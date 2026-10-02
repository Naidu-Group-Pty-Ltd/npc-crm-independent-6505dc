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
import {
  readTemplateDesignReference,
  type DesignEcho,
  type TemplateDesignReference,
} from '../../reportDesign/templateDesign.pure.ts';
import { joinPlaces, readableFileName, storageSafeFileName } from '../readableFileName.pure.ts';

/** Only this is accepted from the caller; everything else is read server-side. */
export interface ComparisonRenderRequest {
  /** The `property_comparisons` row to typeset. */
  comparisonId: string;
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
  | { ok: true; request: ComparisonRenderRequest }
  | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseRenderRequest(body: unknown): RequestParse {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid json' };
  const b = body as Record<string, unknown>;

  const comparisonId = typeof b.comparisonId === 'string' ? b.comparisonId.trim() : '';
  if (!UUID.test(comparisonId)) return { ok: false, error: 'comparisonId must be a uuid' };

  const edition = typeof b.edition === 'string' ? b.edition.trim().slice(0, 40) : '';
  // A design is optional, and a malformed one is refused rather than ignored,
  // so a caller that meant to ask for one is told it did not get it.
  const design = readTemplateDesignReference(b.design);
  if (design.ok === false) return { ok: false, error: design.error };

  return { ok: true, request: { comparisonId, edition: edition || null, design: design.reference } };
}

/**
 * The filename: `Property Comparison - <the properties> - 28 Sep 2026.pdf`.
 *
 * It used to be `Property_Comparison_3_Properties_2026-09-28_5B1C0A3E.pdf` — a
 * count and a hash, so two comparisons from one afternoon differed in eight
 * characters nobody could read. A comparison's subject is the properties in it,
 * so they are the topic (`readableFileName.pure.ts`). The reference is still
 * printed on the cover foot, which is where "which PDF is this?" is answered,
 * and two renders on one day still never collide in storage: the key carries a
 * random segment.
 */
export function comparisonFileName(
  shortAddresses: readonly string[],
  isoDate: string,
  qualifier?: string | null,
): string {
  return readableFileName({
    name: COMPARISON_FILE_NAME,
    qualifier: qualifier ?? null,
    topic: joinPlaces(shortAddresses),
    isoDate,
  });
}

/** What the file calls the document. The cover's longer name is the archetype's. */
export const COMPARISON_FILE_NAME = 'Property Comparison';

/**
 * The AI-written report ("Download (legacy layout)") under the same name,
 * qualified so it is never mistaken for the typeset document. It borrows the
 * Investment report's drawer, and so saved as `Investment Compass - <the
 * comparison's title> - 1 Oct 2026.pdf`: another document's name, with the
 * title standing where an address goes, and its flattened copy as
 * `<the title>-flattened.pdf` (Audit 8). Both take this name now, and the
 * flatten button adds its own word.
 */
export const COMPARISON_LEGACY_QUALIFIER = 'legacy layout';

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
  // The readable name is what a person is handed; the key keeps to characters
  // no URL encoder rewrites.
  return `property-comparisons/${comparisonId}/typeset/${day}/${uniqueId}-${storageSafeFileName(fileName)}`;
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
  /**
   * The design the document was drawn in, or why the one asked for was not
   * used — in that case the document is the standard design. Null when none
   * was asked for.
   */
  design: DesignEcho | null;
}
