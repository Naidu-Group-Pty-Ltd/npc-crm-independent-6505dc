/**
 * Docling-backed PDF importer.
 *
 * Produces the canonical template PDF import result contract.
 *
 * Pipeline:
 *   1. `template-import-pdf` → create_import (gives us an importId + audit row).
 *   2. Upload PDF bytes to the dispatcher as base64 (the dispatcher signs &
 *      forwards a URL to the Cloud Run Docling sidecar).
 *   3. Poll `pdf_import_jobs` until status ∈ {succeeded, failed, cancelled}.
 *   4. Download the resulting `docling.json` (+ optional `rasters.json`) via
 *      signed URLs from the `pdf-import-diagnostics` bucket.
 *   5. Map to `TemplateImportPlan` (`mapDoclingToPagePlan`), convert to a
 *      `ReportTemplate` via `applyTemplateImportPlan`, and finalize through
 *      `template-import-pdf` so downstream UI sees a normal template.
 */
import type { ImportOptions, ImportProgress, ImportResult } from './types';
import { supabase } from '@/integrations/supabase/client';
import { invokeSecureFunction, describeAuthError } from '@/lib/secureInvoke';
import { reportTemplateToCdir } from '@/lib/reportTemplate/ingestion/cdir';
import { buildCdirFidelityReport } from '@/lib/reportTemplate/ingestion/fidelity';
import { applyTemplateImportPlan } from '@/lib/reportTemplate/ingestion/reconciliation/applyPlan';
import { validateReconstructedSchema } from '@/lib/reportTemplate/referenceImport';
import { mapDoclingToPagePlan, type DoclingPlanMode } from './docling/mapDoclingToPagePlan';
import { buildDoclingExpectations } from './docling/buildDoclingExpectations';
import {
  buildVisualSourceExpectationBundle,
  pageNumberFromDoclingId,
} from '@/lib/reportTemplate/ingestion/visualQuality';
import { runImportQualityGate } from './importQualityGate';
import { applyPagePolicyToPage } from '@/lib/reportTemplate/rendering/pdfImportPagePolicy';
import {
  buildSourceCriticalEvidenceByPage,
  buildSourceRasterRefsFromManifest,
  chooseSourceCriticalEvidence,
} from './criticalVisualContainmentAdapters';
import type { RasterManifest } from './docling/doclingTypes';
import type { CriticalContainmentPolicy } from './criticalVisualContainment.pure';
import { buildEmbeddedFontFace, type FontFaceEntry } from './fontFaceBuilder';
import { fontLookupKey, resolveSourceFontFamily, lookupEmbeddedFamily } from './fontResolver';
import { recommendFidelityMode } from './recommendFidelityMode';
import { createCanvasMeasurer } from './fontMetricCompatibility';
import type { FontVerticalMetrics } from './firstBaseline.pure';
import {
  bridgePageCharts,
  readSceneChartRegions,
  type BridgedChart,
} from './sourceChartBridge.pure';
import { stripTransientRasterUrls } from './stripTransientRasterUrls';
import type {
  DoclingDocument,
  DoclingRasterByPage,
  DoclingRasterResponse,
} from './docling/doclingTypes';

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 20 * 60_000; // Wave F8: bumped from 10→20m to absorb Cloud Run cold-start + hybrid raster runs.
const FINALIZATION_POLL_INTERVAL_MS = 2500;
const FINALIZATION_POLL_TIMEOUT_MS = 20 * 60_000;
const TERMINAL_STATUS = new Set(['succeeded', 'failed', 'cancelled']);
const DIAGNOSTICS_BUCKET = 'pdf-import-diagnostics';

const CONSUMER_GUARDRAIL_VERSION = 'template-import-consumer-guardrails-v1';
const REQUIRED_ARTIFACT_CONTRACT_VERSION = 'raster-manifest-v1';
const REQUIRED_DOCLING_PAGE_REBASE_VERSION = 'chunk-page-rebase-v1';
const REQUIRED_CHUNK_MERGE_VALIDATION_VERSION = 'chunk-merge-validation-v1';
const REQUIRED_TERMINAL_STATE_VERSION = 'terminal-state-normalizer-v1';

/**
 * E0 containment flags. Sourced from optional Vite build env
 * (VITE_PDF_IMPORT_*_NATIVE_ENABLED); a MISSING flag defaults to the SAFE state
 * (false), so containment can never be bypassed by an absent variable, and the
 * browser cannot flip it via a request property.
 */
function resolveContainmentPolicyFromEnv(): Partial<CriticalContainmentPolicy> {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
  return {
    complexNativeEnabled: env.VITE_PDF_IMPORT_COMPLEX_NATIVE_ENABLED === 'true',
    chartNativeEnabled: env.VITE_PDF_IMPORT_CHART_NATIVE_ENABLED === 'true',
    unverifiedTableNativeEnabled: env.VITE_PDF_IMPORT_UNVERIFIED_TABLE_NATIVE_ENABLED === 'true',
  };
}

async function invokeImport(body: any) {
  const { data, error } = await invokeSecureFunction('template-import-pdf', body, { timeoutMs: 300_000 });
  if (error) throw new Error(describeAuthError(error.message) ?? error.message ?? 'template-import-pdf failed');
  if (data?.error) throw new Error(describeAuthError(String(data.error)) ?? String(data.error));
  return data;
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', buf.slice(0));
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return `unverified-${buf.byteLength}`;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(bin);
}

function modeToDocling(mode: ImportOptions['mode']): DoclingPlanMode {
  if (mode === 'pixel') return 'pixel-perfect';
  if (mode === 'hybrid') return 'hybrid';
  // 'semantic' or 'ocr' → docling has no OCR concept; semantic is the closest
  // since the sidecar already OCRs scanned pages internally.
  return 'semantic';
}

