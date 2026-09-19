/**
 * selfHealingTypes — Phase 10E.
 *
 * Type model for the controlled Self-Healing Retry Orchestration layer. It builds
 * an evidence-based recovery plan with explicit safety gates, may execute only
 * safe/supported metadata-level actions, and persists an audit trail. It never
 * calls AI, mutates templates, reruns imports, or performs browser-dependent
 * actions automatically, and never stores raw PDF/OCR text.
 */

export const SELF_HEALING_RETRY_AUDIT_VERSION =
  'pdf-import-self-healing-retry-audit-v1';

export type SelfHealingMode =
  | 'dry_run'
  | 'audit_only'
  | 'execute_safe'
  | 'execute_confirmed';

export type SelfHealingPlanStatus =
  | 'planned'
  | 'completed'
  | 'completed_with_warnings'
  | 'partial'
  | 'blocked'
  | 'failed'
  | 'no_action';

export type SelfHealingSafetyLevel =
  | 'safe_automatic'
  | 'operator_confirmed'
  | 'manual_only'
  | 'blocked';

export type SelfHealingActionStatus =
  | 'pending'
  | 'skipped'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'manual_required'
  | 'not_supported';

export type SelfHealingActionId =
  | 'reload_snapshot'
  | 'build_import_intelligence_profile'
  | 'persist_import_intelligence_profile'
  | 'build_repair_pattern_analysis'
  | 'persist_repair_pattern_analysis'
  | 'build_adaptive_reconciliation_policy'
  | 'persist_adaptive_reconciliation_policy'
  | 'run_export_parity_automation'
  | 'persist_export_parity_summary'
  | 'rerun_golden_regression'
  | 'persist_golden_regression_summary'
  | 'save_golden_run_history'
  | 'rerun_visual_qa'
  | 'rerun_repair'
  | 'run_ai_reconciliation'
  | 'rerun_export_parity_manual'
  | 'rerun_import'
  | 'inspect_template_editor'
  | 'inspect_storage_artifacts'
  | 'inspect_pdf_import_jobs'
  | 'inspect_supabase_function_logs'
  | 'inspect_cloud_run_logs'
  | 'block_until_manual_review';

export interface SelfHealingEvidence {
  code: string;
  label: string;
  value: string | number | boolean | null;
  weight: number;
  message: string;
}

export interface SelfHealingSignals {
  importId: string | null;
  templateId: string | null;
  sourceFilename: string | null;

  importStatus: string | null;
  templateExists: boolean | null;

  hasVisualQuality: boolean;
  visualQaScore: number | null;
  visualQaManualReviewRequired: boolean | null;

  hasRepairAudit: boolean;
  repairStatus: string | null;
  repairFinalScore: number | null;
  repairRequiresFallback: boolean | null;
  repairRequiresManualReview: boolean | null;

  hasExportParity: boolean;
  exportParityStatus: string | null;
  exportVsSourceScore: number | null;

  hasImportIntelligenceProfile: boolean;
  importProfileCategory: string | null;
  importRiskLevel: string | null;

  hasRepairPatternAnalysis: boolean;
  primaryRepairPatternId: string | null;
  repairPatternSeverity: string | null;
  deterministicRepairStrategy: string | null;
  repairPatternOperatorReviewRequirement: string | null;

  hasAdaptiveReconciliationPolicy: boolean;
  adaptiveDecision: string | null;
  adaptiveRecommendedAction: string | null;
  adaptiveAiBlocked: boolean | null;
  adaptiveRequiresManualReview: boolean | null;
  adaptiveShouldRerunRepairFirst: boolean | null;

  goldenQualityGateStatus: string | null;
  goldenOperatorDecision: string | null;
  goldenFailureCount: number | null;
  goldenWarningCount: number | null;

  triageOutcome: string | null;
  triagePrimaryAction: string | null;
  triageSeverity: string | null;

  baselineOutcome: string | null;

  failureCodes: string[];
  warningCodes: string[];

  previousAuditActionCounts: Record<string, number>;
}

export interface SelfHealingActionDefinition {
  actionId: SelfHealingActionId;
  label: string;
  description: string;
  defaultSafetyLevel: SelfHealingSafetyLevel;
  maxAttempts: number;
  manualReason: string | null;
  blockedReason: string | null;
}

export interface SelfHealingActionPlan {
  actionId: SelfHealingActionId;
  label: string;
  safetyLevel: SelfHealingSafetyLevel;
  status: SelfHealingActionStatus;
  priority: number;
  reasonCodes: string[];
  prerequisites: string[];
  evidence: SelfHealingEvidence[];
  maxAttempts: number;
  attemptCount: number;
  message: string;
  resultMessage?: string | null;
}

export interface SelfHealingPlanSummary {
  totalActions: number;
  executableActions: number;
  completedActions: number;
  failedActions: number;
  skippedActions: number;
  manualActions: number;
  blockedActions: number;
}

export interface SelfHealingRetryAudit {
  version: typeof SELF_HEALING_RETRY_AUDIT_VERSION;

  importId: string | null;
  templateId: string | null;
  sourceFilename: string | null;

  planId: string;
  mode: SelfHealingMode;
  status: SelfHealingPlanStatus;

  actions: SelfHealingActionPlan[];
  summary: SelfHealingPlanSummary;

  warnings: string[];
  blockers: string[];

  generatedAt: string;
  executedAt: string | null;
  persistedAt: string | null;
}

export interface BuildSelfHealingPlanOptions {
  importId?: string | null;
  templateId?: string | null;
  sourceFilename?: string | null;
  mode?: SelfHealingMode;
  snapshot?: unknown;
  importIntelligenceProfile?: unknown;
  repairPatternAnalysis?: unknown;
  adaptiveReconciliationPolicy?: unknown;
  visualQualitySummary?: unknown;
  repairSummary?: unknown;
  exportParitySummary?: unknown;
  goldenRegressionSummary?: unknown;
  qualityGateReport?: unknown;
  triageSummary?: unknown;
  previousAudit?: unknown;
  now?: () => Date;
}

export interface ExecuteSelfHealingPlanOptions {
  audit: SelfHealingRetryAudit;
  mode: SelfHealingMode;
  operatorConfirmed?: boolean;
  now?: () => Date;
}

export type SaveSelfHealingRetryAuditResult =
  | { kind: 'ok' }
  | { kind: 'error'; message: string };

export type LoadSelfHealingRetryAuditResult =
  | { kind: 'ok'; audit: SelfHealingRetryAudit }
  | { kind: 'missing' }
  | { kind: 'error'; message: string };
