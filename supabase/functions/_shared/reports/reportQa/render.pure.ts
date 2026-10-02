/**
 * A Report Q&A conversation as HTML, through the design system.
 *
 * ## What this replaces
 *
 * Four PDF implementations across three libraries, three filename conventions
 * and two unrelated hardcoded palettes:
 *
 *  - `QAPDFGenerator.tsx` (jsPDF, 467 lines) — the best-maintained copy, and
 *    **unreachable**. Nothing imported it; the only reference in the repo was
 *    a comment in `MessageReportEditor.tsx` saying another file mirrors it.
 *    Deleted in the legacy consolidation once that fact had stood recorded.
 *  - `ConversationReportEditor.tsx:135` (jsPDF) — the live structured-report
 *    export, and an older revision of the same code. Its `drawTable` uses a
 *    fixed `rowHeight = 8` where `QAPDFGenerator` uses `calcRowHeight`, so
 *    **multi-line table cells overlap**. 105 of 562 answers contain a table.
 *  - `MessageReportEditor.tsx:144` (jsPDF) — the live single-answer export, a
 *    third copy of the same template.
 *  - `report-qa/index.ts:3715` `generate-qa-pdf` (pdf-lib) — the transcript,
 *    server-side, with a cover copied from a `report_structure_templates` row.
 *
 * Between them they carry `15,18,25` and `191,155,80` — the `#BF9B50` gold this
 * design system retired — plus `59,130,246`, which is Tailwind blue-500 used as
 * a rule under an H1; and on the server `rgb(0.07,0.2,0.38)` and
 * `rgb(0.89,0.71,0.31)`, a fifth and sixth palette. All three client copies also
 * print the fixed subtitle **"Investment Property Analysis"** at the top of
 * every content page of a Q&A document.
 *
 * ## What is no longer thrown away
 *
 * `sanitizeForPDF` (`QAPDFGenerator.tsx:24`) drops every non-ASCII character
 * outside a Latin-1 whitelist. That is correct for jsPDF, whose built-in faces
 * are WinAnsi-encoded, and it costs — measured — smart punctuation in **389 of
 * 562 answers**, every `✓ ✗ ⚠ →` in 187, and every non-Latin name, which is
 * what `fonts-noto-cjk` is installed for. None of it needs to go here;
 * `markdown.pure.ts` keeps what the fonts can set and transliterates only what
 * they cannot.
 *
 * Citations are printed for the first time. `report_qa_messages.citations` has
 * been persisted since `buildStructuredCitations` was written and shown on
 * screen by `Citations.tsx`, but every exporter redeclares a thin `Message` of
 * `role | content | timestamp` (`ConversationExport.tsx:14`) and drops them. A
 * Q&A PDF today carries no source attribution at all.
 *
 * ## No charts, and that is a decision
 *
 * Every other migrated format has them. This document is prose, and the only
 * numbers available — message counts, answer lengths, model mix — are not what
 * the reader wants. Parsing figures out of the model's own sentences in order to
 * chart them would put a second answer beside the one the prose already gives,
 * which is the failure this programme removes: the Borrowing Capacity waterfall
 * was deleted for disagreeing with the figure printed beneath it.
 *
 * ## The legacy generators stay
 *
 * This is a second path. All four still draw their documents, all three buttons
 * still work, and the `.txt` / `.csv` / `.md` / `.json` exports are untouched —
 * the last of which is what the truncation notice points at.
 */

