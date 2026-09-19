// pdf-parse-chunk-callback — per-chunk completion endpoint for the chunked
// Docling pipeline (Wave G). The sidecar's /parse-chunk background task POSTs
// here as each page-range chunk finishes (or fails).
//
// Responsibilities
//   - Authenticate via the shared service token.
//   - Update the matching `pdf_import_chunks` row.
//   - On success: when every chunk for the job is `succeeded`, trigger the
//     finalizer (downloads chunk artifacts, merges into final docling.json /
//     document.md / outline.json / rasters.json, flips job → succeeded).
//   - On failure: increment attempts and either re-dispatch, split the chunk
//     into smaller spans (page-level fallback at span=1), or mark fatal.
//   - On too many fatal chunks: flip job → recoverable_failed so an operator
//     (or stuck-job recovery) can intervene.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { createTokenAuthCorsHeaders } from '../_shared/auth.ts';
import { validateSidecarOperationalMetricsV1 } from '../_shared/sidecarOperationalMetricsV1.pure.ts';
// E1 — Source Scene Graph V2 / Page Artifact Contract V3 versions.
//
// Both constants come from `sourceSceneGraphV2.pure.ts`, which is where
// `PAGE_ARTIFACT_CONTRACT_VERSION` is declared. It used to be imported from
// `pageArtifactContractV3.pure.ts`, which imports it for its own use and does
// not re-export it — so Deno refused this module at load time and every
// invocation of this function answered BOOT_ERROR. Importing a value from the
// module that consumes it rather than the one that declares it is the shape to
// watch for; `check-edge-function-imports.mjs` now fails the build on it.
import {
  SOURCE_SCENE_GRAPH_VERSION,
  PAGE_ARTIFACT_CONTRACT_VERSION as SOURCE_SCENE_PAGE_ARTIFACT_CONTRACT_VERSION,
} from '../_shared/sourceSceneGraphV2.pure.ts';
import {
  buildInvocationEnvelope,
  buildEdgeObservation,
  aggregateChunkMetrics,
  chooseChunkMetricsEnvelope,
  chunkEnvelopeToAggInput,
  type ChunkAggregationInput,
} from '../_shared/pdfOperationalMetricsEnvelope.pure.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CALLBACK_TOKEN = Deno.env.get('PDF_PARSE_SERVICE_TOKEN') ?? '';
const PARSE_URL = (Deno.env.get('PDF_PARSE_SERVICE_URL') ?? '').replace(/\/$/, '');
const DIAGNOSTICS_BUCKET = 'pdf-import-diagnostics';
const DOCLING_PAGE_REBASE_VERSION = 'chunk-page-rebase-v1';
const EDGE_FUNCTION_VERSION = Deno.env.get('SUPABASE_FUNCTION_VERSION') ?? null;
const MAX_MERGED_FONTS = 48;
const MAX_MERGED_FONT_BASE64_CHARS = 4 * Math.ceil((4 * 1024 * 1024) / 3);

// deno-lint-ignore no-explicit-any
type Admin = ReturnType<typeof createClient>;

interface ChunkRow {
  id: string;
  job_id: string;
  parent_chunk_id: string | null;
  chunk_index: number;
  page_start: number;
  page_end: number;
  status: string;
  attempts: number;
  max_attempts: number;
  artifact_paths: Record<string, unknown>;
}

async function appendJobAttempt(admin: Admin, jobId: string, entry: Record<string, unknown>) {
  const enriched = { ...entry, at: new Date().toISOString() };
  const { error } = await admin.rpc('append_pdf_import_attempt', {
    p_job_id: jobId,
    p_attempt: enriched,
  });
  if (!error) return;
  // Fallback: read-modify-write.
  const { data } = await admin.from('pdf_import_jobs').select('attempts').eq('id', jobId).maybeSingle();
  const attempts = Array.isArray((data as any)?.attempts) ? (data as any).attempts : [];
  await admin.from('pdf_import_jobs').update({ attempts: [...attempts, enriched] }).eq('id', jobId);
}

async function resignSourceUrl(admin: Admin, jobId: string): Promise<string | null> {
  const { data: job } = await admin
    .from('pdf_import_jobs')
    .select('plan_payload, request_payload')
    .eq('id', jobId)
    .maybeSingle();
  const plan = (job as any)?.plan_payload ?? {};
  const src = plan?.source ?? {};
  if (src.kind === 'storage' && src.bucket && src.path) {
    const { data, error } = await admin.storage.from(src.bucket).createSignedUrl(src.path, 1200);
    if (error || !data?.signedUrl) {
      console.error('[chunk-callback] re-sign failed', { jobId, error });
      return null;
    }
    return data.signedUrl;
  }
  if (src.kind === 'url' && typeof src.url === 'string') return src.url;
  return null;
}

async function dispatchChunk(admin: Admin, jobId: string, chunk: ChunkRow): Promise<void> {
  if (!PARSE_URL || !CALLBACK_TOKEN) {
    console.error('[chunk-callback] cannot dispatch — PARSE_URL/TOKEN missing');
    return;
  }
  const signedUrl = await resignSourceUrl(admin, jobId);
  if (!signedUrl) {
    await admin.from('pdf_import_chunks').update({
      status: 'fatal',
      error_code: 'source_fetch_error',
      error_text: 'source URL could not be re-signed',
      finished_at: new Date().toISOString(),
    }).eq('id', chunk.id);
    return;
  }
  const { data: job } = await admin
    .from('pdf_import_jobs')
    .select('mode, request_payload, plan_payload')
    .eq('id', jobId)
    .maybeSingle();
  const rp = ((job as any)?.request_payload ?? {}) as Record<string, unknown>;
  // C1.6: redispatch on the job's persisted effective mode + lane, not the raw
  // requested mode with a dropped lane.
  const plan = ((job as any)?.plan_payload ?? {}) as Record<string, unknown>;
  const mode = String(plan.dispatch_effective_mode ?? (job as any)?.mode ?? 'semantic');
  const selectedLane = String(plan.selected_lane ?? plan.recommended_lane ?? 'unplanned');
  await admin.from('pdf_import_chunks').update({
    status: 'dispatched',
    attempts: (chunk.attempts ?? 0) + 1,
    dispatched_at: new Date().toISOString(),
    error_code: null,
    error_text: null,
  }).eq('id', chunk.id);

  const body = {
    job_id: jobId,
    chunk_id: chunk.id,
    chunk_index: chunk.chunk_index,
    page_start: chunk.page_start,
    page_end: chunk.page_end,
    url: signedUrl,
    mode,
    extractor_lane: selectedLane,
    callback_url: `${SUPABASE_URL}/functions/v1/pdf-parse-chunk-callback`,
    callback_token: CALLBACK_TOKEN,
    enable_picture_description: (rp.description_tier === 'on' || rp.description_tier === 'premium')
      && plan.requires_picture_description === true,
    include_doctags: true,
    include_markdown: rp.include_markdown !== false,
    redact_pii: Boolean(rp.redact_pii),
    raster_dpi: mode === 'pixel_perfect' || mode === 'pixel-perfect' ? 200 : 144,
    raster_format: 'png',
  };
  try {
    const res = await fetch(`${PARSE_URL}/parse-chunk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CALLBACK_TOKEN}`,
        'X-Request-Id': jobId,
      },
      body: JSON.stringify(body),
    });
    if (res.status !== 202) {
      const text = await res.text().catch(() => '');
      console.error('[chunk-callback] re-dispatch non-202', { jobId, chunkId: chunk.id, status: res.status, text: text.slice(0, 300) });
      await admin.from('pdf_import_chunks').update({
        status: 'failed',
        error_code: `dispatch_http_${res.status}`,
        error_text: text.slice(0, 500),
      }).eq('id', chunk.id);
    }
  } catch (e) {
    console.error('[chunk-callback] re-dispatch exception', e);
    await admin.from('pdf_import_chunks').update({
      status: 'failed',
      error_code: 'dispatch_exception',
      error_text: String((e as Error)?.message ?? e).slice(0, 500),
    }).eq('id', chunk.id);
  }
}

async function nextChunkIndex(admin: Admin, jobId: string): Promise<number> {
  const { data } = await admin
    .from('pdf_import_chunks')
    .select('chunk_index')
    .eq('job_id', jobId)
    .order('chunk_index', { ascending: false })
    .limit(1);
  const max = Array.isArray(data) && data.length ? Number((data[0] as any).chunk_index) || 0 : 0;
  return max + 1;
}

