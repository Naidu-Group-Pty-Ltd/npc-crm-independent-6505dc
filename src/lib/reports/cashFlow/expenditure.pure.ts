/**
 * Bridge — the implementation lives with the Edge Functions.
 *
 * The on-screen analysis, the legacy export and the typeset document all read
 * this one module, so a figure cannot be computed three ways. Nothing may be
 * added here; see `__tests__/cashFlowSourceOfTruth.spec.ts`.
 */
export * from '../../../../supabase/functions/_shared/reports/cashFlow/expenditure.pure.ts';
