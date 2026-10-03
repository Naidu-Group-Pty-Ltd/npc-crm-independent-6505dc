/**
 * The shape of a render request and what comes back.
 *
 * Everything testable about the route lives here: what a caller may send, what
 * the file is called, and where it lands. The edge function around it does auth,
 * four reads, a render, an upload and two writes, none of which a unit test can
 * reach.
 */
import {
  readTemplateDesignReference,
  type DesignEcho,
  type TemplateDesignReference,
} from '../../reportDesign/templateDesign.pure.ts';
import { MAX_COMPARED_PROPERTIES, MIN_COMPARED_PROPERTIES } from './payload.pure.ts';
import { joinPlaces, readableFileName, storageSafeFileName } from '../readableFileName.pure.ts';

/** One property, as the caller sends it. */
export interface ComparisonRequestProperty {
  /** The `investment_reports` row. Everything else about it is read server-side. */
  reportId: string;
  /**
   * That property's projection, unvalidated.
   *
   * `normalise.pure.ts` decides whether it is a projection; this only
   * establishes that something was sent. Keeping the two apart means the shape
   * check and the request check fail with different messages.
   */
  projection: unknown;
}

/** Only these are accepted from the caller; everything else is read server-side. */
export interface ComparisonRenderRequest {
  /** The report the adviser had open. Names the file and the storage prefix. */
  primaryReportId: string;
  /** In display order, the primary included. */
  properties: ComparisonRequestProperty[];
  /** `growth` | `income` | `balanced`. Cosmetic to the arithmetic, not to the prose. */
  investorProfile: string | null;
  /** The model's analysis, when the adviser generated one. Often absent. */
  analysis: unknown;
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

/**
 * Read a request body.
 *
 * Addresses and the client name are deliberately **not** inputs. They are read
 * from `investment_reports` and `clients`, because a name the caller supplies is
 * a name the caller can change — and the label on a column of someone's
 * financial projection is not a display preference.
 *
 * The primary must be one of the properties. A request naming a primary that is
 * not in the set would produce a document filed under a report it does not
 * contain, which is a storage path and a filename that both lie.
 */
export function parseRenderRequest(body: unknown): RequestParse {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid json' };
  const b = body as Record<string, unknown>;

  const primaryReportId = typeof b.primaryReportId === 'string' ? b.primaryReportId.trim() : '';
  if (!UUID.test(primaryReportId)) return { ok: false, error: 'primaryReportId must be a uuid' };

  if (!Array.isArray(b.properties)) return { ok: false, error: 'properties must be an array' };
  if (b.properties.length < MIN_COMPARED_PROPERTIES) {
    return {
      ok: false,
      error: `a comparison needs at least ${MIN_COMPARED_PROPERTIES} properties, got ${b.properties.length}`,
    };
  }
  if (b.properties.length > MAX_COMPARED_PROPERTIES) {
    return {
      ok: false,
      error: `a comparison accepts at most ${MAX_COMPARED_PROPERTIES} properties, got ${b.properties.length}`,
    };
  }

  const properties: ComparisonRequestProperty[] = [];
  for (let i = 0; i < b.properties.length; i += 1) {
    const raw = b.properties[i];
    if (!raw || typeof raw !== 'object') {
      return { ok: false, error: `properties[${i}] must be an object` };
    }
    const entry = raw as Record<string, unknown>;
    const reportId = typeof entry.reportId === 'string' ? entry.reportId.trim() : '';
    if (!UUID.test(reportId)) return { ok: false, error: `properties[${i}].reportId must be a uuid` };
    if (!entry.projection || typeof entry.projection !== 'object') {
      return { ok: false, error: `properties[${i}].projection is required` };
    }
    properties.push({ reportId, projection: entry.projection });
  }

  if (!properties.some((x) => x.reportId === primaryReportId)) {
    return { ok: false, error: 'primaryReportId must name one of the properties' };
  }

  const investorProfile = typeof b.investorProfile === 'string'
    ? b.investorProfile.trim().slice(0, 40)
    : '';
  const edition = typeof b.edition === 'string' ? b.edition.trim().slice(0, 40) : '';
  // A design is optional, and a malformed one is refused rather than ignored,
  // so a caller that meant to ask for one is told it did not get it.
  const design = readTemplateDesignReference(b.design);
  if (design.ok === false) return { ok: false, error: design.error };

  return {
    ok: true,
    request: {
      primaryReportId,
      properties,
      investorProfile: investorProfile || null,
      // Absent, null and a non-object all mean the same thing: the adviser did
      // not generate one. `toAnalysis` returns null for each.
      analysis: b.analysis ?? null,
      edition: edition || null,
      design: design.reference,
    },
  };
}

/**
 * The filename: `Cash Flow Comparison - <the properties> - 28 Sep 2026.pdf`.
 *
 * It was `Cash_Flow_Comparison_3_Properties_2026-09-28_1A2B3C4D.pdf` — a count
 * and a hash, which says nothing about which comparison it is. The properties
 * are the subject, so they are the topic (`readableFileName.pure.ts`); two
 * renders on one day never collide in storage, because the key carries a random
 * segment, and the reference is still on the cover foot.
 */
export function comparisonFileName(
  shortAddresses: readonly string[],
  isoDate: string,
  qualifier?: string | null,
): string {
  return readableFileName({
    name: 'Cash Flow Comparison',
    qualifier: qualifier ?? null,
    topic: joinPlaces(shortAddresses),
    isoDate,
  });
}

/**
 * The same name for the downloads the modal draws itself, qualified so none is
 * mistaken for the typeset document: `… - legacy layout - …`, and the written
 * analysis on its own. They saved as
 * `cash-flow-comparison-3-properties-2026-10-01.pdf` and
 * `ai-cash-flow-analysis-2026-10-01.pdf`, which say neither which comparison nor
 * which document (Audit 8, as the 10 Year Cash Flow's own did in Audit 7).
 *
 * There is no "flattened" qualifier on purpose: the flatten button names its
 * copy itself (`withFlattenedSuffix`), so a flattened download is given the name
 * of the document it flattens and nothing more.
 */
export const COMPARISON_LEGACY_QUALIFIER = 'legacy layout';
export const COMPARISON_ANALYSIS_QUALIFIER = 'written analysis';

/** The first eight characters of the primary report's id, uppercased. */
export function comparisonReference(primaryReportId: string): string {
  return primaryReportId.slice(0, 8).toUpperCase();
}

/**
 * Where the file lands.
 *
 * Keyed by the **primary report**, never by a client. The properties in a
 * comparison may belong to different clients, so a client-derived prefix would
 * either be wrong or scatter one comparison's renders across prefixes as the
 * peer set changed. The random segment stops a second render overwriting a file
 * someone already holds a link to.
 */
export function comparisonStoragePath(
  primaryReportId: string,
  fileName: string,
  isoDate: string,
  uniqueId: string,
): string {
  const day = /^\d{4}-\d{2}-\d{2}/.exec(isoDate)?.[0] ?? 'undated';
  // The readable name is what a person is handed; the key keeps to characters
  // no URL encoder rewrites.
  return `cash-flow-comparison/${primaryReportId}/${day}/${uniqueId}-${storageSafeFileName(fileName)}`;
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
  /** How many properties the document actually compared. */
  propertyCount: number;
  /** False when the adviser had generated no analysis. The common case. */
  hasAnalysis: boolean;
  /** Which of the eight model sections did not arrive. Empty with no analysis. */
  missingSections: string[];
  durationMs: number;
  /**
   * The design the document was drawn in, or why the one asked for was not
   * used — in that case the document is the standard design. Null when none
   * was asked for.
   */
  design: DesignEcho | null;
}
