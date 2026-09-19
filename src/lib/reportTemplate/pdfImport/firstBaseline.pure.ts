/**
 * Put a reconstructed text block's first baseline where the source put it.
 *
 * THE DEFECT
 * ----------
 * Every line of imported text sits LOW. Measured between the source PDF and the
 * WeasyPrint render of its reconstruction, across two pages and 21 matched
 * lines:
 *
 *     6.75pt labels      +2.5pt      10.12pt contact rows   +3.7pt
 *     7.12pt eyebrows    +2.6pt      12.75pt figures        +4.6pt
 *     7.88pt disclaimer  +4.1pt      34.50pt client name   +12.3pt
 *
 * The 12.3pt on `Masline Nyawo` reads as an outlier and is not one: divided by
 * its type size it is 0.357, and every other line in the main group is
 * 0.357–0.370. The drift is one constant, expressed in ems, on a page whose
 * type ranges over 5x. There is a single cause.
 *
 * WHY IT DRIFTS
 * -------------
 * Two definitions of "the top of the text" that are not the same thing.
 *
 * The importer places a block at the source item's box top, which is the top of
 * the INK — for capitals, the cap line. CSS then lays the first line out inside
 * a line box and puts its baseline a full ASCENT below the top, plus half the
 * leading. Ascent is a metric of the font, well above the cap line. So the text
 * lands lower than the source by
 *
 *     (lineHeight - (ascent + descent)) / 2 + ascent - capHeight        [em]
 *
 * which for SegoeUI-Semibold at the default 1.3 leading is 0.364em — against
 * 0.357–0.370 measured. The two groups that differ are explained by the same
 * expression: the disclaimer paragraphs carry the source's own wider leading
 * (1.62 → 0.524em predicted, 0.520–0.533 measured), and the Cinzel lockup has a
 * shorter ascent (0.256em predicted, 0.256 measured).
 *
 * THE CORRECTION
 * --------------
 * Stated that way it needs a cap height, which is a property of the glyphs
 * drawn and not knowable in general. Stated the other way round it needs
 * nothing of the sort — the source already reports where its baseline is
 * (`source_measure.lines[].baselineYPt`, v2), so place the box such that the
 * renderer's first baseline lands exactly there:
 *
 *     y = sourceBaselineY - firstBaselineOffset(...)
 *
 * No cap height, no assumption about which glyphs the line contains, and no
 * residual: it is the renderer's own formula solved for the box position.
 *
 * WHY THE FORMULA IS TRUSTED
 * --------------------------
 * It was measured, not read off a spec. Against WeasyPrint, using the exact
 * declaration set the production renderer emits — flex column, nowrap,
 * letter-spacing, weights, centred and left — over sizes 6.75–34.5pt and
 * leadings 1.0–1.6, the worst error was **0.0002pt**. `hhea` ascent and descent
 * are the metrics that fit; the OS/2 typo and win pairs do not.
 *
 * Pure and deterministic.
 */

/** A font's own vertical metrics, in em, as the sidecar reads them from hhea. */
export interface FontVerticalMetrics {
  /** hhea ascent ÷ unitsPerEm. Positive. */
  ascender: number;
  /** hhea descent ÷ unitsPerEm, as a MAGNITUDE. Positive. */
  descender: number;
}

/**
 * Distance from a text box's content top to the first line's baseline, in
 * points — the renderer's own line-box geometry.
 *
 * Returns null when the metrics or the type size cannot support the
 * calculation, so a caller can leave the box where it is rather than move it by
 * a number that means nothing.
 */
export function firstBaselineOffsetPt(
  metrics: FontVerticalMetrics | null | undefined,
  fontSizePt: number,
  lineHeight: number,
): number | null {
  const ascender = Number(metrics?.ascender);
  const descender = Number(metrics?.descender);
  const size = Number(fontSizePt);
  const leading = Number(lineHeight);
  if (!Number.isFinite(ascender) || ascender <= 0) return null;
  if (!Number.isFinite(descender) || descender < 0) return null;
  if (!Number.isFinite(size) || size <= 0) return null;
  if (!Number.isFinite(leading) || leading <= 0) return null;
  const halfLeading = (leading - (ascender + descender)) / 2;
  return (halfLeading + ascender) * size;
}

/**
 * Largest correction that can be a leading difference rather than a mistake.
 *
 * The real ones on this document run 0.26em to 0.53em. Two ems is far beyond
 * anything line-box geometry produces, so a value that big means the baseline
 * and the box describe different things — a line the geometry swept in from a
 * neighbouring item, say. Leaving the block where the source's own box put it
 * is the safe answer; moving it two ems on bad evidence is not.
 */
export const MAX_BASELINE_CORRECTION_EM = 2;

export interface BaselineAlignment {
  /** Corrected box top, in points. */
  y: number;
  /** How far the box moved. Negative moves it up, which is the usual case. */
  deltaPt: number;
}

/**
 * Move a box so the renderer's first baseline lands on the source's.
 *
 * Returns null — leave the box alone — when the source baseline is unknown (a
 * v1 artifact), the font's metrics are unknown (a substituted font we never
 * embedded), or the implied move is too large to be line-box geometry.
 */
export function alignBoxToSourceBaseline(
  boxTopPt: number,
  sourceBaselineYPt: number | null | undefined,
  metrics: FontVerticalMetrics | null | undefined,
  fontSizePt: number,
  lineHeight: number,
): BaselineAlignment | null {
  const baseline = Number(sourceBaselineYPt);
  const top = Number(boxTopPt);
  if (!Number.isFinite(baseline) || !Number.isFinite(top)) return null;
  const offset = firstBaselineOffsetPt(metrics, fontSizePt, lineHeight);
  if (offset == null) return null;
  const y = baseline - offset;
  const deltaPt = y - top;
  if (Math.abs(deltaPt) > MAX_BASELINE_CORRECTION_EM * Number(fontSizePt)) return null;
  return { y, deltaPt };
}
