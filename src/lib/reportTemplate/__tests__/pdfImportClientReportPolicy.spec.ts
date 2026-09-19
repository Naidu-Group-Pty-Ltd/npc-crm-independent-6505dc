import { describe, expect, it } from 'vitest';
import {
  PDF_IMPORT_CLIENT_REPORT_DISALLOWED_PATTERNS,
  assertPdfImportClientReportPolicyIntegrity,
  getDefaultAudienceForReportType,
  isClientReportExportAllowed,
  resolveClientReportSafetyLevel,
} from '../ingestion/clientReports';

describe('pdfImportClientReportPolicy', () => {
  it('defaults client-facing types to external_client', () => {
    expect(getDefaultAudienceForReportType('import_status_summary')).toBe('external_client');
    expect(getDefaultAudienceForReportType('template_quality_summary')).toBe('external_client');
    expect(getDefaultAudienceForReportType('production_audit_summary')).toBe('internal_business');
  });

  it('resolves safe when there are no warnings or blocks', () => {
    expect(resolveClientReportSafetyLevel({ audience: 'external_client', reportType: 'import_status_summary' })).toBe('safe');
  });

  it('resolves safe_with_warnings for warnings/manual review', () => {
    expect(resolveClientReportSafetyLevel({ audience: 'external_client', reportType: 'import_status_summary', hasWarnings: true })).toBe('safe_with_warnings');
    expect(resolveClientReportSafetyLevel({ audience: 'external_client', reportType: 'manual_review_summary', manualReviewRequired: true })).toBe('safe_with_warnings');
  });

  it('blocks when unsafe redactions remain', () => {
    expect(resolveClientReportSafetyLevel({ audience: 'external_client', reportType: 'import_status_summary', hasUnsafeRedactions: true })).toBe('blocked');
  });

  it('marks blocked state internal_only for external audience', () => {
    expect(resolveClientReportSafetyLevel({ audience: 'external_client', reportType: 'import_status_summary', hasBlockedState: true })).toBe('internal_only');
  });

  it('only allows export of approved safe / safe_with_warnings reports', () => {
    expect(isClientReportExportAllowed({ audience: 'external_client', safetyLevel: 'safe', approved: true })).toBe(true);
    expect(isClientReportExportAllowed({ audience: 'external_client', safetyLevel: 'safe_with_warnings', approved: true })).toBe(true);
    expect(isClientReportExportAllowed({ audience: 'external_client', safetyLevel: 'safe', approved: false })).toBe(false);
    expect(isClientReportExportAllowed({ audience: 'external_client', safetyLevel: 'internal_only', approved: true })).toBe(false);
    expect(isClientReportExportAllowed({ audience: 'external_client', safetyLevel: 'blocked', approved: true })).toBe(false);
  });

  it('includes the critical disallowed patterns', () => {
    const codes = PDF_IMPORT_CLIENT_REPORT_DISALLOWED_PATTERNS.map((p) => p.code);
    for (const c of ['signed_or_token_url', 'artifact_bucket', 'service_role', 'stack_trace', 'raw_json_dump']) {
      expect(codes).toContain(c);
    }
  });

  it('passes policy integrity', () => {
    const result = assertPdfImportClientReportPolicyIntegrity();
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
