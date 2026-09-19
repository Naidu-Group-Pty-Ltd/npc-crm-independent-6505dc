/**
 * Asking the server for a typeset Report Q&A document.
 *
 * ## What crosses the wire, and what deliberately does not
 *
 * A conversation id and which of the three documents is wanted. **Not the
 * messages.** The legacy path posts them up from browser state
 * (`ReportQA.tsx:2042`) and typesets whatever arrives; this route reads
 * `report_qa_conversations` and `report_qa_messages` itself, because a
 * transcript the caller supplies is a transcript the caller can edit, and this
 * document's whole claim is that it is a record of what was asked and what was
 * said.
 *
 * It also means the document does not depend on which screen asked for it, or
 * on how much of the conversation that screen had loaded.
 *
 * ## No legacy fallback
 *
 * `requestCashFlowPdf` falls back to its in-browser generator when the route is
 * absent, because for that format the two renderers produce the same document
 * from the same inputs.
 *
 * Here they do not. Substituting a jsPDF export whose tables overlap
 * (`ConversationReportEditor.tsx:268`), whose smart punctuation has been
 * transliterated to ASCII, and whose cover is our letterhead rather than the
 * tenant's, would send somebody a different document from the one they chose. A
 * deployment gap means the new control does not work yet, and it says so,
 * naming the exports that do.
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { looksUndeployed } from '../undeployedRoute';

export type ReportQaSubjectName = 'structured' | 'answer' | 'transcript';

export interface ReportQaPdfAttachment {
  messageId: string;
  name: string;
  url: string;
  size: number;
}

export interface ReportQaPdfResult {
  url: string;
  fileName: string;
  bytes: number;
  pageCount: number | null;
  /** What the tenant's brand snapshot was missing. Empty for a complete one. */
  brandGaps: string[];
  /** Section titles in printed order — discovered from the content. */
  sections: string[];
  subject: ReportQaSubjectName;
  turnCount: number;
  turnsShown: number;
  /** True when the document says on its own pages that it is not the whole thing. */
  truncated: boolean;
  /** True when the route called a model rather than reading a stored write-up. */
  generated: boolean;
  /** Set when the file was also posted into the conversation. */
  attachment: ReportQaPdfAttachment | null;
}

export interface RequestReportQaOptions {
  /** Required for the `answer` subject. */
  messageId?: string | null;
  /**
   * Let the route write the structured report when the conversation has none.
   *
   * Off by default. This is the only route in the programme that can spend
   * tokens, so spending them is something a caller asks for rather than
   * something a download does on its way past.
   */
  generateIfMissing?: boolean;
  /** Post the finished file into the conversation, so it can be emailed. */
  attachToConversation?: boolean;
  edition?: string | null;
}

/**
 * True when the failure means "this function does not exist here yet".
 *
 * Deliberately narrow, and used only to choose the *message*. A bare 404 does
 * not count: the route answers 404 for a conversation that does not exist, and
 * reading that as "not deployed" would send someone to deploy a function that is
 * already there.
 *
 * The `network` arm is the one that matters in practice. An absent function is
 * a 404 from the Supabase gateway rather than from the function, and a gateway
 * 404 carries no `Access-Control-Allow-Origin`, so the browser never lets the
 * caller see the status — `fetch` rejects and `invokeSecureFunction` turns that
 * into its "Network/CORS error calling …" string. Matching only on
 * `failed to fetch` therefore missed the very case it was written for, and the
 * person who pressed the button was shown a CORS diagnostic for a function that
 * had simply never been deployed.
 */
// The predicate is shared (`../undeployedRoute`). This module is where the
// `network` arm was worked out; the other two formats carried stale copies
// that could not match it, so their legacy fallbacks never fired.

const UNDEPLOYED_MESSAGE =
  'The typeset Q&A document is not available yet — render-report-qa-pdf has not been '
  + 'deployed to this project (run npm run deploy:report-qa-render). The existing '
  + 'Export PDF button and the .md / .txt / .csv / .json exports still work.';

/** Request the document. Throws with a message worth showing a person. */
export async function requestReportQaPdf(
  conversationId: string,
  subject: ReportQaSubjectName,
  options: RequestReportQaOptions = {},
): Promise<ReportQaPdfResult> {
  const { data, error } = await invokeSecureFunction('render-report-qa-pdf', {
    conversationId,
    subject,
    messageId: options.messageId ?? null,
    generateIfMissing: options.generateIfMissing === true,
    attachToConversation: options.attachToConversation === true,
    edition: options.edition ?? null,
    // A transcript runs to twenty-nine pages, WeasyPrint is a network hop, and
    // the structured subject may make a gpt-5.2 call on the way. Generous
    // against the worst case rather than the median — the legacy's own cap was
    // two minutes and it was reached.
  }, { timeoutMs: 240_000 });

  if (!error && data?.url) {
    const raw = data.attachment as Record<string, unknown> | null | undefined;
    return {
      url: String(data.url),
      fileName: String(data.fileName ?? 'Q_and_A.pdf'),
      bytes: Number(data.bytes ?? 0),
      pageCount: Number.isFinite(data.pageCount) ? Number(data.pageCount) : null,
      brandGaps: Array.isArray(data.brandGaps) ? data.brandGaps.map(String) : [],
      sections: Array.isArray(data.sections) ? data.sections.map(String) : [],
      subject: (data.subject as ReportQaSubjectName) ?? subject,
      turnCount: Number(data.turnCount ?? 0),
      turnsShown: Number(data.turnsShown ?? 0),
      truncated: data.truncated === true,
      generated: data.generated === true,
      attachment: raw && typeof raw === 'object'
        ? {
          messageId: String(raw.messageId ?? ''),
          name: String(raw.name ?? ''),
          url: String(raw.url ?? ''),
          size: Number(raw.size ?? 0),
        }
        : null,
    };
  }

  if (looksUndeployed(error)) throw new Error(UNDEPLOYED_MESSAGE);
  throw new Error(error?.message || 'Could not produce the Q&A document');
}
