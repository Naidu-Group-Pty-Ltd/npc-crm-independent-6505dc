/**
 * pdf-import-diagnostics-v2 pure builders (Path-to-100 v2 · C8).
 *
 * Pins the compact list row, the heavy detail view-model, and — most importantly
 * — the failed-page categorization: infra failure / unscored / manual review /
 * missing artifacts are DISTINCT sources and are never collapsed, so an operator
 * can tell an infrastructure failure apart from a low-confidence reconstruction.
 */
import { describe, it, expect } from 'vitest';
import {
  buildDiagnosticsListRow,
  buildDiagnosticsDetail,
  categorizeFailedPages,
  computeOcrRatio,
  computeMissingArtifactPages,
  formatPageRanges,
  expandChunkRanges,
  pageNumberFromDecisionId,
  PDF_IMPORT_DIAGNOSTICS_V2_VERSION,
  type DiagnosticsRawJob,
  type DiagnosticsGateSummary,
} from '../ingestion/diagnostics/pdfImportDiagnosticsV2';

function job(overrides: Partial<DiagnosticsRawJob> = {}): DiagnosticsRawJob {
  return {
    id: 'job-1',
    user_id: 'user-1',
    template_id: 'tpl-1',
    template_import_id: 'imp-1',
    source_file_name: 'report.pdf',
    source_file_hash: 'sha256:abcdef0123456789ffff',
    engine: 'docling',
    engine_version: 'docling-2',
    mode: 'hybrid',
    service_class: 'default',
    status: 'succeeded',
    page_count: 10,
    chunked: true,
    chunks_total: 2,
    chunks_completed: 2,
    chunks_failed: 0,
    duration_ms: 42000,
    cloud_run_ms: 30000,
    ssim_score: 0.88,
    diagnostics_path: 'job-1/diagnostics.json',
    created_at: '2026-07-16T00:00:00.000Z',
    result_payload: {
      summary: { text_chars: 1000, ocr_chars: 250, table_count: 3, avg_text_confidence: 0.9 },
      rasters_manifest_path: 'job-1/rasters-manifest.json',
      page_raster_paths: ['job-1/pages/page-001.png'],
      per_page_docling_manifest_path: 'imp-1/pages-manifest.json',
    },
    plan_payload: { requested_mode: 'hybrid', dispatch_effective_mode: 'hybrid', selected_lane: 'text-native' },
    ...overrides,
  };
}

function gate(overrides: Partial<DiagnosticsGateSummary> = {}): DiagnosticsGateSummary {
  return {
    ran: true,
    finalScore: 0.82,
    overallScore: 0.78,
    coverage: 'complete',
    qualityCoverage: 'docling_source',
    repairPassesApplied: 1,
    manualReviewRequired: true,
    pagesNative: 7,
    pagesHybridFallback: 2,
    pagesPixelFallback: 1,
    pagesFallbackUnavailable: 0,
    pagesScored: 10,
    pagesUnscored: [],
    pagesNeedingReview: 3,
    pageCount: 10,
    perPage: [
      { pageNumber: 1, score: 0.95, recommendedAction: 'accept' },
      { pageNumber: 2, score: 0.4, recommendedAction: 'manual_review' },
    ],
    pageDecisions: {
      'docling-page-1': { finalMode: 'semantic', outputStrategy: 'native', decision: { action: 'keep_native', score: 0.95 } },
      'docling-page-3': { finalMode: 'pixel-perfect', outputStrategy: 'raster-only', decision: { action: 'fallback_unavailable', score: 0.3 } },
    },
    ...overrides,
  };
}

describe('helpers', () => {
  it('computeOcrRatio = ocr_chars / text_chars, null when text is 0/missing', () => {
    expect(computeOcrRatio({ text_chars: 1000, ocr_chars: 250 })).toBe(0.25);
    expect(computeOcrRatio({ text_chars: 0, ocr_chars: 5 })).toBeNull();
    expect(computeOcrRatio({ ocr_chars: 5 })).toBeNull();
    expect(computeOcrRatio(null)).toBeNull();
  });

  it('formatPageRanges compresses sorted pages into compact ranges', () => {
    expect(formatPageRanges([1, 2, 3, 5, 8, 9])).toBe('1-3, 5, 8-9');
    expect(formatPageRanges([4, 4, 2, 1, 3])).toBe('1-4');
    expect(formatPageRanges([])).toBe('');
  });

  it('expandChunkRanges expands and dedupes inclusive ranges', () => {
    expect(expandChunkRanges([{ page_start: 1, page_end: 3 }, { page_start: 3, page_end: 4 }])).toEqual([1, 2, 3, 4]);
    expect(expandChunkRanges([{ page_start: 5 }])).toEqual([5]);
  });

  it('pageNumberFromDecisionId reads the trailing page number', () => {
    expect(pageNumberFromDecisionId('docling-page-12')).toBe(12);
    expect(pageNumberFromDecisionId('page-3')).toBe(3);
    expect(pageNumberFromDecisionId('cover')).toBeNull();
  });
});