import type { BrandLockupProps } from '../../reportDesign/primitives.pure.ts';
import {
  BRIEF_CLASS,
  closeChapter,
  escapeHtml,
  FINE_PRINT_CLASS,
  KEEP_TOGETHER_CLASS,
  openChapter,
  renderCallout,
  renderChapterHeader,
  renderCompanyPage,
  renderContentsPage,
  renderCover,
  renderDataTable,
  renderDocument,
  renderLede,
  renderSidenote,
  SUBHEAD_CLASS,
} from '../../reportDesign/primitives.pure.ts';
import { buildReportCss } from '../../reportDesign/css.pure.ts';
import { keptTable } from '../../reportDesign/tableKeeping.pure.ts';
import type { ResolvedReportPalette } from '../../reportDesign/roles.pure.ts';
import type { ReportDesignOptions } from '../../reportDesign/options.pure.ts';
import type { CompanyBlock, CompanyDisclaimer } from '../../reportDesign/companyBlock.pure.ts';
import {
  buildSpine,
  contentsEntriesFor,
  REPORT_ARCHETYPES,
  spinePageBudget,
  validateSpine,
  type SpineEntry,
} from '../../reportDesign/structure.pure.ts';
import type { ReportBrandSnapshot } from '../../reportDesign/snapshot.pure.ts';
import { resolveSnapshotBrand } from '../../reportDesign/documentBrand.pure.ts';
import {
  withDesignOptions,
  type ReportTemplateDesign,
} from '../../reportDesign/templateDesign.pure.ts';

import type { QaCitation, ReportQaDocument } from './payload.pure.ts';
import { renderMarkdown, type MarkdownResult } from './markdown.pure.ts';
import { narrativeFor } from './normalise.pure.ts';
import { fitTranscript, planFromMarkdown, sourcesChapter, type SectionPlan } from './sections.pure.ts';
import { formatReportDate } from '../reportDate.pure.ts';
import { clipAtWord, firstHeadingOf } from './documentIdentity.pure.ts';

const ARCHETYPE = REPORT_ARCHETYPES['report-qa'];

/** What the product calls this format, on the cover and in the filename. */
export const DOCUMENT_NAME = ARCHETYPE.documentName;


/**
 * `2026-08-02T…` → `02 August 2026`.
 *
 * Parsed rather than handed to `Date`: this module is pure, and
 * `toLocaleDateString` depends on the runtime's ICU build, so the same
 * conversation would date itself differently in Deno and in Node.
 */
export { formatReportDate };

/** Which of the three documents, in the words a reader would use. */
const SUBJECT_LABEL: Record<ReportQaDocument['meta']['subject'], string> = {
  structured: 'Structured report',
  answer: 'Single answer',
  transcript: 'Conversation transcript',
};

// ── Sources ─────────────────────────────────────────────────────────────────

/**
 * The sources list.
 *
 * A table rather than prose because the four fields are a record: which
 * document, which page, which paragraph, and how close the retrieval was. The
 * snippet goes in a sidenote beside it rather than into a cell, because a
 * 280-character quotation in a table cell is a paragraph wearing a ledger's
 * clothes.
 *
 * The similarity is printed as a percentage and only when it was stored. A
 * missing score printed as 0% would say the retrieval was a bad match, which is
 * a different claim from not knowing.
 */
function sourcesSection(citations: readonly QaCitation[]): string {
  if (!citations.length) return '';
  const rows = citations.map((c, i) => ({
    n: String(i + 1),
    doc: c.documentName,
    where: [
      c.page !== null ? `p.${c.page}` : '',
      c.paragraph !== null ? `¶${c.paragraph}` : '',
    ].filter(Boolean).join(' · ') || '—',
    match: c.similarity !== null ? `${Math.round(c.similarity * 100)}%` : '—',
  }));

  const table = renderDataTable(
    [
      { key: 'n', label: '#', align: 'left' },
      { key: 'doc', label: 'Document', align: 'left' },
      { key: 'where', label: 'Located', align: 'left' },
      { key: 'match', label: 'Match', align: 'right' },
    ],
    rows,
    { caption: 'Passages the answers were drawn from' },
  );

  const quoted = citations
    .map((c, i) => (c.snippet
      ? renderSidenote(
        `Source ${i + 1}`,
        `<p>${escapeHtml(c.snippet)}</p>`,
      )
      : ''))
    .join('');

  return table + quoted;
}

