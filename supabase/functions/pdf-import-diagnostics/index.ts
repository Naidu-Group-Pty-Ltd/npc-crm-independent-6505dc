// pdf-import-diagnostics — superadmin-only read access to pdf_import_jobs +
// signed download URLs for the per-job diagnostics bundle.
//
// Phase 7 of the Docling pipeline plan. Backs the /admin/pdf-import-diagnostics
// page. The table's RLS scopes by `auth.uid()` which doesn't fire for our
// custom-auth users — this function mediates with the service-role key after
// re-checking the superadmin role server-side.
//
// Operations:
//   - { operation: 'list',     status?, engine?, engineVersion?, limit? } -> { rows, gates }
//   - { operation: 'get',      jobId }                       -> { row }
//   - { operation: 'detail',   jobId }                       -> { job, importId, gate, chunks, missingArtifactPages, signedUrls } (C8)
//   - { operation: 'download', diagnosticsPath, expiresIn? } -> { signedUrl }
//   - { operation: 'stats' }                                 -> { totals, recent }
//
// C8 (pdf-import-diagnostics-v2): `list` also returns a { [jobId]: gateSummary }
// map (the linked import's `meta.visual_quality_gate`) so the UI can render the
// compact visual/quality columns; `detail` returns the raw correlated rows for a
// single job — the frontend `pdfImportDiagnosticsV2` module does all shaping so
// there is a single tested implementation and no server/client drift.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import {
  verifyAuth,
  createTokenAuthCorsHeaders,
  createUnauthorizedResponse,
  createForbiddenResponse,
} from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { withRequestOrigin } from "../_shared/corsOrigin.ts";
import { internalError } from '../_shared/errorResponse.ts';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const DIAGNOSTICS_BUCKET = 'pdf-import-diagnostics';

/** Pull the C3-C6 quality-gate summary out of a template_imports.meta blob. */
function extractGateFromMeta(meta: unknown): Record<string, unknown> | null {
  if (!meta || typeof meta !== 'object') return null;
  const gate = (meta as Record<string, unknown>).visual_quality_gate;
  return gate && typeof gate === 'object' ? (gate as Record<string, unknown>) : null;
}

/**
 * C8 — batch-load the quality-gate summaries for a page of jobs, keyed by jobId.
 * Uses the C1 `template_import_id` correlation column; jobs without one simply
 * have no gate columns in the list.
 */
async function loadGateSummaries(
  admin: ReturnType<typeof createClient>,
  jobs: Array<{ id: string; template_import_id?: string | null }>,
): Promise<Record<string, Record<string, unknown>>> {
  const importIdToJobIds = new Map<string, string[]>();
  for (const job of jobs) {
    const importId = job.template_import_id;
    if (!importId) continue;
    const list = importIdToJobIds.get(importId) ?? [];
    list.push(job.id);
    importIdToJobIds.set(importId, list);
  }
  const importIds = [...importIdToJobIds.keys()];
  if (importIds.length === 0) return {};

  const { data, error } = await admin
    .from('template_imports')
    .select('id,meta')
    .in('id', importIds);
  if (error || !data) return {};

  const gates: Record<string, Record<string, unknown>> = {};
  for (const row of data as Array<{ id: string; meta: unknown }>) {
    const gate = extractGateFromMeta(row.meta);
    if (!gate) continue;
    for (const jobId of importIdToJobIds.get(row.id) ?? []) gates[jobId] = gate;
  }
  return gates;
}

/**
 * C8 fix — batch-fetch the FAILED/FATAL chunk page ranges for a page of jobs,
 * keyed by jobId, so the list can show the real "failed leaf ranges" (e.g.
 * "6-10, 21") instead of a bare chunk count — without an N+1 per row. Only
 * chunked jobs have chunk rows; the rest simply have no entry.
 */
