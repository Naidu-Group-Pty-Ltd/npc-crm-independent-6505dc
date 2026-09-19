import { describe, expect, it } from 'vitest';
import {
  classifyImportIntelligenceProfile,
  calculateImportProfileConfidence,
  resolveImportRiskLevel,
} from '../ingestion/importIntelligence';
import type {
  ImportIntelligenceScores,
  ImportIntelligenceSignals,
} from '../ingestion/importIntelligence';

function sig(overrides: Partial<ImportIntelligenceSignals> = {}): ImportIntelligenceSignals {
  return {
    pageCount: null,
    isMultiPage: null,
    hasVisualQuality: false,
    visualQaScore: null,
    visualQaManualReviewRequired: null,
    hasRepairAudit: false,
    repairStatus: null,
    repairFinalScore: null,
    repairRequiresFallback: null,
    repairRequiresManualReview: null,
    hasExportParity: false,
    exportParityStatus: null,
    exportVsSourceScore: null,
    editorVsSourceScore: null,
    exportVsEditorScore: null,
    aiReconciliationStatus: null,
    aiReconciliationRecommendation: null,
    engineVersion: null,
    tableCountEstimate: null,
    imageCountEstimate: null,
    textDensityEstimate: null,
    ocrLikelihood: null,
    designComplexityEstimate: null,
    layoutRiskEstimate: null,
    goldenQualityGateStatus: null,
    goldenFailureCount: null,
    goldenWarningCount: null,
    baselineOutcome: null,
    ...overrides,
  };
}

function scores(overrides: Partial<ImportIntelligenceScores> = {}): ImportIntelligenceScores {
  return {
    complexityScore: null,
    ocrRiskScore: null,
    tableRiskScore: null,
    imageRiskScore: null,
    designRiskScore: null,
    automationRiskScore: null,
    manualReviewLikelihood: null,
    confidence: null,
    ...overrides,
  };
}

const simple = sig({
  pageCount: 1,
  hasVisualQuality: true,
  visualQaScore: 0.97,
  hasRepairAudit: true,
  repairStatus: 'completed',
  repairFinalScore: 0.96,
  hasExportParity: true,
  exportParityStatus: 'completed',
  exportVsSourceScore: 0.95,
  tableCountEstimate: 0,
  imageCountEstimate: 0,
});

describe('classifyImportIntelligenceProfile categories', () => {
  it('classifies simple low-risk one-page signals as simple_document', () => {
    const r = classifyImportIntelligenceProfile({ signals: simple });
    expect(r.profileCategory).toBe('simple_document');
  });

  it('classifies moderate multi-page signals as multi_page_report', () => {
    const r = classifyImportIntelligenceProfile({ signals: sig({
      pageCount: 5,
      hasVisualQuality: true,
      visualQaScore: 0.78,
      hasRepairAudit: true,
      repairStatus: 'completed',
      repairFinalScore: 0.82,
      hasExportParity: true,
      exportParityStatus: 'completed',
      exportVsSourceScore: 0.82,
      tableCountEstimate: 1,
      imageCountEstimate: 1,
    }) });
    expect(r.profileCategory).toBe('multi_page_report');
  });

  it('classifies high table risk as table_heavy', () => {
    const r = classifyImportIntelligenceProfile({ signals: sig({
      pageCount: 2,
      hasVisualQuality: true,
      visualQaScore: 0.9,
      hasRepairAudit: true,
      repairStatus: 'completed',
      repairFinalScore: 0.9,
      hasExportParity: true,
      exportParityStatus: 'completed',
      exportVsSourceScore: 0.9,
      tableCountEstimate: 6,
      imageCountEstimate: 0,
    }) });
    expect(r.profileCategory).toBe('table_heavy');
  });

  it('classifies high image risk as image_heavy', () => {
    const r = classifyImportIntelligenceProfile({ signals: sig({
      pageCount: 2,
      hasVisualQuality: true,
      visualQaScore: 0.9,
      hasRepairAudit: true,
      repairStatus: 'completed',
      repairFinalScore: 0.9,
      hasExportParity: true,
      exportParityStatus: 'completed',
      exportVsSourceScore: 0.9,
      tableCountEstimate: 0,
      imageCountEstimate: 6,
    }) });
    expect(r.profileCategory).toBe('image_heavy');
  });

  it('classifies high design risk as design_heavy', () => {
    const r = classifyImportIntelligenceProfile({ signals: sig({
      pageCount: 2,
      hasVisualQuality: true,
      visualQaScore: 0.9,
      hasRepairAudit: true,
      repairStatus: 'completed',
      repairFinalScore: 0.9,
      hasExportParity: true,
      exportParityStatus: 'completed',
      exportVsSourceScore: 0.9,
      tableCountEstimate: 0,
      imageCountEstimate: 1,
      designComplexityEstimate: 0.8,
    }) });
    expect(r.profileCategory).toBe('design_heavy');
  });

  it('classifies high OCR risk as scanned_ocr', () => {
    const r = classifyImportIntelligenceProfile({ signals: sig({
      pageCount: 2,
      hasVisualQuality: true,
      visualQaScore: 0.7,
      ocrLikelihood: 0.8,
      textDensityEstimate: 0.1,
      tableCountEstimate: 0,
      imageCountEstimate: 0,
      designComplexityEstimate: 0.2,
    }) });
    expect(r.profileCategory).toBe('scanned_ocr');
  });

  it('classifies multiple high risk categories as mixed_complex', () => {
    const r = classifyImportIntelligenceProfile({ signals: sig({
      pageCount: 8,
      hasVisualQuality: true,
      visualQaScore: 0.55,
      hasRepairAudit: true,
      repairRequiresFallback: true,
      hasExportParity: true,
      exportParityStatus: 'manual_required',
      exportVsSourceScore: 0.6,
      tableCountEstimate: 6,
      imageCountEstimate: 6,
      designComplexityEstimate: 0.8,
      ocrLikelihood: 0.3,
    }) });
    expect(r.profileCategory).toBe('mixed_complex');
  });

  it('classifies automation risk >= 0.85 as high_risk', () => {
    const r = classifyImportIntelligenceProfile({ signals: sig({
      pageCount: 4,
      hasVisualQuality: true,
      visualQaScore: 0.5,
      visualQaManualReviewRequired: true,
      hasRepairAudit: true,
      repairStatus: 'failed',
      repairRequiresFallback: true,
      hasExportParity: true,
      exportParityStatus: 'failed',
      goldenQualityGateStatus: 'fail',
      goldenFailureCount: 2,
    }) });
    expect(r.profileCategory).toBe('high_risk');
  });

  it('classifies low confidence as unknown', () => {
    const r = classifyImportIntelligenceProfile({ signals: sig() });
    expect(r.profileCategory).toBe('unknown');
  });
});

