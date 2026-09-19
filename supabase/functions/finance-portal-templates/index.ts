/**
 * Finance Portal — Message/Note Templates
 * Operations: list, create, update, delete, use (records usage + returns rendered body)
 */
import { extractFinanceToken, makeServiceClient, resolveFinancePartner } from '../_shared/finance-portal-session.ts';

import { createCorsHeaders as __createCorsHeaders } from "../_shared/auth.ts";
import { internalError } from '../_shared/errorResponse.ts';
// Dynamic per-request CORS — frontend uses `credentials: 'include'`, so ACAO must
// echo the request Origin (never `*`) with `Allow-Credentials: true`.
const corsHeaderDefaults: Record<string, string> = {
  ...__createCorsHeaders(null),
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-finance-session-token, x-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

const KIND_VALUES = ['message', 'note', 'doc_request', 'sms'];

function jsonWithHeaders(data: any, responseCorsHeaders: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
  });
}

function renderBody(body: string, vars: Record<string, string>) {
  return body.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_m, key) =>
    vars[key] !== undefined && vars[key] !== null ? String(vars[key]) : `{{${key}}}`
  );
}

Deno.serve(async (req) => {
  const corsHeaders = { ...__createCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Headers': corsHeaderDefaults['Access-Control-Allow-Headers'], 'Access-Control-Expose-Headers': corsHeaderDefaults['Access-Control-Expose-Headers'] };
  const json = (data: any, status = 200) => jsonWithHeaders(data, corsHeaders, status);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = makeServiceClient();
    const body = await req.json().catch(() => ({}));
    const token = extractFinanceToken(req.headers, body);
    const auth = await resolveFinancePartner(supabase, token);
    if (auth.error) return json({ error: auth.error }, auth.status);
    const portalUser = auth.portalUser!;

    const { operation } = body;

    // ─── List (shared + owned) ───
    if (operation === 'list') {
      const kind = body.kind && KIND_VALUES.includes(body.kind) ? body.kind : null;
      let q = supabase
        .from('finance_partner_message_templates')
        .select('*')
        .or(`is_shared.eq.true,owner_finance_contact_id.eq.${portalUser.id}`)
        .order('use_count', { ascending: false })
        .order('title', { ascending: true });
      if (kind) q = q.eq('kind', kind);
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 500);
      return json({ templates: data ?? [] });
    }

    // ─── Create ───
    if (operation === 'create') {
      const payload = body.payload || {};
      const kind = KIND_VALUES.includes(payload.kind) ? payload.kind : 'message';
      const title = (payload.title || '').toString().trim().slice(0, 200);
      const messageBody = (payload.body || '').toString().slice(0, 5000);
      if (!title || !messageBody) return json({ error: 'title and body required' }, 400);

      const mergeMatches = Array.from(new Set(
        [...messageBody.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)].map(m => m[1].toLowerCase())
      ));

      const { data, error } = await supabase
        .from('finance_partner_message_templates')
        .insert({
          owner_finance_contact_id: portalUser.id,
          kind,
          title,
          body: messageBody,
          category: (payload.category || '').toString().slice(0, 80) || null,
          merge_tags: mergeMatches,
          is_shared: false,
        })
        .select()
        .single();
      if (error) return json({ error: error.message }, 500);
      return json({ template: data });
    }

    // ─── Update ───
    if (operation === 'update') {
      const id = body.id;
      const payload = body.payload || {};
      if (!id) return json({ error: 'id required' }, 400);

      const { data: existing } = await supabase
        .from('finance_partner_message_templates')
        .select('id, owner_finance_contact_id, is_shared')
        .eq('id', id).maybeSingle();
      if (!existing) return json({ error: 'Not found' }, 404);
      if (existing.is_shared || existing.owner_finance_contact_id !== portalUser.id) {
        return json({ error: 'Forbidden' }, 403);
      }

      const updates: Record<string, any> = {};
      if (payload.title) updates.title = String(payload.title).trim().slice(0, 200);
      if (payload.body !== undefined) updates.body = String(payload.body).slice(0, 5000);
      if (payload.category !== undefined) updates.category = String(payload.category || '').slice(0, 80) || null;
      if (payload.kind && KIND_VALUES.includes(payload.kind)) updates.kind = payload.kind;
      if (updates.body) {
        updates.merge_tags = Array.from(new Set(
          [...updates.body.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)].map((m: any) => m[1].toLowerCase())
        ));
      }

      const { data, error } = await supabase
        .from('finance_partner_message_templates')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) return json({ error: error.message }, 500);
      return json({ template: data });
    }

    // ─── Delete ───
    if (operation === 'delete') {
      const id = body.id;
      if (!id) return json({ error: 'id required' }, 400);
      const { data: existing } = await supabase
        .from('finance_partner_message_templates')
        .select('id, owner_finance_contact_id, is_shared')
        .eq('id', id).maybeSingle();
      if (!existing) return json({ error: 'Not found' }, 404);
      if (existing.is_shared || existing.owner_finance_contact_id !== portalUser.id) {
        return json({ error: 'Forbidden' }, 403);
      }
      const { error } = await supabase.from('finance_partner_message_templates').delete().eq('id', id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    // ─── Use (record + render) ───
    if (operation === 'use') {
      const id = body.id;
      const vars = (body.vars || {}) as Record<string, string>;
      if (!id) return json({ error: 'id required' }, 400);
      const { data: tpl } = await supabase
        .from('finance_partner_message_templates')
        .select('*').eq('id', id).maybeSingle();
      if (!tpl) return json({ error: 'Not found' }, 404);

      // Bump usage (best effort)
      await supabase.from('finance_partner_message_templates')
        .update({ use_count: (tpl.use_count || 0) + 1, last_used_at: new Date().toISOString() })
        .eq('id', id);

      return json({
        template: tpl,
        rendered_body: renderBody(tpl.body, vars),
        rendered_title: renderBody(tpl.title, vars),
      });
    }

    return json({ error: `Unknown operation: ${operation}` }, 400);
  } catch (e: any) {
    console.error('[finance-portal-templates] error', e);
    return json({ ...internalError(e, 'finance-portal-templates') }, 500);
  }
});
