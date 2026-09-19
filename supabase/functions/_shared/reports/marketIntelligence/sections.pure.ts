/**
 * The spine: which sections a report has, and how many pages each claims.
 *
 * Declared rather than discovered, unlike the Report Q&A's. This format has a
 * fixed vocabulary of fifteen possible sections, and which appear is a question
 * about which parts of the payload have content — the same rule the Client
 * Details and Portfolio documents follow. What is *inside* a section is model
 * prose, but the section list is the format's.
 *
 * ## An empty layer is named, not listed
 *
 * Six of the record's 46 layer bodies are empty strings, because the edge
 * function runs layers 1/2/3/6/7 in parallel with a `.catch` that returns empty
 * (`generate-market-intelligence-report/index.ts:616-652`). The generator being
 * replaced still puts those layers in its table of contents — the TOC is built
 * from `includedLayers` alone (`MarketIntelligencePDFGenerator.ts:301-345`) —
 * and then prints no section for them, so the numbering silently drifts and a
 * reader counting sections finds one missing with no explanation.
 *
 * Here an empty layer gets **no chapter and no contents entry**, and the
 * document says which layers returned nothing in its opening lede. The contents
 * page cannot list something that was not printed, which is the one structural
 * assertion every format in this programme carries.
 */
import type { ChapterInput } from '../../reportDesign/structure.pure.ts';
import { pagesForLines, renderMarkdown } from '../markdown.pure.ts';
import { layerSummary } from './normalise.pure.ts';
import {
  audiencePanelCount,
  BRAND_CLOSE_CALLOUTS,
  MAX_DOCUMENT_LINES,
  MAX_SECTION_CHARS,
  MIN_SECTION_CHARS,
  type MarketIntelligenceReport,
} from './payload.pure.ts';

/** Every section this format can have, in printed order. */
export type SectionId =
  | 'summary'
  | 'briefing'
  | 'correlation'
  | 'layer'
  | 'strategy'
  | 'events'
  | 'next-steps'
  | 'sources';

export interface PlannedSection {
  id: string;
  kind: SectionId;
  title: string;
  /**
   * The contents-page note. A gloss for a reader deciding what to read.
   *
   * For a layer this is the opening sentence of the layer itself, which is the
   * only summary the payload contains.
   */
  note?: string;
  /**
   * The chapter standfirst, when the section has one worth setting.
   *
   * Deliberately **not** the same field as `note`, and a layer has none. A
   * layer's note is its own first sentence, and setting that as a standfirst
   * printed the sentence twice within three centimetres — once in italic under
   * the heading and again as the opening line of the prose. It reads as a
   * rendering fault. The authored labels — "Now, what to avoid, and when",
   * "12 dated events" — are furniture rather than a duplicate, so those stay.
   */
  dek?: string;
  /** Markdown for the prose sections; empty for the ones built from data. */
  markdown: string;
  /** Estimated printed lines, from the parse or from the row count. */
  lines: number;
  pages: number;
  /** Set for `kind: 'layer'` so the renderer can reach its citations. */
  layerIndex?: number;
  /**
   * Characters of this section's Markdown the section cap did not carry.
   *
   * Per section rather than only summed, so the callout on the page can name
   * which section was cut and by how much. A total alone tells a reader that
   * something was shortened and gives them no way to find out what.
   */
  clippedChars?: number;
}

/**
 * Lines a section costs before a word of it is set.
 *
 * Only the standfirst and the gap under the chapter rule. The Report Q&A
 * charges thirteen per exchange, and copying that here over-claimed every
 * document by four to seven pages: an exchange there carries a question
 * callout, a provenance line and its own gaps, while a section here carries a
 * chapter header — and `pagesForLines` already floors every section at one page
 * for exactly that header. Charging for it twice is what the first measurement
 * caught.
 *
 * Pinned by render: six fixtures through WeasyPrint, claimed against actual.
 */
export const SECTION_FURNITURE_LINES = 3;

/** Clip a section's Markdown at a line boundary, never mid-construct. */
function clipSection(markdown: string): { text: string; omitted: number } {
  if (markdown.length <= MAX_SECTION_CHARS) return { text: markdown, omitted: 0 };
  const cut = markdown.lastIndexOf('\n', MAX_SECTION_CHARS);
  const at = cut > MAX_SECTION_CHARS / 2 ? cut : MAX_SECTION_CHARS;
  return { text: markdown.slice(0, at), omitted: markdown.length - at };
}

