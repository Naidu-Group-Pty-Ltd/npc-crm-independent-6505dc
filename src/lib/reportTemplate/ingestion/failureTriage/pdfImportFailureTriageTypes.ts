/**
 * pdfImportFailureTriageTypes — Phase 8F triage data model.
 *
 * Turns raw PDF-import quality failure/warning codes (from the Phase 8C gate
 * taxonomy, Phase 8D golden regression summaries, or ad-hoc signals) into
 * actionable recovery recommendations: category, severity, owner, primary/
 * secondary recovery actions, and a triage outcome. Pure logic; no persistence.
 */

export const PDF_IMPORT_FAILURE_TRIAGE_VERSION = 'pdf-import-failure-triage-v1';

export type PdfImportFailureTriageCategory =
  | 'import'
  | 'sidecar'
  | 'artifact'
  | 'template'
  | 'visual_quality'
  | 'repair'
  | 'ai_reconciliation'
  | 'export_parity'
  | 'golden_regression'
  | 'auth_security'
  | 'backend_contract'
  | 'diagnostics'
  | 'unknown';

export type PdfImportFailureTriageSeverity = 'info' | 'warning' | 'error' | 'critical';

export type PdfImportFailureTriageOwner =
  | 'operator'
  | 'qa'
  | 'manual_review'
  | 'developer_frontend'
  | 'developer_backend'
  | 'developer_sidecar'
  | 'developer_fullstack'
  | 'unknown';

export type PdfImportRecoveryAction =
  | 'no_action'
  | 'accept_warning'
  | 'manual_review'
  | 'rerun_import'
  | 'rerun_visual_qa'
  | 'rerun_repair'
  | 'run_ai_reconciliation'
  | 'rerun_export_parity'
  | 'reapply_template'
  | 'inspect_template_editor'
  | 'inspect_storage_artifacts'
  | 'inspect_pdf_import_jobs'
  | 'inspect_supabase_function_logs'
  | 'inspect_cloud_run_logs'
  | 'patch_frontend'
  | 'patch_supabase_function'
  | 'patch_sidecar'
  | 'patch_renderer'
  | 'rerun_golden_regression'
  | 'escalate_to_developer';

export type PdfImportTriageOutcome =
  | 'resolved'
  | 'monitor'
  | 'action_required'
  | 'blocked'
  | 'escalate';

export interface PdfImportFailureSignal {
  code: string;
  message?: string | null;
  source?: string | null;
  details?: Record<string, unknown>;
}

export interface PdfImportFailureTriageRule {
  code: string;
  category: PdfImportFailureTriageCategory;
  severity: PdfImportFailureTriageSeverity;
  owner: PdfImportFailureTriageOwner;
  primaryAction: PdfImportRecoveryAction;
  secondaryActions: PdfImportRecoveryAction[];
  outcome: PdfImportTriageOutcome;
  title: string;
  operatorSummary: string;
  developerSummary: string;
  playbookAnchor: string;
}

export interface PdfImportFailureTriageRecommendation {
  version: typeof PDF_IMPORT_FAILURE_TRIAGE_VERSION;
  signal: PdfImportFailureSignal;
  rule: PdfImportFailureTriageRule;
}

export interface PdfImportFailureTriageSummary {
  version: typeof PDF_IMPORT_FAILURE_TRIAGE_VERSION;
  recommendations: PdfImportFailureTriageRecommendation[];
  severity: PdfImportFailureTriageSeverity;
  outcome: PdfImportTriageOutcome;
  primaryOwner: PdfImportFailureTriageOwner;
  primaryAction: PdfImportRecoveryAction;
  actionLabels: string[];
  generatedAt: string;
}

export interface PdfImportFailureTriageInput {
  signals: PdfImportFailureSignal[];
  now?: () => Date;
}
