/**
 * operatorControlTypes — Phase 10G.
 *
 * Data model for the Production Operator Controls layer. It turns the Phase 10
 * intelligence stack into a safe, explicit, audited operator action surface.
 * Controls are policy-aware and non-destructive by default: nothing here calls
 * AI, mutates templates, applies repair/reconciliation, or reruns imports
 * automatically. Metadata only; never stores raw PDF/OCR text or rasters.
 */
export const PRODUCTION_OPERATOR_CONTROL_AUDIT_VERSION =
  'pdf-import-production-operator-control-audit-v1';

export type OperatorControlId =
  | 'mark_not_reviewed'
  | 'mark_accepted'
  | 'mark_accepted_with_warnings'
  | 'mark_rejected'
  | 'mark_needs_rerun'
  | 'mark_manual_review_required'
  | 'mark_blocked'
  | 'add_operator_note'
  | 'build_import_intelligence_profile'
  | 'build_repair_pattern_analysis'
  | 'build_adaptive_reconciliation_policy'
  | 'build_self_healing_plan'
  | 'build_performance_cost_audit'
  | 'run_export_parity_automation'
  | 'rerun_golden_regression'
  | 'persist_golden_regression_summary'
  | 'save_golden_run_history'
  | 'run_self_healing_execute_safe'
  | 'open_template_editor'
  | 'open_template_import_quality'
  | 'rerun_visual_qa_manual'
  | 'rerun_repair_manual'
  | 'run_ai_reconciliation_manual'
  | 'apply_repair_manual'
  | 'apply_reconciliation_manual'
  | 'rerun_import_manual'
  | 'inspect_storage_artifacts'
  | 'inspect_pdf_import_jobs'
  | 'inspect_logs'
  | 'clear_operator_control_audit';

export type OperatorControlSafetyLevel =
  | 'read_only'
  | 'metadata_write'
  | 'orchestrator_safe'
  | 'manual_workflow'
  | 'blocked';

export type OperatorControlState =
  | 'available'
  | 'recommended'
  | 'requires_confirmation'
  | 'manual_only'
  | 'blocked'
  | 'disabled'
  | 'completed'
  | 'failed';

export type OperatorDecisionState =
  | 'not_reviewed'
  | 'accepted'
  | 'accepted_with_warnings'
  | 'rejected'
  | 'needs_rerun'
  | 'manual_review_required'
  | 'blocked';

export interface OperatorControlEvidence {
  code: string;
  label: string;
  value: string | number | boolean | null;
  weight: number;
  message: string;
}

export interface OperatorControlSignals {
  importId: string | null;
  templateId: string | null;
  sourceFilename: string | null;

  importStatus: string | null;
  templateExists: boolean | null;

  qualityGateStatus: string | null;
  operatorDecision: string | null;
  goldenFailureCount: number | null;
  goldenWarningCount: number | null;

  hasImportProfile: boolean;
  importProfileCategory: string | null;
  importRiskLevel: string | null;

  hasRepairPatternAnalysis: boolean;
  primaryRepairPatternId: string | null;
  repairPatternSeverity: string | null;
  operatorReviewRequirement: string | null;
  deterministicRepairStrategy: string | null;

  hasAdaptivePolicy: boolean;
  adaptiveDecision: string | null;
  adaptiveAction: string | null;
  adaptiveAiBlocked: boolean | null;
  adaptiveRequiresManualReview: boolean | null;

  hasSelfHealingAudit: boolean;
  selfHealingStatus: string | null;
  selfHealingBlockedActions: number | null;
  selfHealingManualActions: number | null;

  hasPerformanceAudit: boolean;
  performanceRiskLevel: string | null;
  performanceCostLevel: string | null;

  hasExportParity: boolean;
  exportParityStatus: string | null;

  hasVisualQuality: boolean;
  visualQaManualReviewRequired: boolean | null;

  hasRepairAudit: boolean;
  repairStatus: string | null;
  repairRequiresManualReview: boolean | null;
  repairRequiresFallback: boolean | null;

  previousOperatorAuditDecision: OperatorDecisionState | null;
  previousOperatorAuditBlocked: boolean | null;

  failureCodes: string[];
  warningCodes: string[];
}

export interface OperatorControlDefinition {
  controlId: OperatorControlId;
  label: string;
  description: string;
  safetyLevel: OperatorControlSafetyLevel;
  requiresConfirmation: boolean;
  defaultState: OperatorControlState;
  manualReason: string | null;
  blockedReason: string | null;
}

export interface OperatorControlAvailability {
  controlId: OperatorControlId;
  label: string;
  description: string;
  state: OperatorControlState;
  safetyLevel: OperatorControlSafetyLevel;
  recommended: boolean;
  requiresConfirmation: boolean;
  reason: string;
  blockedReason: string | null;
  evidence: OperatorControlEvidence[];
  // Phase 11B — optional permission overlay. `requiredCapability` is the
  // capability string this control maps to; when a permission context is
  // supplied to the rules evaluator, the remaining fields are populated. Kept as
  // strings to avoid a hard type dependency / circular import.
  requiredCapability?: string | null;
  permissionDecision?: string | null;
  permissionReason?: string | null;
  allowedByPermission?: boolean;
}

export interface OperatorControlExecutionRequest {
  importId: string;
  templateId?: string | null;
  controlId: OperatorControlId;
  note?: string | null;
  operatorConfirmed?: boolean;
  // Phase 11B — optional permission context/role for a second enforcement layer.
  // Typed loosely to avoid a circular import with operatorPermissions.
  permissionContext?: unknown;
  resolvedRole?: unknown;
}

export interface OperatorControlExecutionResult {
  controlId: OperatorControlId;
  status: 'completed' | 'failed' | 'blocked' | 'manual_required' | 'not_supported';
  message: string;
  metadataPatch?: Record<string, unknown> | null;
  executedAt: string;
}

export interface ProductionOperatorState {
  decision: OperatorDecisionState;
  manualReviewRequired: boolean;
  blocked: boolean;
  acceptedAt: string | null;
  rejectedAt: string | null;
  lastActionId: OperatorControlId | null;
  lastActionAt: string | null;
}

export interface ProductionOperatorControlAudit {
  version: typeof PRODUCTION_OPERATOR_CONTROL_AUDIT_VERSION;

  importId: string | null;
  templateId: string | null;
  sourceFilename: string | null;

  operatorState: ProductionOperatorState;

  controls: OperatorControlAvailability[];
  executedActions: OperatorControlExecutionResult[];

  notes: string[];
  warnings: string[];
  blockers: string[];

  generatedAt: string;
  persistedAt: string | null;
}

export interface BuildOperatorControlAuditOptions {
  importId?: string | null;
  templateId?: string | null;
  sourceFilename?: string | null;
  snapshot?: unknown;
  goldenRegressionSummary?: unknown;
  importIntelligenceProfile?: unknown;
  repairPatternAnalysis?: unknown;
  adaptiveReconciliationPolicy?: unknown;
  selfHealingRetryAudit?: unknown;
  performanceCostAudit?: unknown;
  exportParitySummary?: unknown;
  visualQualitySummary?: unknown;
  repairSummary?: unknown;
  qualityGateReport?: unknown;
  triageSummary?: unknown;
  previousOperatorControlAudit?: unknown;
  now?: () => Date;
}

export type SaveOperatorControlAuditResult =
  | { kind: 'ok' }
  | { kind: 'error'; message: string };

export type LoadOperatorControlAuditResult =
  | { kind: 'ok'; audit: ProductionOperatorControlAudit }
  | { kind: 'missing' }
  | { kind: 'error'; message: string };