describe('buildDiagnosticsListRow', () => {
  it('correlates job ↔ import ↔ template and surfaces modes/lane/service-class', () => {
    const row = buildDiagnosticsListRow(job(), gate());
    expect(row.jobId).toBe('job-1');
    expect(row.importId).toBe('imp-1');
    expect(row.templateId).toBe('tpl-1');
    expect(row.fileHashShort).toBe('abcdef012345');
    expect(row.requestedMode).toBe('hybrid');
    expect(row.lane).toBe('text-native');
    expect(row.serviceClass).toBe('default');
    expect(row.ocrRatio).toBe(0.25);
    expect(row.artifacts).toEqual({ diagnostics: true, rastersManifest: true, pageRasters: true, perPageManifest: true });
  });

  it('fills visual/quality columns from the gate when present', () => {
    const row = buildDiagnosticsListRow(job(), gate());
    expect(row.visualScore).toBe(0.82);
    expect(row.visualCoverage).toBe('complete');
    expect(row.repairPasses).toBe(1);
    expect(row.pagesNative).toBe(7);
    expect(row.pagesHybridFallback).toBe(2);
    expect(row.pagesPixelFallback).toBe(1);
    expect(row.manualReviewRequired).toBe(true);
  });

  it('falls back to ssim and leaves gate columns null without a gate summary', () => {
    const row = buildDiagnosticsListRow(job());
    expect(row.visualScore).toBe(0.88); // ssim_score
    expect(row.visualCoverage).toBeNull();
    expect(row.repairPasses).toBeNull();
    expect(row.pagesNative).toBeNull();
    expect(row.manualReviewRequired).toBeNull();
  });

  it('summarizes failed chunk counts when no ranges are supplied', () => {
    expect(buildDiagnosticsListRow(job({ chunks_failed: 2 })).failedLeafRanges).toBe('2 chunks');
    expect(buildDiagnosticsListRow(job({ chunks_failed: 0 })).failedLeafRanges).toBeNull();
  });

  it('surfaces REAL failed page ranges when the failed chunk rows are supplied', () => {
    const row = buildDiagnosticsListRow(
      job({ chunks_failed: 2 }),
      undefined,
      [{ page_start: 6, page_end: 10 }, { page_start: 21, page_end: 21 }],
    );
    expect(row.failedLeafRanges).toBe('6-10, 21'); // real ranges, not "2 chunks"
  });

  it('falls back to the count when the supplied ranges are empty', () => {
    expect(buildDiagnosticsListRow(job({ chunks_failed: 3 }), undefined, []).failedLeafRanges).toBe('3 chunks');
  });
});

describe('categorizeFailedPages — distinct sources, never collapsed', () => {
  it('keeps infra / unscored / manual-review / missing-artifacts separate', () => {
    const res = categorizeFailedPages({
      jobStatus: 'succeeded',
      pageCount: 10,
      gate: gate({ pagesUnscored: [8, 9] }),
      failedChunkRanges: [{ page_start: 5, page_end: 6 }],
      missingArtifactPages: [9, 10],
    });
    expect(res.infra_failure).toEqual([5, 6]);
    expect(res.unscored).toEqual([8, 9]);
    // manual_review: page 2 (perPage manual_review) + page 3 (decision fallback_unavailable).
    expect(res.manual_review).toEqual([2, 3]);
    expect(res.missing_artifacts).toEqual([9, 10]);
    // Page 9 appears in BOTH unscored and missing_artifacts — not collapsed.
    expect(res.unscored).toContain(9);
    expect(res.missing_artifacts).toContain(9);
  });

  it('attributes a monolithic failure with no chunk detail to every page as infra', () => {
    const res = categorizeFailedPages({ jobStatus: 'failed', pageCount: 3 });
    expect(res.infra_failure).toEqual([1, 2, 3]);
    expect(res.unscored).toEqual([]);
  });

  it('derives manual review from both per-page verdicts and per-page decisions', () => {
    const res = categorizeFailedPages({
      jobStatus: 'succeeded',
      gate: gate({
        perPage: [{ pageNumber: 4, recommendedAction: 'repair' }],
        pageDecisions: { 'docling-page-6': { decision: { action: 'native_review' } } },
      }),
    });
    expect(res.manual_review).toEqual([4, 6]);
  });

  it('is empty for a clean succeeded job with full coverage', () => {
    const res = categorizeFailedPages({
      jobStatus: 'succeeded',
      pageCount: 2,
      gate: gate({ pagesUnscored: [], perPage: [{ pageNumber: 1, recommendedAction: 'accept' }], pageDecisions: {} }),
    });
    expect(res.infra_failure).toEqual([]);
    expect(res.unscored).toEqual([]);
    expect(res.manual_review).toEqual([]);
    expect(res.missing_artifacts).toEqual([]);
  });
});

