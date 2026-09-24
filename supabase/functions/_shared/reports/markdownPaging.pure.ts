/**
 * Packing rendered Markdown into fixed-height page buckets.
 *
 * This lives on the shared side, and is imported by both the `markdown-block`
 * renderer in `src/lib/reportTemplate/blocks/` and the narrative projections,
 * for a reason that is not tidiness. A master makes page N conditional on
 * `narrative.pages > N` (or `qa.answerPages > N`), and the block decides what
 * page N contains. If the two disagreed by a single line the document would
 * either print a blank page or silently drop its tail — and the tail is the
 * end of something a client is reading. They have to be the same arithmetic,
 * so they are the same functions, and a format that opts into the calibrated
 * profile below must do so on BOTH sides through `resolveNarrativeProfile`.
 *
 * ## The 2026-09 calibration
 *
 * `scripts/reports/markdownCalibration.mts` rendered probes through the real
 * seeded Investment Compass master (WeasyPrint 69, the pinned engine) twice:
 * once with the pager in charge, once with the bucket cap lifted so the page
 * geometry decided. The pager was sending pages at **40–47% of what they
 * hold**: a continuation page really fits ~54.5 rendered line-units and the
 * first narrative page ~42.5 (part-header furniture), while the legacy charge
 * model (65 chars/line, integer rounding) summed the same content to 34 units.
 * Real prose wraps at ~98 characters on this measure, not 65. That under-fill
 * is where every "large sectional gap" in a narrative page came from — the
 * page broke long before it was full.
 *
 * The calibrated profile pairs the measured charge model in `markdown.pure.ts`
 * (`charging: 'measured'`) with budgets set 8% under the measured capacity,
 * because template families set their own body size and a slightly larger face
 * must not push the last line past the box. `DEFAULT_LINES_PER_PAGE` (34) is
 * ALSO the value baked into every deployed master's block props, so it doubles
 * as the legacy sentinel: a schema still carrying 34 is read as "use the
 * calibrated profile" by the formats that opt in, while any other explicit
 * value is honoured verbatim — a hand-tuned master keeps its tuning.
 */
import type { MarkdownBlock, MarkdownTableMeta } from './markdown.pure.ts';
import { splitListBlock, splitParagraphBlock, splitTableBlock } from './markdown.pure.ts';
import { listCharge, paragraphCharge, type NarrativeGeometry } from './narrativeGeometry.pure.ts';

/**
 * The legacy bucket size, and the sentinel every pre-calibration master baked
 * into its block props. Overridable per master.
 */
export const DEFAULT_LINES_PER_PAGE = 34;

/**
 * Measured on the Compass continuation page; see the header — then cut again
 * against a failure in the field. A real Compass render (1/27D Mitchell
 * Street, 2026-09-04) packed its final bucket at 47 charged units under the
 * 50 budget and still overflowed the physical box: the estimator's error on
 * a list-and-margin-heavy page exceeded the 8% held back, the tail printed
 * over the running foot, and the sources bullet lost its description with
 * nothing saying so. The budget therefore sits ~16% under the measured
 * capacity (54.5), because a sparser page costs white space and an overfull
 * one costs a client the end of the document — and only one of those is
 * recoverable by reading on.
 */
export const CALIBRATED_CONT_LINES = 46;
/** The first narrative page's box is shorter (part-header furniture). */
export const CALIBRATED_FIRST_LINES = 36;

export interface NarrativeProfile {
  /** Charge model `renderMarkdown` must be called with. */
  charging: 'measured';
  /** Bucket size for continuation pages, in measured line-units. */
  linesPerPage: number;
  /** Bucket size for the first page (its box is shorter). */
  firstPageLines: number;
  /** Never end a page on a heading or a lead-in line. */
  keepWithNext: true;
  /** Split a taller-than-a-page table by rows, repeating its head. */
  splitTables: true;
  /**
   * Pack by the template's own geometry when the renderer can supply it —
   * see `narrativeGeometry.pure.ts` and `packNarrativeGeometry`. The
   * calibrated budgets above remain the arithmetic for a caller with no
   * template in hand (the projection's template-blind page count).
   */
  geometryAware: boolean;
}

