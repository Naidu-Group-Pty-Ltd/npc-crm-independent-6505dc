/**
 * The Portfolio Performance Review's Template Builder adapter.
 *
 * The third production report type, after `investment` and `borrowing_capacity`.
 * It reads `portfolio_analysis_reports` — 21 stored reports, every one carrying
 * a `health_score` and a `report_data` object with the portfolio metrics, the
 * per-property inventory and the model-authored assessment — **and** the
 * client's newest completed `portfolio_reviews` row, exactly as
 * `render-portfolio-review-pdf` joins it before building the same document.
 *
 * This header used to argue the opposite — that `portfolio_reviews` was "a
 * different table for a different thing" the format never reads. That was true
 * of `PortfolioAnalysisPDFGenerator` and stopped being true when the flowing
 * route and the projection took the review as the source of the review,
 * scenario and per-property-score pages. The adapter not doing the join meant
 * those pages rendered in the production-fit harness — which does the join —
 * and never through the product path: silently the same output as
 * `includeReview: false` on every render.
 *
 * The review read is best-effort, as the route's is: a review that cannot be
 * read is a warning and a thinner document, not a failed one — the projection
 * treats a null review exactly as the route treats `includeReview: false`.
 *
 * As with the other adapters, this calculates nothing: every figure is one the
 * analysis already stored, restated in the vocabulary a template binds. The only
 * derivation is monthly × 12.
 */
import { applyPortfolioProjection } from '../../../../supabase/functions/_shared/portfolioProjection.pure';
import { applyOrganisationAndBrand } from './organisation';
import {
  loadPortfolioReportRow,
  listPortfolioReportRows,
  listClientScopedRows,
} from './secureSource';
import type {
  BrandContext, ReportListing, ReportTemplateAdapter, RoutingContext, TemplateBindingContext,
} from './types';

/**
 * One portfolio analysis report, through the broker.
 *
 * Its only non-service SELECT policy is `generated_by = auth.uid()` OR a join
 * on `clients.created_by = auth.uid()`, and `auth.uid()` is always NULL in this
 * browser — identity is a custom HttpOnly cookie. So this returned zero rows
 * for all 22 stored reports and every user: not an error, an empty result,
 * which became `null`, which the router read as a refusal and turned into the
 * legacy generator. This format had rendered no design-system document at all.
 * See `secureSource.ts`.
 */
async function loadReport(reportId: string): Promise<Record<string, any> | null> {
  return loadPortfolioReportRow(reportId);
}

/**
 * The client's newest completed review — the route's own join, clause for
 * clause: `status = 'completed'`, newest `review_date` first with nulls last,
 * one row. Reviews exist for 20 of the 21 stored reports' clients.
 */
async function loadNewestCompletedReview(
  clientId: unknown,
): Promise<Record<string, any> | null> {
  if (typeof clientId !== 'string' || !clientId) return null;
  // Through the broker: `portfolio_reviews` is invisible to the browser client
  // for the same reason the report is.
  //
  // The broker orders but cannot express `nullsFirst: false`, and Postgres puts
  // NULLs first on a DESC order — so a client whose newest review has no
  // `review_date` would otherwise win over one that has a date. The rows are
  // taken in order and the first dated one is preferred here instead, which is
  // what the route's own join means by "newest completed".
  const rows = await listClientScopedRows('portfolio_reviews', {
    select: '*',
    orderBy: 'review_date',
    orderAsc: false,
    limit: 10,
    filters: { client_id: clientId, status: 'completed' },
  });
  if (!rows.length) return null;
  return rows.find((row) => row.review_date != null) ?? rows[0];
}

export const portfolioAdapter: ReportTemplateAdapter = {
  reportType: 'portfolio',
  label: 'Portfolio Analysis',
  supportsProduction: true,
  legacyFallback: {
    label: 'Portfolio Analysis legacy generator',
    reason: 'The pdf-lib generator remains the default until a template is activated for this report type.',
  },

  async listRecentReports({ limit = 20 }: { limit?: number } = {}): Promise<ReportListing[]> {
    try {
      // Through the broker, for the same reason `loadReport` is.
      const data = await listPortfolioReportRows(limit, 'id, client_name, created_at');
      if (!data.length) return [];
      return data.map((row) => ({
        id: String(row.id),
        label: (row.client_name as string) || 'Portfolio analysis',
        savedAt: (row.created_at as string) ?? null,
      }));
    } catch {
      return [];
    }
  },

  async resolveRoutingContext({ reportId }): Promise<RoutingContext | null> {
    const row = await loadReport(reportId);
    if (!row) return null;
    return {
      reportId,
      reportType: 'portfolio',
      variant: null,
      tier: null,
      title: 'Portfolio Performance Review',
      fileLabel: 'portfolio-performance-review',
      sourceTable: 'portfolio_analysis_reports',
      legacyFallback: portfolioAdapter.legacyFallback,
    };
  },

  async buildBindingContext(
    { reportId, brand }: { reportId: string; brand?: BrandContext | null },
  ): Promise<TemplateBindingContext | null> {
    const row = await loadReport(reportId);
    if (!row) return null;
    const review = await loadNewestCompletedReview(row.client_id);

    const data: Record<string, any> = {
      report: {
        id: row.id,
        type: 'portfolio',
        generated_at: row.updated_at ?? row.created_at,
      },
      // The raw row stays available under its own column names, as with the
      // other adapters, so anything already bound to one keeps resolving.
      analysis: row,
      brand: {
        tokens: brand?.tokens ?? {},
        logo: brand?.logoUrl ?? null,
      },
    };

    applyPortfolioProjection(data, row, review);
    // The letterhead — the wordmark on the cover and the contact block on the
    // disclaimer page every template ends with. Nothing published `org` until
    // August 2026, so both printed blank on every report this product has ever
    // generated. See `organisationProjection.pure.ts`.
    await applyOrganisationAndBrand(data);


    return {
      data,
      meta: { reportId, reportType: 'portfolio', variant: null, tier: null },
    };
  },
};
