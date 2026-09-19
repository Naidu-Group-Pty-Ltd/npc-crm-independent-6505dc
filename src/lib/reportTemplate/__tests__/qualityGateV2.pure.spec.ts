/**
 * E7 — Quality Gate V2 pure specs. Hard defects first, score second, decision
 * third. Verifies the veto, evidence separation, null/coverage semantics, DOM
 * evaluators, image metrics V2, region + structural validation, scoring,
 * decision cascade, export parity, the gate, and the renderer wiring helper.
 */
import { describe, it, expect } from 'vitest';
import {
  RENDERED_OUTPUT_EVIDENCE_VERSION, EXPORT_OUTPUT_EVIDENCE_VERSION, CRITICAL_QUALITY_DEFECTS_VERSION,
  VISUAL_QUALITY_REPORT_V2_VERSION, IMPORT_QUALITY_GATE_V2_VERSION,
  makeDefect, hasUnresolvedHardDefect, assertDecisionPermitted, HARD_VETO_CODES,
  evaluateClipping, evaluateOffPage, computeContrastRatio, detectOverlaps, evaluateTextRun, isRenderedVisible,
  toCanonicalGray, pagePixelSimilarity, compareForeground, compareEdges, tiledComparison, detectLocalBlank,
  compareRegion, validateStructural, scorePageMetricsV2, aggregateDocumentScore,
  decidePage, finalizeDocument, validateExportEvidence, validatePageParity,
  validateVisualPageReportV2, validateMetricsV2,
  runImportQualityGateV2, evaluatePage, computePageMetrics,
  type PageEvaluationInputV2,
} from '../ingestion/visualQuality/v2';
import {
  makeImage, whitePage, chartImage, pageEvidence, textNode, style, regionPlanProjection, buildFailureClassFixture, cropImage,
} from '../ingestion/visualQuality/v2/fixtures';
import {
  resolveRegionRenderPlanProjection, suppressedOverlayIdSet, buildFinalCropElementsHtml, isDurableArtifactPath,
} from '../rendering/regionRenderPlanApply';
import { PageSchema } from '../templateSchema';

// ── A. Versions + validation ──────────────────────────────────────────────────

describe('E7 versions + validation', () => {
  it('version constants are exact', () => {
    expect(RENDERED_OUTPUT_EVIDENCE_VERSION).toBe('rendered-output-evidence-v1');
    expect(EXPORT_OUTPUT_EVIDENCE_VERSION).toBe('export-output-evidence-v1');
    expect(CRITICAL_QUALITY_DEFECTS_VERSION).toBe('critical-quality-defects-v1');
    expect(VISUAL_QUALITY_REPORT_V2_VERSION).toBe('visual-quality-report-v2');
    expect(IMPORT_QUALITY_GATE_V2_VERSION).toBe('import-quality-gate-v2');
  });
  it('a metric out of range / non-finite is rejected; null is allowed', () => {
    const good = { version: 'visual-metrics-v2', pagePixelSimilarity: 0.9, foregroundRecall: null } as any;
    expect(validateMetricsV2({ ...blankMetrics(), ...good })).not.toContain('metric_out_of_range:pagePixelSimilarity');
    expect(validateMetricsV2({ ...blankMetrics(), pagePixelSimilarity: 1.4 })).toContain('metric_out_of_range:pagePixelSimilarity');
    expect(validateMetricsV2({ ...blankMetrics(), edgeSimilarity: Number.NaN })).toContain('metric_non_finite:edgeSimilarity');
  });
  it('an accepted report with an unresolved hard defect is rejected', () => {
    const report = acceptedReport([makeDefect({ code: 'chart_region_missing' })]);
    expect(validateVisualPageReportV2(report)).toContain('accepted_with_unresolved_hard_defect');
  });
  it('a persisted signed URL anywhere is rejected', () => {
    const report = acceptedReport([]);
    (report as any).problems = ['https://signed.example/x.png'];
    expect(validateVisualPageReportV2(report)).toContain('signed_url_persisted');
  });
});

