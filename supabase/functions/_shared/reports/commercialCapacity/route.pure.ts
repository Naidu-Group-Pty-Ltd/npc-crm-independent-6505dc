/**
 * The shape of a render request and what comes back.
 *
 * Pure, which is the point: the edge function around it does auth, five reads,
 * a model call, a render, an upload and two writes, and none of that is
 * testable in a unit test. Request validation, the filename a user sees and the
 * path a file lands at are testable, and they are the parts with a contract to
 * keep.
 */

/**
 * Only these are accepted from the caller. Everything else is read server-side.
 *
 * There is no `clientName`, no `capacity` and no `html` here, deliberately —
 * the same decision `render-borrowing-capacity-pdf` rests on. For a document
 * that states what a borrower can borrow, the contents are not the browser's to
 * decide, and a test asserts the route ignores those fields if they are sent.
 */
export interface CapacityRenderRequest {
  assessmentId: string;
  /**
   * Whether to generate an AI analysis section when the assessment has none.
   *
   * Defaults to true. `false` renders the document without the analysis, which
   * is the right answer for a re-render where the caller does not want to spend
   * a model call — and for anyone who would rather the document contained no
   * model-authored prose at all.
   */
  includeAnalysis: boolean;
  /**
   * Discard any stored analysis and write a new one.
   *
   * The stored analysis is reused by default, so re-rendering the same
   * assessment is free and produces the same document twice. This is the
   * explicit opt-out for an adviser who wants a second reading.
   */
  refreshAnalysis: boolean;
  /** `VOL. 2026 · ED. 08`. Cosmetic; the caller may supply it. */
  edition: string | null;
}

export type RequestParse =
  | { ok: true; request: CapacityRenderRequest }
  | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseCapacityRequest(body: unknown): RequestParse {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid json' };
  const b = body as Record<string, unknown>;

  const assessmentId = typeof b.assessmentId === 'string' ? b.assessmentId.trim() : '';
  if (!UUID.test(assessmentId)) return { ok: false, error: 'assessmentId must be a uuid' };

  const edition = typeof b.edition === 'string' ? b.edition.trim().slice(0, 40) : '';

  return {
    ok: true,
    request: {
      assessmentId,
      // Absent means yes. A caller that says nothing about the analysis gets the
      // complete document; only an explicit `false` turns it off.
      includeAnalysis: b.includeAnalysis !== false,
      refreshAnalysis: b.refreshAnalysis === true,
      edition: edition || null,
    },
  };
}

/**
 * The filename.
 *
 * Built from the assessment's own reference rather than from a client name,
 * because this document's subject may be a standalone assessment with no client
 * attached — and a folder of `Commercial_Capacity_Report_Client_2026-08-05.pdf`
 * files that are all different assessments is a folder nobody can use.
 *
 * `[^a-zA-Z0-9]` → `_` is the rule the Snapshot's filename uses, kept
 * deliberately so the two documents sort together in a downloads folder.
 */
export function capacityFileName(reference: string, isoDate: string): string {
  const safe = (reference || 'Assessment').replace(/[^a-zA-Z0-9]/g, '_');
  const date = /^\d{4}-\d{2}-\d{2}/.exec(isoDate)?.[0] ?? '';
  return `Commercial_Capacity_Report_${safe}_${date}.pdf`;
}

/**
 * Where the file lands.
 *
 * Under the assessment's own prefix. The random segment is not decoration:
 * without it a second render on the same day either overwrites the first or
 * needs `upsert`, and overwriting a document somebody may already hold a link
 * to is not a thing to do quietly.
 */
export function capacityStoragePath(
  assessmentId: string,
  fileName: string,
  isoDate: string,
  uniqueId: string,
): string {
  const day = /^\d{4}-\d{2}-\d{2}/.exec(isoDate)?.[0] ?? 'undated';
  return `commercial-capacity/${assessmentId}/${day}/${uniqueId}-${fileName}`;
}

/** How long a returned link lives. Long enough to email, short enough to expire. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24;

/**
 * Statuses a report may be generated from.
 *
 * The product's rule, enforced server-side rather than only in the UI: a report
 * is generated from a **completed** assessment's saved calculation run, so it
 * reflects the engine and policy versions in force when the figures were
 * produced. A draft's figures change under the reader's feet, and a PDF of them
 * is a document that was never true for longer than a moment.
 *
 * `linked` is the status a completed assessment moves to once it is attached to
 * a client. It is completion plus a client, not a step before it.
 */
export const REPORTABLE_STATUSES: readonly string[] = ['completed', 'linked'];

export function isReportable(status: unknown): boolean {
  return typeof status === 'string' && REPORTABLE_STATUSES.includes(status);
}

export interface CapacityRenderResponse {
  url: string;
  fileName: string;
  bytes: number;
  pageCount: number | null;
  renderId: string | null;
  brandSnapshotId: string | null;
  /** What the tenant's brand snapshot was missing. Empty for a complete one. */
  brandGaps: string[];
  /** Whether the document carries a model-authored analysis section. */
  hasAnalysis: boolean;
  /**
   * Why it does not, when it does not and one was asked for.
   *
   * Returned rather than only logged: "the analysis is missing" is a question
   * somebody asks at the moment they are about to send the document, and
   * "the model was unavailable" and "you turned it off" are different answers.
   */
  analysisNote: string | null;
  durationMs: number;
}