// ── Turn rendering ──────────────────────────────────────────────────────────

/**
 * How an answer came to be on the page, as one line under the question in a
 * transcript: whether a person edited it before export, what it cites, and
 * when it was asked. An edited answer is not what the Hub first said, and a
 * reader three months later needs to know that.
 */
function provenance(turn: ReportQaDocument['turns'][number]): string {
  // Which system answered is not printed. `model_provider` holds the Hub's
  // own agent key (`report_qa`) and `model_version` a vendor's model id —
  // the machine room's vocabulary, not a fact a reader can use
  // (`ADVISER_VOICE.md` rule 1). The ledger keeps both.
  const parts: string[] = [];
  if (turn.answerWasEdited) parts.push('edited before export');
  if (turn.citations.length) {
    parts.push(`${turn.citations.length} source${turn.citations.length === 1 ? '' : 's'}`);
  }
  const when = formatReportDate(turn.askedAt);
  if (when) parts.push(when);
  return parts.length ? `<p class="lede">${escapeHtml(parts.join(' — '))}</p>` : '';
}

/**
 * One exchange: what was asked, how it was answered, and the answer itself.
 *
 * The question comes back apart from the rest, because an exchange whose
 * section is titled by the whole question does not print it again
 * (`turnTitle`). The answer is set by the same block rules as a finished
 * answer — tables kept whole or grouped, long labels as sentences, a label on
 * its own line — so the three documents read alike.
 */
function turnBody(turn: ReportQaDocument['turns'][number], idPrefix: string): {
  asked: string;
  rest: string;
  lines: number;
} {
  const asked = turn.question
    ? renderCallout('informative', 'Asked', `<p>${escapeHtml(turn.question)}</p>`)
    : '';
  if (!turn.answer.trim()) {
    // A question with no answer under it. Kept rather than dropped, because a
    // transcript that quietly omits an exchange is not a transcript.
    return {
      asked,
      rest: renderCallout('caution', 'No answer', '<p>This question has no answer recorded against it.</p>'),
      lines: 6,
    };
  }
  // `baseHeadingLevel: 2`, not 3.
  //
  // Three assumed the question above the answer was a heading. It is not — it
  // is a callout, `Asked`, and always has been. So an answer's shallowest
  // heading landed at `h3` directly under the chapter's `h1`, with nothing at
  // level 2 anywhere in the document, and PDF/UA 7.4.2 failed on five checks
  // for a skipped level. The visual difference is a subhead set at the size
  // the design system drew a subhead at.
  const parsed = renderMarkdown(turn.answer, {
    idPrefix: `${idPrefix}t${turn.index}`,
    baseHeadingLevel: 2,
    labelLineBreaks: true,
  });
  return {
    asked,
    rest: provenance(turn) + parsed.blocks.map((b) => presentedBlock(b)).join(''),
    lines: parsed.lines + 6,
  };
}

// ── The document ────────────────────────────────────────────────────────────

export interface RenderReportQaInput {
  document: ReportQaDocument;
  palette: ResolvedReportPalette;
  company: CompanyBlock;
  masthead: string;
  lockup?: BrandLockupProps | null;
  /** The **tenant's** cover art, inlined. Never the house art — see the header. */
  heroDataUri?: string | null;
  confidentiality?: string | null;
  options?: Partial<ReportDesignOptions> | null;
  edition?: string | null;
  reference?: string | null;
}

export interface ReportQaRenderPlan {
  spine: SpineEntry[];
  bodyHtml: string;
  /** Section titles in printed order. The ledger records these. */
  sections: string[];
  pageBudget: number;
  /**
   * Exchanges the document actually carries, after the exact fit.
   *
   * Not `document.meta.turnsShown`: the normaliser cut on a character estimate
   * and the fit cut again on the real line counts. This is the number printed on
   * the cover and the one the ledger records, because it is the one that is true
   * of the pages.
   */
  turnsShown: number;
  /** True when the document says on its own pages that it is not the whole thing. */
  truncated: boolean;
  /** Every departure from the source, summed across the whole document. */
  degraded: boolean;
  problems: string[];
}

