/**
 * pdfImportRetentionDisplay — Phase 11E presentational labels + tones. Pure.
 */
import {
  type PdfImportCleanupAction,
  type PdfImportRetentionDecision,
  type PdfImportRetentionDomain,
  type PdfImportRetentionEventRecord,
  type PdfImportRetentionEventStatus,
  type PdfImportRetentionSafetyLevel,
} from './pdfImportRetentionTypes';

export type PdfImportRetentionDisplayTone = 'default' | 'secondary' | 'destructive' | 'outline';

const DECISION_LABELS: Record<string, string> = {
  retain: 'Retain',
  review: 'Review',
  archive_candidate: 'Archive candidate',
  delete_candidate: 'Delete candidate',
  blocked: 'Blocked',
  unknown: 'Unknown',
};

const DECISION_TONES: Record<string, PdfImportRetentionDisplayTone> = {
  retain: 'default',
  review: 'outline',
  archive_candidate: 'secondary',
  delete_candidate: 'destructive',
  blocked: 'destructive',
  unknown: 'outline',
};

const CLEANUP_ACTION_LABELS: Record<string, string> = {
  no_action: 'No action',
  mark_for_review: 'Mark for review',
  archive_later: 'Archive later',
  delete_later: 'Delete later',
  compact_metadata_later: 'Compact metadata later',
  repair_reference: 'Repair reference',
  preserve_for_audit: 'Preserve for audit',
  preserve_for_regression: 'Preserve for regression',
  preserve_for_manual_review: 'Preserve for manual review',
  blocked_from_cleanup: 'Blocked from cleanup',
};

const SAFETY_LABELS: Record<string, string> = {
  safe_to_recommend: 'Safe to recommend',
  requires_operator_approval: 'Requires operator approval',
  requires_developer_approval: 'Requires developer approval',
  manual_only: 'Manual only',
  blocked: 'Blocked',
};

const SAFETY_TONES: Record<string, PdfImportRetentionDisplayTone> = {
  safe_to_recommend: 'default',
  requires_operator_approval: 'secondary',
  requires_developer_approval: 'destructive',
  manual_only: 'outline',
  blocked: 'destructive',
};

const STATUS_LABELS: Record<string, string> = {
  candidate: 'Candidate',
  reviewed: 'Reviewed',
  approved_for_future_cleanup: 'Approved (future cleanup)',
  rejected: 'Rejected',
  blocked: 'Blocked',
  completed: 'Completed',
  superseded: 'Superseded',
};

const STATUS_TONES: Record<string, PdfImportRetentionDisplayTone> = {
  candidate: 'secondary',
  reviewed: 'default',
  approved_for_future_cleanup: 'default',
  rejected: 'outline',
  blocked: 'destructive',
  completed: 'outline',
  superseded: 'outline',
};

export function getPdfImportRetentionDecisionLabel(decision: PdfImportRetentionDecision | string | null | undefined): string {
  return DECISION_LABELS[String(decision ?? '')] ?? 'Unknown';
}
export function getPdfImportRetentionDecisionTone(decision: PdfImportRetentionDecision | string | null | undefined): PdfImportRetentionDisplayTone {
  return DECISION_TONES[String(decision ?? '')] ?? 'outline';
}
export function getPdfImportCleanupActionLabel(action: PdfImportCleanupAction | string | null | undefined): string {
  return CLEANUP_ACTION_LABELS[String(action ?? '')] ?? String(action ?? 'Unknown');
}
export function getPdfImportRetentionSafetyLabel(safetyLevel: PdfImportRetentionSafetyLevel | string | null | undefined): string {
  return SAFETY_LABELS[String(safetyLevel ?? '')] ?? 'Unknown';
}
export function getPdfImportRetentionSafetyTone(safetyLevel: PdfImportRetentionSafetyLevel | string | null | undefined): PdfImportRetentionDisplayTone {
  return SAFETY_TONES[String(safetyLevel ?? '')] ?? 'outline';
}
export function getPdfImportRetentionStatusLabel(status: PdfImportRetentionEventStatus | string | null | undefined): string {
  return STATUS_LABELS[String(status ?? '')] ?? 'Unknown';
}
export function getPdfImportRetentionStatusTone(status: PdfImportRetentionEventStatus | string | null | undefined): PdfImportRetentionDisplayTone {
  return STATUS_TONES[String(status ?? '')] ?? 'outline';
}
export function getPdfImportRetentionDomainLabel(domain: PdfImportRetentionDomain | string | null | undefined): string {
  const s = String(domain ?? '').replace(/_/g, ' ');
  if (!s) return 'Unknown';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatEstimatedBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  const text = i === 0 || Number.isInteger(value) ? String(Math.round(value)) : value.toFixed(1);
  return `${text} ${units[i]}`;
}

export function summarizePdfImportRetentionEvents(events: PdfImportRetentionEventRecord[]): {
  total: number;
  candidates: number;
  review: number;
  archiveCandidates: number;
  deleteCandidates: number;
  blocked: number;
  estimatedRecoverableBytes: number;
} {
  const list = Array.isArray(events) ? events : [];
  let recoverable = 0;
  for (const e of list) {
    if ((e.decision === 'archive_candidate' || e.decision === 'delete_candidate') && typeof e.estimatedBytes === 'number') {
      recoverable += e.estimatedBytes;
    }
  }
  return {
    total: list.length,
    candidates: list.filter((e) => e.status === 'candidate').length,
    review: list.filter((e) => e.decision === 'review').length,
    archiveCandidates: list.filter((e) => e.decision === 'archive_candidate').length,
    deleteCandidates: list.filter((e) => e.decision === 'delete_candidate').length,
    blocked: list.filter((e) => e.decision === 'blocked' || e.status === 'blocked').length,
    estimatedRecoverableBytes: recoverable,
  };
}
