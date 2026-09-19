/**
 * Measured text geometry from a PDF's own content stream — pure.
 *
 * WHAT THIS IS FOR
 * ----------------
 * The Claude PDF reconstruction path sends the document to the model and asks it
 * to "transcribe text EXACTLY at its real positions". Reading positions off a
 * rendered page is the one thing a model is genuinely bad at, and it is the one
 * thing the file states exactly: every show-text operator carries a text matrix
 * whose translation IS the baseline origin, and an advance width in points.
 *
 * This module turns PDF.js text fragments into placed boxes, so the model is
 * handed the measurements instead of asked to estimate them. It is the same
 * grounding every other reference kind already gets — OCR words for an image, a
 * box tree for code and for Figma — for the source that holds the best evidence.
 *
 * VERIFIED AGAINST AN INDEPENDENT PARSER
 * --------------------------------------
 * Checked on `reports/golden/borrowing-capacity-snapshot.pdf` p2 against
 * PyMuPDF, which reads the file with a completely separate implementation:
 *
 *     "A. & J. Sample"   PDF.js x=56.69 baseline=85.04 advance=125.046
 *                        PyMuPDF x=56.69 origin  =85.04 x1−x0  =125.05
 *
 * Baseline and advance agree exactly. That is why `y` here is derived FROM the
 * baseline rather than from any parser's idea of a bounding box: the two
 * disagree about box tops (PyMuPDF inflates the ascender for the base-14 fonts;
 * PDF.js reports the font's own) and only one of the two numbers is in the file.
 *
 * THE KNOWN RESIDUAL
 * ------------------
 * `y` is the ink top — baseline minus the font's ascent — which is the same
 * convention `imageGrounding` uses for OCR boxes and the convention the schema's
 * overlays carry. It is NOT the box top that would make a CSS line box put the
 * baseline back exactly where the source has it: that is
 *
 *     boxTop = baseline − ((lineHeight − (hheaAsc + hheaDesc)) / 2 + hheaAsc) × size
 *
 * (see `firstBaseline.pure.ts`), which needs the hhea metrics of the *substituted*
 * font and the line-height the model picks — neither of which exists at grounding
 * time. The residual is about 0.2em with a default line-height. Correcting it
 * belongs downstream, where the resolved font is known.
 *
 * Pure and deterministic: no PDF.js import, no DOM, no fetch, no clock. The
 * impure page walk lives in `groundPdfDocument.ts`.
 */

/** A PDF 2×3 affine, in PDF.js's `[a, b, c, d, e, f]` order. */
export type Matrix6 = readonly [number, number, number, number, number, number];

/** The fields of a PDF.js `TextItem` this module reads. */
export interface PdfTextFragment {
  str?: unknown;
  /** Text matrix in PDF user space (y-up). `[4]`/`[5]` are the baseline origin. */
  transform?: unknown;
  /** Advance width in points. */
  width?: unknown;
  height?: unknown;
  fontName?: unknown;
  hasEOL?: unknown;
}

/** The fields of a PDF.js `TextStyle` this module reads. */
export interface PdfFontStyle {
  /** Ascent as a fraction of the em, from the font's own metrics. */
  ascent?: unknown;
  /** Descent as a fraction of the em. Negative. */
  descent?: unknown;
  fontFamily?: unknown;
  vertical?: unknown;
}

export interface PlacedTextFragment {
  text: string;
  /** Page points, top-left origin. */
  x: number;
  y: number;
  width: number;
  height: number;
  fontSizePt: number;
  /** Top-down baseline. The number the file actually states. */
  baselineYPt: number;
  fontFamily?: string;
  /** PDF.js's per-page font key. Fragments sharing one never differ in typeface. */
  fontKey?: string;
  hasEOL: boolean;
}

/**
 * Ascent/descent when the font reports none.
 *
 * Only reached for a font PDF.js could not extract metrics from. Chosen to sit
 * between the extremes rather than to be right for any particular typeface — a
 * fragment placed on a guess is still placed at the correct BASELINE, which is
 * the measurement that matters, and only its box height is approximate.
 */
const FALLBACK_ASCENT = 0.75;
const FALLBACK_DESCENT = -0.21;

/** Beyond this the text is rotated or sheared and an axis-aligned box lies about it. */
const AXIS_ALIGNED_EPSILON = 0.01;

/**
 * Horizontal gap, in ems, at which two same-baseline fragments stop being one
 * line. Matches `splitBaselineColumns.pure.ts` — a gap this wide is a column
 * boundary or a table cell, and merging across it invents a sentence.
 */
export const MAX_INTRA_LINE_GAP_EM = 4;

/** Vertical tolerance for "same baseline", in points. Matches the column splitter. */
export const SAME_BASELINE_TOLERANCE_PT = 1.5;

/** Gap at which a space is inserted between merged fragments, in ems. */
const SPACE_GAP_EM = 0.16;

