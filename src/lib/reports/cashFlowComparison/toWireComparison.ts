/**
 * The modal's comparison state, as the render route wants it.
 *
 * A reshape and nothing else — **no arithmetic, and no metrics**. That second
 * part is the point of the file.
 *
 * `CashFlowAnalysisModal` computes nine metrics per property
 * (`calculateAdvancedMetrics`) and it would be easy to put them on the wire. They
 * are deliberately not here. The server derives every one of them from the years
 * it is sent, so that the KPI strip, the ranking and the tables cannot disagree —
 * the rule `cashFlow/normalise.pure.ts` already applies to equity and LVR, and it
 * matters more here because a comparison is a document whose whole content is
 * one property's number next to another's.
 *
 * It also fixes something. The modal's own peer metrics are not comparable with
 * the primary's: `compBaseData` carries no `lmiAmount` key, and that figure is
 * inside the denominator of return on capital, cash-on-cash and the equity
 * multiple. Every property here goes through `readBaseFinancials`, so every
 * column of the document is read by one implementation.
 *
 * Keeping this out of the 6,000-line component is the same reasoning as
 * `toWireProjection`: the mapping from modal state to the wire is the one place a
 * field can be silently dropped, and it should be small enough to read in one
 * screen and to test.
 */
import { readBaseFinancials, type ReadableReport } from '@/lib/reports/cashFlow/readBaseFinancials';
import {
  toWireProjection,
  type ModalProjectionYear,
} from '@/lib/reports/cashFlow/toWireProjection';
import type { WireProjection } from '@/lib/reports/cashFlow/requestCashFlowPdf';

/** One property as the modal holds it: the report, and the years it computed. */
export interface ComparableProperty {
  report: ReadableReport & { id: string; property_address?: string };
  /** All eleven rows, year 0 first. `toWireProjection` drops year 0. */
  projections: readonly ModalProjectionYear[];
}

export interface ToWireComparisonInput {
  /** The report the adviser had open. */
  primary: ComparableProperty;
  /** The peers, in the order they were added. */
  peers: readonly ComparableProperty[];
  /** `growth` | `income` | `balanced`, as the modal's selector holds it. */
  investorProfile: string;
  /** The analysis in state, or null when the adviser never generated one. */
  // deno-lint-ignore no-explicit-any
  analysis?: any;
  /** The calendar year that year 1 falls in. */
  firstCalendarYear: number;
  /** The year the base financials are read against. */
  currentYear: number;
}

export interface WireComparisonProperty {
  reportId: string;
  projection: WireProjection;
}

export interface WireComparison {
  primaryReportId: string;
  properties: WireComparisonProperty[];
  investorProfile: string;
  // deno-lint-ignore no-explicit-any
  analysis: any;
}

function toProperty(
  entry: ComparableProperty,
  firstCalendarYear: number,
  currentYear: number,
): WireComparisonProperty {
  const base = readBaseFinancials(entry.report, currentYear);
  return {
    reportId: entry.report.id,
    projection: toWireProjection({
      projections: entry.projections,
      base,
      firstCalendarYear,
      // Stated per property rather than for the comparison, because the toggle
      // is per report: two properties in one document can legitimately differ,
      // and a note attached to the wrong one is worse than none.
      notes: base.includeDepreciationInCashFlow
        ? []
        : ['Depreciation is excluded from this projection at the adviser\'s direction.'],
    }),
  };
}

/**
 * The primary first, then the peers in the order they were added.
 *
 * Display order, not rank order — the server ranks. Keeping it the adviser's own
 * selection order means the numbering on the page matches the order they built
 * the comparison in, and it is stable across re-renders.
 */
export function toWireComparison(input: ToWireComparisonInput): WireComparison {
  return {
    primaryReportId: input.primary.report.id,
    properties: [input.primary, ...input.peers].map(
      (entry) => toProperty(entry, input.firstCalendarYear, input.currentYear),
    ),
    investorProfile: input.investorProfile,
    // Passed straight through, unvalidated. `normalise.pure.ts` on the server is
    // what decides what any of it means; a second opinion in the browser would
    // be a second place for the two to disagree.
    analysis: input.analysis ?? null,
  };
}