/** Split a failing chunk into smaller spans and dispatch them. */
async function splitChunk(admin: Admin, jobId: string, chunk: ChunkRow): Promise<void> {
  const span = chunk.page_end - chunk.page_start + 1;
  if (span <= 1) {
    // Page-level fallback already failed — give up on this page.
    await admin.from('pdf_import_chunks').update({
      status: 'fatal',
      error_code: 'chunk_retry_exhausted',
      finished_at: new Date().toISOString(),
    }).eq('id', chunk.id);
    return;
  }
  // Split into halves (or single pages when span <= 5).
  const subSpan = span <= 5 ? 1 : Math.max(1, Math.floor(span / 2));
  const ranges: Array<[number, number]> = [];
  for (let s = chunk.page_start; s <= chunk.page_end; s += subSpan) {
    ranges.push([s, Math.min(chunk.page_end, s + subSpan - 1)]);
  }
  let nextIdx = await nextChunkIndex(admin, jobId);
  const newRows = ranges.map(([ps, pe]) => ({
    job_id: jobId,
    parent_chunk_id: chunk.id,
    chunk_index: nextIdx++,
    page_start: ps,
    page_end: pe,
    status: 'pending',
    max_attempts: chunk.max_attempts,
  }));
  const { data: inserted, error } = await admin
    .from('pdf_import_chunks')
    .insert(newRows)
    .select('id, job_id, parent_chunk_id, chunk_index, page_start, page_end, status, attempts, max_attempts, artifact_paths');
  if (error) {
    console.error('[chunk-callback] split insert failed', error);
    await admin.from('pdf_import_chunks').update({
      status: 'fatal',
      error_code: 'chunk_split_failed',
      error_text: error.message,
      finished_at: new Date().toISOString(),
    }).eq('id', chunk.id);
    return;
  }
  await admin.from('pdf_import_chunks').update({
    status: 'split',
    finished_at: new Date().toISOString(),
  }).eq('id', chunk.id);
  await appendJobAttempt(admin, jobId, {
    kind: 'split',
    parent_chunk_id: chunk.id,
    new_chunks: (inserted ?? []).length,
  });
  for (const row of inserted as ChunkRow[] ?? []) {
    await dispatchChunk(admin, jobId, row);
  }
}

async function downloadJson(admin: Admin, path: string): Promise<any | null> {
  const objectPath = path.startsWith(`${DIAGNOSTICS_BUCKET}/`) ? path.slice(DIAGNOSTICS_BUCKET.length + 1) : path;
  const { data, error } = await admin.storage.from(DIAGNOSTICS_BUCKET).download(objectPath);
  if (error || !data) return null;
  try {
    return JSON.parse(await data.text());
  } catch {
    return null;
  }
}

async function downloadText(admin: Admin, path: string): Promise<string | null> {
  const objectPath = path.startsWith(`${DIAGNOSTICS_BUCKET}/`) ? path.slice(DIAGNOSTICS_BUCKET.length + 1) : path;
  const { data, error } = await admin.storage.from(DIAGNOSTICS_BUCKET).download(objectPath);
  if (error || !data) return null;
  return await data.text();
}

async function uploadJson(admin: Admin, path: string, body: unknown): Promise<string | null> {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const { error } = await admin.storage.from(DIAGNOSTICS_BUCKET).upload(path, bytes, {
    contentType: 'application/json',
    upsert: true,
  });
  if (error) {
    console.error('[chunk-callback] upload json failed', { path, error });
    return null;
  }
  return path;
}

async function uploadText(admin: Admin, path: string, body: string, contentType: string): Promise<string | null> {
  const { error } = await admin.storage.from(DIAGNOSTICS_BUCKET).upload(path, new TextEncoder().encode(body), {
    contentType,
    upsert: true,
  });
  if (error) {
    console.error('[chunk-callback] upload text failed', { path, error });
    return null;
  }
  return path;
}


const MERGE_VALIDATION_VERSION = 'chunk-merge-validation-v1';
const TERMINAL_STATE_VERSION = 'terminal-state-normalizer-v1';
const CHUNK_REF_NAMESPACING_VERSION = 'chunk-ref-namespacing-v1';
const PER_PAGE_DOCLING_ARTIFACT_VERSION = 'per-page-docling-v1';

/**
 * Docling emits chunk-local `self_ref`/`$ref` strings (e.g. `#/texts/0`). When
 * chunk documents are concatenated into one merged document those indices
 * collide across chunks, so a picture's caption `$ref` in chunk 2 would resolve
 * to chunk 1's text 0 downstream. Namespace every ref with the chunk index so
 * refs stay internally consistent after the merge. Applied in place, per chunk,
 * before the chunk's items are pushed into the merged arrays.
 */
function namespaceChunkRefs(dd: any, chunkIndex: number): void {
  if (!dd || typeof dd !== 'object') return;
  const tag = `#/__c${chunkIndex}`;
  const rewriteRefString = (ref: string): string =>
    ref.startsWith('#/') ? `${tag}/${ref.slice(2)}` : ref;
  const rewriteRefObject = (obj: any): void => {
    if (!obj || typeof obj !== 'object') return;
    if (typeof obj.$ref === 'string') obj.$ref = rewriteRefString(obj.$ref);
    if (typeof obj.cref === 'string') obj.cref = rewriteRefString(obj.cref);
  };
  const rewriteItem = (item: any): void => {
    if (!item || typeof item !== 'object') return;
    if (typeof item.self_ref === 'string') item.self_ref = rewriteRefString(item.self_ref);
    rewriteRefObject(item.parent);
    for (const child of item.children ?? []) rewriteRefObject(child);
    for (const cap of item.captions ?? []) {
      if (typeof cap === 'string') continue; // string caption refs are rewritten below
      rewriteRefObject(cap);
    }
    if (Array.isArray(item.captions)) {
      item.captions = item.captions.map((cap: any) => (typeof cap === 'string' ? rewriteRefString(cap) : cap));
    }
    for (const ref of item.references ?? []) rewriteRefObject(ref);
  };
  for (const key of ['texts', 'tables', 'pictures', 'vectors', 'groups'] as const) {
    for (const item of dd[key] ?? []) rewriteItem(item);
  }
}

/**
 * Recompute per-page and average text confidence from the merged Docling texts
 * (whose `prov.page_no` values are already rebased to global). Mirrors the
 * monolithic sidecar `_summarise_doc` so chunked imports report the same
 * `page_confidence` / `avg_text_confidence` / `ocr_pages` signals the client's
 * mode recommender and per-page warnings depend on.
 */
function computeMergedConfidence(texts: any[]): {
  avg_text_confidence: number | null;
  page_confidence: Array<{ page_no: number; avg_text_confidence: number | null; text_block_count: number }>;
  ocr_pages: number[];
} {
  let confSum = 0;
  let confN = 0;
  const pageConf = new Map<number, { sum: number; count: number }>();
  const ocrPages = new Set<number>();
  const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

  for (const t of texts ?? []) {
    const provs = Array.isArray(t?.prov) ? t.prov : [];
    const origin = String(t?.origin ?? t?.source ?? '').toLowerCase();
    if (origin.includes('ocr')) {
      for (const p of provs) {
        if (typeof p?.page_no === 'number') ocrPages.add(p.page_no);
      }
    }
    const conf = t?.confidence;
    if (typeof conf === 'number' && conf >= 0 && conf <= 1) {
      confSum += conf;
      confN += 1;
      for (const p of provs) {
        const pn = p?.page_no;
        if (typeof pn !== 'number') continue;
        const bucket = pageConf.get(pn) ?? { sum: 0, count: 0 };
        bucket.sum += conf;
        bucket.count += 1;
        pageConf.set(pn, bucket);
      }
    }
  }

  const page_confidence = [...pageConf.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([page_no, vals]) => ({
      page_no,
      avg_text_confidence: vals.count ? round4(vals.sum / vals.count) : null,
      text_block_count: vals.count,
    }));

  return {
    avg_text_confidence: confN ? round4(confSum / confN) : null,
    page_confidence,
    ocr_pages: [...ocrPages].sort((a, b) => a - b),
  };
}

const PER_PAGE_DOCLING_PARENT_MANIFEST_VERSION = 'chunk-parent-pages-manifest-v1';
const PER_PAGE_DOCLING_PARENT_VALIDATION_VERSION = 'per-page-docling-parent-validation-v1';
const PER_PAGE_DOCLING_GLOBAL_ARTIFACT_COPY_VERSION = 'parent-global-page-artifact-copy-v1';
// C2.3: contract identifier surfaced to consumers alongside the manifest so they
// can recognize an OCR/vector-complete page-artifact manifest. Additive — the
// legacy `version` field is preserved for backward compatibility.
const PDF_PAGE_ARTIFACT_CONTRACT_VERSION = 'pdf-page-artifact-contract-v2';

