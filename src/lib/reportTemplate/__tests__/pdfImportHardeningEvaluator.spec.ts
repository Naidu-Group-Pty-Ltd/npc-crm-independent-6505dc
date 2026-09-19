import { describe, expect, it } from 'vitest';
import {
  PDF_IMPORT_HARDENING_AUDIT_VERSION,
  PDF_IMPORT_HARDENING_CHECKLIST,
  calculatePdfImportHardeningScore,
  evaluatePdfImportHardeningAudit,
  getPdfImportHardeningCheckById,
  getPdfImportHardeningSeverityWeight,
  listPdfImportHardeningChecks,
  resolvePdfImportHardeningReadiness,
  summarizePdfImportHardeningChecks,
  type PdfImportHardeningCheck,
  type PdfImportHardeningSeverity,
  type PdfImportHardeningStatus,
} from '../ingestion/hardening';

const NOW = () => new Date('2026-07-08T00:00:00.000Z');

function check(
  id: string,
  severity: PdfImportHardeningSeverity,
  status: PdfImportHardeningStatus,
): PdfImportHardeningCheck {
  return {
    id,
    domain: 'security_auth',
    title: `title ${id}`,
    description: `description ${id}`,
    severity,
    likelihood: 'possible',
    status,
    owner: 'developer_backend',
    evidence: [],
    recommendation: `recommendation ${id}`,
    targetPhase: '10A',
  };
}

describe('getPdfImportHardeningSeverityWeight', () => {
  it('returns the correct weight per severity', () => {
    expect(getPdfImportHardeningSeverityWeight('critical')).toBe(15);
    expect(getPdfImportHardeningSeverityWeight('high')).toBe(8);
    expect(getPdfImportHardeningSeverityWeight('medium')).toBe(4);
    expect(getPdfImportHardeningSeverityWeight('low')).toBe(2);
    expect(getPdfImportHardeningSeverityWeight('info')).toBe(1);
  });
});

describe('calculatePdfImportHardeningScore', () => {
  it('returns 100 when every check passes', () => {
    const checks = [
      check('a', 'critical', 'pass'),
      check('b', 'high', 'pass'),
      check('c', 'medium', 'pass'),
    ];
    expect(calculatePdfImportHardeningScore(checks)).toBe(100);
  });

  it('subtracts the full severity weight for a critical fail', () => {
    expect(calculatePdfImportHardeningScore([check('a', 'critical', 'fail')])).toBe(85);
  });

  it('subtracts half the weight for a warning', () => {
    // high weight 8 -> 8 * 0.5 = 4 -> 96
    expect(calculatePdfImportHardeningScore([check('a', 'high', 'warning')])).toBe(96);
  });

  it('subtracts a quarter of the weight for an unknown', () => {
    // critical weight 15 -> 15 * 0.25 = 3.75 -> 96.25 -> round 96
    expect(calculatePdfImportHardeningScore([check('a', 'critical', 'unknown')])).toBe(96);
  });

  it('clamps the score at 0', () => {
    const checks = Array.from({ length: 10 }, (_, i) => check(`c${i}`, 'critical', 'fail'));
    expect(calculatePdfImportHardeningScore(checks)).toBe(0);
  });

  it('clamps the score at 100', () => {
    // not_applicable / pass never add above 100
    const checks = [check('a', 'critical', 'pass'), check('b', 'high', 'not_applicable')];
    expect(calculatePdfImportHardeningScore(checks)).toBe(100);
  });
});

describe('resolvePdfImportHardeningReadiness', () => {
  it('is not_ready when there is a critical fail', () => {
    const checks = [check('a', 'critical', 'fail'), check('b', 'low', 'pass')];
    expect(resolvePdfImportHardeningReadiness(checks)).toBe('not_ready');
  });

  it('is not_ready when there are two high fails', () => {
    const checks = [check('a', 'high', 'fail'), check('b', 'high', 'fail')];
    expect(resolvePdfImportHardeningReadiness(checks)).toBe('not_ready');
  });

  it('is not_ready when the score drops below 70', () => {
    // five high fails: 100 - 40 = 60, and 5 high fails > 2 as well
    const checks = Array.from({ length: 5 }, (_, i) => check(`h${i}`, 'high', 'fail'));
    expect(calculatePdfImportHardeningScore(checks)).toBe(60);
    expect(resolvePdfImportHardeningReadiness(checks)).toBe('not_ready');
  });

  it('is ready_with_warnings for a warning with no fails', () => {
    const checks = [check('a', 'medium', 'warning'), check('b', 'low', 'pass')];
    expect(resolvePdfImportHardeningReadiness(checks)).toBe('ready_with_warnings');
  });

  it('is ready_with_warnings for an unknown with no fails', () => {
    const checks = [check('a', 'medium', 'unknown'), check('b', 'low', 'pass')];
    expect(resolvePdfImportHardeningReadiness(checks)).toBe('ready_with_warnings');
  });

  it('is ready when all checks pass and score >= 90', () => {
    const checks = [
      check('a', 'critical', 'pass'),
      check('b', 'high', 'pass'),
      check('c', 'medium', 'not_applicable'),
    ];
    expect(resolvePdfImportHardeningReadiness(checks)).toBe('ready');
  });
});

