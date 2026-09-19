/**
 * Is this picture a chart? — decided from geometry the import already holds.
 *
 * WHAT PRODUCTION SAYS
 * --------------------
 * Across 245 imports and 76 stored templates:
 *
 *     text overlays          18,148
 *     vector overlays         5,741
 *     image overlays          1,226   ← 1,111 of them named "[image]"
 *     table overlays            610
 *     chart overlays              0
 *
 * Not one chart, ever. Four independent reasons, any one sufficient:
 *
 *   1. The source scene graph never runs — 0 of 84 jobs produced a
 *      `source_scene*` artifact — and `chart_candidates.py` is imported only by
 *      `source_scene_graph.py`, so the sidecar's chart arithmetic has never
 *      executed on a production document.
 *   2. `loadSourceChartsByPage` therefore always returns `{}`, so
 *      `promotePicturesToCharts` no-ops on every import.
 *   3. Docling's picture classifier runs only on the `design_heavy` lane —
 *      **2 of 84 jobs**. That is exactly why 1,111 of 1,226 images are named
 *      `[image]`: that string is the fallback for no alt text, no caption AND
 *      no picture class.
 *   4. `chartNativeEnabled` is false unless an env var says otherwise, so
 *      containment would crop a chart even if one arrived.
 *
 * WHAT THIS MODULE DOES
 * ---------------------
 * The detection signal the scene graph would have supplied is recoverable from
 * what an import ALREADY produces: 5,741 vector overlays carry the page's real
 * geometry, and every axis tick and value label is a measured text overlay.
 * So a picture can be classified as chart-like with no sidecar change, no model
 * and no extra cost.
 *
 * It classifies and nothing more. **It never reads a value off a chart.** A
 * misread number entering a client's financial report is this programme's stated
 * top risk, and a classification cannot misstate a figure. What it produces is:
 *
 *   - alternative text for a figure that had none — **0 of 1,226** imported
 *     images carry `alt` today, because Stage 2's fallback to a picture class
 *     can never fire while the classifier is off;
 *   - a layer name a designer can find;
 *   - the evidence any future native chart would have to be gated on.
 *
 * It returns null rather than guessing. A picture wrongly labelled "Bar chart"
 * puts a false description into a tagged PDF, which is worse than the honest
 * absence it replaces.
 *
 * Pure and deterministic: no DOM, no fetch, no clock.
 */

export const CHART_CANDIDATE_VERSION = 'chart-candidate-v1';

export type ChartCandidateKind = 'bar' | 'line' | 'pie' | 'unknown';

export interface ChartCandidateEvidence {
  /** Vector overlays whose box sits inside the picture. */
  vectorsInside: number;
  /** Of those, ones shaped like a plotted bar — a filled rectangle in a row. */
  barLikeVectors: number;
  /** Long, thin vectors along the picture's edges: axes and gridlines. */
  axisLikeVectors: number;
  /** Text overlays inside the picture that read as numbers. */
  numericLabels: number;
  /** Text overlays inside the picture, numeric or not. */
  labelsInside: number;
  /** Bar-like vectors sharing a baseline — the row a bar chart plots along. */
  sharedBaselineBars: number;
}

export interface ChartCandidate {
  version: typeof CHART_CANDIDATE_VERSION;
  kind: ChartCandidateKind;
  /** 0..1. A ranking of how much evidence agreed, never a probability. */
  confidence: number;
  evidence: ChartCandidateEvidence;
}

export interface CandidateBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CandidateVector extends CandidateBox {
  /** Path `d` strings, when available — a wedge reads differently from a bar. */
  paths?: readonly string[];
}

export interface CandidateLabel extends CandidateBox {
  text?: string;
}

/** A picture smaller than this is an icon or a rule, not a chart. */
export const MIN_CHART_AREA_PT2 = 4_000;
/** Below this many plotted marks there is no chart to speak of. */
export const MIN_PLOTTED_MARKS = 3;
/** A vector this much longer than it is thick is a line, not a mark. */
export const AXIS_ASPECT_RATIO = 12;
/** Share of the picture's span a vector must cross to read as an axis. */
export const AXIS_SPAN_SHARE = 0.6;
/** Vertical tolerance, in points, for two bars sharing a baseline. */
export const BASELINE_TOLERANCE_PT = 1.5;
/** Confidence below which a candidate is not reported at all. */
export const MIN_REPORTED_CONFIDENCE = 0.5;

function area(box: CandidateBox): number {
  return Math.max(0, box.width) * Math.max(0, box.height);
}

/** `inner` sits within `outer` when most of it does — a bar may overhang an axis. */
function isInside(inner: CandidateBox, outer: CandidateBox, share = 0.8): boolean {
  const left = Math.max(inner.x, outer.x);
  const right = Math.min(inner.x + inner.width, outer.x + outer.width);
  const top = Math.max(inner.y, outer.y);
  const bottom = Math.min(inner.y + inner.height, outer.y + outer.height);
  if (right <= left || bottom <= top) return false;
  const overlap = (right - left) * (bottom - top);
  const own = area(inner);
  if (own <= 0) return false;
  return overlap / own >= share;
}

function usable(box: unknown): box is CandidateBox {
  const b = box as CandidateBox | null;
  return !!b && Number.isFinite(b.x) && Number.isFinite(b.y)
    && Number.isFinite(b.width) && Number.isFinite(b.height)
    && b.width > 0 && b.height > 0;
}

