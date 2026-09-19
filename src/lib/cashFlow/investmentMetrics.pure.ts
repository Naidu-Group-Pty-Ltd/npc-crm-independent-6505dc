/**
 * The investment metrics a property comparison is ranked on.
 *
 * ## Why this is a module
 *
 * It was a `useCallback` inside `CashFlowAnalysisModal`, fed by two different
 * readings of a report: `baseFinancialData` (via `readBaseFinancials`) for the
 * property the adviser had open, and a hand-rolled `compBaseData` for every
 * property it was compared against. `readBaseFinancials` exists *because* that
 * divergence was found once already — and the comparison call site was never
 * switched over to it.
 *
 * What that cost, measured off a real screen:
 *
 *     93 Bimbadeen Avenue    10-Year ROI   160,902.0%
 *                            Equity Multiple  1,049.02x
 *                            Cash-on-Cash    -2,066.00%
 *
 * `compBaseData` read `mo.purchasePrice || fc.purchasePrice || fc.propertyValue`
 * and missed `initialCosts.propertyValue`, which is where that report keeps its
 * price — and it missed `initialCosts.stampDuty` and LMI the same way. So the
 * purchase price resolved to 0, the deposit fell back to `0 × (1 - LVR)` = 0,
 * stamp duty was 0, and the cost base collapsed to the **$2,000 solicitor-fee
 * default** that the old code substituted when none was recorded. Every return
 * was then a real dollar figure divided by two thousand dollars:
 * 3,218,039 / 2,000 = 160,902%. The property's own *projection* was correct
 * throughout; only the denominator was fiction.
 *
 * ## Three rules
 *
 * **A return needs a cost base, and a missing one is not a small one.** There
 * is no default here. When the capital committed cannot be established the
 * metrics are refused, and the table says so — because a plausible-looking
 * percentage is far worse than a blank, and this is a document an adviser puts
 * in front of a client.
 *
 * **The gain is measured over the ten years being projected.** It was
 * `projs[10].value - purchasePrice`, which for a property bought years ago
 * folds decades of past appreciation into a ten-year forecast. It is now
 * `projs[10].value - projs[0].value` — the first row of the table the reader is
 * looking at, to the last. For a property being bought today the two are
 * identical, which is why the primary property's figures do not move.
 *
 * **The denominator is the capital committed at the START of those ten years.**
 * For a purchase that is the cash outlay — deposit, duty, legal, LMI — because
 * the duty and fees are sunk into it. For a property already held it is the
 * equity in it today, which is what the next ten years are actually earned on.
 * The greater of the two is the one the investor has in it at year 0. Dividing
 * a ten-year gain on a $2.7m asset by a deposit paid two decades ago is how
 * 71 Saltwater Creek Road came to read 3,997%.
 */

/** One row of the ten-year projection, as this module needs it. */
export interface MetricsProjection {
  propertyMarketValue: number;
  equityInProperty: number;
  afterTaxCashFlowPA: number;
}

/** A property's acquisition position, as `readBaseFinancials` reports it. */
export interface MetricsBase {
  purchasePrice: number;
  depositValue: number;
  stampDuty: number;
  solicitorFees: number;
  /** Building and pest inspections — part of the same settlement-cost object as duty and legal fees. */
  inspectionFees?: number;
  lmiAmount: number;
  loanToValueRatio: number;
}

export interface InvestmentMetrics {
  /** Capital committed at the start of the projection — the denominator. */
  capitalCommitted: number;
  /** Which reading `capitalCommitted` came from, for disclosure. */
  capitalBasis: 'acquisition_cash' | 'opening_equity';
  /** Cash outlay to acquire: deposit + duty + legal + LMI. */
  acquisitionCash: number;
  /** Equity in the property at year 0. */
  openingEquity: number;
  /** Cumulative after-tax cash flow, years 1–10. */
  totalCashFlow: number;
  /** Growth in market value across the projected horizon. */
  capitalGain: number;
  totalReturn: number;
  /** Total return as a percentage of capital committed. */
  roi: number;
  /** The same, compounded to a yearly rate. Null when ROI is a total loss. */
  annualisedRoi: number | null;
  /** First year cumulative cash flow turns positive; null if never. */
  breakEvenYear: number | null;
  cashOnCash: number;
  equityMultiple: number;
  horizonStartValue: number;
  horizonEndValue: number;
}

export type MetricsUnavailable =
  | 'projection_incomplete'
  | 'capital_unknown';

export type MetricsRead =
  | { ok: true; metrics: InvestmentMetrics }
  | { ok: false; reason: MetricsUnavailable };

/** What the reader is told when a column cannot be filled in. */
export const METRICS_UNAVAILABLE_REASON: Record<MetricsUnavailable, string> = {
  projection_incomplete: 'This report does not carry a complete ten-year projection.',
  capital_unknown:
    'This report records no deposit, stamp duty or purchase price, so there is no cost base to measure a return against.',
};

const HORIZON_YEARS = 10;

