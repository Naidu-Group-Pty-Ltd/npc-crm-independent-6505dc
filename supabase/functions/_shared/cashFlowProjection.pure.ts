/**
 * Project a stored `investment_reports.financial_calculations` into the binding
 * vocabulary a 10 Year Cash Flow template uses.
 *
 * ## This format has no table of its own, and that is the first thing to know
 *
 * The other four formats on the family system each read a stored artefact:
 * `investment_reports`, `borrowing_capacity_assessments`,
 * `portfolio_analysis_reports`, `property_comparisons`. This one has
 * **`cash_flow_analyses`, which holds 0 rows**, and `cash_flow_renders`, which
 * is a render ledger carrying no payload.
 *
 * `docs/reports/CASH_FLOW.md` explains why, and it is by design rather than by
 * neglect: `CashFlowAnalysisModal` lets an adviser override any of ten fields in
 * any of ten years, live, and those overrides are never persisted. The
 * arithmetic is the browser's and it is thrown away.
 *
 * So a template rendered from a report **id** — which is all an adapter is
 * given — cannot show the projection an adviser reviewed, because that
 * projection was never written down. What it can show is the one the report
 * itself stores, and 162 of the 1,182 investment reports carry exactly that:
 * `financial_calculations.projections`, three scenarios of ten years each, all
 * 4,860 elements complete, every one carrying the same eight numeric fields.
 *
 * The 1,020 reports without it are not an error and are not rendered blank —
 * `cashFlowAdapter` returns null and the legacy generator keeps them.
 *
 * ## Four figures in this record contradict the series, and none is published
 *
 * This is the whole design of the module, so it is stated once here in full.
 * Everything below was measured across all 162 stored reports.
 *
 * **1. `keyMetrics.annualNet` / `weeklyNet`.** Both are year-one annual cash
 * flow, exactly what `projections.moderate[0].cashFlow` is. They differ by a
 * **median of $24,793**, the projection being the more negative on 148 of the
 * 162, and they agree exactly on **none**. Neither equals
 * `annualRent - annualCosts.totalAnnual - monthlyPayment * 12`. They are two
 * independent computations and nothing reconciles them. A page with one in a
 * KPI and the other in the year-one row of the table beneath it contradicts
 * itself by $25,000, and a reader has no way to tell which to believe.
 *
 * **2. `initialCosts.propertyValue`.** Sound on 160 reports. On one it is
 * **$3**, while that same report's deposit is $150,000, its loan $600,000 and
 * its own year-one projected value $780,000. The series carries the value on
 * every report and is the subject of this document, so the value is read from
 * the series and never from the input.
 *
 * **3. `initialCosts.totalUpfront`.** Equals the sum of the initial costs
 * beside it on **29 of 161**. The residual runs from −$80,740 to +$93,000,
 * because the total is computed from the real deposit (price less loan) while
 * the `deposit` field is a percentage of price, and the two disagree whenever
 * the LVR is not the deposit's complement.
 *
 * **4. `annualCosts.totalAnnual`.** Equals the sum of its own components on
 * **18 of 162** (21 within $100). Residual −$25,020 to +$14,003, and it is
 * exactly 0 on 13 reports whose components are not.
 *
 * A total printed under the figures it is supposed to total, wrong by up to
 * $93,000, is worse than no total: it tells the reader the document cannot add
 * up, and there is no way for them to know which line is at fault. So the
 * components are published and the totals are not. `cashFlowCatalogue.spec.ts`
 * asserts no master binds them, because the natural instinct when laying out a
 * cost table is to add a total row.
 *
 * Two more are omitted for a related reason.
 *
 * **`loanDetails.interestOnlyPeriod`** is 2 years on the 93 reports that carry
 * it, but the projected loan balance falls in year one on **all 161** — 0.988
 * of the original on every report, in every scenario. The series does not model
 * the interest-only period. Stating it beside a balance column that amortises
 * from year one would put a contradiction on the page.
 *
 * **The whole `assumptions` object** — `capitalGrowth`, `cpiGrowth`,
 * `occupancyWeeks` — describes something other than the series stored beside
 * it. Measured across all 162:
 *
 *  - The three scenarios are built at **exactly 2%, 4% and 6% capital growth
 *    and 2%, 3% and 4% rental growth**, identically on every report. Not
 *    approximately: `(value₁₀/value₁)^(1/9)` is 2.000, 4.000 and 6.000 on all
 *    162, to three decimal places.
 *  - `assumptions.capitalGrowth` is recorded on 69 of them, runs 0 to 26.6 with
 *    a median of 5.0, and equals the 4% the moderate series was built at on
 *    **3**.
 *  - `assumptions.cpiGrowth` is recorded on 16 and equals the rental growth the
 *    series used on 2 of the 48 scenario-series those reports carry.
 *  - `income.weeklyRent × assumptions.occupancyWeeks` equals year-one rent on
 *    **none** of them.
 *
 * A page headed "what this rests on" that states 5.2% growth beside a table
 * built at 4% is worse than one that states nothing: it is a specific, checkable
 * claim about the document's own arithmetic, and it is false. So the recorded
 * assumptions are not published, and `basis` below is derived from the series
 * instead — which makes it a restatement of the numbers on the page rather than
 * a second opinion about them.
 *
 * ## Units, measured across all 4,860 elements
 *
 *  - `year` 1-10, on all three scenarios of all 162 reports.
 *  - `propertyValue` $438,600-$2,149,017, `loanBalance` $293,642-$949,586,
 *    `equity` $37,342-$1,329,551, `annualRent` $0-$103,104 — dollars.
 *  - `cashFlow` −$96,910 to +$2,562, and **negative on 4,856 of the 4,860**:
 *    all four exceptions are in the optimistic scenario. `cumulativeCashFlow`
 *    −$932,328 to −$12,269, negative on every element without exception. That is
 *    what the data says; the pages label it as a shortfall rather than dressing
 *    it up.
 *  - `roi` −122.24 to 88.34 — whole-number percent, like every other rate in
 *    this codebase. The `percent` filter does not multiply.
 *  - The scenarios are strictly ordered — conservative < moderate < optimistic
 *    at year ten on all 162 — so naming them is meaningful rather than
 *    decorative.
 *
 * `projections.annualRent` equals neither `income.weeklyRent * 52` nor
 * `weeklyRent * assumptions.occupancyWeeks` on any report, so the weekly rent is
 * not published beside the series either. It would read as the figure the series
 * was built from, and it is not.
 *
 * ## There is no client on this record
 *
 * `investment_reports` has **no `client_name` column at all**, and
 * `client_property_id` is set on **2 of the 162**. So this format is addressed
 * to a property rather than to a person: no `client` namespace is published,
 * and the masters lead on `cashflow.property.address` — present, and at most 67
 * characters, on all 162.
 */

