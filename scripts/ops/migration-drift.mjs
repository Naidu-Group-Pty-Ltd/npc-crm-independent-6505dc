#!/usr/bin/env node
/**
 * Report which merged migrations have not reached the database.
 *
 *   node scripts/ops/migration-drift.mjs --facts facts.json [--json] [--quiet-unverifiable]
 *
 * `facts.json` is what the workflow's psql probe collected — the database
 * side of the question, so this process needs no credential:
 *
 *   {
 *     "appliedVersions": ["20250124160000", ...],
 *     "existingObjects": ["table:public.urban_centre_register", ...],
 *     "probeResults":    { "20261209000000_seed_....sql": true }
 *   }
 *
 * Exit 1 when anything is `not_applied`. `unverifiable` does not fail the run
 * on its own — 800-odd historical files declare no probe and failing on them
 * would make this report the thing people switch off — but it is always
 * printed, and a file added from here on can close its own gap with one line.
 *
 * See `migrationDrift.pure.mjs` for why the ledger cannot answer this.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { objectsCreatedIn, effectProbeIn } from '../build-migration-object-index.mjs';
import { assessMigrationDrift, probeIsReadOnly } from './migrationDrift.pure.mjs';

const MIGRATIONS_DIR = 'supabase/migrations';

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
};
const has = (name) => process.argv.includes(name);

/**
 * The SQL with its comments removed.
 *
 * `objectsCreatedIn` deliberately counts a name that appears only in a
 * comment, and its own header says why: for the PARITY report that pushes an
 * object toward "ours", which is the side that gets reviewed rather than the
 * side that gets dropped. Here the same imprecision points the other way. A
 * phantom object can never exist in the catalogue, so it makes an applied
 * migration read as NOT APPLIED — and measured 21 Sep 2026 on the prime it
 * produced `table:if` (from `-- Everything here is idempotent (CREATE TABLE IF
 * NOT EXISTS …`), `table:skips` (`-- … CREATE TABLE IF NOT EXISTS skips the
 * new inline definition`), `function:as` and `trigger:on`, each condemning a
 * migration that had run.
 *
 * So the rule is not changed, it is asked of code alone. The index keeps its
 * bytes and its meaning; the gate stops crying wolf.
 */
export function sqlWithoutComments(src) {
  return String(src ?? '')
    // Block comments first: a `--` inside one is not a line comment.
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
}

/**
 * The SQL with the CREATEs whose object cannot be NAMED from the source.
 *
 * Two shapes, both in code rather than prose, so comment-stripping does not
 * reach them, and both measured on the prime 21 Sep 2026:
 *
 *   CREATE INDEX ON aml.step_up_challenges(user_id, capability, created_at DESC);
 *
 * is an UNNAMED index — Postgres generates the name, and there is no object
 * called `on`. The extractor reads the keyword as the name.
 *
 *   EXECUTE format('CREATE TRIGGER trg_touch_%1$s BEFORE UPDATE ON aml.%1$s …', t);
 *
 * builds the name by interpolation, so the capture stops at the `%` and
 * yields the fragment `trg_touch_`. The real triggers are
 * `trg_touch_documents` and three siblings, and the file creates all four.
 *
 * In both cases the object is real and its name is not in the file, so it can
 * verify nothing — and judging a migration by a name that cannot exist reads
 * a migration that RAN as one that never did. Neither statement is deleted:
 * only the `create` keyword is broken, so the rest of the file still yields
 * every object it does name.
 */
