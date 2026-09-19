/**
 * operatorControlRules — Phase 10G.
 *
 * Deterministic evaluation of which operator controls are available,
 * recommended, requires_confirmation, manual_only, blocked, or disabled given
 * the current import state. Policy-aware and conservative: unsafe actions are
 * never made executable, and AI/template-mutating controls stay manual-only or
 * blocked.
 */
import {
  getOperatorControlDefinition,
  listOperatorControlDefinitions,
} from './operatorControlCatalog';
import type {
  OperatorControlAvailability,
  OperatorControlDefinition,
  OperatorControlEvidence,
  OperatorControlId,
  OperatorControlSignals,
  OperatorControlState,
} from './operatorControlTypes';
import {
  evaluatePdfImportPermission,
  type PdfImportCapability,
  type PdfImportPermissionContext,
  type PdfImportResolvedRole,
} from '../operatorPermissions';

/**
 * Phase 11B — map an operator control to the capability required to perform it.
 * Read-only navigation/inspection controls map to view/developer capabilities;
 * write/decision controls map to their persist/operator/manual capabilities.
 */
const CONTROL_CAPABILITY_MAP: Partial<Record<OperatorControlId, PdfImportCapability>> = {
  mark_not_reviewed: 'pdf_import.operator.mark_not_reviewed',
  mark_accepted: 'pdf_import.operator.mark_accepted',
  mark_accepted_with_warnings: 'pdf_import.operator.mark_accepted_with_warnings',
  mark_rejected: 'pdf_import.operator.mark_rejected',
  mark_needs_rerun: 'pdf_import.operator.mark_needs_rerun',
  mark_manual_review_required: 'pdf_import.operator.mark_manual_review_required',
  mark_blocked: 'pdf_import.operator.mark_blocked',
  add_operator_note: 'pdf_import.operator.add_note',
  build_import_intelligence_profile: 'pdf_import.build_import_intelligence',
  build_repair_pattern_analysis: 'pdf_import.build_repair_patterns',
  build_adaptive_reconciliation_policy: 'pdf_import.build_adaptive_policy',
  build_self_healing_plan: 'pdf_import.build_self_healing_plan',
  build_performance_cost_audit: 'pdf_import.build_performance_audit',
  run_export_parity_automation: 'pdf_import.run_export_parity_automation',
  rerun_golden_regression: 'pdf_import.run_golden_regression_preview',
  persist_golden_regression_summary: 'pdf_import.persist_golden_summary',
  save_golden_run_history: 'pdf_import.persist_golden_history',
  run_self_healing_execute_safe: 'pdf_import.run_self_healing_execute_safe',
  run_ai_reconciliation_manual: 'pdf_import.manual.run_ai_reconciliation',
  rerun_visual_qa_manual: 'pdf_import.manual.rerun_visual_qa',
  rerun_repair_manual: 'pdf_import.manual.rerun_repair',
  apply_repair_manual: 'pdf_import.manual.apply_repair',
  apply_reconciliation_manual: 'pdf_import.manual.apply_reconciliation',
  rerun_import_manual: 'pdf_import.manual.rerun_import',
  open_template_editor: 'pdf_import.view_console',
  open_template_import_quality: 'pdf_import.view_quality',
  inspect_pdf_import_jobs: 'pdf_import.developer.inspect_jobs',
  inspect_storage_artifacts: 'pdf_import.developer.inspect_storage',
  inspect_logs: 'pdf_import.developer.inspect_logs',
};

export function getRequiredCapabilityForOperatorControl(
  controlId: OperatorControlId,
): PdfImportCapability | null {
  return CONTROL_CAPABILITY_MAP[controlId] ?? null;
}

type Gate = 'pass' | 'warning' | 'fail' | 'blocked' | null;

function gate(signals: OperatorControlSignals): Gate {
  const s = signals.qualityGateStatus;
  if (s === 'pass' || s === 'warning' || s === 'fail' || s === 'blocked') return s;
  return null;
}

function highPerfRisk(signals: OperatorControlSignals): boolean {
  return signals.performanceRiskLevel === 'high' || signals.performanceRiskLevel === 'critical';
}