function numberHistogram(values: number[]): Map<number, number> {
  const hist = new Map<number, number>();
  for (const raw of values) {
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    hist.set(n, (hist.get(n) ?? 0) + 1);
  }
  return hist;
}

function pageNumberReport(label: string, values: number[], expectedPageCount: number) {
  const hist = numberHistogram(values);
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
    expected_count: expectedPageCount,
    observed_count: values.length,
    unique_count: unique.length,
    min_page: unique.length ? unique[0] : null,
    max_page: unique.length ? unique[unique.length - 1] : null,
    duplicates,
    missing,
    out_of_range: outOfRange,
  };
}

function validateMergedArtifacts(
  chunkRows: any[],
  doclingPageNumbers: number[],
  parentRasterManifestPages: any[],
  pageRasterPaths: string[],
  finalPageCount: number,
) {
  const problems: string[] = [];
  const sortedChunks = [...chunkRows].sort((a, b) => Number(a.page_start ?? 0) - Number(b.page_start ?? 0));
  const chunkRanges = sortedChunks.map((c) => ({
    chunk_index: Number(c.chunk_index ?? 0),
    page_start: Number(c.page_start ?? 0),
    page_end: Number(c.page_end ?? 0),
    status: String(c.status ?? ''),
  }));

  let expectedNextPage = 1;
  let chunkCoverageOk = true;
  for (const c of chunkRanges) {
    if (c.page_start !== expectedNextPage) {
      chunkCoverageOk = false;
      problems.push(`chunk_range_gap_or_overlap_at_chunk_${c.chunk_index}: expected page ${expectedNextPage}, got ${c.page_start}`);
    }
    if (c.page_end < c.page_start) {
      chunkCoverageOk = false;
      problems.push(`invalid_chunk_range_at_chunk_${c.chunk_index}: ${c.page_start}-${c.page_end}`);
    }
    expectedNextPage = Math.max(expectedNextPage, c.page_end + 1);
  }

  const expectedFromChunks = Math.max(0, ...chunkRanges.map((c) => c.page_end));
  if (finalPageCount <= 0) {
    problems.push('final_page_count_not_positive');
  }
  if (expectedFromChunks !== finalPageCount) {
    problems.push(`final_page_count_mismatch: chunks end at ${expectedFromChunks}, finalPageCount is ${finalPageCount}`);
  }

  const doclingReport = pageNumberReport('docling_pages', doclingPageNumbers, finalPageCount);
  if (!doclingReport.ok) {
    problems.push('docling_page_numbers_not_continuous_or_unique');
  }

  const rasterPageNumbers = parentRasterManifestPages
    .map((p) => Number(p?.page_no ?? 0))
    .filter((n) => Number.isFinite(n) && n > 0);

  const rasterActive = parentRasterManifestPages.length > 0 || pageRasterPaths.length > 0;
  const rasterReport = rasterActive
    ? pageNumberReport('raster_manifest_pages', rasterPageNumbers, finalPageCount)
    : {
        label: 'raster_manifest_pages',
        ok: true,
        expected_count: finalPageCount,
        observed_count: 0,
        unique_count: 0,
        min_page: null,
        max_page: null,
        duplicates: [],
        missing: [],
        out_of_range: [],
      };

  if (rasterActive && !rasterReport.ok) {
    problems.push('raster_manifest_page_numbers_not_continuous_or_unique');
  }

  if (rasterActive && pageRasterPaths.length !== finalPageCount) {
    problems.push(`page_raster_paths_count_mismatch: expected ${finalPageCount}, got ${pageRasterPaths.length}`);
  }

  if (rasterActive && parentRasterManifestPages.length !== finalPageCount) {
    problems.push(`raster_manifest_entries_count_mismatch: expected ${finalPageCount}, got ${parentRasterManifestPages.length}`);
  }

  const duplicateRasterPaths = pageRasterPaths.filter(
    (path, index) => pageRasterPaths.indexOf(path) !== index,
  );
  if (duplicateRasterPaths.length > 0) {
    problems.push('page_raster_paths_not_unique');
  }

  return {
    version: MERGE_VALIDATION_VERSION,
    ok: problems.length === 0,
    expected_page_count: finalPageCount,
    expected_from_chunks: expectedFromChunks,
    chunk_count: sortedChunks.length,
    chunk_coverage: {
      ok: chunkCoverageOk,
      ranges: chunkRanges,
    },
    docling_pages: doclingReport,
    raster_manifest_pages: rasterReport,
    page_raster_paths_count: pageRasterPaths.length,
    raster_manifest_entries_count: parentRasterManifestPages.length,
    duplicate_raster_path_index_check: duplicateRasterPaths.length === 0,
    problems,
  };
}



async function copyParentGlobalPerPageArtifacts(
  admin: Admin,
  jobId: string,
  parentPages: any[],
): Promise<{ pages: any[]; copied_count: number; problems: string[] }> {
  const copiedPages: any[] = [];
  const problems: string[] = [];
  const copyTasks: Array<{
    page_index: number;
    page_no: number;
    key: string;
    file: string;
    source_path: string;
    dest_path: string;
  }> = [];

  const pathSpecs = [
    { key: 'docling_path', file: 'docling.json', required: true },
    { key: 'blocks_path', file: 'blocks.json', required: true },
    { key: 'tables_path', file: 'tables.json', required: false },
    { key: 'pictures_path', file: 'pictures.json', required: false },
    { key: 'summary_path', file: 'summary.json', required: true },
    // C2.2: OCR + vector artifacts. Optional (legacy chunks predate them), but
    // when present they must be re-homed to global paths like the rest, so the
    // parent manifest never references soon-deleted chunk-local paths.
    { key: 'ocr_path', file: 'ocr.json', required: false },
    { key: 'vectors_path', file: 'vectors.json', required: false },
    // E1: source-scene sibling JSON. `source_spans` / `foreground` carry no
    // internal crop paths, so a straight re-home is safe. `regions.json` DOES
    // reference chunk-local crop paths, so it is rehomed + rewritten separately
    // in copyParentGlobalSourceSceneCrops (never via this straight copy).
    { key: 'source_spans_path', file: 'source-spans.json', required: false },
    { key: 'foreground_path', file: 'foreground.json', required: false },
  ];

  for (const rawPage of parentPages) {
    const pageNo = Number(rawPage?.page_no ?? 0);
    if (!Number.isFinite(pageNo) || pageNo <= 0) {
      problems.push(`invalid_parent_page_no:${String(rawPage?.page_no ?? '')}`);
      continue;
    }

    const pagePrefix = `${jobId}/pages/page-${String(pageNo).padStart(3, '0')}`;
    const copiedPage: Record<string, unknown> = {
      ...rawPage,
      page_no: pageNo,
      global_artifact_prefix: pagePrefix,
      global_artifact_copy_version: PER_PAGE_DOCLING_GLOBAL_ARTIFACT_COPY_VERSION,
      source_chunk_artifact_paths: {},
    };

    const pageIndex = copiedPages.length;

    for (const spec of pathSpecs) {
      const sourcePath = typeof rawPage?.[spec.key] === 'string' ? String(rawPage[spec.key]) : '';
      if (!sourcePath) {
        if (spec.required) problems.push(`page_${pageNo}_${spec.key}_missing`);
        continue;
      }

      (copiedPage.source_chunk_artifact_paths as Record<string, string>)[spec.key] = sourcePath;

      copyTasks.push({
        page_index: pageIndex,
        page_no: pageNo,
        key: spec.key,
        file: spec.file,
        source_path: sourcePath,
        dest_path: `${pagePrefix}/${spec.file}`,
      });
    }

    copiedPages.push(copiedPage);
  }

  async function copyOne(task: typeof copyTasks[number]): Promise<boolean> {
    const sourceObjectPath = task.source_path.startsWith(`${DIAGNOSTICS_BUCKET}/`)
      ? task.source_path.slice(DIAGNOSTICS_BUCKET.length + 1)
      : task.source_path;

    // Fast path: server-side copy inside Supabase Storage.
    try {
      const { error: copyError } = await admin.storage
        .from(DIAGNOSTICS_BUCKET)
        .copy(sourceObjectPath, task.dest_path);

      if (!copyError) {
        copiedPages[task.page_index][task.key] = task.dest_path;
        return true;
      }

      const msg = String(copyError.message ?? copyError);
      if (
        msg.toLowerCase().includes('already exists')
        || msg.toLowerCase().includes('duplicate')
      ) {
        copiedPages[task.page_index][task.key] = task.dest_path;
        return true;
      }

      console.warn('[chunk-callback] storage copy failed; falling back to download/upload', {
        source: sourceObjectPath,
        dest: task.dest_path,
        error: msg.slice(0, 300),
      });
    } catch (e) {
      console.warn('[chunk-callback] storage copy exception; falling back to download/upload', {
        source: sourceObjectPath,
        dest: task.dest_path,
        error: String((e as Error)?.message ?? e).slice(0, 300),
      });
    }

    // Fallback path: download blob and upload with upsert.
    try {
      const { data, error: downloadError } = await admin.storage
        .from(DIAGNOSTICS_BUCKET)
        .download(sourceObjectPath);

      if (downloadError || !data) {
        problems.push(`page_${task.page_no}_${task.key}_download_failed`);
        return false;
      }

      const { error: uploadError } = await admin.storage
        .from(DIAGNOSTICS_BUCKET)
        .upload(task.dest_path, data, {
          contentType: 'application/json',
          upsert: true,
        });

      if (uploadError) {
        problems.push(`page_${task.page_no}_${task.key}_upload_failed`);
        return false;
      }

      copiedPages[task.page_index][task.key] = task.dest_path;
      return true;
    } catch (e) {
      problems.push(`page_${task.page_no}_${task.key}_copy_exception`);
      console.error('[chunk-callback] artifact copy exception', {
        page_no: task.page_no,
        key: task.key,
        source: sourceObjectPath,
        dest: task.dest_path,
        error: String((e as Error)?.message ?? e).slice(0, 500),
      });
      return false;
    }
  }

  let copiedCount = 0;
  const concurrency = 24;

  for (let i = 0; i < copyTasks.length; i += concurrency) {
    const batch = copyTasks.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(copyOne));
    copiedCount += results.filter(Boolean).length;
  }

  copiedPages.sort((a, b) => Number(a.page_no ?? 0) - Number(b.page_no ?? 0));

  return {
    pages: copiedPages,
    copied_count: copiedCount,
    problems,
  };
}

