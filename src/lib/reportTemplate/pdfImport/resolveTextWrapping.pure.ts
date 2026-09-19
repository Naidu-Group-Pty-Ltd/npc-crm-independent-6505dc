/**
 * Decide whether an imported text overlay may wrap.
 *
 * THE TWO DEFECTS THIS SITS BETWEEN
 * ---------------------------------
 * Both are real, both were observed in production imports, and each is the
 * other's cure — which is why this is a decision module rather than a constant.
 *
 *   A. **Wrapping text that the source set on one line.** The importer copies a
 *      box's bbox from the source, then re-lays the text out in a SUBSTITUTED
 *      font that runs a few percent wider. One extra word falls to a second
 *      line, and that line lands on top of whatever sits below. This is the
 *      dominant overlap artifact in imported previews, and it is why
 *      `whiteSpace: 'nowrap'` was applied at all.
 *
 *   B. **Refusing to wrap text that the source set on TWO lines.** Docling
 *      joins a multi-line paragraph's lines with a SPACE, not a newline, so the
 *      string arrives looking single-line. Forced onto one line it does not
 *      run a few percent wide — it runs off the page. In the BC Snapshot
 *      render the cover title `BORROWING CAPACITY SNAPSHOT` (27.75pt in a
 *      386pt box) needed 519pt on one line: it left the page and was clipped,
 *      on the first page a client sees.
 *
 * WHAT DECIDES IT
 * ---------------
 * `source_measure.lineCount` — how many lines PyMuPDF actually found inside
 * this item's box in the source PDF. It is a count of drawn lines, not an
 * inference, so when it is present it settles the question outright:
 *
 *   - **≥ 2 → wrap.** The source itself broke this text. Reproducing that break
 *     is fidelity, not damage.
 *   - **= 1 → never wrap.** The source fit it on one line, so any overflow here
 *     is the substituted font being wide. Wrapping is the wrong remedy for
 *     that — `textReflowReconciliation.pure.ts` owns it, and it tightens
 *     tracking or shrinks the type rather than adding a line the source has no
 *     room for.
 *
 * `textAlign: 'justify'` is a second signal that costs no new plumbing and
 * reaches back further: the sidecar's `infer_alignment` only returns it from
 * two or more matched lines — three or more since `align-v2`. A single-line
 * item can never be inferred as justified either way, so a justified block is a
 * multi-line block whose newlines were joined away. That is what catches the
 * artifacts stored before `source_measure` existed.
 *
 * THE HAZARD IN THAT COUNT
 * ------------------------
 * A PyMuPDF "line" is not necessarily a STACKED line. Two runs set side by side
 * on one baseline are two line records, and the same cover proves it: the
 * footer `PRIVATE AND CONFIDENTIAL` and `REF 90E5DF34` sit at opposite ends of
 * the same 9pt-tall strip and count as two. Wrapping there would stack text the
 * source never stacked.
 *
 * From `source-measure-v2` the count of DISTINCT BASELINES settles it exactly,
 * and that is used when present. Before it, the box separates the cases,
 * because a box's height is INK EXTENT: one visual line spans at most about one
 * em, ascender to descender, while two stacked lines span a line advance plus a
 * cap height — a shade over 1.4em even set solid. On this cover the title
 * measures 1.65em and the side-by-side footer 1.33em, on either side of the
 * threshold with room to spare. So on a v1 artifact the line count says "more
 * than one line was drawn" and the box height says "and they were stacked";
 * wrapping needs both.
 *
 * WHEN THERE IS NO MEASUREMENT
 * ----------------------------
 * Older artifacts and the non-Docling ingestion path have neither. Two
 * heuristics stand in, in order:
 *
 *   - Box height. A box taller than ~1.6 line-heights held more than one line.
 *     Weak on its own: a two-line block of CAPITALS has no descenders, so its
 *     ink extent is nearer 1.65× the font size than 2× the line height — which
 *     is exactly how the cover title passed as single-line.
 *   - Measured natural width against the box. Deliberately blunt: substituted
 *     faces run wide by design, so the threshold has to clear normal
 *     substitution widening before it can mean "this was never one line".
 *
 * Pure and deterministic. No DOM, no fetch, no clock.
 */