const INVESTMENT_PROFILE: NarrativeProfile = {
  charging: 'measured',
  linesPerPage: CALIBRATED_CONT_LINES,
  firstPageLines: CALIBRATED_FIRST_LINES,
  keepWithNext: true,
  splitTables: true,
  geometryAware: true,
};

/**
 * The formats whose narrative path has been calibrated. Both sides of the
 * contract — the block renderer and the format's projection — resolve through
 * this one function, so they cannot disagree about whether a format is on the
 * calibrated arithmetic. Formats not named here keep the legacy behaviour
 * byte for byte; they join by being measured, not by being assumed
 * (`scripts/reports/markdownCalibration.mts` is the instrument).
 */
export function resolveNarrativeProfile(reportType: string | null | undefined): NarrativeProfile | null {
  const t = String(reportType ?? '').toLowerCase();
  if (t === 'investment' || t === 'investment_compass' || t === 'compass') return INVESTMENT_PROFILE;
  return null;
}

export interface PackOptions {
  /** Bucket size for page 0; defaults to `linesPerPage`. */
  firstPageLines?: number;
  /**
   * When a page break would strand a heading, or a lead-in paragraph ending
   * in a colon, as the last block of a page, carry it (and at most one
   * companion) onto the next page instead. A heading at a page foot promises
   * content the page does not deliver, and "The key considerations are:"
   * followed by white space is the exact defect this was measured from.
   */
  keepWithNext?: boolean;
  /**
   * A table taller than a whole page used to get a bucket of its own and then
   * overflow its fixed-height box — the overflow was clipped at the page edge
   * and the severed row was simply lost (measured on a real risk register:
   * the word "dependency" sliced through by the row rule, its remainder never
   * printed). With this on, such a table is split by rows into page-sized
   * chunks, each repeating the header row, which is what a paper ledger does.
   * A table that fits a page whole still moves whole.
   */
  splitTables?: boolean;
  /**
   * Split a table at a page boundary when the room left on the page holds
   * its head and a few rows, instead of pushing it whole and leaving that
   * room white. Measured on the sparse reference report (14 Sep 2026): a
   * risk table and a checklist pushed whole left 67% and 57% of two pages
   * empty above them. Only a table long enough to survive the cut is split
   * (`BOUNDARY_SPLIT_MIN_ROWS`), and only into room worth using
   * (`BOUNDARY_SPLIT_MIN_LINES`).
   */
  splitAtBoundary?: boolean;
  /**
   * Let a figure that does not fit the room left float past the prose that
   * follows it, up to the next heading, and open the next page instead — the
   * convention every typeset book uses, and the difference between a page
   * that ends where its text ends and one that ends where a chart would not
   * fit. At most `MAX_FLOATED` figures are carried at once; a figure taller
   * than a page is never floated.
   */
  floatFigures?: boolean;
  /**
   * Fold a final bucket of at most `TAIL_ABSORB_LINES` lines onto the page
   * before it. A last page carrying three lines is a page that is 90% white,
   * and the master's content bottom sits 76pt above the running foot on every
   * family, so an overrun that small lands well inside the reserve.
   */
  absorbTail?: boolean;
  /**
   * Split a paragraph that does not fit at a sentence boundary, charging each
   * part with this function (the geometry's paragraph charge), so the room
   * left on a page is filled rather than left white. See
   * `splitParagraphBlock` for what makes a cut honest.
   */
  splitParagraphs?: (chars: number) => number;
  /**
   * Split a list taller than the room it has by top-level item, charging
   * each chunk with this function (the geometry's list charge). A list was
   * never split before, and one taller than a page was clipped at the
   * paper's edge with its tail lost — see `splitListBlock`.
   */
  splitLists?: (items: readonly { depth: number; text: string; chars?: number }[]) => number;
  /**
   * Keep the last page from being a stub. A final page carrying a few lines
   * under a running foot is the one page a reader sees as unfinished, and
   * the packer made it two ways: a boundary cut that filled the page before
   * and left the remainder alone on the next (two bullets on a page 84%
   * white, measured on the long reference report's Midnight render, RS-4),
   * and a short run of blocks that missed the room by a line. So a cut that
   * would leave less than `TAIL_MIN_FRACTION` of a page is made SHORTER —
   * the first piece takes only what leaves the last page that much, and a
   * list whose head would be a single item, or a paragraph with no honest
   * cut left, opens the last page whole; and a short last page draws whole
   * blocks down from the page before it until it holds that much — never a
   * table (its chunks repeat their head) and never a piece cut from a larger
   * block (it would sit beside its sibling as a gap in one list or one
   * paragraph).
   */
  balanceTail?: boolean;
  /**
   * Lines held back on one page for something the caller draws there itself
   * — the "this section continues" note folded onto the last page a master
   * allows, in place of the page of its own the master gave it (RS-5c.6).
   * Zero for every page not named.
   */
  reserveLines?: (pageIndex: number) => number;
}

