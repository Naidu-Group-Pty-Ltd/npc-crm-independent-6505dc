/**
 * Bridge — the implementation lives with the Edge Functions.
 *
 * The 10 Year Cash Flow Analysis is rendered server-side, and the browser
 * builds the projection that feeds it. Both must agree on what a projection is,
 * so there is one implementation and this re-exports it. Nothing may be added
 * here; see `__tests__/cashFlowSourceOfTruth.spec.ts`.
 */
export * from '../../../../supabase/functions/_shared/reports/cashFlow/charts.pure.ts';
