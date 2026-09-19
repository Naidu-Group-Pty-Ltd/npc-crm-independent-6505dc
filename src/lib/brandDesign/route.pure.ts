/**
 * Bridge — the implementation lives with the Edge Functions.
 *
 * The design-system form posts what this module says a request is, and reads
 * back what it says a response is. One contract, two import paths.
 */
export * from '../../../supabase/functions/_shared/brandDesign/route.pure.ts';
