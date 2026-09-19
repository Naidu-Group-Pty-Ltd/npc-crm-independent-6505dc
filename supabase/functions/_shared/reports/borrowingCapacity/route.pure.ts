/**
 * The shape of a render request and what comes back.
 *
 * Everything here is pure, which is the point: the edge function around it does
 * auth, four reads, a render, an upload and two writes, and none of that is
 * testable in a unit test. Request validation, the filename a client sees and
 * the path a file lands at are testable, and they are the parts that have a
 * contract to keep.
 *
 * The filename is that contract. `ClientReportsTab.tsx` publishes the Snapshot
 * to the client portal and four call sites download it, all under
 * `Borrowing_Capacity_Snapshot_<SafeName>_<date>.pdf` today
 * (`BORROWING_CAPACITY.md` §5). A migration that quietly renames the file
 * renames it in the client's downloads folder too.
 */

/** Only these are accepted from the caller; everything else is read server-side. */
export interface SnapshotRenderRequest {
  clientId: string;
  /** Omit for the most recent assessment. */
  assessmentId: string | null;
  /** Saved what-if presets, when the export came from the scenario modeller. */
  scenarioPresets: unknown[];
  /** `VOL. 2026 · ED. 08`. Cosmetic; the caller may supply it. */
  edition: string | null;
}

export type RequestParse =
  | { ok: true; request: SnapshotRenderRequest }
  | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Read a request body.
 *
 * The client name is deliberately **not** an input. It is read from the
 * `clients` row, because a name the caller supplies is a name the caller can
 * change — and the name on a lending document is not a display preference.
 */
export function parseRenderRequest(body: unknown): RequestParse {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid json' };
  const b = body as Record<string, unknown>;

  const clientId = typeof b.clientId === 'string' ? b.clientId.trim() : '';
  if (!UUID.test(clientId)) return { ok: false, error: 'clientId must be a uuid' };

  const rawAssessment = typeof b.assessmentId === 'string' ? b.assessmentId.trim() : '';
  if (rawAssessment && !UUID.test(rawAssessment)) {
    return { ok: false, error: 'assessmentId must be a uuid' };
  }

  const presets = Array.isArray(b.scenarioPresets) ? b.scenarioPresets : [];
  // A cap rather than a rejection: the scenario table is readable at a handful
  // of rows and unreadable at a hundred, and the modeller has no upper bound.
  if (presets.length > MAX_SCENARIO_PRESETS) {
    return { ok: false, error: `at most ${MAX_SCENARIO_PRESETS} scenario presets` };
  }

  const edition = typeof b.edition === 'string' ? b.edition.trim().slice(0, 40) : '';

  return {
    ok: true,
    request: {
      clientId,
      assessmentId: rawAssessment || null,
      scenarioPresets: presets,
      edition: edition || null,
    },
  };
}

export const MAX_SCENARIO_PRESETS = 12;

/**
 * The filename, unchanged from what the product has always produced.
 *
 * `[^a-zA-Z0-9]` → `_` is the existing rule, kept exactly: a client called
 * "A. & J. Sample" has been receiving `A___J__Sample` since this format
 * existed, and "improving" it renames every future file for no one's benefit.
 */
export function snapshotFileName(clientName: string, isoDate: string): string {
  const safeName = (clientName || 'Client').replace(/[^a-zA-Z0-9]/g, '_');
  const date = /^\d{4}-\d{2}-\d{2}/.exec(isoDate)?.[0] ?? '';
  return `Borrowing_Capacity_Snapshot_${safeName}_${date}.pdf`;
}

/**
 * Where the file lands.
 *
 * Under the client's own prefix in `client-files`, which is the bucket the
 * portal publish path already uses for this document — so one document class
 * lives in one place with one access rule, rather than two.
 *
 * The random segment is not decoration: without it a second render on the same
 * day either overwrites the first or needs `upsert`, and overwriting a document
 * a client may already have been sent a link to is not a thing to do quietly.
 */
export function snapshotStoragePath(
  clientId: string,
  fileName: string,
  isoDate: string,
  uniqueId: string,
): string {
  const day = /^\d{4}-\d{2}-\d{2}/.exec(isoDate)?.[0] ?? 'undated';
  return `borrowing-capacity/${clientId}/${day}/${uniqueId}-${fileName}`;
}

/** How long a returned link lives. Long enough to email, short enough to expire. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24;

export interface SnapshotRenderResponse {
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
  /**
   * What the brand snapshot was missing.
   *
   * Returned to the caller rather than only logged, so the UI can say "this
   * report has no ABN on it" at the moment someone is about to send it.
   */
  brandGaps: string[];
  durationMs: number;
}
