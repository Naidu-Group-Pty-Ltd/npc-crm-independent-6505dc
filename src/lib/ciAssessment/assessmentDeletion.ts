/**
 * Bridge — the deletion rule lives with the Edge Function that enforces it.
 *
 * `manage-ci-assessments` gathers the facts and decides; the app renders the
 * verdict it returns. One implementation, re-exported, so the words on the
 * dialog and the rule on the server cannot drift apart.
 */
export * from '../../../supabase/functions/_shared/ciAssessments/deletion.pure.ts';
