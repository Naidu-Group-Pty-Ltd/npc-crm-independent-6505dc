/**
 * pdf-text-layout-v1 — reading-order text reconstruction from PDF.js text items.
 *
 * PDF has no notion of a word, a line or a paragraph: a page is a bag of
 * positioned glyph runs emitted in content-stream order, which is frequently
 * *not* reading order. The old extractor joined those runs with `' '` and
 * inserted a newline whenever the baseline moved more than 2 units, which
 * produced three failure modes on real documents:
 *
 *   1. **Split words.** A run break inside a word (`Rich` + `mond`, extremely
 *      common with kerning pairs and font switches) became `Rich mond`.
 *   2. **Merged columns.** A two-column form (`Weekly rent` … `$650`) became
 *      `Weekly rent $650 Council rates $2,100` on one line, so an LLM had to
 *      guess which value belonged to which label.
 *   3. **Scrambled order.** Content-stream order was preserved verbatim, so
 *      footers, sidebars and rotated stamps landed mid-sentence.
 *
 * This module reconstructs lines from geometry instead: items are grouped by
 * *vertical span overlap* (robust across mixed font sizes and superscripts),
 * ordered left-to-right, and joined using the horizontal gap between them —
 * no gap means no space, a word-sized gap means one space, a column-sized gap
 * becomes an explicit column separator that survives into the LLM prompt.
 *
 * Pure and DOM-free: it takes plain `{ str, transform, width }` shapes, so it
 * is unit-testable without loading PDF.js.
 */

/** The subset of a PDF.js `TextItem` this module needs. */
export interface PdfTextItemLike {
  str: string;
  /** PDF.js text matrix `[a, b, c, d, e, f]` (text space → page space). */
  transform: number[];
  /** Horizontal advance of the run, in page units. */
  width?: number;
  /** Height of the run, in page units. */
  height?: number;
  fontName?: string;
  /** PDF.js sets this when the run ends a line in the content stream. */
  hasEOL?: boolean;
}

export interface PdfSpan {
  text: string;
  /** Left edge in page units. */
  x: number;
  /** Baseline Y in PDF coordinates (origin bottom-left, Y grows upward). */
  y: number;
  width: number;
  /** Effective font size derived from the text matrix. */
  fontSize: number;
  /** Rotation in degrees, normalised to [0, 360). */
  rotation: number;
  fontName?: string;
  hasEOL: boolean;
}

export interface PdfLine {
  text: string;
  /** Left edge of the leftmost span. */
  x: number;
  /** Baseline Y of the line (median of its spans). */
  y: number;
  /** Right edge of the rightmost span. */
  right: number;
  /** Dominant font size on the line. */
  fontSize: number;
  rotation: number;
  spanCount: number;
}

export interface BuildLinesOptions {
  /**
   * Gap, as a multiple of font size, above which a single space is inserted
   * between two spans. Default 0.18 — below a typical space advance (~0.25em)
   * so genuine spaces are never lost, but wide enough that kerning gaps inside
   * a word do not become spaces.
   */
  spaceGapEm?: number;
  /**
   * Gap, as a multiple of font size, above which spans are treated as separate
   * columns and joined with `columnSeparator`. Default 1.6.
   */
  columnGapEm?: number;
  /** Separator inserted at a column-sized gap. Default two spaces. */
  columnSeparator?: string;
  /**
   * Minimum fraction of vertical overlap for two spans to share a line.
   * Default 0.4.
   */
  lineOverlapRatio?: number;
  /** Drop spans whose rotation is not a multiple of 90°. Default false. */
  dropSkewedText?: boolean;
}

const DEFAULTS: Required<BuildLinesOptions> = {
  spaceGapEm: 0.18,
  columnGapEm: 1.6,
  columnSeparator: '  ',
  lineOverlapRatio: 0.4,
  dropSkewedText: false,
};

