/**
 * Markdown, as the report design system sets it.
 *
 * Written for the Report Q&A export, which was the first format whose payload
 * was prose rather than typed figures, and moved here when the Market
 * Intelligence report turned out to be the second. Both store model-authored
 * Markdown in a column and need it turned into the system's own HTML without
 * either losing what the model said or letting it say anything.
 *
 * The move is the same one `neutraliseUrls` made for the same reason: two
 * callers is where a second copy starts, and a second Markdown parser is a
 * second set of the defects recorded below.
 *
 * ## What the record actually contains
 *
 * Measured across the 562 assistant answers in `report_qa_messages`
 * (`coalesce(edited_content, content)`), because a grammar guessed from
 * CommonMark would be both too large and, in two places, too small:
 *
 * | construct | answers |     | construct | answers |
 * | --- | --- | --- | --- | --- |
 * | inline bold | 392 (70%) |  | blockquote | 18 |
 * | bullet list | 321 (57%) |  | inline code | 6 |
 * | ATX heading | 270 (48%) |  | fenced code | 6 |
 * | inline italic | 193 (34%) || thematic break | 3 |
 * | ordered list | 181 (32%) || bare URL | 7 |
 * | pipe table | 105 (19%) |  | markdown link | **0** |
 * | smart punctuation | 389 || markdown image | 1 |
 *
 * Heading levels used: `#` 290, `##` 1,214, `###` 1,536, `####` 192, `#####` 5.
 * Tables run to **14 columns** and 101 rows. Dingbats appear in 98 answers,
 * arrows in 89, **variation selector 16 in 93**, pictographs in 16.
 *
 * ## Three rules the stylesheet imposes
 *
 * `css.pure.ts` styles `h1, h2, h3` (`:635`), `h4` (`:649`), `p` (`:660`),
 * `strong` (`:666`), `em` (`:667`), `a` (`:668`), `ul, ol` (`:673`), `li`
 * (`:674`) and the whole `table.data` system (`:239-344`). It styles **nothing**
 * for `h5`, `h6`, `blockquote` as an element, `code`, `pre`, `hr` or `img`.
 *
 * 1. **`h4` is not a small heading.** It is IBM Plex Mono, uppercase, tracked,
 *    at caption size — the comment at `css.pure.ts:647` says it is the same
 *    object as `.eyebrow`. It is a real level to demote onto, but it reads as a
 *    labelled sub-section, which is why the clamp stops there rather than
 *    marching on into unstyled `h5`.
 * 2. **`<pre>` is disqualified.** WeasyPrint's UA sheet gives it
 *    `white-space: pre`, and there is no `overflow-wrap` or `word-break` rule
 *    anywhere in the sheet — so a 120-character line of JSON would run off the
 *    trim edge of a client's document. A fenced block becomes a callout of
 *    `<code>` separated by `<br>`, which wraps.
 * 3. Everything the sheet already styles is emitted as that element. Only the
 *    unstyled constructs go through a primitive, whose *classes* it does style.
 *
 * ## Never repairs, and never throws
 *
 * The block scan is one left-to-right pass in the house style of
 * `propertyComparison/salvage.pure.ts:180`. A table without a delimiter row is
 * not a table; seven hashes are not a heading; a ten-digit ordinal is not a
 * list. Each falls through to a paragraph, which is the honest reading of what
 * was written. Nothing is fabricated to make a construct parse.
 *
 * And nothing throws. A caller who hands over 350 KB gets a truncated document
 * and a notice saying so — the same choice `measure.pure.ts:249` makes returning
 * `null` rather than throwing, and for the same reason: a pure formatter that
 * throws takes the whole render down and the caller has no better recovery.
 */
import {
  escapeHtml,
  renderCallout,
  renderDataTable,
  renderPage,
  renderPullQuote,
  renderSidenote,
  renderStatCard,
  type TableColumn,
  type TableRow,
} from '../reportDesign/primitives.pure.ts';
import { countUrlTokens, neutraliseUrls } from './text.pure.ts';
import {
  codeCharge, headingCharge, listCharge, paragraphCharge, pullQuoteCharge, sidenoteCharge, statCharge, tableCharge,
  type NarrativeGeometry,
} from './narrativeGeometry.pure.ts';
import { statCardHasValue } from './investment/blockHygiene.pure.ts';
import {
  directiveOnlyBlock,
  scanVizDirectives,
  type VizDirective,
} from './vizDirectives.pure.ts';

// ── Bounds ──────────────────────────────────────────────────────────────────

/**
 * The unit of work is one message, not one conversation.
 *
 * The largest conversation in the record is 354,406 characters, but the caller
 * renders per turn, so the number this has to survive is the largest single
 * answer: 33,377. This is twice that, and it is deliberately the same figure as
 * `MAX_SALVAGE_CHARS` (`propertyComparison/salvage.pure.ts:49`) — a cap rather
 * than a guess, bounding a linear scan at a size no legitimate input approaches.
 *
 * The conversation-level budget is a different question and lives in
 * `normalise.pure.ts`, where the turns are.
 */
export const MAX_MARKDOWN_CHARS = 65_536;

/** A p90 answer is 60–120 blocks. This is a runaway guard, not a budget. */
export const MAX_BLOCKS = 400;
export const MAX_HEADINGS = 100;
/** Per list, not per document. */
export const MAX_LIST_ITEMS = 200;
/**
 * `ul, ol { padding-left: 14pt }` (`css.pure.ts:673`), so depth 4 has consumed
 * 56pt ≈ 20mm of a 174mm measure and reads as broken in a print column. Deeper
 * items are flattened onto this depth — the content is real, only the indent is
 * not printable.
 */
export const MAX_LIST_DEPTH = 3;
export const MAX_TABLE_ROWS = 120;
/**
 * `renderBandedMatrix`'s own landscape budget (`primitives.pure.ts:461`): twelve
 * columns is 42pt each portrait and 63pt across the long edge. Not chosen here —
 * inherited from the one place in the design system that already measured it.
 */
export const MAX_TABLE_COLS = 12;
/**
 * `TEXT_BLOCK.widthMm = 174` (`page.pure.ts:41`). At seven columns a prose cell
 * gets 24.9mm ≈ 70pt and wraps to three lines, so seven is where a table stops
 * fitting the portrait measure and starts needing the long edge.
 */
export const MAX_PORTRAIT_TABLE_COLS = 6;
export const MAX_CODE_LINES = 60;

/**
 * What a landscape table costs on top of its own rows.
 *
 * `renderPage('landscape-table', …)` opens a page of its own, so the portrait
 * flow breaks before it and resumes after it — two page boundaries the row count
 * knows nothing about. Measured: a chapter whose only content was one
 * eleven-column table claimed one page and printed two more than that; charging it one page of
 * lines closes the gap exactly.
 */
export const LANDSCAPE_BREAK_LINES = 38;

/**
 * Above this many characters in one text run, emphasis is not parsed and the
 * markers are stripped instead.
 *
 * The emphasis patterns are lazy, so a run with many markers costs
 * markers × length. `MAX_INLINE_MARKERS` is the real guard; this is the second
 * one, because a single 20,000-character paragraph is already eight printed
 * pages and nothing legitimate is one.
 */
export const MAX_INLINE_CHARS = 20_000;
/** Ordinary prose carries a handful. Four hundred is adversarial input. */
export const MAX_INLINE_MARKERS = 400;

/**
 * `page.pure.ts:26` states the 18mm side margins "keep the measure near 65
 * characters at 10.5pt". Used to estimate rendered lines so the caller can
 * compute a page count before the render rather than after it.
 */
export const CHARS_PER_LINE = 65;

/**
 * The measured measure, for the calibrated charge model.
 *
 * `scripts/reports/markdownCalibration.mts` rendered a 390-character paragraph
 * through the real seeded Compass master on the pinned engine: it wraps at
 * ~98 characters per line, not 65. 95 keeps 3% in hand for a family that sets
 * a slightly larger body face. Only `charging: 'measured'` reads this; the
 * legacy model keeps 65 so every uncalibrated caller stays byte-identical.
 */
export const MEASURED_CHARS_PER_LINE = 95;

/**
 * How block line-costs are estimated.
 *
 * `legacy` is the pre-calibration arithmetic, unchanged to the byte — it is
 * what every deployed master not yet on a narrative profile expects. `measured`
 * is the 2026-09 calibration: real characters-per-line, half-line rounding,
 * a measured paragraph margin (~0.36 rendered lines → charged 0.4), a measured
 * heading cost (~1.67 → charged 1.5), and per-row table charges that account
 * for cell wrapping — the miss that let a tall table be charged one line per
 * row, packed onto a page it could not fit, and clipped mid-row.
 */
export type ChargeModel = 'legacy' | 'measured';

/**
 * The third model is not a member of `ChargeModel`: it is selected by passing
 * a `geometry` (see `MarkdownOptions.geometry`), because it is not a set of
 * constants but a function of ONE template's page — its measure, body size,
 * leading and face — and there is no meaningful value of it without one.
 */

/**
 * Body lines that fit one page.
 *
 * The other half of the same measurement, and it lives beside it for that
 * reason. `TEXT_BLOCK.heightMm` is 253mm ≈ 717pt; body copy is 10.5pt on roughly
 * 15.5pt of leading, which is 46 lines with nothing else on the page. Real pages
 * carry headings, table furniture and callout padding — all of which this module
 * already charges for in its own block line counts — so the working figure is
 * lower than that arithmetic ceiling.
 *
 * **Pinned by render, not by arithmetic.** Ten Report Q&A fixtures through
 * WeasyPrint matched their claimed page counts exactly at 38, and the Market
 * Intelligence fixtures were checked against the same figure.
 */
export const LINES_PER_PAGE = 38;

/** A section always claims at least one page, because its header opens one. */
export const MIN_SECTION_PAGES = 1;

/**
 * Below this, a chapter cannot hold a page on its own.
 *
 * Half of `LINES_PER_PAGE`. Arrived at by the converted-template format and
 * moved here when the investment format needed the same rule — the number is
 * about the page, not about either format.
 *
 * Its history is the point. The first value was twelve — a third of a page,
 * reasoned from "a heading, a short paragraph and a couple of bullets" rather
 * than measured. Then the document was rendered and the pages counted: a
 * section of three ordinary paragraphs costs fourteen estimated lines, cleared
 * the threshold, and printed on a sheet of its own at **2.3% ink**. Three
 * consecutive sheets did. The rubric's sparse floor is 8% and a natively
 * designed page in this system measures 13.3% to 22.1%, so a third of a page is
 * not the boundary between "deliberate" and "unfinished" — it is well inside
 * "unfinished".
 */
export const THIN_CHAPTER_LINES = Math.round(LINES_PER_PAGE / 2);

/** Lines to pages, floored at one. The one conversion both formats do. */
export function pagesForLines(lines: number): number {
  return Math.max(MIN_SECTION_PAGES, Math.ceil(lines / LINES_PER_PAGE));
}

// ── Glyphs ──────────────────────────────────────────────────────────────────

/**
 * Codepoints removed before anything else looks at the text.
 *
 * **Variation selector 16 is the highest-value entry here — 93 answers.** It
 * asks for the emoji presentation of a character that has a perfectly good text
 * form, and the container installs no colour-emoji font
 * (`typography.pure.ts:46-56`), so the engine either ignores it or draws
 * `.notdef`. Removing it turns `⚠️` into `⚠`, which DejaVu Sans sets correctly,
 * and `1️⃣` into `1`. It costs nothing and fixes a fifth of the corpus.
 *
 * The bidi controls are here for a second reason: they reorder text on a
 * document a client relies on, which is a spoofing vector rather than a
 * typographic one.
 */