import type { WidthMeasurer } from './detrackText.pure';

/**
 * Box height, as a multiple of one line height, above which the box is assumed
 * to have held more than one line.
 */
export const MULTI_LINE_BOX_HEIGHT_RATIO = 1.6;

/**
 * Box ink extent, as a multiple of the FONT SIZE, below which a box cannot be
 * holding two stacked lines.
 *
 * One visual line's ink spans at most about one em; two stacked lines span a
 * line advance plus a cap height, which is over 1.4em even set solid. This is
 * what distinguishes a genuinely wrapped block from two runs sharing a baseline
 * — both report two lines, and only the first may wrap.
 */
export const MIN_STACKED_BOX_HEIGHT_RATIO = 1.4;

/**
 * How far measured text may exceed its box before wrapping is preferred to
 * overflow, when nothing better is known.
 *
 * Measured against the seven text blocks on the BC Snapshot cover, using each
 * one's own source font: genuine single lines sat at 0.72–1.02 of their box,
 * and blocks whose lines had been joined sat at 1.25–1.34. 1.2 clears the
 * former with room for a substitute that runs wide, and still catches the
 * latter. Anything under it is treated as substitution widening, which is
 * `reconcileTextReflow`'s problem and not solved by adding a line.
 */
export const MAX_NOWRAP_OVERFLOW_RATIO = 1.2;

export type TextWrappingReason =
  | 'no_text'
  | 'explicit_newline'
  | 'source_drew_multiple_lines'
  | 'source_alignment_implies_multiple_lines'
  | 'source_lines_share_one_baseline'
  | 'source_drew_one_line'
  | 'box_taller_than_one_line'
  | 'measured_width_exceeds_box'
  | 'fits_on_one_line';

export interface TextWrappingInput {
  text: string;
  boxWidthPt: number;
  boxHeightPt: number;
  fontSizePt: number;
  /** Line-height multiplier, as the overlay will render it. */
  lineHeight: number;
  /** Tracking in points, as the overlay will render it. */
  letterSpacingPt?: number;
  /** Family string handed to the measurer — the substitute, not the source. */
  fontFamily?: string;
  /** Lines the SOURCE drew in this box (`source_measure.lineCount`). */
  sourceLineCount?: number | null;
  /**
   * Distinct baselines among those lines (`source-measure-v2`). Exact where
   * `sourceLineCount` is only suggestive — see the header. Absent on v1.
   */
  sourceBaselineCount?: number | null;
  /** Alignment the sidecar inferred; `justify` implies two or more lines. */
  sourceAlign?: string | null;
  /** Advance-width measurer, when one exists (browser: canvas). */
  measure?: WidthMeasurer | null;
}

export interface TextWrappingDecision {
  /** True when the overlay must be given `whiteSpace: 'nowrap'`. */
  nowrap: boolean;
  reason: TextWrappingReason;
  /** Natural advance width in points, when a measurer produced one. */
  naturalWidthPt?: number;
}

/**
 * Advance width of `text` including its tracking, in points.
 *
 * Tracking is counted between glyphs (`n − 1` gaps). CSS also adds it after the
 * final glyph, so this under-states by one gap — deliberately, since the number
 * is compared against a threshold whose purpose is to NOT fire on marginal
 * cases.
 */
function naturalWidthPt(input: TextWrappingInput): number | null {
  if (!input.measure) return null;
  const family = input.fontFamily?.trim();
  if (!family) return null;
  if (!Number.isFinite(input.fontSizePt) || input.fontSizePt <= 0) return null;
  let measured: number | null = null;
  try {
    measured = input.measure(input.text, family, input.fontSizePt);
  } catch {
    return null;
  }
  if (measured == null || !Number.isFinite(measured) || measured <= 0) return null;
  const tracking = Number(input.letterSpacingPt);
  const gaps = Math.max(0, [...input.text].length - 1);
  const tracked = measured + (Number.isFinite(tracking) ? tracking * gaps : 0);
  return tracked > 0 ? tracked : measured;
}

