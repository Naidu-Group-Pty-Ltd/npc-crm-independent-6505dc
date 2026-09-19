/**
 * pdf-import-diagnostics-v2 (Path-to-100 v2 · C8).
 *
 * Pure view-model builders for the superadmin PDF-import diagnostics surface:
 *   - `buildDiagnosticsListRow`  → a compact, correlated list row (job ↔ import
 *      ↔ template, modes/lane/service-class, chunk + page counts, OCR ratio,
 *      status, elapsed, visual score/coverage, repair + native/hybrid/pixel
 *      counts, failed leaf ranges, error code, artifact flags).
 *   - `buildDiagnosticsDetail`   → the heavy per-job drill-down (correlation,
 *      timings, page coverage, quality, per-category failed pages, chunk
 *      breakdown, artifacts).
 *   - `categorizeFailedPages`    → failed pages derived from DISTINCT sources
 *      (infra failure vs unscored vs manual-review vs missing artifacts) and
 *      NEVER collapsed into one bucket — a page may appear in several.
 *
 * Pure and deterministic: the edge function is a thin superadmin-mediated data
 * layer that returns raw rows; all shaping + categorization happens here (and is
 * unit-tested) so the UI and the contract can't silently drift.
 */

export const PDF_IMPORT_DIAGNOSTICS_V2_VERSION = 'pdf-import-diagnostics-v2';

// ─── Raw inputs (subsets of the rows the edge function returns) ───────────────

export interface DiagnosticsJobSummaryPayload {
  text_chars?: number;
  ocr_chars?: number;
  table_count?: number;
  avg_text_confidence?: number | null;
}

export interface DiagnosticsResultPayload {
  summary?: DiagnosticsJobSummaryPayload | null;
  rasters_manifest_path?: string | null;
  page_raster_paths?: string[] | null;
  per_page_docling_manifest_path?: string | null;
  /** Count of pages that actually have per-page source artifacts (docling/blocks). */
  per_page_docling_page_count?: number | null;
  artifact_contract_version?: string | null;
  selected_lane?: string | null;
}

export interface DiagnosticsPlanPayload {
  selected_lane?: string | null;
  requested_mode?: string | null;
  dispatch_effective_mode?: string | null;
  service_class?: string | null;
  /** C11 — sidecar plan wall time, when the planner reported it. */
  plan_ms?: number | null;
}

export interface DiagnosticsRawJob {
  id: string;
  user_id?: string | null;
  template_id?: string | null;
  template_import_id?: string | null;
  source_file_name?: string | null;
  source_file_hash?: string | null;
  engine?: string | null;
  engine_version?: string | null;
  mode?: string | null;
  service_class?: string | null;
  status: string;
  stage?: string | null;
  page_count?: number | null;
  chunked?: boolean | null;
  chunks_total?: number | null;
  chunks_completed?: number | null;
  chunks_failed?: number | null;
  duration_ms?: number | null;
  cloud_run_ms?: number | null;
  ssim_score?: number | null;
  error_code?: string | null;
  error_text?: string | null;
  diagnostics_path?: string | null;
  created_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  result_payload?: DiagnosticsResultPayload | null;
  plan_payload?: DiagnosticsPlanPayload | null;
  // C11 — sidecar operational-metrics envelope + cache-hit provenance.
  operational_metrics?: unknown;
  cache_hit?: boolean | null;
  cache_source_job_id?: string | null;
}

/** Subset of the C3-C6 quality-gate summary staged into `template_imports.meta`. */
export interface DiagnosticsGateSummary {
  ran?: boolean;
  skippedReason?: string;
  finalScore?: number | null;
  overallScore?: number | null;
  coverage?: string;
  qualityCoverage?: string;
  repairPassesApplied?: number;
  manualReviewRequired?: boolean;
  pagesNative?: number;
  pagesHybridFallback?: number;
  pagesPixelFallback?: number;
  pagesFallbackUnavailable?: number;
  pagesScored?: number;
  pagesUnscored?: number[];
  pagesNeedingReview?: number;
  pageCount?: number;
  perPage?: Array<{ pageNumber: number; score?: number | null; recommendedAction?: string }>;
  pageDecisions?: Record<string, { finalMode?: string; outputStrategy?: string; decision?: { action?: string; reason?: string; score?: number | null } }>;
  /** E0 critical-visual-containment-v1 audit (subset), when the gate recorded it. */
  criticalContainment?: {
    version?: string;
    ran?: boolean;
    nativeSuppressed?: boolean;
    criticalPageCount?: number;
    criticalDefectCount?: number;
    pagesForcedHybrid?: number;
    pagesForcedPixel?: number;
    pagesBlockedNoRaster?: number;
    perPage?: Array<{ pageNumber?: number; action?: string; reason?: string; contentKinds?: string[]; sourceRasterAvailable?: boolean; manualReviewRequired?: boolean; defects?: Array<{ code?: string }> }>;
  };
}

