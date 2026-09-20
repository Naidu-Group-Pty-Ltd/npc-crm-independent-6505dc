/**
 * Browser-side re-export of the canonical chart-evidence contract.
 *
 * One implementation, in `supabase/functions/_shared/`, so the four readers
 * and the edge renderer cannot disagree about which visuals a record supports.
 */
export * from '../../../../supabase/functions/_shared/reports/investment/chartEvidence.pure.ts';
