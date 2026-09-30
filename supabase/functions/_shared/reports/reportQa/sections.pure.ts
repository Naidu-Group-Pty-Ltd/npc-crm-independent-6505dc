/**
 * The spine, discovered rather than declared.
 *
 * Every format before this one names its sections in code: the Client Details
 * document has eight, the Cash Flow Comparison ten, and which of them appear is
 * a question about which rows exist. This one cannot work that way. Its sections
 * are the headings a model wrote, so the spine is read out of the content — and
 * that makes two things this module has to get right that the others got for
 * free.
 *
 * **The contents page must match the document.** `contentsEntriesFor` derives
 * the listing from the spine, so as long as the spine is built from the same
 * `MarkdownResult` the renderer prints, they cannot disagree. That is why this
 * module takes the parsed result rather than the raw Markdown: parsing twice
 * would be two answers to "what are the sections".
 *
 * **The spine must be legal whatever the model wrote.** A model that emits forty
 * `##` headings would produce forty chapters, each claiming a page, and the
 * document would fail its own page band. So headings are promoted to chapters
 * only at the top level the answer used, the rest stay inside the body they
 * belong to, and the count is capped. `validateSpine` is the backstop.
 *
 * ## The page rates
 *
 * A chapter's page budget is estimated from the lines `markdown.pure.ts` counted
 * across the 174mm measure at `CHARS_PER_LINE`. `LINES_PER_PAGE` is the one
 * figure here that has to come from a render rather than from arithmetic, and it
 * is pinned by one — an estimate is what put the Client Details band four pages
 * out on its first attempt.
 */
import type { ChapterInput } from '../../reportDesign/structure.pure.ts';
import type { MarkdownHeading, MarkdownResult } from './markdown.pure.ts';
import { markdownToPlainText, pagesForLines } from '../markdown.pure.ts';
import type { ReportQaDocument } from './payload.pure.ts';
import { clipAtWord } from '../readableFileName.pure.ts';

/**
 * Body lines that fit one page.
 *
 * Moved to `../markdown.pure.ts` beside `CHARS_PER_LINE`, which is the other
 * half of the same measurement, when the Market Intelligence report became the
 * second format that needed it. Re-exported so this module's callers and
 * `render.spec.ts` are unchanged.
 */
export { LINES_PER_PAGE } from '../markdown.pure.ts';

/** A chapter always claims at least this, because a chapter header opens one. */
export const MIN_CHAPTER_PAGES = 1;

/**
 * Chapters a document may carry.
 *
 * Not a limit anyone reaches by writing a report — it is what stops a model that
 * emitted a heading per line producing a contents page longer than the document.
 * Headings beyond it stay in the body of the chapter they fall in; nothing is
 * lost from the page, only from the listing.
 */
export const MAX_CHAPTERS = 24;

/** Turns before the transcript stops opening a chapter for each one. */
export const MAX_TRANSCRIPT_CHAPTERS = 12;

const pagesFor = pagesForLines;

/**
 * The level whose headings become chapters.
 *
 * The shallowest level the answer used — **unless it used it exactly once and
 * wrote deeper headings under it**, in which case that single heading is a
 * title, not a section, and the level below it is where the document's
 * structure actually is.
 *
 * Found by rendering. A structured report opening `# Full analysis` and then
 * `## Section 1` … `## Section 6` produced a contents page with **one entry**
 * for an eleven-page document, because the `#` was the only heading at the
 * shallowest level and so the only chapter. Models write that shape constantly:
 * `summarize-conversation`'s own brief asks for exactly it (`report-qa/index.ts:3060`
 * — one `#` title over eight `##` sections).
 */
export function chapterLevelOf(headings: readonly MarkdownHeading[]): 2 | 3 | 4 {
  if (!headings.length) return 2;
  const shallowest = headings.reduce<2 | 3 | 4>((lowest, h) => (h.level < lowest ? h.level : lowest), 4);
  if (headings.filter((h) => h.level === shallowest).length > 1) return shallowest;
  const next = headings.filter((h) => h.level > shallowest);
  if (!next.length) return shallowest;
  return next.reduce<2 | 3 | 4>((lowest, h) => (h.level < lowest ? h.level : lowest), 4);
}

export interface SectionPlan {
  chapters: ChapterInput[];
  /**
   * Where each chapter starts in `MarkdownResult.blocks`, so the renderer opens
   * its sections at exactly the points the spine promised. Derived once, here,
   * rather than recomputed at render time — that is what makes a contents entry
   * for a section the document does not contain impossible.
   */
  starts: number[];
  /**
   * The block holding each chapter's own heading, which its chapter header
   * prints instead — `-1` for a chapter that opens on content. Read by index,
   * never by comparing text, because the printed title may have lost the
   * section number the heading carried.
   */
  headingBlocks?: number[];
}

