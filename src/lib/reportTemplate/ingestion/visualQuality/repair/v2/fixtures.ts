/**
 * E8 — deterministic generated fixtures (test-time only). Artificial, small, no
 * private data. Builds E7 page reports, defects, templates, repair inputs and a
 * deterministic runtime adapter map for exercising the cascade.
 */
import { VISUAL_METRICS_V2_VERSION, VISUAL_QUALITY_REPORT_V2_VERSION, type VisualPageMetricsV2, type VisualPageQualityReportV2 } from '../../v2/contracts';
import { makeDefect, type CriticalQualityDefectV1, type CriticalQualityDefectCode } from '../../v2/criticalDefects';

export function perfectMetrics(): VisualPageMetricsV2 {
  const one = 1;
  return {
    version: VISUAL_METRICS_V2_VERSION,
    pagePixelSimilarity: one, tiledPixelSimilarity: one, colourSimilarity: one,
    foregroundMaskIoU: one, foregroundRecall: one, edgeSimilarity: one, contentOccupancyRecall: one,
    localBlankRegionScore: one, visibleTextCodePointRecall: one, criticalTokenRecall: one, punctuationRecall: one,
    layoutGeometryScore: one, sourceRegionCoverage: one, chartCoverage: one, pictureCoverage: one,
    tableIntegrityScore: one, typographyFidelityScore: one, compositionCompleteness: one, assetAvailability: one,
    browserExportParity: one, contrastScore: one, overlapScore: one, offPageScore: one,
  };
}

export function defect(code: CriticalQualityDefectCode, ids: Partial<Pick<CriticalQualityDefectV1, 'pageId' | 'pageNumber' | 'regionId' | 'overlayId' | 'sourceRunId' | 'scope'>> = {}): CriticalQualityDefectV1 {
  return makeDefect({ code, pageId: ids.pageId ?? 'docling-page-1', pageNumber: ids.pageNumber ?? 1, regionId: ids.regionId ?? null, overlayId: ids.overlayId ?? null, sourceRunId: ids.sourceRunId ?? null, scope: ids.scope ?? 'page' });
}

export function pageReport(overrides: Partial<VisualPageQualityReportV2> = {}): VisualPageQualityReportV2 {
  const defects = overrides.criticalDefects ?? [];
  return {
    version: VISUAL_QUALITY_REPORT_V2_VERSION,
    pageId: 'docling-page-1', pageNumber: 1, evaluationStage: 'native',
    qualityCoverage: 'complete', overallScore: 0.95, metricCoverage: 0.9, metrics: perfectMetrics(),
    criticalDefects: defects, hardDefectCount: defects.filter((d) => d.hardVeto).length,
    recommendedAction: defects.some((d) => d.hardVeto) ? 'apply-page-raster' : 'accept-native',
    outputStrategy: defects.some((d) => d.hardVeto) ? 'blocked' : 'native',
    manualReviewRequired: false, renderPlanHash: 'rplanh-base', sourceEvidenceHash: null,
    expectationOrigin: 'source-derived', problems: [],
    ...overrides,
  };
}

/** A clean accepted page report (no defects). */
export function acceptedReport(strategy: 'native' | 'mixed' | 'raster-only' = 'native', hash = 'rplanh-fixed'): VisualPageQualityReportV2 {
  return pageReport({ criticalDefects: [], recommendedAction: strategy === 'native' ? 'accept-native' : strategy === 'mixed' ? 'accept-mixed' : 'accept-page-raster', outputStrategy: strategy, renderPlanHash: hash });
}

// ── Minimal template ─────────────────────────────────────────────────────────

export function templateFixture(overlay: Record<string, unknown> = {}): unknown {
  return {
    version: 1, tokens: { colors: {}, fonts: {}, spacing: {} },
    pages: [{
      id: 'docling-page-1', name: 'P1', size: { width: 595, height: 842 }, background: { color: '#fff' },
      meta: { pdfImportRegionOutput: { version: 'pdf-region-output-policy-v1', renderPlan: { renderPlanVersion: 'pdf-region-render-plan-v1', renderPlanHash: 'rplanh-base', pageOutputStrategy: 'native', renderFullPageRaster: false, renderNativeOverlayIds: ['ov-1'], suppressedOverlayIds: [], suppressedRegionIds: [], hiddenSemanticRegionIds: [], finalRegionCrops: [] } } },
      blocks: [{ id: 'b1', type: 'free', props: {}, overlays: [{ id: 'ov-1', type: 'text', x: 40, y: 40, width: 200, height: 20, content: 'Heading', style: { fontSize: 12, lineHeight: 16 }, ...overlay }] }],
    }],
  };
}

// ── Failure-class cascade fixture ────────────────────────────────────────────

/** A page with a missing chart (hard defect) whose only safe repair is the crop/raster. */
export function missingChartReport(): VisualPageQualityReportV2 {
  return pageReport({
    overallScore: 0.86, // deceptively high (mostly white)
    criticalDefects: [defect('chart_region_missing', { regionId: 'chart-1', scope: 'region' }), defect('local_blank_region')],
  });
}
