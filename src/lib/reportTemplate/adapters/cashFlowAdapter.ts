/**
 * The 10 Year Cash Flow Analysis's Template Builder adapter.
 *
 * The fifth production report type. It is the only one of the five that does
 * **not** read the table named after it, and that is deliberate rather than an
 * oversight: `cash_flow_analyses` holds 0 rows and `cash_flow_renders` is a
 * ledger with no payload, because — as `docs/reports/CASH_FLOW.md` records —
 * the adviser's overrides live in `CashFlowAnalysisModal` and are never
 * persisted. There is no stored artefact for a template to render.
 *
 * What *is* stored is `investment_reports.financial_calculations.projections`:
 * three scenarios of ten years, on 162 of the 1,182 reports. That is this
 * format's source, and `cashFlowProjection.pure.ts` explains what it publishes
 * and, more importantly, the one thing it refuses to.
 *
 * ## A report without a stored projection returns null, and that is the point
 *
 * 1,020 of the 1,182 investment reports carry no `projections` object. Rendering
 * one of them through this format would produce a document whose entire subject
 * — a ten-year series — is missing, with every year's row blank. So
 * `buildBindingContext` returns null, `resolveRoutingContext` returns null, and
 * the caller falls through to `legacyFallback` exactly as it does for a report
 * id that does not exist. The legacy generator keeps those 1,020.
 *
 * That check has to happen in *both* methods. Routing resolves before binding,
 * and a routing context that resolves for a report the binding cannot serve
 * would show an operator a ready-looking template that renders empty.
 */
import {
  applyCashFlowProjection,
  projectCashFlow,
  DEFAULT_SCENARIO,
  type ScenarioName,
} from '../../../../supabase/functions/_shared/cashFlowProjection.pure';
import {
  applyLiveCashFlowProjection,
  wireAsProjectionRow,
} from '@/lib/reports/cashFlow/liveProjectionRow';
import type { WireProjection } from '@/lib/reports/cashFlow/requestCashFlowPdf';
import { listInvestmentReportRows, loadInvestmentReportRow } from './secureSource';
import { applyOrganisationAndBrand } from './organisation';
import type {
  BrandContext, ReportListing, ReportTemplateAdapter, RoutingContext, TemplateBindingContext,
} from './types';

/**
 * The columns the projection reads, and nothing else.
 *
 * `financial_calculations` is a large JSON blob and `investment_reports` has
 * wide model-authored text columns beside it (`report_content` alone runs to
 * tens of kilobytes); selecting `*` here would pull the whole generated report
 * across the wire to read one nested object.
 *
 * There is no `client_name` on this table — see the projection's header. A
 * misspelt or absent column is not a silent empty here, it is a PostgREST
 * `42703` that fails the whole statement, which is how the Finance Portal's
 * notification feed returned 500 for three weeks.
 */
const COLUMNS = 'id, property_address, financial_calculations, created_at, updated_at';

/**
 * Read through the broker, never through the browser client.
 *
 * `investment_reports`' only non-service SELECT policy is gated on
 * `auth.uid()`, and this app's identity is a custom cookie session — so a
 * direct read returns zero rows for every report, and this adapter answered
 * "I refuse this record" for all 1,182 of them. That is what made a chosen
 * template come out as the standard layout on every download. See
 * `secureSource.ts`. The `detail` projection `reportId` selects carries
 * `financial_calculations`, which is the whole of what this format binds.
 */
async function loadReport(reportId: string): Promise<Record<string, any> | null> {
  return loadInvestmentReportRow(reportId);
}

/**
 * The scenario a caller asked for, when it is one of the three.
 *
 * An unrecognised name silently becomes `moderate` rather than throwing or
 * rendering an empty series: the scenario is a presentation choice, and a
 * mistyped one should not cost the document.
 */
function resolveScenario(variant?: string | null): ScenarioName {
  const key = String(variant ?? '').trim().toLowerCase();
  if (key === 'conservative' || key === 'optimistic' || key === 'moderate') return key;
  return DEFAULT_SCENARIO;
}

/**
 * The reviewed series the caller handed over, as a row this adapter can read.
 *
 * The 10 Year Cash Flow is the one format whose contract puts the arithmetic
 * in the browser (`docs/reports/CASH_FLOW.md`): the modal recomputes ten years
 * live, and those overrides are not stored anywhere this adapter could load
 * them from. Without this channel the stored template choice applied only when
 * the screen happened to equal the store — the exception, not the rule.
 *
 * Null when no payload was supplied, or the supplied one is not whole enough
 * to draw — the same refusal shape as a stored row with no projection.
 */
