/**
 * Getting a typeset client details report into someone's hands — or into an
 * email.
 *
 * ## Why this one hands back the bytes
 *
 * Every other `deliver*` module in the programme saves a file and returns a
 * summary. This one must also return the `Blob`, because the two paths that
 * matter most for this document do not download anything:
 *
 *  - **Send to Finance** base64s the PDF into `share-report-with-finance`, which
 *    puts it in the broker's Finance Portal;
 *  - **the email composer** takes the blob as an attachment
 *    (`ClientDetailsModal.tsx:178`).
 *
 * Both take a `Blob` from the legacy generator today. Handing back the same
 * thing is what lets the typeset document reach a broker rather than only a
 * downloads folder — which is the whole point of migrating this format, since a
 * broker is who reads it.
 *
 * The signed URL is fetched rather than followed for the same reason it is in
 * the other formats: a PDF that opens in a tab is a PDF someone has to find
 * again.
 */
import { tryTemplateDocument } from '@/lib/reportTemplate/templateDocument';
import {
  requestClientDetailsPdf,
  type ClientDetailsPdfResult,
} from './requestClientDetailsPdf';

export interface DeliveredClientDetails {
  fileName: string;
  pageCount: number | null;
  /** What the tenant's brand snapshot was missing. */
  brandGaps: string[];
  /** Which sections the record had content for. */
  sections: string[];
  propertyCount: number;
  /** The document itself, for the email and Finance Portal paths. */
  blob: Blob;
  /**
   * Rendered from an activated Template Builder template rather than by the
   * flowing route. The diagnostics above describe the flowing render and are
   * left empty when this is true — they are not zero, they are not measured.
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
 * `save` is opt-in rather than automatic, because two of the three callers do
 * not want a file on disk — they want the bytes to send.
 *
 * Throws on failure with the message the renderer gave, so a caller can put it
 * in front of the person who pressed the button rather than in a console.
 */
export async function deliverClientDetailsPdf(
  clientId: string,
  options: { save?: boolean; edition?: string | null } = {},
): Promise<DeliveredClientDetails> {
  // An activated template wins, and answers null when there is none. See
  // `templateDocument.ts`; every one of its failure modes lands here as null,
  // so the route below stays the way this document is produced.
  // The FINAL document: drawn by the pinned engine, never the browser's jsPDF (RS-5c).
  const templated = await tryTemplateDocument('client_details', clientId, { renderer: 'weasyprint' });
  if (templated) {
    if (options.save !== false) saveToBrowser(templated.blob, templated.fileName);
    return {
      fileName: templated.fileName,
      pageCount: null,
      brandGaps: [],
      sections: [],
      propertyCount: 0,
      blob: templated.blob,
      templated: true,
    };
  }

  const result: ClientDetailsPdfResult = await requestClientDetailsPdf(clientId, options.edition);

  const response = await fetch(result.url);
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const blob = await response.blob();

  if (options.save !== false) saveToBrowser(blob, result.fileName);

  return {
    fileName: result.fileName,
    pageCount: result.pageCount,
    brandGaps: result.brandGaps,
    sections: result.sections,
    propertyCount: result.propertyCount,
    blob,
  };
}
