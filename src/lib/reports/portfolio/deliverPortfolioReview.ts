/**
 * Getting a Portfolio Performance Review into someone's hands.
 *
 * ## Two variants, and how they differ from the Snapshot's two
 *
 * `deliverSnapshot.ts` offers `server` and `legacy`, where `legacy` *runs* the
 * in-browser generator. This one cannot: `PortfolioAnalysisPDFGenerator` has no
 * importable entry point, so there is no function to call.
 *
 * So the second variant here is the **stored** legacy PDF — the file that
 * generator already produced and left at
 * `portfolio_analysis_reports.pdf_file_path`. Every existing item in the reports
 * list's row menu is `disabled={!report.pdf_file_path}` for exactly this reason,
 * and 7 of the 21 stored reports have no such file, which is why they are
 * un-downloadable today.
 *
 * The `server` variant reads `report_data` rather than the file, so those seven
 * become downloadable for the first time. That is a side effect of doing the
 * work properly rather than the point of it, but it is worth knowing.
 *
 * ## What is deliberately absent
 *
 * No fallback between them, in either direction. Asking for the typeset document
 * and receiving the legacy one — or the reverse — is handing someone a document
 * from a renderer they did not choose. The variant is a choice, and a failure in
 * either says which one failed.
 */
import { secureStorageDownload } from '@/hooks/useSecureStorage';
import { parseStorageRef } from '@/lib/reports/storageRef';
import { tryTemplateDocument } from '@/lib/reportTemplate/templateDocument';
import { requestPortfolioReview, type PortfolioReviewRequest } from './requestPortfolioReview';

/** Which document. */
export type PortfolioVariant = 'server' | 'stored';

export interface DeliverPortfolioInput {
  variant: PortfolioVariant;
  request: PortfolioReviewRequest;
  /**
   * `portfolio_analysis_reports.pdf_file_path`, for the `stored` variant.
   *
   * Passed through `parseStorageRef` rather than used raw: this column holds
   * bare keys, full public URLs, signed URLs and stringified upload results,
   * and handing a URL to `secureStorageDownload` is what made a whole class of
   * report undownloadable elsewhere in this app.
   */
  storedPath?: string | null;
  /** What to call the saved file on the `stored` path. */
  storedFileName?: string;
}

export interface DeliveredPortfolioReview {
  source: PortfolioVariant;
  fileName: string;
  /** What the tenant's brand snapshot was missing. Always empty for `stored`. */
  brandGaps: string[];
  /** Whether a review was folded in. Unknown, so false, for `stored`. */
  reviewIncluded: boolean;
  /** Rendered from an activated template rather than by the flowing route. */
  templated?: boolean;
}

/** The default storage bucket for generated client documents. */
const CLIENT_FILES = 'client-files';

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

/** The file the legacy generator already produced. */
async function deliverStored(input: DeliverPortfolioInput): Promise<DeliveredPortfolioReview> {
  const ref = parseStorageRef(input.storedPath);
  if (!ref.path) {
    throw new Error('This report has no saved PDF. Generate one, or download the typeset review.');
  }

  const result = await secureStorageDownload(
    (ref.bucket || CLIENT_FILES) as never,
    ref.path,
  );
  if (!result.success || !result.blob) {
    throw new Error(result.error || 'Could not download the saved PDF');
  }

  const fileName = input.storedFileName || 'Portfolio_Analysis.pdf';
  saveToBrowser(URL.createObjectURL(result.blob), fileName);
  return { source: 'stored', fileName, brandGaps: [], reviewIncluded: false };
}

/**
 * Produce the review and hand it to the browser.
 *
 * Throws on failure with the message the renderer gave, so a caller can put it
 * in front of the person who pressed the button rather than in a console.
 */
