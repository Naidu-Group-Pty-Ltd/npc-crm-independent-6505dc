/**
 * Bridge — the implementation lives with the Edge Functions.
 *
 * See `supabase/functions/_shared/reports/investment/reportGeneratedAt.pure.ts`.
 * The server resolves the date once; the browser reads what it resolved, and
 * the same rule, where a row reached it by another route.
 */
export * from '../../../../supabase/functions/_shared/reports/investment/reportGeneratedAt.pure.ts';