/**
 * E1 — parent-global copy of Source Scene Graph V2 region crops + regions.json.
 *
 * Region IDs are already parent-global (the sidecar rebases them), so this only
 * re-homes the PNG crops to `${jobId}/pages/page-NNN/regions/<id>.png`, rewrites
 * every internal `sourceCrop.path` inside regions.json, and rewrites each page's
 * `region_crop_paths` map. The parent-preferred manifest therefore never points
 * at a soon-deleted chunk-local crop path. Mutates `parentPages` in place.
 */
async function copyParentGlobalSourceSceneCrops(
  admin: Admin,
  jobId: string,
  parentPages: any[],
): Promise<{ copied_count: number; total_crop_count: number; total_region_count: number; total_critical_region_count: number; problems: string[] }> {
  const problems: string[] = [];
  let copiedCount = 0;
  let totalCrops = 0;
  let totalRegions = 0;
  let totalCritical = 0;

  const stripBucket = (p: string): string =>
    p.startsWith(`${DIAGNOSTICS_BUCKET}/`) ? p.slice(DIAGNOSTICS_BUCKET.length + 1) : p;

  for (const page of parentPages) {
    const pageNo = Number(page?.page_no ?? 0);
    if (!Number.isFinite(pageNo) || pageNo <= 0) continue;
    const pagePrefix = `${jobId}/pages/page-${String(pageNo).padStart(3, '0')}`;

    const chunkCropPaths = (page?.region_crop_paths && typeof page.region_crop_paths === 'object')
      ? page.region_crop_paths as Record<string, string>
      : {};
    const globalCropPaths: Record<string, string> = {};

    for (const [regionId, chunkPath] of Object.entries(chunkCropPaths)) {
      if (typeof chunkPath !== 'string' || !chunkPath) continue;
      // Deterministic global crop path derived from the (parent-global) region ID.
      const destPath = `${pagePrefix}/regions/${regionId}.png`;
      totalCrops += 1;
      try {
        const { error } = await admin.storage.from(DIAGNOSTICS_BUCKET).copy(stripBucket(chunkPath), destPath);
        const msg = error ? String(error.message ?? error).toLowerCase() : '';
        if (!error || msg.includes('already exists') || msg.includes('duplicate')) {
          globalCropPaths[regionId] = destPath;
          copiedCount += 1;
          continue;
        }
      } catch { /* fall through to download/upload */ }
      try {
        const { data, error: dErr } = await admin.storage.from(DIAGNOSTICS_BUCKET).download(stripBucket(chunkPath));
        if (dErr || !data) { problems.push(`page_${pageNo}_crop_${regionId}_download_failed`); continue; }
        const { error: uErr } = await admin.storage.from(DIAGNOSTICS_BUCKET).upload(destPath, data, { contentType: 'image/png', upsert: true });
        if (uErr) { problems.push(`page_${pageNo}_crop_${regionId}_upload_failed`); continue; }
        globalCropPaths[regionId] = destPath;
        copiedCount += 1;
      } catch { problems.push(`page_${pageNo}_crop_${regionId}_copy_exception`); }
    }
    page.region_crop_paths = globalCropPaths;

    // Re-home + rewrite regions.json so its internal sourceCrop.path values are global.
    const chunkRegionsPath = typeof page?.regions_path === 'string' ? page.regions_path : '';
    if (chunkRegionsPath) {
      const destRegionsPath = `${pagePrefix}/regions.json`;
      try {
        const { data, error } = await admin.storage.from(DIAGNOSTICS_BUCKET).download(stripBucket(chunkRegionsPath));
        if (error || !data) {
          problems.push(`page_${pageNo}_regions_download_failed`);
        } else {
          const parsed = JSON.parse(await data.text());
          const regions = Array.isArray(parsed?.regions) ? parsed.regions : [];
          totalRegions += regions.length;
          for (const region of regions) {
            if (region?.type && region.type !== 'text' && region.type !== 'background') totalCritical += 1;
            const rid = region?.id;
            if (rid && globalCropPaths[rid] && region.sourceCrop) region.sourceCrop.path = globalCropPaths[rid];
          }
          const body = new TextEncoder().encode(JSON.stringify(parsed));
          const { error: uErr } = await admin.storage.from(DIAGNOSTICS_BUCKET).upload(destRegionsPath, body, { contentType: 'application/json', upsert: true });
          if (uErr) problems.push(`page_${pageNo}_regions_upload_failed`);
          else page.regions_path = destRegionsPath;
        }
      } catch { problems.push(`page_${pageNo}_regions_rewrite_exception`); }
    }
  }

  return { copied_count: copiedCount, total_crop_count: totalCrops, total_region_count: totalRegions, total_critical_region_count: totalCritical, problems };
}


function validateParentPerPageDoclingManifest(
  parentPages: any[],
  finalPageCount: number,
  chunkProblems: string[] = [],
) {
  const pageNumbers = parentPages
    .map((p) => Number(p?.page_no ?? 0))
    .filter((n) => Number.isFinite(n) && n > 0);

  const report = pageNumberReport('per_page_docling_pages', pageNumbers, finalPageCount);
  const problems = [...chunkProblems];

  if (!report.ok) {
    problems.push('per_page_docling_page_numbers_not_continuous_or_unique');
  }

  if (parentPages.length !== finalPageCount) {
    problems.push(`per_page_docling_entries_count_mismatch: expected ${finalPageCount}, got ${parentPages.length}`);
  }

  return {
    version: PER_PAGE_DOCLING_PARENT_VALIDATION_VERSION,
    ok: problems.length === 0,
    expected_page_count: finalPageCount,
    observed_page_count: parentPages.length,
    page_numbers: report,
    problems,
  };
}

