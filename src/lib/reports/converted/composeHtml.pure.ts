/**
 * Bridge — the implementation lives with the Edge Functions.
 *
 * The sanitiser is the security boundary for model-authored markup and is
 * specced on this side; the render route runs it on the other. One
 * implementation, two import paths.
 */
export * from '../../../../supabase/functions/_shared/reports/converted/composeHtml.pure.ts';