describe('buildDiagnosticsDetail', () => {
  it('assembles correlation, quality, failed-page counts, chunks and per-page rows', () => {
    const detail = buildDiagnosticsDetail({
      job: job(),
      gate: gate({ pagesUnscored: [8] }),
      chunks: [
        { page_start: 1, page_end: 5, status: 'succeeded', attempts: 1, mode: 'hybrid', lane: 'text-native' },
        { page_start: 6, page_end: 10, status: 'failed', attempts: 2, mode: 'hybrid', lane: 'text-native' },
      ],
      missingArtifactPages: [10],
    });
    expect(detail.version).toBe(PDF_IMPORT_DIAGNOSTICS_V2_VERSION);
    expect(detail.correlation).toMatchObject({ jobId: 'job-1', importId: 'imp-1', templateId: 'tpl-1' });
    expect(detail.quality.finalScore).toBe(0.82);
    expect(detail.quality.coverage).toBe('complete');
    expect(detail.quality.pagesPixelFallback).toBe(1);
    // Failed pages: infra 6-10, unscored 8, manual 2+3, missing 10.
    expect(detail.failedPages.infra_failure).toEqual([6, 7, 8, 9, 10]);
    expect(detail.failedPageCounts).toEqual({ infra_failure: 5, unscored: 1, manual_review: 2, missing_artifacts: 1 });
    // Chunk range formatting.
    expect(detail.chunks[0].range).toBe('1-5');
    expect(detail.chunks[1].status).toBe('failed');
    // Per-page merges verdict score + decision output strategy.
    const p1 = detail.perPage.find((p) => p.pageNumber === 1)!;
    expect(p1.score).toBe(0.95);
    expect(p1.outputStrategy).toBe('native');
    const p3 = detail.perPage.find((p) => p.pageNumber === 3)!;
    expect(p3.outputStrategy).toBe('raster-only');
    expect(p3.action).toBe('fallback_unavailable');
  });

  it('surfaces an error and works without a gate (raw job only)', () => {
    const detail = buildDiagnosticsDetail({ job: job({ status: 'failed', error_code: 'sidecar_timeout', error_text: 'Cloud Run 504' }) });
    expect(detail.error).toEqual({ code: 'sidecar_timeout', text: 'Cloud Run 504' });
    expect(detail.quality.finalScore).toBe(0.88); // ssim fallback
    expect(detail.failedPages.infra_failure).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(detail.perPage).toEqual([]);
  });
});

// C8 fix — missing per-page artifacts come from per-page-manifest coverage, not
// raster count (the old heuristic flagged every page of a raster-free semantic
// import as "missing artifacts").
describe('computeMissingArtifactPages', () => {
  it('returns [] when per-page coverage is unknown (legacy job) — never fabricates', () => {
    expect(computeMissingArtifactPages({ pageCount: 10, perPageDoclingPageCount: null })).toEqual([]);
    expect(computeMissingArtifactPages({ pageCount: 10, perPageDoclingPageCount: undefined })).toEqual([]);
  });

  it('returns [] when coverage meets or exceeds the page count', () => {
    expect(computeMissingArtifactPages({ pageCount: 10, perPageDoclingPageCount: 10 })).toEqual([]);
    expect(computeMissingArtifactPages({ pageCount: 10, perPageDoclingPageCount: 12 })).toEqual([]);
  });

  it('returns the trailing uncovered pages when coverage is partial', () => {
    expect(computeMissingArtifactPages({ pageCount: 10, perPageDoclingPageCount: 7 })).toEqual([8, 9, 10]);
    expect(computeMissingArtifactPages({ pageCount: 3, perPageDoclingPageCount: 0 })).toEqual([1, 2, 3]);
  });

  it('returns [] for non-positive / missing page counts', () => {
    expect(computeMissingArtifactPages({ pageCount: 0, perPageDoclingPageCount: 0 })).toEqual([]);
    expect(computeMissingArtifactPages({ pageCount: null, perPageDoclingPageCount: 5 })).toEqual([]);
  });
});

describe('buildDiagnosticsDetail — missing-artifacts uses per-page coverage', () => {
  it('does NOT flag pages of a raster-free semantic import as missing artifacts', () => {
    // 10-page semantic import: no rasters, but full per-page docling coverage.
    const detail = buildDiagnosticsDetail({
      job: job({
        mode: 'semantic',
        result_payload: {
          summary: { text_chars: 1000 },
          page_raster_paths: [], // semantic → no rasters
          per_page_docling_page_count: 10, // every page HAS docling/blocks
        },
      }),
      // Even if the edge still sent the old raster-based value, coverage wins:
      missingArtifactPages: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    });
    expect(detail.failedPages.missing_artifacts).toEqual([]);
    expect(detail.failedPageCounts.missing_artifacts).toBe(0);
  });

  it('flags only the genuinely-uncovered trailing pages', () => {
    const detail = buildDiagnosticsDetail({
      job: job({ page_count: 10, result_payload: { page_raster_paths: [], per_page_docling_page_count: 8 } }),
    });
    expect(detail.failedPages.missing_artifacts).toEqual([9, 10]);
  });

  it('falls back to the supplied value for a legacy job with no coverage signal', () => {
    const detail = buildDiagnosticsDetail({
      job: job({ result_payload: { page_raster_paths: ['job-1/pages/page-001.png'] } }), // no per_page_docling_page_count
      missingArtifactPages: [10],
    });
    expect(detail.failedPages.missing_artifacts).toEqual([10]);
  });
});
