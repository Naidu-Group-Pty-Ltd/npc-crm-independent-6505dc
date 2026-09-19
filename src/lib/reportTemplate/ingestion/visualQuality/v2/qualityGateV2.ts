/**
 * E7 — Import Quality Gate V2 (pure orchestrator). hard defects → score →
 * decision. Evaluates the ACTUAL composed output supplied as evidence (a
 * runtime capture/rasterize adapter feeds it; this module does no DOM/network
 * I/O). Fails closed: an unscored critical page, incomplete coverage or a
 * missing required metric can never be accepted as verified native/mixed.
 *
 * Large documents are processed in bounded sequential batches; every page is
 * attempted, results merge by pageId without duplication, and unscored pages
 * are recorded explicitly — never silently skipped or marked complete.
 */
import {
  IMPORT_QUALITY_GATE_V2_VERSION, VISUAL_QUALITY_REPORT_V2_VERSION, VISUAL_METRICS_V2_VERSION,
  type VisualPageMetricsV2, type VisualPageQualityReportV2, type VisualImportQualityReportV2,
  type RenderedPageEvidenceV1, type RegionRenderPlanProjectionV1, type ExpectationOrigin, type FinalDecisionV2,
} from './contracts';
import { makeDefect, hasUnresolvedHardDefect, countHardDefects, type CriticalQualityDefectV1 } from './criticalDefects';
import type { ImageDataLike } from './imageMetricsV2';
import {
  pagePixelSimilarity, tiledComparison, colourSimilarity, toCanonicalGray, compareForeground, compareEdges,
  contentOccupancy, foregroundMask, detectLocalBlank, dimensionMismatchRatio,
} from './imageMetricsV2';
import { compareRegion, type RegionComparisonInput, type RegionComparisonResult } from './regionMetrics';
import {
  validateStructural, type ExpectedChartRegion, type ExpectedTableRegion, type ExpectedTypographyRun, type TableRenderObservation,
} from './structuralValidation';
import { clampRectToSurface, detectOverlaps, type OverlapCandidate } from './domEvidence';
import { scorePageMetricsV2, aggregateDocumentScore } from './scoreV2';
import { decidePage, finalizeDocument, type PageDecisionResult } from './decisionV2';

const COMPOSITION_DEFECT_CODES: ReadonlySet<string> = new Set([
  'duplicate_source_pixels', 'source_region_not_rendered', 'unresolved_region_crop_overlap',
  'crop_and_native_both_visible', 'nested_crop_both_visible', 'hidden_semantic_visible',
  'editor_reference_visible_in_final', 'renderer_plan_mismatch', 'region_crop_asset_missing',
  'region_crop_asset_invalid', 'page_raster_missing', 'final_output_blank_region',
  'final_output_blank_page', 'composition_unscored',
]);

function nullMetrics(): VisualPageMetricsV2 {
  return {
    version: VISUAL_METRICS_V2_VERSION,
    pagePixelSimilarity: null, tiledPixelSimilarity: null, colourSimilarity: null,
    foregroundMaskIoU: null, foregroundRecall: null, edgeSimilarity: null, contentOccupancyRecall: null,
    localBlankRegionScore: null, visibleTextCodePointRecall: null, criticalTokenRecall: null, punctuationRecall: null,
    layoutGeometryScore: null, sourceRegionCoverage: null, chartCoverage: null, pictureCoverage: null,
    tableIntegrityScore: null, typographyFidelityScore: null, compositionCompleteness: null, assetAvailability: null,
    browserExportParity: null, contrastScore: null, overlapScore: null, offPageScore: null,
  };
}
function clamp01(n: number): number { return Math.max(0, Math.min(1, n)); }
function round4(n: number): number { return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : 0; }
function ratio(pass: number, total: number): number | null { return total <= 0 ? null : round4(pass / total); }

