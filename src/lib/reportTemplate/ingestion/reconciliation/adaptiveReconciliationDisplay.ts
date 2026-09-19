/**
 * adaptiveReconciliationDisplay — Phase 10D.
 *
 * UI-safe labels, Badge tones, and formatting for the Adaptive Reconciliation
 * Policy. Pure; no network.
 */
import type {
  AdaptiveReconciliationDecision,
  AdaptiveReconciliationPolicy,
  AdaptiveReconciliationRecommendedAction,
  AdaptiveReconciliationSeverity,
} from './adaptiveReconciliationTypes';

export type AdaptiveReconciliationDisplayTone =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'outline';

const DECISION_LABELS: Record<string, string> = {
  not_needed: 'Not needed',
  optional: 'Optional',
  recommended: 'Recommended',
  manual_review: 'Manual review',
  blocked: 'Blocked',
};

const SEVERITY_LABELS: Record<string, string> = {
  info: 'Info',
  low: 'Low severity',
  medium: 'Medium severity',
  high: 'High severity',
  critical: 'Critical severity',
};

const ACTION_LABELS: Record<string, string> = {
  no_action: 'No action',
  allow_operator_choice: 'Operator choice',
  run_ai_reconciliation: 'Run AI reconciliation',
  run_ai_reconciliation_with_review: 'Run AI with review',
  require_manual_review: 'Require manual review',
  block_ai_reconciliation: 'Block AI reconciliation',
  rerun_visual_qa_first: 'Rerun Visual QA first',
  rerun_repair_first: 'Rerun repair first',
  rerun_export_parity_first: 'Rerun export parity first',
  inspect_template_editor: 'Inspect template editor',
  inspect_repair_patterns: 'Inspect repair patterns',
  inspect_import_profile: 'Inspect import profile',
};

export function getAdaptiveReconciliationDecisionLabel(
  decision: AdaptiveReconciliationDecision | string | null | undefined,
): string {
  if (!decision) return 'Unknown';
  return DECISION_LABELS[decision] ?? 'Unknown';
}

export function getAdaptiveReconciliationSeverityLabel(
  severity: AdaptiveReconciliationSeverity | string | null | undefined,
): string {
  if (!severity) return 'Info';
  return SEVERITY_LABELS[severity] ?? 'Info';
}

export function getAdaptiveReconciliationActionLabel(
  action: AdaptiveReconciliationRecommendedAction | string | null | undefined,
): string {
  if (!action) return 'No action';
  return ACTION_LABELS[action] ?? 'No action';
}

export function getAdaptiveReconciliationDecisionTone(
  decision: AdaptiveReconciliationDecision | string | null | undefined,
): AdaptiveReconciliationDisplayTone {
  switch (decision) {
    case 'not_needed':
      return 'default';
    case 'optional':
    case 'recommended':
      return 'secondary';
    case 'manual_review':
    case 'blocked':
      return 'destructive';
    default:
      return 'outline';
  }
}

export function getAdaptiveReconciliationSeverityTone(
  severity: AdaptiveReconciliationSeverity | string | null | undefined,
): AdaptiveReconciliationDisplayTone {
  switch (severity) {
    case 'info':
      return 'outline';
    case 'low':
      return 'default';
    case 'medium':
      return 'secondary';
    case 'high':
    case 'critical':
      return 'destructive';
    default:
      return 'outline';
  }
}

export function formatAdaptiveReconciliationConfidence(
  confidence: number | null | undefined,
): string {
  if (confidence === null || confidence === undefined || Number.isNaN(confidence)) return '—';
  return `${Math.round(confidence * 100)}%`;
}

export function getAdaptiveReconciliationHeadline(
  policy: AdaptiveReconciliationPolicy | null | undefined,
): string {
  if (!policy) return 'No adaptive reconciliation policy';
  return `AI reconciliation ${getAdaptiveReconciliationDecisionLabel(policy.decision).toLowerCase()} · ${getAdaptiveReconciliationSeverityLabel(policy.severity)}`;
}

export function summarizeAdaptiveReconciliationPolicy(
  policy: AdaptiveReconciliationPolicy | null | undefined,
): {
  label: string;
  severityLabel: string;
  tone: AdaptiveReconciliationDisplayTone;
  confidenceLabel: string;
  actionLabel: string;
} {
  if (!policy) {
    return {
      label: 'No adaptive reconciliation policy',
      severityLabel: 'Info',
      tone: 'outline',
      confidenceLabel: '—',
      actionLabel: 'No action',
    };
  }
  return {
    label: getAdaptiveReconciliationDecisionLabel(policy.decision),
    severityLabel: getAdaptiveReconciliationSeverityLabel(policy.severity),
    tone: getAdaptiveReconciliationDecisionTone(policy.decision),
    confidenceLabel: formatAdaptiveReconciliationConfidence(policy.confidence),
    actionLabel: getAdaptiveReconciliationActionLabel(policy.recommendedAction),
  };
}
