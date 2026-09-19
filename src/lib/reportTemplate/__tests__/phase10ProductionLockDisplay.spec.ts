import { describe, expect, it } from 'vitest';
import {
  getPhase10ProductionLockDecisionLabel,
  getPhase10ProductionLockDecisionTone,
  getPhase10ProductionLockStatusLabel,
  getPhase10ProductionLockStatusTone,
  getPhase10ProductionLockSeverityLabel,
  getPhase10ProductionLockDomainLabel,
  formatPhase10ProductionLockScore,
  getPhase10ProductionLockHeadline,
  evaluatePhase10ProductionLock,
  type Phase10ProductionLockRequirement,
} from '../ingestion/phase10Lock';

const NOW = () => new Date('2026-07-09T00:00:00.000Z');

function passReq(id: string): Phase10ProductionLockRequirement {
  return { id, domain: 'documentation', title: 't', description: 'd', severity: 'high', status: 'pass', evidence: [], remediation: 'r' };
}

describe('phase 10 lock display', () => {
  it('maps decision labels', () => {
    expect(getPhase10ProductionLockDecisionLabel('locked')).toBe('Locked');
    expect(getPhase10ProductionLockDecisionLabel('locked_with_warnings')).toBe('Locked with warnings');
    expect(getPhase10ProductionLockDecisionLabel('not_locked')).toBe('Not locked');
  });
  it('not_locked tone destructive', () => {
    expect(getPhase10ProductionLockDecisionTone('not_locked')).toBe('destructive');
  });
  it('locked tone default', () => {
    expect(getPhase10ProductionLockDecisionTone('locked')).toBe('default');
  });
  it('locked_with_warnings tone secondary', () => {
    expect(getPhase10ProductionLockDecisionTone('locked_with_warnings')).toBe('secondary');
  });
  it('maps status labels', () => {
    expect(getPhase10ProductionLockStatusLabel('not_applicable')).toBe('Not applicable');
    expect(getPhase10ProductionLockStatusLabel('pass')).toBe('Pass');
  });
  it('fail status tone destructive', () => {
    expect(getPhase10ProductionLockStatusTone('fail')).toBe('destructive');
  });
  it('warning status tone secondary', () => {
    expect(getPhase10ProductionLockStatusTone('warning')).toBe('secondary');
    expect(getPhase10ProductionLockStatusTone('unknown')).toBe('secondary');
  });
  it('maps severity labels', () => {
    expect(getPhase10ProductionLockSeverityLabel('critical')).toBe('Critical');
    expect(getPhase10ProductionLockSeverityLabel('info')).toBe('Info');
  });
  it('maps domain labels', () => {
    expect(getPhase10ProductionLockDomainLabel('operator_controls')).toBe('Operator controls');
    expect(getPhase10ProductionLockDomainLabel('self_healing')).toBe('Self-healing');
  });
  it('formats score', () => {
    expect(formatPhase10ProductionLockScore(91)).toBe('91/100');
    expect(formatPhase10ProductionLockScore(null)).toBe('—');
  });
  it('headline returns no report for null', () => {
    expect(getPhase10ProductionLockHeadline(null)).toBe('No Phase 10 lock report');
  });
  it('headline includes decision and score', () => {
    const report = evaluatePhase10ProductionLock({ requirements: [passReq('P-1'), passReq('P-2')], now: NOW });
    const h = getPhase10ProductionLockHeadline(report);
    expect(h).toContain('Locked');
    expect(h).toContain('/100');
  });
});