describe('summarizePdfImportHardeningChecks', () => {
  it('counts pass/warning/fail/unknown/not_applicable correctly', () => {
    const checks = [
      check('a', 'low', 'pass'),
      check('b', 'low', 'pass'),
      check('c', 'medium', 'warning'),
      check('d', 'high', 'fail'),
      check('e', 'medium', 'unknown'),
      check('f', 'low', 'not_applicable'),
    ];
    const summary = summarizePdfImportHardeningChecks(checks, NOW);
    expect(summary.total).toBe(6);
    expect(summary.pass).toBe(2);
    expect(summary.warning).toBe(1);
    expect(summary.fail).toBe(1);
    expect(summary.unknown).toBe(1);
    expect(summary.notApplicable).toBe(1);
  });

  it('counts criticalFailures and highFailures correctly', () => {
    const checks = [
      check('a', 'critical', 'fail'),
      check('b', 'high', 'fail'),
      check('c', 'high', 'fail'),
      check('d', 'critical', 'pass'),
    ];
    const summary = summarizePdfImportHardeningChecks(checks, NOW);
    expect(summary.criticalFailures).toBe(1);
    expect(summary.highFailures).toBe(2);
  });

  it('uses the provided now() for generatedAt', () => {
    const summary = summarizePdfImportHardeningChecks([check('a', 'low', 'pass')], NOW);
    expect(summary.generatedAt).toBe('2026-07-08T00:00:00.000Z');
  });
});

describe('evaluatePdfImportHardeningAudit', () => {
  it('returns the report version', () => {
    const report = evaluatePdfImportHardeningAudit({ checks: [check('a', 'low', 'pass')], now: NOW });
    expect(report.version).toBe(PDF_IMPORT_HARDENING_AUDIT_VERSION);
    expect(report.summary.version).toBe(PDF_IMPORT_HARDENING_AUDIT_VERSION);
  });

  it('does not mutate the input checks', () => {
    const input = [check('a', 'high', 'warning')];
    const snapshot = JSON.parse(JSON.stringify(input));
    const report = evaluatePdfImportHardeningAudit({ checks: input, now: NOW });
    report.checks[0].status = 'fail';
    report.checks[0].evidence.push('mutated');
    expect(input).toEqual(snapshot);
  });
});

describe('PDF_IMPORT_HARDENING_CHECKLIST', () => {
  it('contains at least 40 checks', () => {
    expect(PDF_IMPORT_HARDENING_CHECKLIST.length).toBeGreaterThanOrEqual(40);
    expect(listPdfImportHardeningChecks().length).toBe(PDF_IMPORT_HARDENING_CHECKLIST.length);
  });

  it('has unique check IDs', () => {
    const ids = PDF_IMPORT_HARDENING_CHECKLIST.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has every required field on every check', () => {
    for (const c of PDF_IMPORT_HARDENING_CHECKLIST) {
      expect(typeof c.id).toBe('string');
      expect(c.id.length).toBeGreaterThan(0);
      expect(typeof c.domain).toBe('string');
      expect(typeof c.title).toBe('string');
      expect(c.title.length).toBeGreaterThan(0);
      expect(typeof c.description).toBe('string');
      expect(c.description.length).toBeGreaterThan(0);
      expect(typeof c.severity).toBe('string');
      expect(typeof c.likelihood).toBe('string');
      expect(typeof c.status).toBe('string');
      expect(typeof c.owner).toBe('string');
      expect(c.owner.length).toBeGreaterThan(0);
      expect(Array.isArray(c.evidence)).toBe(true);
      expect(typeof c.recommendation).toBe('string');
      expect(c.recommendation.length).toBeGreaterThan(0);
      expect(typeof c.targetPhase).toBe('string');
      expect(c.targetPhase.length).toBeGreaterThan(0);
    }
  });

  it('covers all twelve audit domains', () => {
    const domains = new Set(PDF_IMPORT_HARDENING_CHECKLIST.map((c) => c.domain));
    for (const d of [
      'security_auth',
      'rls_database',
      'storage',
      'edge_functions',
      'sidecar',
      'data_privacy',
      'operator_console',
      'golden_regression',
      'export_parity',
      'observability',
      'performance_cost',
      'rollout',
    ]) {
      expect(domains.has(d as PdfImportHardeningCheck['domain'])).toBe(true);
    }
  });

  it('looks up checks by id and returns null for unknown ids', () => {
    expect(getPdfImportHardeningCheckById('PDF-HARDEN-AUTH-001')?.id).toBe('PDF-HARDEN-AUTH-001');
    expect(getPdfImportHardeningCheckById('does-not-exist')).toBeNull();
  });
});
