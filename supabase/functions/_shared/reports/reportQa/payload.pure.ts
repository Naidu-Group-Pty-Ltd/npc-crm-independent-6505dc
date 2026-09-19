/**
 * What a Report Q&A document says, as a shape.
 *
 * ## Three subjects, one format
 *
 * The Q&A feature has four PDF implementations across three libraries and they
 * do not produce the same document. Two of them are jsPDF and are reachable;
 * one is jsPDF and is dead code; one is pdf-lib and lives in the edge function.
 * Between them they answer three genuinely different questions:
 *
 *  - **`structured`** — the model's own write-up of the whole conversation,
 *    persisted at `report_qa_conversations.structured_report`. What a client is
 *    meant to receive. Avg 8,193 characters, max 18,912, bounded by the
 *    producer's `max_completion_tokens: 8192`.
 *  - **`answer`** — one assistant message, edited or not. What a broker asks for
 *    when a single reply is the useful thing. Max 33,377 characters.
 *  - **`transcript`** — what was actually asked and actually said. No model
 *    involved, always available, and the only one that is unbounded: the largest
 *    conversation in the record is 354,406 characters across 70 messages.
 *
 * They are one format because they are one document with three spines, not
 * three documents. Collapsing them is the point — four implementations is how
 * the same table-rendering defect got fixed in one copy and not the other two.
 *
 * ## The payload is prose, and that is the whole difficulty
 *
 * Every format migrated before this one had a typed payload: `Measure` fields,
 * arithmetic, columns somebody declared. This one has a `text` column holding
 * Markdown a model wrote. So the payload here is *structure around prose* — who
 * asked, when, which model answered, what it cited — and the prose itself goes
 * through `markdown.pure.ts` at render time rather than being parsed into
 * fields. Parsing figures out of the prose to restate them elsewhere would be a
 * second answer to a question the prose already answers, which is the failure
 * this programme exists to remove.
 *
 * ## Nothing is derived that the record holds
 *
 * `report_qa_conversations.report_names` and `report_contents` are the grounding
 * documents; `title` is what the conversation is called. None of them is
 * recomputed here. What *is* derived is the turn pairing — a question and the
 * answer that followed it — because the table stores messages in a flat list and
 * pairing them is a reading, not a fact.
 */

/** Which of the three documents this is. */
export type ReportQaSubject = 'structured' | 'answer' | 'transcript';

/**
 * A source the model cited, from `report_qa_messages.citations`.
 *
 * Persisted by `buildStructuredCitations` (`report-qa/index.ts:969`) and shown
 * on screen by `Citations.tsx`, but dropped by **every** export today: each
 * exporter redeclares a thin `Message` of `role | content | timestamp`
 * (`ConversationExport.tsx:14`), so nothing downstream ever sees them. A Q&A PDF
 * currently carries no source attribution at all. Zero messages in the record
 * have one, so this closes a latent defect rather than a live one — which is
 * exactly when it is cheap to close.
 */
export interface QaCitation {
  documentName: string;
  /** Null when the retrieval had no page. Printed as `p.4` when it does. */
  page: number | null;
  /** Null when the retrieval had no paragraph. Printed as `¶12`. */
  paragraph: number | null;
  /** The retrieved text, capped. Empty when there was none. */
  snippet: string;
  /** 0–1 as stored. Null when absent; never a zero standing in for unknown. */
  similarity: number | null;
}

/** One question and the answer it drew. */
export interface QaTurn {
  /** 1-based, in `created_at` order. What the contents page numbers. */
  index: number;
  /** The question, plain — it is a heading, so it carries no markup. */
  question: string;
  /** ISO instant of the question, as stored. */
  askedAt: string;
  /** The answer, still Markdown. `edited_content` wins over `content`. */
  answer: string;
  /** True when a human edited the answer before it was exported. */
  answerWasEdited: boolean;
  /** `openai`, `perplexity`, `gemini`, … as recorded. Empty when unknown. */
  modelProvider: string;
  modelVersion: string;
  citations: readonly QaCitation[];
}

