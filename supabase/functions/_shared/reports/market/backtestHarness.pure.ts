/**
 * ME-4 — the backtest harness and its calibration diagnostics.
 *
 * Consumes a {@link HistoricalBacktestInput}, a `MarketEvidence` snapshot and
 * {@link scoreInvestmentV2Shadow}, and produces the per-report rows and the
 * distributions a calibration decision needs.
 *
 * **It does not fabricate evidence.** `runBacktest` scores exactly the rows it
 * is handed evidence for and reports the rest as unresolved. There is no
 * synthetic fallback, no regional stand-in for a suburb figure, and no default
 * — because a backtest run on invented inputs would produce a distribution
 * that looks exactly like a real one and would be acted on.
 *
 * ## The diagnostics are diagnostics
 *
 * Every check below **reports**; none adjusts a score. That separation is the
 * point: audit §48 was found by looking at a distribution, and a system that
 * had silently corrected for it would have hidden the finding instead. An
 * operator reads these and decides; the engine does not decide for them.
 *
 * The nine checks are the failure modes this programme has already met or can
 * name: one state dominating the top grades (§48), one dimension dominating the
 * composite, compression, inflation, everything landing in one grade, A/A+ on
 * low confidence, a high score resting on one extraordinary year,
 * a high score resting mainly on renormalisation, and — the subtlest —
 * score movement driven by data availability rather than by performance.
 */

import type { HistoricalBacktestInput } from './backtestInput.pure.ts';
import type { MarketEvidence } from './marketEvidence.pure.ts';
import {
  type DimensionKey,
  type ShadowScoreResult,
  COMPOSITE_WEIGHTS,
  scoreInvestmentV2Shadow,
} from './shadowScorer.pure.ts';

export interface BacktestRow {
  reportId: string;
  state: string | null;
  suburb: string | null;
  dwellingType: string | null;

  /** The score already stored, from the live V1 engine. */
  v1Score: number | null;
  v1Grade: string | null;

  v2Score: number | null;
  uncappedGrade: string | null;
  finalGrade: string | null;
  capReason: ReadonlyArray<string>;

  growth: number | null;
  growthConfidence: number | null;
  growthCoverage: number;
  demand: number | null;
  demandConfidence: number | null;
  location: number | null;
  yieldScore: number | null;
  risk: number | null;

  evidenceCoverage: number;
  measuredDimensions: number;
  /** Providers behind the market evidence, for the provenance column. */
  providers: ReadonlyArray<string>;
}

export interface BacktestDistributions {
  gradeCounts: Readonly<Record<string, number>>;
  stateCounts: Readonly<Record<string, number>>;
  dwellingCounts: Readonly<Record<string, number>>;
  /** Ten-point buckets, `0-9` … `90-100`. */
  scoreHistogram: Readonly<Record<string, number>>;
  aCount: number;
  aPlusCount: number;
  /** A/A+ by state, the §48 shape. */
  topGradesByState: Readonly<Record<string, number>>;
  coverageHistogram: Readonly<Record<string, number>>;
  providerCounts: Readonly<Record<string, number>>;
}

export interface BiggestMover {
  reportId: string;
  v1Score: number;
  v2Score: number;
  delta: number;
  /** Whether the move came with a change in how much evidence was available. */
  evidenceCoverage: number;
}

export type DiagnosticSeverity = 'info' | 'attention' | 'serious';

export interface Diagnostic {
  key: string;
  severity: DiagnosticSeverity;
  finding: string;
  /** The measurement behind it, so the reading can be checked. */
  measurement: string;
}

export interface BacktestReport {
  scored: number;
  unresolved: number;
  rows: ReadonlyArray<BacktestRow>;
  distributions: BacktestDistributions;
  biggestMovers: ReadonlyArray<BiggestMover>;
  diagnostics: ReadonlyArray<Diagnostic>;
}

export interface BacktestCase {
  input: HistoricalBacktestInput;
  /** The market evidence for this property's suburb. Null when none was found. */
  evidence: MarketEvidence | null;
}

