/**
 * E8 — candidate evaluation (pure). Compares before/after E7 page reports.
 *
 * A candidate is ACCEPTED only when every targeted defect is resolved (or
 * replaced by a strictly safer fallback representation), no new hard defect is
 * introduced, critical coverage stays complete, E7 permits the decision, and the
 * actual output was re-rendered/re-measured. Score is a secondary ranking
 * signal, never an acceptance criterion — a safe source-crop/raster candidate
 * that resolves all hard defects may be accepted even at a lower score than an
 * unsafe native candidate.
 */
import type { VisualPageQualityReportV2 } from '../../v2/contracts';
import { assertDecisionPermitted, type PermittedDecision, type CriticalQualityDefectV1 } from '../../v2/criticalDefects';
import {
  defectFingerprint, REPAIR_CANDIDATE_EVALUATION_VERSION,
  type RepairCandidateEvaluationV1, type RepairCandidateV1,
} from './contracts';

function fingerprints(report: VisualPageQualityReportV2 | null): string[] {
  if (!report) return [];
  return report.criticalDefects.map((d) => defectFingerprint(d));
}
function hardFingerprints(report: VisualPageQualityReportV2 | null): Set<string> {
  if (!report) return new Set();
  return new Set(report.criticalDefects.filter((d) => d.hardVeto).map((d) => defectFingerprint(d)));
}

const ACTION_TO_DECISION: Record<string, PermittedDecision> = {
  'accept-native': 'accept-native', 'accept-native-with-review': 'accept-native-with-review',
  'accept-mixed': 'accept-mixed', 'accept-mixed-with-review': 'accept-mixed-with-review',
  'accept-page-raster': 'accept-page-raster', 'block-finalization': 'block-finalization',
  'manual-review': 'manual-review', 'apply-mixed-region-fallback': 'apply-mixed-region-fallback',
  'apply-page-raster': 'apply-page-raster',
};

export interface EvaluateCandidateInput {
  candidate: RepairCandidateV1;
  beforeReport: VisualPageQualityReportV2;
  afterReport: VisualPageQualityReportV2 | null;
  targetDefectFingerprints: string[];
  renderPlanHashMatched: boolean;
  exportParityPassed?: boolean | null;
  /** true when the after-strategy is a strictly-safer fallback (native→crop/raster). */
  fallbackSafer?: boolean;
}

/**
 * Codes whose critical-recall/coverage metrics must never regress on repair.
 * (Monotonicity — Phase 24.) Compared on ACTUAL E7 metrics.
 */
const MONOTONIC_METRICS: Array<keyof VisualPageQualityReportV2['metrics']> = [
  'criticalTokenRecall', 'punctuationRecall', 'tableIntegrityScore', 'chartCoverage',
  'compositionCompleteness', 'assetAvailability', 'foregroundRecall',
];

export function evaluateCandidate(input: EvaluateCandidateInput): RepairCandidateEvaluationV1 {
  const before = input.beforeReport; const after = input.afterReport;
  const beforeFps = fingerprints(before); const afterFps = fingerprints(after);
  const beforeSet = new Set(beforeFps); const afterSet = new Set(afterFps);
  const rejectionCodes: string[] = [];

  const resolved = beforeFps.filter((f) => !afterSet.has(f));
  const retained = beforeFps.filter((f) => afterSet.has(f));
  const introduced = afterFps.filter((f) => !beforeSet.has(f));

  const beforeHard = hardFingerprints(before); const afterHard = hardFingerprints(after);
  const introducedHard = [...afterHard].filter((f) => !beforeHard.has(f));
  const newHardDefectIntroduced = introducedHard.length > 0;

  // targeted defects must be absent from the after report (resolved OR replaced
  // by a strictly-safer fallback — flagged by the caller).
  const targetResolved = input.targetDefectFingerprints.every((f) => !afterSet.has(f) || input.fallbackSafer === true);

  const criticalCoverageComplete = after != null && after.qualityCoverage === 'complete';

  // E7 permission on the after decision.
  let permittedByE7 = false;
  if (after) {
    const decision = ACTION_TO_DECISION[after.recommendedAction] ?? 'manual-review';
    permittedByE7 = assertDecisionPermitted(decision, after.criticalDefects).permitted;
  }

  // rejection reasons (fail-closed).
  if (!after) rejectionCodes.push('candidate_not_rendered');
  if (after && after.overallScore == null) rejectionCodes.push('candidate_unscored');
  if (!input.renderPlanHashMatched) rejectionCodes.push('render_plan_hash_mismatch');
  if (newHardDefectIntroduced) rejectionCodes.push('new_hard_defect_introduced');
  if (!targetResolved) rejectionCodes.push('target_hard_defect_retained');
  if (after && !criticalCoverageComplete) rejectionCodes.push('critical_coverage_incomplete');
  if (after && !permittedByE7) rejectionCodes.push('e7_decision_not_permitted');
  if (input.exportParityPassed === false) rejectionCodes.push('export_parity_failed');
  // monotonicity: no critical metric may regress unless moving to a safer fallback.
  if (after && !input.fallbackSafer) {
    for (const m of MONOTONIC_METRICS) {
      const b = before.metrics[m]; const a = after.metrics[m];
      if (typeof b === 'number' && typeof a === 'number' && a < b - 1e-6) { rejectionCodes.push(`metric_regressed:${m}`); }
    }
  }

  const accepted = rejectionCodes.length === 0;
  const beforeScore = before.overallScore; const afterScore = after?.overallScore ?? null;

  return {
    version: REPAIR_CANDIDATE_EVALUATION_VERSION,
    candidateId: input.candidate.id,
    beforeReport: before, afterReport: after,
    beforeDefectFingerprints: beforeFps, afterDefectFingerprints: afterFps,
    resolvedDefectFingerprints: resolved, retainedDefectFingerprints: retained, introducedDefectFingerprints: introduced,
    targetDefectsResolved: targetResolved,
    newHardDefectIntroduced,
    criticalCoverageComplete,
    beforeScore, afterScore,
    scoreDelta: (typeof beforeScore === 'number' && typeof afterScore === 'number') ? Math.round((afterScore - beforeScore) * 10000) / 10000 : null,
    beforeOutputStrategy: before.outputStrategy,
    afterOutputStrategy: after?.outputStrategy ?? null,
    renderPlanHashMatched: input.renderPlanHashMatched,
    exportParityPassed: input.exportParityPassed ?? null,
    permittedByE7,
    selectionTier: null,
    accepted,
    rejectionCodes: Array.from(new Set(rejectionCodes)),
    problems: [],
  };
}

export { defectFingerprint };
export type { CriticalQualityDefectV1 };