function expensiveCost(signals: OperatorControlSignals): boolean {
  return signals.performanceCostLevel === 'high' || signals.performanceCostLevel === 'very_high';
}

function manualReviewNeeded(signals: OperatorControlSignals): boolean {
  return signals.adaptiveRequiresManualReview === true
    || signals.visualQaManualReviewRequired === true
    || signals.repairRequiresManualReview === true
    || signals.operatorReviewRequirement === 'required'
    || signals.operatorReviewRequirement === 'block_until_review';
}

/** Policy block that overrides everything else. Returns a reason or null. */
export function isOperatorControlBlockedByPolicy(input: {
  controlId: OperatorControlId;
  signals: OperatorControlSignals;
}): string | null {
  const { controlId, signals } = input;

  if (controlId === 'clear_operator_control_audit') {
    return 'clear_operator_control_audit_disabled_in_phase_10g';
  }

  if (controlId === 'run_ai_reconciliation_manual' || controlId === 'apply_reconciliation_manual') {
    if (signals.adaptiveAiBlocked === true) return 'adaptive_policy_blocks_ai';
  }

  if (controlId === 'apply_repair_manual') {
    if (signals.operatorReviewRequirement === 'block_until_review'
      && signals.previousOperatorAuditDecision !== 'manual_review_required') {
      return 'repair_pattern_requires_review_first';
    }
    if (signals.deterministicRepairStrategy === 'blocked') return 'repair_strategy_blocked';
  }

  if (controlId === 'mark_accepted') {
    const g = gate(signals);
    if (g === 'fail' || g === 'blocked') return 'quality_gate_not_passing';
    if (signals.operatorReviewRequirement === 'block_until_review'
      && signals.previousOperatorAuditDecision !== 'manual_review_required') {
      return 'repair_pattern_requires_review_first';
    }
  }

  if (controlId === 'mark_accepted_with_warnings') {
    const g = gate(signals);
    if (g === 'fail' || g === 'blocked') return 'quality_gate_not_passing';
  }

  if (controlId === 'persist_golden_regression_summary' || controlId === 'save_golden_run_history') {
    if (signals.qualityGateStatus == null && signals.operatorDecision == null) {
      return 'no_golden_regression_summary';
    }
  }

  if (controlId === 'run_self_healing_execute_safe') {
    if (signals.adaptiveAiBlocked === true && (signals.selfHealingBlockedActions ?? 0) > 0
      && !signals.hasSelfHealingAudit) {
      return 'self_healing_unavailable';
    }
  }

  return null;
}

const WRITE_SAFETY = new Set(['metadata_write', 'orchestrator_safe']);

export function isOperatorControlRecommended(input: {
  controlId: OperatorControlId;
  signals: OperatorControlSignals;
}): boolean {
  const { controlId, signals } = input;
  const g = gate(signals);

  switch (controlId) {
    case 'mark_accepted':
      return g === 'pass' && !manualReviewNeeded(signals);
    case 'mark_accepted_with_warnings':
      return g === 'warning';
    case 'mark_rejected':
      return g === 'fail';
    case 'mark_needs_rerun':
      return g === 'fail' || g === 'blocked'
        || ['partial', 'failed', 'blocked'].includes(signals.selfHealingStatus ?? '');
    case 'mark_manual_review_required':
      return manualReviewNeeded(signals);
    case 'mark_blocked':
      return signals.adaptiveAiBlocked === true
        || signals.deterministicRepairStrategy === 'blocked'
        || g === 'blocked';
    case 'build_import_intelligence_profile':
      return !signals.hasImportProfile;
    case 'build_repair_pattern_analysis':
      return !signals.hasRepairPatternAnalysis && signals.hasImportProfile;
    case 'build_adaptive_reconciliation_policy':
      return !signals.hasAdaptivePolicy && signals.hasImportProfile && signals.hasRepairPatternAnalysis;
    case 'build_self_healing_plan':
      return g === 'warning' || g === 'fail' || g === 'blocked'
        || (!signals.hasSelfHealingAudit && ((signals.goldenFailureCount ?? 0) > 0 || (signals.goldenWarningCount ?? 0) > 0));
    case 'build_performance_cost_audit':
      return !signals.hasPerformanceAudit;
    case 'run_export_parity_automation':
      return !signals.hasExportParity;
    case 'run_self_healing_execute_safe':
      return signals.hasSelfHealingAudit
        && (signals.selfHealingStatus === 'planned')
        && signals.adaptiveAiBlocked !== true;
    default:
      return false;
  }
}