export interface PageEvaluationInputV2 {
  pageId: string; pageNumber: number;
  evaluationStage: VisualPageQualityReportV2['evaluationStage'];
  evidence: RenderedPageEvidenceV1;
  sourceRaster: ImageDataLike | null;
  outputRaster: ImageDataLike | null;
  regionInputs: RegionComparisonInput[];
  charts: ExpectedChartRegion[];
  tables: ExpectedTableRegion[];
  typography: ExpectedTypographyRun[];
  tableObservations?: TableRenderObservation[];
  regionPlan: RegionRenderPlanProjectionV1 | null;
  expectationOrigin: ExpectationOrigin;
  pageRasterAvailable: boolean;
  exactRegionCropsAvailable: boolean;
  browserExportParity?: number | null;
  textRecall?: { visibleCodePointRecall?: number | null; criticalTokenRecall?: number | null; punctuationRecall?: number | null };
  sourceEvidenceHash?: string | null;
}

// ── Per-page metric computation ──────────────────────────────────────────────

export interface PageMetricsComputation { metrics: VisualPageMetricsV2; regionResults: RegionComparisonResult[]; imageDefects: CriticalQualityDefectV1[] }

export function computePageMetrics(input: PageEvaluationInputV2): PageMetricsComputation {
  const m = nullMetrics();
  const imageDefects: CriticalQualityDefectV1[] = [];
  const base = { pageId: input.pageId, pageNumber: input.pageNumber, scope: 'page' as const };
  const src = input.sourceRaster; const out = input.outputRaster;

  if (!src) imageDefects.push(makeDefect({ code: 'source_raster_missing', ...base, reason: 'source raster unavailable' }));
  if (!out) imageDefects.push(makeDefect({ code: 'rendered_raster_missing', ...base, reason: 'rendered raster unavailable' }));

  if (src && out) {
    // NOTE: missing rasters leave these NULL (never 0.5).
    if (dimensionMismatchRatio(src, out) > 0.03) imageDefects.push(makeDefect({ code: 'page_dimension_mismatch', ...base, reason: 'source/output aspect ratio differ' }));
    m.pagePixelSimilarity = pagePixelSimilarity(src, out);
    m.tiledPixelSimilarity = tiledComparison(src, out).weightedSimilarity;
    m.colourSimilarity = colourSimilarity(src, out);
    const sGray = toCanonicalGray(src, 1280); const oGray = toCanonicalGray(out, 1280);
    const fg = compareForeground(sGray, oGray); m.foregroundMaskIoU = fg.iou; m.foregroundRecall = fg.recall;
    m.edgeSimilarity = compareEdges(sGray, oGray).recall;
    const sOcc = contentOccupancy(foregroundMask(sGray)); const oOcc = contentOccupancy(foregroundMask(oGray));
    m.contentOccupancyRecall = sOcc <= 0 ? 1 : round4(clamp01(oOcc / sOcc));
    const blank = detectLocalBlank(src, out);
    m.localBlankRegionScore = blank.blank ? 0 : 1;
    if (blank.blank && input.regionPlan?.pageOutputStrategy !== 'raster-only') {
      imageDefects.push(makeDefect({ code: 'local_blank_region', ...base, metric: 'outputOccupancy', observed: blank.outputOccupancy, reason: 'page has source content but output is blank' }));
    }
  }

  // Region comparisons.
  const regionResults = input.regionInputs.map((ri) => compareRegion(ri));
  const criticalRegions = regionResults.length;
  const scoredRegions = regionResults.filter((r) => r.scored).length;
  // A page with no critical regions has trivially complete region coverage (1),
  // not "unmeasured" — text-only pages must not read as partial coverage.
  m.sourceRegionCoverage = criticalRegions === 0 ? 1 : ratio(scoredRegions, criticalRegions);

  const chartRegions = new Set(input.charts.filter((c) => !c.isPicture && !c.isLogo).map((c) => c.regionId));
  const pictureRegions = new Set(input.charts.filter((c) => c.isPicture || c.isLogo).map((c) => c.regionId));
  m.chartCoverage = regionCoverage(regionResults, chartRegions);
  m.pictureCoverage = regionCoverage(regionResults, pictureRegions);

  // Table integrity / typography fidelity from region + defect signals (0..1).
  const tableRegions = new Set(input.tables.map((t) => t.regionId));
  m.tableIntegrityScore = regionCoverage(regionResults, tableRegions);
  m.typographyFidelityScore = input.typography.length === 0 ? null
    : ratio(input.typography.filter((t) => t.hardDefectCodes.length === 0).length, input.typography.length);

  // Composition completeness / asset availability.
  const plan = input.regionPlan;
  if (plan) {
    const totalCrops = plan.finalRegionCrops.length;
    const loaded = plan.finalRegionCrops.filter((c) => {
      const a = input.evidence.regionAssets.find((x) => x.regionId === c.regionId);
      return a && a.state === 'ready';
    }).length;
    m.assetAvailability = totalCrops === 0 ? 1 : ratio(loaded, totalCrops);
  }

  // Text recall (supplied by caller from source expectations vs visible text).
  if (input.textRecall) {
    m.visibleTextCodePointRecall = numOrNull(input.textRecall.visibleCodePointRecall);
    m.criticalTokenRecall = numOrNull(input.textRecall.criticalTokenRecall);
    m.punctuationRecall = numOrNull(input.textRecall.punctuationRecall);
  }
  m.browserExportParity = numOrNull(input.browserExportParity);

  // Overlap / off-page / contrast diagnostics from the actual evidence.
  const candidates: OverlapCandidate[] = input.evidence.elements.flatMap((el) => {
    const bboxPx = clampRectToSurface(el.bboxPx, input.evidence.pageRectPx);
    return bboxPx ? [{
      id: el.id, regionId: el.regionId, overlayId: el.overlayId, bboxPx,
      opacity: el.opacity, zIndex: el.zIndex, kind: el.kind, decorative: el.kind === 'page-raster',
    }] : [];
  });
  const overlaps = detectOverlaps(candidates, { surfaceRect: input.evidence.pageRectPx });
  m.overlapScore = candidates.length === 0 ? null : round4(clamp01(1 - overlaps.length / Math.max(1, candidates.length)));
  for (const o of overlaps) {
    imageDefects.push(makeDefect({ code: o.code, ...base, scope: 'overlay', observed: o.overlapRatio, reason: `${o.code} between ${o.aId} and ${o.bId}` }));
  }
  const offPageEls = input.evidence.elements.filter((el) => el.offPage);
  m.offPageScore = input.evidence.elements.length === 0 ? null : round4(clamp01(1 - offPageEls.length / input.evidence.elements.length));
  for (const el of offPageEls) imageDefects.push(makeDefect({ code: 'element_off_page', ...base, scope: 'region', regionId: el.regionId, reason: 'element off page' }));
  const contrasts = input.evidence.textNodes.filter((n) => n.visible && n.contrastRatio != null);
  m.contrastScore = contrasts.length === 0 ? null : round4(clamp01(contrasts.filter((n) => (n.contrastRatio ?? 21) >= 3).length / contrasts.length));

  // Layout geometry from clipping + off-page on text nodes.
  const textNodes = input.evidence.textNodes.filter((n) => !n.hiddenSemantic);
  if (textNodes.length > 0) {
    const ok = textNodes.filter((n) => !n.clipped && !n.offPage).length;
    m.layoutGeometryScore = round4(ok / textNodes.length);
  }
  return { metrics: m, regionResults, imageDefects };
}

