/**
 * The migration drift report — what it must never get wrong.
 *
 * Every case here is a real observation from 21 Sep 2026 against the
 * production ledger, not an invented scenario.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { assessMigrationDrift, probeIsReadOnly } from '../../../../scripts/ops/migrationDrift.pure.mjs';
import { migrationText, migrationsContaining } from '../../testSupport/migrationCorpus';

const MIGRATIONS = 'supabase/migrations';

const m = (over: Record<string, unknown> = {}) => ({
  version: '20261209000000', file: 'x.sql', objects: [], probe: null, ...over,
});

describe('assessMigrationDrift', () => {
  it('says nothing about a migration the ledger already records', () => {
    const r = assessMigrationDrift({
      migrations: [m({ objects: ['table:public.gone'] })],
      appliedVersions: ['20261209000000'],
      existingObjects: [],
    });
    expect(r.rows).toHaveLength(0);
  });

  /*
   * The whole reason this module exists. Measured: 832 of 1,008 repo
   * migrations carry no ledger row while their objects exist, because
   * migrations here have been applied through routes that record nothing. A
   * report that called those 832 a backlog would be a report nobody reads.
   */
  it('does not call an unrecorded migration a backlog when its objects exist', () => {
    const r = assessMigrationDrift({
      migrations: [m({ objects: ['table:public.urban_centre_register'] })],
      appliedVersions: [],
      existingObjects: ['table:public.urban_centre_register'],
    });
    expect(r.notApplied).toHaveLength(0);
    expect(r.effectPresent).toHaveLength(1);
  });

  it('reports a migration whose object is absent', () => {
    const r = assessMigrationDrift({
      migrations: [m({ objects: ['table:public.a', 'table:public.b'] })],
      appliedVersions: [],
      existingObjects: ['table:public.a'],
    });
    expect(r.notApplied).toHaveLength(1);
    expect(r.notApplied[0].missing).toEqual(['table:public.b']);
  });

  /*
   * The flaw production caught in the first cut of this module, and the reason
   * the probe outranks object counting.
   *
   * Seeds v12 through v18 each create the same helper tables with
   * `if not exists`. v17 created them; v18's objects therefore ALL exist while
   * v18's rows never landed — `template_library_release_baselines` holds v15,
   * v16 and v17 at 543 rows each and no v18. Counting objects would have
   * called it `effect_present` and been wrong, which is precisely the defect
   * that left every report printing "Five dimensions, weighted" over a table
   * of three rows.
   */
  it('believes the declared probe over objects that an earlier migration created', () => {
    const seed = m({
      file: 'v18.sql',
      objects: ['table:public.template_library_release_baselines'],
      probe: "select 1 from public.template_library_release_baselines where release = 'v18'",
    });
    const r = assessMigrationDrift({
      migrations: [seed],
      appliedVersions: [],
      // The table exists — v17 made it.
      existingObjects: ['table:public.template_library_release_baselines'],
      probeResults: new Map([['v18.sql', false]]),
    });
    expect(r.notApplied).toHaveLength(1);
    expect(r.notApplied[0].why).toMatch(/probe is NOT satisfied/);
  });

  it('does not pass a probe that was never run', () => {
    const r = assessMigrationDrift({
      migrations: [m({ file: 'v18.sql', probe: 'select 1' })],
      appliedVersions: [], existingObjects: [], probeResults: new Map(),
    });
    expect(r.notApplied).toHaveLength(1);
    expect(r.notApplied[0].why).toMatch(/was not run/);
  });

  /*
   * `unverifiable` is reported rather than passed. An INSERT-only migration
   * with no probe is not evidence of anything, and silently treating it as
   * applied is the failure this module was written for.
   */
  it('keeps an unjudgeable migration visible rather than passing it', () => {
    const r = assessMigrationDrift({
      migrations: [m({ objects: [], probe: null })],
      appliedVersions: [], existingObjects: [],
    });
    expect(r.unverifiable).toHaveLength(1);
    expect(r.effectPresent).toHaveLength(0);
    expect(r.notApplied).toHaveLength(0);
  });
});

