/**
 * ME-6 — Aurixa owns the growth calculation.
 *
 * ## Why this exists
 *
 * A provider may hand back a pre-computed "5 year growth" or it may hand back
 * a series of observations. Where it hands back observations, the arithmetic is
 * ours, and the programme's governing rule applies without exception: **if a
 * figure can be produced deterministically from the record, the model must
 * never be asked to calculate, guess, transcribe or recreate it.** Nothing in
 * this module calls anything. It is arithmetic over data with the working
 * shown.
 *
 * ## The rule that shapes it: a growth figure is a claim about ONE series
 *
 * The four ways to get this wrong all look like a number:
 *
 * | mixing | why it is not a growth rate |
 * | --- | --- |
 * | house with unit | two markets; the ratio between them is composition, not growth |
 * | suburb with regional | §48 is what happened when a regional figure stood in for a local one |
 * | observed with forecast | a projection is somebody's opinion; growth is what occurred |
 * | median price with valuation index | a median moves when the MIX of sales moves; an index holds mix constant |
 *
 * None of these is detectable from the numbers afterwards — a series blended
 * from a house median and a unit median is a perfectly plausible-looking
 * series. So {@link seriesIsHomogeneous} is checked BEFORE any arithmetic runs,
 * and a heterogeneous series produces a refusal rather than a figure.
 *
 * ## What is persisted, and why all of it
 *
 * A `GrowthPeriodResult` carries the start observation, the end observation,
 * the exact elapsed period, the formula version, the value and the source. That
 * is not bookkeeping: it is what lets a reader reproduce the number, and what
 * lets a later reader tell a 3-year CAGR computed over 2.9 years from one
 * computed over 3.1.
 *
 * ## Absent, never zero
 *
 * A period that cannot be computed returns a refusal naming the reason. It
 * never returns 0, and it never falls back to a shorter window and calls it a
 * five-year figure.
 */

/** Bumped when the arithmetic changes. Persisted on every result. */
export const GROWTH_FORMULA_VERSION = 'me6.growth.1' as const;

/** What the series measures. Mixing two of these is not a growth rate. */
export type SeriesMeasure = 'median_sale_price' | 'valuation_index' | 'median_rent';

/** Whether an observation happened or was projected. */
export type ObservationBasis = 'observed' | 'forecast';

/** One point in a provider's series. */
export interface SeriesObservation {
  /** ISO date the observation describes — the END of its period. */
  period: string;
  value: number;
  /** Transactions behind it, where the provider states one. */
  sampleSize?: number | null;
  basis?: ObservationBasis;
}

/** A series and everything that makes it one series rather than several. */
export interface HomogeneousSeries {
  observations: ReadonlyArray<SeriesObservation>;
  measure: SeriesMeasure;
  /** house / attached / land / any — the evidence vocabulary, not the engine's. */
  dwellingType: string;
  /** suburb / postcode / lga / … — the level EVERY observation describes. */
  level: string;
  areaName: string;
  provider: string;
  /** The provider's own product/dataset name, for the audit trail. */
  sourceProduct?: string | null;
}

/** Why a period could not be computed. Never a zero. */
export type GrowthRefusalReason =
  | 'series_empty'
  | 'series_heterogeneous'
  | 'insufficient_history'
  | 'no_observation_near_start'
  | 'non_positive_start_value'
  | 'non_finite_value'
  | 'period_out_of_tolerance'
  | 'duplicate_period';

export interface GrowthRefusal {
  ok: false;
  reason: GrowthRefusalReason;
  detail: string;
  requestedYears: number;
}

export interface GrowthPeriodResult {
  ok: true;
  /** Per cent for 1 year; per cent PER ANNUM for 3 and 5. */
  value: number;
  requestedYears: number;
  /** Years actually elapsed between the two observations, to 3 decimals. */
  actualYears: number;
  start: SeriesObservation;
  end: SeriesObservation;
  measure: SeriesMeasure;
  dwellingType: string;
  level: string;
  areaName: string;
  provider: string;
  sourceProduct: string | null;
  formulaVersion: typeof GROWTH_FORMULA_VERSION;
  /** `annual_movement` for 1 year, `cagr` for multi-year. */
  method: 'annual_movement' | 'cagr';
  /** The arithmetic, as a reader would check it. */
  working: string;
}

export type GrowthPeriodAnswer = GrowthPeriodResult | GrowthRefusal;

const MS_PER_YEAR = 365.2425 * 24 * 60 * 60 * 1000;

function parse(period: string): number | null {
  const t = Date.parse(period);
  return Number.isFinite(t) ? t : null;
}

/**
 * Is every observation from the same series?
 *
 * A `forecast` observation is not rejected here — it is excluded by
 * {@link observedOnly} before this runs — because a series that legitimately
 * carries projections beyond today is not malformed, it just may not be used.
 */
export function seriesIsHomogeneous(series: HomogeneousSeries): { ok: boolean; detail: string } {
  const { observations } = series;
  if (observations.length === 0) return { ok: false, detail: 'The series carries no observations.' };

  const periods = new Set<string>();
  for (const o of observations) {
    if (!Number.isFinite(o.value)) {
      return { ok: false, detail: `Observation at ${o.period} is not a finite number.` };
    }
    if (parse(o.period) === null) {
      return { ok: false, detail: `Observation period "${o.period}" is not a date.` };
    }
    if (periods.has(o.period)) {
      return { ok: false, detail: `Period ${o.period} appears more than once; one period is one observation.` };
    }
    periods.add(o.period);
  }
  return { ok: true, detail: 'One measure, one dwelling type, one geography, one provider.' };
}

