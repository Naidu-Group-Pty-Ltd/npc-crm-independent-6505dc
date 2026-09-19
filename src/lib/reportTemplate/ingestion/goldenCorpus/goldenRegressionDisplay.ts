/**
 * goldenRegressionDisplay — Phase 8E dashboard formatting helpers.
 *
 * Pure display logic (no I/O) mapping a persisted golden regression summary's
 * status/decision/counts into a badge label, tone, and an action-required state
 * for the Template Import Quality diagnostics table.
 */

export type GoldenRegressionDisplayTone =
  | 'success'
  | 'warning'
  | 'destructive'
  | 'secondary'
  | 'outline';

export type GoldenRegressionActionRequired = 'none' | 'review' | 'rerun' | 'fix';

export interface GoldenRegressionDisplayInput {
  qualityGateStatus?: string | null;
  operatorDecision?: string | null;
  warningCount?: number | null;
  failureCount?: number | null;
  exportParityStatus?: string | null;
  manualReviewRequired?: boolean | null;
}

export interface GoldenRegressionDisplayState {
  label: string;
  tone: GoldenRegressionDisplayTone;
  actionRequired: GoldenRegressionActionRequired;
  actionLabel: string;
}

function state(
  label: string,
  tone: GoldenRegressionDisplayTone,
  actionRequired: GoldenRegressionActionRequired,
  actionLabel: string,
): GoldenRegressionDisplayState {
  return { label, tone, actionRequired, actionLabel };
}

/**
 * Resolve the dashboard display state. Ordering is significant: hard-fail signals
 * (failures, fail/blocked gate status, rejected decision) win over warnings, which
 * win over pass. A missing summary resolves to "Not run".
 */
export function getGoldenRegressionDisplayState(
  input: GoldenRegressionDisplayInput,
): GoldenRegressionDisplayState {
  const gate = input.qualityGateStatus ?? null;
  const decision = input.operatorDecision ?? null;
  const failureCount = Number(input.failureCount) || 0;
  const warningCount = Number(input.warningCount) || 0;

  // Hard failures first.
  if (failureCount > 0) return state('Fail', 'destructive', 'fix', 'Fix');
  if (gate === 'fail') return state('Fail', 'destructive', 'fix', 'Fix');
  if (gate === 'blocked') return state('Blocked', 'destructive', 'rerun', 'Rerun');
  if (decision === 'rejected') return state('Rejected', 'destructive', 'fix', 'Fix');
  if (decision === 'needs_rerun') return state('Needs rerun', 'warning', 'rerun', 'Rerun');

  // Warnings / review.
  if (gate === 'warning') return state('Warning', 'warning', 'review', 'Review');
  if (warningCount > 0) return state('Warning', 'warning', 'review', 'Review');
  if (decision === 'not_reviewed') return state('Review', 'warning', 'review', 'Review');
  if (decision === 'accepted_with_warnings') return state('Review', 'warning', 'review', 'Review');
  if (input.exportParityStatus === 'manual_required') return state('Review', 'warning', 'review', 'Review');
  if (input.manualReviewRequired === true) return state('Review', 'warning', 'review', 'Review');

  // Clean.
  if (gate === 'pass' && decision === 'accepted') return state('Pass', 'success', 'none', 'None');

  // Unevaluated / missing.
  if (gate === 'not_evaluated') return state('Not evaluated', 'outline', 'review', 'Review');
  return state('Not run', 'outline', 'review', 'Review');
}

/** Format a 0..1 score as a whole-percent string, or "—" when missing/non-finite. */
export function formatGoldenRegressionScore(score: number | null | undefined): string {
  if (typeof score !== 'number' || !Number.isFinite(score)) return '—';
  return `${Math.round(score * 100)}%`;
}
