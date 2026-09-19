/**
 * What a Report Q&A template may bind.
 *
 * ## This restates the document, it does not re-read the record
 *
 * `_shared/reports/reportQa/` already builds a `ReportQaDocument` for the
 * flowing `render-report-qa-pdf` route — turns in order, citations, the
 * transcript budget, what was cut and by how much. This projection restates
 * that, exactly as the Comparison, Client Details and Cash Flow Comparison
 * projections restate their normalisers. A second read of
 * `report_qa_messages` would be a second set of answers to "what was said",
 * which is the failure this programme removes rather than adds.
 *
 * ## The answer stays Markdown
 *
 * Every other projection publishes formatted scalars, because every other block
 * escapes its body. This one publishes the answer as **Markdown source**, and
 * `markdown-block` renders it. That is the whole reason the format can be on
 * the families at all: the safety is in the renderer, so the projection does not
 * have to sanitise, and must not try — a projection that pre-rendered HTML would
 * move the escaping decision to whoever calls it.
 *
 * ## Page counts are computed here and honoured by the block
 *
 * A master makes answer page N conditional on `qa.answerPages > N`. That number
 * comes from `packMarkdownPages` — the same function the block uses to decide
 * what page N contains. See `reports/markdownPaging.pure.ts` for why that is one
 * function rather than two.
 *
 * ## What it deliberately does not publish
 *
 * `structured_report` on the conversation. It is a second, separately-generated
 * document about the same conversation, and binding it beside the turns would
 * put two answers to the same question on one page with nothing to tell a reader
 * which is current.
 */
import { renderMarkdown } from './reports/markdown.pure.ts';
import { packMarkdownPages, DEFAULT_LINES_PER_PAGE } from './reports/markdownPaging.pure.ts';
import type { ReportQaDocument, QaTurn } from './reports/reportQa/payload.pure.ts';

/**
 * What a master may draw, and what the specs assert against.
 *
 * Turns are capped because a page model that cannot paginate cannot be handed an
 * unbounded collection. The largest real conversation is 70 turns; a document
 * that shows the first 12 and says so is a better artefact than one that runs
 * off the end of its own page sequence.
 */
export const CAPS = {
  turns: 12,
  /**
   * Answer pages a master declares — one opening page plus seven continuations,
   * the same `ANSWER_PAGES` the composer sets. This used to say 10 while the
   * masters declared 8, which meant the guard the composer's comment promised —
   * "beyond it the truncation note prints" — fired two pages after the tail had
   * already stopped being drawn. Nine of the 565 stored answers run past eight
   * pages, so the gap was real. `reportQaOnTheFamilies.spec.ts` now asserts the
   * two numbers agree.
   */
  answerPages: 8,
  citationsPerTurn: 6,
  /** Document-level citations drawn by the citations page. */
  citations: 6,
  /** Grounding reports listed on the sources page. */
  sources: 8,
} as const;

function put(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined && value !== null && value !== '') target[key] = value;
}

function str(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? undefined : s;
}

/** Which of the three documents, in the words a reader would use — restating
 * `render.pure.ts`'s private `SUBJECT_LABEL`. The cover used to bind the raw
 * enum and print "answer" as a document type. */
const SUBJECT_LABEL: Record<ReportQaDocument['meta']['subject'], string> = {
  structured: 'Structured report',
  answer: 'Single answer',
  transcript: 'Conversation transcript',
};

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * `2026-08-02T…` → `02 August 2026` — restating `render.pure.ts`'s exported
 * `formatReportDate` rather than importing it, because importing would pull the
 * whole renderer (primitives, css, structure) into every bundle that carries
 * this projection. `reportQaProjection.spec.ts` imports the renderer's own
 * function and asserts the two agree, so a drift fails CI rather than a page.
 */
function formatReportDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return '';
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${m[3]} ${month} ${m[1]}` : '';
}

/**
 * How an answer was produced, as one line — `render.pure.ts`'s `provenance`,
 * word for word: provider · version, whether a human edited it, how many
 * sources it cited, and when it was asked, joined with em-dash separators.
 * The line the legacy prints under every question and the exporters drop.
 */
function provenanceLine(turn: QaTurn): string | undefined {
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
  return parts.length ? parts.join(' — ') : undefined;
}

/** How many pages this Markdown needs at the master's line budget. */
export function answerPageCount(
  markdown: string,
  linesPerPage: number = DEFAULT_LINES_PER_PAGE,
): number {
  const source = str(markdown);
  if (!source) return 0;
  return packMarkdownPages(renderMarkdown(source).blocks, linesPerPage).length;
}

function projectTurn(turn: QaTurn, linesPerPage: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  put(out, 'index', turn.index);
  put(out, 'question', str(turn.question));
  put(out, 'askedAt', str(turn.askedAt));
  put(out, 'answer', str(turn.answer));
  put(out, 'answerPages', answerPageCount(turn.answer, linesPerPage) || undefined);

  // A human edited this before it was sent. Worth printing, and only when true —
  // "Edited: No" on every one of 565 answers tells a reader nothing.
  if (turn.answerWasEdited) put(out, 'editedNote', 'This answer was edited before export.');

  const model = [str(turn.modelProvider), str(turn.modelVersion)].filter(Boolean).join(' ');
  put(out, 'model', model || undefined);
  // Only under an answered turn — the legacy's `turnBody` returns its "No
  // answer" callout before provenance is ever composed, and a provenance line
  // holding nothing but a date under an unanswered question would read as
  // "how it was answered".
  if (str(turn.answer)) put(out, 'provenanceLine', provenanceLine(turn));

  const citations = turn.citations.slice(0, CAPS.citationsPerTurn).map((c) => {
    const cite: Record<string, unknown> = {};
    put(cite, 'documentName', str(c.documentName));
    // ` · ` between page and paragraph, as the legacy sources table sets it.
    const locus = [
      c.page != null ? `p.${c.page}` : null,
      c.paragraph != null ? `¶${c.paragraph}` : null,
    ].filter(Boolean).join(' · ');
    put(cite, 'locus', locus || undefined);
    put(cite, 'snippet', str(c.snippet));
    return cite;
  });
  if (citations.length) out.citations = citations;
  put(out, 'citationCount', turn.citations.length || undefined);
  if (turn.citations.length > CAPS.citationsPerTurn) {
    put(out, 'citationsOmitted', `${turn.citations.length - CAPS.citationsPerTurn} more sources`);
  }
  return out;
}

export interface ProjectedReportQa {
  qa: Record<string, unknown>;
}

export function projectReportQa(
  doc: ReportQaDocument,
  linesPerPage: number = DEFAULT_LINES_PER_PAGE,
): ProjectedReportQa {
  const qa: Record<string, unknown> = {};

  /*
   * Nothing to describe means nothing published — not even `subject`.
   *
   * `subject` is an enum and so is never empty, which would make `qa` truthy on
   * a document with no title, no turns and no answer. A template making a page
   * conditional on `qa` would then draw an empty page for it. Absent has to mean
   * absent all the way up, not just per-key.
   */
  const hasContent = Boolean(str(doc.meta.title))
    || doc.turns.some((t) => str(t.question) || str(t.answer));
  if (!hasContent) return { qa };

  put(qa, 'title', str(doc.meta.title));
  /*
   * The cover sets the title at display size in a fixed box, and a
   * conversation's title is whatever its first question was — the stored tail
   * reaches the normaliser's 160-character cap, and a 144-character title ran
   * 256pt past the footer on one family's cover when this was measured; 80
   * still ran 118pt over. The budget is 56 because ~55 is the longest string
   * any family's cover is *proven* against — the Property Comparison sets
   * street lines that long on all ten families — and 204 of the 252 stored
   * titles fit it whole. Bounded on a word, the cut said by an ellipsis; the
   * running foot and the record keep the full title.
   */
  const fullTitle = str(doc.meta.title);
  if (fullTitle) {
    put(qa, 'coverTitle', fullTitle.length <= 56
      ? fullTitle
      : `${fullTitle.slice(0, 56).replace(/\s+\S*$/, '')}…`);
  }
  put(qa, 'subject', doc.meta.subject);
  // The words a reader would use, not the enum — the legacy cover prints
  // "Single answer", never "answer".
  put(qa, 'subjectLabel', SUBJECT_LABEL[doc.meta.subject]);
  put(qa, 'preparedOn', str(doc.meta.preparedOn));
  put(qa, 'turnCount', doc.meta.turnCount || undefined);
  put(qa, 'turnsShown', doc.meta.turnsShown || undefined);
  // The legacy cover's Exchanges value: "13 of 20" when the transcript budget
  // cut the conversation, the plain count when it did not.
  if (doc.meta.turnCount > 0) {
    put(qa, 'exchangesLabel', doc.meta.turnsShown < doc.meta.turnCount
      ? `${doc.meta.turnsShown} of ${doc.meta.turnCount}`
      : String(doc.meta.turnCount));
  }

  // Two or three sentences framing the document, built by `narrativeFor` from
  // the record — the lede the legacy opens its first chapter with, and the one
  // piece of prose here no model wrote.
  put(qa, 'narrative', str(doc.narrative));

  const turns = doc.turns.slice(0, CAPS.turns);
  if (turns.length) qa.turns = turns.map((t) => projectTurn(t, linesPerPage));

  // The single-answer subject: one turn, and the pages it needs.
  const first = turns[0];
  if (first) {
    put(qa, 'question', str(first.question));
    put(qa, 'answer', str(first.answer));
    if (str(first.answer)) put(qa, 'provenanceLine', provenanceLine(first));
    const pages = answerPageCount(first.answer, linesPerPage);
    put(qa, 'answerPages', pages || undefined);
    if (pages) {
      // What the document actually sets, for the cover — the full count drives
      // the continuation conditionals, but a cover claiming fifteen pages over
      // a document that sets eight would be the document overstating itself.
      put(qa, 'answerPagesShown', Math.min(pages, CAPS.answerPages));
      if (pages > CAPS.answerPages) {
        put(
          qa,
          'answerCutNote',
          `The answer runs to ${pages} pages and this document sets the first `
          + `${CAPS.answerPages}. The complete text is in the Markdown export.`,
        );
      }
    }
    // A question that was asked and never answered. The legacy prints this as
    // a caution callout rather than an empty page, and so do the masters.
    if (str(first.question) && !str(first.answer)) {
      put(qa, 'answerMissingNote', 'This question has no answer recorded against it.');
    }
  }

  /*
   * A whole sentence, and absent when nothing was cut.
   *
   * The Cash Flow Comparison's `matched` taught this: `put` correctly drops an
   * empty string, but a template that concatenates a fragment into a sentence is
   * left with a dangling clause when the fragment is absent. So the omission is
   * either a complete sentence or it is not published at all.
   */
  const omittedTurns = Math.max(0, doc.meta.turnCount - doc.meta.turnsShown);
  const cappedHere = Math.max(0, doc.meta.turnsShown - turns.length);
  const notShown = omittedTurns + cappedHere;
  if (doc.meta.subject === 'transcript' && turns.length > 1) {
    /*
     * What the masters actually set: the first exchange in full (`qa.answer`,
     * bounded by `CAPS.answerPages`) and the further QUESTIONS in a table
     * without their answers. The sentence says exactly that. "Carries N of M
     * exchanges" read as though N answers were set; one was.
     */
    const further = turns.length - 1;
    const listed = `${further} further ${further === 1 ? 'question is' : 'questions are'} listed without `
      + `${further === 1 ? 'its answer' : 'their answers'}`;
    const beyond = notShown > 0 ? `, and ${notShown} more ${notShown === 1 ? 'is' : 'are'} not shown` : '';
    put(qa, 'omissionNote', `The first exchange is set in full; ${listed}${beyond}. The complete transcript is in the Markdown export.`);
  } else if (notShown > 0) {
    put(
      qa,
      'omissionNote',
      `This document carries ${turns.length} of ${doc.meta.turnCount} exchanges; `
      + `${notShown} ${notShown === 1 ? 'is' : 'are'} not shown.`,
    );
  }
  if (doc.meta.truncated && doc.meta.charsOmitted > 0) {
    put(
      qa,
      'truncationNote',
      `${doc.meta.charsOmitted.toLocaleString('en-AU')} characters of the conversation `
      + 'are not shown. The complete text is in the Markdown export.',
    );
  }

  // What the conversation was grounded in. Named, because an answer about a
  // report the reader cannot identify is not checkable.
  const names = (doc.grounding?.reportNames ?? []).map(str).filter(Boolean) as string[];
  if (names.length) {
    qa.sources = names.slice(0, CAPS.sources).map((name) => ({ name }));
    put(qa, 'sourceCount', names.length);
    put(qa, 'sourceSummary', names.length === 1
      ? `Grounded in ${names[0]}.`
      : `Grounded in ${names.length} reports.`);
    if (names.length > CAPS.sources) {
      // Three stored conversations name seventeen reports. A whole sentence,
      // or nothing — the rule every omission note here follows.
      put(
        qa,
        'sourcesOmittedNote',
        `The conversation names ${names.length} reports; the first ${CAPS.sources} are listed here.`,
      );
    }
  }

  /*
   * The passages the answers were drawn from — the document-level citations
   * list the legacy sources chapter tables, deduplicated across every turn by
   * the normaliser. Zero messages in the record carry one, which is exactly
   * when closing the gap is cheap: the page lights up as citations land, and
   * until then it costs nothing. `locus` and `match` carry the legacy table's
   * own em-dash for absent values, because a table cell resolves an absent
   * binding to the empty string and a blank cell reads as a missing figure.
   */
  const allCitations = (doc.citations ?? []).slice(0, CAPS.citations);
  if (allCitations.length) {
    qa.citations = allCitations.map((c, i) => {
      const cite: Record<string, unknown> = { n: i + 1 };
      put(cite, 'documentName', str(c.documentName));
      const locus = [
        c.page != null ? `p.${c.page}` : null,
        c.paragraph != null ? `¶${c.paragraph}` : null,
      ].filter(Boolean).join(' · ');
      cite.locus = locus || '—';
      cite.match = c.similarity !== null && c.similarity !== undefined
        ? `${Math.round(c.similarity * 100)}%`
        : '—';
      put(cite, 'snippet', str(c.snippet));
      return cite;
    });
    put(qa, 'citationCount', (doc.citations ?? []).length);
    if ((doc.citations ?? []).length > CAPS.citations) {
      put(
        qa,
        'citationsNote',
        `The answers cite ${(doc.citations ?? []).length} passages; `
        + `the first ${CAPS.citations} are shown here.`,
      );
    }
  }

  return { qa };
}

export function applyReportQaProjection(
  target: Record<string, unknown>,
  doc: ReportQaDocument,
  linesPerPage: number = DEFAULT_LINES_PER_PAGE,
): void {
  const { qa } = projectReportQa(doc, linesPerPage);
  if (Object.keys(qa).length) target.qa = qa;
}
