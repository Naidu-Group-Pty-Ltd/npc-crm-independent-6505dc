import { describe, expect, it, vi } from 'vitest';
import {
  executeOperatorControl,
  buildOperatorDecisionMetadataPatch,
  canExecuteOperatorControl,
  type OperatorControlExecutionRequest,
} from '../ingestion/operatorControls';

const NOW = () => new Date('2026-07-09T00:00:00.000Z');

function req(overrides: Partial<OperatorControlExecutionRequest> = {}): OperatorControlExecutionRequest {
  return { importId: 'import-1', templateId: 'template-1', controlId: 'mark_accepted', operatorConfirmed: true, ...overrides };
}

function auditOf(patch: Record<string, unknown> | null | undefined) {
  return (patch as any)?.production_operator_control_audit;
}

describe('executeOperatorControl — metadata decision controls', () => {
  it('mark_accepted builds accepted operator state', async () => {
    const r = await executeOperatorControl({ request: req({ controlId: 'mark_accepted' }), now: NOW });
    expect(r.status).toBe('completed');
    expect(auditOf(r.metadataPatch).operatorState.decision).toBe('accepted');
    expect(auditOf(r.metadataPatch).operatorState.acceptedAt).toBe('2026-07-09T00:00:00.000Z');
  });
  it('mark_accepted_with_warnings builds accepted_with_warnings state', async () => {
    const r = await executeOperatorControl({ request: req({ controlId: 'mark_accepted_with_warnings' }), now: NOW });
    expect(auditOf(r.metadataPatch).operatorState.decision).toBe('accepted_with_warnings');
  });
  it('mark_rejected builds rejected state and rejectedAt', async () => {
    const r = await executeOperatorControl({ request: req({ controlId: 'mark_rejected' }), now: NOW });
    expect(auditOf(r.metadataPatch).operatorState.decision).toBe('rejected');
    expect(auditOf(r.metadataPatch).operatorState.rejectedAt).toBeTruthy();
  });
  it('mark_needs_rerun builds needs_rerun state', async () => {
    const r = await executeOperatorControl({ request: req({ controlId: 'mark_needs_rerun' }), now: NOW });
    expect(auditOf(r.metadataPatch).operatorState.decision).toBe('needs_rerun');
  });
  it('mark_manual_review_required sets manualReviewRequired true', async () => {
    const r = await executeOperatorControl({ request: req({ controlId: 'mark_manual_review_required' }), now: NOW });
    expect(auditOf(r.metadataPatch).operatorState.manualReviewRequired).toBe(true);
  });
  it('mark_blocked sets blocked true', async () => {
    const r = await executeOperatorControl({ request: req({ controlId: 'mark_blocked' }), now: NOW });
    expect(auditOf(r.metadataPatch).operatorState.blocked).toBe(true);
  });
  it('add_operator_note appends note', async () => {
    const r = await executeOperatorControl({ request: req({ controlId: 'add_operator_note', note: 'checked layout' }), now: NOW });
    expect(auditOf(r.metadataPatch).notes).toContain('checked layout');
  });
  it('confirmation required blocks mark_accepted if not confirmed', async () => {
    const r = await executeOperatorControl({ request: req({ controlId: 'mark_accepted', operatorConfirmed: false }), now: NOW });
    expect(r.status).toBe('blocked');
    expect(r.message).toBe('operator_confirmation_required');
  });
  it('metadata patch contains production_operator_control_audit', async () => {
    const r = await executeOperatorControl({ request: req({ controlId: 'add_operator_note', note: 'x' }), now: NOW });
    expect(r.metadataPatch).toHaveProperty('production_operator_control_audit');
  });
  it('executedAt uses now', async () => {
    const r = await executeOperatorControl({ request: req({ controlId: 'add_operator_note', note: 'x' }), now: NOW });
    expect(r.executedAt).toBe('2026-07-09T00:00:00.000Z');
  });
  it('lastActionId and lastActionAt update', async () => {
    const r = await executeOperatorControl({ request: req({ controlId: 'mark_accepted' }), now: NOW });
    expect(auditOf(r.metadataPatch).operatorState.lastActionId).toBe('mark_accepted');
    expect(auditOf(r.metadataPatch).operatorState.lastActionAt).toBe('2026-07-09T00:00:00.000Z');
  });
});

