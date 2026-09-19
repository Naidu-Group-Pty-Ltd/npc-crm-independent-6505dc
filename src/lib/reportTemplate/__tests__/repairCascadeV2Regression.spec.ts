/**
 * E8 — pre-upgrade 57/100 failure-class repair cascade regression.
 *
 * The failure class (a missing chart on a mostly-white page that scores
 * deceptively well) must end in a SAFE mixed/raster output — never unsafe
 * native. Proves E8 rejects any candidate that retains the hard defect and
 * selects the exact source crop / page raster instead.
 */
import { describe, it, expect } from 'vitest';
import {
  runRepairCascadeV2, createDeterministicAdapter, evaluateCandidate, defectFingerprint,
  type RenderAndEvaluateRepairCandidate, type RepairCandidateV1,
} from '../ingestion/visualQuality/repair/v2';
import { pageReport, acceptedReport, defect, templateFixture, missingChartReport, perfectMetrics } from '../ingestion/visualQuality/repair/v2/fixtures';

function classAdapter(byClass: Partial<Record<RepairCandidateV1['candidateClass'], ReturnType<typeof acceptedReport> | ReturnType<typeof pageReport> | null>>): RenderAndEvaluateRepairCandidate {
  return {
    async renderAndEvaluate(candidate) {
      const report = byClass[candidate.candidateClass] ?? null;
      return { candidateId: candidate.id, pageReport: report ?? null, evidence: null, renderPlanHash: report?.renderPlanHash ?? null, renderPlanHashMatched: true, exportParityPassed: report ? true : null, loadedAssetStates: {}, renderMs: 1, captureMs: 1, problems: [] };
    },
  };
}

const sourceContext = {
  sourceBBox: {}, pageWidthPt: 595, pageHeightPt: 842,
  cropAssets: { 'chart-exec': { path: 'job/chart.png', hash: 'h', blank: false } },
  pageRaster: { path: 'job/p1.png', hash: 'h', widthPt: 595, heightPt: 842, blank: false },
  hasRegionPlan: true,
};

describe('57/100 failure-class repair cascade', () => {
  it('an unsafe native candidate that keeps the missing chart is rejected; mixed crop is selected', () => {
    const before = missingChartReport();
    const chartMissing = before.criticalDefects.filter((d) => d.hardVeto).map(defectFingerprint);
    // native candidate raises score but STILL missing chart → rejected.
    const unsafeNative = evaluateCandidate({
      candidate: { candidateClass: 'native-repair' } as RepairCandidateV1,
      beforeReport: before,
      afterReport: pageReport({ criticalDefects: before.criticalDefects, overallScore: 0.99 }),
      targetDefectFingerprints: chartMissing, renderPlanHashMatched: true,
    });
    expect(unsafeNative.accepted).toBe(false);
    expect(unsafeNative.rejectionCodes).toContain('target_hard_defect_retained');
  });

  it('the failure-class page ends safe mixed via exact source crop (never accept-native)', async () => {
    const mixedResolved = pageReport({ criticalDefects: [], overallScore: 0.88, outputStrategy: 'mixed', recommendedAction: 'accept-mixed', renderPlanHash: 'rplanh-base', metrics: perfectMetrics() });
    const res = await runRepairCascadeV2({
      importId: 'i', templateId: null, template: templateFixture(),
      pages: [{
        pageId: 'docling-page-1', pageNumber: 1, initialReport: missingChartReport(), sourceContext,
        pass1Inputs: {},
        pass2Inputs: {
          regionCropFallbacks: [{ regionId: 'chart-exec', crop: { regionId: 'chart-exec', bbox: { x: 20, y: 70, width: 180, height: 140 }, artifactPath: 'job/chart.png', assetId: 'chart-exec', sha256: 'a'.repeat(64), cropRole: 'final-output' }, renderPlanHash: 'rplanh-base', evidence: { kind: 'source-crop', ref: 'job/chart.png', hash: 'h' } }],
          pageRasterFallback: { evidence: { kind: 'source-page-raster', ref: 'job/p1.png', hash: 'h' } },
        },
        pageRasterAvailable: true,
      }],
      adapter: classAdapter({ 'mixed-region': mixedResolved, 'page-raster': acceptedReport('raster-only', 'rplanh-base') }),
      runtimeContextFor: () => ({ importId: 'i', templateId: null, pageId: 'docling-page-1', pageNumber: 1 }),
    });
    const page = res.pages[0];
    expect(['accepted-mixed', 'accepted-raster']).toContain(page.finalStatus);
    expect(page.finalStatus).not.toBe('accepted-native');
    expect(page.remainingDefectFingerprints).toEqual([]);
    expect(res.finalizationAllowed).toBe(true);
  });
});

void defect;