const bucket = (n: number) => `${Math.min(90, Math.floor(n / 10) * 10)}-${Math.min(99, Math.floor(n / 10) * 10 + 9)}`;
const tally = (map: Record<string, number>, key: string | null) => {
  const k = key ?? '(unknown)';
  map[k] = (map[k] ?? 0) + 1;
};

/**
 * Score one case.
 *
 * Returns null when there is no market evidence — the row is unresolved, not
 * zero-scored, because a property we could not find evidence for is not a
 * property that performed badly.
 */
export function scoreCase(c: BacktestCase, now: Date): { row: BacktestRow; result: ShadowScoreResult } | null {
  if (!c.evidence) return null;
  const i = c.input;

  const result = scoreInvestmentV2Shadow({
    evidence: c.evidence,
    yieldInputs: {
      basis: 'purchase',
      basisAmount: i.purchasePrice.value,
      weeklyRent: i.weeklyRent.value,
      annualOutgoings: i.annualOutgoings.value,
      weeklyCashFlow: i.weeklyCashFlow.value,
    },
    locationInputs: {
      walkScore: i.walkScore.value,
      commuteTimeCBD: i.commuteTimeCBD.value,
      schoolsNearby: i.schoolsNearby.value,
    },
    propertyRisk: {
      // The stored type SELECTS the risk schema; the record holds no answered
      // property-risk questions, so Model D reports observations (none) and
      // withholds the dimension rather than renormalising.
      propertyType: i.dwellingType.value,
      answers: {},
      growth1Year: c.evidence.growth1Year?.value ?? null,
    },
    finance: {
      lvr: i.lvr.value,
      weeklyCashFlow: i.weeklyCashFlow.value,
      purchasePrice: i.purchasePrice.value,
    },
    audience: 'internal',
    now,
  });

  return {
    result,
    row: {
      reportId: i.reportId,
      state: i.state.value,
      suburb: i.suburb.value,
      dwellingType: i.dwellingType.value,
      v1Score: i.existingScore.value,
      v1Grade: i.existingGrade.value,
      v2Score: result.compositeScore,
      uncappedGrade: result.uncappedGrade,
      finalGrade: result.grade,
      capReason: result.gradeCapReason,
      growth: result.growth.score,
      growthConfidence: result.growth.confidence.score,
      growthCoverage: result.growth.weightCovered,
      demand: result.demand.score,
      demandConfidence: result.demand.confidence.score,
      location: result.location.score,
      yieldScore: result.yieldResult.score,
      risk: result.risk.score,
      evidenceCoverage: result.evidenceCoverage,
      measuredDimensions: result.measured.length,
      providers: [...new Set(c.evidence.providersConsulted)],
    },
  };
}

/**
 * Run the harness over a set of cases.
 *
 * Hand it cases with real evidence and it reports; hand it none and it says
 * so. It will not invent a snapshot to fill the corpus.
 */
export function runBacktest(cases: ReadonlyArray<BacktestCase>, now: Date = new Date()): BacktestReport {
  const rows: BacktestRow[] = [];
  const results: ShadowScoreResult[] = [];
  let unresolved = 0;

  for (const c of cases) {
    const scored = scoreCase(c, now);
    if (!scored) { unresolved += 1; continue; }
    rows.push(scored.row);
    results.push(scored.result);
  }

  return {
    scored: rows.length,
    unresolved,
    rows,
    distributions: buildDistributions(rows),
    biggestMovers: biggestMovers(rows),
    diagnostics: diagnose(rows),
  };
}

