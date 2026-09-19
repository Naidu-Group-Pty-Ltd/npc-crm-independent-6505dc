/**
 * Bridge — the implementation lives with the Edge Functions.
 *
 * The model writes its chart vocabulary into a column that both the edge render
 * routes and the browser read, so the parser sits beside `markdown.pure.ts` at
 * the root of `_shared/reports/`.
 */
export * from '../../../supabase/functions/_shared/reports/vizDirectives.pure.ts';