export function resolveOperatorControlState(input: {
  controlId: OperatorControlId;
  signals: OperatorControlSignals;
}): {
  state: OperatorControlState;
  recommended: boolean;
  reason: string;
  blockedReason: string | null;
} {
  const { controlId, signals } = input;
  const def = getOperatorControlDefinition(controlId);
  const safety = def?.safetyLevel ?? 'read_only';

  // 1. Policy block always wins.
  const policyBlock = isOperatorControlBlockedByPolicy({ controlId, signals });
  if (policyBlock) {
    return { state: 'blocked', recommended: false, reason: 'Blocked by policy.', blockedReason: policyBlock };
  }

  // 2. Missing importId disables write / orchestrator / manual controls.
  if (!signals.importId && safety !== 'read_only') {
    return { state: 'disabled', recommended: false, reason: 'No import ID; action unavailable.', blockedReason: 'import_id_missing' };
  }

  // 3. Read-only controls are always available.
  if (safety === 'read_only') {
    return { state: 'available', recommended: false, reason: 'Read-only navigation/inspection.', blockedReason: null };
  }

  // 4. Manual workflow controls are surfaced as manual_only (never executed here).
  if (safety === 'manual_workflow') {
    const recommended =
      (controlId === 'rerun_import_manual' && (signals.importStatus === 'failed'))
      || (controlId === 'apply_repair_manual' && manualReviewNeeded(signals) && signals.hasRepairAudit)
      || (controlId === 'run_ai_reconciliation_manual' && signals.adaptiveDecision === 'recommended');
    return {
      state: 'manual_only',
      recommended,
      reason: def?.manualReason ?? 'Manual workflow; use the existing UI.',
      blockedReason: null,
    };
  }

  // 5. Write/orchestrator controls: recommended vs requires_confirmation vs available.
  const recommended = isOperatorControlRecommended({ controlId, signals });

  // Confirmation is required by the catalog, and additionally for expensive
  // orchestrator actions under high performance risk.
  let requiresConfirmation = def?.requiresConfirmation ?? false;
  if (safety === 'orchestrator_safe' && (highPerfRisk(signals) || expensiveCost(signals))
    && (controlId === 'run_export_parity_automation' || controlId === 'rerun_golden_regression' || controlId === 'run_self_healing_execute_safe')) {
    requiresConfirmation = true;
  }

  if (recommended) {
    return { state: 'recommended', recommended: true, reason: 'Recommended by the current import state.', blockedReason: null };
  }
  if (requiresConfirmation) {
    return { state: 'requires_confirmation', recommended: false, reason: 'Available; requires operator confirmation.', blockedReason: null };
  }
  return { state: 'available', recommended: false, reason: 'Available.', blockedReason: null };
}

export function evaluateOperatorControl(input: {
  controlId: OperatorControlId;
  signals: OperatorControlSignals;
  evidence?: OperatorControlEvidence[];
  definition?: OperatorControlDefinition | null;
  permissionContext?: PdfImportPermissionContext;
  resolvedRole?: PdfImportResolvedRole;
}): OperatorControlAvailability {
  const def = input.definition ?? getOperatorControlDefinition(input.controlId);
  const resolved = resolveOperatorControlState({ controlId: input.controlId, signals: input.signals });

  // Whether a confirmation is required is tracked independently of the state
  // (a `requires_confirmation` state OR a recommended write control both need it).
  const baseConfirm = def?.requiresConfirmation ?? false;
  const requiresConfirmation =
    resolved.state === 'requires_confirmation'
    || (baseConfirm && (resolved.state === 'recommended' || resolved.state === 'available')
      && (def?.safetyLevel === 'metadata_write' || def?.safetyLevel === 'orchestrator_safe'));

  const availability: OperatorControlAvailability = {
    controlId: input.controlId,
    label: def?.label ?? input.controlId,
    description: def?.description ?? '',
    state: resolved.state,
    safetyLevel: def?.safetyLevel ?? 'read_only',
    recommended: resolved.recommended,
    requiresConfirmation,
    reason: resolved.reason,
    blockedReason: resolved.blockedReason,
    evidence: input.evidence ?? [],
    requiredCapability: getRequiredCapabilityForOperatorControl(input.controlId),
  };

  // Phase 11B — overlay permission. Precedence:
  //   safety blocked > permission denied > manual_only > requires_confirmation > normal.
  if (input.permissionContext || input.resolvedRole) {
    return applyPermissionOverlay(availability, def?.safetyLevel ?? 'read_only', {
      permissionContext: input.permissionContext,
      resolvedRole: input.resolvedRole,
    });
  }
  return availability;
}

