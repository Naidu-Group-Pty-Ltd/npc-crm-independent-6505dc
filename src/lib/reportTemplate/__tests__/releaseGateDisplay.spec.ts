import { describe, expect, it } from 'vitest';
import {
  evaluatePdfImportReleaseGate,
  formatPdfImportReleaseGateScore,
  getPdfImportReleaseGateDecisionLabel,
  getPdfImportReleaseGateDecisionTone,
  getPdfImportReleaseGateDomainLabel,
  getPdfImportReleaseGateHeadline,
  getPdfImportReleaseGateStatusLabel,
  getPdfImportReleaseGateStatusTone,
} from '../ingestion/releaseGate';

describe('releaseGateDisplay', () => {
  it('labels decisions', () => {
    expect(getPdfImportReleaseGateDecisionLabel('pass')).toBe('Pass');
    expect(getPdfImportReleaseGateDecisionLabel('pass_with_warnings')).toBe('Pass with warnings');
    expect(getPdfImportReleaseGateDecisionLabel(null)).toBe('Unknown');
  });

  it('maps fail tone destructive, pass tone default, warning tone secondary', () => {
    expect(getPdfImportReleaseGateDecisionTone('fail')).toBe('destructive');
    expect(getPdfImportReleaseGateDecisionTone('pass')).toBe('default');
    expect(getPdfImportReleaseGateStatusTone('warning')).toBe('secondary');
  });

  it('labels statuses', () => {
    expect(getPdfImportReleaseGateStatusLabel('unknown')).toBe('Unknown');
    expect(getPdfImportReleaseGateStatusLabel('fail')).toBe('Fail');
  });

  it('humanizes domain labels', () => {
    expect(getPdfImportReleaseGateDomainLabel('security_safety')).toBe('Security safety');
    expect(getPdfImportReleaseGateDomainLabel('live_environment')).toBe('Live environment');
  });

  it('formats scores', () => {
    expect(formatPdfImportReleaseGateScore(87)).toBe('87/100');
    expect(formatPdfImportReleaseGateScore(null)).toBe('—/100');
    expect(formatPdfImportReleaseGateScore(140)).toBe('100/100');
  });

  it('headline handles no report', () => {
    expect(getPdfImportReleaseGateHeadline(null)).toBe('No release gate report available');
  });

  it('headline includes decision and score', () => {
    const report = evaluatePdfImportReleaseGate({
      checks: [{ id: 'x', domain: 'build', severity: 'critical', status: 'pass', title: 't', message: 'm', evidence: [], remediation: 'r' }],
    });
    const headline = getPdfImportReleaseGateHeadline(report);
    expect(headline).toContain('Pass');
    expect(headline).toContain('/100');
  });
});
