/**
 * Bridge onto the one implementation in `supabase/functions/_shared`.
 *
 * Placement runs in the edge function and is asserted by the frontend's tests;
 * two copies is how two copies disagree.
 */
export * from '../../../../supabase/functions/_shared/reports/investment/documentPlacement.pure.ts';
