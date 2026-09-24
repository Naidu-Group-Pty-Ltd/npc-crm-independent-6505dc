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
 *
 * 4%, two lines on the 50-line page the Board Pack Brief master sets. It was
 * 6% — three and a quarter lines, twice what this comment says it covers —
 * and on the five documents issued on 23 Sep 2026 that was 41pt of white at
 * the foot of every body page, on top of the reserve under the box, on a
 * document the owner sent back for its white space. 3% was tried first and a
 * prose page of the 18 Annabelle Crescent Compass set two lines past its box
 * (still 15pt clear of the running foot); two lines of holdback plus the
 * untouched reserve keep even that page, AND the three-line tail
 * `absorbTail` folds onto a page, above the foot.
 */
export const NARRATIVE_HOLDBACK = 0.02;

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
  /**
   * The body face, as the box stated it. Prose is charged by
   * `charsPerLine`; a table is charged character by character at the face's
   * measured class widths (`FACE_CLASS_ADVANCE_EM`), and an absent face is
   * charged at the widest.
   */
  face?: string | null;
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
/**
 * The fewest lines worth opening the report body in, on a page it SHARES.
 *
 * A master may set the body's first box in the room a summary leaves above it
 * (the tiers whose front matter flows into the report — see `flowLayout.ts`).
 * Where that room is a sliver, opening there puts a heading and a line at the
 * foot of the summary and the rest overleaf, which is worse than starting the
 * body on the next page — so a shared first box under this is not used and
 * the first bucket is empty. A first box on a page of its own is never
 * affected: it is a whole page.
 */
export const MIN_SHARED_FIRST_LINES = 6;

