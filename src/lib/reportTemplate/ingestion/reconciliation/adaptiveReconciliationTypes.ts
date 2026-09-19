/**
 * adaptiveReconciliationTypes — Phase 10D.
 *
 * Type model for the deterministic Adaptive Reconciliation Policy. It decides
 * whether AI reconciliation is not_needed / optional / recommended /
 * manual_review / blocked from import intelligence, repair patterns, and QA
 * signals. It never calls AI, never applies reconciliation, and never stores raw
 * PDF/OCR text.
 */

export const ADAPTIVE_RECONCILIATION_POLICY_VERSION =
  'pdf-import-adaptive-reconciliation-policy-v1';

export type AdaptiveReconciliationDecision =
  | 'not_needed'
  | 'optional'
  | 'recommended'
  | 'manual_review'
  | 'blocked';

export type AdaptiveReconciliationSeverity =
  | 'info'
  | 'low'
  | 'medium'
  | 'high'
  | 'critical';

export type AdaptiveReconciliationRecommendedAction =
  | 'no_action'
  | 'allow_operator_choice'
  | 'run_ai_reconciliation'
  | 'run_ai_reconciliation_with_review'
  | 'require_manual_review'
  | 'block_ai_reconciliation'
  | 'rerun_visual_qa_first'
  | 'rerun_repair_first'
  | 'rerun_export_parity_first'
  | 'inspect_template_editor'
  | 'inspect_repair_patterns'
  | 'inspect_import_profile';

export interface AdaptiveReconciliationEvidence {
  code: string;
  label: string;
  value: string | number | boolean | null;
  weight: number;
  message: string;
}

export interface AdaptiveReconciliationSignals {
  importId: string | null;
  templateId: string | null;
  sourceFilename: string | null;

  profileCategory: string | null;
  importRiskLevel: string | null;
  importConfidence: number | null;
  automationRiskScore: number | null;
  manualReviewLikelihood: number | null;
  ocrRiskScore: number | null;
  tableRiskScore: number | null;
  imageRiskScore: number | null;
  designRiskScore: number | null;

  primaryRepairPatternId: string | null;
  repairPatternSeverity: string | null;
  deterministicRepairStrategy: string | null;
  repairPatternAiUsefulness: string | null;
  repairPatternOperatorReviewRequirement: string | null;
  repairPatternExportParityRequirement: string | null;
  repairPatternConfidence: number | null;

  visualQaScore: number | null;
  visualQaManualReviewRequired: boolean | null;

  repairStatus: string | null;
  repairFinalScore: number | null;
  repairRequiresFallback: boolean | null;
  repairRequiresManualReview: boolean | null;

  exportParityStatus: string | null;
  exportVsSourceScore: number | null;
  editorVsSourceScore: number | null;
  exportVsEditorScore: number | null;

  existingAiReconciliationStatus: string | null;
  existingAiReconciliationRecommendation: string | null;

  goldenQualityGateStatus: string | null;
  goldenWarningCount: number | null;
  goldenFailureCount: number | null;
  baselineOutcome: string | null;

  qualityGateFailures: string[];
  qualityGateWarnings: string[];
  triageFailureCodes: string[];
  triageWarningCodes: string[];
}

export interface AdaptiveReconciliationFlags {
  requiresOperatorConfirmation: boolean;
  requiresManualReview: boolean;
  requiresVisualQaAfterReconciliation: boolean;
  requiresExportParityAfterReconciliation: boolean;
  shouldRerunRepairBeforeReconciliation: boolean;
  aiAllowed: boolean;
  aiBlocked: boolean;
  canProceedWithoutAi: boolean;
}

export interface AdaptiveReconciliationSourceSummary {
  profileCategory: string | null;
  importRiskLevel: string | null;
  primaryRepairPatternId: string | null;
  repairPatternSeverity: string | null;
  visualQaScore: number | null;
  repairStatus: string | null;
  exportParityStatus: string | null;
  goldenQualityGateStatus: string | null;
}

export interface AdaptiveReconciliationPolicy {
  version: typeof ADAPTIVE_RECONCILIATION_POLICY_VERSION;

  importId: string | null;
  templateId: string | null;
  sourceFilename: string | null;

  decision: AdaptiveReconciliationDecision;
  severity: AdaptiveReconciliationSeverity;
  confidence: number;

  recommendedAction: AdaptiveReconciliationRecommendedAction;

  reasons: string[];
  evidence: AdaptiveReconciliationEvidence[];

  flags: AdaptiveReconciliationFlags;
  sourceSummary: AdaptiveReconciliationSourceSummary;

  warnings: string[];
  blockers: string[];

  generatedAt: string;
}

export interface BuildAdaptiveReconciliationPolicyOptions {
  importId?: string | null;
  templateId?: string | null;
  sourceFilename?: string | null;
  snapshot?: unknown;
  importIntelligenceProfile?: unknown;
  repairPatternAnalysis?: unknown;
  visualQualitySummary?: unknown;
  repairSummary?: unknown;
  exportParitySummary?: unknown;
  goldenRegressionSummary?: unknown;
  qualityGateReport?: unknown;
  triageSummary?: unknown;
  existingAiReconciliationSummary?: unknown;
  now?: () => Date;
}

export type SaveAdaptiveReconciliationPolicyResult =
  | { kind: 'ok' }
  | { kind: 'error'; message: string };

export type LoadAdaptiveReconciliationPolicyResult =
  | { kind: 'ok'; policy: AdaptiveReconciliationPolicy }
  | { kind: 'missing' }
  | { kind: 'error'; message: string };
