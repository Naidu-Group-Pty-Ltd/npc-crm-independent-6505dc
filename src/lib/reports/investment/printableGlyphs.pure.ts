/**
 * Bridge onto the one implementation in `supabase/functions/_shared`.
 *
 * The rules run in the edge function's read path and are asserted by the
 * frontend's tests; two copies is how two copies disagree.
 */
export * from '../../../../supabase/functions/_shared/reports/investment/printableGlyphs.pure.ts';