function liveRowFromPayload(
  payload: Record<string, unknown> | null | undefined,
  reportId: string,
  /**
   * The stored record's `financial_calculations`, when one could be read.
   *
   * The series never comes from here — that is the whole point of the channel,
   * and a refused read must not cost the document. Only the inputs beneath it
   * do: the fee lines, the repayments and the annual holding costs, which no
   * override changes and which the payload does not carry.
   */
  storedFinancials?: Record<string, unknown> | null,
  /**
   * The record's timestamps, which are what date the document.
   *
   * Same best-effort rule as `storedFinancials`: taken from the record when it
   * is readable, withheld when it is not. Without them the cover printed
   * "Prepared" and nothing after it.
   */
  timestamps?: { updated_at?: unknown; created_at?: unknown } | null,
): Record<string, unknown> | null {
  const wire = payload?.wire as WireProjection | undefined;
  if (!wire) return null;
  const iso = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
  return wireAsProjectionRow(wire, {
    reportId,
    // From the payload, never from the database: the whole point of this
    // channel is that a caller holding the document's data can render it
    // without a read that may be refused.
    propertyAddress: (payload?.propertyAddress as string | null) ?? null,
    storedFinancials: storedFinancials ?? null,
    updatedAt: iso(timestamps?.updated_at),
    createdAt: iso(timestamps?.created_at),
  });
}

/** The scenario the caller proved, when it proved one. */
function provedScenario(payload: Record<string, unknown> | null | undefined): string | null {
  const s = payload?.scenario;
  return typeof s === 'string' && s.trim() ? s.trim() : null;
}

/** The document's title, from whichever source is serving it. */
function titleFor(address: unknown): string {
  return address ? `10 Year Cash Flow — ${address}` : '10 Year Cash Flow Analysis';
}

