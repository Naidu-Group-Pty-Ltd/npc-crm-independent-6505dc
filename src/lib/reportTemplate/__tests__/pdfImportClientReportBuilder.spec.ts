import { describe, expect, it } from 'vitest';
import {
  buildPdfImportClientReport,
  buildPdfImportClientReportHtml,
  buildPdfImportClientReportMarkdown,
  detectUnsafeClientReportContent,
  type BuildPdfImportClientReportOptions,
} from '../ingestion/clientReports';

const NOW = () => new Date('2026-07-09T00:00:00.000Z');

function opts(over: Partial<BuildPdfImportClientReportOptions> = {}): BuildPdfImportClientReportOptions {
  return { reportType: 'import_status_summary', importId: 'imp-1', now: NOW, ...over };
}

describe('buildPdfImportClientReport', () => {
  it('builds an import_status_summary (external, safe)', () => {
    const r = buildPdfImportClientReport(opts({ productionOperatorControlAudit: { operatorState: { decision: 'accepted' } } }));
    expect(r.reportType).toBe('import_status_summary');
    expect(r.audience).toBe('external_client');
    expect(r.safetyLevel).toBe('safe');
    expect(r.sections.some((s) => s.id === 'operator_decision')).toBe(true);
  });

  it('builds a template_quality_summary', () => {
    const r = buildPdfImportClientReport(opts({ reportType: 'template_quality_summary', goldenRegressionSummary: { qualityGateStatus: 'pass' } }));
    expect(r.sections.find((s) => s.id === 'quality_review')?.status).toBe('pass');
  });

  it('builds a manual_review_summary with a manual review section', () => {
    const r = buildPdfImportClientReport(opts({ reportType: 'manual_review_summary', visualQualitySummary: { manualReviewRequired: true } }));
    expect(r.safetyLevel).toBe('safe_with_warnings');
    expect(r.sections.find((s) => s.id === 'manual_review')?.status).toBe('warning');
  });

  it('builds an accepted_with_warnings_summary', () => {
    const r = buildPdfImportClientReport(opts({ reportType: 'accepted_with_warnings_summary', goldenRegressionSummary: { qualityGateStatus: 'warning' } }));
    expect(r.summary.toLowerCase()).toContain('accepted');
    expect(r.safetyLevel).toBe('safe_with_warnings');
  });

  it('builds a rejected_import_summary', () => {
    const r = buildPdfImportClientReport(opts({ reportType: 'rejected_import_summary', productionOperatorControlAudit: { operatorState: { decision: 'rejected' } } }));
    expect(r.summary.toLowerCase()).toContain('rework');
  });

  it('external_client report excludes internal IDs from rendered text', () => {
    const r = buildPdfImportClientReport(opts({ operatorNote: 'ref 11111111-2222-3333-4444-555555555555' }));
    const text = JSON.stringify(r.sections);
    expect(text).not.toContain('11111111-2222-3333-4444-555555555555');
  });

  it('internal_operator report can keep a UUID in the operator note', () => {
    const uuid = '11111111-2222-3333-4444-555555555555';
    const r = buildPdfImportClientReport(opts({ audience: 'internal_operator', operatorNote: `ref ${uuid}` }));
    expect(JSON.stringify(r.sections)).toContain(uuid);
  });

  it('blocked operator state downgrades an external report to internal_only', () => {
    const r = buildPdfImportClientReport(opts({ productionOperatorControlAudit: { operatorState: { decision: 'blocked', blocked: true } } }));
    expect(['internal_only', 'safe_with_warnings']).toContain(r.safetyLevel);
    expect(r.audience === 'external_client' ? r.safetyLevel : 'internal_only').toBe('internal_only');
  });

  it('includes export parity status safely', () => {
    const r = buildPdfImportClientReport(opts({ exportParitySummary: { status: 'manual_required' } }));
    expect(r.sourceSummary.exportParityStatus).toBe('manual_required');
    expect(r.sections.find((s) => s.id === 'export_validation')?.status).toBe('warning');
  });

  it('does not expose monitoring/retention events in external_client', () => {
    const r = buildPdfImportClientReport(opts({ monitoringEvents: [{ id: 'e1', severity: 'high', status: 'open' }], retentionEvents: [{ id: 'r1' }] }));
    expect(r.sections.some((s) => s.id === 'operational_context')).toBe(false);
  });

  it('active critical monitoring blocks external audience (internal_only)', () => {
    const r = buildPdfImportClientReport(opts({ monitoringEvents: [{ id: 'e1', severity: 'critical', status: 'open' }] }));
    expect(r.safetyLevel).toBe('internal_only');
  });

  it('surfaces internal operational context for internal audiences only', () => {
    const r = buildPdfImportClientReport(opts({ audience: 'internal_operator', monitoringEvents: [{ id: 'e1', severity: 'high', status: 'open' }] }));
    expect(r.sections.some((s) => s.id === 'operational_context')).toBe(true);
  });

  it('markdown includes the title and sections and stays safe', () => {
    const r = buildPdfImportClientReport(opts());
    const md = buildPdfImportClientReportMarkdown(r);
    expect(md).toContain(`# ${r.title}`);
    expect(md).toContain('## Overview');
    expect(detectUnsafeClientReportContent({ payload: r }).safe).toBe(true);
  });

  it('html escapes content', () => {
    const r = buildPdfImportClientReport(opts({ operatorNote: '<script>alert(1)</script>' }));
    const html = buildPdfImportClientReportHtml(r);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
