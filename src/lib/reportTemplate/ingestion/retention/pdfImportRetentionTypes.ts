/**
 * pdfImportRetentionTypes — Phase 11E artifact retention + cleanup governance.
 *
 * Phase 11E is DRY-RUN ONLY. It identifies retention/cleanup candidates,
 * classifies them by decision + safety level, and persists them for operator
 * review. It NEVER physically deletes files or rows, never archives, never
 * compacts metadata, never mutates templates, and never calls AI. It stores
 * metadata references only — never raw PDF/OCR text, screenshots, signed URLs,
 * or secrets.
 */
export const PDF_IMPORT_RETENTION_EVENT_VERSION = 'pdf-import-retention-event-v1';

export type PdfImportRetentionDomain =
  | 'source_pdf'
  | 'docling_artifact'
  | 'page_manifest'
  | 'diagnostics'
  | 'visual_quality'
  | 'visual_repair'
  | 'export_parity'
  | 'golden_regression'
  | 'golden_history'
  | 'monitoring_events'
  | 'phase10_metadata'
  | 'operator_audit'
  | 'storage_orphan'
  | 'metadata_reference'
  | 'unknown';

export const PDF_IMPORT_RETENTION_DOMAINS: PdfImportRetentionDomain[] = [
  'source_pdf',
  'docling_artifact',
  'page_manifest',
  'diagnostics',
  'visual_quality',
  'visual_repair',
  'export_parity',
  'golden_regression',
  'golden_history',
  'monitoring_events',
  'phase10_metadata',
  'operator_audit',
  'storage_orphan',
  'metadata_reference',
  'unknown',
];

export type PdfImportRetentionDecision =
  | 'retain'
  | 'review'
  | 'archive_candidate'
  | 'delete_candidate'
  | 'blocked'
  | 'unknown';

export type PdfImportCleanupAction =
  | 'no_action'
  | 'mark_for_review'
  | 'archive_later'
  | 'delete_later'
  | 'compact_metadata_later'
  | 'repair_reference'
  | 'preserve_for_audit'
  | 'preserve_for_regression'
  | 'preserve_for_manual_review'
  | 'blocked_from_cleanup';

export type PdfImportRetentionSafetyLevel =
  | 'safe_to_recommend'
  | 'requires_operator_approval'
  | 'requires_developer_approval'
  | 'manual_only'
  | 'blocked';

export type PdfImportRetentionEventStatus =
  | 'candidate'
  | 'reviewed'
  | 'approved_for_future_cleanup'
  | 'rejected'
  | 'blocked'
  | 'completed'
  | 'superseded';

export const PDF_IMPORT_RETENTION_ACTIVE_STATUSES: PdfImportRetentionEventStatus[] = [
  'candidate',
  'reviewed',
  'approved_for_future_cleanup',
  'blocked',
];

export type PdfImportRetentionRuleId =
  | 'source_pdf_retained'
  | 'docling_artifact_old'
  | 'page_manifest_old'
  | 'diagnostics_old_success'
  | 'diagnostics_failed_import_retained'
  | 'visual_quality_old_accepted'
  | 'visual_quality_manual_review_retained'
  | 'visual_repair_old'
  | 'visual_repair_applied_retained'
  | 'export_parity_old'
  | 'export_parity_golden_retained'
  | 'golden_history_retained'
  | 'monitoring_event_old_resolved'
  | 'phase10_metadata_large'
  | 'operator_audit_retained'
  | 'storage_object_orphaned'
  | 'metadata_reference_missing_object'
  | 'unknown_artifact_review';

export interface PdfImportRetentionEvidence {
  code: string;
  label: string;
  value: string | number | boolean | null;
  message: string;
}

export interface PdfImportRetentionScope {
  type: string;
  id: string;
  label: string | null;
}

export interface PdfImportRetentionPolicyRule {
  retentionRuleId: PdfImportRetentionRuleId;
  domain: PdfImportRetentionDomain;
  title: string;
  description: string;
  defaultDecision: PdfImportRetentionDecision;
  defaultCleanupAction: PdfImportCleanupAction;
  defaultSafetyLevel: PdfImportRetentionSafetyLevel;
  retentionDays: number | null;
  requiresImportInactive: boolean;
  requiresNoOpenAlerts: boolean;
  requiresNoManualReview: boolean;
  recommendedAction: string;
}

export interface PdfImportRetentionEventInput {
  version: typeof PDF_IMPORT_RETENTION_EVENT_VERSION;
  retentionRuleId: PdfImportRetentionRuleId;
  domain: PdfImportRetentionDomain;
  decision: PdfImportRetentionDecision;
  cleanupAction: PdfImportCleanupAction;
  safetyLevel: PdfImportRetentionSafetyLevel;
  status: PdfImportRetentionEventStatus;
  title: string;
  message: string;
  scope: PdfImportRetentionScope;
  dedupeKey: string;
  storageBucket: string | null;
  storageObjectPath: string | null;
  importId: string | null;
  templateId: string | null;
  monitoringEventId: string | null;
  goldenRunId: string | null;
  evidence: PdfImportRetentionEvidence[];
  recommendedAction: string;
  estimatedBytes: number | null;
  objectCreatedAt: string | null;
  objectUpdatedAt: string | null;
  source: string;
  runId: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrenceCount: number;
}

export interface PdfImportRetentionEventRecord extends PdfImportRetentionEventInput {
  id: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  approvalNote: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectionNote: string | null;
  blockedBy: string | null;
  blockedAt: string | null;
  blockNote: string | null;
  completedBy: string | null;
  completedAt: string | null;
  completionNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PdfImportRetentionSignals {
  imports: unknown[];
  jobs: unknown[];
  goldenRuns: unknown[];
  monitoringEvents: unknown[];
  storageBuckets: unknown[];
  storageObjects: unknown[];
  generatedAt: string;
}

export interface PdfImportRetentionEvaluationResult {
  runId: string;
  generatedAt: string;
  events: PdfImportRetentionEventInput[];
  retainCount: number;
  reviewCount: number;
  archiveCandidateCount: number;
  deleteCandidateCount: number;
  blockedCount: number;
  estimatedRecoverableBytes: number;
}

export type PdfImportRetentionAction =
  | 'review'
  | 'approve_for_future_cleanup'
  | 'reject'
  | 'block'
  | 'supersede';

export interface PdfImportRetentionActionResult {
  kind: 'ok' | 'error';
  message: string;
  event?: PdfImportRetentionEventRecord | null;
}

export interface ListPdfImportRetentionEventsOptions {
  status?: PdfImportRetentionEventStatus | 'active' | 'all';
  decision?: PdfImportRetentionDecision | 'all';
  domain?: PdfImportRetentionDomain | 'all';
  limit?: number;
}
