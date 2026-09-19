/**
 * Recover real words from tracked (letter-spaced) source text.
 *
 * THE ARTIFACT
 * ------------
 * Documents track out their headings — `NAIDU` set as `N A I D U`, standard
 * luxury-brand styling. The PDF positions each letter individually, so the
 * extractor emits one glyph per letter and joins them with spaces: the word
 * becomes `N A I D U`, the real word gaps become multiple spaces, and sometimes
 * a word gap is lost outright. A production import stored exactly this:
 *
 *     "N A I D U   P R O P E R T Y C O N S U L T I N G   S E R V I C E S"
 *
 * Note PROPERTY–CONSULTING: the word boundary is GONE. Rendered as-is this
 * reads as gibberish, edits as gibberish, and searches as gibberish.
 *
 * THE RECONSTRUCTION
 * ------------------
 * Tracked text is words plus a letter-spacing STYLE, so that is what we emit:
 * `NAIDU PROPERTY CONSULTING SERVICES` + `letterSpacing: N pt`. Three evidence
 * sources, in order of authority:
 *
 *   1. Per-LINE char counts from the sidecar's `source_measure`. See below —
 *      this is the one that recovers PROPERTY|CONSULTING.
 *   2. Span char-counts. SOME PDFs draw tracked text as one span per word, in
 *      which case the span partition is the word structure. Not a rule: this
 *      cover draws each tracked line as a SINGLE span, so nothing here helps
 *      it. Kept because when it does hold it is exact.
 *   3. The string's own multi-space runs, which survive as word gaps when the
 *      extractor preserved them. Cannot recover a lost boundary, but never
 *      invents one either.
 *
 * WHERE THE LOST BOUNDARY ACTUALLY WENT
 * -------------------------------------
 * The source drew the lockup as two lines, each with its word gaps intact:
 *
 *     line 1  'N A I D U  P R O P E R T Y'
 *     line 2  'C O N S U L T I N G  S E R V I C E S'
 *
 * Docling joins an item's lines with a SINGLE space, and inside tracked text a
 * single space is a letter gap, not a word gap. So the join manufactured
 * `...P R O P E R T Y C O N S U L T I N G...` and the collapse dutifully read
 * it as one word. Nothing in the merged string marks the seam — but the line
 * char counts locate it exactly, because a line boundary is always a word
 * boundary. De-track each line separately, then join with a space.
 *
 * When no source yields a confident answer the text is LEFT ALONE. A wrongly
 * merged heading would be worse than the artifact — the artifact is at least
 * visibly broken, where a wrong merge looks intentional.
 *
 * Pure and deterministic.
 */

/** Minimum single-character tokens before a string is considered tracked. */
export const MIN_TRACKED_TOKENS = 4;

/**
 * Minimum share of tokens that must be single characters. Tracked headings are
 * ~100%; ordinary text with an initial ("J R R Tolkien") stays untouched
 * because the long tokens pull the share down.
 */
export const MIN_SINGLE_CHAR_SHARE = 0.8;

/**
 * Longest token that can still be a KERN PAIR rather than a word.
 *
 * Tracked text is not reliably one letter per token. Where the source kerns a
 * pair — `AT`, `PA`, `VA` — the two glyphs are drawn with no positioning
 * operator between them, so the extractor emits them joined. Requiring every
 * token in a run to be a single character therefore refuses to collapse the run
 * at all, and the word survives with a hole in it. Measured across this
 * document, on every one of its seven pages:
 *
 *     'C A PA C I T Y'   pages 2-7      → CAPACITY
 *     'P R I VAT E'      pages 2-7      → PRIVATE
 *     'D AT E' / 'R AT E'  page 1       → DATE / RATE
 *     'W H AT', 'B U I LT'  page 6      → WHAT / BUILT
 *     'N YA W O'         page 7         → NYAWO
 *
 * Three characters covers the longest of them (`VAT`). A real word next to
 * single letters would have to be three characters or fewer AND sit inside a
 * string that already reads as tracked overall, which is the same as saying it
 * was tracked too.
 */
export const MAX_KERNED_TOKEN_LENGTH = 3;

/**
 * Minimum share of a run's tokens that must be single characters before the run
 * is collapsed. Lower than the whole-string bar because a short run has few
 * tokens to average over: `D AT E` is 2 of 3.
 */