function isStripped(cp: number): boolean {
  if (cp === 0x09 || cp === 0x0a) return false;
  if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return true; // C0 / C1
  if (cp >= 0x200b && cp <= 0x200f) return true; // ZWSP, ZWNJ, ZWJ, LRM, RLM
  if (cp >= 0x202a && cp <= 0x202e) return true; // bidi embedding / override
  if (cp >= 0x2060 && cp <= 0x2064) return true; // word joiner, invisible ops
  if (cp === 0x20e3) return true; // combining keycap
  if (cp === 0xfe0e || cp === 0xfe0f) return true; // variation selectors 15/16
  if (cp === 0xfeff) return true; // BOM / ZWNBSP
  if (cp >= 0x1f1e6 && cp <= 0x1f1ff) return true; // regional indicators
  if (cp >= 0x1f3fb && cp <= 0x1f3ff) return true; // skin tone modifiers
  return false;
}

/**
 * Symbol blocks with no coverage in any installed text face.
 *
 * **This list is what the pass is about, and getting its shape wrong is a real
 * defect I shipped and then found by looking at a page.** The first version
 * dropped everything at or above U+2600 unless it was explicitly kept — which
 * reads as a safe allow-list and is not one, because Han starts at U+4E00. A
 * rendered proof carried `A non-Latin name: 李小龍 and Ελληνικά`, and the page came
 * back reading `A non-Latin name: and Ελληνικά`. The name was gone. That is
 * precisely the over-reach this module criticises `sanitizeForPDF` for, arrived
 * at from the other direction, and the container installs `fonts-noto-cjk`
 * (`typography.pure.ts:54`) to stop exactly it.
 *
 * So the rule is: **scripts are open-ended and are kept; symbol blocks are
 * finite and are enumerated.** Everything not in one of these ranges survives,
 * which means Greek, Cyrillic, Han, Hangul, Arabic, Hebrew and Devanagari all
 * reach the page and are set by DejaVu or Noto. Inside these ranges a codepoint
 * survives only if `KEEP_SYMBOLS` names it or `TRANSLITERATE` maps it.
 */
const SYMBOL_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x2600, 0x27bf], // Miscellaneous Symbols, Dingbats
  [0x2b00, 0x2bff], // Miscellaneous Symbols and Arrows
  [0xe000, 0xf8ff], // Private use — no agreed meaning, and a font may draw anything
  [0xfff0, 0xffff], // Specials, including the replacement character
  [0x1f000, 0x1faff], // Every pictograph block
];

const inSymbolRange = (cp: number): boolean =>
  SYMBOL_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);

/**
 * Symbols inside those ranges that survive.
 *
 * Short on purpose, and every one of them verified on a rendered page rather
 * than assumed from a font's advertised coverage — a substituted face still
 * produces a valid PDF, which is the trap `DESIGN_SYSTEM.md:345` records about
 * `pdffonts`.
 */
const KEEP_SYMBOLS = new Set<number>([
  0x2605, 0x2606, // ★ ☆
  0x260e, // ☎
  0x2610, 0x2611, 0x2612, // ☐ ☑ ☒
  0x2660, 0x2663, 0x2665, 0x2666, // ♠ ♣ ♥ ♦
  0x266a, 0x266b, // ♪ ♫
  0x26a0, // ⚠
  0x2713, 0x2714, 0x2715, 0x2716, 0x2717, 0x2718, // ✓ ✔ ✕ ✖ ✗ ✘
]);

/**
 * Emoji-presentation symbols that carry meaning a word would lose.
 *
 * Each maps onto something in `KEEP_SYMBOLS` or outside the symbol ranges
 * entirely, so the output alphabet never grows. `✅` and `❌` are the two
 * that matter: they are how a model says yes and no, and dropping them would
 * leave a bare table cell where a verdict was.
 */
const TRANSLITERATE: Readonly<Record<number, string>> = {
  0x2705: '✓', // ✅ -> ✓
  0x274c: '✗', // ❌ -> ✗
  0x274e: '✗', // ❎ -> ✗
  0x2b50: '★', // ⭐ -> ★
  0x2753: '?', 0x2754: '?',
  0x2755: '!', 0x2757: '!',
  0x27a1: '→', 0x2794: '→', 0x279c: '→', 0x27a4: '→',
  0x2b05: '←', 0x2b06: '↑', 0x2b07: '↓',
  0x2b1b: '■', 0x2b1c: '□',
  0x276f: '›', 0x276e: '‹',
  0x2726: '•', 0x2727: '•',
};

/**
 * The glyph pass.
 *
 * A codepoint is emitted unless it is in the strip set, or it falls in a symbol
 * range and is neither kept nor transliterated. Scripts are never touched.
 *
 * ## Where the prior art is right, and where it over-reaches
 *
 * `sanitizeForPDF` (`QAPDFGenerator.tsx:24-42`) ends in `[^\x00-\x7F]` with a
 * small Latin-1 keep-list, and the *architecture* is right: a deny-list of "bad
 * glyphs" can never be complete and its failure mode is tofu on a document a
 * client has already been sent. But it exists because jsPDF's built-in faces
 * genuinely cannot set U+2014, and against WeasyPrint it costs:
 *
 *  - `—` -> `--`, `…` -> `...`, curly quotes -> straight, on **389 of 562
 *    answers**, on a document whose entire premise is print typography;
 *  - `≤` -> `<=`, `→` -> `->`, `•` -> `-`, all fully covered by the installed faces;
 *  - **every non-Latin name**, which is what `fonts-noto-cjk` is installed for.
 *
 * Dropping the 16 answers' pictographs outright is still right, because the
 * house vocabulary is decorative-prefix-plus-word — `clientDetails/render.pure.ts`
 * documents the same list in its own "No emoji" section — so `🏠 Owner Occupied`
 * becomes `Owner Occupied` and reads perfectly. The coloured circles are dropped
 * rather than mapped to `●`: three identical discs destroy the distinction they
 * were carrying, and status in this design system is a `renderCallout` tone.
 */
export function sanitiseGlyphs(
  value: string,
): { text: string; dropped: number; transliterated: number } {
  let dropped = 0;
  let transliterated = 0;
  let out = '';
  for (const ch of value) {
    const cp = ch.codePointAt(0)!;
    if (isStripped(cp)) { dropped++; continue; }
    if (!inSymbolRange(cp)) { out += ch; continue; }
    if (KEEP_SYMBOLS.has(cp)) { out += ch; continue; }
    const swap = TRANSLITERATE[cp];
    if (swap !== undefined) { out += swap; transliterated++; continue; }
    dropped++;
  }
  return { text: out, dropped, transliterated };
}

// ── Public shape ────────────────────────────────────────────────────────────

export interface MarkdownOptions {
  /** The h-level this run's *shallowest* heading maps to. Default 2. */
  baseHeadingLevel?: 2 | 3 | 4;
  /**
   * Line-cost model for `MarkdownBlock.lines`. Default `legacy` — the
   * pre-calibration arithmetic, byte-identical, which every deployed master
   * not on a narrative profile expects. A calibrated caller passes `measured`
   * and MUST pair it with the same profile on the paging side; see
   * `markdownPaging.pure.ts`.
   */
  charging?: ChargeModel;
  /**
   * Charge every block by the geometry of the page it will print on — the
   * template's own measure, body size, leading and face — through the
   * formulas in `narrativeGeometry.pure.ts`, which are checked against the
   * pinned engine block by block. When set, `charging` is ignored: the
   * geometry IS the charge model. A caller passing this must draw its figures
   * with `vizDirectiveRenderer(ctx, geometry)` so a figure's lines come from
   * its printed height at that measure, and must pack with the same geometry
   * (`packNarrativeGeometry`), or the count and the buckets disagree.
   */
  geometry?: NarrativeGeometry;
  /**
   * Drop a heading that has no content before the next heading of the same or
   * shallower level (or the end of the document). Default true: a heading
   * whose body is missing promises analysis the page does not deliver, and a
   * run of them — measured on a real report, five in a stack over 480px of
   * white — reads as a broken page. The drop is counted in
   * `notices.headingsDroppedEmpty`. Pass false to keep skeletons.
   */
  dropEmptyHeadings?: boolean;
  /** Namespaces heading ids so two answers on one page cannot collide. */
  idPrefix?: string;
  /** Label on the callout a `>` blockquote becomes. */
  blockquoteLabel?: string;
  /** Label on a fenced block whose fence names no language. */
  codeLabel?: string;
  /** Label on the truncation callout. */
  truncationLabel?: string;
  /** Send a table wider than the portrait measure to the landscape page. */
  landscapeWideTables?: boolean;
  /** Mark a row whose first cell is exactly "Total" with the primitive's rule. */
  detectTotalRow?: boolean;
  /**
   * What to caption a table that has no header row of its own.
   *
   * A GFM table whose header cells are all blank gets no `thead` at all
   * (`primitives.pure.ts` drops it: an empty tinted band is not a header, and
   * there is nothing for a screen reader or a tagged PDF to announce). That is
   * right, and it costs the table the only per-page-repeating box the sheet has
   * — so twelve rows of a key/value table transcribed out of a PDF landed on a
   * fresh sheet identified by nothing but the 8.5pt running head.
   *
   * A caption is the honest half of the answer: it titles the table where it
   * starts. It does **not** repeat per page — only `display: table-header-group`
   * does that, and synthesising header labels the source never had would be
   * inventing text on a client's document to solve a layout problem.
   *
   * Ignored when the table has real headers; they say what it is already.
   */
  headlessTableCaption?: string;
  /**
   * A chapter title this run sits under, so the run does not repeat it.
   *
   * The natural way to write a section is to head it with its own name, and a
   * model asked for the prose of *Executive Summary* writes `## Executive
   * Summary` as its first line. The renderer has already printed that as a 34pt
   * chapter title, so the page reads the same words twice, four lines apart, at
   * 34pt and 17pt. Seen on a Market Intelligence render on two consecutive
   * chapters.
   *
   * Only the *leading* heading is dropped, and only when it matches. A heading
   * of the same name later in the body is a real subsection.
   */
  chapterTitle?: string;
  /**
   * Draw a chart the model asked for.
   *
   * The investment corpus carries **2,601** `{{bars: …}}` / `{{gauge: …}}`
   * directives across 21 documents — about 124 a report — and without this
   * every one of them set as an ordinary paragraph. A client's page printed
   * `{{bars: Bed/bath/car match to family demand 82, Layout flexibility 75 |
   * title=Property fit | max=100}}` in body copy, over and over.
   *
   * A callback rather than a direct call into `charts.pure.ts`, because a chart
   * needs a `ChartContext` — the resolved palette and the printed column width
   * — and this module has neither and should not acquire them. The caller knows
   * both. See `vizFigures.pure.ts` for the one this programme's formats pass.
   *
   * Return `null` to decline a kind; it is dropped and counted, never printed.
   * **Omitting the option entirely is also a decision**: the directives are
   * still removed from the prose, because a shortcode is instruction to the
   * renderer and not something to show a client either way.
   *
   * `lines` is the block's share of the page budget, in body lines. Omitted, a
   * figure is charged `DEFAULT_FIGURE_LINES`.
   */
  renderDirective?: (
    directive: VizDirective,
  ) => string | { html: string; lines?: number } | null;

  /**
   * Draw an inline sparkline for `~~[3,5,8,13]~~`, or decline it.
   *
   * The generator's prompt demands this construct — "Use `~~[…]~~` inline
   * sparklines liberally for any time-series mentioned in prose" — and this
   * module had no handling of `~~` at all, so on 262 Pallas Street a bare
   * array of numbers printed inside a client's sentence. Where the marker was
   * stripped instead (`markdownToPlainText`), the numbers printed without
   * even the tildes to mark them as a directive.
   *
   * Returning null, or omitting the option, REMOVES the construct rather than
   * printing it — the same decision `renderDirective` records: a shortcode is
   * instruction to the renderer and not something to show a client either way.
   */
  renderInlineSpark?: (values: number[]) => string | null;
}

