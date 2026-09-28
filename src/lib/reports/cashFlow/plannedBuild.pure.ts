/**
 * Bridge — the implementation lives with the Edge Functions.
 *
 * A land-only purchase with a planned build is re-read as the new build it
 * becomes in one place. Nothing may be added here; see
 * `__tests__/cashFlowSourceOfTruth.spec.ts`.
 */
export * from '../../../../supabase/functions/_shared/reports/cashFlow/plannedBuild.pure.ts';
