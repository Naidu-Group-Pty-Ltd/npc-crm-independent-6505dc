import { describe, expect, it } from 'vitest';
import {
  executeSelfHealingRetryPlan,
  canExecuteSelfHealingAction,
  buildSelfHealingRetryPlan,
} from '../ingestion/selfHealing';
import type { SelfHealingActionPlan, SelfHealingRetryAudit } from '../ingestion/selfHealing';

const NOW = () => new Date('2026-07-08T00:00:00.000Z');

function action(overrides: Partial<SelfHealingActionPlan>): SelfHealingActionPlan {
  return {
    actionId: 'reload_snapshot', label: 'Reload snapshot', safetyLevel: 'safe_automatic', status: 'pending',
    priority: 1, reasonCodes: [], prerequisites: [], evidence: [], maxAttempts: 2, attemptCount: 0, message: '',
    ...overrides,
  };
}

function audit(actions: SelfHealingActionPlan[]): SelfHealingRetryAudit {
  return {
    version: 'pdf-import-self-healing-retry-audit-v1',
    importId: 'import-1', templateId: 'template-1', sourceFilename: 'doc.pdf',
    planId: 'plan-1', mode: 'dry_run', status: 'planned',
    actions,
    summary: { totalActions: actions.length, executableActions: 0, completedActions: 0, failedActions: 0, skippedActions: 0, manualActions: 0, blockedActions: 0 },
    warnings: [], blockers: [], generatedAt: '2026-07-08T00:00:00.000Z', executedAt: null, persistedAt: null,
  };
}

describe('executeSelfHealingRetryPlan modes', () => {
  it('dry_run executes nothing and marks pending actions skipped', async () => {
    const r = await executeSelfHealingRetryPlan({ audit: audit([action({})]), mode: 'dry_run', now: NOW });
    expect(r.actions[0].status).toBe('skipped');
    expect(r.executedAt).toBeNull();
  });
  it('audit_only executes nothing', async () => {
    const r = await executeSelfHealingRetryPlan({ audit: audit([action({})]), mode: 'audit_only', now: NOW });
    expect(r.actions[0].status).toBe('skipped');
    expect(r.executedAt).toBeNull();
  });
  it('execute_safe executes only safe_automatic actions (reload_snapshot completes)', async () => {
    const r = await executeSelfHealingRetryPlan({ audit: audit([action({ actionId: 'reload_snapshot' })]), mode: 'execute_safe', now: NOW });
    expect(r.actions[0].status).toBe('completed');
    expect(r.executedAt).toBe('2026-07-08T00:00:00.000Z');
  });
  it('execute_safe skips operator_confirmed actions', async () => {
    const r = await executeSelfHealingRetryPlan({ audit: audit([action({ actionId: 'persist_import_intelligence_profile', safetyLevel: 'operator_confirmed' })]), mode: 'execute_safe', now: NOW });
    expect(r.actions[0].status).toBe('skipped');
  });
  it('execute_safe marks manual_only as manual_required', async () => {
    const r = await executeSelfHealingRetryPlan({ audit: audit([action({ actionId: 'rerun_visual_qa', safetyLevel: 'manual_only', status: 'manual_required' })]), mode: 'execute_safe', now: NOW });
    expect(r.actions[0].status).toBe('manual_required');
  });
  it('execute_safe leaves blocked as blocked', async () => {
    const r = await executeSelfHealingRetryPlan({ audit: audit([action({ actionId: 'block_until_manual_review', safetyLevel: 'blocked', status: 'blocked' })]), mode: 'execute_safe', now: NOW });
    expect(r.actions[0].status).toBe('blocked');
  });
  it('execute_confirmed without operatorConfirmed does not execute operator_confirmed actions', async () => {
    const r = await executeSelfHealingRetryPlan({ audit: audit([action({ actionId: 'persist_import_intelligence_profile', safetyLevel: 'operator_confirmed' })]), mode: 'execute_confirmed', operatorConfirmed: false, now: NOW });
    expect(r.actions[0].status).toBe('skipped');
  });
  it('execute_confirmed with operatorConfirmed marks unsupported metadata action not_supported', async () => {
    const r = await executeSelfHealingRetryPlan({ audit: audit([action({ actionId: 'persist_import_intelligence_profile', safetyLevel: 'operator_confirmed' })]), mode: 'execute_confirmed', operatorConfirmed: true, now: NOW });
    expect(r.actions[0].status).toBe('not_supported');
  });
});