import { reconcileStoredFinancials } from './reports/investment/financialEngine.pure.ts';

export interface CashFlowRowLike {
  id?: string;
  financial_calculations?: unknown;
  property_address?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  [k: string]: unknown;
}

/** The scenario a document leads on when it does not say otherwise. */
export const DEFAULT_SCENARIO = 'moderate';

export const SCENARIOS = ['conservative', 'moderate', 'optimistic'] as const;
export type ScenarioName = (typeof SCENARIOS)[number];

/** Every stored series is exactly this long, in every scenario, on all 162. */
export const PROJECTION_YEARS = 10;

/**
 * `interest_only` is the only stored value, on 114 of the 162.
 *
 * Mapped rather than printed: a snake-case enum on a client's document reads as
 * a database field that escaped, and this is the same reasoning as
 * `bandLabel` in `borrowingCapacityProjection.pure.ts`.
 */
const LOAN_TYPE_LABELS: Record<string, string> = {
  interest_only: 'Interest only',
  principal_and_interest: 'Principal and interest',
  principal_interest: 'Principal and interest',
};

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s || undefined;
}

function put(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined && value !== null && value !== '') target[key] = value;
}

/** One year of a scenario. Every field is a number in the stored data. */
function projectYear(raw: unknown): Record<string, unknown> {
  const y = obj(raw);
  const out: Record<string, unknown> = {};
  put(out, 'year', num(y.year));
  put(out, 'propertyValue', num(y.propertyValue));
  put(out, 'loanBalance', num(y.loanBalance));
  put(out, 'equity', num(y.equity));
  put(out, 'annualRent', num(y.annualRent));
  put(out, 'cashFlow', num(y.cashFlow));
  put(out, 'cumulativeCashFlow', num(y.cumulativeCashFlow));
  put(out, 'roi', num(y.roi));
  return out;
}

