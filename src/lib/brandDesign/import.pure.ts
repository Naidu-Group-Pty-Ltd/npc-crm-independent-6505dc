/**
 * Bridge — the implementation lives with the Edge Functions.
 *
 * The import runs in the browser (a person drops a file) and on the route (the
 * saved system is re-read), so the canonical module sits beside the routes and
 * this file exists only so both reach the same code. One implementation, two
 * import paths.
 */
export * from '../../../supabase/functions/_shared/brandDesign/import.pure.ts';