function normaliseAngle(degrees: number): number {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** Decompose a PDF.js text item into position, size and rotation. */
export function decodeSpan(item: PdfTextItemLike): PdfSpan | null {
  const text = typeof item?.str === 'string' ? item.str : '';
  const t = Array.isArray(item?.transform) ? item.transform : [];
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = t as number[];
  if (![a, b, c, d, e, f].every((n) => Number.isFinite(n))) return null;

  // Font size is the vertical scale of the text matrix, not `hypot(c, d)` of the
  // skew column — using the wrong column inflated sizes on italic/skewed text.
  const fontSize = Math.hypot(b, d) || Math.hypot(a, c) || Number(item.height) || 0;
  const rotation = normaliseAngle((Math.atan2(b, a) * 180) / Math.PI);

  const width = Number.isFinite(Number(item.width)) ? Number(item.width) : 0;

  return {
    text,
    x: e,
    y: f,
    width,
    fontSize: fontSize > 0 ? fontSize : 0,
    rotation,
    fontName: item.fontName,
    hasEOL: item.hasEOL === true,
  };
}

/** Bucket spans by their quarter-turn orientation; upright text sorts first. */
function rotationBucket(rotation: number): number {
  return Math.round(rotation / 90) % 4;
}

interface LineAccumulator {
  spans: PdfSpan[];
  top: number;
  bottom: number;
}

function spanBounds(span: PdfSpan): { top: number; bottom: number } {
  // Approximate the em box around the baseline: ~0.75 above, ~0.25 below.
  const size = span.fontSize || 1;
  return { top: span.y + size * 0.75, bottom: span.y - size * 0.25 };
}

function overlaps(a: LineAccumulator, span: PdfSpan, ratio: number): boolean {
  const { top, bottom } = spanBounds(span);
  const overlap = Math.min(a.top, top) - Math.max(a.bottom, bottom);
  if (overlap <= 0) return false;
  const smaller = Math.min(a.top - a.bottom, top - bottom);
  return smaller <= 0 ? true : overlap / smaller >= ratio;
}

/** Join the spans of one line, choosing a separator from the horizontal gap. */
function joinLineSpans(spans: PdfSpan[], options: Required<BuildLinesOptions>): string {
  let text = '';
  let previousRight: number | null = null;
  let previousSize = 0;

  for (const span of spans) {
    if (!span.text) continue;
    const size = span.fontSize || previousSize || 1;

    if (text) {
      const gap = previousRight == null ? 0 : span.x - previousRight;
      const endsWithSpace = /\s$/.test(text);
      const startsWithSpace = /^\s/.test(span.text);

      if (!endsWithSpace && !startsWithSpace) {
        if (gap >= size * options.columnGapEm) text += options.columnSeparator;
        else if (gap >= size * options.spaceGapEm) text += ' ';
        // Otherwise the runs are contiguous: `Rich` + `mond` stays `Richmond`.
      }
    }

    text += span.text;
    previousRight = span.x + (span.width || size * 0.5 * span.text.length);
    previousSize = size;
  }

  return text.replace(/[ \t]+$/, '');
}

/**
 * Group PDF.js text items into geometric lines in reading order.
 *
 * Upright text is emitted first (top-to-bottom, left-to-right), followed by
 * each rotated orientation as its own run so a rotated sidebar or stamp never
 * interleaves itself into the body text.
 */
export function buildPageLines(
  items: readonly PdfTextItemLike[] | null | undefined,
  options: BuildLinesOptions = {},
): PdfLine[] {
  const config = { ...DEFAULTS, ...options };
  if (!items || items.length === 0) return [];

  const spans: PdfSpan[] = [];
  for (const item of items) {
    const span = decodeSpan(item);
    if (!span) continue;
    if (!span.text) continue;
    if (config.dropSkewedText && Math.abs(span.rotation % 90) > 1) continue;
    // Whitespace-only runs carry no glyphs; their geometry is already implied
    // by the gap between their neighbours.
    if (!span.text.trim()) continue;
    spans.push(span);
  }
  if (!spans.length) return [];

  const buckets = new Map<number, PdfSpan[]>();
  for (const span of spans) {
    const bucket = rotationBucket(span.rotation);
    const list = buckets.get(bucket);
    if (list) list.push(span);
    else buckets.set(bucket, [span]);
  }

  const lines: PdfLine[] = [];
  // Upright (0) first, then 90/180/270 so rotated furniture trails the body.
  const orderedBuckets = [...buckets.keys()].sort((a, b) => a - b);

  for (const bucket of orderedBuckets) {
    const bucketSpans = buckets.get(bucket)!;

    // For rotated text the "reading" axes swap; project onto the axes that the
    // glyphs actually advance along so grouping stays meaningful.
    const project = (span: PdfSpan): { across: number; down: number } => {
      switch (bucket) {
        case 1: return { across: span.y, down: span.x }; // 90° CCW
        case 2: return { across: -span.x, down: -span.y }; // 180°
        case 3: return { across: -span.y, down: -span.x }; // 270°
        default: return { across: span.x, down: -span.y };
      }
    };

    const projected = bucketSpans.map((span) => {
      const { across, down } = project(span);
      return { ...span, x: across, y: -down };
    });

    projected.sort((a, b) => (b.y - a.y) || (a.x - b.x));

    const accumulators: LineAccumulator[] = [];
    for (const span of projected) {
      const { top, bottom } = spanBounds(span);
      // Spans arrive top-to-bottom, so the matching line is almost always one of
      // the most recent accumulators — search backwards.
      let target: LineAccumulator | undefined;
      for (let i = accumulators.length - 1; i >= 0; i -= 1) {
        if (overlaps(accumulators[i]!, span, config.lineOverlapRatio)) {
          target = accumulators[i];
          break;
        }
      }
      if (target) {
        target.spans.push(span);
        target.top = Math.max(target.top, top);
        target.bottom = Math.min(target.bottom, bottom);
      } else {
        accumulators.push({ spans: [span], top, bottom });
      }
    }

    for (const acc of accumulators) {
      acc.spans.sort((a, b) => a.x - b.x);
      const text = joinLineSpans(acc.spans, config);
      if (!text.trim()) continue;
      const sizes = acc.spans.map((s) => s.fontSize).filter((n) => n > 0).sort((a, b) => a - b);
      const last = acc.spans[acc.spans.length - 1]!;
      lines.push({
        text,
        x: acc.spans[0]!.x,
        y: (acc.top + acc.bottom) / 2,
        right: last.x + (last.width || 0),
        fontSize: sizes.length ? sizes[Math.floor(sizes.length / 2)]! : 0,
        rotation: bucket * 90,
        spanCount: acc.spans.length,
      });
    }
  }

  return lines;
}

export interface RenderPageTextOptions extends BuildLinesOptions {
  /**
   * Vertical gap, as a multiple of line height, above which a blank line is
   * emitted to mark a paragraph break. Default 1.6. Set to 0 to disable.
   */
  paragraphGapEm?: number;
}

/**
 * Render one page's text items to text, preserving line structure and marking
 * paragraph breaks with a blank line.
 *
 * The paragraph markers matter downstream: the checklist/template importers
 * detect sections from blank-line-separated blocks, and RAG chunking splits on
 * them. The old single-blob output gave them nothing to work with.
 */
export function renderPageText(
  items: readonly PdfTextItemLike[] | null | undefined,
  options: RenderPageTextOptions = {},
): string {
  const { paragraphGapEm = 1.6, ...lineOptions } = options;
  const lines = buildPageLines(items, lineOptions);
  if (!lines.length) return '';

  const out: string[] = [];
  let previous: PdfLine | null = null;

  for (const line of lines) {
    if (previous) {
      const changedOrientation = previous.rotation !== line.rotation;
      const height = Math.max(previous.fontSize, line.fontSize, 1);
      const gap = previous.y - line.y;
      if (changedOrientation || (paragraphGapEm > 0 && gap > height * paragraphGapEm)) {
        out.push('');
      }
    }
    out.push(line.text);
    previous = line;
  }

  return out.join('\n');
}
