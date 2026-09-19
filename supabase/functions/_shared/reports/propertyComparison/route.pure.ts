/**
 * The shape of a render request and what comes back.
 *
 * Everything testable about the route lives here: what a caller may send, what
 * the file is called, and where it lands. The edge function around it does auth,
 * four reads, a render, an upload and two writes, none of which a unit test can
 * reach.
 *
 * The caller sends one identifier. Everything the document says is already in the
 * row, so nothing about the contents is the caller's to choose — not the client's
 * name, not the ranking, not which sections appear.
 */

/** Only this is accepted from the caller; everything else is read server-side. */
export interface ComparisonRenderRequest {
  /** The `property_comparisons` row to typeset. */
  comparisonId: string;
  /** `VOL. 2026 · ED. 08`. Cosmetic; the caller may supply it. */
  edition: string | null;
}

export type RequestParse =
  | { ok: true; request: ComparisonRenderRequest }
  | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseRenderRequest(body: unknown): RequestParse {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid json' };
  const b = body as Record<string, unknown>;

  const comparisonId = typeof b.comparisonId === 'string' ? b.comparisonId.trim() : '';
  if (!UUID.test(comparisonId)) return { ok: false, error: 'comparisonId must be a uuid' };

  const edition = typeof b.edition === 'string' ? b.edition.trim().slice(0, 40) : '';

  return { ok: true, request: { comparisonId, edition: edition || null } };
}

/**
 * The filename.
 *
 * A comparison has no single address to name a file after, and the date alone
 * does not separate two comparisons run on the same day — which is normal, since
 * re-running is how someone adjusts the weighting. So the row's own reference
 * goes in the name, and it is the same eight characters printed on the cover
 * foot: "which PDF is this?" is answerable from either end.
 */
export function comparisonFileName(
  propertyCount: number,
  isoDate: string,
  reference: string,
): string {
  const date = /^\d{4}-\d{2}-\d{2}/.exec(isoDate)?.[0] ?? '';
  const ref = (reference || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase();
  const n = Number.isFinite(propertyCount) && propertyCount > 0 ? propertyCount : 0;
  return `Property_Comparison_${n}_Properties_${date}_${ref}.pdf`;
}

/**
 * Where the file lands.
 *
 * Keyed by the **comparison**, never by a client. There is no `client_id` on this
 * table, and the client can only be inferred two hops out through
 * `report_ids → investment_reports → client_properties` — an inference that can
 * change when a property is reassigned. A storage path is a durable identifier,
 * so it is derived from the one thing that cannot move.
 *
 * The random segment is not decoration: without it a second render on the same
 * day either overwrites the first or needs `upsert`, and overwriting a document a
 * client may already have a link to is not a thing to do quietly.
 */
export function comparisonStoragePath(
  comparisonId: string,
  fileName: string,
  isoDate: string,
  uniqueId: string,
): string {
  const day = /^\d{4}-\d{2}-\d{2}/.exec(isoDate)?.[0] ?? 'undated';
  return `property-comparisons/${comparisonId}/typeset/${day}/${uniqueId}-${fileName}`;
}

/** How long a returned link lives. Long enough to email, short enough to expire. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24;

export interface ComparisonRenderResponse {
  url: string;
  fileName: string;
  bytes: number;
  pageCount: number | null;
  renderId: string | null;
  brandSnapshotId: string | null;
  /** What the brand snapshot was missing, so the UI can say so before sending. */
  brandGaps: string[];
  /**
   * False when the source record was truncated and sections are absent.
   *
   * Surfaced at the same moment and for the same reason as `brandGaps`: someone
   * about to email a document to a client should know it is incomplete before
   * they send it, not after.
   */
  recordComplete: boolean;
  /** Which sections the record does not hold. Empty when it is complete. */
  missingSections: string[];
  /** 10 or 100, or null when nothing was scored. */
  scoreScale: number | null;
  durationMs: number;
}
