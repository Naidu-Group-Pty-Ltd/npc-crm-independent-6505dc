/**
 * Bridge — the implementation lives with the Edge Functions.
 *
 * One implementation, re-exported, for the same reason
 * `reports/clientDetails/finance.pure.ts` is: the browser and the server both
 * decide whether a household is a couple, and audit item 9 is what happens
 * when they decide it differently. Nothing may be added here.
 */
export * from '../../supabase/functions/_shared/householdComposition.pure.ts';