/**
 * Build the spine and the chapter bodies together, in one pass.
 *
 * Together deliberately. A format whose sections are discovered from its content
 * has exactly one way to end up with a contents page that lists a section the
 * document does not contain, and that is planning the spine from one parse and
 * rendering from another. Here the parse happens once and both come out of it.
 */
export function planReportQa(document: ReportQaDocument): {
  plan: SectionPlan;
  chapters: Array<{ title: string; note?: string; html: string }>;
  degraded: boolean;
  /** Exchanges this document actually carries, after the exact fit. */
  turnsShown: number;
  /** Characters of conversation the fit dropped, on top of the normaliser's. */
  charsOmitted: number;
} {
  const idPrefix = 'q';

  if (document.meta.subject === 'transcript') {
    const bodies = document.turns.map((t) => turnBody(t, idPrefix));
    const lineCounts = bodies.map((b) => b.lines);
    const { plan, turnsKept } = fitTranscript(
      document,
      lineCounts,
      idPrefix,
      // The spine the plan would build, priced. The chrome — cover, contents,
      // closing, and a sources chapter when there is one — is part of the band,
      // so it is part of what is checked.
      (candidate) => spinePageBudget(buildSpine({
        archetype: 'report-qa',
        chapters: sourcesChapter(document, idPrefix)
          ? [...candidate.chapters, sourcesChapter(document, idPrefix)!]
          : candidate.chapters,
      })),
      ARCHETYPE.pageBudget[1],
    );
    // `planFromTurns` folds the tail into one chapter past its threshold, so a
    // chapter owns every body from its own start index up to the next one's.
    const chapters = plan.chapters.map((c, idx) => {
      const from = plan.starts[idx];
      const to = idx + 1 < plan.starts.length ? plan.starts[idx + 1] : turnsKept;
      const html = bodies.slice(from, to).map((b, k) => {
        // A section titled by the whole question has already printed it.
        const turn = document.turns[from + k];
        const titledByIt = k === 0 && Boolean(turn?.question) && c.title === turn.question.trim();
        return (titledByIt ? '' : b.asked) + b.rest;
      }).join('');
      return { title: c.title, note: c.note, html };
    });
    const charsOmitted = document.turns
      .slice(turnsKept)
      .reduce((n, t) => n + t.question.length + t.answer.length, 0);
    return { plan, chapters, degraded: false, turnsShown: turnsKept, charsOmitted };
  }

  // A finished answer is drawn from under its own title block — the letterhead,
  // title, subtitle and front matter are the cover's (`readTitleBlock`). A
  // document built before the block was read falls back to the one rule that
  // existed then.
  const presentation = document.presentation ?? null;
  const parsed: MarkdownResult = renderMarkdown(
    presentation ? presentation.body : withoutLeadingTitle(document.body, document.meta.title),
    { idPrefix, labelLineBreaks: true },
  );
  const plan = planFromMarkdown(parsed, document.meta.title || 'The report', idPrefix, { continuous: true });
  const blockHtml = parsed.blocks.map((b) => presentedBlock(b));
  const finePrintFrom = finePrintStart(parsed);
  const chapters = plan.chapters.map((c, idx) => {
    const from = plan.starts[idx];
    const to = idx + 1 < plan.starts.length ? plan.starts[idx + 1] : parsed.blocks.length;
    // The heading that opened this chapter is already printed by
    // `renderChapterHeader`, so the block carrying it is dropped rather than
    // set twice — found by its index, because the printed title may have lost
    // the section number the heading carried.
    const heading = plan.headingBlocks?.[idx] ?? -1;
    const indices: number[] = [];
    for (let i = from; i < to; i++) if (i !== heading) indices.push(i);
    // The document's own closing caveat, set as the fine print it is.
    const main = indices.filter((i) => finePrintFrom < 0 || i < finePrintFrom);
    const fine = indices.filter((i) => finePrintFrom >= 0 && i >= finePrintFrom);
    const blocks = main.map((i) => blockHtml[i]);
    const finePrint = fine.length
      ? `<div class="${FINE_PRINT_CLASS}${visibleLength(fine.map((i) => blockHtml[i]).join('')) <= FINE_PRINT_KEEP_CHARS ? ` ${KEEP_TOGETHER_CLASS}` : ''}">${fine.map((i) => blockHtml[i]).join('')}</div>`
      : '';
    // The document's last words never turn a page alone (`KEEP_TOGETHER_CLASS`): a
    // short closing block is bound to the block before it. Only when it IS
    // short: binding two long blocks would move a half-page table to leave a
    // hole instead. The fine print is its own unit and binds nothing.
    const last = blocks[blocks.length - 1] ?? '';
    const body = idx === plan.chapters.length - 1 && !finePrint && blocks.length >= 2 && visibleLength(last) <= SHORT_TAIL_CHARS
      ? blocks.slice(0, -2).join('') + `<div class="${KEEP_TOGETHER_CLASS}">${blocks.slice(-2).join('')}</div>`
      : blocks.join('');
    // The brief the answer set under its title — the front matter the cover
    // does not carry — opens the first section.
    const brief = idx === 0 ? briefTable(presentation) : '';
    return { title: c.title, note: c.note, html: brief + body + finePrint };
  });
  return {
    plan,
    chapters,
    degraded: parsed.degraded,
    turnsShown: document.meta.turnsShown,
    charsOmitted: 0,
  };
}

