/**
 * Asking the server for a typeset Property Comparison Analysis.
 *
 * ## No legacy fallback, and here that is not even a choice
 *
 * `requestSnapshot.ts` falls back to its in-browser generator when the route is
 * absent, because for that format the two renderers produce the same document
 * from the same inputs.
 *
 * Neither half holds here. `ComparisonPDFGenerator` has **no importable entry
 * point** — it is a React component that calls an edge function and then mounts
 * `PixelPerfectPDFGenerator`, which exposes only a ref handle returning a URL —
 * so there is no function this module could call. And nothing is being replaced:
 * the existing button keeps working everywhere it works today, and this is an
 * additional one. A deployment gap means one new menu item does not work yet, and
 * it says so, naming the button that does.
 *
 * ## What the two paths actually differ on
 *
 * Worth stating because the UI says it too: the legacy path asks a model to
 * rewrite the stored analysis as markdown on **every** download, so it spends
 * report credits and the wording differs each time. This one typesets the row.
 * Free, and the same twice.
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { looksUndeployed } from '../undeployedRoute';

export interface ComparisonPdfRequest {
  /** The `property_comparisons` row to typeset. */
  comparisonId: string;
  /** `VOL. 2026 · ED. 08`. Cosmetic. */
  edition?: string | null;
}

export interface ComparisonPdfResult {
  url: string;
  fileName: string;
  bytes: number;
  pageCount: number | null;
  /** What the tenant's brand snapshot was missing. Empty for a complete one. */
  brandGaps: string[];
  /**
   * False when the stored analysis was cut off before it finished.
   *
   * Surfaced so the UI can warn *before* someone emails the document, at the
   * same moment and for the same reason as `brandGaps`.
   */
  recordComplete: boolean;
  /** Which sections the record does not hold. Empty when it is complete. */
  missingSections: string[];
  /** 10 or 100, or null when the analysis scored nothing. */
  scoreScale: number | null;
}

// The predicate is shared (`../undeployedRoute`). Every one of the nine
// formats carried its own copy and eight were stale in the same way: none
// could match the message the transport produces for an absent function,
// so the fallback each of them guards never fired for the case it exists
// for. See that module's header.

const UNDEPLOYED_MESSAGE =
  'The typeset comparison is not available yet — render-property-comparison-pdf has '
  + 'not been deployed. Use “Download the AI-written report” in the meantime.';

/** Request the document. Throws with a message worth showing a person. */
export async function requestComparisonPdf(
  request: ComparisonPdfRequest,
): Promise<ComparisonPdfResult> {
  const { data, error } = await invokeSecureFunction('render-property-comparison-pdf', {
    comparisonId: request.comparisonId,
    edition: request.edition ?? null,
    // A five-property comparison with every section runs to 26 pages and
    // WeasyPrint is a network hop; this is generous against the worst case
    // rather than against the median.
  }, { timeoutMs: 180_000 });

  if (!error && data?.url) {
    return {
      url: String(data.url),
      fileName: String(data.fileName ?? 'Property_Comparison.pdf'),
      bytes: Number(data.bytes ?? 0),
      pageCount: Number.isFinite(data.pageCount) ? Number(data.pageCount) : null,
      brandGaps: Array.isArray(data.brandGaps) ? data.brandGaps.map(String) : [],
      // Absent means complete: an older deployment that does not send the field
      // should not make every document look truncated.
      recordComplete: data.recordComplete !== false,
      missingSections: Array.isArray(data.missingSections)
        ? data.missingSections.map(String)
        : [],
      scoreScale: Number.isFinite(data.scoreScale) ? Number(data.scoreScale) : null,
    };
  }

  if (looksUndeployed(error)) throw new Error(UNDEPLOYED_MESSAGE);
  throw new Error(error?.message || 'Could not produce the comparison analysis');
}