/**
 * What a figure costs the page estimator when its renderer does not say.
 *
 * The charts run 176–360 SVG units tall against a `CHART_WIDTH` of 520–720,
 * which on the 174mm measure is roughly 42–87mm, or 8–17 body lines at the
 * 15.5pt leading `LINES_PER_PAGE` is derived from. Twelve is the middle of
 * that, and a renderer that knows which chart it drew should say so instead.
 */
export const DEFAULT_FIGURE_LINES = 12;

export interface MarkdownHeading {
  /** As emitted. Never 1, 5 or 6. */
  level: 2 | 3 | 4;
  /** As authored, 1–6. Kept so a contract test can prove the demotion. */
  sourceLevel: number;
  /** Plain — no markup, glyph-sanitised. What a contents entry prints. */
  text: string;
  /** Unique within one call. Charset `[a-z0-9-]`, so it can never hold `//`. */
  id: string;
  blockIndex: number;
}

export type MarkdownBlockKind =
  | 'paragraph' | 'heading' | 'list' | 'table' | 'landscape-table'
  | 'blockquote' | 'code' | 'notice' | 'figure';

/**
 * The structured half of a table block, kept so the pager can split a
 * taller-than-a-page table by rows with its header repeated. Splitting the
 * HTML string would mean parsing our own output; carrying the rows costs a
 * reference and buys a correct split.
 */
export interface MarkdownTableMeta {
  cols: TableColumn[];
  rows: TableRow[];
  signedKeys: string[];
  caption?: string;
  /** The "Columns not shown" sidenote; first chunk only on a split. */
  note?: string;
  /** Per-row line charge, in the charge model this block was built under. */
  rowLines: number[];
  /** Head + frame charge the row charges sit on. */
  headLines: number;
}

/** A list's items, kept so a list taller than a page can be split by item. */
export interface MarkdownListMeta {
  /**
   * `chars` is what the item prints (`printedChars`), which is what a charge
   * reads. `ordered` is the kind of the item's own marker, so a chunk cut from
   * this list re-renders its bulleted sub-points under their numbered step.
   */
  items: Array<{ depth: number; text: string; chars?: number; ordered?: boolean }>;
  ordered: boolean;
  start: number;
}

export interface MarkdownBlock {
  kind: MarkdownBlockKind;
  html: string;
  /** Estimated rendered lines across the 174mm measure. See `estimateLines`. */
  lines: number;
  /** Present on `table` blocks only; see `MarkdownTableMeta`. */
  table?: MarkdownTableMeta;
  /** Set on a `list` block built from source items (never on a synthesised one). */
  list?: MarkdownListMeta;
}

/** Every departure from the source, counted. Zero on a clean answer. */
export interface MarkdownNotices {
  /** Characters not shown, or null when nothing was cut. */
  truncatedAtChars: number | null;
  truncatedAtBlocks: boolean;
  /** No delimiter row, a mismatched one, or no body rows. */
  tablesRejected: number;
  tablesRagged: number;
  tableColumnsDropped: number;
  tableRowsDropped: number;
  tablesLandscaped: number;
  listsFlattened: number;
  listItemsDropped: number;
  codeLinesDropped: number;
  headingsDropped: number;
  thematicBreaks: number;
  linksFlattened: number;
  imagesDropped: number;
  glyphsDropped: number;
  glyphsTransliterated: number;
  urlsNeutralised: number;
  unmatchedEmphasis: number;
  /** Runs too long or too marker-dense to parse emphasis in. */
  inlineSkipped: number;
  /** `~~[…]~~` inline sparklines that became a drawing. */
  sparksDrawn: number;
  /** ... and those removed: fewer than two numbers, or a caller that declined. */
  sparksDropped: number;
  /** `{{…}}` chart directives that became a figure. */
  figuresDrawn: number;
  /**
   * Directives that did not: an unknown kind, a payload with nothing plottable
   * in it, or a caller who declined the kind. Counted rather than printed.
   */
  figuresDropped: number;
  /** Headings dropped because nothing followed them. See `dropEmptyHeadings`. */
  headingsDroppedEmpty: number;
  /** `[^id]` references rendered as superscript notes. */
  footnotesRendered: number;
  /** `[^id]` references whose definition never appeared; the marker is dropped. */
  footnoteRefsDropped: number;
  /** Loose list runs (items separated by blank lines) merged into one list. */
  listRunsMerged: number;
  /**
   * Table delimiter rows rewritten to their canonical width before the
   * character cap. A delimiter row carries alignment and nothing else, so its
   * length is never information — and a stored Market Intelligence layer
   * (14 Sep 2026) carried one cell of 123,913 dashes, which spent the whole
   * budget: the cap fell inside that row, every row after it was cut, and the
   * header printed raw.
   */
  delimiterRowsNormalised: number;
}

/**
 * What a render LOST, in sentences a person can act on.
 *
 * ## Why this is here
 *
 * `MarkdownNotices` is a complete degradation report and, measured 2026-09-07,
 * **every caller throws it away**. `reportBindingProjection`,
 * `reportQaProjection`, `marketIntelligenceProjection` and both converted-report
 * renderers take `.blocks`, `.html` or `.lines` and read no notice at all; the
 * investment renderer reads exactly two of the twenty-four
 * (`figuresDrawn` / `figuresDropped`) and discards the rest.
 *
 * That includes every notice that means a client's content did not reach the
 * page. On `28 Bligh Street, Muswellbrook` a table row written as
 * `… | General evidence only || Tenant stability …` — two rows concatenated —
 * renders with `tablesRagged: 1` and **`tableColumnsDropped: 5`**, and nothing
 * anywhere is told. Across the corpus 12 reports carry that shape and 118 carry
 * an unterminated row.
 *
 * ## The line this draws
 *
 * A notice that means content was **lost** is a problem. A notice that means
 * content was **transformed** is not: `tablesLandscaped`, `listsFlattened`,
 * `linksFlattened`, `glyphsTransliterated`, `urlsNeutralised`, `listRunsMerged`
 * and `inlineSkipped` all describe a deliberate accommodation that keeps the
 * words, and reporting them would bury the ones that do not. `tablesRagged` is
 * likewise a description rather than a loss — the loss it causes is counted
 * separately as dropped columns and rows, and counting both would double it.
 *
 * Returns an empty array for a clean render, so a caller can spread it into an
 * existing `problems` list without a guard.
 */
export function contentLosses(notices: MarkdownNotices): string[] {
  const out: string[] = [];
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  if (notices.truncatedAtChars !== null) {
    out.push(`${plural(notices.truncatedAtChars, 'character')} cut from the end of a section`);
  }
  if (notices.truncatedAtBlocks) out.push('a section was cut short at a block boundary');
  if (notices.tablesRejected) out.push(`${plural(notices.tablesRejected, 'table')} could not be parsed and was dropped`);
  if (notices.tableColumnsDropped) out.push(`${plural(notices.tableColumnsDropped, 'table column')} dropped from a malformed row`);
  if (notices.tableRowsDropped) out.push(`${plural(notices.tableRowsDropped, 'table row')} dropped`);
  if (notices.listItemsDropped) out.push(`${plural(notices.listItemsDropped, 'list item')} dropped`);
  if (notices.codeLinesDropped) out.push(`${plural(notices.codeLinesDropped, 'code line')} dropped`);
  if (notices.headingsDropped) out.push(`${plural(notices.headingsDropped, 'heading')} dropped`);
  if (notices.headingsDroppedEmpty) out.push(`${plural(notices.headingsDroppedEmpty, 'heading')} dropped with nothing under it`);
  if (notices.imagesDropped) out.push(`${plural(notices.imagesDropped, 'image')} dropped`);
  if (notices.glyphsDropped) out.push(`${plural(notices.glyphsDropped, 'character')} dropped as unprintable`);
  if (notices.footnoteRefsDropped) out.push(`${plural(notices.footnoteRefsDropped, 'footnote marker')} dropped with no definition`);
  if (notices.figuresDropped) out.push(`${plural(notices.figuresDropped, 'chart directive')} did not draw`);
  return out;
}

export interface MarkdownResult {
  blocks: readonly MarkdownBlock[];
  /** `blocks.map(b => b.html).join('')` — the common case. */
  html: string;
  headings: readonly MarkdownHeading[];
  lines: number;
  notices: MarkdownNotices;
  /**
   * True only when **content** was lost.
   *
   * Not set by glyph or emphasis normalisation, which happen on almost every
   * answer in the record — a flag that is true for 70% of inputs tells an
   * operator nothing, and the ledger column that records this exists to answer
   * "did we send someone a partial document".
   */
  degraded: boolean;
}

const emptyNotices = (): MarkdownNotices => ({
  truncatedAtChars: null,
  truncatedAtBlocks: false,
  tablesRejected: 0,
  tablesRagged: 0,
  tableColumnsDropped: 0,
  tableRowsDropped: 0,
  tablesLandscaped: 0,
  listsFlattened: 0,
  listItemsDropped: 0,
  codeLinesDropped: 0,
  headingsDropped: 0,
  thematicBreaks: 0,
  linksFlattened: 0,
  imagesDropped: 0,
  glyphsDropped: 0,
  glyphsTransliterated: 0,
  urlsNeutralised: 0,
  unmatchedEmphasis: 0,
  inlineSkipped: 0,
  figuresDrawn: 0,
  figuresDropped: 0,
  sparksDrawn: 0,
  sparksDropped: 0,
  headingsDroppedEmpty: 0,
  footnotesRendered: 0,
  footnoteRefsDropped: 0,
  listRunsMerged: 0,
  delimiterRowsNormalised: 0,
});

// ── Inline ──────────────────────────────────────────────────────────────────

/**
 * Escape first, then apply emphasis over the escaped string.
 *
 * ## Why this order and not the other
 *
 * Both can be made correct. This one is chosen for its **failure mode**.
 * Escape-first puts `escapeHtml` at one auditable call at the top of this
 * function; get it wrong — parse emphasis first and escape the result — and the
 * page prints `&lt;strong&gt;` in the body copy. Loud, and the first test
 * catches it. The alternative, building an AST and escaping at serialisation, is
 * correct only if *every* serialiser branch remembers to; the branch that
 * forgets is an XSS-shaped hole that renders identically to correct output in
 * every test that does not specifically probe it.
 *
 * ## The property that makes it safe
 *
 * `escapeHtml` (`primitives.pure.ts:34`) produces only `&amp; &lt; &gt; &quot;
 * &#39;`, and **none of `*`, `_`, backtick, `[`, `]`, `(`, `)` appears in any of
 * those five entities**. So no marker can land inside an entity and no emphasis
 * span can split one. `markdown.spec.ts` asserts that directly, so adding a
 * sixth entity to `escapeHtml` fails here rather than in a client's document.
 *
 * Two rules follow, and both are load-bearing:
 *
 *  - the scanner anchors only on those seven characters, never on `&` or `;`;
 *  - every length cap is applied to the **raw** text, because a run of `&` grows
 *    fivefold under escaping.
 */
/**
 * The footnote registry for the render in flight.
 *
 * `[^id]` references can appear anywhere inline text does — paragraphs, list
 * items, table cells — and every one of those paths already funnels through
 * `renderInlineMarkdown`, so the reference substitution lives there. The
 * definitions are document-level state, and threading a map through a dozen
 * call sites would change every signature for one feature; a module-ambient
 * registry set for the duration of one `renderMarkdown` call (this module is
 * synchronous and single-threaded in both runtimes) is the smaller surface.
 * Null outside a render: a bare `renderInlineMarkdown` caller sees `[^id]`
 * dropped only when a render established definitions for it.
 */
let activeFootnotes: {
  defs: Map<string, string>;
  order: string[];
  notices: MarkdownNotices;
} | null = null;

