/**
 * Browser entry point for the condition-record validator.
 *
 * One implementation. The Edge runtime cannot import from `src/`, and two
 * copies of an admissibility rule is how a dialog and a server come to hold
 * two standards — so the module lives with the functions and this re-export
 * is the whole file. See
 * `supabase/functions/_shared/reports/risk/conditionRecord.pure.ts`.
 */
export * from '../../../supabase/functions/_shared/reports/risk/conditionRecord.pure.ts';
