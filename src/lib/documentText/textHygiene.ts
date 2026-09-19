/**
 * Document text hygiene — frontend entry point.
 *
 * Re-exports the single CANONICAL implementation in `_shared` so the browser
 * extractors, the Edge Function parsers and Vitest all normalise, de-hyphenate,
 * truncate and chunk document text identically. No handwritten duplication that
 * could drift between the client and the server halves of the same import.
 */
export * from '../../../supabase/functions/_shared/documentText.pure.ts';
