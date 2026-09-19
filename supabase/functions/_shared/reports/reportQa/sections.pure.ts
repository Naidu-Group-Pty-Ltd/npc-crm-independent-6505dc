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
import { pagesForLines } from '../markdown.pure.ts';
import type { ReportQaDocument } from './payload.pure.ts';

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
}

/**
 * Split a parsed answer into chapters at its own top-level headings.
 *
 * Content before the first heading — a model that opens with a paragraph, which
 * many do — becomes an opening chapter rather than being dropped or silently
 * attached to a section it does not belong to.
 */
export function planFromMarkdown(
  parsed: MarkdownResult,
  fallbackTitle: string,
  idPrefix: string,
): SectionPlan {
  const level = chapterLevelOf(parsed.headings);
  const tops = parsed.headings.filter((h) => h.level === level).slice(0, MAX_CHAPTERS);

  if (!tops.length) {
    return {
      chapters: [{
        id: `${idPrefix}.body`,
        title: fallbackTitle,
        pageBudget: pagesFor(parsed.lines),
      }],
      starts: [0],
    };
  }

  const starts = tops.map((h) => h.blockIndex);
  const chapters: ChapterInput[] = [];
  const allStarts: number[] = [];

  if (starts[0] > 0) {
    chapters.push({
      id: `${idPrefix}.opening`,
      title: fallbackTitle,
      pageBudget: pagesFor(linesBetween(parsed, 0, starts[0])),
    });
    allStarts.push(0);
  }

  tops.forEach((h, idx) => {
    const from = h.blockIndex;
    const to = idx + 1 < starts.length ? starts[idx + 1] : parsed.blocks.length;
    const lines = linesBetween(parsed, from, to);
    chapters.push({
      id: `${idPrefix}.${h.id}`,
      title: h.text,
      pageBudget: pagesFor(lines),
      // A chapter carrying a table wider than the portrait measure is already
      // on the landscape page — `markdown.pure.ts` wrapped it. Declaring the
      // chapter wide as well would open a second one.
      wide: false,
    });
    allStarts.push(from);
  });

  return { chapters, starts: allStarts };
}

function linesBetween(parsed: MarkdownResult, from: number, to: number): number {
  let n = 0;
  for (let i = from; i < to && i < parsed.blocks.length; i++) n += parsed.blocks[i].lines;
  return n;
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
    title: t.question || `Exchange ${t.index}`,
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