/**
 * Decide whether this text may wrap.
 *
 * Never throws: a measurer that fails, a nonsensical box or an absent
 * measurement all fall through to the next rule rather than deciding on a
 * number that does not mean what it appears to.
 */
export function resolveTextWrapping(input: TextWrappingInput): TextWrappingDecision {
  const text = typeof input.text === 'string' ? input.text : '';
  if (!text.trim()) return { nowrap: false, reason: 'no_text' };

  // An author-visible break. Nothing may override it.
  if (/[\r\n]/.test(text)) return { nowrap: false, reason: 'explicit_newline' };

  // Distinct baselines, when the artifact carries them, answer the stacked
  // question outright — no box arithmetic, no threshold. One baseline is one
  // visual line however many line records share it.
  const baselines = Number(input.sourceBaselineCount);
  if (Number.isFinite(baselines) && baselines >= 1) {
    if (baselines >= 2) return { nowrap: false, reason: 'source_drew_multiple_lines' };
    return {
      nowrap: true,
      reason: Number(input.sourceLineCount) >= 2
        ? 'source_lines_share_one_baseline'
        : 'source_drew_one_line',
    };
  }

  const fontSize = Number(input.fontSizePt);
  const lineHeight = Number(input.lineHeight);
  const boxHeight = Number(input.boxHeightPt);

  // Could this box be holding two STACKED lines? Unusable geometry answers
  // "unknown", and unknown must not veto the source's own count — the count is
  // the stronger evidence, and this test exists only to catch the one case it
  // cannot express (two runs on a shared baseline).
  const boxCouldHoldTwoLines = !(
    Number.isFinite(fontSize) && fontSize > 0 && Number.isFinite(boxHeight)
  ) || boxHeight >= fontSize * MIN_STACKED_BOX_HEIGHT_RATIO;

  const sourceLines = Number(input.sourceLineCount);
  const sourceSaysMultiple = (Number.isFinite(sourceLines) && sourceLines >= 2)
    // `justify` is only ever inferred from two or more matched lines, so it
    // says the same thing for artifacts that predate `lineCount`.
    || input.sourceAlign === 'justify';

  if (sourceSaysMultiple) {
    if (boxCouldHoldTwoLines) {
      return {
        nowrap: false,
        reason: Number.isFinite(sourceLines) && sourceLines >= 2
          ? 'source_drew_multiple_lines'
          : 'source_alignment_implies_multiple_lines',
      };
    }
    // Two line records in a box too short to stack them: side-by-side runs
    // that were merged into one string. One visual line, so keep it on one.
    return { nowrap: true, reason: 'source_lines_share_one_baseline' };
  }

  if (Number.isFinite(sourceLines) && sourceLines === 1) {
    return { nowrap: true, reason: 'source_drew_one_line' };
  }

  if (
    Number.isFinite(fontSize) && fontSize > 0
    && Number.isFinite(lineHeight) && lineHeight > 0
    && Number.isFinite(boxHeight)
    && boxHeight > fontSize * lineHeight * MULTI_LINE_BOX_HEIGHT_RATIO
  ) {
    return { nowrap: false, reason: 'box_taller_than_one_line' };
  }

  const natural = naturalWidthPt(input);
  const boxWidth = Number(input.boxWidthPt);
  if (
    natural != null
    && Number.isFinite(boxWidth) && boxWidth > 0
    && natural > boxWidth * MAX_NOWRAP_OVERFLOW_RATIO
  ) {
    return {
      nowrap: false,
      reason: 'measured_width_exceeds_box',
      naturalWidthPt: Math.round(natural * 100) / 100,
    };
  }

  return {
    nowrap: true,
    reason: 'fits_on_one_line',
    ...(natural != null ? { naturalWidthPt: Math.round(natural * 100) / 100 } : {}),
  };
}
