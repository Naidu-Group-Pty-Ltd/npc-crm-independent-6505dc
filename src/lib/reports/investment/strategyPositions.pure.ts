/**
 * Bridge onto the one implementation in `supabase/functions/_shared`.
 *
 * The composers run in the edge function and are read by the frontend's tests
 * and previews; two copies is how two copies disagree.
 */
export * from '../../../../supabase/functions/_shared/reports/investment/strategyPositions.pure.ts';