function modeToWire(mode: DoclingPlanMode): string {
  return mode === 'pixel-perfect' ? 'pixel_perfect' : mode;
}

async function downloadJson<T>(path: string): Promise<T | null> {
  // Sign via the dispatcher — the anon client can't sign URLs on the private
  // diagnostics bucket under our custom-auth model.
  const { data, error } = await invokeSecureFunction(
    'pdf-parse-dispatch',
    { operation: 'download', path },
    { timeoutMs: 30_000 },
  );
  if (error) return null;
  const signed = (data as { signed_url?: string } | null)?.signed_url;
  if (!signed) return null;
  const res = await fetch(signed);
  if (!res.ok) return null;
  return (await res.json()) as T;
}

async function downloadUrl(path: string): Promise<string | null> {
  const { data, error } = await invokeSecureFunction(
    'pdf-parse-dispatch',
    { operation: 'download', path },
    { timeoutMs: 30_000 },
  );
  if (error) return null;
  return (data as { signed_url?: string } | null)?.signed_url ?? null;
}


interface TemplateImportStatusRow {
  id: string;
  status: string;
  page_count: number | null;
  created_template_id: string | null;
  error: string | null;
  source_filename?: string | null;
  meta?: Record<string, any> | null;
}

async function waitForTemplateFinalization(
  importId: string,
  onProgress: (progress: ImportProgress) => void,
): Promise<TemplateImportStatusRow> {
  const started = Date.now();

  while (Date.now() - started < FINALIZATION_POLL_TIMEOUT_MS) {
    const statusRes = await invokeImport({
      operation: 'get_status',
      import_id: importId,
    });

    const record = statusRes?.record as TemplateImportStatusRow | undefined;
    if (!record) {
      throw new Error('Template finalization status response was empty.');
    }

    const meta = record.meta ?? {};
    const finalizationStatus = typeof meta.finalization_status === 'string'
      ? meta.finalization_status
      : record.status;

    onProgress({
      phase: 'finalizing',
      totalPages: record.page_count ?? undefined,
      message: `Finalizing template… (${finalizationStatus})`,
    });

    if (record.status === 'completed' && record.created_template_id) {
      return record;
    }

    if (record.status === 'failed' || record.status === 'cancelled') {
      const detail = record.error
        ?? meta.finalization_error
        ?? meta.finalization_last_error
        ?? 'unknown finalization error';
      throw new Error(`Template finalization failed: ${detail}`);
    }

    await new Promise((resolve) => setTimeout(resolve, FINALIZATION_POLL_INTERVAL_MS));
  }

  throw new Error('Template finalization timed out while waiting for the async worker.');
}

interface JobRow {
  id: string;
  status: string;
  stage: string | null;
  page_count: number | null;
  pages_completed?: number | null;
  pages_total?: number | null;
  duration_ms: number | null;
  engine_version: string | null;
  diagnostics_path: string | null;
  error_code: string | null;
  error_text: string | null;
  result_payload: Record<string, any> | null;
  attempts?: Array<{ endpoint?: string; ok?: boolean; status?: number; attempt?: number; error_code?: string; retryable?: boolean; message?: string } | unknown> | null;
}

function stageToPhase(stage: string | null): ImportProgress['phase'] {
  switch (stage) {
    case 'rastering':
    case 'rasterizing':
      return 'rasterizing';
    case 'finalizing':
    case 'parsed':
    case 'persisting':
      return 'finalizing';
    case 'hashing':
    case 'queued':
    case 'cache_hit':
      return 'uploading';
    default:
      return 'extracting';
  }
}

function stageLabel(stage: string | null): string {
  if (!stage) return 'Working…';
  switch (stage) {
    case 'queued': return 'Queued';
    case 'hashing': return 'Hashing source';
    case 'parsing': return 'Docling parsing';
    case 'persisting': return 'Saving Docling output';
    case 'rastering':
    case 'rasterizing':
      return 'Rasterising pages';
    case 'finalizing': return 'Finalising';
    case 'parsed': return 'Done';
    case 'cache_hit': return 'Cache hit — reusing prior parse';
    default: return stage;
  }
}

function latestSidecarWarning(attempts: JobRow['attempts']): string | null {
  if (!Array.isArray(attempts)) return null;
  for (let i = attempts.length - 1; i >= 0; i--) {
    const a = attempts[i] as any;
    if (!a || a.ok) continue;
    const ep = a.endpoint ?? 'sidecar';
    const status = a.status ? ` ${a.status}` : '';
    const reason = a.message ? ` — ${String(a.message).slice(0, 160)}` : '';
    const retry = a.retryable === false ? ' (giving up)' : ' (retrying)';
    return `${ep}${status}${retry}${reason}`;
  }
  return null;
}

