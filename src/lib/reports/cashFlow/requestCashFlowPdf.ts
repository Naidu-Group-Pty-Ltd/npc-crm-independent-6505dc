/**
 * Asking the server for a 10 Year Cash Flow Analysis.
 *
 * ## What crosses the wire
 *
 * The projection the modal is showing, as plain numbers. Not the overrides, not
 * the report id and a hope the server recomputes the same thing — the actual
 * ten years on screen. `CashFlowAnalysisModal` lets an adviser edit any of ten
 * fields in any of ten years without saving, so "recompute it server-side" and
 * "render what the adviser reviewed" are different documents, and only one of
 * them is the one they meant to send.
 *
 * Units are attached on the server (`normalise.pure.ts`), which is why every
 * value here is a bare number: there is one place that decides that a rate of
 * `5` means five percent, and it is not this file.
 *
 * ## The fallback, and why it is narrow
 *
 * `render-cash-flow-pdf` has to be deployed and its migration applied before it
 * can answer. Between merging this and doing those, the button would fail. So a
 * missing *function* — and only that — falls back to the jsPDF generator that
 * ships today, and says which one the caller got.
 *
 * A 400 from a deployed function is a real failure and must surface as one. A
 * 500 likewise: falling back on it would hand a client a document produced by
 * the generator this format exists to replace, while telling nobody.
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { describeRenderFailure, readRenderFailure } from '@/lib/reports/renderFailure.pure';
import { looksUndeployed } from '../undeployedRoute';

/** One projected year, exactly as `CashFlowAnalysisModal` computes it. */
export interface WireProjectionYear {
  year: number;
  calendarYear?: number | null;
  propertyValue: number;
  loanBalance: number;
  rentalIncome: number;
  grossYield: number;
  netYield: number;
  expenses: number;
  interestRate: number;
  interest: number;
  principal: number;
  preTaxAnnual: number;
  afterTaxAnnual: number;
  depreciation: number;
  taxRefund: number;
  /**
   * `taxRefund - taxPayable`: the SIGNED amount tax adds to cash flow. Optional
   * so a client that predates the fix still renders; the server falls back to
   * `taxRefund`, which is what it always used. A profitable year has a zero
   * refund and a real payable, so a renderer reading `taxRefund` alone shows a
   * dash while after-tax cash flow drops with nothing to explain it.
   */
  taxEffect?: number;
  landTax: number;
  capitalGrowth: number;
  cpiGrowth: number;
}

export interface WireAcquisition {
  purchasePrice: number;
  marketValue: number;
  deposit: number;
  loanAmount: number;
  loanTermYears: number;
  interestRate: number;
  loanType: string;
  weeklyRent: number;
  costs: Array<{ label: string; amount: number }>;
}

export interface WireProjection {
  acquisition: WireAcquisition;
  years: WireProjectionYear[];
  assumptions: Array<{ label: string; value: string }>;
  notes: string[];
}

export interface CashFlowPdfResult {
  url: string;
  fileName: string;
  bytes: number;
  pageCount: number | null;
  /** What the tenant's brand snapshot was missing. Empty for a complete one. */
  brandGaps: string[];
  /**
   * Where the route stored these exact bytes (in `client-files`), or null for
   * a document nothing stored — the in-browser generator on the deployment-gap
   * fallback. A caller that publishes the document points the portal at it,
   * so the file a client opens is the one that was reviewed and it exists
   * once (RS-5c.2).
   */
  storagePath: string | null;
  /** `server` for the new path, `legacy` when the route is not deployed yet. */
  source: 'server' | 'legacy';
}

// The predicate is shared (`../undeployedRoute`). This module carried its own
// copy which could not match the message the transport actually produces for an
// absent function, so the in-browser generator handed in as `legacyFallback`
// was never called and the adviser got a red toast and NO FILE. See that
// module's header for why the substring arms were dead on every browser.

/**
 * Request the document.
 *
 * `legacyFallback` is passed in rather than imported so this module does not
 * drag the jsPDF generator into every bundle that touches the button.
 *
 * ## The Template Builder route here is guarded, not automatic
 *
 * Every other migrated format asks `tryTemplateDocument` first and renders an
 * activated template instead of calling its flowing route. This one may not ask
 * unconditionally, and the reason is the first line of this module's contract:
 * **the projection is an argument, not a lookup.**
 *
 * It arrives from `CashFlowAnalysisModal`, which recomputes ten years in the
 * browser from the report's `manual_overrides` plus whatever the adviser has
 * changed since the modal opened. `cashFlowAdapter` cannot see any of that — it
 * reads the stored `financial_calculations.projections`, a different series
 * whenever an override exists, which is the normal case for the reports this
 * modal is opened on. Asking regardless would hand the client a document whose
 * numbers are not the numbers the adviser is looking at while they send it, and
 * a wrong figure in a client's financial report outranks a nicer layout.
 *
 * So `storedSeriesMatch.ts` has to name a stored scenario first — every field
 * both series state, in every year, plus a cash-flow column that corresponds
 * consistently — and the modal asks only then, for that scenario. It answers
 * null for anything it cannot be certain of.
 * `cashFlowTemplateRouteGuarded.spec.ts` keeps the guard attached to the call.
 */
export async function requestCashFlowPdf(
  request: { reportId: string; projection: WireProjection; edition?: string | null },
  legacyFallback?: () => Promise<{ url: string; fileName: string; bytes: number } | null>,
): Promise<CashFlowPdfResult> {
  const { data, error } = await invokeSecureFunction<{
    url: string;
    path?: string;
    fileName: string;
    bytes: number;
    pageCount: number | null;
    brandGaps: string[];
  }>('render-cash-flow-pdf', {
    reportId: request.reportId,
    projection: request.projection,
    edition: request.edition ?? null,
  }, { timeoutMs: 180_000 });

  if (!error && data?.url) {
    return {
      url: String(data.url),
      fileName: String(data.fileName ?? 'Cash_Flow_Analysis.pdf'),
      bytes: Number(data.bytes ?? 0),
      pageCount: Number.isFinite(data.pageCount) ? Number(data.pageCount) : null,
      brandGaps: Array.isArray(data.brandGaps) ? data.brandGaps.map(String) : [],
      storagePath: typeof data.path === 'string' && data.path ? data.path : null,
      source: 'server',
    };
  }

  if (legacyFallback && looksUndeployed(error)) {
    console.warn(
      '[cash-flow] render-cash-flow-pdf is not deployed; falling back to the in-browser '
      + 'generator. Deploy the function and apply migration 20260815000000 to use the new report.',
    );
    const legacy = await legacyFallback();
    if (legacy) return { ...legacy, pageCount: null, brandGaps: [], storagePath: null, source: 'legacy' };
  }

  // A failure the render service answered arrives classified from the
  // function (`code`, `upstreamStatus`); its message is already the operator's
  // sentence — "The print engine did not answer (HTTP 503 …)" — never the
  // service's HTML page, which is what this toast showed on 15 Sep 2026.
  const classified = readRenderFailure(data);
  if (classified) {
    throw new Error(classified.error || describeRenderFailure({ kind: classified.code, upstreamStatus: classified.upstreamStatus }));
  }
  throw new Error(error?.message || 'Could not generate the Cash Flow Analysis');
}
