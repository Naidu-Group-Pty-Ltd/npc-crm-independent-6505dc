import { describe, expect, it } from 'vitest';
import {
  evaluatePdfImportRolloutReadiness,
  summarizePdfImportRolloutReadinessChecks,
  calculatePdfImportRolloutReadinessScore,
  resolvePdfImportRolloutDecision,
  resolveRecommendedPdfImportRolloutMode,
  getPdfImportRolloutReadinessSeverityWeight,
  getRecommendedPhase11FollowUps,
  type PdfImportRolloutReadinessCheck,
  type PdfImportRolloutReadinessDomain,
  type PdfImportRolloutReadinessSeverity,
  type PdfImportRolloutReadinessStatus,
} from '../ingestion/rolloutReadiness';

let seq = 0;
function mk(
  status: PdfImportRolloutReadinessStatus,
  severity: PdfImportRolloutReadinessSeverity = 'medium',
  opts: { id?: string; domain?: PdfImportRolloutReadinessDomain } = {},
): PdfImportRolloutReadinessCheck {
  seq += 1;
  return {
    id: opts.id ?? `X-${seq}`,
    domain: opts.domain ?? 'operator_workflow',
    title: 'check',
    description: 'check',
    severity,
    status,
    evidence: [],
    requiredFor: ['admin_limited'],
    remediation: 'fix it',
    targetPhase: '11A',
  };
}

const NOW = () => new Date('2026-07-09T00:00:00.000Z');

describe('severity weights', () => {
  it('are correct', () => {
    expect(getPdfImportRolloutReadinessSeverityWeight('critical')).toBe(20);
    expect(getPdfImportRolloutReadinessSeverityWeight('high')).toBe(10);
    expect(getPdfImportRolloutReadinessSeverityWeight('medium')).toBe(5);
    expect(getPdfImportRolloutReadinessSeverityWeight('low')).toBe(2);
    expect(getPdfImportRolloutReadinessSeverityWeight('info')).toBe(1);
  });
});

describe('score', () => {
  it('all pass returns 100', () => {
    expect(calculatePdfImportRolloutReadinessScore([mk('pass', 'critical'), mk('pass', 'high')])).toBe(100);
  });
  it('critical fail subtracts 20', () => {
    expect(calculatePdfImportRolloutReadinessScore([mk('fail', 'critical')])).toBe(80);
  });
  it('high fail subtracts 10', () => {
    expect(calculatePdfImportRolloutReadinessScore([mk('fail', 'high')])).toBe(90);
  });
  it('warning subtracts half weight', () => {
    expect(calculatePdfImportRolloutReadinessScore([mk('warning', 'critical')])).toBe(90);
  });
  it('unknown subtracts quarter weight', () => {
    expect(calculatePdfImportRolloutReadinessScore([mk('unknown', 'critical')])).toBe(95);
  });
  it('clamps at 0', () => {
    expect(calculatePdfImportRolloutReadinessScore(Array.from({ length: 10 }, () => mk('fail', 'critical')))).toBe(0);
  });
  it('clamps at 100', () => {
    expect(calculatePdfImportRolloutReadinessScore([mk('not_applicable', 'critical'), mk('pass', 'high')])).toBe(100);
  });
});