// ── B. Hard-defect veto ───────────────────────────────────────────────────────

describe('hard-defect veto (score never overrides)', () => {
  it('makeDefect marks known critical codes as hard veto', () => {
    expect(makeDefect({ code: 'chart_region_missing' }).hardVeto).toBe(true);
    expect(HARD_VETO_CODES.has('duplicate_source_pixels')).toBe(true);
  });
  it('a warning-severity instance does not veto', () => {
    expect(makeDefect({ code: 'chart_region_missing', severity: 'warning' }).hardVeto).toBe(false);
  });
  it('assertDecisionPermitted blocks native accept with a hard defect, even at score 0.99', () => {
    const defects = [makeDefect({ code: 'critical_numeric_token_missing' })];
    expect(assertDecisionPermitted('accept-native', defects).permitted).toBe(false);
    expect(assertDecisionPermitted('accept-page-raster', []).permitted).toBe(true);
    expect(assertDecisionPermitted('accept-page-raster', [makeDefect({ code: 'page_raster_missing' })]).permitted).toBe(false);
  });
});

// ── C. Evidence separation / DOM evaluators ──────────────────────────────────

describe('DOM evaluators', () => {
  it('display:none / visibility:hidden / opacity:0 / zero-size are NOT visible', () => {
    expect(isRenderedVisible({ style: style({ display: 'none' }), rectPx: { x: 0, y: 0, width: 10, height: 10 } })).toBe(false);
    expect(isRenderedVisible({ style: style({ visibility: 'hidden' }), rectPx: { x: 0, y: 0, width: 10, height: 10 } })).toBe(false);
    expect(isRenderedVisible({ style: style({ opacity: 0 }), rectPx: { x: 0, y: 0, width: 10, height: 10 } })).toBe(false);
    expect(isRenderedVisible({ style: style(), rectPx: { x: 0, y: 0, width: 0, height: 10 } })).toBe(false);
    expect(isRenderedVisible({ style: style(), rectPx: { x: 0, y: 0, width: 10, height: 10 } })).toBe(true);
  });
  it('horizontal + vertical clipping detected via scroll vs client', () => {
    const clip = evaluateClipping({ clientWidth: 100, clientHeight: 20, scrollWidth: 160, scrollHeight: 20, overflowX: 'hidden', overflowY: 'visible', lineRectsPx: [], clipRectPx: { x: 0, y: 0, width: 100, height: 20 } });
    expect(clip.clipped).toBe(true); expect(clip.clippedWidthPx).toBe(60);
  });
  it('a line box outside the clip region is clipped', () => {
    const clip = evaluateClipping({ clientWidth: 100, clientHeight: 20, scrollWidth: 100, scrollHeight: 20, overflowX: 'hidden', overflowY: 'hidden', lineRectsPx: [{ x: 120, y: 0, width: 40, height: 16 }], clipRectPx: { x: 0, y: 0, width: 100, height: 20 } });
    expect(clip.clippedLineCount).toBe(1); expect(clip.clipped).toBe(true);
  });
  // W0 — the defect that was structurally invisible. The export renderer
  // (blocks/_shared.html.ts) sets `overflow` only under `maxLines`, so a text
  // box too small for its content spilled under `overflow: visible` and the
  // gate measured it as perfectly fine. Overflow is now measured regardless of
  // mode, then classified: clipping mode loses content, visible mode spills it.
  it('overflow under visible overflow is measured, not ignored', () => {
    const clip = evaluateClipping({
      clientWidth: 100, clientHeight: 20, scrollWidth: 100, scrollHeight: 64,
      overflowX: 'visible', overflowY: 'visible',
      lineRectsPx: [], clipRectPx: { x: 0, y: 0, width: 100, height: 20 },
    });
    expect(clip.overflowing).toBe(true);
    expect(clip.overflowHeightPx).toBe(44);
    // It spills, it is not cut off — the two must not be conflated.
    expect(clip.clipped).toBe(false);
    expect(clip.clippedHeightPx).toBe(0);
  });

  it('the same geometry under a clipping overflow reports clipped, not overflowing', () => {
    const clip = evaluateClipping({
      clientWidth: 100, clientHeight: 20, scrollWidth: 100, scrollHeight: 64,
      overflowX: 'hidden', overflowY: 'hidden',
      lineRectsPx: [], clipRectPx: { x: 0, y: 0, width: 100, height: 20 },
    });
    expect(clip.clipped).toBe(true);
    expect(clip.clippedHeightPx).toBe(44);
    expect(clip.overflowing).toBe(false);
  });

  it('a spilling line box under visible overflow counts as overflow, not clipping', () => {
    const clip = evaluateClipping({
      clientWidth: 100, clientHeight: 20, scrollWidth: 100, scrollHeight: 20,
      overflowX: 'visible', overflowY: 'visible',
      lineRectsPx: [{ x: 0, y: 24, width: 90, height: 16 }],
      clipRectPx: { x: 0, y: 0, width: 100, height: 20 },
    });
    expect(clip.overflowLineCount).toBe(1);
    expect(clip.overflowing).toBe(true);
    expect(clip.clippedLineCount).toBe(0);
  });

  it('a fitting box is neither clipped nor overflowing under either mode', () => {
    for (const mode of ['visible', 'hidden'] as const) {
      const clip = evaluateClipping({
        clientWidth: 100, clientHeight: 20, scrollWidth: 100, scrollHeight: 20,
        overflowX: mode, overflowY: mode,
        lineRectsPx: [{ x: 0, y: 2, width: 90, height: 16 }],
        clipRectPx: { x: 0, y: 0, width: 100, height: 20 },
      });
      expect(clip.clipped, mode).toBe(false);
      expect(clip.overflowing, mode).toBe(false);
    }
  });

  it('critical content off-page detected; subpixel tolerated', () => {
    expect(evaluateOffPage({ x: 590, y: 10, width: 40, height: 10 }, { x: 0, y: 0, width: 595, height: 842 })).toBe(true);
    expect(evaluateOffPage({ x: -0.4, y: 10, width: 40, height: 10 }, { x: 0, y: 0, width: 595, height: 842 })).toBe(false);
  });
  it('contrast: dark-on-dark fails, readable passes, transparent bg resolves to white', () => {
    expect(computeContrastRatio('rgb(20,20,20)', 'rgb(15,15,15)')!).toBeLessThan(3);
    expect(computeContrastRatio('rgb(17,24,39)', 'rgb(255,255,255)')!).toBeGreaterThan(4.5);
    expect(computeContrastRatio('rgb(0,0,0)', 'transparent')!).toBeGreaterThan(4.5);
  });
  it('detectOverlaps flags a native overlay painted over its own final crop', () => {
    const pairs = detectOverlaps([
      { id: 'crop', regionId: 'r1', overlayId: null, bboxPx: { x: 0, y: 0, width: 100, height: 100 }, opacity: 1, zIndex: 0, kind: 'source-crop' },
      { id: 'text', regionId: 'r1', overlayId: 'o1', bboxPx: { x: 10, y: 10, width: 60, height: 20 }, opacity: 1, zIndex: 1, kind: 'text' },
    ]);
    expect(pairs.some((p) => p.code === 'crop_and_native_both_visible')).toBe(true);
  });
  it('detectOverlaps ignores a run inside its own region (valid ownership)', () => {
    const pairs = detectOverlaps([
      { id: 'a', regionId: 'r1', overlayId: null, bboxPx: { x: 0, y: 0, width: 100, height: 100 }, opacity: 1, zIndex: 0, kind: 'block-group', ownerRegionId: null },
      { id: 'b', regionId: 'r1', overlayId: null, bboxPx: { x: 10, y: 10, width: 40, height: 40 }, opacity: 1, zIndex: 1, kind: 'text', ownerRegionId: 'r1' },
    ]);
    expect(pairs.length).toBe(0);
  });
  it('detectOverlaps bounds bucket construction for hostile rectangles', () => {
    const started = performance.now();
    expect(detectOverlaps([{
      id: 'hostile', regionId: null, overlayId: null,
      bboxPx: { x: 0, y: 0, width: 100_000_000, height: 100_000_000 },
      opacity: 1, zIndex: 0, kind: 'image',
    }], { maxPairs: 0 })).toEqual([]);
    expect(performance.now() - started).toBeLessThan(100);
  });
  it('evaluateTextRun: hidden-semantic never counts as visible; clipped flagged', () => {
    const hidden = evaluateTextRun(baseRun({ hiddenSemantic: true }));
    expect(hidden.visible).toBe(false);
    const clipped = evaluateTextRun(baseRun({ scrollWidth: 300, computedStyle: style({ overflowX: 'hidden' }) }));
    expect(clipped.clipped).toBe(true);
  });
});