function regionCoverage(results: RegionComparisonResult[], ids: Set<string>): number | null {
  if (ids.size === 0) return null;
  const relevant = results.filter((r) => ids.has(r.regionId));
  if (relevant.length === 0) return 0;
  const good = relevant.filter((r) => r.scored && !r.blank && (r.foregroundRecall == null || r.foregroundRecall >= 0.5) && r.representationCount === 1).length;
  return ratio(good, relevant.length);
}
function numOrNull(v: number | null | undefined): number | null { return typeof v === 'number' && Number.isFinite(v) ? clamp01(v) : null; }

// ── Per-page report ──────────────────────────────────────────────────────────

export function evaluatePage(input: PageEvaluationInputV2): VisualPageQualityReportV2 {
  const { metrics, regionResults, imageDefects } = computePageMetrics(input);
  const structural = validateStructural({
    pageId: input.pageId, pageNumber: input.pageNumber, evidence: input.evidence,
    regionResults, charts: input.charts, tables: input.tables, typography: input.typography,
    tableObservations: input.tableObservations, regionPlan: input.regionPlan,
  });
  const defects = dedupeDefects([...imageDefects, ...structural]);
  if (input.expectationOrigin !== 'source-derived' && input.expectationOrigin !== 'partial-source-derived') {
    defects.push(makeDefect({ code: 'source_expectations_not_source_derived', pageId: input.pageId, pageNumber: input.pageNumber, severity: 'warning', hardVeto: false, reason: `expectations are ${input.expectationOrigin}` }));
  }

  // compositionCompleteness = 1 − composition hard-defects / composed-unit count.
  const composedUnits = Math.max(1, input.regionInputs.length + input.charts.length + input.tables.length + input.typography.length + (input.regionPlan ? input.regionPlan.finalRegionCrops.length : 0));
  const compDefects = defects.filter((d) => COMPOSITION_DEFECT_CODES.has(d.code)).length;
  metrics.compositionCompleteness = Math.round(Math.max(0, Math.min(1, 1 - compDefects / composedUnits)) * 10000) / 10000;

  const scoreRes = scorePageMetricsV2(metrics);
  const coverageComplete = scoreRes.qualityCoverage === 'complete';
  const decision: PageDecisionResult = decidePage({
    stage: input.evaluationStage, score: scoreRes.overallScore, defects,
    qualityCoverageComplete: coverageComplete,
    exactRegionCropsAvailable: input.exactRegionCropsAvailable, pageRasterAvailable: input.pageRasterAvailable,
  });

  return {
    version: VISUAL_QUALITY_REPORT_V2_VERSION,
    pageId: input.pageId, pageNumber: input.pageNumber,
    evaluationStage: input.evaluationStage,
    qualityCoverage: scoreRes.qualityCoverage,
    overallScore: scoreRes.overallScore,
    metricCoverage: scoreRes.metricCoverage,
    metrics, criticalDefects: defects, hardDefectCount: countHardDefects(defects),
    recommendedAction: decision.action, outputStrategy: decision.outputStrategy,
    manualReviewRequired: decision.manualReviewRequired,
    renderPlanHash: input.evidence.renderPlanHash ?? input.regionPlan?.renderPlanHash ?? null,
    sourceEvidenceHash: input.sourceEvidenceHash ?? null,
    expectationOrigin: input.expectationOrigin,
    problems: [...input.evidence.problems],
  };
}

