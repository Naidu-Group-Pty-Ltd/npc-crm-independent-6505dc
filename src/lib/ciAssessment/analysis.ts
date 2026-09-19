/**
 * The investment-analysis half of an assessment.
 *
 * ## Why this exists
 *
 * The standalone calculator suite could compute a cap rate, a ten-year cash
 * flow and a set of industrial metrics — and could not remember any of it. Its
 * whole state lived in a Zustand store created at page load
 * (`commercialDealState.ts`), so a refresh, a crash or a click on a link threw
 * away every input the operator had typed. Nothing was written anywhere. The
 * "Generate Report" button set a timestamp in React state and dispatched a
 * window event; no document was ever produced.
 *
 * The assessment record already solves persistence properly: a durable id, a
 * reference, autosave with version conflict detection, immutable calculation
 * runs, a client link with reconciliation, an audit trail and a real rendered
 * report. What it did not carry was the *analysis* inputs — the ones the
 * lending assessment has no opinion about: a target capitalisation rate, a
 * hold period, growth and exit assumptions, and the site metrics that make an
 * industrial building comparable to another industrial building.
 *
 * So this is the missing section, and it lives inside the same payload. One
 * record, one autosave, one calculation run, one report. No second store, no
 * second table, no second idea of what a deal is.
 *
 * ## Why every field is optional-with-a-default
 *
 * Assessments written before this section existed are read back through
 * `hydrateAssessmentPayload`, which merges over these defaults. An older
 * record therefore opens in the workspace with sane assumptions rather than
 * `undefined` propagating into a discounted cash flow — where it would not
 * error, it would quietly produce a number.
 */

import type { AssessmentPayload } from './types';

/** Which NOI a valuation is struck on. Mirrors the cap-rate engine's basis. */
export type ValuationBasis = 'passing' | 'market' | 'stabilised' | 'lenderAdjusted';

export interface ValuationAssumptions {
  /** The rate the asset is being valued at, as a percentage. */
  targetCapRatePct: number;
  /** Comparable evidence range, used to flag a rate outside the market. */
  benchmarkLowPct: number;
  benchmarkHighPct: number;
  valuationBasis: ValuationBasis;
}

export interface ForecastAssumptions {
  holdPeriodYears: number;
  /** Compounding rental growth applied to NOI, per year. */
  rentalGrowthPct: number;
  /** Structural vacancy haircut applied to each year's NOI. */
  vacancyAllowancePct: number;
  /** Recurring capital expenditure, per year, in dollars. */
  annualCapex: number;
  /** The rate the asset is assumed to be sold at. */
  terminalCapRatePct: number;
  sellingCostsPct: number;
  /** The rate future cash flows are discounted at for NPV. */
  discountRatePct: number;
}

/**
 * Industrial site metrics.
 *
 * Lettable and site area live on the property section — they are facts about
 * the building, not assumptions — and are read from there. These are the ones
 * only an industrial analysis asks for.
 */
export interface IndustrialAssumptions {
  officeAreaSqm: number;
  hardstandAreaSqm: number;
  /** Internal clearance height in metres. */
  clearanceMetres: number;
  /** Three-phase supply in amps. */
  powerAmps: number;
}

export interface AnalysisSection {
  valuation: ValuationAssumptions;
  forecast: ForecastAssumptions;
  industrial: IndustrialAssumptions;
}

/**
 * Defaults.
 *
 * Deliberately conservative and deliberately *visible*: every one of these is
 * shown in a field the operator can change, and the analysis states which
 * figures are assumptions rather than evidence. A default that produces a
 * plausible-looking IRR nobody chose is worse than an empty one, so growth and
 * capex start at zero — the model runs, and says what it was given.
 */
export function emptyAnalysisSection(): AnalysisSection {
  return {
    valuation: {
      targetCapRatePct: 0,
      benchmarkLowPct: 0,
      benchmarkHighPct: 0,
      valuationBasis: 'passing',
    },
    forecast: {
      holdPeriodYears: 10,
      rentalGrowthPct: 0,
      vacancyAllowancePct: 0,
      annualCapex: 0,
      terminalCapRatePct: 0,
      sellingCostsPct: 2,
      discountRatePct: 0,
    },
    industrial: {
      officeAreaSqm: 0,
      hardstandAreaSqm: 0,
      clearanceMetres: 0,
      powerAmps: 0,
    },
  };
}

/**
 * Read the analysis section off a payload of any vintage.
 *
 * Never returns undefined and never mutates the payload: a record written
 * before this section existed reads as the defaults, and only becomes one on
 * disk when the operator changes something.
 */
export function analysisOf(payload: AssessmentPayload): AnalysisSection {
  const base = emptyAnalysisSection();
  const source = (payload as AssessmentPayload & { analysis?: Partial<AnalysisSection> }).analysis;
  if (!source) return base;
  return {
    valuation: { ...base.valuation, ...(source.valuation ?? {}) },
    forecast: { ...base.forecast, ...(source.forecast ?? {}) },
    industrial: { ...base.industrial, ...(source.industrial ?? {}) },
  };
}

/** Write one analysis group back, returning a new payload. */
export function withAnalysis<K extends keyof AnalysisSection>(
  payload: AssessmentPayload,
  group: K,
  patch: Partial<AnalysisSection[K]>,
): AssessmentPayload {
  const current = analysisOf(payload);
  return {
    ...payload,
    analysis: { ...current, [group]: { ...current[group], ...patch } },
  };
}
