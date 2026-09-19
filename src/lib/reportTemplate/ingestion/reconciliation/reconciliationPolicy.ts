/**
 * reconciliationPolicy — decide whether AI reconciliation should be offered.
 *
 * Phase 7E. After Visual QA and/or deterministic Repair have run, this pure
 * helper turns the available quality signals into a user-facing recommendation.
 * It NEVER auto-runs anything (`shouldAutoRun` is always false) — it only advises
 * the UI whether to surface the "Run AI reconciliation" action and how strongly.
 */

export type ReconciliationRecommendation =
  | 'not_needed'
  | 'optional'
  | 'recommended'
  | 'manual_review';

export interface ReconciliationPolicyInput {
  visualQaScore: number | null;
  manualReviewRequired?: boolean;
  requiresFallback?: boolean;
  repairStatus?: string | null;
  repairFinalScore?: number | null;
  repairAppliedPatchCount?: number | null;
  sourceRasterCount?: number | null;
  problemCount?: number | null;
}

export interface ReconciliationPolicyDecision {
  recommendation: ReconciliationRecommendation;
  shouldShowAction: boolean;
  shouldAutoRun: boolean;
  reason: string;
  severity: 'none' | 'low' | 'medium' | 'high';
  thresholds: {
    highQuality: number;
    minimumAcceptable: number;
  };
}

export const DEFAULT_RECONCILIATION_THRESHOLDS = {
  highQuality: 0.92,
  minimumAcceptable: 0.80,
} as const;

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function evaluateReconciliationPolicy(
  input: ReconciliationPolicyInput,
): ReconciliationPolicyDecision {
  const thresholds = { ...DEFAULT_RECONCILIATION_THRESHOLDS };
  // Phase 7E hard rule: AI reconciliation is never auto-run.
  const decide = (
    recommendation: ReconciliationRecommendation,
    shouldShowAction: boolean,
    severity: ReconciliationPolicyDecision['severity'],
    reason: string,
  ): ReconciliationPolicyDecision => ({
    recommendation,
    shouldShowAction,
    shouldAutoRun: false,
    severity,
    reason,
    thresholds,
  });

  // 1. Missing source raster evidence — cannot evaluate safely.
  const rasterCount = input.sourceRasterCount;
  if (rasterCount == null || rasterCount <= 0) {
    return decide(
      'manual_review',
      false,
      'high',
      'Source raster evidence is missing, so AI reconciliation cannot be safely evaluated.',
    );
  }

  // 2. Visual QA flagged manual review.
  if (input.manualReviewRequired) {
    return decide(
      'manual_review',
      true,
      'high',
      'Visual QA requires manual review. AI reconciliation may assist, but the result must be checked before applying.',
    );
  }

  // 3. Repair required a fallback.
  if (input.requiresFallback) {
    return decide(
      'manual_review',
      true,
      'high',
      'Fallback was required. AI reconciliation may assist, but the result cannot be trusted automatically.',
    );
  }

  // 4. Deterministic repair failed — recommend the assisted step regardless of the
  //    (necessarily low/absent) score. Placed before the score bands so a failed
  //    repair with an otherwise "acceptable" score is still escalated.
  if (String(input.repairStatus ?? '').toLowerCase() === 'failed') {
    return decide(
      'recommended',
      true,
      'medium',
      'Deterministic repair failed. AI reconciliation is recommended as the next assisted improvement step.',
    );
  }

  // 5. Choose the score: prefer the repaired final score, else the Visual QA score.
  const score = finiteOrNull(input.repairFinalScore) ?? finiteOrNull(input.visualQaScore);
  if (score == null) {
    return decide(
      'optional',
      true,
      'low',
      'Visual score is unavailable. AI reconciliation can be run manually after reviewing the import.',
    );
  }

  // 6. Already high quality.
  if (score >= thresholds.highQuality) {
    return decide('not_needed', false, 'none', 'Visual quality is already above the high-quality threshold.');
  }

  // 7. Acceptable but improvable.
  if (score >= thresholds.minimumAcceptable) {
    return decide(
      'optional',
      true,
      'low',
      'Visual quality is acceptable, but AI reconciliation may improve layout fidelity.',
    );
  }

  // 8. Below the acceptable threshold.
  return decide(
    'recommended',
    true,
    'medium',
    'Visual quality is below the acceptable threshold. AI reconciliation is recommended before applying.',
  );
}