describe('probeIsReadOnly — a probe is read from the repo and run against a writable connection', () => {
  it('accepts a lone select', () => {
    expect(probeIsReadOnly('select 1 from public.t where x = 1')).toBe(true);
  });

  /*
   * A column may be NAMED for a keyword without being one. The first version
   * of this test asserted that `delete_me` was refused; it is not, because
   * `\bdelete\b` finds no boundary before `_`, and the guard is right — the
   * statement is an ordinary SELECT over a column with an unfortunate name.
   * The test was pinning a defect it had invented.
   */
  it('accepts a select over a column whose name contains a keyword', () => {
    expect(probeIsReadOnly('select 1 from t where deleted_at is null')).toBe(true);
    expect(probeIsReadOnly('select 1 from t where f() and delete_me')).toBe(true);
  });

  it.each([
    ['a second statement', 'select 1; drop table t'],
    ['a write', 'insert into t values (1)'],
    ['a write behind a CTE', 'with x as (select 1) update t set a = 1'],
    ['a function that writes', 'select public.truncate everything'],
    ['a DO block', 'do $$ begin end $$'],
    ['a procedure call', 'call public.rebuild()'],
    ['empty', '   '],
  ])('refuses %s', (_label, sql) => {
    expect(probeIsReadOnly(sql)).toBe(false);
  });
});

describe('the probes this repository actually declares', () => {
  // Byte-gated: `supabase/migrations` is 620 MB and all but ~14 MB of it is
  // the generated template library, so decoding every file to find a comment
  // header costs seconds per suite. The gate carries both casings because the
  // match below is `/i` -- see `testSupport/migrationCorpus`.
  const declared = migrationsContaining(['@effect', '@EFFECT'])
    .filter((f) => /^\d{14}_.*\.sql$/.test(f))
    .map((f) => ({ f, src: migrationText(f) }))
    .map(({ f, src }) => ({ f, probe: src.match(/^\s*--\s*@effect:\s*(.+?)\s*$/mi)?.[1] ?? null }))
    .filter((x) => x.probe);

  it('declares at least one, so the mechanism is exercised rather than described', () => {
    expect(declared.length).toBeGreaterThan(0);
  });

  it('every declared probe is read-only', () => {
    const bad = declared.filter((x) => !probeIsReadOnly(x.probe as string));
    expect(bad.map((x) => x.f)).toEqual([]);
  });
});

/*
 * What the reporter's first real run found — about itself.
 *
 * Dispatched 21 Sep 2026 against the prime, the job reported fourteen
 * unapplied migrations and finished GREEN, and five of the fourteen were
 * condemned by an object that appears only in a comment. Each half on its own
 * makes the gate useless: one never fails, the other fails for nothing.
 */
describe('the gate reports on itself', () => {
  it('reads no object out of a comment', async () => {
    const { sqlWithoutComments } = await import('../../../../scripts/ops/migration-drift.mjs');
    const { objectsCreatedIn } = await import('../../../../scripts/build-migration-object-index.mjs');

    // Verbatim from the four migrations the run named.
    const src = [
      '-- Everything here is idempotent (CREATE TABLE IF NOT EXISTS / CREATE OR REPLACE',
      'CREATE TABLE IF NOT EXISTS public.provider_circuit_state (id int);',
      '-- constraint (CREATE TABLE IF NOT EXISTS skips the new inline definition)',
      "-- WP-17's `secdef_execute` rule reads CREATE FUNCTION as granting EXECUTE to",
      '-- though a role able to CREATE TRIGGER on its own table could still have',
      '/* CREATE VIEW in_a_block_comment AS select 1; */',
    ].join('\n');

    const objects = objectsCreatedIn(sqlWithoutComments(src));
    expect(objects).toEqual(['table:public.provider_circuit_state']);
    // The shared extractor still counts them, deliberately, for parity.
    expect(objectsCreatedIn(src)).toContain('table:if');
  });

  it('keeps a real object that sits beside prose mentioning another', async () => {
    const { sqlWithoutComments } = await import('../../../../scripts/ops/migration-drift.mjs');
    const { objectsCreatedIn } = await import('../../../../scripts/build-migration-object-index.mjs');
    const src = 'CREATE INDEX idx_a ON t(c); -- replaces CREATE INDEX idx_b\nCREATE VIEW v AS select 1;';
    expect(objectsCreatedIn(sqlWithoutComments(src)).sort()).toEqual(['index:idx_a', 'view:v']);
  });

  it('never judges a migration by a pg_temp function, which cannot survive its session', async () => {
    const mod = await import('../../../../scripts/ops/migration-drift.mjs');
    const { objectsCreatedIn } = await import('../../../../scripts/build-migration-object-index.mjs');
    const src = 'CREATE FUNCTION pg_temp.safe_jsonb(t text) RETURNS jsonb AS $$ select null::jsonb $$ LANGUAGE sql;';
    const objects = objectsCreatedIn(mod.sqlWithoutComments(src));
    expect(objects).toContain('function:pg_temp.safe_jsonb');
    // …and the reader drops it, so the file falls through to its probe.
    const kept = objects.filter((o: string) => !/(^|:)pg_temp\./.test(o));
    expect(kept).toEqual([]);
  });

  /*
   * `$?` after `cmd | tee` is tee's status. The gate read it and was therefore
   * skipped on every run ever made.
   */
  it('does not take its exit status from the end of a pipe', async () => {
    const { readFileSync } = await import('node:fs');
    const wf = readFileSync('.github/workflows/migration-drift.yml', 'utf8');
    expect(wf).not.toMatch(/migration-drift\.mjs[^\n]*\|\s*tee/);
    expect(wf).toMatch(/status=\$status/);
  });
});