export async function deliverPortfolioReview(
  input: DeliverPortfolioInput,
): Promise<DeliveredPortfolioReview> {
  if (input.variant === 'stored') return deliverStored(input);

  // Not for `stored`, which is a request for one particular file that already
  // exists — this module's own rule is that substituting a document from a
  // renderer the person did not choose is the thing never to do.
  //
  // And not when the caller asked for the analysis without the review: the
  // adapter always joins the client's newest completed review, exactly as this
  // route does by default, so it cannot produce the without-review document.
  if (input.request.includeReview !== false) {
    // The FINAL document: drawn by the pinned engine, never the browser's jsPDF (RS-5c).
    const templated = await tryTemplateDocument('portfolio', input.request.reportId, { renderer: 'weasyprint' });
    if (templated) {
      saveToBrowser(URL.createObjectURL(templated.blob), templated.fileName);
      return {
        source: 'server',
        fileName: templated.fileName,
        brandGaps: [],
        // The adapter performs the join, so the review is in the document.
        reviewIncluded: true,
        templated: true,
      };
    }
  }

  const result = await requestPortfolioReview(input.request);

  // A signed URL. Fetched rather than followed, so the file is *saved* — a PDF
  // that opens in a tab is a PDF the client has to find again.
  const response = await fetch(result.url);
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  saveToBrowser(URL.createObjectURL(await response.blob()), result.fileName);

  return {
    source: 'server',
    fileName: result.fileName,
    brandGaps: result.brandGaps,
    reviewIncluded: result.reviewIncluded,
  };
}

/**
 * The review as bytes — and where they already are — for a caller that
 * publishes rather than saves.
 *
 * `publishReportToPortal` is that caller (audit item 6: a stored analysis
 * whose PDF upload failed in the 403 era has `report_data` and no file, so
 * publishing renders the review from the record). It used to upload the
 * bytes a second time to `client-files/portal-reports/…`; since RS-5c.3 it
 * points the portal at `storagePath` whenever the renderer stored the
 * document, and still never writes `pdf_file_path` — that column is the
 * legacy generator's file, and substituting a document from a renderer the
 * person did not choose is this module's own never.
 */
export async function portfolioReviewBlob(input: DeliverPortfolioInput): Promise<{
  blob: Blob;
  fileName: string;
  source: PortfolioVariant;
  brandGaps: string[];
  /**
   * Where the renderer stored these exact bytes: the templated final's object
   * (`investment-reports`) or the route's (`client-files`). Null for the
   * `stored` variant, which is a file somebody else placed and named.
   */
  storagePath: string | null;
}> {
  if (input.variant === 'stored') {
    const ref = parseStorageRef(input.storedPath);
    if (!ref.path) throw new Error('This report has no saved PDF.');
    const result = await secureStorageDownload((ref.bucket || CLIENT_FILES) as never, ref.path);
    if (!result.success || !result.blob) {
      throw new Error(result.error || 'Could not download the saved PDF');
    }
    return {
      blob: result.blob,
      fileName: input.storedFileName || 'Portfolio_Analysis.pdf',
      source: 'stored',
      brandGaps: [],
      storagePath: null,
    };
  }

  // The same two guards as the download path above.
  if (input.request.includeReview !== false) {
    // The FINAL document: drawn by the pinned engine, never the browser's jsPDF (RS-5c).
    const templated = await tryTemplateDocument('portfolio', input.request.reportId, { renderer: 'weasyprint' });
    if (templated) {
      return {
        blob: templated.blob, fileName: templated.fileName, source: 'server', brandGaps: [],
        storagePath: templated.storagePath,
      };
    }
  }

  const result = await requestPortfolioReview(input.request);
  const response = await fetch(result.url);
  if (!response.ok) throw new Error(`Could not read the rendered document (${response.status})`);
  return {
    blob: await response.blob(),
    fileName: result.fileName,
    source: 'server',
    brandGaps: result.brandGaps,
    // Where `render-portfolio-review-pdf` stored and ledgered these bytes.
    storagePath: result.storagePath,
  };
}
