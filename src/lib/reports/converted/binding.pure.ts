/**
 * Bridge — the implementation lives with the Edge Functions.
 *
 * The converter runs server-side, so the canonical module sits beside the
 * routes and this file exists only so the Template Builder subpage and the
 * tests can reach the same code. One implementation, two import paths.
 */
export * from '../../../../supabase/functions/_shared/reports/converted/binding.pure.ts';
