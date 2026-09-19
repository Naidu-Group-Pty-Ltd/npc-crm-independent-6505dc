/**
 * The document spine — the shape every report shares, independent of what is
 * written in it.
 *
 * ## Why this is not another section registry
 *
 * `compassSectionRegistry.ts` already declares *what the sections are* for two
 * formats: their headings, word budgets, visual components, trim priorities.
 * That is content. This module declares *what a document is*: a cover, then a
 * contents, then chapters, then a closing page — and which physical page each
 * of those prints on.
 *
 * Keeping them apart is deliberate. The registry has already been mirrored by
 * hand into `src/lib/reports/` and drifted from 672 lines to 174; copying its
 * section lists into a third place would guarantee a third divergence. A caller
 * passes the registry's sections *into* `buildSpine()` — the two compose rather
 * than overlap.
 *
 * ## What this buys
 *
 * `validateSpine()` catches the structural defects that reach clients: a report
 * with two covers because a retry appended one, a disclaimer that is not last,
 * a contents page listing sections a trim pass removed, a 40-page document that
 * rendered as 12 because a data fetch failed silently. None of those are
 * detectable from the PDF bytes; all of them are detectable here, before the
 * render.
 */
import { type NamedPage } from './page.pure.ts';

/** A structural role in the document. */
export type ReportSlot =
  | 'cover'
  | 'contents'
  | 'chapter'
  | 'divider'
  | 'wide-table'
  | 'closing';

/**
 * Which physical page each slot prints on.
 *
 * The indirection matters: a chapter is a *role*, `chapter-opener` is a *page
 * geometry*, and the day a format wants its chapters to open on the body page
 * that is one entry here rather than a change at every call site.
 */
export const SLOT_PAGE: Record<ReportSlot, NamedPage> = {
  cover: 'cover',
  contents: 'contents',
  chapter: 'chapter-opener',
  divider: 'section-divider',
  'wide-table': 'landscape-table',
  closing: 'disclaimer',
};

export interface SpineEntry {
  slot: ReportSlot;
  /** Stable id. For chapters this is the registry's section id. */
  id: string;
  /** As printed in the contents and the running head. */
  title: string;
  /** Expected page count. Summed and checked against the archetype's band. */
  pageBudget: number;
  /** One line for the contents page. */
  note?: string;
  /**
   * What this chapter is numbered, when the caller numbers its own.
   *
   * Almost every format lets `contentsEntriesFor` count — `01`, `02`, `03` down
   * the spine — and should keep doing so. The converter cannot: its document is
   * the format's chapters *plus* an appendix of whatever the uploaded template
   * had no home for, and those two are separate series (`SECTION 05` /
   * `APPENDIX A`). Numbered here so the contents page and the chapter openers
   * read the same source; they used to count independently and agreed only by
   * coincidence.
   */
  number?: string;
}

export type ReportArchetypeId =
  | 'investment-compass'
  | 'financial-analysis'
  | 'cash-flow-projection'
  | 'cash-flow-comparison'
  | 'market-intelligence'
  | 'borrowing-capacity'
  | 'commercial-capacity'
  | 'client-details'
  | 'portfolio-performance'
  | 'property-comparison'
  | 'report-qa'
  | 'snapshot';

export interface ReportArchetype {
  id: ReportArchetypeId;
  /** Printed on the cover and in the running foot. */
  documentName: string;
  /** The word before a chapter number — "Chapter", "Part", "Section". */
  chapterLabel: string;
  /** Slots this format is allowed to use. */
  slots: readonly ReportSlot[];
  /** Inclusive page band. A render outside it is a defect, not a preference. */
  pageBudget: readonly [number, number];
  /** Whether a contents page is expected. Short formats do not carry one. */
  contents: boolean;
  /** Why this archetype differs from the others. */
  note: string;
}

const FULL_SLOTS: readonly ReportSlot[] = ['cover', 'contents', 'chapter', 'divider', 'wide-table', 'closing'];
const SHORT_SLOTS: readonly ReportSlot[] = ['cover', 'chapter', 'closing'];

