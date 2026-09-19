/**
 * The shape of a render request and what comes back.
 *
 * Everything testable about the route lives here: what a caller may send, what
 * the file is called, and where it lands. The edge function around it does auth,
 * four reads, a render, an upload and two writes, none of which a unit test can
 * reach.
 */
import { MAX_COMPARED_PROPERTIES, MIN_COMPARED_PROPERTIES } from './payload.pure.ts';

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
    },
  };
}

/**
 * The filename.
 *
 * There is no single address to name it after, and a date alone does not
 * separate two comparisons run on the same day — which is the normal case, since
 * the whole point of the screen is to try different peer sets. So the primary
 * report's reference is appended, and it is the same reference printed on the
 * cover foot, which makes "which PDF is this?" answerable from either end.
 *
 * **This diverges from the legacy filename**, which is
 * `cash-flow-comparison-5-properties-2026-08-02.pdf`
 * (`CashFlowAnalysisModal.tsx:1922`) — lowercase, hyphenated, no reference. That
 * generator is the only one in the suite producing that shape; every other
 * migrated format uses `Title_Case_With_Underscores`, and two files in a
 * client's downloads folder differing only in case is a support ticket. The
 * divergence is deliberate and recorded in the contract document.
 */
export function comparisonFileName(propertyCount: number, isoDate: string, reference: string): string {
  const date = /^\d{4}-\d{2}-\d{2}/.exec(isoDate)?.[0] ?? '';
  const ref = (reference || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
  const plural = propertyCount === 1 ? 'Property' : 'Properties';
  return `Cash_Flow_Comparison_${propertyCount}_${plural}_${date}_${ref}.pdf`;
}

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
  return `cash-flow-comparison/${primaryReportId}/${day}/${uniqueId}-${fileName}`;
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
}
