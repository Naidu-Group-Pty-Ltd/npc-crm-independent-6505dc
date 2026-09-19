// figma-template-sync
// Superadmin-only edge function that manages Figma-sourced report templates.
//
// Operations:
//   list                  → all figma_templates rows
//   get                   → one row by id (+ recent sync log)
//   register_from_url     → parse Figma URL → insert row (no IDs hardcoded)
//   update                → patch label/desc/report_type/tier/is_active/is_default
//   delete                → remove row
//   sync                  → fetch latest /v1/files/{key}/nodes from Figma + compile
//   compile_only          → re-run compiler against stored raw_node
//   preview_image         → fetch /v1/images/{key} for thumbnail URL
//   list_active           → public-ish (still authed) list for picker dropdowns
//
// Token: FIGMA_API_TOKEN secret.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import {
  verifyAuth,
  createCorsHeaders,
  createUnauthorizedResponse,
  createForbiddenResponse,
} from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { compileFigmaToReportTemplate } from '../_shared/figmaCompiler.ts';
import { internalError } from '../_shared/errorResponse.ts';

const FIGMA_BASE = 'https://api.figma.com';

async function isSuperadmin(supabase: any, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('role', 'superadmin')
    .maybeSingle();
  return !!data;
}

interface ParsedFigmaUrl {
  fileKey: string;
  nodeId: string | null;
}

function parseFigmaUrl(url: string): ParsedFigmaUrl | null {
  try {
    const u = new URL(url);
    // Supports /file/{key}/..., /design/{key}/..., /proto/{key}/...
    const m = u.pathname.match(/\/(file|design|proto)\/([a-zA-Z0-9]+)/);
    if (!m) return null;
    const fileKey = m[2];
    const nodeIdRaw = u.searchParams.get('node-id');
    // Figma uses "123-456" in URLs but the API expects "123:456"
    const nodeId = nodeIdRaw ? nodeIdRaw.replace(/-/g, ':') : null;
    return { fileKey, nodeId };
  } catch {
    return null;
  }
}