export const REPORT_ARCHETYPES: Record<ReportArchetypeId, ReportArchetype> = {
  'investment-compass': {
    id: 'investment-compass',
    documentName: 'Investment Location & Property Fit Report',
    chapterLabel: 'Chapter',
    slots: FULL_SLOTS,
    // Re-pinned twice. The figures below are the second set, and the first set
    // is worth keeping in mind: they measured a document that was wrong.
    //
    // Until this format was rendered and looked at, each of the generator's 36
    // numbered prose sections was its own chapter. `.chapter` carries
    // `page-break-before: always`, and a corpus section averages about a
    // thousand characters — two paragraphs. So a full report was 46 sheets at
    // 4.1% ink: a display title low on the page, two paragraphs, and half a page
    // of nothing, thirty-six times over. The band said 43-53 and the document
    // sat inside it, which is what a band cannot tell you.
    //
    // The sections are now grouped into four chapters and set as subheads
    // inside them (`investment/sections.pure.ts`, `PROSE_GROUPS`). Six shapes
    // rendered through WeasyPrint, claimed against actual: a full report with
    // every column populated 32/29, one with no financial model 28, one with no
    // score 30, a location-only report 13, a minimal one whose prose is a single
    // section 5, and a payload carrying 40 further sections at the section cap
    // 58 — that last one shedding sections to the document budget and saying so.
    //
    // So a real report is 13 to 32 pages, against 43 to 53 before. The ceiling
    // stays where it is: it is set by what the caps permit rather than by what
    // the corpus contains, for the reason the Market Intelligence band records
    // — the render route treats a band violation as fatal, and a correctly
    // clipped document should not be thrown away for being long.
    pageBudget: [5, 92],
    contents: true,
    // The original note claimed this document "carries no financial modelling —
    // that lives in the Financial Analysis report by design". The corpus
    // disagrees: sections 20 through 28 of the prose are base assumptions, yield
    // calculations, both loan structures, sensitivity, three projection tables
    // and the final LVR, in 541 reports. The note was written from the
    // archetype's name rather than from the artefact, which is the same hazard
    // the market-intelligence archetype carried.
    note: 'The locality and property-fit document, and the largest in the '
      + 'programme: a 36-section prose skeleton, grouped into four chapters, '
      + 'with up to sixteen infographics attached to it by section number. '
      + 'Carries financial modelling when the row has any — only 15% do, and '
      + 'the document says so when it does not.',
  },
  'financial-analysis': {
    id: 'financial-analysis',
    documentName: 'Financial Analysis Report',
    chapterLabel: 'Section',
    slots: FULL_SLOTS,
    pageBudget: [16, 26],
    contents: true,
    note: 'Purchase costs through to the ten-year projection. The only archetype '
      + 'that regularly needs the landscape page.',
  },
  'cash-flow-projection': {
    id: 'cash-flow-projection',
    documentName: '10 Year Cash Flow Analysis',
    chapterLabel: 'Section',
    slots: FULL_SLOTS,
    pageBudget: [6, 14],
    contents: false,
    note: 'A matrix document. The projection table is the artefact; the narrative '
      + 'exists to frame it.',
  },
  'cash-flow-comparison': {
    id: 'cash-flow-comparison',
    documentName: 'Cash Flow Comparison Analysis',
    chapterLabel: 'Section',
    slots: FULL_SLOTS,
    // Bounded twice over, which is why the band is the tightest of the long
    // formats. `compare-cash-flow-reports/index.ts:47` accepts two to five
    // properties, so the subject cannot run away the way a portfolio's can; and
    // the prose half is eight blocks written under a 4,000-token ceiling, a
    // third of what the Property Comparison's producer is given.
    //
    // Length therefore varies with the property count and with how many of the
    // eight model blocks arrived, both of which are small ranges.
    //
    // Measured, not estimated. Four documents rendered through WeasyPrint from
    // real production figures: two properties without an analysis is 17 pages,
    // five without is 20, two with is 25, five with is 27. The first attempt at
    // this band was [10, 26] and every one of those four would have been outside
    // it or inside it by accident — the wide sections each cost a chapter-header
    // page plus two landscape matrices, which the estimate had at one page.
    //
    // The floor sits under the shortest real document rather than at it: it
    // exists to catch a spine that collapsed, not to predict a page count.
    pageBudget: [15, 34],
    // Ten sections. `cash-flow-projection` carries no contents page for four
    // and is right not to; this is not that document.
    contents: true,
    note: 'Two to five 10 Year Cash Flow Analyses read side by side. The first '
      + 'comparison format whose figures are arithmetic rather than model output, '
      + 'so the tables are the document and the analysis — which the adviser may '
      + 'never have asked for — is a suffix.',
  },
  'market-intelligence': {
    id: 'market-intelligence',
    documentName: 'Market Intelligence Report',
    chapterLabel: 'Section',
    slots: FULL_SLOTS,
    // Pinned by render when the format was implemented. The band had been
    // declared before anything rendered against it, and the ceiling was wrong.
    //
    // Six shapes drawn from the record, rendered through WeasyPrint, claimed
    // against actual pages: a `market_pulse` with four layers 14/14, a `full`
    // with three layers empty 18/18, a `full` 23/23, an investor edition 22/23,
    // one carrying a correlation block 24/24, and the record's 244,332-character
    // runaway layer clipped to the section cap 31/29. So a real report is
    // fourteen to twenty-four pages and the estimate is within a page of the
    // print on five of six.
    //
    // The ceiling is set by the caps, not by the observed reports, and that is a
    // deliberate departure from how the other seven bands were pinned. The
    // render route treats a band violation as fatal, so a band tighter than what
    // `MAX_SECTION_CHARS` and `MAX_DOCUMENT_LINES` actually permit would turn a
    // pathological-but-correctly-handled payload into a failed render — the
    // document would be right, clipped, and honest about it, and would be thrown
    // away for being long.
    //
    // Measured at the caps: one runaway layer clipped to the section cap claims
    // 33, two claim 39, and a payload where every prose block hits the cap
    // claims 44. (All eight layers runaway claims 36 rather than more, because
    // the document budget starts dropping sections and the page says so.) 46
    // leaves two pages of margin.
    //
    // What the ceiling still catches is a cap that regressed — a document that
    // escaped the clipping entirely — which is the only way past 46.
    //
    // The floor is the arithmetic minimum, and a render confirmed it exactly:
    // cover, contents, an executive summary, a next-steps page and the closing
    // page is five, and that is what a report whose layers all failed produces.
    pageBudget: [5, 46],
    contents: true,
    // The original note described a locality report — "comparables, trends and
    // commentary for a locality" — which is not this document and never was. It
    // reads as having been written from the archetype's name rather than from
    // the generator, which is the hazard of declaring an archetype before
    // anything implements it.
    note: 'The eight-layer macro brief: RBA and rates, housing, sentiment, '
      + 'regulation, the economy, suburb intelligence, competitive edge, and a '
      + 'ninety-day outlook that synthesises the rest. National in scope, with '
      + 'one suburb-level layer. The second format whose payload is '
      + 'model-authored Markdown rather than typed figures.',
  },
  'borrowing-capacity': {
    id: 'borrowing-capacity',
    documentName: 'Borrowing Capacity Assessment',
    chapterLabel: 'Section',
    slots: SHORT_SLOTS,
    pageBudget: [4, 12],
    contents: false,
    note: 'Serviceability and capacity. Implemented three times in the codebase '
      + 'today; one archetype so the three converge rather than diverge further.',
  },
  'commercial-capacity': {
    id: 'commercial-capacity',
    documentName: 'Commercial & Industrial Capacity Report',
    chapterLabel: 'Section',
    // A contents page, where `borrowing-capacity` has none. The two formats
    // differ in kind here rather than in degree: the residential Snapshot is
    // one argument told in order, and a reader goes through it. This one is a
    // credit pack — a transaction, its income, eight independent tests, a
    // portfolio position, a compliance classification — and a reader arrives at
    // it wanting the constraints table, or the tenancies. That is what a
    // contents page is for.
    slots: FULL_SLOTS,
    // Measured against real renders rather than summed from the section
    // budgets, for the reason `market-intelligence` records: a section that
    // claims two pages and fills one and a half is not an error, and a band
    // built by adding claims up is a band nothing can satisfy.
    //
    // The floor is a linked assessment with no portfolio, no tenancy schedule,
    // no business income and no analysis — cover, contents, capacity,
    // constraints, compliance, closing. The ceiling is the full document with
    // every conditional section on, a twelve-tenancy schedule and a method
    // trail of thirty steps.
    pageBudget: [6, 30],
    contents: true,
    note: 'The commercial and industrial counterpart to the Borrowing Capacity '
      + 'Snapshot. What separates them is the binding constraint: a household '
      + 'is bound by its surplus, a commercial facility by whichever of LVR, '
      + 'DSCR, ICR and debt yield bites first — so this format is built around '
      + 'saying which one, and by how much. It is also the first format whose '
      + 'analysis is model-authored under a fixed schema.',
  },
  'client-details': {
    id: 'client-details',
    documentName: 'Client Details',
    chapterLabel: 'Section',
    slots: FULL_SLOTS,
    // The widest band in the programme, because this format's subject varies
    // more than any other's. Measured: 771 clients, of whom **26 have any
    // property at all**. The ordinary document is a household, some financial
    // rows and a position; the largest is that plus a portfolio.
    //
    // So the floor is genuinely a client with a name and an address — cover,
    // contents, who this is about, where they stand, closing — and it has to be
    // low enough to let that render. Refusing to produce a document because a
    // client has recorded little is refusing 97% of the record.
    //
    // That is not hypothetical. The first estimate here was `[6, 30]` and the
    // very first render refused a name-only client at five pages, which is the
    // ordinary case for this format. Four leaves a page of slack under the
    // arithmetic minimum rather than sitting on it.
    pageBudget: [4, 34],
    contents: true,
    note: 'The client\'s own record: who they are, what they earn, own, owe and '
      + 'spend, and any property held. The only format whose subject is a person '
      + 'rather than a transaction, and the only one where the ordinary case is a '
      + 'record with most of its sections empty.',
  },
  'portfolio-performance': {
    id: 'portfolio-performance',
    documentName: 'Portfolio Performance Review',
    chapterLabel: 'Section',
    slots: FULL_SLOTS,
    // Measured: all 21 stored reports rendered through WeasyPrint land between
    // 18 and 26 pages.
    //
    // The band is far wider than that range, and deliberately so — it is the
    // one archetype whose length scales with its subject. A portfolio is
    // between one and sixty properties, and the sections that describe them
    // grow with the count, so a band tight enough to be a page prediction would
    // refuse to render a legitimate large portfolio. This ceiling is a runaway
    // guard: with `MAX_HOLDINGS` properties and the per-property commentary
    // capped at `DETAIL_CAP`, the spine tops out in the low forties.
    //
    // The floor is the arithmetic minimum, not a preference: cover, contents,
    // where-the-portfolio-stands, one page of holdings matrix and the closing
    // page is seven, and that is what a report whose `report_data.analysis` came
    // back empty produces. That is a real state — the analysis is stored model
    // output parsed out of a fenced code block — and such a document is still
    // worth sending, because the figures in it are the deterministic half.
    // Refusing to render a client's report because the model wrote fewer blocks
    // would turn a content problem into an outage. Found by rendering one.
    pageBudget: [7, 46],
    // The first migrated format long enough to need one. Borrowing Capacity
    // refuses a contents page for four pages and is right to; this document
    // runs to nine sections and the legacy generator built one by hand.
    contents: true,
    note: 'The whole-of-portfolio document: every holding in one landscape '
      + 'matrix, then what the portfolio is, how it performs, and what to do '
      + 'about it. The only format that reads a second, optional table — a '
      + 'portfolio review — to enrich a report it can already write without it.',
  },
  'property-comparison': {
    id: 'property-comparison',
    documentName: 'Property Comparison Analysis',
    chapterLabel: 'Section',
    slots: FULL_SLOTS,
    // Bounded, unlike the Portfolio's, and that is the whole difference:
    // `compare-investment-reports` accepts 2 to 5 properties, so this format's
    // subject cannot run away and its length varies with how much prose a model
    // wrote rather than with how many things it was given.
    //
    // Measured: all 50 stored comparisons rendered through WeasyPrint land
    // between 16 and 26 pages — the two-property ones at the bottom, the
    // five-property salvaged ones at the top.
    //
    // The floor is the arithmetic minimum rather than the observed one: cover,
    // contents, the verdict, the scorecard, the basis and the closing page is
    // eight, and that is what a record truncated before it wrote anything but
    // its ranking would produce. The ceiling carries headroom over the observed
    // maximum, because a five-property comparison with every section *and* a
    // placeholder for each one the record lost is longer than any row has been.
    pageBudget: [8, 32],
    contents: true,
    note: 'A ranked comparison of two to five properties. The only format whose '
      + 'source is stored model output with no deterministic figures at all, and '
      + 'the only one that reads part of its content back out of a response that '
      + 'was cut off while it was being written.',
  },
  'report-qa': {
    id: 'report-qa',
    documentName: 'Report Q&A',
    chapterLabel: 'Section',
    slots: FULL_SLOTS,
    // Three documents under one archetype, and the band has to hold all three.
    //
    // Measured against the record. A structured report averages 8,193
    // characters and tops out at 18,912, bounded by its producer's own
    // `max_completion_tokens: 8192`; the largest single answer is 33,377; and a
    // transcript is capped at `MAX_TRANSCRIPT_CHARS` (50,000), which keeps 234
    // of the 244 conversations whole. At the design system's 65-character
    // measure that ceiling is roughly twenty pages of body copy, and the
    // remaining headroom is the chapter furniture a transcript of many turns
    // carries.
    //
    // The floor is the arithmetic minimum for the shortest real document: a
    // one-answer export is a cover, a contents page, one section and the
    // closing page. It exists to catch a spine that collapsed, not to predict a
    // page count — the Client Details band was set by estimate and refused a
    // legitimate five-page document on its first render.
    pageBudget: [4, 30],
    // The only format whose contents page is discovered rather than declared:
    // the sections come from the headings the model wrote. A conversation of
    // twenty exchanges without one is unnavigable.
    contents: true,
    note: 'The Report Q&A export, in three subjects: the structured write-up, '
      + 'one answer, or the transcript. The only format whose payload is prose '
      + 'rather than figures, so its sections are read out of the content '
      + 'instead of being fixed by the format.',
  },
  snapshot: {
    id: 'snapshot',
    documentName: 'Property Snapshot',
    chapterLabel: 'Section',
    slots: SHORT_SLOTS,
    // Three is the floor for any document at all: cover, one chapter, closing.
    pageBudget: [3, 6],
    contents: false,
    note: 'The short overview. No contents page — a table of contents for three '
      + 'pages reads as padding.',
  },
};