export function buildDistributions(rows: ReadonlyArray<BacktestRow>): BacktestDistributions {
  const gradeCounts: Record<string, number> = {};
  const stateCounts: Record<string, number> = {};
  const dwellingCounts: Record<string, number> = {};
  const scoreHistogram: Record<string, number> = {};
  const topGradesByState: Record<string, number> = {};
  const coverageHistogram: Record<string, number> = {};
  const providerCounts: Record<string, number> = {};
  let aCount = 0, aPlusCount = 0;

  for (const r of rows) {
    tally(gradeCounts, r.finalGrade);
    tally(stateCounts, r.state);
    tally(dwellingCounts, r.dwellingType);
    if (r.v2Score !== null) tally(scoreHistogram, bucket(r.v2Score));
    tally(coverageHistogram, bucket(Math.round(r.evidenceCoverage * 100)));
    for (const p of r.providers) tally(providerCounts, p);
    if (r.finalGrade === 'A') aCount += 1;
    if (r.finalGrade === 'A+') { aPlusCount += 1; }
    if (r.finalGrade === 'A' || r.finalGrade === 'A+') tally(topGradesByState, r.state);
  }

  return {
    gradeCounts, stateCounts, dwellingCounts, scoreHistogram,
    aCount, aPlusCount, topGradesByState, coverageHistogram, providerCounts,
  };
}

