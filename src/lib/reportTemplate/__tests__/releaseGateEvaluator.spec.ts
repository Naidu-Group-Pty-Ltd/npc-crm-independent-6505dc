import { describe, expect, it } from 'vitest';
import {
  calculatePdfImportReleaseGateScore,
  evaluatePdfImportReleaseGate,
  getPdfImportReleaseGateSeverityWeight,
  resolvePdfImportReleaseGateDecision,
  summarizePdfImportReleaseGateChecks,
  type PdfImportReleaseGateCheck,
  type PdfImportReleaseGateCheckStatus,
  type PdfImportReleaseGateSeverity,
} from '../ingestion/releaseGate';

const NOW = () => new Date('2026-07-09T00:00:00.000Z');

let seq = 0;
function mk(
  status: PdfImportReleaseGateCheckStatus,
  severity: PdfImportReleaseGateSeverity,
): PdfImportReleaseGateCheck {
  return {
    id: `check_${seq++}`,
    domain: 'source_integrity',
    severity,
    status,
    title: 't',
    message: 'm',
    evidence: [],
    remediation: 'r',
  };
}

describe('releaseGateEvaluator', () => {
  it('all pass -> pass', () => {
    const checks = [mk('pass', 'critical'), mk('pass', 'high'), mk('pass', 'medium')];
    const report = evaluatePdfImportReleaseGate({ checks, now: NOW });
    expect(report.score).toBe(100);
    expect(report.decision).toBe('pass');
    expect(report.generatedAt).toBe('2026-07-09T00:00:00.000Z');
  });

  it('critical fail -> fail', () => {
    const checks = [mk('pass', 'high'), mk('fail', 'critical')];
    expect(evaluatePdfImportReleaseGate({ checks, now: NOW }).decision).toBe('fail');
  });

  it('two high fails -> fail', () => {
    const checks = [mk('fail', 'high'), mk('fail', 'high'), mk('pass', 'low')];
    expect(evaluatePdfImportReleaseGate({ checks, now: NOW }).decision).toBe('fail');
  });

  it('warnings -> pass_with_warnings', () => {
    const checks = [mk('pass', 'high'), mk('warning', 'high'), mk('warning', 'high')];
    const report = evaluatePdfImportReleaseGate({ checks, now: NOW });
    expect(report.decision).toBe('pass_with_warnings');
    expect(report.score).toBeGreaterThanOrEqual(75);
    expect(report.score).toBeLessThan(95);
  });

  it('unknown -> pass_with_warnings', () => {
    const checks = [mk('pass', 'high'), mk('unknown', 'medium')];
    expect(evaluatePdfImportReleaseGate({ checks, now: NOW }).decision).toBe('pass_with_warnings');
  });

  it('score below 75 -> fail', () => {
    const checks = [mk('fail', 'medium'), mk('fail', 'medium'), mk('fail', 'medium'), mk('fail', 'medium'), mk('fail', 'medium')];
    const report = evaluatePdfImportReleaseGate({ checks, now: NOW });
    expect(report.score).toBeLessThan(75);
    expect(report.decision).toBe('fail');
  });

  it('applies score weights', () => {
    expect(getPdfImportReleaseGateSeverityWeight('critical')).toBe(25);
    expect(getPdfImportReleaseGateSeverityWeight('info')).toBe(0);
    expect(calculatePdfImportReleaseGateScore([mk('fail', 'critical')])).toBe(75);
    expect(calculatePdfImportReleaseGateScore([mk('warning', 'critical')])).toBe(88); // 100 - 12.5 -> 88
    expect(calculatePdfImportReleaseGateScore([mk('unknown', 'high')])).toBe(97); // 100 - 3
    expect(calculatePdfImportReleaseGateScore([mk('skipped', 'critical')])).toBe(100);
  });

  it('computes summary counts', () => {
    const checks = [mk('pass', 'low'), mk('fail', 'critical'), mk('fail', 'high'), mk('warning', 'medium'), mk('skipped', 'info'), mk('unknown', 'low')];
    const summary = summarizePdfImportReleaseGateChecks(checks);
    expect(summary.total).toBe(6);
    expect(summary.criticalFailures).toBe(1);
    expect(summary.highFailures).toBe(1);
    expect(summary.warning).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.unknown).toBe(1);
  });

  it('all skipped -> skipped', () => {
    const checks = [mk('skipped', 'high'), mk('skipped', 'medium')];
    expect(resolvePdfImportReleaseGateDecision({ checks, score: 100 })).toBe('skipped');
  });

  it('empty checks -> skipped', () => {
    expect(evaluatePdfImportReleaseGate({ checks: [], now: NOW }).decision).toBe('skipped');
  });
});