export interface DiagnosticsChunkRow {
  id?: string;
  page_start?: number | null;
  page_end?: number | null;
  status?: string | null;
  attempts?: number | null;
  mode?: string | null;
  lane?: string | null;
}

// ─── Output shapes ────────────────────────────────────────────────────────────

export interface DiagnosticsArtifactFlags {
  diagnostics: boolean;
  rastersManifest: boolean;
  pageRasters: boolean;
  perPageManifest: boolean;
}

export interface DiagnosticsListRow {
  jobId: string;
  importId: string | null;
  templateId: string | null;
  userId: string | null;
  filename: string | null;
  fileHashShort: string | null;
  engine: string | null;
  engineVersion: string | null;
  requestedMode: string | null;
  effectiveMode: string | null;
  lane: string | null;
  serviceClass: string | null;
  status: string;
  stage: string | null;
  pageCount: number | null;
  chunked: boolean;
  chunksTotal: number | null;
  chunksCompleted: number | null;
  chunksFailed: number | null;
  ocrRatio: number | null;
  elapsedMs: number | null;
  cloudRunMs: number | null;
  visualScore: number | null;
  visualCoverage: string | null;
  repairPasses: number | null;
  pagesNative: number | null;
  pagesHybridFallback: number | null;
  pagesPixelFallback: number | null;
  failedLeafRanges: string | null;
  errorCode: string | null;
  manualReviewRequired: boolean | null;
  artifacts: DiagnosticsArtifactFlags;
  createdAt: string | null;
}

export type FailedPageCategory = 'infra_failure' | 'unscored' | 'manual_review' | 'missing_artifacts';

export interface FailedPagesByCategory {
  infra_failure: number[];
  unscored: number[];
  manual_review: number[];
  missing_artifacts: number[];
}

export interface DiagnosticsDetailChunk {
  range: string;
  pageStart: number | null;
  pageEnd: number | null;
  status: string | null;
  attempts: number | null;
  mode: string | null;
  lane: string | null;
}

export interface DiagnosticsDetailPage {
  pageNumber: number;
  score: number | null;
  action: string | null;
  outputStrategy: string | null;
}

