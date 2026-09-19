/**
 * The spine: which chapters the document has, and how many pages each claims.
 *
 * Declared by the payload rather than by this module, which makes it the third
 * kind in the programme. The Client Details and Market Intelligence documents
 * declare their sections in code; the Report Q&A discovers them from model
 * headings; this one takes them from the prose's own numbered skeleton, which
 * is declared by the *generator* and stable across the corpus.
 *
 * Two chapters are synthesised rather than read: a property summary at the
 * front, which no prose section covers because the specs live in a column, and
 * a sources chapter at the back.
 */
import type { ChapterInput } from '../../reportDesign/structure.pure.ts';
import {
  markdownToPlainText,
  pagesForLines,
  renderMarkdown,
  THIN_CHAPTER_LINES,
} from '../markdown.pure.ts';
import { planningChartContext, vizDirectiveRenderer } from '../vizFigures.pure.ts';
import { chartHasData } from './charts.pure.ts';
import {
  type InvestmentReport,
  MAX_DOCUMENT_LINES,
  MAX_SECTION_CHARS,
  type SectionChart,
} from './payload.pure.ts';

export type ChapterKind = 'property' | 'prose' | 'sources';

/**
 * One of the generator's numbered sections, inside the chapter that carries it.
 *
 * Sections are not chapters here, and the first render of this format is why.
 * The corpus's prose runs to 37,270 characters across 36 sections — about a
 * thousand characters each, which is two paragraphs. Given a chapter apiece,
 * and `page-break-before: always` on `.chapter`, that produced forty-six sheets
 * at 4.1% ink: a display title low on the page, two paragraphs, and half a page
 * of nothing, thirty-six times. No format in the programme was further from the
 * 13.3–22.1% a natively designed page in this system measures.
 *
 * So the sections are grouped, and a section becomes a subhead inside its
 * group. Its charts stay with it — that is the whole reason a part exists
 * rather than a concatenated string. `SECTION_CHARTS` attaches an infographic
 * to a section *by its number*, and rendering a group's prose and then all of
 * its charts would put the sensitivity tornado four subheads below the
 * sensitivity analysis.
 */
export interface ChapterPart {
  /** The generator's own number, when the heading had one. */
  number: number | null;
  title: string;
  markdown: string;
  charts: readonly SectionChart[];
  lines: number;
  clippedChars?: number;
}

export interface PlannedChapter {
  id: string;
  kind: ChapterKind;
  title: string;
  /** The contents-page gloss. */
  note?: string;
  /** The chapter standfirst. Absent for prose chapters — see below. */
  dek?: string;
  markdown: string;
  charts: readonly SectionChart[];
  /** The numbered sections this chapter carries, in order. Prose chapters only. */
  parts: readonly ChapterPart[];
  lines: number;
  pages: number;
  clippedChars?: number;
}

/**
 * The four parts of an investment report, by the section numbers in each.
 *
 * Read off the skeleton the generator writes, which `payload.pure.ts` records:
 * sections 1-19 are locality and market, 20-28 are the financial model, 29-31
 * are the score, and 32-36 are risk, structuring and what to do next. The
 * boundaries are the generator's own, not an editorial invention — 19 is the
 * last locality section and 20 is `Base Assumptions`, 28 is the last financial
 * one and 29 is `Investment Score`.
 *
 * A report with no financial model still gets the group; it simply has no
 * sections in it, and an empty group is not printed.
 */
export const PROSE_GROUPS: ReadonlyArray<{
  id: string;
  title: string;
  note: string;
  /** The last section number in this group. */
  through: number;
}> = [
  { id: 'locality', title: 'Location & Market', note: 'Where it is and what is around it', through: 19 },
  { id: 'numbers', title: 'The Numbers', note: 'Yield, costs, loan and projections', through: 28 },
  { id: 'score', title: 'The Score', note: 'How it rates, and against what', through: 31 },
  { id: 'outlook', title: 'Risk, Tax & Next Steps', note: 'What to watch and what to do', through: 99 },
];

