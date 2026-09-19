import { describe, expect, it } from 'vitest';
import {
  getAdaptiveReconciliationDecisionLabel,
  getAdaptiveReconciliationSeverityLabel,
  getAdaptiveReconciliationActionLabel,
  getAdaptiveReconciliationDecisionTone,
  formatAdaptiveReconciliationConfidence,
  getAdaptiveReconciliationHeadline,
  summarizeAdaptiveReconciliationPolicy,
  buildAdaptiveReconciliationPolicy,
} from '../ingestion/reconciliation';

const NOW = () => new Date('2026-07-08T00:00:00.000Z');

describe('adaptive reconciliation display', () => {
  it('maps decision labels correctly', () => {
    expect(getAdaptiveReconciliationDecisionLabel('recommended')).toBe('Recommended');
    expect(getAdaptiveReconciliationDecisionLabel('manual_review')).toBe('Manual review');
    expect(getAdaptiveReconciliationDecisionLabel('blocked')).toBe('Blocked');
  });
  it('returns Unknown for an unknown decision', () => {
    expect(getAdaptiveReconciliationDecisionLabel('nope')).toBe('Unknown');
    expect(getAdaptiveReconciliationDecisionLabel(null)).toBe('Unknown');
  });
  it('maps severity labels correctly', () => {
    expect(getAdaptiveReconciliationSeverityLabel('critical')).toBe('Critical severity');
  });
  it('maps action labels correctly', () => {
    expect(getAdaptiveReconciliationActionLabel('run_ai_reconciliation')).toBe('Run AI reconciliation');
    expect(getAdaptiveReconciliationActionLabel('block_ai_reconciliation')).toBe('Block AI reconciliation');
  });

  it('decision tones', () => {
    expect(getAdaptiveReconciliationDecisionTone('not_needed')).toBe('default');
    expect(getAdaptiveReconciliationDecisionTone('optional')).toBe('secondary');
    expect(getAdaptiveReconciliationDecisionTone('recommended')).toBe('secondary');
    expect(getAdaptiveReconciliationDecisionTone('manual_review')).toBe('destructive');
    expect(getAdaptiveReconciliationDecisionTone('blocked')).toBe('destructive');
  });

  it('confidence formatter', () => {
    expect(formatAdaptiveReconciliationConfidence(0.91)).toBe('91%');
    expect(formatAdaptiveReconciliationConfidence(null)).toBe('—');
  });

  it('headline returns no-policy message for null', () => {
    expect(getAdaptiveReconciliationHeadline(null)).toBe('No adaptive reconciliation policy');
  });

  it('headline includes decision and severity for a policy', () => {
    const p = buildAdaptiveReconciliationPolicy({
      importId: 'import-1',
      importIntelligenceProfile: { profileCategory: 'table_heavy', riskLevel: 'medium', scores: { tableRiskScore: 0.9 } },
      repairPatternAnalysis: { primaryPatternId: 'table_grid_drift', aiReconciliationUsefulness: 'high' },
      snapshot: { importId: 'import-1', visualQaScore: 0.8 },
      now: NOW,
    });
    const headline = getAdaptiveReconciliationHeadline(p);
    expect(headline).toContain(getAdaptiveReconciliationSeverityLabel(p.severity));
  });

  it('summary returns label/tone/confidence/action', () => {
    const p = buildAdaptiveReconciliationPolicy({ importId: 'import-1', snapshot: { importId: 'import-1' }, now: NOW });
    const s = summarizeAdaptiveReconciliationPolicy(p);
    expect(typeof s.label).toBe('string');
    expect(typeof s.severityLabel).toBe('string');
    expect(typeof s.actionLabel).toBe('string');
    expect(s.confidenceLabel).toMatch(/%$|—/);
  });

  it('summary handles null policy', () => {
    const s = summarizeAdaptiveReconciliationPolicy(null);
    expect(s.label).toBe('No adaptive reconciliation policy');
    expect(s.tone).toBe('outline');
  });
});
