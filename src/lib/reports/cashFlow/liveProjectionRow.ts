/**
 * The reviewed projection, in the shape the template projection reads.
 *
 * ## Why this exists
 *
 * The 10 Year Cash Flow's contract (`docs/reports/CASH_FLOW.md`) puts the
 * arithmetic in the browser: the adviser overrides any of ten fields in any of
 * ten years, live, and the document must state the series they just reviewed.
 * The template adapter, like every adapter, reads the *stored* record — so a
 * chosen template applied only when the screen happened to equal the store,
 * which for this format is the exception. Every other download quietly fell
 * back to the standard layout, and the choice the picker promised was kept
 * changed nothing.
 *
 * This module is the bridge: it converts the same `WireProjection` the server
 * composer receives into a row shaped like `investment_reports`, so
 * `projectCashFlow` — the format's one projection producer — can publish the
 * reviewed series under the exact vocabulary every master binds. One producer,
 * two sources, zero duplicated derivations.
 *
 * ## The three rules
 *
 * - **Validated like a stored row, refused like one.** A year missing any of
 *   the five fields the series is drawn from returns null, and the caller
 *   falls back to the composer — which runs the same class of validation
 *   server-side. An unresolved binding renders as the empty string, so a
 *   half-shaped series would print blank cells in a client's table rather
 *   than failing.
 * - **The headline figure is the composer's headline figure.** `cashFlow` maps
 *   from `afterTaxAnnual`, because the composer's opening sentence — the first
 *   thing a client reads — is the after-tax weekly position. A templated
 *   document and a composed document of the same projection must lead with the
 *   same number.
 * - **No scenario is claimed that the series does not satisfy.** The stored
 *   scenarios are exact 2/4/6% growth ladders; a reviewed series is whatever
 *   the adviser made it. It is published as `reviewed` / "Adviser-reviewed",
 *   and the stored-scenario side-by-side blocks are withheld — a comparison
 *   of one column labelled "Moderate" would be a claim, not a comparison.
 */
import {
  applyCashFlowProjection,
  type ScenarioName,
} from '../../../../supabase/functions/_shared/cashFlowProjection.pure';
import type { WireProjection } from './requestCashFlowPdf';

/** The scenario key the reviewed series is stored under, inside the pseudo-row. */
const CARRIER_SCENARIO: ScenarioName = 'moderate';

const finiteOrNull = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * The wire's years in the stored-series vocabulary, or null when any year is
 * not whole enough to draw.
 */
export function wireYearsAsStoredSeries(
  wire: WireProjection,
): Array<Record<string, number>> | null {
  const years = Array.isArray(wire?.years) ? wire.years : [];
  if (!years.length) return null;

  let cumulative = 0;
  const out: Array<Record<string, number>> = [];
  for (const raw of years) {
    const year = finiteOrNull(raw?.year);
    const propertyValue = finiteOrNull(raw?.propertyValue);
    const loanBalance = finiteOrNull(raw?.loanBalance);
    const annualRent = finiteOrNull(raw?.rentalIncome);
    const cashFlow = finiteOrNull(raw?.afterTaxAnnual);
    if (year === null || propertyValue === null || loanBalance === null
      || annualRent === null || cashFlow === null) {
      return null;
    }
    cumulative += cashFlow;
    out.push({
      year,
      propertyValue,
      loanBalance,
      // Derived the way the stored series derives it, so the equity column and
      // the value/balance columns cannot disagree.
      equity: propertyValue - loanBalance,
      annualRent,
      cashFlow,
      cumulativeCashFlow: cumulative,
    });
  }
  return out;
}

