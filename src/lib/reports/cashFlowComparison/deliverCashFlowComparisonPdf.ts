/**
 * Getting a typeset cash flow comparison into someone's hands.
 *
 * One thing to deliver, so this is thin. Nothing is stored against a comparison —
 * `cash_flow_analyses` holds zero rows and structurally cannot hold any — so
 * there is no saved file to offer as a second option, and the two legacy
 * generators are React callbacks inside the modal rather than importable
 * functions. The control that uses this offers them as *places to press* rather
 * than as second downloads; see `CashFlowComparisonDownloadButton`.
 */
import {
  requestCashFlowComparisonPdf,
  type ComparisonPdfResult,
} from './requestCashFlowComparisonPdf';
import type { WireComparison } from './toWireComparison';

export interface DeliveredComparison {
  fileName: string;
  pageCount: number | null;
  /** What the tenant's brand snapshot was missing. */
  brandGaps: string[];
  propertyCount: number;
  /** False when no written analysis was generated. Common, and not an error. */
  hasAnalysis: boolean;
  /** Which of the producer's eight sections did not arrive. */
  missingSections: string[];
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
 * Throws on failure with the message the renderer gave, so a caller can put it
 * in front of the person who pressed the button rather than in a console.
 */
export async function deliverCashFlowComparisonPdf(
  comparison: WireComparison,
  edition?: string | null,
): Promise<DeliveredComparison> {
  const result: ComparisonPdfResult = await requestCashFlowComparisonPdf(comparison, edition);

  // A signed URL. Fetched rather than followed, so the file is *saved* — a PDF
  // that opens in a tab is a PDF the client has to find again.
  const response = await fetch(result.url);
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  saveToBrowser(URL.createObjectURL(await response.blob()), result.fileName);

  return {
    fileName: result.fileName,
    pageCount: result.pageCount,
    brandGaps: result.brandGaps,
    propertyCount: result.propertyCount,
    hasAnalysis: result.hasAnalysis,
    missingSections: result.missingSections,
  };
}