// ── D. Image metrics V2 ───────────────────────────────────────────────────────

describe('image metrics V2', () => {
  it('identical pages score ~1; a missing chart scores low on foreground/edges', () => {
    const src = chartImage(); const out = whitePage(200, 160);
    expect(pagePixelSimilarity(src, src)).toBeGreaterThan(0.99);
    const sGray = toCanonicalGray(src, 256); const oGray = toCanonicalGray(out, 256);
    expect(compareForeground(sGray, sGray).recall).toBe(1);
    expect(compareForeground(sGray, oGray).recall).toBeLessThan(0.2);
    expect(compareEdges(sGray, oGray).recall).toBeLessThan(0.2);
  });
  it('empty white tiles cannot dominate: a locally-missing chart is a blank tile', () => {
    const src = makeImage(200, 200, [{ x: 60, y: 60, w: 60, h: 60 }]);
    const out = whitePage(200, 200);
    const tiled = tiledComparison(src, out, { grid: 4 });
    expect(tiled.blankTiles.length).toBeGreaterThan(0);
    // colour/pixel similarity is deceptively high, but weighted similarity drops.
    expect(pagePixelSimilarity(src, out)).toBeGreaterThan(0.85);
    expect(tiled.weightedSimilarity).toBeLessThan(0.6);
  });
  it('detectLocalBlank: source content, blank output → blank', () => {
    const src = makeImage(120, 120, [{ x: 20, y: 20, w: 60, h: 60 }]);
    expect(detectLocalBlank(src, whitePage(120, 120)).blank).toBe(true);
    expect(detectLocalBlank(src, src).blank).toBe(false);
  });
});