/** A chapter as the caller supplies it — typically from the section registry. */
export interface ChapterInput {
  id: string;
  title: string;
  pageBudget: number;
  note?: string;
  /** Force this chapter onto the landscape page. */
  wide?: boolean;
  /** Override the counted number. See `SpineEntry.number`. */
  number?: string;
}

export interface BuildSpineInput {
  archetype: ReportArchetypeId;
  chapters: readonly ChapterInput[];
  /** Page budget for the cover. One, unless a format says otherwise. */
  coverPages?: number;
  /** Page budget for the closing page. */
  closingPages?: number;
  /** Override the archetype's contents default. */
  contents?: boolean;
  /**
   * Pages the contents page will take. One, unless a format outgrows it.
   *
   * Added when the Market Intelligence format became the first with enough
   * chapters — fourteen or fifteen, each with a note — to run the contents onto
   * a second page. Every format before it had few enough that the fixed single
   * page was right, and the assumption was invisible until a render disagreed
   * with the budget by exactly one page. Formats that do not pass it are
   * unchanged.
   */
  contentsPages?: number;
}

/**
 * Assemble the full spine: cover, optional contents, the chapters, closing.
 *
 * The cover and closing are added here rather than left to the caller because
 * every report has both, and "the disclaimer page was missing" is the one
 * structural defect with a legal consequence.
 */