export const MIN_RUN_SINGLE_CHAR_SHARE = 0.6;

export interface DetrackResult {
  text: string;
  changed: boolean;
  /** Which evidence decided the word boundaries. */
  method: 'line-partition' | 'span-partition' | 'multi-space' | 'none';
  /**
   * The de-tracked text of each source line, when the lines were located.
   *
   * Tracking is derived from a measured width divided by a glyph count, and
   * both terms are per-LINE facts. Deriving it from the joined string against
   * one line's width answers a question nobody asked.
   */
  lines?: string[];
}

/** One source line's measurement, as `source_measure.lines[]` ships it. */
export interface SourceLineMeasure {
  charCount?: number;
  widthPt?: number;
  spans?: ReadonlyArray<{ chars?: number }>;
}

/** Is this the letter-spread pattern at all? */
export function looksTracked(raw: string): boolean {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < MIN_TRACKED_TOKENS) return false;
  const single = tokens.filter((t) => [...t].length === 1).length;
  return single / tokens.length >= MIN_SINGLE_CHAR_SHARE;
}

/**
 * Collapse using the string's own spacing: single spaces between letters are
 * tracking, runs of 2+ spaces are word gaps.
 */
function collapseByMultiSpace(raw: string): string {
  return raw
    .trim()
    .split(/\s{2,}/)
    .map((segment) => {
      const tokens = segment.split(' ').filter(Boolean);
      return isLetterRun(tokens) ? tokens.join('') : segment;
    })
    .join(' ');
}

/** Is this run of tokens a spread-out word rather than several words? */
function isLetterRun(tokens: readonly string[]): boolean {
  if (tokens.length < 2) return false;
  const lengths = tokens.map((t) => [...t].length);
  if (lengths.some((n) => n > MAX_KERNED_TOKEN_LENGTH)) return false;
  const single = lengths.filter((n) => n === 1).length;
  return single / tokens.length >= MIN_RUN_SINGLE_CHAR_SHARE;
}

/**
 * Partition the letter stream by span char-counts, when they account for it
 * exactly. An inexact partition proves the spans describe something other than
 * this string (a different extractor's view, a multi-line item, spans that
 * include their own spaces) — in which case they must not be trusted for it.
 */
function collapseBySpans(raw: string, spanCharCounts: readonly number[]): string | null {
  const letters = [...raw.replace(/\s+/g, '')];
  const counts = spanCharCounts.filter((n) => Number.isFinite(n) && n >= 1).map((n) => Math.round(n));
  if (counts.length < 2 || counts.length !== spanCharCounts.length) return null;
  const total = counts.reduce((a, b) => a + b, 0);
  if (total !== letters.length) return null;

  const words: string[] = [];
  let at = 0;
  for (const count of counts) {
    words.push(letters.slice(at, at + count).join(''));
    at += count;
  }
  return words.join(' ');
}

/**
 * De-track one string.
 *
 * Span evidence wins when it partitions the letters exactly — it is the only
 * source that can recover a LOST boundary. Otherwise the string's own multi-
 * space gaps are used. A string that does not look tracked is returned as-is.
 */
export function detrackText(
  raw: string,
  spanCharCounts?: readonly number[],
): DetrackResult {
  if (typeof raw !== 'string' || !looksTracked(raw)) {
    return { text: raw, changed: false, method: 'none' };
  }

  if (spanCharCounts && spanCharCounts.length >= 2) {
    const bySpans = collapseBySpans(raw, spanCharCounts);
    if (bySpans !== null && bySpans !== raw) {
      return { text: bySpans, changed: true, method: 'span-partition' };
    }
  }

  const byGaps = collapseByMultiSpace(raw);
  if (byGaps !== raw.trim()) {
    return { text: byGaps, changed: true, method: 'multi-space' };
  }
  return { text: raw, changed: false, method: 'none' };
}

/**
 * De-track a string the extractor built by joining several source lines.
 *
 * Each line is de-tracked on its own evidence and the results are joined with a
 * space, because a line boundary is a word boundary — which is precisely the
 * boundary the join destroyed. Falls back to whole-string de-tracking when the
 * lines cannot be located in the string, so this is safe to call unconditionally.
 */