/** Room held back on one page of a run. See `PackOptions.reserveLines`. */
export interface PageReserve {
  pageIndex: number;
  lines: number;
}

/**
 * Formats whose markdown runs are packed by the template's own geometry when
 * the renderer has the template in hand (`narrativePlan.ts`).
 *
 * The Investment Compass joined by being calibrated (`resolveNarrativeProfile`).
 * Market Intelligence and Report Q&A join by being measured: neither has a
 * profile, so their blocks packed with the legacy estimate at the schema's 34
 * lines against a box that holds about 46 — on the Chancery renders (14 Sep
 * 2026) continuation pages were 20–57% full while the same sections were
 * being clipped by up to fourteen pages, and the Q&A transcript was cut at one
 * exchange. A format named here changes ONLY where a geometry is filed for it;
 * a block rendered on its own still packs exactly as before, and the
 * template-blind estimate the projections publish is untouched.
 */
export function geometryAwareFormat(reportType: string | null | undefined): boolean {
  if (resolveNarrativeProfile(reportType)?.geometryAware) return true;
  const t = String(reportType ?? '').toLowerCase();
  return t === 'market_intelligence' || t === 'marketing_intelligence' || t === 'qa' || t === 'report_qa';
}

export const BOUNDARY_SPLIT_MIN_ROWS = 6;
/** Room worth cutting a paragraph for, and the paragraph worth cutting. */
export const PARAGRAPH_SPLIT_MIN_ROOM = 2.5;
export const PARAGRAPH_SPLIT_MIN_LINES = 4;
export const BOUNDARY_SPLIT_MIN_LINES = 8;
/**
 * A table short of `BOUNDARY_SPLIT_MIN_ROWS` still meets the boundary when it
 * is TALL — its rows are paragraphs, so a head over one row is a page's worth
 * of reading rather than an orphan (`splitTableBlock` lets such a row stand
 * alone). A fifth of a page is tall. The room must also hold the head and the
 * first row, or the cut would only put two heads on the next page.
 */
export const BOUNDARY_SPLIT_TALL_LINES = 2 * BOUNDARY_SPLIT_MIN_LINES;
function survivesTheCut(table: MarkdownTableMeta, remaining: number): boolean {
  if (table.rows.length >= BOUNDARY_SPLIT_MIN_ROWS) return true;
  const total = table.headLines + table.rowLines.reduce((n, l) => n + l, 0);
  return table.rows.length >= 2 && total >= BOUNDARY_SPLIT_TALL_LINES
    && remaining >= table.headLines + (table.rowLines[0] ?? 1) + 1;
}
export const MAX_FLOATED = 2;
export const TAIL_ABSORB_LINES = 3;
/**
 * The least a last page may hold, as a share of a continuation page — a fifth
 * of a page reads as an ending, two bullets read as a page left unfinished.
 */
export const TAIL_MIN_FRACTION = 0.2;
export const tailMinLines = (contBudget: number): number =>
  Math.max(TAIL_ABSORB_LINES + 1, Math.round(contBudget * TAIL_MIN_FRACTION));

const leadsIn = (b: MarkdownBlock): boolean => b.kind === 'paragraph' && /[:：]\s*<\/p>\s*$/.test(b.html);

const sumLines = (blocks: readonly MarkdownBlock[]): number => blocks.reduce((n, b) => n + b.lines, 0);

/**
 * Pack blocks into buckets of at most `linesPerPage` estimated lines.
 *
 * A block taller than a whole page gets a bucket of its own rather than being
 * split — unless it is a table and `splitTables` is on, because a clipped
 * table row is lost content, which is worse than either alternative.
 */
