/**
 * Getting a typeset Q&A document into someone's hands — or into an email.
 *
 * ## Why this one hands back the bytes
 *
 * Because the path that matters most for this document does not download
 * anything. The toolbar's existing "Export PDF" posts the file into the
 * conversation as an assistant attachment (`ReportQA.tsx:2055`), which is what
 * `PDFAttachmentMessage.tsx` renders and what `InPlaceEmailCompose.tsx` sends.
 * A control that could only save to disk would leave the typeset document
 * unreachable from the one route that puts it in front of a person who is not
 * the adviser.
 *
 * So the route writes the attachment row and this module hands back the `Blob`,
 * and between them the new document reaches every destination the old one did.
 *
 * The signed URL is fetched rather than followed, for the same reason it is in
 * the other formats: a PDF that opens in a tab is a PDF someone has to find
 * again.
 */
import { tryTemplateDocument } from '@/lib/reportTemplate/templateDocument';
import {
  requestReportQaPdf,
  type ReportQaPdfResult,
  type ReportQaSubjectName,
  type RequestReportQaOptions,
} from './requestReportQaPdf';

export interface DeliveredReportQa {
  fileName: string;
  pageCount: number | null;
  /** What the tenant's brand snapshot was missing. */
  brandGaps: string[];
  /** Section titles in printed order. */
  sections: string[];
  subject: ReportQaSubjectName;
  turnCount: number;
  turnsShown: number;
  truncated: boolean;
  generated: boolean;
  attachment: ReportQaPdfResult['attachment'];
  /** The document itself, for the email and attachment paths. */
  blob: Blob;
  /**
   * Rendered from an activated template. The counts above describe the flowing
   * render and are left at zero when this is true — a template carries a fixed
   * page sequence, so "13 of 20 exchanges" is a claim it cannot make.
   */
  templated?: boolean;
}

/** Save a file the way a browser saves files. */
function saveToBrowser(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // On a delay: Safari cancels an in-flight download when the URL disappears
  // underneath it.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/**
 * Produce the document and return it.
 *
 * `save` is opt-in rather than automatic, because a caller who asked for the
 * file to be posted into the conversation does not also want it in a downloads
 * folder.
 *
 * Throws on failure with the message the renderer gave, so a caller can put it
 * in front of the person who pressed the button rather than in a console.
 */
export async function deliverReportQaPdf(
  conversationId: string,
  subject: ReportQaSubjectName,
  options: RequestReportQaOptions & { save?: boolean } = {},
): Promise<DeliveredReportQa> {
  // The subject is this format's variant — transcript, single answer or the
  // structured report — and the adapter reads it to decide which of the three
  // documents a conversation makes. Passing it is what stops every templated
  // export being a transcript.
  // The FINAL document: drawn by the pinned engine, never the browser's jsPDF (RS-5c).
  const templated = await tryTemplateDocument('qa', conversationId, { variant: subject, renderer: 'weasyprint' });
  if (templated) {
    if (options.save !== false) saveToBrowser(templated.blob, templated.fileName);
    return {
      fileName: templated.fileName,
      pageCount: null,
      brandGaps: [],
      sections: [],
      subject,
      turnCount: 0,
      turnsShown: 0,
      truncated: false,
      generated: false,
      attachment: null,
      blob: templated.blob,
      templated: true,
    };
  }

  const result = await requestReportQaPdf(conversationId, subject, options);

  const response = await fetch(result.url);
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const blob = await response.blob();

  if (options.save !== false) saveToBrowser(blob, result.fileName);

  return {
    fileName: result.fileName,
    pageCount: result.pageCount,
    brandGaps: result.brandGaps,
    sections: result.sections,
    subject: result.subject,
    turnCount: result.turnCount,
    turnsShown: result.turnsShown,
    truncated: result.truncated,
    generated: result.generated,
    attachment: result.attachment,
    blob,
  };
}
