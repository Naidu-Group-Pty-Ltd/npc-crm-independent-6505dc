import { describe, expect, it } from 'vitest';
import {
  formatEstimatedBytes,
  getPdfImportCleanupActionLabel,
  getPdfImportRetentionDecisionLabel,
  getPdfImportRetentionDecisionTone,
  getPdfImportRetentionDomainLabel,
  getPdfImportRetentionSafetyLabel,
  getPdfImportRetentionSafetyTone,
  getPdfImportRetentionStatusLabel,
  summarizePdfImportRetentionEvents,
  type PdfImportRetentionEventRecord,
} from '../ingestion/retention';

function rec(over: Partial<PdfImportRetentionEventRecord>): PdfImportRetentionEventRecord {
  return {
    version: 'pdf-import-retention-event-v1',
    retentionRuleId: 'storage_object_orphaned',
    domain: 'storage_orphan',
    decision: 'delete_candidate',
    cleanupAction: 'delete_later',
    safetyLevel: 'requires_developer_approval',
    status: 'candidate',
    title: 't',
    message: 'm',
    scope: { type: 'storage_object', id: 'x', label: 'x' },
    dedupeKey: 'k',
    storageBucket: null,
    storageObjectPath: null,
    importId: null,
    templateId: null,
    monitoringEventId: null,
    goldenRunId: null,
    evidence: [],
    recommendedAction: 'r',
    estimatedBytes: 1000,
    objectCreatedAt: null,
    objectUpdatedAt: null,
    source: 'pdf_import_retention',
    runId: null,
    firstSeenAt: '',
    lastSeenAt: '',
    occurrenceCount: 1,
    id: 'e1',
    reviewedBy: null, reviewedAt: null, reviewNote: null,
    approvedBy: null, approvedAt: null, approvalNote: null,
    rejectedBy: null, rejectedAt: null, rejectionNote: null,
    blockedBy: null, blockedAt: null, blockNote: null,
    completedBy: null, completedAt: null, completionNote: null,
    createdAt: '', updatedAt: '',
    ...over,
  };
}

describe('pdfImportRetentionDisplay', () => {
  it('maps decision labels + tones', () => {
    expect(getPdfImportRetentionDecisionLabel('archive_candidate')).toBe('Archive candidate');
    expect(getPdfImportRetentionDecisionTone('delete_candidate')).toBe('destructive');
    expect(getPdfImportRetentionDecisionTone('retain')).toBe('default');
    expect(getPdfImportRetentionDecisionTone('archive_candidate')).toBe('secondary');
    expect(getPdfImportRetentionDecisionLabel(null)).toBe('Unknown');
  });

  it('maps cleanup action + safety + status + domain labels', () => {
    expect(getPdfImportCleanupActionLabel('compact_metadata_later')).toBe('Compact metadata later');
    expect(getPdfImportRetentionSafetyLabel('requires_developer_approval')).toBe('Requires developer approval');
    expect(getPdfImportRetentionSafetyTone('blocked')).toBe('destructive');
    expect(getPdfImportRetentionStatusLabel('approved_for_future_cleanup')).toBe('Approved (future cleanup)');
    expect(getPdfImportRetentionDomainLabel('storage_orphan')).toBe('Storage orphan');
  });

  it('formats bytes', () => {
    expect(formatEstimatedBytes(0)).toBe('0 B');
    expect(formatEstimatedBytes(1536)).toBe('1.5 KB');
    expect(formatEstimatedBytes(null)).toBe('—');
    expect(formatEstimatedBytes(5 * 1024 * 1024)).toBe('5 MB');
  });

  it('summarizes events and totals recoverable bytes', () => {
    const events = [
      rec({ id: 'a', decision: 'delete_candidate', estimatedBytes: 1000 }),
      rec({ id: 'b', decision: 'archive_candidate', estimatedBytes: 500 }),
      rec({ id: 'c', decision: 'retain', estimatedBytes: 999 }),
      rec({ id: 'd', decision: 'blocked', status: 'blocked', estimatedBytes: null }),
    ];
    const s = summarizePdfImportRetentionEvents(events);
    expect(s.total).toBe(4);
    expect(s.deleteCandidates).toBe(1);
    expect(s.archiveCandidates).toBe(1);
    expect(s.blocked).toBe(1);
    expect(s.estimatedRecoverableBytes).toBe(1500);
  });
});