/** `1. Executive summary` → 1. A lone integer, punctuated as a number. */
const SECTION_NUMBER = /^(\d{1,2})[.)]\s+(\S.*)$/;

const sectionNumber = (h: MarkdownHeading): number | null => {
  const m = SECTION_NUMBER.exec(h.text);
  return m ? Number(m[1]) : null;
};

const consecutive = (numbers: readonly (number | null)[]): boolean =>
  numbers.length > 0
  && numbers.every((n) => n !== null)
  && numbers.every((n, i) => i === 0 || n === (numbers[i - 1] as number) + 1);

/**
 * The chapters of an answer that numbered its sections and set one of them at
 * the wrong level.
 *
 * The owner's answer of 30 Sep 2026 numbered ten sections, wrote "1. Executive
 * Summary" at `##` and "2." through "10." at `#`. Read by level alone, section 1
 * was not a chapter: it fell into an opening chapter named after the document,
 * the contents page listed nine sections starting at "2.", and the first
 * section's subheads printed as sub-subheads. A numbered sequence is the
 * answer saying what its sections are, so a heading that continues it — the
 * missing "1." before "2.", or the next number after the last — joins it
 * wherever it was set. Only a heading one step DEEPER is taken, only when
 * every chapter-level heading is part of the same unbroken sequence, and only
 * the adjacent number: a sub-list numbered afresh under a section ("1. Option
 * A", "2. Option B") never continues the outer sequence and is never taken.
 */
function withNumberedStragglers(
  headings: readonly MarkdownHeading[],
  tops: MarkdownHeading[],
  level: number,
): MarkdownHeading[] {
  if (tops.length < 2 || !consecutive(tops.map(sectionNumber))) return tops;
  const out = [...tops];
  // Backwards: the numbers before the first chapter heading.
  for (;;) {
    const first = out[0];
    const want = (sectionNumber(first) as number) - 1;
    if (want < 1) break;
    const before = headings.slice(0, headings.indexOf(first)).reverse().find((h) => sectionNumber(h) !== null);
    if (!before || sectionNumber(before) !== want || before.level !== level + 1) break;
    out.unshift(before);
  }
  // Forwards: the number after the last one.
  for (;;) {
    const last = out[out.length - 1];
    const want = (sectionNumber(last) as number) + 1;
    const after = headings.slice(headings.indexOf(last) + 1).find((h) => sectionNumber(h) !== null);
    if (!after || sectionNumber(after) !== want || after.level !== level + 1) break;
    out.push(after);
  }
  return out;
}

/** Content before the first chapter that is a preface to it rather than a chapter of its own. */
export const PREFACE_MERGE_LINES = 12;

export interface PlanOptions {
  /**
   * Continuous documents (a finished answer, a write-up): a numbered heading
   * set at the wrong level still opens its chapter, a short preface opens the
   * first chapter rather than a chapter of its own, and the answer's own
   * section numbers leave the titles when they are the chapters' numbers —
   * the header already prints "Section 02", so "2. Client Investment Mandate"
   * under it said the number twice, and the contents page listed "02  2. …".
   */
  continuous?: boolean;
}

/**
 * Split a parsed answer into chapters at its own top-level headings.
 *
 * Content before the first heading — a model that opens with a paragraph, which
 * many do — becomes an opening chapter rather than being dropped or silently
 * attached to a section it does not belong to. In a continuous document a short
 * one is the first chapter's preface instead (`PlanOptions.continuous`).
 */
