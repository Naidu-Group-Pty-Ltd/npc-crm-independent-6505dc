/**
 * Chart integrity arbitration — decides whether a reconstructed chart may be
 * rendered natively, or must fall back to its source crop.
 *
 * WHY A GATE AT ALL
 * -----------------
 * `chartPreservation.pure.ts` has always said charts are source truth, preserved
 * by rendering the exact source crop and "never by rebuilding bars, axes,
 * legends or labels". That was the correct position while nothing could PROVE a
 * reconstruction right. It is not an argument against reconstruction; it is an
 * argument against unverified reconstruction, and this module is what supplies
 * the verification the prohibition was standing in for.
 *
 * The stakes are asymmetric and worth stating plainly. These documents are
 * borrowing-capacity snapshots, cash-flow projections and valuation reports. A
 * chart that is a picture is inert — a reader sees an image and reads the
 * numbers printed on it. A chart that has been rebuilt with a misread bar height
 * is worse than useless: it looks authoritative, it is editable, and it is
 * wrong. So a chart earns native rendering by proving itself, and the failure
 * mode of every check below is "fall back to the crop", never "ship it anyway".
 *
 * MODELLED ON THE TABLE PRECEDENT
 * -------------------------------
 * `table_candidates.py` / `table_integrity.py` solved this exact problem for
 * tables and the pattern is proven here: immutable source evidence, candidates
 * scored against it, hard defects that veto absolutely, and four render modes of
 * which only one is native. Their governing rule is copied verbatim in spirit:
 *
 *   SOURCE FIDELITY OUTRANKS EDITABILITY.
 *   A WEIGHTED SCORE MAY NEVER OVERRIDE A HARD DEFECT.
 *
 * Pure: no I/O, no DOM, no model access. Deterministic for a given input.
 */

export const CHART_ARBITRATION_VERSION = 'chart-arbitration-v1';

/**
 * Minimum coefficient of determination for the axis scale fit.
 *
 * An axis is linear by construction, so a good tick-to-value fit is very nearly
 * exact. Anything below this means the tick labels were paired with the wrong
 * positions, or the axis is not linear at all (a log axis fits a straight line
 * badly) — either way the derived values are not trustworthy.
 */
export const AXIS_SCALE_MIN_R2 = 0.999;

/** Minimum tick pairs needed to fit a scale at all. Two points always fit. */
export const AXIS_SCALE_MIN_TICKS = 3;

/**
 * How far a geometrically-derived value may sit from a printed data label,
 * as a fraction of the printed value.
 *
 * Where a chart prints its numbers, those numbers are source truth and the
 * geometry must agree with them.
 */
export const VALUE_LABEL_TOLERANCE = 0.005;

/**
 * Absolute floor on that tolerance, as a fraction of the smallest axis tick.
 *
 * Needed because a purely relative tolerance underflows near zero: 0.5% of a
 * printed 2 is 0.01, which is below what reading a position off a chart can
 * resolve. The floor absorbs that quantisation and nothing more.
 *
 * It is deliberately small. An earlier draft used HALF a tick interval, which
 * on an axis ticked every 25 units permits a bar to be misread by 12.5 — a 25%
 * error on a value of 50, waved through. Pixel quantisation at 300 DPI is
 * nowhere near that coarse, so the floor should reflect measurement precision,
 * not tick spacing.
 */
export const TICK_TOLERANCE_FRACTION = 0.05;

export type ChartRenderModeV2 =
  | 'verified-native-chart'
  | 'native-with-source-reference'
  | 'chart-source-crop'
  | 'containment-fallback';

/**
 * Hard defects. Each is an ABSOLUTE veto on native rendering — no score, no
 * combination of other signals, and no configuration overrides one.
 */
export const CHART_HARD_DEFECT_CODES = [
  'source_chart_crop_missing',
  'source_chart_evidence_incomplete',
  'chart_type_unknown',
  'series_empty',
  'axis_scale_underdetermined',
  'axis_scale_nonlinear',
  'axis_r2_below_floor',
  'value_label_disagreement',
  'numeric_token_unaccounted',
  'series_count_mismatch',
  'category_count_mismatch',
  'non_finite_value',
] as const;
export type ChartHardDefectCode = (typeof CHART_HARD_DEFECT_CODES)[number];

export interface ChartAxisScale {
  kind: 'linear' | 'log' | 'unknown';
  tickCount: number;
  r2: number | null;
}

export interface ChartValueLabelPair {
  /** Value derived from geometry (bar height, wedge angle, vertex position). */
  derived: number;
  /** Value printed on the chart next to that mark. Source truth. */
  printed: number;
}

export interface ChartCandidateEvidence {
  chartType: string | null;
  detectionMethod?: string;
  /** Present when a 300 DPI crop was cut for this region. */
  hasCrop: boolean;
  /** Extracted series. Empty means nothing was reconstructed. */
  series: Array<{ label: string; value: number }>;
  axisScale: ChartAxisScale | null;
  /** Geometry-vs-printed-label pairs, where the chart prints its numbers. */
  valueLabelPairs: ChartValueLabelPair[];
  /** Smallest gap between axis ticks, used to floor the value tolerance. */
  smallestTickInterval?: number | null;
  /**
   * Numeric tokens found inside the chart region that the extractor could NOT
   * explain as an axis tick, data label, legend entry or caption. An
   * unexplained number means the chart was not understood.
   */
  unaccountedNumericTokens: string[];
  /** Series/category counts the detector expected, when it stated them. */
  expectedSeriesCount?: number | null;
  expectedCategoryCount?: number | null;
}