/**
 * The acquisition, in the vocabulary `projectCashFlow` reads it from.
 *
 * ## What is carried, and what deliberately is not
 *
 * Only quantities the wire holds that are **the same quantity** the stored blob
 * holds — the deposit is the deposit, the loan amount is the loan amount, and
 * `costs[]` carries the same three figures under labels this file's sibling
 * (`toWireProjection.ts`) chose. LVR is a definition rather than a
 * recalculation, and it agrees with the store on production rows (420,000 of
 * 525,000 = 80).
 *
 * `monthlyPayment`, `weeklyPayment`, `totalInterest` and `rateSource` are NOT
 * derived, and that is the point of this comment. The wire carries year one's
 * `interest` and `principal`, and dividing their sum by twelve looks like the
 * monthly repayment — but on a production interest-only row the store says
 * $2,518.11 and that arithmetic says $2,100, because the store records the
 * P&I payment whatever the loan type. Publishing the second number under the
 * same label as the first would put a figure in a client's financial document
 * that disagrees with every other surface in the product. They are read from
 * the stored record or withheld. Same for every `annualCosts` component: the
 * wire has one aggregate `expenses` per year and no breakdown at all.
 */
function acquisitionAsFinancials(wire: WireProjection): Record<string, unknown> {
  const a = (wire?.acquisition ?? {}) as Record<string, unknown>;
  const costOf = (label: string): number | null => {
    const rows = Array.isArray(a.costs) ? a.costs as Array<Record<string, unknown>> : [];
    const hit = rows.find((c) => String(c?.label ?? '').trim().toLowerCase() === label);
    return hit ? finiteOrNull(hit.amount) : null;
  };
  const purchasePrice = finiteOrNull(a.purchasePrice);
  const loanAmount = finiteOrNull(a.loanAmount);

  const initialCosts: Record<string, unknown> = {};
  const put = (into: Record<string, unknown>, key: string, value: unknown) => {
    if (value !== null && value !== undefined) into[key] = value;
  };
  put(initialCosts, 'deposit', finiteOrNull(a.deposit));
  put(initialCosts, 'loanAmount', loanAmount);
  put(initialCosts, 'stampDuty', costOf('stamp duty'));
  put(initialCosts, 'legalFees', costOf('legal fees'));
  put(initialCosts, 'lmi', costOf('lenders mortgage insurance'));

  const loanDetails: Record<string, unknown> = {};
  put(loanDetails, 'loanAmount', loanAmount);
  put(loanDetails, 'interestRate', finiteOrNull(a.interestRate));
  const loanType = String(a.loanType ?? '').trim();
  if (loanType) loanDetails.loanType = loanType;
  if (loanAmount !== null && purchasePrice !== null && purchasePrice > 0) {
    loanDetails.lvr = (loanAmount / purchasePrice) * 100;
  }

  const out: Record<string, unknown> = {};
  if (Object.keys(initialCosts).length) out.initialCosts = initialCosts;
  if (Object.keys(loanDetails).length) out.loanDetails = loanDetails;
  return out;
}

export interface LiveProjectionSource {
  /** The row the document is about — for its id, address and timestamps. */
  reportId: string;
  propertyAddress?: string | null;
  /**
   * The record's timestamps, which is what dates the document.
   *
   * `projectCashFlow` publishes `report.generatedDate` from `updated_at ??
   * created_at`, and the pseudo-row below carried neither — so every document
   * produced on this path printed the cover word "Prepared" with nothing after
   * it, and said the same again on the assumptions page. The record has both
   * (the report behind the 15 Aug 2026 export was created 6 Aug and updated
   * 11 Aug); only this row was dropping them.
   *
   * Optional for the same reason `storedFinancials` is: a refused read must
   * degrade the document, never fail it.
   */
  updatedAt?: string | null;
  createdAt?: string | null;
  /**
   * The stored `financial_calculations`, when the record could be read.
   *
   * The series on screen is the adviser's; the *inputs* underneath it are not.
   * `annualCosts` (council rates, water, insurance, maintenance, management,
   * strata) exist nowhere in the payload — the wire carries one aggregate
   * `expenses` per year — and an override of a projection year does not change
   * what the council charges. So they are taken from the record when it is
   * readable and withheld when it is not.
   *
   * Optional by rule. The render must never *depend* on this read: a refused
   * one is what made the whole templated path fall back to the standard
   * composer before the payload channel existed.
   */
  storedFinancials?: Record<string, unknown> | null;
  /**
   * The stored scenario this series was proved to equal, when it was.
   *
   * Present only when `matchStoredScenario` named one, so the document may
   * honestly print "Moderate". Absent means the adviser shaped the series by
   * hand and it is labelled "Adviser-reviewed" — never a scenario name the
   * numbers do not satisfy.
   */
  scenario?: string | null;
}