// ── E. Region + structural validation ────────────────────────────────────────

describe('region + structural validation', () => {
  it('a region with no output raster is unscored (never a false pass)', () => {
    const r = compareRegion({ regionId: 'c1', regionType: 'chart', sourceCrop: chartImage(), outputCrop: null, visibleOwnerRegionId: 'c1', assetLoaded: false, representationCount: 0 });
    expect(r.scored).toBe(false);
  });
  it('missing chart on white page → chart_region_missing hard defect', () => {
    const ev = pageEvidence({ visibleRegionIds: [], visibleCropRegionIds: [] });
    const rr = compareRegion({ regionId: 'c1', regionType: 'chart', sourceCrop: chartImage(), outputCrop: whitePage(200, 160), visibleOwnerRegionId: 'c1', assetLoaded: true, representationCount: 0 });
    const defects = validateStructural({
      pageId: 'p', pageNumber: 1, evidence: ev, regionResults: [rr],
      charts: [{ regionId: 'c1', pageNumber: 1, mode: 'chart-crop', childRegionIds: [] }],
      tables: [], typography: [], regionPlan: regionPlanProjection({ renderPlanHash: null as any }),
    });
    expect(defects.some((d) => d.code === 'chart_region_missing')).toBe(true);
  });
  it('fused numeric range → range_separator_missing; missing token → critical_numeric_token_missing', () => {
    const ev = pageEvidence({ textNodes: [textNode({ overlayId: 'o1', rawVisibleText: '1015 years $910,000920,000', visible: true })], visibleRegionIds: ['run-1'] });
    const defects = validateStructural({
      pageId: 'p', pageNumber: 1, evidence: ev, regionResults: [],
      charts: [], tables: [],
      typography: [{ sourceRunId: 'run-1', pageNumber: 1, regionId: 'run-1', overlayId: 'o1', mode: 'verified-native-text', criticalTokens: ['$920,000'], criticalPunctuation: ['10–15'], forbiddenFusions: ['1015'], expectedLineCount: null, hardDefectCodes: [] }],
      regionPlan: regionPlanProjection(),
    });
    expect(defects.some((d) => d.code === 'range_separator_missing')).toBe(true);
    expect(defects.some((d) => d.code === 'critical_numeric_token_missing')).toBe(true);
  });
  it('E6 composition: plan-hash mismatch + suppressed overlay visible are hard defects', () => {
    const ev = pageEvidence({ renderPlanHash: 'rplanh-WRONG', visibleOverlayIds: ['axis'] });
    const defects = validateStructural({
      pageId: 'p', pageNumber: 1, evidence: ev, regionResults: [],
      charts: [], tables: [], typography: [],
      regionPlan: regionPlanProjection({ renderPlanHash: 'rplanh-RIGHT', suppressedOverlayIds: ['axis'] }),
    });
    expect(defects.some((d) => d.code === 'renderer_plan_mismatch')).toBe(true);
    expect(defects.some((d) => d.code === 'crop_and_native_both_visible')).toBe(true);
  });
  it('editor-reference crop visible in final output is a hard defect', () => {
    const ev = pageEvidence({ editorReferenceRegionIds: ['t1'], renderPlanHash: 'h' });
    const defects = validateStructural({ pageId: 'p', pageNumber: 1, evidence: ev, regionResults: [], charts: [], tables: [], typography: [], regionPlan: regionPlanProjection({ renderPlanHash: 'h' }) });
    expect(defects.some((d) => d.code === 'editor_reference_visible_in_final')).toBe(true);
  });
});

