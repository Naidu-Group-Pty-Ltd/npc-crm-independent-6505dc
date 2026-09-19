/**
 * The `rba_series_meta.table_code` CHECK constraint and the `RbaTableCode`
 * union are ONE vocabulary, and the column is the half that decides.
 *
 * ## Why this test exists
 *
 * RF-7.2B.1 added F1 to the code — `RbaTableCode`, `RBA_WANTED_SERIES`,
 * `RBA_MIN_DATA_ROWS`, the ingest function's accepted tables — and did not
 * widen the CHECK constraint with it. Every gate passed: the type-check was
 * clean, 3,996 unit tests passed, seven CI checks went green, and the defect
 * was invisible until the first real load in production answered
 *
 *     new row for relation "rba_series_meta" violates check constraint
 *     "rba_series_meta_table_code_check"
 *
 * because no test in this repository compares a TypeScript vocabulary against
 * the constraint that actually admits it.
 *
 * ## The class
 *
 * This repository has now met it three times:
 *
 *  - `template_library_entries_category_check` vs `TemplateLibraryCategory` —
 *    the union has `market`, the column has `suburb`/`postcode`/`statewide`,
 *    and 50 masters were rejected by Postgres MID-APPLY after 290 rows;
 *  - `report_geography.method` vs `'point_in_polygon'` — the sweep writes a
 *    value the constraint refuses (latent: its work list has been empty);
 *  - `rba_series_meta.table_code` vs `RbaTableCode` — this one.
 *
 * In every case the column decides and the union only proposes. So this reads
 * the MIGRATION, not a hand-copied list: a second transcription of the
 * vocabulary would be a third thing to keep in step.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { RBA_WANTED_SERIES } from '../../../../supabase/functions/_shared/rbaTables.pure';

const MIGRATIONS = resolve(__dirname, '../../../../supabase/migrations');

/**
 * The codes the LIVE constraint admits, read from the most recent migration
 * that defines it. Reading the newest rather than the first is the point: a
 * later migration is what widens it.
 */
function admittedByConstraint(): string[] {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  let latest: string | null = null;
  for (const file of files) {
    const sql = readFileSync(resolve(MIGRATIONS, file), 'utf-8');
    // Both spellings the repo uses: the inline `check (...)` on CREATE TABLE
    // and the named ADD CONSTRAINT that widens it later.
    const m = sql.match(/table_code\s+text\s+not\s+null\s+check\s*\(\s*table_code\s+in\s*\(([^)]*)\)/i)
      ?? sql.match(/ADD\s+CONSTRAINT\s+rba_series_meta_table_code_check\s+CHECK\s*\(\s*table_code\s+IN\s*\(([^)]*)\)/i);
    if (m) latest = m[1];
  }
  if (latest === null) throw new Error('no migration defines rba_series_meta.table_code');
  return [...latest.matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
}

describe('rba_series_meta.table_code — the column and the union are one vocabulary', () => {
  it('every table the loader can fetch is admitted by the constraint', () => {
    const admitted = admittedByConstraint();
    const wanted = Object.keys(RBA_WANTED_SERIES).sort();

    const refused = wanted.filter((code) => !admitted.includes(code));
    expect(
      refused,
      `These table codes are loadable in TypeScript but REFUSED by the database:\n  `
      + `${refused.join(', ')}\nWiden rba_series_meta_table_code_check in a migration — `
      + `the column decides, the union only proposes.`,
    ).toEqual([]);
  });

  it('and the constraint admits nothing the loader cannot produce', () => {
    // The other direction: a code in the constraint with no series behind it is
    // a column that has drifted ahead of the product, which is how a typo'd
    // table_code becomes storable.
    const admitted = admittedByConstraint();
    const wanted = Object.keys(RBA_WANTED_SERIES);
    expect(admitted.filter((c) => !wanted.includes(c))).toEqual([]);
  });

  it('f1 specifically — the one that failed in production', () => {
    expect(admittedByConstraint()).toContain('f1');
    expect(Object.keys(RBA_WANTED_SERIES)).toContain('f1');
  });
});