/** Merge per-chunk Docling outputs into final artifacts and finalize the job. */
async function finalizeJob(admin: Admin, jobId: string): Promise<void> {
  const startedAt = Date.now();
  const mergePerfStart = performance.now();
  await admin.from('pdf_import_jobs').update({
    stage: 'finalizing',
    stage_started_at: new Date(startedAt).toISOString(),
  }).eq('id', jobId);

  const { data: chunkRows, error: chunkErr } = await admin
    .from('pdf_import_chunks')
    .select('id, chunk_index, page_start, page_end, status, artifact_paths, summary, operational_metrics')
    .eq('job_id', jobId)
    .neq('status', 'split')
    .order('chunk_index', { ascending: true });
  if (chunkErr || !chunkRows) {
    console.error('[chunk-callback] finalize: chunk fetch failed', chunkErr);
    await admin.from('pdf_import_jobs').update({
      status: 'recoverable_failed',
      stage: 'failed',
      error_code: 'final_merge_failed',
      error_text: chunkErr?.message ?? 'no chunks',
      finished_at: new Date().toISOString(),
    }).eq('id', jobId);
    return;
  }

  // Sanity: every non-split chunk must be succeeded.
  const notDone = chunkRows.filter((c: any) => c.status !== 'succeeded');
  if (notDone.length > 0) {
    console.warn('[chunk-callback] finalize aborted — not all chunks succeeded', { jobId, notDone: notDone.length });
    return;
  }

  // Merge docling.json files in chunk order. Each chunk's pages start at 1
  // locally — we rebase to global page numbers using page_start.
  const mergedDoc: any = {
    schema_name: 'DoclingDocument',
    name: 'merged',
    texts: [],
    tables: [],
    pictures: [],
    vectors: [],
    fonts: [],
    pages: {},
  };
  const mergedFontNames = new Set<string>();
  let mergedFontBase64Chars = 0;
  const mergedOutline: any[] = [];
  const pageLanguages: Record<string, string> = {};
  const markdownParts: string[] = [];
  const doctagsParts: string[] = [];
  const rasterPages: any[] = [];
  const chunkRasterManifestPaths: string[] = [];
  const pageRasterPaths: string[] = [];
  const parentRasterManifestPages: any[] = [];
  const chunkPerPageDoclingManifestPaths: string[] = [];
  const parentPerPageDoclingPages: any[] = [];
  const perPageDoclingProblems: string[] = [];
  const doclingPageNumbers: number[] = [];
  const chunkExtractorLanes: string[] = [];
  const chunkLaneVersions: string[] = [];
  const chunkEffectiveModes: string[] = [];
  const chunkLanePolicies: any[] = [];
  let totalTextChars = 0;
  let totalOcrChars = 0;
  let totalTableCells = 0;
  let totalPictures = 0;
  let totalTables = 0;
  let totalTexts = 0;
  let pageCount = 0;
  let maxChunkPageEnd = 0;

  for (const c of chunkRows as any[]) {
    maxChunkPageEnd = Math.max(maxChunkPageEnd, Number(c.page_end ?? 0));
    const offset = c.page_start - 1;
    const ap = (c.artifact_paths ?? {}) as Record<string, any>;

    if (typeof ap.extractor_lane === 'string' && ap.extractor_lane.trim()) {
      chunkExtractorLanes.push(ap.extractor_lane.trim());
    }
    if (typeof ap.lane_enforcement_version === 'string' && ap.lane_enforcement_version.trim()) {
      chunkLaneVersions.push(ap.lane_enforcement_version.trim());
    }
    if (typeof ap.effective_mode === 'string' && ap.effective_mode.trim()) {
      chunkEffectiveModes.push(ap.effective_mode.trim());
    }
    if (ap.lane_policy && typeof ap.lane_policy === 'object') {
      chunkLanePolicies.push(ap.lane_policy);
    }

    if (ap.docling_path) {
      const dd = await downloadJson(admin, ap.docling_path);
      if (dd && typeof dd === 'object') {
        // Namespace chunk-local self_ref/$ref strings so they don't collide
        // across chunks once the arrays are concatenated below.
        namespaceChunkRefs(dd, Number(c.chunk_index ?? 0));
        const rebaseProv = (node: any) => {
          if (!node) return;
          const provs = node?.prov;
          if (Array.isArray(provs)) {
            for (const p of provs) {
              if (typeof p?.page_no === 'number') p.page_no = p.page_no + offset;
            }
          }
        };
        for (const t of dd.texts ?? []) { rebaseProv(t); mergedDoc.texts.push(t); }
        for (const t of dd.tables ?? []) { rebaseProv(t); mergedDoc.tables.push(t); }
        for (const p of dd.pictures ?? []) { rebaseProv(p); mergedDoc.pictures.push(p); }
        // Phase 2: carry vector graphics through the chunk merge (rebase page_no).
        for (const v of dd.vectors ?? []) { rebaseProv(v); mergedDoc.vectors.push(v); }
        // Phase 3: carry document fonts through, deduped by family name.
        for (const fnt of dd.fonts ?? []) {
          const key = String(fnt?.basename ?? fnt?.psName ?? '').toLowerCase();
          if (!key || mergedFontNames.has(key) || mergedDoc.fonts.length >= MAX_MERGED_FONTS) continue;
          const font = { ...fnt };
          const base64Chars = typeof font.base64 === 'string' ? font.base64.length : 0;
          if (base64Chars > MAX_MERGED_FONT_BASE64_CHARS - mergedFontBase64Chars) {
            delete font.base64;
          } else {
            mergedFontBase64Chars += base64Chars;
          }
          mergedFontNames.add(key);
          mergedDoc.fonts.push(font);
        }
        const pages = dd.pages ?? {};
        for (const [k, v] of Object.entries(pages)) {
          const localNo = Number(k);
          const globalNo = localNo + offset;
          doclingPageNumbers.push(globalNo);
          const pageValue = v && typeof v === 'object'
            ? { ...(v as Record<string, unknown>), page_no: globalNo }
            : v;
          (mergedDoc.pages as any)[String(globalNo)] = pageValue;
          if (globalNo > pageCount) pageCount = globalNo;
        }
      }
    }
    if (ap.outline_path) {
      const outlinePayload = await downloadJson(admin, ap.outline_path);
      const outline = outlinePayload?.outline ?? [];
      for (const entry of outline) {
        if (entry && typeof entry.page_no === 'number') entry.page_no = entry.page_no + offset;
        mergedOutline.push(entry);
      }
      const langs = outlinePayload?.page_languages ?? {};
      for (const [k, v] of Object.entries(langs)) {
        const globalNo = Number(k) + offset;
        pageLanguages[String(globalNo)] = String(v);
      }
    }
    if (ap.markdown_path) {
      const md = await downloadText(admin, ap.markdown_path);
      if (md) markdownParts.push(`<!-- pages ${c.page_start}-${c.page_end} -->\n${md}`);
    }
    if (ap.doctags_path) {
      const dt = await downloadText(admin, ap.doctags_path);
      if (dt) doctagsParts.push(`<!-- pages ${c.page_start}-${c.page_end} -->\n${dt}`);
    }
    if (ap.rasters_path) {
      const rj = await downloadJson(admin, ap.rasters_path);
      if (rj?.pages && Array.isArray(rj.pages)) {
        for (const p of rj.pages) {
          rasterPages.push({
            page_no: typeof p.global_page_no === 'number' ? p.global_page_no : (Number(p.page_no) + offset),
            width: p.width,
            height: p.height,
            image_base64: p.image_base64,
          });
        }
      }
    }

    if (ap.rasters_manifest_path) {
      chunkRasterManifestPaths.push(ap.rasters_manifest_path);
      const manifest = await downloadJson(admin, ap.rasters_manifest_path);
      if (manifest?.pages && Array.isArray(manifest.pages)) {
        for (const page of manifest.pages) {
          const localPageNo = Number(page.page_no ?? 0);
          const globalPageNo = typeof page.global_page_no === 'number'
            ? page.global_page_no
            : localPageNo + offset;

          if (typeof page.path === 'string' && page.path) {
            pageRasterPaths.push(page.path);
          }

          parentRasterManifestPages.push({
            page_no: globalPageNo,
            source_chunk_index: c.chunk_index,
            source_chunk_page_no: localPageNo || null,
            width: page.width ?? null,
            height: page.height ?? null,
            path: page.path ?? null,
            mime: page.mime ?? 'image/png',
            bytes: page.bytes ?? null,
          });
        }
      }
    }

    const chunkPageRasterPaths = Array.isArray((ap as any).page_raster_paths)
      ? ((ap as any).page_raster_paths as unknown[]).filter((v): v is string => typeof v === 'string')
      : [];
    for (const path of chunkPageRasterPaths) {
      if (!pageRasterPaths.includes(path)) pageRasterPaths.push(path);
    }

    const expectedChunkPageCount = Math.max(0, Number(c.page_end ?? 0) - Number(c.page_start ?? 0) + 1);
    const perPageVersion = typeof ap.per_page_docling_artifact_version === 'string'
      ? ap.per_page_docling_artifact_version
      : '';
    const perPageManifestPath = typeof ap.per_page_docling_manifest_path === 'string'
      ? ap.per_page_docling_manifest_path
      : '';
    const perPageChunkCount = Number(ap.per_page_docling_page_count ?? 0);
    const perPageValidationOk = Boolean((ap.per_page_docling_validation as any)?.ok);

    if (perPageVersion !== PER_PAGE_DOCLING_ARTIFACT_VERSION) {
      perPageDoclingProblems.push(`chunk_${c.chunk_index}_per_page_version_missing_or_invalid`);
    }
    if (!perPageManifestPath) {
      perPageDoclingProblems.push(`chunk_${c.chunk_index}_per_page_manifest_path_missing`);
    }
    if (perPageChunkCount !== expectedChunkPageCount) {
      perPageDoclingProblems.push(`chunk_${c.chunk_index}_per_page_count_mismatch: expected ${expectedChunkPageCount}, got ${perPageChunkCount}`);
    }
    if (!perPageValidationOk) {
      perPageDoclingProblems.push(`chunk_${c.chunk_index}_per_page_validation_not_ok`);
    }

    if (perPageManifestPath) {
      chunkPerPageDoclingManifestPaths.push(perPageManifestPath);
      const perPageManifest = await downloadJson(admin, perPageManifestPath);
      const perPageManifestPages = Array.isArray(perPageManifest?.pages) ? perPageManifest.pages : [];

      if (perPageManifestPages.length !== expectedChunkPageCount) {
        perPageDoclingProblems.push(`chunk_${c.chunk_index}_per_page_manifest_entries_mismatch: expected ${expectedChunkPageCount}, got ${perPageManifestPages.length}`);
      }

      for (const rawPage of perPageManifestPages) {
        if (!rawPage || typeof rawPage !== 'object') continue;

        const sourceChunkPageNo = Number((rawPage as any).source_chunk_page_no ?? 0);
        let globalPageNo = Number((rawPage as any).page_no ?? 0);

        // Chunk sidecar should already emit global page numbers, but keep a safe fallback.
        if (
          (!Number.isFinite(globalPageNo) || globalPageNo < Number(c.page_start) || globalPageNo > Number(c.page_end))
          && Number.isFinite(sourceChunkPageNo)
          && sourceChunkPageNo > 0
        ) {
          globalPageNo = Number(c.page_start) + sourceChunkPageNo - 1;
        }

        parentPerPageDoclingPages.push({
          ...(rawPage as Record<string, unknown>),
          page_no: globalPageNo,
          source_chunk_index: Number(c.chunk_index ?? 0),
          source_chunk_page_no: sourceChunkPageNo || (globalPageNo - Number(c.page_start) + 1),
          source_manifest_path: perPageManifestPath,
        });
      }
    }

    const s = (c.summary ?? {}) as any;
    totalTextChars += Number(s.text_chars ?? 0);
    totalOcrChars += Number(s.ocr_chars ?? 0);
    totalTableCells += Number(s.table_cell_count ?? 0);
    totalPictures += Number(s.picture_count ?? 0);
    totalTables += Number(s.table_count ?? 0);
    totalTexts += Number(s.text_block_count ?? 0);
  }

  const mergedConfidence = computeMergedConfidence(mergedDoc.texts as any[]);
  const summary = {
    text_chars: totalTextChars,
    ocr_chars: totalOcrChars,
    table_count: totalTables,
    table_cell_count: totalTableCells,
    picture_count: totalPictures,
    text_block_count: totalTexts,
    // Phase 5: mirror the monolithic summary so chunked imports also report these
    // (observability parity; the merged arrays are already populated above).
    vector_count: mergedDoc.vectors.length,
    font_count: mergedDoc.fonts.length,
    // Recomputed from the merged, page-rebased texts so chunked imports report
    // the same confidence signals as monolithic ones — the client's fidelity-
    // mode recommender and per-page low-confidence warnings read these.
    avg_text_confidence: mergedConfidence.avg_text_confidence,
    page_confidence: mergedConfidence.page_confidence,
    ocr_pages: mergedConfidence.ocr_pages,
    chunked: true,
    chunk_count: chunkRows.length,
  };
  (mergedDoc as any).summary = summary;

  const doclingPath = await uploadJson(admin, `${jobId}/docling.json`, mergedDoc);
  const outlinePath = await uploadJson(admin, `${jobId}/outline.json`, { outline: mergedOutline, page_languages: pageLanguages });
  const markdownPath = markdownParts.length
    ? await uploadText(admin, `${jobId}/document.md`, markdownParts.join('\n\n'), 'text/markdown')
    : null;
  const doctagsPath = doctagsParts.length
    ? await uploadText(admin, `${jobId}/doctags.md`, doctagsParts.join('\n\n'), 'text/markdown')
    : null;
  const rastersPath = rasterPages.length
    ? await uploadJson(admin, `${jobId}/rasters.json`, { format: 'png', pages: rasterPages })
    : null;

  parentRasterManifestPages.sort((a, b) => Number(a.page_no ?? 0) - Number(b.page_no ?? 0));
  const rasterManifestMaxPage = parentRasterManifestPages.reduce((max, page) => {
    const pageNo = Number(page?.page_no ?? 0);
    return Number.isFinite(pageNo) ? Math.max(max, pageNo) : max;
  }, 0);
  const finalPageCount = Math.max(
    pageCount,
    maxChunkPageEnd,
    rasterManifestMaxPage,
    pageRasterPaths.length,
  );

  parentPerPageDoclingPages.sort((a, b) => Number(a.page_no ?? 0) - Number(b.page_no ?? 0));

  const parentGlobalPerPageArtifacts = await copyParentGlobalPerPageArtifacts(
    admin,
    jobId,
    parentPerPageDoclingPages,
  );

  const parentGlobalPerPagePages = parentGlobalPerPageArtifacts.pages;

  // E1 — re-home + rewrite the Source Scene Graph V2 crops + regions.json so the
  // parent-preferred manifest never references chunk-local crop paths.
  const sceneCropCopy = await copyParentGlobalSourceSceneCrops(admin, jobId, parentGlobalPerPagePages);
  const anySceneGraph = parentGlobalPerPagePages.some(
    (p: any) => typeof p?.scene_graph_version === 'string' && p.scene_graph_version,
  );

  const perPageDoclingValidation = validateParentPerPageDoclingManifest(
    parentGlobalPerPagePages,
    finalPageCount,
    [
      ...perPageDoclingProblems,
      ...parentGlobalPerPageArtifacts.problems,
      ...sceneCropCopy.problems,
    ],
  );

  const perPageDoclingManifestPath = parentGlobalPerPagePages.length
    ? await uploadJson(admin, `${jobId}/pages-manifest.json`, {
        version: PER_PAGE_DOCLING_ARTIFACT_VERSION,
        // E1: promote the merged parent manifest to V3 only when every chunk
        // produced a scene graph; otherwise keep the V2 contract marker so a
        // partial merge can never masquerade as a complete V3.
        artifact_contract_version: anySceneGraph
          ? SOURCE_SCENE_PAGE_ARTIFACT_CONTRACT_VERSION
          : PDF_PAGE_ARTIFACT_CONTRACT_VERSION,
        ...(anySceneGraph
          ? {
              scene_graph_version: SOURCE_SCENE_GRAPH_VERSION,
              source_scene_path: `${jobId}/source-scene.json`,
              total_region_count: sceneCropCopy.total_region_count,
              total_critical_region_count: sceneCropCopy.total_critical_region_count,
              total_crop_count: sceneCropCopy.total_crop_count,
            }
          : {}),
        parent_manifest_version: PER_PAGE_DOCLING_PARENT_MANIFEST_VERSION,
        global_artifact_copy_version: PER_PAGE_DOCLING_GLOBAL_ARTIFACT_COPY_VERSION,
        source: 'chunk-merge-global-artifacts',
        job_id: jobId,
        page_count: finalPageCount,
        generated_at: new Date().toISOString(),
        pages: parentGlobalPerPagePages,
        chunk_per_page_docling_manifest_paths: chunkPerPageDoclingManifestPaths,
        global_per_page_artifact_copy: {
          version: PER_PAGE_DOCLING_GLOBAL_ARTIFACT_COPY_VERSION,
          copied_artifact_count: parentGlobalPerPageArtifacts.copied_count,
          source_scene_crops_copied: sceneCropCopy.copied_count,
          problems: [...parentGlobalPerPageArtifacts.problems, ...sceneCropCopy.problems],
        },
        validation: perPageDoclingValidation,
      })
    : null;

  const rastersManifestPath = parentRasterManifestPages.length
    ? await uploadJson(admin, `${jobId}/rasters-manifest.json`, {
        version: 'phase3-raster-manifest-v1',
        source: 'chunk-merge',
        page_count: finalPageCount,
        pages: parentRasterManifestPages,
        chunk_raster_manifest_paths: chunkRasterManifestPaths,
      })
    : null;

  const mergeValidation = validateMergedArtifacts(
    chunkRows as any[],
    doclingPageNumbers,
    parentRasterManifestPages,
    pageRasterPaths,
    finalPageCount,
  );
  if (!perPageDoclingValidation.ok) {
    mergeValidation.ok = false;
    mergeValidation.problems.push('per_page_docling_parent_validation_failed');
    for (const problem of perPageDoclingValidation.problems ?? []) {
      mergeValidation.problems.push(String(problem));
    }
  }

  const mergeValidationPath = await uploadJson(admin, `${jobId}/merge-validation.json`, mergeValidation);

  if (!mergeValidation.ok) {
    console.error('[chunk-callback] merge validation failed', {
      jobId,
      problems: mergeValidation.problems,
    });

    await admin.from('pdf_import_jobs').update({
      status: 'recoverable_failed',
      stage: 'failed',
      page_count: finalPageCount,
      pages_total: finalPageCount,
      pages_completed: Math.min(pageRasterPaths.length, finalPageCount),
      diagnostics_path: doclingPath,
      error_code: 'chunk_merge_validation_failed',
      error_text: mergeValidation.problems.join('; ').slice(0, 1000),
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      result_payload: {
        chunked: true,
        docling_path: doclingPath,
        outline_path: outlinePath,
        markdown_path: markdownPath,
        doctags_path: doctagsPath,
        rasters_path: rastersPath,
        legacy_rasters_path: rastersPath,
        rasters_manifest_path: rastersManifestPath,
        chunk_raster_manifest_paths: chunkRasterManifestPaths,
        page_raster_paths: pageRasterPaths,
        per_page_docling_artifact_version: PER_PAGE_DOCLING_ARTIFACT_VERSION,
        per_page_docling_parent_manifest_version: PER_PAGE_DOCLING_PARENT_MANIFEST_VERSION,
        per_page_docling_global_artifact_copy_version: PER_PAGE_DOCLING_GLOBAL_ARTIFACT_COPY_VERSION,
        per_page_docling_manifest_path: perPageDoclingManifestPath,
        per_page_docling_page_count: parentGlobalPerPagePages.length,
        per_page_docling_validation: perPageDoclingValidation,
        per_page_docling_global_artifact_copy: {
          version: PER_PAGE_DOCLING_GLOBAL_ARTIFACT_COPY_VERSION,
          copied_artifact_count: parentGlobalPerPageArtifacts.copied_count,
          problems: parentGlobalPerPageArtifacts.problems,
        },
        chunk_per_page_docling_manifest_paths: chunkPerPageDoclingManifestPaths,
        artifact_contract_version: 'raster-manifest-v1',
        docling_page_rebase_version: DOCLING_PAGE_REBASE_VERSION,
        chunk_merge_validation_version: MERGE_VALIDATION_VERSION,
        chunk_ref_namespacing_version: CHUNK_REF_NAMESPACING_VERSION,
        merge_validation_path: mergeValidationPath,
        merge_validation: mergeValidation,
        terminal_state_version: TERMINAL_STATE_VERSION,
        page_count: finalPageCount,
        summary: {
          ...summary,
          page_count: finalPageCount,
          docling_page_count: pageCount,
          raster_page_count: pageRasterPaths.length,
        },
      },
    }).eq('id', jobId);
    return;
  }

  if (!doclingPath) {
    await admin.from('pdf_import_jobs').update({
      status: 'recoverable_failed',
      stage: 'failed',
      error_code: 'final_merge_failed',
      error_text: 'failed to upload merged docling.json',
      finished_at: new Date().toISOString(),
    }).eq('id', jobId);
    return;
  }

  const { data: existing } = await admin
    .from('pdf_import_jobs')
    .select('started_at, result_payload, mode, plan_payload')
    .eq('id', jobId)
    .maybeSingle();
  const startedJob = (existing as any)?.started_at ? new Date((existing as any).started_at).getTime() : startedAt;
  const finished = Date.now();
  const prior = ((existing as any)?.result_payload ?? {}) as Record<string, unknown>;
  const planPayload = ((existing as any)?.plan_payload ?? {}) as Record<string, unknown>;

  // C11 — honest parent aggregation. `parent_elapsed_ms` is the job wall clock
  // (started_at → finalize done), measured independently of the chunk sums;
  // `merge_ms` is the finalize/merge wall time alone. Only valid V1 chunk metrics
  // feed the sums/maxima; legacy/invalid/missing are counted, not fabricated.
  const parentElapsedMs = finished - startedJob;
  const mergeMs = Math.round(performance.now() - mergePerfStart);
  const chunkAggInputs: ChunkAggregationInput[] = (chunkRows as any[]).map((c) =>
    chunkEnvelopeToAggInput(c.operational_metrics, null),
  );
  const parentAggregation = aggregateChunkMetrics({
    chunks: chunkAggInputs,
    parentElapsedMs,
    mergeMs,
  });
  const finalizeEdge = buildEdgeObservation({
    callbackReceivedAt: new Date(finished).toISOString(),
    edgeProcessingMs: mergeMs,
    operation: 'parent_finalize',
    edgeFunctionVersion: EDGE_FUNCTION_VERSION,
  });
  const parentOperationalMetrics = { ...parentAggregation, finalize_edge: finalizeEdge };

  const parentExtractorLane = String(
    chunkExtractorLanes[0]
      ?? prior.extractor_lane
      ?? planPayload.selected_lane
      ?? planPayload.recommended_lane
      ?? 'unplanned'
  );

  const parentLaneEnforcementVersion = String(
    chunkLaneVersions[0]
      ?? prior.lane_enforcement_version
      ?? 'extractor-lane-policy-v1'
  );

  const parentEffectiveMode = String(
    chunkEffectiveModes[0]
      ?? prior.effective_mode
      ?? planPayload.dispatch_effective_mode
      ?? (existing as any)?.mode
      ?? 'semantic'
  );

  const parentLanePolicy = chunkLanePolicies[0]
    ?? prior.lane_policy
    ?? {
      lane: parentExtractorLane,
      version: parentLaneEnforcementVersion,
      requested_mode: String(planPayload.requested_mode ?? (existing as any)?.mode ?? 'semantic'),
    };

  await admin.from('pdf_import_jobs').update({
    status: 'succeeded',
    stage: 'parsed',
    error_code: null,
    error_text: null,
    page_count: finalPageCount,
    pages_total: finalPageCount,
    pages_completed: finalPageCount,
    diagnostics_path: doclingPath,
    callback_received_at: new Date(finished).toISOString(),
    finished_at: new Date(finished).toISOString(),
    updated_at: new Date(finished).toISOString(),
    duration_ms: finished - startedJob,
    operational_metrics: parentOperationalMetrics,
    result_payload: {
      ...prior,
      chunked: true,
      docling_path: doclingPath,
      outline_path: outlinePath,
      markdown_path: markdownPath,
      doctags_path: doctagsPath,
      rasters_path: rastersPath,
      legacy_rasters_path: rastersPath,
      rasters_manifest_path: rastersManifestPath,
      chunk_raster_manifest_paths: chunkRasterManifestPaths,
      page_raster_paths: pageRasterPaths,
      per_page_docling_artifact_version: PER_PAGE_DOCLING_ARTIFACT_VERSION,
      per_page_docling_parent_manifest_version: PER_PAGE_DOCLING_PARENT_MANIFEST_VERSION,
      per_page_docling_global_artifact_copy_version: PER_PAGE_DOCLING_GLOBAL_ARTIFACT_COPY_VERSION,
      per_page_docling_manifest_path: perPageDoclingManifestPath,
      per_page_docling_page_count: parentGlobalPerPagePages.length,
      per_page_docling_validation: perPageDoclingValidation,
      per_page_docling_global_artifact_copy: {
        version: PER_PAGE_DOCLING_GLOBAL_ARTIFACT_COPY_VERSION,
        copied_artifact_count: parentGlobalPerPageArtifacts.copied_count,
        problems: parentGlobalPerPageArtifacts.problems,
      },
      chunk_per_page_docling_manifest_paths: chunkPerPageDoclingManifestPaths,
      artifact_contract_version: 'raster-manifest-v1',
      docling_page_rebase_version: DOCLING_PAGE_REBASE_VERSION,
      chunk_merge_validation_version: MERGE_VALIDATION_VERSION,
      chunk_ref_namespacing_version: CHUNK_REF_NAMESPACING_VERSION,
      merge_validation_path: mergeValidationPath,
      merge_validation: mergeValidation,
      terminal_state_version: TERMINAL_STATE_VERSION,
      extractor_lane: parentExtractorLane,
      lane_enforcement_version: parentLaneEnforcementVersion,
      effective_mode: parentEffectiveMode,
      lane_policy: parentLanePolicy,
      page_count: finalPageCount,
      summary: {
        ...summary,
        page_count: finalPageCount,
        docling_page_count: pageCount,
        raster_page_count: pageRasterPaths.length,
      },
    },
  }).eq('id', jobId);
  console.log('[chunk-callback] finalized', { jobId, pageCount: finalPageCount, doclingPageCount: pageCount, rasterPageCount: pageRasterPaths.length, chunks: chunkRows.length });
}