// ── F. Scoring + coverage + decision cascade ─────────────────────────────────

describe('scoring, coverage + decision cascade', () => {
  it('missing metrics stay null (never 0.5) and lower coverage', () => {
    const m = { ...blankMetrics(), sourceRegionCoverage: 1, foregroundRecall: 1 };
    const res = scorePageMetricsV2(m as any);
    expect(res.overallScore).not.toBeNull();
    expect(res.qualityCoverage).toBe('partial'); // required metrics missing
  });
  it('a strong document average cannot hide one catastrophic page', () => {
    const doc = aggregateDocumentScore({ pageScores: [0.98, 0.98, 0.98, 0.2], minimumCriticalRegionScore: 0.2, criticalPagePass: [true, true, true, false] });
    expect(doc.minimumPageScore).toBe(0.2);
    expect(doc.documentScore!).toBeLessThan(doc.meanPageScore!);
  });
  it('native cascade: high score no defect → accept-native; hard defect → mixed/raster', () => {
    expect(decidePage({ stage: 'native', score: 0.95, defects: [], qualityCoverageComplete: true, exactRegionCropsAvailable: false, pageRasterAvailable: true }).action).toBe('accept-native');
    expect(decidePage({ stage: 'native', score: 0.95, defects: [makeDefect({ code: 'chart_region_missing' })], qualityCoverageComplete: true, exactRegionCropsAvailable: true, pageRasterAvailable: true }).action).toBe('apply-mixed-region-fallback');
    expect(decidePage({ stage: 'native', score: 0.95, defects: [makeDefect({ code: 'chart_region_missing' })], qualityCoverageComplete: true, exactRegionCropsAvailable: false, pageRasterAvailable: true }).action).toBe('apply-page-raster');
  });
  it('unscored/incomplete coverage never accepts; escalates to raster or blocks', () => {
    expect(decidePage({ stage: 'native', score: null, defects: [], qualityCoverageComplete: false, exactRegionCropsAvailable: false, pageRasterAvailable: true }).outputStrategy).toBe('raster-only');
    expect(decidePage({ stage: 'native', score: null, defects: [], qualityCoverageComplete: false, exactRegionCropsAvailable: false, pageRasterAvailable: false }).outputStrategy).toBe('blocked');
  });
  it('document finalize blocks on any unscored critical page or blocked page', () => {
    expect(finalizeDocument({ pageStrategies: ['native'], anyPageManualReview: false, anyCriticalPageUnscored: true, batchCoverageComplete: false, exportParityRequired: false, exportParityAvailable: false }).finalizationAllowed).toBe(false);
    expect(finalizeDocument({ pageStrategies: ['native', 'blocked'], anyPageManualReview: false, anyCriticalPageUnscored: false, batchCoverageComplete: true, exportParityRequired: false, exportParityAvailable: false }).finalDecision).toBe('blocked');
  });
});