describe('decision', () => {
  const dec = (checks: PdfImportRolloutReadinessCheck[]) => resolvePdfImportRolloutDecision({ checks });
  it('any critical fail returns rollout_not_ready', () => {
    expect(dec([mk('fail', 'critical', { id: 'ROLL-REL-003' })])).toBe('rollout_not_ready');
  });
  it('two high fails return rollout_not_ready', () => {
    expect(dec([mk('fail', 'high', { id: 'H-1' }), mk('fail', 'high', { id: 'H-2' })])).toBe('rollout_not_ready');
  });
  it('score below 70 returns rollout_not_ready', () => {
    const checks = Array.from({ length: 7 }, (_, i) => mk('fail', 'medium', { id: `M-${i}` }));
    expect(calculatePdfImportRolloutReadinessScore(checks)).toBeLessThan(70);
    expect(dec(checks)).toBe('rollout_not_ready');
  });
  it('warning with no critical fail returns rollout_ready_with_conditions', () => {
    expect(dec([mk('pass', 'high', { id: 'P-1' }), mk('warning', 'medium', { id: 'W-1' })])).toBe('rollout_ready_with_conditions');
  });
  it('unknown non-safety with no critical fail returns rollout_ready_with_conditions', () => {
    expect(dec([mk('pass', 'high', { id: 'P-2' }), mk('unknown', 'medium', { id: 'U-1' })])).toBe('rollout_ready_with_conditions');
  });
  it('all pass and score >= 95 returns rollout_ready', () => {
    expect(dec([mk('pass', 'critical', { id: 'P-3' }), mk('pass', 'high', { id: 'P-4' })])).toBe('rollout_ready');
  });
  it('critical safety unknown returns rollout_not_ready', () => {
    expect(dec([mk('pass', 'high', { id: 'P-5' }), mk('unknown', 'critical', { id: 'ROLL-SEC-003' })])).toBe('rollout_not_ready');
  });
  it('missing permissions/monitoring/runbooks (non-safety) returns rollout_ready_with_conditions', () => {
    const checks = [
      mk('pass', 'critical', { id: 'ROLL-SEC-003', domain: 'security_access' }),
      mk('pass', 'critical', { id: 'ROLL-OP-005', domain: 'operator_workflow' }),
      mk('unknown', 'medium', { id: 'ROLL-PERM-002', domain: 'permissions' }),
      mk('unknown', 'medium', { id: 'ROLL-MON-004', domain: 'monitoring_alerting' }),
      mk('unknown', 'medium', { id: 'ROLL-RUNBOOK-001', domain: 'support_runbooks' }),
    ];
    expect(dec(checks)).toBe('rollout_ready_with_conditions');
  });
});

describe('recommended mode', () => {
  function coreChecks(status: PdfImportRolloutReadinessStatus = 'pass') {
    return [
      mk(status, 'critical', { id: 'ROLL-P10-002', domain: 'phase10_lock' }),
      mk(status, 'critical', { id: 'ROLL-SEC-003', domain: 'security_access' }),
      mk(status, 'critical', { id: 'ROLL-OP-005', domain: 'operator_workflow' }),
    ];
  }
  const mode = (checks: PdfImportRolloutReadinessCheck[]) => {
    const decision = resolvePdfImportRolloutDecision({ checks });
    return resolveRecommendedPdfImportRolloutMode({ checks, decision });
  };

  it('rollout_not_ready recommends blocked', () => {
    expect(mode([mk('fail', 'critical', { id: 'ROLL-REL-003' })])).toBe('blocked');
  });
  it('partial readiness recommends admin_limited', () => {
    const checks = [...coreChecks('pass'), mk('unknown', 'medium', { id: 'ROLL-PERM-002', domain: 'permissions' })];
    expect(mode(checks)).toBe('admin_limited');
  });
  it('stronger readiness recommends controlled_team_rollout', () => {
    const checks = [
      ...coreChecks('pass'),
      mk('pass', 'critical', { id: 'ROLL-PERM-001', domain: 'permissions' }),
      mk('pass', 'high', { id: 'ROLL-MON-001', domain: 'monitoring_alerting' }),
      mk('pass', 'high', { id: 'ROLL-RUNBOOK-001', domain: 'support_runbooks' }),
      mk('pass', 'high', { id: 'ROLL-REL-001', domain: 'release_governance' }),
      mk('unknown', 'medium', { id: 'ROLL-RETENTION-004', domain: 'artifact_retention' }),
    ];
    expect(mode(checks)).toBe('controlled_team_rollout');
  });
  it('full readiness recommends broad_production', () => {
    const checks = [
      ...coreChecks('pass'),
      mk('pass', 'critical', { id: 'ROLL-PERM-001', domain: 'permissions' }),
      mk('pass', 'high', { id: 'ROLL-MON-001', domain: 'monitoring_alerting' }),
      mk('pass', 'high', { id: 'ROLL-RUNBOOK-001', domain: 'support_runbooks' }),
      mk('pass', 'high', { id: 'ROLL-REL-001', domain: 'release_governance' }),
      mk('pass', 'high', { id: 'ROLL-RETENTION-001', domain: 'artifact_retention' }),
      mk('pass', 'high', { id: 'ROLL-CLIENT-001', domain: 'client_impact' }),
    ];
    expect(mode(checks)).toBe('broad_production');
  });
});

