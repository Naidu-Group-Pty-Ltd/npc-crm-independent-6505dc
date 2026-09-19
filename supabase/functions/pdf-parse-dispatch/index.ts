// pdf-parse-dispatch — async orchestrator for Docling-based PDF imports.
//
// Phase 2 of the Docling pipeline plan. The frontend calls this with either a
// signed source URL or a Storage path; we insert a `pdf_import_jobs` row,
// return `{ jobId }` in <2s, and run the heavy work (sidecar parse + raster +
// diagnostics upload) inside EdgeRuntime.waitUntil so we never block the edge
// request envelope. The UI subscribes to `pdf_import_jobs` via Supabase
// realtime to render staged progress.
//
// Phase C additions:
//   * SHA-256 file-hash dedupe — identical PDFs in the same mode reuse prior
//     `docling.json` / `rasters.json` artifacts (instant return, cache_hit=true).
//   * Per-page raster streaming — rasters are produced one page at a time so
//     `pages_completed` / `pages_total` advance live in the UI.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import {
  verifyAuthOrNativeUser,
  createTokenAuthCorsHeaders,
  createUnauthorizedResponse,
  createForbiddenResponse,
} from '../_shared/auth.ts';
import {
  normalizePlanV2,
  PDF_PLAN_CONTRACT_VERSION,
  type PdfParsePlanV2,
} from '../_shared/pdfParsePlanV2.pure.ts';
import {
  buildCacheContractFingerprintInput,
  PDF_CACHE_CONTRACT_VERSION,
} from '../_shared/pdfCacheContract.pure.ts';
import { csrfDenied, enforceCsrf } from '../_shared/csrfGuard.ts';
import { assertPdfChunkPlanLimits } from '../_shared/pdfChunkLimits.pure.ts';
import { resolvePdfDescriptionTier } from '../_shared/pdfDescriptionTier.pure.ts';
import { meteredFetch } from '../_shared/meteredFetch.ts';
import { internalError } from '../_shared/errorResponse.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PARSE_URL = Deno.env.get('PDF_PARSE_SERVICE_URL') ?? '';
const PARSE_TOKEN = Deno.env.get('PDF_PARSE_SERVICE_TOKEN') ?? '';
const DIAGNOSTICS_BUCKET = 'pdf-import-diagnostics';
const SOURCE_BUCKET = 'template-import-assets';
const ENGINE = 'docling';
// +subset-fonts-v1+source-measure-v1: the sidecar now embeds subset font
// programs (exact source glyphs) and ships per-line measured advance widths.
// Cached artifacts predating that carry neither, so they must not be reused —
// a cache hit would quietly bring the font substitutes back.
//
// +align-v2: `text_align` changed MEANING rather than shape — a two-line block
// is no longer reported as justified. An older artifact answers the same key
// with the old semantics, which is exactly the case a fingerprint exists to
// catch. Mirrors the sidecar's ENGINE_VERSION; the two must move together.
//
// +source-measure-v2: per-line x0/x1/baseline, so two fields sharing a baseline
// can be told from a wrapped paragraph.
//
// +cmap-repair-v1: the embedded font BYTES changed. A subset's cmap need not
// address every glyph it carries, and a cached program still cannot — serving
// one would put the fallback typeface back mid-word.
//
// +font-metrics-v1: per-font hhea ascent/descent, without which the importer
// cannot place a block by its baseline and every line lands ~0.36em low.
const ENGINE_VERSION_FAMILY = 'docling-2.14.0+phaseD+waveD+option3+waveG-chunked+phase1-plan-router+phase3-raster-manifest+subset-fonts-v1+source-measure-v2+align-v2+cmap-repair-v1+font-metrics-v1';
const ARTIFACT_CONTRACT_VERSION = 'raster-manifest-v1';
const DOCLING_PAGE_REBASE_VERSION = 'chunk-page-rebase-v1';
const CHUNK_MERGE_VALIDATION_VERSION = 'chunk-merge-validation-v1';
const TERMINAL_STATE_VERSION = 'terminal-state-normalizer-v1';
const CACHE_SAFETY_VERSION = 'parse-cache-safety-v1';
const PHASE3_ENGINE_MARKER = 'phase3-raster-manifest';
const MAX_SIDECAR_ATTEMPTS = 3;
const STATUS_SAFE_FIELDS = [
  'id', 'status', 'stage', 'mode', 'page_count', 'pages_completed', 'pages_total',
  'duration_ms', 'ssim_score', 'error_code', 'error_text', 'diagnostics_path',
  'result_payload', 'started_at', 'finished_at', 'cache_hit', 'cache_source_job_id',
  'source_file_hash', 'engine_version', 'attempts',
].join(',');

// C1 policy versions folded into the cache-contract fingerprint. LANE_POLICY_VERSION
// mirrors the sidecar's LANE_ENFORCEMENT_VERSION; bump both together when lane
// behavior changes so stale-policy artifacts are never reused.
// G1: bumped to v2 alongside the sidecar's extractor-lane-policy-v2 so cached
// v1-semantics artifacts are never reused for v2 lane behavior.
// v3: mirrors the sidecar decoupling `force_full_page_ocr_default` from OCR
// availability and defaulting formula/code enrichment off. Every INHERIT cell in
// the lane matrix resolves differently, so v2 artifacts must not be reused.
// Deploy this function and the sidecar image together (LANE-POLICY.md G3).
const LANE_POLICY_VERSION = 'extractor-lane-policy-v3';
const REDACTION_POLICY_VERSION = 'redaction-policy-v1';
const PARSE_PROVIDER = 'docling';
const DEFAULT_SERVICE_CLASS = 'default';

// Wave G chunked thresholds. <=20 pages → monolithic /parse callback.
// 21–60 → 10-page chunks. >60 → 5-page chunks. OCR-heavy halves the size.
const CHUNK_MONOLITHIC_MAX = 20;
const CHUNK_SIZE_MEDIUM = 10;
const CHUNK_SIZE_LARGE = 5;
const STUCK_PARSING_MINUTES = 15;

function modeRequiresRaster(mode: string | null | undefined): boolean {
  return mode === 'hybrid' || mode === 'pixel_perfect' || mode === 'pixel-perfect';
}

function isCurrentArtifactContract(row: any, mode: string): boolean {
  const engineVersion = String(row?.engine_version ?? '');
  if (!engineVersion.includes(PHASE3_ENGINE_MARKER)) return false;

  if (!modeRequiresRaster(mode)) return true;

  const result = row?.result_payload ?? {};
  const manifestPath = result.rasters_manifest_path;
  const pageRasterPaths = result.page_raster_paths;
  const pageCount = Number(row?.page_count ?? result.page_count ?? 0);

  if (typeof manifestPath !== 'string' || !manifestPath) return false;
  if (!Array.isArray(pageRasterPaths) || pageRasterPaths.length === 0) return false;
  if (pageCount > 0 && pageRasterPaths.length < pageCount) return false;

  const artifactResult = ((row as any)?.result_payload ?? {}) as Record<string, unknown>;
  const isChunkedResult = artifactResult.chunked === true || Array.isArray((artifactResult as any).chunk_raster_manifest_paths);

  if (isChunkedResult) {
    if (artifactResult.docling_page_rebase_version !== DOCLING_PAGE_REBASE_VERSION) return false;
    if (artifactResult.chunk_merge_validation_version !== CHUNK_MERGE_VALIDATION_VERSION) return false;
    if (artifactResult.terminal_state_version !== TERMINAL_STATE_VERSION) return false;

    const mergeValidation = artifactResult.merge_validation as Record<string, unknown> | undefined;
    if (!mergeValidation || mergeValidation.ok !== true) return false;
  }

  return true;
}

// deno-lint-ignore no-explicit-any
type Admin = ReturnType<typeof createClient>;

async function updateJob(
  admin: Admin,
  jobId: string,
  patch: Record<string, unknown>,
) {
  const { error } = await admin
    .from('pdf_import_jobs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', jobId);
  if (error) console.error('[pdf-parse-dispatch] updateJob failed', { jobId, error });
}