// ── G. Export parity ──────────────────────────────────────────────────────────

describe('export parity', () => {
  it('a plan-hash mismatch and a missing crop fail parity', () => {
    const r = validatePageParity({
      browser: pageEvidence({ renderPlanHash: 'A', visibleCropRegionIds: ['c1'], widthPt: 595, heightPt: 842 }),
      exported: { pageNumber: 1, widthPt: 595, heightPt: 842, raster: null, pdfTextCompanion: null, embeddedFontSummary: null, finalCropAssetIds: [], finalCropShas: [], renderPlanHash: 'B', missingAssets: [], problems: [] },
    });
    expect(r.defects.some((d) => d.code === 'renderer_parity_failed')).toBe(true);
    expect(r.defects.some((d) => d.code === 'export_critical_region_missing')).toBe(true);
  });
  it('PDF text present is NOT proof — a missing raster region still fails', () => {
    const res = validateExportEvidence({
      browser: { version: 'rendered-output-evidence-v1', importId: 'i', templateId: null, surface: 'quality-capture', capturedAt: 't', renderPlanVersion: null, renderPlanHash: 'A', viewport: { widthPx: 1, heightPx: 1, devicePixelRatio: 1, scale: 1 }, pages: [pageEvidence({ renderPlanHash: 'A', visibleCropRegionIds: ['c1'] })], complete: true, problems: [] },
      exported: { version: 'export-output-evidence-v1', importId: 'i', templateId: null, exportId: 'e', renderPlanVersion: null, renderPlanHash: 'A', pageCount: 1, exportPreflightPassed: false, pages: [{ pageNumber: 1, widthPt: 595, heightPt: 842, raster: null, pdfTextCompanion: { present: true, codePointCount: 100 }, embeddedFontSummary: null, finalCropAssetIds: [], finalCropShas: [], renderPlanHash: 'A', missingAssets: [], problems: [] }], complete: true, problems: [] },
    });
    expect(res.defects.some((d) => d.code === 'export_preflight_failed')).toBe(true);
    expect(res.defects.some((d) => d.code === 'export_critical_region_missing')).toBe(true);
  });
});

// ── H. Gate (batching + fail-closed) ─────────────────────────────────────────

describe('runImportQualityGateV2', () => {
  it('a clean native page is accepted; batching scores every page without duplication', () => {
    const pages = [1, 2, 3].map((n) => cleanNativePage(n));
    const res = runImportQualityGateV2({ importId: 'i', pages, expectedPageCount: 3, batchSize: 2 });
    expect(res.finalReport.pages).toHaveLength(3);
    expect(res.finalReport.coverage).toBe('complete');
    expect(['native', 'native-review']).toContain(res.finalDecision);
    expect(res.finalizationAllowed).toBe(true);
  });
  it('a page missing its chart is never accepted native; document may still finalize via fallback', () => {
    const res = runImportQualityGateV2({ importId: 'i', pages: [missingChartPage(1)], expectedPageCount: 1 });
    const page = res.finalReport.pages[0];
    expect(page.recommendedAction).not.toBe('accept-native');
    expect(page.hardDefectCount).toBeGreaterThan(0);
  });
  it('an incomplete batch (fewer pages than expected) fails closed', () => {
    const res = runImportQualityGateV2({ importId: 'i', pages: [cleanNativePage(1)], expectedPageCount: 5 });
    expect(res.finalizationAllowed).toBe(false);
    expect(res.finalDecision).toBe('blocked');
  });
});