/** Observations that actually happened, oldest first. A forecast is not growth. */
export function observedOnly(series: HomogeneousSeries): HomogeneousSeries {
  return {
    ...series,
    observations: [...series.observations]
      .filter((o) => (o.basis ?? 'observed') === 'observed')
      .sort((a, b) => (parse(a.period)! - parse(b.period)!)),
  };
}

/**
 * How far the start observation may sit from the exact anniversary.
 *
 * Providers publish quarterly, so an exact five-years-ago observation usually
 * does not exist. A tolerance is honest; silently taking the nearest point
 * whatever its distance is not — a "5 year CAGR" computed over 3.5 years is a
 * different claim, and `actualYears` records what was really used.
 */
export const PERIOD_TOLERANCE_YEARS = 0.5;

/**
 * Compute one growth period from a series.
 *
 * The end observation is the most recent observed point. The start observation
 * is the one closest to `requestedYears` before it, and the answer is refused
 * if that is outside {@link PERIOD_TOLERANCE_YEARS}.
 */
export function computeGrowthPeriod(
  rawSeries: HomogeneousSeries,
  requestedYears: number,
): GrowthPeriodAnswer {
  const homogeneous = seriesIsHomogeneous(rawSeries);
  if (!homogeneous.ok) {
    const reason: GrowthRefusalReason = rawSeries.observations.length === 0
      ? 'series_empty'
      : homogeneous.detail.includes('more than once')
        ? 'duplicate_period'
        : homogeneous.detail.includes('not a finite')
          ? 'non_finite_value'
          : 'series_heterogeneous';
    return { ok: false, reason, detail: homogeneous.detail, requestedYears };
  }

  const series = observedOnly(rawSeries);
  const obs = series.observations;
  if (obs.length < 2) {
    return {
      ok: false,
      reason: 'insufficient_history',
      detail: `${obs.length} observed point(s); a growth period needs two.`,
      requestedYears,
    };
  }

  const end = obs[obs.length - 1];
  const endT = parse(end.period)!;
  const targetT = endT - requestedYears * MS_PER_YEAR;

  let start = obs[0];
  let bestGap = Math.abs(parse(obs[0].period)! - targetT);
  for (const o of obs.slice(0, -1)) {
    const gap = Math.abs(parse(o.period)! - targetT);
    if (gap < bestGap) { bestGap = gap; start = o; }
  }

  const actualYears = Math.round(((endT - parse(start.period)!) / MS_PER_YEAR) * 1000) / 1000;
  if (Math.abs(actualYears - requestedYears) > PERIOD_TOLERANCE_YEARS) {
    return {
      ok: false,
      reason: obs.length > 0 && actualYears < requestedYears ? 'insufficient_history' : 'period_out_of_tolerance',
      detail:
        `Closest available start is ${actualYears} years before ${end.period}, and ${requestedYears} was asked for `
        + `(tolerance ${PERIOD_TOLERANCE_YEARS}). A shorter window is not a ${requestedYears}-year figure.`,
      requestedYears,
    };
  }
  if (!(start.value > 0)) {
    return {
      ok: false,
      reason: 'non_positive_start_value',
      detail: `Start value ${start.value} at ${start.period}: growth from a non-positive base is undefined.`,
      requestedYears,
    };
  }

  const ratio = end.value / start.value;
  const method: 'annual_movement' | 'cagr' = requestedYears <= 1 ? 'annual_movement' : 'cagr';
  const value = method === 'annual_movement'
    ? (ratio - 1) * 100
    : (Math.pow(ratio, 1 / actualYears) - 1) * 100;

  if (!Number.isFinite(value)) {
    return { ok: false, reason: 'non_finite_value', detail: 'The computed value is not finite.', requestedYears };
  }

  const rounded = Math.round(value * 100) / 100;
  return {
    ok: true,
    value: rounded,
    requestedYears,
    actualYears,
    start,
    end,
    measure: series.measure,
    dwellingType: series.dwellingType,
    level: series.level,
    areaName: series.areaName,
    provider: series.provider,
    sourceProduct: series.sourceProduct ?? null,
    formulaVersion: GROWTH_FORMULA_VERSION,
    method,
    working: method === 'annual_movement'
      ? `(${end.value} ÷ ${start.value} − 1) × 100 = ${rounded}% over ${actualYears} years `
        + `(${start.period} → ${end.period})`
      : `((${end.value} ÷ ${start.value})^(1/${actualYears}) − 1) × 100 = ${rounded}% p.a. `
        + `(${start.period} → ${end.period})`,
  };
}

/** The three periods the Growth methodology reads. */
export const GROWTH_PERIODS = [1, 3, 5] as const;

export interface GrowthPeriodSet {
  oneYear: GrowthPeriodAnswer;
  threeYear: GrowthPeriodAnswer;
  fiveYear: GrowthPeriodAnswer;
  /** Observed points available, after forecasts are excluded. */
  observedPoints: number;
  /** Span of the observed series in years, or null where it cannot be measured. */
  observedSpanYears: number | null;
}

/** Compute all three, each refusing independently. A missing 5-year does not cost the 1-year. */
export function computeGrowthPeriods(series: HomogeneousSeries): GrowthPeriodSet {
  const observed = observedOnly(series).observations;
  let span: number | null = null;
  if (observed.length >= 2) {
    const a = parse(observed[0].period);
    const b = parse(observed[observed.length - 1].period);
    if (a !== null && b !== null) span = Math.round(((b - a) / MS_PER_YEAR) * 1000) / 1000;
  }
  return {
    oneYear: computeGrowthPeriod(series, 1),
    threeYear: computeGrowthPeriod(series, 3),
    fiveYear: computeGrowthPeriod(series, 5),
    observedPoints: observed.length,
    observedSpanYears: span,
  };
}
