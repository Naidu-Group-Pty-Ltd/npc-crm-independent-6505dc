import { describe, expect, it } from 'vitest';
import {
  clampImportIntelligenceScore,
  coerceImportIntelligenceBoolean,
  coerceImportIntelligenceNumber,
  readImportIntelligencePath,
  extractImportIntelligenceSignals,
  estimateTableCount,
  estimateImageCount,
  estimateTextDensity,
  estimateOcrLikelihood,
  estimateDesignComplexity,
  estimateLayoutRisk,
} from '../ingestion/importIntelligence';

const schema = {
  pages: [
    { blocks: [{ type: 'table' }, { type: 'text' }, { type: 'image' }, { kind: 'heading' }] },
    { blocks: [{ type: 'paragraph' }, { name: 'logo' }] },
  ],
};

describe('score/coerce helpers', () => {
  it('clampImportIntelligenceScore accepts 0.5', () => {
    expect(clampImportIntelligenceScore(0.5)).toBe(0.5);
  });
  it('clamps below 0 to 0', () => {
    expect(clampImportIntelligenceScore(-1)).toBe(0);
  });
  it('clamps above 1 to 1', () => {
    expect(clampImportIntelligenceScore(2)).toBe(1);
  });
  it('returns null for invalid values', () => {
    expect(clampImportIntelligenceScore('abc')).toBeNull();
    expect(clampImportIntelligenceScore(null)).toBeNull();
    expect(clampImportIntelligenceScore(undefined)).toBeNull();
  });
  it('coerce boolean handles true/false strings', () => {
    expect(coerceImportIntelligenceBoolean('true')).toBe(true);
    expect(coerceImportIntelligenceBoolean('false')).toBe(false);
    expect(coerceImportIntelligenceBoolean(true)).toBe(true);
    expect(coerceImportIntelligenceBoolean('maybe')).toBeNull();
  });
  it('coerce number accepts numeric strings', () => {
    expect(coerceImportIntelligenceNumber('0.91')).toBe(0.91);
    expect(coerceImportIntelligenceNumber('x')).toBeNull();
  });
  it('read path handles nested values', () => {
    expect(readImportIntelligencePath({ a: { b: { c: 3 } } }, ['a', 'b', 'c'])).toBe(3);
    expect(readImportIntelligencePath({ a: 1 }, ['a', 'b'])).toBeUndefined();
  });
});

describe('extractImportIntelligenceSignals', () => {
  const snapshot = {
    importId: 'import-1',
    templateId: 'template-1',
    sourceFilename: 'doc.pdf',
    importPageCount: 4,
    visualQaScore: 0.82,
    visualQaManualReviewRequired: true,
    repairStatus: 'completed',
    repairFinalScore: 0.88,
    repairRequiresFallback: true,
    repairRequiresManualReview: false,
    exportParityStatus: 'completed',
    exportVsSourceScore: 0.9,
    editorVsSourceScore: 0.88,
    exportVsEditorScore: 0.95,
    aiReconciliationStatus: 'not_run',
    aiReconciliationRecommendation: 'not_needed',
    engineVersion: 'docling-1.0',
  };

  it('extracts page count from snapshot', () => {
    const { signals } = extractImportIntelligenceSignals({ importId: 'import-1', snapshot });
    expect(signals.pageCount).toBe(4);
    expect(signals.isMultiPage).toBe(true);
  });
  it('extracts visual QA score/manual review from snapshot', () => {
    const { signals } = extractImportIntelligenceSignals({ importId: 'import-1', snapshot });
    expect(signals.visualQaScore).toBe(0.82);
    expect(signals.visualQaManualReviewRequired).toBe(true);
    expect(signals.hasVisualQuality).toBe(true);
  });
  it('extracts repair signals from snapshot', () => {
    const { signals } = extractImportIntelligenceSignals({ importId: 'import-1', snapshot });
    expect(signals.repairStatus).toBe('completed');
    expect(signals.repairFinalScore).toBe(0.88);
    expect(signals.repairRequiresFallback).toBe(true);
    expect(signals.hasRepairAudit).toBe(true);
  });
  it('extracts export parity signals from snapshot', () => {
    const { signals } = extractImportIntelligenceSignals({ importId: 'import-1', snapshot });
    expect(signals.exportParityStatus).toBe('completed');
    expect(signals.exportVsSourceScore).toBe(0.9);
    expect(signals.hasExportParity).toBe(true);
  });
  it('extracts AI reconciliation signals', () => {
    const { signals } = extractImportIntelligenceSignals({ importId: 'import-1', snapshot });
    expect(signals.aiReconciliationStatus).toBe('not_run');
    expect(signals.aiReconciliationRecommendation).toBe('not_needed');
  });
  it('returns warnings for missing optional evidence', () => {
    const { warnings } = extractImportIntelligenceSignals({ importId: 'import-1', snapshot: { importId: 'import-1', importPageCount: 1 } });
    expect(warnings).toContain('missing_visual_quality');
    expect(warnings).toContain('insufficient_schema_evidence');
  });
  it('blockers include import_id_missing only when input lacks import id', () => {
    const withId = extractImportIntelligenceSignals({ importId: 'import-1', snapshot });
    expect(withId.blockers).not.toContain('import_id_missing');
    const withoutId = extractImportIntelligenceSignals({ snapshot: { importPageCount: 2 } });
    expect(withoutId.blockers).toContain('import_id_missing');
  });
  it('produces evidence entries for major signals', () => {
    const { evidence } = extractImportIntelligenceSignals({ importId: 'import-1', snapshot });
    const codes = evidence.map((e) => e.code);
    expect(codes).toContain('multi_page_detected');
    expect(codes).toContain('visual_qa_manual_review');
    expect(codes).toContain('repair_fallback');
  });
});

describe('estimators', () => {
  it('estimateTableCount counts table-like schema elements', () => {
    expect(estimateTableCount({ templateSchema: schema })).toBe(1);
    expect(estimateTableCount({})).toBeNull();
  });
  it('estimateImageCount counts image-like schema elements', () => {
    // image + logo (background/picture keywords) → 2
    expect(estimateImageCount({ templateSchema: schema })).toBe(2);
    expect(estimateImageCount({})).toBeNull();
  });
  it('estimateTextDensity returns a bounded number and never exposes raw text', () => {
    const density = estimateTextDensity({ templateSchema: schema });
    expect(density === null || (typeof density === 'number' && density >= 0 && density <= 1)).toBe(true);
    expect(estimateTextDensity({})).toBeNull();
  });
  it('estimateOcrLikelihood high for low text density + manual review + fallback', () => {
    const ocr = estimateOcrLikelihood({
      signals: { textDensityEstimate: 0.1, visualQaManualReviewRequired: true, repairRequiresFallback: true },
    });
    expect(ocr).not.toBeNull();
    expect(ocr as number).toBeGreaterThanOrEqual(0.5);
  });
  it('estimateDesignComplexity high for image/design/low QA', () => {
    const design = estimateDesignComplexity({
      signals: { imageCountEstimate: 6, visualQaScore: 0.7, repairRequiresFallback: true },
    });
    expect(design).not.toBeNull();
    expect(design as number).toBeGreaterThanOrEqual(0.65);
  });
  it('estimateLayoutRisk high for table count + low QA + fallback', () => {
    const layout = estimateLayoutRisk({
      signals: { tableCountEstimate: 6, visualQaScore: 0.7, repairRequiresFallback: true },
    });
    expect(layout).not.toBeNull();
    expect(layout as number).toBeGreaterThanOrEqual(0.6);
  });
});