describe('executor safety and status', () => {
  it('unsupported safe action becomes not_supported', async () => {
    const r = await executeSelfHealingRetryPlan({ audit: audit([action({ actionId: 'build_import_intelligence_profile', safetyLevel: 'safe_automatic' })]), mode: 'execute_safe', now: NOW });
    expect(r.actions[0].status).toBe('not_supported');
  });
  it('a failed action makes the audit failed', async () => {
    const r = await executeSelfHealingRetryPlan({ audit: audit([action({ status: 'failed' })]), mode: 'execute_safe', now: NOW });
    expect(r.status).toBe('failed');
  });
  it('completed safe actions make the audit completed when no manuals', async () => {
    const r = await executeSelfHealingRetryPlan({ audit: audit([action({ actionId: 'reload_snapshot' })]), mode: 'execute_safe', now: NOW });
    expect(r.status).toBe('completed');
  });
  it('a mix of completed and manual actions makes the audit partial', async () => {
    const r = await executeSelfHealingRetryPlan({
      audit: audit([action({ actionId: 'reload_snapshot' }), action({ actionId: 'rerun_visual_qa', safetyLevel: 'manual_only', status: 'manual_required' })]),
      mode: 'execute_safe', now: NOW,
    });
    expect(r.status).toBe('partial');
  });
  it('executedAt uses now and attemptCount increments on completion', async () => {
    const r = await executeSelfHealingRetryPlan({ audit: audit([action({ actionId: 'reload_snapshot', attemptCount: 0 })]), mode: 'execute_safe', now: NOW });
    expect(r.executedAt).toBe('2026-07-08T00:00:00.000Z');
    expect(r.actions[0].attemptCount).toBe(1);
  });
  it('never runs run_ai_reconciliation or rerun_import', async () => {
    const r = await executeSelfHealingRetryPlan({
      audit: audit([action({ actionId: 'run_ai_reconciliation', safetyLevel: 'manual_only', status: 'manual_required' }), action({ actionId: 'rerun_import', safetyLevel: 'manual_only', status: 'manual_required' })]),
      mode: 'execute_confirmed', operatorConfirmed: true, now: NOW,
    });
    expect(r.actions.every((a) => a.status !== 'completed')).toBe(true);
  });
  it('canExecuteSelfHealingAction blocks dry_run and manual_only', () => {
    expect(canExecuteSelfHealingAction({ action: action({}), mode: 'dry_run' }).canExecute).toBe(false);
    expect(canExecuteSelfHealingAction({ action: action({ safetyLevel: 'manual_only', status: 'manual_required' }), mode: 'execute_safe' }).canExecute).toBe(false);
  });
  it('result messages are populated after execution', async () => {
    const r = await executeSelfHealingRetryPlan({ audit: audit([action({ actionId: 'reload_snapshot' })]), mode: 'execute_safe', now: NOW });
    expect(typeof r.actions[0].resultMessage).toBe('string');
  });
  it('a real built plan for a healthy import remains no_action after dry_run', async () => {
    const plan = buildSelfHealingRetryPlan({
      importId: 'import-1', now: NOW,
      snapshot: { importId: 'import-1', templateId: 'template-1', importStatus: 'completed', visualQaScore: 0.95, visualQaArtifactPath: 'a', repairStatus: 'completed', repairArtifactPath: 'r', exportParityStatus: 'completed', exportVsSourceScore: 0.95, exportParityArtifactPath: 'e' },
      importIntelligenceProfile: { profileCategory: 'simple_document', riskLevel: 'low', scores: {} },
      repairPatternAnalysis: { deterministicRepairStrategy: 'safe' },
      adaptiveReconciliationPolicy: { decision: 'not_needed', flags: { aiBlocked: false } },
      goldenRegressionSummary: { qualityGateStatus: 'pass' },
    });
    const r = await executeSelfHealingRetryPlan({ audit: plan, mode: 'dry_run', now: NOW });
    expect(r.status).toBe('no_action');
  });
});
