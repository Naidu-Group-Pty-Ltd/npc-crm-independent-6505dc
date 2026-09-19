/**
 * Browser-side entry point for the Airtable intake column names.
 *
 * The implementation lives in
 * `supabase/functions/_shared/airtableIntakeFields.pure.ts` so the edge runtime
 * and the browser share one copy — the repo convention for anything both
 * runtimes must agree on exactly. Re-exporting rather than reimplementing is
 * what stops a rename in one place quietly breaking the other, which is
 * precisely the class of bug this module was created to end.
 */
export {
  INTAKE_FIELDS,
  INTAKE_SORT_FIELD,
  type IntakeFieldKey,
} from '../../supabase/functions/_shared/airtableIntakeFields.pure';
