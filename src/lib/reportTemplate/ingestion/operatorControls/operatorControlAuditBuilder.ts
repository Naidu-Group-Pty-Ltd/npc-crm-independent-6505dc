/**
 * operatorControlAuditBuilder — Phase 10G.
 *
 * Composes signals + control availability into the persistable
 * ProductionOperatorControlAudit. Advisory/state-tracking only; it never
 * executes controls, calls AI, or mutates templates.
 */
import {
  PRODUCTION_OPERATOR_CONTROL_AUDIT_VERSION,
  type BuildOperatorControlAuditOptions,
  type OperatorControlAvailability,
  type OperatorControlExecutionResult,
  type OperatorDecisionState,
  type ProductionOperatorControlAudit,
  type ProductionOperatorState,
} from './operatorControlTypes';
import { extractOperatorControlSignals } from './operatorControlSignals';
import { evaluateOperatorControls } from './operatorControlRules';

const DECISIONS = new Set<OperatorDecisionState>([
  'not_reviewed', 'accepted', 'accepted_with_warnings', 'rejected', 'needs_rerun', 'manual_review_required', 'blocked',
]);

function coerceDecision(value: unknown): OperatorDecisionState | null {
  return typeof value === 'string' && DECISIONS.has(value as OperatorDecisionState)
    ? (value as OperatorDecisionState)
    : null;
}

function mapGoldenDecision(value: string | null): OperatorDecisionState | null {
  switch (value) {
    case 'accepted': return 'accepted';
    case 'accepted_with_warnings': return 'accepted_with_warnings';
    case 'rejected': return 'rejected';
    case 'needs_rerun': return 'needs_rerun';
    case 'not_reviewed': return 'not_reviewed';
    default: return null;
  }
}

export function buildProductionOperatorControlAudit(
  options: BuildOperatorControlAuditOptions,
): ProductionOperatorControlAudit {
  const now = options.now ?? (() => new Date());
  const generatedAt = now().toISOString();

  const extracted = extractOperatorControlSignals(options);
  const signals = extracted.signals;
  const controls: OperatorControlAvailability[] = evaluateOperatorControls({
    signals, evidence: extracted.evidence,
  });

  const prev = options.previousOperatorControlAudit as ProductionOperatorControlAudit | undefined;
  const prevState = prev?.operatorState;

  // Resolve decision: previous audit → golden operator decision → not_reviewed.
  const decision: OperatorDecisionState =
    coerceDecision(prevState?.decision)
    ?? mapGoldenDecision(signals.operatorDecision)
    ?? 'not_reviewed';

  const manualReviewRequired =
    prevState?.manualReviewRequired === true
    || signals.adaptiveRequiresManualReview === true
    || signals.operatorReviewRequirement === 'required'
    || signals.operatorReviewRequirement === 'block_until_review'
    || signals.visualQaManualReviewRequired === true
    || signals.repairRequiresManualReview === true;

  const blocked =
    prevState?.blocked === true
    || (signals.adaptiveAiBlocked === true && signals.qualityGateStatus === 'blocked')
    || signals.deterministicRepairStrategy === 'blocked'
    || signals.qualityGateStatus === 'blocked';

  const operatorState: ProductionOperatorState = {
    decision,
    manualReviewRequired,
    blocked,
    acceptedAt: prevState?.acceptedAt ?? null,
    rejectedAt: prevState?.rejectedAt ?? null,
    lastActionId: prevState?.lastActionId ?? null,
    lastActionAt: prevState?.lastActionAt ?? null,
  };

  const executedActions: OperatorControlExecutionResult[] = Array.isArray(prev?.executedActions)
    ? prev!.executedActions
    : [];
  const notes: string[] = Array.isArray(prev?.notes) ? prev!.notes.slice() : [];

  return {
    version: PRODUCTION_OPERATOR_CONTROL_AUDIT_VERSION,
    importId: signals.importId,
    templateId: signals.templateId,
    sourceFilename: signals.sourceFilename,
    operatorState,
    controls,
    executedActions,
    notes,
    warnings: extracted.warnings,
    blockers: extracted.blockers,
    generatedAt,
    persistedAt: null,
  };
}

const OPERATOR_DECISIONS = new Set<OperatorDecisionState>([
  'not_reviewed', 'accepted', 'accepted_with_warnings', 'rejected', 'needs_rerun', 'manual_review_required', 'blocked',
]);

export function validateProductionOperatorControlAudit(
  audit: ProductionOperatorControlAudit,
): { ok: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (audit.version !== PRODUCTION_OPERATOR_CONTROL_AUDIT_VERSION) errors.push('invalid_version');
  if (!audit.operatorState) errors.push('missing_operator_state');
  else if (!OPERATOR_DECISIONS.has(audit.operatorState.decision)) errors.push('invalid_operator_decision');
  if (!Array.isArray(audit.controls)) errors.push('missing_controls');
  if (!Array.isArray(audit.executedActions)) errors.push('missing_executed_actions');
  if (!Array.isArray(audit.warnings)) warnings.push('missing_warnings_array');
  if (!Array.isArray(audit.blockers)) warnings.push('missing_blockers_array');
  if (!audit.generatedAt) warnings.push('missing_generated_at');

  return { ok: errors.length === 0, errors, warnings };
}