export function packMarkdownPages(
  blocks: readonly MarkdownBlock[],
  linesPerPage: number = DEFAULT_LINES_PER_PAGE,
  options: PackOptions = {},
): MarkdownBlock[][] {
  const contBudget = Math.max(1, linesPerPage);
  // Zero is a real answer, and only for the first page: the body's opening
  // box is shared with a summary and too small to open in (see
  // `MIN_SHARED_FIRST_LINES`), so the first bucket is EMPTY and the body
  // opens on the next page. Anything else keeps its floor of one line.
  const openingSkipped = options.firstPageLines === 0;
  const firstBudget = openingSkipped ? contBudget : Math.max(1, options.firstPageLines ?? contBudget);
  const pages: MarkdownBlock[][] = openingSkipped ? [[]] : [];
  let current: MarkdownBlock[] = [];
  let used = 0;
  // Figures carried past the prose that follows them; they open the next page.
  let floated: MarkdownBlock[] = [];

  const budgetFor = (pageIndex: number) => Math.max(
    1,
    (pageIndex === 0 ? firstBudget : contBudget) - Math.max(0, options.reserveLines?.(pageIndex) ?? 0),
  );

  // What is left to set from each block on, and the least a last page may hold.
  const restFrom: number[] = new Array(blocks.length + 1).fill(0);
  for (let i = blocks.length - 1; i >= 0; i -= 1) restFrom[i] = restFrom[i + 1] + blocks[i].lines;
  const tailMin = tailMinLines(contBudget);
  /** Pieces cut from a larger block; never moved away from their siblings. */
  const cut = new WeakSet<MarkdownBlock>();
  const cutInto = (pieces: readonly MarkdownBlock[]): readonly MarkdownBlock[] => {
    if (pieces.length > 1) for (const piece of pieces) cut.add(piece);
    return pieces;
  };
  /**
   * For a block (or a piece of the block at `index`, `own` lines of it) cut
   * at a page boundary with its first piece holding `fitted` lines: the room
   * the first piece may take instead, so that the last page holds at least
   * `tailMin` — or null when the cut leaves no stub and may stand (a tail
   * small enough to fold back is left to `absorbTail`). Judged on the cut
   * actually made, because a cut lands on whole items and rows and the lines
   * the room could not take are the stub's.
   */
  const stubRoom = (own: number, index: number, fitted: number): number | null => {
    if (!options.balanceTail) return null;
    const rest = own + restFrom[index + 1] + sumLines(floated);
    const stub = rest - fitted;
    if (rest > contBudget || stub <= TAIL_ABSORB_LINES || stub >= tailMin) return null;
    return rest - tailMin;
  };
  const topItems = (b: MarkdownBlock): number => {
    const items = b.list?.items ?? [];
    const top = Math.min(...items.map((it) => it.depth));
    return items.filter((it) => it.depth === top).length;
  };

  const breakPage = () => {
    if (!current.length) return;
    let peeled: MarkdownBlock[] = [];
    if (options.keepWithNext) {
      /*
       * A page that is NOTHING but a heading is the defect this option exists
       * to prevent, produced by this option.
       *
       * Measured on the Financial report for 18 Annabelle Crescent (17 Sep
       * 2026): pages 16 and 18 carried `Base case` and `Optimistic` and
       * nothing else — a heading above a running foot, its scenario table on
       * the page after. The sequence is the peel's own: a heading is peeled
       * off a full page onto a fresh one, the block that follows still does
       * not fit beside it, and the guard below — `current.length > 1`, there
       * so a page is never carried whole and the packer cannot loop — then
       * refuses to peel it a second time.
       *
       * So a page made ENTIRELY of keep-with-next blocks is carried whole.
       * It cannot loop: whatever comes next is not peelable, so the page
       * holding it has a non-peelable block and is pushed.
       */
      const peelable = (b: MarkdownBlock) => b.kind === 'heading' || leadsIn(b);
      if (current.length <= 2 && current.every(peelable)) {
        peeled = current.splice(0, current.length);
      } else {
        // Peel a trailing heading / lead-in so it opens the next page instead
        // of closing this one. At most two blocks (a heading over a lead-in),
        // and never the whole page.
        while (current.length > 1 && peeled.length < 2) {
          const last = current[current.length - 1];
          if (last.kind !== 'heading' && !leadsIn(last)) break;
          peeled.unshift(current.pop()!);
        }
      }
    }
    // …and a page carried away whole leaves nothing to push.
    if (current.length) pages.push(current);
    // A floated figure is earlier content than anything peeled, so it leads.
    current = [...floated, ...peeled];
    floated = [];
    used = sumLines(current);
  };

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const budget = budgetFor(pages.length);
    let pieces: readonly MarkdownBlock[] = [block];
    // A chunked block is cut for the room it will land in. The first chunk is
    // sized to the room left on this page; when it still does not fit there
    // (a chunk must hold a whole row or a whole item group) it will open the
    // next page, so the block is re-cut as if it started on a fresh page —
    // otherwise a first chunk sized for nine lines lands alone on a page of
    // forty and the page-sized chunk behind it cannot follow. Measured on the
    // long reference report's Chancery render (RS-4, 14 Sep 2026): a risk
    // register's first row stood alone on a page 70% white.
    const landed = (cut: (first: number) => readonly MarkdownBlock[], room: number, remaining: number): readonly MarkdownBlock[] => {
      const first = cut(room);
      return first.length > 1 && first[0].lines > remaining ? cut(contBudget) : first;
    };
    if (options.splitLists && block.kind === 'list' && block.list) {
      const remaining = budget - used;
      const room = current.length && remaining >= BOUNDARY_SPLIT_MIN_LINES ? remaining : contBudget;
      const cutList = (first: number) => splitListBlock(block, first, contBudget, options.splitLists!);
      if (block.lines > budget) {
        pieces = cutInto(landed(cutList, room, remaining));
      } else if (
        options.splitAtBoundary && current.length && block.lines > remaining
        && remaining >= BOUNDARY_SPLIT_MIN_LINES
        // Six items, or a TALL list of fewer — five paragraph-long bullets
        // pushed whole left half a page white on the long report (RS-4).
        && (block.list.items.length >= BOUNDARY_SPLIT_MIN_ROWS || block.lines >= BOUNDARY_SPLIT_TALL_LINES)
      ) {
        let at = landed(cutList, remaining, remaining);
        const room = stubRoom(block.lines, index, at[0].lines);
        // A cut that would leave a stub is made shorter, so the last page
        // holds an ending; a head of one item is not a head, so the list
        // opens the last page whole instead.
        if (room !== null) {
          at = room > 0 ? landed(cutList, Math.min(remaining, room), remaining) : [block];
          if (at.length > 1 && topItems(at[0]) < 2) at = [block];
        }
        pieces = cutInto(at);
      }
    }
    if (block.kind === 'table' && block.table) {
      const remaining = budget - used;
      const cutTable = (first: number) => splitTableBlock(block, first, contBudget);
      if (options.splitTables && block.lines > budget) {
        // First chunk sizes to the space left on the current page when that is
        // worth using (head + a few rows); otherwise every chunk is page-sized
        // and the pack loop opens a fresh page for the first one naturally.
        const firstChunk = current.length && remaining >= BOUNDARY_SPLIT_MIN_LINES ? remaining : contBudget;
        pieces = cutInto(landed(cutTable, firstChunk, remaining));
      } else if (
        options.splitAtBoundary && current.length && block.lines > remaining
        && remaining >= BOUNDARY_SPLIT_MIN_LINES && survivesTheCut(block.table, remaining)
      ) {
        let at = landed(cutTable, remaining, remaining);
        const room = stubRoom(block.lines, index, at[0].lines);
        if (room !== null) at = room > 0 ? landed(cutTable, Math.min(remaining, room), remaining) : [block];
        pieces = cutInto(at);
      }
    }

    const queue = [...pieces];
    while (queue.length) {
      const piece = queue.shift()!;
      const pageBudget = budgetFor(pages.length);
      const remaining = pageBudget - used;
      if (current.length && piece.lines > remaining) {
        if (options.floatFigures && piece.kind === 'figure' && floated.length < MAX_FLOATED && piece.lines <= contBudget) {
          floated.push(piece);
          continue;
        }
        if (options.splitParagraphs && piece.kind === 'paragraph'
          && remaining >= PARAGRAPH_SPLIT_MIN_ROOM && piece.lines >= PARAGRAPH_SPLIT_MIN_LINES) {
          let parts = splitParagraphBlock(piece, remaining, options.splitParagraphs);
          const room = parts.length === 2 ? stubRoom(piece.lines, index, parts[0].lines) : null;
          // A cut that would leave a stub is made shorter; with too little
          // room for an honest cut the paragraph opens the last page whole.
          if (room !== null) {
            parts = room >= PARAGRAPH_SPLIT_MIN_ROOM ? splitParagraphBlock(piece, Math.min(remaining, room), options.splitParagraphs) : [piece];
          }
          // The head fits the room by construction; the tail comes round again
          // and opens the next page.
          if (parts.length === 2) { queue.unshift(...cutInto(parts)); continue; }
        }
        // A later chunk of a table was cut for a fresh page; where it lands on
        // one already part-full, it is cut again for the room that is there.
        // The risk register of the 18 Annabelle Crescent Compass (Board Pack
        // Brief, 23 Sep 2026) left ten lines white under its second chunk
        // because its third — two tall rows — could not follow whole, when
        // its first row could.
        if (options.splitTables && piece.kind === 'table' && piece.table
          && remaining >= BOUNDARY_SPLIT_MIN_LINES) {
          const parts = splitTableBlock(piece, remaining, contBudget);
          if (parts.length > 1 && parts[0].lines <= remaining) { queue.unshift(...cutInto(parts)); continue; }
        }
        breakPage();
      } else if (floated.length && piece.kind === 'heading' && current.length) {
        // A new section: the figure it follows must not drift into it.
        breakPage();
      }
      current.push(piece);
      used += piece.lines;
    }
  }
  if (floated.length) {
    // Nothing followed the figure on this page; it opens the last one.
    if (current.length) breakPage();
    else { current = floated; floated = []; }
  }
  if (current.length) pages.push(current);
  // The reserved empty opening is not a page anything may be folded into.
  const firstPackable = openingSkipped ? 1 : 0;
  if (options.absorbTail && pages.length > firstPackable + 1 && sumLines(pages[pages.length - 1]) <= TAIL_ABSORB_LINES) {
    const tail = pages.pop()!;
    pages[pages.length - 1].push(...tail);
  }
  if (options.balanceTail && pages.length > firstPackable + 1 && sumLines(pages[pages.length - 1]) < tailMin) {
    const last = pages[pages.length - 1];
    const prev = pages[pages.length - 2];
    const prevBudget = budgetFor(pages.length - 2);
    // Whole blocks come down until the last page holds enough — never a table
    // (its chunks each repeat the head), never a piece cut from a larger block
    // (it would sit beside its sibling as a gap), and never so many that the
    // page before is left emptier than the stub it avoids: a short last page
    // is an ending, a short penultimate page is a mistake.
    while (prev.length > 1 && sumLines(last) < tailMin) {
      const foot = prev[prev.length - 1];
      if (foot.kind === 'table' || cut.has(foot)) break;
      if (sumLines(last) + foot.lines > contBudget || sumLines(prev) - foot.lines < prevBudget / 2) break;
      last.unshift(prev.pop()!);
    }
    // What came down is not left under a heading or a lead-in with nothing after it.
    while (options.keepWithNext && prev.length > 1) {
      const foot = prev[prev.length - 1];
      if ((foot.kind !== 'heading' && !leadsIn(foot)) || sumLines(last) + foot.lines > contBudget) break;
      last.unshift(prev.pop()!);
    }
  }
  return pages;
}

