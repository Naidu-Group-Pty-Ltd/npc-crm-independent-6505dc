import { describe, expect, it } from 'vitest';
import {
  getPdfImportCostLevelLabel,
  getPdfImportCostLevelTone,
  getPdfImportPerformanceRiskLabel,
  getPdfImportPerformanceRiskTone,
  getPdfImportOptimizationActionLabel,
  formatPdfImportPerformanceScore,
  getPdfImportPerformanceHeadline,
  summarizePdfImportPerformanceAudit,
  buildPdfImportPerformanceCostAudit,
} from '../ingestion/performance';

const NOW = () => new Date('2026-07-09T00:00:00.000Z');

describe('performance display', () => {
  it('maps cost labels correctly', () => {
    expect(getPdfImportCostLevelLabel('very_high')).toBe('Very high');
    expect(getPdfImportCostLevelLabel('negligible')).toBe('Negligible');
    expect(getPdfImportCostLevelLabel(null)).toBe('Unknown');
  });
  it('maps high/very_high cost to destructive tone', () => {
    expect(getPdfImportCostLevelTone('high')).toBe('destructive');
    expect(getPdfImportCostLevelTone('very_high')).toBe('destructive');
    expect(getPdfImportCostLevelTone('low')).toBe('default');
  });
  it('maps risk labels correctly', () => {
    expect(getPdfImportPerformanceRiskLabel('critical')).toBe('Critical');
    expect(getPdfImportPerformanceRiskLabel('medium')).toBe('Medium');
  });
  it('maps high/critical risk to destructive tone', () => {
    expect(getPdfImportPerformanceRiskTone('high')).toBe('destructive');
    expect(getPdfImportPerformanceRiskTone('critical')).toBe('destructive');
    expect(getPdfImportPerformanceRiskTone('unknown')).toBe('outline');
  });
  it('maps action labels correctly', () => {
    expect(getPdfImportOptimizationActionLabel('reuse_existing_result')).toBe('Reuse existing result');
    expect(getPdfImportOptimizationActionLabel('avoid_ai_reconciliation')).toBe('Avoid AI reconciliation');
    expect(getPdfImportOptimizationActionLabel('nope')).toBe('No action');
  });
  it('formats scores', () => {
    expect(formatPdfImportPerformanceScore(0.91)).toBe('91%');
    expect(formatPdfImportPerformanceScore(null)).toBe('—');
  });
  it('headline returns no audit for null', () => {
    expect(getPdfImportPerformanceHeadline(null)).toBe('No performance/cost audit');
  });
  it('headline includes risk and cost', () => {
    const audit = buildPdfImportPerformanceCostAudit({ snapshot: { importId: 'import-1', importStatus: 'completed' }, now: NOW });
    const h = getPdfImportPerformanceHeadline(audit);
    expect(h).toContain('Performance risk');
    expect(h).toContain('Cost');
  });
  it('summary returns labels and recommendation count', () => {
    const audit = buildPdfImportPerformanceCostAudit({ snapshot: { importId: 'import-1', importStatus: 'completed' }, now: NOW });
    const s = summarizePdfImportPerformanceAudit(audit);
    expect(typeof s.costLabel).toBe('string');
    expect(typeof s.riskLabel).toBe('string');
    expect(s.recommendationCountLabel).toBe(String(audit.recommendations.length));
  });
  it('summary handles null audit', () => {
    const s = summarizePdfImportPerformanceAudit(null);
    expect(s.label).toBe('No performance/cost audit');
    expect(s.tone).toBe('outline');
  });
});
