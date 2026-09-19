/**
 * Browser entry point for the workflow graph model.
 *
 * The model itself lives in `supabase/functions/_shared/workflow/types.pure.ts`
 * because the run engine that consumes it has to execute in two places: in the
 * page, for Test run and Run live, and in an Edge Function, for a workflow that
 * a captured trigger event dispatches with nobody watching. A second copy of
 * the wire format is a second answer to "what does this saved graph mean".
 */
export * from '../../../supabase/functions/_shared/workflow/types.pure.ts';
