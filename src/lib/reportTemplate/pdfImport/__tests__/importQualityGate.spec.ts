import { describe, expect, it, vi } from 'vitest';
import {
  runImportQualityGate,
  recommendFinalMode,
  DEFAULT_QUALITY_GATE_MAX_PAGES,
} from '../importQualityGate';
import type { ReportTemplate } from '../../templateSchema';
import type { CdirDocument } from '../../ingestion/cdir';
import type { DoclingRasterByPage } from '../docling/doclingTypes';

function fakeImageData(): ImageData {
  return { data: new Uint8ClampedArray(4), width: 1, height: 1, colorSpace: 'srgb' } as unknown as ImageData;
}

function makeCdir(pageCount: number): CdirDocument {
  return {
    version: 1,
    source: { kind: 'pdf', checksum: 'sha256:test', filename: 'test.pdf' },
    pages: Array.from({ length: pageCount }, (_, i) => ({
      id: `docling-page-${i + 1}`,
      label: `Page ${i + 1}`,
      width: 595,
      height: 842,
      layers: [],
    })),
  } as unknown as CdirDocument;
}

function makeTemplate(pageCount: number): ReportTemplate {
  return {
    version: 1,
    tokens: { colors: {}, fonts: {}, spacing: {} },
    pages: Array.from({ length: pageCount }, (_, i) => ({
      id: `docling-page-${i + 1}`,
      name: `Page ${i + 1}`,
      size: { width: 595, height: 842 },
      background: {},
      blocks: [],
    })),
  } as unknown as ReportTemplate;
}

function makeRasters(pageCount: number): DoclingRasterByPage {
  const out: DoclingRasterByPage = {};
  for (let i = 1; i <= pageCount; i += 1) {
    out[i] = { width: 1190, height: 1684, dataUrl: `data:image/png;base64,PAGE${i}` };
  }
  return out;
}

/** Minimal fake of runVisualRepairOrchestrationPipeline output. */
function makeOrchestrationResult(opts: {
  template: ReportTemplate;
  visualQaScore: number;
  finalScore: number;
  totalApplied: number;
  passesAttempted: number;
  requiresManualReview?: boolean;
  pages?: Array<{ pageNumber: number; overallScore: number; recommendedAction: string; warnings?: unknown[] }>;
}): any {
  return {
    summary: {
      visualQaScore: opts.visualQaScore,
      finalScore: opts.finalScore,
      scoreDelta: opts.finalScore - opts.visualQaScore,
      repairStatus: 'completed',
      passesAttempted: opts.passesAttempted,
      totalApplied: opts.totalApplied,
      requiresManualReview: Boolean(opts.requiresManualReview),
    },
    repair: {
      finalReport: {
        manualReviewRequired: Boolean(opts.requiresManualReview),
        pages: opts.pages ?? [],
      },
    },
    draft: { template: opts.template },
  };
}

describe('recommendFinalMode', () => {
  it('never changes pixel-perfect', () => {
    expect(recommendFinalMode('pixel-perfect', 0.1)).toBe('pixel-perfect');
    expect(recommendFinalMode('pixel-perfect', 0.99)).toBe('pixel-perfect');
  });

  it('keeps the requested mode when the score is healthy', () => {
    expect(recommendFinalMode('semantic', 0.95)).toBe('semantic');
    expect(recommendFinalMode('hybrid', 0.82)).toBe('hybrid');
  });

  it('nudges a weak semantic import to hybrid (keep the source raster)', () => {
    expect(recommendFinalMode('semantic', 0.6)).toBe('hybrid');
  });

  it('falls back to pixel-perfect below the hybrid floor', () => {
    expect(recommendFinalMode('semantic', 0.4)).toBe('pixel-perfect');
    expect(recommendFinalMode('hybrid', 0.4)).toBe('pixel-perfect');
  });

  it('returns the requested mode when score is unknown', () => {
    expect(recommendFinalMode('hybrid', null)).toBe('hybrid');
  });
});

