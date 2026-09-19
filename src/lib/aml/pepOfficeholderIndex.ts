/**
 * Browser entry point for the office-holder index contract — see
 * `supabase/functions/_shared/aml/pepOfficeholderIndex.pure.ts`.
 *
 * The readings, the coverage prose and the rule that a miss is not a
 * clearance are decided once, there, and rendered from here.
 */
export {
  PEP_INDEX_SOURCES,
  describeCoverage,
  indexIsUsable,
  searchVerdict,
  candidateToMethodDraft,
  assessIndexRecency,
  describeTenure,
  PEP_INDEX_AGEING_AFTER_DAYS,
  PEP_INDEX_STALE_AFTER_DAYS,
  type PepIndexSourceCode,
  type PepIndexCoverage,
  type PepIndexCandidate,
  type PepIndexReading,
  type PepIndexVerdict,
  type PepIndexRecency,
  type PepIndexRecencyReading,
} from '../../../supabase/functions/_shared/aml/pepOfficeholderIndex.pure.ts';

/**
 * The discrimination rule, rendered from the same module the server enforces.
 *
 * A date of birth ORDERS candidates and annotates them; it never removes one.
 * The client renders `comparePepDob`'s sentence rather than composing its own,
 * so what an operator reads and what the server decided cannot become two
 * things.
 */
export {
  PEP_CANDIDATE_MIN_NAME_SCORE,
  admitCandidate,
  comparePepDob,
  rankCandidate,
  resolveSubjectDob,
  type DobReading,
  type PepDobComparison,
} from '../../../supabase/functions/_shared/aml/pepCandidateMatch.pure.ts';
