/**
 * Bridge onto the one implementation in `supabase/functions/_shared`.
 *
 * The scrub runs in the edge function's read path and is asserted by the
 * frontend's tests; two copies is how two copies disagree.
 */
export * from '../../../../supabase/functions/_shared/reports/investment/braceHygiene.pure.ts';