/**
 * Does this text read as a number a chart would print?
 *
 * Currency, percentages, thousands separators and plain decimals all count; a
 * year does too, because an axis of years is an axis. A word does not.
 */
export function readsAsNumber(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 24) return false;
  return /^[$€£¥]?\s?-?\d[\d,. ]*\s?[%kKmMbB]?$/.test(trimmed);
}

/** A wedge path — the `A` (arc) command a pie slice is drawn with. */
function looksLikeWedge(paths: readonly string[] | undefined): boolean {
  if (!paths?.length) return false;
  return paths.some((d) => typeof d === 'string' && /[Aa]\s*[\d.]/.test(d) && /[Zz]\s*$/.test(d.trim()));
}

/**
 * Classify one picture from the page geometry around it.
 *
 * `vectors` and `labels` are every vector and text overlay on the SAME page;
 * this selects the ones that fall inside the picture itself.
 */
export function detectChartCandidate(
  picture: CandidateBox | null | undefined,
  vectors: readonly CandidateVector[] | null | undefined,
  labels: readonly CandidateLabel[] | null | undefined,
): ChartCandidate | null {
  if (!usable(picture)) return null;
  // An icon is not a chart, and neither is a rule. This is the first gate
  // because it removes most of the page before any shape analysis runs.
  if (area(picture) < MIN_CHART_AREA_PT2) return null;

  const inside = (Array.isArray(vectors) ? vectors : []).filter((v) => usable(v) && isInside(v, picture));
  const insideLabels = (Array.isArray(labels) ? labels : []).filter((l) => usable(l) && isInside(l, picture));

  let barLike = 0;
  let axisLike = 0;
  let wedges = 0;
  const barBaselines: number[] = [];

  for (const vector of inside) {
    const long = Math.max(vector.width, vector.height);
    const thin = Math.min(vector.width, vector.height);
    const aspect = thin > 0 ? long / thin : Number.POSITIVE_INFINITY;
    const spansPicture = vector.width >= picture.width * AXIS_SPAN_SHARE
      || vector.height >= picture.height * AXIS_SPAN_SHARE;

    if (looksLikeWedge(vector.paths)) { wedges += 1; continue; }
    // An axis or gridline: long, thin, and crossing most of the plot.
    if (aspect >= AXIS_ASPECT_RATIO && spansPicture) { axisLike += 1; continue; }
    // A plotted bar: a filled rectangle that is not a hairline and does not
    // span the whole plot.
    if (aspect < AXIS_ASPECT_RATIO && !spansPicture && area(vector) > 0) {
      barLike += 1;
      barBaselines.push(vector.y + vector.height);
    }
  }

  // Bars in a chart stand on one baseline. Marks scattered at unrelated
  // vertical positions are a diagram, not a plot.
  let sharedBaselineBars = 0;
  for (const baseline of barBaselines) {
    const cohort = barBaselines.filter((other) => Math.abs(other - baseline) <= BASELINE_TOLERANCE_PT).length;
    sharedBaselineBars = Math.max(sharedBaselineBars, cohort);
  }

  const numericLabels = insideLabels.filter((l) => readsAsNumber(l.text)).length;
  const evidence: ChartCandidateEvidence = {
    vectorsInside: inside.length,
    barLikeVectors: barLike,
    axisLikeVectors: axisLike,
    numericLabels,
    labelsInside: insideLabels.length,
    sharedBaselineBars,
  };

  // ── scoring ────────────────────────────────────────────────────────────────
  // Each signal is worth a fixed amount and they simply add. A weighted model
  // would imply a precision this evidence does not have, and the only decision
  // downstream is "call it a chart in the alt text or say nothing".
  let kind: ChartCandidateKind = 'unknown';
  let score = 0;

  if (wedges >= 2) {
    kind = 'pie';
    score = 0.6 + Math.min(0.2, wedges * 0.05);
  } else if (sharedBaselineBars >= MIN_PLOTTED_MARKS) {
    kind = 'bar';
    score = 0.55 + Math.min(0.2, sharedBaselineBars * 0.03);
  } else if (axisLike >= 2 && inside.length >= MIN_PLOTTED_MARKS) {
    // Two axes and something plotted between them: a line or scatter plot.
    kind = 'line';
    score = 0.5;
  } else {
    return null;
  }

  // Numbers printed inside the picture are what separates a chart from a
  // decorative diagram of the same shape.
  if (numericLabels >= 2) score += 0.15;
  else if (numericLabels === 1) score += 0.05;
  if (axisLike >= 1 && kind !== 'pie') score += 0.05;

  const confidence = Math.min(1, Math.round(score * 100) / 100);
  if (confidence < MIN_REPORTED_CONFIDENCE) return null;

  return { version: CHART_CANDIDATE_VERSION, kind, confidence, evidence };
}

const KIND_LABELS: Readonly<Record<ChartCandidateKind, string>> = {
  bar: 'Bar chart',
  line: 'Line chart',
  pie: 'Pie chart',
  unknown: 'Chart',
};

/**
 * Alternative text for a detected chart.
 *
 * Deliberately says only what was detected. "Bar chart" is a true and useful
 * description; "Bar chart showing income rising to $186,000" would be a reading
 * of the data, which this module does not do and must never appear to.
 */
export function chartCandidateAltText(candidate: ChartCandidate | null | undefined): string | null {
  if (!candidate) return null;
  return KIND_LABELS[candidate.kind] ?? KIND_LABELS.unknown;
}
