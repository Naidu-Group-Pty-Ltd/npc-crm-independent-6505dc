/**
 * The repair of library refreshes that ran before their seeds
 * (`20261226100000_refresh_masters_whose_refresh_ran_before_its_seed`).
 *
 * A refresh run ahead of its seed finds no baseline, replaces nothing and is
 * recorded, so its masters stay on the old release for good. Measured 23–26
 * Sep 2026 on three clones; the migration's header has the account. What makes
 * the repair safe is a handful of properties of its SQL, and these pin them:
 *
 *   - it NAMES every seed and refresh it judges, in executable SQL, because
 *     that is how Mission Control's fleet lane knows to hold it until each has
 *     landed on a clone — sent early, it would judge a refresh whose seed was
 *     still missing, which is the fault it repairs;
 *   - a refresh counts as early only where one of its OWN decisions predates
 *     its release's baseline, so wherever every seed ran first it changes
 *     nothing;
 *   - it rewrites a master only when it is proven an unedited copy of a
 *     release that was missed, after snapshotting it, and never one that a
 *     proper refresh judged — which is what keeps an operator's restore;
 *   - every write is idempotent, so a re-applied migration changes nothing.
 *
 * Execution was proven separately, by replaying the real v15–v22 refresh
 * migrations against Postgres 16 in both orders (see the pull request that
 * added it). This file keeps a later edit from quietly dropping a property;
 * the applied-bodies guard keeps the file itself from changing once it runs.
 */
import { describe, expect, it } from 'vitest';
import { migrationNames, migrationText } from '../../testSupport/migrationCorpus';

const FILE = '20261226100000_refresh_masters_whose_refresh_ran_before_its_seed.sql';
const REPAIR = FILE.replace(/\.sql$/, '');

const sql = migrationText(FILE);
/** The SQL with its line comments removed — a comment naming a release is prose. */
const code = sql
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');

/** The refreshes that judge against a release baseline: v15 onwards. */
const refreshes = migrationNames().filter((n) =>
  /^\d{14}_refresh_active_masters_from_library_v(1[5-9]|2[0-2])\.sql$/.test(n),
);

describe('the repair names every release whose refresh it judges', () => {
  it('finds the eight refreshes that judge against a baseline', () => {
    expect(refreshes).toHaveLength(8);
  });

  it('names each refresh, and the seed that refresh reads, in executable SQL', () => {
    for (const file of refreshes) {
      const refresh = file.replace(/\.sql$/, '');
      // The seed's name is read from the refresh itself, never typed here: the
      // seed files are too large to reach a clone, and the pairing is the
      // refresh's to state.
      const seed = /b\.release = '([^']+)'/.exec(migrationText(file))?.[1];
      expect(seed, `${file} names no seed release`).toBeTruthy();
      expect(code).toContain(`'${refresh}'`);
      expect(code).toContain(`'${seed}'`);
    }
  });
});

describe('an early refresh is measured on the database, from its own rows', () => {
  it('counts a release early only where one of its decisions predates its baseline', () => {
    expect(code).toContain('d.decided_at < b.captured_at');
    // For the SAME entry and release — a baseline for another entry proves
    // nothing about when this decision was taken.
    expect(code).toMatch(/b\.entry_id = d\.entry_id\s+and b\.release = d\.release/);
  });

  it('treats a decision taken after the baseline as a proper judgement, and defers to it', () => {
    expect(code).toContain('p.decided_at >= b.captured_at');
  });
});

describe('it rewrites only a proven unedited copy, and can be undone', () => {
  it('never rewrites a master that already matches its entry', () => {
    const current = code.indexOf("when j.row_digest = j.entry_digest then 'already_current'");
    const refreshed = code.indexOf("when j.missed_unedited then 'refreshed'");
    expect(current).toBeGreaterThan(-1);
    expect(refreshed).toBeGreaterThan(current);
  });

  it('proves "unedited" the way every refresh does: the digest without the palette', () => {
    expect(code).toContain("md5((t.schema #- '{tokens,colors}')::text) as row_digest");
    expect(code).toContain("md5((e.schema #- '{tokens,colors}')::text) as entry_digest");
    expect(code).toContain('b.schema_digest = a.row_digest');
  });

  it('changes report_templates in one statement, and only the rows it proved', () => {
    const updates = code.match(/update\s+public\.report_templates\b/gi) ?? [];
    expect(updates).toHaveLength(1);
    const update = code.slice(code.search(/update\s+public\.report_templates\b/i));
    expect(update.slice(0, update.indexOf(';'))).toContain("c.verdict = 'refreshed'");
  });

  it('carries the row\'s own palette forward', () => {
    expect(code).toContain("coalesce(t.schema -> 'tokens' -> 'colors'");
  });

  it('snapshots and records every master it examined before it changes one', () => {
    const snapshot = code.indexOf('insert into public.report_template_refresh_snapshots');
    const decision = code.indexOf('insert into public.template_master_refresh_decisions');
    const update = code.search(/update\s+public\.report_templates\b/i);
    expect(snapshot).toBeGreaterThan(-1);
    expect(decision).toBeGreaterThan(-1);
    expect(snapshot).toBeLessThan(update);
    expect(decision).toBeLessThan(update);
    expect(code).toContain(`'${REPAIR}'`);
  });

  it('is idempotent: every insert gives way to a row already written', () => {
    const inserts = code.match(/insert\s+into\s+public\.[a-z_]+[\s\S]*?;/gi) ?? [];
    expect(inserts.length).toBeGreaterThanOrEqual(3);
    for (const insert of inserts) expect(insert).toMatch(/on conflict \([^)]+\) do nothing/i);
  });
});

describe('it says what it did', () => {
  it('opens with an @effect probe the drift runner will execute', () => {
    const first = sql.split('\n')[0];
    expect(first).toMatch(/^-- @effect: select 1 from public\.template_master_refresh_repairs where repair = '/);
    const probe = first.replace(/^-- @effect:\s*/, '');
    // The runner's own rule: one statement, opening with SELECT, changing nothing.
    expect(probe).not.toMatch(/;|\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|do|call)\b/i);
    expect(probe).toContain(`'${REPAIR}'`);
  });

  it('writes the row its probe reads on every database, whether or not it found anything', () => {
    expect(code).toMatch(/insert into public\.template_master_refresh_repairs\s*\(/);
    // A row per database, not per master: the count columns are aggregates.
    expect(code).toContain('(select count(*) from _early_refresh_classified)');
  });
});