/**
 * What the blocks that are not prose cost, in the same estimated lines.
 *
 * Every one of these was pinned by binary search through WeasyPrint rather than
 * chosen: a chapter carrying only N of the block was rendered at several N and
 * the page count read back, which brackets the constant from both sides. The
 * bracket is recorded beside each so the next person can re-run it.
 *
 * They exist because the first render under-claimed every document by one to
 * three pages, and the reason was structural rather than a constant being
 * slightly wrong: three blocks the document prints were not being counted at
 * all. `renderDataTable`'s rows, the sidenote under each market event, and the
 * callouts appended to two sections by the renderer. A per-line fudge factor
 * would have hidden that; costing the blocks names it.
 */

/** A callout: label, body and padding. 4/8/12 callouts render as 1/2/2 pages. */
export const LINES_PER_CALLOUT = 6;

/** A sidenote: its label plus a short paragraph. 4/8/12/16 → 1/2/2/3 pages. */
export const LINES_PER_SIDENOTE = 5;

/**
 * One body row of a `table.data`: a line of text plus the band padding.
 *
 * 10/20/30/40/50 rows render as 1/2/2/2/3 pages, which brackets this to
 * (1.55, 1.725]. It is deliberately not rounded to 2 — at 40 rows that would
 * over-claim by a whole page, and the events table in this format is the only
 * place a table gets long.
 */
export const LINES_PER_TABLE_ROW = 1.7;

/** A table's head row and its caption, once per table. */
export const TABLE_FURNITURE_LINES = 4;

/** A dated event: one table row, and one sidenote carrying its description. */
export const LINES_PER_EVENT = LINES_PER_TABLE_ROW + LINES_PER_SIDENOTE;

/** A citation is one row of a two-column table and nothing else. */
export const LINES_PER_CITATION = LINES_PER_TABLE_ROW;

/**
 * How much of the contents page one entry costs, and how much a page holds.
 *
 * The contents page is the one piece of furniture `buildSpine` fixes at a single
 * page, and this format is the first to outgrow it: a `full` report has fourteen
 * or fifteen sections, each with a note drawn from the opening sentence of its
 * layer, and that runs onto a second page. Nothing noticed, so every large
 * report under-claimed by exactly one page.
 *
 * `CONTENTS_LINES_PER_PAGE` is pinned on both sides: eleven entries with
 * three-line notes (44) set as one page and the fourteen-entry `full` fixture
 * (45) sets as two. The note column wraps near 33 characters, measured off the
 * same renders, and an entry never costs less than two lines even with no note.
 */
export const CONTENTS_LINES_PER_PAGE = 44;
export const CONTENTS_NOTE_CHARS = 33;

/** Pages the contents page will actually take for these sections. */
export function contentsPagesFor(sections: readonly PlannedSection[]): number {
  const lines = sections.reduce(
    (n, s) => n + 1 + Math.max(1, Math.ceil((s.note ?? '').length / CONTENTS_NOTE_CHARS)),
    0,
  );
  return Math.max(1, Math.ceil(lines / CONTENTS_LINES_PER_PAGE));
}

const proseLines = (markdown: string, idPrefix: string): number =>
  markdown ? renderMarkdown(markdown, { idPrefix }).lines + SECTION_FURNITURE_LINES : 0;

/**
 * Plan the document.
 *
 * Returns the sections in printed order, already priced, plus what the document
 * budget cut. The budget is applied here rather than in the normaliser because
 * this is where the real line counts exist — the lesson the Report Q&A
 * transcript taught twice over: a character estimate does not know what Markdown
 * costs, and a four-row table is seven printed lines for a hundred characters.
 */