export function detrackJoinedLines(
  raw: string,
  lines: readonly SourceLineMeasure[] | undefined,
): DetrackResult {
  if (typeof raw !== 'string' || !looksTracked(raw)) {
    return { text: raw, changed: false, method: 'none' };
  }
  const segments = lines && lines.length >= 2
    ? partitionByLineCounts(raw, lines.map((l) => Number(l?.charCount ?? 0)))
    : null;
  if (!segments) {
    return detrackText(
      raw,
      lines?.length === 1
        ? lines[0]?.spans?.map((s) => Number(s?.chars ?? 0)).filter((n) => n > 0)
        : undefined,
    );
  }
  const perLine = segments.map((segment, i) =>
    detrackText(segment, lines![i]?.spans?.map((s) => Number(s?.chars ?? 0)).filter((n) => n > 0)));
  const lineTexts = perLine.map((r) => r.text.trim());
  const text = lineTexts.join(' ');
  return {
    text,
    changed: text !== raw.trim(),
    // The partition is what recovered the seam even when each line then
    // collapsed on its own multi-space gaps, so name the evidence that mattered.
    method: text !== raw.trim() ? 'line-partition' : 'none',
    lines: lineTexts,
  };
}

/**
 * Split `raw` back into the source lines it was joined from, using each line's
 * character count.
 *
 * The separator the extractor used is not stated anywhere, so it is DERIVED:
 * the only width that makes the counts add up to the string's own length is the
 * one that was used. A single space and an empty join are the realistic cases;
 * both are checked, and if neither reproduces the length exactly the counts
 * describe something other than this string — a different extractor's view of
 * the item, a line the geometry matched but Docling did not — and are refused.
 *
 * Refusing costs a missed word boundary. Accepting a partition that is off by
 * one puts the seam inside a word, which is worse and looks deliberate.
 */
export function partitionByLineCounts(
  raw: string,
  lineCharCounts: readonly number[],
): string[] | null {
  const counts = lineCharCounts
    .filter((n) => Number.isFinite(n) && n >= 1)
    .map((n) => Math.round(n));
  if (counts.length < 2 || counts.length !== lineCharCounts.length) return null;
  const chars = [...raw];
  const total = counts.reduce((a, b) => a + b, 0);
  for (const separator of [1, 0]) {
    if (total + separator * (counts.length - 1) !== chars.length) continue;
    const segments: string[] = [];
    let at = 0;
    for (const count of counts) {
      segments.push(chars.slice(at, at + count).join(''));
      at += count + separator;
    }
    if (segments.every((s) => s.trim())) return segments;
  }
  return null;
}

// ── Letter-spacing recovery ──────────────────────────────────────────────────

/**
 * Measures the advance width of `text` in `family` at `sizePt`, in points.
 *
 * `fontWeight` is not decoration: a semibold face runs several percent wider
 * than its regular, so measuring a semibold heading at the default 400 makes
 * the natural width too small and the derived spacing too large by exactly what
 * the weight was worth. Optional, so a caller without one is unchanged.
 */
export type WidthMeasurer = (
  text: string,
  family: string,
  sizePt: number,
  fontWeight?: number | string,
) => number | null;

/**
 * Widest credible tracking, as a multiple of the font size. Beyond this the
 * derivation is more likely wrong than the design is extreme.
 */
export const MAX_TRACKING_EM = 1.5;

/**
 * Average glyph advance as a fraction of font size, used ONLY when nothing can
 * be measured. Roman faces average 0.45–0.55em per glyph; 0.5 splits the
 * difference. An estimate this crude is acceptable for a fallback because the
 * result is clamped and only ever ADDS spacing the design visibly had.
 */
export const FALLBACK_GLYPH_ADVANCE_EM = 0.5;

/**
 * Derive the letter-spacing that makes the de-tracked text occupy the width the
 * source measured for the tracked original.
 *
 * spacing = (measuredWidth − naturalWidth) / (glyphCount − 1)
 *
 * `naturalWidth` comes from the injected measurer (canvas, with the fallback
 * family — the embedded face is not loaded in the measuring document, so the
 * fallback's metrics are the honest approximation available). Without a
 * measurer the glyph-advance estimate above stands in. Returns null rather
 * than a negative or absurd value: tracked text only ever gains spacing.
 */
