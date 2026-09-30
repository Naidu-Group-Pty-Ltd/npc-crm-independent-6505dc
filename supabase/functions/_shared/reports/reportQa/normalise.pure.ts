/**
 * Turning rows from two tables into a document — or refusing to.
 *
 * Everything this format prints is persisted. `report_qa_conversations` holds
 * the title, the grounding documents and the model's write-up;
 * `report_qa_messages` holds every turn with its citations and the model that
 * answered. So there is nothing for the browser to send and nothing for it to
 * get wrong, and the route reads the tables directly.
 *
 * What this module does is the reading: pair the flat message list into turns,
 * decide which of the three documents is being built, apply the transcript
 * budget, and say what it left out. It never asks a model and never writes back.
 */
import {
  MAX_CITATIONS,
  MAX_QUESTION_CHARS,
  MAX_TRANSCRIPT_CHARS,
  MAX_TRANSCRIPT_LINES,
  MAX_TURNS,
  TURN_FURNITURE_LINES,
  type QaCitation,
  type ReportQaDocument,
  type ReportQaSubject,
} from './payload.pure.ts';
import { CHARS_PER_LINE, markdownToPlainText, sanitiseGlyphs } from './markdown.pure.ts';
import { neutraliseUrls } from '../text.pure.ts';
import { HUB_DOCUMENT_NAME, hubDocumentTopic, readTitleBlock } from './documentIdentity.pure.ts';
import type { QaPresentation } from './payload.pure.ts';

/** A row from `report_qa_messages`, as the route reads it. */
export interface MessageRow {
  id?: unknown;
  role?: unknown;
  content?: unknown;
  edited_content?: unknown;
  created_at?: unknown;
  model_provider?: unknown;
  model_version?: unknown;
  citations?: unknown;
}

/** A row from `report_qa_conversations`. */
export interface ConversationRow {
  id?: unknown;
  title?: unknown;
  report_names?: unknown;
  structured_report?: unknown;
  created_at?: unknown;
}

export interface BuildInput {
  conversation: ConversationRow;
  messages: readonly MessageRow[];
  subject: ReportQaSubject;
  /** Required for `answer`; ignored otherwise. */
  messageId?: string | null;
  /** ISO instant. Passed in — this module has no clock. */
  preparedOn: string;
  /**
   * Keep every turn of a transcript rather than applying the line budget.
   *
   * The budget bounds the FLOWING route's document, which sets every answer
   * in full. The templated masters set the FIRST answer alone, bounded by
   * their own answer pages, and list the further questions in a table — so
   * the budget bought nothing there and cost the table its rows: a four-
   * exchange conversation whose first answer ran 28,690 characters was cut
   * to one turn, and the only place the other three questions appeared did
   * not draw at all (measured on the Chancery render, 14 Sep 2026). The
   * projection still caps the list (`CAPS.turns`) and every question is
   * already bounded (`MAX_QUESTION_CHARS`), so nothing here is unbounded.
   */
  keepAllTurns?: boolean;
  /**
   * The issuer's names — the brand snapshot's company and trading name. A
   * first heading that is one of them is the answer's letterhead, not its
   * title (`readTitleBlock`). Absent, nothing is read as a letterhead.
   */
  issuerNames?: readonly (string | null | undefined)[];
}

export type BuildResult =
  | { ok: true; document: ReportQaDocument }
  | { ok: false; error: string };

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const clean = (v: unknown, max: number): string =>
  neutraliseUrls(sanitiseGlyphs(str(v)).text).replace(/\s+/g, ' ').trim().slice(0, max).trim();

/**
 * Read the citation array off a message row.
 *
 * `report_qa_messages.citations` is `jsonb` and nullable, and every field inside
 * it is optional — `Citations.tsx:17` types four of the five that way. A missing
 * page number is printed as absent rather than as page zero, which is the same
 * rule the rest of this programme holds about a null that is not a value.
 */
export function toCitations(raw: unknown): QaCitation[] {
  if (!Array.isArray(raw)) return [];
  const out: QaCitation[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const c = entry as Record<string, unknown>;
    const documentName = clean(c.document_name ?? c.documentName, 120);
    if (!documentName) continue;
    out.push({
      documentName,
      page: finite(c.page_number ?? c.pageNumber),
      paragraph: finite(c.paragraph_index ?? c.paragraphIndex),
      snippet: clean(c.snippet, 280),
      similarity: finite(c.similarity),
    });
    if (out.length >= MAX_CITATIONS) break;
  }
  return out;
}

