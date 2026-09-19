/**
 * Which reports the cash-flow comparison picker may offer.
 *
 * Audit item 16 — one address appeared five times in "Add property". The
 * reporter's reading was that the list captures every report kind rather than
 * the Compass one, and the row counts bear that out exactly: 93 Bimbadeen
 * Avenue has one completed report of each variant — `snapshot`, `briefing`,
 * `strategic`, `financial`, `compass`.
 *
 * But filtering by variant fixes neither half of the problem, and the
 * production numbers are what show it. Measured 2026-08-31 over
 * `investment_reports`:
 *
 *   listed by the picker today                  1,169
 *   …that carry financial_calculations            185
 *   …distinct properties among those               98
 *
 *   compass, completed                          1,106
 *   …that carry financial_calculations            143   (963 do NOT)
 *   compass reports for "10 Chester Street"        20
 *
 * Two things follow.
 *
 * **A comparison needs figures, and 984 of the 1,169 entries have none.** That
 * is the larger defect and it is invisible: the row looks identical to a
 * usable one, and choosing it compares against nothing. Variant is a proxy for
 * this and a poor one — filtering to `compass` would still list 20 rows for
 * 10 Chester Street, and would drop the one property whose only report with
 * figures is not a Compass (98 distinct properties become 97).
 *
 * **It is a property picker.** It says "Add property", its search box says
 * "Search properties…", and it was listing reports. One entry per address,
 * the most recent that has figures — 185 rows become 98.
 *
 * The caller fetches newest-first, and `dedupeByProperty` preserves input
 * order, so "most recent" is a property of the query rather than a second
 * sort here.
 */

import {
  resolveCashFlowFinancialSummary,
  type CashFlowFinancialSource,
} from '@/components/cash-flow/financialSummary';

/**
 * A comparison holds five reports: the one open, plus four peers.
 *
 * Named once because three surfaces state it — the toggle's ceiling, the
 * picker's counter and the "maximum reached" message — and three literals is
 * how a picker comes to offer a fifth peer the handler then refuses.
 */
export const COMPARISON_TOTAL_REPORTS = 5;
export const MAX_COMPARISON_PEERS = COMPARISON_TOTAL_REPORTS - 1;

/**
 * How the candidate library is walked.
 *
 * 200 is the endpoint's maximum page size, and the limit bounds the dialog: a
 * library larger than 2,000 completed reports offers its most recent 2,000
 * rather than holding the picker open on an unbounded walk.
 */
export const COMPARISON_CANDIDATE_PAGE_SIZE = 200;
export const COMPARISON_CANDIDATE_PAGE_LIMIT = 10;

export interface ComparisonCandidate extends CashFlowFinancialSource {
  id: string;
  property_address?: string | null;
}

/**
 * Is this a non-empty object of figures?
 *
 * `financial_calculations` arrives as an object, as `{}` from a report whose
 * generation never reached the financial section, and as null. Only the first
 * carries anything.
 */
function carriesSourceFigures(figures: unknown): boolean {
  if (figures === null || figures === undefined) return false;
  if (typeof figures !== 'object') return false;
  if (Array.isArray(figures)) return figures.length > 0;
  return Object.keys(figures as Record<string, unknown>).length > 0;
}

/**
 * Does this report carry figures a comparison can draw?
 *
 * The question is asked of TWO shapes, because the same report reaches this
 * function two ways. The list projection (`cashFlowLibrary`) resolves the
 * headline figures server-side into `cash_flow_purchase_price` /
 * `cash_flow_weekly_rent` and **deletes** `financial_calculations`; the
 * comparison projection keeps the source blob. Testing only the blob is why
 * the picker read "No properties found" on every deployment: the endpoint
 * ignores a caller-supplied `select`, the default projection carries no blob
 * at all, and a filter written against a field the response never contains
 * rejects every row while looking exactly like an empty library.
 *
 * So a report is comparable when the shared resolver finds a price or a rent,
 * or — the conservative floor, for a blob whose figures sit under keys the
 * resolver does not know — when the source blob has anything in it.
 */
export function hasComparableFigures(report: ComparisonCandidate): boolean {
  const { purchasePrice, weeklyRent } = resolveCashFlowFinancialSummary(report);
  if (purchasePrice !== null || weeklyRent !== null) return true;
  return carriesSourceFigures(report.financial_calculations);
}

/** A stable key for "the same property", tolerant of case and stray spacing. */
export function propertyKey(address: string | null | undefined): string {
  return String(address ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** First occurrence per address wins, and input order is preserved. */
export function dedupeByProperty<T extends ComparisonCandidate>(reports: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const report of reports) {
    const key = propertyKey(report.property_address);
    // A report with no address cannot be grouped and cannot be labelled, so it
    // is not offered — the picker would draw a blank row.
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(report);
  }
  return out;
}

/**
 * The list to offer, from the list that was fetched.
 *
 * `excludeId` is the report already open — comparing a report with itself is
 * the one entry that is certainly useless.
 *
 * `excludeAddress` is that report's PROPERTY, and it is a separate exclusion
 * because one property has up to twenty completed reports here. Dropping the
 * open report by id alone leaves its siblings, and this is a property picker:
 * the address the analysis is already about was offered as something to
 * compare it against, one row down from itself. Excluding by address covers
 * both, and the id is still excluded because a report with no address cannot
 * be matched that way.
 */
export function comparisonCandidates<T extends ComparisonCandidate>(
  reports: T[],
  excludeId?: string | null,
  excludeAddress?: string | null,
): T[] {
  const excludedProperty = propertyKey(excludeAddress);
  return dedupeByProperty(
    reports.filter((report) => {
      if (report.id === excludeId) return false;
      if (excludedProperty && propertyKey(report.property_address) === excludedProperty) return false;
      return hasComparableFigures(report);
    }),
  );
}
