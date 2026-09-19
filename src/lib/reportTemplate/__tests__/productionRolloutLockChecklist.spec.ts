import { describe, expect, it } from 'vitest';
import {
  PDF_IMPORT_PRODUCTION_ROLLOUT_LOCK_CHECKLIST,
  listPdfImportProductionRolloutLockChecks,
  getPdfImportProductionRolloutLockCheckById,
  assertPdfImportProductionRolloutLockChecklistIntegrity,
} from '../ingestion/productionRolloutLock';

const DOMAINS = [
  'phase10_lock', 'rollout_readiness', 'permissions', 'monitoring_alerting', 'release_gate',
  'retention', 'runbooks', 'client_reporting', 'security_privacy', 'database_storage',
  'ui_routes', 'tests_build', 'production_preview', 'private_artifacts', 'deployment', 'rollout_scope',
] as const;

describe('production rollout lock checklist', () => {
  it('includes at least 80 checks', () => {
    expect(PDF_IMPORT_PRODUCTION_ROLLOUT_LOCK_CHECKLIST.length).toBeGreaterThanOrEqual(80);
  });
  it('has no duplicate IDs', () => {
    const ids = PDF_IMPORT_PRODUCTION_ROLLOUT_LOCK_CHECKLIST.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('represents every domain', () => {
    for (const d of DOMAINS) {
      expect(PDF_IMPORT_PRODUCTION_ROLLOUT_LOCK_CHECKLIST.some((c) => c.domain === d)).toBe(true);
    }
  });
  it('includes Phase 10 lock checks', () => {
    expect(getPdfImportProductionRolloutLockCheckById('PROD-LOCK-P10-004')?.severity).toBe('critical');
  });
  it('includes Phase 11A rollout readiness checks', () => {
    expect(getPdfImportProductionRolloutLockCheckById('PROD-LOCK-11A-004')).not.toBeNull();
  });
  it('includes permission checks', () => {
    expect(getPdfImportProductionRolloutLockCheckById('PROD-LOCK-PERM-002')?.severity).toBe('critical');
  });
  it('includes monitoring checks', () => {
    expect(getPdfImportProductionRolloutLockCheckById('PROD-LOCK-MON-002')?.severity).toBe('critical');
  });
  it('includes release gate checks', () => {
    expect(getPdfImportProductionRolloutLockCheckById('PROD-LOCK-REL-006')?.severity).toBe('critical');
  });
  it('includes retention checks', () => {
    expect(getPdfImportProductionRolloutLockCheckById('PROD-LOCK-RET-006')?.severity).toBe('critical');
  });
  it('includes runbook checks', () => {
    expect(getPdfImportProductionRolloutLockCheckById('PROD-LOCK-RUNBOOK-005')?.severity).toBe('critical');
  });
  it('includes client reporting checks', () => {
    expect(getPdfImportProductionRolloutLockCheckById('PROD-LOCK-CLIENT-007')?.severity).toBe('critical');
  });
  it('includes security/privacy checks', () => {
    expect(getPdfImportProductionRolloutLockCheckById('PROD-LOCK-SEC-005')?.severity).toBe('critical');
  });
  it('includes private artifact checks', () => {
    expect(getPdfImportProductionRolloutLockCheckById('PROD-LOCK-ARTIFACT-001')?.severity).toBe('critical');
  });
  it('includes deployment checks', () => {
    expect(getPdfImportProductionRolloutLockCheckById('PROD-LOCK-DEPLOY-003')?.severity).toBe('critical');
  });
  it('includes rollout scope checks', () => {
    expect(getPdfImportProductionRolloutLockCheckById('PROD-LOCK-SCOPE-001')?.severity).toBe('critical');
  });
  it('every critical check has remediation', () => {
    for (const c of PDF_IMPORT_PRODUCTION_ROLLOUT_LOCK_CHECKLIST) {
      if (c.severity === 'critical') expect(c.remediation).toBeTruthy();
    }
  });
  it('every check has a non-empty requiredFor', () => {
    for (const c of PDF_IMPORT_PRODUCTION_ROLLOUT_LOCK_CHECKLIST) {
      expect(Array.isArray(c.requiredFor)).toBe(true);
      expect(c.requiredFor.length).toBeGreaterThan(0);
    }
  });
  it('all checks default to unknown status', () => {
    expect(listPdfImportProductionRolloutLockChecks().every((c) => c.status === 'unknown')).toBe(true);
  });
  it('integrity passes', () => {
    const r = assertPdfImportProductionRolloutLockChecklistIntegrity();
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });
  it('listing returns a copy (mutating it does not change the canonical list)', () => {
    const copy = listPdfImportProductionRolloutLockChecks();
    copy[0].status = 'pass';
    copy[0].requiredFor.push('blocked');
    expect(PDF_IMPORT_PRODUCTION_ROLLOUT_LOCK_CHECKLIST[0].status).toBe('unknown');
  });
});
