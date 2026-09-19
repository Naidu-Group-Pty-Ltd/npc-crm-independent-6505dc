// Template PDF importer.
// Operations: create_import | upload_asset | stage_artifacts | start_finalize | retry_finalize | get_status | finalize | resync | get_artifacts | record_review_decision | list_recent_imports | get_linked_import | fail | save_visual_quality | get_visual_quality | save_visual_repair_audit | get_visual_repair_audit | save_golden_run_history | list_golden_run_history | get_golden_run_history | get_latest_golden_run_baselines
//
// upload_asset accepts base64 PNG/JPG, stores in `template-import-assets`
// (creates the bucket on first use) and returns the public URL. finalize
// writes the assembled ReportTemplate JSON into `report_templates` via the
// service-role client (RLS-only table), and persists private CDIR/fidelity
// JSON artifacts in `template-import-artifacts` when supplied by the client.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { verifyAuthOrNativeUser, createTokenAuthCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { csrfDenied, enforceCsrf } from '../_shared/csrfGuard.ts';
// E1 — Source Scene Graph V2 / Page Artifact Contract V3 lazy signed delivery.
import { validatePageArtifactContractV3 } from '../_shared/pageArtifactContractV3.pure.ts';
import { isSafeArtifactPath } from '../_shared/sourceSceneGraphV2.pure.ts';
import { isPdfDiagnosticsPathOwnedByJob } from '../_shared/pdfDiagnosticsAuthorization.pure.ts';
import {
  isAllowedTemplateImportMetaPatch,
  isTemplateImportArtifactPathOwnedByImport,
} from '../_shared/templateImportArtifactAuthorization.pure.ts';
import { authorizeTemplateResync } from '../_shared/templateResyncAuthorization.ts';
import { requireModulePermission } from '../_shared/authz.ts';
import { internalError } from '../_shared/errorResponse.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ASSET_BUCKET = 'template-import-assets';
const ARTIFACT_BUCKET = 'template-import-artifacts';
const PDF_DIAGNOSTICS_BUCKET = 'pdf-import-diagnostics';
const PDF_DIAGNOSTICS_SIGNED_URL_TTL_SECONDS = 60 * 60;
const PDF_PAGE_CONTEXT_SUMMARY_MAX_PAGES = 60;
const MAX_ASSET_BASE64_LENGTH = 20 * 1024 * 1024;
const ALLOWED_ASSET_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const TEMPLATE_FINALIZATION_ARTIFACT_CONTRACT = 'template-finalization-artifacts-v1';
const TEMPLATE_IMPORT_WORKER_TOKEN = Deno.env.get('TEMPLATE_IMPORT_WORKER_TOKEN') ?? SERVICE_ROLE;

function logDbError(operation: string, error: { message?: string; details?: string | null; hint?: string | null; code?: string | null } | null) {
  if (!error) return;
  console.error(`[template-import-pdf] ${operation} failed`, {
    message: error.message,
    details: error.details,
    hint: error.hint,
    code: error.code,
  });
}

async function ensureAssetBucket(admin: ReturnType<typeof createClient>) {
  const { data } = await admin.storage.getBucket(ASSET_BUCKET);
  if (data) {
    if (!data.public) {
      const { error } = await admin.storage.updateBucket(ASSET_BUCKET, {
        public: true,
        fileSizeLimit: 25 * 1024 * 1024,
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
      });
      if (error) logDbError('ensure_asset_bucket.update_public', error);
    }
    return;
  }
  await admin.storage.createBucket(ASSET_BUCKET, {
    public: true,
    fileSizeLimit: 25 * 1024 * 1024,
    allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
  });
}

async function ensureArtifactBucket(admin: ReturnType<typeof createClient>) {
  const allowedMimeTypes = ['application/json', 'image/png', 'image/jpeg', 'image/webp'];
  const fileSizeLimit = 25 * 1024 * 1024;
  const { data } = await admin.storage.getBucket(ARTIFACT_BUCKET);
  if (data) {
    // Widen MIME allowlist in-place — Phase 5 added raster persistence.
    const current = (data as { allowed_mime_types?: string[] | null }).allowed_mime_types ?? [];
    const missing = allowedMimeTypes.some((m) => !current.includes(m));
    if (missing) {
      const { error } = await admin.storage.updateBucket(ARTIFACT_BUCKET, {
        public: false,
        fileSizeLimit,
        allowedMimeTypes,
      });
      if (error) logDbError('ensure_artifact_bucket.update_mime', error);
    }
    return;
  }
  await admin.storage.createBucket(ARTIFACT_BUCKET, {
    public: false,
    fileSizeLimit,
    allowedMimeTypes,
  });
}

function safeArtifactName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80);
}

async function uploadJsonArtifact(
  admin: ReturnType<typeof createClient>,
  importId: string,
  name: string,
  payload: unknown,
): Promise<string | null> {
  if (!payload) return null;
  await ensureArtifactBucket(admin);
  const path = `${importId}/${safeArtifactName(name)}.json`;
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const { error } = await admin.storage
    .from(ARTIFACT_BUCKET)
    .upload(path, bytes, { contentType: 'application/json', upsert: true });
  if (error) {
    logDbError(`upload_json_artifact.${name}`, error);
    return null;
  }
  return path;
}


function importAssetSummary(asset: any) {
  if (!asset || typeof asset !== 'object' || !Array.isArray(asset.pages)) return null;
  return {
    fileId: typeof asset.fileId === 'string' ? asset.fileId : null,
    fileType: typeof asset.fileType === 'string' ? asset.fileType : null,
    pageCount: asset.pages.length,
    sourcePages: asset.pages.filter((page: any) => typeof page?.referenceImageUrl === 'string' && page.referenceImageUrl.length > 0).length,
    dimensions: asset.pages.slice(0, 10).map((page: any) => ({
      pageIndex: Number.isFinite(Number(page?.pageIndex)) ? Number(page.pageIndex) : null,
      width: Number.isFinite(Number(page?.width)) ? Number(page.width) : null,
      height: Number.isFinite(Number(page?.height)) ? Number(page.height) : null,
      dpiScale: Number.isFinite(Number(page?.dpiScale)) ? Number(page.dpiScale) : null,
    })),
  };
}

function fidelitySummary(report: any) {
  if (!report || typeof report !== 'object') return null;
  return {
    overallScore: report.overallScore ?? null,
    nativeCoverage: report.nativeCoverage ?? null,
    rasterFallbackCoverage: report.rasterFallbackCoverage ?? null,
    textAccuracy: report.textAccuracy ?? null,
    medianPositionDrift: report.medianPositionDrift ?? null,
    p95PositionDrift: report.p95PositionDrift ?? null,
    warningCount: Array.isArray(report.warnings) ? report.warnings.length : 0,
    pageCount: Array.isArray(report.pages) ? report.pages.length : null,
  };
}

function importManifestSummary(manifests: any) {
  if (!manifests || typeof manifests !== 'object') return null;
  const pdf = manifests.pdf_import_job && typeof manifests.pdf_import_job === 'object'
    ? manifests.pdf_import_job
    : null;

  if (!pdf) {
    return {
      has_pdf_import_job: false,
      page_context_manifest_available: false,
      page_context_source: 'missing_pdf_import_job',
    };
  }

  const jobId = typeof pdf.job_id === 'string' && pdf.job_id.length > 0 ? pdf.job_id : null;
  const explicitPageManifestPath = typeof pdf.per_page_docling_manifest_path === 'string' && pdf.per_page_docling_manifest_path.length > 0
    ? pdf.per_page_docling_manifest_path
    : null;
  const derivedPageManifestPath = !explicitPageManifestPath && jobId
    ? `${jobId}/pages-manifest.json`
    : null;
  const resolvedPageManifestPath = explicitPageManifestPath ?? derivedPageManifestPath ?? null;

  return {
    has_pdf_import_job: true,
    job_id: pdf.job_id ?? null,
    engine_version: pdf.engine_version ?? null,
    diagnostics_path: pdf.diagnostics_path ?? null,
    rasters_manifest_path: pdf.rasters_manifest_path ?? null,
    page_raster_count: Array.isArray(pdf.page_raster_paths) ? pdf.page_raster_paths.length : null,
    per_page_docling_artifact_version: pdf.per_page_docling_artifact_version ?? null,
    per_page_docling_parent_manifest_version: pdf.per_page_docling_parent_manifest_version ?? null,
    per_page_docling_global_artifact_copy_version: pdf.per_page_docling_global_artifact_copy_version ?? null,
    per_page_docling_manifest_path: resolvedPageManifestPath,
    per_page_docling_manifest_path_explicit: explicitPageManifestPath,
    per_page_docling_manifest_path_derived: derivedPageManifestPath,
    per_page_docling_page_count: pdf.per_page_docling_page_count ?? null,
    per_page_docling_validation_ok: pdf.per_page_docling_validation?.ok ?? null,
    per_page_docling_validation_problem_count: Array.isArray(pdf.per_page_docling_validation?.problems)
      ? pdf.per_page_docling_validation.problems.length
      : null,
    page_context_manifest_available: Boolean(resolvedPageManifestPath),
    page_context_source: explicitPageManifestPath
      ? 'per_page_docling_manifest_path'
      : derivedPageManifestPath
        ? 'derived_job_pages_manifest_path'
        : 'legacy_docling_path',
    mode: pdf.mode ?? null,
    page_count: pdf.page_count ?? null,
    consumer_guardrail_version: pdf.consumer_guardrail_version ?? null,
    parse_guardrails_ok: pdf.parse_guardrails?.ok ?? null,
    artifact_guardrails_ok: pdf.artifact_guardrails?.ok ?? null,
    artifact_contract_version: pdf.artifact_contract_version ?? null,
    docling_page_rebase_version: pdf.docling_page_rebase_version ?? null,
    chunk_merge_validation_version: pdf.chunk_merge_validation_version ?? null,
    terminal_state_version: pdf.terminal_state_version ?? null,
  };
}


async function buildStagedImportArtifactMeta(
  admin: ReturnType<typeof createClient>,
  importId: string,
  body: any,
  existingMeta: Record<string, unknown> = {},
) {
  const schemaPath = await uploadJsonArtifact(admin, importId, 'template-schema', body.schema);
  const cdirPath = await uploadJsonArtifact(admin, importId, 'cdir', body.cdir);
  const fidelityPath = await uploadJsonArtifact(admin, importId, 'cdir-fidelity', body.cdir_fidelity);
  const importAssetPath = await uploadJsonArtifact(admin, importId, 'import-asset', body.import_asset);
  const importManifestsPath = await uploadJsonArtifact(admin, importId, 'import-manifests', body.import_manifests);

  return {
    ...(existingMeta && typeof existingMeta === 'object' ? existingMeta : {}),
    ...(body.meta && typeof body.meta === 'object' ? body.meta : {}),
    source_checksum: body.source_checksum ?? body.cdir?.source?.checksum ?? null,
    schema_artifact_path: schemaPath,
    cdir_artifact_path: cdirPath,
    cdir_fidelity_artifact_path: fidelityPath,
    import_asset_artifact_path: importAssetPath,
    import_manifests_artifact_path: importManifestsPath,
    import_manifests: body.import_manifests ?? null,
    import_manifests_summary: importManifestSummary(body.import_manifests),
    import_asset_summary: importAssetSummary(body.import_asset),
    cdir_fidelity_summary: fidelitySummary(body.cdir_fidelity),
    artifact_contract_version: TEMPLATE_FINALIZATION_ARTIFACT_CONTRACT,
    artifact_stage: 'staged',
    artifact_staged_at: new Date().toISOString(),
    finalization_status: 'artifacts_staged',
  };
}

