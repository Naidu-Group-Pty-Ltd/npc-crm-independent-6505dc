import { describe, expect, it } from 'vitest';
import {
  evaluatePhase10ProductionLock,
  summarizePhase10ProductionLockRequirements,
  calculatePhase10ProductionLockScore,
  resolvePhase10ProductionLockDecision,
  getPhase10ProductionLockSeverityWeight,
  type Phase10ProductionLockRequirement,
  type Phase10ProductionLockRequirementStatus,
  type Phase10ProductionLockSeverity,
} from '../ingestion/phase10Lock';

let seq = 0;
function mk(
  status: Phase10ProductionLockRequirementStatus,
  severity: Phase10ProductionLockSeverity = 'medium',
  id?: string,
): Phase10ProductionLockRequirement {
  seq += 1;
  return {
    id: id ?? `X-${seq}`,
    domain: 'documentation',
    title: 'req',
    description: 'req',
    severity,
    status,
    evidence: [],
    remediation: 'fix it',
  };
}

const NOW = () => new Date('2026-07-09T00:00:00.000Z');

describe('severity weights', () => {
  it('are correct', () => {
    expect(getPhase10ProductionLockSeverityWeight('critical')).toBe(20);
    expect(getPhase10ProductionLockSeverityWeight('high')).toBe(10);
    expect(getPhase10ProductionLockSeverityWeight('medium')).toBe(5);
    expect(getPhase10ProductionLockSeverityWeight('low')).toBe(2);
    expect(getPhase10ProductionLockSeverityWeight('info')).toBe(1);
  });
});

describe('score', () => {
  it('all pass returns score 100', () => {
    expect(calculatePhase10ProductionLockScore([mk('pass', 'critical'), mk('pass', 'high')])).toBe(100);
  });
  it('critical fail subtracts 20', () => {
    expect(calculatePhase10ProductionLockScore([mk('fail', 'critical')])).toBe(80);
  });
  it('high fail subtracts 10', () => {
    expect(calculatePhase10ProductionLockScore([mk('fail', 'high')])).toBe(90);
  });
  it('warning subtracts half weight', () => {
    expect(calculatePhase10ProductionLockScore([mk('warning', 'critical')])).toBe(90);
  });
  it('unknown subtracts quarter weight', () => {
    expect(calculatePhase10ProductionLockScore([mk('unknown', 'critical')])).toBe(95);
  });
  it('clamps at 0', () => {
    expect(calculatePhase10ProductionLockScore(Array.from({ length: 10 }, () => mk('fail', 'critical')))).toBe(0);
  });
  it('clamps at 100 with not_applicable', () => {
    expect(calculatePhase10ProductionLockScore([mk('not_applicable', 'critical'), mk('pass', 'high')])).toBe(100);
  });
});

describe('decision', () => {
  it('critical fail returns not_locked', () => {
    expect(resolvePhase10ProductionLockDecision([mk('fail', 'critical', 'PHASE10-DB-001')])).toBe('not_locked');
  });
  it('two high fails return not_locked', () => {
    expect(resolvePhase10ProductionLockDecision([mk('fail', 'high', 'H-1'), mk('fail', 'high', 'H-2')])).toBe('not_locked');
  });
  it('score below 75 returns not_locked', () => {
    const reqs = Array.from({ length: 6 }, (_, i) => mk('fail', 'medium', `M-${i}`));
    expect(calculatePhase10ProductionLockScore(reqs)).toBeLessThan(75);
    expect(resolvePhase10ProductionLockDecision(reqs)).toBe('not_locked');
  });
  it('warning with no critical fail returns locked_with_warnings', () => {
    expect(resolvePhase10ProductionLockDecision([mk('pass', 'high', 'P-1'), mk('warning', 'medium', 'W-1')])).toBe('locked_with_warnings');
  });
  it('unknown non-safety with no critical fail returns locked_with_warnings', () => {
    expect(resolvePhase10ProductionLockDecision([mk('pass', 'high', 'P-2'), mk('unknown', 'medium', 'U-1')])).toBe('locked_with_warnings');
  });
  it('all pass and score >= 95 returns locked', () => {
    expect(resolvePhase10ProductionLockDecision([mk('pass', 'critical', 'P-3'), mk('pass', 'high', 'P-4')])).toBe('locked');
  });
  it('critical AI safety unknown returns not_locked', () => {
    expect(resolvePhase10ProductionLockDecision([mk('pass', 'high', 'P-5'), mk('unknown', 'critical', 'PHASE10-ADAPTIVE-002')])).toBe('not_locked');
  });
  it('private artifact fail returns not_locked', () => {
    expect(resolvePhase10ProductionLockDecision([mk('fail', 'critical', 'PHASE10-PRIVACY-001')])).toBe('not_locked');
  });
  it('build fail returns not_locked', () => {
    expect(resolvePhase10ProductionLockDecision([mk('fail', 'critical', 'PHASE10-TEST-003')])).toBe('not_locked');
  });
});

describe('summary + report', () => {
  it('counts pass/warning/fail/unknown/not_applicable', () => {
    const reqs = [mk('pass'), mk('warning'), mk('fail'), mk('unknown'), mk('not_applicable')];
    const s = summarizePhase10ProductionLockRequirements(reqs, NOW);
    expect(s.total).toBe(5);
    expect(s.pass).toBe(1);
    expect(s.warning).toBe(1);
    expect(s.fail).toBe(1);
    expect(s.unknown).toBe(1);
    expect(s.notApplicable).toBe(1);
  });
  it('generatedAt uses now', () => {
    expect(summarizePhase10ProductionLockRequirements([mk('pass')], NOW).generatedAt).toBe('2026-07-09T00:00:00.000Z');
  });
  it('criticalBlockers includes critical failures', () => {
    const report = evaluatePhase10ProductionLock({ requirements: [mk('fail', 'critical', 'PHASE10-DB-001'), mk('pass', 'high', 'OK-1')], now: NOW });
    expect(report.criticalBlockers.some((r) => r.id === 'PHASE10-DB-001')).toBe(true);
  });
  it('warnings includes warning and unknown requirements', () => {
    const report = evaluatePhase10ProductionLock({ requirements: [mk('warning', 'medium', 'W-2'), mk('unknown', 'medium', 'U-2'), mk('pass', 'low', 'P-6')], now: NOW });
    const ids = report.warnings.map((r) => r.id);
    expect(ids).toContain('W-2');
    expect(ids).toContain('U-2');
    expect(ids).not.toContain('P-6');
  });
  it('does not mutate input', () => {
    const reqs = [mk('unknown', 'critical', 'PHASE10-SELFHEAL-002')];
    const before = JSON.parse(JSON.stringify(reqs));
    evaluatePhase10ProductionLock({ requirements: reqs, now: NOW });
    expect(reqs).toEqual(before);
  });
});