export const cashFlowAdapter: ReportTemplateAdapter = {
  reportType: 'cashflow',
  label: 'Cash Flow Analysis',
  supportsProduction: true,
  legacyFallback: {
    label: 'Cash Flow Analysis legacy generator',
    reason:
      'The pdf-lib generator remains the default until a template is activated for this report type, '
      + 'and stays permanently for the reports that store no projection.',
  },

  /**
   * Only reports that store a projection — the 162, not the 1,182. The filter
   * is the server-side approximation (`projections` present on the blob);
   * `projectCashFlow`'s structural check still guards the render, so a
   * mis-shaped projection is refused at selection rather than listed out. The
   * blob itself is deliberately not selected here: pulling twenty of them to
   * label a picker is the exact waste `COLUMNS` exists to avoid.
   */
  async listRecentReports({ limit = 20 }: { limit?: number } = {}): Promise<ReportListing[]> {
    // Through the broker, for the same reason `loadReport` is: a direct read
    // of `investment_reports` returns nothing at all in the browser.
    //
    // The "only reports that store a projection" filter cannot travel with it
    // — the broker's list projection deliberately omits the
    // `financial_calculations` blob, because pulling twenty of them to label a
    // picker is exactly the waste `COLUMNS` exists to avoid. Listing a report
    // that turns out to store no series costs a refusal at render time, which
    // `projectCashFlow`'s structural check has always been the real guard for;
    // listing nothing at all, which is what the direct read did, costs the
    // whole picker.
    const rows = await listInvestmentReportRows(limit);
    return rows.map((row) => ({
      id: String(row.id),
      label: (row.property_address as string) || '10 Year Cash Flow',
      savedAt: (row.created_at as string) ?? null,
    }));
  },

  async resolveRoutingContext({ reportId, variant, payload }): Promise<RoutingContext | null> {
    // The supplied series is served WITHOUT a database read.
    //
    // This format's data is the ten years on screen, and the caller is holding
    // them. Reading the record first made the render depend on a query that
    // can be refused — by RLS, by a module permission, by the broker being
    // unreachable — none of which the document actually needs. When a payload
    // is present the only thing the row contributed was the address, so the
    // caller supplies that too and the read is skipped entirely.
    const live = liveRowFromPayload(payload, reportId);
    if (live) {
      return {
        reportId,
        reportType: 'cashflow',
        variant: variant ?? null,
        tier: null,
        title: titleFor((payload as Record<string, unknown>)?.propertyAddress),
        fileLabel: 'cash-flow-analysis',
        sourceTable: 'investment_reports',
        legacyFallback: cashFlowAdapter.legacyFallback,
      };
    }

    const row = await loadReport(reportId);
    if (!row) return null;
    if (!projectCashFlow(row, resolveScenario(variant)).hasProjections) return null;
    return {
      reportId,
      reportType: 'cashflow',
      variant: variant ?? null,
      tier: null,
      title: titleFor(row.property_address),
      fileLabel: 'cash-flow-analysis',
      sourceTable: 'investment_reports',
      legacyFallback: cashFlowAdapter.legacyFallback,
    };
  },

  async buildBindingContext(
    { reportId, variant, brand, payload }: {
      reportId: string; variant?: string | null; brand?: BrandContext | null;
      payload?: Record<string, unknown> | null;
    },
  ): Promise<TemplateBindingContext | null> {
    // The record is read alongside the payload, and neither is sufficient
    // alone.
    //
    // The payload carries the series the adviser is looking at, which is the
    // only thing an override changes. The record carries the *inputs* under
    // it — the purchase fee lines, the loan repayments, the annual holding
    // costs — none of which are in the payload at all, and none of which an
    // override touches. Serving the payload alone published nine of the
    // fourteen `cashflow.*` groups a master binds, and the other five printed
    // as labelled tables of empty cells in a client's document: 50 of the
    // production master's 133 bound paths resolved to nothing, 35 empty table
    // cells.
    //
    // The read is best-effort and the render never depends on it — that
    // dependency is what made a chosen template fall back to the standard
    // composer on every download. A refusal costs the holding-cost table, not
    // the document.
    const row = await loadReport(reportId);
    const live = liveRowFromPayload(
      payload, reportId, (row?.financial_calculations ?? null) as Record<string, unknown> | null,
      row as { updated_at?: unknown; created_at?: unknown } | null,
    );
    if (!live && !row) return null;

    const scenario = resolveScenario(variant);

    // A proved series IS the stored series — `matchStoredScenario` established
    // that every field agrees in every year — so the record serves it whole,
    // including the two things the payload can never carry honestly: `roi`,
    // whose stored derivation this repo has no second implementation of, and
    // the three-scenario comparison, which is a real comparison only when the
    // series on screen is one of the three.
    const proved = provedScenario(payload);
    if (proved && row && projectCashFlow(row, resolveScenario(proved)).hasProjections) {
      const data: Record<string, any> = {
        report: {
          id: reportId,
          type: 'cashflow',
          generated_at: (row.updated_at ?? row.created_at) ?? new Date().toISOString(),
        },
        analysis: row,
        brand: { tokens: brand?.tokens ?? {}, logo: brand?.logoUrl ?? null },
      };
      applyCashFlowProjection(data, row, resolveScenario(proved));
      await applyOrganisationAndBrand(data);
      return {
        data,
        meta: { reportId, reportType: 'cashflow', variant: variant ?? null, tier: null },
      };
    }

    if (!live && !projectCashFlow(row!, scenario).hasProjections) return null;

    const source = live ?? row!;
    const data: Record<string, any> = {
      report: {
        id: reportId,
        type: 'cashflow',
        generated_at: (row?.updated_at ?? row?.created_at) ?? new Date().toISOString(),
      },
      // As with the other adapters, the raw row stays bound under its own column
      // names so anything already keyed on one keeps resolving.
      analysis: source,
      brand: {
        tokens: brand?.tokens ?? {},
        logo: brand?.logoUrl ?? null,
      },
    };

    if (live) {
      // The series the adviser reviewed, published under the same vocabulary
      // by the same producer — and never labelled with a scenario it does not
      // satisfy. See `liveProjectionRow.ts`.
      applyLiveCashFlowProjection(data, live, provedScenario(payload));
    } else {
      applyCashFlowProjection(data, row!, scenario);
    }
    // The letterhead — the wordmark on the cover and the contact block on the
    // disclaimer page every template ends with. Nothing published `org` until
    // August 2026, so both printed blank on every report this product has ever
    // generated. See `organisationProjection.pure.ts`.
    await applyOrganisationAndBrand(data);


    return {
      data,
      meta: { reportId, reportType: 'cashflow', variant: variant ?? null, tier: null },
    };
  },
};
