/**
 * operatorControlDisplay — Phase 10G.
 *
 * UI-safe labels, Badge tones, and formatting for production operator controls.
 * Pure; no network.
 */
import { getOperatorControlDefinition } from './operatorControlCatalog';
import type {
  OperatorControlId,
  OperatorControlSafetyLevel,
  OperatorControlState,
  OperatorDecisionState,
  ProductionOperatorControlAudit,
} from './operatorControlTypes';

export type OperatorControlDisplayTone =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'outline';

const STATE_LABELS: Record<string, string> = {
  available: 'Available',
  recommended: 'Recommended',
  requires_confirmation: 'Requires confirmation',
  manual_only: 'Manual only',
  blocked: 'Blocked',
  disabled: 'Disabled',
  completed: 'Completed',
  failed: 'Failed',
};

const SAFETY_LABELS: Record<string, string> = {
  read_only: 'Read only',
  metadata_write: 'Metadata write',
  orchestrator_safe: 'Orchestrator safe',
  manual_workflow: 'Manual workflow',
  blocked: 'Blocked',
};

const DECISION_LABELS: Record<string, string> = {
  not_reviewed: 'Not reviewed',
  accepted: 'Accepted',
  accepted_with_warnings: 'Accepted with warnings',
  rejected: 'Rejected',
  needs_rerun: 'Needs rerun',
  manual_review_required: 'Manual review required',
  blocked: 'Blocked',
};

export function getOperatorControlLabel(
  controlId: OperatorControlId | string | null | undefined,
): string {
  if (!controlId) return 'Unknown';
  return getOperatorControlDefinition(controlId as OperatorControlId)?.label ?? 'Unknown';
}

export function getOperatorControlStateLabel(
  state: OperatorControlState | string | null | undefined,
): string {
  if (!state) return 'Available';
  return STATE_LABELS[state] ?? 'Available';
}

export function getOperatorControlStateTone(
  state: OperatorControlState | string | null | undefined,
): OperatorControlDisplayTone {
  switch (state) {
    case 'available':
    case 'completed':
      return 'default';
    case 'recommended':
    case 'requires_confirmation':
      return 'secondary';
    case 'blocked':
    case 'failed':
      return 'destructive';
    case 'manual_only':
    case 'disabled':
    default:
      return 'outline';
  }
}

export function getOperatorControlSafetyLabel(
  safetyLevel: OperatorControlSafetyLevel | string | null | undefined,
): string {
  if (!safetyLevel) return 'Read only';
  return SAFETY_LABELS[safetyLevel] ?? 'Read only';
}

export function getOperatorControlSafetyTone(
  safetyLevel: OperatorControlSafetyLevel | string | null | undefined,
): OperatorControlDisplayTone {
  switch (safetyLevel) {
    case 'metadata_write':
    case 'orchestrator_safe':
      return 'default';
    case 'manual_workflow':
      return 'secondary';
    case 'blocked':
      return 'destructive';
    case 'read_only':
    default:
      return 'outline';
  }
}

export function getOperatorDecisionLabel(
  decision: OperatorDecisionState | string | null | undefined,
): string {
  if (!decision) return 'Not reviewed';
  return DECISION_LABELS[decision] ?? 'Not reviewed';
}

export function getOperatorDecisionTone(
  decision: OperatorDecisionState | string | null | undefined,
): OperatorControlDisplayTone {
  switch (decision) {
    case 'accepted':
      return 'default';
    case 'accepted_with_warnings':
    case 'needs_rerun':
    case 'manual_review_required':
      return 'secondary';
    case 'rejected':
    case 'blocked':
      return 'destructive';
    case 'not_reviewed':
    default:
      return 'outline';
  }
}

export function getProductionOperatorControlHeadline(
  audit: ProductionOperatorControlAudit | null | undefined,
): string {
  if (!audit) return 'No production operator controls';
  const decision = getOperatorDecisionLabel(audit.operatorState?.decision);
  const recommended = audit.controls.filter((c) => c.recommended).length;
  return `Operator decision: ${decision} · ${recommended} recommended control(s)`;
}

export function summarizeProductionOperatorControlAudit(
  audit: ProductionOperatorControlAudit | null | undefined,
): {
  label: string;
  decisionLabel: string;
  tone: OperatorControlDisplayTone;
  recommendedCountLabel: string;
  blockedCountLabel: string;
  manualCountLabel: string;
} {
  if (!audit) {
    return {
      label: 'No production operator controls',
      decisionLabel: 'Not reviewed',
      tone: 'outline',
      recommendedCountLabel: '0',
      blockedCountLabel: '0',
      manualCountLabel: '0',
    };
  }
  const recommended = audit.controls.filter((c) => c.recommended).length;
  const blocked = audit.controls.filter((c) => c.state === 'blocked').length;
  const manual = audit.controls.filter((c) => c.state === 'manual_only').length;
  return {
    label: getProductionOperatorControlHeadline(audit),
    decisionLabel: getOperatorDecisionLabel(audit.operatorState?.decision),
    tone: getOperatorDecisionTone(audit.operatorState?.decision),
    recommendedCountLabel: String(recommended),
    blockedCountLabel: String(blocked),
    manualCountLabel: String(manual),
  };
}