export function planFromMarkdown(
  parsed: MarkdownResult,
  fallbackTitle: string,
  idPrefix: string,
  options: PlanOptions = {},
): SectionPlan {
  const level = chapterLevelOf(parsed.headings);
  const atLevel = parsed.headings.filter((h) => h.level === level);
  const tops = (options.continuous ? withNumberedStragglers(parsed.headings, atLevel, level) : atLevel)
    .slice(0, MAX_CHAPTERS);

  if (!tops.length) {
    return {
      chapters: [{
        id: `${idPrefix}.body`,
        title: fallbackTitle,
        pageBudget: pagesFor(parsed.lines),
      }],
      starts: [0],
      headingBlocks: [-1],
    };
  }

  const starts = tops.map((h) => h.blockIndex);
  const chapters: ChapterInput[] = [];
  const allStarts: number[] = [];
  const headingBlocks: number[] = [];

  // A preface: the first chapter's opening, or a chapter of its own.
  const prefaceLines = starts[0] > 0 ? linesBetween(parsed, 0, starts[0]) : 0;
  const prefaceJoinsFirst = starts[0] > 0 && Boolean(options.continuous) && prefaceLines <= PREFACE_MERGE_LINES;
  if (starts[0] > 0 && !prefaceJoinsFirst) {
    chapters.push({
      id: `${idPrefix}.opening`,
      title: fallbackTitle,
      pageBudget: pagesFor(prefaceLines),
    });
    allStarts.push(0);
    headingBlocks.push(-1);
  }

  // The answer's own numbers leave the titles only when they ARE the
  // chapters' numbers — the first chapter is "1." and nothing precedes it.
  const numbers = tops.map(sectionNumber);
  const numbersAreOrdinals = Boolean(options.continuous)
    && consecutive(numbers)
    && numbers[0] === chapters.length + 1;

  tops.forEach((h, idx) => {
    const from = idx === 0 && prefaceJoinsFirst ? 0 : h.blockIndex;
    const to = idx + 1 < starts.length ? starts[idx + 1] : parsed.blocks.length;
    const lines = linesBetween(parsed, from, to);
    chapters.push({
      id: `${idPrefix}.${h.id}`,
      title: numbersAreOrdinals ? (SECTION_NUMBER.exec(h.text)?.[2] ?? h.text) : h.text,
      pageBudget: pagesFor(lines),
      // A chapter carrying a table wider than the portrait measure is already
      // on the landscape page — `markdown.pure.ts` wrapped it. Declaring the
      // chapter wide as well would open a second one.
      wide: false,
    });
    allStarts.push(from);
    headingBlocks.push(h.blockIndex);
  });

  return { chapters, starts: allStarts, headingBlocks };
}

function linesBetween(parsed: MarkdownResult, from: number, to: number): number {
  let n = 0;
  for (let i = from; i < to && i < parsed.blocks.length; i++) n += parsed.blocks[i].lines;
  return n;
}

/**
 * An exchange's title: its question, cut at a word to a heading's length.
 *
 * The question is the most navigable title an exchange has, and it can be a
 * paragraph: the third question of the owner's conversation of 30 Sep 2026 ran
 * to 221 characters, printed as a four-line section title, and was printed in
 * full again straight under it. Where it is cut the title says so, and the
 * whole question is printed under it (`render.pure.ts`); where it is not, the
 * title is the question and it is printed once.
 */
export const TURN_TITLE_CHARS = 90;

export function turnTitle(question: string, index: number): string {
  const q = question.trim();
  if (!q) return `Exchange ${index}`;
  const clipped = clipAtWord(q, TURN_TITLE_CHARS);
  return clipped === q ? q : `${clipped}…`;
}

/**
 * The transcript's chapters.
 *
 * One chapter per turn up to `MAX_TRANSCRIPT_CHAPTERS`, then the remainder in
 * one. A chapter header costs a page, so seventy of them is the page budget
 * spent entirely on furniture — and a contents page listing seventy questions is
 * not a contents page. Below the threshold, a chapter per exchange is genuinely
 * the most navigable thing: the reader is looking for a question.
 */
export function planFromTurns(
  document: ReportQaDocument,
  lineCounts: readonly number[],
  idPrefix: string,
  turnLimit = Number.POSITIVE_INFINITY,
): SectionPlan {
  const turns = document.turns.slice(0, Math.max(1, Math.min(document.turns.length, turnLimit)));
  if (!turns.length) {
    return { chapters: [{ id: `${idPrefix}.empty`, title: 'The conversation', pageBudget: 1 }], starts: [0] };
  }

  const titled = (t: ReportQaDocument['turns'][number], i: number) => ({
    id: `${idPrefix}.turn-${t.index}`,
    title: turnTitle(t.question, t.index),
    pageBudget: pagesFor(lineCounts[i] ?? 0),
  });

  if (turns.length <= MAX_TRANSCRIPT_CHAPTERS) {
    return { chapters: turns.map(titled), starts: turns.map((_, i) => i) };
  }

  const head = turns.slice(0, MAX_TRANSCRIPT_CHAPTERS - 1);
  const tailLines = lineCounts
    .slice(MAX_TRANSCRIPT_CHAPTERS - 1, turns.length)
    .reduce((n, l) => n + l, 0);
  return {
    chapters: [
      ...head.map(titled),
      {
        id: `${idPrefix}.turns-rest`,
        title: `Exchanges ${MAX_TRANSCRIPT_CHAPTERS} to ${turns[turns.length - 1].index}`,
        pageBudget: pagesFor(tailLines),
      },
    ],
    starts: [...head.map((_, i) => i), MAX_TRANSCRIPT_CHAPTERS - 1],
  };
}

