/**
 * Browser entry point for the manual-register classification — see
 * `supabase/functions/_shared/aml/pepManualChecks.pure.ts`.
 *
 * Which registers still need a person is derived from what the run reports,
 * never from prose that counts them. Prose that counts things goes stale, and
 * this one did: it said "the two Commonwealth registers" on a screen whose
 * own panel said one source was not searched.
 */
export {
  classifyManualChecks,
  describeManualChecks,
  recencyFromRunSource,
  MANUAL_LINK_TO_INDEX_SOURCE,
  type ManualCheck,
  type ManualCheckState,
  type RunSourceState,
} from '../../../supabase/functions/_shared/aml/pepManualChecks.pure.ts';