function applyFootnoteRefs(html: string): string {
  const reg = activeFootnotes;
  if (!reg) return html;
  return html.replace(/\[\^([^\]\s]{1,40})\]/g, (m, id: string) => {
    if (!reg.defs.has(id)) {
      // Only a citation-shaped id strips (letter-led, two-plus characters, no
      // dash). `a[^2]` and `[^a-z]` are prose and stay exactly as written. A
      // model's escaped marker — `[^\*graceSchools]` reached a client's page
      // verbatim on 14 Sep 2026 — is the same citation with a stray escape,
      // so the shape is judged with escapes and asterisks removed.
      if (!/^[A-Za-z][A-Za-z0-9_]{1,39}$/.test(id.replace(/[\\*]/g, ''))) return m;
      reg.notices.footnoteRefsDropped++;
      return '';
    }
    let n = reg.order.indexOf(id);
    if (n === -1) { reg.order.push(id); n = reg.order.length - 1; }
    reg.notices.footnotesRendered++;
    return `<sup class="fn-ref">${n + 1}</sup>`;
  });
}

/**
 * How many characters of a source span PRINT.
 *
 * Every charge used to count the source — `it.text.length`, `joined.length` —
 * and the source carries what the page does not: `**` around a lead-in, the
 * URL inside `[text](url)`, a footnote marker. Measured on the long reference
 * report (RS-4, 14 Sep 2026): a location list whose items cite their sources
 * charged 29.9 lines and set in 24, because each item's URL was counted as
 * prose; the page under it was 45% white. The charge counts what the inline
 * renderer emits, tags stripped and entities read as the one glyph they print.
 */
export function printedText(value: string): string {
  return renderInlineMarkdown(value)
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&(?:amp|lt|gt|quot|#39);/g, 'x');
}
export function printedChars(value: string): number {
  return printedText(value).length;
}

/** The plain text a span of inline Markdown prints — for a primitive that escapes its own input. */
export function inlinePlainText(value: string): string {
  return renderInlineMarkdown(value)
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

/**
 * The inline sparkline the generator's prompt asks for: `~~[3,5,8,13]~~`.
 *
 * Matched after escaping, because none of `~`, `[`, `]`, a digit, a comma,
 * a dot, a minus or a space is escaped — so the construct survives `escapeHtml`
 * intact and can be recognised as a unit there, the way a code span is.
 */
const INLINE_SPARK = /~~\[([\d.,\s+-]+)\]~~/g;

/** Draw, or remove. Never print. */
function drawSparks(part: string, notices?: MarkdownNotices, opts?: InlineMarkdownOptions): string {
  if (!INLINE_SPARK.test(part)) { INLINE_SPARK.lastIndex = 0; return part; }
  INLINE_SPARK.lastIndex = 0;
  return part.replace(INLINE_SPARK, (_whole, list: string) => {
    const values = String(list).split(',').map((v) => Number(v.trim())).filter((n) => Number.isFinite(n));
    const html = values.length >= 2 ? (opts?.renderInlineSpark?.(values) ?? null) : null;
    if (!html) { if (notices) notices.sparksDropped++; return ''; }
    if (notices) notices.sparksDrawn++;
    return html;
  });
}

/** What the inline pass needs from the caller. A subset of `MarkdownOptions`. */
export interface InlineMarkdownOptions {
  renderInlineSpark?: (values: number[]) => string | null;
}

export function renderInlineMarkdown(
  value: string,
  notices?: MarkdownNotices,
  opts?: InlineMarkdownOptions,
): string {
  const raw = value ?? '';
  if (!raw) return '';

  const markers = (raw.match(/[*_`]/g) ?? []).length;
  if (raw.length > MAX_INLINE_CHARS || markers > MAX_INLINE_MARKERS) {
    if (notices) notices.inlineSkipped++;
    // Even the run this pass declines to parse must not print a directive.
    return applyFootnoteRefs(drawSparks(escapeHtml(stripMarkers(raw)), notices, opts));
  }

  // Links first, on the *raw* string: the target has to be recognised as a unit
  // before escaping turns its parentheses into ordinary text, and it must never
  // reach the output as an `href`. See `flattenLinks`.
  let s = flattenLinks(raw, notices);
  s = escapeHtml(s);

  // Code spans become their tag first; the string is then split on those tags
  // and emphasis applied only outside them. CommonMark does not parse emphasis
  // inside a code span, and a backtick span is the one construct here that
  // legitimately contains asterisks.
  //
  // A split rather than a placeholder substitution, because a placeholder is a
  // token that could also occur in the prose. Escaping has already run, so no
  // literal `<code>` can exist in the text and the split is exact.
  s = s.replace(/`+([^`]+?)`+/g, (_m, inner: string) => `<code>${inner}</code>`);
  // Code spans are left alone, then a sparkline is drawn outside them, then
  // emphasis is applied outside the drawing. Three splits rather than three
  // placeholder tokens, for the reason above: a token is a string the prose
  // could also contain, and a tag is not.
  return s
    .split(/(<code>[\s\S]*?<\/code>)/)
    .map((part, idx) => {
      if (idx % 2 === 1) return part;
      return drawSparks(part, notices, opts)
        .split(/(<svg\b[\s\S]*?<\/svg>)/)
        .map((piece, i) => (i % 2 === 1 ? piece : applyFootnoteRefs(emphasise(piece, notices))))
        .join('');
    })
    .join('');
}

/** The emphasis half of the inline pass. Never sees the inside of a code span. */
function emphasise(input: string, notices?: MarkdownNotices): string {
  let s = input
    .replace(/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<![\w*])\*(?=\S)([^*]*?\S)\*(?![\w*])/g, '<em>$1</em>')
    // Intraword `_` never emphasises. Not a nicety — this codebase's own prose
    // is full of `edited_content` and `snake_case`, and CommonMark's flanking
    // rule exists for exactly that.
    .replace(/(?<![\w_])___(?=\S)([\s\S]*?\S)___(?![\w_])/g, '<strong><em>$1</em></strong>')
    .replace(/(?<![\w_])__(?=\S)([\s\S]*?\S)__(?![\w_])/g, '<strong>$1</strong>')
    .replace(/(?<![\w_])_(?=\S)([^_]*?\S)_(?![\w_])/g, '<em>$1</em>');

  // What is left is a marker with no partner. A *flanking* one — hard against
  // the text on exactly one side — is dropped, because `**Important` printing
  // its asterisks on a client's document reads unambiguously as a defect and
  // nothing a reader could act on is lost.
  //
  // This is a deliberate departure from `salvage.pure.ts`'s never-repair rule,
  // and the distinction is the justification: salvage refuses because a
  // half-closed array yields a *partial fact* indistinguishable from a whole
  // one. An unmatched `**` is presentation, not content.
  s = s.replace(/(^|\s)([*_]{1,3})(?=\S)/g, (_m, pre: string) => { bump(notices); return pre; });
  s = s.replace(/(?<=\S)([*_]{1,3})(?=\s|$)/g, () => { bump(notices); return ''; });

  // A marker with space on both sides is arithmetic, not emphasis — `2 * 3 * 4`
  // keeps its asterisks, and neither pattern above touches them.

  return s;
}

function bump(notices?: MarkdownNotices): void {
  if (notices) notices.unmatchedEmphasis++;
}

/** Every emphasis marker removed, leaving the words. For a table cell. */
function stripMarkers(value: string): string {
  return value
    .replace(/`+([^`]+?)`+/g, '$1')
    .replace(/\*{1,3}(?=\S)([\s\S]*?\S)\*{1,3}/g, '$1')
    .replace(/(?<![\w_])_{1,3}(?=\S)([\s\S]*?\S)_{1,3}(?![\w_])/g, '$1')
    .replace(/(^|\s)[*_]{1,3}(?=\S)/g, '$1')
    .replace(/(?<=\S)[*_]{1,3}(?=\s|$)/g, '');
}

/**
 * `[text](target)` and `![alt](src)` become their text, and never an anchor.
 *
 * The stakes here are the whole document, not this span.
 * `assertSafeRenderResources` decodes HTML entities and *then* throws on any
 * `https?://`, `//host`, `file:`, `ftp:` or `gopher:` token anywhere in the
 * HTML, escaped body text included (`renderResourcePolicy.pure.ts:67-91`). An
 * `<a href>` would fail the render with an error naming no field and no line —
 * and `a` *is* styled by the sheet, which is exactly what makes emitting one
 * look reasonable.
 *
 * The target is not simply deleted. `neutraliseUrls` has already stripped its
 * scheme in Pass 0, so what is left is a bare host and path; printing it in
 * parentheses keeps the attribution a citation was carrying. Zero links appear
 * in the 562-answer corpus, so this rule exists to be correct rather than to be
 * exercised — which is precisely when it will be got wrong.
 */
function flattenLinks(value: string, notices?: MarkdownNotices): string {
  let s = value.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) => {
    if (notices) notices.imagesDropped++;
    return alt;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]*)[^)]*\)/g, (_m, text: string, target: string) => {
    if (notices) notices.linksFlattened++;
    const bare = target.replace(/^[a-z]+:/i, '').replace(/^\/+/, '').trim();
    return bare && bare !== text ? `${text} (${bare})` : text;
  });
  return s;
}

/**
 * Markers gone, glyphs normalised, URLs neutralised. A contents entry, a running
 * head, or a question printed above the answer it drew.
 *
 * `neutraliseUrls` belongs here and not only in `renderMarkdown`, because these
 * strings reach the page **without passing through the block scanner**: the
 * transcript prints each question in a callout of its own, and a heading's plain
 * text becomes a contents entry. Eight user messages in the record carry a URL,
 * and without this the render fails on every one of them with an error naming no
 * field and no line. Found by a test that put a URL in a question rather than in
 * an answer.
 */
export function markdownToPlainText(value: string, maxChars?: number): string {
  const clean = neutraliseUrls(stripMarkers(sanitiseGlyphs(String(value ?? '')).text))
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (typeof maxChars !== 'number' || clean.length <= maxChars) return clean;

  // Cut on a word, and say that it was cut.
  //
  // This text is a contents-page note, a chapter standfirst or a running head —
  // furniture a reader takes in at a glance — and a hard slice ends it mid-word
  // on a hyphenated compound often enough to look like a truncated database
  // column rather than a summary. The Market Intelligence render showed
  // "…the board's statement noting trimmed" under a heading, with the rest of
  // "trimmed-mean" gone.
  //
  // The ellipsis is inside the budget, not added to it, so a caller's cap still
  // means what it says. A word boundary is only used when there is one in the
  // back third; a single very long token is cut where it falls rather than
  // collapsing the whole string to nothing.
  const room = Math.max(1, maxChars - 1);
  const head = clean.slice(0, room);
  const space = head.lastIndexOf(' ');
  const cut = space > room * (2 / 3) ? head.slice(0, space) : head;
  return `${cut.replace(/[\s,;:.–—-]+$/, '')}…`;
}

// ── Tables ──────────────────────────────────────────────────────────────────

/** `1,234`, `-1,234`, `(500)`, `$1,234.56`, `12.5%`, `1.2x`. */
const NUMERIC_CELL = /^[-+(]?\s*[$€£]?\s*\d[\d,\s]*(?:\.\d+)?\s*(?:%|x)?\s*\)?$/i;

const splitRow = (line: string): string[] => {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
};

const isDelimiterRow = (line: string): boolean => {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c));
};

// ── The scan ────────────────────────────────────────────────────────────────

/** `ordered` is the kind of the item's OWN marker — a bulleted sub-point under a numbered step. */
interface ListItem { depth: number; text: string; ordered?: boolean }

const slugify = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'section';

/**
 * Turn Markdown into design-system HTML.
 *
 * Three passes. **Pass 0** normalises once — BOM, line endings, the character
 * cap, then `sanitiseGlyphs`, then `neutraliseUrls`, in that order. The order is
 * not cosmetic: stripping a zero-width character is what *creates* a
 * scheme-relative URL, so neutralising first leaves a live `//` for the resource
 * policy to throw on. Running the URL pass once over the whole raw input, rather
 * than per construct, is what covers table cells, code blocks, alt text and
 * heading ids by construction instead of by remembering.
 *
 * **Pass 1** segments blocks in one left-to-right walk. **Pass 2** runs inline
 * only where inline is legal — never inside a fence.
 */