describe('runImportQualityGate', () => {
  const baseInjectables = {
    imageUrlToImageDataImpl: vi.fn(async () => fakeImageData()),
  };

  it('skips cleanly when there are no source rasters', async () => {
    const res = await runImportQualityGate({
      importId: 'imp-1',
      template: makeTemplate(2),
      cdir: makeCdir(2),
      requestedMode: 'hybrid',
      rastersByPage: {},
      ...baseInjectables,
    });
    expect(res.summary.ran).toBe(false);
    expect(res.summary.skippedReason).toBe('no_source_rasters');
    expect(res.recommendedFinalMode).toBe('hybrid');
    expect(res.manualReviewRequired).toBe(false);
  });

  it('skips a document above the default page-count ceiling', async () => {
    const pageCount = DEFAULT_QUALITY_GATE_MAX_PAGES + 5; // 45
    const runOrchestrationImpl = vi.fn(async (opts: any) => {
      const batchPages: number[] = opts.captureOptions?.pageNumbers ?? [];
      return makeOrchestrationResult({
        template: opts.loaded.draft.template,
        visualQaScore: 0.9,
        finalScore: 0.9,
        totalApplied: 0,
        passesAttempted: 1,
        pages: batchPages.map((n) => ({ pageNumber: n, overallScore: 0.9, recommendedAction: 'accept', warnings: [] })),
      });
    });
    const res = await runImportQualityGate({
      importId: 'imp-big',
      template: makeTemplate(pageCount),
      cdir: makeCdir(pageCount),
      requestedMode: 'hybrid',
      rastersByPage: makeRasters(pageCount),
      batchSize: 10,
      runOrchestrationImpl,
      ...baseInjectables,
    });
    expect(res.summary.ran).toBe(false);
    expect(res.summary.skippedReason).toBe('page_count_exceeds_gate_limit');
    expect(res.summary.pageCount).toBe(pageCount);
    expect(runOrchestrationImpl).not.toHaveBeenCalled();
  });

  it('honors a configured ceiling while retaining bounded batching within it', async () => {
    const pageCount = DEFAULT_QUALITY_GATE_MAX_PAGES + 5; // 45
    const runOrchestrationImpl = vi.fn(async (opts: any) => {
      const batchPages: number[] = opts.captureOptions?.pageNumbers ?? [];
      return makeOrchestrationResult({
        template: opts.loaded.draft.template,
        visualQaScore: 0.9,
        finalScore: 0.9,
        totalApplied: 0,
        passesAttempted: 1,
        pages: batchPages.map((n) => ({ pageNumber: n, overallScore: 0.9, recommendedAction: 'accept', warnings: [] })),
      });
    });
    const res = await runImportQualityGate({
      importId: 'imp-big-configured',
      template: makeTemplate(pageCount),
      cdir: makeCdir(pageCount),
      requestedMode: 'hybrid',
      rastersByPage: makeRasters(pageCount),
      maxPages: pageCount,
      batchSize: 10,
      runOrchestrationImpl,
      ...baseInjectables,
    });
    expect(res.summary.ran).toBe(true);
    expect(res.summary.coverage).toBe('complete');
    expect(res.summary.pagesScored).toBe(pageCount);
    expect(res.summary.pagesUnscored).toEqual([]);
    expect(res.summary.perPage).toHaveLength(pageCount);
    // ceil(45 / 10) = 5 bounded batches, not one 45-page capture.
    expect(runOrchestrationImpl).toHaveBeenCalledTimes(5);
  });

  it('runs the orchestration and reports the verdict (healthy score keeps mode)', async () => {
    const repaired = makeTemplate(2);
    const runOrchestrationImpl = vi.fn(async () =>
      makeOrchestrationResult({
        template: repaired,
        visualQaScore: 0.9,
        finalScore: 0.94,
        totalApplied: 0,
        passesAttempted: 1,
        pages: [
          { pageNumber: 1, overallScore: 0.95, recommendedAction: 'accept', warnings: [] },
          { pageNumber: 2, overallScore: 0.93, recommendedAction: 'accept', warnings: [] },
        ],
      }),
    );
    const res = await runImportQualityGate({
      importId: 'imp-2',
      template: makeTemplate(2),
      cdir: makeCdir(2),
      requestedMode: 'hybrid',
      rastersByPage: makeRasters(2),
      runOrchestrationImpl,
      ...baseInjectables,
    });
    expect(runOrchestrationImpl).toHaveBeenCalledOnce();
    expect(res.summary.ran).toBe(true);
    expect(res.summary.finalScore).toBe(0.94);
    expect(res.recommendedFinalMode).toBe('hybrid');
    expect(res.manualReviewRequired).toBe(false);
    expect(res.summary.perPage).toHaveLength(2);
    // C6: healthy pages get an applied native output policy (not a fallback).
    expect(res.summary.pagesNative).toBe(2);
    expect(res.summary.pageDecisions['docling-page-1']?.outputStrategy).toBe('native');
    expect((res.template.pages[0].meta as { pdfImport?: { outputStrategy: string } })?.pdfImport?.outputStrategy).toBe('native');
    expect(res.summary.templateChanged).toBe(true);
  });

  it('flags manual review and recommends pixel fallback on a weak final score', async () => {
    const runOrchestrationImpl = vi.fn(async () =>
      makeOrchestrationResult({
        template: makeTemplate(1),
        visualQaScore: 0.35,
        finalScore: 0.4,
        totalApplied: 1,
        passesAttempted: 2,
        pages: [{ pageNumber: 1, overallScore: 0.4, recommendedAction: 'fallback_to_pixel', warnings: [{}] }],
      }),
    );
    const res = await runImportQualityGate({
      importId: 'imp-3',
      template: makeTemplate(1),
      cdir: makeCdir(1),
      requestedMode: 'hybrid',
      rastersByPage: makeRasters(1),
      runOrchestrationImpl,
      ...baseInjectables,
    });
    expect(res.summary.ran).toBe(true);
    expect(res.manualReviewRequired).toBe(true);
    expect(res.recommendedFinalMode).toBe('pixel-perfect');
    expect(res.summary.pagesNeedingReview).toBe(1);
    expect(res.summary.warningCount).toBe(1);
    expect(res.summary.pagesPixelFallback).toBe(1);
    expect((res.template.pages[0].meta as any)?.pdfImport?.outputStrategy).toBe('raster-only');
    expect(res.template.pages[0].background).toMatchObject({
      imageUrl: 'data:image/png;base64,PAGE1',
      opacity: 1,
      imageFit: 'fill',
      underlay: false,
    });
  });

  it('is fail-open: a failing batch keeps the original template and requires review (C4)', async () => {
    const original = makeTemplate(2);
    const runOrchestrationImpl = vi.fn(async () => {
      throw new Error('html2canvas exploded');
    });
    const res = await runImportQualityGate({
      importId: 'imp-4',
      template: original,
      cdir: makeCdir(2),
      requestedMode: 'semantic',
      rastersByPage: makeRasters(2),
      runOrchestrationImpl,
      ...baseInjectables,
    });
    // No batch completed -> not passed, not bricked: original template, review.
    expect(res.summary.ran).toBe(false);
    expect(res.summary.skippedReason).toBe('visual_qa_no_batches_completed');
    expect(res.summary.coverage).toBe('none');
    expect(res.summary.error).toContain('html2canvas exploded');
    expect(res.template).toBe(original);
    expect(res.recommendedFinalMode).toBe('semantic');
    expect(res.manualReviewRequired).toBe(true);
  });
});
