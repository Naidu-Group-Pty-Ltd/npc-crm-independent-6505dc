import { describe, expect, it } from 'vitest';
import {
  classifyPageRepairIssues,
  classifyVisualQualityRepairIssues,
  isFallbackAction,
  isRepairAction,
  summarizeRepairIssues,
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

describe('visual quality repair issue classifier', () => {
  it('classifies weak page metrics into repair issues', () => {
    const r = report();
    const issues = classifyPageRepairIssues(r, r.pages[0]);

    expect(issues.some((issue) => issue.category === 'pixel_mismatch')).toBe(true);
    expect(issues.some((issue) => issue.category === 'layout_drift')).toBe(true);
    expect(issues.some((issue) => issue.category === 'color_mismatch')).toBe(true);
    expect(issues.some((issue) => issue.suggestedRepair === 'run_repair_loop')).toBe(true);
  });

  it('adds artifact issues when expected visual rasters are missing', () => {
    const p = page({
      sourceRasterAssetId: null,
      renderedRasterAssetId: null,
      diffRasterAssetId: null,
    });
    const issues = classifyPageRepairIssues(report([p]), p);

    expect(issues.some((issue) => issue.category === 'source_raster_missing')).toBe(true);
    expect(issues.some((issue) => issue.category === 'generated_raster_missing')).toBe(true);
    expect(issues.some((issue) => issue.category === 'diff_raster_missing')).toBe(true);
  });

  it('maps fallback and manual review actions into control-flow issues', () => {
    const pages = [
      page({
        pageId: 'page-fallback',
        pageNumber: 1,
        overallScore: 0.55,
        recommendedAction: 'fallback_to_hybrid',
      }),
      page({
        pageId: 'page-manual',
        pageNumber: 2,
        overallScore: 0.4,
        recommendedAction: 'manual_review',
      }),
    ];

    const result = classifyVisualQualityRepairIssues(report(pages));

    expect(result.summary.fallbackPageCount).toBe(1);
    expect(result.summary.manualReviewPageCount).toBe(1);
    expect(result.issues.some((issue) => issue.category === 'fallback_required')).toBe(true);
    expect(result.issues.some((issue) => issue.category === 'manual_review_required')).toBe(true);
  });

  it('summarizes issue counts by category, severity, and suggested repair', () => {
    const result = classifyVisualQualityRepairIssues(report([
      page(),
      page({
        pageId: 'page-2',
        pageNumber: 2,
        overallScore: 0.93,
        pixelDifferenceScore: 0.93,
        textCoverageScore: 0.93,
        layoutDriftScore: 0.93,
        missingElementScore: 0.93,
        colorSimilarityScore: 0.93,
        recommendedAction: 'accept',
      }),
    ]));

    const summary = summarizeRepairIssues(result.report, result.issues);

    expect(summary.issueCount).toBe(result.issues.length);
    expect(summary.pagesWithIssues).toBeGreaterThanOrEqual(1);
    expect(summary.repairablePageCount).toBe(1);
    expect(summary.byCategory.pixel_mismatch).toBeGreaterThanOrEqual(1);
    expect(summary.suggestedRepairCounts.run_repair_loop).toBeGreaterThanOrEqual(1);
    expect(summary.worstPage?.pageId).toBe('page-1');
  });

  it('classifies repair and fallback actions consistently', () => {
    expect(isRepairAction('repair')).toBe(true);
    expect(isRepairAction('fallback_to_hybrid')).toBe(true);
    expect(isRepairAction('manual_review')).toBe(true);
    expect(isRepairAction('accept')).toBe(false);

    expect(isFallbackAction('fallback_to_hybrid')).toBe(true);
    expect(isFallbackAction('fallback_to_pixel')).toBe(true);
    expect(isFallbackAction('repair')).toBe(false);
  });
});
