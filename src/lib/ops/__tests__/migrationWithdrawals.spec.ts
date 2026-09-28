/**
 * Migrations declared withdrawn — what the declaration may and may not say.
 *
 * Three files have been reported NOT APPLIED by the prime's nightly
 * `migration-drift` run on every night since 21 Sep 2026, and none of them is
 * owed: one was withdrawn at the owner's direction, two were superseded by
 * later files whose work they would undo. `MIGRATION_WITHDRAWN.json` says so,
 * and these specs hold what it is allowed to say.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assessMigrationDrift } from '../../../../scripts/ops/migrationDrift.pure.mjs';
import {
  WITHDRAWALS_PATH,
  assessWithdrawal,
  parseWithdrawals,
  validateWithdrawals,
  withdrawalsByFile,
} from '../../../../scripts/ops/migrationWithdrawals.pure.mjs';
import { migrationText } from '../../testSupport/migrationCorpus';

const m = (over: Record<string, unknown> = {}) => ({
  version: '20260728120000',
  file: '20260728120000_aml_verification_checks.sql',
  objects: ['table:aml.verification_checks', 'index:uq_aml_verification_attempt'],
  probe: null,
  ...over,
});

const aml = {
  file: '20260728120000_aml_verification_checks.sql',
  absent: ['index:uq_aml_verification_attempt'],
};

describe('assessMigrationDrift — a declared withdrawal', () => {
  it('reports a withdrawn file as withdrawn, never as NOT APPLIED', () => {
    const r = assessMigrationDrift({
      migrations: [m()],
      appliedVersions: [],
      existingObjects: ['table:aml.verification_checks'],
      withdrawn: withdrawalsByFile([aml]),
    });
    expect(r.notApplied).toHaveLength(0);
    expect(r.withdrawn.map((x: { file: string }) => x.file)).toEqual([aml.file]);
    expect(r.contradicted).toHaveLength(0);
  });

  /*
   * The declaration is a claim about the database, so it is checked against
   * the database. An index that comes back by some other route makes the
   * manifest false, and a false manifest is the same disagreement between
   * repository and database that NOT APPLIED reports.
   */
  it('reports the declaration contradicted when an object it names as absent exists', () => {
    const r = assessMigrationDrift({
      migrations: [m()],
      appliedVersions: [],
      existingObjects: ['table:aml.verification_checks', 'index:uq_aml_verification_attempt'],
      withdrawn: withdrawalsByFile([aml]),
    });
    expect(r.withdrawn).toHaveLength(0);
    expect(r.contradicted).toHaveLength(1);
    expect(r.contradicted[0].present).toEqual(['index:uq_aml_verification_attempt']);
  });

  /*
   * `20260724000000` is shared by two files. Recording the sibling records
   * the version, and a ledger check would then stop looking at the withdrawn
   * file for good. The withdrawal is judged before the ledger is consulted.
   */
  it('still checks a withdrawn file whose version the ledger records', () => {
    const portfolio = {
      version: '20260724000000',
      file: '20260724000000_prevent_duplicate_portfolio_publications.sql',
      objects: ['index:client_portal_reports_unique_portfolio_source'],
      probe: null,
    };
    const r = assessMigrationDrift({
      migrations: [portfolio],
      appliedVersions: ['20260724000000'],
      existingObjects: ['index:client_portal_reports_unique_portfolio_source'],
      withdrawn: withdrawalsByFile([{ file: portfolio.file, absent: portfolio.objects }]),
    });
    expect(r.contradicted).toHaveLength(1);
  });

  it('leaves every file the manifest does not name exactly as it was', () => {
    const other = m({ version: '20261219010000', file: '20261219010000_x.sql', objects: ['table:public.gone'] });
    const r = assessMigrationDrift({
      migrations: [other],
      appliedVersions: [],
      existingObjects: [],
      withdrawn: withdrawalsByFile([aml]),
    });
    expect(r.notApplied.map((x: { file: string }) => x.file)).toEqual(['20261219010000_x.sql']);
  });

  it('accepts the declaration as a plain object as well as a Map', () => {
    const r = assessMigrationDrift({
      migrations: [m()],
      appliedVersions: [],
      existingObjects: [],
      withdrawn: { [aml.file]: aml },
    });
    expect(r.withdrawn).toHaveLength(1);
  });
});

describe('assessWithdrawal', () => {
  it('names each declared-absent object that exists', () => {
    expect(assessWithdrawal(aml, new Set())).toEqual({ verdict: 'withdrawn', present: [] });
    expect(assessWithdrawal(aml, new Set(aml.absent))).toEqual({
      verdict: 'contradicted',
      present: aml.absent,
    });
  });
});

describe('parseWithdrawals — a manifest that cannot be read is reported, not treated as empty', () => {
  it('reports invalid JSON', () => {
    expect(parseWithdrawals('{').errors[0]).toMatch(/not valid JSON/);
  });

  it('reports a schema version it does not know', () => {
    expect(parseWithdrawals('{"schema_version": 2, "withdrawn": []}').errors[0]).toMatch(/schema_version/);
  });

  it('reports a missing list', () => {
    expect(parseWithdrawals('{"schema_version": 1}').errors[0]).toMatch(/must be an array/);
  });

  it('reads a well-formed manifest', () => {
    const { entries, errors } = parseWithdrawals(JSON.stringify({ schema_version: 1, withdrawn: [aml] }));
    expect(errors).toEqual([]);
    expect(entries).toHaveLength(1);
  });
});

