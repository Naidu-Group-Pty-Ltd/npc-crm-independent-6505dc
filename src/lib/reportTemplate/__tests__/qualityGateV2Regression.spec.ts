/**
 * E7 — pre-upgrade 57/100 failure-class regression.
 *
 * Models the observed failure class WITHOUT any private data: a chart-heavy
 * source page whose chart region is MISSING from the output, on a mostly-white
 * page so a legacy global image score looks deceptively non-catastrophic. Proves
 * the V2 gate rejects it: local blank + missing chart region are detected, hard
 * defects veto native acceptance, and the unsafe output can NEVER receive
 * accept-native / accept-native-with-review.
 */
import { describe, it, expect } from 'vitest';
import {
  runImportQualityGateV2, compareRegion, pagePixelSimilarity, colourSimilarity, tiledComparison,
  type PageEvaluationInputV2,
} from '../ingestion/visualQuality/v2';
import { buildFailureClassFixture, cropImage, pageEvidence, regionPlanProjection } from '../ingestion/visualQuality/v2/fixtures';

describe('57/100 failure-class regression', () => {
  const fx = buildFailureClassFixture();
  // chart lives at x0=20,y0=70,w=180,h=140 in the fixture.
  const srcCrop = cropImage(fx.source, 20, 70, 180, 140);
  const outCrop = cropImage(fx.output, 20, 70, 180, 140);

  it('legacy global image score is deceptively non-catastrophic', () => {
    expect(pagePixelSimilarity(fx.source, fx.output)).toBeGreaterThan(0.8);
    expect(colourSimilarity(fx.source, fx.output)).toBeGreaterThan(0.8);
  });

  it('V2 local blank + tiled detection catches the missing chart', () => {
    const tiled = tiledComparison(fx.source, fx.output, { grid: 4 });
    expect(tiled.blankTiles.length).toBeGreaterThan(0);
    expect(tiled.weightedSimilarity).toBeLessThan(pagePixelSimilarity(fx.source, fx.output));
  });

  it('V2 region comparison reports the chart region blank / foreground lost', () => {
    const r = compareRegion({ regionId: fx.chartRegionId, regionType: 'chart', sourceCrop: srcCrop, outputCrop: outCrop, visibleOwnerRegionId: fx.chartRegionId, assetLoaded: true, representationCount: 1 });
    expect(r.scored).toBe(true);
    expect(r.blank || (r.foregroundRecall ?? 1) < 0.3).toBe(true);
  });

  it('the unsafe page can NEVER receive accept-native / accept-native-with-review', () => {
    const page: PageEvaluationInputV2 = {
      pageId: 'docling-page-1', pageNumber: 1, evaluationStage: 'native',
      evidence: pageEvidence({ renderPlanHash: 'h', visibleRegionIds: [], visibleCropRegionIds: [] }),
      sourceRaster: fx.source, outputRaster: fx.output,
      regionInputs: [{ regionId: fx.chartRegionId, regionType: 'chart', sourceCrop: srcCrop, outputCrop: outCrop, visibleOwnerRegionId: fx.chartRegionId, assetLoaded: true, representationCount: 0 }],
      charts: [{ regionId: fx.chartRegionId, pageNumber: 1, mode: 'chart-crop', childRegionIds: [] }],
      tables: [], typography: [],
      regionPlan: regionPlanProjection({ renderPlanHash: 'h' }), expectationOrigin: 'source-derived',
      pageRasterAvailable: true, exactRegionCropsAvailable: false,
      textRecall: { visibleCodePointRecall: 1, criticalTokenRecall: 1, punctuationRecall: 1 },
    };
    const res = runImportQualityGateV2({ importId: 'i', pages: [page], expectedPageCount: 1 });
    const report = res.finalReport.pages[0];
    expect(report.recommendedAction).not.toBe('accept-native');
    expect(report.recommendedAction).not.toBe('accept-native-with-review');
    expect(report.hardDefectCount).toBeGreaterThan(0);
    expect(report.criticalDefects.some((d) => d.code === 'chart_region_missing' || d.code === 'local_blank_region')).toBe(true);
  });
});
