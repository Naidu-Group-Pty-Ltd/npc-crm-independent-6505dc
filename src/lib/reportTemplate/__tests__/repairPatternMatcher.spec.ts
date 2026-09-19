import { describe, expect, it } from 'vitest';
import {
  matchRepairPatterns,
  resolvePrimaryRepairPattern,
  resolveOverallRepairPatternSeverity,
  resolveDeterministicRepairStrategy,
  resolveAiReconciliationUsefulness,
  resolveExportParityRequirement,
  resolveOperatorReviewRequirement,
} from '../ingestion/repairPatterns';
import type { RepairPatternSignals } from '../ingestion/repairPatterns';

function sig(overrides: Partial<RepairPatternSignals> = {}): RepairPatternSignals {
  return {
    importId: 'import-1',
    templateId: 'template-1',
    sourceFilename: 'doc.pdf',
    profileCategory: null,
    importRiskLevel: null,
    importConfidence: null,
    pageCount: null,
    isMultiPage: null,
    visualQaScore: null,
    visualQaManualReviewRequired: null,
    repairStatus: null,
    repairFinalScore: null,
    repairRequiresFallback: null,
    repairRequiresManualReview: null,
    exportParityStatus: null,
    exportVsSourceScore: null,
    editorVsSourceScore: null,
    exportVsEditorScore: null,
    aiReconciliationStatus: null,
    aiReconciliationRecommendation: null,
    tableRiskScore: null,
    imageRiskScore: null,
    designRiskScore: null,
    ocrRiskScore: null,
    automationRiskScore: null,
    manualReviewLikelihood: null,
    goldenQualityGateStatus: null,
    goldenWarningCount: null,
    goldenFailureCount: null,
    baselineOutcome: null,
    failureCodes: [],
    warningCodes: [],
    ...overrides,
  };
}

function matchedIds(signals: RepairPatternSignals): string[] {
  return matchRepairPatterns({ signals }).filter((m) => m.matched).map((m) => m.patternId);
}

describe('matchRepairPatterns', () => {
  it('produces no matches for clean simple signals', () => {
    const ids = matchedIds(sig({
      profileCategory: 'simple_document', importRiskLevel: 'low',
      pageCount: 1, visualQaScore: 0.97, repairStatus: 'completed', repairFinalScore: 0.96,
      exportParityStatus: 'completed', exportVsSourceScore: 0.96,
    }));
    expect(ids).toEqual([]);
  });

  it('matches page_margin_drift on low visual QA + alignment failure', () => {
    const ids = matchedIds(sig({
      profileCategory: 'simple_document', visualQaScore: 0.8, exportVsSourceScore: 0.85,
      failureCodes: ['visual_alignment_drift'],
    }));
    expect(ids).toContain('page_margin_drift');
  });

  it('matches background_block_shift on design risk + fallback', () => {
    const ids = matchedIds(sig({
      profileCategory: 'design_heavy', designRiskScore: 0.7, repairRequiresFallback: true,
    }));
    expect(ids).toContain('background_block_shift');
  });

  it('matches font_scale_mismatch on low visual QA + typography warning', () => {
    const ids = matchedIds(sig({
      visualQaScore: 0.8, warningCodes: ['font_overflow'],
    }));
    expect(ids).toContain('font_scale_mismatch');
  });

  it('matches table_grid_drift on high table risk', () => {
    const ids = matchedIds(sig({
      profileCategory: 'table_heavy', tableRiskScore: 0.9,
    }));
    expect(ids).toContain('table_grid_drift');
  });

  it('matches image_crop_mismatch on high image risk + low export', () => {
    const ids = matchedIds(sig({
      profileCategory: 'image_heavy', imageRiskScore: 0.85, exportVsSourceScore: 0.7,
    }));
    expect(ids).toContain('image_crop_mismatch');
  });

  it('matches layer_order_conflict on high design/layer risk', () => {
    const ids = matchedIds(sig({
      profileCategory: 'design_heavy', designRiskScore: 0.7, failureCodes: ['layer_order_conflict'],
    }));
    expect(ids).toContain('layer_order_conflict');
  });

  it('matches ocr_text_fragments on scanned OCR profile + high OCR risk', () => {
    const ids = matchedIds(sig({
      profileCategory: 'scanned_ocr', ocrRiskScore: 0.8,
    }));
    expect(ids).toContain('ocr_text_fragments');
  });

  it('matches header_footer_alignment on multi-page + header/footer signal', () => {
    const ids = matchedIds(sig({
      profileCategory: 'multi_page_report', pageCount: 5, failureCodes: ['header_footer_drift'],
    }));
    expect(ids).toContain('header_footer_alignment');
  });

  it('matches multi_page_spacing_drift on multi-page + spacing warning', () => {
    const ids = matchedIds(sig({
      profileCategory: 'multi_page_report', pageCount: 4, warningCodes: ['vertical_spacing_drift'],
    }));
    expect(ids).toContain('multi_page_spacing_drift');
  });

  it('matches missing_major_visual_element on very low visual/export + missing failure', () => {
    const ids = matchedIds(sig({
      profileCategory: 'image_heavy', visualQaScore: 0.4, exportVsSourceScore: 0.4,
      failureCodes: ['missing_visual_element'],
    }));
    expect(ids).toContain('missing_major_visual_element');
  });

  it('matches export_renderer_mismatch on export failed with decent editor score', () => {
    const ids = matchedIds(sig({
      exportParityStatus: 'failed', editorVsSourceScore: 0.9, exportVsSourceScore: 0.7,
    }));
    expect(ids).toContain('export_renderer_mismatch');
  });

  it('matches manual_review_only on high risk + high automation risk', () => {
    const ids = matchedIds(sig({
      profileCategory: 'high_risk', importRiskLevel: 'critical', automationRiskScore: 0.9,
      manualReviewLikelihood: 0.8, repairRequiresManualReview: true,
    }));
    expect(ids).toContain('manual_review_only');
  });
});

