/**
 * Reconcile a text overlay's geometry against the source it was measured from.
 *
 * THE DEFECT THIS ADDRESSES
 * -------------------------
 * The importer copies a text box's bbox verbatim from the source PDF, then
 * re-lays the text out in a DIFFERENT font — because the source font is almost
 * always a subset/CID program that cannot be embedded, so it is substituted by
 * name. A substitute that runs even 8% wide overflows a box sized for the
 * original. Nothing compensated, so the text clipped (in the editor) or spilled
 * (in the export). That is "text boxes are constricting their contents".
 *
 * WHY IT NEEDS A MEASUREMENT FROM THE SIDECAR
 * -------------------------------------------
 * A ratio needs two terms. The client knows what its substitute renders; only
 * the sidecar knows what the ORIGINAL occupied, and it now ships that as
 * `item.source_measure.measuredWidthPt`. Without it, "the box is right and the
 * font is wide" and "the box is wrong" are indistinguishable, and every remedy
 * would be a guess applied to a document a client reads.
 *
 * THE REMEDIES, IN ORDER OF HOW LITTLE THEY CHANGE
 * ------------------------------------------------
 * Ordered by visual destructiveness, because the goal is a page that matches the
 * source, not merely one where nothing overlaps:
 *
 *   1. Nothing — the substitute fits.
 *   2. Negative letter-spacing (tracking). Invisible at small corrections and
 *      preserves the type size the designer chose.
 *   3. Grow the box, but only into MEASURED empty space. Never over a sibling:
 *      moving text under a neighbour trades one defect for a worse one.
 *   4. Bounded font-size reduction, floored and capped, so a heading never
 *      visibly shrinks.
 *   5. Give up and say so, so the page can fall back to its source crop.
 *
 * Pure and deterministic. Emits a decision; applying it is the caller's job.
 */

/** Below this the substitute fits and nothing is done. */
export const FIT_TOLERANCE = 0.02;

/** Tracking may not tighten beyond this, in points, at any size. */
export const MAX_NEGATIVE_TRACKING_PT = 0.25;

/** Beyond this ratio, tracking alone would visibly cramp the text. */
export const MAX_TRACKING_RATIO = 1.04;

/** Beyond this, growing the box is preferred to shrinking the type. */
export const MAX_GROW_RATIO = 1.12;

/** Font size may never be reduced by more than this fraction. */
export const MAX_FONT_SHRINK = 0.04;

/** Absolute floor on font size, matching the repair pipeline's own bound. */
export const MIN_FONT_SIZE_PT = 6;

/**
 * Labels whose type size is not ours to change.
 *
 * A disclaimer or footnote often has a legally-required minimum size. Shrinking
 * one to resolve a layout problem is not a layout decision. These grow or fall
 * back instead.
 */
export const SIZE_LOCKED_LABELS = new Set(['footnote', 'disclaimer', 'legal', 'caption']);

export type ReflowRemedy =
  | 'none'
  | 'letter-spacing'
  | 'grow-box'
  | 'font-size'
  | 'source-crop-recommended';

export interface ReflowInput {
  /** Width the SOURCE text occupied, in points. From the sidecar. */
  sourceWidthPt: number;
  /** Width the substituted font renders the same text at, in points. */
  renderedWidthPt: number;
  /** The overlay's box width, in points. */
  boxWidthPt: number;
  /** Characters in the text — tracking is distributed across the gaps. */
  charCount: number;
  fontSizePt: number;
  /** Free space to the right before the nearest sibling, in points. */
  availableGrowthPt?: number;
  /** Semantic label, when known. Gates the font-size remedy. */
  label?: string;
}

export interface ReflowDecision {
  remedy: ReflowRemedy;
  /** Ratio of rendered to source width. >1 means the substitute runs wide. */
  ratio: number;
  /** Tracking to apply, in points. Always <= 0. */
  letterSpacingPt?: number;
  /** New box width, in points. */
  boxWidthPt?: number;
  /** New font size, in points. */
  fontSizePt?: number;
  /** Why this remedy, in terms a reviewer can check. */
  reason: string;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Decide how to make substituted text fit the box the source gave it.
 *
 * Never throws. Missing or nonsensical measurements produce `none` with a
 * stated reason rather than a remedy derived from a number that does not mean
 * what it appears to: doing nothing leaves a visible defect, while acting on a
 * bad measurement silently corrupts a page.
 */
export function reconcileTextReflow(input: ReflowInput): ReflowDecision {
  const { sourceWidthPt, renderedWidthPt, boxWidthPt, charCount, fontSizePt } = input;

  if (!Number.isFinite(sourceWidthPt) || sourceWidthPt <= 0) {
    return { remedy: 'none', ratio: 1, reason: 'no_source_measurement' };
  }
  if (!Number.isFinite(renderedWidthPt) || renderedWidthPt <= 0) {
    return { remedy: 'none', ratio: 1, reason: 'no_rendered_measurement' };
  }

  const ratio = renderedWidthPt / sourceWidthPt;

  // The substitute fits, or renders NARROWER than the source. A narrow
  // substitute is a fidelity difference, not an overflow, and stretching text
  // to fill a box it does not need would make the page worse.
  if (ratio <= 1 + FIT_TOLERANCE) {
    return { remedy: 'none', ratio: round3(ratio), reason: 'substitute_fits' };
  }

  const overflowPt = renderedWidthPt - Math.min(sourceWidthPt, boxWidthPt);

  // 1. Tracking. Distributed across the gaps BETWEEN characters, hence -1.
  if (ratio <= MAX_TRACKING_RATIO && charCount > 1) {
    const perGap = overflowPt / (charCount - 1);
    if (perGap <= MAX_NEGATIVE_TRACKING_PT) {
      return {
        remedy: 'letter-spacing',
        ratio: round3(ratio),
        letterSpacingPt: round3(-perGap),
        reason: 'tracking_within_bounds',
      };
    }
  }

  // 2. Grow the box, but only into space that was MEASURED as empty. Absent
  //    measurement means unknown, and unknown is not permission.
  const available = Number.isFinite(input.availableGrowthPt ?? NaN)
    ? Math.max(0, input.availableGrowthPt as number)
    : 0;
  if (ratio <= MAX_GROW_RATIO && available > 0) {
    const needed = renderedWidthPt - boxWidthPt;
    if (needed > 0 && needed <= available) {
      return {
        remedy: 'grow-box',
        ratio: round3(ratio),
        boxWidthPt: round3(boxWidthPt + needed),
        reason: 'grew_into_measured_free_space',
      };
    }
  }

  // 3. Shrink the type — last resort, and refused outright where the size is
  //    not ours to change.
  const label = (input.label ?? '').toLowerCase();
  if (!SIZE_LOCKED_LABELS.has(label)) {
    const wanted = fontSizePt / ratio;
    const floor = Math.max(MIN_FONT_SIZE_PT, fontSizePt * (1 - MAX_FONT_SHRINK));
    if (wanted >= floor && fontSizePt > MIN_FONT_SIZE_PT) {
      return {
        remedy: 'font-size',
        ratio: round3(ratio),
        fontSizePt: round3(Math.max(wanted, floor)),
        reason: 'bounded_font_reduction',
      };
    }
  }

  // 4. Nothing bounded can fix this. Say so, so the page can fall back to its
  //    source crop rather than shipping text that does not fit.
  return {
    remedy: 'source-crop-recommended',
    ratio: round3(ratio),
    reason: SIZE_LOCKED_LABELS.has(label)
      ? 'size_locked_label_cannot_shrink'
      : 'overflow_exceeds_all_bounded_remedies',
  };
}
