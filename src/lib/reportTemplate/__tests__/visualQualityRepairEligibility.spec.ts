import { describe, expect, it } from 'vitest';
import {
  classifyVisualQualityRepairIssues,
  evaluatePageRepairEligibility,
  evaluateVisualRepairEligibility,
  type VisualImportQualityReport,
  type VisualPageQualityReport,
} from '../ingestion/visualQuality';

function page(overrides: Partial<VisualPageQualityReport> = {}): VisualPageQualityReport {
  return {
    pageId: 'page-1',
    pageNumber: 1,
    sourceRasterAssetId: 'source-page-1.png',
    renderedRasterAssetId: 'generated-page-1.png',
    diffRasterAssetId: 'diff-page-1.png',
    overallScore: 0.7,
    pixelDifferenceScore: 0.72,
    textCoverageScore: 0.94,
    layoutDriftScore: 0.68,
    missingElementScore: 0.91,
    colorSimilarityScore: 0.79,
    confidenceScore: 0.9,
    recommendedAction: 'repair',
    warnings: [],
    ...overrides,
  };
}

function report(pages: VisualPageQualityReport[] = [page()]): VisualImportQualityReport {
  return {
    importId: 'import_123',
    templateId: 'template_123',
    overallScore: pages.reduce((sum, p) => sum + p.overallScore, 0) / pages.length,
    pages,
    repairPassesApplied: 0,
    finalMode: 'hybrid',
    manualReviewRequired: pages.some((p) => p.recommendedAction === 'manual_review'),
    generatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('visual quality repair eligibility gate', () => {
  it('marks repair-band pages with repairable issues as eligible', () => {
    const classified = classifyVisualQualityRepairIssues(report());
    const result = evaluatePageRepairEligibility(classified, classified.report.pages[0]);

    expect(result.decision).toBe('eligible');
    expect(result.eligibleForRepairLoop).toBe(true);
    expect(result.requiresFallback).toBe(false);
    expect(result.repairIssueCategories).toContain('pixel_mismatch');
  });

  it('blocks pages when source or generated rasters are missing', () => {
    const p = page({
      sourceRasterAssetId: null,
      renderedRasterAssetId: null,
    });
    const classified = classifyVisualQualityRepairIssues(report([p]));
    const result = evaluatePageRepairEligibility(classified, p);

    expect(result.decision).toBe('blocked');
    expect(result.eligibleForRepairLoop).toBe(false);
    expect(result.blockingReasons).toContain('source_raster_missing');
    expect(result.blockingReasons).toContain('generated_raster_missing');
  });

  it('routes fallback-to-pixel pages to fallback instead of repair', () => {
    const p = page({
      overallScore: 0.4,
      pixelDifferenceScore: 0.4,
      layoutDriftScore: 0.4,
      recommendedAction: 'fallback_to_pixel',
    });
    const classified = classifyVisualQualityRepairIssues(report([p]));
    const result = evaluatePageRepairEligibility(classified, p);

    expect(result.decision).toBe('fallback');
    expect(result.eligibleForRepairLoop).toBe(false);
    expect(result.requiresFallback).toBe(true);
    expect(result.fallbackMode).toBe('pixel-perfect');
  });

  it('routes manual review pages away from automatic repair', () => {
    const p = page({
      overallScore: 0.45,
      recommendedAction: 'manual_review',
    });
    const classified = classifyVisualQualityRepairIssues(report([p]));
    const result = evaluatePageRepairEligibility(classified, p);

    expect(result.decision).toBe('manual_review');
    expect(result.eligibleForRepairLoop).toBe(false);
    expect(result.requiresManualReview).toBe(true);
    expect(result.blockingReasons).toContain('manual_review_required');
  });

  it('summarizes repair eligibility across the report', () => {
    const pages = [
      page({
        pageId: 'eligible-page',
        pageNumber: 1,
      }),
      page({
        pageId: 'clean-page',
        pageNumber: 2,
        overallScore: 0.95,
        pixelDifferenceScore: 0.95,
        textCoverageScore: 0.95,
        layoutDriftScore: 0.95,
        missingElementScore: 0.95,
        colorSimilarityScore: 0.95,
        recommendedAction: 'accept',
      }),
      page({
        pageId: 'fallback-page',
        pageNumber: 3,
        overallScore: 0.4,
        pixelDifferenceScore: 0.4,
        recommendedAction: 'fallback_to_pixel',
      }),
    ];

    const classified = classifyVisualQualityRepairIssues(report(pages));
    const result = evaluateVisualRepairEligibility(classified);

    expect(result.canRunRepairLoop).toBe(true);
    expect(result.requiresFallback).toBe(true);
    expect(result.pageCount).toBe(3);
    expect(result.eligiblePageCount).toBe(1);
    expect(result.noIssuePageCount).toBe(1);
    expect(result.fallbackPageCount).toBe(1);
    expect(result.blockingReasons.fallback_pixel_required).toBe(1);
  });
});