/**
 * More turns than this in one document is a paste, not a conversation.
 *
 * The largest real conversation is 70 turns, so this is not a limit anyone
 * reaches — it is the guard that stops a malformed read printing ten thousand
 * headings into a contents page.
 */
export const MAX_TURNS = 200;

/**
 * The transcript's budget, in estimated printed lines across all turns.
 *
 * ## Why lines and not characters
 *
 * Characters were the obvious cap and they are the wrong one. What the page band
 * bounds is *pages*, and a transcript's pages come from two things: the prose,
 * and the furniture each exchange carries — a question callout, a provenance
 * line, a chapter header and the gaps around them. Measured against the record,
 * the furniture dominates. A 42,000-character conversation of 70 short exchanges
 * runs to about 45 pages; a 42,000-character conversation of 5 long ones runs to
 * about 15. A character cap admits the first and a turn cap refuses the second,
 * so neither alone is a budget.
 *
 * `TURN_FURNITURE_LINES + chars / CHARS_PER_LINE` per turn is within a few per
 * cent of what `markdown.pure.ts` goes on to count for real, and it needs no
 * parse — which is what lets the normaliser apply it before 350 KB of Markdown
 * is handed to a scanner.
 *
 * ## Where the number comes from
 *
 * 25 pages of body at `LINES_PER_PAGE`, which leaves the cover, contents,
 * sources and closing pages inside the archetype's 30-page ceiling. Against the
 * record that keeps **96% of conversations whole**: the p90 conversation
 * estimates at 414 lines and the p96 at 910. The four above it run to 5,751,
 * which is over a hundred and fifty printed pages.
 *
 * What is cut is said on the page, and the `.md` and `.txt` exports stay
 * uncapped and are what the notice points at.
 */
export const MAX_TRANSCRIPT_LINES = 950;

/**
 * Lines an exchange costs before a word of it is set.
 *
 * The chapter header and its rule, the "Asked" callout with its padding, the
 * provenance line, and the block gaps between them.
 */
export const TURN_FURNITURE_LINES = 13;

/**
 * A hard second guard, in characters.
 *
 * The line budget is the one that decides; this stops a single pathological
 * exchange — one answer of 200,000 characters — passing the line estimate on a
 * technicality and reaching the scanner whole.
 */
export const MAX_TRANSCRIPT_CHARS = 50_000;

/** A question is a heading; past this it is a paragraph someone pasted. */
export const MAX_QUESTION_CHARS = 240;

/** Citations printed per document. Beyond this the list is the document. */
export const MAX_CITATIONS = 40;

/** What the conversation was grounded in. */
export interface QaGrounding {
  /** File names from `report_qa_conversations.report_names`. */
  reportNames: readonly string[];
  /** How many of them there were, before any cap. */
  reportCount: number;
}

export interface ReportQaDocument {
  meta: {
    conversationId: string;
    /** Set only for the `answer` subject. */
    messageId: string | null;
    subject: ReportQaSubject;
    /** The conversation's own title. The document's title. */
    title: string;
    /** ISO instant, supplied by the caller. Nothing here has a clock. */
    preparedOn: string;
    /** Turns in the conversation, before any cap. */
    turnCount: number;
    /** Turns this document actually carries. */
    turnsShown: number;
    /** True when the transcript budget cut the conversation short. */
    truncated: boolean;
    /** Characters of conversation not shown. Zero when nothing was cut. */
    charsOmitted: number;
  };
  grounding: QaGrounding;
  /**
   * Two or three sentences framing the document. Built from the record, not
   * written — the same rule every other format in this programme holds.
   */
  narrative: string;
  /**
   * The Markdown this document typesets.
   *
   * For `structured` it is `structured_report`; for `answer` it is that one
   * message; for `transcript` it is empty and `turns` is the document.
   */
  body: string;
  /** Empty for `structured` and `answer`. The document for `transcript`. */
  turns: readonly QaTurn[];
  /** Deduplicated across every turn shown, in first-seen order. */
  citations: readonly QaCitation[];
  /** Which providers answered. `openai, perplexity` — printed once, in the foot. */
  models: readonly string[];
}
