/**
 * The seed that activated a production master for the eight dark formats.
 *
 * ## What it did
 *
 * Eight of the nine production formats had ZERO active rows in
 * `report_templates`: nothing ever creates one. The library's `instantiate`
 * deliberately makes inactive user drafts, and the only activation surface is
 * the Builder's superadmin button, one template at a time. So the pickers on
 * every download control listed nothing and every document fell back to the
 * legacy generator — the coverage measure in `docs/reports/COVERAGE.md`.
 *
 * `20260814190000_activate_production_masters_eight_formats.sql` copies one
 * curated master per format (Private Banking, variant A — "Chancery") into
 * `report_templates` in exactly the state the Builder's activation gate
 * produces. This spec pins the properties of that file that make it safe to
 * re-run and safe to have run at all. The file has already been applied; these
 * assertions exist so an edit to it — or a copy of it for the next batch of
 * formats — keeps the same contract.
 *
 * ## The four things that must stay true
 *
 * 1. **It only inserts.** An UPDATE or DELETE against `report_templates` in a
 *    seed can displace a template a person chose, which is the one thing the
 *    selection programme promises never happens silently.
 * 2. **It skips formats that already have an active template.** Idempotence is
 *    the file's job (`apply-migration.yml` says so), and "already active"
 *    includes a template a superadmin activated by hand after this shipped.
 * 3. **It creates rows in the activation gate's state.** `is_active` implies
 *    `approved` + a production adapter for the type
 *    (`reportTemplateInsertGuard.pure.ts`); a seed that skipped that contract
 *    would be the second write path `docs/template-library/01-current-state.md`
 *    warns about (risk R9).
 * 4. **Its report types are the adapters' own strings, verbatim.** The
 *    ranking fallback filters `report_type` with a raw `eq`
 *    (`resolveTemplate.ts`), so a seeded spelling the adapter does not emit is
 *    a template that can be picked but never resolves.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getAdapter } from '@/lib/reportTemplate/adapters';
import { normaliseReportType } from '@/lib/reportTemplate/templateSelection';

const ROOT = join(__dirname, '../../../..');
const SQL = readFileSync(
  join(
    ROOT,
    'supabase/migrations/20260814190000_activate_production_masters_eight_formats.sql',
  ),
  'utf8',
);

// Strip comments so the file's own prose (which names the forbidden verbs
// while explaining them) cannot satisfy or trip a check.
const code = SQL.replace(/--[^\n]*/g, '');

/** The eight formats the seed serves, exactly as the migration lists them. */
const SEEDED_FORMATS = [
  'borrowing_capacity',
  'cashflow',
  'client_details',
  'commercial_capacity',
  'comparison',
  'market_intelligence',
  'portfolio',
  'qa',
] as const;

describe('the seeded formats', () => {
  it('are exactly the eight that had no active template', () => {
    for (const fmt of SEEDED_FORMATS) {
      expect(code, `migration must list ${fmt}`).toMatch(new RegExp(`'${fmt}'`));
    }
    // investment_compass has its own active row (the pilot); the seed must
    // never name it, in the format list or anywhere else.
    expect(code).not.toMatch(/investment_compass/);
    expect(code).not.toMatch(/'investment'/);
  });

  it('are the adapters’ own report-type strings, verbatim', () => {
    for (const fmt of SEEDED_FORMATS) {
      // Canonical spelling: the string is its own normalisation, so the
      // selection path (which normalises) and the ranking path (which does
      // not) agree about the row.
      expect(normaliseReportType(fmt), `${fmt} must be canonical`).toBe(fmt);

      const adapter = getAdapter(fmt);
      expect(adapter, `${fmt} must resolve to an adapter`).toBeTruthy();
      expect(
        adapter?.reportType,
        `the ${fmt} adapter must emit the exact string the seed stores`,
      ).toBe(fmt);
      expect(
        adapter?.supportsProduction,
        `${fmt} must have a production adapter — the activation gate's own clause`,
      ).toBe(true);
    }
  });
});

describe('the state the rows are created in', () => {
  it('is the activation gate’s state: active, approved, not draft, global', () => {
    expect(code).toMatch(/'approved'/);
    expect(code).toMatch(/'global'/);
    // The insert carries explicit true for is_active/is_default and false for
    // is_draft — asserted as comment-stripped source order in the VALUES list.
    expect(code).toMatch(/true,\s*\n\s*true,\s*\n\s*false,\s*\n\s*'approved'/);
  });

  it('draws only from published, production-ready WeasyPrint masters', () => {
    expect(code).toMatch(/status\s*=\s*'published'/);
    expect(code).toMatch(/production_ready\s*=\s*true/);
    expect(code).toMatch(/engine\s*=\s*'weasyprint'/);
    expect(code).toMatch(/'private_banking'/);
    // Variant A — the reference, the one drawn expression of each family.
    expect(code).toMatch(/like\s+'A %'/);
  });

  it('records lineage the way instantiate does', () => {
    expect(code).toMatch(/template_library_instantiations/);
    expect(code).toMatch(/template_audit_log/);
    expect(code).toMatch(/libraryLineage/);
    expect(code).toMatch(/'library_instantiated'/);
  });
});

describe('what the file may never do', () => {
  it('never updates or deletes report_templates rows', () => {
    expect(code).not.toMatch(/update\s+public\.report_templates/i);
    expect(code).not.toMatch(/delete\s+from\s+public\.report_templates/i);
  });

  it('skips a format that already has an active template', () => {
    // The idempotency guard, and the promise that a person's own activation
    // is never displaced by a re-run.
    expect(code).toMatch(
      /exists\s*\(\s*select\s+1\s+from\s+public\.report_templates\s+rt\s+where\s+rt\.report_type\s*=\s*fmt\s+and\s+rt\.is_active\s*=\s*true/i,
    );
    expect(code).toMatch(/continue;/);
  });

  it('asserts every candidate exists before writing anything', () => {
    // The all-or-nothing rule: a missing or ambiguous master raises before
    // any insert, and the single DO block makes the raise roll everything back.
    expect(code).toMatch(/raise exception/);
    expect(code).toMatch(/select\s+\*\s+into\s+strict\s+e/i);
  });

  it('is a single DO block, so it cannot be split or partially applied', () => {
    const statements = code.trim();
    expect(statements.startsWith('do $$')).toBe(true);
    expect(statements.endsWith('$$;')).toBe(true);
    // No second top-level statement after the block.
    expect(statements.indexOf('$$;')).toBe(statements.length - 3);
  });
});
