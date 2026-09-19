/**
 * The shape of a render request and what comes back.
 *
 * Everything testable about the route lives here: what a caller may send, what
 * the file is called, and where it lands. The edge function around it does auth,
 * nine reads, a render, an upload and two writes, none of which a unit test can
 * reach.
 *
 * The request is one id. That is the whole difference between this format and
 * the cash flow ones: every figure in this document is a persisted row, so
 * there is nothing for the browser to send and nothing for it to get wrong.
 */

/** Only these are accepted from the caller; everything else is read server-side. */
export interface ClientDetailsRenderRequest {
  /** The `clients` row to typeset. */
  clientId: string;
  /** `VOL. 2026 · ED. 08`. Cosmetic; the caller may supply it. */
  edition: string | null;
}

export type RequestParse =
  | { ok: true; request: ClientDetailsRenderRequest }
  | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Read a request body.
 *
 * The client's name, address and every figure are deliberately **not** inputs.
 * They are read from the nine tables, because a name the caller supplies is a
 * name the caller can change — and this document is a record of what the
 * business holds about a person, not a rendering of what a browser believes.
 */
export function parseRenderRequest(body: unknown): RequestParse {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid json' };
  const b = body as Record<string, unknown>;

  const clientId = typeof b.clientId === 'string' ? b.clientId.trim() : '';
  if (!UUID.test(clientId)) return { ok: false, error: 'clientId must be a uuid' };

  const edition = typeof b.edition === 'string' ? b.edition.trim().slice(0, 40) : '';

  return { ok: true, request: { clientId, edition: edition || null } };
}

/**
 * The filename.
 *
 * **A deliberate divergence from the legacy**, which produces
 * `Formara_Form_<Name>_<date>.pdf` (`FormaraPDFGenerator.tsx:783`). "Formara" is
 * a vendor's name for a broker form standard; it appears nowhere on the document
 * and means nothing to the client or the broker who receives it. Every other
 * migrated format names the file after what it is, and this one now does too.
 *
 * The existing `[^a-zA-Z0-9] → _` rule is kept exactly, so the two files sort
 * together in a downloads folder and neither is mistaken for the other.
 */
export function clientDetailsFileName(clientName: string, isoDate: string): string {
  const safe = (clientName || 'Client').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 80);
  const date = /^\d{4}-\d{2}-\d{2}/.exec(isoDate)?.[0] ?? '';
  return `Client_Details_${safe}_${date}.pdf`;
}

/** The first eight characters of the client's id, uppercased, for the cover foot. */
export function clientDetailsReference(clientId: string): string {
  return clientId.slice(0, 8).toUpperCase();
}

/**
 * Where the file lands.
 *
 * Under the client's own prefix in `client-files` — the same bucket and access
 * rule as every other generated client document. The random segment is not
 * decoration: without it a second render on the same day either overwrites the
 * first or needs `upsert`, and overwriting a document a broker may already hold
 * a link to is not a thing to do quietly.
 */
export function clientDetailsStoragePath(
  clientId: string,
  fileName: string,
  isoDate: string,
  uniqueId: string,
): string {
  const day = /^\d{4}-\d{2}-\d{2}/.exec(isoDate)?.[0] ?? 'undated';
  return `client-details/${clientId}/${day}/${uniqueId}-${fileName}`;
}

/** How long a returned link lives. Long enough to email, short enough to expire. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24;

export interface ClientDetailsRenderResponse {
  url: string;
  fileName: string;
  bytes: number;
  pageCount: number | null;
  renderId: string | null;
  brandSnapshotId: string | null;
  /** What the brand snapshot was missing, so the UI can say so before sending. */
  brandGaps: string[];
  /** Which sections the record had content for. Empty is impossible. */
  sections: string[];
  /** How many holdings the portfolio sections covered. Routinely zero. */
  propertyCount: number;
  durationMs: number;
}