const finite = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Pair the flat message list into turns.
 *
 * The table stores one row per message with no link between a question and its
 * answer, so the pairing is a reading rather than a fact. The reading is: in
 * `created_at` order, an assistant message belongs to the most recent user
 * message before it.
 *
 * Two things fall out of that, and both happen in the record:
 *
 *  - **An assistant message with no question before it** — the `generate-qa-pdf`
 *    action inserts one (`report-qa/index.ts:4297`), and the four rows carrying
 *    attachments are exactly those. It still gets a turn, with the question left
 *    empty, because dropping a real answer to keep the shape tidy would be the
 *    document lying about what was said.
 *  - **A question with no answer** — a turn that was cut off. Kept for the same
 *    reason, with an empty answer, so the transcript shows the question was
 *    asked.
 */
export function toTurns(messages: readonly MessageRow[]): ReportQaDocument['turns'] {
  const ordered = [...messages]
    .filter((m) => str(m.role) === 'user' || str(m.role) === 'assistant')
    .sort((a, b) => str(a.created_at).localeCompare(str(b.created_at)));

  const turns: Array<{
    index: number; question: string; askedAt: string; answer: string;
    answerWasEdited: boolean; modelProvider: string; modelVersion: string;
    citations: readonly QaCitation[];
  }> = [];
  let pending: { question: string; askedAt: string } | null = null;

  for (const m of ordered) {
    if (turns.length >= MAX_TURNS) break;
    if (str(m.role) === 'user') {
      // Two questions in a row: the first went unanswered and is still a turn.
      if (pending) {
        turns.push({
          index: turns.length + 1,
          question: pending.question,
          askedAt: pending.askedAt,
          answer: '',
          answerWasEdited: false,
          modelProvider: '',
          modelVersion: '',
          citations: [],
        });
      }
      pending = {
        question: markdownToPlainText(str(m.content), MAX_QUESTION_CHARS) || 'Question',
        askedAt: str(m.created_at),
      };
      continue;
    }
    const edited = str(m.edited_content);
    turns.push({
      index: turns.length + 1,
      question: pending?.question ?? '',
      askedAt: pending?.askedAt ?? str(m.created_at),
      answer: edited || str(m.content),
      answerWasEdited: Boolean(edited),
      modelProvider: clean(m.model_provider, 40),
      modelVersion: clean(m.model_version, 60),
      citations: toCitations(m.citations),
    });
    pending = null;
  }
  if (pending && turns.length < MAX_TURNS) {
    turns.push({
      index: turns.length + 1,
      question: pending.question,
      askedAt: pending.askedAt,
      answer: '',
      answerWasEdited: false,
      modelProvider: '',
      modelVersion: '',
      citations: [],
    });
  }
  return turns;
}

/**
 * Apply the transcript budget.
 *
 * Whole turns, never part of one. A turn cut in half is a question with a
 * truncated answer under it, and a reader has no way to tell that from an answer
 * the model gave badly — the same reason `salvage.pure.ts` records only closed
 * pairs. `markdown.pure.ts` has its own per-answer cap and will say so on the
 * page if one exchange alone exceeds it; this cap is about the conversation.
 *
 * Both budgets are checked, and the line one is the one that usually bites. See
 * `MAX_TRANSCRIPT_LINES` for why a character cap on its own is not a budget for
 * this document.
 *
 * At least one turn always survives, however long it is. A document with a cover
 * and nothing in it is not a better answer than a document with one long answer
 * in it.
 */
export function estimateTurnLines(question: string, answer: string): number {
  return TURN_FURNITURE_LINES + Math.ceil((question.length + answer.length) / CHARS_PER_LINE);
}

function applyBudget(
  turns: ReportQaDocument['turns'],
): { kept: ReportQaDocument['turns']; charsOmitted: number } {
  let chars = 0;
  let lines = 0;
  const kept: typeof turns[number][] = [];
  for (const turn of turns) {
    const cost = turn.question.length + turn.answer.length;
    const costLines = estimateTurnLines(turn.question, turn.answer);
    if (kept.length && (chars + cost > MAX_TRANSCRIPT_CHARS || lines + costLines > MAX_TRANSCRIPT_LINES)) break;
    kept.push(turn);
    chars += cost;
    lines += costLines;
  }
  const omitted = turns
    .slice(kept.length)
    .reduce((n, t) => n + t.question.length + t.answer.length, 0);
  return { kept, charsOmitted: omitted };
}