/**
 * How many turns actually fit inside the archetype's page band.
 *
 * `normalise.pure.ts` already applied a budget, and it is a coarse one on
 * purpose: it works from character counts so it can refuse 350 KB before a
 * scanner ever sees it, and character counts do not know what Markdown costs. A
 * four-row table is seven printed lines for a hundred characters; a heading is
 * two lines for twenty. Against structured answers the cheap estimate runs about
 * forty per cent low, which is the difference between a document inside its band
 * and one nine pages outside it.
 *
 * So the decisive cut happens here, where `markdown.pure.ts` has counted the
 * lines for real, and it is made against the thing that actually matters:
 * `spinePageBudget` of the spine this plan would build. Dropping one turn at a
 * time and re-checking is exact — no estimate stands between the rule and what
 * it is a rule about — and it is a handful of iterations on the four
 * conversations in the record that reach it.
 *
 * One turn always survives. A cover page and a closing page with nothing between
 * them is not a better document than one long exchange.
 */
export function fitTranscript(
  document: ReportQaDocument,
  lineCounts: readonly number[],
  idPrefix: string,
  budgetOf: (plan: SectionPlan) => number,
  ceilingPages: number,
): { plan: SectionPlan; turnsKept: number } {
  let kept = document.turns.length;
  let plan = planFromTurns(document, lineCounts, idPrefix, kept);
  while (kept > 1 && budgetOf(plan) > ceilingPages) {
    kept -= 1;
    plan = planFromTurns(document, lineCounts, idPrefix, kept);
  }
  return { plan, turnsKept: kept };
}

/**
 * The sources chapter, when there is anything to attribute.
 *
 * Absent rather than empty when a conversation has no citations — which today
 * is every conversation in the record, so this is the ordinary case and an empty
 * "Sources" heading on every document would be the wrong default.
 */
export function sourcesChapter(
  document: ReportQaDocument,
  idPrefix: string,
): ChapterInput | null {
  if (!document.citations.length) return null;
  return {
    id: `${idPrefix}.sources`,
    title: 'Sources',
    pageBudget: pagesFor(document.citations.length * 3 + 4),
    note: `${document.citations.length} cited passage${document.citations.length === 1 ? '' : 's'}`,
  };
}

/** A heading's words, as a printed section title and its source line share them. */
function headingKey(text: string): string {
  return text
    .replace(/[*_`~]+/g, '')
    .replace(/^(?:section\s+\d+(?:\.\d+)*[.):]?|\d+(?:\.\d+)*[.):])\s+/i, '')
    .replace(/[…]+$|\.{3}$/u, '')
    .replace(/[\s:#]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Where a printed section's heading is in the Markdown it was drawn from, as
 * character offsets of the heading's line — so the export dialog can take the
 * person from a page of the preview to the words that made it.
 *
 * The printed title is the heading with its number taken off
 * (`planFromMarkdown`) and, for an exchange, clipped (`turnTitle`), so both
 * sides are compared without numbering, emphasis or a trailing ellipsis, and a
 * clipped title matches the heading it begins. The first match wins; null
 * where no heading says it.
 */
export function findSectionHeading(
  markdown: string,
  title: string,
): { start: number; end: number } | null {
  const wanted = headingKey(title);
  if (!wanted) return null;
  const clipped = /(?:…|\.\.\.)\s*$/u.test(title.trim());
  const lines = markdown.split('\n');
  let offset = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const text = headingTextOf(line, lines[i + 1]);
    if (text !== null) {
      // Read as the parser reads a heading for its title: links to their
      // words, emphasis and smart punctuation as printed.
      const key = headingKey(markdownToPlainText(text));
      if (key === wanted || (clipped && key.startsWith(wanted))) {
        return { start: offset, end: offset + line.length };
      }
    }
    offset += line.length + 1;
  }
  return null;
}

/**
 * The words of a heading line, by the parser's own two rules
 * (`markdown.pure.ts`): `## Title` with its closing hashes off — only where a
 * space precedes them, so `## C#` keeps its sign — or a line of text
 * underlined with `===` or `---`. Null for any other line.
 */
function headingTextOf(line: string, next: string | undefined): string | null {
  const trimmed = line.trim();
  const atx = /^(#{1,6})\s+(.*)$/.exec(trimmed);
  if (atx && !/^#{7,}/.test(trimmed)) {
    const raw = atx[2].replace(/\s+#+\s*$/, '').trim();
    return raw || null;
  }
  if (trimmed && !trimmed.startsWith('#') && next !== undefined && /^(=+|-+)\s*$/.test(next.trim())) {
    return trimmed;
  }
  return null;
}
