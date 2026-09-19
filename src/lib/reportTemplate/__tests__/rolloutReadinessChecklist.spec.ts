import { describe, expect, it } from 'vitest';
import {
  PDF_IMPORT_ROLLOUT_READINESS_CHECKLIST,
  listPdfImportRolloutReadinessChecks,
  getPdfImportRolloutReadinessCheckById,
  assertPdfImportRolloutReadinessChecklistIntegrity,
} from '../ingestion/rolloutReadiness';

const MODES = ['internal_dev_only', 'admin_limited', 'controlled_team_rollout', 'broad_production', 'blocked'];

function hasDomain(domain: string): boolean {
  return PDF_IMPORT_ROLLOUT_READINESS_CHECKLIST.some((c) => c.domain === domain);
}

describe('rollout readiness checklist', () => {
  it('contains at least 70 checks', () => {
    expect(PDF_IMPORT_ROLLOUT_READINESS_CHECKLIST.length).toBeGreaterThanOrEqual(70);
  });
  it('has no duplicate check IDs', () => {
    const ids = PDF_IMPORT_ROLLOUT_READINESS_CHECKLIST.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('includes phase10_lock checks', () => { expect(hasDomain('phase10_lock')).toBe(true); });
  it('includes security_access checks', () => { expect(hasDomain('security_access')).toBe(true); });
  it('includes deployment checks', () => { expect(hasDomain('deployment')).toBe(true); });
  it('includes operator_workflow checks', () => { expect(hasDomain('operator_workflow')).toBe(true); });
  it('includes permissions checks', () => { expect(hasDomain('permissions')).toBe(true); });
  it('includes monitoring_alerting checks', () => { expect(hasDomain('monitoring_alerting')).toBe(true); });
  it('includes release_governance checks', () => { expect(hasDomain('release_governance')).toBe(true); });
  it('includes data_privacy checks', () => { expect(hasDomain('data_privacy')).toBe(true); });
  it('includes support_runbooks checks', () => { expect(hasDomain('support_runbooks')).toBe(true); });
  it('includes performance_cost checks', () => { expect(hasDomain('performance_cost')).toBe(true); });
  it('includes artifact_retention checks', () => { expect(hasDomain('artifact_retention')).toBe(true); });
  it('includes client_impact checks', () => { expect(hasDomain('client_impact')).toBe(true); });
  it('includes rollout_scope checks', () => { expect(hasDomain('rollout_scope')).toBe(true); });
  it('critical checks include remediation', () => {
    for (const c of PDF_IMPORT_ROLLOUT_READINESS_CHECKLIST.filter((x) => x.severity === 'critical')) {
      expect(c.remediation).toBeTruthy();
    }
  });
  it('every check has all fields', () => {
    for (const c of listPdfImportRolloutReadinessChecks()) {
      expect(c.id).toBeTruthy();
      expect(c.domain).toBeTruthy();
      expect(c.title).toBeTruthy();
      expect(c.description).toBeTruthy();
      expect(c.severity).toBeTruthy();
      expect(c.status).toBeTruthy();
      expect(Array.isArray(c.evidence)).toBe(true);
      expect(Array.isArray(c.requiredFor)).toBe(true);
      expect(c.remediation).toBeTruthy();
      expect(c.targetPhase).toBeTruthy();
    }
  });
  it('every requiredFor value is a valid mode', () => {
    for (const c of PDF_IMPORT_ROLLOUT_READINESS_CHECKLIST) {
      for (const m of c.requiredFor) expect(MODES).toContain(m);
    }
  });
  it('defaults all checks to unknown', () => {
    expect(listPdfImportRolloutReadinessChecks().every((c) => c.status === 'unknown')).toBe(true);
  });
  it('getById returns a copy', () => {
    const c = getPdfImportRolloutReadinessCheckById('ROLL-P10-002');
    expect(c).not.toBeNull();
    if (c) { c.status = 'pass'; expect(getPdfImportRolloutReadinessCheckById('ROLL-P10-002')?.status).toBe('unknown'); }
  });
  it('assert integrity returns ok', () => {
    const r = assertPdfImportRolloutReadinessChecklistIntegrity();
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });
});