async function loadFailedChunkRanges(
  admin: ReturnType<typeof createClient>,
  jobs: Array<{ id: string; chunked?: boolean | null }>,
): Promise<Record<string, Array<{ page_start: number; page_end: number }>>> {
  const jobIds = jobs.filter((j) => j.chunked).map((j) => j.id);
  if (jobIds.length === 0) return {};

  const { data, error } = await admin
    .from('pdf_import_chunks')
    .select('job_id,page_start,page_end,status')
    .in('job_id', jobIds)
    .in('status', ['failed', 'fatal']);
  if (error || !data) return {};

  const ranges: Record<string, Array<{ page_start: number; page_end: number }>> = {};
  for (const row of data as Array<{ job_id: string; page_start: number; page_end: number }>) {
    (ranges[row.job_id] ??= []).push({ page_start: row.page_start, page_end: row.page_end });
  }
  return ranges;
}

/**
 * C8 — resolve a job's linked import + gate summary. Prefers the C1
 * `template_import_id`; falls back to the reverse correlation stored at
 * `template_imports.meta.import_manifests.pdf_import_job.job_id`.
 */
async function resolveImportGate(
  admin: ReturnType<typeof createClient>,
  job: { id: string; template_import_id?: string | null },
): Promise<{ importId: string | null; gate: Record<string, unknown> | null }> {
  if (job.template_import_id) {
    const { data } = await admin
      .from('template_imports')
      .select('id,meta')
      .eq('id', job.template_import_id)
      .maybeSingle();
    if (data) return { importId: (data as any).id, gate: extractGateFromMeta((data as any).meta) };
  }
  const { data: reverse } = await admin
    .from('template_imports')
    .select('id,meta')
    .eq('meta->import_manifests->pdf_import_job->>job_id', job.id)
    .maybeSingle();
  if (reverse) return { importId: (reverse as any).id, gate: extractGateFromMeta((reverse as any).meta) };
  return { importId: null, gate: null };
}