function finite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** `m1 × m2`, matching PDF.js's `Util.transform`. */
export function multiplyMatrix(m1: Matrix6, m2: Matrix6): Matrix6 {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function readMatrix(value: unknown): Matrix6 | null {
  if (!Array.isArray(value) || value.length < 6) return null;
  const out: number[] = [];
  for (let i = 0; i < 6; i += 1) {
    const n = finite(value[i]);
    if (n == null) return null;
    out.push(n);
  }
  return out as unknown as Matrix6;
}

/**
 * CSS generic families. PDF.js reports one of these as `style.fontFamily` when it
 * has no real name for the font, and passing it on would be worse than silence:
 * the agent treats a supplied family as authoritative and would set every overlay
 * to the literal string "sans-serif" instead of reading the typeface off the page.
 */
const GENERIC_FAMILIES = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui']);

function realFamily(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const family = value.trim().replace(/^["']|["']$/g, '');
  if (!family || GENERIC_FAMILIES.has(family.toLowerCase())) return undefined;
  return family;
}

/**
 * Place one PDF.js text fragment on the page, in points from the top-left.
 *
 * `viewportTransform` is PDF.js's own `viewport.transform` for a scale-1
 * viewport, which carries the y-flip, the page rotation and any non-zero
 * MediaBox origin — deriving those by hand is how a rotated page silently comes
 * out mirrored.
 *
 * Returns null for anything that cannot be placed honestly: empty and
 * whitespace-only fragments (PDF.js synthesises those to represent inter-run
 * gaps, and gives them a width spanning the whole gap), rotated or sheared runs,
 * and degenerate geometry.
 */
export function placeTextFragment(
  fragment: PdfTextFragment,
  style: PdfFontStyle | null | undefined,
  viewportTransform: Matrix6,
): PlacedTextFragment | null {
  const text = typeof fragment?.str === 'string' ? fragment.str : '';
  if (!text.trim()) return null;
  if (style?.vertical === true) return null;

  const textMatrix = readMatrix(fragment.transform);
  if (!textMatrix) return null;
  const tx = multiplyMatrix(viewportTransform, textMatrix);

  const fontSizePt = Math.hypot(tx[2], tx[3]);
  if (!(fontSizePt > 0)) return null;
  // Off-diagonal terms mean rotation or shear. An axis-aligned box for rotated
  // text reports a position the glyphs are not at.
  const scale = Math.max(Math.abs(tx[0]), fontSizePt);
  if (Math.abs(tx[1]) > scale * AXIS_ALIGNED_EPSILON) return null;
  if (Math.abs(tx[2]) > scale * AXIS_ALIGNED_EPSILON) return null;

  const width = finite(fragment.width);
  if (width == null || !(width > 0)) return null;

  const ascent = finite(style?.ascent) ?? FALLBACK_ASCENT;
  const descent = finite(style?.descent) ?? FALLBACK_DESCENT;
  const span = ascent - descent;
  const baselineYPt = tx[5];

  return {
    text,
    x: tx[4],
    y: baselineYPt - ascent * fontSizePt,
    width,
    height: (span > 0 ? span : FALLBACK_ASCENT - FALLBACK_DESCENT) * fontSizePt,
    fontSizePt,
    baselineYPt,
    ...(realFamily(style?.fontFamily) ? { fontFamily: realFamily(style?.fontFamily) } : {}),
    ...(typeof fragment.fontName === 'string' ? { fontKey: fragment.fontName } : {}),
    hasEOL: fragment.hasEOL === true,
  };
}

/**
 * Join fragments that are visually one line.
 *
 * A PDF emits one fragment per show-text operator, so a single rendered line
 * routinely arrives in several pieces — and a table row arrives as pieces too.
 * The difference is the horizontal gap: within a line it is a word space, across
 * a column it is the gutter. `MAX_INTRA_LINE_GAP_EM` is the same threshold the
 * column splitter uses, so the two agree about where a line ends.
 *
 * Merging matters beyond tidiness. One overlay per fragment would spend the
 * element budget on pieces of sentences and produce a reconstruction assembled
 * from fragments, which is not what the source is.
 */
export function mergeFragmentsIntoLines(
  fragments: readonly PlacedTextFragment[],
): PlacedTextFragment[] {
  const usable = fragments.filter(Boolean);
  if (!usable.length) return [];

  // Reading order, then left to right. PDF content streams are under no
  // obligation to be in either.
  const ordered = usable
    .map((fragment, index) => ({ fragment, index }))
    .sort((a, b) =>
      a.fragment.baselineYPt - b.fragment.baselineYPt
      || a.fragment.x - b.fragment.x
      || a.index - b.index)
    .map((entry) => entry.fragment);

  const lines: PlacedTextFragment[] = [];
  let current: PlacedTextFragment | null = null;
  let currentRight = 0;

  const flush = () => { if (current) lines.push(current); current = null; };

  for (const fragment of ordered) {
    if (!current) {
      current = { ...fragment };
      currentRight = fragment.x + fragment.width;
      continue;
    }
    const sameBaseline = Math.abs(fragment.baselineYPt - current.baselineYPt) <= SAME_BASELINE_TOLERANCE_PT;
    const em = Math.max(current.fontSizePt, fragment.fontSizePt);
    const gap = fragment.x - currentRight;
    // A fragment that starts left of where the last one ended is an overlap, not
    // a gap — kerned or re-positioned runs do this, and they belong together.
    const joinable = sameBaseline && !current.hasEOL && gap <= em * MAX_INTRA_LINE_GAP_EM;
    if (!joinable) {
      flush();
      current = { ...fragment };
      currentRight = fragment.x + fragment.width;
      continue;
    }

    const needsSpace = gap > em * SPACE_GAP_EM
      && !/\s$/.test(current.text) && !/^\s/.test(fragment.text);
    const top = Math.min(current.y, fragment.y);
    const bottom = Math.max(current.y + current.height, fragment.y + fragment.height);
    const right = Math.max(currentRight, fragment.x + fragment.width);
    current = {
      ...current,
      text: current.text + (needsSpace ? ' ' : '') + fragment.text,
      y: top,
      height: bottom - top,
      width: right - current.x,
      // The line's type size is its largest run: it is what the line looks like,
      // and what a single overlay would have to be set in.
      fontSizePt: Math.max(current.fontSizePt, fragment.fontSizePt),
      fontFamily: current.fontFamily ?? fragment.fontFamily,
      hasEOL: fragment.hasEOL,
    };
    currentRight = right;
  }
  flush();
  return lines;
}
