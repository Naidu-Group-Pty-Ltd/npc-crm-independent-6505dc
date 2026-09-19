/**
 * Frontend mirror of supabase/functions/_shared/reportSplitRegistry.ts
 * KEEP IN SYNC.
 */

export type ForkVariant = 'financial' | 'due_diligence';

export const FIN_REPORT_TITLE = 'Client Investment Feasibility & Financial Performance Report';
export const FIN_REPORT_SUBTITLE =
  'Cashflow, lending, yield, sensitivity, projections and portfolio suitability assessment.';

export const PLDD_REPORT_TITLE = 'Property & Location Due Diligence Report';
export const PLDD_REPORT_SUBTITLE =
  'Property fundamentals, suburb profile, tenant demand, planning context and local risk assessment.';

export const REPORT_VARIANT_LABELS: Record<'composite' | ForkVariant, string> = {
  composite: 'Composite',
  financial: 'Financial Feasibility',
  due_diligence: 'Property Due Diligence',
};

export const REPORT_VARIANT_SHORT_LABELS: Record<'composite' | ForkVariant, string> = {
  composite: 'Composite',
  financial: 'FIN',
  due_diligence: 'PLDD',
};