describe('recommended follow-up phases', () => {
  const g = (domain: PdfImportRolloutReadinessDomain, id: string) => mk('unknown', 'high', { id, domain });
  it('permission gaps recommend Phase 11B', () => {
    expect(getRecommendedPhase11FollowUps([g('permissions', 'ROLL-PERM-001')])).toContain('11B');
  });
  it('monitoring gaps recommend Phase 11C', () => {
    expect(getRecommendedPhase11FollowUps([g('monitoring_alerting', 'ROLL-MON-001')])).toContain('11C');
  });
  it('release governance gaps recommend Phase 11D', () => {
    expect(getRecommendedPhase11FollowUps([g('release_governance', 'ROLL-REL-001')])).toContain('11D');
  });
  it('retention gaps recommend Phase 11E', () => {
    expect(getRecommendedPhase11FollowUps([g('artifact_retention', 'ROLL-RETENTION-001')])).toContain('11E');
  });
  it('runbook gaps recommend Phase 11F', () => {
    expect(getRecommendedPhase11FollowUps([g('support_runbooks', 'ROLL-RUNBOOK-001')])).toContain('11F');
  });
  it('client impact gaps recommend Phase 11G', () => {
    expect(getRecommendedPhase11FollowUps([g('client_impact', 'ROLL-CLIENT-001')])).toContain('11G');
  });
  it('all mostly passing recommends Phase 11H', () => {
    expect(getRecommendedPhase11FollowUps([mk('pass', 'high', { id: 'P', domain: 'phase10_lock' })])).toEqual(['11H']);
  });
});

describe('summary + report', () => {
  it('counts statuses correctly', () => {
    const checks = [mk('pass'), mk('warning'), mk('fail'), mk('unknown'), mk('not_applicable')];
    const s = summarizePdfImportRolloutReadinessChecks(checks, NOW);
    expect(s.total).toBe(5);
    expect(s.pass).toBe(1);
    expect(s.warning).toBe(1);
    expect(s.fail).toBe(1);
    expect(s.unknown).toBe(1);
    expect(s.notApplicable).toBe(1);
  });
  it('generatedAt uses now', () => {
    expect(summarizePdfImportRolloutReadinessChecks([mk('pass')], NOW).generatedAt).toBe('2026-07-09T00:00:00.000Z');
  });
  it('criticalBlockers include critical failures', () => {
    const report = evaluatePdfImportRolloutReadiness({ checks: [mk('fail', 'critical', { id: 'ROLL-REL-003' }), mk('pass', 'high', { id: 'OK' })], now: NOW });
    expect(report.criticalBlockers.some((c) => c.id === 'ROLL-REL-003')).toBe(true);
  });
  it('conditions include warning/unknown/high-fail unresolved checks', () => {
    const report = evaluatePdfImportRolloutReadiness({ checks: [mk('warning', 'medium', { id: 'W' }), mk('unknown', 'medium', { id: 'U' }), mk('pass', 'low', { id: 'P' })], now: NOW });
    const ids = report.conditions.map((c) => c.id);
    expect(ids).toContain('W');
    expect(ids).toContain('U');
    expect(ids).not.toContain('P');
  });
  it('does not mutate input', () => {
    const checks = [mk('unknown', 'critical', { id: 'ROLL-SEC-003' })];
    const before = JSON.parse(JSON.stringify(checks));
    evaluatePdfImportRolloutReadiness({ checks, now: NOW });
    expect(checks).toEqual(before);
  });
});
