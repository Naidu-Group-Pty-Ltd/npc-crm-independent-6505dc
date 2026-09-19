/**
 * pdfImportClientReportTypes — Phase 11G client-safe reporting + audit export.
 *
 * Phase 11G is the boundary between internal PDF-import diagnostics and external
 * communication. It transforms internal QA/operator/regression state into
 * sanitized, approved, non-sensitive report summaries. It NEVER calls AI, never
 * mutates templates, never sends email, never creates public links, and never
 * exposes raw PDFs, screenshots, signed URLs, storage paths, raw OCR/extracted
 * text, raw metadata JSON, or logs. These types are pure data.
 */
export const PDF_IMPORT_CLIENT_REPORT_VERSION = 'pdf-import-client-report-v1';

export type PdfImportClientReportType =
  | 'import_status_summary'
  | 'template_quality_summary'
  | 'manual_review_summary'
  | 'accepted_with_warnings_summary'
  | 'rejected_import_summary'
  | 'production_audit_summary'
  | 'release_readiness_summary';

export const PDF_IMPORT_CLIENT_REPORT_TYPES: PdfImportClientReportType[] = [
  'import_status_summary',
  'template_quality_summary',
  'manual_review_summary',
  'accepted_with_warnings_summary',
  'rejected_import_summary',
  'production_audit_summary',
  'release_readiness_summary',
];

export type PdfImportClientReportAudience =
  | 'internal_operator'
  | 'internal_business'
  | 'external_client';

export const PDF_IMPORT_CLIENT_REPORT_AUDIENCES: PdfImportClientReportAudience[] = [
  'internal_operator',
  'internal_business',
  'external_client',
];

export type PdfImportClientReportSafetyLevel =
  | 'safe'
  | 'safe_with_warnings'
  | 'internal_only'
  | 'blocked';

export type PdfImportClientReportStatus =
  | 'draft'
  | 'pending_review'
  | 'approved'
  | 'exported'
  | 'rejected'
  | 'superseded';

export type PdfImportClientReportExportFormat = 'json' | 'markdown' | 'html' | 'pdf';

export interface PdfImportClientReportRedaction {
  code: string;
  field: string;
  reason: string;
}

export interface PdfImportClientReportSection {
  id: string;
  title: string;
  body: string;
  status: 'pass' | 'warning' | 'fail' | 'info' | 'not_applicable';
  items: string[];
}

export interface PdfImportClientReportPayload {
  version: typeof PDF_IMPORT_CLIENT_REPORT_VERSION;
  reportType: PdfImportClientReportType;
  audience: PdfImportClientReportAudience;
  safetyLevel: PdfImportClientReportSafetyLevel;
  status: PdfImportClientReportStatus;
  importId: string | null;
  templateId: string | null;
  title: string;
  summary: string;
  sections: PdfImportClientReportSection[];
  redactions: PdfImportClientReportRedaction[];
  sourceSummary: {
    operatorDecision: string | null;
    qualityGateStatus: string | null;
    exportParityStatus: string | null;
    manualReviewRequired: boolean | null;
    generatedFrom: string[];
  };
  generatedAt: string;
}

export interface PdfImportClientReportRecord extends PdfImportClientReportPayload {
  id: string;
  generatedBy: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  approvalNote: string | null;
  exportedBy: string | null;
  exportedAt: string | null;
  exportNote: string | null;
  exportFormat: PdfImportClientReportExportFormat | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectionNote: string | null;
  supersededBy: string | null;
  supersededAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BuildPdfImportClientReportOptions {
  reportType: PdfImportClientReportType;
  audience?: PdfImportClientReportAudience;
  importId?: string | null;
  templateId?: string | null;
  snapshot?: unknown;
  goldenRegressionSummary?: unknown;
  exportParitySummary?: unknown;
  visualQualitySummary?: unknown;
  repairSummary?: unknown;
  importIntelligenceProfile?: unknown;
  repairPatternAnalysis?: unknown;
  adaptiveReconciliationPolicy?: unknown;
  selfHealingRetryAudit?: unknown;
  performanceCostAudit?: unknown;
  productionOperatorControlAudit?: unknown;
  monitoringEvents?: unknown[];
  retentionEvents?: unknown[];
  operatorNote?: string | null;
  now?: () => Date;
}

export type PdfImportClientReportAction =
  | 'review'
  | 'approve'
  | 'reject'
  | 'mark_exported'
  | 'supersede';

export interface PdfImportClientReportActionResult {
  kind: 'ok' | 'error';
  message: string;
  report?: PdfImportClientReportRecord | null;
}

export interface ListPdfImportClientReportsOptions {
  importId?: string | null;
  templateId?: string | null;
  status?: PdfImportClientReportStatus | 'all';
  audience?: PdfImportClientReportAudience | 'all';
  reportType?: PdfImportClientReportType | 'all';
  limit?: number;
}