export function narrativeGeometry(first: NarrativeBox, cont: NarrativeBox | null, page: PageSize): NarrativeGeometry {
  const body = first.bodyPt;
  const lineHeight = first.lineHeight;
  const widthPt = first.width;
  const advance = faceAdvanceEm(first.face);
  const charsPerLine = Math.max(20, widthPt / (body * advance));
  const contLines = boxLines(cont ?? first, page);
  const opening = boxLines(first, page);
  // Shared when the first box starts well below where a continuation's does.
  const shared = cont !== null && first.y > cont.y + pitchPt(first) * 2;
  return {
    bodyPt: body,
    lineHeight,
    widthPt,
    charsPerLine,
    firstPageLines: shared && opening < MIN_SHARED_FIRST_LINES ? 0 : opening,
    contLines,
    ...(first.face ? { face: first.face } : {}),
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
 * What a table cell is made of, by the width its characters take.
 *
 * A table is not prose. Its cells are figures, dates, capitalised names and
 * short labels, and a prose average charges them wrong in both directions: a
 * digit is a fifth wider than an average prose character, so a column of
 * `$1,192,000` and `7 Aug 2026` sets wider than the average says, while a
 * 300-character reason in a risk register sets narrower. Measured with the
 * pinned engine on 23 Sep 2026 — each class set on one unbroken line at 20pt,
 * per face, at the three weights the block sets a table in (400 in a cell,
 * 500 for the row label, 600 for the column head; a face with no such weight
 * falls back exactly as the engine does, which is why Noto Serif's 500 reads
 * as its 400). `lower` is weighted by English letter frequency; `upper`,
 * `digit` and `punct` are uniform over their sets.
 */
export interface ClassAdvance {
  lower: number;
  upper: number;
  digit: number;
  space: number;
  punct: number;
  dash: number;
}
export type TableWeight = 400 | 500 | 600;

export const FACE_CLASS_ADVANCE_EM: Readonly<Record<string, Readonly<Record<TableWeight, ClassAdvance>>>> = {
  'inter': {
    400: { lower: 0.515, upper: 0.681, digit: 0.592, space: 0.281, punct: 0.432, dash: 0.75 },
    500: { lower: 0.523, upper: 0.688, digit: 0.601, space: 0.267, punct: 0.441, dash: 0.75 },
    600: { lower: 0.532, upper: 0.694, digit: 0.61, space: 0.252, punct: 0.451, dash: 0.75 },
  },
  'noto serif': {
    400: { lower: 0.524, upper: 0.668, digit: 0.559, space: 0.26, punct: 0.398, dash: 0.75 },
    500: { lower: 0.524, upper: 0.668, digit: 0.559, space: 0.26, punct: 0.398, dash: 0.75 },
    600: { lower: 0.561, upper: 0.707, digit: 0.559, space: 0.26, punct: 0.429, dash: 0.75 },
  },
  'lato': {
    400: { lower: 0.475, upper: 0.663, digit: 0.58, space: 0.256, punct: 0.376, dash: 0.687 },
    500: { lower: 0.477, upper: 0.665, digit: 0.58, space: 0.253, punct: 0.378, dash: 0.687 },
    600: { lower: 0.48, upper: 0.668, digit: 0.58, space: 0.249, punct: 0.381, dash: 0.688 },
  },
  'roboto': {
    400: { lower: 0.484, upper: 0.634, digit: 0.562, space: 0.248, punct: 0.365, dash: 0.719 },
    500: { lower: 0.489, upper: 0.638, digit: 0.568, space: 0.249, punct: 0.378, dash: 0.709 },
    600: { lower: 0.492, upper: 0.641, digit: 0.574, space: 0.249, punct: 0.39, dash: 0.698 },
  },
};

/**
 * For a face not in the table: every class at the WIDEST any measured face
 * sets it, so an unknown family's tables pack sparser rather than overflowing
 * — the rule `UNKNOWN_FACE_ADVANCE_EM` applies to prose.
 */
export const UNKNOWN_FACE_CLASS_ADVANCE_EM: Readonly<Record<TableWeight, ClassAdvance>> = (() => {
  const faces = Object.values(FACE_CLASS_ADVANCE_EM);
  const widest = (w: TableWeight): ClassAdvance => {
    const pick = (k: keyof ClassAdvance) => Math.max(...faces.map((f) => f[w][k]));
    return { lower: pick('lower'), upper: pick('upper'), digit: pick('digit'), space: pick('space'), punct: pick('punct'), dash: pick('dash') };
  };
  return { 400: widest(400), 500: widest(500), 600: widest(600) };
})();

export function faceClassAdvance(family: string | null | undefined): Readonly<Record<TableWeight, ClassAdvance>> {
  const face = primaryFace(family);
  return (face && FACE_CLASS_ADVANCE_EM[face]) || UNKNOWN_FACE_CLASS_ADVANCE_EM;
}

function classOf(ch: string): keyof ClassAdvance {
  if (ch >= 'a' && ch <= 'z') return 'lower';
  if (ch >= '0' && ch <= '9') return 'digit';
  if (ch === ' ') return 'space';
  if (ch === '—' || ch === '–') return 'dash';
  if (/[.,;:\-()/%$&'’"“”!?[\]]/.test(ch)) return 'punct';
  // Capitals — and anything unclassified (accented, symbols) charged as wide as one.
  return 'upper';
}

/**
 * Where a line may end inside a word: after a dash, and after a hyphen or a
 * slash that is not followed by a digit — the line-breaking rules the engine
 * applies (UAX #14: a break after `–` and `—`, none between a hyphen and a
 * number). Only real opportunities are listed, so a word is never charged as
 * narrower than the engine can set it.
 */
function breakPieces(word: string): string[] {
  const chars = [...word];
  const out: string[] = [];
  let piece = '';
  chars.forEach((ch, i) => {
    piece += ch;
    const next = chars[i + 1];
    if (next === undefined) return;
    if (ch === '—' || ch === '–' || ((ch === '-' || ch === '/') && !(next >= '0' && next <= '9'))) {
      out.push(piece);
      piece = '';
    }
  });
  if (piece) out.push(piece);
  return out;
}

/**
 * A table's rows, charged the way the engine sets them.
 *
 * ## Why the old model was replaced
 *
 * It charged each row from its characters against a damped share of the
 * measure, with a wrap-loss factor — calibrated once, on one five-column risk
 * register. Measured on 23 Sep 2026 against the pinned engine over every table
 * the ten S5 documents and the two stored reports draw (74 tables, 406 rows)
 * at fourteen of the geometries the masters set — every body face, from
 * 7.5pt over 509pt to 10.25pt over 437pt — it was wrong both ways at once: it
 * charged a risk register's long reasons up to two-thirds high, which is how
 * a table page came to end 40% empty, and it charged a two-column ledger's
 * wrapped labels as ONE line where the engine set two, on 35 of 1,036 tables
 * by as much as 3.7 lines, which is an overflow into the running foot.
 *
 * ## What it does now
 *
 * Exactly what the engine does (`auto_table_layout`, CSS 2.1 §17.5.2.2 as
 * WeasyPrint 69 implements it): every column's min-content width is its
 * longest unbreakable piece and its max-content width its longest cell set on
 * one line, head cells included, each plus the cell's padding; when the
 * max-contents do not fit the measure, each column gets its min-content plus
 * the SAME fraction of its (max − min) — a linear interpolation, not a share
 * by characters. Then each cell is wrapped greedily at its column's width,
 * word by word, at the character-class widths above. It reproduces the three
 * probes `narrativeGeometry.spec.ts` pins from the engine to the hundredth of
 * a line.
 *
 * A table the packer cuts across pages is a NEW table to the engine — each
 * chunk is laid out from its own rows, so its columns differ from the whole
 * table's (a chunk without the longest label gives that width to the reasons
 * beside it). The old model sliced the whole table's row charges, and on 250
 * chunks of that corpus (halves and thirds, 3,500 layouts) it was 9.7% high
 * and still left 50 chunks below the engine by up to 1.8 lines.
 * `splitTableBlock` therefore charges every chunk by calling this again on
 * the chunk's own rows.
 *
 * `TABLE_WIDTH_SAFETY` widens every character by 3%, for the metrics a class
 * average cannot see (an `m` is not an `i`) and the face revisions the
 * container may ship. At 3%: whole tables 3.8% high and chunks 4.3% high in
 * total, and not one of the 1,036 table layouts or 3,500 chunk layouts below
 * the engine by half a line. At 2% three chunks still were.
 */
export const TABLE_WIDTH_SAFETY = 1.03;
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
  .replace(/\s+/g, ' ')
  .trim();

/**
 * @param cells   each row's printed cell text, in column order
 * @param columns the table's column count
 * @param head    the column heads' printed text; a head that wraps costs lines too
 * @param caption the table's `<caption>`, when it carries one: set above the
 *                head at the table's size and leading, across the measure
 */
export function tableCharge(
  g: NarrativeGeometry,
  cells: readonly (readonly string[])[],
  columns: number,
  head: readonly string[] = [],
  caption = '',
): TableCharge {
  const t = MARKDOWN_TYPE.table;
  const cellPt = scaledPt(g.bodyPt, t.scale);
  const cellLine = (cellPt * g.lineHeight) / pitchPt(g);
  const cols = Math.max(1, Math.floor(columns));
  const advance = faceClassAdvance(g.face);

  const widthOf = (text: string, weight: TableWeight): number => {
    const a = advance[weight];
    let em = 0;
    for (const ch of text) em += a[classOf(ch)];
    return em * cellPt * TABLE_WIDTH_SAFETY;
  };
  const spaceOf = (weight: TableWeight): number => advance[weight].space * cellPt * TABLE_WIDTH_SAFETY;
  // The head is set at 600, the first cell of a row is its label at 500.
  const weightOf = (row: number, col: number): TableWeight => (row < 0 ? 600 : col === 0 ? 500 : 400);

  const headTexts = Array.from({ length: cols }, (_, i) => plainCell(head[i]));
  const texts = cells.map((row) => Array.from({ length: cols }, (_, i) => plainCell(row[i])));
  const words = (text: string) => (text ? text.split(' ') : []);

  const minContent = new Array<number>(cols).fill(TABLE_H_PADDING_PT);
  const maxContent = new Array<number>(cols).fill(TABLE_H_PADDING_PT);
  [headTexts, ...texts].forEach((row, r) => row.forEach((text, i) => {
    const weight = weightOf(r - 1, i);
    let min = 0;
    let max = 0;
    words(text).forEach((w, k) => {
      for (const piece of breakPieces(w)) min = Math.max(min, widthOf(piece, weight));
      max += widthOf(w, weight) + (k > 0 ? spaceOf(weight) : 0);
    });
    minContent[i] = Math.max(minContent[i], min + TABLE_H_PADDING_PT);
    maxContent[i] = Math.max(maxContent[i], max + TABLE_H_PADDING_PT);
  }));

  const sumMin = minContent.reduce((a, b) => a + b, 0);
  const sumMax = maxContent.reduce((a, b) => a + b, 0);
  const measure = g.widthPt;
  let width: number[];
  if (sumMax <= measure) width = maxContent.slice();
  else if (sumMin >= measure) width = minContent.slice();
  else {
    const r = (measure - sumMin) / (sumMax - sumMin);
    width = minContent.map((m, i) => m + (maxContent[i] - m) * r);
  }

  const linesIn = (text: string, col: number, weight: TableWeight): number => {
    const avail = width[col] - TABLE_H_PADDING_PT;
    const space = spaceOf(weight);
    let lines = 1;
    let x = -1;
    for (const w of words(text)) {
      breakPieces(w).forEach((piece, j) => {
        const pw = widthOf(piece, weight);
        if (x < 0) { x = pw; return; }
        const gap = j === 0 ? space : 0;
        if (x + gap + pw > avail + 0.01) { lines++; x = pw; } else x += gap + pw;
      });
    }
    return lines;
  };

  const padPt = 2 * t.cellPaddingPt;
  const rowLines = texts.map((row) => {
    let lines = 1;
    row.forEach((text, i) => { lines = Math.max(lines, linesIn(text, i, weightOf(0, i))); });
    return lines * cellLine + linesOf(g, padPt + t.rowRulePt);
  });
  let headRowLines = 1;
  headTexts.forEach((text, i) => { if (text) headRowLines = Math.max(headRowLines, linesIn(text, i, 600)); });
  // A caption is a block of its own above the head: it inherits the table's
  // size and leading and has no margin, so it costs its lines and nothing
  // else. Charged at the widest class widths the face has, because it is one
  // line of arbitrary words across the whole measure.
  const captionText = plainCell(caption);
  let captionLines = 0;
  if (captionText) {
    const perLine = Math.max(8, (measure / (cellPt * TABLE_WIDTH_SAFETY)) / Math.max(...Object.values(advance[400])));
    captionLines = Math.ceil(captionText.length / perLine) * cellLine;
  }
  const headLines = captionLines + headRowLines * cellLine + linesOf(g, padPt + t.headRulePt + t.marginBottomPt);
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