async function figmaGet(path: string, token: string): Promise<any> {
  const res = await fetch(`${FIGMA_BASE}${path}`, {
    headers: { 'X-Figma-Token': token },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Figma API ${res.status}: ${text.slice(0, 200)}`);
  }
  return await res.json();
}

async function logSync(
  supabase: any,
  templateId: string | null,
  operation: string,
  status: string,
  triggeredBy: string | null,
  summary: string | null,
  durationMs: number,
  error?: string | null,
  diff?: any,
) {
  await supabase.from('figma_template_sync_log').insert({
    figma_template_id: templateId,
    operation,
    status,
    triggered_by: triggeredBy,
    summary,
    duration_ms: durationMs,
    error: error || null,
    diff: diff || null,
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(url, key);

    const body = await req.json().catch(() => ({}));
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError || !userId) return createUnauthorizedResponse(authError || 'auth required', corsHeaders);

    if (!(await isSuperadmin(supabase, userId))) {
      return createForbiddenResponse('superadmin only', corsHeaders);
    }

    const FIGMA_TOKEN = Deno.env.get('FIGMA_API_TOKEN');
    const op = String(body?.op || body?.operation || '').trim();

    switch (op) {
      case 'list': {
        const { data, error } = await supabase
          .from('figma_templates')
          .select('id, label, description, figma_file_key, figma_node_id, figma_url, report_type, tier, version, is_active, is_default, thumbnail_url, last_synced_at, last_sync_status, last_sync_error, compile_warnings, created_at, updated_at')
          .order('updated_at', { ascending: false });
        if (error) throw error;
        return json({ templates: data ?? [] }, corsHeaders);
      }

      case 'list_active': {
        const reportType = body.report_type || null;
        let q = supabase
          .from('figma_templates')
          .select('id, label, description, report_type, tier, thumbnail_url, version, is_default')
          .eq('is_active', true)
          .order('is_default', { ascending: false })
          .order('label', { ascending: true });
        if (reportType) q = q.eq('report_type', reportType);
        const { data, error } = await q;
        if (error) throw error;
        return json({ templates: data ?? [] }, corsHeaders);
      }

      case 'get': {
        const id = String(body.id || '');
        if (!id) return json({ error: 'id required' }, corsHeaders, 400);
        const [{ data: tpl, error: tErr }, { data: logs }] = await Promise.all([
          supabase.from('figma_templates').select('*').eq('id', id).maybeSingle(),
          supabase
            .from('figma_template_sync_log')
            .select('*')
            .eq('figma_template_id', id)
            .order('created_at', { ascending: false })
            .limit(20),
        ]);
        if (tErr) throw tErr;
        return json({ template: tpl, logs: logs ?? [] }, corsHeaders);
      }

      case 'register_from_url': {
        const figmaUrl = String(body.figma_url || '').trim();
        const label = String(body.label || '').trim() || 'Untitled Figma template';
        const reportType = String(body.report_type || 'investment');
        const tier = body.tier || null;
        if (!figmaUrl) return json({ error: 'figma_url required' }, corsHeaders, 400);

        const parsed = parseFigmaUrl(figmaUrl);
        if (!parsed) return json({ error: 'Could not parse Figma URL (expected /file|/design|/proto/{key}/...)' }, corsHeaders, 400);

        const { data, error } = await supabase
          .from('figma_templates')
          .insert({
            label,
            description: body.description || null,
            figma_file_key: parsed.fileKey,
            figma_node_id: parsed.nodeId,
            figma_url: figmaUrl,
            report_type: reportType,
            tier,
            is_active: false,
            created_by: userId,
            updated_by: userId,
          })
          .select('*')
          .single();
        if (error) throw error;
        return json({ template: data }, corsHeaders);
      }

      case 'update': {
        const id = String(body.id || '');
        if (!id) return json({ error: 'id required' }, corsHeaders, 400);
        const patch: Record<string, any> = { updated_by: userId };
        for (const k of ['label', 'description', 'report_type', 'tier', 'is_active', 'is_default']) {
          if (k in body) patch[k] = body[k];
        }
        // Enforce single default per report_type
        if (patch.is_default === true) {
          const rt = patch.report_type || (await supabase.from('figma_templates').select('report_type').eq('id', id).maybeSingle()).data?.report_type;
          if (rt) {
            await supabase.from('figma_templates').update({ is_default: false }).eq('report_type', rt).neq('id', id);
          }
        }
        const { data, error } = await supabase
          .from('figma_templates')
          .update(patch)
          .eq('id', id)
          .select('*')
          .single();
        if (error) throw error;
        return json({ template: data }, corsHeaders);
      }

      case 'delete': {
        const id = String(body.id || '');
        if (!id) return json({ error: 'id required' }, corsHeaders, 400);
        const { error } = await supabase.from('figma_templates').delete().eq('id', id);
        if (error) throw error;
        return json({ ok: true }, corsHeaders);
      }

      case 'sync': {
        if (!FIGMA_TOKEN) return json({ error: 'FIGMA_API_TOKEN secret not configured' }, corsHeaders, 500);
        const id = String(body.id || '');
        if (!id) return json({ error: 'id required' }, corsHeaders, 400);
        const started = Date.now();
        const { data: tpl, error: tErr } = await supabase
          .from('figma_templates')
          .select('*')
          .eq('id', id)
          .maybeSingle();
        if (tErr) throw tErr;
        if (!tpl) return json({ error: 'template not found' }, corsHeaders, 404);

        try {
          let rootNode: any;
          if (tpl.figma_node_id) {
            const data = await figmaGet(
              `/v1/files/${tpl.figma_file_key}/nodes?ids=${encodeURIComponent(tpl.figma_node_id)}&geometry=paths`,
              FIGMA_TOKEN,
            );
            rootNode = data?.nodes?.[tpl.figma_node_id]?.document;
            if (!rootNode) throw new Error(`Node ${tpl.figma_node_id} not found in file`);
          } else {
            const data = await figmaGet(`/v1/files/${tpl.figma_file_key}?geometry=paths`, FIGMA_TOKEN);
            rootNode = data?.document;
          }

          const compiled = compileFigmaToReportTemplate(rootNode, tpl.figma_file_key);

          // Fetch a thumbnail too (best-effort)
          let thumbUrl: string | null = null;
          try {
            const imgRes = await figmaGet(
              `/v1/images/${tpl.figma_file_key}?ids=${encodeURIComponent(tpl.figma_node_id || rootNode.id)}&format=png&scale=1`,
              FIGMA_TOKEN,
            );
            thumbUrl = imgRes?.images?.[tpl.figma_node_id || rootNode.id] || null;
          } catch (e) {
            console.warn('[sync] thumbnail fetch failed', (e as Error).message);
          }

          const dur = Date.now() - started;
          const { data: updated, error: uErr } = await supabase
            .from('figma_templates')
            .update({
              raw_node: rootNode,
              compiled_schema: compiled.template,
              compile_warnings: compiled.warnings,
              thumbnail_url: thumbUrl,
              thumbnail_expires_at: thumbUrl ? new Date(Date.now() + 30 * 60 * 1000).toISOString() : null,
              last_synced_at: new Date().toISOString(),
              last_sync_status: 'success',
              last_sync_error: null,
              version: (tpl.version || 1) + 1,
              updated_by: userId,
            })
            .eq('id', id)
            .select('*')
            .single();
          if (uErr) throw uErr;

          await logSync(supabase, id, 'sync', 'success', userId,
            `Compiled ${compiled.stats.pages} pages, ${compiled.stats.blocks} blocks, ${compiled.stats.overlays} overlays (${compiled.stats.bound} bound)`,
            dur, null, { stats: compiled.stats, warnings: compiled.warnings });

          return json({ template: updated, stats: compiled.stats, warnings: compiled.warnings }, corsHeaders);
        } catch (e: any) {
          const dur = Date.now() - started;
          await supabase
            .from('figma_templates')
            .update({
              last_synced_at: new Date().toISOString(),
              last_sync_status: 'error',
              last_sync_error: e?.message || String(e),
              updated_by: userId,
            })
            .eq('id', id);
          await logSync(supabase, id, 'sync', 'error', userId, null, dur, e?.message || String(e));
          return json({ ...internalError(e, 'figma-template-sync') }, corsHeaders, 500);
        }
      }

      case 'compile_only': {
        const id = String(body.id || '');
        if (!id) return json({ error: 'id required' }, corsHeaders, 400);
        const { data: tpl, error: tErr } = await supabase
          .from('figma_templates')
          .select('id, figma_file_key, raw_node')
          .eq('id', id)
          .maybeSingle();
        if (tErr) throw tErr;
        if (!tpl?.raw_node) return json({ error: 'No raw_node stored — run sync first' }, corsHeaders, 400);

        const compiled = compileFigmaToReportTemplate(tpl.raw_node, tpl.figma_file_key);
        const { data: updated, error: uErr } = await supabase
          .from('figma_templates')
          .update({
            compiled_schema: compiled.template,
            compile_warnings: compiled.warnings,
            updated_by: userId,
          })
          .eq('id', id)
          .select('*')
          .single();
        if (uErr) throw uErr;
        await logSync(supabase, id, 'compile_only', 'success', userId,
          `Recompiled: ${compiled.stats.pages}p / ${compiled.stats.blocks}b / ${compiled.stats.overlays}o`,
          0, null, { stats: compiled.stats });
        return json({ template: updated, stats: compiled.stats, warnings: compiled.warnings }, corsHeaders);
      }

      case 'preview_image': {
        if (!FIGMA_TOKEN) return json({ error: 'FIGMA_API_TOKEN secret not configured' }, corsHeaders, 500);
        const id = String(body.id || '');
        if (!id) return json({ error: 'id required' }, corsHeaders, 400);
        const { data: tpl } = await supabase
          .from('figma_templates')
          .select('figma_file_key, figma_node_id')
          .eq('id', id)
          .maybeSingle();
        if (!tpl) return json({ error: 'template not found' }, corsHeaders, 404);
        const scale = Number(body.scale ?? 2);
        const fmt = String(body.format || 'png');
        const ids = tpl.figma_node_id ? `&ids=${encodeURIComponent(tpl.figma_node_id)}` : '';
        const res = await figmaGet(`/v1/images/${tpl.figma_file_key}?format=${fmt}&scale=${scale}${ids}`, FIGMA_TOKEN);
        return json({ images: res?.images || {} }, corsHeaders);
      }

      default:
        return json({
          error: `unknown op: ${op || '(missing)'}`,
          allowed_ops: [
            'list', 'list_active', 'get', 'register_from_url',
            'update', 'delete', 'sync', 'compile_only', 'preview_image',
          ],
        }, corsHeaders, 400);
    }
  } catch (e: any) {
    return json({ ...internalError(e, 'figma-template-sync') }, createCorsHeaders(origin), 500);
  }
});

function json(body: any, corsHeaders: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