// ── I. Renderer wiring helper ─────────────────────────────────────────────────

describe('region render plan apply (renderer wiring)', () => {
  it('resolves a projection off page.meta and reports suppressed overlays', () => {
    const page = { id: 'p', meta: { pdfImportRegionOutput: { renderPlan: regionPlanProjection({ suppressedOverlayIds: ['a', 'b'] }) } } } as any;
    const plan = resolveRegionRenderPlanProjection(page);
    expect(plan).not.toBeNull();
    expect([...suppressedOverlayIdSet(plan)].sort()).toEqual(['a', 'b']);
  });
  it('emits a hydrated final crop and never emits editor references; rejects live URLs as durable', () => {
    const plan = regionPlanProjection({ finalRegionCrops: [{ regionId: 'c1', bbox: { x: 10, y: 10, width: 50, height: 40 }, artifactPath: 'job/c1.png', assetId: 'c1', sha256: 'a'.repeat(64), cropRole: 'final-output' }] });
    const html = buildFinalCropElementsHtml(plan, { resolveSrc: () => 'blob:abc' });
    expect(html).toContain('data-pdf-region-id="c1"');
    expect(html).toContain('data-pdf-crop-role="final-output"');
    expect(html).toContain('<img');
    expect(isDurableArtifactPath('https://x/y.png')).toBe(false);
    expect(isDurableArtifactPath('job/c1.png')).toBe(true);
  });
  it('a raster-only page has no plan projection consumed as crops (no projection = no-op)', () => {
    expect(resolveRegionRenderPlanProjection({ id: 'p', meta: {} } as any)).toBeNull();
    expect(buildFinalCropElementsHtml(null)).toBe('');
  });
  it('rejects out-of-page crop projections and skips unsafe direct crop input', () => {
    const hostile = regionPlanProjection({ finalRegionCrops: [{
      regionId: 'bad', bbox: { x: 0, y: 0, width: 100_000, height: 100_000 },
      artifactPath: 'job/bad.png', assetId: null, sha256: null, cropRole: 'final-output',
    }] });
    const page = { id: 'p', size: { width: 595, height: 842 }, meta: { pdfImportRegionOutput: { renderPlan: hostile } } } as any;
    expect(resolveRegionRenderPlanProjection(page)).toBeNull();
    expect(buildFinalCropElementsHtml(hostile)).toBe('');
  });
  it('rejects non-finite and extremely large persisted crop geometry', () => {
    const base = { id: 'p', meta: { pdfImportRegionOutput: { renderPlan: regionPlanProjection() } } };
    const crops = (base.meta.pdfImportRegionOutput.renderPlan as any).finalRegionCrops;
    crops.push({ regionId: 'bad', bbox: { x: 0, y: 0, width: Infinity, height: 10 }, artifactPath: 'job/bad.png', assetId: null, sha256: null, cropRole: 'final-output' });
    expect(PageSchema.safeParse(base).success).toBe(false);
  });
  it('rejects persisted crop geometry extending beyond its page', () => {
    const plan = regionPlanProjection({ finalRegionCrops: [{
      regionId: 'bad', bbox: { x: 590, y: 0, width: 10, height: 10 },
      artifactPath: 'job/bad.png', assetId: null, sha256: null, cropRole: 'final-output',
    }] });
    expect(PageSchema.safeParse({ id: 'p', size: { width: 595, height: 842 }, meta: { pdfImportRegionOutput: { renderPlan: plan } } }).success).toBe(false);
  });
});

// ── helpers ───────────────────────────────────────────────────────────────────

