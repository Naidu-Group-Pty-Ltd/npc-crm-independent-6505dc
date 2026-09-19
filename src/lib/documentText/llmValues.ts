/**
 * LLM extraction value coercion — frontend entry point.
 *
 * Re-exports the single CANONICAL implementation in `_shared` so a value the
 * model returned as `"$850,000"` is recovered the same way whether it is read
 * in an Edge Function or in the browser. No handwritten duplication.
 */
export * from '../../../supabase/functions/_shared/llmJson.pure.ts';
