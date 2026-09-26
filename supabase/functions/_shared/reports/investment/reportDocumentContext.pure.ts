/**
 * The words of the document a report was made from, kept for the whole
 * generation.
 *
 * ## The defect
 *
 * A report made from an uploaded brochure, or from a listing link, carries the
 * document's words into its prompt: the description, the features, what the
 * seller says about the property. Only the FIRST invocation of a generation
 * receives them. They arrive in `propertyDetails`, and a continuation — every
 * invocation after the first, whether the browser, the bulk worker or the cron
 * watchdog makes it — sends `{ reportId, propertyAddress, continueFrom }` and
 * nothing else. A Compass is written across several invocations, so the
 * sections of the first batch were written from the brochure and every section
 * after them was written as though there had been no document at all.
 *
 * ## The rule
 *
 * The first invocation keeps the document context it composed — the words,
 * already bounded the way it bounded them, and what it says about where they
 * came from — and every later invocation of the same report that was handed no
 * document of its own reads the kept copy. So every section is written from the
 * same evidence, and the prompt a continuation composes is the prompt the first
 * invocation composed.
 *
 * Three things keep it safe:
 *
 *  - **A kept copy is used only for the report and the address it was kept
 *    for.** An address that changed is a different property, and a document
 *    about another property is worse than none.
 *  - **Only a record this module wrote is read.** Anything malformed, of an
 *    unknown version, or larger than anything written here is not the kept
 *    copy, and is ignored.
 *  - **Keeping it never fails a report.** A write that cannot be made costs the
 *    later sections the document, which is exactly what they had before.
 *
 * It lives in the private `listing-images` bucket beside the report's other
 * source material (its photographs), under its own prefix, so no migration is
 * needed and nothing that lists a photograph folder ever sees it.
 */

/** The private bucket the report's source material is kept in. */
export const REPORT_SOURCES_BUCKET = 'listing-images';

/** Its folder, one per report. */
export const REPORT_SOURCES_PREFIX = 'report-sources';

/** The document context's object name in that folder. */
export const DOCUMENT_CONTEXT_OBJECT = 'document.json';

export const REPORT_DOCUMENT_CONTEXT_VERSION = 1;

/**
 * Larger than anything the generator writes: an uploaded document is bounded
 * to 12,000 bytes and a listing page to 24,000 before it is kept.
 */
export const DOCUMENT_CONTEXT_MAX_TEXT_BYTES = 32_000;
export const DOCUMENT_CONTEXT_MAX_DETAILS_BYTES = 4_000;

/** What a prompt needs to state the document again. */
export interface ReportDocumentContextInput {
  /** `pdf` — an uploaded document; `listing` — a listing page's words. */
  source: 'pdf' | 'listing';
  /** What the prompt calls the source: `PDF Document`, the listing's URL, or `Property Listing`. */
  sourceLabel: string;
  /** The words, bounded exactly as the first invocation bounded them. */
  text: string;
  /** The extracted-specifications block the first invocation composed, or ''. */
  extractedDetails: string;
}

export interface ReportDocumentContext extends ReportDocumentContextInput {
  version: typeof REPORT_DOCUMENT_CONTEXT_VERSION;
  reportId: string;
  /** The report's address when the document was kept. */
  address: string;
  /** ISO instant, supplied by the caller. Nothing here has a clock. */
  keptAt: string;
}

const REPORT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const encoder = new TextEncoder();
const bytes = (value: string): number => encoder.encode(value).length;

/** Where a report's document context is kept, or null for anything that is not a report id. */
export function documentContextPath(reportId: string): string | null {
  return REPORT_ID.test(reportId) ? `${REPORT_SOURCES_PREFIX}/${reportId.toLowerCase()}/${DOCUMENT_CONTEXT_OBJECT}` : null;
}

/**
 * An address as the report compares it: the rule the generator already applies
 * to a request against its row (trimmed, case-folded), with runs of whitespace
 * read as one.
 */
export function normaliseReportAddress(address: unknown): string {
  return typeof address === 'string' ? address.trim().toLowerCase().replace(/\s+/g, ' ') : '';
}

/** The record the first invocation keeps. */
export function buildReportDocumentContext(args: ReportDocumentContextInput & {
  reportId: string;
  address: string;
  keptAt: string;
}): ReportDocumentContext {
  return {
    version: REPORT_DOCUMENT_CONTEXT_VERSION,
    reportId: args.reportId.toLowerCase(),
    address: args.address.trim(),
    source: args.source,
    sourceLabel: args.sourceLabel,
    text: args.text,
    extractedDetails: args.extractedDetails,
    keptAt: args.keptAt,
  };
}

/** A kept record read back, or null when it is not one this module wrote. */
export function parseReportDocumentContext(raw: unknown): ReportDocumentContext | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== REPORT_DOCUMENT_CONTEXT_VERSION) return null;
  if (typeof r.reportId !== 'string' || !REPORT_ID.test(r.reportId)) return null;
  if (typeof r.address !== 'string' || !r.address.trim()) return null;
  if (r.source !== 'pdf' && r.source !== 'listing') return null;
  if (typeof r.sourceLabel !== 'string' || !r.sourceLabel.trim()) return null;
  if (typeof r.text !== 'string' || !r.text.trim() || bytes(r.text) > DOCUMENT_CONTEXT_MAX_TEXT_BYTES) return null;
  if (typeof r.extractedDetails !== 'string' || bytes(r.extractedDetails) > DOCUMENT_CONTEXT_MAX_DETAILS_BYTES) return null;
  if (typeof r.keptAt !== 'string') return null;
  return {
    version: REPORT_DOCUMENT_CONTEXT_VERSION,
    reportId: r.reportId.toLowerCase(),
    address: r.address,
    source: r.source,
    sourceLabel: r.sourceLabel,
    text: r.text,
    extractedDetails: r.extractedDetails,
    keptAt: r.keptAt,
  };
}

/**
 * Whether a kept record may stand in for the document this invocation was not
 * handed: the same report, and the same address it was kept for.
 */
export function keptDocumentApplies(
  record: ReportDocumentContext,
  invocation: { reportId: string; address: unknown },
): boolean {
  if (record.reportId !== invocation.reportId.toLowerCase()) return false;
  const address = normaliseReportAddress(invocation.address);
  return address !== '' && normaliseReportAddress(record.address) === address;
}
