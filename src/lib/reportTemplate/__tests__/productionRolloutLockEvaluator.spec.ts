import { describe, expect, it } from 'vitest';
import {
  evaluatePdfImportProductionRolloutLock,
  summarizePdfImportProductionRolloutLockChecks,
  calculatePdfImportProductionRolloutLockScore,
  resolvePdfImportProductionRolloutLockDecision,
  resolvePdfImportProductionRolloutMode,
  getPdfImportProductionRolloutLockSeverityWeight,
  type PdfImportProductionRolloutLockCheck,
  type PdfImportProductionRolloutLockDomain,
  type PdfImportProductionRolloutLockSeverity,
  type PdfImportProductionRolloutLockStatus,
} from '../ingestion/productionRolloutLock';

let seq = 0;
function mk(
  status: PdfImportProductionRolloutLockStatus,
  severity: PdfImportProductionRolloutLockSeverity = 'medium',
  domain: PdfImportProductionRolloutLockDomain = 'rollout_readiness',
  id?: string,
): PdfImportProductionRolloutLockCheck {
  seq += 1;
  return {
    id: id ?? `X-${seq}`,
    domain,
    severity,
    status,
    title: 'check',
    message: 'check',
    evidence: [],
    remediation: 'fix it',
    requiredFor: ['broad_production'],
  };
}

const NOW = () => new Date('2026-07-09T00:00:00.000Z');

function decide(checks: PdfImportProductionRolloutLockCheck[]) {
  const score = calculatePdfImportProductionRolloutLockScore(checks);
  return resolvePdfImportProductionRolloutLockDecision({ checks, score });
}

describe('severity weights', () => {
  it('are correct', () => {
    expect(getPdfImportProductionRolloutLockSeverityWeight('critical')).toBe(25);
    expect(getPdfImportProductionRolloutLockSeverityWeight('high')).toBe(12);
    expect(getPdfImportProductionRolloutLockSeverityWeight('medium')).toBe(6);
    expect(getPdfImportProductionRolloutLockSeverityWeight('low')).toBe(2);
    expect(getPdfImportProductionRolloutLockSeverityWeight('info')).toBe(1);
  });
});

describe('score', () => {
  it('all pass returns 100', () => {
    expect(calculatePdfImportProductionRolloutLockScore([mk('pass', 'critical'), mk('pass', 'high')])).toBe(100);
  });
  it('critical fail subtracts 25', () => {
    expect(calculatePdfImportProductionRolloutLockScore([mk('fail', 'critical')])).toBe(75);
  });
  it('high fail subtracts 12', () => {
    expect(calculatePdfImportProductionRolloutLockScore([mk('fail', 'high')])).toBe(88);
  });
  it('warning subtracts half weight', () => {
    expect(calculatePdfImportProductionRolloutLockScore([mk('warning', 'high')])).toBe(94);
  });
  it('unknown subtracts quarter weight', () => {
    expect(calculatePdfImportProductionRolloutLockScore([mk('unknown', 'critical')])).toBe(94);
  });
  it('clamps at 0', () => {
    expect(calculatePdfImportProductionRolloutLockScore(Array.from({ length: 10 }, () => mk('fail', 'critical')))).toBe(0);
  });
});

describe('decision', () => {
  it('all pass returns production_rollout_locked', () => {
    expect(decide([mk('pass', 'critical', 'permissions', 'P-1'), mk('pass', 'high', 'monitoring_alerting', 'P-2')]))
      .toBe('production_rollout_locked');
  });
  it('critical fail returns production_rollout_not_locked', () => {
    expect(decide([mk('fail', 'critical', 'database_storage', 'C-1')])).toBe('production_rollout_not_locked');
  });
  it('two high fails return production_rollout_not_locked', () => {
    expect(decide([mk('fail', 'high', 'runbooks', 'H-1'), mk('fail', 'high', 'ui_routes', 'H-2')]))
      .toBe('production_rollout_not_locked');
  });
  it('score below 75 returns production_rollout_not_locked', () => {
    const reqs = Array.from({ length: 6 }, (_, i) => mk('fail', 'medium', 'rollout_readiness', `M-${i}`));
    expect(calculatePdfImportProductionRolloutLockScore(reqs)).toBeLessThan(75);
    expect(decide(reqs)).toBe('production_rollout_not_locked');
  });
  it('warnings return production_rollout_locked_with_conditions', () => {
    expect(decide([mk('pass', 'high', 'permissions', 'P-3'), mk('warning', 'medium', 'runbooks', 'W-1')]))
      .toBe('production_rollout_locked_with_conditions');
  });
  it('unknown returns production_rollout_locked_with_conditions', () => {
    expect(decide([mk('pass', 'high', 'permissions', 'P-4'), mk('unknown', 'medium', 'runbooks', 'U-1')]))
      .toBe('production_rollout_locked_with_conditions');
  });
  it('critical privacy fail returns production_rollout_not_locked', () => {
    expect(decide([mk('fail', 'critical', 'security_privacy', 'PROD-LOCK-SEC-005')]))
      .toBe('production_rollout_not_locked');
  });
  it('client report unsafe fail returns production_rollout_not_locked', () => {
    expect(decide([mk('fail', 'critical', 'client_reporting', 'PROD-LOCK-CLIENT-007')]))
      .toBe('production_rollout_not_locked');
  });
  it('retention physical cleanup fail returns production_rollout_not_locked', () => {
    expect(decide([mk('fail', 'critical', 'retention', 'PROD-LOCK-RET-006')]))
      .toBe('production_rollout_not_locked');
  });
  it('permission fail returns production_rollout_not_locked', () => {
    expect(decide([mk('fail', 'critical', 'permissions', 'PROD-LOCK-PERM-002')]))
      .toBe('production_rollout_not_locked');
  });
  it('monitoring high fail returns locked_with_conditions', () => {
    expect(decide([mk('pass', 'critical', 'permissions', 'P-5'), mk('fail', 'high', 'monitoring_alerting', 'MON-H')]))
      .toBe('production_rollout_locked_with_conditions');
  });
});