async function buildImportArtifactMeta(admin: ReturnType<typeof createClient>, importId: string, body: any) {
  const cdirPath = await uploadJsonArtifact(admin, importId, 'cdir', body.cdir);
  const fidelityPath = await uploadJsonArtifact(admin, importId, 'cdir-fidelity', body.cdir_fidelity);
  const importAssetPath = await uploadJsonArtifact(admin, importId, 'import-asset', body.import_asset);
  const importManifestsPath = await uploadJsonArtifact(admin, importId, 'import-manifests', body.import_manifests);
  return {
    ...(body.meta && typeof body.meta === 'object' ? body.meta : {}),
    source_checksum: body.source_checksum ?? body.cdir?.source?.checksum ?? null,
    cdir_artifact_path: cdirPath,
    cdir_fidelity_artifact_path: fidelityPath,
    import_asset_artifact_path: importAssetPath,
    import_manifests_artifact_path: importManifestsPath,
    import_manifests: body.import_manifests ?? null,
    import_manifests_summary: importManifestSummary(body.import_manifests),
    import_asset_summary: importAssetSummary(body.import_asset),
    cdir_fidelity_summary: fidelitySummary(body.cdir_fidelity),
  };
}


function validateReconstructedSchemaLite(raw: unknown): { ok: boolean; pageCount: number; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') {
    return { ok: false, pageCount: 0, errors: ['Schema must be an object.'] };
  }
  const schema = raw as any;
  const pages = Array.isArray(schema.pages) ? schema.pages : [];
  if (pages.length === 0) errors.push('Reconstruction produced no pages.');
  pages.forEach((page: any, index: number) => {
    if (!page || typeof page !== 'object') {
      errors.push(`Page ${index + 1} is not an object.`);
      return;
    }
    if (!page.id || !page.size || !Number.isFinite(Number(page.size.width)) || !Number.isFinite(Number(page.size.height))) {
      errors.push(`Page ${index + 1} is missing id or valid size.`);
    }
    if (!Array.isArray(page.blocks)) errors.push(`Page ${index + 1} is malformed (missing blocks).`);
  });
  return { ok: errors.length === 0, pageCount: pages.length, errors };
}

function schemaValidationErrorResponse(json: (body: unknown, status?: number) => Response, schema: unknown): Response | null {
  const validation = validateReconstructedSchemaLite(schema);
  if (validation.ok) return null;
  return json({
    error: 'schema_validation_failed',
    message: 'Reconstructed schema failed server-side validation.',
    validation,
  }, 400);
}

function b64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(',') ? b64.split(',')[1] : b64;
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function readJsonArtifact(admin: ReturnType<typeof createClient>, path: string | null | undefined) {
  if (!path) return null;
  const { data, error } = await admin.storage.from(ARTIFACT_BUCKET).download(path);
  if (error) {
    logDbError(`read_json_artifact.${path}`, error);
    return null;
  }
  try {
    return JSON.parse(await data.text());
  } catch (e) {
    console.error(`[template-import-pdf] artifact parse failed`, { path, error: String((e as Error).message ?? e) });
    return null;
  }
}


async function readPdfDiagnosticsJsonArtifact(admin: ReturnType<typeof createClient>, path: string | null | undefined) {
  if (!path || typeof path !== 'string') return null;
  const objectPath = path.startsWith(`${PDF_DIAGNOSTICS_BUCKET}/`)
    ? path.slice(PDF_DIAGNOSTICS_BUCKET.length + 1)
    : path;

  const { data, error } = await admin.storage.from(PDF_DIAGNOSTICS_BUCKET).download(objectPath);
  if (error || !data) {
    logDbError(`read_pdf_diagnostics_json.${objectPath}`, error);
    return null;
  }

  try {
    return JSON.parse(await data.text());
  } catch (e) {
    console.error(`[template-import-pdf] pdf diagnostics artifact parse failed`, {
      path: objectPath,
      error: String((e as Error).message ?? e),
    });
    return null;
  }
}


function normalizePdfDiagnosticsObjectPath(path: string | null | undefined): string | null {
  if (!path || typeof path !== 'string') return null;
  const trimmed = path.trim();
  if (!trimmed) return null;
  return trimmed.startsWith(`${PDF_DIAGNOSTICS_BUCKET}/`)
    ? trimmed.slice(PDF_DIAGNOSTICS_BUCKET.length + 1)
    : trimmed;
}

async function signPdfDiagnosticsArtifactPaths(
  admin: ReturnType<typeof createClient>,
  paths: Array<string | null | undefined>,
  authorizedJobId: string,
): Promise<Record<string, string>> {
  const unique = [...new Set(
    paths
      .filter((path) => isPdfDiagnosticsPathOwnedByJob(path, authorizedJobId))
      .map((path) => normalizePdfDiagnosticsObjectPath(path))
      .filter((path): path is string => Boolean(path))
  )];

  if (!unique.length) return {};

  const signed: Record<string, string> = {};
  const { data, error } = await admin.storage
    .from(PDF_DIAGNOSTICS_BUCKET)
    .createSignedUrls(unique, PDF_DIAGNOSTICS_SIGNED_URL_TTL_SECONDS);

  if (error) {
    logDbError('sign_pdf_diagnostics_artifact_paths', error);
    return {};
  }

  for (const item of data ?? []) {
    const objectPath = normalizePdfDiagnosticsObjectPath((item as any)?.path);
    const signedUrl = typeof (item as any)?.signedUrl === 'string' ? (item as any).signedUrl : null;
    if (objectPath && signedUrl) {
      signed[objectPath] = signedUrl;
      signed[`${PDF_DIAGNOSTICS_BUCKET}/${objectPath}`] = signedUrl;
    }
  }

  return signed;
}

// E1 — collect the durable Source Scene Graph V2 paths to sign, LAZILY (only the
// requested pages / regions / kinds) and ONLY from the trusted V3 manifest — a
// client-supplied path is never signed. Bounded so an 80-page doc cannot request
// hundreds of crops in one call.
const SOURCE_SCENE_MAX_SIGN = 300;

function collectSourceSceneV3PathsToSign(
  jobId: string | null,
  manifest: any,
  req: { pageNumbers?: unknown; regionIds?: unknown; kinds?: unknown },
): { paths: string[]; state: string; contractVersion: string | null } {
  const validation = validatePageArtifactContractV3(manifest, jobId ? { jobId } : {});
  if (!validation.manifest || validation.state !== 'valid_v3') {
    return { paths: [], state: validation.state, contractVersion: null };
  }
  const wantPages = Array.isArray(req.pageNumbers)
    ? new Set((req.pageNumbers as unknown[]).map(Number).filter((n) => Number.isFinite(n)))
    : null;
  const wantRegions = Array.isArray(req.regionIds) ? new Set((req.regionIds as unknown[]).map(String)) : null;
  const kinds = Array.isArray(req.kinds) ? new Set((req.kinds as unknown[]).map(String)) : null;
  const wantKind = (k: string): boolean => !kinds || kinds.has(k);

  const out: string[] = [];
  const push = (p: string | null | undefined): void => {
    if (typeof p === 'string' && p && isSafeArtifactPath(p) && out.length < SOURCE_SCENE_MAX_SIGN && !out.includes(p)) {
      out.push(p);
    }
  };

  const topScene = typeof manifest?.source_scene_path === 'string' ? manifest.source_scene_path : null;
  if (wantKind('scene') && (!wantPages || wantPages.size === 0)) push(topScene);

  for (const page of validation.manifest.pages) {
    if (wantPages && wantPages.size > 0 && !wantPages.has(page.pageNumber)) continue;
    if (wantKind('regions')) push(page.regionsPath);
    if (wantKind('source_spans')) push(page.sourceSpansPath);
    if (wantKind('foreground')) push(page.foregroundPath);
    if (wantKind('source')) push(page.sourcePath);
    if (wantKind('region_crop')) {
      for (const [rid, cropPath] of Object.entries(page.regionCropPaths)) {
        if (wantRegions && !wantRegions.has(rid)) continue;
        push(cropPath);
      }
    }
  }
  return { paths: out, state: validation.state, contractVersion: validation.manifest.artifactContractVersion };
}

function isPdfDiagnosticsPathForJob(path: string | null, jobId: string | null): boolean {
  const normalizedPath = normalizePdfDiagnosticsObjectPath(path);
  return Boolean(normalizedPath && jobId && normalizedPath.startsWith(`${jobId}/`));
}

function buildPdfPageArtifactSignedUrls(
  pdfPageContexts: any[],
  signedByPath: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};

  for (const ctx of pdfPageContexts ?? []) {
    const pageNo = Number(ctx?.page_no ?? 0);
    if (!Number.isFinite(pageNo) || pageNo <= 0) continue;

    const artifacts = ctx?.artifacts && typeof ctx.artifacts === 'object' ? ctx.artifacts : {};
    const entries: Array<[string, string | null | undefined]> = [
      ['source', artifacts.raster_path],
      ['raster', artifacts.raster_path],
      ['docling', artifacts.docling_path],
      ['blocks', artifacts.blocks_path],
      ['ocr', artifacts.ocr_path],
      ['tables', artifacts.tables_path],
      ['pictures', artifacts.pictures_path],
      ['vectors', artifacts.vectors_path],
      ['summary', artifacts.summary_path],
    ];

    for (const [kind, rawPath] of entries) {
      const objectPath = normalizePdfDiagnosticsObjectPath(rawPath);
      if (!objectPath) continue;
      const signedUrl = signedByPath[objectPath] ?? signedByPath[`${PDF_DIAGNOSTICS_BUCKET}/${objectPath}`] ?? null;
      if (signedUrl) {
        out[`${pageNo}:${kind}`] = signedUrl;
      }
    }
  }

  return out;
}

function summarizePdfPageManifest(manifest: any) {
  if (!manifest || typeof manifest !== 'object') return null;

  const pages = Array.isArray(manifest.pages) ? manifest.pages : [];
  const firstPage = pages[0] ?? null;
  const lastPage = pages.length ? pages[pages.length - 1] : null;
  const parentGlobalPathCount = pages.filter((page: any) =>
    typeof page?.docling_path === 'string'
    && typeof page?.page_no === 'number'
    && page.docling_path.includes(`/pages/page-${String(page.page_no).padStart(3, '0')}/`)
  ).length;

  return {
    version: manifest.version ?? null,
    artifact_contract_version: manifest.artifact_contract_version ?? null,
    parent_manifest_version: manifest.parent_manifest_version ?? null,
    global_artifact_copy_version: manifest.global_artifact_copy_version ?? null,
    source: manifest.source ?? null,
    page_count: manifest.page_count ?? pages.length,
    pages_observed: pages.length,
    validation_ok: manifest.validation?.ok ?? null,
    validation_problem_count: Array.isArray(manifest.validation?.problems) ? manifest.validation.problems.length : null,
    first_page_no: firstPage?.page_no ?? null,
    last_page_no: lastPage?.page_no ?? null,
    parent_global_path_count: parentGlobalPathCount,
    parent_global_paths_ok: pages.length > 0 && parentGlobalPathCount === pages.length,
  };
}