async function setStage(admin: Admin, jobId: string, stage: string) {
  await updateJob(admin, jobId, { stage, stage_started_at: new Date().toISOString() });
}

async function appendAttempt(
  admin: Admin,
  jobId: string,
  attempt: Record<string, unknown>,
) {
  const enriched = { ...attempt, at: new Date().toISOString() };
  const { error } = await admin.rpc('append_pdf_import_attempt', {
    p_job_id: jobId,
    p_attempt: enriched,
  });
  if (!error) return;
  console.warn('[pdf-parse-dispatch] append attempt rpc failed; falling back', { jobId, error });
  const { data } = await admin
    .from('pdf_import_jobs')
    .select('attempts')
    .eq('id', jobId)
    .maybeSingle();
  const attempts = Array.isArray((data as any)?.attempts) ? (data as any).attempts : [];
  await updateJob(admin, jobId, { attempts: [...attempts, enriched] });
}

const DIAGNOSTICS_ALLOWED_MIME = [
  'application/json',
  'application/pdf',
  'image/png',
  'image/jpeg',
  'text/markdown',
  'text/plain',
  'text/html',
  'application/octet-stream',
];

async function ensureDiagnosticsBucket(admin: Admin) {
  const { data } = await admin.storage.getBucket(DIAGNOSTICS_BUCKET);
  if (!data) {
    const { error } = await admin.storage.createBucket(DIAGNOSTICS_BUCKET, {
      public: false,
      fileSizeLimit: 52428800,
      allowedMimeTypes: DIAGNOSTICS_ALLOWED_MIME,
    });
    if (error) console.error('[pdf-parse-dispatch] ensureDiagnosticsBucket create failed', error);
    return;
  }
  // Bucket already exists — ensure the markdown/text mime types are whitelisted so
  // Docling's `document.md` / `doctags.md` artifacts can be uploaded.
  const current = (data as any).allowed_mime_types as string[] | null | undefined;
  const missing = DIAGNOSTICS_ALLOWED_MIME.some((m) => !current?.includes(m));
  if (missing) {
    const { error } = await admin.storage.updateBucket(DIAGNOSTICS_BUCKET, {
      public: false,
      fileSizeLimit: 52428800,
      allowedMimeTypes: DIAGNOSTICS_ALLOWED_MIME,
    });
    if (error) console.error('[pdf-parse-dispatch] ensureDiagnosticsBucket update failed', error);
  }
}

async function ensureSourceBucket(admin: Admin) {
  const { data } = await admin.storage.getBucket(SOURCE_BUCKET);
  if (data) return;
  const { error } = await admin.storage.createBucket(SOURCE_BUCKET, {
    public: false,
    fileSizeLimit: 104857600,
    allowedMimeTypes: ['application/pdf'],
  });
  if (error) console.error('[pdf-parse-dispatch] ensureSourceBucket failed', error);
}

async function uploadDiagnostic(
  admin: Admin,
  jobId: string,
  name: string,
  body: Uint8Array | string,
  contentType: string,
): Promise<string | null> {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  const path = `${jobId}/${name}`;
  const { error } = await admin.storage
    .from(DIAGNOSTICS_BUCKET)
    .upload(path, bytes, { contentType, upsert: true });
  if (error) {
    console.error('[pdf-parse-dispatch] diagnostic upload failed', { path, error });
    return null;
  }
  return path;
}

function byteLength(body: Uint8Array | string | null | undefined): number {
  if (!body) return 0;
  return typeof body === 'string' ? new TextEncoder().encode(body).byteLength : body.byteLength;
}

