import { describe, expect, it } from 'vitest';
import {
  getPdfImportClientReportAudienceLabel,
  getPdfImportClientReportSafetyLabel,
  getPdfImportClientReportSafetyTone,
  getPdfImportClientReportStatusLabel,
  getPdfImportClientReportStatusTone,
  getPdfImportClientReportTypeLabel,
  summarizePdfImportClientReports,
  type PdfImportClientReportRecord,
} from '../ingestion/clientReports';

function rec(over: Partial<PdfImportClientReportRecord>): PdfImportClientReportRecord {
  return {
    version: 'pdf-import-client-report-v1',
    reportType: 'import_status_summary',
    audience: 'external_client',
    safetyLevel: 'safe',
    status: 'draft',
    importId: null, templateId: null,
    title: 't', summary: 's', sections: [], redactions: [],
    sourceSummary: { operatorDecision: null, qualityGateStatus: null, exportParityStatus: null, manualReviewRequired: null, generatedFrom: [] },
    generatedAt: '',
    id: 'r1', generatedBy: null,
    reviewedBy: null, reviewedAt: null, reviewNote: null,
    approvedBy: null, approvedAt: null, approvalNote: null,
    exportedBy: null, exportedAt: null, exportNote: null, exportFormat: null,
    rejectedBy: null, rejectedAt: null, rejectionNote: null,
    supersededBy: null, supersededAt: null,
    createdAt: '', updatedAt: '',
    ...over,
  };
}

describe('pdfImportClientReportDisplay', () => {
  it('maps type/audience/safety/status labels', () => {
    expect(getPdfImportClientReportTypeLabel('manual_review_summary')).toBe('Manual review summary');
    expect(getPdfImportClientReportAudienceLabel('external_client')).toBe('External · client');
    expect(getPdfImportClientReportSafetyLabel('safe_with_warnings')).toBe('Safe with warnings');
    expect(getPdfImportClientReportStatusLabel('pending_review')).toBe('Pending review');
  });

  it('maps tones (blocked/rejected destructive, safe/approved default)', () => {
    expect(getPdfImportClientReportSafetyTone('blocked')).toBe('destructive');
    expect(getPdfImportClientReportSafetyTone('safe')).toBe('default');
    expect(getPdfImportClientReportStatusTone('rejected')).toBe('destructive');
    expect(getPdfImportClientReportStatusTone('approved')).toBe('default');
    expect(getPdfImportClientReportStatusTone('exported')).toBe('default');
  });

  it('summarizes reports', () => {
    const reports = [
      rec({ id: 'a', status: 'draft' }),
      rec({ id: 'b', status: 'approved' }),
      rec({ id: 'c', status: 'exported' }),
      rec({ id: 'd', status: 'rejected', safetyLevel: 'blocked' }),
    ];
    const s = summarizePdfImportClientReports(reports);
    expect(s.total).toBe(4);
    expect(s.approved).toBe(1);
    expect(s.exported).toBe(1);
    expect(s.rejected).toBe(1);
    expect(s.blocked).toBe(1);
  });
});