export function withoutUnnameableCreates(sql) {
  return String(sql ?? '')
    // An index with no name of its own.
    .replace(/\bcreate(\s+unique)?\s+index\s+(?=on\b)/gi, 'created$1_index_')
    // A name assembled by `format()`: the identifier runs into a placeholder.
    .replace(
      /*
       * The lookahead walks CHARACTERS, never a starred group of `+` runs:
       * `(?:[A-Za-z0-9_$]+)*%` backtracks catastrophically on every name this
       * file does not interpolate, which is nearly all of them — it hung the
       * reader past two minutes on the first run. It is also bounded, because
       * an identifier is not 200 characters long.
       */
      /\bcreate(\s+or\s+replace)?(\s+unique)?(\s+materialized)?\s+(table|view|function|index|trigger|sequence|type|schema)\s+(?=[A-Za-z0-9_$."]{0,200}%)/gi,
      'created$1$2$3_$4_',
    );
}

/**
 * An object this migration creates that could still be absent afterwards.
 *
 * `pg_temp` is the only exclusion and it is not a heuristic: a function in the
 * temporary schema is dropped when the session that made it ends, so it is
 * absent from the catalogue on every correct run. Judging a migration by one
 * is judging it by something guaranteed false.
 */
const isDurable = (o) => !/(^|:)pg_temp\./.test(o);

/** Every migration in the repo, with what it creates and what it claims. */
export function readRepoMigrations(dir = MIGRATIONS_DIR) {
  return readdirSync(dir)
    .filter((f) => /^\d{14}_.*\.sql$/.test(f))
    .sort()
    .map((file) => {
      const src = readFileSync(join(dir, file), 'utf8');
      const probe = effectProbeIn(src);
      return {
        version: file.slice(0, 14),
        file,
        objects: objectsCreatedIn(withoutUnnameableCreates(sqlWithoutComments(src))).filter(isDurable),
        // A probe that is not a lone SELECT is refused here rather than sent to
        // the database, and the file is then judged on its objects alone.
        probe: probe && probeIsReadOnly(probe) ? probe : null,
        probeRefused: Boolean(probe) && !probeIsReadOnly(probe),
      };
    });
}

function main() {
  const factsPath = arg('--facts');
  if (!factsPath) {
    console.error('usage: node scripts/ops/migration-drift.mjs --facts <facts.json> [--json]');
    process.exit(2);
  }
  const facts = JSON.parse(readFileSync(factsPath, 'utf8'));
  const migrations = readRepoMigrations();
  const refused = migrations.filter((m) => m.probeRefused);

  const result = assessMigrationDrift({
    migrations,
    appliedVersions: facts.appliedVersions ?? [],
    existingObjects: facts.existingObjects ?? [],
    probeResults: facts.probeResults ?? {},
  });

  if (has('--json')) {
    console.log(JSON.stringify({ ...result, refusedProbes: refused.map((m) => m.file) }, null, 2));
  } else {
    const n = migrations.length;
    console.log(`Migration drift — ${n} migration(s) in the repo, `
      + `${(facts.appliedVersions ?? []).length} recorded in the ledger.\n`);
    console.log(`  effect present : ${result.effectPresent.length.toString().padStart(4)}  `
      + '(unrecorded, but what they do is already done)');
    console.log(`  unverifiable   : ${result.unverifiable.length.toString().padStart(4)}  `
      + '(create no object, declare no @effect probe)');
    console.log(`  NOT APPLIED    : ${result.notApplied.length.toString().padStart(4)}  `
      + '(merged, and the database does not carry it)');

    if (refused.length) {
      console.log('\nRefused @effect probes (not a lone SELECT — never executed):');
      for (const m of refused) console.log(`  - ${m.file}`);
    }

    if (result.notApplied.length) {
      console.log('\nNOT APPLIED — oldest first:\n');
      for (const r of result.notApplied) {
        console.log(`  ${r.file}`);
        console.log(`      ${r.why}`);
        for (const o of r.missing.slice(0, 5)) console.log(`      missing: ${o}`);
        if (r.missing.length > 5) console.log(`      …and ${r.missing.length - 5} more`);
      }
      console.log('\nApply one with the "Apply a migration" workflow, newest-last.');
    }

    if (!has('--quiet-unverifiable') && result.unverifiable.length) {
      const recent = result.unverifiable.slice(-15);
      console.log(`\nUnverifiable — the ${recent.length} most recent of `
        + `${result.unverifiable.length}. Add one line to close the gap:`);
      console.log('  -- @effect: select 1 from <table> where <the row this file writes>\n');
      for (const r of recent) console.log(`  ${r.file}`);
    }
  }

  process.exit(result.notApplied.length ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