/** `key="value"` and `key=value` pairs on a directive fence's opening line. */
export function fenceAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of String(raw ?? '').matchAll(/([A-Za-z][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g)) {
    attrs[m[1].toLowerCase()] = (m[2] ?? m[3] ?? m[4] ?? '').trim();
  }
  return attrs;
}

/** The fence kinds the generator's prompt asks for, and what each draws here. */
export const FENCE_KINDS = ['pullquote', 'quote-page', 'sidenote', 'stat', 'divider'] as const;

export function renderMarkdown(source: string, options: MarkdownOptions = {}): MarkdownResult {
  const notices = emptyNotices();
  const base = options.baseHeadingLevel ?? 2;
  const idPrefix = (options.idPrefix ?? 'a').replace(/[^a-z0-9]+/gi, '').toLowerCase() || 'a';
  const landscape = options.landscapeWideTables !== false;
  const detectTotal = options.detectTotalRow !== false;
  const headlessCaption = String(options.headlessTableCaption ?? '').trim();
  /** Compared ignoring case, punctuation and spacing — `Sources:` matches `Sources`. */
  const sameWords = (a: string, b: string) => {
    const key = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    return Boolean(key(a)) && key(a) === key(b);
  };
  const chapterTitle = String(options.chapterTitle ?? '').trim();
  /** Said once per run. See the table scanner. */
  let headlessCaptionUsed = false;

  // ── Pass 0 ────────────────────────────────────────────────────────────────
  let text = String(source ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  // Delimiter rows first, so the character cap is spent on words. Only a row
  // longer than an ordinary hand-written one is touched, which keeps a clean
  // document byte-identical. See `MarkdownNotices.delimiterRowsNormalised`.
  if (text.includes('-|') || text.includes('|-') || text.includes('| :') || text.includes('|:')) {
    text = text.split('\n').map((line) => {
      if (line.length <= 96 || !line.includes('|') || !isDelimiterRow(line)) return line;
      notices.delimiterRowsNormalised++;
      const cells = splitRow(line).map((c) => `${c.startsWith(':') ? ':' : ''}---${c.endsWith(':') ? ':' : ''}`);
      return `| ${cells.join(' | ')} |`;
    }).join('\n');
  }
  if (text.length > MAX_MARKDOWN_CHARS) {
    const cut = text.lastIndexOf('\n', MAX_MARKDOWN_CHARS);
    const at = cut > MAX_MARKDOWN_CHARS / 2 ? cut : MAX_MARKDOWN_CHARS;
    notices.truncatedAtChars = text.length - at;
    text = text.slice(0, at);
  }
  const glyphs = sanitiseGlyphs(text);
  notices.glyphsDropped = glyphs.dropped;
  notices.glyphsTransliterated = glyphs.transliterated;
  text = glyphs.text;
  const urlsBefore = countUrlTokens(text);
  if (urlsBefore) {
    notices.urlsNeutralised = urlsBefore;
    text = neutraliseUrls(text);
  }

  // Footnote definitions come out before the block scan sees them: a
  // `[^id]: text` line is an instruction to the renderer, and the source
  // syntax printing as body copy ("…violent crime.[^bocsar]") was measured on
  // a real client document. Single-line definitions only — that is the only
  // form the record contains.
  const footnoteDefs = new Map<string, string>();
  text = text.split('\n').filter((line) => {
    const def = /^\[\^([A-Za-z0-9_-]{1,40})\]:\s?(.*)$/.exec(line.trim());
    if (def && def[2].trim()) { footnoteDefs.set(def[1], def[2].trim()); return false; }
    return true;
  }).join('\n');
  const footnoteOrder: string[] = [];
  // A model cites with `[^abs]`-style refs and, often, never writes the
  // definitions (they live in a sources column this render does not see).
  // Printing the raw marker is the worst outcome — nothing reads more like a
  // machine's output — so citation-shaped refs arm the registry even with no
  // definitions, and simply strip. Citation-shaped means a letter-led id of
  // two or more characters with no dash: `[^2]` (an array slice) and
  // `[^a-z]` (a character class) stay prose.
  const hasCitationRefs = /\[\^[A-Za-z][A-Za-z0-9_]{1,39}\]/.test(text);
  activeFootnotes = (footnoteDefs.size || hasCitationRefs)
    ? { defs: footnoteDefs, order: footnoteOrder, notices }
    : null;

  const lines = text.split('\n');
  const blocks: MarkdownBlock[] = [];
  const headings: MarkdownHeading[] = [];
  const idsUsed = new Map<string, number>();

  // Pass 1a — the shallowest heading in this run, so demotion is relative.
  let minLevel = 7;
  for (const line of lines) {
    const m = /^(#{1,6})\s+\S/.exec(line);
    if (m) minLevel = Math.min(minLevel, m[1].length);
  }
  if (minLevel === 7) minLevel = 1;

  // The charge model. `legacy` keeps every number byte-identical for callers
  // not yet on a calibrated narrative profile; `measured` is the 2026-09
  // calibration (see `ChargeModel`). Half-line rounding matters at `measured`:
  // integer rounding inflated a heading-dense page by up to one line per block.
  const geometry = options.geometry ?? null;
  const measured = geometry !== null || options.charging === 'measured';
  const cpl = geometry ? geometry.charsPerLine : measured ? MEASURED_CHARS_PER_LINE : CHARS_PER_LINE;
  const headingCost = measured ? 1.5 : 2;
  // Geometry charges are exact to the point and are kept to the hundredth;
  // the two constant models keep their own rounding byte for byte.
  const roundCharge = (n: number) => (geometry
    ? Math.max(0.25, Math.round(n * 100) / 100)
    : measured
      ? Math.max(0.5, Math.round(n * 2) / 2)
      : Math.max(1, Math.round(n)));

  const push = (kind: MarkdownBlockKind, html: string, lineCount: number, table?: MarkdownTableMeta, list?: MarkdownListMeta): boolean => {
    if (!html) return true;
    if (blocks.length >= MAX_BLOCKS) { notices.truncatedAtBlocks = true; return false; }
    const entry: MarkdownBlock = { kind, html, lines: roundCharge(lineCount) };
    if (table) entry.table = table;
    if (list) entry.list = list;
    blocks.push(entry);
    return true;
  };

  const textLines = (s: string) => (geometry
    ? Math.max(1, Math.ceil(s.length / cpl))
    : measured
      ? Math.max(1, s.length / cpl)
      : Math.ceil(Math.max(1, s.length) / cpl));

  /**
   * How many lines a list actually sets.
   *
   * An item is not one line. It is as many as its text needs at the measure,
   * and a nested item has less measure to work with because its marker and
   * indent eat into it. Counting one line per item is what made a 4,315-
   * character Market Intelligence strategy — three headings and three lists —
   * estimate at 19 lines and pack onto a single page, which then rendered 96pt
   * past the footer. A paragraph two lines above this already counts its wrap;
   * a list simply never did.
   *
   * The `+ 1` that follows the sum is the block's own separation, unchanged.
   */
  const listLines = (items: readonly ListItem[]) => items.reduce(
    (n, it) => {
      // A top-level item does not set at the full measure either: its marker
      // and hanging indent eat ~6 characters before the nesting steps start.
      // Charging depth 0 at the whole `cpl` is how a source-note list charged
      // 17.5 lines and rendered past the footer on a real Compass render
      // (1/27D Mitchell Street, p19, 2026-09-04) — every item was a bold
      // lead-in plus a long sentence, undercharged by its own indent, and the
      // page's tail printed over the running foot. Measured model only; the
      // legacy charge stays byte-identical for the uncalibrated formats.
      const width = Math.max(20, cpl - (measured ? 6 : 0) - it.depth * 4);
      return n + (measured
        ? Math.max(1, it.text.length / width)
        : Math.ceil(Math.max(1, it.text.length) / width));
    },
    0,
  );

  // ── Pass 1b — one left-to-right walk ──────────────────────────────────────
  let i = 0;
  let paragraph: string[] = [];

  const flushParagraph = (): boolean => {
    if (!paragraph.length) return true;
    const joined = paragraph.join('\n');
    paragraph = [];
    const html = paragraphHtml(joined, notices, options);
    return push('paragraph', html, geometry ? paragraphCharge(geometry, printedChars(joined)) : textLines(joined) + 0.5);
  };

  scan: while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // A fenced directive the generator writes: `::: kind attr="…"` … `:::`.
    //
    // The prompt asks for five of them (pull quote, sidenote, stat block,
    // section divider, quote page) and the flowing route draws all five;
    // this renderer drew none, so every one printed RAW — fences, attributes
    // and all — in the client document on every structure (RS-4, 14 Sep
    // 2026: `::: stat label="Mining share of workforce" unit="%" …` set as
    // body copy on page 14 of the medium reference report). A kind with no
    // drawing here (columns, dashboard, signature, anything new) is unwrapped
    // and its body read as ordinary Markdown, so nothing a fence carries is
    // lost and no fence is ever printed.
    const directive = /^:::\s*([A-Za-z][\w-]*)\s*(.*)$/.exec(trimmed);
    if (directive) {
      if (!flushParagraph()) break scan;
      const kind = directive[1].toLowerCase();
      const attrs = fenceAttrs(directive[2]);
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^:::\s*$/.test(lines[i].trim())) { body.push(lines[i]); i++; }
      if (i < lines.length) i++;
      const inner = body.join('\n').trim();
      const oneLine = renderInlineMarkdown(inner.replace(/\s*\n+\s*/g, ' '), notices, options);
      const innerChars = printedChars(inner.replace(/\s*\n+\s*/g, ' '));
      if (kind === 'pullquote' || kind === 'quote-page') {
        if (!inner) continue;
        const attribution = (attrs.attribution ?? '').trim();
        // The primitive escapes what it is handed, so it is handed the plain
        // sentence — a pull quote is one line of type, not a run of markup.
        const html = renderPullQuote(inlinePlainText(inner.replace(/\s*\n+\s*/g, ' ')), attribution || undefined);
        const cost = geometry
          ? pullQuoteCharge(geometry, innerChars, printedChars(attribution))
          : textLines(inner) * 1.4 + (attribution ? 1 : 0) + 2;
        if (!push('blockquote', html, cost)) break scan;
        continue;
      }
      if (kind === 'sidenote') {
        if (!inner) continue;
        const html = renderSidenote(attrs.label || 'Note', `<p>${oneLine}</p>`);
        const cost = geometry ? sidenoteCharge(geometry, [innerChars]) : textLines(inner) + 2;
        if (!push('notice', html, cost)) break scan;
        continue;
      }
      if (kind === 'stat' || kind === 'divider') {
        // A stat card states its body; a divider states its `stat` attribute
        // and carries its body as the headline. A card with nothing to state
        // is not drawn — not a dash, not the unit on its own: the rule
        // `blockHygiene` already enforces at the write path, shared so the two
        // ends cannot disagree about "empty".
        const value = kind === 'stat' ? inner : (attrs.stat ?? '');
        if (!statCardHasValue(value)) continue;
        const label = kind === 'stat' ? (attrs.label ?? '') : (attrs.eyebrow ?? '');
        const sub = kind === 'stat' ? (attrs.sub ?? '') : (attrs.label ?? '');
        const headline = kind === 'divider' ? oneLine : '';
        const unit = kind === 'stat' ? (attrs.unit ?? '') : '';
        const html = renderStatCard({ value, label, unit, sub, headlineHtml: headline || undefined, divider: kind === 'divider' });
        const cost = geometry
          ? statCharge(geometry, { label: Boolean(label), sub: Boolean(sub), headlineChars: headline ? innerChars : 0 })
          : 4 + (label ? 1 : 0) + (sub ? 1 : 0) + (headline ? textLines(inner) : 0);
        if (!push('notice', html, cost)) break scan;
        continue;
      }
      // Unknown kind: the fence goes, the body stays and is read as Markdown.
      lines.splice(i, 0, ...body);
      continue;
    }

    // Fenced code.
    const fence = /^([`~]{3,})\s*([\w+-]*)\s*$/.exec(trimmed);
    if (fence) {
      if (!flushParagraph()) break scan;
      const closer = fence[1][0];
      const body: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s*${closer}{3,}\\s*$`).test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      // An unclosed fence at end of input is still a complete block. This is a
      // deliberate difference from `salvage.pure.ts`: a truncated line of code
      // is self-evidently truncated, so there is no fabrication hazard.
      if (i < lines.length) i++;
      const kept = body.slice(0, MAX_CODE_LINES);
      notices.codeLinesDropped += body.length - kept.length;
      const label = fence[2] ? fence[2].toUpperCase() : (options.codeLabel ?? 'Code');
      const inner = kept
        // Leading indentation becomes non-breaking: this wraps as `<p>` text,
        // not `<pre>`, so ordinary leading spaces would collapse away.
        .map((l) => escapeHtml(l).replace(/^ +/, (sp) => '\u00a0'.repeat(sp.length)))
        .join('<br>');
      if (!push('code', renderCallout('informative', label, `<p><code>${inner}</code></p>`), geometry ? codeCharge(geometry, kept.length) : kept.length + 2)) break scan;
      continue;
    }

    // A line that is nothing but chart directives.
    //
    // Whole-line only, and that is the whole of the rule. Measured over the
    // corpus: 3,761 lines carry a directive and **3,748 of them carry nothing
    // else**. The remaining 13 are a "how to read this report" legend, where
    // the model names the kinds in prose — `- **{{gauge: …}}** — a score out of
    // 100`. Lifting those out would leave a bullet with a hole in it, and their
    // payload is a literal ellipsis, so they refuse to parse anyway.
    if (trimmed.startsWith('{{') && directiveOnlyBlock(trimmed)) {
      if (!flushParagraph()) break scan;
      const { directives, refused } = scanVizDirectives(trimmed);
      notices.figuresDropped += refused;
      for (const directive of directives) {
        const drawn = options.renderDirective?.(directive) ?? null;
        const html = typeof drawn === 'string' ? drawn : drawn?.html ?? '';
        if (!html.trim()) { notices.figuresDropped++; continue; }
        notices.figuresDrawn++;
        // `typeof null === 'object'`, so the null arm must be excluded
        // explicitly before reading `.lines`. Unreachable with null at
        // runtime anyway — a null draw produced an empty `html` and was
        // dropped by the guard above — but the narrowing makes that visible
        // to the type system instead of relying on it.
        const charged = drawn !== null && typeof drawn === 'object' && typeof drawn.lines === 'number'
          ? drawn.lines
          : DEFAULT_FIGURE_LINES;
        if (!push('figure', html, charged)) break scan;
      }
      i++;
      continue;
    }

    // A bare `#` with nothing after it. Not a heading, and not worth printing
    // as a paragraph either — a lone hash on a client's document is noise, and
    // this is the one place where dropping beats falling through.
    if (/^#{1,6}$/.test(trimmed)) {
      if (!flushParagraph()) break scan;
      i++;
      continue;
    }

    // ATX heading. Seven or more hashes is not a heading in CommonMark, and
    // neither is `#Heading`; both fall through to the paragraph below.
    const atx = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (atx && !/^#{7,}/.test(trimmed)) {
      if (!flushParagraph()) break scan;
      const raw = atx[2].replace(/\s+#+\s*$/, '').trim();
      if (raw) {
        if (!emitHeading(atx[1].length, raw)) break scan;
      }
      i++;
      continue;
    }

    // Setext. Supported because without it a `---` under a text line is neither
    // a break nor a heading, and the `---` would print inside the paragraph.
    if (
      paragraph.length && /^(=+|-+)\s*$/.test(trimmed)
      && !isDelimiterRow(line) && lines[i - 1]?.trim()
    ) {
      // The underlined line is the heading; anything above it in flight is a
      // paragraph that ends here.
      const heading = paragraph.pop()!.trim();
      if (!flushParagraph()) break scan;
      if (!emitHeading(trimmed.startsWith('=') ? 1 : 2, heading)) break scan;
      i++;
      continue;
    }

    // Pipe table. A table only exists when the next line is a delimiter row
    // whose cell count matches the header's — GFM's own rule, and the point at
    // which this module declines to invent structure.
    if (trimmed.includes('|') && i + 1 < lines.length && isDelimiterRow(lines[i + 1])) {
      const header = splitRow(line);
      const delim = splitRow(lines[i + 1]);
      if (header.length === delim.length && header.length > 0) {
        const body: string[][] = [];
        let j = i + 2;
        while (j < lines.length && lines[j].trim().includes('|') && lines[j].trim()) {
          body.push(splitRow(lines[j]));
          j++;
        }
        if (body.length) {
          if (!flushParagraph()) break scan;
          if (!emitTable(header, delim, body)) break scan;
          i = j;
          continue;
        }
        // Header and delimiter but no body: a table the model started and
        // never filled (a stored Market Intelligence layer ends exactly so —
        // the generation ran out inside the delimiter row). This used to fall
        // through to the paragraph path, which printed `| Factor | Risk Level |
        // … | :--- | :--- |` raw on a client's page. A table with nothing in it
        // is nothing to show; the two lines are consumed and the loss is
        // counted where every other degradation is.
        notices.tablesRejected++;
        if (!flushParagraph()) break scan;
        i += 2;
        continue;
      } else {
        notices.tablesRejected++;
      }
    } else if (
      // A run of pipe lines with no delimiter row under its first line is not a
      // table — GFM requires one, and inventing a header from whichever line
      // happens to come first is exactly the fabrication `salvage.pure.ts`
      // refuses. It is still worth counting: a model that meant a table and
      // wrote one badly is a thing an operator should be able to see.
      trimmed.split('|').length > 2
      && !(lines[i - 1] ?? '').includes('|')
      && (lines[i + 1] ?? '').includes('|')
    ) {
      notices.tablesRejected++;
    }

    // Blockquote.
    if (/^>\s?/.test(trimmed)) {
      if (!flushParagraph()) break scan;
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>+\s?/, ''));
        i++;
      }
      const joined = body.join('\n').trim();
      const innerHtml = joined
        .split(/\n{2,}/)
        .map((p) => paragraphHtml(p, notices, options))
        .join('');
      if (!push(
        'blockquote',
        renderCallout('neutral', options.blockquoteLabel ?? 'Note', innerHtml),
        textLines(joined) + 2,
      )) break scan;
      continue;
    }

    // Lists.
    const listMark = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(line);
    if (listMark) {
      if (!flushParagraph()) break scan;
      const ordered = /\d/.test(listMark[2]);
      const startNum = ordered ? parseInt(listMark[2], 10) : 1;
      // The run's own depth. An item of the OTHER kind nested deeper than this
      // is a child of the item above it — a numbered step with bulleted
      // sub-points, which is how a model writes a plan — and stays in the run.
      // The same kind at the run's depth is a sibling, and the run ends. This
      // used to end the run on any change of kind, so every numbered step
      // with sub-points opened a new list and every one was numbered "1."
      // (measured on a Market Intelligence layer, RS-5c.6).
      const floorDepth = Math.floor(listMark[1].replace(/\t/g, '  ').length / 2);
      const items: ListItem[] = [];
      let mergedRuns = 0;
      while (i < lines.length) {
        const m = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(lines[i]);
        if (!m) {
          // A plain continuation line belongs to the item above it.
          if (items.length && lines[i].trim() && /^\s{2,}\S/.test(lines[i])) {
            items[items.length - 1].text += ` ${lines[i].trim()}`;
            i++;
            continue;
          }
          // A blank line inside a list is CommonMark's *loose* list, not the
          // end of it. Breaking here is what turned a fifteen-item checklist
          // into fifteen one-item lists, every one numbered "1." — measured on
          // a real due-diligence page. Peek past the blanks: if the next
          // non-blank line is an item of the same kind, the run continues.
          if (items.length && !lines[i].trim()) {
            let j = i;
            while (j < lines.length && !lines[j].trim()) j++;
            const next = j < lines.length ? /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(lines[j]) : null;
            const nextDepth = next ? Math.floor(next[1].replace(/\t/g, '  ').length / 2) : 0;
            if (next && (/\d/.test(next[2]) === ordered || nextDepth > floorDepth)) {
              mergedRuns++;
              i = j;
              continue;
            }
          }
          break;
        }
        const itemOrdered = /\d/.test(m[2]);
        const rawDepth = Math.floor(m[1].replace(/\t/g, '  ').length / 2);
        if (itemOrdered !== ordered && rawDepth <= floorDepth) break;
        const depth = Math.min(rawDepth, MAX_LIST_DEPTH - 1);
        if (rawDepth > MAX_LIST_DEPTH - 1) notices.listsFlattened++;
        items.push({ depth, text: m[3], ordered: itemOrdered });
        i++;
      }
      // Nesting is by RANK of indentation, not by columns: a four-space child
      // (CommonMark's own indent) is one level under its step, not two — the
      // column count opened two `<ul>`s for one sub-point and charged the
      // measure twice over.
      const levels = [...new Set(items.map((it) => it.depth))].sort((a, b) => a - b);
      for (const it of items) it.depth = levels.indexOf(it.depth);
      const kept = items.slice(0, MAX_LIST_ITEMS);
      notices.listItemsDropped += items.length - kept.length;
      if (mergedRuns) notices.listRunsMerged += mergedRuns;
      const listCost = geometry
        ? listCharge(geometry, kept.map((it) => ({ chars: printedChars(it.text), depth: it.depth })))
        : listLines(kept) + 1;
      const listMeta: MarkdownListMeta = {
        items: kept.map((it) => ({ depth: it.depth, text: it.text, chars: printedChars(it.text), ordered: it.ordered })), ordered, start: startNum,
      };
      if (!push('list', listHtml(kept, ordered, notices, startNum, options), listCost, undefined, listMeta)) break scan;
      continue;
    }

    // Thematic break. Dropped: it carries no content, and the design system's
    // own block rhythm already separates. The one construct where dropping is
    // unambiguously right.
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed.replace(/\s/g, ''))) {
      if (!flushParagraph()) break scan;
      notices.thematicBreaks++;
      i++;
      continue;
    }

    if (!trimmed) {
      if (!flushParagraph()) break scan;
      i++;
      continue;
    }

    paragraph.push(line);
    i++;
  }
  flushParagraph();

  // The notes the references point at, in first-use order, after everything
  // that could use one has been rendered. Only defined-and-referenced notes
  // print; an unreferenced definition is the author talking to themselves.
  if (activeFootnotes && footnoteOrder.length) {
    const items = footnoteOrder
      .map((id) => footnoteDefs.get(id) ?? '')
      .filter(Boolean)
      .map((def, idx) => `<li value="${idx + 1}">${renderInlineMarkdown(def, notices, options)}</li>`);
    if (items.length) {
      const html = `<h4>Notes</h4><ol class="fn-notes">${items.join('')}</ol>`;
      const notesCost = geometry
        ? headingCharge(geometry, 4, 5)
          + listCharge(geometry, footnoteOrder.map((id) => ({ chars: printedChars(footnoteDefs.get(id) ?? ''), depth: 0 })))
        : items.length + 2;
      push('list', html, notesCost);
    }
  }
  activeFootnotes = null;

  // A heading with nothing under it promises analysis the page does not
  // deliver — five in a stack over white space was measured on a real report
  // after the word-cap truncation kept structure while dropping its prose.
  // Dropped bottom-up so a run of empty headings collapses in one pass.
  if (options.dropEmptyHeadings !== false) {
    const levelOf = (b: MarkdownBlock) => Number(/^<h(\d)/.exec(b.html)?.[1] ?? 9);
    for (let k = blocks.length - 1; k >= 0; k--) {
      if (blocks[k].kind !== 'heading') continue;
      const next = blocks[k + 1];
      const empty = !next
        || (next.kind === 'heading' && levelOf(next) <= levelOf(blocks[k]))
        || (next.kind === 'notice');
      if (empty) {
        const removed = blocks.splice(k, 1)[0];
        const hIdx = headings.findIndex((h) => h.blockIndex === k);
        if (hIdx >= 0) headings.splice(hIdx, 1);
        for (const h of headings) if (h.blockIndex > k) h.blockIndex--;
        notices.headingsDroppedEmpty++;
        void removed;
      }
    }
  }

  const total = blocks.reduce((n, b) => n + b.lines, 0);

  // The truncation notice is part of the document, not a log line. It names the
  // residue exactly, so a reader knows what they are missing and where to get
  // it — silent truncation is the failure this whole migration removes.
  if (notices.truncatedAtChars !== null || notices.truncatedAtBlocks) {
    const said = notices.truncatedAtChars !== null
      ? `A further ${notices.truncatedAtChars.toLocaleString('en-AU')} characters of this answer are not shown.`
      : 'The remainder of this answer is not shown.';
    blocks.push({
      kind: 'notice',
      html: renderCallout(
        'caution',
        options.truncationLabel ?? 'Not shown',
        `<p>${escapeHtml(said)} The complete text is in the Markdown export.</p>`,
      ),
      lines: 3,
    });
  }

  const degraded = notices.truncatedAtChars !== null
    || notices.truncatedAtBlocks
    || notices.tableRowsDropped > 0
    || notices.tableColumnsDropped > 0
    || notices.listItemsDropped > 0
    || notices.codeLinesDropped > 0
    || notices.headingsDropped > 0;

  return {
    blocks,
    html: blocks.map((b) => b.html).join(''),
    headings,
    lines: total,
    notices,
    degraded,
  };

  // ── Emitters, closed over the accumulators above ────────────────────────

  function emitHeading(sourceLevel: number, raw: string): boolean {
    if (headings.length >= MAX_HEADINGS) {
      notices.headingsDropped++;
      return true;
    }
    // Relative to this run's own shallowest heading, then clamped.
    //
    // Relative because models are inconsistent about whether they open at `#` or
    // `##`, and an answer written entirely in `##`/`###` must render with the
    // same hierarchy as one written in `#`/`##` rather than being pushed a level
    // down for an arbitrary authoring choice. Clamped at 4 because `h4` is the
    // last level the stylesheet dresses and `h5` would print at body size with
    // the user agent's own margins.
    const level = Math.min(4, Math.max(base, base + (sourceLevel - minLevel))) as 2 | 3 | 4;
    const plain = markdownToPlainText(raw, 160);
    const stem = `${idPrefix}-${headings.length + 1}-${slugify(plain)}`;
    const seen = idsUsed.get(stem) ?? 0;
    idsUsed.set(stem, seen + 1);
    const id = seen ? `${stem}-${seen + 1}` : stem;
    // The chapter's own name, said again as its first heading. See
    // `MarkdownOptions.chapterTitle`. Dropped only while nothing has been
    // emitted yet — later on, a heading of the same name is a real subsection.
    if (!blocks.length && chapterTitle && sameWords(plain, chapterTitle)) return true;

    const html = `<h${level} id="${id}">${renderInlineMarkdown(raw, notices, options)}</h${level}>`;
    const index = blocks.length;
    if (!push('heading', html, geometry ? headingCharge(geometry, level, plain.length) : headingCost)) return false;
    headings.push({ level, sourceLevel, text: plain, id, blockIndex: index });
    return true;
  }

  function emitTable(header: string[], delim: string[], body: string[][]): boolean {
    // Column keys are positional, never the header text. `TableRow` is keyed by
    // string (`primitives.pure.ts:397`), so two columns both headed "Value"
    // would collide and one would silently render blank — and a positional key
    // can never collide with the reserved `__total` either.
    const width = Math.min(header.length, MAX_TABLE_COLS);
    const droppedCols = header.slice(width);
    notices.tableColumnsDropped += droppedCols.length;

    const keptRows = body.slice(0, MAX_TABLE_ROWS);
    notices.tableRowsDropped += body.length - keptRows.length;

    const cells = keptRows.map((r) => {
      if (r.length !== header.length) notices.tablesRagged++;
      // A short row's trailing cells become empty, which is GFM's own reading.
      // A long row's extras are dropped and counted, because a row wider than
      // its header is a malformed table and the count is how anyone finds out.
      // Against the header, not against the cap: the columns cut by
      // `MAX_TABLE_COLS` are already counted once above, and counting them
      // again per row would report a 19-column table as losing 14.
      if (r.length > header.length) notices.tableColumnsDropped += r.length - header.length;
      return Array.from({ length: width }, (_, c) => stripMarkers(r[c] ?? '').trim());
    });

    // A column the model gave no alignment to but filled with figures is a
    // numeric column. Saying so is what buys `tabular-nums` and `white-space:
    // nowrap` from the sheet — the difference between a readable ledger column
    // and an unreadable one, and the reason this goes through the primitive.
    const numeric = Array.from({ length: width }, (_, c) => {
      const values = cells.map((r) => r[c]).filter(Boolean);
      return values.length > 0 && values.every((v) => NUMERIC_CELL.test(v));
    });

    const cols: TableColumn[] = Array.from({ length: width }, (_, c) => ({
      key: `c${c}`,
      label: stripMarkers(header[c] ?? '').trim(),
      // `TableColumn.align` is `'left' | 'right'` only (`primitives.pure.ts:394`),
      // so `:---:` lands on left. Inventing a centre alignment the design system
      // does not have is out of scope for a format module.
      align: (/-:$/.test(delim[c] ?? '') && !/^:-/.test(delim[c] ?? '')) || numeric[c] ? 'right' : 'left',
    }));

    // A single column is a list wearing a ledger's clothes. `table.data` would
    // give it banded rows and a mono uppercase head, and its tagged structure is
    // strictly worse than a real list's.
    if (width === 1) {
      const items = cells.map((r) => ({ depth: 0, text: r[0] })).filter((it) => it.text);
      const head = cols[0].label ? `<h4>${escapeHtml(cols[0].label)}</h4>` : '';
      const singleCost = geometry
        ? (head ? headingCharge(geometry, 4, cols[0].label.length) : 0)
          + listCharge(geometry, items.map((it) => ({ chars: printedChars(it.text), depth: 0 })))
        : listLines(items) + 2;
      return push('list', head + listHtml(items, false, notices, 1, options), singleCost);
    }

    const rows: TableRow[] = cells.map((r) => {
      const row: TableRow = {};
      r.forEach((v, c) => { row[`c${c}`] = v; });
      // Whole-cell match, so "Total addressable market" is not a total row.
      const first = (r[0] ?? '').trim().toLowerCase();
      if (detectTotal && (first === 'total' || first === 'totals')) row.__total = true;
      return row;
    });

    // See `headlessTableCaption`. Only when the table has no head of its own —
    // a table with real column labels already says what it is.
    // ── Caption the *first* headless table, and only when nothing else names it
    //
    // The first version captioned every headless table with the chapter title,
    // and a chapter with two of them printed the chapter title twice — the
    // second time directly under a subhead that had just said something else.
    // Read off a render: `Capacity Breakdown` (34pt chapter title), the table,
    // `Additional Assumptions` (17pt subhead), then `CAPACITY BREAKDOWN` again.
    // Two competing labels for one table, 12pt apart, and the caption was the
    // wrong one. Worse than the unlabelled table it replaced.
    //
    // So: a heading already standing over the table is the better label and the
    // caption is suppressed, and after the first one the chapter title has been
    // said and repeating it adds nothing.
    //
    // An empty `blocks` counts as named, and that is the case worth spelling
    // out. It means the table is the first thing in the chapter body — so the
    // chapter's own 34pt title is standing directly over it, and the caption is
    // *that same title* (`converted/render.pure.ts` passes `chapter.title`).
    // The first version of this guard tested `blocks.length > 0`, which excluded
    // exactly the one arrangement where the caption is guaranteed to be a
    // verbatim echo — and that is what both conversions then printed on their
    // densest page.
    const headless = !cols.some((c) => c.label);
    const named = blocks.length === 0 || blocks[blocks.length - 1].kind === 'heading';
    const wantsCaption = headless && headlessCaption && !named && !headlessCaptionUsed;
    if (wantsCaption) headlessCaptionUsed = true;
    const table = renderDataTable(cols, rows, {
      signedKeys: cols.filter((c) => c.align === 'right').map((c) => c.key),
      caption: wantsCaption ? headlessCaption : undefined,
    });

    const wide = width > MAX_PORTRAIT_TABLE_COLS;
    const note = droppedCols.length
      ? renderSidenote(
        'Columns not shown',
        `<p>${escapeHtml(droppedCols.map((h) => stripMarkers(h).trim()).filter(Boolean).join(', '))}</p>`,
      )
      : '';

    // Per-row charge. Legacy charged one line per row whatever the cells held,
    // which is how a risk register whose cells wrap to four lines was packed
    // onto a page it could not fit and clipped mid-row. Measured charges each
    // row by its tallest cell at the column's share of the measure, plus the
    // cell padding the stylesheet adds.
    // Auto table layout gives a prose column its share by content, so a
    // per-column split of the measure overcharges wide cells about 2× (five
    // consecutive half-empty register pages, measured). The row's TOTAL
    // characters against the full measure tracks what auto layout actually
    // sets, with a floor for padding-dominated narrow rows and a small cost
    // per extra column for cell padding.
    const rowCharCounts = rows.map((row) => Object.values(row)
      .filter((v): v is string => typeof v === 'string')
      .reduce((n, v) => n + v.length, 0));
    // The geometry model reads the row's characters against the measure at
    // the table's own scale, padded and ruled as the block styles the cells
    // (`narrativeGeometry.pure.ts`); the two constant models keep theirs.
    // The table model reads each cell's words (its longest word sets the
    // column's floor), so it is handed the printed text rather than a count.
    const geometryTable = geometry ? tableCharge(geometry, cells.map((r) => r.slice(0, width).map(printedText)), width) : null;
    const rowLines = geometryTable
      ? geometryTable.rowLines
      : rowCharCounts.map((totalChars) => (measured
        ? Math.max(1.35, totalChars / cpl + 0.35 + Math.max(0, width - 1) * 0.08)
        : 1));
    const headLines = geometryTable ? geometryTable.headLines : 3;
    const bodyCharge = measured ? rowLines.reduce((a, b) => a + b, 0) : rows.length;
    const meta: MarkdownTableMeta = {
      cols, rows, signedKeys: cols.filter((c) => c.align === 'right').map((c) => c.key),
      caption: wantsCaption ? headlessCaption : undefined,
      note: note || undefined,
      rowLines, headLines,
    };
    if (wide && landscape) {
      notices.tablesLandscaped++;
      return push('landscape-table', renderPage('landscape-table', table + note), bodyCharge + 4 + LANDSCAPE_BREAK_LINES);
    }
    return push('table', table + note, bodyCharge + headLines, meta);
  }
}

