/**
 * The shape of a render request and what comes back.
 *
 * Everything testable about the route lives here: what a caller may send, what
 * the file is called, and where it lands. The edge function around it does auth,
 * three reads, a render, an upload and two writes, none of which a unit test can
 * reach.
 *
 * The filename is a contract. `CashFlowAnalysisModal` has been producing
 * `Cash_Flow_Analysis_<Address>.pdf` since this export existed; a migration that
 * quietly renames it renames it in the client's downloads folder too, so the
 * pattern below is the existing one with the date appended rather than a new
 * one.
 */

/** Only these are accepted from the caller; everything else is read server-side. */
export interface CashFlowRenderRequest {
  /** The `investment_reports` row this projection is for. */
  reportId: string;
  /**
   * The projection itself, unvalidated.
   *
   * `normalise.pure.ts` is what decides whether it is a projection; this only
   * establishes that something was sent. Keeping the two apart means the shape
   * check and the request check fail with different messages.
   */
  projection: unknown;
  /** `VOL. 2026 · ED. 08`. Cosmetic; the caller may supply it. */
  edition: string | null;
}

export type RequestParse =
  | { ok: true; request: CashFlowRenderRequest }
  | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Read a request body.
 *
 * The property address and the client name are deliberately **not** inputs.
 * They are read from the `investment_reports` and `clients` rows, because a
 * name the caller supplies is a name the caller can change — and the address on
 * a financial projection is not a display preference.
 */
export function parseRenderRequest(body: unknown): RequestParse {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid json' };
  const b = body as Record<string, unknown>;

  const reportId = typeof b.reportId === 'string' ? b.reportId.trim() : '';
  if (!UUID.test(reportId)) return { ok: false, error: 'reportId must be a uuid' };

  if (!b.projection || typeof b.projection !== 'object') {
    return { ok: false, error: 'projection is required' };
  }

  const edition = typeof b.edition === 'string' ? b.edition.trim().slice(0, 40) : '';

  return { ok: true, request: { reportId, projection: b.projection, edition: edition || null } };
}

/**
 * The filename, keeping the shape the product already produces.
 *
 * `[^a-zA-Z0-9]` → `_` is the existing rule from `CashFlowAnalysisModal`, kept
 * exactly, with the date appended so a client who receives two revisions of the
 * same property can tell them apart in their downloads folder.
 */
export function cashFlowFileName(propertyAddress: string, isoDate: string): string {
  const safe = (propertyAddress || 'Property').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 80);
  const date = /^\d{4}-\d{2}-\d{2}/.exec(isoDate)?.[0] ?? '';
  return `Cash_Flow_Analysis_${safe}_${date}.pdf`;
}

/**
 * Where the file lands.
 *
 * Under the report's own prefix in `client-files`, the same bucket and the same
 * access rule as every other generated client document. The random segment is
 * not decoration: without it a second render on the same day either overwrites
 * the first or needs `upsert`, and overwriting a document a client may already
 * have a link to is not a thing to do quietly.
 */
export function cashFlowStoragePath(
  reportId: string,
  fileName: string,
  isoDate: string,
  uniqueId: string,
): string {
  const day = /^\d{4}-\d{2}-\d{2}/.exec(isoDate)?.[0] ?? 'undated';
  return `cash-flow/${reportId}/${day}/${uniqueId}-${fileName}`;
}

/** How long a returned link lives. Long enough to email, short enough to expire. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24;

export interface CashFlowRenderResponse {
  url: string;
  /**
   * Where the PDF was stored, in `client-files` — the same bytes the signed
   * `url` serves. A caller that puts the document in front of a client points
   * the portal at THIS object rather than uploading a second copy of it; the
   * portal signs `client-files` first, then `investment-reports` (RS-5c.2).
   */
  path: string;
  fileName: string;
  bytes: number;
  pageCount: number | null;
  renderId: string | null;
  brandSnapshotId: string | null;
  /** What the brand snapshot was missing, so the UI can say so before sending. */
  brandGaps: string[];
  durationMs: number;
}