async function pollJob(
  jobId: string,
  onProgress?: ImportOptions['onProgress'],
): Promise<JobRow> {
  const start = Date.now();
  let lastStage: string | null = null;
  let lastPages = -1;
  let lastWarning: string | null = null;
  let consecutiveErrors = 0;
  let lastError: string | null = null;
  // Poll via `pdf-parse-dispatch { operation: 'status' }` rather than direct
  // table reads — the table is RLS-scoped to `auth.uid()`, which is null under
  // our custom session tokens, so direct selects would silently return zero
  // rows and the import would always time out.
  const MAX_CONSECUTIVE_ERRORS = 8;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await invokeSecureFunction(
      'pdf-parse-dispatch',
      { operation: 'status', job_id: jobId },
      { timeoutMs: 30_000 },
    );
    if (error || (data as any)?.error) {
      consecutiveErrors += 1;
      lastError = error?.message ?? String((data as any)?.error ?? 'unknown');
      console.warn(`[docling] status read failed (attempt ${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}): ${lastError}`);
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        throw new Error(`pdf-parse-dispatch status failed after ${consecutiveErrors} retries: ${lastError}`);
      }
      await new Promise((r) => setTimeout(r, Math.min(1000 * consecutiveErrors, 5000)));
    } else {
      consecutiveErrors = 0;
      const row = (data as { job?: JobRow } | null)?.job;
      if (row) {
        const pages = row.pages_completed ?? 0;
        const total = row.pages_total ?? row.page_count ?? null;
        const warning = latestSidecarWarning(row.attempts);
        const stageChanged = row.stage !== lastStage;
        const pagesChanged = pages !== lastPages;
        const warningChanged = warning !== lastWarning;
        if (stageChanged || pagesChanged || warningChanged) {
          lastStage = row.stage;
          lastPages = pages;
          lastWarning = warning;
          onProgress?.({
            phase: stageToPhase(row.stage),
            stage: row.stage,
            page: pages || undefined,
            totalPages: total ?? undefined,
            pagesCompleted: pages,
            pagesTotal: total,
            warning,
            message: `${stageLabel(row.stage)}${total ? ` · ${pages}/${total} pages` : ''}`,
          });
        }
        if (TERMINAL_STATUS.has(row.status)) return row;
      }
    }
    if (Date.now() - start > POLL_TIMEOUT_MS) {
      throw new Error(`Docling parse timed out after ${Math.round(POLL_TIMEOUT_MS / 60_000)} minutes (last stage: ${lastStage ?? 'unknown'})`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}


function wireModeToDocling(mode: string | null | undefined, fallback: DoclingPlanMode): DoclingPlanMode {
  if (mode === 'pixel_perfect' || mode === 'pixel-perfect') return 'pixel-perfect';
  if (mode === 'hybrid') return 'hybrid';
  if (mode === 'semantic') return 'semantic';
  return fallback;
}

export function rastersByPage(payload: unknown): DoclingRasterByPage | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const env = payload as DoclingRasterResponse;
  const pages = env.pages;
  if (!Array.isArray(pages)) return undefined;
  const out: DoclingRasterByPage = {};
  for (const p of pages) {
    const width = p?.width_px ?? p?.width;
    const height = p?.height_px ?? p?.height;
    const base64 = p?.base64 ?? p?.image_base64;
    const mime = p?.mime ?? (env.format === 'jpeg' ? 'image/jpeg' : 'image/png');
    if (
      typeof p?.page_no !== 'number'
      || typeof width !== 'number'
      || typeof height !== 'number'
      || typeof base64 !== 'string'
      || base64.length === 0
    ) continue;
    out[p.page_no] = {
      width,
      height,
      dataUrl: `data:${mime};base64,${base64}`,
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

async function manifestToRastersByPage(payload: unknown): Promise<DoclingRasterByPage | undefined> {
  if (!payload || typeof payload !== 'object') return undefined;
  const pages = (payload as { pages?: Array<{ page_no?: number; width?: number; height?: number; path?: string }> }).pages;
  if (!Array.isArray(pages)) return undefined;

  const out: DoclingRasterByPage = {};
  for (const page of pages) {
    if (page?.page_no == null || !page.path) continue;
    const signedUrl = await downloadUrl(page.path);
    if (!signedUrl) continue;

    out[page.page_no] = {
      width: Number(page.width ?? 0),
      height: Number(page.height ?? 0),
      dataUrl: signedUrl,
    };
  }

  return Object.keys(out).length ? out : undefined;
}


/**
 * Load the charts the sidecar read, keyed by page number.
 *
 * `pages-manifest.json` carries a `regions_path` per page plus a
 * `chart_region_count`, so only pages that actually contain a chart are
 * fetched — most imports download nothing extra at all.
 *
 * Fail-open throughout. Every failure path returns fewer charts, never an
 * error: a chart that does not arrive here stays a source crop, which is the
 * behaviour that shipped for a year and is always a correct outcome. An import
 * must never fail because a chart could not be reconstructed.
 */
async function loadSourceChartsByPage(
  manifestPath: string | null,
): Promise<Record<number, BridgedChart[]>> {
  if (!manifestPath) return {};
  try {
    const manifest = await downloadJson<{
      pages?: Array<{ page_no?: number; regions_path?: string; chart_region_count?: number }>;
    }>(manifestPath);
    const pages = manifest?.pages;
    if (!Array.isArray(pages)) return {};

    const withCharts = pages.filter(
      (p) => Number(p?.chart_region_count ?? 0) > 0 && typeof p?.regions_path === 'string',
    );
    if (!withCharts.length) return {};

    const out: Record<number, BridgedChart[]> = {};
    await Promise.all(withCharts.map(async (page) => {
      const pageNo = Number(page.page_no ?? 0);
      if (!Number.isFinite(pageNo) || pageNo <= 0) return;
      try {
        const payload = await downloadJson<unknown>(page.regions_path as string);
        const bridged = bridgePageCharts(readSceneChartRegions(payload));
        if (bridged.length) out[pageNo] = bridged;
      } catch {
        // One unreadable page must not cost the others their charts.
      }
    }));
    return out;
  } catch {
    return {};
  }
}

interface ConsumerGuardrailReport {
  version: string;
  ok: boolean;
  expectedPageCount: number;
  problems: string[];
  checks: Record<string, unknown>;
}

function pageNumberContinuity(label: string, values: number[], expectedPageCount: number) {
  const hist = new Map<number, number>();
  for (const raw of values) {
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    hist.set(n, (hist.get(n) ?? 0) + 1);
  }

  const unique = [...hist.keys()].sort((a, b) => a - b);
  const duplicates = unique.filter((n) => (hist.get(n) ?? 0) > 1);
  const missing: number[] = [];
  for (let i = 1; i <= expectedPageCount; i += 1) {
    if (!hist.has(i)) missing.push(i);
  }
  const outOfRange = unique.filter((n) => n < 1 || n > expectedPageCount);

  return {
    label,
    ok: duplicates.length === 0
      && missing.length === 0
      && outOfRange.length === 0
      && unique.length === expectedPageCount,
    expectedPageCount,
    observedCount: values.length,
    uniqueCount: unique.length,
    minPage: unique.length ? unique[0] : null,
    maxPage: unique.length ? unique[unique.length - 1] : null,
    duplicates,
    missing,
    outOfRange,
  };
}

function expectedPageCountFromJob(job: JobRow): number {
  const payload = job.result_payload ?? {};
  const summary = payload.summary && typeof payload.summary === 'object'
    ? payload.summary as Record<string, any>
    : {};
  return Math.max(
    Number(job.page_count ?? 0),
    Number(job.pages_total ?? 0),
    Number(payload.page_count ?? 0),
    Number(summary.page_count ?? 0),
    Number(summary.docling_page_count ?? 0),
    Number(summary.raster_page_count ?? 0),
    Array.isArray(payload.page_raster_paths) ? payload.page_raster_paths.length : 0,
  );
}

function isChunkedJob(job: JobRow): boolean {
  const payload = job.result_payload ?? {};
  return payload.chunked === true
    || typeof payload.docling_page_rebase_version === 'string'
    || typeof payload.chunk_merge_validation_version === 'string';
}

function validateParseJobConsumerGuardrails(job: JobRow): ConsumerGuardrailReport {
  const payload = job.result_payload ?? {};
  const expectedPageCount = expectedPageCountFromJob(job);
  const problems: string[] = [];

  if (job.status !== 'succeeded') problems.push(`job_status_not_succeeded:${job.status}`);
  if (job.stage !== 'parsed') problems.push(`job_stage_not_parsed:${job.stage ?? 'null'}`);
  if (expectedPageCount <= 0) problems.push('expected_page_count_not_positive');

  const chunked = isChunkedJob(job);
  if (chunked) {
    if (payload.artifact_contract_version !== REQUIRED_ARTIFACT_CONTRACT_VERSION) {
      problems.push(`artifact_contract_version_missing_or_stale:${String(payload.artifact_contract_version ?? 'null')}`);
    }
    if (payload.docling_page_rebase_version !== REQUIRED_DOCLING_PAGE_REBASE_VERSION) {
      problems.push(`docling_page_rebase_version_missing_or_stale:${String(payload.docling_page_rebase_version ?? 'null')}`);
    }
    if (payload.chunk_merge_validation_version !== REQUIRED_CHUNK_MERGE_VALIDATION_VERSION) {
      problems.push(`chunk_merge_validation_version_missing_or_stale:${String(payload.chunk_merge_validation_version ?? 'null')}`);
    }
    if (payload.terminal_state_version !== REQUIRED_TERMINAL_STATE_VERSION) {
      problems.push(`terminal_state_version_missing_or_stale:${String(payload.terminal_state_version ?? 'null')}`);
    }

    const mergeValidation = payload.merge_validation && typeof payload.merge_validation === 'object'
      ? payload.merge_validation as Record<string, any>
      : null;

    if (!mergeValidation || mergeValidation.ok !== true) {
      problems.push('merge_validation_not_ok');
    }
  }

  const pageRasterPaths = Array.isArray(payload.page_raster_paths) ? payload.page_raster_paths : [];
  const hasRasterManifest = typeof payload.rasters_manifest_path === 'string' && payload.rasters_manifest_path.length > 0;
  if (hasRasterManifest && pageRasterPaths.length !== expectedPageCount) {
    problems.push(`page_raster_paths_count_mismatch:${pageRasterPaths.length}/${expectedPageCount}`);
  }

  return {
    version: CONSUMER_GUARDRAIL_VERSION,
    ok: problems.length === 0,
    expectedPageCount,
    problems,
    checks: {
      chunked,
      jobStatus: job.status,
      jobStage: job.stage,
      artifactContractVersion: payload.artifact_contract_version ?? null,
      doclingPageRebaseVersion: payload.docling_page_rebase_version ?? null,
      chunkMergeValidationVersion: payload.chunk_merge_validation_version ?? null,
      terminalStateVersion: payload.terminal_state_version ?? null,
      pageRasterPathCount: pageRasterPaths.length,
      hasRasterManifest,
    },
  };
}

function validateDownloadedArtifacts(
  job: JobRow,
  doclingDoc: DoclingDocument,
  rasterManifestPayload: unknown,
): ConsumerGuardrailReport {
  const expectedPageCount = expectedPageCountFromJob(job);
  const problems: string[] = [];

  const pages = ((doclingDoc as any).pages ?? {}) as Record<string, any>;
  const pageEntries = Object.entries(pages);
  const pageKeys = pageEntries
    .map(([key]) => Number(key))
    .filter((n) => Number.isFinite(n) && n > 0);

  const nestedPageNos = pageEntries
    .map(([, value]) => Number(value?.page_no ?? 0))
    .filter((n) => Number.isFinite(n) && n > 0);

  const keyReport = pageNumberContinuity('docling_page_keys', pageKeys, expectedPageCount);
  if (!keyReport.ok) problems.push('docling_page_keys_not_continuous');

  const nestedReport = nestedPageNos.length
    ? pageNumberContinuity('docling_nested_page_no', nestedPageNos, expectedPageCount)
    : null;

  if (nestedReport && !nestedReport.ok) problems.push('docling_nested_page_no_not_continuous');

  const mismatchedNestedPages = pageEntries
    .filter(([key, value]) => {
      const keyNo = Number(key);
      const nestedNo = Number(value?.page_no ?? keyNo);
      return Number.isFinite(keyNo) && Number.isFinite(nestedNo) && keyNo !== nestedNo;
    })
    .map(([key, value]) => ({ key: Number(key), nested: Number(value?.page_no ?? 0) }));

  if (mismatchedNestedPages.length > 0) {
    problems.push(`docling_page_key_nested_mismatch:${mismatchedNestedPages.slice(0, 10).map((p) => `${p.key}->${p.nested}`).join(',')}`);
  }

  let rasterReport: ReturnType<typeof pageNumberContinuity> | null = null;
  if (rasterManifestPayload && typeof rasterManifestPayload === 'object') {
    const rasterPages = ((rasterManifestPayload as any).pages ?? []) as Array<Record<string, any>>;
    const rasterPageNos = Array.isArray(rasterPages)
      ? rasterPages.map((page) => Number(page.page_no ?? 0)).filter((n) => Number.isFinite(n) && n > 0)
      : [];

    rasterReport = pageNumberContinuity('raster_manifest_page_no', rasterPageNos, expectedPageCount);
    if (!rasterReport.ok) problems.push('raster_manifest_page_no_not_continuous');

    if (rasterPageNos.length !== expectedPageCount) {
      problems.push(`raster_manifest_page_count_mismatch:${rasterPageNos.length}/${expectedPageCount}`);
    }
  }

  return {
    version: CONSUMER_GUARDRAIL_VERSION,
    ok: problems.length === 0,
    expectedPageCount,
    problems,
    checks: {
      doclingPageKeys: keyReport,
      doclingNestedPageNos: nestedReport,
      mismatchedNestedPages,
      rasterManifestPages: rasterReport,
    },
  };
}


export async function extractPdfViaDocling(
  file: File,
  options: ImportOptions,
): Promise<ImportResult> {
  const onProgress = options.onProgress ?? (() => {});
  const mode = modeToDocling(options.mode);

  onProgress({ phase: 'reading', message: 'Reading PDF…' });
  const buf = await file.arrayBuffer();
  const sourceChecksum = `sha256:${await sha256Hex(buf)}`;

  const createRes = await invokeImport({
    operation: 'create_import',
    user_id: options.userId ?? null,
    fidelity_mode: options.mode,
    source_filename: file.name,
    source_size_bytes: file.size,
    page_count: null,
    meta: { source_checksum: sourceChecksum, engine: 'docling', docling_mode: mode },
  });
  const importId: string = createRes.record.id;

  try {
    onProgress({ phase: 'uploading', message: 'Uploading PDF source…' });
    const base64 = bytesToBase64(new Uint8Array(buf));
    const { data: uploadRes, error: uploadErr } = await invokeSecureFunction(
      'pdf-parse-dispatch',
      {
        operation: 'upload_source',
        source_base64: base64,
        source_file_name: file.name,
      },
      { timeoutMs: 120_000 },
    );
    if (uploadErr) throw new Error(uploadErr.message ?? 'pdf-parse-dispatch upload_source failed');
    const uploaded = uploadRes as { source_path?: string; source_bucket?: string; source_file_hash?: string } | null;
    if (!uploaded?.source_path) throw new Error('pdf-parse-dispatch upload_source did not return a source_path');

    onProgress({ phase: 'uploading', message: 'Starting Docling job…' });
    const { data: dispatchRes, error: dispatchErr } = await invokeSecureFunction(
      'pdf-parse-dispatch',
      {
        operation: 'start',
        // C1.3: correlate the parse job to its template import so diagnostics and
        // review can trace job -> import -> template without meta-JSON archaeology.
        template_import_id: importId,
        mode: modeToWire(mode),
        source_path: uploaded.source_path,
        source_bucket: uploaded.source_bucket,
        source_file_hash: uploaded.source_file_hash,
        source_file_name: file.name,
        source_file_size_bytes: file.size,
        redact_pii: Boolean(options.redactPii),
        pii_redaction_reason: options.redactPii ? 'finance_pdf_import' : null,
        description_tier: 'on',
        include_markdown: true,
      },
      { timeoutMs: 120_000 },
    );
    if (dispatchErr) throw new Error(dispatchErr.message ?? 'pdf-parse-dispatch start failed');
    const jobId = (dispatchRes as { job_id?: string } | null)?.job_id;
    if (!jobId) throw new Error('pdf-parse-dispatch did not return a job_id');

    onProgress({ phase: 'extracting', message: 'Docling parsing…' });
    const job = await pollJob(jobId, onProgress);
    if (job.status !== 'succeeded') {
      throw new Error(
        `Docling job ${job.status}: ${job.error_code ?? 'unknown'} — ${job.error_text ?? ''}`.trim(),
      );
    }

    const parseGuardrails = validateParseJobConsumerGuardrails(job);
    if (!parseGuardrails.ok) {
      throw new Error(`Docling job failed consumer guardrails: ${parseGuardrails.problems.join('; ')}`);
    }

    const doclingPath = job.result_payload?.docling_path ?? job.diagnostics_path;
    if (!doclingPath) throw new Error('Docling job did not produce a diagnostics path');

    const doclingDoc = await downloadJson<DoclingDocument>(doclingPath);
    if (!doclingDoc) throw new Error('Failed to download docling.json');
    if (job.result_payload?.summary && !doclingDoc.summary) {
      doclingDoc.summary = job.result_payload.summary as DoclingDocument['summary'];
    }

    const rasterManifestPayload = job.result_payload?.rasters_manifest_path
      ? await downloadJson<unknown>(job.result_payload.rasters_manifest_path)
      : null;
    const rasters = rasterManifestPayload
      ? await manifestToRastersByPage(rasterManifestPayload)
      : job.result_payload?.rasters_path
        ? rastersByPage(await downloadJson<unknown>(job.result_payload.rasters_path))
        : undefined;

    const artifactGuardrails = validateDownloadedArtifacts(job, doclingDoc, rasterManifestPayload);
    if (!artifactGuardrails.ok) {
      throw new Error(`Downloaded Docling artifacts failed consumer guardrails: ${artifactGuardrails.problems.join('; ')}`);
    }

    const effectiveMode = wireModeToDocling(job.result_payload?.effective_mode ?? job.result_payload?.mode, mode);
    onProgress({
      phase: 'finalizing',
      message: job.result_payload?.auto_mode_selected
        ? 'Mapping Docling → template (Pixel-Perfect selected for OCR-heavy PDF)…'
        : 'Mapping Docling → template…',
    });
    // Build @font-face entries for every embeddable source font program —
    // INCLUDING subsets, which are the common case. A subset carries exactly the
    // glyphs the source text drew with it, and the mapper places the
    // name-resolved web font after the embedded family in the stack, so
    // per-glyph fallback covers anything the subset lacks (edited text, mostly).
    // Text therefore renders in the source's own outlines, not a substitute.
    const embeddedFaces: FontFaceEntry[] = [];
    const embeddedFontFamilies: Record<string, string> = {};
    // D1 — the vertical metrics of the program that will actually draw the
    // text. CSS puts a line's first baseline at
    // `(lineHeight - (ascent + descent))/2 + ascent` below the box, so without
    // these the mapper cannot know where its text lands and has to place every
    // block by its ink top — which sits ~0.36em high of the baseline.
    const fontMetrics: Record<string, FontVerticalMetrics> = {};
    for (const f of doclingDoc.fonts ?? []) {
      if (!f?.base64) continue;
      if (typeof f.ascender === 'number' && typeof f.descender === 'number') {
        fontMetrics[fontLookupKey(f.basename)] = {
          ascender: f.ascender,
          descender: f.descender,
        };
      }
      const built = buildEmbeddedFontFace({
        loadedName: f.basename,
        postscriptName: f.psName ?? f.basename,
        base64: f.base64,
        mimetype: f.mimetype,
        bold: f.bold,
        italic: f.italic,
        // R2 — scope the face to the cmap's real coverage so a subset can
        // never claim codepoints it lacks; absent for pre-R2 sidecar payloads.
        coverageRanges: f.coverage_ranges,
      });
      embeddedFaces.push(built.face);
      embeddedFontFamilies[fontLookupKey(f.basename)] = built.family;
    }

    // W3 — collect any charts the sidecar managed to read. The scene graph is
    // published on `pages-manifest.json`, which the job payload already exposes;
    // nothing downloaded it before, so extracted chart series were written and
    // never read. Fail-open by design: any problem here leaves every chart as a
    // source crop, which is the existing behaviour and always correct.
    const sourceChartsByPage = await loadSourceChartsByPage(
      job.result_payload?.per_page_docling_manifest_path ?? null,
    );

    const plan = mapDoclingToPagePlan(doclingDoc, {
      importId,
      mode: effectiveMode,
      rastersByPage: rasters,
      engineVersion: job.engine_version ?? 'docling',
      embeddedFontFamilies,
      fontMetrics,
      sourceChartsByPage,
      // R1 — real canvas metrics for tracked-text spacing derivation; degrades
      // to the documented estimate when no canvas exists.
      measureTextWidth: createCanvasMeasurer(),
    });

    const template = applyTemplateImportPlan(plan, {
      templateName: options.templateName ?? file.name.replace(/\.pdf$/i, ''),
    });
    if (embeddedFaces.length) {
      const tokens = (template.tokens ?? {}) as any;
      const existing: any[] = tokens.fontFaces ?? [];
      const seen = new Set(existing.map((x) => x?.family));
      tokens.fontFaces = [...existing, ...embeddedFaces.filter((x) => !seen.has(x.family))];
      template.tokens = tokens;
    }
    template.meta = {
      ...(template.meta ?? {}),
      pdfImport: {
        engine: 'docling',
        engineVersion: job.engine_version ?? 'docling',
        mode: effectiveMode,
        diagnosticsPath: doclingPath,
        jobId,
        importedAt: new Date().toISOString(),
        consumerGuardrailVersion: CONSUMER_GUARDRAIL_VERSION,
        parseGuardrails,
        artifactGuardrails,
        parseArtifactContractVersion: job.result_payload?.artifact_contract_version ?? null,
        doclingPageRebaseVersion: job.result_payload?.docling_page_rebase_version ?? null,
        chunkMergeValidationVersion: job.result_payload?.chunk_merge_validation_version ?? null,
        terminalStateVersion: job.result_payload?.terminal_state_version ?? null,
      },
    };
    // Attach the durable manifest path independently of the optional quality
    // gate. The signed URL in the mapped background is render-time data only.
    const sourceRasterRefByPage = buildSourceRasterRefsFromManifest(
      rasterManifestPayload as RasterManifest | null,
      jobId,
      job.result_payload?.rasters_manifest_path ?? null,
    );
    template.pages = template.pages.map((page, index) => {
      const pageNumber = pageNumberFromDoclingId(page.id) ?? index + 1;
      const sourceRasterRef = sourceRasterRefByPage[pageNumber];
      return sourceRasterRef
        ? { ...page, meta: { ...(page.meta ?? {}), sourceRasterRef } }
        : page;
    });
    const schemaValidation = validateReconstructedSchema(template);
    if (!schemaValidation.ok) {
      throw new Error(`Docling reconstructed schema failed validation: ${schemaValidation.errors.join('; ')}`);
    }

    const cdir = reportTemplateToCdir(template, {
      kind: 'pdf',
      checksum: sourceChecksum,
      filename: file.name,
    });
    // Phase 3: Feed real text and bounds expectations into CDIR fidelity so
    // `textAccuracy` and `medianPositionDrift` are measured against the
    // source Docling document instead of empty arrays.
    const doclingExpectations = buildDoclingExpectations(doclingDoc);
    let cdirFidelity = buildCdirFidelityReport(cdir, doclingExpectations);

    // C3: package the immutable source-derived expectations so the quality gate
    // scores text coverage / layout drift / missing elements against the SOURCE
    // Docling document, not the candidate CDIR's own self-expectations.
    const sourceExpectationBundle = buildVisualSourceExpectationBundle({
      source: 'docling-document',
      expectedText: doclingExpectations.expectedText,
      expectedBounds: doclingExpectations.expectedBounds,
      expectedPageNumbers: cdir.pages.map((page, index) => pageNumberFromDoclingId(page.id) ?? index + 1),
    });

    // Phase 7 — quality-gated finalization. Diff the reconstructed template
    // against the source page rasters, run the deterministic repair loop on
    // weak pages, and decide a recommended final mode BEFORE finalizing. The
    // gate is fail-open: any failure returns the un-repaired template with a
    // `ran: false` summary, so it can never block an import.
    let stageTemplate = template;
    let stageCdir = cdir;
    let qualityGateSummary: Record<string, unknown> | null = null;
    let qualityGateResultSummary: ImportResult['visualQuality'] | undefined;
    if (options.runQualityGate !== false) {
      onProgress({ phase: 'finalizing', message: 'Running visual quality gate…' });
      // E0 — assemble source critical evidence (charts/tables/pictures/vectors)
      // and durable raster references so containment can protect complex pages
      // and guarantee a safe raster fallback (never a blank raster-only page).
      // E1 — prefer Source Scene Graph V2 evidence (durable region crops) when a
      // valid V3 scene is supplied; otherwise fall back to the legacy Docling
      // adapter. A missing / invalid / region-less V3 can never weaken E0.
      const criticalSourceEvidenceByPage = chooseSourceCriticalEvidence({
        sourceSceneGraph: (options as { sourceSceneGraph?: unknown }).sourceSceneGraph ?? null,
        doclingDoc,
      }).byPage;
      const gate = await runImportQualityGate({
        importId,
        template,
        cdir,
        requestedMode: effectiveMode,
        rastersByPage: rasters,
        sourceExpectations: sourceExpectationBundle,
        maxPages: options.qualityGateMaxPages,
        criticalSourceEvidenceByPage,
        sourceRasterRefByPage,
        containmentPolicy: resolveContainmentPolicyFromEnv(),
      });
      qualityGateSummary = gate.summary as unknown as Record<string, unknown>;
      qualityGateResultSummary = {
        ran: gate.summary.ran,
        skippedReason: gate.summary.skippedReason,
        overallScore: gate.summary.overallScore,
        finalScore: gate.summary.finalScore,
        recommendedFinalMode: gate.recommendedFinalMode,
        repairPassesApplied: gate.repairPassesApplied,
        manualReviewRequired: gate.manualReviewRequired,
        pagesNeedingReview: gate.summary.pagesNeedingReview,
        pageCount: gate.summary.pageCount,
      };

      // C6.3: stage whenever the gate changed the template (deterministic repair
      // AND/OR per-page output-policy decisions). Preserve page size always;
      // merge embedded font faces + import metadata. For pages the gate DECIDED
      // (they carry a pdf-page-output-policy), keep the gate's policy and restore
      // the source raster from the original (the CDIR round-trip drops
      // backgrounds), then reconcile the background flags with the policy so a
      // raster-only page actually paints its raster. Untouched pages restore the
      // original background as before, so gate decisions are never clobbered.
      // E0 — stage whenever the gate changed the template, INCLUDING when only
      // critical containment changed it on a QA fail-open path (ran === false).
      // A containment fallback must be persisted, not dropped as "gate skipped".
      const shouldStage = gate.summary.templateChanged
        && gate.template !== template;
      if (shouldStage) {
        const originalPagesById = new Map(template.pages.map((page) => [page.id, page]));
        const embeddedFaces: any[] = (template.tokens as any)?.fontFaces ?? [];
        const mergedTokens: any = { ...(gate.template.tokens ?? {}) };
        if (embeddedFaces.length) {
          const seen = new Set((mergedTokens.fontFaces ?? []).map((f: any) => f?.family));
          mergedTokens.fontFaces = [
            ...(mergedTokens.fontFaces ?? []),
            ...embeddedFaces.filter((f: any) => !seen.has(f?.family)),
          ];
        }
        const candidate = {
          ...gate.template,
          tokens: mergedTokens,
          meta: { ...(gate.template.meta ?? {}), ...(template.meta ?? {}) },
          pages: gate.template.pages.map((page) => {
            const orig = originalPagesById.get(page.id);
            if (!orig) return page;
            const policy = (page.meta as any)?.pdfImport;
            if (policy) {
              const decidedRaster = policy.outputStrategy === 'raster-only'
                ? (page.background as any)?.imageUrl
                : undefined;
              const hasDurableRasterRef = policy.outputStrategy === 'raster-only'
                && Boolean((page.meta as any)?.sourceRasterRef);
              return applyPagePolicyToPage(
                {
                  ...page,
                  size: orig.size,
                  background: {
                    ...((orig.background as any) ?? {}),
                    ...(hasDurableRasterRef ? { imageUrl: undefined } : {}),
                    ...(decidedRaster ? { imageUrl: decidedRaster } : {}),
                  },
                  meta: { ...((orig.meta as any) ?? {}), ...((page.meta as any) ?? {}) },
                } as typeof page,
                policy,
              );
            }
            return { ...page, background: orig.background, size: orig.size };
          }),
        } as typeof template;
        const candidateValidation = validateReconstructedSchema(candidate);
        if (candidateValidation.ok) {
          stageTemplate = candidate;
          stageCdir = reportTemplateToCdir(candidate, {
            kind: 'pdf',
            checksum: sourceChecksum,
            filename: file.name,
          });
          cdirFidelity = buildCdirFidelityReport(stageCdir, doclingExpectations);
        }
      }
    }

    const rasterPageCount = job.result_payload?.page_raster_paths?.length ?? 0;
    const totalPages = Math.max(
      job.page_count ?? 0,
      stageTemplate.pages.length,
      rasterPageCount,
    );

    // Raster URLs are short-lived, caller-scoped values used only while
    // reconstructing and reviewing the import. Persist the durable Storage
    // reference instead so renderers re-sign it when needed.
    const persistedTemplate = stripTransientRasterUrls(stageTemplate);
    const persistedCdir = reportTemplateToCdir(persistedTemplate, {
      kind: 'pdf',
      checksum: sourceChecksum,
      filename: file.name,
    });
    const persistedCdirFidelity = buildCdirFidelityReport(persistedCdir, doclingExpectations);

    await invokeImport({
      operation: 'stage_artifacts',
      import_id: importId,
      schema: persistedTemplate,
      page_count: totalPages,
      source_filename: file.name,
      source_checksum: sourceChecksum,
      ...(qualityGateSummary ? { meta: { visual_quality_gate: qualityGateSummary } } : {}),
      cdir: persistedCdir,
      cdir_fidelity: persistedCdirFidelity,
      import_manifests: {
        pdf_import_job: {
          job_id: jobId,
          engine_version: job.engine_version ?? 'docling',
          diagnostics_path: doclingPath,
          rasters_manifest_path: job.result_payload?.rasters_manifest_path ?? null,
          page_raster_paths: job.result_payload?.page_raster_paths ?? [],
          mode: effectiveMode,
          page_count: totalPages,
          consumer_guardrail_version: CONSUMER_GUARDRAIL_VERSION,
          parse_guardrails: parseGuardrails,
          artifact_guardrails: artifactGuardrails,
          artifact_contract_version: job.result_payload?.artifact_contract_version ?? null,
          // C2.4: persist the explicit per-page manifest path + contract version
          // so get_artifacts resolves the preferred source directly instead of
          // relying only on the derived `${jobId}/pages-manifest.json` fallback.
          per_page_docling_manifest_path: job.result_payload?.per_page_docling_manifest_path ?? null,
          per_page_docling_artifact_version: job.result_payload?.per_page_docling_artifact_version
            ?? job.result_payload?.per_page_docling_contract_version ?? null,
          docling_page_rebase_version: job.result_payload?.docling_page_rebase_version ?? null,
          chunk_merge_validation_version: job.result_payload?.chunk_merge_validation_version ?? null,
          terminal_state_version: job.result_payload?.terminal_state_version ?? null,
        },
      },
    });

    onProgress({
      phase: 'finalizing',
      totalPages,
      message: 'Template artifacts staged. Starting async finalization…',
    });

    await invokeImport(options.targetTemplateId
      ? {
          operation: 'start_finalize',
          import_id: importId,
          mode: 'resync',
          template_id: options.targetTemplateId,
          page_count: totalPages,
          source_filename: file.name,
          note: `Re-synced from ${file.name} (docling)`,
        }
      : {
          operation: 'start_finalize',
          import_id: importId,
          mode: 'finalize',
          name: options.templateName ?? file.name.replace(/\.pdf$/i, ''),
          page_count: totalPages,
          source_filename: file.name,
        });

    const finalRecord = await waitForTemplateFinalization(importId, onProgress);

    onProgress({ phase: 'done', totalPages });
    const textBlocks = plan.pages.reduce(
      (acc, p) => acc + p.overlays.filter((o) => o.type === 'text').length, 0);
    const images = plan.pages.reduce(
      (acc, p) => acc + p.overlays.filter((o) => o.type === 'image').length, 0);
    const recommendation = recommendFidelityMode(doclingDoc);

    return {
      template: {
        id: finalRecord.created_template_id ?? options.targetTemplateId ?? importId,
        name: options.templateName ?? file.name.replace(/\.pdf$/i, ''),
      },
      importId,
      pageCount: totalPages,
      cdir: stageCdir,
      cdirFidelity,
      ...(qualityGateResultSummary ? { visualQuality: qualityGateResultSummary } : {}),
      fidelityReport: {
        semanticPages: effectiveMode === 'pixel-perfect' ? 0 : totalPages,
        rasterizedPages: effectiveMode === 'semantic' ? 0 : totalPages,
        textBlocks,
        images,
        // Phase 4: surface the real counts (were hardcoded 0/[]). Vectors (Phase 2),
        // embedded faces (Phase 3), and the distinct source fonts that fell back to
        // a substitute because they aren't available as web fonts.
        vectors: doclingDoc.vectors?.length ?? 0,
        fontsEmbedded: embeddedFaces.length,
        fontsSubstituted: (() => {
          const out = new Set<string>();
          for (const t of doclingDoc.texts ?? []) {
            const fam = t.font?.family;
            if (!fam) continue;
            if (lookupEmbeddedFamily(fam, embeddedFontFamilies)) continue;
            if (resolveSourceFontFamily(fam).substituted) out.add(fam.replace(/^[A-Z]{6}\+/, ''));
          }
          return Array.from(out);
        })(),
      },
      recommendedMode: recommendation.mode,
      recommendedModeReason: recommendation.reason,
    };
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    const asyncFinalizationError =
      message.startsWith('Template finalization failed:') ||
      message.startsWith('Template finalization timed out');
    if (!asyncFinalizationError) {
      await invokeImport({
        operation: 'fail',
        import_id: importId,
        error: message,
      }).catch(() => {});
    }
    throw err;
  }
}