function finite(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * The investor's own capital in the purchase.
 *
 * Falls back to price × (100 − LVR) / 100 only when no deposit was recorded —
 * with no purchase price that fallback is 0, which is the case the metrics must
 * NOT paper over. Multiplied before dividing so an 80% LVR on $800,000 is
 * $160,000 rather than $159,999.99999999997.
 */
export function depositFor(base: MetricsBase): number {
  const recorded = finite(base.depositValue);
  if (recorded > 0) return recorded;
  const lvr = finite(base.loanToValueRatio);
  return (finite(base.purchasePrice) * (100 - (lvr > 0 ? lvr : 80))) / 100;
}

/**
 * The cash an investor put in to acquire the property: deposit + costs.
 *
 * Inspection fees are in it because they are in the sibling report's
 * settlement-cost object (`initialCosts.inspectionFees`): the standalone cash
 * flow of 291 Stone Mason Drive stated $259,800 upfront where the Financial
 * Analysis stated $314,832, and the $55,032 gap was duty, legal and inspection
 * costs this reading never reached (QA-03).
 */
export function acquisitionCashFor(base: MetricsBase): number {
  return depositFor(base)
    + finite(base.stampDuty)
    + finite(base.solicitorFees)
    + finite(base.inspectionFees)
    + finite(base.lmiAmount);
}

/**
 * Compound a total return over the horizon into a yearly rate.
 *
 * Null rather than NaN when the multiple is not positive: `Math.pow` of a
 * negative base to a fractional exponent is NaN, and a table cell reading
 * "NaN%" is how a spreadsheet error reaches a client.
 */
export function annualiseReturn(roiPercent: number, years = HORIZON_YEARS): number | null {
  const multiple = 1 + roiPercent / 100;
  if (!(multiple > 0)) return null;
  return (Math.pow(multiple, 1 / years) - 1) * 100;
}

/** Derive every headline metric, or say why it cannot be derived. */
export function deriveInvestmentMetrics(
  projections: MetricsProjection[],
  base: MetricsBase | null | undefined,
): MetricsRead {
  if (!base || !projections || projections.length < HORIZON_YEARS + 1) {
    return { ok: false, reason: 'projection_incomplete' };
  }

  const opening = projections[0];
  const closing = projections[HORIZON_YEARS];

  const deposit = depositFor(base);
  const acquisitionCash = acquisitionCashFor(base);
  const openingEquity = Math.max(0, finite(opening.equityInProperty));
  // The greater of the two: what the investor has in it at year 0.
  const capitalCommitted = Math.max(acquisitionCash, openingEquity);
  const capitalBasis = openingEquity > acquisitionCash ? 'opening_equity' : 'acquisition_cash';

  // A cost base needs actual CAPITAL. Duty, legal fees and LMI are costs of
  // acquiring, not the stake acquired — and a report with nothing but a $2,000
  // solicitor fee recorded is precisely the case that produced 160,902%. Their
  // sum is a positive number, which is why "> 0" alone was not a guard.
  if (deposit <= 0 && openingEquity <= 0) return { ok: false, reason: 'capital_unknown' };
  if (!(capitalCommitted > 0)) return { ok: false, reason: 'capital_unknown' };

  const totalCashFlow = projections
    .slice(1, HORIZON_YEARS + 1)
    .reduce((sum, row) => sum + finite(row.afterTaxCashFlowPA), 0);

  const horizonStartValue = finite(opening.propertyMarketValue);
  const horizonEndValue = finite(closing.propertyMarketValue);
  const capitalGain = horizonEndValue - horizonStartValue;
  const totalReturn = capitalGain + totalCashFlow;

  const roi = (totalReturn / capitalCommitted) * 100;

  let cumulative = 0;
  let breakEvenYear: number | null = null;
  for (let year = 1; year <= HORIZON_YEARS; year += 1) {
    cumulative += finite(projections[year].afterTaxCashFlowPA);
    if (cumulative >= 0) { breakEvenYear = year; break; }
  }

  return {
    ok: true,
    metrics: {
      capitalCommitted,
      capitalBasis,
      acquisitionCash,
      openingEquity,
      totalCashFlow,
      capitalGain,
      totalReturn,
      roi,
      annualisedRoi: annualiseReturn(roi),
      breakEvenYear,
      cashOnCash: (finite(projections[1].afterTaxCashFlowPA) / capitalCommitted) * 100,
      equityMultiple: (finite(closing.equityInProperty) + totalCashFlow) / capitalCommitted,
      horizonStartValue,
      horizonEndValue,
    },
  };
}

/**
 * A percentage, or the reason there isn't one.
 *
 * Kept beside the derivation so a surface cannot invent its own rendering of
 * an absent value — an em dash and a fabricated `0.0%` look nothing alike to a
 * reader and identical to a component that only checks for null.
 */
export function formatMetricPercent(value: number | null | undefined, digits = 1): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

export function formatMetricMultiple(value: number | null | undefined, digits = 2): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${value.toFixed(digits)}x`;
}

/** "Year 4", or the fact that it does not happen inside the projection. */
export function formatBreakEven(year: number | null | undefined): string {
  return typeof year === 'number' ? `Year ${year}` : 'Beyond year 10';
}