/**
 * Lines a chapter costs before a word of it is set.
 *
 * Three, the figure the Market Intelligence migration pinned by render:
 * `pagesForLines` already floors every chapter at one page for its header, so
 * charging more counts that header twice.
 */
export const CHAPTER_FURNITURE_LINES = 3;

/**
 * What each infographic costs in estimated lines.
 *
 * Charts are the reason this format needs its own costing at all — the other
 * seven either had none or had one per section. Here a single chapter can carry
 * a gauge, a peer strip and a caption, and a page estimate that ignores them
 * under-claims by a page per charted chapter. Fourteen charted chapters is
 * fourteen pages of drift, which is the difference between a 34-page document
 * and a 48-page one.
 *
 * Pinned by render against the archetype's own band.
 */
export const CHART_LINES: Readonly<Record<SectionChart, number>> = {
  'score-gauge': 22,
  'score-peers': 14,
  // The wheel plus the dimension table it now ships with — see `scoreWheel`.
  'score-wheel': 26 + 8,
  'swot-quadrant': 20,
  'locality-map': 30,
  'amenity-bullets': 20,
  'demographics-bars': 20,
  'economic-bullets': 16,
  'yield-bullets': 20,
  'cost-waterfall': 26,
  'sensitivity-tornado': 22,
  'projection-value': 28,
  'projection-rent': 28,
  'projection-cashflow': 28,
  'lvr-bullet': 10,
  'property-tiles': 14,
};

/** A citation row of a one-column table. */
export const LINES_PER_SOURCE = 2;

/** Clip a chapter's Markdown at a line boundary, never mid-construct. */
function clip(markdown: string): { text: string; omitted: number } {
  if (markdown.length <= MAX_SECTION_CHARS) return { text: markdown, omitted: 0 };
  const cut = markdown.lastIndexOf('\n', MAX_SECTION_CHARS);
  const at = cut > MAX_SECTION_CHARS / 2 ? cut : MAX_SECTION_CHARS;
  return { text: markdown.slice(0, at), omitted: markdown.length - at };
}

/**
 * A chapter's prose, in lines — **including the figures inside it**.
 *
 * `renderDirective` is passed here for one reason: without it the planner
 * charges nothing for the model's own charts, and the corpus carries around 124
 * of them a report. A plan that budgets zero for a hundred figures is not a
 * plan. The context is `planningChartContext` — grey, never printed — because
 * a chart's height comes from its data and its column width and not at all from
 * its colours, so this measures the figure the render will actually draw rather
 * than a per-kind constant that goes stale.
 */
const proseLines = (markdown: string, idPrefix: string): number =>
  markdown
    ? renderMarkdown(markdown, {
      idPrefix,
      renderDirective: vizDirectiveRenderer(planningChartContext()),
    }).lines
    : 0;

/**
 * Only the charts that will actually be drawn.
 *
 * `chartHasData` is the one fact the renderer reads too. Charging for a chart
 * the renderer then skips is what made a report with no financial model claim
 * four pages more than it printed.
 */
const chartLines = (charts: readonly SectionChart[], report: InvestmentReport): number =>
  charts.reduce((n, c) => n + (chartHasData(c, report) ? (CHART_LINES[c] ?? 0) : 0), 0);

/**
 * Plan the document.
 *
 * The budget is applied from the end and never to the property summary, the
 * score chapters or the sources: those are what a reader opens the document
 * for. A locality chapter dropped off the end is named in a callout; a missing
 * score chapter would just look broken.
 */
