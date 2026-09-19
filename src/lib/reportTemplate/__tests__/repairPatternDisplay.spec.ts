import { describe, expect, it } from 'vitest';
import {
  getRepairPatternLabel,
  getRepairPatternSeverityLabel,
  getRepairPatternSeverityTone,
  formatRepairPatternScore,
  getRepairPatternAnalysisHeadline,
  summarizeRepairPatternAnalysis,
  buildRepairPatternAnalysis,
} from '../ingestion/repairPatterns';

const NOW = () => new Date('2026-07-08T00:00:00.000Z');

describe('repairPatternDisplay labels', () => {
  it('maps pattern labels correctly', () => {
    expect(getRepairPatternLabel('table_grid_drift')).toBe('Table grid drift');
    expect(getRepairPatternLabel('manual_review_only')).toBe('Manual review only');
  });
  it('returns Unknown for an unknown pattern', () => {
    expect(getRepairPatternLabel('nope')).toBe('Unknown');
    expect(getRepairPatternLabel(null)).toBe('Unknown');
  });
  it('maps severity labels correctly', () => {
    expect(getRepairPatternSeverityLabel('high')).toBe('High severity');
    expect(getRepairPatternSeverityLabel('critical')).toBe('Critical severity');
  });
});

describe('repairPatternDisplay tones', () => {
  it('low/info severity tone is outline/default', () => {
    expect(getRepairPatternSeverityTone('info')).toBe('outline');
    expect(getRepairPatternSeverityTone('low')).toBe('default');
  });
  it('medium severity tone is secondary', () => {
    expect(getRepairPatternSeverityTone('medium')).toBe('secondary');
  });
  it('high/critical severity tone is destructive', () => {
    expect(getRepairPatternSeverityTone('high')).toBe('destructive');
    expect(getRepairPatternSeverityTone('critical')).toBe('destructive');
  });
});

describe('repairPatternDisplay score', () => {
  it('returns 91% for 0.91', () => {
    expect(formatRepairPatternScore(0.91)).toBe('91%');
  });
  it('returns em dash for null', () => {
    expect(formatRepairPatternScore(null)).toBe('—');
  });
});

describe('repairPatternDisplay headline/summary', () => {
  it('returns no-analysis message for null', () => {
    expect(getRepairPatternAnalysisHeadline(null)).toBe('No repair pattern analysis');
  });

  it('includes primary pattern and severity for a matched analysis', () => {
    const analysis = buildRepairPatternAnalysis({
      importId: 'import-1',
      importIntelligenceProfile: {
        profileCategory: 'table_heavy', riskLevel: 'high',
        scores: { tableRiskScore: 0.9, automationRiskScore: 0.4 },
      },
      snapshot: { importId: 'import-1', visualQaScore: 0.8, exportVsSourceScore: 0.8 },
      now: NOW,
    });
    const headline = getRepairPatternAnalysisHeadline(analysis);
    expect(headline).toContain(getRepairPatternSeverityLabel(analysis.overallSeverity));
  });

  it('summarize returns label/tone/confidence/strategy/review', () => {
    const analysis = buildRepairPatternAnalysis({
      importId: 'import-1',
      importIntelligenceProfile: { profileCategory: 'high_risk', riskLevel: 'critical', scores: { automationRiskScore: 0.9, manualReviewLikelihood: 0.9 } },
      snapshot: { importId: 'import-1', repairRequiresManualReview: true },
      now: NOW,
    });
    const s = summarizeRepairPatternAnalysis(analysis);
    expect(typeof s.label).toBe('string');
    expect(typeof s.severityLabel).toBe('string');
    expect(typeof s.strategyLabel).toBe('string');
    expect(typeof s.reviewLabel).toBe('string');
    expect(s.confidenceLabel).toMatch(/%$|—/);
  });

  it('summarize handles null analysis', () => {
    const s = summarizeRepairPatternAnalysis(null);
    expect(s.label).toBe('No repair pattern analysis');
    expect(s.tone).toBe('outline');
  });
});