export function deriveTrackingPt(
  collapsedText: string,
  measuredWidthPt: number,
  fontSizePt: number,
  fontFamily: string,
  measure?: WidthMeasurer | null,
  fontWeight?: number | string,
): number | null {
  const glyphs = [...collapsedText];
  if (glyphs.length < 2) return null;
  if (!Number.isFinite(measuredWidthPt) || measuredWidthPt <= 0) return null;
  if (!Number.isFinite(fontSizePt) || fontSizePt <= 0) return null;

  let naturalWidth: number | null = null;
  if (measure) {
    try {
      naturalWidth = measure(collapsedText, fontFamily, fontSizePt, fontWeight);
    } catch {
      naturalWidth = null;
    }
  }
  if (naturalWidth == null || !Number.isFinite(naturalWidth) || naturalWidth <= 0) {
    naturalWidth = glyphs.length * fontSizePt * FALLBACK_GLYPH_ADVANCE_EM;
  }

  const spacing = (measuredWidthPt - naturalWidth) / (glyphs.length - 1);
  if (!Number.isFinite(spacing) || spacing <= 0) return null;
  const clamped = Math.min(spacing, fontSizePt * MAX_TRACKING_EM);
  // Rounded DOWN, not to nearest. The width this reproduces is the width the
  // source measured, and the box is exactly that wide — so a hundredth of a
  // point over the true value is text that no longer fits, while the same
  // amount under is invisible. `Math.round` turned 3.725 into 3.73 and put the
  // brand lockup's second line 0.09pt past its box, which cost it a whole line.
  return Math.floor(clamped * 100) / 100;
}

/**
 * Derive one tracking value for an item whose text spans several source lines.
 *
 * WHY NOT JUST MEASURE THE WHOLE STRING
 * -------------------------------------
 * `deriveTrackingPt` divides a measured width by a glyph count, and neither
 * term survives the join. The item's `measuredWidthPt` is the widest LINE, and
 * its box width is the same thing; the joined string has every line's glyphs.
 * Feeding one line's width and every line's glyphs to the same equation gives a
 * number with no meaning — for the BC Snapshot lockup it produced a spacing at
 * or below zero, so the tracked brand line came out with no tracking at all
 * while the single-line labels beside it kept theirs. That is the inconsistency.
 *
 * WHY THE SMALLEST ESTIMATE AND NOT THE AVERAGE
 * ---------------------------------------------
 * Each line is its own measurement, so each yields its own estimate, and a
 * design applies one tracking to a lockup — so they very nearly agree. The
 * lockup's two lines want 3.89pt and 3.72pt.
 *
 * They are not interchangeable, because the errors are not symmetric. The box
 * comes from the source, so it is exactly as wide as the widest line with no
 * slack at all. Tracking a shade under leaves that line a fraction of a point
 * narrow, which nobody can see. Tracking a shade over pushes it past the box
 * and it WRAPS — a whole extra line, and every line below it moves. Splitting
 * the difference at 3.81pt did exactly that: `CONSULTING SERVICES` came out
 * 1.5pt over its 199.8pt box and the two-line lockup rendered as three.
 *
 * So take the smallest: it is the only value at which no line can overflow the
 * width the source measured for it. A line whose estimate is spuriously small
 * would pull the result down, but `deriveTrackingPt` already returns null for
 * anything at or below zero, so the pull is bounded by real measurements.
 */
export function deriveTrackingFromLines(
  lineTexts: readonly string[],
  lineWidthsPt: readonly number[],
  fontSizePt: number,
  fontFamily: string,
  measure?: WidthMeasurer | null,
  fontWeight?: number | string,
): number | null {
  const estimates: number[] = [];
  for (let i = 0; i < lineTexts.length; i += 1) {
    const tracking = deriveTrackingPt(
      lineTexts[i] ?? '',
      Number(lineWidthsPt[i]),
      fontSizePt,
      fontFamily,
      measure,
      fontWeight,
    );
    if (tracking != null) estimates.push(tracking);
  }
  // Each estimate is already floored by `deriveTrackingPt`, so the minimum of
  // them is too — no line can exceed the width its own measurement allows.
  return estimates.length ? Math.min(...estimates) : null;
}
