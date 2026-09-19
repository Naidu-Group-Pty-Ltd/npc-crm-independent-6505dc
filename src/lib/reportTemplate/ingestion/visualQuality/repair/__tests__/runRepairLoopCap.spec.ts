import { describe, expect, it } from 'vitest';
import { runRepairLoop, type RunRepairLoopOptions } from '../runRepairLoop';
import type { RepairSolver } from '../repairTypes';
import type { CdirDocument } from '@/lib/reportTemplate/ingestion/cdir/schema';
import type { VisualImportQualityReport, VisualPageQualityReport } from '../../schema';

function cdir(): CdirDocument {
  return {
    version: 1,
    source: { kind: 'pdf', checksum: 'sha256:cap', filename: 'cap.pdf' },
    pages: [{
      id: 'docling-page-1',
      label: 'Page 1',
      width: 595,
      height: 842,
      layers: [{
        id: 'layer-1',
        kind: 'text',
        bounds: { x: 10, y: 10, width: 100, height: 20 },
        text: 'hello',
      }],
    }],
  } as unknown as CdirDocument;
}

function page(score: number): VisualPageQualityReport {
  return {
    pageId: 'docling-page-1',
    pageNumber: 1,
    overallScore: score,
    pixelDifferenceScore: score,
    textCoverageScore: score,
    layoutDriftScore: score,
    missingElementScore: score,
    colorSimilarityScore: score,
    textAccuracy: null,
    medianPositionDrift: null,
    p95PositionDrift: null,
    recommendedAction: 'repair',
    warnings: [],
  } as unknown as VisualPageQualityReport;
}

function report(score: number): VisualImportQualityReport {
  return {
    importId: 'imp-cap',
    templateId: null,
    overallScore: score,
    pages: [page(score)],
    repairPassesApplied: 0,
    finalMode: 'hybrid',
    manualReviewRequired: score < 0.65,
  } as unknown as VisualImportQualityReport;
}

/** Solver that always proposes a bounds snap (accepted by applyPatch). */
const alwaysSolver: RepairSolver = {
  name: 'test-always',
  propose: () => ({
    pageId: 'docling-page-1',
    ops: [{ kind: 'set_bounds', pageId: 'docling-page-1', layerId: 'layer-1', bounds: { x: 12, y: 12, width: 100, height: 20 } }],
    rationale: 'test snap',
    source: 'manual',
  }),
};

function baseOptions(scorer: (n: number) => number, overrides: Partial<RunRepairLoopOptions> = {}): RunRepairLoopOptions {
  let trials = 0;
  return {
    importId: 'imp-cap',
    templateId: null,
    cdir: cdir(),
    expectations: {
      expectedText: [{ pageId: 'docling-page-1', text: 'hello' }],
      expectedBounds: [{ pageId: 'docling-page-1', layerId: 'layer-1', bounds: { x: 10, y: 10, width: 100, height: 20 } }],
    },
    renderedRasters: [{ pageId: 'docling-page-1', pageNumber: 1, imageData: { data: new Uint8ClampedArray(4), width: 1, height: 1 } as unknown as ImageData }],
    sourceRasters: [{ pageNumber: 1, imageData: { data: new Uint8ClampedArray(4), width: 1, height: 1 } as unknown as ImageData, widthPt: 595, heightPt: 842 }],
    finalMode: 'hybrid',
    solvers: [alwaysSolver],
    runVisualDiffImpl: async (input) => {
      // Initial scoring has repairPassesApplied 0; each trial increments.
      const n = input.repairPassesApplied ?? 0;
      if (n > 0) trials += 1;
      return report(scorer(n === 0 ? 0 : trials));
    },
    ...overrides,
  };
}

describe('runRepairLoop pass cap (Phase 2 contract)', () => {
  it('never runs more than 2 passes even when maxPasses is higher', async () => {
    // Strictly-improving score keeps every patch accepted → the loop would run
    // forever if uncapped; it must stop at the 2-pass ceiling.
    const result = await runRepairLoop(baseOptions((n) => 0.5 + 0.02 * n, { maxPasses: 5 }));
    expect(result.passes.length).toBeLessThanOrEqual(2);
    expect(result.passes.length).toBe(2);
    expect(result.totalApplied).toBe(2);
  });

  it('honours a lower maxPasses of 1', async () => {
    const result = await runRepairLoop(baseOptions((n) => 0.5 + 0.02 * n, { maxPasses: 1 }));
    expect(result.passes.length).toBe(1);
    expect(result.totalApplied).toBe(1);
  });

  it('stops early when a pass improves nothing (accept-on-improvement)', async () => {
    // Flat score → trial never beats the prior page score → patch rolled back →
    // patchesAccepted 0 → loop breaks after the first pass.
    const result = await runRepairLoop(baseOptions(() => 0.5, { maxPasses: 5 }));
    expect(result.passes.length).toBe(1);
    expect(result.totalApplied).toBe(0);
    expect(result.passes[0].patchesRejected).toBeGreaterThan(0);
  });

  it('keeps the improved CDIR when a patch is accepted', async () => {
    const opts = baseOptions((n) => 0.5 + 0.05 * n, { maxPasses: 2 });
    const result = await runRepairLoop(opts);
    const layer = (result.cdir.pages[0] as any).layers[0];
    expect(layer.bounds.x).toBe(12); // snapped by the accepted patch
  });
});
