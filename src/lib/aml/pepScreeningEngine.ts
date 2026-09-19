/**
 * Browser entry point for the PEP screening engine — see
 * `supabase/functions/_shared/aml/pepScreeningEngine.pure.ts`.
 *
 * The engine SCREENS and never determines. What a run means is decided once,
 * there, so the panel that renders it and the endpoint that records it cannot
 * come to two different readings of the same result.
 */
export {
  SERVER_UNREACHABLE_SOURCES,
  buildScreeningRun,
  runIsEvidence,
  runToMethodDraft,
  type PepScreeningSourceResult,
  type PepScreeningCandidate,
  type PepScreeningVerdict,
  type PepScreeningRun,
  type PepIndicator,
} from '../../../supabase/functions/_shared/aml/pepScreeningEngine.pure.ts';
