import { describe, expect, it } from 'vitest';
import {
  PHASE_10_PRODUCTION_LOCK_REQUIREMENTS,
  listPhase10ProductionLockRequirements,
  getPhase10ProductionLockRequirementById,
  assertPhase10ProductionLockChecklistIntegrity,
} from '../ingestion/phase10Lock';

describe('phase 10 production lock checklist', () => {
  it('contains at least 60 requirements', () => {
    expect(PHASE_10_PRODUCTION_LOCK_REQUIREMENTS.length).toBeGreaterThanOrEqual(60);
  });
  it('has no duplicate requirement IDs', () => {
    const ids = PHASE_10_PRODUCTION_LOCK_REQUIREMENTS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('includes Phase 10A documentation requirement', () => {
    expect(getPhase10ProductionLockRequirementById('PHASE10-DOC-001')).not.toBeNull();
  });
  it('includes Phase 10B import intelligence requirement', () => {
    expect(getPhase10ProductionLockRequirementById('PHASE10-INTEL-001')).not.toBeNull();
  });
  it('includes Phase 10C repair pattern requirement', () => {
    expect(getPhase10ProductionLockRequirementById('PHASE10-REPAIRPATTERN-001')).not.toBeNull();
  });
  it('includes Phase 10D adaptive reconciliation requirement', () => {
    expect(getPhase10ProductionLockRequirementById('PHASE10-ADAPTIVE-001')).not.toBeNull();
  });
  it('includes Phase 10E self-healing requirement', () => {
    expect(getPhase10ProductionLockRequirementById('PHASE10-SELFHEAL-001')).not.toBeNull();
  });
  it('includes Phase 10F performance/cost requirement', () => {
    expect(getPhase10ProductionLockRequirementById('PHASE10-PERF-001')).not.toBeNull();
  });
  it('includes Phase 10G operator controls requirement', () => {
    expect(getPhase10ProductionLockRequirementById('PHASE10-OPERATOR-001')).not.toBeNull();
  });
  it('includes automatic AI safety requirement', () => {
    expect(getPhase10ProductionLockRequirementById('PHASE10-ADAPTIVE-002')?.severity).toBe('critical');
    expect(getPhase10ProductionLockRequirementById('PHASE10-SELFHEAL-002')?.severity).toBe('critical');
    expect(getPhase10ProductionLockRequirementById('PHASE10-OPERATOR-002')?.severity).toBe('critical');
  });
  it('includes template mutation safety requirement', () => {
    expect(getPhase10ProductionLockRequirementById('PHASE10-SELFHEAL-003')?.severity).toBe('critical');
    expect(getPhase10ProductionLockRequirementById('PHASE10-OPERATOR-003')?.severity).toBe('critical');
  });
  it('includes quality gate bypass safety requirement', () => {
    expect(getPhase10ProductionLockRequirementById('PHASE10-OPERATOR-004')?.severity).toBe('critical');
    expect(getPhase10ProductionLockRequirementById('PHASE10-PERF-003')?.severity).toBe('critical');
  });
  it('includes private artifact safety requirement', () => {
    expect(getPhase10ProductionLockRequirementById('PHASE10-PRIVACY-001')?.severity).toBe('critical');
  });
  it('includes build/test requirements', () => {
    expect(getPhase10ProductionLockRequirementById('PHASE10-TEST-001')?.severity).toBe('critical');
    expect(getPhase10ProductionLockRequirementById('PHASE10-TEST-003')?.severity).toBe('critical');
  });
  it('every requirement has all fields', () => {
    for (const r of listPhase10ProductionLockRequirements()) {
      expect(r.id).toBeTruthy();
      expect(r.domain).toBeTruthy();
      expect(r.title).toBeTruthy();
      expect(r.description).toBeTruthy();
      expect(r.severity).toBeTruthy();
      expect(r.status).toBeTruthy();
      expect(Array.isArray(r.evidence)).toBe(true);
      expect(r.remediation).toBeTruthy();
    }
  });
  it('all requirements default to unknown status', () => {
    expect(listPhase10ProductionLockRequirements().every((r) => r.status === 'unknown')).toBe(true);
  });
  it('assert integrity returns ok', () => {
    const r = assertPhase10ProductionLockChecklistIntegrity();
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });
  it('listing returns a copy (mutating it does not change the canonical list)', () => {
    const copy = listPhase10ProductionLockRequirements();
    copy[0].status = 'pass';
    expect(PHASE_10_PRODUCTION_LOCK_REQUIREMENTS[0].status).toBe('unknown');
  });
});