/** A label longer than this is a sentence, and is set as one (`SUBHEAD_CLASS`). */
export const LONG_LABEL_CHARS = 48;

/** A fine-print caveat this short is kept on one page. */
const FINE_PRINT_KEEP_CHARS = 1_400;

/**
 * A heading that introduces the document's own caveat, not its analysis.
 *
 * Read from the heading alone, as structure: the words under it are never
 * inspected, only set smaller. The last heading of the document, and only
 * when it says it is a disclaimer, a warning or important information.
 */
const CAVEAT_HEADING = /^(?:important\s+)?(?:disclaimer|disclaimers|general advice warning|important (?:information|notice|note)|limitations? of (?:this )?(?:report|advice))\.?:?$/i;

/** Where the closing caveat starts, as a block index, or -1. */
export function finePrintStart(parsed: MarkdownResult): number {
  const last = parsed.headings[parsed.headings.length - 1];
  if (!last || !CAVEAT_HEADING.test(last.text.trim())) return -1;
  // A caveat heading is the document's last heading, over prose alone.
  const after = parsed.blocks.slice(last.blockIndex + 1);
  if (!after.length || after.some((b) => b.kind !== 'paragraph' && b.kind !== 'list')) return -1;
  return last.blockIndex;
}

/**
 * A short table is one object on one page; a long one never leaves a single
 * row stranded. The rule and its measurements live in
 * `reportDesign/tableKeeping.pure.ts`, which the Portfolio Performance Review
 * shares; the names are re-exported here so this module's callers and its
 * spec are unchanged.
 */
export {
  estimatedTableLines,
  groupTableRows,
  KEEP_WHOLE_TABLE_LINES,
  TABLE_MEASURE_CHARS,
} from '../../reportDesign/tableKeeping.pure.ts';

/**
 * A block as the memo prints it: a long `h4` label becomes a sentence-case
 * subhead, and a table is kept whole or grouped (see above).
 */
function presentedBlock(block: MarkdownResult['blocks'][number]): string {
  if (block.kind === 'table' && block.table) return keptTable(block.html, block.table);
  if (block.kind !== 'heading' || !block.html.startsWith('<h4 ')) return block.html;
  return visibleLength(block.html) > LONG_LABEL_CHARS
    ? block.html.replace(/^<h4 /, `<h4 class="${SUBHEAD_CLASS}" `)
    : block.html;
}

