/**
 * Bridge — the client search and creation rules live with the Edge Function
 * that enforces them, so the form and the server ask for the same thing.
 */
export * from '../../../supabase/functions/_shared/ciAssessments/clientRecords.pure.ts';

/** A client as the module names them: their name, or plainly that none is recorded. */
export function clientLabel(client: { primary_first_name: string | null; primary_surname: string | null }): string {
  return [client.primary_first_name, client.primary_surname].filter(Boolean).join(' ') || 'Unnamed client';
}
