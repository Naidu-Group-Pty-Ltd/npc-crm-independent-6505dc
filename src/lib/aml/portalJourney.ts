/**
 * Browser entry point for the shared portal-journey rules — see
 * `supabase/functions/_shared/aml/portalJourney.pure.ts`.
 *
 * The submission-readiness rule is decided once, there: the server renders it
 * into the journey and enforces it at `submit_for_review`, and the Review
 * screen reads THIS re-export so it cannot drift into a second calculation.
 */
export {
  stepHoldsSubmission, submissionBlockers,
  type SubmissionBlocker,
} from '../../../supabase/functions/_shared/aml/portalJourney.pure.ts';
