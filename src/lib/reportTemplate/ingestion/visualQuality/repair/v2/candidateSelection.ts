/**
 * E8 — deterministic lexicographic candidate selection (pure).
 *
 * SAFETY TIER OUTRANKS SCORE. A safe source-crop/raster candidate that resolves
 * all hard defects is never ranked below a higher-scoring unsafe native
 * candidate. Ties resolve deterministically down to candidate id. Only accepted
 * candidates are selectable; when none is accepted the cascade falls back or
 * blocks.
 */
import { REPAIR_SELECTION_POLICY_VERSION, type RepairCandidateV1, type RepairCandidateEvaluationV1 } from './contracts';

export const SAFETY_TIER = { verifiedNative: 4, verifiedAlternative: 4, verifiedMixed: 3, verifiedPageRaster: 2, blocked: 0 } as const;

export function safetyTierFor(candidate: RepairCandidateV1, evaluation: RepairCandidateEvaluationV1): number {
  const strat = evaluation.afterOutputStrategy;
  if (strat === 'raster-only') return SAFETY_TIER.verifiedPageRaster;
  if (strat === 'mixed') return SAFETY_TIER.verifiedMixed;
  if (strat === 'native') {
    return candidate.candidateClass === 'alternative-table' || candidate.candidateClass === 'alternative-typography'
      ? SAFETY_TIER.verifiedAlternative : SAFETY_TIER.verifiedNative;
  }
  return SAFETY_TIER.blocked;
}

export interface EvaluatedCandidate { candidate: RepairCandidateV1; evaluation: RepairCandidateEvaluationV1 }

/** Higher tuple sorts first. Booleans → 1/0; "lower is better" fields negated. */
function selectionTuple(ec: EvaluatedCandidate): number[] {
  const { candidate: c, evaluation: e } = ec;
  const after = e.afterReport;
  const score = after?.overallScore ?? 0;
  const minCritical = (after?.metrics.foregroundRecall ?? after?.overallScore ?? 0);
  const parity = e.exportParityPassed === true ? 1 : e.exportParityPassed == null ? 0.5 : 0;
  const regionFidelity = after?.metrics.sourceRegionCoverage ?? 0;
  const editability = c.estimatedEditability ?? 0;
  return [
    e.permittedByE7 ? 1 : 0,                    // 1
    e.newHardDefectIntroduced ? 0 : 1,          // 2
    e.targetDefectsResolved ? 1 : 0,            // 3
    e.criticalCoverageComplete ? 1 : 0,         // 4
    safetyTierFor(c, e),                        // 5
    -(after?.hardDefectCount ?? 999),           // 6 (fewer better)
    score,                                      // 7
    minCritical,                                // 8
    parity,                                     // 9
    regionFidelity,                             // 10
    editability,                                // 11
    -operationRisk(c),                          // 12 (lower better)
    -c.operationIds.length,                     // 13 (fewer better)
    -c.deterministicCost,                       // 14 (lower better)
  ];
}

function operationRisk(c: RepairCandidateV1): number {
  // native repair carries more risk than a verified switch or a safe fallback.
  switch (c.candidateClass) {
    case 'page-raster': return 0;
    case 'mixed-region': return 1;
    case 'alternative-table': case 'alternative-typography': return 2;
    case 'native-repair': return 3;
    default: return 4;
  }
}

function compareTuples(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i += 1) { if (a[i] !== b[i]) return b[i] - a[i]; }
  return 0;
}

export interface SelectionResult {
  version: typeof REPAIR_SELECTION_POLICY_VERSION;
  selected: EvaluatedCandidate | null;
  ranked: Array<{ candidateId: string; tier: number; accepted: boolean }>;
  reason: string;
}

/** Select the single best ACCEPTED candidate deterministically. */
export function selectCandidate(candidates: EvaluatedCandidate[]): SelectionResult {
  const accepted = candidates.filter((c) => c.evaluation.accepted);
  const ranked = [...candidates]
    .sort((x, y) => {
      const t = compareTuples(selectionTuple(x), selectionTuple(y));
      return t !== 0 ? t : x.candidate.id.localeCompare(y.candidate.id); // deterministic id tie-break
    })
    .map((c) => ({ candidateId: c.candidate.id, tier: safetyTierFor(c.candidate, c.evaluation), accepted: c.evaluation.accepted }));

  if (accepted.length === 0) {
    return { version: REPAIR_SELECTION_POLICY_VERSION, selected: null, ranked, reason: 'no_accepted_candidate' };
  }
  const best = [...accepted].sort((x, y) => {
    const t = compareTuples(selectionTuple(x), selectionTuple(y));
    return t !== 0 ? t : x.candidate.id.localeCompare(y.candidate.id);
  })[0];
  best.evaluation.selectionTier = safetyTierFor(best.candidate, best.evaluation);
  return { version: REPAIR_SELECTION_POLICY_VERSION, selected: best, ranked, reason: 'selected' };
}
