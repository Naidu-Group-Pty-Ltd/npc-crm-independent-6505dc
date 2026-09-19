import { describe, expect, it } from 'vitest';
import {
  SELF_HEALING_RETRY_AUDIT_VERSION,
  SELF_HEALING_MAX_TOTAL_ACTIONS,
  buildSelfHealingRetryPlan,
  buildSelfHealingPlanId,
  summarizeSelfHealingActions,
  resolveSelfHealingPlanStatus,
  validateSelfHealingRetryAudit,
} from '../ingestion/selfHealing';

const NOW = () => new Date('2026-07-08T00:00:00.000Z');

const healthy = {
  importId: 'import-1', now: NOW,
  snapshot: { importId: 'import-1', templateId: 'template-1', importStatus: 'completed', visualQaScore: 0.95, visualQaArtifactPath: 'a', repairStatus: 'completed', repairArtifactPath: 'r', exportParityStatus: 'completed', exportVsSourceScore: 0.95, exportParityArtifactPath: 'e' },
  importIntelligenceProfile: { profileCategory: 'simple_document', riskLevel: 'low', scores: {} },
  repairPatternAnalysis: { primaryPatternId: null, deterministicRepairStrategy: 'safe' },
  adaptiveReconciliationPolicy: { decision: 'not_needed', flags: { aiBlocked: false } },
  goldenRegressionSummary: { qualityGateStatus: 'pass' },
};

describe('buildSelfHealingRetryPlan', () => {
  it('builds an audit with the version', () => {
    const a = buildSelfHealingRetryPlan(healthy);
    expect(a.version).toBe(SELF_HEALING_RETRY_AUDIT_VERSION);
  });
  it('builds a plan ID with import ID and timestamp', () => {
    const id = buildSelfHealingPlanId({ importId: 'import-1', now: NOW });
    expect(id).toContain('import-1');
    expect(id).toContain('2026-07-08');
  });
  it('returns no_action when there are no issues', () => {
    const a = buildSelfHealingRetryPlan(healthy);
    expect(a.actions.length).toBe(0);
    expect(a.status).toBe('no_action');
  });
  it('returns blocked when import ID is missing', () => {
    const a = buildSelfHealingRetryPlan({ snapshot: {}, now: NOW });
    expect(a.status).toBe('blocked');
    expect(a.blockers).toContain('import_id_missing');
  });
  it('creates a pending build profile action when profile missing', () => {
    const a = buildSelfHealingRetryPlan({ ...healthy, importIntelligenceProfile: undefined });
    const build = a.actions.find((x) => x.actionId === 'build_import_intelligence_profile');
    expect(build).toBeTruthy();
    expect(build?.status).toBe('pending');
    expect(a.status).toBe('planned');
  });
  it('counts manual and blocked actions in the summary', () => {
    const a = buildSelfHealingRetryPlan({
      ...healthy,
      snapshot: { ...healthy.snapshot, visualQaScore: undefined, visualQaArtifactPath: undefined },
      adaptiveReconciliationPolicy: { decision: 'blocked', flags: { aiBlocked: true } },
    });
    expect(a.summary.manualActions).toBeGreaterThanOrEqual(1);
    expect(a.summary.blockedActions).toBeGreaterThanOrEqual(1);
  });
  it('limits actions to the max total', () => {
    const a = buildSelfHealingRetryPlan({
      importId: 'import-1', now: NOW,
      snapshot: { importId: 'import-1', importStatus: 'failed' },
    });
    expect(a.actions.length).toBeLessThanOrEqual(SELF_HEALING_MAX_TOTAL_ACTIONS);
  });
  it('sorts actions by priority ascending', () => {
    const a = buildSelfHealingRetryPlan({ ...healthy, importIntelligenceProfile: undefined, repairPatternAnalysis: undefined, adaptiveReconciliationPolicy: undefined });
    const priorities = a.actions.map((x) => x.priority);
    expect(priorities).toEqual([...priorities].sort((x, y) => x - y));
  });
  it('generatedAt uses now', () => {
    expect(buildSelfHealingRetryPlan(healthy).generatedAt).toBe('2026-07-08T00:00:00.000Z');
  });
});

describe('summary/status helpers', () => {
  it('summary counts are correct', () => {
    const summary = summarizeSelfHealingActions([
      { actionId: 'reload_snapshot', label: '', safetyLevel: 'safe_automatic', status: 'pending', priority: 1, reasonCodes: [], prerequisites: [], evidence: [], maxAttempts: 2, attemptCount: 0, message: '' },
      { actionId: 'rerun_visual_qa', label: '', safetyLevel: 'manual_only', status: 'manual_required', priority: 2, reasonCodes: [], prerequisites: [], evidence: [], maxAttempts: 2, attemptCount: 0, message: '' },
      { actionId: 'block_until_manual_review', label: '', safetyLevel: 'blocked', status: 'blocked', priority: 3, reasonCodes: [], prerequisites: [], evidence: [], maxAttempts: 2, attemptCount: 0, message: '' },
    ]);
    expect(summary.totalActions).toBe(3);
    expect(summary.executableActions).toBe(1);
    expect(summary.manualActions).toBe(1);
    expect(summary.blockedActions).toBe(1);
  });
  it('plan status is no_action with no actions', () => {
    expect(resolveSelfHealingPlanStatus([])).toBe('no_action');
  });
  it('plan status is blocked with import_id_missing blocker', () => {
    expect(resolveSelfHealingPlanStatus([], ['import_id_missing'])).toBe('blocked');
  });
});

describe('validateSelfHealingRetryAudit', () => {
  it('passes for a valid audit', () => {
    expect(validateSelfHealingRetryAudit(buildSelfHealingRetryPlan(healthy)).ok).toBe(true);
  });
  it('fails for an invalid mode', () => {
    const a = buildSelfHealingRetryPlan(healthy);
    expect(validateSelfHealingRetryAudit({ ...a, mode: 'nope' as any }).errors).toContain('invalid_mode');
  });
  it('catches inconsistent summary counts', () => {
    const a = buildSelfHealingRetryPlan({ ...healthy, importIntelligenceProfile: undefined });
    const bad = { ...a, summary: { ...a.summary, totalActions: a.summary.totalActions + 5 } };
    expect(validateSelfHealingRetryAudit(bad).errors).toContain('inconsistent_summary_total');
  });
});