Deno.serve(async (req) => {
  // C11 — monotonic Edge-processing timer (measures validation/persistence up to
  // the DB write; boundary documented, no second fragile update).
  const edgeStart = performance.now();
  const cors = createTokenAuthCorsHeaders();
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const auth = req.headers.get('authorization') ?? '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!CALLBACK_TOKEN || token !== CALLBACK_TOKEN) return json({ error: 'unauthorised' }, 401);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const operation = String((body as any).operation ?? '');
  const jobId = String((body as any).job_id ?? '');
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  if (operation === 'finalize_job') {
    if (!jobId) return json({ error: 'job_id required' }, 400);
    await finalizeJob(admin, jobId);
    return json({ ok: true, finalized: true, job_id: jobId });
  }
  const chunkId = String((body as any).chunk_id ?? '');
  const chunkIndex = Number((body as any).chunk_index);
  if (!jobId || !chunkId) return json({ error: 'job_id + chunk_id required' }, 400);

  const { data: chunkRow } = await admin
    .from('pdf_import_chunks')
    .select('id, job_id, parent_chunk_id, chunk_index, page_start, page_end, status, attempts, max_attempts, artifact_paths, operational_metrics')
    .eq('id', chunkId)
    .maybeSingle();
  if (!chunkRow) return json({ error: 'unknown chunk' }, 404);
  const chunk = chunkRow as ChunkRow;
  const priorChunkMetrics = (chunkRow as any).operational_metrics;

  const status = (body as any).status === 'failed' ? 'failed' : 'succeeded';
  const now = new Date().toISOString();

  // C11 — validate this delivery's chunk metrics + build the persisted envelope.
  // Fail-open: legacy/invalid/unknown never blocks the chunk callback.
  const chunkValidation = validateSidecarOperationalMetricsV1((body as any).metrics);
  const chunkEdge = buildEdgeObservation({
    callbackReceivedAt: now,
    edgeProcessingMs: Math.round(performance.now() - edgeStart),
    operation: status === 'failed' ? 'chunk_failure' : 'chunk_success',
    edgeFunctionVersion: EDGE_FUNCTION_VERSION,
  });
  const nextChunkEnvelope = buildInvocationEnvelope({
    validation: chunkValidation,
    source: 'chunk',
    receivedAt: now,
    attempt: Number(chunk.attempts ?? 0),
    edge: chunkEdge,
  });
  const { envelope: chunkMetricsToPersist, supersededPriorValid } = chooseChunkMetricsEnvelope(
    priorChunkMetrics,
    nextChunkEnvelope,
  );
  if (supersededPriorValid) {
    // A recovered re-run replaced an earlier valid metric — keep the earlier one
    // visible in the attempt log so a prior attempt's metrics are never lost.
    await appendJobAttempt(admin, jobId, {
      kind: 'chunk_metrics_superseded',
      chunk_id: chunkId,
      chunk_index: chunkIndex,
      prior_validation_state: supersededPriorValid.validation_state,
      prior_attempt: supersededPriorValid.attempt,
      prior_status: supersededPriorValid.metrics?.status ?? null,
    });
  }

  if (status === 'succeeded') {
    const artifacts = { ...(((body as any).artifact_paths ?? {}) as Record<string, unknown>) };
    const summary = ((body as any).summary ?? {}) as Record<string, unknown>;

    const extractorLane = String((body as any).extractor_lane ?? artifacts.extractor_lane ?? '').trim();
    const laneVersion = String((body as any).lane_enforcement_version ?? artifacts.lane_enforcement_version ?? '').trim();
    const effectiveMode = String((body as any).effective_mode ?? artifacts.effective_mode ?? '').trim();
    const lanePolicy = (body as any).lane_policy ?? artifacts.lane_policy ?? null;

    if (extractorLane) artifacts.extractor_lane = extractorLane;
    if (laneVersion) artifacts.lane_enforcement_version = laneVersion;
    if (effectiveMode) artifacts.effective_mode = effectiveMode;
    if (lanePolicy && typeof lanePolicy === 'object') artifacts.lane_policy = lanePolicy;

    await admin.from('pdf_import_chunks').update({
      status: 'succeeded',
      artifact_paths: artifacts,
      summary,
      finished_at: now,
      duration_ms: Number((body as any).duration_ms) || null,
      error_code: null,
      error_text: null,
      operational_metrics: chunkMetricsToPersist,
    }).eq('id', chunkId);
    await appendJobAttempt(admin, jobId, {
      kind: 'chunk_succeeded',
      chunk_id: chunkId,
      chunk_index: chunkIndex,
      page_start: chunk.page_start,
      page_end: chunk.page_end,
    });

    // Check if every chunk for the job is done; if so → finalize.
    const { data: remaining } = await admin
      .from('pdf_import_chunks')
      .select('id, status')
      .eq('job_id', jobId);
    const all = remaining as any[] ?? [];
    const stillRunning = all.some((c) => !['succeeded', 'fatal', 'split'].includes(c.status));
    const anyFatal = all.some((c) => c.status === 'fatal');
    const allDone = all.length > 0 && !stillRunning;
    if (allDone) {
      if (anyFatal) {
        await admin.from('pdf_import_jobs').update({
          status: 'recoverable_failed',
          stage: 'failed',
          error_code: 'chunk_retry_exhausted',
          error_text: 'one or more chunks gave up after page-level fallback',
          finished_at: now,
        }).eq('id', jobId);
      } else {
        await finalizeJob(admin, jobId);
      }
    }
    return json({ ok: true, finalized: allDone && !anyFatal });
  }

  // ---- Failure path: retry / split / mark fatal ----
  const errorCode = String((body as any).error_code ?? 'chunk_unhandled');
  const message = String((body as any).message ?? '').slice(0, 1000);
  const retryable = (body as any).retryable !== false;
  await admin.from('pdf_import_chunks').update({
    status: 'failed',
    error_code: errorCode,
    error_text: message,
    finished_at: now,
    duration_ms: Number((body as any).duration_ms) || null,
    // C11 — preserve this failed attempt's partial metrics (never clobber a prior valid one).
    operational_metrics: chunkMetricsToPersist,
  }).eq('id', chunkId);
  await appendJobAttempt(admin, jobId, {
    kind: 'chunk_failed',
    chunk_id: chunkId,
    chunk_index: chunkIndex,
    error_code: errorCode,
    page_start: chunk.page_start,
    page_end: chunk.page_end,
  });

  const fatalCodes = new Set(['chunk_out_of_range', 'invalid_pdf', 'pdf_too_large', 'callback_upload_not_configured']);
  const span = chunk.page_end - chunk.page_start + 1;

  if (!retryable && !fatalCodes.has(errorCode) && span > 1) {
    // Non-retryable but splittable — try smaller spans before giving up.
    await splitChunk(admin, jobId, chunk);
  } else if (fatalCodes.has(errorCode)) {
    await admin.from('pdf_import_chunks').update({
      status: 'fatal',
    }).eq('id', chunkId);
  } else if ((chunk.attempts ?? 0) + 1 < (chunk.max_attempts ?? 3)) {
    await dispatchChunk(admin, jobId, chunk);
  } else if (span > 1) {
    await splitChunk(admin, jobId, chunk);
  } else {
    await admin.from('pdf_import_chunks').update({
      status: 'fatal',
      error_code: 'chunk_retry_exhausted',
    }).eq('id', chunkId);
  }

  // Re-evaluate completion (a fatal might be the last outstanding chunk).
  const { data: remaining } = await admin
    .from('pdf_import_chunks')
    .select('id, status')
    .eq('job_id', jobId);
  const all = remaining as any[] ?? [];
  const stillRunning = all.some((c) => !['succeeded', 'fatal', 'split'].includes(c.status));
  if (!stillRunning && all.length > 0) {
    const anyFatal = all.some((c) => c.status === 'fatal');
    if (anyFatal) {
      await admin.from('pdf_import_jobs').update({
        status: 'recoverable_failed',
        stage: 'failed',
        error_code: 'chunk_retry_exhausted',
        error_text: 'one or more chunks failed after retry+split',
        finished_at: new Date().toISOString(),
      }).eq('id', jobId);
    } else {
      await finalizeJob(admin, jobId);
    }
  }
  return json({ ok: true });
});
