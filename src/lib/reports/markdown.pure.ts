/**
 * Bridge — the implementation lives with the Edge Functions.
 *
 * Shared rather than per-format: two formats now store model-authored Markdown
 * in a column, so the parser sits beside `text.pure.ts` at the root of
 * `_shared/reports/` rather than inside either of them.
 */
export * from '../../../supabase/functions/_shared/reports/markdown.pure.ts';
