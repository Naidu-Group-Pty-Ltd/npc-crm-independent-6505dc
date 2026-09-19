/**
 * Scoring Engine V2 — missing evidence is not an average score.
 *
 * ## What V1 did, measured across all 992 scored reports
 *
 * | dimension | weight | avg | min | max | included at exactly 50 |
 * | --- | ---: | ---: | ---: | ---: | ---: |
 * | growth | 40 | 49.9 | 0 | **50** | **975 of 992** |
 * | location | 25 | 53.2 | 14 | 85 | — |
 * | yield | 15 | **19.9** | 0 | 100 | — |
 * | demand | 15 | 50.0 | **50** | **50** | **974 of 991** |
 * | risk | 5 | 92.9 | 35 | 100 | — |
 *
 * Best score ever produced: **68**. A needs 75, A+ needs 85. In a year, not one
 * report reached either — and 649 of 992 sat inside a six-point band (48–54).
 *
 * ## Three causes, each measured
 *
 * **1. A dimension was marked "has data" by an input it does not score on.**
 * This is the whole of the growth and demand problem, and it is not simply
 * "starts at 50". `growthPoints` counts `populationGrowth` towards `hasData`,
 * but `calculateGrowthScore` only adds for it above 2% — so a report carrying
 * population growth of 1.4% is marked as a *measured* growth dimension,
 * contributes nothing, and holds **40% of the weight at a flat 50**. Demand is
 * worse: `medianSuburbPrice` counts towards `hasData` and the demand scorer
 * never reads it at all.
 *
 * The aggregate machinery was always right — `aggregateDimensions` excludes a
 * dimension with `hasData: false` and renormalises the rest, and 17 reports
 * prove it works. It was fed a lie about what had been measured.
 *
 * **2. The yield score double-counted the cash flow.** V1 banded the gross
 * yield and then subtracted 20 more when weekly cash flow was below −$100.
 * A low yield is what *causes* negative cash flow on a leveraged purchase, so
 * the same fact was scored twice — and negative gearing is the ordinary
 * condition of an Australian growth asset. Measured: **778 of 992 reports
 * (78%) scored exactly 10**, every one of them carrying the detail
 * *"Below average yield (2-3%)"* — the 30-point band minus the 20-point
 * penalty. Cash flow is already scored by `riskScore`, and by `cashflowScore`
 * on the financial variant.
 *
 * **3. `propertyType || 'house'`** turned an unclassified property into a
 * house, and `dRisk` awards `house` +3. `property_specs.property_type` is the
 * literal `'Residential Property'` on 100% of reports since June 2026, so the
 * bonus was being awarded on the strength of a placeholder.
 *
 * ## The rules
 *
 * **A dimension has data only if an input it actually scores on moved it.**
 * Every scorer below returns the `contributing` inputs — the ones that changed
 * the number — and `hasData` is derived from that list, never from a wider
 * "we have something in this area" test.
 *
 * **A dimension with no contributing input is excluded and the remaining
 * weights renormalise.** No placeholder, no neutral 50 standing in for a
 * measurement nobody made.
 *
 * **Absent inputs do not drag a present one toward the middle.** Growth and
 * demand score as the mean of the sub-signals that are present, so a property
 * with one strong measured signal scores strongly on it rather than being
 * averaged against a base that means nothing.
 *
 * **Thresholds are unchanged.** A = 75 and A+ = 85, exactly as before. The
 * range is made reachable by measuring properly, never by moving the line.
 */

export const SCORING_VERSION = 2;

/** A = 75, A+ = 85 — deliberately identical to V1. */
export const GRADE_THRESHOLDS: ReadonlyArray<readonly [number, string]> = [
  [85, 'A+'], [75, 'A'], [65, 'B+'], [55, 'B'], [50, 'C+'], [40, 'C'], [30, 'D'], [0, 'F'],
] as const;

export interface ScoringInputV2 {
  propertyPrice?: number;
  weeklyRent?: number;
  propertyType?: string;
  medianSuburbPrice?: number;
  priceGrowth1Year?: number;
  priceGrowth3Year?: number;
  populationGrowth?: number;
  vacancyRate?: number;
  daysOnMarket?: number;
  unemploymentRate?: number;
  medianIncome?: number;
  walkScore?: number;
  commuteTimeCBD?: number;
  schoolsNearby?: number;
  cashFlow?: number;
  lvr?: number;
  state?: string;
}