describe('resolveImportRiskLevel', () => {
  it('resolves critical for very high automation risk', () => {
    expect(resolveImportRiskLevel(scores({ automationRiskScore: 0.9 }))).toBe('critical');
  });
  it('resolves high for high manual review likelihood', () => {
    expect(resolveImportRiskLevel(scores({ automationRiskScore: 0.4, manualReviewLikelihood: 0.8 }))).toBe('high');
  });
  it('resolves medium for moderate complexity/automation', () => {
    expect(resolveImportRiskLevel(scores({ automationRiskScore: 0.5, confidence: 0.8 }))).toBe('medium');
  });
  it('resolves low for simple signals', () => {
    expect(resolveImportRiskLevel(scores({ automationRiskScore: 0.2, confidence: 0.8 }))).toBe('low');
  });
  it('resolves unknown when scores are mostly null', () => {
    expect(resolveImportRiskLevel(scores())).toBe('unknown');
  });
});

describe('recommendations', () => {
  it('simple_document recommendations are permissive', () => {
    const r = classifyImportIntelligenceProfile({ signals: simple });
    expect(r.recommendations.repairStrategy).toBe('allow');
    expect(r.recommendations.aiReconciliationStrategy).toBe('not_needed');
    expect(r.recommendations.operatorStrategy).toBe('proceed');
  });

  it('scanned_ocr recommendations require manual review/manual-only', () => {
    const r = classifyImportIntelligenceProfile({ signals: sig({
      pageCount: 2, hasVisualQuality: true, visualQaScore: 0.7,
      ocrLikelihood: 0.8, textDensityEstimate: 0.1, tableCountEstimate: 0, imageCountEstimate: 0, designComplexityEstimate: 0.2,
    }) });
    expect(r.recommendations.repairStrategy).toBe('manual_only');
    expect(r.recommendations.aiReconciliationStrategy).toBe('manual_review');
    expect(r.recommendations.operatorStrategy).toBe('manual_review_required');
  });

  it('high_risk recommendations block or require manual review', () => {
    const r = classifyImportIntelligenceProfile({ signals: sig({
      pageCount: 4, hasVisualQuality: true, visualQaScore: 0.5, visualQaManualReviewRequired: true,
      hasRepairAudit: true, repairStatus: 'failed', repairRequiresFallback: true,
      hasExportParity: true, exportParityStatus: 'failed', goldenQualityGateStatus: 'fail', goldenFailureCount: 2,
    }) });
    expect(['manual_only', 'blocked']).toContain(r.recommendations.repairStrategy);
    expect(['manual_review', 'blocked']).toContain(r.recommendations.aiReconciliationStrategy);
    expect(r.recommendations.operatorStrategy).toBe('block_until_review');
  });

  it('mixed_complex recommends AI reconciliation', () => {
    const r = classifyImportIntelligenceProfile({ signals: sig({
      pageCount: 8, hasVisualQuality: true, visualQaScore: 0.55, hasRepairAudit: true, repairRequiresFallback: true,
      hasExportParity: true, exportParityStatus: 'manual_required', exportVsSourceScore: 0.6,
      tableCountEstimate: 6, imageCountEstimate: 6, designComplexityEstimate: 0.8, ocrLikelihood: 0.3,
    }) });
    expect(r.recommendations.aiReconciliationStrategy).toBe('recommended');
  });

  it('table_heavy requires Visual QA and export parity', () => {
    const r = classifyImportIntelligenceProfile({ signals: sig({
      pageCount: 2, hasVisualQuality: true, visualQaScore: 0.9, hasRepairAudit: true, repairStatus: 'completed',
      repairFinalScore: 0.9, hasExportParity: true, exportParityStatus: 'completed', exportVsSourceScore: 0.9,
      tableCountEstimate: 6, imageCountEstimate: 0,
    }) });
    expect(r.recommendations.visualQaStrategy).toBe('required');
    expect(r.recommendations.exportParityStrategy).toBe('required');
  });
});

describe('confidence and score validity', () => {
  it('calculateImportProfileConfidence increases with evidence', () => {
    const sparse = calculateImportProfileConfidence(sig({ pageCount: 1 }));
    const rich = calculateImportProfileConfidence(sig({
      pageCount: 1, hasVisualQuality: true, hasRepairAudit: true, hasExportParity: true,
      tableCountEstimate: 0, goldenQualityGateStatus: 'pass',
    }));
    expect(rich).toBeGreaterThan(sparse);
  });

  it('classifier returns valid score values between 0 and 1 or null', () => {
    const r = classifyImportIntelligenceProfile({ signals: simple });
    for (const value of Object.values(r.scores)) {
      if (value === null) continue;
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});