export function buildSpine(input: BuildSpineInput): SpineEntry[] {
  const archetype = REPORT_ARCHETYPES[input.archetype];
  const wantContents = input.contents ?? archetype.contents;

  const spine: SpineEntry[] = [{
    slot: 'cover',
    id: `${archetype.id}.cover`,
    title: archetype.documentName,
    pageBudget: input.coverPages ?? 1,
  }];

  if (wantContents && archetype.slots.includes('contents')) {
    spine.push({
      slot: 'contents',
      id: `${archetype.id}.contents`,
      title: 'Contents',
      pageBudget: Math.max(1, Math.trunc(input.contentsPages ?? 1)),
    });
  }

  for (const c of input.chapters) {
    spine.push({
      slot: c.wide && archetype.slots.includes('wide-table') ? 'wide-table' : 'chapter',
      id: c.id,
      title: c.title,
      pageBudget: c.pageBudget,
      note: c.note,
      number: c.number,
    });
  }

  spine.push({
    slot: 'closing',
    id: `${archetype.id}.closing`,
    title: 'Contact & disclaimer',
    pageBudget: input.closingPages ?? 1,
  });

  return spine;
}

/** Total pages the spine claims it will occupy. */
export function spinePageBudget(spine: readonly SpineEntry[]): number {
  return spine.reduce((sum, e) => sum + (Number.isFinite(e.pageBudget) ? e.pageBudget : 0), 0);
}

