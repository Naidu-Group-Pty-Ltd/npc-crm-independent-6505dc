/**
 * The shape of a render request and what comes back.
 *
 * Everything testable about the route lives here: what a caller may send, what
 * the file is called, and where it lands. The edge function around it does auth,
 * four reads, a render, an upload and two writes, none of which a unit test can
 * reach.
 *
 * ## The caller sends an id and nothing else
 *
 * Unlike the Cash Flow route, which has to accept a projection because the
 * browser holds unsaved overrides, everything this document says is already
 * persisted. So the request is one identifier, and the route reads the rest.
 * A caller cannot choose the client's name, the figures, or which review is
 * folded in.
 *
 * ## The filename is a contract
 *
 * `PortfolioAnalysisPDFGenerator` has been producing
 * `Portfolio_Analysis_<Client>.pdf` since the format existed, and clients have
 * those files in their downloads folders. The pattern below is that one with the
 * date appended, not a new one.
 */
import {
  readTemplateDesignReference,
  type DesignEcho,
  type TemplateDesignReference,
} from '../../reportDesign/templateDesign.pure.ts';

/** Only this is accepted from the caller; everything else is read server-side. */
export interface PortfolioRenderRequest {
  /** The `portfolio_analysis_reports` row to typeset. */
  reportId: string;
  /**
   * Fold in the client's most recent completed review, when one exists.
   *
   * Default true. A caller may turn it off to reproduce the document as the
   * analysis alone described it — the review is a later, separate assessment
   * and its figures differ, which the review section says on the page.
   */
  includeReview: boolean;
  /** `VOL. 2026 · ED. 08`. Cosmetic; the caller may supply it. */
  edition: string | null;
  /**
   * The design to draw the document in (`templateDesign.pure.ts`): a catalogue
   * design or a template row, or null for the standard design. The words,
   * figures and pages are the report's own whatever is named here.
   */
  design: TemplateDesignReference | null;
}

export type RequestParse =
  | { ok: true; request: PortfolioRenderRequest }
  | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Read a request body.
 *
 * The client's name is deliberately not an input. It is read from `clients`,
 * because a name the caller supplies is a name the caller can change — and this
 * document is addressed to a person about their own money.
 */
export function parseRenderRequest(body: unknown): RequestParse {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid json' };
  const b = body as Record<string, unknown>;

  const reportId = typeof b.reportId === 'string' ? b.reportId.trim() : '';
  if (!UUID.test(reportId)) return { ok: false, error: 'reportId must be a uuid' };

  const edition = typeof b.edition === 'string' ? b.edition.trim().slice(0, 40) : '';
  // A design is optional, and a malformed one is refused rather than ignored,
  // so a caller that meant to ask for one is told it did not get it.
  const design = readTemplateDesignReference(b.design);
  if (design.ok === false) return { ok: false, error: design.error };

  return {
    ok: true,
    request: {
      reportId,
      // Absent means yes. The richer document is the one someone asking for a
      // portfolio review wants, and a caller who wants the thinner one says so.
      includeReview: b.includeReview !== false,
      edition: edition || null,
      design: design.reference,
    },
  };
}

/**
 * The filename, keeping the shape the product already produces.
 *
 * `[^a-zA-Z0-9]` → `_` is the existing rule from `PortfolioAnalysisPDFGenerator`,
 * kept exactly, with the date appended so a client who receives two reviews can
 * tell them apart.
 */
export function portfolioFileName(clientName: string, isoDate: string): string {
  const safe = (clientName || 'Client').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 80);
  const date = /^\d{4}-\d{2}-\d{2}/.exec(isoDate)?.[0] ?? '';
  return `Portfolio_Analysis_${safe}_${date}.pdf`;
}

/**
 * Where the file lands.
 *
 * Under `portfolio-reports/<clientId>/` in `client-files` — the prefix the
 * legacy generator already writes to, so the two paths' output sits together
 * under one storage rule rather than under two.
 *
 * The random segment is not decoration: without it a second render on the same
 * day either overwrites the first or needs `upsert`, and overwriting a document
 * a client may already have a link to is not a thing to do quietly. It is also
 * what keeps this route away from the legacy's own filenames — nothing written
 * here can collide with a file `pdf_file_path` points at.
 */
export function portfolioStoragePath(
  clientId: string,
  fileName: string,
  isoDate: string,
  uniqueId: string,
): string {
  const day = /^\d{4}-\d{2}-\d{2}/.exec(isoDate)?.[0] ?? 'undated';
  return `portfolio-reports/${clientId}/typeset/${day}/${uniqueId}-${fileName}`;
}

/** How long a returned link lives. Long enough to email, short enough to expire. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24;

export interface PortfolioRenderResponse {
  url: string;
  /**
   * Where the PDF was stored, in `client-files` — the same bytes the signed
   * `url` serves. A caller that puts the document in front of a client points
   * the portal at THIS object rather than uploading a second copy of it; the
   * portal signs `client-files` first, then `investment-reports` (RS-5c.3).
   */
  path: string;
  fileName: string;
  bytes: number;
  pageCount: number | null;
  renderId: string | null;
  brandSnapshotId: string | null;
  /** What the brand snapshot was missing, so the UI can say so before sending. */
  brandGaps: string[];
  /** Whether a review was folded in. The UI says which document it just made. */
  reviewIncluded: boolean;
  durationMs: number;
  /**
   * The design the document was drawn in, or why the one asked for was not
   * used — in that case the document is the standard design. Null when none
   * was asked for.
   */
  design: DesignEcho | null;
}
