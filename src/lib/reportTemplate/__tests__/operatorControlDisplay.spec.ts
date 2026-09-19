import { describe, expect, it } from 'vitest';
import {
  getOperatorControlLabel,
  getOperatorControlStateLabel,
  getOperatorControlStateTone,
  getOperatorControlSafetyLabel,
  getOperatorControlSafetyTone,
  getOperatorDecisionLabel,
  getOperatorDecisionTone,
  getProductionOperatorControlHeadline,
  summarizeProductionOperatorControlAudit,
  buildProductionOperatorControlAudit,
} from '../ingestion/operatorControls';

const NOW = () => new Date('2026-07-09T00:00:00.000Z');

describe('operator control display', () => {
  it('maps canonical control labels', () => {
    expect(getOperatorControlLabel('mark_accepted')).toBe('Mark accepted');
    expect(getOperatorControlLabel('run_ai_reconciliation_manual')).toBe('Run AI reconciliation (manual)');
  });
  it('returns Unknown for unknown control', () => {
    expect(getOperatorControlLabel('nope')).toBe('Unknown');
    expect(getOperatorControlLabel(null)).toBe('Unknown');
  });
  it('maps state labels', () => {
    expect(getOperatorControlStateLabel('requires_confirmation')).toBe('Requires confirmation');
    expect(getOperatorControlStateLabel('manual_only')).toBe('Manual only');
  });
  it('maps blocked/failed state tone to destructive', () => {
    expect(getOperatorControlStateTone('blocked')).toBe('destructive');
    expect(getOperatorControlStateTone('failed')).toBe('destructive');
  });
  it('maps recommended/requires_confirmation tone to secondary', () => {
    expect(getOperatorControlStateTone('recommended')).toBe('secondary');
    expect(getOperatorControlStateTone('requires_confirmation')).toBe('secondary');
  });
  it('maps safety labels', () => {
    expect(getOperatorControlSafetyLabel('metadata_write')).toBe('Metadata write');
    expect(getOperatorControlSafetyLabel('orchestrator_safe')).toBe('Orchestrator safe');
  });
  it('maps blocked safety tone to destructive', () => {
    expect(getOperatorControlSafetyTone('blocked')).toBe('destructive');
  });
  it('maps operator decision labels', () => {
    expect(getOperatorDecisionLabel('accepted_with_warnings')).toBe('Accepted with warnings');
    expect(getOperatorDecisionLabel('manual_review_required')).toBe('Manual review required');
  });
  it('maps rejected/blocked decision tone to destructive', () => {
    expect(getOperatorDecisionTone('rejected')).toBe('destructive');
    expect(getOperatorDecisionTone('blocked')).toBe('destructive');
    expect(getOperatorDecisionTone('accepted')).toBe('default');
  });
  it('headline returns no audit for null', () => {
    expect(getProductionOperatorControlHeadline(null)).toBe('No production operator controls');
  });
  it('headline includes decision', () => {
    const audit = buildProductionOperatorControlAudit({ snapshot: { importId: 'import-1', importStatus: 'completed', templateId: 't' }, goldenRegressionSummary: { qualityGateStatus: 'pass' }, now: NOW });
    expect(getProductionOperatorControlHeadline(audit)).toContain('Operator decision');
  });
  it('summary returns expected counts', () => {
    const audit = buildProductionOperatorControlAudit({ snapshot: { importId: 'import-1', importStatus: 'completed', templateId: 't' }, goldenRegressionSummary: { qualityGateStatus: 'pass' }, now: NOW });
    const s = summarizeProductionOperatorControlAudit(audit);
    expect(typeof s.recommendedCountLabel).toBe('string');
    expect(typeof s.blockedCountLabel).toBe('string');
    expect(typeof s.manualCountLabel).toBe('string');
    expect(Number(s.blockedCountLabel)).toBeGreaterThanOrEqual(1); // clear_operator_control_audit
  });
  it('summary handles null audit', () => {
    const s = summarizeProductionOperatorControlAudit(null);
    expect(s.label).toBe('No production operator controls');
    expect(s.tone).toBe('outline');
  });
});