export function planSections(report: MarketIntelligenceReport): {
  sections: PlannedSection[];
  dropped: PlannedSection[];
  charsOmitted: number;
} {
  const all: PlannedSection[] = [];
  let clipped = 0;
  const push = (
    kind: SectionId,
    id: string,
    title: string,
    markdown: string,
    lines: number,
    note?: string,
    layerIndex?: number,
  ) => {
    const cut = clipSection(markdown);
    clipped += cut.omitted;
    const cost = cut.omitted
      ? proseLines(cut.text, id.replace(/[^a-z0-9]/gi, '')) 
      : lines;
    all.push({
      id, kind, title, note,
      // A layer's note is its own opening sentence, so it is a contents-page
      // gloss and never a standfirst. Every other note is authored furniture.
      dek: kind === 'layer' ? undefined : note,
      markdown: cut.text,
      lines: cost,
      pages: pagesForLines(cost),
      layerIndex,
      clippedChars: cut.omitted || undefined,
    });
  };

  if (report.prose.executiveSummary.length >= MIN_SECTION_CHARS) {
    push('summary', 'mi.summary', 'Executive Summary', report.prose.executiveSummary,
      proseLines(report.prose.executiveSummary, 'mis'));
  }

  if (report.prose.keyInsightsSnapshot.length >= MIN_SECTION_CHARS) {
    push('briefing', 'mi.briefing', 'Your 60-Second Briefing', report.prose.keyInsightsSnapshot,
      proseLines(report.prose.keyInsightsSnapshot, 'mib'),
      'The five things that moved this period');
  }

  if (report.correlation) {
    const md = [report.correlation.aiAnalysis, report.correlation.perplexityResearch]
      .filter(Boolean).join('\n\n');
    if (md.length >= MIN_SECTION_CHARS) {
      push('correlation', 'mi.correlation', 'Correlation Highlights', md,
        proseLines(md, 'mic'), 'How the indicators moved together');
    }
  }

  report.layers.forEach((layer, index) => {
    // Empty layers are deliberately absent. See the module header.
    if (layer.empty) return;
    // The suburb layer is the one the renderer appends audience panels to, so it
    // is the one that has to pay for them. `audiencePanelCount` is the single
    // fact both sides read, which is what stops the two drifting apart.
    const panels = layer.key === 'layer7_micro'
      ? audiencePanelCount(report.meta.audienceSegment) * LINES_PER_CALLOUT
      : 0;
    push('layer', `mi.${layer.key}`, layer.title, layer.content,
      proseLines(layer.content, `mil${index}`) + panels, layerSummary(layer), index);
  });

  if (report.prose.actionableStrategy.length >= MIN_SECTION_CHARS) {
    push('strategy', 'mi.strategy', 'What To Do About It', report.prose.actionableStrategy,
      proseLines(report.prose.actionableStrategy, 'mia'),
      'Now, what to avoid, and when');
  }

  if (report.events.length) {
    // A table row each, plus a sidenote for each event that carries a
    // description — which is what the renderer prints, and what the first
    // estimate missed. Twelve events is three pages, not two.
    const described = report.events.filter((e) => e.description).length;
    push('events', 'mi.events', 'Market Events Timeline', '',
      TABLE_FURNITURE_LINES
      + report.events.length * LINES_PER_TABLE_ROW
      + described * LINES_PER_SIDENOTE
      + SECTION_FURNITURE_LINES,
      `${report.events.length} dated ${report.events.length === 1 ? 'event' : 'events'}`);
  }

  // The CTA section exists when the model wrote one *or* when the brand's own
  // close will be printed, which it always is. A "Next Steps" page carrying only
  // the brand block is still a next-steps page.
  push('next-steps', 'mi.next-steps', 'Your Next Steps', report.prose.ctaContent,
    proseLines(report.prose.ctaContent, 'min') + BRAND_CLOSE_CALLOUTS * LINES_PER_CALLOUT);

  if (report.citations.length) {
    push('sources', 'mi.sources', 'Sources', '',
      TABLE_FURNITURE_LINES
      + report.citations.length * LINES_PER_CITATION
      + SECTION_FURNITURE_LINES,
      `${report.citations.length} cited`);
  }

  // ── The document budget ──────────────────────────────────────────────────
  //
  // Applied from the end, and never to the sections a reader would notice
  // missing first: the summary, the briefing and the closing next-steps page
  // are what a client actually reads. A layer dropped off the end is named in
  // the callout the renderer prints; a missing executive summary would just look
  // like a broken document.
  const KEEP = new Set<SectionId>(['summary', 'briefing', 'next-steps', 'sources']);
  const sections: PlannedSection[] = [];
  const dropped: PlannedSection[] = [];
  let lines = 0;

  for (const section of all) {
    if (KEEP.has(section.kind)) {
      sections.push(section);
      lines += section.lines;
      continue;
    }
    if (lines + section.lines > MAX_DOCUMENT_LINES) {
      dropped.push(section);
      continue;
    }
    sections.push(section);
    lines += section.lines;
  }

  const charsOmitted = dropped.reduce((n, s) => n + s.markdown.length, 0) + clipped;
  return { sections, dropped, charsOmitted };
}

/** The chapters, for `buildSpine`. */
export function chaptersFor(sections: readonly PlannedSection[]): ChapterInput[] {
  return sections.map((s) => ({ id: s.id, title: s.title, pageBudget: s.pages, note: s.note }));
}
