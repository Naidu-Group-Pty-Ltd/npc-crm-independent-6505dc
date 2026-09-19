import { describe, expect, it } from 'vitest';
import {
  getImportIntelligenceCategoryLabel,
  getImportIntelligenceRiskLabel,
  getImportIntelligenceRiskTone,
  formatImportIntelligenceScore,
  getImportIntelligenceHeadline,
  summarizeImportIntelligenceProfile,
  buildImportIntelligenceProfile,
} from '../ingestion/importIntelligence';

const NOW = () => new Date('2026-07-08T00:00:00.000Z');

describe('labels', () => {
  it('maps category labels correctly', () => {
    expect(getImportIntelligenceCategoryLabel('simple_document')).toBe('Simple document');
    expect(getImportIntelligenceCategoryLabel('scanned_ocr')).toBe('Scanned/OCR');
    expect(getImportIntelligenceCategoryLabel('high_risk')).toBe('High risk');
  });
  it('returns Unknown for an unknown category', () => {
    expect(getImportIntelligenceCategoryLabel('nope')).toBe('Unknown');
    expect(getImportIntelligenceCategoryLabel(null)).toBe('Unknown');
  });
  it('maps risk labels correctly', () => {
    expect(getImportIntelligenceRiskLabel('low')).toBe('Low risk');
    expect(getImportIntelligenceRiskLabel('critical')).toBe('Critical risk');
  });
});

describe('tones', () => {
  it('low risk tone is default', () => {
    expect(getImportIntelligenceRiskTone('low')).toBe('default');
  });
  it('medium risk tone is secondary', () => {
    expect(getImportIntelligenceRiskTone('medium')).toBe('secondary');
  });
  it('high/critical risk tone is destructive', () => {
    expect(getImportIntelligenceRiskTone('high')).toBe('destructive');
    expect(getImportIntelligenceRiskTone('critical')).toBe('destructive');
  });
  it('unknown risk tone is outline', () => {
    expect(getImportIntelligenceRiskTone('unknown')).toBe('outline');
    expect(getImportIntelligenceRiskTone(null)).toBe('outline');
  });
});

describe('score formatting', () => {
  it('returns 91% for 0.91', () => {
    expect(formatImportIntelligenceScore(0.91)).toBe('91%');
  });
  it('returns an em dash for null', () => {
    expect(formatImportIntelligenceScore(null)).toBe('—');
    expect(formatImportIntelligenceScore(undefined)).toBe('—');
  });
});

describe('headline and summary', () => {
  it('returns "No import intelligence profile" for null', () => {
    expect(getImportIntelligenceHeadline(null)).toBe('No import intelligence profile');
  });
  it('includes category and risk for a profile', () => {
    const p = buildImportIntelligenceProfile({
      importId: 'import-1',
      snapshot: { importId: 'import-1', importPageCount: 1, visualQaScore: 0.97, repairStatus: 'completed', repairFinalScore: 0.96, exportParityStatus: 'completed', exportVsSourceScore: 0.95 },
      now: NOW,
    });
    const headline = getImportIntelligenceHeadline(p);
    expect(headline).toContain(getImportIntelligenceCategoryLabel(p.profileCategory));
    expect(headline).toContain(getImportIntelligenceRiskLabel(p.riskLevel));
  });
  it('summarizeImportIntelligenceProfile returns label/tone/confidence/recommendation', () => {
    const p = buildImportIntelligenceProfile({
      importId: 'import-1',
      snapshot: { importId: 'import-1', importPageCount: 1, visualQaScore: 0.97, repairStatus: 'completed', repairFinalScore: 0.96, exportParityStatus: 'completed', exportVsSourceScore: 0.95 },
      now: NOW,
    });
    const s = summarizeImportIntelligenceProfile(p);
    expect(s.label).toBe(getImportIntelligenceCategoryLabel(p.profileCategory));
    expect(s.riskLabel).toBe(getImportIntelligenceRiskLabel(p.riskLevel));
    expect(s.tone).toBe(getImportIntelligenceRiskTone(p.riskLevel));
    expect(s.confidenceLabel).toMatch(/%$/);
    expect(s.recommendationLabel).toContain('Operator');
  });
  it('summarize handles null profile', () => {
    const s = summarizeImportIntelligenceProfile(null);
    expect(s.label).toBe('No import intelligence profile');
    expect(s.tone).toBe('outline');
  });
});