export interface DimensionV2 {
  score: number;
  details: string;
  /** Inputs that actually MOVED this score. `hasData` is derived from it. */
  contributing: string[];
  hasData: boolean;
}

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** Mean of the sub-scores that were actually measured. Never a base value. */
function meanOf(parts: Array<{ score: number; label: string; detail: string }>): DimensionV2 {
  if (!parts.length) {
    return { score: 0, details: 'Not measured', contributing: [], hasData: false };
  }
  const score = clamp(parts.reduce((s, p) => s + p.score, 0) / parts.length);
  return {
    score,
    details: parts.map((p) => p.detail).join('. '),
    contributing: parts.map((p) => p.label),
    hasData: true,
  };
}

/**
 * Piecewise-linear interpolation over measured anchor points.
 *
 * Used for yield, where the anchors are the observed percentiles of the
 * corpus's own gross-yield distribution — so a score is a statement about
 * where the property sits among comparable investment stock, which is what
 * makes it defensible to a client who challenges it.
 */
function interpolate(value: number, anchors: ReadonlyArray<readonly [number, number]>): number {
  const pts = [...anchors].sort((a, b) => a[0] - b[0]);
  if (value <= pts[0][0]) return pts[0][1];
  if (value >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 0; i < pts.length - 1; i += 1) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    if (value >= x0 && value <= x1) {
      return y0 + ((value - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return pts[pts.length - 1][1];
}

/**
 * Gross yield anchored to the corpus's own distribution.
 *
 * Measured over the 203 reports carrying both a rent and a price
 * (2026-09-08): p10 3.60%, p25 3.95%, p50 4.36%, p75 5.49%, p90 6.42%,
 * p95 7.01%. The anchors below map those percentiles onto the score, so the
 * median property scores 50 and a p90 property scores 90 — a percentile
 * statement rather than an opinion about what a "good" yield is.
 *
 * V1's fixed bands (≥6→100, ≥5→85, ≥4→70, ≥3→50, ≥2→30) were not obviously
 * wrong for this stock — the median of 4.36% lands in its 70 band. What broke
 * them was the −20 cash-flow penalty applied afterwards, which is why the
 * modal score was 10. That penalty is gone: cash flow is `riskScore`'s to
 * judge, and scoring it twice punishes every negatively geared growth asset
 * for the thing that makes it a growth asset.
 */
export const YIELD_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [2.0, 5], [3.0, 20], [3.6, 30], [3.95, 40], [4.36, 50], [5.49, 75], [6.42, 90], [7.01, 97], [9.0, 100],
] as const;

export function scoreYield(i: ScoringInputV2): DimensionV2 {
  const price = num(i.propertyPrice);
  const rent = num(i.weeklyRent);
  if (!price || price <= 0 || !rent || rent <= 0) {
    return { score: 0, details: 'No rent or price on record', contributing: [], hasData: false };
  }
  const gross = (rent * 52 / price) * 100;
  return {
    score: clamp(interpolate(gross, YIELD_ANCHORS)),
    details: `Gross yield ${gross.toFixed(2)}%`,
    contributing: ['propertyPrice', 'weeklyRent'],
    hasData: true,
  };
}

/**
 * Growth from whichever of the three signals is present — never a base of 50.
 *
 * V1 marked this dimension measured whenever `populationGrowth` existed, then
 * only moved the score when it exceeded 2%. So the commonest outcome was
 * "measured, 50" on 40% of the total weight.
 */
export function scoreGrowth(i: ScoringInputV2): DimensionV2 {
  const parts: Array<{ score: number; label: string; detail: string }> = [];
  const g1 = num(i.priceGrowth1Year);
  const g3 = num(i.priceGrowth3Year);
  const pop = num(i.populationGrowth);

  if (g1 !== undefined) {
    const s = g1 >= 12 ? 100 : g1 >= 8 ? 88 : g1 >= 5 ? 75 : g1 >= 3 ? 62 : g1 >= 1 ? 48 : g1 >= 0 ? 35 : 15;
    parts.push({ score: s, label: 'priceGrowth1Year', detail: `${g1.toFixed(1)}% growth over 12 months` });
  }
  if (g3 !== undefined) {
    const s = g3 >= 30 ? 100 : g3 >= 20 ? 85 : g3 >= 12 ? 70 : g3 >= 6 ? 55 : g3 >= 0 ? 40 : 15;
    parts.push({ score: s, label: 'priceGrowth3Year', detail: `${g3.toFixed(1)}% over three years` });
  }
  if (pop !== undefined) {
    // ABS ERP by SA2. National average is ~1.5%/yr, so 2%+ is genuinely above
    // trend and 3%+ is a high-growth corridor.
    const s = pop >= 3 ? 100 : pop >= 2 ? 82 : pop >= 1.5 ? 65 : pop >= 0.8 ? 50 : pop >= 0 ? 35 : 15;
    parts.push({ score: s, label: 'populationGrowth', detail: `${pop.toFixed(1)}% population growth` });
  }
  return meanOf(parts);
}

/**
 * Demand from vacancy, days on market and unemployment.
 *
 * `medianSuburbPrice` is deliberately NOT here. V1 counted it towards
 * `hasData` and never scored on it, which is the single clearest instance of
 * a dimension declaring itself measured on evidence it does not use.
 */
export function scoreDemand(i: ScoringInputV2): DimensionV2 {
  const parts: Array<{ score: number; label: string; detail: string }> = [];
  const vac = num(i.vacancyRate);
  const dom = num(i.daysOnMarket);
  const unemp = num(i.unemploymentRate);

  if (vac !== undefined) {
    const s = vac < 1 ? 100 : vac < 1.5 ? 88 : vac < 2 ? 75 : vac < 3 ? 58 : vac < 4 ? 42 : vac < 5 ? 28 : 12;
    parts.push({ score: s, label: 'vacancyRate', detail: `${vac.toFixed(1)}% rental vacancy` });
  }
  if (dom !== undefined) {
    const s = dom < 15 ? 100 : dom < 30 ? 85 : dom < 45 ? 70 : dom < 60 ? 55 : dom < 90 ? 38 : 20;
    parts.push({ score: s, label: 'daysOnMarket', detail: `${Math.round(dom)} days on market` });
  }
  if (unemp !== undefined) {
    const s = unemp < 2.5 ? 100 : unemp < 3.5 ? 85 : unemp < 4.5 ? 68 : unemp < 5.5 ? 52 : unemp < 7 ? 35 : 18;
    parts.push({ score: s, label: 'unemploymentRate', detail: `${unemp.toFixed(1)}% unemployment` });
  }
  return meanOf(parts);
}

/** Location from walkability, commute and school access. */
export function scoreLocation(i: ScoringInputV2): DimensionV2 {
  const parts: Array<{ score: number; label: string; detail: string }> = [];
  const walk = num(i.walkScore);
  const commute = num(i.commuteTimeCBD);
  const schools = num(i.schoolsNearby);

  if (walk !== undefined && walk > 0) {
    const s = walk >= 90 ? 100 : walk >= 70 ? 85 : walk >= 50 ? 65 : walk >= 25 ? 42 : 22;
    parts.push({ score: s, label: 'walkScore', detail: `Walk score ${Math.round(walk)}` });
  }
  if (commute !== undefined && commute > 0) {
    const s = commute <= 20 ? 100 : commute <= 35 ? 85 : commute <= 50 ? 68 : commute <= 70 ? 48 : 28;
    parts.push({ score: s, label: 'commuteTimeCBD', detail: `${Math.round(commute)} min to the CBD` });
  }
  if (schools !== undefined && schools > 0) {
    const s = schools >= 8 ? 100 : schools >= 5 ? 82 : schools >= 3 ? 65 : schools >= 1 ? 45 : 25;
    parts.push({ score: s, label: 'schoolsNearby', detail: `${Math.round(schools)} schools within 3 km` });
  }
  return meanOf(parts);
}

/**
 * Risk from leverage, cash flow and property type.
 *
 * The type contributes only when it RESOLVES. V1 read
 * `propertyType || 'house'`, so an unclassified property collected the house
 * bonus — and the spec column has held the placeholder `'Residential Property'`
 * on every report since June 2026.
 */
export function scoreRisk(i: ScoringInputV2): DimensionV2 {
  const parts: Array<{ score: number; label: string; detail: string }> = [];
  const lvr = num(i.lvr);
  const cash = num(i.cashFlow);
  const type = typeof i.propertyType === 'string' ? i.propertyType.trim().toLowerCase() : '';

  if (lvr !== undefined) {
    const s = lvr <= 60 ? 100 : lvr <= 70 ? 88 : lvr <= 80 ? 72 : lvr <= 85 ? 55 : lvr <= 90 ? 38 : lvr <= 95 ? 22 : 10;
    parts.push({ score: s, label: 'lvr', detail: `${Math.round(lvr)}% LVR` });
  }
  if (cash !== undefined) {
    const s = cash > 150 ? 100 : cash > 50 ? 88 : cash >= 0 ? 75 : cash > -100 ? 60 : cash > -200 ? 48 : cash > -300 ? 36 : cash > -400 ? 25 : 15;
    parts.push({ score: s, label: 'cashFlow', detail: `$${Math.round(cash)}/week net` });
  }
  // Only a type the engine recognises contributes. No default.
  if (type === 'house') parts.push({ score: 78, label: 'propertyType', detail: 'Detached house' });
  else if (type === 'townhouse') parts.push({ score: 62, label: 'propertyType', detail: 'Townhouse' });
  else if (type === 'unit' || type === 'apartment') parts.push({ score: 52, label: 'propertyType', detail: 'Strata unit' });

  return meanOf(parts);
}

/** Nominal weights. Identical to V1's composite — this release does not re-weight. */
export const COMPOSITE_WEIGHTS_V2: Readonly<Record<string, number>> = {
  yieldScore: 0.15,
  growthScore: 0.40,
  locationScore: 0.25,
  demandScore: 0.15,
  riskScore: 0.05,
};

/** Below this many measured dimensions there is no defensible headline grade. */
export const MIN_DIMENSIONS_FOR_GRADE = 3;

export interface ScoreResultV2 {
  scoringVersion: number;
  totalScore: number | null;
  grade: string;
  breakdown: Record<string, DimensionV2 & { weight: number; excluded: boolean }>;
  coverage: {
    dimensionsScored: number;
    totalDimensions: number;
    coverageRatio: number;
    weightCovered: number;
    dataInsufficient: boolean;
    partialLabel: string;
  };
}

export function gradeFor(score: number): string {
  for (const [floor, grade] of GRADE_THRESHOLDS) if (score >= floor) return grade;
  return 'F';
}

/**
 * Score a property. Dimensions with no contributing evidence are excluded and
 * the remaining weights renormalise over what was measured.
 */
export function scoreInvestmentV2(input: ScoringInputV2): ScoreResultV2 {
  const dims: Record<string, DimensionV2> = {
    yieldScore: scoreYield(input),
    growthScore: scoreGrowth(input),
    locationScore: scoreLocation(input),
    demandScore: scoreDemand(input),
    riskScore: scoreRisk(input),
  };

  const keys = Object.keys(COMPOSITE_WEIGHTS_V2);
  const scored = keys.filter((k) => dims[k].hasData);
  const weightCovered = scored.reduce((s, k) => s + COMPOSITE_WEIGHTS_V2[k], 0);
  const dataInsufficient = scored.length < MIN_DIMENSIONS_FOR_GRADE || weightCovered <= 0;

  const totalScore = dataInsufficient
    ? null
    : clamp(scored.reduce((s, k) => s + dims[k].score * (COMPOSITE_WEIGHTS_V2[k] / weightCovered), 0));

  const breakdown: ScoreResultV2['breakdown'] = {};
  for (const k of keys) {
    const d = dims[k];
    breakdown[k] = {
      ...d,
      weight: d.hasData && !dataInsufficient ? Math.round((COMPOSITE_WEIGHTS_V2[k] / weightCovered) * 100) : 0,
      excluded: !d.hasData,
    };
  }

  return {
    scoringVersion: SCORING_VERSION,
    totalScore,
    grade: totalScore === null ? 'N/A' : gradeFor(totalScore),
    breakdown,
    coverage: {
      dimensionsScored: scored.length,
      totalDimensions: keys.length,
      coverageRatio: scored.length / keys.length,
      weightCovered,
      dataInsufficient,
      partialLabel: scored.length === keys.length
        ? 'Scored on all 5 dimensions'
        : `Partial score: ${scored.length} of ${keys.length} dimensions`,
    },
  };
}