describe('resolution', () => {
  it('resolvePrimaryRepairPattern returns the highest score', () => {
    const matches = matchRepairPatterns({ signals: sig({
      profileCategory: 'table_heavy', tableRiskScore: 0.9, visualQaScore: 0.8, failureCodes: ['table_grid'],
    }) });
    const primary = resolvePrimaryRepairPattern(matches);
    expect(primary?.patternId).toBe('table_grid_drift');
  });

  it('overall severity resolves the highest matched severity', () => {
    const matches = matchRepairPatterns({ signals: sig({
      profileCategory: 'high_risk', automationRiskScore: 0.9, manualReviewLikelihood: 0.8, repairRequiresManualReview: true,
    }) });
    expect(resolveOverallRepairPatternSeverity(matches)).toBe('critical');
  });

  it('deterministic strategy is blocked for manual_review_only / missing critical', () => {
    const matches = matchRepairPatterns({ signals: sig({
      profileCategory: 'high_risk', automationRiskScore: 0.9, manualReviewLikelihood: 0.8, repairRequiresManualReview: true,
    }) });
    expect(resolveDeterministicRepairStrategy(matches, sig())).toBe('blocked');
  });

  it('deterministic strategy is constrained for high table/image/layer', () => {
    const matches = matchRepairPatterns({ signals: sig({
      profileCategory: 'table_heavy', tableRiskScore: 0.9,
    }) });
    expect(resolveDeterministicRepairStrategy(matches, sig())).toBe('constrained');
  });

  it('AI usefulness is high for table/missing visual element', () => {
    const matches = matchRepairPatterns({ signals: sig({
      profileCategory: 'table_heavy', tableRiskScore: 0.9,
    }) });
    expect(resolveAiReconciliationUsefulness(matches, sig())).toBe('high');
  });

  it('export parity requirement is rerun_required for geometry/export matches', () => {
    const matches = matchRepairPatterns({ signals: sig({
      profileCategory: 'simple_document', visualQaScore: 0.8, failureCodes: ['page_margin_drift'],
    }) });
    expect(resolveExportParityRequirement(matches, sig())).toBe('rerun_required');
  });

  it('operator review is block_until_review for critical patterns', () => {
    const matches = matchRepairPatterns({ signals: sig({
      profileCategory: 'image_heavy', visualQaScore: 0.4, exportVsSourceScore: 0.4, failureCodes: ['missing_visual_element'],
    }) });
    expect(resolveOperatorReviewRequirement(matches, sig())).toBe('block_until_review');
  });
});