/**
 * The one call both sides of a calibrated format make.
 *
 * `schemaLinesPerPage` is the value baked into the master's block props. The
 * legacy sentinel (34) — and any absent value — resolves to the calibrated
 * budgets; an explicit different value is a hand-tuned master and is honoured
 * with the profile's packing behaviours but its own bucket size.
 */
export function packNarrativePages(
  blocks: readonly MarkdownBlock[],
  profile: NarrativeProfile,
  schemaLinesPerPage?: number,
): MarkdownBlock[][] {
  const custom = schemaLinesPerPage !== undefined
    && schemaLinesPerPage !== DEFAULT_LINES_PER_PAGE
    && schemaLinesPerPage > 0;
  const lines = custom ? schemaLinesPerPage! : profile.linesPerPage;
  const first = custom ? schemaLinesPerPage! : profile.firstPageLines;
  return packMarkdownPages(blocks, lines, {
    firstPageLines: first,
    keepWithNext: profile.keepWithNext,
    splitTables: profile.splitTables,
  });
}

/**
 * Pack by one template's geometry: the first page's and the continuation
 * pages' own line capacities, with the profile's packing behaviours. The
 * blocks must have been charged with the SAME geometry (`renderMarkdown`'s
 * `geometry` option), and every instance of the run must be packed with it,
 * because each packs the whole source and a differing budget on one instance
 * prints a line twice or not at all.
 */