function dedupeDefects(defects: CriticalQualityDefectV1[]): CriticalQualityDefectV1[] {
  const seen = new Set<string>(); const out: CriticalQualityDefectV1[] = [];
  for (const d of defects) {
    const k = `${d.code}|${d.scope}|${d.regionId ?? ''}|${d.overlayId ?? ''}|${d.sourceRunId ?? ''}`;
    if (seen.has(k)) continue; seen.add(k); out.push(d);
  }
  return out;
}

// ── Gate ─────────────────────────────────────────────────────────────────────

export interface QualityGateV2Input {
  importId: string; templateId?: string | null;
  pages: PageEvaluationInputV2[];
  batchSize?: number;
  expectedPageCount?: number | null;
  minimumCriticalRegionScore?: number | null;
  browserExportParity?: number | null;
  exportParityRequired?: boolean;
  exportParityAvailable?: boolean;
  repairPassesApplied?: number;
  artifactPaths?: string[];
  now?: () => Date;
}

export interface ImportQualityGateV2Result {
  version: typeof IMPORT_QUALITY_GATE_V2_VERSION;
  finalReport: VisualImportQualityReportV2;
  finalDecision: FinalDecisionV2;
  finalizationAllowed: boolean;
  exportAllowed: boolean;
  manualReviewRequired: boolean;
  regionDecisionsApplied: boolean;
  templateChanged: boolean;
  problems: string[];
}

