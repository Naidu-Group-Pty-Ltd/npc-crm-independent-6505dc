/**
 * The shape of a render request and what comes back.
 *
 * Everything testable about the route lives here: what a caller may send, what
 * the file is called, and where it lands. The edge function around it does auth,
 * two reads, a render, an upload and two writes, none of which a unit test can
 * reach.
 *
 * The request is a conversation id, a subject, and — for one answer — a message
 * id. Nothing else, because everything this document says is already a row.
 */

import type { ReportQaSubject } from './payload.pure.ts';

export interface ReportQaRenderRequest {
  /** The `report_qa_conversations` row to typeset. */
  conversationId: string;
  /** Which of the three documents. */
  subject: ReportQaSubject;
  /** Required for `answer`, ignored otherwise. */
  messageId: string | null;
  /**
   * Generate the structured report when the conversation has none stored.
   *
   * Off by default, and that default is the point: this is the only route in
   * the programme that can call a model, so spending tokens is something a
   * caller asks for rather than something a render does on its way past.
   */
  generateIfMissing: boolean;
  /**
   * Post the finished file into the conversation as an assistant attachment.
   *
   * The shape `PDFAttachmentMessage.tsx` already reads, so the existing in-place
   * email compose keeps working against the new document without changing.
   */
  attachToConversation: boolean;
  /** `VOL. 2026 · ED. 08`. Cosmetic; the caller may supply it. */
  edition: string | null;
}

export type RequestParse =
  | { ok: true; request: ReportQaRenderRequest }
  | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SUBJECTS: readonly ReportQaSubject[] = ['structured', 'answer', 'transcript'];

/**
 * Read a request body.
 *
 * The conversation's title, its messages and its citations are deliberately
 * **not** inputs. They are read from the two tables, because a transcript the
 * caller supplies is a transcript the caller can edit — and this document's
 * whole claim is that it is a record of what was asked and what was said.
 *
 * That is a change from the legacy, which posts the messages up from browser
 * state (`ReportQA.tsx:2042`) and typesets whatever arrives.
 */
export function parseRenderRequest(body: unknown): RequestParse {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid json' };
  const b = body as Record<string, unknown>;

  const conversationId = typeof b.conversationId === 'string' ? b.conversationId.trim() : '';
  if (!UUID.test(conversationId)) return { ok: false, error: 'conversationId must be a uuid' };

  const raw = typeof b.subject === 'string' ? b.subject.trim() : '';
  const subject = SUBJECTS.find((s) => s === raw);
  if (!subject) {
    return { ok: false, error: `subject must be one of ${SUBJECTS.join(', ')}` };
  }

  let messageId: string | null = null;
  if (subject === 'answer') {
    const id = typeof b.messageId === 'string' ? b.messageId.trim() : '';
    if (!UUID.test(id)) return { ok: false, error: 'messageId must be a uuid for the answer subject' };
    messageId = id;
  }

  const edition = typeof b.edition === 'string' ? b.edition.trim().slice(0, 40) : '';

  return {
    ok: true,
    request: {
      conversationId,
      subject,
      messageId,
      generateIfMissing: b.generateIfMissing === true,
      attachToConversation: b.attachToConversation === true,
      edition: edition || null,
    },
  };
}

/**
 * The filename.
 *
 * **A deliberate divergence from all three legacy conventions**, which are:
 *
 *  - `Summary - ${reportNames.join(', ')}.pdf` (`QAPDFGenerator.tsx:431` and,
 *    byte for byte, `MessageReportEditor.tsx:533`). Unsanitised, so the commas
 *    land in the filename; and when there are no report names it falls back to
 *    `Q&A Summary - ${new Date().toLocaleDateString()}.pdf`, which with no
 *    locale argument produces `8/2/2026` — **slashes in a filename**.
 *  - `${sanitizedTitle}_report.pdf` (`ConversationReportEditor.tsx:515`).
 *  - `${sanitizedTitle}_message.pdf` (`MessageReportEditor.tsx:534`).
 *
 * One name, and it says what the document is and which of the three it is. The
 * `[^a-zA-Z0-9] → _` rule the legacy uses is kept exactly, so the old and new
 * files sort together in a downloads folder.
 */
export function reportQaFileName(
  title: string,
  subject: ReportQaSubject,
  isoDate: string,
): string {
  const safe = (title || 'Conversation').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 80);
  const date = /^\d{4}-\d{2}-\d{2}/.exec(isoDate)?.[0] ?? '';
  const kind = subject === 'answer' ? 'Answer' : subject === 'structured' ? 'Report' : 'Transcript';
  return `Q_and_A_${kind}_${safe}_${date}.pdf`;
}

/** The first eight characters of the conversation id, uppercased, for the cover foot. */
export function reportQaReference(conversationId: string): string {
  return conversationId.slice(0, 8).toUpperCase();
}

/**
 * Where the file lands.
 *
 * `qa_exports` is the private bucket `generate-qa-pdf` already writes to
 * (`report-qa/index.ts:4270`), so the two paths' artefacts sit together and one
 * access rule governs both.
 *
 * The random segment is not decoration: without it a second render of the same
 * conversation on the same day either overwrites the first or needs `upsert`,
 * and overwriting a document somebody may already hold a link to is not a thing
 * to do quietly.
 */
export function reportQaStoragePath(
  conversationId: string,
  fileName: string,
  isoDate: string,
  uniqueId: string,
): string {
  const day = /^\d{4}-\d{2}-\d{2}/.exec(isoDate)?.[0] ?? 'undated';
  return `report-qa/${conversationId}/${day}/${uniqueId}-${fileName}`;
}

/** The bucket. Private, and shared with the legacy server path. */
export const STORAGE_BUCKET = 'qa_exports';

/** How long a returned link lives. Long enough to email, short enough to expire. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface ReportQaRenderResponse {
  url: string;
  fileName: string;
  bytes: number;
  pageCount: number | null;
  renderId: string | null;
  brandSnapshotId: string | null;
  /** What the brand snapshot was missing, so the UI can say so before sending. */
  brandGaps: string[];
  /** Section titles in printed order. Discovered from the content. */
  sections: string[];
  subject: ReportQaSubject;
  /** Exchanges in the conversation, and how many the document carries. */
  turnCount: number;
  turnsShown: number;
  /** True when the document says on its own pages that it is not the whole thing. */
  truncated: boolean;
  /** Set when the route generated a structured report rather than reading one. */
  generated: boolean;
  /** The attachment written into the conversation, when one was asked for. */
  attachment: {
    messageId: string;
    name: string;
    url: string;
    size: number;
  } | null;
  durationMs: number;
}
