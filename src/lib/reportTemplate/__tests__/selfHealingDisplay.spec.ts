import { describe, expect, it } from 'vitest';
import {
  getSelfHealingModeLabel,
  getSelfHealingPlanStatusLabel,
  getSelfHealingPlanStatusTone,
  getSelfHealingSafetyLevelLabel,
  getSelfHealingSafetyLevelTone,
  getSelfHealingActionStatusLabel,
  getSelfHealingActionLabel,
  getSelfHealingHeadline,
  summarizeSelfHealingAudit,
  buildSelfHealingRetryPlan,
} from '../ingestion/selfHealing';

const NOW = () => new Date('2026-07-08T00:00:00.000Z');

describe('self-healing display', () => {
  it('maps mode labels', () => {
    expect(getSelfHealingModeLabel('dry_run')).toBe('Dry run');
    expect(getSelfHealingModeLabel('execute_confirmed')).toBe('Execute confirmed actions');
  });
  it('maps plan status labels', () => {
    expect(getSelfHealingPlanStatusLabel('completed_with_warnings')).toBe('Completed with warnings');
    expect(getSelfHealingPlanStatusLabel('no_action')).toBe('No action');
  });
  it('maps failed/blocked plan status to destructive tone', () => {
    expect(getSelfHealingPlanStatusTone('failed')).toBe('destructive');
    expect(getSelfHealingPlanStatusTone('blocked')).toBe('destructive');
    expect(getSelfHealingPlanStatusTone('no_action')).toBe('outline');
  });
  it('maps safety labels and tones', () => {
    expect(getSelfHealingSafetyLevelLabel('safe_automatic')).toBe('Safe automatic');
    expect(getSelfHealingSafetyLevelTone('blocked')).toBe('destructive');
    expect(getSelfHealingSafetyLevelTone('safe_automatic')).toBe('default');
  });
  it('maps action status labels', () => {
    expect(getSelfHealingActionStatusLabel('manual_required')).toBe('Manual required');
    expect(getSelfHealingActionStatusLabel('not_supported')).toBe('Not supported');
  });
  it('maps canonical action IDs and returns Unknown for unknown', () => {
    expect(getSelfHealingActionLabel('run_ai_reconciliation')).toBe('Run AI reconciliation');
    expect(getSelfHealingActionLabel('block_until_manual_review')).toBe('Block until manual review');
    expect(getSelfHealingActionLabel('nope')).toBe('Unknown');
  });
  it('headline returns no-plan message for null', () => {
    expect(getSelfHealingHeadline(null)).toBe('No self-healing retry plan');
  });
  it('headline includes status and mode', () => {
    const a = buildSelfHealingRetryPlan({ importId: 'import-1', snapshot: { importId: 'import-1', importStatus: 'failed' }, mode: 'dry_run', now: NOW });
    const h = getSelfHealingHeadline(a);
    expect(h).toContain(getSelfHealingModeLabel(a.mode));
  });
  it('summary returns expected counts', () => {
    const a = buildSelfHealingRetryPlan({ importId: 'import-1', snapshot: { importId: 'import-1', importStatus: 'failed' }, now: NOW });
    const s = summarizeSelfHealingAudit(a);
    expect(typeof s.label).toBe('string');
    expect(typeof s.executableLabel).toBe('string');
    expect(typeof s.manualLabel).toBe('string');
    expect(typeof s.blockedLabel).toBe('string');
  });
  it('summary handles null audit', () => {
    const s = summarizeSelfHealingAudit(null);
    expect(s.label).toBe('No self-healing retry plan');
    expect(s.tone).toBe('outline');
  });
});
