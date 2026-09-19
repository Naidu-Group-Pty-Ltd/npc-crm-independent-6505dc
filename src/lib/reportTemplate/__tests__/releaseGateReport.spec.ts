import { describe, expect, it } from 'vitest';
import {
  PDF_IMPORT_RELEASE_GATE_VERSION,
  buildPdfImportReleaseGateJsonReport,
  buildPdfImportReleaseGateMarkdownReport,
  evaluatePdfImportReleaseGate,
  validatePdfImportReleaseGateReport,
  type PdfImportReleaseGateCheck,
  type PdfImportReleaseGateReport,
} from '../ingestion/releaseGate';

const NOW = () => new Date('2026-07-09T00:00:00.000Z');

function check(over: Partial<PdfImportReleaseGateCheck>): PdfImportReleaseGateCheck {
  return {
    id: 'c1',
    domain: 'build',
    severity: 'critical',
    status: 'fail',
    title: 'Build',
    message: 'build failed',
    evidence: [],
    remediation: 'fix build',
    ...over,
  };
}

function report(): PdfImportReleaseGateReport {
  return evaluatePdfImportReleaseGate({
    checks: [check({}), check({ id: 'c2', status: 'warning', severity: 'medium', message: 'a warning' })],
    now: NOW,
    branch: 'feature/x',
    commit: 'abc123',
  });
}

describe('releaseGateReport', () => {
  it('builds a markdown report including decision + critical failures', () => {
    const md = buildPdfImportReleaseGateMarkdownReport(report());
    expect(md).toContain('# PDF Import Release Gate Report');
    expect(md).toContain('**Decision:**');
    expect(md).toContain('## Critical Failures');
    expect(md).toContain('c1');
  });

  it('builds parseable pretty JSON', () => {
    const json = buildPdfImportReleaseGateJsonReport(report());
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(PDF_IMPORT_RELEASE_GATE_VERSION);
    expect(json).toContain('\n  '); // pretty-printed
  });

  it('validates a well-formed report', () => {
    const result = validatePdfImportReleaseGateReport(report());
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('fails validation on an invalid decision', () => {
    const bad = { ...report(), decision: 'maybe' as never };
    const result = validatePdfImportReleaseGateReport(bad);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('invalid_decision');
  });

  it('fails validation when checks are missing', () => {
    const bad = { ...report(), checks: undefined as never };
    const result = validatePdfImportReleaseGateReport(bad);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('missing_checks');
  });
});