function projectSeries(raw: unknown): Record<string, unknown>[] {
  return arr(raw).map(projectYear).filter((y) => Object.keys(y).length > 0);
}

/**
 * The compound rate a series was actually built at, read off its own ends.
 *
 * Nine intervals across ten years. Rounded to two places because the underlying
 * figures are rounded dollars, which puts a few parts in ten thousand of noise
 * on the root — the stored series come back as 2.00, 4.00 and 6.00 exactly.
 *
 * Returns undefined rather than a number when the series cannot support one:
 * five of the 162 reports carry a year-one rent of $0, and a growth rate off a
 * zero base is a division, not a fact.
 */
function compoundRate(series: Record<string, unknown>[], key: string): number | undefined {
  if (series.length < 2) return undefined;
  const first = num(series[0][key]);
  const last = num(series[series.length - 1][key]);
  if (!first || last === undefined || first <= 0 || last <= 0) return undefined;
  const rate = ((last / first) ** (1 / (series.length - 1)) - 1) * 100;
  return Number.isFinite(rate) ? Number(rate.toFixed(2)) : undefined;
}

/** What a scenario assumed, derived from the scenario itself. */
function basisOf(series: Record<string, unknown>[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  put(out, 'capitalGrowth', compoundRate(series, 'propertyValue'));
  put(out, 'rentalGrowth', compoundRate(series, 'annualRent'));
  return out;
}

export interface ProjectedCashFlow {
  cashflow: Record<string, unknown>;
  report: Record<string, unknown>;
  /** False when the report stores no projection — 1,020 of the 1,182 do not. */
  hasProjections: boolean;
}

export function projectCashFlow(
  row: CashFlowRowLike,
  scenario: ScenarioName = DEFAULT_SCENARIO,
): ProjectedCashFlow {
  // Read-boundary heal (audit F26): a stored series folded against
  // triple-charged operating costs is reconciled here, so the 10 Year Cash
  // Flow prints the same figures as the investment routes whatever path the
  // row arrived by. Idempotent on healthy rows; never written back.
  const fin = obj(reconcileStoredFinancials(row.financial_calculations).fin);
  const projections = obj(fin.projections);
  const initial = obj(fin.initialCosts);
  const loan = obj(fin.loanDetails);
  const costs = obj(fin.annualCosts);

  const series = projectSeries(projections[scenario]);
  const cashflow: Record<string, unknown> = {};

  if (series.length) {
    cashflow.years = series;
    cashflow.termYears = series.length;
    cashflow.scenario = scenario;
    // A page sets this in a sentence — "the moderate scenario" — and a KPI sets
    // it as a value, where a lower-case word reads as a database field that
    // escaped. Same reasoning as `loanType` above.
    cashflow.scenarioLabel = scenario.charAt(0).toUpperCase() + scenario.slice(1);

    // Every scenario, so a page can set them side by side. Strictly ordered on
    // all 162 stored reports, which is what makes the comparison worth drawing.
    const scenarios: Record<string, unknown> = {};
    // What each one assumed, read off the series rather than off the record —
    // see the header. 2/4/6 capital and 2/3/4 rental on all 162.
    const basis: Record<string, unknown> = {};
    for (const name of SCENARIOS) {
      const s = projectSeries(projections[name]);
      if (!s.length) continue;
      scenarios[name] = s;
      const b = basisOf(s);
      if (Object.keys(b).length) basis[name] = b;
    }
    if (Object.keys(scenarios).length) cashflow.scenarios = scenarios;
    if (Object.keys(basis).length) cashflow.scenarioBasis = basis;

    const leading = basisOf(series);
    if (Object.keys(leading).length) cashflow.basis = leading;

    // The ends of the series, so a KPI does not have to index the last element.
    const first = series[0];
    const last = series[series.length - 1];
    const outcome: Record<string, unknown> = {};
    put(outcome, 'year', num(last.year));
    put(outcome, 'propertyValue', num(last.propertyValue));
    put(outcome, 'loanBalance', num(last.loanBalance));
    put(outcome, 'equity', num(last.equity));
    put(outcome, 'annualRent', num(last.annualRent));
    put(outcome, 'cashFlow', num(last.cashFlow));
    put(outcome, 'cumulativeCashFlow', num(last.cumulativeCashFlow));
    put(outcome, 'roi', num(last.roi));

    // Arithmetic on the series itself — a subtraction the reader would
    // otherwise do off the table, not a second opinion about the same quantity.
    const v1 = num(first.propertyValue);
    const v10 = num(last.propertyValue);
    if (v1 && v10) {
      put(outcome, 'valueGrowth', v10 - v1);
      put(outcome, 'valueGrowthPercent', ((v10 - v1) / v1) * 100);
    }
    const e1 = num(first.equity);
    const e10 = num(last.equity);
    const shortfall = num(last.cumulativeCashFlow);
    if (e1 !== undefined && e10 !== undefined) {
      put(outcome, 'equityGrowth', e10 - e1);
      // Equity gained across the term LESS the cash contributed to hold it over
      // the same years — `cumulativeCashFlow` is negative on every element, so
      // this is a sum rather than a difference. It is the only figure in the
      // record that sets the paper gain against what it cost, and no document
      // this product produces has ever stated it. Labelled on the page as
      // exactly what it is: the deposit and the purchase costs are not in it.
      if (shortfall !== undefined) put(outcome, 'equityGrowthLessShortfall', (e10 - e1) + shortfall);
    }

    // The legacy outcome block carries the year the cash flow first turns
    // positive. Derived from the series exactly as `toOutcome` derives it —
    // and null on every moderate scenario in production (the four positive
    // elements across all 4,860 are optimistic), which the narrative below
    // says in the legacy's own sentence.
    const breakEven = series.find((y) => {
      const cf = num(y.cashFlow);
      return cf !== undefined && cf >= 0;
    });
    if (breakEven) put(outcome, 'breakEvenYear', num(breakEven.year));

    if (Object.keys(outcome).length) cashflow.outcome = outcome;

    const firstYear: Record<string, unknown> = { ...first };
    // The weekly figure the legacy year-one block carries — arithmetic on the
    // series (÷52), never `keyMetrics.weeklyNet`, which disagrees with the
    // series' own year one by a median of $477 a week.
    const cf1 = num(first.cashFlow);
    if (cf1 !== undefined) put(firstYear, 'cashFlowWeekly', cf1 / 52);
    if (Object.keys(firstYear).length) cashflow.firstYear = firstYear;

    /*
     * The narrative, in the legacy document's own sentence shapes.
     *
     * `describeProjection` in `reports/cashFlow/normalise.pure.ts` cannot run
     * here: it takes the browser's twenty-field years and throws on anything
     * less, which is its contract — the stored series carries eight fields.
     * So the sentences are restated from it with one deliberate change: the
     * legacy says "a week after tax", and the stored series does not state
     * its tax treatment, so this says "a week" and claims nothing the record
     * does not.
     */
    const moneyWord = (n: number): string => {
      const grouped = String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return `${n < 0 ? '-' : ''}$${grouped}`;
    };
    const growth = num(outcome.valueGrowth);
    if (cf1 !== undefined && growth !== undefined && e10 !== undefined) {
      const weekly = cf1 / 52;
      const position = weekly >= 0
        ? `returns ${moneyWord(weekly)} a week in year one`
        : `costs ${moneyWord(Math.abs(weekly))} a week to hold in year one`;
      const breakEvenSentence = breakEven
        ? (num(breakEven.year) === 1
          ? 'It is cash-flow positive from the first year.'
          : `On these assumptions it turns cash-flow positive in year ${num(breakEven.year)}.`)
        : 'On these assumptions it does not turn cash-flow positive within the projected term.';
      // `overview`, not `narrative` — the voice catalogue's ten-year table
      // already binds `cashflow.narrative` as its own hand-written paragraph,
      // and in the shared preview sample one string cannot serve two series.
      cashflow.overview = `${str(row.property_address) ?? 'The property'} ${position}. `
        + `Over ${series.length} years the projection shows ${moneyWord(growth)} of capital growth `
        + `and ${moneyWord(e10)} of equity at the end of the term. ${breakEvenSentence}`;
    }
  }

  // The purchase and the loan are INPUTS to the series rather than competing
  // outputs, so they can sit on the same document as it — less the two totals
  // and the property value, for the reasons in the header.
  const purchase: Record<string, unknown> = {};
  put(purchase, 'deposit', num(initial.deposit));
  put(purchase, 'stampDuty', num(initial.stampDuty));
  put(purchase, 'legalFees', num(initial.legalFees));
  put(purchase, 'inspectionFees', num(initial.inspectionFees));
  put(purchase, 'lmi', num(initial.lmi));
  put(purchase, 'agentFee', num(initial.agentFee));
  put(purchase, 'landPrice', num(initial.landPrice));
  put(purchase, 'buildPrice', num(initial.buildPrice));
  put(purchase, 'loanAmount', num(initial.loanAmount) ?? num(loan.loanAmount));
  if (Object.keys(purchase).length) cashflow.purchase = purchase;

  const lending: Record<string, unknown> = {};
  put(lending, 'interestRate', num(loan.interestRate));
  put(lending, 'monthlyPayment', num(loan.monthlyPayment));
  put(lending, 'weeklyPayment', num(loan.weeklyPayment));
  put(lending, 'totalInterest', num(loan.totalInterest));
  const loanType = str(loan.loanType);
  if (loanType) put(lending, 'loanType', LOAN_TYPE_LABELS[loanType] ?? loanType);
  put(lending, 'rateSource', str(loan.rateSource));
  put(lending, 'lvr', num(loan.lvr) ?? num(obj(fin.keyMetrics).lvr));
  if (Object.keys(lending).length) cashflow.loan = lending;

  // Components only. `totalAnnual` is absent for the reason in the header.
  const holding: Record<string, unknown> = {};
  put(holding, 'councilRates', num(costs.councilRates));
  put(holding, 'waterRates', num(costs.waterRates));
  put(holding, 'landlordInsurance', num(costs.landlordInsurance));
  put(holding, 'maintenance', num(costs.maintenance));
  put(holding, 'propertyManagement', num(costs.propertyManagement));
  put(holding, 'strataFees', num(costs.strataFees));
  put(holding, 'landTax', num(costs.landTax));
  put(holding, 'lettingFees', num(costs.lettingFees));
  if (Object.keys(holding).length) cashflow.costs = holding;

  // `fin.assumptions` is deliberately not read. It describes rates the stored
  // series was not built at — see the header — and `basis` above carries the
  // rates it was.

  const property: Record<string, unknown> = {};
  put(property, 'address', str(row.property_address));
  if (Object.keys(property).length) cashflow.property = property;

  const report: Record<string, unknown> = {};
  put(report, 'generatedDate', str(row.updated_at) ?? str(row.created_at));

  return { cashflow, report, hasProjections: series.length > 0 };
}

/**
 * Merge the projection into a binding-context `data` object.
 *
 * Nested under `cashflow`, which the voice catalogue already uses for its own
 * ten-year table — the keys are disjoint, and nesting keeps this format's
 * namespace from colliding with `assumptions`, `loan`, `costs` and `property`,
 * all of which mean other things elsewhere in the shared preview sample.
 */
export function applyCashFlowProjection(
  data: Record<string, any>,
  row: CashFlowRowLike,
  scenario: ScenarioName = DEFAULT_SCENARIO,
): Record<string, any> {
  const p = projectCashFlow(row, scenario);
  const merge = (key: string, extra: Record<string, unknown>) => {
    if (!Object.keys(extra).length) return;
    const existing = data[key];
    data[key] = {
      ...(existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}),
      ...extra,
    };
  };
  merge('cashflow', p.cashflow);
  merge('report', p.report);
  return data;
}