const __corsWrappedHandler = (async (req: Request): Promise<Response> => {
  const cors = createTokenAuthCorsHeaders();
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(cors, __csrf);

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const body = await req.json().catch(() => ({}));
    const auth = await verifyAuth(admin, req.headers, body);
    if (auth.error || !auth.userId) {
      return createUnauthorizedResponse(auth.error ?? 'unauthorized', cors);
    }
    if (auth.userId !== 'service_role') {
      const { data: roles } = await admin
        .from('user_roles')
        .select('role')
        .eq('user_id', auth.userId);
      const isSuperadmin =
        Array.isArray(roles) && roles.some((r: any) => r.role === 'superadmin');
      if (!isSuperadmin) return createForbiddenResponse('superadmin required', cors);
    }

    const operation = (body.operation as string) || 'list';

    if (operation === 'list') {
      const status = typeof body.status === 'string' ? body.status : null;
      const engine = typeof body.engine === 'string' ? body.engine : null;
      const engineVersion = typeof body.engineVersion === 'string' ? body.engineVersion : null;
      const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200);

      const runList = async (columns: string) => {
        let q = admin
          .from('pdf_import_jobs')
          .select(columns)
          .order('created_at', { ascending: false })
          .limit(limit);
        if (status) q = q.eq('status', status);
        if (engine) q = q.eq('engine', engine);
        if (engineVersion) q = q.eq('engine_version', engineVersion);
        return await q;
      };

      // C8 fix — resilience to schema drift. Base columns are always present; the
      // C1/C8/C11 additions below can be absent on an un-migrated environment.
      // A single missing column previously 500'd the ENTIRE diagnostics surface
      // (Postgres 42703). Now: try the full projection, and on a missing-column
      // error degrade to the base projection with a `degraded` flag so the page
      // still renders (the frontend already treats these fields as optional).
      const BASE_COLS = 'id,user_id,template_id,source_file_hash,source_file_name,source_file_size_bytes,engine,engine_version,mode,status,stage,started_at,finished_at,duration_ms,cloud_run_ms,bytes_in,bytes_out,page_count,chunked,chunks_total,chunks_completed,chunks_failed,ssim_score,error_code,error_text,diagnostics_path,result_payload,plan_payload,created_at,updated_at';
      const OPTIONAL_COLS = ['template_import_id', 'service_class', 'operational_metrics', 'cache_hit', 'cache_source_job_id'];

      let degraded = false;
      let missingColumns: string[] = [];
      let { data, error } = await runList(`${BASE_COLS},${OPTIONAL_COLS.join(',')}`);
      if (error && /column .* does not exist/i.test(error.message)) {
        console.warn('[pdf-import-diagnostics] list degraded — optional column(s) absent (schema drift):', error.message);
        degraded = true;
        missingColumns = OPTIONAL_COLS; // dropped all optionals to guarantee the page renders
        ({ data, error } = await runList(BASE_COLS));
      }
      if (error) return json({ error: error.message }, 500);
      const rows = data ?? [];

      // C8 — batch-fetch the linked imports' quality-gate summaries so the list
      // can render the visual/quality columns without an N+1 per row. This joins
      // on template_import_id; when that column was dropped, jobs simply have no
      // gate (the map is empty) — never an error.
      const gates = await loadGateSummaries(admin, rows as any[]);
      // C8 fix — real failed page ranges for the list (batched, chunked jobs only).
      const failedChunkRanges = await loadFailedChunkRanges(admin, rows as any[]);
      return json({ rows, gates, degraded, missingColumns, failedChunkRanges });
    }

    if (operation === 'get') {
      const jobId = body.jobId as string;
      if (!jobId) return json({ error: 'jobId required' }, 400);
      const { data, error } = await admin
        .from('pdf_import_jobs')
        .select('*')
        .eq('id', jobId)
        .maybeSingle();
      if (error) return json({ error: error.message }, 500);
      return json({ row: data });
    }

    if (operation === 'detail') {
      // C8 — heavy, correlated per-job drill-down. Returns RAW rows; the frontend
      // `buildDiagnosticsDetail` does all shaping so there is one tested
      // implementation. Superadmin auth already enforced above.
      const jobId = body.jobId as string;
      if (!jobId) return json({ error: 'jobId required' }, 400);

      const { data: job, error: jobErr } = await admin
        .from('pdf_import_jobs')
        .select('*')
        .eq('id', jobId)
        .maybeSingle();
      if (jobErr) return json({ error: jobErr.message }, 500);
      if (!job) return json({ error: 'job not found' }, 404);

      const { importId, gate } = await resolveImportGate(admin, job as any);

      const { data: chunkRows } = await admin
        .from('pdf_import_chunks')
        // C11: operational_metrics carries each chunk's validated invocation envelope.
        .select('id,chunk_index,page_start,page_end,status,attempts,error_code,error_text,duration_ms,operational_metrics')
        .eq('job_id', jobId)
        .order('chunk_index', { ascending: true });
      const chunks = chunkRows ?? [];

      // C8 fix — pages missing their per-page SOURCE artifacts are derived from
      // per-page-manifest coverage, NOT raster count (a semantic-mode import
      // produces no rasters yet every page has docling/blocks artifacts). The
      // frontend `buildDiagnosticsDetail` recomputes this authoritatively from
      // `result_payload.per_page_docling_page_count`; we mirror it here so the raw
      // response is already correct. Unknown coverage → empty (never fabricated).
      const rp = (job as any).result_payload ?? {};
      const pageCount = Number((job as any).page_count) || 0;
      const perPageCovered = typeof rp.per_page_docling_page_count === 'number' ? rp.per_page_docling_page_count : null;
      const missingArtifactPages: number[] = [];
      if (pageCount > 0 && perPageCovered !== null && perPageCovered < pageCount) {
        for (let p = Math.max(0, perPageCovered) + 1; p <= pageCount; p += 1) missingArtifactPages.push(p);
      }

      // Short-lived signed URLs for the key per-job artifacts (never persisted).
      const expiresIn = 300;
      const signedUrls: Record<string, string> = {};
      const signPaths: Array<[string, string | null | undefined]> = [
        ['diagnostics', (job as any).diagnostics_path],
        ['rastersManifest', (job as any).result_payload?.rasters_manifest_path],
      ];
      for (const [key, rawPath] of signPaths) {
        if (!rawPath) continue;
        const objectPath = String(rawPath).startsWith(`${DIAGNOSTICS_BUCKET}/`)
          ? String(rawPath).slice(DIAGNOSTICS_BUCKET.length + 1)
          : String(rawPath);
        const { data: signed } = await admin.storage
          .from(DIAGNOSTICS_BUCKET)
          .createSignedUrl(objectPath, expiresIn);
        if (signed?.signedUrl) signedUrls[key] = signed.signedUrl;
      }

      await admin.from('pdf_import_audit_log').insert({
        job_id: jobId,
        actor_id: auth.userId === 'service_role' ? null : auth.userId,
        action: 'diagnostics_detail_viewed',
        diagnostics_path: (job as any).diagnostics_path ?? null,
        file_hash: (job as any).source_file_hash ?? null,
        metadata: { import_id: importId, signed_artifact_count: Object.keys(signedUrls).length, expires_in: expiresIn },
      }).then(({ error: auditError }) => {
        if (auditError) console.warn('[pdf-import-diagnostics] detail audit insert failed', auditError);
      });

      return json({ job, importId, gate, chunks, missingArtifactPages, signedUrls, expiresIn });
    }

    if (operation === 'download') {
      const path = body.diagnosticsPath as string;
      if (!path) return json({ error: 'diagnosticsPath required' }, 400);
      const expiresIn = Math.min(Math.max(Number(body.expiresIn) || 300, 60), 300);
      // Strip the bucket prefix if the caller passed the full storage path.
      const objectPath = path.startsWith(`${DIAGNOSTICS_BUCKET}/`)
        ? path.slice(DIAGNOSTICS_BUCKET.length + 1)
        : path;
      const { data: jobRow } = await admin
        .from('pdf_import_jobs')
        .select('id,source_file_hash,source_file_name')
        .eq('id', objectPath.split('/')[0])
        .maybeSingle();
      const { data, error } = await admin.storage
        .from(DIAGNOSTICS_BUCKET)
        .createSignedUrl(objectPath, expiresIn);
      if (error) return json({ error: error.message }, 500);
      await admin.from('pdf_import_audit_log').insert({
        job_id: jobRow?.id ?? null,
        actor_id: auth.userId === 'service_role' ? null : auth.userId,
        action: 'diagnostics_download_signed',
        diagnostics_path: objectPath,
        file_hash: jobRow?.source_file_hash ?? null,
        metadata: { expires_in: expiresIn, source_file_name: jobRow?.source_file_name ?? null },
      }).then(({ error: auditError }) => {
        if (auditError) console.warn('[pdf-import-diagnostics] audit insert failed', auditError);
      });
      return json({ signedUrl: data?.signedUrl, expiresIn });
    }

    if (operation === 'stats') {
      // Lightweight rollup for the dashboard hero strip.
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await admin
        .from('pdf_import_jobs')
        // C8 fix — project only result_payload->summary (small nested object) instead
        // of the entire result_payload (docling paths, page arrays, manifests, …) for
        // up to 1000 rows; the rollup only ever reads `.summary`.
        .select('status,engine,engine_version,duration_ms,cloud_run_ms,bytes_in,bytes_out,ssim_score,page_count,source_file_size_bytes,user_id,summary:result_payload->summary,created_at')
        .gte('created_at', since)
        .limit(1000);
      if (error) return json({ error: error.message }, 500);
      const rows = data ?? [];
      const totals = {
        total: rows.length,
        succeeded: rows.filter((r) => r.status === 'succeeded').length,
        failed: rows.filter((r) => r.status === 'failed').length,
        inflight: rows.filter(
          (r) => !['succeeded', 'failed', 'cancelled'].includes(String(r.status)),
        ).length,
        legacy: rows.filter((r) => r.engine === 'legacy').length,
        docling: rows.filter((r) => r.engine === 'docling').length,
      };
      const durations = rows
        .map((r) => Number(r.duration_ms))
        .filter((n) => Number.isFinite(n) && n > 0)
        .sort((a, b) => a - b);
      const p50 = durations.length ? durations[Math.floor(durations.length * 0.5)] : null;
      const p95 = durations.length ? durations[Math.floor(durations.length * 0.95)] : null;
      const ssim = rows
        .map((r) => Number(r.ssim_score))
        .filter((n) => Number.isFinite(n));
      const avgSsim = ssim.length ? ssim.reduce((a, b) => a + b, 0) / ssim.length : null;
      const byEngineVersion: Record<string, number> = {};
      const byUser: Record<string, number> = {};
      const byFileSizeBucket: Record<string, number> = {};
      const byPageCount: Record<string, number> = {};
      const summary = {
        text_chars: 0,
        ocr_ratio_sum: 0,
        ocr_ratio_count: 0,
        table_count: 0,
        confidence_sum: 0,
        confidence_count: 0,
      };
      let cloudRunMs = 0;
      let bytesIn = 0;
      let bytesOut = 0;
      for (const r of rows as any[]) {
        const ev = r.engine_version || '(unset)';
        byEngineVersion[ev] = (byEngineVersion[ev] ?? 0) + 1;
        byUser[r.user_id || '(unknown)'] = (byUser[r.user_id || '(unknown)'] ?? 0) + 1;
        const size = Number(r.source_file_size_bytes ?? r.bytes_in ?? 0);
        const sizeBucket = size < 1024 * 1024 ? '<1MB' : size < 10 * 1024 * 1024 ? '1-10MB' : size < 50 * 1024 * 1024 ? '10-50MB' : '50MB+';
        byFileSizeBucket[sizeBucket] = (byFileSizeBucket[sizeBucket] ?? 0) + 1;
        const pc = Number(r.page_count ?? 0);
        const pageBucket = pc <= 1 ? '1 page' : pc <= 5 ? '2-5 pages' : pc <= 20 ? '6-20 pages' : '21+ pages';
        byPageCount[pageBucket] = (byPageCount[pageBucket] ?? 0) + 1;
        cloudRunMs += Number(r.cloud_run_ms) || 0;
        bytesIn += Number(r.bytes_in) || 0;
        bytesOut += Number(r.bytes_out) || 0;
        const s = r.summary;
        if (s && typeof s === 'object') {
          summary.text_chars += Number(s.text_chars) || 0;
          summary.table_count += Number(s.table_count) || 0;
          const ocrChars = Number(s.ocr_chars) || 0;
          const textChars = Number(s.text_chars) || 0;
          if (textChars > 0) {
            summary.ocr_ratio_sum += ocrChars / textChars;
            summary.ocr_ratio_count += 1;
          }
          const conf = Number(s.avg_text_confidence);
          if (Number.isFinite(conf)) {
            summary.confidence_sum += conf;
            summary.confidence_count += 1;
          }
        }
      }
      return json({
        totals,
        latency: { p50_ms: p50, p95_ms: p95 },
        ssim: { avg: avgSsim, sample_count: ssim.length },
        summary: {
          text_chars: summary.text_chars,
          avg_ocr_ratio: summary.ocr_ratio_count ? summary.ocr_ratio_sum / summary.ocr_ratio_count : null,
          table_count: summary.table_count,
          avg_confidence: summary.confidence_count ? summary.confidence_sum / summary.confidence_count : null,
        },
        cohorts: { byEngineVersion, byUser, byFileSizeBucket, byPageCount },
        cost: { cloud_run_ms: cloudRunMs, bytes_in: bytesIn, bytes_out: bytesOut },
      });
    }

    return json({ error: `unknown operation: ${operation}` }, 400);
  } catch (e: any) {
    console.error('[pdf-import-diagnostics] error', e);
    return new Response(
      JSON.stringify(internalError(e, 'pdf-import-diagnostics')),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }
});

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