describe('validateWithdrawals', () => {
  const files = new Set([
    '20260724000000_prevent_duplicate_portfolio_publications.sql',
    '20260728120000_aml_verification_checks.sql',
    '20260921100000_withdraw_builder_aml_partner_portal_changes.sql',
  ]);
  const objectsOf = (file: string) => (file.startsWith('20260728120000')
    ? ['table:aml.verification_checks', 'index:uq_aml_verification_attempt']
    : ['index:client_portal_reports_unique_portfolio_source']);
  const ok = {
    ...aml,
    decided: '2026-09-21',
    withdrawn_by: '20260921100000_withdraw_builder_aml_partner_portal_changes.sql',
    reason: 'Withdrawn at the owner\'s direction with the other 21 Sep 2026 AML/CTF changes.',
  };
  const check = (entries: unknown[]) => validateWithdrawals(entries, { files, objectsOf });

  it('passes a sound entry', () => {
    expect(check([ok])).toEqual([]);
  });

  it('refuses a file that does not exist', () => {
    expect(check([{ ...ok, file: '20260728120000_aml_verification_check.sql' }])[0]).toMatch(/no such migration/);
  });

  it('refuses an empty absent list, which no database could ever contradict', () => {
    expect(check([{ ...ok, absent: [] }])[0]).toMatch(/must name at least one object/);
  });

  it('refuses an absent object the file never creates', () => {
    expect(check([{ ...ok, absent: ['index:uq_aml_verification_attempts'] }])[0])
      .toMatch(/not an object this file creates/);
  });

  it('refuses a successor that does not exist or that runs first', () => {
    expect(check([{ ...ok, withdrawn_by: '20260921100000_missing.sql' }])[0]).toMatch(/does not exist/);
    expect(check([{ ...ok, withdrawn_by: '20260724000000_prevent_duplicate_portfolio_publications.sql' }])[0])
      .toMatch(/must run after/);
  });

  it('refuses a date that is not a date and a reason that is not a sentence', () => {
    expect(check([{ ...ok, decided: '21 Sep' }])).toEqual([expect.stringMatching(/YYYY-MM-DD/)]);
    expect(check([{ ...ok, reason: 'withdrawn' }])).toEqual([expect.stringMatching(/must say why/)]);
  });

  it('refuses a file listed twice or out of order', () => {
    const portfolio = {
      ...ok,
      file: '20260724000000_prevent_duplicate_portfolio_publications.sql',
      absent: ['index:client_portal_reports_unique_portfolio_source'],
      withdrawn_by: undefined,
    };
    expect(check([ok, ok]).some((e) => /listed twice/.test(e))).toBe(true);
    expect(check([ok, portfolio]).some((e) => /file order/.test(e))).toBe(true);
  });
});

/*
 * The manifest in the tree, against the tree. The gate checks the same thing
 * in CI; this keeps it true for anyone running the suite, and it uses the
 * drift report's own spelling of an object, which is the only spelling the
 * database side is ever compared against.
 */
describe('the manifest this repository carries', () => {
  const MIGRATIONS = 'supabase/migrations';

  it('is sound against the migrations it names', async () => {
    const { sqlWithoutComments, withoutUnnameableCreates } = await import('../../../../scripts/ops/migration-drift.mjs');
    const { objectsCreatedIn } = await import('../../../../scripts/build-migration-object-index.mjs');
    const { entries, errors } = parseWithdrawals(readFileSync(WITHDRAWALS_PATH, 'utf8'));
    expect(errors).toEqual([]);
    const files = new Set(readdirSync(MIGRATIONS).filter((f) => /^\d{14}_.+\.sql$/.test(f)));
    const objectsOf = (file: string) =>
      objectsCreatedIn(withoutUnnameableCreates(sqlWithoutComments(migrationText(file))));
    expect(validateWithdrawals(entries, { files, objectsOf })).toEqual([]);
  });

  /*
   * A withdrawal is a decision already taken, and the manifest records it; it
   * is never where a decision is made. Each entry names the file or run that
   * took it, so a reviewer can check the record rather than trust the list.
   */
  it('names, for every entry, where the decision is recorded', () => {
    const { entries } = parseWithdrawals(readFileSync(WITHDRAWALS_PATH, 'utf8'));
    for (const e of entries) {
      expect(String(e.evidence ?? e.withdrawn_by ?? e.superseded_by ?? '')).not.toEqual('');
    }
  });
});

describe('readWithdrawals — the drift report never mistakes an unreadable manifest for an empty one', () => {
  it('treats a missing manifest as empty, and a broken one as a fault', async () => {
    const { readWithdrawals } = await import('../../../../scripts/ops/migration-drift.mjs');
    const dir = mkdtempSync(join(tmpdir(), 'withdrawn-'));
    expect(readWithdrawals(join(dir, 'absent.json'))).toEqual({ byFile: new Map(), errors: [] });

    const broken = join(dir, 'broken.json');
    writeFileSync(broken, '{"schema_version": 1, "withdrawn": ');
    const r = readWithdrawals(broken);
    expect(r.byFile.size).toBe(0);
    expect(r.errors[0]).toMatch(/not valid JSON/);
  });
});