/**
 * The answer's front matter the cover does not carry, as a two-column brief.
 *
 * "Investment Budget" and "Purpose" are what the document is FOR, and a label
 * over a sentence is a key and a value, so they are set as the rows of a
 * headless table at the head of the first section — the answer's own words,
 * placed where the answer put them.
 */
function briefTable(presentation: ReportQaDocument['presentation'] | null): string {
  const facts = presentation?.facts ?? [];
  if (!facts.length) return '';
  return renderDataTable(
    [
      { key: 'label', label: '', align: 'left' },
      { key: 'value', label: '', align: 'left' },
    ],
    facts.map((f) => ({ label: f.label, value: f.value })),
  ).replace(/^<div class="table-block">/, `<div class="table-block ${BRIEF_CLASS}">`);
}

/**
 * The answer's own title, once — on the cover.
 *
 * A model that writes a report titles it (`# Investment Property Suburb
 * Shortlist Report`), and that heading is now what the cover names the
 * document (`documentIdentity.pure.ts`). Left in the body it also became the
 * first SECTION: a chapter opener repeating the cover, holding nothing but the
 * "Asked" callout, on a page of its own. It is dropped only when it is the
 * first thing in the body and says exactly what the cover says, so a body that
 * opens on prose, or on a heading the cover does not carry, is untouched.
 */
export function withoutLeadingTitle(body: string, title: string): string {
  const match = /^\s*#{1,3}[ \t]+(.+?)[ \t]*#*[ \t]*(?:\r?\n|$)/.exec(body);
  if (!match || !title) return body;
  return firstHeadingOf(match[0]) === title ? body.slice(match[0].length) : body;
}

/**
 * Sections that run on rather than each opening a page (`RUN_ON_CHAPTER_CLASS`).
 *
 * A single answer or a write-up is a memo — the owner's shortlist is nine
 * sections of one to two thousand characters — and drawn a page a section it
 * was eleven sheets, three of them a heading and a callout, against the ten
 * continuous pages of the in-browser export it replaces. A transcript keeps a
 * page per exchange: there the break is where one question ends and the next
 * begins.
 */
const runsOn = (subject: ReportQaDocument['meta']['subject'], index: number): boolean =>
  index > 0 && subject !== 'transcript';

/** A closing block this short is a tail, not a section of its own. */
const SHORT_TAIL_CHARS = 600;

/**
 * The running head is one line.
 *
 * It carries the section's title, and a transcript's section is titled by a
 * question: at the owner's 221 characters it set in three lines at the head of
 * every page and pushed the document's name beside it onto two. The head is a
 * finding aid, so it is cut at a word with an ellipsis; the section's own title
 * and the contents keep what they had.
 */
export const RUNNING_HEAD_CHARS = 72;

export function runningHeadFor(title: string): string {
  const clipped = clipAtWord(title.replace(/…$/, '').trim(), RUNNING_HEAD_CHARS);
  return clipped === title ? title : `${clipped}…`;
}

const visibleLength = (html: string): number =>
  html.replace(/<[^>]*>/g, '').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim().length;