/** Run the gate over all pages in bounded sequential batches. Fail-closed. */
export function runImportQualityGateV2(input: QualityGateV2Input): ImportQualityGateV2Result {
  const batchSize = Math.max(1, Math.min(20, input.batchSize ?? 10));
  const seenPageIds = new Set<string>();
  const pageReports: VisualPageQualityReportV2[] = [];

  for (let i = 0; i < input.pages.length; i += batchSize) {
    const batch = input.pages.slice(i, i + batchSize);
    for (const page of batch) {
      if (seenPageIds.has(page.pageId)) continue; // no duplicate merge
      seenPageIds.add(page.pageId);
      pageReports.push(evaluatePage(page));
    }
  }
  pageReports.sort((a, b) => a.pageNumber - b.pageNumber);

  // Coverage: every expected page attempted + scored.
  const expected = input.expectedPageCount ?? input.pages.length;
  const pagesUnscored = pageReports.filter((p) => p.overallScore == null || p.qualityCoverage === 'none').length
    + Math.max(0, expected - pageReports.length);
  const batchCoverageComplete = pageReports.length >= expected && pageReports.every((p) => p.qualityCoverage !== 'none');

  const anyCriticalPageUnscored = pageReports.some((p) => p.overallScore == null || p.qualityCoverage === 'none')
    || pageReports.length < expected;

  const doc = aggregateDocumentScore({
    pageScores: pageReports.map((p) => p.overallScore),
    minimumCriticalRegionScore: input.minimumCriticalRegionScore ?? null,
    criticalPagePass: pageReports.map((p) => p.hardDefectCount === 0 && (p.overallScore ?? 0) >= 0.80 && p.qualityCoverage === 'complete'),
  });

  const finalize = finalizeDocument({
    pageStrategies: pageReports.map((p) => p.outputStrategy),
    anyPageManualReview: pageReports.some((p) => p.manualReviewRequired),
    anyCriticalPageUnscored,
    batchCoverageComplete,
    exportParityRequired: Boolean(input.exportParityRequired),
    exportParityAvailable: Boolean(input.exportParityAvailable),
  });

  const strategyCounts: Record<string, number> = {};
  for (const p of pageReports) strategyCounts[p.outputStrategy] = (strategyCounts[p.outputStrategy] ?? 0) + 1;
  const totalHardDefectCount = pageReports.reduce((n, p) => n + p.hardDefectCount, 0);
  const coverage: VisualImportQualityReportV2['coverage'] = batchCoverageComplete ? 'complete' : (pageReports.length > 0 ? 'partial' : 'none');

  const finalReport: VisualImportQualityReportV2 = {
    version: VISUAL_QUALITY_REPORT_V2_VERSION,
    importId: input.importId, templateId: input.templateId ?? null,
    pages: pageReports,
    documentScore: doc.documentScore, meanPageScore: doc.meanPageScore, minimumPageScore: doc.minimumPageScore,
    p10PageScore: doc.p10PageScore, minimumCriticalRegionScore: doc.minimumCriticalRegionScore,
    criticalPagePassRate: doc.criticalPagePassRate,
    totalHardDefectCount, pagesWithHardDefects: pageReports.filter((p) => p.hardDefectCount > 0).length,
    pagesUnscored, browserExportParity: numOrNull(input.browserExportParity),
    coverage, strategyCounts, manualReviewRequired: finalize.manualReviewRequired,
    repairPassesApplied: Math.max(0, input.repairPassesApplied ?? 0),
    generatedAt: (input.now ?? (() => new Date()))().toISOString(),
    artifactPaths: [...(input.artifactPaths ?? [])], problems: [],
  };

  const regionDecisionsApplied = pageReports.some((p) => p.outputStrategy === 'mixed' || p.recommendedAction === 'apply-mixed-region-fallback');
  const templateChanged = pageReports.some((p) => p.outputStrategy !== 'native' || p.recommendedAction.startsWith('apply-'));

  return {
    version: IMPORT_QUALITY_GATE_V2_VERSION,
    finalReport, finalDecision: finalize.finalDecision,
    finalizationAllowed: finalize.finalizationAllowed, exportAllowed: finalize.exportAllowed,
    manualReviewRequired: finalize.manualReviewRequired,
    regionDecisionsApplied, templateChanged,
    problems: finalize.finalizationAllowed ? [] : [finalize.reason],
  };
}
