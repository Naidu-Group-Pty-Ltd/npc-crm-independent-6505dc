/**
 * Getting a typeset comparison into someone's hands.
 *
 * Thinner than `deliverSnapshot.ts` and `deliverPortfolioReview.ts`, because
 * there is only one thing this module can deliver. `property_comparisons` has no
 * `pdf_file_path`, so there is no stored file to offer as a second option, and
 * `ComparisonPDFGenerator` has no importable entry point, so the legacy renderer
 * cannot be called either. The control that uses this offers the legacy path as a
 * *place to go* rather than as a second download — see
 * `ComparisonDownloadButton`.
 */
import { tryTemplateDocument } from '@/lib/reportTemplate/templateDocument';
import { requestComparisonPdf, type ComparisonPdfRequest } from './requestComparisonPdf';

export interface DeliveredComparison {
  fileName: string;
  /** What the tenant's brand snapshot was missing. */
  brandGaps: string[];
  /** False when the stored analysis was cut off before it finished. */
  recordComplete: boolean;
  /** Which sections the record does not hold. */
  missingSections: string[];
  /**
   * Rendered from an activated template. The diagnostics above describe the
   * flowing render and are left neutral — a truncated record is not lost by
   * that, because the projection composes the cut-off note into the document
   * itself and the masters draw it, so the warning reaches the reader on the
   * page rather than in a toast the sender saw once.
   */
  templated?: boolean;
}

/**
 * Save a file the way a browser saves files.
 *
 * The object URL is always ours here, so it is always revoked — on a delay,
 * because Safari cancels an in-flight download when the URL disappears
 * underneath it.
 */
function saveToBrowser(url: string, fileName: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/**
 * Produce the comparison and hand it to the browser.
 *
 * Throws on failure with the message the renderer gave, so a caller can put it in
 * front of the person who pressed the button rather than in a console.
 */
export async function deliverComparisonPdf(
  request: ComparisonPdfRequest,
): Promise<DeliveredComparison> {
  // The FINAL document: drawn by the pinned engine, never the browser's jsPDF (RS-5c).
  const templated = await tryTemplateDocument('comparison', request.comparisonId, { renderer: 'weasyprint' });
  if (templated) {
    saveToBrowser(URL.createObjectURL(templated.blob), templated.fileName);
    return {
      fileName: templated.fileName,
      brandGaps: [],
      recordComplete: true,
      missingSections: [],
      templated: true,
    };
  }

  const result = await requestComparisonPdf(request);

  // A signed URL. Fetched rather than followed, so the file is *saved* — a PDF
  // that opens in a tab is a PDF the client has to find again.
  const response = await fetch(result.url);
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  saveToBrowser(URL.createObjectURL(await response.blob()), result.fileName);

  return {
    fileName: result.fileName,
    brandGaps: result.brandGaps,
    recordComplete: result.recordComplete,
    missingSections: result.missingSections,
  };
}

/**
 * The comparison as bytes, for a caller that uploads it rather than saving it.
 *
 * Nothing publishes a comparison to the client portal today. This exists so that
 * when someone decides to, the contract they need — a blob and a filename,
 * produced without a download side effect — is already here rather than invented
 * at the call site.
 */
export async function comparisonPdfBlob(request: ComparisonPdfRequest): Promise<{
  blob: Blob;
  fileName: string;
  brandGaps: string[];
  recordComplete: boolean;
}> {
  // The FINAL document: drawn by the pinned engine, never the browser's jsPDF (RS-5c).
  const templated = await tryTemplateDocument('comparison', request.comparisonId, { renderer: 'weasyprint' });
  if (templated) {
    return {
      blob: templated.blob,
      fileName: templated.fileName,
      brandGaps: [],
      recordComplete: true,
    };
  }

  const result = await requestComparisonPdf(request);
  const response = await fetch(result.url);
  if (!response.ok) throw new Error(`Could not read the rendered document (${response.status})`);
  return {
    blob: await response.blob(),
    fileName: result.fileName,
    brandGaps: result.brandGaps,
    recordComplete: result.recordComplete,
  };
}