/**
 * Contents entries for the chapter slots, numbered in printed order.
 *
 * Derived from the spine rather than passed in separately, which is what stops
 * a contents page listing a section a trim pass removed.
 *
 * An entry that carries its own `number` keeps it, and does not consume one from
 * the count — a document with two series (the converter's chapters and its
 * appendix) numbers both itself, and its own chapters must not be renumbered by
 * the appendix entries sitting between them.
 */
export function contentsEntriesFor(
  spine: readonly SpineEntry[],
): Array<{ number: string; title: string; note?: string }> {
  let n = 0;
  return spine
    .filter((e) => e.slot === 'chapter' || e.slot === 'wide-table')
    .map((e) => {
      if (e.number) return { number: e.number, title: e.title, note: e.note };
      n += 1;
      return { number: String(n).padStart(2, '0'), title: e.title, note: e.note };
    });
}

/**
 * Every way a spine violates its archetype.
 *
 * Returns an empty array for a valid spine. Messages are written to be read in
 * a CI failure, so each one names the entry it is about.
 */
export function validateSpine(
  archetypeId: ReportArchetypeId,
  spine: readonly SpineEntry[],
): string[] {
  const archetype = REPORT_ARCHETYPES[archetypeId];
  const problems: string[] = [];
  const allowed = new Set(archetype.slots);

  for (const entry of spine) {
    if (!allowed.has(entry.slot)) {
      problems.push(`${entry.id}: slot "${entry.slot}" is not permitted in ${archetype.id}`);
    }
    if (!entry.title.trim()) problems.push(`${entry.id}: has no title`);
    if (!(entry.pageBudget > 0)) {
      problems.push(`${entry.id}: page budget must be positive, got ${entry.pageBudget}`);
    }
  }

  const seen = new Set<string>();
  for (const entry of spine) {
    if (seen.has(entry.id)) problems.push(`${entry.id}: duplicate entry id`);
    seen.add(entry.id);
  }

  const covers = spine.filter((e) => e.slot === 'cover');
  if (covers.length !== 1) problems.push(`expected exactly one cover, found ${covers.length}`);
  else if (spine[0]?.slot !== 'cover') problems.push('the cover must be the first entry');

  const closings = spine.filter((e) => e.slot === 'closing');
  if (closings.length !== 1) {
    problems.push(`expected exactly one closing page, found ${closings.length}`);
  } else if (spine[spine.length - 1]?.slot !== 'closing') {
    problems.push('the closing page must be the last entry');
  }

  const contentsIdx = spine.findIndex((e) => e.slot === 'contents');
  if (contentsIdx > 0 && spine[contentsIdx - 1]?.slot !== 'cover') {
    problems.push('the contents page must follow the cover');
  }
  if (spine.filter((e) => e.slot === 'contents').length > 1) {
    problems.push('a document may carry only one contents page');
  }

  const chapters = spine.filter((e) => e.slot === 'chapter' || e.slot === 'wide-table');
  if (!chapters.length) problems.push(`${archetype.id}: a document must have at least one chapter`);

  const [min, max] = archetype.pageBudget;
  const total = spinePageBudget(spine);
  if (total < min || total > max) {
    problems.push(
      `page budget ${total} is outside ${archetype.id}'s band of ${min}–${max}`,
    );
  }

  return problems;
}
