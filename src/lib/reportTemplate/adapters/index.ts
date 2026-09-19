import { investmentReportAdapter } from './investmentReportAdapter';
import { borrowingCapacityAdapter } from './borrowingCapacityAdapter';
import { portfolioAdapter } from './portfolioAdapter';
import { comparisonAdapter } from './comparisonAdapter';
import { cashFlowAdapter } from './cashFlowAdapter';
import { qaAdapter } from './qaAdapter';
import { commercialCapacityAdapter } from './commercialCapacityAdapter';
import { marketIntelligenceAdapter } from './marketIntelligenceAdapter';
import { clientDetailsAdapter } from './clientDetailsAdapter';
import type { ReportTemplateAdapter } from './types';

function previewOnlyAdapter(reportType: string, label: string, reason = 'Production adapter has not been configured yet.'): ReportTemplateAdapter {
  return {
    reportType,
    label,
    supportsProduction: false,
    legacyFallback: { label: `${label} legacy generator`, reason },
    async resolveRoutingContext() { return null; },
    async buildBindingContext() { return null; },
  };
}

export const REPORT_TEMPLATE_ADAPTERS: ReportTemplateAdapter[] = [
  investmentReportAdapter,
  // Second production adapter. `borrowing_capacity_assessments` is a typed table
  // with 143 real rows, so these templates can render an actual assessment
  // rather than only a preview. See `borrowingCapacityAdapter.ts`.
  borrowingCapacityAdapter,
  // Third production adapter, reading `portfolio_analysis_reports` (21 rows).
  portfolioAdapter,
  // Fourth, reading `property_comparisons` (50 rows) through the normaliser the
  // format's own render route already uses.
  comparisonAdapter,
  // Fifth, and the only one that does not read the table named after it:
  // `cash_flow_analyses` holds 0 rows by design, so this reads the stored
  // `financial_calculations.projections` on `investment_reports` (162 of 1,182)
  // and returns null for the rest. See `cashFlowAdapter.ts`.
  cashFlowAdapter,
  // Sixth. Nine tables through the normaliser the format's own render route
  // uses — 742 of the 775 clients hold nothing financial, which is what the
  // masters are built around rather than in spite of.
  clientDetailsAdapter,
  /**
   * Preview-only, and not for want of an adapter.
   *
   * A Cash Flow Comparison has nothing an adapter could read: the projections
   * are the browser's and are never persisted, the analysis is never persisted
   * and structurally cannot be (`cash_flow_analyses` holds 0 rows and its
   * INSERT policy refuses this application's own sign-in), and the render
   * ledger holds 0 rows, stores neither, and is superadmin-only. The stored
   * `financial_calculations.projections` cannot stand in: every headline
   * measure here is built on `afterTaxAnnual` and that series models no tax.
   * `cashFlowComparisonProjection.pure.ts` carries the detail, and is what an
   * adapter would call the day a comparison is persisted.
   */
  previewOnlyAdapter(
    'cash_flow_comparison',
    'Cash Flow Comparison',
    'No comparison is persisted anywhere a template can read: the projections are the '
    + 'browser’s, the analysis table refuses every write, and the render ledger stores neither.',
  ),
  /**
   * Seventh production adapter. Reads `report_qa_conversations` and
   * `report_qa_messages` through the normaliser the format's own render route
   * uses. This was preview-only until `markdown-block` existed: the vocabulary
   * had no way to set model-authored Markdown as structure, so an answer bound
   * to a `text-block` printed its own source.
   */
  qaAdapter,
  /**
   * Eighth. Reads the stored calculation run through the normaliser the
   * format's own render route uses, and declines the thirteen of sixteen
   * assessments that have no run — there are no figures for a document to
   * carry, and this format's first rule is that every figure comes from the
   * stored run rather than a recomputation.
   */
  commercialCapacityAdapter,
  /**
   * Ninth, and the last of the migrated formats to get one. Goes through the
   * normaliser rather than the row because three editorial strips live there —
   * the model's data-limitations hedging, its empty regulatory sections and the
   * brand tagline it repeats under the letterhead.
   */
  marketIntelligenceAdapter,
  previewOnlyAdapter('suburb', 'Suburb Analysis'),
  previewOnlyAdapter('postcode', 'Postcode Analysis'),
  previewOnlyAdapter('statewide', 'Statewide Analysis'),
];

/**
 * The alias map moved to `_shared/reports/reportTemplateSelection.pure.ts` and
 * is re-exported here unchanged, so every existing caller is unaffected.
 *
 * It moved because the template picker needs the same answer and runs against
 * the raw `report_type` column, where one format is stored under up to four
 * spellings. Two copies of that map would mean a template the broker will
 * activate under `commercial_industrial` that the registry then resolves to no
 * adapter — which is exactly what a second copy had already produced, and what
 * `reportTemplateSelection.spec.ts` now checks for every spelling.
 */
export { normaliseReportType, REPORT_TYPE_ALIASES } from '../../../../supabase/functions/_shared/reports/reportTemplateSelection.pure.ts';

import { normaliseReportType } from '../../../../supabase/functions/_shared/reports/reportTemplateSelection.pure.ts';

export function getAdapter(reportType?: string | null): ReportTemplateAdapter | null {
  const key = normaliseReportType(reportType);
  if (!key) return null;
  return REPORT_TEMPLATE_ADAPTERS.find((adapter) => adapter.reportType === key) ?? null;
}

export function listAdapters(): ReportTemplateAdapter[] {
  return [...REPORT_TEMPLATE_ADAPTERS];
}

export function supportsProduction(reportType?: string | null): boolean {
  return !!getAdapter(reportType)?.supportsProduction;
}

export type { BrandContext, LegacyFallbackDescriptor, ReportListing, ReportTemplateAdapter, RoutingContext, TemplateBindingContext } from './types';
