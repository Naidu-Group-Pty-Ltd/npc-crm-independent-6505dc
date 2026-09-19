/**
 * pdfImportClientReportDisplay — Phase 11G presentational labels + tones. Pure.
 */
import type {
  PdfImportClientReportAudience,
  PdfImportClientReportRecord,
  PdfImportClientReportSafetyLevel,
  PdfImportClientReportStatus,
  PdfImportClientReportType,
} from './pdfImportClientReportTypes';

export type PdfImportClientReportDisplayTone = 'default' | 'secondary' | 'destructive' | 'outline';

const TYPE_LABELS: Record<string, string> = {
  import_status_summary: 'Import status summary',
  template_quality_summary: 'Template quality summary',
  manual_review_summary: 'Manual review summary',
  accepted_with_warnings_summary: 'Accepted with warnings',
  rejected_import_summary: 'Rejected import summary',
  production_audit_summary: 'Production audit summary',
  release_readiness_summary: 'Release readiness summary',
};

const AUDIENCE_LABELS: Record<string, string> = {
  internal_operator: 'Internal · operator',
  internal_business: 'Internal · business',
  external_client: 'External · client',
};

const SAFETY_LABELS: Record<string, string> = {
  safe: 'Safe',
  safe_with_warnings: 'Safe with warnings',
  internal_only: 'Internal only',
  blocked: 'Blocked',
};

const SAFETY_TONES: Record<string, PdfImportClientReportDisplayTone> = {
  safe: 'default',
  safe_with_warnings: 'secondary',
  internal_only: 'outline',
  blocked: 'destructive',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  pending_review: 'Pending review',
  approved: 'Approved',
  exported: 'Exported',
  rejected: 'Rejected',
  superseded: 'Superseded',
};

const STATUS_TONES: Record<string, PdfImportClientReportDisplayTone> = {
  draft: 'secondary',
  pending_review: 'secondary',
  approved: 'default',
  exported: 'default',
  rejected: 'destructive',
  superseded: 'outline',
};

export function getPdfImportClientReportTypeLabel(type: PdfImportClientReportType | string | null | undefined): string {
  return TYPE_LABELS[String(type ?? '')] ?? 'Report';
}
export function getPdfImportClientReportAudienceLabel(audience: PdfImportClientReportAudience | string | null | undefined): string {
  return AUDIENCE_LABELS[String(audience ?? '')] ?? 'Unknown';
}
export function getPdfImportClientReportSafetyLabel(safetyLevel: PdfImportClientReportSafetyLevel | string | null | undefined): string {
  return SAFETY_LABELS[String(safetyLevel ?? '')] ?? 'Unknown';
}
export function getPdfImportClientReportSafetyTone(safetyLevel: PdfImportClientReportSafetyLevel | string | null | undefined): PdfImportClientReportDisplayTone {
  return SAFETY_TONES[String(safetyLevel ?? '')] ?? 'outline';
}
export function getPdfImportClientReportStatusLabel(status: PdfImportClientReportStatus | string | null | undefined): string {
  return STATUS_LABELS[String(status ?? '')] ?? 'Unknown';
}
export function getPdfImportClientReportStatusTone(status: PdfImportClientReportStatus | string | null | undefined): PdfImportClientReportDisplayTone {
  return STATUS_TONES[String(status ?? '')] ?? 'outline';
}

export function summarizePdfImportClientReports(reports: PdfImportClientReportRecord[]): {
  total: number;
  draft: number;
  pendingReview: number;
  approved: number;
  exported: number;
  rejected: number;
  blocked: number;
} {
  const list = Array.isArray(reports) ? reports : [];
  return {
    total: list.length,
    draft: list.filter((r) => r.status === 'draft').length,
    pendingReview: list.filter((r) => r.status === 'pending_review').length,
    approved: list.filter((r) => r.status === 'approved').length,
    exported: list.filter((r) => r.status === 'exported').length,
    rejected: list.filter((r) => r.status === 'rejected').length,
    blocked: list.filter((r) => r.safetyLevel === 'blocked').length,
  };
}