export function packNarrativeGeometry(
  blocks: readonly MarkdownBlock[],
  geometry: NarrativeGeometry,
  reserve: PageReserve | null = null,
): MarkdownBlock[][] {
  return packMarkdownPages(blocks, geometry.contLines, {
    firstPageLines: geometry.firstPageLines,
    reserveLines: reserve ? (i) => (i === reserve.pageIndex ? reserve.lines : 0) : undefined,
    keepWithNext: true,
    splitTables: true,
    splitAtBoundary: true,
    floatFigures: true,
    absorbTail: true,
    balanceTail: true,
    splitParagraphs: (chars) => paragraphCharge(geometry, chars),
    splitLists: (items) => listCharge(geometry, items.map((it) => ({ chars: it.chars ?? it.text.length, depth: it.depth }))),
  });
}

/**
 * Which of the report's own sections landed in which packed bucket.
 *
 * ## Why this exists
 *
 * The contents page listed the MASTER'S page names — "The report", "The report
 * (2)" … — because that is all `ctx.pages` carries. On the Compass that is
 * twenty-two identical entries naming a page archetype, and a reader looking
 * for Planning has nothing to look for. The report's real sections are
 * headings inside the flowing narrative, and where each one lands is not
 * knowable until the narrative has been packed against the template's own
 * geometry.
 *
 * It is knowable at that moment, though, and nothing new has to be computed:
 * `packMarkdownPages` already returns the buckets, a heading block already
 * carries its level and a stable `id` in its own html (`<h2 id="…">`), and the
 * renderer's pre-pass already packs once and memoises. So the index is a read
 * over what the packer produced.
 *
 * Two rules.
 *
 * **A bucket is not a page.** This answers in bucket numbers, because a bucket
 * lands on whichever document page the master drew it on, and only the
 * renderer knows that. Turning one into the other is the caller's job, and
 * keeping it out of here is what stops this module guessing at a layout it
 * cannot see.
 *
 * **The label is what printed.** It is taken from the rendered heading with
 * its inline markup removed, not from the source line, so a section set as
 * `## **Planning** controls` is listed as "Planning controls" — the words a
 * reader saw, with the emphasis that carried them dropped.
 */
