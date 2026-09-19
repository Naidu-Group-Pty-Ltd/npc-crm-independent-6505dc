/**
 * pdfImportPerformanceTypes — Phase 10F.
 *
 * Data model for the deterministic Performance + Cost Optimization audit. This
 * layer is advisory-first: it identifies expensive operations, duplicate work,
 * and stale metadata, and produces safe reuse/optimization recommendations. It
 * never skips required quality gates, calls AI, mutates templates, or changes
 * pipeline behaviour. Metadata only; never stores raw PDF/OCR text or rasters.
 */
export const PDF_IMPORT_PERFORMANCE_AUDIT_VERSION = 'pdf-import-performance-cost-audit-v1';

export type PdfImportPerformanceDomain =
  | 'artifact_fetch'
  | 'visual_qa'
  | 'repair'
  | 'ai_reconciliation'
  | 'export_parity'
  | 'golden_regression'
  | 'metadata'
  | 'diagnostics'
  | 'ui_dashboard'
  | 'storage';

export type PdfImportCostLevel =
  | 'negligible'
  | 'low'
  | 'medium'
  | 'high'
  | 'very_high'
  | 'unknown';

export type PdfImportPerformanceRiskLevel =
  | 'low'
  | 'medium'
  | 'high'
  | 'critical'
  | 'unknown';

export type PdfImportOptimizationAction =
  | 'no_action'
  | 'reuse_existing_result'
  | 'rebuild_stale_metadata'
  | 'defer_expensive_step'
  | 'require_operator_confirmation'
  | 'compact_metadata'
  | 'limit_query_scope'
  | 'cache_artifact_lookup'
  | 'rerun_only_if_inputs_changed'
  | 'avoid_ai_reconciliation'
  | 'require_manual_review_before_costly_step'
  | 'inspect_long_running_job'
  | 'inspect_storage_artifacts'
  | 'archive_or_prune_old_history'
  | 'document_manual_gap';

export type PdfImportMetadataStalenessStatus =
  | 'fresh'
  | 'stale'
  | 'missing'
  | 'unknown'
  | 'not_applicable';

export type PdfImportPerformanceSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface PdfImportPerformanceEvidence {
  code: string;
  label: string;
  value: string | number | boolean | null;
  weight: number;
  message: string;
}

export interface PdfImportPerformanceSignals {
  importId: string | null;
  templateId: string | null;
  sourceFilename: string | null;

  importStatus: string | null;
  pageCount: number | null;
  engineVersion: string | null;

  hasVisualQuality: boolean;
  visualQaScore: number | null;
  visualQaGeneratedAt: string | null;

  hasRepairAudit: boolean;
  repairStatus: string | null;
  repairFinalScore: number | null;
  repairGeneratedAt: string | null;

  hasExportParity: boolean;
  exportParityStatus: string | null;
  exportVsSourceScore: number | null;
  exportParityGeneratedAt: string | null;

  hasGoldenRegression: boolean;
  goldenQualityGateStatus: string | null;
  goldenGeneratedAt: string | null;
  goldenPersistedAt: string | null;

  hasGoldenHistory: boolean;
  goldenHistoryRunCount: number | null;

  hasImportProfile: boolean;
  importProfileCategory: string | null;
  importRiskLevel: string | null;
  importProfileGeneratedAt: string | null;

  hasRepairPatternAnalysis: boolean;
  primaryRepairPatternId: string | null;
  repairPatternSeverity: string | null;
  repairPatternGeneratedAt: string | null;

  hasAdaptiveReconciliationPolicy: boolean;
  adaptiveDecision: string | null;
  adaptiveAiBlocked: boolean | null;
  adaptiveGeneratedAt: string | null;

  hasSelfHealingAudit: boolean;
  selfHealingStatus: string | null;
  selfHealingGeneratedAt: string | null;
  selfHealingExecutedAt: string | null;

  pdfJobDurationMs: number | null;
  pdfJobStatus: string | null;
  pdfJobFailed: boolean | null;

  artifactPathCount: number;
  missingArtifactPathCount: number;

  warningCount: number;
  failureCount: number;
}

export interface PdfImportStepCost {
  stepId: string;
  label: string;
  domain: PdfImportPerformanceDomain;
  costLevel: PdfImportCostLevel;
  estimatedCostScore: number;
  shouldRequireConfirmation: boolean;
  canReuseExistingResult: boolean;
  reason: string;
}

export interface PdfImportMetadataStaleness {
  metadataKey: string;
  status: PdfImportMetadataStalenessStatus;
  reason: string;
  generatedAt: string | null;
  dependsOn: string[];
}

export interface PdfImportDuplicateWorkSignal {
  code: string;
  count: number;
  message: string;
}

export interface PdfImportOptimizationRecommendation {
  id: string;
  domain: PdfImportPerformanceDomain;
  action: PdfImportOptimizationAction;
  severity: PdfImportPerformanceSeverity;
  costLevel: PdfImportCostLevel;
  confidence: number;
  message: string;
  evidence: PdfImportPerformanceEvidence[];
}

export interface PdfImportPerformanceCostAudit {
  version: typeof PDF_IMPORT_PERFORMANCE_AUDIT_VERSION;

  importId: string | null;
  templateId: string | null;
  sourceFilename: string | null;

  overallCostLevel: PdfImportCostLevel;
  overallRiskLevel: PdfImportPerformanceRiskLevel;

  estimatedCostScore: number;
  estimatedWasteScore: number;

  signals: PdfImportPerformanceSignals;
  stepCosts: PdfImportStepCost[];
  staleness: PdfImportMetadataStaleness[];
  duplicateWork: PdfImportDuplicateWorkSignal[];
  recommendations: PdfImportOptimizationRecommendation[];

  evidence: PdfImportPerformanceEvidence[];
  warnings: string[];
  blockers: string[];

  generatedAt: string;
  persistedAt: string | null;
}

export interface BuildPdfImportPerformanceAuditOptions {
  importId?: string | null;
  templateId?: string | null;
  sourceFilename?: string | null;
  snapshot?: unknown;
  importIntelligenceProfile?: unknown;
  repairPatternAnalysis?: unknown;
  adaptiveReconciliationPolicy?: unknown;
  selfHealingRetryAudit?: unknown;
  visualQualitySummary?: unknown;
  repairSummary?: unknown;
  exportParitySummary?: unknown;
  goldenRegressionSummary?: unknown;
  goldenHistory?: unknown[];
  pdfImportJob?: unknown;
  now?: () => Date;
}

export type SavePdfImportPerformanceAuditResult =
  | { kind: 'ok' }
  | { kind: 'error'; message: string };

export type LoadPdfImportPerformanceAuditResult =
  | { kind: 'ok'; audit: PdfImportPerformanceCostAudit }
  | { kind: 'missing' }
  | { kind: 'error'; message: string };
