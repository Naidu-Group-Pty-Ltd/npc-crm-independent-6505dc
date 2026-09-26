/**
 * Bridge onto the one implementation in `supabase/functions/_shared`.
 *
 * The scrub runs on the read path every renderer shares and is asserted by the
 * frontend's tests; two copies is how two copies disagree.
 */
export * from '../../../../supabase/functions/_shared/reports/investment/scaffoldingLabels.pure.ts';
