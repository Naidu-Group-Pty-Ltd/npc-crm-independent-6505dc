/**
 * Browser entry point for the outstanding-requirements list — see
 * `supabase/functions/_shared/aml/pepDeterminationSteps.pure.ts`.
 *
 * It is derived from the errors `assessPepEvidence` actually produces, so
 * what the operator is shown outstanding and what the server refuses cannot
 * become two standards.
 */
export {
  describeOutstanding,
  pepDeterminationRequirements,
  type PepStepRequirement,
} from '../../../supabase/functions/_shared/aml/pepDeterminationSteps.pure.ts';