export function planChapters(report: InvestmentReport): {
  chapters: PlannedChapter[];
  dropped: ChapterPart[];
  charsOmitted: number;
} {
  let clipped = 0;

  // ── The prose, as parts, in the generator's own numbering ──
  const parts: ChapterPart[] = report.sections.map((section, index): ChapterPart => {
    const cut = clip(section.markdown);
    clipped += cut.omitted;
    return {
      number: section.number,
      title: section.title,
      markdown: cut.text,
      charts: section.charts,
      // A subhead rather than a chapter header, so no `CHAPTER_FURNITURE_LINES`.
      lines: proseLines(cut.text, `inv${index}`) + chartLines(section.charts, report) + 1,
      clippedChars: cut.omitted || undefined,
    };
  });

  // ── The document budget, applied to parts ──
  //
  // Before the grouping this ran over chapters, which is the same list under a
  // different name; running it over parts keeps a long report shedding its
  // least-load-bearing *sections* rather than a whole quarter of the document.
  /** Sections a reader opens the document for, by their stable number. */
  const KEEP_NUMBERS = new Set([29, 30, 31, 34]);
  const kept: ChapterPart[] = [];
  const dropped: ChapterPart[] = [];
  let lines = 0;

  for (const part of parts) {
    if (part.number !== null && KEEP_NUMBERS.has(part.number)) {
      kept.push(part);
      lines += part.lines;
      continue;
    }
    if (lines + part.lines > MAX_DOCUMENT_LINES) {
      dropped.push(part);
      continue;
    }
    kept.push(part);
    lines += part.lines;
  }

  // ── The chapters ──
  const chapters: PlannedChapter[] = [];

  const push = (c: Omit<PlannedChapter, 'pages'>) => {
    chapters.push({ ...c, pages: pagesForLines(c.lines) });
  };

  // The property, synthesised. Every row in the corpus has `property_specs` and
  // no prose section covers it, so without this the document opens on a
  // locality overview and never says what was actually assessed.
  push({
    id: 'inv.property',
    kind: 'property',
    title: 'The Property',
    note: report.meta.propertyAddress || 'What was assessed',
    dek: report.meta.propertyAddress,
    markdown: '',
    charts: ['property-tiles'],
    parts: [],
    lines: chartLines(['property-tiles'], report) + CHAPTER_FURNITURE_LINES,
  });

  // ── The prose chapters ────────────────────────────────────────────────
  //
  // Two shapes, because the generator has two.
  //
  // **Numbered** — sections 1-36 with `# 24. Sensitivity Analysis` headings.
  // 733 reports in the corpus. `PROSE_GROUPS` folds those 36 into four
  // chapters, which is the only sane contents page for a document of that
  // shape.
  //
  // **Unnumbered** — 17-odd named sections: `Executive Verdict`, `Transport &
  // Connectivity`, `Risk Dashboard`, `Final Recommendation`. **Every report the
  // product makes today**, and not one of them numbered. Folding those into
  // four groups needs a number they do not have, so the old loop left `group`
  // at 0 and put all seventeen into "Location & Market" — one chapter, three
  // empty ones, and a contents page that named none of the model's sections.
  //
  // The fix is not a cleverer fold. A report whose sections are already named
  // and already in a deliberate order **is** its own chapter list: the section
  // becomes the chapter. Order is preserved exactly, because nothing is being
  // sorted. A keyword classifier was tried first and is not in this file for a
  // reason — the financial variant opens with `Client Investment Decision
  // Summary` and closes with `Financial Recommendation & Portfolio Fit`, so any
  // monotonic keyword scan puts the whole document in the last chapter.
  if (!kept.some((p) => p.number !== null)) {
    // One chapter per section — except for a section too short to hold a page.
    //
    // A current section is substantial: measured over the 546 sections in the
    // 35 reports the generator has produced, the median is 7,938 characters,
    // about 122 lines of prose before its seven figures. So the chapter is
    // normally two to three full pages and giving it a page of its own is
    // right. **4.9% are not** — 27 of 546 come in under half a page, and one of
    // those opening a sheet on its own is the defect the converter recorded at
    // 2.3% ink.
    //
    // `THIN_CHAPTER_LINES` is the converter's own threshold, and its history is
    // worth keeping: the first value was twelve, a third of a page, reasoned
    // rather than measured, and a render showed a section that cleared it
    // printing almost blank. Half a page is the boundary a render supports.
    const packed: ChapterPart[][] = [];
    for (const part of kept) {
      const previous = packed[packed.length - 1];
      if (previous && part.lines < THIN_CHAPTER_LINES) previous.push(part);
      else packed.push([part]);
    }

    for (const group of packed) {
      const lead = group[0];
      push({
        id: `inv.s${chapters.length}`,
        kind: 'prose',
        // The chapter takes the first section's name. A packed run is named for
        // what it opens on, and every section in it keeps its own subhead —
        // `chapterBody` sets those as soon as a chapter carries more than one.
        title: lead.title,
        // The section's own opening words. There is no editorial gloss to use
        // and inventing one would be writing on a client's contents page.
        note: markdownToPlainText(lead.markdown, CONTENTS_NOTE_CHARS * 2),
        markdown: '',
        charts: [],
        parts: group,
        lines: group.reduce((n, p) => n + p.lines, 0) + CHAPTER_FURNITURE_LINES,
      });
    }
  } else {
  // An unnumbered section belongs with whatever was numbered before it — 256
  // reports carry `## Location Overview` and `## Current Market Performance`
  // between the numbered ones, and they are real content.
  let group = 0;
  const grouped: ChapterPart[][] = PROSE_GROUPS.map(() => []);
  for (const part of kept) {
    if (part.number !== null) {
      while (group < PROSE_GROUPS.length - 1 && part.number > PROSE_GROUPS[group].through) group += 1;
    }
    grouped[group].push(part);
  }

  PROSE_GROUPS.forEach((definition, i) => {
    const members = grouped[i];
    if (!members.length) return;
    const charted = members.reduce((n, p) => n + p.charts.length, 0);
    push({
      id: `inv.${definition.id}`,
      kind: 'prose',
      title: definition.title,
      // The gloss says what the chapter covers and how many charts are in it —
      // the two things a reader scanning the contents cannot see from a title.
      // No standfirst: the prose opens with its own topic sentence, and the
      // Market Intelligence render showed a gloss set above an identical first
      // line reads as a rendering fault.
      note: charted
        ? `${definition.note} · ${charted} ${charted === 1 ? 'chart' : 'charts'}`
        : definition.note,
      markdown: '',
      charts: [],
      parts: members,
      lines: members.reduce((n, p) => n + p.lines, 0) + CHAPTER_FURNITURE_LINES,
    });
  });
  }

  if (report.sources.length) {
    push({
      id: 'inv.sources',
      kind: 'sources',
      title: 'Sources',
      note: `${report.sources.length} cited`,
      dek: `${report.sources.length} cited`,
      markdown: '',
      charts: [],
      parts: [],
      lines: report.sources.length * LINES_PER_SOURCE + CHAPTER_FURNITURE_LINES,
    });
  }

  const charsOmitted = dropped.reduce((n, p) => n + p.markdown.length, 0) + clipped;
  return { chapters, dropped, charsOmitted };
}

/** The chapters, for `buildSpine`. */
export function chaptersFor(chapters: readonly PlannedChapter[]): ChapterInput[] {
  return chapters.map((c) => ({ id: c.id, title: c.title, pageBudget: c.pages, note: c.note }));
}

/**
 * How many pages the contents page will take.
 *
 * This document has up to 38 entries — by far the most in the programme, and
 * more than three times the Market Intelligence report that first outgrew the
 * single fixed page. The constants are that migration's, measured through
 * WeasyPrint.
 */
export const CONTENTS_LINES_PER_PAGE = 44;
export const CONTENTS_NOTE_CHARS = 33;

export function contentsPagesFor(chapters: readonly PlannedChapter[]): number {
  const lines = chapters.reduce(
    (n, c) => n + 1 + Math.max(1, Math.ceil((c.note ?? '').length / CONTENTS_NOTE_CHARS)),
    0,
  );
  return Math.max(1, Math.ceil(lines / CONTENTS_LINES_PER_PAGE));
}
