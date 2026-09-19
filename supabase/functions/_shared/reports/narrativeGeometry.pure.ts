/**
 * What a run of Markdown costs on ONE template's page, in that template's own
 * lines.
 *
 * ## Why the block has to know its geometry
 *
 * The markdown block packs a report's prose into page buckets by estimated
 * lines (`markdownPaging.pure.ts`) and every deployed master reserves a fixed
 * run of pages for it. The estimate was calibrated once — one family's face at
 * one size over one measure — and then held back 16% to survive the pages it
 * still got wrong. Every other family sets a different face at a different
 * size over a different measure, and the block's own inline styles (heading
 * scale, list indent, cell padding, figure width) decide what each kind of
 * block really costs. Measured through the real journey on 14 Sep 2026 the
 * long reference report ran its narrative to y≈810pt on sixteen consecutive
 * pages of a Midnight render — through the running foot at 820 — because a
 * gauge was charged at 62% of its printed height, a one-line list item at 79%
 * of its own, and a page whose bottom the master sets at 744pt was packed to
 * 791.
 *
 * So the charge model is derived here from the geometry the block can read
 * off its own props — the measure, the body size, the leading, the face — and
 * from the styles `markdownBlock.html.ts` emits, which are declared ONCE, as
 * `MARKDOWN_TYPE`, so the block cannot style a heading one way and charge it
 * another. Every formula below was checked against the pinned engine with
 * `scripts/verify/report-pdf/measureNarrativeMetrics.py`, which sets each
 * probe with these exact styles and reads the height WeasyPrint gives it:
 * paragraph, headings, list, table, figure and callout all agree within 0.4%
 * of a line, and the two that did not (a lone list item's trailing margin,
 * which collapses into the list's; a wrapped item, which costs whole lines)
 * are the two rules written into `listCharge`.
 *
 * ## The page bottom is the master's, not the foot's
 *
 * A markdown block carries no `height` — the master sizes it to whatever is
 * left above `contentBottom`, which `investmentCompass/blocks.ts` defines as
 * `PAGE.height - margin - FOOTER_RESERVE`. The block knows neither number by
 * name, but the right margin is the page width less the block's own right
 * edge, and the reserve is a constant the two modules share. Packing to the
 * foot instead — the 22pt footer is at 820 — would put the last line of every
 * full page 76pt below where every other block on the page is allowed to end.
 *
 * ## Faces
 *
 * There is no text measurement in a pure module, so a face contributes one
 * number: its average advance over ordinary English prose, in ems, measured
 * with the pinned engine over eighty lines at three sizes (all within 1% of
 * each other). A face not in the table is charged at a WIDER advance than any
 * measured one, so an unknown family packs sparser rather than overflowing.
 */
import { COMPACT_FIGURE_FRACTION } from '../reportDesign/charts.pure.ts';

/**
 * The block's type scale — every value `markdownBlock.html.ts` puts on a tag,
 * so the styles and the charges are one declaration.
 */
export const MARKDOWN_TYPE = {
  heading: {
    2: { scale: 1.5, lineHeight: 1.25, marginTopPt: 0, marginBottomPt: 6 },
    3: { scale: 1.2, lineHeight: 1.3, marginTopPt: 8, marginBottomPt: 4 },
    4: { scale: 1.0, lineHeight: 1.3, marginTopPt: 8, marginBottomPt: 3 },
  },
  paragraph: { marginBottomPt: 6 },
  list: { marginBottomPt: 6, indentPt: 12, itemMarginBottomPt: 2 },
  table: { scale: 0.92, cellPaddingPt: 3, headRulePt: 0.75, rowRulePt: 0.5, marginBottomPt: 8 },
  figure: {
    marginTopPt: 6, marginBottomPt: 8, captionScale: 0.8, captionGapPt: 4,
    compactFraction: COMPACT_FIGURE_FRACTION,
  },
  callout: { paddingPt: 6, marginBottomPt: 8, labelScale: 0.8, labelGapPt: 3, rulePt: 1.5 },
  blockquote: { marginBottomPt: 6, paddingLeftPt: 8, rulePt: 1.5 },
  code: { scale: 0.85, paddingPt: 5, marginBottomPt: 6 },
  /** `::: pullquote` / `::: quote-page` — one sentence, set larger, behind a rule. */
  pullquote: {
    scale: 1.3, lineHeight: 1.35, paddingLeftPt: 10, rulePt: 2, marginTopPt: 8, marginBottomPt: 10,
    attributionScale: 0.8, attributionGapPt: 4,
  },
  /** `::: stat` / `::: divider` — a label, one oversized figure, a caption, inside rules. */
  stat: {
    valueScale: 2.4, valueLineHeight: 1.1, labelScale: 0.8, subScale: 0.85,
    paddingPt: 8, marginTopPt: 6, marginBottomPt: 10, gapPt: 3, rulePt: 0.75,
  },
} as const;

