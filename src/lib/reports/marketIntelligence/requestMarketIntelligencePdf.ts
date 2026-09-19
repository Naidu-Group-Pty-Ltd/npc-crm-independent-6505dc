/**
 * Asking the server for a typeset Market Intelligence report.
 *
 * ## What crosses the wire, and what deliberately does not
 *
 * A report id. **Not the payload.** The legacy path casts
 * `report.report_data` straight to its own interface
 * (`MarketIntelligenceHistoryModal.tsx:70`) and typesets whatever arrives; this
 * route reads `marketing_intelligence_reports` itself.
 *
 * That is not only a validation argument. It is also why the document no longer
 * depends on which screen asked for it: the export button had the correlation
 * block in memory and the History modal never could, so the same report
 * produced two different PDFs depending on where you pressed the button.
 *
 * ## No legacy fallback
 *
 * `requestCashFlowPdf` falls back to its in-browser generator when the route is
 * absent, because for that format the two renderers produce the same document
 * from the same inputs.
 *
 * Here they do not. The legacy lists empty layers in its contents and prints
 * nothing for them, has no ceiling on a 244,332-character layer, and fills its
 * cover with a hardcoded navy rather than the tenant's brand. Substituting it
 * would send somebody a different document from the one they chose. A
 * deployment gap means the new control does not work yet, and it says so,
 * naming the button that does.
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { looksUndeployed } from '../undeployedRoute';

export interface MarketIntelligencePdfResult {
  url: string;
  fileName: string;
  bytes: number;
  pageCount: number | null;
  /** What the tenant's brand snapshot was missing. Empty for a complete one. */
  brandGaps: string[];
  /** Section titles in printed order. */
  sections: string[];
  /** Sections the document budget did not carry. Named on the page too. */
  dropped: string[];
  /** Layers asked for that returned nothing. Named on the page too. */
  emptyLayers: string[];
  reportPeriod: string;
  audienceSegment: string;
  /** True when `pdf_storage_path` was set, so the email dispatch can attach it. */
  persisted: boolean;
  storagePath: string | null;
}

export interface RequestMarketIntelligenceOptions {
  /**
   * Write the PDF into the `marketing-reports` bucket and set
   * `pdf_storage_path`.
   *
   * On by default, and that default is the point: `dispatch-marketing-reports`
   * reads that column to attach a PDF to a scheduled marketing email, and
   * nothing has ever written it.
   */
  persist?: boolean;
  /** `VOL. 2026 · ED. 08`. Cosmetic. */
  edition?: string | null;
  /**
   * Issue the report as `general`, `investor` or `homebuyer`.
   *
   * Changes the closing panels on the suburb section and the cover's edition
   * line, and nothing else — no model call, no regeneration. Omit to use the
   * segment the report was generated under. An unrecognised value falls back to
   * the row rather than failing.
   */
  audience?: string | null;
}

// The predicate is shared (`../undeployedRoute`). Every one of the nine
// formats carried its own copy and eight were stale in the same way: none
// could match the message the transport produces for an absent function,
// so the fallback each of them guards never fired for the case it exists
// for. See that module's header.

const UNDEPLOYED_MESSAGE =
  'The typeset market intelligence report is not available yet — '
  + 'render-market-intelligence-pdf has not been deployed. The existing Download PDF button '
  + 'still works.';

/** Request the document. Throws with a message worth showing a person. */
export async function requestMarketIntelligencePdf(
  reportId: string,
  options: RequestMarketIntelligenceOptions = {},
): Promise<MarketIntelligencePdfResult> {
  const { data, error } = await invokeSecureFunction('render-market-intelligence-pdf', {
    reportId,
    persist: options.persist !== false,
    edition: options.edition ?? null,
    audience: options.audience ?? null,
    // Twenty-four pages of prose through a network hop to WeasyPrint. Generous
    // against the worst case rather than the median.
  }, { timeoutMs: 240_000 });

  if (!error && data?.url) {
    return {
      url: String(data.url),
      fileName: String(data.fileName ?? 'Market_Intelligence_Report.pdf'),
      bytes: Number(data.bytes ?? 0),
      pageCount: Number.isFinite(data.pageCount) ? Number(data.pageCount) : null,
      brandGaps: Array.isArray(data.brandGaps) ? data.brandGaps.map(String) : [],
      sections: Array.isArray(data.sections) ? data.sections.map(String) : [],
      dropped: Array.isArray(data.dropped) ? data.dropped.map(String) : [],
      emptyLayers: Array.isArray(data.emptyLayers) ? data.emptyLayers.map(String) : [],
      reportPeriod: String(data.reportPeriod ?? ''),
      audienceSegment: String(data.audienceSegment ?? ''),
      persisted: data.persisted === true,
      storagePath: typeof data.storagePath === 'string' ? data.storagePath : null,
    };
  }

  if (looksUndeployed(error)) throw new Error(UNDEPLOYED_MESSAGE);
  throw new Error(error?.message || 'Could not produce the market intelligence report');
}
