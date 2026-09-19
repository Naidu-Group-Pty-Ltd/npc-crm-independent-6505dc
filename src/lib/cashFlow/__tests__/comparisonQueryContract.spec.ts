/**
 * What the comparison asks the server for, and what the server may answer.
 *
 * Two failures live here that no unit test on a pure module can see, because
 * both are about a projection.
 *
 * **The picker asked for a column the response never carries.**
 * `get-investment-reports` declares `listOptions.select` "deprecated and
 * deliberately ignored — callers cannot define database projections", so
 * asking for `financial_calculations` got the default `library` projection,
 * which does not select it. Every candidate was rejected for having no
 * figures and the popover read "No properties found." on 1,169 completed
 * reports.
 *
 * **A comparison drawn from a collapsed row is silently wrong.**
 * `allComparisonProjections` replays ten years out of `financial_calculations`
 * and `manual_overrides` — council rates, the interest rate, capital growth,
 * the depreciation schedule, every per-year override. Handed a row whose blobs
 * were collapsed into two scalars it does not fail: it defaults to 0 / 5% /
 * 5.5% and renders a plausible projection of nothing. So `cashFlowComparison`
 * must return the source blobs, and must not be collapsed on the way out.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const MODAL = readFileSync(
  path.join(REPO_ROOT, 'src/components/reports/CashFlowAnalysisModal.tsx'),
  'utf8',
);
const ENDPOINT = readFileSync(
  path.join(REPO_ROOT, 'supabase/functions/get-investment-reports/index.ts'),
  'utf8',
);

/** Strip comments, keeping newlines, so prose about the bug is not the bug. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (_match, prefix) => prefix);
}

const modalCode = code(MODAL);
const endpointCode = code(ENDPOINT);

describe('the candidate list asks for the cash-flow projection', () => {
  it('names cashFlowLibrary', () => {
    expect(modalCode).toContain("projection: 'cashFlowLibrary'");
  });

  it('never passes a select the endpoint ignores', () => {
    // The one that mattered was `select: 'id, property_address,
    // financial_calculations, manual_overrides'`, which read as a request and
    // was discarded server-side.
    expect(modalCode).not.toMatch(/listOptions:\s*\{[^}]*\bselect:/s);
  });

  it('walks the pages rather than taking the default fifty', () => {
    expect(modalCode).toContain('COMPARISON_CANDIDATE_PAGE_SIZE');
    expect(modalCode).toContain('COMPARISON_CANDIDATE_PAGE_LIMIT');
    expect(modalCode).toMatch(/pagination\?\.totalPages/);
  });
});

describe('a selection is hydrated, never projected from a list row', () => {
  it('fetches the source figures for the reports that were picked', () => {
    expect(modalCode).toContain("request('cashFlowComparison')");
    expect(modalCode).toMatch(/reportIds:\s*selectedComparisonReportIds/);
  });

  it('keeps a fallback so a partial rollout does not empty the comparison', () => {
    expect(modalCode).toContain("INVALID_REPORT_QUERY");
    expect(modalCode).toContain("request('detail')");
  });

  it('does not build the comparison by filtering the candidate list', () => {
    // `availableReports.filter(r => selectedComparisonReportIds.includes(r.id))`
    // is what used to feed the projection, and under the list projection those
    // rows carry no figures at all.
    expect(modalCode).not.toMatch(/availableReports\s*\.?\s*filter\([^)]*selectedComparisonReportIds/);
  });
});

describe('the endpoint publishes an uncollapsed comparison projection', () => {
  it('accepts cashFlowComparison', () => {
    expect(endpointCode).toMatch(/const allowed: Projection\[\] = \[[^\]]*'cashFlowComparison'/);
  });

  it('selects the source blobs for it', () => {
    expect(endpointCode).toMatch(
      /projection === 'cashFlowLibrary' \|\| projection === 'cashFlowComparison' \? INVESTMENT_LIBRARY_SOURCE_SELECT/,
    );
    expect(endpointCode).toMatch(
      /INVESTMENT_LIBRARY_SOURCE_SELECT = `\$\{INVESTMENT_LIBRARY_SELECT\},manual_overrides,financial_calculations`/,
    );
  });

  it('does NOT collapse it into the two headline scalars', () => {
    // This is the assertion that matters. `toLibraryFinancialSummary` deletes
    // `financial_calculations` and `manual_overrides`; adding
    // `cashFlowComparison` to the line below would leave every comparison
    // drawing a projection out of defaults, with nothing failing.
    const collapse = endpointCode.match(/if \(table === 'investment_reports' && projection === [^)]*\) \{\s*\n\s*responseData = responseData\.map\(row => toLibraryFinancialSummary/);
    expect(collapse, 'the collapse step could not be located — re-read this test').not.toBeNull();
    expect(collapse?.[0]).not.toContain('cashFlowComparison');
  });
});
