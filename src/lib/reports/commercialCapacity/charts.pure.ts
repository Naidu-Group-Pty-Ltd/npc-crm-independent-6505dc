/**
 * Bridge — the implementation lives with the Edge Functions.
 *
 * The report is built server-side, and the app needs the same types to talk
 * about it. One implementation, re-exported. Nothing may be added here; see
 * `__tests__/commercialCapacitySourceOfTruth.spec.ts`.
 */
export * from '../../../../supabase/functions/_shared/reports/commercialCapacity/charts.pure.ts';