/*
 * The two artefacts that survived comment-stripping, because they are code.
 * Both verbatim from the migrations the 21 Sep 2026 run named.
 */
describe('a name that is not in the file verifies nothing', () => {
  const load = async () => {
    const mod = await import('../../../../scripts/ops/migration-drift.mjs');
    const { objectsCreatedIn } = await import('../../../../scripts/build-migration-object-index.mjs');
    return (sql: string) => objectsCreatedIn(mod.withoutUnnameableCreates(mod.sqlWithoutComments(sql)));
  };

  it('reads no object from an UNNAMED index', async () => {
    const objects = await load().then((f) => f(
      'CREATE INDEX ON aml.step_up_challenges(user_id, capability, created_at DESC);\n'
      + 'CREATE UNIQUE INDEX ON aml.step_up_sessions(user_id);\n'
      + 'CREATE INDEX idx_real ON aml.t(c);',
    ));
    // Postgres generates the name; there is no object called `on`.
    expect(objects).toEqual(['index:idx_real']);
  });

  it('reads no object from a name built by format()', async () => {
    const objects = await load().then((f) => f(
      "EXECUTE format('CREATE TRIGGER trg_touch_%1$s BEFORE UPDATE ON aml.%1$s FOR EACH ROW EXECUTE FUNCTION aml.touch_updated_at();', t);\n"
      + 'CREATE TRIGGER aml_rd_updated BEFORE UPDATE ON aml.t FOR EACH ROW EXECUTE FUNCTION f();',
    ));
    // `trg_touch_` is a fragment; the four real triggers are not in the file.
    expect(objects).toEqual(['trigger:aml_rd_updated']);
  });

  it('is a no-op on ordinary SQL, so nothing real is lost', async () => {
    const f = await load();
    const ordinary = 'CREATE TABLE public.a (id int);\nCREATE OR REPLACE FUNCTION public.b() RETURNS void AS $$ $$ LANGUAGE sql;\nCREATE MATERIALIZED VIEW public.c AS select 1;';
    // `view:`, not `materialized_view:` — the shared extractor's optional
    // `materialized` prefix is consumed before the class is read. Pre-existing
    // and untouched here; asserted as it IS rather than as it reads.
    expect(f(ordinary)).toEqual(['function:public.b', 'table:public.a', 'view:public.c']);
  });

  /*
   * `(?:[A-Za-z0-9_$]+)*%` backtracks catastrophically on every name that is
   * NOT interpolated, which is nearly all of them; the first version hung the
   * reader past two minutes over the real migration set.
   */
  it('does not backtrack on a long ordinary identifier', async () => {
    const f = await load();
    const sql = `CREATE TABLE public.${'a'.repeat(200)} (id int);`;
    const started = Date.now();
    expect(f(sql)).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

/*
 * The third class of the same fault, this time in the collector's own SQL.
 *
 * Seven unqualified `CREATE TYPE`s across two migrations were reported absent
 * because the catalogue published only the qualified spelling. Both files had
 * run. The collector's comment already stated the rule for indexes and
 * triggers; it was true of every class.
 */
describe('a bare source name needs a bare catalogue entry', () => {
  it('publishes both spellings for every class the extractor can emit bare', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync('.github/scripts/migration-drift-facts.mjs', 'utf8');
    // `CREATE TYPE foo AS ENUM (…)` and `CREATE TABLE foo (…)` name no schema.
    for (const cls of ['table', 'view', 'materialized_view', 'sequence', 'index', 'function', 'type']) {
      expect(sql, `${cls} has no bare spelling`).toMatch(
        new RegExp(`'${cls}:'\\\\|\\\\|(c\\\\.relname|p\\\\.proname|t\\\\.typname)`),
      );
    }
  });

  it('still matches a QUALIFIED source name only on the qualified entry', async () => {
    const { assessMigrationDrift } = await import('../../../../scripts/ops/migrationDrift.pure.mjs');
    const result = assessMigrationDrift({
      migrations: [{ version: '1', file: 'a.sql', objects: ['table:public.foo'], probe: null }],
      appliedVersions: [],
      // Only a bare entry, and a different schema's table could be its source.
      existingObjects: ['table:foo', 'table:other.foo'],
    });
    expect(result.notApplied).toHaveLength(1);
  });

  it('matches a bare source name on the bare entry', async () => {
    const { assessMigrationDrift } = await import('../../../../scripts/ops/migrationDrift.pure.mjs');
    const result = assessMigrationDrift({
      migrations: [{ version: '1', file: 'a.sql', objects: ['type:report_tier_enum'], probe: null }],
      appliedVersions: [],
      existingObjects: ['type:public.report_tier_enum', 'type:report_tier_enum'],
    });
    expect(result.notApplied).toHaveLength(0);
  });
});

/*
 * And the same fault once more, in the CLASS rather than the schema.
 *
 * A test above records that `CREATE MATERIALIZED VIEW` normalises to `view:`.
 * What it did not follow through to is that the catalogue spells relkind 'm'
 * as `materialized_view:`, so the two could never meet — which is why
 * `public.pdf_import_cost_daily` was reported absent on two migrations that
 * had both run.
 */
describe('a materialized view answers to both words', () => {
  it('is published under view: as well, so an extracted view: can match', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync('.github/scripts/migration-drift-facts.mjs', 'utf8');
    expect(sql).toMatch(/'view:'\|\|n\.nspname[^\n]*relkind in \('v','m'\)/);
    expect(sql).toMatch(/'view:'\|\|c\.relname\s+from pg_class c where c\.relkind in \('v','m'\)/);
  });

  it('resolves the finding it was written for', async () => {
    const { assessMigrationDrift } = await import('../../../../scripts/ops/migrationDrift.pure.mjs');
    const migrations = [{
      version: '20260614032708', file: 'docling.sql',
      objects: ['view:public.pdf_import_cost_daily'], probe: null,
    }];
    // Before: the catalogue offered only the materialized spelling.
    expect(assessMigrationDrift({
      migrations, appliedVersions: [],
      existingObjects: ['materialized_view:public.pdf_import_cost_daily'],
    }).notApplied).toHaveLength(1);
    // After: both words.
    expect(assessMigrationDrift({
      migrations, appliedVersions: [],
      existingObjects: ['materialized_view:public.pdf_import_cost_daily', 'view:public.pdf_import_cost_daily'],
    }).notApplied).toHaveLength(0);
  });

  /*
   * The SQL lives in a template literal, so a backtick in one of its comments
   * ends the string and the file stops parsing. It did, on the commit that
   * added the comment above.
   */
  it('keeps the catalogue query free of backticks', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('.github/scripts/migration-drift-facts.mjs', 'utf8');
    const open = 'const existingObjects = await q(`';
    const body = src.slice(src.indexOf(open) + open.length);
    expect(body.slice(0, body.indexOf('`);'))).not.toContain('`');
  });
});