function blankMetrics() {
  return {
    version: 'visual-metrics-v2', pagePixelSimilarity: null, tiledPixelSimilarity: null, colourSimilarity: null,
    foregroundMaskIoU: null, foregroundRecall: null, edgeSimilarity: null, contentOccupancyRecall: null,
    localBlankRegionScore: null, visibleTextCodePointRecall: null, criticalTokenRecall: null, punctuationRecall: null,
    layoutGeometryScore: null, sourceRegionCoverage: null, chartCoverage: null, pictureCoverage: null,
    tableIntegrityScore: null, typographyFidelityScore: null, compositionCompleteness: null, assetAvailability: null,
    browserExportParity: null, contrastScore: null, overlapScore: null, offPageScore: null,
  };
}
function acceptedReport(defects: any[]) {
  return {
    version: 'visual-quality-report-v2', pageId: 'p', pageNumber: 1, evaluationStage: 'native',
    qualityCoverage: 'complete', overallScore: 0.95, metricCoverage: 0.9, metrics: blankMetrics(),
    criticalDefects: defects, hardDefectCount: defects.filter((d: any) => d.hardVeto).length,
    recommendedAction: 'accept-native', outputStrategy: 'native', manualReviewRequired: false,
    renderPlanHash: 'h', sourceEvidenceHash: null, expectationOrigin: 'source-derived', problems: [],
  };
}
function baseRun(overrides: any = {}) {
  return {
    id: 'r', overlayId: 'o', regionId: 'reg', sourceRunIds: ['run'], rawVisibleText: 'hello',
    pageRectPx: { x: 40, y: 40, width: 100, height: 16 }, lineRectsPx: [{ x: 40, y: 40, width: 100, height: 16 }],
    clientWidth: 100, clientHeight: 16, scrollWidth: 100, scrollHeight: 16,
    clipRectPx: { x: 40, y: 40, width: 100, height: 16 }, pageBoxPx: { x: 0, y: 0, width: 595, height: 842 },
    computedStyle: style(), ...overrides,
  };
}

function cleanNativePage(pageNumber: number): PageEvaluationInputV2 {
  const img = makeImage(200, 260, [{ x: 20, y: 20, w: 160, h: 8 }, { x: 20, y: 40, w: 140, h: 8 }]);
  return {
    pageId: `docling-page-${pageNumber}`, pageNumber, evaluationStage: 'native',
    evidence: pageEvidence({ pageId: `docling-page-${pageNumber}`, pageNumber, renderPlanHash: 'h', textNodes: [textNode({ overlayId: 'o', rawVisibleText: 'clean prose', visible: true })] }),
    sourceRaster: img, outputRaster: img, regionInputs: [], charts: [], tables: [], typography: [],
    regionPlan: regionPlanProjection({ renderPlanHash: 'h' }), expectationOrigin: 'source-derived',
    pageRasterAvailable: true, exactRegionCropsAvailable: false,
    textRecall: { visibleCodePointRecall: 1, criticalTokenRecall: 1, punctuationRecall: 1 },
  };
}
function missingChartPage(pageNumber: number): PageEvaluationInputV2 {
  const src = chartImage(200, 160); const out = whitePage(200, 160);
  return {
    pageId: `docling-page-${pageNumber}`, pageNumber, evaluationStage: 'native',
    evidence: pageEvidence({ pageId: `docling-page-${pageNumber}`, pageNumber, renderPlanHash: 'h', visibleRegionIds: [], visibleCropRegionIds: [] }),
    sourceRaster: src, outputRaster: out,
    regionInputs: [{ regionId: 'c1', regionType: 'chart', sourceCrop: src, outputCrop: out, visibleOwnerRegionId: 'c1', assetLoaded: true, representationCount: 0 }],
    charts: [{ regionId: 'c1', pageNumber, mode: 'chart-crop', childRegionIds: [] }], tables: [], typography: [],
    regionPlan: regionPlanProjection({ renderPlanHash: 'h' }), expectationOrigin: 'source-derived',
    pageRasterAvailable: true, exactRegionCropsAvailable: false,
    textRecall: { visibleCodePointRecall: 1, criticalTokenRecall: 1, punctuationRecall: 1 },
  };
}

// keep imports referenced
void computePageMetrics; void evaluatePage; void buildFailureClassFixture; void cropImage; void hasUnresolvedHardDefect;