/** Providers that answered, in first-seen order, deduplicated. */
function modelsOf(turns: ReportQaDocument['turns']): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of turns) {
    // `system` is the placeholder the edge function writes when no model
    // answered; naming it on the page would say a model did.
    if (!t.modelProvider || t.modelProvider === 'system') continue;
    if (seen.has(t.modelProvider)) continue;
    seen.add(t.modelProvider);
    out.push(t.modelProvider);
  }
  return out;
}

/** Citations across every turn shown, deduplicated on name, page and paragraph. */
function citationsOf(turns: ReportQaDocument['turns']): QaCitation[] {
  const seen = new Set<string>();
  const out: QaCitation[] = [];
  for (const t of turns) {
    for (const c of t.citations) {
      const key = `${c.documentName}|${c.page ?? ''}|${c.paragraph ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
      if (out.length >= MAX_CITATIONS) return out;
    }
  }
  return out;
}

/**
 * Two or three sentences framing the document, built from the record.
 *
 * Not written, and not asked of a model. Every other format in this programme
 * builds its lede this way, and here it matters more than usual: a document
 * whose body is model prose should not open with more model prose that nobody
 * can trace to a row.
 *
 * **Exported because the renderer has to rebuild it.** The transcript is cut
 * twice — once here on a character estimate, once in the renderer on the real
 * line counts — and a lede built from the first number sat three lines above a
 * callout built from the second, reading "19 of 20 exchanges" over "This
 * document carries 13 of 20 exchanges". Found by looking at the page, which is
 * the only way that class of defect is ever found.
 *
 * ## A finished answer has no framing sentence (30 Sep 2026)
 *
 * The single answer and the write-up used to open on "One answer from an
 * Intelligence Hub conversation grounded in no attached reports. Answers came
 * from report_qa." — the first words a client read, on the owner's export.
 * Every clause was true and none was about the property: `report_qa` is the
 * Hub's own agent key (`model_provider` records `modelAssignment.agent_key`),
 * "grounded in no attached reports" describes how the answer was made, and
 * "the model's" names the machine room (`ADVISER_VOICE.md` rule 1). A report
 * the adviser is handing over speaks for itself, so those two subjects carry
 * none. A transcript is a record of the exchange and keeps one sentence that
 * says so — with the reports it draws on where there are any, and nothing
 * about which system answered.
 */
export function narrativeFor(
  subject: ReportQaSubject,
  turnsShown: number,
  turnCount: number,
  reportNames: readonly string[],
  _models: readonly string[],
): string {
  if (subject === 'answer' || subject === 'structured') return '';
  const drawsOn = reportNames.length === 0
    ? ''
    : reportNames.length === 1
      ? ` It draws on one report, ${reportNames[0]}.`
      : ` It draws on ${reportNames.length} reports.`;
  // "all 1 exchange" is not a phrase anybody writes.
  const shown = turnsShown === turnCount
    ? (turnCount === 1 ? 'its one exchange' : `all ${turnCount} exchanges`)
    : `${turnsShown} of ${turnCount} exchanges`;
  return `The Intelligence Hub conversation as it happened — ${shown}.${drawsOn}`;
}

const uuidLike = (v: unknown): string => {
  const s = str(v).trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : '';
};

/**
 * Build the document.
 *
 * Refuses rather than renders when the subject has nothing to say: a
 * `structured` request with no write-up stored, an `answer` request naming a
 * message that is not in the conversation, a `transcript` with no turns. Each
 * refusal names what was missing, because the alternative — a cover page and a
 * closing page with nothing between them — is a file somebody sends before
 * noticing.
 */
export function buildReportQaDocument(input: BuildInput): BuildResult {
  const conversationId = uuidLike(input.conversation?.id);
  if (!conversationId) return { ok: false, error: 'conversation id missing' };

  // The cover's title is what the document is ABOUT (`documentIdentity.pure.ts`):
  // the answer's own heading where it wrote one, else a conversation title
  // somebody gave, else the question. The product's name is the eyebrow above
  // it, and stands in only where nothing says what the document covers.
  const conversationTitle = clean(input.conversation?.title, 160);
  const issuerNames = input.issuerNames ?? [];
  const titleFor = (body: string, question: string) =>
    clean(hubDocumentTopic({ body, conversationTitle, question, issuerNames }), 160) || HUB_DOCUMENT_NAME;
  // A finished answer's own title block, placed: its letterhead is the
  // issuer's, its title and subtitle go on the cover, its front matter becomes
  // the cover's facts and the document's brief (`readTitleBlock`).
  const presentationOf = (body: string): QaPresentation => {
    const block = readTitleBlock(body, { issuerNames });
    return {
      body: block.body,
      subtitle: clean(block.subtitle, 160),
      preparedFor: clean(block.preparedFor, 120),
      preparedBy: clean(block.preparedBy, 120),
      facts: block.facts
        .map((f) => ({ label: clean(f.label, 60), value: clean(f.value, 400) }))
        .filter((f) => f.label && f.value),
      omitted: block.omitted.map((label) => clean(label, 60)).filter(Boolean),
    };
  };
  const rawNames = Array.isArray(input.conversation?.report_names)
    ? input.conversation.report_names as unknown[]
    : [];
  const reportNames = rawNames
    .map((n) => clean(n, 120).replace(/\.pdf$/i, ''))
    .filter(Boolean)
    .slice(0, 24);

  const allTurns = toTurns(input.messages ?? []);

  if (input.subject === 'answer') {
    const wanted = uuidLike(input.messageId);
    if (!wanted) return { ok: false, error: 'messageId must be a uuid' };
    const row = (input.messages ?? []).find(
      (m) => uuidLike(m.id) === wanted && str(m.role) === 'assistant',
    );
    if (!row) return { ok: false, error: 'no assistant message with that id in this conversation' };
    const edited = str(row.edited_content);
    const body = edited || str(row.content);
    if (!body.trim()) return { ok: false, error: 'that answer is empty' };
    const turn = allTurns.find((t) => t.answer === body);
    const title = titleFor(body, turn?.question ?? '');
    const citations = toCitations(row.citations);
    const models = clean(row.model_provider, 40) && clean(row.model_provider, 40) !== 'system'
      ? [clean(row.model_provider, 40)]
      : [];
    return {
      ok: true,
      document: {
        meta: {
          conversationId,
          messageId: wanted,
          subject: 'answer',
          title,
          preparedOn: input.preparedOn,
          turnCount: allTurns.length,
          turnsShown: 1,
          truncated: false,
          charsOmitted: 0,
        },
        grounding: { reportNames, reportCount: rawNames.length },
        narrative: narrativeFor('answer', 1, allTurns.length, reportNames, models),
        body,
        // The question is kept as the answer's own turn — for the ledger and
        // the templated masters. The flowing document no longer prints it:
        // what was asked of the Hub is an instruction to it, not a line of
        // the report (`render.pure.ts`).
        turns: turn ? [turn] : [],
        citations,
        models,
        presentation: presentationOf(body),
      },
    };
  }

  if (input.subject === 'structured') {
    const body = str(input.conversation?.structured_report);
    if (!body.trim()) {
      return { ok: false, error: 'this conversation has no structured report stored' };
    }
    const models = modelsOf(allTurns);
    const title = titleFor(body, allTurns[0]?.question ?? '');
    return {
      ok: true,
      document: {
        meta: {
          conversationId,
          messageId: null,
          subject: 'structured',
          title,
          preparedOn: input.preparedOn,
          turnCount: allTurns.length,
          turnsShown: 0,
          truncated: false,
          charsOmitted: 0,
        },
        grounding: { reportNames, reportCount: rawNames.length },
        narrative: narrativeFor('structured', 0, allTurns.length, reportNames, models),
        body,
        turns: [],
        citations: citationsOf(allTurns),
        models,
        presentation: presentationOf(body),
      },
    };
  }

  if (!allTurns.length) return { ok: false, error: 'this conversation has no messages' };
  const { kept, charsOmitted } = input.keepAllTurns
    ? { kept: [...allTurns], charsOmitted: 0 }
    : applyBudget(allTurns);
  const models = modelsOf(kept);
  // A transcript has no one body to name it; the conversation's title or its
  // first question does.
  const title = titleFor('', allTurns[0]?.question ?? '');
  return {
    ok: true,
    document: {
      meta: {
        conversationId,
        messageId: null,
        subject: 'transcript',
        title,
        preparedOn: input.preparedOn,
        turnCount: allTurns.length,
        turnsShown: kept.length,
        truncated: kept.length < allTurns.length,
        charsOmitted,
      },
      grounding: { reportNames, reportCount: rawNames.length },
      narrative: narrativeFor('transcript', kept.length, allTurns.length, reportNames, models),
      body: '',
      turns: kept,
      citations: citationsOf(kept),
      models,
    },
  };
}
