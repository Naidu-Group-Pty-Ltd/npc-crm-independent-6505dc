import { describe, expect, it } from 'vitest';
import {
  formatPdfImportRunbookReadinessScore,
  getPdfImportRunbookCriticalityLabel,
  getPdfImportRunbookCriticalityTone,
  getPdfImportRunbookDomainLabel,
  getPdfImportRunbookReadinessHeadline,
  getPdfImportRunbookReadinessStatusLabel,
  getPdfImportRunbookReadinessStatusTone,
  type PdfImportRunbookReadinessReport,
} from '../ingestion/runbooks';

describe('pdfImportRunbookDisplay', () => {
  it('labels criticalities and maps critical to destructive', () => {
    expect(getPdfImportRunbookCriticalityLabel('critical')).toBe('Critical');
    expect(getPdfImportRunbookCriticalityTone('critical')).toBe('destructive');
    expect(getPdfImportRunbookCriticalityTone('high')).toBe('secondary');
    expect(getPdfImportRunbookCriticalityLabel(null)).toBe('Unknown');
  });

  it('labels + tones readiness statuses', () => {
    expect(getPdfImportRunbookReadinessStatusLabel('ready')).toBe('Ready');
    expect(getPdfImportRunbookReadinessStatusLabel('needs_review')).toBe('Needs review');
    expect(getPdfImportRunbookReadinessStatusTone('ready')).toBe('default');
    expect(getPdfImportRunbookReadinessStatusTone('missing')).toBe('destructive');
    expect(getPdfImportRunbookReadinessStatusTone('incomplete')).toBe('secondary');
  });

  it('humanizes domain labels', () => {
    expect(getPdfImportRunbookDomainLabel('monitoring_alerts')).toBe('Monitoring alerts');
    expect(getPdfImportRunbookDomainLabel('client_communication')).toBe('Client communication');
  });

  it('formats scores', () => {
    expect(formatPdfImportRunbookReadinessScore(87)).toBe('87/100');
    expect(formatPdfImportRunbookReadinessScore(null)).toBe('—/100');
  });

  it('headlines a report or its absence', () => {
    expect(getPdfImportRunbookReadinessHeadline(null)).toBe('No runbook readiness report available');
    const report: PdfImportRunbookReadinessReport = {
      version: 'pdf-import-runbook-registry-v1',
      results: [], total: 18, ready: 18, missing: 0, incomplete: 0, needsReview: 0,
      criticalMissing: 0, highMissing: 0, score: 100, generatedAt: '',
    };
    const headline = getPdfImportRunbookReadinessHeadline(report);
    expect(headline).toContain('100/100');
    expect(headline).toContain('18/18');
  });
});