/**
 * A row `projectCashFlow` can read, carrying the reviewed series.
 *
 * Null when the wire cannot be drawn — the refusal, not an empty document.
 */
export function wireAsProjectionRow(
  wire: WireProjection,
  source: LiveProjectionSource,
): Record<string, unknown> | null {
  const series = wireYearsAsStoredSeries(wire);
  if (!series) return null;
  const stored = (source.storedFinancials ?? {}) as Record<string, unknown>;
  const derived = acquisitionAsFinancials(wire);
  const merge = (key: string) => {
    // The record wins where it has the field, because it is the fuller of the
    // two — it carries the payments and the fee lines the wire never had. The
    // wire fills in when the read was refused, so a document produced without
    // a readable record still states the deposit, the loan and the rate rather
    // than printing a labelled table of empty cells.
    const a = stored[key] && typeof stored[key] === 'object' ? stored[key] as Record<string, unknown> : null;
    const b = derived[key] && typeof derived[key] === 'object' ? derived[key] as Record<string, unknown> : null;
    if (!a && !b) return undefined;
    return { ...(b ?? {}), ...(a ?? {}) };
  };
  const financials: Record<string, unknown> = {
    projections: { [CARRIER_SCENARIO]: series },
  };
  for (const key of ['initialCosts', 'loanDetails', 'annualCosts']) {
    const merged = merge(key);
    if (merged && Object.keys(merged).length) financials[key] = merged;
  }
  return {
    id: source.reportId,
    property_address: source.propertyAddress ?? null,
    // Named exactly as the columns are, because `projectCashFlow` reads
    // `row.updated_at ?? row.created_at` off a stored row and this pseudo-row
    // is fed to that same function. Omitted keys leave `report.generatedDate`
    // unpublished, which prints as the empty string — a cover reading
    // "Prepared" and then nothing.
    created_at: source.createdAt ?? null,
    updated_at: source.updatedAt ?? null,
    financial_calculations: financials,
  };
}

/**
 * Publish the reviewed series into a binding context.
 *
 * `projectCashFlow` runs over the pseudo-row exactly as it runs over a stored
 * one — same derivations, same vocabulary — and then the scenario claim is
 * corrected: the carrier key was only ever a vehicle, and a document must not
 * say "Moderate" about a series the adviser shaped by hand. `basis` (growth
 * rates read off the series itself) survives because it is an observation;
 * `scenarios` and `scenarioBasis` (the stored three-way comparison) are
 * withheld because there is nothing to compare.
 */
export function applyLiveCashFlowProjection(
  data: Record<string, any>,
  row: Record<string, unknown>,
  scenario?: string | null,
): Record<string, any> {
  applyCashFlowProjection(data, row, CARRIER_SCENARIO);
  const cashflow = data.cashflow;
  if (cashflow && typeof cashflow === 'object') {
    // A proved scenario keeps its own name; anything else is the adviser's.
    const proved = typeof scenario === 'string' && scenario.trim() ? scenario.trim() : null;
    cashflow.scenario = proved ?? 'reviewed';
    cashflow.scenarioLabel = proved
      ? proved.charAt(0).toUpperCase() + proved.slice(1)
      : 'Adviser-reviewed';
    // The stored three-way comparison is withheld either way: only the series
    // on screen was reviewed, and the other two are not in this payload.
    delete cashflow.scenarios;
    delete cashflow.scenarioBasis;
  }
  return data;
}
