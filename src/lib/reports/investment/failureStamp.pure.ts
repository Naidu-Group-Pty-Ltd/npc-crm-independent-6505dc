/**
 * Bridge — the implementation lives with the Edge Functions, because
 * `manage-investment-reports` enforces the same rule the browser asks.
 *
 * See `supabase/functions/_shared/reports/investment/failureStamp.pure.ts`.
 */
export * from '../../../../supabase/functions/_shared/reports/investment/failureStamp.pure.ts';