export interface NarrativeSection {
  /** The heading's text as printed, inline markup removed. */
  label: string;
  /** 1–6, as the rendered heading carries it. */
  level: number;
  /** The heading's own id, so a contents entry can land on the section. */
  id: string;
  /** Which packed bucket it fell in. NOT a document page number. */
  bucket: number;
}

const HEADING = /^<h([1-6])\b([^>]*)>([\s\S]*)<\/h\1>\s*$/;
const ID_ATTR = /\bid="([^"]*)"/;

/** Strip tags, then the entities `esc` writes, in the order that cannot double-decode. */
function printedText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sectionIndexFromBuckets(
  buckets: readonly (readonly MarkdownBlock[])[],
): NarrativeSection[] {
  const out: NarrativeSection[] = [];
  buckets.forEach((blocks, bucket) => {
    for (const b of blocks) {
      if (b.kind !== 'heading') continue;
      const m = HEADING.exec(b.html);
      if (!m) continue;
      const label = printedText(m[3]);
      // A heading with no words is not a destination. `renderMarkdown` already
      // drops one with nothing under it; this is the belt for anything else.
      if (!label) continue;
      const id = ID_ATTR.exec(m[2])?.[1] ?? '';
      if (!id) continue;
      out.push({ label, level: Number(m[1]), id, bucket });
    }
  });
  return out;
}