function paragraphHtml(block: string, notices: MarkdownNotices, opts?: InlineMarkdownOptions): string {
  return block
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${inlineWithBreaks(p, notices, opts)}</p>`)
    .join('');
}

/** Two trailing spaces or a trailing backslash is a hard break; a bare newline is a space. */
function inlineWithBreaks(paragraph: string, notices: MarkdownNotices, opts?: InlineMarkdownOptions): string {
  return paragraph
    .split('\n')
    .map((l) => ({ text: l.replace(/(?: {2,}|\\)$/, ''), hard: /(?: {2,}|\\)$/.test(l) }))
    .map((l, idx, all) => renderInlineMarkdown(l.text.trim(), notices, opts) + (idx < all.length - 1 ? (l.hard ? '<br>' : ' ') : ''))
    .join('');
}

/**
 * A list, nested correctly.
 *
 * The sublist goes **inside** the `<li>` it belongs to, which is the whole
 * difficulty: the obvious loop — close the item, open the sublist, carry on —
 * produces `<ul><li>a</li><ul><li>b</li></ul></ul>`, where the nested list is a
 * sibling of the item rather than its child. That is invalid HTML, and
 * WeasyPrint renders it as a second list at the parent's own indent, so the
 * nesting the author wrote is simply not on the page. Caught by looking at the
 * output rather than by the type checker, which is happy either way.
 */
function listHtml(items: readonly ListItem[], ordered: boolean, notices: MarkdownNotices, start = 1, opts?: InlineMarkdownOptions): string {
  if (!items.length) return '';
  const tagOf = (o: boolean) => (o ? 'ol' : 'ul');
  const topTag = tagOf(ordered);
  // `start` carries the source's own first ordinal, so a numbered run the
  // author opened at 4 (after prose interrupted it), or a chunk the packer
  // cut from a longer list, keeps counting from there. The pinned engine
  // reads neither `start` nor `<li value>` (WeasyPrint 69.0, measured:
  // `<ol start="2">` set "1."), and does read the CSS counter the attribute
  // stands for — so both are written: the attribute for any reader that
  // honours it, the counter for the one that does not.
  const first = Math.min(9999, Math.max(2, Math.floor(start)));
  const openTag = ordered && start > 1 && Number.isFinite(start)
    ? `<ol start="${first}" style="counter-reset:list-item ${first - 1}">`
    : `<${topTag}>`;
  // A list that opens indented still starts at depth zero; the author's absolute
  // indentation is not the document's.
  const floor = Math.min(...items.map((it) => it.depth));
  let out = openTag;
  // The open list tags, by depth. A nested run takes the kind of ITS marker
  // (bullets under a numbered step), not its parent's.
  const stack: string[] = [topTag];
  let itemOpen = false;
  for (const item of items) {
    const want = item.depth - floor;
    if (want > stack.length - 1) {
      // Opened while the parent item is still open, so it nests inside it.
      while (stack.length - 1 < want) {
        const tag = tagOf(item.ordered ?? ordered);
        out += `<${tag}>`;
        stack.push(tag);
      }
      itemOpen = false;
    } else {
      while (stack.length - 1 > want) {
        if (itemOpen) { out += '</li>'; itemOpen = false; }
        out += `</${stack.pop()}></li>`;
      }
      if (itemOpen) { out += '</li>'; itemOpen = false; }
    }
    out += `<li>${renderInlineMarkdown(item.text, notices, opts)}`;
    itemOpen = true;
  }
  while (stack.length > 1) {
    if (itemOpen) { out += '</li>'; itemOpen = false; }
    out += `</${stack.pop()}></li>`;
  }
  if (itemOpen) out += '</li>';
  return `${out}</${stack[0]}>`;
}

/**
 * Split a paragraph at a sentence boundary so its head fills the room left on
 * a page and its tail opens the next.
 *
 * A packer that only pushes leaves the room a paragraph did not fit into
 * empty — measured on the long reference report (14 Sep 2026) the narrative
 * pages ended 60-140pt above the bottom the master sets, a whole paragraph's
 * worth on most of them, which is what "large unused sections" looked like
 * once nothing overflowed any more. A sentence is the unit every typeset book
 * breaks a page inside.
 *
 * The cut is taken only where it is honest: after sentence punctuation, with
 * every inline tag opened in the head closed in it (a `<strong>` cannot span
 * the break), and with at least `minLines` on either side so neither page
 * carries a widow or an orphan. `charge` is the caller's paragraph charge —
 * the geometry model's, so the head is charged exactly as any paragraph is.
 * Nothing is reworded; the two parts concatenate to the original.
 */
export function splitParagraphBlock(
  block: MarkdownBlock,
  firstBudget: number,
  charge: (chars: number) => number,
  minLines = 2,
): MarkdownBlock[] {
  if (block.kind !== 'paragraph') return [block];
  const m = /^<p>([\s\S]*)<\/p>$/.exec(block.html.trim());
  if (!m || m[1].includes('<p>')) return [block];
  const inner = m[1];
  const plainLength = (html: string) => html.replace(/<[^>]+>/g, '').length;
  const balanced = (html: string) => ['strong', 'em', 'a', 'code', 'span', 'b', 'i', 'u', 's', 'sub', 'sup', 'mark']
    .every((tag) => (html.match(new RegExp(`<${tag}[\\s>]`, 'g')) ?? []).length === (html.match(new RegExp(`</${tag}>`, 'g')) ?? []).length);
  const boundary = /[.!?…][”"’')\]]*\s+(?=[A-Z0-9“"(])/g;
  let best: number | null = null;
  for (const hit of inner.matchAll(boundary)) {
    const cut = (hit.index ?? 0) + hit[0].length;
    const head = inner.slice(0, cut).trimEnd();
    if (!balanced(head)) continue;
    const headLines = charge(plainLength(head));
    if (headLines > firstBudget) break;
    if (headLines < minLines || charge(plainLength(inner.slice(cut))) < minLines) continue;
    best = cut;
  }
  if (best === null) return [block];
  const head = inner.slice(0, best).trimEnd();
  const tail = inner.slice(best);
  return [
    { kind: 'paragraph', html: `<p>${head}</p>`, lines: charge(plainLength(head)) },
    { kind: 'paragraph', html: `<p>${tail}</p>`, lines: charge(plainLength(tail)) },
  ];
}

/**
 * Split a list taller than the room it has into page-sized chunks, by
 * top-level item.
 *
 * A list block was never split: a 28-item nested list on the long reference
 * report (14 Sep 2026) charged 81 lines against a 40-line page, was given a
 * page of its own, and was clipped at the page's edge — its last eleven
 * items, "Public transport & road access" among them, were drawn below the
 * paper and never seen. A top-level item travels with its nested items, so
 * a chunk never opens on a sub-point whose parent is on the page before;
 * a chunk carries at least two top-level items unless only one remains. An
 * ordered list's numbering continues across chunks.
 *
 * `charge` is the caller's list charge — the geometry model's — so each
 * chunk is charged exactly as any list is. The chunk is re-set through
 * `listHtml` with notices nobody reads: the original render counted them.
 */
export function splitListBlock(
  block: MarkdownBlock,
  firstBudget: number,
  contBudget: number,
  charge: (items: readonly { depth: number; text: string }[]) => number,
): MarkdownBlock[] {
  const meta = block.list;
  if (block.kind !== 'list' || !meta || meta.items.length < 2) return [block];
  const items = meta.items;
  const minDepth = Math.min(...items.map((it) => it.depth));
  // Where the list may be cut: before a top-level item always; inside a
  // top-level item's run of nested items only where at least
  // `NESTED_CUT_MIN` nested items stay on each side, so a lead-in never
  // stands over nothing and a continuation never opens with a lone child.
  // Cutting only between top-level groups was measured on the Chancery
  // render (RS-4, 14 Sep 2026): a group of a lead-in and four three-line
  // children did not fit the fourteen lines left, the whole list moved on,
  // and the page under it was 45% white.
  const cuts: number[] = [];
  for (let k = 1; k < items.length; k++) {
    if (items[k].depth === minDepth) { cuts.push(k); continue; }
    // k is inside a group: count nested items before and after the cut.
    let start = k - 1;
    while (start >= 0 && items[start].depth !== minDepth) start--;
    let end = k;
    while (end < items.length && items[end].depth !== minDepth) end++;
    const before = k - start - 1;
    const after = end - k;
    if (before >= NESTED_CUT_MIN && after >= NESTED_CUT_MIN) cuts.push(k);
  }
  if (!cuts.length) return [block];

  const notices = emptyNotices();
  const out: MarkdownBlock[] = [];
  let index = 0;
  let ordinal = meta.start;
  while (index < items.length) {
    const budget = Math.max(2, out.length === 0 ? firstBudget : contBudget);
    // The furthest cut whose head fits the budget; failing that, the nearest
    // cut, so every chunk carries at least one whole piece.
    const candidates = cuts.filter((c) => c > index);
    let end = items.length;
    if (candidates.length) {
      const fitting = candidates.filter((c) => charge(items.slice(index, c)) <= budget);
      if (fitting.length && charge(items.slice(index)) > budget) end = fitting[fitting.length - 1];
      else if (!fitting.length && charge(items.slice(index)) > budget) end = candidates[0];
    }
    const chunk = items.slice(index, end);
    const topLevel = chunk.filter((it) => it.depth === minDepth).length;
    out.push({
      kind: 'list',
      html: listHtml(chunk, meta.ordered, notices, ordinal),
      lines: charge(chunk),
      list: { items: chunk, ordered: meta.ordered, start: ordinal },
    });
    ordinal += topLevel;
    index = end;
  }
  return out;
}

/** Nested items that must stay on each side of a cut inside a top-level item. */
export const NESTED_CUT_MIN = 2;

/** Sum of block lines. The caller divides by its own lines-per-page. */
export function estimateLines(blocks: readonly MarkdownBlock[]): number {
  return blocks.reduce((n, b) => n + b.lines, 0);
}

/**
 * Split a taller-than-a-page table into page-sized chunks, head repeated.
 *
 * Only a block carrying `MarkdownTableMeta` can split — the rows are re-set
 * through `renderDataTable`, never by cutting HTML. The caption and the
 * columns-not-shown note stay with the first chunk (a repeated caption reads
 * as a second table); the header row repeats on every chunk, which is what a
 * paper ledger does and what the clipped alternative destroyed — a real risk
 * register lost the tail of its last row mid-word.
 *
 * `firstBudget` is the room left on the page the table starts on; `contBudget`
 * sizes every later chunk. A chunk always carries at least two rows so a
 * lone orphan row never opens a page, except when only one row remains — or
 * when the row is a paragraph in its own right. A row of `TALL_ROW_LINES` or
 * more (a risk register's "why it matters" wraps to eleven) stands alone
 * under a repeated head without reading as an orphan, and a two-row table of
 * such rows is the one measured on the sparse reference report (RS-3c,
 * 14 Sep 2026): pushed whole, it left 47% of one page white and stood alone
 * on the next.
 */
export const TALL_ROW_LINES = 4;

export function splitTableBlock(
  block: MarkdownBlock,
  firstBudget: number,
  contBudget: number,
): MarkdownBlock[] {
  const t = block.table;
  if (!t || t.rows.length < 2) return [block];
  const tall = (row: number) => (t.rowLines[row] ?? 1) >= TALL_ROW_LINES;
  // A two-row table splits only when its rows are tall enough to stand alone.
  if (t.rows.length === 2 && !(tall(0) && tall(1))) return [block];

  const out: MarkdownBlock[] = [];
  let index = 0;
  while (index < t.rows.length) {
    const first = out.length === 0;
    const budget = Math.max(t.headLines + 2, (first ? firstBudget : contBudget));
    let charge = t.headLines;
    let take = 0;
    // The chunk's first row decides how many it must hold: a tall row stands alone.
    const minRows = tall(index) ? 1 : 2;
    while (index + take < t.rows.length) {
      const rowCost = t.rowLines[index + take] ?? 1;
      if (take >= minRows && charge + rowCost > budget) break;
      charge += rowCost;
      take++;
    }
    // Never strand a single short row in the final chunk: pull one back.
    if (index + take === t.rows.length - 1 && take > 2 && !tall(t.rows.length - 1)) { take--; charge -= t.rowLines[index + take] ?? 1; }
    const rows = t.rows.slice(index, index + take);
    const rowLines = t.rowLines.slice(index, index + take);
    const html = renderDataTable(t.cols, rows, {
      signedKeys: t.signedKeys,
      caption: first ? t.caption : undefined,
    }) + (first ? (t.note ?? '') : '');
    out.push({
      kind: 'table',
      html,
      lines: Math.max(1, Math.round(charge * 2) / 2),
      table: { ...t, rows, rowLines, caption: first ? t.caption : undefined, note: first ? t.note : undefined },
    });
    index += take;
  }
  return out;
}