function parseDataUri(uri: string): { mime: string; bytes: Uint8Array; ext: string } | null {
  const match = uri.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;
  const mime = match[1];
  const bin = atob(match[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = mime.includes('jpeg') ? 'jpg' : mime.includes('png') ? 'png' : '';
  if (!ext) return null;
  return { mime, bytes, ext };
}

async function uploadDoclingPictureAssets(admin: Admin, jobId: string, doclingDoc: any): Promise<number> {
  const pictures = Array.isArray(doclingDoc?.pictures) ? doclingDoc.pictures : [];
  let bytes = 0;
  for (let i = 0; i < pictures.length; i++) {
    const uri = pictures[i]?.image?.uri;
    if (typeof uri !== 'string') continue;
    const parsed = parseDataUri(uri);
    if (!parsed) continue;
    const path = await uploadDiagnostic(admin, jobId, `images/picture-${i + 1}.${parsed.ext}`, parsed.bytes, parsed.mime);
    if (path) {
      pictures[i].image.diagnostics_path = path;
      bytes += parsed.bytes.byteLength;
    }
  }
  return bytes;
}

async function downloadDiagnostic(
  admin: Admin,
  path: string,
): Promise<Uint8Array | null> {
  const objectPath = path.startsWith(`${DIAGNOSTICS_BUCKET}/`)
    ? path.slice(DIAGNOSTICS_BUCKET.length + 1)
    : path;
  const { data, error } = await admin.storage.from(DIAGNOSTICS_BUCKET).download(objectPath);
  if (error || !data) {
    console.warn('[pdf-parse-dispatch] cache fetch failed', { path, error });
    return null;
  }
  return new Uint8Array(await data.arrayBuffer());
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Text(text: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(text));
}

// Requested raster DPI is a deterministic function of the requested mode; used
// both for the parse request and for the cache fingerprint.
/**
 * The output-grade raster DPI for a mode.
 *
 * The dispatcher is the only layer that knows whether a page raster is a
 * throwaway alignment underlay or the actual deliverable, so the DPI decision
 * belongs here — `lane_policy.resolve_raster_dpi` treats an explicit request as
 * the target and `DOCLING_RASTER_DPI` only as a fallback.
 *
 * Was a flat 200/144. At 144 DPI an A4 page is 1191px, which a Retina display
 * at 100% zoom already upscales 1.33x — the reported pixelation — and which is
 * 2.08x below the 300 DPI print floor. Pixel-perfect rasters ARE the output, so
 * they go to the print floor. Hybrid rasters are nominally an editor underlay
 * (see TemplateImportPagePlan.background.underlay), but the quality gate can
 * later downgrade a hybrid page to raster-only and promote that same underlay
 * to final output, so 144 is too weak a starting point; 200 matches what the
 * design_heavy lane already demands.
 *
 * This value feeds computeCacheFingerprint, so changing it invalidates cached
 * artifacts for the affected modes automatically — which is correct, the old
 * ones are lower-resolution than the contract now promises.
 */
function requestedRasterDpi(_mode: string): number {
  // 300 for every mode that rasters at all, and the reason is the raster-only
  // downgrade path. The quality gate decides AFTER the parse that a page cannot
  // be rebuilt natively, and promotes that page's raster from alignment
  // underlay to final output — see applyCriticalContainment / pageFidelityDecision.
  // A mode-dependent DPI therefore means the pages that lost their native
  // layers, and so have the least fidelity left, are also the ones stuck with
  // the weakest asset. Rastering everything at the print floor removes the
  // problem instead of requiring a second round trip to re-raster after the
  // decision.
  //
  // Affordable because of the reference-mode transport: rasters are fetched by
  // WeasyPrint from storage rather than base64-inlined into a 25 MB payload, so
  // page count no longer bounds resolution. The remaining cost is sidecar
  // parse time and memory, which scale with DPI^2 — dial back here first if a
  // raster-heavy corpus regresses.
  return 300;
}

// pdf-cache-contract-v2 fingerprint. Computed pre-plan from request-level policy
// inputs (all known before /plan) so the fast cache path is preserved while the
// security invariant — redacted requests never reuse unredacted results — holds.
async function computeCacheFingerprint(
  hash: string,
  requestedMode: string,
  requestPayload: Record<string, unknown>,
): Promise<string> {
  const canonical = buildCacheContractFingerprintInput({
    contractVersion: PDF_CACHE_CONTRACT_VERSION,
    sourceHash: hash,
    requestedMode,
    allowModeOverride: requestPayload?.allow_mode_override !== false,
    redactPii: Boolean(requestPayload?.redact_pii),
    redactionPolicyVersion: REDACTION_POLICY_VERSION,
    descriptionTier: typeof requestPayload?.description_tier === 'string'
      ? (requestPayload.description_tier as string)
      : 'auto',
    includeMarkdown: requestPayload?.include_markdown !== false,
    includeDoctags: true,
    rasterFormat: 'png',
    rasterDpi: requestedRasterDpi(requestedMode),
    engineVersion: ENGINE_VERSION_FAMILY,
    artifactContractVersion: ARTIFACT_CONTRACT_VERSION,
    lanePolicyVersion: LANE_POLICY_VERSION,
    provider: PARSE_PROVIDER,
    serviceClass: DEFAULT_SERVICE_CLASS,
  });
  return sha256Text(canonical);
}

async function resolveSignedSourceUrl(
  admin: Admin,
  body: Record<string, unknown>,
): Promise<{ url: string; cleanup?: () => Promise<void> } | { error: string }> {
  const directUrl = typeof body.source_url === 'string' ? body.source_url : '';
  // Never bridge a caller-controlled URL into the privileged parser network.
  // Sources must first be uploaded to one of the private, server-controlled
  // locations below so this function is the only component that mints the URL.
  if (directUrl) return { error: 'source_url is not supported; upload the PDF first' };

  const storagePath = typeof body.source_path === 'string' ? body.source_path : '';
  const bucket = typeof body.source_bucket === 'string' && body.source_bucket
    ? (body.source_bucket as string)
    : SOURCE_BUCKET;
  if (storagePath) {
    const isTemplateSource = bucket === SOURCE_BUCKET;
    const isUploadedSource = bucket === DIAGNOSTICS_BUCKET
      && storagePath.startsWith('pdf-import-sources/');
    if (!isTemplateSource && !isUploadedSource) {
      return { error: 'source bucket or path is not allowed' };
    }
    const { data, error } = await admin.storage.from(bucket).createSignedUrl(storagePath, 600);
    if (error || !data) return { error: error?.message ?? 'failed to sign source URL' };
    return { url: data.signedUrl };
  }

  // base64 fallback: upload to diagnostics bucket so the sidecar can pull it.
  const b64 = typeof body.source_base64 === 'string' ? body.source_base64 : '';
  if (b64) {
    const clean = b64.includes(',') ? b64.split(',')[1] : b64;
    const bin = atob(clean);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const path = `inbox/${crypto.randomUUID()}.pdf`;
    const { error: upErr } = await admin.storage
      .from(DIAGNOSTICS_BUCKET)
      .upload(path, bytes, { contentType: 'application/pdf', upsert: true });
    if (upErr) return { error: upErr.message };
    const { data, error } = await admin.storage.from(DIAGNOSTICS_BUCKET).createSignedUrl(path, 600);
    if (error || !data) return { error: error?.message ?? 'failed to sign uploaded PDF' };
    return {
      url: data.signedUrl,
      cleanup: async () => {
        await admin.storage.from(DIAGNOSTICS_BUCKET).remove([path]);
      },
    };
  }
  return { error: 'must supply source_path or source_base64' };
}

async function fetchAndHash(signedUrl: string): Promise<{ hash: string; size: number } | null> {
  try {
    const res = await fetch(signedUrl);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const hash = await sha256Hex(bytes);
    return { hash, size: bytes.length };
  } catch (e) {
    console.warn('[pdf-parse-dispatch] hash fetch failed', e);
    return null;
  }
}

async function findCachedJob(
  admin: Admin,
  fingerprint: string,
  mode: string,
): Promise<{ id: string; result_payload: Record<string, unknown> | null; page_count: number | null; engine_version: string | null } | null> {
  // pdf-cache-contract-v2: reuse requires an EXACT fingerprint match. The
  // fingerprint encodes redaction policy, lane, DPI, description tier and
  // engine/artifact versions, so a non-redacted result can never satisfy a
  // redacted request. Legacy jobs (null fingerprint) never match — safe.
  if (!fingerprint) return null;
  const { data } = await admin
    .from('pdf_import_jobs')
    .select('id, result_payload, page_count, engine_version, diagnostics_path, cache_contract_fingerprint')
    .eq('cache_contract_fingerprint', fingerprint)
    .eq('engine', 'docling')
    .eq('status', 'succeeded')
    .order('finished_at', { ascending: false })
    .limit(1);
  if (!data || !data.length) return null;
  const row = data[0] as any;
  // Verify diagnostics still exist and cached artifacts satisfy the current contract.
  const doclingPath = row?.result_payload?.docling_path ?? row?.diagnostics_path;
  if (!doclingPath) return null;

  if (!isCurrentArtifactContract(row, mode)) {
    console.info('[pdf-parse-dispatch] cache rejected: incompatible artifact contract', {
      cached_job_id: row?.id,
      mode,
      engine_version: row?.engine_version,
    });
    return null;
  }

  return row;
}


async function sourceFingerprint(body: Record<string, unknown>): Promise<string> {
  if (typeof body.source_path === 'string' && body.source_path) return `storage:${body.source_bucket ?? SOURCE_BUCKET}:${body.source_path}`;
  // A pre-signed URL is a bearer credential. Hash it for idempotency rather
  // than persisting it in source_file_path as ordinary job metadata.
  if (typeof body.source_url === 'string' && body.source_url) return `url-sha256:${await sha256Text(body.source_url)}`;
  if (typeof body.source_base64 === 'string' && body.source_base64) {
    const clean = body.source_base64.includes(',') ? body.source_base64.split(',').pop()! : body.source_base64;
    return `inline-sha256:${await sha256Text(clean.replace(/\s+/g, ''))}`;
  }
  if (typeof body.source_file_name === 'string' && body.source_file_name) return `inline-name:${body.source_file_name}`;
  return `unknown:${crypto.randomUUID()}`;
}

async function findIdempotentJob(
  admin: Admin,
  userId: string | null,
  idempotencyKey: string,
  mode: string,
): Promise<{ id: string; status: string; stage: string | null } | null> {
  let q = admin
    .from('pdf_import_jobs')
    .select('id,status,stage,engine_version,result_payload,page_count')
    .eq('idempotency_key', idempotencyKey)
    .in('status', ['queued', 'uploading', 'parsing', 'mapping', 'finalizing', 'succeeded']);

  if (userId) q = q.eq('user_id', userId);

  const { data } = await q.order('created_at', { ascending: false }).limit(1);
  const row = data?.[0] as any ?? null;
  if (!row) return null;

  const engineVersion = String(row?.engine_version ?? '');

  if (engineVersion && !engineVersion.includes(PHASE3_ENGINE_MARKER)) {
    console.info('[pdf-parse-dispatch] idempotent replay rejected: old engine family', {
      job_id: row.id,
      engine_version: row.engine_version,
    });
    return null;
  }

  if (row.status === 'succeeded' && !isCurrentArtifactContract(row, mode)) {
    console.info('[pdf-parse-dispatch] idempotent replay rejected: incompatible artifact contract', {
      job_id: row.id,
      mode,
      engine_version: row.engine_version,
    });
    return null;
  }

  return row;
}


function ocrPageRatio(summary: any, pageCount: number | null): number {
  const ocrPages = Array.isArray(summary?.ocr_pages) ? summary.ocr_pages.length : 0;
  if (!pageCount || pageCount <= 0) return 0;
  return ocrPages / pageCount;
}

function shouldForcePixelPerfect(summary: any, pageCount: number | null, requestedMode: string, requestPayload: Record<string, unknown> | undefined): boolean {
  if (requestedMode === 'pixel_perfect' || requestedMode === 'pixel-perfect') return false;
  // Honor explicit user choices. Semantic = "I want editable overlays even if the
  // PDF is scanned/flattened" — Docling's internal OCR still produces text blocks
  // we can place as editable text. Auto-promotion only applies to 'hybrid' (the
  // default), where the user has not committed to either extreme.
  if (requestedMode === 'semantic') return false;
  if (requestPayload?.allow_mode_override === false) return false;
  return ocrPageRatio(summary, pageCount) > 0.3;
}

async function copyDiagnostic(
  admin: Admin,
  srcPath: string,
  destJobId: string,
  destName: string,
  contentType = 'application/json',
): Promise<string | null> {
  const bytes = await downloadDiagnostic(admin, srcPath);
  if (!bytes) return null;
  return uploadDiagnostic(admin, destJobId, destName, bytes, contentType);
}

// Per-page artifact keys reproduced on a cache hit. OCR/vectors are copied when
// present (forward-compatible with pdf-page-artifact-contract-v2 / C2).
const PER_PAGE_ARTIFACT_KEYS = [
  'raster_path',
  'docling_path',
  'blocks_path',
  'ocr_path',
  'tables_path',
  'pictures_path',
  'vectors_path',
  'summary_path',
] as const;

// Strip an optional bucket prefix and the leading job-id segment, yielding the
// artifact's sub-path (e.g. `pages/page-001/docling.json`) so it can be re-homed
// under a new job prefix.
function artifactSubpath(path: unknown): string | null {
  if (typeof path !== 'string' || !path) return null;
  const bare = path.startsWith(`${DIAGNOSTICS_BUCKET}/`) ? path.slice(DIAGNOSTICS_BUCKET.length + 1) : path;
  const segs = bare.split('/').filter(Boolean);
  if (segs.length < 2) return null;
  return segs.slice(1).join('/');
}

function contentTypeForPath(path: string): string {
  const p = path.toLowerCase();
  if (p.endsWith('.json')) return 'application/json';
  if (p.endsWith('.jpg') || p.endsWith('.jpeg')) return 'image/jpeg';
  if (p.endsWith('.png')) return 'image/png';
  if (p.endsWith('.md')) return 'text/markdown';
  return 'application/octet-stream';
}

// Copy a cached artifact into the new job's prefix, preserving its relative
// sub-path. Returns the new path, or null if the source could not be copied.
async function rehomeArtifact(admin: Admin, srcPath: unknown, newJobId: string): Promise<string | null> {
  const sub = artifactSubpath(srcPath);
  if (!sub) return null;
  return copyDiagnostic(admin, srcPath as string, newJobId, sub, contentTypeForPath(sub));
}

// Reproduce the full per-page artifact tree + parent pages-manifest under the new
// job so a cache hit satisfies the same artifact contract as a fresh parse.
// Returns null when the cached job cannot be faithfully reproduced (caller then
// falls through to a fresh parse rather than serving an incomplete result).
async function reproducePerPageTree(
  admin: Admin,
  cached: { id: string; result_payload: Record<string, unknown> | null },
  newJobId: string,
): Promise<{ perPageManifestPath: string; perPageManifestVersion: string | null } | null> {
  const result = (cached.result_payload ?? {}) as Record<string, unknown>;
  const sourceManifestPath = typeof result.per_page_docling_manifest_path === 'string' && result.per_page_docling_manifest_path
    ? result.per_page_docling_manifest_path
    : `${cached.id}/pages-manifest.json`;

  const raw = await downloadDiagnostic(admin, sourceManifestPath);
  if (!raw) return null;
  let manifest: any;
  try {
    manifest = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return null;
  }
  const pages = Array.isArray(manifest?.pages) ? manifest.pages : null;
  if (!pages || pages.length === 0) return null;

  const rewrittenPages: any[] = [];
  for (const page of pages) {
    if (!page || typeof page !== 'object') return null;
    const rewritten: Record<string, unknown> = { ...page };
    for (const key of PER_PAGE_ARTIFACT_KEYS) {
      const src = (page as Record<string, unknown>)[key];
      if (typeof src !== 'string' || !src) continue;
      const copied = await rehomeArtifact(admin, src, newJobId);
      if (!copied) return null; // a referenced artifact could not be reproduced
      rewritten[key] = copied;
    }
    rewrittenPages.push(rewritten);
  }

  const rewrittenManifest = { ...manifest, pages: rewrittenPages, cache_source_job_id: cached.id };
  const newManifestPath = await uploadDiagnostic(
    admin,
    newJobId,
    'pages-manifest.json',
    JSON.stringify(rewrittenManifest),
    'application/json',
  );
  if (!newManifestPath) return null;
  return {
    perPageManifestPath: newManifestPath,
    perPageManifestVersion: typeof manifest?.version === 'string' ? manifest.version : null,
  };
}

// Serve a job from a policy-safe cache hit. Reproduces the complete artifact
// contract (top-level + per-page tree). Returns true on a fully-reproduced hit;
// false means the caller must fall through to a fresh parse.
async function serveFromCache(
  admin: Admin,
  jobId: string,
  cached: { id: string; result_payload: Record<string, unknown> | null; page_count: number | null; engine_version: string | null },
  mode: string,
  startedAt: number,
): Promise<boolean> {
  try {
    await setStage(admin, jobId, 'cache_hit');
    const result = (cached.result_payload ?? {}) as Record<string, unknown>;
    const doclingSrc = (result.docling_path as string) ?? '';
    const rasterSrc = (result.rasters_path as string) ?? '';
    const manifestSrc = (result.rasters_manifest_path as string) ?? '';
    const pageRasterSrcs = Array.isArray(result.page_raster_paths)
      ? (result.page_raster_paths as unknown[]).filter((v): v is string => typeof v === 'string')
      : [];

    const doclingPath = doclingSrc ? await copyDiagnostic(admin, doclingSrc, jobId, 'docling.json') : null;
    // A cache hit that cannot reproduce its primary Docling artifact is unusable.
    if (doclingSrc && !doclingPath) return false;

    const rasterPath = rasterSrc ? await copyDiagnostic(admin, rasterSrc, jobId, 'rasters.json') : null;
    const manifestPath = manifestSrc ? await copyDiagnostic(admin, manifestSrc, jobId, 'rasters-manifest.json') : null;

    const pageRasterPaths: string[] = [];
    for (const src of pageRasterSrcs) {
      const filename = src.split('/').pop() || `page-${pageRasterPaths.length + 1}.png`;
      const copied = await copyDiagnostic(admin, src, jobId, `pages/${filename}`, contentTypeForPath(filename));
      if (copied) pageRasterPaths.push(copied);
    }
    // Rasters are contractually required for raster-bearing modes.
    if (modeRequiresRaster(mode) && pageRasterSrcs.length > 0 && pageRasterPaths.length < pageRasterSrcs.length) {
      return false;
    }

    // Reproduce the per-page artifact tree so persisted review / diagnostics work
    // for a cached job exactly as for a fresh one.
    const perPage = await reproducePerPageTree(admin, cached, jobId);
    if (!perPage) return false;

    // Top-level text artifacts, best-effort (present only for some engines).
    const outlinePath = result.outline_path ? await rehomeArtifact(admin, result.outline_path, jobId) : null;
    const markdownPath = result.markdown_path ? await rehomeArtifact(admin, result.markdown_path, jobId) : null;
    const doctagsPath = result.doctags_path ? await rehomeArtifact(admin, result.doctags_path, jobId) : null;
    const mergeValidationPath = result.merge_validation_path ? await rehomeArtifact(admin, result.merge_validation_path, jobId) : null;

    const finishedAt = Date.now();
    const pageCount = cached.page_count ?? null;
    await updateJob(admin, jobId, {
      status: 'succeeded',
      stage: 'parsed',
      cache_hit: true,
      cache_source_job_id: cached.id,
      engine_version: cached.engine_version ?? 'docling',
      page_count: pageCount,
      pages_total: pageCount,
      pages_completed: pageCount,
      finished_at: new Date(finishedAt).toISOString(),
      duration_ms: finishedAt - startedAt,
      diagnostics_path: doclingPath,
      result_payload: {
        docling_path: doclingPath,
        rasters_path: rasterPath,
        legacy_rasters_path: rasterPath,
        rasters_manifest_path: manifestPath,
        page_raster_paths: pageRasterPaths,
        per_page_docling_manifest_path: perPage.perPageManifestPath,
        per_page_docling_artifact_version: perPage.perPageManifestVersion,
        outline_path: outlinePath,
        markdown_path: markdownPath,
        doctags_path: doctagsPath,
        artifact_contract_version: ARTIFACT_CONTRACT_VERSION,
        docling_page_rebase_version: result.docling_page_rebase_version ?? null,
        chunk_merge_validation_version: result.chunk_merge_validation_version ?? null,
        merge_validation_path: mergeValidationPath ?? result.merge_validation_path ?? null,
        merge_validation: result.merge_validation ?? null,
        terminal_state_version: result.terminal_state_version ?? null,
        lane_enforcement_version: result.lane_enforcement_version ?? null,
        extractor_lane: result.extractor_lane ?? null,
        effective_mode: result.effective_mode ?? mode,
        lane_policy: result.lane_policy ?? null,
        cache_safety_version: CACHE_SAFETY_VERSION,
        cache_contract_version: PDF_CACHE_CONTRACT_VERSION,
        page_count: pageCount,
        mode,
        cache_hit: true,
        cache_source_job_id: cached.id,
      },
    });
    return true;
  } catch (e) {
    console.warn('[pdf-parse-dispatch] serveFromCache failed; will fall through to fresh parse', { jobId, cached: cached.id, error: String((e as Error)?.message ?? e) });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Wave G — chunked pipeline planning and dispatch.
// ---------------------------------------------------------------------------
interface SourceDescriptor {
  kind: 'storage' | 'url';
  bucket?: string;
  path?: string;
  url?: string;
}

// Call the sidecar /plan route. The request now forwards the requested mode and
// chunking hints (previously only { url } was sent, silently dropping them). The
// raw body is returned untyped; runJob validates it via normalizePlanV2.
async function callSidecarPlan(
  signedUrl: string,
  jobId: string,
  requestedMode: string,
  requestPayload: Record<string, unknown>,
): Promise<unknown | null> {
  try {
    const maxChunkPages = typeof requestPayload?.max_chunk_pages === 'number' && Number.isFinite(requestPayload.max_chunk_pages)
      ? requestPayload.max_chunk_pages
      : null;
    const res = await meteredFetch(`${PARSE_URL.replace(/\/$/, '')}/plan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${PARSE_TOKEN}`,
        'X-Request-Id': jobId,
      },
      body: JSON.stringify({
        url: signedUrl,
        mode: requestedMode,
        max_chunk_pages: maxChunkPages,
        force_chunking: requestPayload?.force_chunked === true,
      }),
    }, { secretName: 'PDF_PARSE_SERVICE_TOKEN', feature: 'pdf-parse/sidecar' });
    if (!res.ok) {
      console.warn('[pdf-parse-dispatch] /plan returned', res.status);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn('[pdf-parse-dispatch] /plan exception', e);
    return null;
  }
}

function planChunks(pageCount: number, ocrHint: boolean, preferredChunkSize?: number | null): Array<{ page_start: number; page_end: number }> {
  // Validate before allocating ranges: every chunk currently fetches the full
  // source PDF, so unbounded page counts would amplify one import into many
  // downloads and parse jobs.
  assertPdfChunkPlanLimits(pageCount);

  let size = preferredChunkSize && Number.isFinite(preferredChunkSize)
    ? Math.max(1, Math.min(50, Math.floor(preferredChunkSize)))
    : pageCount <= CHUNK_MONOLITHIC_MAX
      ? pageCount
      : pageCount <= 60
        ? CHUNK_SIZE_MEDIUM
        : CHUNK_SIZE_LARGE;

  // OCR-heavy PDFs: halve only when /plan did not already provide a chunk size.
  if (!preferredChunkSize && ocrHint && size > 2) size = Math.max(2, Math.floor(size / 2));

  const ranges: Array<{ page_start: number; page_end: number }> = [];
  for (let s = 1; s <= pageCount; s += size) {
    ranges.push({ page_start: s, page_end: Math.min(pageCount, s + size - 1) });
  }
  assertPdfChunkPlanLimits(pageCount, ranges.length);
  return ranges;
}

async function dispatchChunkToSidecar(
  admin: Admin,
  jobId: string,
  chunk: { id: string; chunk_index: number; page_start: number; page_end: number; attempts: number },
  signedUrl: string,
  mode: string,
  extractorLane: string,
  requestPayload: Record<string, unknown>,
): Promise<boolean> {
  await admin.from('pdf_import_chunks').update({
    status: 'dispatched',
    attempts: (chunk.attempts ?? 0) + 1,
    dispatched_at: new Date().toISOString(),
  }).eq('id', chunk.id);
  const body = {
    job_id: jobId,
    chunk_id: chunk.id,
    chunk_index: chunk.chunk_index,
    page_start: chunk.page_start,
    page_end: chunk.page_end,
    url: signedUrl,
    mode,
    extractor_lane: extractorLane,
    callback_url: `${SUPABASE_URL}/functions/v1/pdf-parse-chunk-callback`,
    callback_token: PARSE_TOKEN,
    enable_picture_description: requestPayload?.description_tier === 'on'
      || requestPayload?.description_tier === 'premium',
    include_doctags: true,
    include_markdown: requestPayload?.include_markdown !== false,
    redact_pii: Boolean(requestPayload?.redact_pii),
    // Same source as the cache fingerprint — a chunked page must not raster at a
    // different grade from the monolithic path, or a cache hit serves the wrong one.
    raster_dpi: requestedRasterDpi(mode),
    raster_format: 'png',
  };
  try {
    const res = await meteredFetch(`${PARSE_URL.replace(/\/$/, '')}/parse-chunk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${PARSE_TOKEN}`,
        'X-Request-Id': jobId,
      },
      body: JSON.stringify(body),
    }, { secretName: 'PDF_PARSE_SERVICE_TOKEN', feature: 'pdf-parse/sidecar' });
    if (res.status !== 202) {
      const text = await res.text().catch(() => '');
      console.error('[pdf-parse-dispatch] /parse-chunk non-202', { jobId, chunkIndex: chunk.chunk_index, status: res.status, text: text.slice(0, 300) });
      await admin.from('pdf_import_chunks').update({
        status: 'failed',
        error_code: `dispatch_http_${res.status}`,
        error_text: text.slice(0, 500),
      }).eq('id', chunk.id);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[pdf-parse-dispatch] /parse-chunk exception', e);
    await admin.from('pdf_import_chunks').update({
      status: 'failed',
      error_code: 'dispatch_exception',
      error_text: String((e as Error)?.message ?? e).slice(0, 500),
    }).eq('id', chunk.id);
    return false;
  }
}

async function runChunkedDispatch(
  admin: Admin,
  jobId: string,
  signedUrl: string,
  mode: string,
  extractorLane: string,
  pageCount: number,
  ocrHint: boolean,
  requestPayload: Record<string, unknown>,
  preferredChunkSize?: number | null,
): Promise<void> {
  const ranges = planChunks(pageCount, ocrHint, preferredChunkSize);
  if (!ranges.length) {
    throw new Error(`chunk plan produced no ranges (pageCount=${pageCount})`);
  }
  await updateJob(admin, jobId, {
    chunked: true,
    chunks_total: ranges.length,
    pages_total: pageCount,
    page_count: pageCount,
  });
  const inserts = ranges.map((r, i) => ({
    job_id: jobId,
    chunk_index: i + 1,
    page_start: r.page_start,
    page_end: r.page_end,
    status: 'pending',
  }));
  const { data: chunkRows, error } = await admin
    .from('pdf_import_chunks')
    .insert(inserts)
    .select('id, chunk_index, page_start, page_end, attempts');
  if (error || !chunkRows) {
    throw new Error(`chunk insert failed: ${error?.message ?? 'unknown'}`);
  }
  // Dispatch in chunk_index order. Sidecar runs concurrently; Cloud Run scales.
  for (const c of chunkRows as any[]) {
    await dispatchChunkToSidecar(admin, jobId, c, signedUrl, mode, extractorLane, requestPayload);
  }
}

async function runJob(
  admin: Admin,
  jobId: string,
  signedUrl: string,
  mode: string,
  cleanup?: () => Promise<void>,
  source?: SourceDescriptor,
) {
  const startedAt = Date.now();
  let bytesIn: number | null = null;
  let chunkedRan = false;
  try {
    // ---- Phase C: hash + policy-safe cache lookup --------------------------
    await setStage(admin, jobId, 'hashing');

    // request_payload carries the policy inputs (redaction, description tier,
    // markdown) that partition the cache fingerprint, so it is loaded BEFORE the
    // cache lookup so a redacted request can never reuse an unredacted result.
    const requestPayload = ((await admin
      .from('pdf_import_jobs')
      .select('request_payload')
      .eq('id', jobId)
      .maybeSingle()).data?.request_payload ?? {}) as Record<string, unknown>;

    // Hash the resolved source in this trusted process. Request metadata is only
    // a client hint and must never select another job's cached artifacts.
    const hashed = await fetchAndHash(signedUrl);
    if (hashed) {
      const cacheFingerprint = await computeCacheFingerprint(hashed.hash, mode, requestPayload);
      await updateJob(admin, jobId, {
        source_file_hash: hashed.hash,
        source_file_size_bytes: hashed.size,
        bytes_in: hashed.size,
        cache_contract_fingerprint: cacheFingerprint,
        service_class: DEFAULT_SERVICE_CLASS,
      });
      bytesIn = hashed.size;
      const cached = await findCachedJob(admin, cacheFingerprint, mode);
      if (cached) {
        console.log('[pdf-parse-dispatch] cache candidate', { jobId, source: cached.id, fingerprint: cacheFingerprint });
        const served = await serveFromCache(admin, jobId, cached, mode, startedAt);
        if (served) return;
        // Reproduction incomplete — fall through to a fresh parse rather than
        // serving a partial artifact set.
        console.warn('[pdf-parse-dispatch] cache reproduction incomplete; parsing fresh', { jobId, source: cached.id });
      }
    } else {
      await updateJob(admin, jobId, { service_class: DEFAULT_SERVICE_CLASS });
    }

    // ---- Phase 2B: planning lane contract (pdf-plan-contract-v2) -----------
    await setStage(admin, jobId, 'planning');
    const planRaw = await callSidecarPlan(signedUrl, jobId, mode, requestPayload);
    const normalized = normalizePlanV2(planRaw);
    const plan: PdfParsePlanV2 | null = normalized.ok ? normalized.plan : null;
    const planFallbackReason = normalized.ok
      ? null
      : (planRaw == null ? 'plan_unavailable' : normalized.reason);
    if (!normalized.ok && planRaw != null) {
      console.warn('[pdf-parse-dispatch] /plan rejected by validator; conservative fallback', { jobId, reason: normalized.reason, problems: normalized.problems });
    }

    const allowModeOverride = requestPayload?.allow_mode_override !== false;
    // recommended_mode is canonical 'pixel-perfect'; map to DB form 'pixel_perfect'.
    const plannedModeRaw = plan?.recommended_mode ?? null;
    const plannedMode = plannedModeRaw === 'pixel-perfect' ? 'pixel_perfect' : plannedModeRaw;
    const effectiveMode = allowModeOverride && plannedMode ? plannedMode : mode;

    const selectedLane = plan?.recommended_lane ?? 'unplanned';
    const selectedChunkSize = plan?.recommended_chunk_size ?? null;

    const planRecord: Record<string, unknown> = {
      ...(plan ?? {}),
      contract_version: PDF_PLAN_CONTRACT_VERSION,
      plan_fallback_reason: planFallbackReason,
      source,
      selected_lane: selectedLane,
      requested_mode: mode,
      dispatch_effective_mode: effectiveMode,
      dispatch_selected_chunk_size: selectedChunkSize,
      dispatch_allow_mode_override: allowModeOverride,
      service_class: DEFAULT_SERVICE_CLASS,
    };
    await updateJob(admin, jobId, { plan_payload: planRecord, service_class: DEFAULT_SERVICE_CLASS });

    const forceChunked = requestPayload?.force_chunked === true;
    const planRequestsChunking = Boolean(plan && selectedChunkSize && selectedChunkSize < plan.page_count);
    const useChunked = Boolean(plan && (forceChunked || plan.page_count > CHUNK_MONOLITHIC_MAX || planRequestsChunking));

    if (useChunked && plan) {
      // ---- Chunked path -----------------------------------------------------
      await setStage(admin, jobId, 'parsing');
      await appendAttempt(admin, jobId, {
        endpoint: '/parse-chunk',
        kind: 'chunked_plan',
        page_count: plan.page_count,
        ocr_hint: plan.ocr_hint,
        selected_lane: selectedLane,
        requested_mode: mode,
        effective_mode: effectiveMode,
        recommended_mode: plan.recommended_mode,
        recommended_chunk_size: plan.recommended_chunk_size,
        selected_chunk_size: selectedChunkSize,
        requires_raster: plan.requires_raster,
        requires_ocr: plan.requires_ocr,
        requires_picture_description: plan.requires_picture_description,
      });
      await runChunkedDispatch(admin, jobId, signedUrl, effectiveMode, selectedLane, plan.page_count, plan.ocr_hint, requestPayload, selectedChunkSize);
      chunkedRan = true;
      await updateJob(admin, jobId, { bytes_in: bytesIn });
      return;
    }

    // ---- Wave F-Option-3: monolithic callback dispatch (small docs) -------
    await setStage(admin, jobId, 'parsing');
    const descriptionTier = (requestPayload?.description_tier as string) ?? 'auto';
    const includeMarkdown = requestPayload?.include_markdown === false ? false : true;
    const enablePictureDescription = (descriptionTier === 'on' || descriptionTier === 'premium')
      && (!plan || plan.requires_picture_description === true);
    const rasterDpi = requestedRasterDpi(effectiveMode);

    const parseBody: Record<string, unknown> = {
      url: signedUrl,
      include_doctags: true,
      include_markdown: includeMarkdown,
      redact_pii: Boolean(requestPayload?.redact_pii),
      callback_url: `${SUPABASE_URL}/functions/v1/pdf-parse-callback`,
      callback_token: PARSE_TOKEN,
      job_id: jobId,
      mode: effectiveMode,
      extractor_lane: selectedLane,
      raster_dpi: rasterDpi,
      raster_format: 'png',
      allow_mode_override: allowModeOverride,
      enable_picture_description: enablePictureDescription,
    };

    const TRANSIENT = new Set([408, 429, 500, 502, 503, 504, 522, 524]);
    let dispatched = false;
    let lastErr = '';
    for (let attempt = 1; attempt <= MAX_SIDECAR_ATTEMPTS; attempt++) {
      const attemptStarted = Date.now();
      try {
        const parseRes = await meteredFetch(`${PARSE_URL.replace(/\/$/, '')}/parse`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${PARSE_TOKEN}`,
            'X-Request-Id': jobId,
          },
          body: JSON.stringify(parseBody),
        }, { secretName: 'PDF_PARSE_SERVICE_TOKEN', feature: 'pdf-parse/sidecar' });
        const text = await parseRes.text().catch(() => '');
        if (parseRes.status === 202) {
          await appendAttempt(admin, jobId, { endpoint: '/parse', attempt, status: 202, ok: true, duration_ms: Date.now() - attemptStarted, mode: 'callback', selected_lane: selectedLane, requested_mode: mode, effective_mode: effectiveMode });
          dispatched = true;
          break;
        }
        let retryable = TRANSIENT.has(parseRes.status);
        let errorCode = `http_${parseRes.status}`;
        try {
          const errJson = JSON.parse(text);
          if (typeof errJson?.retryable === 'boolean') retryable = errJson.retryable;
          if (typeof errJson?.error_code === 'string') errorCode = errJson.error_code;
        } catch (_ignored) { /* non-JSON */ }
        lastErr = `sidecar /parse ${parseRes.status}: ${text.slice(0, 500)}`;
        await appendAttempt(admin, jobId, { endpoint: '/parse', attempt, status: parseRes.status, ok: false, error_code: errorCode, retryable, duration_ms: Date.now() - attemptStarted });
        if (!retryable || attempt === MAX_SIDECAR_ATTEMPTS) throw new Error(lastErr);
      } catch (e) {
        lastErr = String((e as Error)?.message ?? e);
        if (lastErr.startsWith('sidecar /parse')) throw new Error(lastErr);
        await appendAttempt(admin, jobId, { endpoint: '/parse', attempt, ok: false, error_code: 'fetch_exception', retryable: attempt < MAX_SIDECAR_ATTEMPTS, message: lastErr.slice(0, 500), duration_ms: Date.now() - attemptStarted });
        if (attempt === MAX_SIDECAR_ATTEMPTS) throw new Error(lastErr);
      }
      const delay = [2000, 5000][attempt - 1] ?? 5000;
      await new Promise((r) => setTimeout(r, delay));
    }
    if (!dispatched) throw new Error(lastErr || 'sidecar /parse dispatch failed');
    await updateJob(admin, jobId, { stage: 'parsing', bytes_in: bytesIn });
  } catch (err) {
    const finishedAt = Date.now();
    console.error('[pdf-parse-dispatch] dispatch failed', { jobId, err });
    await updateJob(admin, jobId, {
      status: 'failed',
      stage: 'failed',
      finished_at: new Date(finishedAt).toISOString(),
      duration_ms: finishedAt - startedAt,
      error_code: 'sidecar_dispatch_error',
      error_text: String((err as Error)?.message ?? err).slice(0, 2000),
    });
  } finally {
    // Chunk workers fetch the signed source after dispatch returns, so the
    // temporary inline source must remain available for their background work.
    if (cleanup && !chunkedRan) await cleanup().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Stuck-job recovery — invoked manually (admin) or by a cron schedule.
// ---------------------------------------------------------------------------
async function recoverStuckJobs(admin: Admin): Promise<{ requeued: number; failed: number; jobs: Array<{ job_id: string; action: string }> }> {
  const cutoff = new Date(Date.now() - STUCK_PARSING_MINUTES * 60_000).toISOString();
  const results: Array<{ job_id: string; action: string }> = [];
  let requeued = 0;
  let failed = 0;

  // Monolithic stuck (Option-3 path with no callback after N minutes).
  const { data: monolithicStuck } = await admin
    .from('pdf_import_jobs')
    .select('id, stage_started_at, chunked, plan_payload, mode, request_payload')
    .eq('status', 'parsing')
    .eq('chunked', false)
    .lt('stage_started_at', cutoff)
    .limit(25);
  for (const row of (monolithicStuck as any[]) ?? []) {
    await updateJob(admin, row.id, {
      status: 'recoverable_failed',
      stage: 'failed',
      error_code: 'callback_failed',
      error_text: `monolithic parse exceeded ${STUCK_PARSING_MINUTES}m without callback`,
      finished_at: new Date().toISOString(),
    });
    results.push({ job_id: row.id, action: 'mark_recoverable_failed' });
    failed++;
  }

  // Chunked stuck — re-dispatch any 'dispatched'/'parsing' chunks past cutoff.
  const { data: stuckChunks } = await admin
    .from('pdf_import_chunks')
    .select('id, job_id, chunk_index, page_start, page_end, attempts, max_attempts, status, last_event_at')
    .in('status', ['dispatched', 'parsing'])
    .lt('last_event_at', cutoff)
    .limit(100);
  // Group by job for re-dispatch.
  const byJob = new Map<string, any[]>();
  for (const c of (stuckChunks as any[]) ?? []) {
    if (!byJob.has(c.job_id)) byJob.set(c.job_id, []);
    byJob.get(c.job_id)!.push(c);
  }
  for (const [jobId, chunks] of byJob) {
    const { data: job } = await admin
      .from('pdf_import_jobs')
      .select('mode, request_payload, plan_payload')
      .eq('id', jobId)
      .maybeSingle();
    const plan = ((job as any)?.plan_payload ?? {}) as Record<string, unknown>;
    const src = (plan?.source ?? {}) as SourceDescriptor;
    let signedUrl: string | null = null;
    if (src.kind === 'storage' && src.bucket && src.path) {
      const { data } = await admin.storage.from(src.bucket).createSignedUrl(src.path, 1200);
      signedUrl = data?.signedUrl ?? null;
    } else if (src.kind === 'url' && src.url) {
      signedUrl = src.url;
    }
    if (!signedUrl) {
      for (const c of chunks) {
        await admin.from('pdf_import_chunks').update({
          status: 'fatal',
          error_code: 'source_fetch_error',
          error_text: 'could not re-sign source for stuck recovery',
        }).eq('id', c.id);
        failed++;
        results.push({ job_id: jobId, action: 'fatal_no_source' });
      }
      continue;
    }
    // C1.6: redispatch on the job's persisted effective mode + lane, not the raw
    // requested mode / a hard-coded 'unplanned' lane.
    const mode = String(plan.dispatch_effective_mode ?? (job as any)?.mode ?? 'semantic');
    const selectedLane = String(plan.selected_lane ?? plan.recommended_lane ?? 'unplanned');
    const requestPayload = ((job as any)?.request_payload ?? {}) as Record<string, unknown>;
    for (const c of chunks) {
      if ((c.attempts ?? 0) >= (c.max_attempts ?? 3)) {
        await admin.from('pdf_import_chunks').update({
          status: 'fatal',
          error_code: 'chunk_retry_exhausted',
        }).eq('id', c.id);
        failed++;
        results.push({ job_id: jobId, action: 'fatal_max_attempts' });
        continue;
      }
      const ok = await dispatchChunkToSidecar(admin, jobId, c, signedUrl, mode, selectedLane, requestPayload);
      results.push({ job_id: jobId, action: ok ? 'redispatched' : 'redispatch_failed' });
      if (ok) requeued++;
      else failed++;
    }
  }
  return { requeued, failed, jobs: results };
}

Deno.serve(async (req) => {
  // Origin-aware: an allowlisted origin gets an exact ACAO + credentials so the
  // HttpOnly `__Host-session_token` cookie authenticates the parse job. Anyone
  // else keeps the historical wildcard token-auth answer.
  const cors = createTokenAuthCorsHeaders(req.headers.get('origin'));
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  // Ambient cookie authority requires an exact-origin check; no-ops for
  // token-only callers, which send no cookie.
  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(cors, csrf);

  if (!PARSE_URL || !PARSE_TOKEN) {
    return json({ error: 'PDF_PARSE_SERVICE_URL / PDF_PARSE_SERVICE_TOKEN not configured' }, 503);
  }

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const body = await req.json().catch(() => ({}));
    const auth = await verifyAuthOrNativeUser(admin, req, body);
    if (auth.error) return createUnauthorizedResponse(auth.error, cors);
    const userId = auth.userId && auth.userId !== 'service_role' ? auth.userId : (body.user_id ?? null);
    // Picture descriptions are resource intensive. Never trust a user-supplied
    // premium tier unless the request authenticated with the service role.
    const descriptionTier = resolvePdfDescriptionTier(body.description_tier, auth.authMethod);

    const operation = (body.operation as string) || 'start';

    if (operation === 'status') {
      const jobId = body.job_id as string;
      if (!jobId) return json({ error: 'job_id required' }, 400);
      if (!userId) return createForbiddenResponse('job owner required', cors);
      const { data, error } = await admin
        .from('pdf_import_jobs')
        .select(STATUS_SAFE_FIELDS)
        .eq('id', jobId)
        .eq('user_id', userId)
        .single();
      if (error) return json({ error: error.message }, 404);
      return json({ job: data });
    }

    if (operation === 'download') {
      // Signed-URL minter for diagnostic artifacts (docling.json / rasters.json).
      // The frontend can't sign URLs on the private `pdf-import-diagnostics`
      // bucket itself under our custom-auth model, so we mediate here.
      const path = typeof body.path === 'string' ? body.path : '';
      if (!path) return json({ error: 'path required' }, 400);
      // Ceiling raised 300s -> 900s. A signed URL handed to WeasyPrint as a
      // resource reference (rather than inlined as base64) must outlive the
      // render that consumes it, and the render timeout is 600s. At 300s a
      // long multi-page export would have had its images expire midway and
      // silently drop to blank backgrounds. Still short-lived: this is a
      // bearer credential for a private bucket, so the window is the render
      // duration plus headroom and nothing more.
      const expiresIn = Math.min(Math.max(Number(body.expires_in) || 300, 60), 900);
      const objectPath = path.startsWith(`${DIAGNOSTICS_BUCKET}/`)
        ? path.slice(DIAGNOSTICS_BUCKET.length + 1)
        : path;
      // Scope: caller must own the underlying job (jobId is the first path segment).
      const jobId = objectPath.split('/')[0];
      if (!userId || !jobId) return json({ error: 'forbidden' }, 403);
      const { data: jobRow, error: jobError } = await admin
        .from('pdf_import_jobs')
        .select('user_id')
        .eq('id', jobId)
        .maybeSingle();
      // Fail closed: non-job prefixes (including pdf-import-sources), missing
      // owners, and lookup failures must never reach the signed-URL minter.
      if (jobError || !jobRow?.user_id || jobRow.user_id !== userId) {
        return json({ error: 'forbidden' }, 403);
      }
      const { data, error } = await admin.storage
        .from(DIAGNOSTICS_BUCKET)
        .createSignedUrl(objectPath, expiresIn);
      if (error || !data?.signedUrl) return json({ error: error?.message ?? 'sign failed' }, 500);
      return json({ signed_url: data.signedUrl, expires_in: expiresIn });
    }

    if (operation === 'upload_source') {
      const b64 = typeof body.source_base64 === 'string' ? body.source_base64 : '';
      if (!b64) return json({ error: 'source_base64 required' }, 400);
      const clean = b64.includes(',') ? b64.split(',').pop()! : b64;
      const bin = atob(clean);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const hash = await sha256Hex(bytes);
      const filename = String(body.source_file_name || 'source.pdf').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80);
      const path = `pdf-import-sources/${hash}/${filename || 'source.pdf'}`;
      // Diagnostics bucket already allows application/pdf; the legacy
      // template-import-assets bucket is image-only on existing projects
      // and was rejecting "mime type application/pdf is not supported".
      await ensureDiagnosticsBucket(admin);
      const { error: upErr } = await admin.storage
        .from(DIAGNOSTICS_BUCKET)
        .upload(path, bytes, { contentType: 'application/pdf', upsert: true });
      if (upErr) return json({ error: upErr.message }, 500);
      return json({ source_path: path, source_bucket: DIAGNOSTICS_BUCKET, source_file_hash: hash, bytes: bytes.byteLength });
    }

    if (operation === 'start') {
      const rawMode = (body.mode as string) ?? 'semantic';
      // DB CHECK uses 'pixel_perfect' (underscore); UI/API may pass 'pixel-perfect'.
      const mode = rawMode === 'pixel-perfect' ? 'pixel_perfect' : rawMode;
      const sourceFilePath = await sourceFingerprint(body);
      // Idempotency must partition on the same policy inputs as the cache
      // fingerprint, otherwise a redacted request could replay an in-flight
      // NON-redacted job (or vice versa).
      const idempotencyPolicy = [
        `redact=${Boolean(body.redact_pii) ? 1 : 0}`,
        `desc=${descriptionTier}`,
        `md=${body.include_markdown === false ? 0 : 1}`,
        `override=${body.allow_mode_override !== false ? 1 : 0}`,
      ].join(':');
      const idempotencyKey = typeof body.idempotency_key === 'string' && body.idempotency_key
        ? body.idempotency_key
        : await sha256Text(`${sourceFilePath}:${mode}:${ENGINE_VERSION_FAMILY}:${ARTIFACT_CONTRACT_VERSION}:${idempotencyPolicy}`);
      const existing = await findIdempotentJob(admin, userId as string | null, idempotencyKey, mode);
      if (existing) {
        return json({
          job_id: existing.id,
          status: existing.status,
          stage: existing.stage,
          idempotency_key: idempotencyKey,
          idempotent_replay: true,
        });
      }
      await ensureDiagnosticsBucket(admin);
      const sourceRes = await resolveSignedSourceUrl(admin, body);
      if ('error' in sourceRes) return json({ error: sourceRes.error }, 400);


      const { data: jobRow, error: insertErr } = await admin
        .from('pdf_import_jobs')
        .insert({
          user_id: userId,
          template_id: body.template_id ?? null,
          template_import_id: typeof body.template_import_id === 'string' ? body.template_import_id : null,
          service_class: DEFAULT_SERVICE_CLASS,
          source_file_path: sourceFilePath,
          source_file_name: body.source_file_name ?? null,
          source_file_size_bytes: body.source_file_size_bytes ?? null,
          // Persist only a hash verified by runJob against the resolved source.
          source_file_hash: null,
          engine: ENGINE,
          engine_version: ENGINE_VERSION_FAMILY,
          idempotency_key: idempotencyKey,
          mode,
          status: 'queued',
          stage: 'queued',
          started_at: new Date().toISOString(),
          stage_started_at: new Date().toISOString(),
          request_payload: {
            mode,
            has_source_url: Boolean(body.source_url),
            has_source_path: Boolean(body.source_path),
            has_source_base64: Boolean(body.source_base64),
            // Phase D passthroughs (consumed by runJob).
            description_tier: descriptionTier,
            include_markdown: body.include_markdown === false ? false : true,
            redact_pii: Boolean(body.redact_pii),
            pii_redaction_reason: typeof body.pii_redaction_reason === 'string' ? body.pii_redaction_reason.slice(0, 120) : null,
            allow_mode_override: body.allow_mode_override !== false,
          },
        })
        .select('id')
        .single();
      if (insertErr || !jobRow) {
        const replay = await findIdempotentJob(admin, userId as string | null, idempotencyKey, mode);
        if (replay) {
          return json({
            job_id: replay.id,
            status: replay.status,
            stage: replay.stage,
            idempotency_key: idempotencyKey,
            idempotent_replay: true,
          });
        }
        return json({ error: insertErr?.message ?? 'job insert failed' }, 500);
      }

      // Build a SourceDescriptor so chunk callbacks can re-sign on retry/recovery.
      let source: SourceDescriptor | undefined;
      if (typeof body.source_path === 'string' && body.source_path) {
        source = { kind: 'storage', bucket: (body.source_bucket as string) || SOURCE_BUCKET, path: body.source_path as string };
      } else if (typeof body.source_url === 'string' && body.source_url) {
        // Direct URLs are transient bearer credentials. They are used only by
        // this dispatch and deliberately omitted from persisted plan metadata.
        source = { kind: 'url' };
      }
      // base64 → resolveSignedSourceUrl persisted it to DIAGNOSTICS_BUCKET inbox.
      // We can't recover the inbox path cleanly here, so chunked + base64 will
      // need a small follow-up. For now record kind='url' (signed) which is OK
      // for single-attempt dispatch but not for stuck recovery.

      // Fire-and-forget background processing.
      // @ts-expect-error EdgeRuntime is provided by Supabase's Deno runtime.
      EdgeRuntime.waitUntil(runJob(admin, jobRow.id, sourceRes.url, mode, sourceRes.cleanup, source));

      return json({ job_id: jobRow.id, status: 'queued', idempotency_key: idempotencyKey });
    }

    if (operation === 'recover') {
      // Recovery scans and mutates stuck jobs across all tenants, so ordinary
      // authenticated users must never reach it through this service-role client.
      // Verified internal callers retain the cron/operator maintenance path.
      if (auth.userId !== 'service_role') {
        const { data: roles, error: rolesError } = await admin
          .from('user_roles')
          .select('role')
          .eq('user_id', auth.userId);
        const isSuperadmin = !rolesError
          && Array.isArray(roles)
          && roles.some((row: { role?: string }) => row.role === 'superadmin');
        if (!isSuperadmin) return createForbiddenResponse('superadmin required', cors);
      }
      // Stuck-job recovery — re-dispatch chunks past their last_event_at
      // cutoff, mark monolithic stalls as recoverable_failed. Returns a report.
      const result = await recoverStuckJobs(admin);
      return json({ ok: true, ...result });
    }

    return json({ error: `unknown operation: ${operation}` }, 400);
  } catch (e) {
    console.error('[pdf-parse-dispatch] unhandled', e);
    return json({ ...internalError(e, 'pdf-parse-dispatch') }, 500);
  }
});