/** The twenty largest V1→V2 movements, largest first. */
export function biggestMovers(rows: ReadonlyArray<BacktestRow>, limit = 20): BiggestMover[] {
  return rows
    .filter((r): r is BacktestRow & { v1Score: number; v2Score: number } =>
      r.v1Score !== null && r.v2Score !== null)
    .map((r) => ({
      reportId: r.reportId, v1Score: r.v1Score, v2Score: r.v2Score,
      delta: r.v2Score - r.v1Score, evidenceCoverage: r.evidenceCoverage,
    }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, limit);
}

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const stdev = (v: number[]) => {
  const m = mean(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length);
};

/**
 * The nine calibration checks.
 *
 * Reports only. None of these alters a score, and none should be turned into
 * an automatic penalty — a distribution that looks wrong is a question for an
 * operator, and silently correcting it would hide exactly the finding that
 * makes the question worth asking.
 */
export function diagnose(rows: ReadonlyArray<BacktestRow>): Diagnostic[] {
  const out: Diagnostic[] = [];
  const scored = rows.filter((r): r is BacktestRow & { v2Score: number } => r.v2Score !== null);
  if (scored.length === 0) {
    return [{
      key: 'no_scored_rows', severity: 'info',
      finding: 'Nothing was scored, so no distribution can be read.',
      measurement: `${rows.length} rows in, 0 with a composite score.`,
    }];
  }

  const scores = scored.map((r) => r.v2Score);
  const d = buildDistributions(scored);
  const top = scored.filter((r) => r.finalGrade === 'A' || r.finalGrade === 'A+');

  // 1. One state dominating the top grades — the §48 shape.
  if (top.length >= 5) {
    const byState = Object.entries(d.topGradesByState).sort((a, b) => b[1] - a[1]);
    const [leadState, leadCount] = byState[0];
    const share = leadCount / top.length;
    const stateShare = (d.stateCounts[leadState] ?? 0) / scored.length;
    if (share > 0.6 && share > stateShare * 1.5) {
      out.push({
        key: 'state_domination', severity: 'serious',
        finding: `${leadState} holds a disproportionate share of the top grades. This is the shape audit §48 `
          + 'recorded, where a regional figure stood in for a local one.',
        measurement: `${leadCount} of ${top.length} A/A+ (${(share * 100).toFixed(0)}%) are in ${leadState}, `
          + `which is ${(stateShare * 100).toFixed(0)}% of the scored corpus.`,
      });
    }
  }

  // 2. One dimension dominating the composite.
  const dims: Array<[DimensionKey, Array<number | null>]> = [
    ['growth', scored.map((r) => r.growth)],
    ['demand', scored.map((r) => r.demand)],
    ['location', scored.map((r) => r.location)],
    ['yield', scored.map((r) => r.yieldScore)],
    ['risk', scored.map((r) => r.risk)],
  ];
  for (const [key, values] of dims) {
    const present = values.filter((v): v is number => v !== null);
    if (present.length < scored.length * 0.5) continue;
    const contribution = stdev(present) * COMPOSITE_WEIGHTS[key];
    const total = dims.reduce((s, [k, vs]) => {
      const p = vs.filter((v): v is number => v !== null);
      return s + (p.length ? stdev(p) * COMPOSITE_WEIGHTS[k] : 0);
    }, 0);
    if (total > 0 && contribution / total > 0.6) {
      out.push({
        key: `dimension_domination_${key}`, severity: 'attention',
        finding: `${key} accounts for most of the variation between properties. The composite is close to a `
          + `restatement of one dimension.`,
        measurement: `${key} contributes ${((contribution / total) * 100).toFixed(0)}% of the weighted spread.`,
      });
    }
  }

  // 3 & 4. Compression and inflation.
  const sd = stdev(scores);
  if (sd < 8) {
    out.push({
      key: 'compression', severity: 'attention',
      finding: 'Scores are tightly clustered; the scale is not separating properties.',
      measurement: `standard deviation ${sd.toFixed(1)} points across ${scored.length} properties.`,
    });
  }
  const m = mean(scores);
  if (m > 72) {
    out.push({
      key: 'inflation', severity: 'attention',
      finding: 'The average property is scoring near the A threshold.',
      measurement: `mean ${m.toFixed(1)}, with A at 75.`,
    });
  }

  // 5. Everything in one grade.
  const gradeEntries = Object.entries(d.gradeCounts).sort((a, b) => b[1] - a[1]);
  if (gradeEntries.length > 0 && gradeEntries[0][1] / scored.length > 0.6) {
    out.push({
      key: 'single_grade_collapse', severity: 'serious',
      finding: `Most properties receive the same grade, so the grade carries little information.`,
      measurement: `${gradeEntries[0][1]} of ${scored.length} are ${gradeEntries[0][0]}.`,
    });
  }

  // 6. A/A+ awarded on low confidence.
  const lowConfidenceTop = top.filter((r) => (r.growthConfidence ?? 0) < 45);
  if (lowConfidenceTop.length > 0) {
    out.push({
      key: 'top_grade_low_confidence', severity: 'serious',
      finding: 'Top grades were awarded where growth confidence is low. The eligibility ceiling should have '
        + 'prevented this, so either a threshold or the ceiling itself needs review.',
      measurement: `${lowConfidenceTop.length} of ${top.length} A/A+ have growth confidence below 45.`,
    });
  }

  // 7. A high score resting on one extraordinary year.
  const oneYearDriven = scored.filter((r) =>
    r.v2Score >= 75 && r.growthCoverage > 0 && r.growthCoverage <= 0.25);
  if (oneYearDriven.length > 0) {
    out.push({
      key: 'single_horizon_highs', severity: 'attention',
      finding: 'High scores rest on a single growth horizon rather than a sustained record.',
      measurement: `${oneYearDriven.length} properties score 75+ with a quarter or less of the growth `
        + 'methodology measured.',
    });
  }

  // 8. A high score resting mainly on renormalisation.
  const renormDriven = scored.filter((r) => r.v2Score >= 75 && r.evidenceCoverage < 0.55);
  if (renormDriven.length > 0) {
    out.push({
      key: 'renormalisation_highs', severity: 'serious',
      finding: 'High scores were produced by renormalising a minority of the evidence to full weight — the '
        + 'exact mechanism behind every A+ in the §48 backtest.',
      measurement: `${renormDriven.length} properties score 75+ on under 55% evidence coverage.`,
    });
  }

  // 9. Movement driven by data availability rather than performance.
  const movers = biggestMovers(scored, scored.length)
    .filter((x) => Math.abs(x.delta) >= 10);
  if (movers.length >= 5) {
    const lowCoverage = movers.filter((x) => x.evidenceCoverage < 0.6).length;
    if (lowCoverage / movers.length > 0.6) {
      out.push({
        key: 'availability_driven_movement', severity: 'attention',
        finding: 'The largest score changes are concentrated in properties with the least evidence, which '
          + 'suggests the movement reflects what could be measured rather than how the property performed.',
        measurement: `${lowCoverage} of ${movers.length} moves of 10+ points are on under 60% coverage.`,
      });
    }
  }

  if (out.length === 0) {
    out.push({
      key: 'no_findings', severity: 'info',
      finding: 'No calibration concern was detected in this distribution.',
      measurement: `${scored.length} properties, mean ${m.toFixed(1)}, standard deviation ${sd.toFixed(1)}.`,
    });
  }
  return out;
}