describe('rollout mode', () => {
  it('all pass score >= 95 returns broad_production', () => {
    const checks = [mk('pass', 'critical', 'permissions', 'P-1'), mk('pass', 'high', 'runbooks', 'P-2')];
    const report = evaluatePdfImportProductionRolloutLock({ checks, now: NOW });
    expect(report.score).toBeGreaterThanOrEqual(95);
    expect(report.rolloutMode).toBe('broad_production');
  });
  it('warnings with no critical fail return admin_limited or controlled_team_rollout', () => {
    const checks = [
      mk('pass', 'critical', 'permissions', 'P-3'),
      mk('pass', 'critical', 'monitoring_alerting', 'P-4'),
      mk('pass', 'high', 'release_gate', 'P-5'),
      mk('pass', 'high', 'runbooks', 'P-6'),
      mk('pass', 'high', 'client_reporting', 'P-7'),
      mk('warning', 'medium', 'rollout_readiness', 'W-1'),
    ];
    const report = evaluatePdfImportProductionRolloutLock({ checks, now: NOW });
    expect(report.decision).toBe('production_rollout_locked_with_conditions');
    expect(['admin_limited', 'controlled_team_rollout']).toContain(report.rolloutMode);
  });
  it('critical privacy fail returns blocked mode', () => {
    const report = evaluatePdfImportProductionRolloutLock({
      checks: [mk('fail', 'critical', 'security_privacy', 'PROD-LOCK-SEC-005')],
      now: NOW,
    });
    expect(report.rolloutMode).toBe('blocked');
  });
});

describe('summary + report', () => {
  it('counts pass/warning/fail/unknown/not_applicable', () => {
    const checks = [mk('pass'), mk('warning'), mk('fail'), mk('unknown'), mk('not_applicable')];
    const s = summarizePdfImportProductionRolloutLockChecks(checks);
    expect(s.total).toBe(5);
    expect(s.pass).toBe(1);
    expect(s.warning).toBe(1);
    expect(s.fail).toBe(1);
    expect(s.unknown).toBe(1);
    expect(s.notApplicable).toBe(1);
  });
  it('blockers include critical failures', () => {
    const report = evaluatePdfImportProductionRolloutLock({
      checks: [mk('fail', 'critical', 'database_storage', 'DB-1'), mk('pass', 'high', 'runbooks', 'OK-1')],
      now: NOW,
    });
    expect(report.blockers.some((c) => c.id === 'DB-1')).toBe(true);
  });
  it('conditions include warnings and unknowns', () => {
    const report = evaluatePdfImportProductionRolloutLock({
      checks: [mk('warning', 'medium', 'runbooks', 'W-2'), mk('unknown', 'medium', 'ui_routes', 'U-2'), mk('pass', 'low', 'deployment', 'P-8')],
      now: NOW,
    });
    const ids = report.conditions.map((c) => c.id);
    expect(ids).toContain('W-2');
    expect(ids).toContain('U-2');
    expect(ids).not.toContain('P-8');
  });
  it('generatedAt uses now', () => {
    const report = evaluatePdfImportProductionRolloutLock({ checks: [mk('pass', 'high', 'runbooks', 'P-9')], now: NOW });
    expect(report.generatedAt).toBe('2026-07-09T00:00:00.000Z');
  });
  it('evaluator does not mutate input', () => {
    const checks = [mk('unknown', 'critical', 'client_reporting', 'PROD-LOCK-CLIENT-007')];
    const before = JSON.parse(JSON.stringify(checks));
    evaluatePdfImportProductionRolloutLock({ checks, now: NOW });
    expect(checks).toEqual(before);
  });
});