function buildPdfPageContexts(manifest: any) {
  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.pages)) {
    return [];
  }

  return manifest.pages
    .map((page: any) => {
      const pageNo = Number(page?.page_no ?? 0);
      if (!Number.isFinite(pageNo) || pageNo <= 0) return null;

      const padded = String(pageNo).padStart(3, '0');
      const expectedPrefix = `/pages/page-${padded}/`;

      const doclingPath = typeof page?.docling_path === 'string' ? page.docling_path : null;
      const blocksPath = typeof page?.blocks_path === 'string' ? page.blocks_path : null;
      const tablesPath = typeof page?.tables_path === 'string' ? page.tables_path : null;
      const picturesPath = typeof page?.pictures_path === 'string' ? page.pictures_path : null;
      const summaryPath = typeof page?.summary_path === 'string' ? page.summary_path : null;
      const rasterPath = typeof page?.raster_path === 'string' ? page.raster_path : null;
      // C2.2: OCR + vectors are optional; propagate when present.
      const ocrPath = typeof page?.ocr_path === 'string' ? page.ocr_path : null;
      const vectorsPath = typeof page?.vectors_path === 'string' ? page.vectors_path : null;

      const hasParentGlobalArtifacts = Boolean(
        doclingPath?.includes(expectedPrefix)
        && blocksPath?.includes(expectedPrefix)
        && summaryPath?.includes(expectedPrefix)
      );

      return {
        version: 'pdf-page-context-v1',
        page_no: pageNo,
        page_index: pageNo - 1,
        width: Number.isFinite(Number(page?.width)) ? Number(page.width) : null,
        height: Number.isFinite(Number(page?.height)) ? Number(page.height) : null,

        artifacts: {
          docling_path: doclingPath,
          blocks_path: blocksPath,
          tables_path: tablesPath,
          pictures_path: picturesPath,
          summary_path: summaryPath,
          raster_path: rasterPath,
          ocr_path: ocrPath,
          vectors_path: vectorsPath,
        },

        source: {
          manifest_path: typeof page?.source_manifest_path === 'string' ? page.source_manifest_path : null,
          source_chunk_index: Number.isFinite(Number(page?.source_chunk_index)) ? Number(page.source_chunk_index) : null,
          source_chunk_page_no: Number.isFinite(Number(page?.source_chunk_page_no)) ? Number(page.source_chunk_page_no) : null,
          source_chunk_artifact_paths: page?.source_chunk_artifact_paths && typeof page.source_chunk_artifact_paths === 'object'
            ? page.source_chunk_artifact_paths
            : null,
        },

        flags: {
          has_docling: Boolean(doclingPath),
          has_blocks: Boolean(blocksPath),
          has_tables: Boolean(tablesPath),
          has_pictures: Boolean(picturesPath),
          has_summary: Boolean(summaryPath),
          has_raster: Boolean(rasterPath),
          has_ocr: Boolean(ocrPath),
          has_vectors: Boolean(vectorsPath),
          has_parent_global_artifacts: hasParentGlobalArtifacts,
        },

        global_artifact_prefix: typeof page?.global_artifact_prefix === 'string' ? page.global_artifact_prefix : null,
        global_artifact_copy_version: page?.global_artifact_copy_version ?? null,
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => Number(a.page_no ?? 0) - Number(b.page_no ?? 0));
}

function summarizePdfPageContexts(pageContexts: any[], manifest: any) {
  const pageNumbers = pageContexts
    .map((ctx: any) => Number(ctx?.page_no ?? 0))
    .filter((n: number) => Number.isFinite(n) && n > 0);

  const unique = [...new Set(pageNumbers)].sort((a, b) => a - b);
  const uniquePageNumbers = new Set(unique);
  const rawExpectedPageCount = Number(manifest?.page_count ?? pageContexts.length);
  const hasValidExpectedPageCount = Number.isFinite(rawExpectedPageCount)
    && Number.isSafeInteger(rawExpectedPageCount)
    && rawExpectedPageCount >= 0;
  const expectedPageCount = Math.min(
    hasValidExpectedPageCount ? rawExpectedPageCount : pageContexts.length,
    PDF_PAGE_CONTEXT_SUMMARY_MAX_PAGES,
  );
  const missing: number[] = [];
  for (let i = 1; i <= expectedPageCount; i += 1) {
    if (!uniquePageNumbers.has(i)) missing.push(i);
  }

  const duplicate_page_numbers = unique.filter((n) => pageNumbers.filter((p) => p === n).length > 1);

  const requiredProblems: string[] = [];
  if (!hasValidExpectedPageCount) {
    requiredProblems.push('invalid_page_count');
  } else if (rawExpectedPageCount > PDF_PAGE_CONTEXT_SUMMARY_MAX_PAGES) {
    requiredProblems.push('page_count_exceeds_summary_limit');
  }
  for (const ctx of pageContexts) {
    const pageNo = Number(ctx?.page_no ?? 0);
    if (!ctx?.artifacts?.docling_path) requiredProblems.push(`page_${pageNo}_docling_path_missing`);
    if (!ctx?.artifacts?.blocks_path) requiredProblems.push(`page_${pageNo}_blocks_path_missing`);
    if (!ctx?.artifacts?.summary_path) requiredProblems.push(`page_${pageNo}_summary_path_missing`);
    if (!ctx?.flags?.has_parent_global_artifacts) requiredProblems.push(`page_${pageNo}_parent_global_artifacts_missing`);
  }

  const parentGlobalCount = pageContexts.filter((ctx: any) => ctx?.flags?.has_parent_global_artifacts).length;

  return {
    version: 'pdf-page-context-summary-v1',
    ok: missing.length === 0
      && duplicate_page_numbers.length === 0
      && requiredProblems.length === 0
      && pageContexts.length === expectedPageCount,
    expected_page_count: expectedPageCount,
    observed_page_count: pageContexts.length,
    first_page_no: unique[0] ?? null,
    last_page_no: unique.length ? unique[unique.length - 1] : null,
    parent_global_context_count: parentGlobalCount,
    missing_page_numbers: missing,
    duplicate_page_numbers,
    problems: requiredProblems,
  };
}


async function triggerFinalizeWorker(importId: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  const url = `${SUPABASE_URL}/functions/v1/template-import-finalize-worker`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEMPLATE_IMPORT_WORKER_TOKEN}`,
      },
      body: JSON.stringify({ import_id: importId }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, status: res.status, error: text.slice(0, 500) };
    }
    return { ok: true, status: res.status };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e).slice(0, 500) };
  }
}

function normalizeFinalizeMode(raw: unknown): 'finalize' | 'resync' {
  return raw === 'resync' ? 'resync' : 'finalize';
}

/**
 * Does this custom_users account carry an admin-tier role? Used to scope the
 * import-review discovery reads (list_recent_imports): admins see every recent
 * import, non-admins see only their own — matching the template_imports RLS
 * intent ("users read their imports or admins read all"). The browser client
 * is anonymous under this app's custom-auth flow, so these reads must run here
 * (service role) rather than directly against RLS-protected tables.
 */
async function userHasAdminRole(admin: any, userId: string | null): Promise<boolean> {
  if (!userId) return false;
  try {
    const { data: cu } = await admin.from('custom_users').select('role').eq('id', userId).maybeSingle();
    const role = String((cu as any)?.role ?? '').toLowerCase();
    if (['super_admin', 'superadmin', 'admin', 'sub_admin'].includes(role)) return true;
    const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', userId);
    return (roles ?? []).some((r: any) => ['admin', 'superadmin'].includes(String(r?.role ?? '').toLowerCase()));
  } catch {
    return false;
  }
}

// ---------- Phase 9C: golden run history helpers ----------
const GOLDEN_RUN_TABLE = 'pdf_import_golden_runs';
const GOLDEN_RUN_GATE_STATUSES = ['pass', 'warning', 'fail', 'blocked', 'not_evaluated'];
const GOLDEN_RUN_OPERATOR_DECISIONS = [
  'accepted', 'accepted_with_warnings', 'rejected', 'needs_rerun', 'not_reviewed',
];

function grStr(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}
function grNum(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function grInt(value: unknown): number | null {
  const n = grNum(value);
  return n === null ? null : Math.trunc(n);
}
function grBool(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}
function grCount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}
function grArr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function grObj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Map a camelCase history input payload to snake_case table columns. */
function goldenRunInputToColumns(history: any, importId: string, createdBy: string | null) {
  return {
    run_id: grStr(history.runId),
    run_batch_id: grStr(history.runBatchId),
    corpus_id: grStr(history.corpusId),
    category: grStr(history.category),
    import_id: importId,
    template_id: grStr(history.templateId),
    source_filename: grStr(history.sourceFilename),
    engine_version: grStr(history.engineVersion),
    orchestrator_version: grStr(history.orchestratorVersion),
    summary_version: grStr(history.summaryVersion),
    import_status: grStr(history.importStatus),
    run_status: grStr(history.runStatus),
    run_decision: grStr(history.runDecision),
    quality_gate_status: grStr(history.qualityGateStatus),
    operator_decision: grStr(history.operatorDecision),
    import_page_count: grInt(history.importPageCount),
    template_page_count: grInt(history.templatePageCount),
    visual_qa_score: grNum(history.visualQaScore),
    visual_qa_manual_review_required: grBool(history.visualQaManualReviewRequired),
    repair_status: grStr(history.repairStatus),
    repair_final_score: grNum(history.repairFinalScore),
    repair_requires_fallback: grBool(history.repairRequiresFallback),
    repair_requires_manual_review: grBool(history.repairRequiresManualReview),
    ai_reconciliation_status: grStr(history.aiReconciliationStatus),
    ai_reconciliation_recommendation: grStr(history.aiReconciliationRecommendation),
    export_parity_status: grStr(history.exportParityStatus),
    export_parity_mode: grStr(history.exportParityMode),
    export_vs_source_score: grNum(history.exportVsSourceScore),
    editor_vs_source_score: grNum(history.editorVsSourceScore),
    export_vs_editor_score: grNum(history.exportVsEditorScore),
    warning_count: grCount(history.warningCount),
    failure_count: grCount(history.failureCount),
    warnings: grArr(history.warnings),
    failures: grArr(history.failures),
    gate_summary: grObj(history.gateSummary),
    triage_summary: grObj(history.triageSummary),
    golden_regression_summary: grObj(history.goldenRegressionSummary),
    baseline_comparison: history.baselineComparison ?? null,
    created_by: createdBy,
  };
}

/** Map a snake_case table row (minus the embedded owner join) to a camelCase record. */
function goldenRunRowToCamel(row: any) {
  return {
    id: row.id ?? null,
    runId: row.run_id ?? null,
    runBatchId: row.run_batch_id ?? null,
    corpusId: row.corpus_id ?? null,
    category: row.category ?? null,
    importId: row.import_id ?? null,
    templateId: row.template_id ?? null,
    sourceFilename: row.source_filename ?? null,
    engineVersion: row.engine_version ?? null,
    orchestratorVersion: row.orchestrator_version ?? null,
    summaryVersion: row.summary_version ?? null,
    importStatus: row.import_status ?? null,
    runStatus: row.run_status ?? null,
    runDecision: row.run_decision ?? null,
    qualityGateStatus: row.quality_gate_status ?? null,
    operatorDecision: row.operator_decision ?? null,
    importPageCount: row.import_page_count ?? null,
    templatePageCount: row.template_page_count ?? null,
    visualQaScore: row.visual_qa_score ?? null,
    visualQaManualReviewRequired: row.visual_qa_manual_review_required ?? null,
    repairStatus: row.repair_status ?? null,
    repairFinalScore: row.repair_final_score ?? null,
    repairRequiresFallback: row.repair_requires_fallback ?? null,
    repairRequiresManualReview: row.repair_requires_manual_review ?? null,
    aiReconciliationStatus: row.ai_reconciliation_status ?? null,
    aiReconciliationRecommendation: row.ai_reconciliation_recommendation ?? null,
    exportParityStatus: row.export_parity_status ?? null,
    exportParityMode: row.export_parity_mode ?? null,
    exportVsSourceScore: row.export_vs_source_score ?? null,
    editorVsSourceScore: row.editor_vs_source_score ?? null,
    exportVsEditorScore: row.export_vs_editor_score ?? null,
    warningCount: row.warning_count ?? 0,
    failureCount: row.failure_count ?? 0,
    warnings: Array.isArray(row.warnings) ? row.warnings : [],
    failures: Array.isArray(row.failures) ? row.failures : [],
    gateSummary: grObj(row.gate_summary),
    triageSummary: grObj(row.triage_summary),
    goldenRegressionSummary: grObj(row.golden_regression_summary),
    baselineComparison: row.baseline_comparison ?? null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

const GOLDEN_RUN_SELECT =
  'id,run_id,run_batch_id,corpus_id,category,import_id,template_id,source_filename,engine_version,orchestrator_version,summary_version,import_status,run_status,run_decision,quality_gate_status,operator_decision,import_page_count,template_page_count,visual_qa_score,visual_qa_manual_review_required,repair_status,repair_final_score,repair_requires_fallback,repair_requires_manual_review,ai_reconciliation_status,ai_reconciliation_recommendation,export_parity_status,export_parity_mode,export_vs_source_score,editor_vs_source_score,export_vs_editor_score,warning_count,failure_count,warnings,failures,gate_summary,triage_summary,golden_regression_summary,baseline_comparison,created_by,created_at,updated_at';

Deno.serve(async (req) => {
  // Origin-aware: an allowlisted origin gets an exact ACAO + credentials so the
  // HttpOnly `__Host-session_token` cookie authenticates the import. Anyone else
  // keeps the historical wildcard token-auth answer. See createTokenAuthCorsHeaders.
  const cors = createTokenAuthCorsHeaders(req.headers.get('origin'));
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  // Cookie authority is ambient, so every cookie-carrying mutation needs an
  // exact-origin check. No-ops for callers that send no cookie (token auth).
  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(cors, csrf);

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    let body = await req.json().catch(() => ({}));
    // Contract normalisation: several frontend callers (visual-quality +
    // repair-audit persistence) invoke this function as
    // `invokeSecureFunction(fn, { body: { operation, ... } })`. invokeSecureFunction
    // forwards its 2nd argument verbatim, so the operation payload arrives nested
    // under a `body` key — `{ body: { operation, ... }, session_token }` — and the
    // dispatch below would never see `operation` (→ "unknown operation", and no
    // visual QA / repair audit ever persisted). Unwrap that envelope while keeping
    // the top-level auth fields (session_token, user_id) intact. Callers that pass
    // the payload directly are unaffected (they already carry a top-level operation).
    if (body && typeof body === 'object' && !body.operation && body.body && typeof body.body === 'object') {
      const { body: wrapped, ...envelope } = body as Record<string, unknown>;
      body = { ...(wrapped as Record<string, unknown>), ...envelope };
    }
    const operation = body.operation as string;

    // Custom-auth verification (session token or custom HS256 JWT). The old
    // implementation used supabase.auth.getUser(), which can NEVER succeed for
    // this app's custom_users accounts — every authed operation 401'd.
    const auth = await verifyAuthOrNativeUser(admin, req, body);
    if (auth.error) return createUnauthorizedResponse(auth.error, cors);
    const authedUserId = auth.userId && auth.userId !== 'service_role' ? auth.userId : null;
    const userId = authedUserId ?? body.user_id ?? null;

    if (operation === 'create_import') {
      const permission = await requireModulePermission(
        admin,
        { userId: auth.userId, authMethod: auth.authMethod },
        'templates',
        'can_edit',
      );
      if (!permission.ok) return json({ error: permission.error, code: permission.reason_code }, 403);

      const { data, error } = await admin
        .from('template_imports')
        .insert({
          user_id: userId,
          status: 'processing',
          fidelity_mode: body.fidelity_mode ?? 'semantic',
          source_filename: body.source_filename ?? null,
          source_size_bytes: body.source_size_bytes ?? null,
          page_count: body.page_count ?? null,
          meta: body.meta ?? {},
        })
        .select()
        .single();
      if (error) return json({ error: error.message }, 400);
      return json({ record: data });
    }

    if (operation === 'upload_asset') {
      const importId = body.import_id as string;
      if (!importId) return json({ error: 'import_id required' }, 400);

      const permission = await requireModulePermission(
        admin,
        { userId: auth.userId, authMethod: auth.authMethod },
        'templates',
        'can_edit',
      );
      if (!permission.ok) return json({ error: permission.error, code: permission.reason_code }, 403);

      const { data: importRecord, error: importError } = await admin
        .from('template_imports')
        .select('id,user_id')
        .eq('id', importId)
        .maybeSingle();
      if (importError) return json({ error: importError.message }, 400);
      if (!importRecord) return json({ error: 'Import record not found' }, 404);
      if (auth.userId !== 'service_role' && importRecord.user_id !== authedUserId) {
        return json({ error: 'forbidden' }, 403);
      }

      const kind = body.kind ?? 'page';
      const pageIndex = Number(body.page_index ?? 0);
      const seq = Number(body.seq ?? 0);
      const contentType = body.content_type ?? 'image/png';
      if (!['page', 'image'].includes(kind)) return json({ error: 'Invalid asset kind' }, 400);
      if (!Number.isSafeInteger(pageIndex) || pageIndex < 0 || !Number.isSafeInteger(seq) || seq < 0) {
        return json({ error: 'Invalid asset index' }, 400);
      }
      if (!ALLOWED_ASSET_CONTENT_TYPES.has(contentType)) return json({ error: 'Invalid asset content type' }, 400);
      const ext = contentType.includes('jpeg') ? 'jpg' : contentType.includes('webp') ? 'webp' : 'png';
      const path = `${importId}/${kind}-${pageIndex}-${seq}.${ext}`;
      // Size ceiling before decoding caller-supplied base64 (request-size control):
      // ~20 MB of base64 ≈ ~15 MB decoded, comfortably above a page raster while
      // preventing a single upload from decoding an unbounded blob into memory.
      const dataB64 = (body.data_base64 as string) || '';
      if (!dataB64) return json({ error: 'Asset payload required' }, 400);
      if (dataB64.length > MAX_ASSET_BASE64_LENGTH) {
        return json({ error: 'Asset payload too large' }, 413);
      }
      let bytes: Uint8Array;
      try {
        bytes = b64ToBytes(dataB64);
      } catch {
        return json({ error: 'Invalid base64 asset payload' }, 400);
      }
      await ensureAssetBucket(admin);
      const { error: upErr } = await admin.storage
        .from(ASSET_BUCKET)
        .upload(path, bytes, { contentType, upsert: true });
      if (upErr) return json({ error: upErr.message }, 400);
      const { data: pub } = admin.storage.from(ASSET_BUCKET).getPublicUrl(path);
      return json({ url: pub.publicUrl, path });
    }


    if (operation === 'stage_artifacts') {
      const importId = body.import_id as string;
      if (!importId) return json({ error: 'import_id required' }, 400);

      const validationError = schemaValidationErrorResponse(json, body.schema);
      if (validationError) return validationError;

      const { data: existing, error: getErr } = await admin
        .from('template_imports')
        .select('id,user_id,meta')
        .eq('id', importId)
        .maybeSingle();

      if (getErr) return json({ error: getErr.message }, 404);
      if (!existing) return json({ error: 'Import record not found' }, 404);
      if ((existing as any)?.user_id && authedUserId && (existing as any).user_id !== authedUserId) {
        return json({ error: 'forbidden' }, 403);
      }

      const existingMeta = ((existing as any)?.meta && typeof (existing as any).meta === 'object')
        ? ((existing as any).meta as Record<string, unknown>)
        : {};
      const artifactMeta = await buildStagedImportArtifactMeta(admin, importId, body, existingMeta);

      if (!artifactMeta.schema_artifact_path) {
        return json({ error: 'schema_artifact_upload_failed' }, 500);
      }

      const pageCount = body.page_count ?? artifactMeta.cdir_fidelity_summary?.pageCount ?? null;
      const { data: updated, error: updateErr } = await admin
        .from('template_imports')
        .update({
          status: 'processing',
          page_count: pageCount,
          meta: artifactMeta,
          error: null,
        })
        .eq('id', importId)
        .select('id,status,page_count,meta,created_template_id,error')
        .single();

      if (updateErr) return json({ error: updateErr.message }, 400);

      return json({
        ok: true,
        record: updated,
        artifactPaths: {
          schema: artifactMeta.schema_artifact_path ?? null,
          cdir: artifactMeta.cdir_artifact_path ?? null,
          cdirFidelity: artifactMeta.cdir_fidelity_artifact_path ?? null,
          importAsset: artifactMeta.import_asset_artifact_path ?? null,
          importManifests: artifactMeta.import_manifests_artifact_path ?? null,
        },
      });
    }


    if (operation === 'start_finalize') {
      const importId = body.import_id as string;
      if (!importId) return json({ error: 'import_id required' }, 400);

      const { data: existing, error: getErr } = await admin
        .from('template_imports')
        .select('id,user_id,status,page_count,source_filename,created_template_id,meta,error')
        .eq('id', importId)
        .maybeSingle();

      if (getErr) return json({ error: getErr.message }, 404);
      if (!existing) return json({ error: 'Import record not found' }, 404);
      if ((existing as any)?.user_id && authedUserId && (existing as any).user_id !== authedUserId) {
        return json({ error: 'forbidden' }, 403);
      }

      const currentMeta = ((existing as any)?.meta && typeof (existing as any).meta === 'object')
        ? ((existing as any).meta as Record<string, unknown>)
        : {};

      if (currentMeta.artifact_contract_version !== TEMPLATE_FINALIZATION_ARTIFACT_CONTRACT || !currentMeta.schema_artifact_path) {
        return json({
          error: 'artifacts_not_staged',
          message: 'Call stage_artifacts before start_finalize.',
        }, 409);
      }

      const mode = normalizeFinalizeMode(body.mode);
      const templateId = typeof body.template_id === 'string' ? body.template_id : null;
      if (mode === 'resync' && !templateId) {
        return json({ error: 'template_id required for resync finalization' }, 400);
      }
      if (mode === 'resync' && templateId) {
        const authorization = await authorizeTemplateResync(admin, authedUserId ?? 'service_role', templateId);
        if (!authorization.exists) return json({ error: 'Template not found' }, 404);
        if (!authorization.allowed) return json({ error: 'forbidden' }, 403);
      }

      const finalizationRequest = {
        mode,
        template_id: templateId,
        name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Imported template',
        note: typeof body.note === 'string' && body.note.trim() ? body.note.trim() : 'Re-synced from PDF',
        source_filename: body.source_filename ?? (existing as any).source_filename ?? null,
        page_count: body.page_count ?? (existing as any).page_count ?? null,
        requested_by: authedUserId ?? 'service_role',
        requested_at: new Date().toISOString(),
      };

      const nextMeta = {
        ...currentMeta,
        finalization_status: 'queued',
        finalization_request: finalizationRequest,
        finalization_queued_at: new Date().toISOString(),
        finalization_error: null,
      };

      const { data: updated, error: updateErr } = await admin
        .from('template_imports')
        .update({
          status: 'processing',
          page_count: finalizationRequest.page_count,
          meta: nextMeta,
          error: null,
        })
        .eq('id', importId)
        .select('id,status,page_count,created_template_id,meta,error')
        .single();

      if (updateErr) return json({ error: updateErr.message }, 400);

      const trigger = await triggerFinalizeWorker(importId);
      if (!trigger.ok) {
        const failedMeta = {
          ...nextMeta,
          finalization_status: 'worker_trigger_failed',
          finalization_error: trigger.error ?? `worker_http_${trigger.status}`,
          recoverable: true,
        };
        await admin.from('template_imports').update({
          status: 'failed',
          meta: failedMeta,
          error: trigger.error ?? `worker trigger failed with status ${trigger.status}`,
        }).eq('id', importId);

        return json({
          error: 'worker_trigger_failed',
          details: trigger.error,
          status: trigger.status,
          recoverable: true,
        }, 502);
      }

      return json({ ok: true, accepted: true, record: updated }, 202);
    }

    if (operation === 'retry_finalize') {
      const importId = body.import_id as string;
      if (!importId) return json({ error: 'import_id required' }, 400);

      const { data: existing, error: getErr } = await admin
        .from('template_imports')
        .select('id,user_id,status,page_count,created_template_id,meta,error')
        .eq('id', importId)
        .maybeSingle();

      if (getErr) return json({ error: getErr.message }, 404);
      if (!existing) return json({ error: 'Import record not found' }, 404);
      if ((existing as any)?.user_id && authedUserId && (existing as any).user_id !== authedUserId) {
        return json({ error: 'forbidden' }, 403);
      }

      const currentMeta = ((existing as any)?.meta && typeof (existing as any).meta === 'object')
        ? ((existing as any).meta as Record<string, unknown>)
        : {};

      if (currentMeta.artifact_contract_version !== TEMPLATE_FINALIZATION_ARTIFACT_CONTRACT || !currentMeta.schema_artifact_path) {
        return json({ error: 'artifacts_not_staged' }, 409);
      }
      if (!currentMeta.finalization_request || typeof currentMeta.finalization_request !== 'object') {
        return json({ error: 'finalization_request_missing' }, 409);
      }

      const nextMeta = {
        ...currentMeta,
        finalization_status: 'queued',
        finalization_queued_at: new Date().toISOString(),
        finalization_retried_at: new Date().toISOString(),
        finalization_error: null,
        recoverable: null,
      };

      const { data: updated, error: updateErr } = await admin
        .from('template_imports')
        .update({
          status: 'processing',
          meta: nextMeta,
          error: null,
        })
        .eq('id', importId)
        .select('id,status,page_count,created_template_id,meta,error')
        .single();

      if (updateErr) return json({ error: updateErr.message }, 400);

      const trigger = await triggerFinalizeWorker(importId);
      if (!trigger.ok) {
        return json({
          error: 'worker_trigger_failed',
          details: trigger.error,
          status: trigger.status,
          recoverable: true,
        }, 502);
      }

      return json({ ok: true, accepted: true, record: updated }, 202);
    }

    if (operation === 'get_status') {
      const importId = body.import_id as string;
      if (!importId) return json({ error: 'import_id required' }, 400);

      const { data: record, error: getErr } = await admin
        .from('template_imports')
        .select('id,user_id,status,fidelity_mode,source_filename,page_count,created_template_id,error,meta,created_at,updated_at')
        .eq('id', importId)
        .maybeSingle();

      if (getErr) return json({ error: getErr.message }, 404);
      if (!record) return json({ error: 'Import record not found' }, 404);
      if ((record as any)?.user_id && authedUserId && (record as any).user_id !== authedUserId) {
        return json({ error: 'forbidden' }, 403);
      }

      return json({ record });
    }

    if (operation === 'finalize') {
      const importId = body.import_id as string;
      if (!importId) return json({ error: 'import_id required' }, 400);

      // This function writes with service-role privileges, so reproduce both
      // authorization boundaries that RLS would otherwise enforce: template
      // edit permission and ownership of the import being finalized.
      const permission = await requireModulePermission(
        admin,
        { userId: auth.userId, authMethod: auth.authMethod },
        'templates',
        'can_edit',
      );
      if (!permission.ok) return json({ error: permission.error, code: permission.reason_code }, 403);

      const { data: importRecord, error: importError } = await admin
        .from('template_imports')
        .select('id,user_id')
        .eq('id', importId)
        .maybeSingle();
      if (importError) return json({ error: importError.message }, 400);
      if (!importRecord) return json({ error: 'Import record not found' }, 404);
      if (auth.userId !== 'service_role' && importRecord.user_id !== authedUserId) {
        return json({ error: 'forbidden' }, 403);
      }

      const name = (body.name as string) ?? 'Imported template';
      const schema = body.schema;
      const validationError = schemaValidationErrorResponse(json, schema);
      if (validationError) return validationError;
      const pageCount = body.page_count ?? null;

      // Delegate to the `public.template_finalize` SECURITY DEFINER RPC, which
      // raises statement_timeout to 5min and writes the template row +
      // version snapshot + template_imports completion atomically. The default
      // 10s statement timeout cancels large hybrid/pixel-perfect schemas
      // (multi-page imports embed base64 page rasters) mid-INSERT.
      const artifactMeta = await buildImportArtifactMeta(admin, importId, body);
      // Use the v2 RPC which returns only id/name/version. The previous RPC
      // returned the entire report_templates row, forcing PostgREST to
      // re-serialize the (sometimes multi-MB) schema jsonb back to the
      // edge function — that round-trip is what was tripping the project's
      // default statement_timeout on hybrid/pixel imports.
      const { data: rpcRow, error: rpcErr } = await admin.rpc('template_finalize_v2', {
        p_import_id: importId,
        p_name: name,
        p_description: `Imported from ${body.source_filename ?? 'PDF'}`,
        p_schema: schema,
        p_page_count: pageCount,
        p_meta: artifactMeta ?? {},
      });
      if (rpcErr) {
        logDbError('finalize.rpc_template_finalize_v2', rpcErr);
        return json({ error: rpcErr.message, details: rpcErr.details, hint: rpcErr.hint, code: rpcErr.code }, 400);
      }
      const tpl = Array.isArray(rpcRow) ? rpcRow[0] : rpcRow;
      if (!tpl) return json({ error: 'Finalize returned no template row' }, 500);
      return json({ template: tpl });
    }

    if (operation === 'resync') {
      // Replace an existing template's schema (re-import revised PDF).
      // Bumps version and snapshots the previous schema.
      //
      // The snapshot + update + post-snapshot is delegated to the
      // `public.template_resync` SECURITY DEFINER function, which raises
      // statement_timeout to 5min so multi-page hybrid schemas with embedded
      // raster page refs don't get cancelled mid-save, and uses
      // ON CONFLICT DO NOTHING on the version snapshots so a partially-failed
      // previous attempt doesn't block a retry.
      const importId = body.import_id as string;
      const templateId = body.template_id as string;
      const schema = body.schema;
      const note = (body.note as string) || 'Re-synced from PDF';
      if (!templateId || !schema) return json({ error: 'template_id and schema required' }, 400);
      const validationError = schemaValidationErrorResponse(json, schema);
      if (validationError) return validationError;

      const authorization = await authorizeTemplateResync(admin, authedUserId ?? 'service_role', templateId);
      if (!authorization.exists) return json({ error: 'Template not found' }, 404);
      if (!authorization.allowed) return json({ error: 'forbidden' }, 403);

      // v2 RPC returns only id/name/version. See finalize note above — the
      // legacy version returned the full row (including the multi-MB schema)
      // and PostgREST's re-serialization round-trip was timing out.
      const { data: rpcRow, error: rpcErr } = await admin.rpc('template_resync_v2', {
        p_template_id: templateId,
        p_schema: schema,
        p_note: note,
      });
      if (rpcErr) {
        logDbError('resync.rpc_template_resync_v2', rpcErr);
        return json({ error: rpcErr.message, details: rpcErr.details, hint: rpcErr.hint, code: rpcErr.code }, 400);
      }
      const tpl = Array.isArray(rpcRow) ? rpcRow[0] : rpcRow;
      if (!tpl) return json({ error: 'Template not found' }, 404);

      const artifactMeta = await buildImportArtifactMeta(admin, importId, body);
      await admin.from('template_imports').update({
        status: 'completed',
        created_template_id: templateId,
        page_count: body.page_count ?? null,
        meta: artifactMeta,
      }).eq('id', importId);

      return json({ template: tpl, version: tpl.version });
    }


    if (operation === 'get_artifacts') {
      const importId = body.import_id as string;
      if (!importId) return json({ error: 'import_id required' }, 400);
      if (!authedUserId && auth.userId !== 'service_role') return json({ error: 'unauthorized' }, 401);

      const { data: record, error: getErr } = await admin
        .from('template_imports')
        .select('id,user_id,status,created_template_id,page_count,source_filename,meta')
        .eq('id', importId)
        .single();
      if (getErr) return json({ error: getErr.message }, 404);
      if (record?.user_id && authedUserId && record.user_id !== authedUserId) return json({ error: 'forbidden' }, 403);

      const meta = ((record.meta && typeof record.meta === 'object') ? record.meta : {}) as any;
      const readOwnedArtifact = (path: unknown) => readJsonArtifact(
        admin,
        isTemplateImportArtifactPathOwnedByImport(path, importId) ? path : null,
      );
      const cdir = await readOwnedArtifact(meta.cdir_artifact_path);
      const cdirFidelity = await readOwnedArtifact(meta.cdir_fidelity_artifact_path);
      const importAsset = await readOwnedArtifact(meta.import_asset_artifact_path);
      const importManifests = await readOwnedArtifact(meta.import_manifests_artifact_path);

      const pdfImportJob = importManifests?.pdf_import_job && typeof importManifests.pdf_import_job === 'object'
        ? importManifests.pdf_import_job
        : null;

      const importManifestSummaryMeta = meta.import_manifests_summary && typeof meta.import_manifests_summary === 'object'
        ? meta.import_manifests_summary
        : null;

      const pdfJobId = typeof pdfImportJob?.job_id === 'string' && pdfImportJob.job_id.length > 0
        ? pdfImportJob.job_id
        : typeof importManifestSummaryMeta?.job_id === 'string' && importManifestSummaryMeta.job_id.length > 0
          ? importManifestSummaryMeta.job_id
          : null;

      let authorizedPdfJobId: string | null = null;
      let pdfJobResultPayload: any = null;
      if (pdfJobId) {
        const { data: pdfJob, error: pdfJobErr } = await admin
          .from('pdf_import_jobs')
          .select('id,result_payload,diagnostics_path,engine_version')
          .eq('id', pdfJobId)
          .eq('user_id', record.user_id)
          .eq('template_import_id', importId)
          .maybeSingle();

        if (pdfJobErr) {
          logDbError('get_artifacts.pdf_import_jobs.lookup', pdfJobErr);
        } else if (pdfJob) {
          authorizedPdfJobId = pdfJob.id;
          if (pdfJob.result_payload && typeof pdfJob.result_payload === 'object') {
            pdfJobResultPayload = pdfJob.result_payload;
          }
        }
      }

      const explicitPdfPageManifestPath = typeof pdfImportJob?.per_page_docling_manifest_path === 'string' && pdfImportJob.per_page_docling_manifest_path.length > 0
        ? pdfImportJob.per_page_docling_manifest_path
        : null;

      const metaSummaryPdfPageManifestPath = typeof importManifestSummaryMeta?.per_page_docling_manifest_path === 'string' && importManifestSummaryMeta.per_page_docling_manifest_path.length > 0
        ? importManifestSummaryMeta.per_page_docling_manifest_path
        : null;

      const jobPayloadPdfPageManifestPath = typeof pdfJobResultPayload?.per_page_docling_manifest_path === 'string' && pdfJobResultPayload.per_page_docling_manifest_path.length > 0
        ? pdfJobResultPayload.per_page_docling_manifest_path
        : null;

      const derivedPdfPageManifestPath = authorizedPdfJobId
        ? `${authorizedPdfJobId}/pages-manifest.json`
        : null;

      const manifestCandidates = [
        ['per_page_docling_manifest_path', explicitPdfPageManifestPath],
        ['meta_import_manifests_summary_path', metaSummaryPdfPageManifestPath],
        ['pdf_import_jobs_result_payload_path', jobPayloadPdfPageManifestPath],
        ['derived_job_pages_manifest_path', derivedPdfPageManifestPath],
      ]
        .filter((entry): entry is [string, string] => Boolean(entry[1]))
        .filter((entry) => isPdfDiagnosticsPathOwnedByJob(entry[1], authorizedPdfJobId))
        .filter((entry, index, arr) => arr.findIndex((candidate) => candidate[1] === entry[1]) === index);

      let pdfPageManifestPath: string | null = null;
      let pdfPageManifest: any = null;
      let pdfPageManifestSource = 'missing';

      for (const [source, candidatePath] of manifestCandidates) {
        const candidateManifest = await readPdfDiagnosticsJsonArtifact(admin, candidatePath);
        if (candidateManifest) {
          pdfPageManifestPath = candidatePath;
          pdfPageManifest = candidateManifest;
          pdfPageManifestSource = source;
          break;
        }
      }

      const pdfPageManifestSummary = summarizePdfPageManifest(pdfPageManifest);
      const pdfPageContexts = buildPdfPageContexts(pdfPageManifest);
      const pdfPageContextSummary = summarizePdfPageContexts(pdfPageContexts, pdfPageManifest);

      const pdfDiagnosticsPathsToSign: Array<string | null | undefined> = [
        pdfPageManifestPath,
        ...pdfPageContexts.flatMap((ctx: any) => [
          ctx?.artifacts?.raster_path,
          ctx?.artifacts?.docling_path,
          ctx?.artifacts?.blocks_path,
          ctx?.artifacts?.ocr_path,
          ctx?.artifacts?.tables_path,
          ctx?.artifacts?.pictures_path,
          ctx?.artifacts?.vectors_path,
          ctx?.artifacts?.summary_path,
        ]),
      ];
      const pdfDiagnosticsSignedByPath = authorizedPdfJobId
        ? await signPdfDiagnosticsArtifactPaths(admin, pdfDiagnosticsPathsToSign, authorizedPdfJobId)
        : {};
      const pdfPageArtifactSignedUrls = buildPdfPageArtifactSignedUrls(pdfPageContexts, pdfDiagnosticsSignedByPath);

      // E1 — additionally sign Source Scene Graph V2 artifacts, lazily and only
      // for the requested pages/regions/kinds, derived solely from the trusted V3
      // manifest. Legacy V2 imports return an empty map + a `legacy` state.
      const sourceSceneV3 = collectSourceSceneV3PathsToSign(authorizedPdfJobId, pdfPageManifest, body);
      const sourceSceneSignedByPath = sourceSceneV3.paths.length
        && authorizedPdfJobId
        ? await signPdfDiagnosticsArtifactPaths(admin, sourceSceneV3.paths, authorizedPdfJobId)
        : {};

      return json({
        record,
        cdir,
        cdirFidelity,
        importAsset,
        importManifests,
        pdfPageManifest,
        pdfPageManifestSummary,
        pdfPageContexts,
        pdfPageContextSummary,
        // C2.1: return the signed-URL maps (previously computed but dropped) so
        // the authenticated review UI can load private per-page artifacts. URLs
        // are short-lived and never persisted.
        pdfDiagnosticsSignedByPath,
        pdfPageArtifactSignedUrls,
        // E1 — Source Scene Graph V2 lazy signed delivery (durable path → short-lived
        // signed URL). Empty for legacy V2 imports; never persisted anywhere.
        sourceSceneSignedByPath,
        sourceSceneContractVersion: sourceSceneV3.contractVersion,
        sourceSceneManifestState: sourceSceneV3.state,
        pdfDiagnosticsSignedUrlTtlSeconds: PDF_DIAGNOSTICS_SIGNED_URL_TTL_SECONDS,
        pageContextEntrypoint: {
          available: Boolean(pdfPageManifestPath && pdfPageManifest && pdfPageContexts.length > 0),
          source: pdfPageManifestSource,
          manifest_path: pdfPageManifestPath,
          manifest_candidates: manifestCandidates.map(([source, path]) => ({ source, path })),
          page_count: pdfPageManifestSummary?.page_count ?? null,
          validation_ok: pdfPageManifestSummary?.validation_ok ?? null,
          parent_global_paths_ok: pdfPageManifestSummary?.parent_global_paths_ok ?? null,
          page_contexts_ok: pdfPageContextSummary.ok,
          page_contexts_usable: Boolean(pdfPageManifestPath && pdfPageManifest && pdfPageContexts.length > 0),
          page_context_count: pdfPageContexts.length,
          page_context_problems: pdfPageContextSummary.problems ?? [],
        },
        artifactPaths: {
          cdir: meta.cdir_artifact_path ?? null,
          cdirFidelity: meta.cdir_fidelity_artifact_path ?? null,
          importAsset: meta.import_asset_artifact_path ?? null,
          importManifests: meta.import_manifests_artifact_path ?? null,
          pdfPageManifest: pdfPageManifestPath,
        },
      });
    }

    if (operation === 'record_review_decision') {
      const importId = body.import_id as string;
      const decision = String(body.decision ?? '');
      const allowed = ['accept', 'accept_with_trace', 'retry', 'manual_edit'];
      if (!importId) return json({ error: 'import_id required' }, 400);
      if (!allowed.includes(decision)) return json({ error: 'invalid decision' }, 400);
      if (!authedUserId) return json({ error: 'unauthorized' }, 401);

      const { data: record, error: getErr } = await admin
        .from('template_imports')
        .select('id,user_id,meta')
        .eq('id', importId)
        .single();
      if (getErr) return json({ error: getErr.message }, 404);
      if (record?.user_id && record.user_id !== authedUserId) return json({ error: 'forbidden' }, 403);

      const currentMeta = ((record.meta && typeof record.meta === 'object') ? record.meta : {}) as any;
      const reviewDecision = {
        decision,
        note: body.note ? String(body.note).slice(0, 1000) : null,
        decided_at: new Date().toISOString(),
        decided_by: authedUserId,
      };
      const nextMeta = { ...currentMeta, import_review_decision: reviewDecision };
      const { data: updated, error: upErr } = await admin
        .from('template_imports')
        .update({ meta: nextMeta })
        .eq('id', importId)
        .select('id,meta')
        .single();
      if (upErr) return json({ error: upErr.message }, 400);
      return json({ record: updated, decision: reviewDecision });
    }

    // ---------- Import-review discovery reads (browser client is anon under
    // custom auth, so RLS-protected template_imports must be read here). ----------
    if (operation === 'list_recent_imports') {
      if (!authedUserId) return json({ error: 'unauthorized' }, 401);
      const limit = Math.min(Math.max(Number(body.limit ?? 10) || 10, 1), 50);
      const isAdmin = await userHasAdminRole(admin, authedUserId);
      let query = admin
        .from('template_imports')
        .select('id,source_filename,page_count,status,created_template_id,created_at,meta')
        .eq('status', 'completed')
        .not('meta->>cdir_artifact_path', 'is', null)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (!isAdmin) query = query.eq('user_id', authedUserId);
      const { data, error } = await query;
      if (error) return json({ error: error.message }, 400);
      return json({ records: data ?? [] });
    }

    if (operation === 'get_linked_import') {
      if (!authedUserId) return json({ error: 'unauthorized' }, 401);
      const templateId = body.template_id as string;
      if (!templateId) return json({ error: 'template_id required' }, 400);
      const isAdmin = await userHasAdminRole(admin, authedUserId);
      let query = admin
        .from('template_imports')
        .select('id,source_filename,updated_at,created_at')
        .eq('created_template_id', templateId)
        .eq('status', 'completed')
        .not('meta->>cdir_artifact_path', 'is', null)
        .order('updated_at', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1);
      if (!isAdmin) query = query.eq('user_id', authedUserId);
      const { data, error } = await query.maybeSingle();
      if (error) return json({ error: error.message }, 400);
      return json({ record: data ?? null });
    }

    if (operation === 'fail') {
      const importId = body.import_id as string;
      await admin.from('template_imports').update({
        status: 'failed',
        error: String(body.error ?? 'unknown'),
      }).eq('id', importId);
      return json({ ok: true });
    }

    // ---------- Phase 9: append allowlisted audit metadata ----------
    if (operation === 'append_meta') {
      const importId = body.import_id as string;
      const patch = body.meta_patch;
      if (!importId || !isAllowedTemplateImportMetaPatch(patch)) {
        return json({ error: 'import_id and an allowlisted meta_patch are required' }, 400);
      }
      const { data: rec, error: getErr } = await admin
        .from('template_imports')
        .select('id,user_id,meta')
        .eq('id', importId)
        .single();
      if (getErr) return json({ error: getErr.message }, 404);
      if (rec?.user_id && authedUserId && rec.user_id !== authedUserId && auth.userId !== 'service_role') {
        return json({ error: 'forbidden' }, 403);
      }
      const currentMeta = ((rec.meta && typeof rec.meta === 'object') ? rec.meta : {}) as any;
      const nextMeta = { ...currentMeta, ...patch };
      const { error: upErr } = await admin
        .from('template_imports')
        .update({ meta: nextMeta })
        .eq('id', importId);
      if (upErr) return json({ error: upErr.message }, 400);
      return json({ ok: true });
    }

    // ---------- Phase 9C: golden run history ledger ----------
    if (operation === 'save_golden_run_history') {
      const importId = body.import_id as string;
      const history = body.history;
      if (!importId || !history || typeof history !== 'object') {
        return json({ error: 'import_id and history required' }, 400);
      }
      const { data: rec, error: getErr } = await admin
        .from('template_imports')
        .select('id,user_id')
        .eq('id', importId)
        .single();
      if (getErr) return json({ error: getErr.message }, 404);
      if (rec?.user_id && authedUserId && rec.user_id !== authedUserId && auth.userId !== 'service_role') {
        return json({ error: 'forbidden' }, 403);
      }

      const columns = goldenRunInputToColumns(history, importId, authedUserId ?? null);
      if (!columns.run_id) return json({ error: 'history.runId is required' }, 400);
      if (!columns.corpus_id) return json({ error: 'history.corpusId is required' }, 400);
      if (!columns.category) return json({ error: 'history.category is required' }, 400);
      if (!columns.quality_gate_status || !GOLDEN_RUN_GATE_STATUSES.includes(columns.quality_gate_status)) {
        return json({ error: 'history.qualityGateStatus is invalid' }, 400);
      }
      if (!columns.operator_decision || !GOLDEN_RUN_OPERATOR_DECISIONS.includes(columns.operator_decision)) {
        return json({ error: 'history.operatorDecision is invalid' }, 400);
      }

      const { data: inserted, error: insErr } = await admin
        .from(GOLDEN_RUN_TABLE)
        .insert(columns)
        .select(GOLDEN_RUN_SELECT)
        .single();
      if (insErr) { logDbError('save_golden_run_history', insErr); return json({ error: insErr.message }, 400); }
      return json({ ok: true, history_id: (inserted as any).id, history: goldenRunRowToCamel(inserted) });
    }

    if (operation === 'list_golden_run_history') {
      if (!authedUserId && auth.userId !== 'service_role') return json({ error: 'unauthorized' }, 401);
      const corpusId = grStr(body.corpus_id);
      const importId = grStr(body.import_id);
      const rawLimit = Number(body.limit);
      const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, Math.trunc(rawLimit))) : 50;
      const isAdmin = authedUserId ? await userHasAdminRole(admin, authedUserId) : false;
      const restrict = !isAdmin && auth.userId !== 'service_role';

      let query = admin
        .from(GOLDEN_RUN_TABLE)
        .select(`${GOLDEN_RUN_SELECT},template_imports!inner(user_id)`)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (corpusId) query = query.eq('corpus_id', corpusId);
      if (importId) query = query.eq('import_id', importId);
      if (restrict) query = query.eq('template_imports.user_id', authedUserId);

      const { data, error } = await query;
      if (error) { logDbError('list_golden_run_history', error); return json({ error: error.message }, 400); }
      return json({ ok: true, history: (data ?? []).map(goldenRunRowToCamel) });
    }

    if (operation === 'get_golden_run_history') {
      if (!authedUserId && auth.userId !== 'service_role') return json({ error: 'unauthorized' }, 401);
      const historyId = grStr(body.history_id);
      if (!historyId) return json({ error: 'history_id required' }, 400);

      const { data: row, error } = await admin
        .from(GOLDEN_RUN_TABLE)
        .select(`${GOLDEN_RUN_SELECT},template_imports!inner(user_id)`)
        .eq('id', historyId)
        .maybeSingle();
      if (error) return json({ error: error.message }, 404);
      if (!row) return json({ error: 'not found' }, 404);

      const ownerId = (row as any).template_imports?.user_id ?? null;
      const isAdmin = authedUserId ? await userHasAdminRole(admin, authedUserId) : false;
      if (ownerId && authedUserId && ownerId !== authedUserId && !isAdmin && auth.userId !== 'service_role') {
        return json({ error: 'forbidden' }, 403);
      }
      return json({ ok: true, history: goldenRunRowToCamel(row) });
    }

    if (operation === 'get_latest_golden_run_baselines') {
      if (!authedUserId && auth.userId !== 'service_role') return json({ error: 'unauthorized' }, 401);
      const corpusId = grStr(body.corpus_id);
      const isAdmin = authedUserId ? await userHasAdminRole(admin, authedUserId) : false;
      const restrict = !isAdmin && auth.userId !== 'service_role';

      let query = admin
        .from(GOLDEN_RUN_TABLE)
        .select(`${GOLDEN_RUN_SELECT},template_imports!inner(user_id)`)
        .order('created_at', { ascending: false });
      if (corpusId) query = query.eq('corpus_id', corpusId);
      if (restrict) query = query.eq('template_imports.user_id', authedUserId);
      query = query.limit(corpusId ? 1 : 500);

      const { data, error } = await query;
      if (error) { logDbError('get_latest_golden_run_baselines', error); return json({ error: error.message }, 400); }

      // Dedupe to the latest run per corpus (rows already ordered created_at desc).
      const seen = new Set<string>();
      const baselines: unknown[] = [];
      for (const row of (data ?? []) as any[]) {
        const cid = row.corpus_id;
        if (cid && seen.has(cid)) continue;
        if (cid) seen.add(cid);
        baselines.push(goldenRunRowToCamel(row));
      }
      return json({ ok: true, baselines });
    }



    // ---------- Phase 5: Visual Import Quality persistence ----------
    if (operation === 'save_visual_quality') {
      const importId = body.import_id as string;
      const report = body.report;
      if (!importId || !report || typeof report !== 'object') {
        return json({ error: 'import_id and report are required' }, 400);
      }
      await ensureArtifactBucket(admin);

      const { data: record, error: getErr } = await admin
        .from('template_imports')
        .select('id,user_id,meta')
        .eq('id', importId)
        .single();
      if (getErr) return json({ error: getErr.message }, 404);
      if (record?.user_id && authedUserId && record.user_id !== authedUserId && auth.userId !== 'service_role') {
        return json({ error: 'forbidden' }, 403);
      }

      // Upload per-page rasters (any subset of source/generated/diff).
      const pages = Array.isArray(body.pages) ? body.pages : [];
      let uploaded = 0;
      for (const page of pages) {
        const pageNumber = Number(page?.page_number);
        if (!Number.isFinite(pageNumber)) continue;
        const padded = String(pageNumber).padStart(3, '0');
        for (const kind of ['source', 'generated', 'diff'] as const) {
          const b64 = page?.[`${kind}_b64`];
          if (typeof b64 !== 'string' || b64.length === 0) continue;
          const path = `${importId}/pages/page-${padded}-${kind}.png`;
          const { error: upErr } = await admin.storage
            .from(ARTIFACT_BUCKET)
            .upload(path, b64ToBytes(b64), { contentType: 'image/png', upsert: true });
          if (upErr) { logDbError(`save_visual_quality.page_${padded}_${kind}`, upErr); continue; }
          uploaded += 1;
        }
      }

      const summaryPath = `${importId}/visual-quality.json`;
      const summaryPayload = {
        ...report,
        artifactPaths: {
          summary: summaryPath,
          sourceRasters: `${importId}/pages`,
          generatedRasters: `${importId}/pages`,
          diffRasters: `${importId}/pages`,
        },
      };
      const { error: sumErr } = await admin.storage
        .from(ARTIFACT_BUCKET)
        .upload(summaryPath, new TextEncoder().encode(JSON.stringify(summaryPayload)), {
          contentType: 'application/json',
          upsert: true,
        });
      if (sumErr) {
        logDbError('save_visual_quality.summary', sumErr);
        return json({ error: sumErr.message }, 400);
      }

      const currentMeta = ((record.meta && typeof record.meta === 'object') ? record.meta : {}) as any;
      const nextMeta = {
        ...currentMeta,
        visual_quality_artifact_path: summaryPath,
        visual_quality_summary: {
          overallScore: report.overallScore ?? null,
          pageCount: Array.isArray(report.pages) ? report.pages.length : 0,
          manualReviewRequired: !!report.manualReviewRequired,
          finalMode: report.finalMode ?? null,
          repairPassesApplied: report.repairPassesApplied ?? 0,
          generatedAt: report.generatedAt ?? new Date().toISOString(),
        },
      };
      const { error: upMetaErr } = await admin
        .from('template_imports')
        .update({ meta: nextMeta })
        .eq('id', importId);
      if (upMetaErr) logDbError('save_visual_quality.update_meta', upMetaErr);

      return json({ ok: true, summary_path: summaryPath, uploaded_count: uploaded });
    }

    if (operation === 'get_visual_quality') {
      const importId = body.import_id as string;
      if (!importId) return json({ error: 'import_id required' }, 400);

      const { data: record, error: getErr } = await admin
        .from('template_imports')
        .select('id,user_id,meta')
        .eq('id', importId)
        .single();
      if (getErr) return json({ error: getErr.message }, 404);
      if (record?.user_id && authedUserId && record.user_id !== authedUserId && auth.userId !== 'service_role') {
        return json({ error: 'forbidden' }, 403);
      }

      const meta = ((record.meta && typeof record.meta === 'object') ? record.meta : {}) as any;
      const summaryPath = meta.visual_quality_artifact_path as string | null | undefined;
      if (!isTemplateImportArtifactPathOwnedByImport(summaryPath, importId)) return json(null);

      const report = await readJsonArtifact(admin, summaryPath);
      if (!report) return json(null);

      const pageNumbers: number[] = Array.isArray(report.pages)
        ? report.pages
            .map((p: any) => Number(p?.pageNumber))
            .filter((n: number) => Number.isFinite(n))
        : [];
      const signed: Record<string, string> = {};
      for (const pageNumber of pageNumbers) {
        const padded = String(pageNumber).padStart(3, '0');
        for (const kind of ['source', 'generated', 'diff'] as const) {
          const path = `${importId}/pages/page-${padded}-${kind}.png`;
          const { data: s } = await admin.storage
            .from(ARTIFACT_BUCKET)
            .createSignedUrl(path, 3600);
          if (s?.signedUrl) signed[`${pageNumber}:${kind}`] = s.signedUrl;
        }
      }

      return json({
        importId,
        report,
        artifactPaths: {
          summary: summaryPath,
          sourceRasters: `${importId}/pages`,
          generatedRasters: `${importId}/pages`,
          diffRasters: `${importId}/pages`,
        },
        signedUrls: signed,
      });
    }


    // ---------- Phase 7B: Visual repair audit persistence ----------
    if (operation === 'save_visual_repair_audit') {
      const importId = body.import_id as string;
      const payload = body.payload;

      if (!importId || !payload || typeof payload !== 'object') {
        return json({ error: 'import_id and payload are required' }, 400);
      }

      await ensureArtifactBucket(admin);

      const { data: record, error: getErr } = await admin
        .from('template_imports')
        .select('id,user_id,meta')
        .eq('id', importId)
        .single();

      if (getErr) return json({ error: getErr.message }, 404);
      if (record?.user_id && authedUserId && record.user_id !== authedUserId && auth.userId !== 'service_role') {
        return json({ error: 'forbidden' }, 403);
      }

      const auditPath = `${importId}/repair/repair-loop.json`;
      const repairFolder = `${importId}/repair`;
      const persistedAt = new Date().toISOString();

      const auditPayload = {
        ...(payload as Record<string, unknown>),
        persistedAt,
        artifactPaths: {
          summary: auditPath,
          repairFolder,
        },
      };

      const { error: uploadErr } = await admin.storage
        .from(ARTIFACT_BUCKET)
        .upload(auditPath, new TextEncoder().encode(JSON.stringify(auditPayload)), {
          contentType: 'application/json',
          upsert: true,
        });

      if (uploadErr) {
        logDbError('save_visual_repair_audit.upload', uploadErr);
        return json({ error: uploadErr.message }, 400);
      }

      const summary = (payload as any)?.summary && typeof (payload as any).summary === 'object'
        ? (payload as any).summary
        : {};

      const repair = (payload as any)?.repair && typeof (payload as any).repair === 'object'
        ? (payload as any).repair
        : {};
      const repairSummary = repair?.summary && typeof repair.summary === 'object' ? repair.summary : {};

      const currentMeta = ((record.meta && typeof record.meta === 'object') ? record.meta : {}) as any;
      const nextMeta = {
        ...currentMeta,
        visual_repair_artifact_path: auditPath,
        visual_repair_summary: {
          version: summary.version ?? null,
          importId: summary.importId ?? importId,
          templateId: (payload as any)?.templateId ?? summary.templateId ?? null,
          visualQaScore: summary.visualQaScore ?? null,
          finalScore: summary.finalScore ?? null,
          scoreDelta: summary.scoreDelta ?? null,
          visualQaPersisted: summary.visualQaPersisted ?? null,
          repairStatus: summary.repairStatus ?? repair?.status ?? null,
          canRunRepairLoop: summary.canRunRepairLoop ?? null,
          eligiblePageCount: summary.eligiblePageCount ?? null,
          totalApplied: summary.totalApplied ?? repair?.totalApplied ?? null,
          passesAttempted: summary.passesAttempted ?? repairSummary?.passesAttempted ?? null,
          patchesAccepted: summary.patchesAccepted ?? repairSummary?.patchesAccepted ?? null,
          patchesRejected: summary.patchesRejected ?? repairSummary?.patchesRejected ?? null,
          requiresFallback: summary.requiresFallback ?? null,
          requiresManualReview: summary.requiresManualReview ?? null,
          problemCount: summary.problemCount ?? null,
          generatedAt: (payload as any)?.generatedAt ?? null,
          persistedAt,
        },
      };

      const { error: updateErr } = await admin
        .from('template_imports')
        .update({ meta: nextMeta })
        .eq('id', importId);

      if (updateErr) {
        logDbError('save_visual_repair_audit.update_meta', updateErr);
        return json({ error: updateErr.message }, 400);
      }

      return json({
        ok: true,
        audit_path: auditPath,
        artifactPaths: {
          summary: auditPath,
          repairFolder,
        },
      });
    }

    if (operation === 'get_visual_repair_audit') {
      const importId = body.import_id as string;
      if (!importId) return json({ error: 'import_id required' }, 400);

      const { data: record, error: getErr } = await admin
        .from('template_imports')
        .select('id,user_id,meta')
        .eq('id', importId)
        .single();

      if (getErr) return json({ error: getErr.message }, 404);
      if (record?.user_id && authedUserId && record.user_id !== authedUserId && auth.userId !== 'service_role') {
        return json({ error: 'forbidden' }, 403);
      }

      const meta = ((record.meta && typeof record.meta === 'object') ? record.meta : {}) as any;
      // Prefer the persisted meta path; fall back to the deterministic audit path
      // so a saved artifact is still discoverable if the meta pointer is missing.
      const auditPath = (meta.visual_repair_artifact_path as string | null | undefined)
        ?? `${importId}/repair/repair-loop.json`;

      const payload = await readJsonArtifact(admin, auditPath);
      if (!payload) return json(null);

      return json({
        importId,
        payload,
        artifactPaths: {
          summary: auditPath,
          repairFolder: `${importId}/repair`,
        },
      });
    }


    // ---------- Phase 8: Diagnostics — list visual-quality reports ----------
    // ---------- Phase 7F: export-parity persistence ----------
    if (operation === 'save_export_parity') {
      const importId = body.import_id as string;
      const summary = body.summary;
      if (!importId || !summary || typeof summary !== 'object') {
        return json({ error: 'import_id and summary are required' }, 400);
      }
      await ensureArtifactBucket(admin);

      const { data: record, error: getErr } = await admin
        .from('template_imports')
        .select('id,user_id,meta')
        .eq('id', importId)
        .single();
      if (getErr) return json({ error: getErr.message }, 404);
      if (record?.user_id && authedUserId && record.user_id !== authedUserId && auth.userId !== 'service_role') {
        return json({ error: 'forbidden' }, 403);
      }

      const summaryPath = `${importId}/export-parity/export-parity.json`;
      const folder = `${importId}/export-parity`;

      const { error: uploadErr } = await admin.storage
        .from(ARTIFACT_BUCKET)
        .upload(summaryPath, new TextEncoder().encode(JSON.stringify(summary)), {
          contentType: 'application/json',
          upsert: true,
        });
      if (uploadErr) {
        logDbError('save_export_parity.upload', uploadErr);
        return json({ error: uploadErr.message }, 400);
      }

      const s = summary as any;
      const currentMeta = ((record.meta && typeof record.meta === 'object') ? record.meta : {}) as any;
      const nextMeta = {
        ...currentMeta,
        export_parity_artifact_path: summaryPath,
        export_parity_summary: {
          status: s.status ?? null,
          mode: s.mode ?? null,
          editorVsSourceScore: s.editorVsSourceScore ?? null,
          exportVsSourceScore: s.exportVsSourceScore ?? null,
          exportVsEditorScore: s.exportVsEditorScore ?? null,
          manualReviewRequired: !!s.manualReviewRequired,
          sourcePageCount: s.sourcePageCount ?? null,
          editorPageCount: s.editorPageCount ?? null,
          exportedPageCount: s.exportedPageCount ?? null,
          problemCount: Array.isArray(s.problems) ? s.problems.length : 0,
          pageCount: Array.isArray(s.pages) ? s.pages.length : 0,
          generatedAt: s.generatedAt ?? null,
          persistedAt: new Date().toISOString(),
        },
      };

      const { error: updateErr } = await admin
        .from('template_imports')
        .update({ meta: nextMeta })
        .eq('id', importId);
      if (updateErr) {
        logDbError('save_export_parity.update_meta', updateErr);
        return json({ error: updateErr.message }, 400);
      }

      return json({ ok: true, summary_path: summaryPath, artifactPaths: { summary: summaryPath, folder } });
    }

    if (operation === 'get_export_parity') {
      const importId = body.import_id as string;
      if (!importId) return json({ error: 'import_id required' }, 400);

      const { data: record, error: getErr } = await admin
        .from('template_imports')
        .select('id,user_id,meta')
        .eq('id', importId)
        .single();
      if (getErr) return json({ error: getErr.message }, 404);
      if (record?.user_id && authedUserId && record.user_id !== authedUserId && auth.userId !== 'service_role') {
        return json({ error: 'forbidden' }, 403);
      }

      const meta = ((record.meta && typeof record.meta === 'object') ? record.meta : {}) as any;
      const summaryPath = (meta.export_parity_artifact_path as string | null | undefined)
        ?? `${importId}/export-parity/export-parity.json`;

      const summary = await readJsonArtifact(admin, summaryPath);
      if (!summary) return json(null);

      return json({
        importId,
        summary,
        artifactPaths: { summary: summaryPath, folder: `${importId}/export-parity` },
      });
    }

    if (operation === 'list_visual_quality') {
      const limit = Math.min(Number(body.limit) || 50, 200);
      const onlyWithReport = body.only_with_report !== false;
      const manualReviewOnly = !!body.manual_review_only;
      const minScore = Number.isFinite(Number(body.min_score)) ? Number(body.min_score) : null;
      const maxScore = Number.isFinite(Number(body.max_score)) ? Number(body.max_score) : null;
      const finalMode = typeof body.final_mode === 'string' ? body.final_mode : null;

      let query = admin
        .from('template_imports')
        .select('id,user_id,status,fidelity_mode,source_filename,page_count,created_at,meta,error')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (authedUserId && auth.userId !== 'service_role') {
        query = query.eq('user_id', authedUserId);
      }
      const { data: rows, error: listErr } = await query;
      if (listErr) return json({ error: listErr.message }, 500);

      const enriched = (rows ?? []).map((row: any) => {
        const meta = (row.meta && typeof row.meta === 'object') ? row.meta : {};
        const vq = (meta.visual_quality_summary && typeof meta.visual_quality_summary === 'object')
          ? meta.visual_quality_summary
          : null;
        return {
          id: row.id,
          user_id: row.user_id,
          status: row.status,
          fidelity_mode: row.fidelity_mode,
          source_filename: row.source_filename,
          page_count: row.page_count,
          created_at: row.created_at,
          error: row.error ?? null,
          visual_quality_artifact_path: meta.visual_quality_artifact_path ?? null,
          visual_quality: vq,
          cdir_fidelity_summary: meta.cdir_fidelity_summary ?? null,
          provider_attempts: Array.isArray(meta.provider_attempts) ? meta.provider_attempts : null,
          export_parity_artifact_path: meta.export_parity_artifact_path ?? null,
          export_parity: (meta.export_parity_summary && typeof meta.export_parity_summary === 'object')
            ? {
                status: meta.export_parity_summary.status ?? null,
                mode: meta.export_parity_summary.mode ?? null,
                editorVsSourceScore: meta.export_parity_summary.editorVsSourceScore ?? null,
                exportVsSourceScore: meta.export_parity_summary.exportVsSourceScore ?? null,
                exportVsEditorScore: meta.export_parity_summary.exportVsEditorScore ?? null,
                manualReviewRequired: meta.export_parity_summary.manualReviewRequired ?? null,
                problemCount: meta.export_parity_summary.problemCount ?? null,
                persistedAt: meta.export_parity_summary.persistedAt ?? null,
              }
            : null,
          golden_regression: (meta.golden_regression_summary && typeof meta.golden_regression_summary === 'object')
            ? {
                version: meta.golden_regression_summary.version ?? null,
                runId: meta.golden_regression_summary.runId ?? null,
                runBatchId: meta.golden_regression_summary.runBatchId ?? null,
                corpusId: meta.golden_regression_summary.corpusId ?? null,
                category: meta.golden_regression_summary.category ?? null,
                qualityGateStatus: meta.golden_regression_summary.qualityGateStatus ?? null,
                operatorDecision: meta.golden_regression_summary.operatorDecision ?? null,
                runStatus: meta.golden_regression_summary.runStatus ?? null,
                runDecision: meta.golden_regression_summary.runDecision ?? null,
                warningCount: Array.isArray(meta.golden_regression_summary.warnings)
                  ? meta.golden_regression_summary.warnings.length
                  : null,
                failureCount: Array.isArray(meta.golden_regression_summary.failures)
                  ? meta.golden_regression_summary.failures.length
                  : null,
                warnings: Array.isArray(meta.golden_regression_summary.warnings)
                  ? meta.golden_regression_summary.warnings.slice(0, 5)
                  : [],
                failures: Array.isArray(meta.golden_regression_summary.failures)
                  ? meta.golden_regression_summary.failures.slice(0, 5)
                  : [],
                generatedAt: meta.golden_regression_summary.generatedAt ?? null,
                persistedAt: meta.golden_regression_summary.persistedAt ?? null,
              }
            : null,
        };
      });


      const filtered = enriched.filter((r) => {
        if (onlyWithReport && !r.visual_quality) return false;
        if (manualReviewOnly && !r.visual_quality?.manualReviewRequired) return false;
        if (finalMode && r.visual_quality?.finalMode !== finalMode) return false;
        const score = r.visual_quality?.overallScore;
        if (minScore !== null && (typeof score !== 'number' || score < minScore)) return false;
        if (maxScore !== null && (typeof score !== 'number' || score > maxScore)) return false;
        return true;
      });

      const scoreList = filtered
        .map((r) => r.visual_quality?.overallScore)
        .filter((n: any): n is number => typeof n === 'number');
      const avgScore = scoreList.length
        ? scoreList.reduce((a, b) => a + b, 0) / scoreList.length
        : null;
      const stats = {
        total: filtered.length,
        with_report: filtered.filter((r) => !!r.visual_quality).length,
        manual_review: filtered.filter((r) => r.visual_quality?.manualReviewRequired).length,
        avg_score: avgScore,
        repair_passes_total: filtered.reduce(
          (sum, r) => sum + (Number(r.visual_quality?.repairPassesApplied) || 0),
          0,
        ),
        by_final_mode: filtered.reduce<Record<string, number>>((acc, r) => {
          const mode = r.visual_quality?.finalMode ?? 'unknown';
          acc[mode] = (acc[mode] ?? 0) + 1;
          return acc;
        }, {}),
        golden: {
          total: filtered.filter((r) => !!r.golden_regression).length,
          pass: filtered.filter((r) => r.golden_regression?.qualityGateStatus === 'pass').length,
          warning: filtered.filter((r) => r.golden_regression?.qualityGateStatus === 'warning').length,
          fail: filtered.filter((r) => r.golden_regression?.qualityGateStatus === 'fail').length,
          blocked: filtered.filter((r) => r.golden_regression?.qualityGateStatus === 'blocked').length,
          not_evaluated: filtered.filter((r) => r.golden_regression?.qualityGateStatus === 'not_evaluated').length,
          needs_review: filtered.filter((r) => {
            const g = r.golden_regression;
            if (!g) return false;
            return (
              ['warning', 'fail', 'blocked', 'not_evaluated'].includes(String(g.qualityGateStatus)) ||
              ['rejected', 'needs_rerun', 'not_reviewed'].includes(String(g.operatorDecision)) ||
              (Number(g.warningCount) || 0) > 0 ||
              (Number(g.failureCount) || 0) > 0
            );
          }).length,
        },
      };

      return json({ rows: filtered, stats });
    }

    // Include the rejected operation name so the frontend can stage a clearer
    // toast than just "unknown operation" (which previously surfaced raw).
    return json({ error: `unknown operation: ${operation}`, operation }, 400);
  } catch (e) {
    return json({ ...internalError(e, 'template-import-pdf') }, 500);
  }
});
