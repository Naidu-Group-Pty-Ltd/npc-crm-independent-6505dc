/**
 * The shape of a render request and what comes back.
 *
 * Everything testable about the route lives here: what a caller may send, what
 * the file is called, and where it lands. The edge function around it does auth,
 * three reads, a render, an upload and two writes, none of which a unit test can
 * reach.
 *
 * The filename is a contract, and it changed once, on purpose: from
 * `Cash_Flow_Analysis_<Address>_<YYYY-MM-DD>.pdf` to the readable name every
 * other report now carries (`readableFileName.pure.ts`) — `10 Year Cash Flow
 * Analysis - 37 Bolin Street, Schofields NSW 2762 - 01 Oct 2026.pdf` (Audit 7,
 * 1 Oct 2026). The storage key stays URL-safe (`storageSafeFileName`).
 */
import {
  readTemplateDesignReference,
  type DesignEcho,
  type TemplateDesignReference,
} from '../../reportDesign/templateDesign.pure.ts';
import { REPORT_ARCHETYPES } from '../../reportDesign/structure.pure.ts';
import { readableFileName, storageSafeFileName } from '../readableFileName.pure.ts';

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
  /**
   * The design to draw the document in (`templateDesign.pure.ts`): a catalogue
   * design or a template row, or null for the standard design. The words,
   * figures and pages are the report's own whatever is named here.
   */
  design: TemplateDesignReference | null;
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
  // A design is optional, and a malformed one is refused rather than ignored,
  // so a caller that meant to ask for one is told it did not get it.
  const design = readTemplateDesignReference(b.design);
  if (design.ok === false) return { ok: false, error: design.error };

  return {
    ok: true,
    request: { reportId, projection: b.projection, edition: edition || null, design: design.reference },
  };
}

/**
 * The filename: what the document is, the property it is about, and the day.
 *
 * `<document>[ - <qualifier>] - <address> - <date>.pdf`, the rule every
 * report's download now follows. The date still tells two revisions of one
 * property apart in a client's downloads folder; it is the day as a reader
 * says it. The qualifier names a copy that is not the typeset document — the
 * browser's "legacy layout" — so the two never share a name in one folder. A
 * flattened copy is named by the flatten button itself (`withFlattenedSuffix`
 * adds the word), so it is handed the name of what it flattens and no more:
 * passing "flattened" here as well printed the word twice.
 */
export function cashFlowFileName(propertyAddress: string, isoDate: string, qualifier?: string | null): string {
  return readableFileName({
    name: REPORT_ARCHETYPES['cash-flow-projection'].documentName,
    qualifier: qualifier ?? null,
    topic: propertyAddress || null,
    isoDate,
  });
}

/** The same name for the workbook beside it, which the modal exports. */
export function cashFlowWorkbookFileName(propertyAddress: string, isoDate: string): string {
  return readableFileName({
    name: REPORT_ARCHETYPES['cash-flow-projection'].documentName,
    topic: propertyAddress || null,
    isoDate,
    extension: 'xlsx',
  });
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
  return `cash-flow/${reportId}/${day}/${uniqueId}-${storageSafeFileName(fileName)}`;
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
  /**
   * The design the document was drawn in, or why the one asked for was not
   * used — in that case the document is the standard design. Null when none
   * was asked for.
   */
  design: DesignEcho | null;
}
