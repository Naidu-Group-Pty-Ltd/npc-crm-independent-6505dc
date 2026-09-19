/**
 * Bridge — the implementation lives with the Edge Functions.
 *
 * The request and response shapes are the contract between the converter
 * subpage and `convert-template-document`, so both ends read the same file
 * rather than each keeping its own idea of what the other sends.
 */
export * from '../../../../supabase/functions/_shared/reports/converted/route.pure.ts';