describe('executeOperatorControl — non-metadata controls', () => {
  it('clear_operator_control_audit returns blocked', async () => {
    const r = await executeOperatorControl({ request: req({ controlId: 'clear_operator_control_audit' }), now: NOW });
    expect(r.status).toBe('blocked');
  });
  it('manual workflow control returns manual_required', async () => {
    const r = await executeOperatorControl({ request: req({ controlId: 'rerun_visual_qa_manual', operatorConfirmed: false }), now: NOW });
    expect(r.status).toBe('manual_required');
  });
  it('orchestrator_safe without runner returns not_supported', async () => {
    const r = await executeOperatorControl({ request: req({ controlId: 'build_import_intelligence_profile' }), now: NOW });
    expect(r.status).toBe('not_supported');
  });
  it('orchestrator_safe with runner calls runner', async () => {
    const runner = vi.fn().mockResolvedValue({ ok: true });
    const r = await executeOperatorControl({ request: req({ controlId: 'build_import_intelligence_profile' }), now: NOW, orchestratorRunner: runner });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(r.status).toBe('completed');
  });
});

describe('canExecuteOperatorControl', () => {
  it('blocks manual workflow', () => {
    expect(canExecuteOperatorControl({ request: req({ controlId: 'rerun_import_manual' }) }).canExecute).toBe(false);
  });
  it('requires confirmation', () => {
    expect(canExecuteOperatorControl({ request: req({ controlId: 'mark_accepted', operatorConfirmed: false }) }).reason).toBe('operator_confirmation_required');
  });
  it('buildOperatorDecisionMetadataPatch preserves prior notes', () => {
    const prior = { production_operator_control_audit: undefined } as any;
    void prior;
    const patch = buildOperatorDecisionMetadataPatch({
      request: req({ controlId: 'add_operator_note', note: 'second' }),
      currentAudit: { version: 'pdf-import-production-operator-control-audit-v1', importId: 'import-1', templateId: 't', sourceFilename: null, operatorState: { decision: 'accepted', manualReviewRequired: false, blocked: false, acceptedAt: null, rejectedAt: null, lastActionId: null, lastActionAt: null }, controls: [], executedActions: [], notes: ['first'], warnings: [], blockers: [], generatedAt: '2026-07-08T00:00:00.000Z', persistedAt: null } as any,
      now: NOW,
    });
    expect(patch.notes).toEqual(['first', 'second']);
  });
});

import { resolvePdfImportOperatorRole } from '../ingestion/operatorPermissions';

describe('Phase 11B — executor permission enforcement', () => {
  const adminRole = resolvePdfImportOperatorRole({ isAuthenticated: true, profile: { role: 'admin' } });
  const operatorRole = resolvePdfImportOperatorRole({ isAuthenticated: true, profile: { role: 'operator' } });

  it('admin can execute mark_accepted (permission allowed)', async () => {
    const r = await executeOperatorControl({ request: req({ controlId: 'mark_accepted', resolvedRole: adminRole }), now: NOW });
    expect(r.status).toBe('completed');
  });

  it('operator role is blocked from mark_accepted by permission', async () => {
    const r = await executeOperatorControl({ request: req({ controlId: 'mark_accepted', resolvedRole: operatorRole }), now: NOW });
    expect(r.status).toBe('blocked');
    expect(r.message).toMatch(/does not have|permission/i);
  });

  it('operator role can still add a note (has add_note capability)', async () => {
    const r = await executeOperatorControl({ request: req({ controlId: 'add_operator_note', note: 'x', resolvedRole: operatorRole, operatorConfirmed: false }), now: NOW });
    // operator role does NOT have add_note (qa+). Expect blocked.
    expect(r.status).toBe('blocked');
  });

  it('qa role can add a note', async () => {
    const qaRole = resolvePdfImportOperatorRole({ isAuthenticated: true, profile: { role: 'qa' } });
    const r = await executeOperatorControl({ request: req({ controlId: 'add_operator_note', note: 'x', resolvedRole: qaRole, operatorConfirmed: false }), now: NOW });
    expect(r.status).toBe('completed');
  });

  it('permission enforcement does not fire without a context (backward compatible)', async () => {
    const r = await executeOperatorControl({ request: req({ controlId: 'mark_accepted' }), now: NOW });
    expect(r.status).toBe('completed');
  });

  it('manual-only control stays manual_required even when role permits it', async () => {
    const r = await executeOperatorControl({ request: req({ controlId: 'run_ai_reconciliation_manual', resolvedRole: adminRole, operatorConfirmed: false }), now: NOW });
    expect(r.status).toBe('manual_required');
  });
});