export interface ChartArbitrationResult {
  version: string;
  renderMode: ChartRenderModeV2;
  defects: ChartHardDefectCode[];
  manualReviewRequired: boolean;
  /** True only when every check passed AND printed labels corroborated it. */
  crossValidated: boolean;
  axisScaleR2: number | null;
}

const KNOWN_CHART_TYPES = new Set([
  'bar', 'stacked-bar', 'stacked_bar', 'line', 'area', 'pie', 'donut', 'scatter', 'radar',
]);

function tolerance(printed: number, smallestTick: number | null | undefined): number {
  const relative = Math.abs(printed) * VALUE_LABEL_TOLERANCE;
  const tickFloor = smallestTick != null && Number.isFinite(smallestTick)
    ? Math.abs(smallestTick) * TICK_TOLERANCE_FRACTION
    : 0;
  return Math.max(relative, tickFloor);
}

/**
 * Arbitrate one chart candidate.
 *
 * Returns the render mode plus every defect found — all of them, not just the
 * first, so review can see the full picture rather than playing whack-a-mole
 * through repeated imports.
 */
export function arbitrateChart(evidence: ChartCandidateEvidence): ChartArbitrationResult {
  const defects: ChartHardDefectCode[] = [];

  // Without a crop there is nothing to fall back TO, which makes this the one
  // defect that changes the fallback rather than just blocking native.
  if (!evidence.hasCrop) defects.push('source_chart_crop_missing');

  const normalizedType = (evidence.chartType ?? '').trim().toLowerCase().replace(/_/g, '-');
  if (!normalizedType || !KNOWN_CHART_TYPES.has(normalizedType) || normalizedType === 'unknown') {
    // 'combo' and anything unrecognised land here: if the extractor cannot name
    // the chart it certainly cannot decompose it.
    defects.push('chart_type_unknown');
  }

  if (!evidence.series.length) defects.push('series_empty');
  if (evidence.series.some((s) => !Number.isFinite(s.value))) defects.push('non_finite_value');

  // Axis scale. Pie and donut derive value from subtended angle, which needs no
  // axis, so they are exempt — everything else must have a calibrated scale.
  const needsAxis = normalizedType !== 'pie' && normalizedType !== 'donut';
  if (needsAxis) {
    const scale = evidence.axisScale;
    if (!scale || scale.kind === 'unknown' || scale.tickCount < AXIS_SCALE_MIN_TICKS) {
      defects.push('axis_scale_underdetermined');
    } else if (scale.kind !== 'linear') {
      // A log axis silently linearised produces plausible, wrong numbers.
      defects.push('axis_scale_nonlinear');
    } else if (scale.r2 == null || scale.r2 < AXIS_SCALE_MIN_R2) {
      defects.push('axis_r2_below_floor');
    }
  }

  // The check that protects financial correctness. Where a chart prints a
  // number, that number is truth and the geometry must agree.
  //
  // ONE disagreement anywhere vetoes the WHOLE chart, not the offending series.
  // A chart with one wrong bar is more dangerous than a chart that is an image,
  // because the rest of it being right is what makes the wrong part credible.
  const disagreed = evidence.valueLabelPairs.some(
    (p) => Math.abs(p.derived - p.printed) > tolerance(p.printed, evidence.smallestTickInterval),
  );
  if (disagreed) defects.push('value_label_disagreement');

  if (evidence.unaccountedNumericTokens.length > 0) defects.push('numeric_token_unaccounted');

  if (evidence.expectedSeriesCount != null
    && evidence.expectedSeriesCount > 0
    && evidence.series.length !== evidence.expectedSeriesCount) {
    defects.push('series_count_mismatch');
  }
  if (evidence.expectedCategoryCount != null
    && evidence.expectedCategoryCount > 0
    && evidence.series.length !== evidence.expectedCategoryCount) {
    defects.push('category_count_mismatch');
  }

  const axisScaleR2 = evidence.axisScale?.r2 ?? null;

  if (defects.length > 0) {
    return {
      version: CHART_ARBITRATION_VERSION,
      // No crop means the crop fallback is unavailable too — drop to E0.
      renderMode: evidence.hasCrop ? 'chart-source-crop' : 'containment-fallback',
      defects,
      manualReviewRequired: false,
      crossValidated: false,
      axisScaleR2,
    };
  }

  // Clean, but was it CORROBORATED? A chart that prints no numbers gives the
  // geometry nothing to be checked against. The reconstruction may well be
  // right, and it is still not proven, so it renders natively but is flagged
  // for sign-off and keeps its crop alongside.
  const crossValidated = evidence.valueLabelPairs.length > 0;

  return {
    version: CHART_ARBITRATION_VERSION,
    renderMode: crossValidated ? 'verified-native-chart' : 'native-with-source-reference',
    defects: [],
    manualReviewRequired: !crossValidated,
    crossValidated,
    axisScaleR2,
  };
}

/** True when the mode renders an editable chart object rather than pixels. */
export function isNativeChartMode(mode: ChartRenderModeV2): boolean {
  return mode === 'verified-native-chart' || mode === 'native-with-source-reference';
}