export function renderReportQaBody(input: RenderReportQaInput): ReportQaRenderPlan {
  const doc = input.document;
  const { plan, chapters, degraded, turnsShown, charsOmitted } = planReportQa(doc);
  // The normaliser cut on a character estimate; the fit above cut on the real
  // line counts. What the page says has to be the second of those.
  const truncated = doc.meta.truncated || turnsShown < doc.meta.turnsShown;
  const omitted = doc.meta.charsOmitted + charsOmitted;

  const sources = sourcesChapter(doc, 'q');
  const allChapters = sources ? [...plan.chapters, sources] : plan.chapters;
  const allBodies = sources
    ? [...chapters, { title: sources.title, note: sources.note, html: sourcesSection(doc.citations) }]
    : chapters;

  const spine = buildSpine({ archetype: 'report-qa', chapters: allChapters });
  const problems = validateSpine('report-qa', spine);

  // What the cover states. A transcript is a record of an exchange, so its
  // cover says which document it is and how many exchanges it carries. A
  // finished answer is the adviser's report: its cover carries the facts of
  // the report — when, and for and by whom where the answer said so — and
  // nothing about the Hub that produced it. "Document: Single answer" and
  // "Exchanges: 3" were the first facts a client read on the owner's export.
  const presentation = doc.meta.subject === 'transcript' ? null : doc.presentation ?? null;
  const reportsLine = doc.grounding.reportCount
    ? `${doc.grounding.reportCount} report${doc.grounding.reportCount === 1 ? '' : 's'}`
    : '';
  const coverMeta = doc.meta.subject === 'transcript'
    ? [
      { label: 'Prepared on', value: formatReportDate(doc.meta.preparedOn) },
      { label: 'Document', value: SUBJECT_LABEL[doc.meta.subject] },
      ...(doc.meta.turnCount
        ? [{ label: 'Exchanges', value: truncated
          ? `${turnsShown} of ${doc.meta.turnCount}`
          : String(doc.meta.turnCount) }]
        : []),
      ...(doc.grounding.reportCount
        ? [{ label: 'Reports', value: String(doc.grounding.reportCount) }]
        : []),
    ]
    : [
      { label: 'Prepared on', value: formatReportDate(doc.meta.preparedOn) },
      { label: 'Prepared for', value: presentation?.preparedFor ?? '' },
      { label: 'Prepared by', value: presentation?.preparedBy ?? '' },
      { label: 'Draws on', value: reportsLine },
    ];

  const cover = renderCover({
    eyebrow: DOCUMENT_NAME,
    // What the document is about, not the format's name — the answer's own
    // title where it wrote one (`readTitleBlock`), under the letterhead it set
    // above it. The legacy covers printed either nothing at all or the literal
    // string 'Q&A Conversation Export'.
    title: doc.meta.title,
    subtitle: presentation?.subtitle || undefined,
    masthead: input.masthead,
    edition: input.edition ?? null,
    meta: coverMeta.filter((m) => m.value),
    lockup: input.lockup ?? null,
    heroDataUri: input.heroDataUri ?? null,
    footerLeft: input.confidentiality ?? 'Private and confidential',
    footerRight: input.reference ?? '',
  });

  const contents = renderContentsPage(
    'Contents',
    contentsEntriesFor(spine).map((e) => ({ number: e.number, title: e.title, note: e.note })),
  );

  // The lede opens the first chapter rather than sitting loose before it: an
  // introduction between the contents page and the first chapter header prints
  // on a page of its own, which is a page of one sentence.
  const grounded = doc.grounding.reportNames.length
    ? renderSidenote('Draws on', `<p>${escapeHtml(doc.grounding.reportNames.join(' · '))}</p>`)
    : '';

  // Said on the page, not only in the ledger. A document that quietly stops
  // partway through a conversation is the failure this migration removes.
  const cut = truncated
    ? renderCallout(
      'caution',
      'Not the whole conversation',
      `<p>${escapeHtml(
        `This document carries ${turnsShown} of ${doc.meta.turnCount} exchanges. `
        + `A further ${omitted.toLocaleString('en-AU')} characters were not shown. `
        + 'The complete conversation is in the Markdown and plain-text exports.',
      )}</p>`,
    )
    : '';

  // Rebuilt for the transcript rather than taken from the payload: the
  // normaliser wrote it against its own estimate, and the exact fit above has
  // since cut further. A lede that says "19 of 20 exchanges" over a callout
  // saying "13 of 20" is a document disagreeing with itself on the same page.
  const narrative = doc.meta.subject === 'transcript'
    ? narrativeFor('transcript', turnsShown, doc.meta.turnCount, doc.grounding.reportNames, doc.models)
    : doc.narrative;

  const body = allBodies.map((chapter, index) => {
    const number = String(index + 1).padStart(2, '0');
    const opening = index === 0
      ? (narrative ? renderLede(narrative) : '') + grounded + cut
      : '';
    return openChapter(DOCUMENT_NAME, number, runningHeadFor(chapter.title), 'body', {
      runOn: runsOn(doc.meta.subject, index),
      memo: true,
    })
      + renderChapterHeader({
        number,
        title: chapter.title,
        dek: chapter.note,
        label: ARCHETYPE.chapterLabel,
      })
      + `<div class="chapter-body">${opening}${chapter.html}</div>`
      + closeChapter();
  }).join('');

  const closing = renderCompanyPage({ block: input.company, lockup: input.lockup ?? null });

  return {
    spine,
    bodyHtml: cover + contents + body + closing,
    sections: allChapters.map((c) => c.title),
    pageBudget: spinePageBudget(spine),
    turnsShown,
    truncated,
    degraded: degraded || truncated,
    problems,
  };
}

