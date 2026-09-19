// template-import-finalize-worker
// Background worker for async artifact-first template finalization.
// Reads staged template artifacts from storage, then calls template_finalize_v2
// or template_resync_v2 outside the frontend request path.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { authorizeTemplateResync } from '../_shared/templateResyncAuthorization.ts';
import { createTokenAuthCorsHeaders } from '../_shared/auth.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ARTIFACT_BUCKET = 'template-import-artifacts';
const TEMPLATE_IMPORT_WORKER_TOKEN = Deno.env.get('TEMPLATE_IMPORT_WORKER_TOKEN') ?? SERVICE_ROLE;
const TEMPLATE_FINALIZATION_ARTIFACT_CONTRACT = 'template-finalization-artifacts-v1';

// deno-lint-ignore no-explicit-any
type Admin = ReturnType<typeof createClient>;

function logDbError(operation: string, error: { message?: string; details?: string | null; hint?: string | null; code?: string | null } | null) {
  if (!error) return;
  console.error(`[template-import-finalize-worker] ${operation} failed`, {
    message: error.message,
    details: error.details,
    hint: error.hint,
    code: error.code,
  });
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

async function readJsonArtifact(admin: Admin, path: string | null | undefined) {
  if (!path) return null;
  const { data, error } = await admin.storage.from(ARTIFACT_BUCKET).download(path);
  if (error || !data) {
    logDbError(`read_json_artifact.${path}`, error);
    return null;
  }
  try {
    return JSON.parse(await data.text());
  } catch (e) {
    console.error('[template-import-finalize-worker] artifact parse failed', {
      path,
      error: String((e as Error)?.message ?? e),
    });
    return null;
  }
}

async function markFailed(
  admin: Admin,
  importId: string,
  message: string,
  meta: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  const nextMeta = {
    ...meta,
    ...extra,
    finalization_status: 'recoverable_failed',
    finalization_failed_at: new Date().toISOString(),
    finalization_error: message,
    recoverable: true,
  };
  await admin.from('template_imports').update({
    status: 'failed',
    error: message.slice(0, 1000),
    meta: nextMeta,
  }).eq('id', importId);
}

async function finalizeImport(importId: string): Promise<void> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: record, error: getErr } = await admin
    .from('template_imports')
    .select('id,user_id,status,page_count,source_filename,meta,created_template_id')
    .eq('id', importId)
    .maybeSingle();

  if (getErr || !record) {
    console.error('[template-import-finalize-worker] import fetch failed', { importId, error: getErr });
    return;
  }

  const meta = ((record as any).meta && typeof (record as any).meta === 'object')
    ? ((record as any).meta as Record<string, unknown>)
    : {};

  if (meta.artifact_contract_version !== TEMPLATE_FINALIZATION_ARTIFACT_CONTRACT || !meta.schema_artifact_path) {
    await markFailed(admin, importId, 'staged template artifacts missing or invalid', meta, {
      failure_code: 'artifacts_not_staged',
    });
    return;
  }

  const request = (meta.finalization_request && typeof meta.finalization_request === 'object')
    ? (meta.finalization_request as Record<string, unknown>)
    : null;

  if (!request) {
    await markFailed(admin, importId, 'finalization_request missing', meta, {
      failure_code: 'finalization_request_missing',
    });
    return;
  }

  const startedAt = new Date().toISOString();
  await admin.from('template_imports').update({
    status: 'processing',
    error: null,
    meta: {
      ...meta,
      finalization_status: 'finalizing',
      finalization_started_at: startedAt,
      finalization_error: null,
    },
  }).eq('id', importId);

  const schema = await readJsonArtifact(admin, String(meta.schema_artifact_path));
  const validation = validateReconstructedSchemaLite(schema);
  if (!validation.ok) {
    await markFailed(admin, importId, 'schema_validation_failed', meta, {
      failure_code: 'schema_validation_failed',
      schema_validation: validation,
    });
    return;
  }

  const mode = request.mode === 'resync' ? 'resync' : 'finalize';
  const pageCount = Number(request.page_count ?? (record as any).page_count ?? validation.pageCount) || validation.pageCount;

  try {
    if (mode === 'resync') {
      const templateId = typeof request.template_id === 'string' ? request.template_id : '';
      if (!templateId) {
        await markFailed(admin, importId, 'template_id required for resync finalization', meta, {
          failure_code: 'template_id_missing',
        });
        return;
      }

      const requestedBy = typeof request.requested_by === 'string' ? request.requested_by : '';
      if (!requestedBy || (requestedBy !== 'service_role' && requestedBy !== (record as any).user_id)) {
        await markFailed(admin, importId, 'resync requester does not own the import', meta, {
          failure_code: 'resync_requester_mismatch',
        });
        return;
      }

      const authorization = await authorizeTemplateResync(admin, requestedBy, templateId);
      if (!authorization.allowed) {
        await markFailed(admin, importId, 'requester is not authorized to resync the target template', meta, {
          failure_code: authorization.exists ? 'template_resync_forbidden' : 'template_not_found',
        });
        return;
      }

      const { data: rpcRow, error: rpcErr } = await admin.rpc('template_resync_v2', {
        p_template_id: templateId,
        p_schema: schema,
        p_note: typeof request.note === 'string' ? request.note : 'Re-synced from PDF',
      });

      if (rpcErr) {
        logDbError('template_resync_v2', rpcErr);
        await markFailed(admin, importId, rpcErr.message ?? 'template_resync_v2 failed', meta, {
          failure_code: 'template_resync_v2_failed',
          rpc_details: rpcErr.details ?? null,
          rpc_hint: rpcErr.hint ?? null,
          rpc_code: rpcErr.code ?? null,
        });
        return;
      }

      const tpl = Array.isArray(rpcRow) ? rpcRow[0] : rpcRow;
      if (!tpl) {
        await markFailed(admin, importId, 'template_resync_v2 returned no template row', meta, {
          failure_code: 'template_resync_empty',
        });
        return;
      }

      const currentMeta = {
        ...meta,
        finalization_status: 'completed',
        finalization_completed_at: new Date().toISOString(),
        finalization_mode: 'resync',
        finalization_error: null,
        recoverable: null,
      };

      await admin.from('template_imports').update({
        status: 'completed',
        created_template_id: templateId,
        page_count: pageCount,
        error: null,
        meta: currentMeta,
      }).eq('id', importId);
      return;
    }

    const name = typeof request.name === 'string' && request.name.trim()
      ? request.name.trim()
      : 'Imported template';
    const descriptionSource = typeof request.source_filename === 'string' && request.source_filename
      ? request.source_filename
      : ((record as any).source_filename ?? 'PDF');

    const { data: rpcRow, error: rpcErr } = await admin.rpc('template_finalize_v2', {
      p_import_id: importId,
      p_name: name,
      p_description: `Imported from ${descriptionSource}`,
      p_schema: schema,
      p_page_count: pageCount,
      p_meta: {
        ...meta,
        finalization_status: 'completed',
        finalization_mode: 'finalize',
      },
    });

    if (rpcErr) {
      logDbError('template_finalize_v2', rpcErr);
      await markFailed(admin, importId, rpcErr.message ?? 'template_finalize_v2 failed', meta, {
        failure_code: 'template_finalize_v2_failed',
        rpc_details: rpcErr.details ?? null,
        rpc_hint: rpcErr.hint ?? null,
        rpc_code: rpcErr.code ?? null,
      });
      return;
    }

    const tpl = Array.isArray(rpcRow) ? rpcRow[0] : rpcRow;
    if (!tpl) {
      await markFailed(admin, importId, 'template_finalize_v2 returned no template row', meta, {
        failure_code: 'template_finalize_empty',
      });
      return;
    }

    const templateId = typeof tpl.id === 'string' ? tpl.id : null;
    await admin.from('template_imports').update({
      status: 'completed',
      created_template_id: templateId,
      page_count: pageCount,
      error: null,
      meta: {
        ...meta,
        finalization_status: 'completed',
        finalization_completed_at: new Date().toISOString(),
        finalization_mode: 'finalize',
        finalization_error: null,
        recoverable: null,
      },
    }).eq('id', importId);
  } catch (e) {
    const message = String((e as Error)?.message ?? e);
    await markFailed(admin, importId, message, meta, {
      failure_code: 'worker_exception',
    });
  }
}

Deno.serve(async (req) => {
  const cors = createTokenAuthCorsHeaders();
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const auth = req.headers.get('authorization') ?? '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!TEMPLATE_IMPORT_WORKER_TOKEN || token !== TEMPLATE_IMPORT_WORKER_TOKEN) {
    return json({ error: 'unauthorized' }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const importId = String((body as any).import_id ?? '');
  if (!importId) return json({ error: 'import_id required' }, 400);

  const task = finalizeImport(importId);
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime?.waitUntil) {
    runtime.waitUntil(task);
  } else {
    task.catch((e) => console.error('[template-import-finalize-worker] background task failed', e));
  }

  return json({ ok: true, accepted: true, import_id: importId }, 202);
});
