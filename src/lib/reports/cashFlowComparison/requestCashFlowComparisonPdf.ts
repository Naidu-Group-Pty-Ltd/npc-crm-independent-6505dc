/**
 * Asking the server for a typeset Cash Flow Comparison Analysis.
 *
 * ## No legacy fallback, and here that is a decision rather than a limitation
 *
 * `requestCashFlowPdf` falls back to its in-browser generator when the route is
 * absent, because for that format the two renderers produce the same document
 * from the same inputs.
 *
 * They do not here. The two legacy generators produce genuinely different
 * documents: `exportComparisonPDF` rasterises three on-screen charts and prints
 * an eight-row metrics table, and `exportAiAnalysisPDF` prints the model's prose
 * and nothing else — and draws nothing at all when there is no analysis.
 * Silently substituting either for this one would hand a client a document
 * nobody chose. So a deployment gap means one new menu item does not work yet,
 * and it says so, naming the buttons that do.
 *
 * ## What crosses the wire
 *
 * Every property's projected years as plain numbers, and the analysis object if
 * the adviser generated one. Not the nine metrics — the server derives those, so
 * that the ranking cannot disagree with the tables beneath it. Not the
 * addresses either: those are read from `investment_reports`, because the label
 * on a column of someone's financial projection is not a display preference.
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { looksUndeployed } from '../undeployedRoute';
import type { WireComparison } from './toWireComparison';

export interface ComparisonPdfResult {
  url: string;
  fileName: string;
  bytes: number;
  pageCount: number | null;
  /** What the tenant's brand snapshot was missing. Empty for a complete one. */
  brandGaps: string[];
  propertyCount: number;
  /** False when no written analysis was generated. Common, and not an error. */
  hasAnalysis: boolean;
  /** Which of the producer's eight sections did not arrive. */
  missingSections: string[];
}

// The predicate is shared (`../undeployedRoute`). Every one of the nine
// formats carried its own copy and eight were stale in the same way: none
// could match the message the transport produces for an absent function,
// so the fallback each of them guards never fired for the case it exists
// for. See that module's header.

const UNDEPLOYED_MESSAGE =
  'The typeset comparison is not available yet — render-cash-flow-comparison-pdf '
  + 'has not been deployed. The Export PDF buttons on this screen still work.';

/** Request the document. Throws with a message worth showing a person. */
export async function requestCashFlowComparisonPdf(
  comparison: WireComparison,
  edition?: string | null,
): Promise<ComparisonPdfResult> {
  const { data, error } = await invokeSecureFunction('render-cash-flow-comparison-pdf', {
    ...comparison,
    edition: edition ?? null,
    // Five properties with every model section runs to 27 pages and WeasyPrint
    // is a network hop; this is generous against the worst case rather than
    // against the median.
  }, { timeoutMs: 180_000 });

  if (!error && data?.url) {
    return {
      url: String(data.url),
      fileName: String(data.fileName ?? 'Cash_Flow_Comparison.pdf'),
      bytes: Number(data.bytes ?? 0),
      pageCount: Number.isFinite(data.pageCount) ? Number(data.pageCount) : null,
      brandGaps: Array.isArray(data.brandGaps) ? data.brandGaps.map(String) : [],
      propertyCount: Number(data.propertyCount ?? comparison.properties.length),
      hasAnalysis: data.hasAnalysis === true,
      missingSections: Array.isArray(data.missingSections)
        ? data.missingSections.map(String)
        : [],
    };
  }

  if (looksUndeployed(error)) throw new Error(UNDEPLOYED_MESSAGE);
  throw new Error(error?.message || 'Could not produce the cash flow comparison');
}
