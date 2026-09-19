/**
 * Property document extraction coercion — frontend entry point.
 *
 * Re-exports the single CANONICAL implementation in `_shared` so the rules that
 * decide whether an extracted value survives into a property record are covered
 * by Vitest rather than living untested inside an Edge Function.
 */
export * from '../../../supabase/functions/_shared/propertyExtraction.pure.ts';
