/**
 * Choose a substitute font by MEASURED width, not by name alone.
 *
 * THE PROBLEM WITH NAME MATCHING
 * ------------------------------
 * `fontResolver` maps a PostScript name to a web font by regex, and when
 * nothing matches it returns `Helvetica, Arial, sans-serif`. That is a
 * reasonable guess about identity and says nothing about METRICS. A substitute
 * chosen this way can run 10% wide, and since the importer copies the source's
 * bbox verbatim, 10% wide is an overflowing text box.
 *
 * `_shared/typographyFidelity.pure.ts` already implements the right selection
 * rule — `resolveFontV2` accepts candidates carrying a measured
 * `totalAdvanceRatio` and rejects any outside tolerance. It has never been
 * callable from the importer for one reason: nothing measured the candidates.
 *
 * WHERE THE MEASUREMENT COMES FROM
 * --------------------------------
 * Two numbers, both real:
 *
 *   - the SOURCE width, now shipped per line as `item.source_measure`
 *     (`_page_text_lines` measured it all along and used to discard it);
 *   - the CANDIDATE width, from canvas `measureText` on the actual string.
 *
 * Neither is a table of invented per-family averages. A metrics table would be
 * fabricated numbers dressed as measurements, and in a document where a text
 * box either fits or does not, a plausible-looking wrong ratio is worse than no
 * ratio at all — it would drive a confident remedy in the wrong direction.
 *
 * The selection logic is pure and takes the measurer as an argument, so it is
 * testable without a browser and cannot silently fall back to guessing.
 */

/**
 * Measures the advance width of `text` in `family` at `sizePt`, in points.
 *
 * `fontWeight` matters more than it looks. Bold and semibold faces run several
 * percent wider than the regular of the same family, so measuring a semibold
 * heading at the default 400 under-states its natural width — and any spacing
 * derived from that difference comes out too large by exactly the amount the
 * weight was worth. Optional so existing callers and test doubles are unchanged.
 */
export type TextWidthMeasurer = (
  text: string,
  family: string,
  sizePt: number,
  fontWeight?: number | string,
) => number | null;

/**
 * How far a candidate's advance may sit from the source's before it is
 * rejected. Matches `resolveFontV2`'s own tolerance so the two agree about what
 * "metric-compatible" means.
 */
export const ADVANCE_TOLERANCE = 0.02;

export type FontResolutionState =
  | 'exact'
  | 'metric-compatible'
  | 'substituted-measured'
  | 'substituted-unmeasured';

export interface FontCandidate {
  family: string;
  /** True when the family is the source font itself, not a stand-in. */
  exact?: boolean;
}

export interface MetricChoice {
  family: string;
  state: FontResolutionState;
  /** Candidate width ÷ source width. 1 is a perfect metric match. */
  advanceRatio: number | null;
  reason: string;
}

/**
 * Pick the candidate whose measured advance is closest to the source's.
 *
 * An exact family match wins outright — it IS the source font, so no
 * measurement can improve on it. Otherwise the closest ratio wins, and the
 * result is labelled by how well it actually did:
 *
 *   - `metric-compatible`     within tolerance; safe to use as-is.
 *   - `substituted-measured`  outside tolerance, but the ratio is KNOWN, so the
 *                             reflow ladder can compensate for it precisely.
 *   - `substituted-unmeasured` nothing could be measured; the caller is on its
 *                             own, and the label says so rather than implying
 *                             a check that did not happen.
 *
 * Never throws. A measurer that fails or returns nonsense degrades the result's
 * honesty, never its safety.
 */
export function chooseMetricCompatibleFont(
  text: string,
  sourceWidthPt: number,
  candidates: readonly FontCandidate[],
  fontSizePt: number,
  measure: TextWidthMeasurer,
): MetricChoice {
  const fallback = candidates[0]?.family ?? 'Helvetica, Arial, sans-serif';

  const exact = candidates.find((c) => c.exact);
  if (exact) {
    return {
      family: exact.family,
      state: 'exact',
      advanceRatio: 1,
      reason: 'source_font_available',
    };
  }

  const usable = Number.isFinite(sourceWidthPt) && sourceWidthPt > 0
    && typeof text === 'string' && text.length > 0
    && Number.isFinite(fontSizePt) && fontSizePt > 0;
  if (!usable) {
    return {
      family: fallback,
      state: 'substituted-unmeasured',
      advanceRatio: null,
      reason: 'no_source_measurement',
    };
  }

  let best: { family: string; ratio: number } | null = null;
  for (const candidate of candidates) {
    let width: number | null;
    try {
      width = measure(text, candidate.family, fontSizePt);
    } catch {
      continue;
    }
    if (width == null || !Number.isFinite(width) || width <= 0) continue;
    const ratio = width / sourceWidthPt;
    if (!best || Math.abs(ratio - 1) < Math.abs(best.ratio - 1)) {
      best = { family: candidate.family, ratio };
    }
  }

  if (!best) {
    return {
      family: fallback,
      state: 'substituted-unmeasured',
      advanceRatio: null,
      reason: 'no_candidate_could_be_measured',
    };
  }

  // Epsilon so a ratio sitting exactly ON the tolerance counts as within it, as
  // documented. Without it `100 * (1 + 0.02)` is 102.00000000000001 and the
  // boundary case fails by float noise rather than by measurement.
  const within = Math.abs(best.ratio - 1) <= ADVANCE_TOLERANCE + 1e-9;
  return {
    family: best.family,
    state: within ? 'metric-compatible' : 'substituted-measured',
    advanceRatio: Math.round(best.ratio * 10000) / 10000,
    reason: within ? 'advance_within_tolerance' : 'closest_available_advance',
  };
}

/**
 * A canvas-backed measurer, for use where a browser exists.
 *
 * Returns null rather than a fabricated number when there is no canvas — the
 * caller then lands on `substituted-unmeasured`, which is the truth. Canvas
 * measures in CSS pixels; points are 3/4 of those.
 */
export function createCanvasMeasurer(): TextWidthMeasurer {
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    if (typeof document !== 'undefined') {
      ctx = document.createElement('canvas').getContext('2d');
    }
  } catch {
    ctx = null;
  }

  return (text, family, sizePt, fontWeight) => {
    if (!ctx) return null;
    try {
      const sizePx = sizePt * (96 / 72);
      // `font` is a shorthand: omitting the weight resets it to `normal`, so a
      // semibold heading was being measured as regular and came out narrower
      // than it renders.
      const weight = fontWeight != null && `${fontWeight}`.trim() ? `${fontWeight} ` : '';
      ctx.font = `${weight}${sizePx}px ${family}`;
      const width = ctx.measureText(text).width;
      if (!Number.isFinite(width) || width <= 0) return null;
      return width * (72 / 96);
    } catch {
      return null;
    }
  };
}
