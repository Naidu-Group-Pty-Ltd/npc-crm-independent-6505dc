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
 * The one exception is a preview, which may carry the editor's draft and keeps
 * nothing (`applyPreviewDraft`); a document that is kept is always the record.
 */
import {
  readTemplateDesignReference,
  type DesignEcho,
  type TemplateDesignReference,
} from '../../reportDesign/templateDesign.pure.ts';

import type { ReportQaSubject } from './payload.pure.ts';
import { HUB_DOCUMENT_NAME, hubDocumentFileName, storageSafeFileName } from './documentIdentity.pure.ts';

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
  /**
   * The design to draw the document in (`templateDesign.pure.ts`): a catalogue
   * design or a template row, or null for the standard design. The words,
   * figures and pages are the report's own whatever is named here.
   */
  design: TemplateDesignReference | null;
  /**
   * Draw the document and keep nothing (`PREVIEW` below): no file, no ledger
   * row, no brand-snapshot row, no attachment, no model call. The bytes go
   * back to the export dialog, which draws the pages.
   */
  preview: boolean;
  /**
   * For a preview only: the text in the editor, drawn in place of the stored
   * answer (the `answer` subject) or the stored write-up (`structured`). A
   * delivered document is always drawn from the record; a draft is what lets
   * somebody see their edit in the chosen template before they keep it.
   */
  draft: string | null;
}

export type RequestParse =
  | { ok: true; request: ReportQaRenderRequest }
  | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The longest draft a preview draws. Three times the longest answer the owner
 * has exported (20,136 characters) with room to spare, and past the Markdown
 * renderer's own bound, which says on the page what it did not draw.
 */
export const MAX_PREVIEW_DRAFT_CHARS = 150_000;

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
  // A design is optional, and a malformed one is refused rather than ignored,
  // so a caller that meant to ask for one is told it did not get it.
  const design = readTemplateDesignReference(b.design);
  if (design.ok === false) return { ok: false, error: design.error };

  // A preview keeps nothing, so it can neither post a file into the
  // conversation nor spend tokens writing a missing write-up.
  const preview = b.preview === true;
  let draft: string | null = null;
  if (b.draft !== undefined && b.draft !== null) {
    if (typeof b.draft !== 'string') return { ok: false, error: 'draft must be text' };
    if (!preview) return { ok: false, error: 'a draft is drawn only in a preview' };
    if (subject === 'transcript') return { ok: false, error: 'a transcript is drawn from the record, never a draft' };
    if (!b.draft.trim()) return { ok: false, error: 'draft is empty' };
    if (b.draft.length > MAX_PREVIEW_DRAFT_CHARS) {
      return { ok: false, error: `draft is longer than ${MAX_PREVIEW_DRAFT_CHARS.toLocaleString('en-AU')} characters` };
    }
    draft = b.draft;
  }

  return {
    ok: true,
    request: {
      conversationId,
      subject,
      messageId,
      generateIfMissing: !preview && b.generateIfMissing === true,
      attachToConversation: !preview && b.attachToConversation === true,
      edition: edition || null,
      design: design.reference,
      preview,
      draft,
    },
  };
}

/**
 * The record with the draft in place of what it stands in for.
 *
 * The answer's draft becomes that message's `edited_content`, which the
 * normaliser already prefers over the original — the same slot the editor's
 * Save writes, so a preview draws exactly what saving would draw. The
 * write-up's draft becomes the conversation's `structured_report`. Nothing is
 * mutated: the rows the route read are left as they were.
 */
export function applyPreviewDraft<C extends Record<string, unknown>, M extends Record<string, unknown>>(
  conversation: C,
  messages: readonly M[],
  request: Pick<ReportQaRenderRequest, 'subject' | 'messageId' | 'draft'>,
): { conversation: C; messages: M[] } {
  if (request.draft === null) return { conversation, messages: [...messages] };
  if (request.subject === 'structured') {
    return { conversation: { ...conversation, structured_report: request.draft }, messages: [...messages] };
  }
  if (request.subject === 'answer') {
    return {
      conversation,
      messages: messages.map((m) => (m.id === request.messageId ? { ...m, edited_content: request.draft } : m)),
    };
  }
  return { conversation, messages: [...messages] };
}

/**
 * A PDF as base64, for the preview's JSON answer.
 *
 * In slices, because `String.fromCharCode(...bytes)` on a whole document
 * overflows the argument limit well before a sixteen-page report.
 */
export function pdfToBase64(bytes: Uint8Array): string {
  let binary = '';
  const SLICE = 0x8000;
  for (let i = 0; i < bytes.length; i += SLICE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + SLICE));
  }
  return btoa(binary);
}

/**
 * The filename: `Intelligence Hub Summary - <topic> - 28 Sep 2026.pdf`.
 *
 * `title` is the document's cover title, which `normalise.pure.ts` already made
 * the TOPIC — the answer's own heading, a title somebody gave the conversation,
 * or the question (`documentIdentity.pure.ts`). Where nothing said what the
 * document covers the cover carries the product's name, and the filename then
 * carries it once rather than twice.
 *
 * This replaces `Q_and_A_${kind}_${title}_${date}.pdf`, which named the file
 * after a feature the page no longer calls itself and underscored the one line
 * of the document somebody reads before opening it. The three legacy
 * conventions it replaced are recorded in `documentIdentity.pure.ts`.
 */
export function reportQaFileName(
  title: string,
  subject: ReportQaSubject,
  isoDate: string,
): string {
  const topic = (title || '').trim() === HUB_DOCUMENT_NAME ? '' : (title || '');
  return hubDocumentFileName(topic, isoDate, {
    kind: subject === 'transcript' ? 'transcript' : 'summary',
  });
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
  // The readable name is what a person is handed; the key keeps to characters
  // no URL encoder rewrites.
  return `report-qa/${conversationId}/${day}/${uniqueId}-${storageSafeFileName(fileName)}`;
}

/** The bucket. Private, and shared with the legacy server path. */
export const STORAGE_BUCKET = 'qa_exports';

/** How long a returned link lives. Long enough to email, short enough to expire. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

/**
 * What a preview answers: the document's own bytes and what the dialog needs
 * to draw and navigate them. No url, no render id, no snapshot id — nothing
 * was kept, so there is nothing to point at.
 */
export interface ReportQaPreviewResponse {
  preview: true;
  /** The PDF, base64. */
  pdf: string;
  fileName: string;
  bytes: number;
  pageCount: number | null;
  brandGaps: string[];
  /** Section titles in printed order — the contents page, and the navigator. */
  sections: string[];
  subject: ReportQaSubject;
  turnCount: number;
  turnsShown: number;
  truncated: boolean;
  durationMs: number;
  design: DesignEcho | null;
}

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
  /**
   * The design the document was drawn in, or why the one asked for was not
   * used — in that case the document is the standard design. Null when none
   * was asked for.
   */
  design: DesignEcho | null;
}
