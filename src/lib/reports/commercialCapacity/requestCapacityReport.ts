/**
 * Asking the server for a Commercial & Industrial Capacity Report.
 *
 * One function behind every button that produces this document, so the two
 * surfaces that offer it — the assessment's results step and the row action on
 * the assessments list — cannot drift into asking for different things.
 *
 * ## No legacy fallback, on purpose
 *
 * The Snapshot's equivalent carries one, because that format had five shipping
 * in-browser generators and merging the server path before deploying the route
 * would have broken every download button in the product
 * (`docs/reports/BORROWING_CAPACITY.md` §10).
 *
 * This format has no such generator. What it replaces is `window.print()` on a
 * print-styled results screen — not a document, a screenshot of an application
 * — and falling back to that would hand a client a page with the app's
 * navigation chrome in it under the name of a finance report. A missing
 * function is an error here, and it says which two deployment steps are
 * outstanding.
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';

export interface CapacityReportRequest {
  assessmentId: string;
  /** Defaults to true; `false` renders without the model-authored analysis. */
  includeAnalysis?: boolean;
  /** Discard any stored analysis and write a new one. */
  refreshAnalysis?: boolean;
  edition?: string | null;
}

export interface CapacityReportResult {
  url: string;
  fileName: string;
  bytes: number;
  pageCount: number | null;
  /** What the tenant's brand snapshot was missing. Empty for a complete one. */
  brandGaps: string[];
  hasAnalysis: boolean;
  /** Why there is no analysis, when one was asked for and there is none. */
  analysisNote: string | null;
}

/**
 * A render can take a while: nine sections, a model call and WeasyPrint.
 *
 * Three minutes is the ceiling the Snapshot's caller uses, and it is generous
 * on purpose — a timeout that fires while the server is still working produces
 * a document nobody collects and a user who tries again.
 */
const TIMEOUT_MS = 180_000;

const NOT_DEPLOYED = [
  'function not found',
  'requested function',
  'does not exist',
  'failed to send a request',
  // `secureInvoke` reports an aborted fetch as "Network/CORS error calling
  // <fn>". For a function the gateway has never heard of, that is exactly what
  // the browser sees — a 404 with no CORS headers — and it is the message the
  // first production click on Generate report actually produced. A deployed
  // function that errors returns a readable status instead, so this needle
  // does not swallow real failures.
  'network/cors',
];

/**
 * Request the document.
 *
 * Throws on failure, with the server's own message where there is one. The
 * caller decides how to show it; every message this route produces is written
 * to be shown to a user.
 */
export async function requestCapacityReport(
  request: CapacityReportRequest,
): Promise<CapacityReportResult> {
  const { data, error } = await invokeSecureFunction('render-commercial-capacity-pdf', {
    assessmentId: request.assessmentId,
    includeAnalysis: request.includeAnalysis !== false,
    refreshAnalysis: request.refreshAnalysis === true,
    edition: request.edition ?? null,
  }, { timeoutMs: TIMEOUT_MS });

  if (!error && data?.url) {
    return {
      url: String(data.url),
      fileName: String(data.fileName ?? 'Commercial_Capacity_Report.pdf'),
      bytes: Number(data.bytes ?? 0),
      pageCount: Number.isFinite(data.pageCount) ? Number(data.pageCount) : null,
      brandGaps: Array.isArray(data.brandGaps) ? data.brandGaps.map(String) : [],
      hasAnalysis: data.hasAnalysis === true,
      analysisNote: typeof data.analysisNote === 'string' ? data.analysisNote : null,
    };
  }

  const message = (error?.message || '').toLowerCase();
  if (NOT_DEPLOYED.some((needle) => message.includes(needle))) {
    throw new Error(
      'The report service is not deployed yet. Deploy render-commercial-capacity-pdf '
      + 'and apply migration 20260817000000, then try again.',
    );
  }

  throw new Error(error?.message || 'Could not generate the capacity report.');
}

/**
 * Fetch the signed URL and hand the bytes to the browser.
 *
 * Fetched rather than navigated to, for two reasons. A signed URL in the
 * address bar is a signed URL in history and in whatever a screen-share
 * captures; and a link the browser follows takes its filename from the storage
 * path, which carries a uuid segment. This keeps the name the server chose.
 */
export async function downloadCapacityReport(result: CapacityReportResult): Promise<void> {
  const response = await fetch(result.url);
  if (!response.ok) throw new Error('The report could not be downloaded.');

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = result.fileName;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Revoked in a `finally`: an object URL that is never revoked holds the
    // whole PDF in memory for the life of the document.
    URL.revokeObjectURL(objectUrl);
  }
}
