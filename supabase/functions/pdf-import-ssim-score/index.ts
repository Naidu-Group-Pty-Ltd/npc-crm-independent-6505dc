// pdf-import-ssim-score — Wave F2 SSIM artifact writer.
//
// The actual visual comparison needs both a source raster and a reconstructed
// template raster. Dispatch already persists Docling source rasters; this job
// records the second-pass contract and stores a deterministic diagnostics
// artifact once both inputs are supplied by the renderer pipeline.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import {
  verifyAuthOrNativeUser,
  createTokenAuthCorsHeaders,
  createUnauthorizedResponse,
} from '../_shared/auth.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const DIAGNOSTICS_BUCKET = 'pdf-import-diagnostics';

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

Deno.serve(async (req) => {
  const cors = createTokenAuthCorsHeaders();
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  // SEC5-CSRF: reject cross-site cookie-authenticated invocations.
  //
  // This function authenticates through `verifyAuthOrNativeUser`, which reads
  // the `__Host-session_token` cookie and nothing else — and that cookie is
  // issued `SameSite=None`, so a page on any origin can make the browser send
  // it. `_shared/auth.ts` states the rule: a function that accepts the cookie
  // MUST also run `enforceCsrf`. Twelve did not, because
  // `check-csrf-coverage.mjs` tested `/\bverifyAuth\b/`, which cannot match
  // `verifyAuthOrNativeUser` — so the gate reported full coverage while
  // reporting on none of them. No-cookie and GET/HEAD/OPTIONS callers pass
  // through untouched.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(cors, __csrf);

  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const body = await req.json().catch(() => ({}));
  const auth = await verifyAuthOrNativeUser(admin, req, body);
  if (auth.error) return createUnauthorizedResponse(auth.error, cors);

  const jobId = String(body.job_id ?? body.jobId ?? '');
  if (!jobId) return json({ error: 'job_id required' }, 400);
  if (auth.userId && auth.userId !== 'service_role') {
    const { data: owner } = await admin
      .from('pdf_import_jobs')
      .select('user_id')
      .eq('id', jobId)
      .maybeSingle();
    if (owner?.user_id && owner.user_id !== auth.userId) return json({ error: 'forbidden' }, 403);
  }

  const pageScores = Array.isArray(body.page_scores)
    ? body.page_scores
        .map((p: any, index: number) => ({
          page_no: Number(p.page_no ?? index + 1),
          ssim: clamp01(Number(p.ssim)),
          heatmap_path: typeof p.heatmap_path === 'string' ? p.heatmap_path : null,
        }))
        .filter((p: any) => Number.isFinite(p.page_no) && Number.isFinite(p.ssim))
    : [];

  const score = pageScores.length
    ? pageScores.reduce((sum: number, p: any) => sum + p.ssim, 0) / pageScores.length
    : null;
  const artifact = {
    job_id: jobId,
    status: pageScores.length ? 'scored' : 'awaiting_reconstructed_rasters',
    scorer: 'pdf-import-ssim-score',
    generated_at: new Date().toISOString(),
    score,
    pages: pageScores,
    note: pageScores.length
      ? 'Per-page SSIM supplied by renderer pipeline.'
      : 'Source rasters are ready; post page_scores after reconstructed rasters are rendered.',
  };
  const path = `${jobId}/ssim.json`;
  const { error: uploadError } = await admin.storage
    .from(DIAGNOSTICS_BUCKET)
    .upload(path, new TextEncoder().encode(JSON.stringify(artifact)), {
      contentType: 'application/json',
      upsert: true,
    });
  if (uploadError) return json({ error: uploadError.message }, 500);

  const { data: existing } = await admin
    .from('pdf_import_jobs')
    .select('result_payload')
    .eq('id', jobId)
    .maybeSingle();
  const resultPayload = ((existing as any)?.result_payload && typeof (existing as any).result_payload === 'object')
    ? (existing as any).result_payload
    : {};
  const patch: Record<string, unknown> = {
    result_payload: { ...resultPayload, ssim_path: path },
    updated_at: new Date().toISOString(),
  };
  if (score !== null) patch.ssim_score = Math.round(score * 10000) / 10000;
  const { error: updateError } = await admin.from('pdf_import_jobs').update(patch).eq('id', jobId);
  if (updateError) return json({ error: updateError.message }, 500);

  return json({ ok: true, job_id: jobId, ssim_score: patch.ssim_score ?? null, ssim_path: path });
});
