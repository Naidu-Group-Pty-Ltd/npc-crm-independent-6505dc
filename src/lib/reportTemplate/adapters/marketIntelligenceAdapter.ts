import { getAuthenticatedSupabaseClient } from '@/hooks/useAuthenticatedSupabase';
import type {
  BrandContext, ReportListing, ReportTemplateAdapter, RoutingContext, TemplateBindingContext,
} from './types';
import {
  buildMarketIntelligenceReport,
} from '../../../../supabase/functions/_shared/reports/marketIntelligence/normalise.pure';
import {
  applyMarketIntelligenceProjection,
} from '../../../../supabase/functions/_shared/marketIntelligenceProjection.pure';
import { applyOrganisationProjection } from '../../../../supabase/functions/_shared/organisationProjection.pure';
import { loadBrandMarks, loadOrganisation, loadReportSettings } from './organisation';

/*
 * The staff-session client, not the anon one.
 *
 * This format's rows are invisible to the browser client under the Command
 * Centre's custom cookie session — see `secureSource.ts` for the measurement —
 * so every read returned an empty result rather than an error, the adapter
 * answered `null`, and the router fell back to the legacy generator. The
 * gateway holds a service-role client and scopes the read to the verified
 * session, which is the rule every adapter read follows.
 */
const db = () => getAuthenticatedSupabaseClient();

/**
 * Market Intelligence, through the normaliser its own render route uses.
 *
 * `buildMarketIntelligenceReport` applies three editorial strips before a word
 * reaches a page — the model's "data limitations" boilerplate, its empty
 * regulatory sections, and the brand tagline it repeats after the tagline
 * already on the letterhead. Reading `report_data` directly here would put all
 * three back, which is the single strongest reason this adapter goes through the
 * normaliser rather than the row.
 *
 * ## The brand name is an input, not decoration
 *
 * `cleanLayerContent` needs it to strip the duplicated tagline, so the
 * organisation is loaded *before* the report is built rather than merged in
 * afterwards as the other adapters do. Passing an empty name would silently
 * disable one of the three strips.
 *
 * ## The audience is a render decision
 *
 * A stored report can be issued as a `general`, `investor` or `homebuyer`
 * edition, and the difference is the closing panels on the suburb layer —
 * nothing the model wrote changes. So `variant` selects the edition and the same
 * row serves three documents, where the legacy generator could only reach the
 * second by running the whole eight-layer pipeline again.
 */

const REPORT_COLUMNS =
  'id, report_data, report_period, report_type, audience_segment, '
  + 'include_advisory_strategy, generated_at, status';

const AUDIENCES = new Set(['general', 'investor', 'homebuyer']);

async function loadReport(id: string) {
  const { data, error } = await db()
    .from('marketing_intelligence_reports')
    .select(REPORT_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  return data as Record<string, any>;
}

export const marketIntelligenceAdapter: ReportTemplateAdapter = {
  reportType: 'market_intelligence',
  label: 'Market Intelligence',
  supportsProduction: true,
  legacyFallback: {
    label: 'Market Intelligence flowing export',
    route: 'render-market-intelligence-pdf',
    reason:
      'The archetype route fits its page budget block by block against the real '
      + 'render, so it carries a long section in full. A template allocates a fixed '
      + 'number of pages per section and says on the page where one is clipped.',
  },

  async listRecentReports({ limit = 20 }: { limit?: number } = {}): Promise<ReportListing[]> {
    try {
      const { data, error } = await db()
        .from('marketing_intelligence_reports')
        .select('id, report_period, generated_at')
        .order('generated_at', { ascending: false })
        .limit(limit);
      if (error || !data) return [];
      return (data as Record<string, any>[]).map((row) => ({
        id: String(row.id),
        label: row.report_period
          ? `Market Intelligence — ${row.report_period}`
          : 'Market Intelligence',
        savedAt: (row.generated_at as string) ?? null,
      }));
    } catch {
      return [];
    }
  },

  async resolveRoutingContext({ reportId, variant }): Promise<RoutingContext | null> {
    const row = await loadReport(reportId);
    if (!row) return null;
    // The two of the normaliser's refusals this read can already answer, so
    // routing does not resolve for a report the binding will decline. All six
    // stored reports are `completed` and carry a payload, so both are latent —
    // and free, because `REPORT_COLUMNS` already selects them. The third
    // refusal (nothing substantial to typeset) needs the build itself, which
    // is 305 KB of layers and not something routing should do.
    if (!row.report_data) return null;
    if (row.status && row.status !== 'completed') return null;
    const audience = AUDIENCES.has(String(variant)) ? String(variant) : null;
    return {
      reportId,
      reportType: 'market_intelligence',
      variant: audience ?? (row.audience_segment as string) ?? null,
      tier: null,
      title: `Market Intelligence — ${row.report_period ?? ''}`.trim(),
      fileLabel: 'market-intelligence',
      sourceTable: 'marketing_intelligence_reports',
      legacyFallback: marketIntelligenceAdapter.legacyFallback,
    };
  },

  async buildBindingContext(
    { reportId, variant, brand }:
    { reportId: string; variant?: string | null; brand?: BrandContext | null },
  ): Promise<TemplateBindingContext | null> {
    const row = await loadReport(reportId);
    if (!row || !row.report_data) return null;

    // Loaded first: the brand name is an input to the tagline strip, not a
    // decoration merged in afterwards.
    const organisation = await loadOrganisation();
    const brandName = (organisation as Record<string, any> | null)?.company_name;

    const built = buildMarketIntelligenceReport({
      row,
      preparedOn: new Date().toISOString(),
      brandName: typeof brandName === 'string' ? brandName : '',
      audienceOverride: AUDIENCES.has(String(variant)) ? String(variant) : null,
    });
    // A report whose layers are all empty is not a document. Returning null is
    // what makes the library card say so rather than offering a cover with
    // nothing behind it.
    if (!built.ok) return null;

    const data: Record<string, any> = {
      report: {
        id: row.id,
        type: 'market_intelligence',
        generated_at: row.generated_at,
      },
      marketReport: row,
      brand: {
        tokens: brand?.tokens ?? {},
        logo: brand?.logoUrl ?? null,
      },
    };

    applyMarketIntelligenceProjection(data, built.report);
    /*
     * The fourth argument is the Report Settings row, and omitting it is why
     * this format printed the generic disclaimer.
     *
     * `applyOrganisationProjection(data, row, marks)` publishes the letterhead
     * from `whitelabel_settings` and nothing else: `org.disclaimer`,
     * `org.disclaimerFontSize`, `org.abn` and `org.address` all come from
     * `projectReportSettings`, which is fed by this argument. Every other
     * adapter reaches the same place through `applyOrganisationAndBrand`, which
     * loads all three sources; this one called the lower-level function with
     * three arguments and so bound a letterhead with no disclaimer under it.
     */
    applyOrganisationProjection(
      data,
      organisation,
      await loadBrandMarks(),
      await loadReportSettings(),
    );

    return {
      data,
      meta: {
        reportId,
        reportType: 'market_intelligence',
        variant: built.report.meta.audienceSegment ?? null,
        tier: null,
      },
    };
  },
};