function applyPermissionOverlay(
  availability: OperatorControlAvailability,
  safetyLevel: OperatorControlAvailability['safetyLevel'],
  perm: { permissionContext?: PdfImportPermissionContext; resolvedRole?: PdfImportResolvedRole },
): OperatorControlAvailability {
  const capability = availability.requiredCapability as PdfImportCapability | null | undefined;
  // Controls with no capability requirement (e.g. clear_operator_control_audit)
  // are governed only by safety.
  if (!capability) {
    return { ...availability, allowedByPermission: availability.state !== 'blocked' && availability.state !== 'disabled' };
  }

  const check = evaluatePdfImportPermission({
    context: perm.permissionContext,
    resolvedRole: perm.resolvedRole,
    capability,
    manualOnly: safetyLevel === 'manual_workflow',
    requiresConfirmation: availability.requiresConfirmation,
  });

  const out: OperatorControlAvailability = {
    ...availability,
    requiredCapability: capability,
    permissionDecision: check.decision,
    permissionReason: check.reason,
    allowedByPermission: check.allowed,
  };

  // Safety block always wins.
  if (availability.state === 'blocked') return out;

  // Permission denied → disable the control regardless of its base state.
  if (check.decision === 'denied') {
    return {
      ...out,
      state: 'disabled',
      recommended: false,
      allowedByPermission: false,
      reason: check.reason,
    };
  }

  // manual_only permission keeps the control manual-only (base already reflects it
  // for manual_workflow controls).
  return out;
}

export function evaluateOperatorControls(input: {
  signals: OperatorControlSignals;
  evidence?: OperatorControlEvidence[];
  definitions?: OperatorControlDefinition[];
  permissionContext?: PdfImportPermissionContext;
  resolvedRole?: PdfImportResolvedRole;
}): OperatorControlAvailability[] {
  const defs = input.definitions ?? listOperatorControlDefinitions();
  return defs.map((def) =>
    evaluateOperatorControl({
      controlId: def.controlId,
      signals: input.signals,
      evidence: relevantEvidence(def.controlId, input.evidence ?? []),
      definition: def,
      permissionContext: input.permissionContext,
      resolvedRole: input.resolvedRole,
    }),
  );
}

/** Attach evidence relevant to a control (best-effort by code prefix). */
function relevantEvidence(controlId: OperatorControlId, evidence: OperatorControlEvidence[]): OperatorControlEvidence[] {
  const wants: Record<string, string[]> = {
    mark_accepted: ['quality_gate_pass', 'repair_pattern_block_until_review'],
    mark_accepted_with_warnings: ['quality_gate_warning'],
    mark_rejected: ['quality_gate_fail'],
    mark_blocked: ['quality_gate_blocked', 'adaptive_policy_blocked', 'self_healing_blocked_actions'],
    mark_manual_review_required: ['repair_pattern_block_until_review', 'adaptive_policy_blocked'],
    run_ai_reconciliation_manual: ['adaptive_policy_blocked', 'adaptive_policy_recommended'],
    apply_reconciliation_manual: ['adaptive_policy_blocked'],
    build_import_intelligence_profile: ['profile_missing'],
    run_export_parity_automation: ['export_parity_missing'],
    run_self_healing_execute_safe: ['self_healing_blocked_actions'],
    build_performance_cost_audit: ['high_performance_risk'],
  };
  const codes = wants[controlId];
  if (!codes) return [];
  return evidence.filter((e) => codes.includes(e.code));
}