export function renderReportQaDocument(input: RenderReportQaInput): ReportQaRenderPlan & { html: string } {
  const plan = renderReportQaBody(input);
  return {
    ...plan,
    html: renderDocument({
      // The product's name, then what this one is about — once, where the
      // cover had nothing more specific to say than the name itself.
      title: input.document.meta.title && input.document.meta.title !== DOCUMENT_NAME
        ? `${DOCUMENT_NAME} — ${input.document.meta.title}`
        : DOCUMENT_NAME,
      author: input.masthead,
      subject: DOCUMENT_NAME,
      css: buildReportCss({
        palette: input.palette,
        options: input.options ?? null,
        masthead: input.masthead,
      }),
      bodyHtml: plan.bodyHtml,
    }),
  };
}

// ── Driven from a brand snapshot ────────────────────────────────────────────

export interface RenderReportQaFromBrandInput {
  document: ReportQaDocument;
  /** The brand as it was at generation time — see `documentBrand.pure.ts`. */
  snapshot: ReportBrandSnapshot;
  disclaimer?: CompanyDisclaimer | null;
  /**
   * The **tenant's** cover art, inlined. Never the house art.
   *
   * The parameter that closes the legacy's cover defect. Three of the four
   * generators hardcode `/templates/npc-qa-cover.jpg` — our own letterhead on
   * every white-label tenant's document — and the fourth copies page one of a
   * `report_structure_templates` row, which is a single global template rather
   * than the tenant's.
   */
  coverArtDataUri?: string | null;
  options?: Partial<ReportDesignOptions> | null;
  edition?: string | null;
  reference?: string | null;
  /**
   * A chosen template's design (`templateDesign.pure.ts`). Its palette, faces
   * and page treatment replace the brand's palette; every word on every page is
   * still this composer's. Absent, and the document is the standard one byte
   * for byte.
   */
  design?: ReportTemplateDesign | null;
}

export interface ReportQaRenderResult extends ReportQaRenderPlan {
  html: string;
  /** What the brand snapshot was missing. Advisory; rendering does not stop. */
  gaps: string[];
}

export function renderReportQaFromBrand(
  input: RenderReportQaFromBrandInput,
): ReportQaRenderResult {
  const brand = resolveSnapshotBrand({
    snapshot: input.snapshot,
    disclaimer: input.disclaimer ?? null,
    coverArtDataUri: input.coverArtDataUri ?? null,
  });

  const rendered = renderReportQaDocument({
    document: input.document,
    palette: input.design?.palette ?? brand.palette,
    company: brand.company,
    masthead: brand.masthead,
    lockup: brand.lockup,
    heroDataUri: brand.heroDataUri,
    confidentiality: brand.confidentiality,
    options: withDesignOptions(input.options, input.design),
    edition: input.edition ?? null,
    reference: input.reference ?? null,
  });

  return { ...rendered, gaps: brand.gaps };
}
