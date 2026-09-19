/**
 * pdfImportMonitoringTypes — Phase 9F monitoring + alert-readiness data model.
 *
 * Defines the monitoring domains, signals, severities, owners, actions, alert /
 * summary / payload shapes, and the metric-snapshot + thresholds the evaluator
 * consumes. Phase 9F only *generates* `open` alerts and payloads — nothing here
 * (or in the evaluator) sends an external alert. Severity/owner terminology is
 * aligned with the Phase 8F failure triage and Phase 9E release gate layers.
 */

export const PDF_IMPORT_MONITORING_VERSION = 'pdf-import-monitoring-v1';

export type PdfImportMonitoringDomain =
  | 'import_pipeline'
  | 'sidecar_diagnostics'
  | 'artifact_integrity'
  | 'visual_quality'
  | 'repair'
  | 'export_parity'
  | 'golden_regression'
  | 'release_gates'
  | 'backend_contract'
  | 'security_privacy';

export type PdfImportMonitoringSeverity =
  | 'info'
  | 'warning'
  | 'error'
  | 'critical';

export type PdfImportMonitoringStatus =
  | 'open'
  | 'acknowledged'
  | 'resolved'
  | 'muted';

export type PdfImportMonitoringOwner =
  | 'operator'
  | 'qa'
  | 'manual_review'
  | 'developer_frontend'
  | 'developer_backend'
  | 'developer_sidecar'
  | 'developer_fullstack'
  | 'security'
  | 'unknown';

export type PdfImportMonitoringAction =
  | 'no_action'
  | 'review_dashboard'
  | 'run_phase_9f_sql'
  | 'run_release_gate_sql'
  | 'inspect_template_imports'
  | 'inspect_pdf_import_jobs'
  | 'inspect_storage_artifacts'
  | 'inspect_supabase_function_logs'
  | 'inspect_cloud_run_logs'
  | 'rerun_import'
  | 'rerun_visual_qa'
  | 'rerun_repair'
  | 'rerun_export_parity'
  | 'rerun_golden_regression'
  | 'run_failure_triage'
  | 'patch_frontend'
  | 'patch_supabase_function'
  | 'patch_sidecar'
  | 'patch_renderer'
  | 'block_release'
  | 'document_warning'
  | 'escalate';

export type PdfImportMonitoringSignalCode =
  | 'failed_imports_recent'
  | 'stuck_imports_recent'
  | 'diagnostics_jobs_failed'
  | 'engine_version_missing'
  | 'source_rasters_missing'
  | 'visual_quality_missing'
  | 'repair_audit_missing'
  | 'export_parity_missing'
  | 'export_parity_failed'
  | 'export_parity_manual_required'
  | 'manual_review_rate_high'
  | 'golden_quality_gate_failed'
  | 'golden_quality_gate_blocked'
  | 'golden_summary_missing'
  | 'golden_history_missing'
  | 'baseline_degraded'
  | 'corpus_coverage_incomplete'
  | 'release_blocked_database'
  | 'backend_unknown_operation'
  | 'private_artifact_risk';

export interface PdfImportMonitoringMetricSnapshot {
  failedImports24h: number;
  stuckImports30m: number;
  failedDiagnosticsJobs24h: number;
  completedImportsWithoutEngineVersion: number;
  completedImportsMissingVisualQa: number;
  visualQaMissingRepairAudit: number;
  goldenReadyMissingExportParity: number;
  exportParityFailed: number;
  exportParityManualRequired: number;
  recentCompletedImports: number;
  recentManualReviewRequired: number;
  goldenQualityGateFailed: number;
  goldenQualityGateBlocked: number;
  goldenSummariesCount: number;
  goldenHistoryRowsCount: number;
  corpusCoveredCount: number;
  baselineDegradedCount: number;
  releaseBlockedDatabase: boolean;
  backendUnknownOperationCount: number;
  privateArtifactRiskCount: number;
}

export interface PdfImportMonitoringThresholds {
  failedImportsError: number;
  failedImportsCritical: number;
  stuckImportsError: number;
  diagnosticsJobsFailedError: number;
  missingVisualQaWarning: number;
  missingRepairAuditWarning: number;
  exportParityFailedError: number;
  goldenGateFailedCritical: number;
  baselineDegradedWarning: number;
  manualReviewRateWarning: number;
  corpusCoverageExpected: number;
  backendUnknownOperationCritical: number;
  privateArtifactRiskCritical: number;
}

export interface PdfImportMonitoringRule {
  code: PdfImportMonitoringSignalCode;
  domain: PdfImportMonitoringDomain;
  severity: PdfImportMonitoringSeverity;
  owner: PdfImportMonitoringOwner;
  primaryAction: PdfImportMonitoringAction;
  secondaryActions: PdfImportMonitoringAction[];
  releaseBlocking: boolean;
  title: string;
  description: string;
  runbookAnchor: string;
}

export interface PdfImportMonitoringAlert {
  version: typeof PDF_IMPORT_MONITORING_VERSION;
  code: PdfImportMonitoringSignalCode;
  domain: PdfImportMonitoringDomain;
  severity: PdfImportMonitoringSeverity;
  status: PdfImportMonitoringStatus;
  owner: PdfImportMonitoringOwner;
  primaryAction: PdfImportMonitoringAction;
  secondaryActions: PdfImportMonitoringAction[];
  releaseBlocking: boolean;
  title: string;
  message: string;
  metricValue: number | boolean | null;
  threshold: number | boolean | null;
  runbookAnchor: string;
  createdAt: string;
}

export interface PdfImportMonitoringSummary {
  version: typeof PDF_IMPORT_MONITORING_VERSION;
  status:
    | 'healthy'
    | 'warnings_present'
    | 'errors_present'
    | 'critical_alerts_present'
    | 'release_blocked';
  alerts: PdfImportMonitoringAlert[];
  counts: {
    total: number;
    info: number;
    warning: number;
    error: number;
    critical: number;
    releaseBlocking: number;
  };
  primaryOwner: PdfImportMonitoringOwner;
  highestSeverity: PdfImportMonitoringSeverity;
  releaseBlocked: boolean;
  generatedAt: string;
}

export interface PdfImportMonitoringEvaluationInput {
  metrics: PdfImportMonitoringMetricSnapshot;
  thresholds?: Partial<PdfImportMonitoringThresholds>;
  now?: () => Date;
}

export interface PdfImportAlertPayload {
  version: typeof PDF_IMPORT_MONITORING_VERSION;
  title: string;
  severity: PdfImportMonitoringSeverity;
  status: PdfImportMonitoringSummary['status'];
  releaseBlocked: boolean;
  primaryOwner: PdfImportMonitoringOwner;
  alertCount: number;
  criticalCount: number;
  errorCount: number;
  warningCount: number;
  summaryText: string;
  alerts: Array<{
    code: PdfImportMonitoringSignalCode;
    title: string;
    severity: PdfImportMonitoringSeverity;
    owner: PdfImportMonitoringOwner;
    action: PdfImportMonitoringAction;
    message: string;
  }>;
  generatedAt: string;
}