export interface DiagnosticsDetail {
  version: typeof PDF_IMPORT_DIAGNOSTICS_V2_VERSION;
  correlation: {
    jobId: string;
    importId: string | null;
    templateId: string | null;
    fileHash: string | null;
    filename: string | null;
  };
  status: string;
  modes: { requested: string | null; effective: string | null; lane: string | null; serviceClass: string | null };
  timings: { elapsedMs: number | null; cloudRunMs: number | null };
  pages: { total: number | null; scored: number | null; unscored: number; needingReview: number | null };
  quality: {
    finalScore: number | null;
    overallScore: number | null;
    coverage: string | null;
    qualityCoverage: string | null;
    repairPasses: number | null;
    manualReviewRequired: boolean | null;
    pagesNative: number | null;
    pagesHybridFallback: number | null;
    pagesPixelFallback: number | null;
    pagesFallbackUnavailable: number | null;
  };
  failedPages: FailedPagesByCategory;
  failedPageCounts: Record<FailedPageCategory, number>;
  chunks: DiagnosticsDetailChunk[];
  perPage: DiagnosticsDetailPage[];
  artifacts: DiagnosticsArtifactFlags;
  signedUrls: Record<string, string>;
  error: { code: string | null; text: string | null } | null;
  /** E0 critical-visual-containment-v1 rollup (null when the gate did not record it). */
  containment: {
    version: string | null;
    nativeSuppressed: boolean;
    criticalPageCount: number;
    pagesForcedHybrid: number;
    pagesForcedPixel: number;
    pagesBlockedNoRaster: number;
    pages: Array<{ pageNumber: number | null; action: string | null; reason: string | null; contentKinds: string[]; sourceRasterAvailable: boolean; defectCodes: string[] }>;
  } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function shortHash(hash: string | null | undefined): string | null {
  if (!hash) return null;
  const bare = hash.replace(/^sha256:/i, '');
  return bare.length > 12 ? bare.slice(0, 12) : bare;
}

/** OCR ratio = ocr_chars / text_chars from the parse summary (0..1+), or null. */
export function computeOcrRatio(summary: DiagnosticsJobSummaryPayload | null | undefined): number | null {
  const text = finite(summary?.text_chars);
  const ocr = finite(summary?.ocr_chars);
  if (text === null || ocr === null || text <= 0) return null;
  return ocr / text;
}

function artifactFlags(job: DiagnosticsRawJob): DiagnosticsArtifactFlags {
  const rp = job.result_payload ?? null;
  return {
    diagnostics: Boolean(job.diagnostics_path),
    rastersManifest: Boolean(rp?.rasters_manifest_path),
    pageRasters: Array.isArray(rp?.page_raster_paths) && (rp?.page_raster_paths?.length ?? 0) > 0,
    perPageManifest: Boolean(rp?.per_page_docling_manifest_path),
  };
}

/** `docling-page-12` / `page-3` / `12` → 12; otherwise null. */
export function pageNumberFromDecisionId(id: string): number | null {
  const match = /(\d+)\s*$/.exec(id);
  return match ? Number(match[1]) : null;
}

function uniqueSortedPages(pages: Array<number | null | undefined>): number[] {
  const set = new Set<number>();
  for (const p of pages) {
    if (typeof p === 'number' && Number.isFinite(p) && p > 0) set.add(Math.trunc(p));
  }
  return [...set].sort((a, b) => a - b);
}

/** Expand a list of {page_start,page_end} ranges into individual page numbers. */
export function expandChunkRanges(ranges: Array<{ page_start?: number | null; page_end?: number | null }>): number[] {
  const pages: number[] = [];
  for (const range of ranges) {
    const start = finite(range.page_start);
    const end = finite(range.page_end);
    if (start === null) continue;
    const last = end === null ? start : end;
    for (let p = start; p <= last; p += 1) pages.push(p);
  }
  return uniqueSortedPages(pages);
}

/**
 * Pages that are genuinely missing their per-page SOURCE artifacts.
 *
 * C8 fix — the earlier heuristic derived this from `page_raster_paths.length`,
 * which wrongly flagged EVERY page of a semantic-mode import (which produces no
 * rasters) — and of any job that wrote a single `rasters.json` rather than
 * per-page rasters — as "missing artifacts". Per-page source artifacts
 * (docling/blocks) exist for every parsed page regardless of raster mode, so the
 * authoritative coverage signal is `per_page_docling_page_count`, not rasters.
 *
 * Contract:
 *  - `perPageDoclingPageCount` null/undefined → coverage is UNKNOWN (a legacy job
 *    that never recorded it): return `[]` rather than fabricate missing pages.
 *  - coverage ≥ page count → nothing missing.
 *  - coverage < page count → the trailing `[coverage+1 … pageCount]` pages
 *    (per-page artifacts are written sequentially from page 1) are missing.
 */
export function computeMissingArtifactPages(args: {
  pageCount?: number | null;
  perPageDoclingPageCount?: number | null;
}): number[] {
  const total = finite(args.pageCount);
  if (total === null || total <= 0) return [];
  const covered = finite(args.perPageDoclingPageCount);
  if (covered === null) return []; // unknown coverage → never fabricate
  if (covered >= total) return [];
  const pages: number[] = [];
  for (let p = Math.max(0, covered) + 1; p <= total; p += 1) pages.push(p);
  return uniqueSortedPages(pages);
}

/** Compress a sorted page list into a compact "1-5, 8, 11-12" range string. */
export function formatPageRanges(pages: number[]): string {
  const sorted = uniqueSortedPages(pages);
  if (sorted.length === 0) return '';
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i += 1) {
    const current = sorted[i];
    if (current === prev + 1) {
      prev = current;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = current;
    prev = current;
  }
  return parts.join(', ');
}

// ─── Failed-page categorization (distinct sources, never collapsed) ───────────

export interface CategorizeFailedPagesInput {
  jobStatus?: string;
  pageCount?: number | null;
  gate?: DiagnosticsGateSummary | null;
  /** Failed chunk page ranges (from pdf_import_chunks where status='failed'). */
  failedChunkRanges?: Array<{ page_start?: number | null; page_end?: number | null }>;
  /** Pages expected to have per-page artifacts but missing them (edge-computed). */
  missingArtifactPages?: number[];
}

/**
 * Derive failed pages from four DISTINCT sources. A page can legitimately belong
 * to more than one bucket (e.g. unscored AND missing artifacts) — the buckets
 * are never merged, so the operator can tell an infrastructure failure apart
 * from a low-confidence reconstruction apart from a missing artifact.
 */
export function categorizeFailedPages(input: CategorizeFailedPagesInput): FailedPagesByCategory {
  const gate = input.gate ?? null;

  // Infrastructure failures — failed chunk leaf ranges. A monolithic job that
  // failed with no chunk detail attributes every known page to infra failure.
  let infra = expandChunkRanges(input.failedChunkRanges ?? []);
  if (infra.length === 0 && input.jobStatus === 'failed') {
    const total = finite(input.pageCount);
    if (total !== null && total > 0) {
      infra = uniqueSortedPages(Array.from({ length: total }, (_, i) => i + 1));
    }
  }

  const unscored = uniqueSortedPages(gate?.pagesUnscored ?? []);

  // Manual review — pages the gate flagged for review or a fallback the source
  // could not satisfy. Drawn from per-page verdicts AND per-page decisions.
  const manualReviewPages: Array<number | null> = [];
  for (const page of gate?.perPage ?? []) {
    if (page.recommendedAction === 'manual_review' || page.recommendedAction === 'repair') {
      manualReviewPages.push(page.pageNumber);
    }
  }
  for (const [id, decision] of Object.entries(gate?.pageDecisions ?? {})) {
    const action = decision?.decision?.action ?? '';
    if (action === 'native_review' || action === 'fallback_unavailable') {
      manualReviewPages.push(pageNumberFromDecisionId(id));
    }
  }

  const missing = uniqueSortedPages(input.missingArtifactPages ?? []);

  return {
    infra_failure: infra,
    unscored,
    manual_review: uniqueSortedPages(manualReviewPages),
    missing_artifacts: missing,
  };
}

// ─── List row ─────────────────────────────────────────────────────────────────

/**
 * Build a compact, correlated diagnostics list row. `gate` (the quality-gate
 * summary from the linked import's meta) is optional — when the edge function
 * has joined it, the visual/quality columns fill in; otherwise they are null
 * and the row still renders from job data alone.
 */
export function buildDiagnosticsListRow(
  job: DiagnosticsRawJob,
  gate?: DiagnosticsGateSummary | null,
  /** This job's failed/fatal chunk rows (batch-fetched by the edge), for real ranges. */
  failedChunkRanges?: Array<{ page_start?: number | null; page_end?: number | null }>,
): DiagnosticsListRow {
  const rp = job.result_payload ?? null;
  const plan = job.plan_payload ?? null;
  const chunksFailed = finite(job.chunks_failed);

  // C8 fix — surface the REAL failed page ranges (the plan's "failed leaf ranges"
  // column) when the caller supplies the failed chunk rows; only fall back to a
  // compact "N chunks" count when those rows aren't available (e.g. legacy list).
  const realRanges = failedChunkRanges && failedChunkRanges.length > 0
    ? formatPageRanges(expandChunkRanges(failedChunkRanges))
    : '';
  const failedLeafRanges = realRanges
    ? realRanges
    : (chunksFailed && chunksFailed > 0 ? `${chunksFailed} chunk${chunksFailed === 1 ? '' : 's'}` : null);

  return {
    jobId: job.id,
    importId: job.template_import_id ?? null,
    templateId: job.template_id ?? null,
    userId: job.user_id ?? null,
    filename: job.source_file_name ?? null,
    fileHashShort: shortHash(job.source_file_hash),
    engine: job.engine ?? null,
    engineVersion: job.engine_version ?? null,
    requestedMode: plan?.requested_mode ?? job.mode ?? null,
    effectiveMode: plan?.dispatch_effective_mode ?? job.mode ?? null,
    lane: plan?.selected_lane ?? rp?.selected_lane ?? null,
    serviceClass: job.service_class ?? plan?.service_class ?? null,
    status: job.status,
    stage: job.stage ?? null,
    pageCount: finite(job.page_count),
    chunked: Boolean(job.chunked),
    chunksTotal: finite(job.chunks_total),
    chunksCompleted: finite(job.chunks_completed),
    chunksFailed,
    ocrRatio: computeOcrRatio(rp?.summary),
    elapsedMs: finite(job.duration_ms),
    cloudRunMs: finite(job.cloud_run_ms),
    visualScore: gate?.finalScore ?? gate?.overallScore ?? finite(job.ssim_score),
    visualCoverage: gate?.coverage ?? null,
    repairPasses: gate ? finite(gate.repairPassesApplied) : null,
    pagesNative: gate ? finite(gate.pagesNative) : null,
    pagesHybridFallback: gate ? finite(gate.pagesHybridFallback) : null,
    pagesPixelFallback: gate ? finite(gate.pagesPixelFallback) : null,
    failedLeafRanges,
    errorCode: job.error_code ?? null,
    manualReviewRequired: gate ? Boolean(gate.manualReviewRequired) : null,
    artifacts: artifactFlags(job),
    createdAt: job.created_at ?? null,
  };
}

// ─── Detail ───────────────────────────────────────────────────────────────────

export interface BuildDiagnosticsDetailInput {
  job: DiagnosticsRawJob;
  importId?: string | null;
  gate?: DiagnosticsGateSummary | null;
  chunks?: DiagnosticsChunkRow[] | null;
  missingArtifactPages?: number[];
  signedUrls?: Record<string, string> | null;
}

function mergePerPage(gate: DiagnosticsGateSummary | null): DiagnosticsDetailPage[] {
  if (!gate) return [];
  const byPage = new Map<number, DiagnosticsDetailPage>();
  for (const page of gate.perPage ?? []) {
    byPage.set(page.pageNumber, {
      pageNumber: page.pageNumber,
      score: finite(page.score),
      action: page.recommendedAction ?? null,
      outputStrategy: null,
    });
  }
  for (const [id, decision] of Object.entries(gate.pageDecisions ?? {})) {
    const pageNumber = pageNumberFromDecisionId(id);
    if (pageNumber === null) continue;
    const existing = byPage.get(pageNumber) ?? { pageNumber, score: null, action: null, outputStrategy: null };
    existing.outputStrategy = decision?.outputStrategy ?? existing.outputStrategy;
    if (!existing.action && decision?.decision?.action) existing.action = decision.decision.action;
    if (existing.score === null) existing.score = finite(decision?.decision?.score);
    byPage.set(pageNumber, existing);
  }
  return [...byPage.values()].sort((a, b) => a.pageNumber - b.pageNumber);
}

export function buildDiagnosticsDetail(input: BuildDiagnosticsDetailInput): DiagnosticsDetail {
  const { job } = input;
  const gate = input.gate ?? null;
  const rp = job.result_payload ?? null;
  const plan = job.plan_payload ?? null;

  // C8 fix — derive missing per-page artifacts from per-page-manifest coverage.
  // For a job that recorded coverage we ALWAYS trust that (ignoring any legacy
  // raster-based value the edge may still send); only a job with no coverage
  // signal at all falls back to an explicitly-supplied value.
  const missingArtifactPages = rp?.per_page_docling_page_count != null
    ? computeMissingArtifactPages({ pageCount: job.page_count, perPageDoclingPageCount: rp.per_page_docling_page_count })
    : (input.missingArtifactPages ?? []);

  const failedChunkRanges = (input.chunks ?? []).filter((c) => c.status === 'failed');
  const failedPages = categorizeFailedPages({
    jobStatus: job.status,
    pageCount: job.page_count,
    gate,
    failedChunkRanges,
    missingArtifactPages,
  });

  const chunks: DiagnosticsDetailChunk[] = [...(input.chunks ?? [])]
    .map((c) => ({
      range: formatPageRanges(expandChunkRanges([c])) || '—',
      pageStart: finite(c.page_start),
      pageEnd: finite(c.page_end),
      status: c.status ?? null,
      attempts: finite(c.attempts),
      mode: c.mode ?? null,
      lane: c.lane ?? null,
    }))
    .sort((a, b) => (a.pageStart ?? 0) - (b.pageStart ?? 0));

  return {
    version: PDF_IMPORT_DIAGNOSTICS_V2_VERSION,
    correlation: {
      jobId: job.id,
      importId: input.importId ?? job.template_import_id ?? null,
      templateId: job.template_id ?? null,
      fileHash: job.source_file_hash ?? null,
      filename: job.source_file_name ?? null,
    },
    status: job.status,
    modes: {
      requested: plan?.requested_mode ?? job.mode ?? null,
      effective: plan?.dispatch_effective_mode ?? job.mode ?? null,
      lane: plan?.selected_lane ?? rp?.selected_lane ?? null,
      serviceClass: job.service_class ?? plan?.service_class ?? null,
    },
    timings: { elapsedMs: finite(job.duration_ms), cloudRunMs: finite(job.cloud_run_ms) },
    pages: {
      total: finite(job.page_count),
      scored: gate ? finite(gate.pagesScored) : null,
      unscored: failedPages.unscored.length,
      needingReview: gate ? finite(gate.pagesNeedingReview) : null,
    },
    quality: {
      finalScore: gate?.finalScore ?? gate?.overallScore ?? finite(job.ssim_score),
      overallScore: gate ? (gate.overallScore ?? null) : finite(job.ssim_score),
      coverage: gate?.coverage ?? null,
      qualityCoverage: gate?.qualityCoverage ?? null,
      repairPasses: gate ? finite(gate.repairPassesApplied) : null,
      manualReviewRequired: gate ? Boolean(gate.manualReviewRequired) : null,
      pagesNative: gate ? finite(gate.pagesNative) : null,
      pagesHybridFallback: gate ? finite(gate.pagesHybridFallback) : null,
      pagesPixelFallback: gate ? finite(gate.pagesPixelFallback) : null,
      pagesFallbackUnavailable: gate ? finite(gate.pagesFallbackUnavailable) : null,
    },
    failedPages,
    failedPageCounts: {
      infra_failure: failedPages.infra_failure.length,
      unscored: failedPages.unscored.length,
      manual_review: failedPages.manual_review.length,
      missing_artifacts: failedPages.missing_artifacts.length,
    },
    chunks,
    perPage: mergePerPage(gate),
    artifacts: artifactFlags(job),
    signedUrls: input.signedUrls ?? {},
    error: job.error_code || job.error_text ? { code: job.error_code ?? null, text: job.error_text ?? null } : null,
    containment: buildContainmentDetail(gate),
  };
}

/** E0 — shape the persisted critical-containment audit into a compact rollup. */
function buildContainmentDetail(gate: DiagnosticsGateSummary | null): DiagnosticsDetail['containment'] {
  const c = gate?.criticalContainment;
  if (!c || c.ran !== true) return null;
  return {
    version: c.version ?? null,
    nativeSuppressed: Boolean(c.nativeSuppressed),
    criticalPageCount: finite(c.criticalPageCount) ?? 0,
    pagesForcedHybrid: finite(c.pagesForcedHybrid) ?? 0,
    pagesForcedPixel: finite(c.pagesForcedPixel) ?? 0,
    pagesBlockedNoRaster: finite(c.pagesBlockedNoRaster) ?? 0,
    pages: (c.perPage ?? [])
      .filter((p) => (p.action ?? 'allow_native') !== 'allow_native')
      .map((p) => ({
        pageNumber: finite(p.pageNumber),
        action: p.action ?? null,
        reason: p.reason ?? null,
        contentKinds: Array.isArray(p.contentKinds) ? p.contentKinds : [],
        sourceRasterAvailable: Boolean(p.sourceRasterAvailable),
        defectCodes: Array.isArray(p.defects) ? p.defects.map((d) => d.code ?? '').filter(Boolean) : [],
      })),
  };
}
