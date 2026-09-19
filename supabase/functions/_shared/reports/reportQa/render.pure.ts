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
  closeChapter,
  escapeHtml,
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
} from '../../reportDesign/primitives.pure.ts';
import { buildReportCss } from '../../reportDesign/css.pure.ts';
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

import type { QaCitation, ReportQaDocument } from './payload.pure.ts';
import { renderMarkdown, type MarkdownResult } from './markdown.pure.ts';
import { narrativeFor } from './normalise.pure.ts';
import { fitTranscript, planFromMarkdown, sourcesChapter, type SectionPlan } from './sections.pure.ts';
import { formatReportDate } from '../reportDate.pure.ts';

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
 * How an answer was produced, as one line under the question.
 *
 * Printed because it is the thing the exporters drop and the thing a reader
 * three months later actually needs: an answer from `perplexity` and an answer
 * from `openai` are not the same kind of claim, and an answer a human edited is
 * not the model's words any more.
 */
function provenance(turn: ReportQaDocument['turns'][number]): string {
  const parts: string[] = [];
  if (turn.modelProvider && turn.modelProvider !== 'system') {
    parts.push(turn.modelVersion ? `${turn.modelProvider} · ${turn.modelVersion}` : turn.modelProvider);
  }
  if (turn.answerWasEdited) parts.push('edited before export');
  if (turn.citations.length) {
    parts.push(`${turn.citations.length} source${turn.citations.length === 1 ? '' : 's'}`);
  }
  const when = formatReportDate(turn.askedAt);
  if (when) parts.push(when);
  return parts.length ? `<p class="lede">${escapeHtml(parts.join(' — '))}</p>` : '';
}

/** One exchange: what was asked, how it was answered, and the answer itself. */
function turnBody(turn: ReportQaDocument['turns'][number], idPrefix: string): {
  html: string;
  lines: number;
} {
  const asked = turn.question
    ? renderCallout('informative', 'Asked', `<p>${escapeHtml(turn.question)}</p>`)
    : '';
  if (!turn.answer.trim()) {
    // A question with no answer under it. Kept rather than dropped, because a
    // transcript that quietly omits an exchange is not a transcript.
    return {
      html: asked + renderCallout('caution', 'No answer', '<p>This question has no answer recorded against it.</p>'),
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
  const parsed = renderMarkdown(turn.answer, { idPrefix: `${idPrefix}t${turn.index}`, baseHeadingLevel: 2 });
  return { html: asked + provenance(turn) + parsed.html, lines: parsed.lines + 6 };
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
  options?: ReportDesignOptions | null;
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
      return { title: c.title, note: c.note, html: bodies.slice(from, to).map((b) => b.html).join('') };
    });
    const charsOmitted = document.turns
      .slice(turnsKept)
      .reduce((n, t) => n + t.question.length + t.answer.length, 0);
    return { plan, chapters, degraded: false, turnsShown: turnsKept, charsOmitted };
  }

  const parsed: MarkdownResult = renderMarkdown(document.body, { idPrefix });
  const plan = planFromMarkdown(parsed, document.meta.title || 'The report', idPrefix);
  const chapters = plan.chapters.map((c, idx) => {
    const from = plan.starts[idx];
    const to = idx + 1 < plan.starts.length ? plan.starts[idx + 1] : parsed.blocks.length;
    // The heading that opened this chapter is already printed by
    // `renderChapterHeader`, so the block carrying it is dropped rather than set
    // twice. Matched on the heading that gave the chapter its title, not on
    // "the first block is a heading" — a chapter of content written before the
    // first top-level heading legitimately opens on a *deeper* heading, and
    // dropping that one would delete a section title from the page.
    const opener = parsed.headings.find((h) => h.blockIndex === from);
    const start = opener && opener.text === c.title ? from + 1 : from;
    const body = parsed.blocks.slice(start, to).map((b) => b.html).join('');
    // The single-answer document prints the question that produced it. The
    // legacy exports it with a title hardcoded at the call site —
    // 'Property Comparison Summary' / 'Investment Report Summary' by report
    // count (`ReportQA.tsx:3868`) — so what was actually asked appears nowhere.
    const asked = idx === 0 && document.meta.subject === 'answer' && document.turns[0]?.question
      ? renderCallout('informative', 'Asked', `<p>${escapeHtml(document.turns[0].question)}</p>`)
      : '';
    return { title: c.title, note: c.note, html: asked + body };
  });
  return {
    plan,
    chapters,
    degraded: parsed.degraded,
    turnsShown: document.meta.turnsShown,
    charsOmitted: 0,
  };
}

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

  const cover = renderCover({
    eyebrow: DOCUMENT_NAME,
    // The conversation's own title, not the format's. The legacy covers print
    // either nothing at all (`QAPDFGenerator` draws the template image and no
    // overlay text) or the literal string 'Q&A Conversation Export'.
    title: doc.meta.title,
    masthead: input.masthead,
    edition: input.edition ?? null,
    meta: [
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
    ].filter((m) => m.value),
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
    ? renderSidenote('Grounded in', `<p>${escapeHtml(doc.grounding.reportNames.join(' · '))}</p>`)
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
      ? renderLede(narrative) + grounded + cut
      : '';
    return openChapter(DOCUMENT_NAME, number, chapter.title)
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
      title: `${DOCUMENT_NAME} — ${input.document.meta.title}`,
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
  options?: ReportDesignOptions | null;
  edition?: string | null;
  reference?: string | null;
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
    palette: brand.palette,
    company: brand.company,
    masthead: brand.masthead,
    lockup: brand.lockup,
    heroDataUri: brand.heroDataUri,
    confidentiality: brand.confidentiality,
    options: input.options ?? null,
    edition: input.edition ?? null,
    reference: input.reference ?? null,
  });

  return { ...rendered, gaps: brand.gaps };
}