/** Average advance per em of ordinary prose, per face. Measured; see the header. */
export const FACE_ADVANCE_EM: Readonly<Record<string, number>> = {
  // Re-measured on real report prose (Chancery, 14 Sep 2026): six full lines
  // of a location list set at 0.462–0.484 em; 0.49 charged Inter three per
  // cent tight.
  'inter': 0.48,
  'noto serif': 0.50,
  'lato': 0.45,
  'roboto': 0.46,
  'playfair display': 0.47,
  'ibm plex mono': 0.62,
};

/** Wider than every measured face: an unknown family packs sparser, never tighter. */
export const UNKNOWN_FACE_ADVANCE_EM = 0.52;

/** The first family of a CSS font-family list, lower-cased and unquoted. */
export function primaryFace(family: string | null | undefined): string | null {
  const first = String(family ?? '').split(',')[0]?.trim().replace(/^['"]|['"]$/g, '').trim();
  return first ? first.toLowerCase() : null;
}

export function faceAdvanceEm(family: string | null | undefined): number {
  const face = primaryFace(family);
  return (face && FACE_ADVANCE_EM[face]) || UNKNOWN_FACE_ADVANCE_EM;
}

/** `FOOTER_RESERVE` in `scripts/template-library/investmentCompass/blocks.ts`. */
export const NARRATIVE_FOOT_RESERVE_PT = 30;

/**
 * The fraction of a page's lines a bucket may not use. The charges are within
 * half a line of the engine block for block; what this covers is the line
 * breaking a character count cannot see — a paragraph of long words, a run of
 * bold — which is worth about a line and a half over a full page.
 */
export const NARRATIVE_HOLDBACK = 0.06;

/** One markdown block instance's box, as its props state it. */
export interface NarrativeBox {
  x: number;
  y: number;
  width: number;
  bodyPt: number;
  lineHeight: number;
  /** The body face, as a CSS font-family list or a bare family name. */
  face?: string | null;
}

export interface PageSize {
  width: number;
  height: number;
}

/** What one template's narrative run costs and holds, in that template's lines. */
export interface NarrativeGeometry {
  bodyPt: number;
  lineHeight: number;
  widthPt: number;
  /** Characters of ordinary prose one full-measure line holds at this face. */
  charsPerLine: number;
  /** Lines the first page's box holds, after the holdback. */
  firstPageLines: number;
  /** Lines a continuation page's box holds, after the holdback. */
  contLines: number;
}

/** The master's own content bottom, recovered from the block's right edge. */
export function narrativeBottom(box: Pick<NarrativeBox, 'x' | 'width'>, page: PageSize): number {
  const rightMargin = Math.max(0, page.width - box.x - box.width);
  return page.height - rightMargin - NARRATIVE_FOOT_RESERVE_PT;
}

export const pitchPt = (g: Pick<NarrativeGeometry, 'bodyPt' | 'lineHeight'>): number => g.bodyPt * g.lineHeight;

/**
 * A scaled size as the block writes it: `markdownBlock.html.ts` emits every
 * derived font size to a tenth of a point (`toFixed(1)`), and 8.75 × 0.92 is
 * 8.05 on paper but 8.1 in the stylesheet — a third of a point across four
 * table rows, which is the difference between charging a row and drawing it.
 */
export const scaledPt = (bodyPt: number, scale: number): number => Math.round(bodyPt * scale * 10) / 10;

const linesOf = (g: Pick<NarrativeGeometry, 'bodyPt' | 'lineHeight'>, pt: number): number => pt / pitchPt(g);

function boxLines(box: NarrativeBox, page: PageSize): number {
  const height = narrativeBottom(box, page) - box.y;
  const pitch = box.bodyPt * box.lineHeight;
  if (!(height > 0) || !(pitch > 0)) return 1;
  return Math.max(1, Math.floor((height / pitch) * (1 - NARRATIVE_HOLDBACK)));
}

/**
 * The geometry of a narrative run from its first instance and one
 * continuation. Every instance of the run must be handed the SAME geometry,
 * because each packs the whole source independently and a bucket boundary
 * that differs between two instances prints a line twice or not at all —
 * which is why the renderer computes it once, from the template, rather than
 * each block from its own box.
 */
export function narrativeGeometry(first: NarrativeBox, cont: NarrativeBox | null, page: PageSize): NarrativeGeometry {
  const body = first.bodyPt;
  const lineHeight = first.lineHeight;
  const widthPt = first.width;
  const advance = faceAdvanceEm(first.face);
  const charsPerLine = Math.max(20, widthPt / (body * advance));
  return {
    bodyPt: body,
    lineHeight,
    widthPt,
    charsPerLine,
    firstPageLines: boxLines(first, page),
    contLines: boxLines(cont ?? first, page),
  };
}

// ── Charges, in body lines ──────────────────────────────────────────────────

/** Whole lines of prose at a fraction of the measure. */
function textLines(g: NarrativeGeometry, chars: number, measureFraction = 1): number {
  const cpl = Math.max(8, g.charsPerLine * measureFraction);
  return Math.max(1, Math.ceil(Math.max(0, chars) / cpl));
}

/** A pull quote: its sentence at the quote scale behind a rule, and its attribution. */
export function pullQuoteCharge(g: NarrativeGeometry, chars: number, attributionChars = 0): number {
  const q = MARKDOWN_TYPE.pullquote;
  const measure = Math.max(0.3, (g.widthPt - q.paddingLeftPt - q.rulePt) / g.widthPt);
  const perLine = Math.max(8, (g.charsPerLine * measure) / q.scale);
  const lines = Math.max(1, Math.ceil(Math.max(0, chars) / perLine));
  let pt = lines * scaledPt(g.bodyPt, q.scale) * q.lineHeight + q.marginTopPt + q.marginBottomPt;
  if (attributionChars > 0) pt += scaledPt(g.bodyPt, q.attributionScale) * g.lineHeight + q.attributionGapPt;
  return linesOf(g, pt);
}

/** A stat card: label, the figure at display size, a caption, a divider's headline. */
export function statCharge(g: NarrativeGeometry, parts: { label: boolean; sub: boolean; headlineChars?: number }): number {
  const st = MARKDOWN_TYPE.stat;
  let pt = st.marginTopPt + st.marginBottomPt + 2 * st.paddingPt + 2 * st.rulePt;
  pt += scaledPt(g.bodyPt, st.valueScale) * st.valueLineHeight;
  if (parts.label) pt += scaledPt(g.bodyPt, st.labelScale) * g.lineHeight + st.gapPt;
  if (parts.sub) pt += scaledPt(g.bodyPt, st.subScale) * g.lineHeight + st.gapPt;
  if (parts.headlineChars && parts.headlineChars > 0) {
    const measure = Math.max(0.3, (g.widthPt - 2 * st.paddingPt) / g.widthPt);
    pt += textLines(g, parts.headlineChars, measure) * pitchPt(g) + st.gapPt;
  }
  return linesOf(g, pt);
}

export function paragraphCharge(g: NarrativeGeometry, chars: number): number {
  return textLines(g, chars) + linesOf(g, MARKDOWN_TYPE.paragraph.marginBottomPt);
}

/**
 * A heading's top margin collapses with the paragraph margin above it, so only
 * what exceeds a paragraph's own margin is new space on the page.
 */
export function headingCharge(g: NarrativeGeometry, level: 2 | 3 | 4, chars: number): number {
  const h = MARKDOWN_TYPE.heading[level];
  const lines = textLines(g, chars, 1 / h.scale);
  const glyphs = lines * h.lineHeight * scaledPt(g.bodyPt, h.scale);
  const top = Math.max(0, h.marginTopPt - MARKDOWN_TYPE.paragraph.marginBottomPt);
  return linesOf(g, glyphs + top + h.marginBottomPt);
}

export interface ListItemShape {
  chars: number;
  depth: number;
}

/**
 * A list item's line breaking is a little worse than prose: the bold lead-in
 * models write, the em dashes, the place names. Measured on a real 28-item
 * nested list (14 Sep 2026) the engine set 73 lines of items at 77 charged
 * lines of text — this factor closes that.
 */
export const LIST_WRAP_LOSS = 1.06;

/**
 * A list item sets at the measure less its indent, and a wrapped item costs
 * whole lines. The last item's margin collapses into the list's own, so the
 * items contribute one fewer margin than there are items; a nested list
 * collapses its parent item's and its last item's margins into its own, so
 * it adds what its margin exceeds those two by. Measured: three top items
 * each over two nested two-line items set at 16.63 lines, which is exactly
 * that arithmetic.
 */
export function listCharge(g: NarrativeGeometry, items: readonly ListItemShape[]): number {
  if (!items.length) return 0;
  const { indentPt, itemMarginBottomPt, marginBottomPt } = MARKDOWN_TYPE.list;
  let lines = 0;
  let nested = 0;
  items.forEach((it, i) => {
    const measure = Math.max(0.3, (g.widthPt - indentPt * (Math.max(0, it.depth) + 1)) / g.widthPt);
    lines += textLines(g, it.chars * LIST_WRAP_LOSS, measure);
    if (i > 0 && it.depth > items[i - 1].depth) nested += 1;
  });
  const nestedExtra = nested * Math.max(0, marginBottomPt - 2 * itemMarginBottomPt);
  return lines + linesOf(g, (items.length - 1) * itemMarginBottomPt + marginBottomPt + nestedExtra);
}

/** How many lines a callout's or sidenote's list items take, inside its padding. */
export function calloutCharge(g: NarrativeGeometry, itemChars: readonly number[]): number {
  const c = MARKDOWN_TYPE.callout;
  const inner = Math.max(0.3, (g.widthPt - 2 * c.paddingPt - c.rulePt - MARKDOWN_TYPE.list.indentPt) / g.widthPt);
  let lines = 0;
  for (const chars of itemChars) lines += textLines(g, chars, inner);
  const label = scaledPt(g.bodyPt, c.labelScale) * g.lineHeight + c.labelGapPt;
  // Inside a padded box the last item's margin has nothing to collapse into,
  // so every item pays its own — unlike a list in the flow (`listCharge`).
  const chrome = 2 * c.paddingPt + c.marginBottomPt
    + itemChars.length * MARKDOWN_TYPE.list.itemMarginBottomPt;
  return lines + linesOf(g, label + chrome);
}

/** A sidenote is a callout whose body is paragraphs rather than items. */
export function sidenoteCharge(g: NarrativeGeometry, paragraphChars: readonly number[]): number {
  const c = MARKDOWN_TYPE.callout;
  const inner = Math.max(0.3, (g.widthPt - 2 * c.paddingPt - c.rulePt) / g.widthPt);
  let lines = 0;
  for (const chars of paragraphChars) lines += textLines(g, chars, inner);
  const label = scaledPt(g.bodyPt, c.labelScale) * g.lineHeight + c.labelGapPt;
  const margins = paragraphChars.length * MARKDOWN_TYPE.paragraph.marginBottomPt;
  return lines + linesOf(g, label + 2 * c.paddingPt + c.marginBottomPt + margins);
}

/**
 * A table's rows, charged the way auto layout sets them.
 *
 * Auto layout gives every column at least its longest word, then shares what
 * is left of the measure by how much each column has to say — so the
 * "Why it matters" column of a five-column risk register gets a third of the
 * measure and its 300-character cell wraps to eleven lines, while the same
 * characters charged against the whole measure came to seven. Measured
 * against the engine (`measureNarrativeMetrics.py`, 14 Sep 2026): the share
 * is damped (`TABLE_SHARE_EXPONENT`), because the engine gives the largest
 * column a little less than its raw share, and a narrow column wraps a
 * little worse than its width says (`TABLE_WRAP_LOSS`).
 */
export const TABLE_SHARE_EXPONENT = 0.8;
export const TABLE_WRAP_LOSS = 1.12;
/** Horizontal cell padding as the block styles it (`padding: 3pt 4pt`). */
const TABLE_H_PADDING_PT = 8;

export interface TableCharge {
  /** Body lines each row costs, in row order. */
  rowLines: number[];
  /** Body lines the head row plus the table's margin cost. */
  headLines: number;
  total: number;
}

const plainCell = (cell: unknown): string => String(cell ?? '')
  .replace(/<[^>]+>/g, '')
  .replace(/[*_`]/g, '')
  .trim();

export function tableCharge(g: NarrativeGeometry, cells: readonly (readonly string[])[], columns: number): TableCharge {
  const t = MARKDOWN_TYPE.table;
  const cellPt = scaledPt(g.bodyPt, t.scale);
  const cellLine = (cellPt * g.lineHeight) / pitchPt(g);
  // Points per character at the cell size: the geometry's own advance.
  const advanceEm = g.widthPt / (g.bodyPt * g.charsPerLine);
  const charPt = Math.max(1, cellPt * advanceEm);
  const cols = Math.max(1, Math.floor(columns));

  const minWidth = new Array<number>(cols).fill(charPt * 2 + TABLE_H_PADDING_PT);
  const content = new Array<number>(cols).fill(0);
  const texts = cells.map((row) => Array.from({ length: cols }, (_, i) => plainCell(row[i])));
  for (const row of texts) {
    row.forEach((text, i) => {
      const longest = text.split(/\s+/).reduce((m, w) => Math.max(m, w.length), 0);
      minWidth[i] = Math.max(minWidth[i], longest * charPt + TABLE_H_PADDING_PT);
      content[i] = Math.max(content[i], text.length);
    });
  }
  const free = Math.max(0, g.widthPt - minWidth.reduce((a, b) => a + b, 0));
  const shares = content.map((c) => Math.pow(Math.max(1, c), TABLE_SHARE_EXPONENT));
  const shareSum = shares.reduce((a, b) => a + b, 0) || 1;
  const width = minWidth.map((w, i) => w + (free * shares[i]) / shareSum);

  const padPt = 2 * t.cellPaddingPt;
  const rowLines = texts.map((row) => {
    let lines = 1;
    row.forEach((text, i) => {
      const perLine = Math.max(4, (width[i] - TABLE_H_PADDING_PT) / charPt);
      lines = Math.max(lines, Math.ceil((text.length * TABLE_WRAP_LOSS) / perLine));
    });
    return lines * cellLine + linesOf(g, padPt + t.rowRulePt);
  });
  const headLines = cellLine + linesOf(g, padPt + t.headRulePt + t.marginBottomPt);
  return { rowLines, headLines, total: headLines + rowLines.reduce((a, b) => a + b, 0) };
}

/**
 * A figure prints at the measure (or the compact fraction of it) at its own
 * aspect ratio, with the block's figure margins and, when captioned, a caption
 * line at the caption scale.
 */
export function figureCharge(
  g: NarrativeGeometry,
  heightOverWidth: number,
  compact: boolean,
  captioned: boolean,
): number {
  const f = MARKDOWN_TYPE.figure;
  const ratio = Number.isFinite(heightOverWidth) && heightOverWidth > 0 ? heightOverWidth : 0.5;
  const printed = g.widthPt * (compact ? f.compactFraction : 1) * ratio;
  const caption = captioned ? f.captionGapPt + scaledPt(g.bodyPt, f.captionScale) * g.lineHeight : 0;
  return linesOf(g, printed + f.marginTopPt + f.marginBottomPt + caption);
}

/** A fenced block: its lines at the code scale, padded and margined. */
export function codeCharge(g: NarrativeGeometry, lines: number): number {
  const c = MARKDOWN_TYPE.code;
  const codeLine = (scaledPt(g.bodyPt, c.scale) * g.lineHeight) / pitchPt(g);
  return Math.max(1, lines) * codeLine + linesOf(g, 2 * c.paddingPt + c.marginBottomPt);
}
