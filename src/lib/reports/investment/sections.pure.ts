/**
 * Bridge — the implementation lives with the Edge Functions.
 *
 * The document is built server-side, so the canonical module sits beside the
 * render route and this file exists only so the browser bundle and the tests
 * can reach the same code. One implementation, two import paths.
 */
export * from '../../../../supabase/functions/_shared/reports/investment/sections.pure.ts';
