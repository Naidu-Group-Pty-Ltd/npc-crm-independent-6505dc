/**
 * Finance Portal — Saved Views
 * Operations: list, upsert, delete, set_default
 * Per-partner saved filter/sort presets for purchase_files and clients lists.
 */
import { createClient } from "npm:@supabase/supabase-js@2.55.0";

import { createCorsHeaders as __createCorsHeaders } from "../_shared/auth.ts";
import { internalError } from '../_shared/errorResponse.ts';
import { extractFinanceSessionToken } from '../_shared/financeSessionToken.ts';
// Dynamic per-request CORS — frontend uses `credentials: 'include'`, so ACAO must
// echo the request Origin (never `*`) with `Allow-Credentials: true`.
const corsHeaderDefaults: Record<string, string> = {
  ...__createCorsHeaders(null),
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-finance-session-token, x-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

const ALLOWED_SCOPES = new Set(['purchase_files', 'clients']);

function jsonWithHeaders(data: any, responseCorsHeaders: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
  });
}

// Delegates to the ONE cookie-aware reader. The local body used to read only
// the header and the request body, so a portal whose session lives in the
// HttpOnly `__Host-finance_session_token` cookie (WP-11B/C) got a 401 on
// every call once its in-memory token was lost to a page load.
function extractToken(headers: Headers, body?: any): string | null {
  return extractFinanceSessionToken(headers, body as Record<string, unknown> | undefined);
}

Deno.serve(async (req) => {
  const corsHeaders = { ...__createCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Headers': corsHeaderDefaults['Access-Control-Allow-Headers'], 'Access-Control-Expose-Headers': corsHeaderDefaults['Access-Control-Expose-Headers'] };
  const json = (data: any, status = 200) => jsonWithHeaders(data, corsHeaders, status);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const body = await req.json().catch(() => ({}));
    const token = extractToken(req.headers, body);
    if (!token) return json({ error: 'Session token required' }, 401);

    const { data: portalUser } = await supabase
      .from('finance_portal_users')
      .select('id, is_active, revoked_at, session_expires_at')
      .eq('session_token', token)
      .maybeSingle();
    if (!portalUser || !portalUser.is_active || portalUser.revoked_at) return json({ error: 'Invalid session' }, 401);
    if (!portalUser.session_expires_at || new Date(portalUser.session_expires_at) < new Date()) {
      return json({ error: 'Session expired' }, 401);
    }

    const op = body.operation;
    const scope = body.scope;
    if (op !== 'list' && op !== 'upsert' && op !== 'delete' && op !== 'set_default') {
      return json({ error: 'Unknown operation' }, 400);
    }

    if (op === 'list') {
      if (!ALLOWED_SCOPES.has(scope)) return json({ error: 'Invalid scope' }, 400);
      const { data, error } = await supabase
        .from('finance_portal_saved_views')
        .select('*')
        .eq('finance_user_id', portalUser.id)
        .eq('scope', scope)
        .order('is_default', { ascending: false })
        .order('name');
      if (error) return json({ error: error.message }, 500);
      return json({ views: data || [] });
    }

    if (op === 'upsert') {
      if (!ALLOWED_SCOPES.has(scope)) return json({ error: 'Invalid scope' }, 400);
      const id: string | undefined = body.id;
      const name = (body.name || '').toString().trim();
      if (!name) return json({ error: 'Name required' }, 400);
      const filters = body.filters && typeof body.filters === 'object' ? body.filters : {};
      const sort = body.sort && typeof body.sort === 'object' ? body.sort : null;
      const is_default = !!body.is_default;

      // If marking default, unset others
      if (is_default) {
        await supabase
          .from('finance_portal_saved_views')
          .update({ is_default: false })
          .eq('finance_user_id', portalUser.id)
          .eq('scope', scope);
      }

      if (id) {
        const { data, error } = await supabase
          .from('finance_portal_saved_views')
          .update({ name, filters, sort, is_default })
          .eq('id', id)
          .eq('finance_user_id', portalUser.id)
          .select('*').maybeSingle();
        if (error) return json({ error: error.message }, 500);
        return json({ view: data });
      }
      const { data, error } = await supabase
        .from('finance_portal_saved_views')
        .insert({ finance_user_id: portalUser.id, scope, name, filters, sort, is_default })
        .select('*').maybeSingle();
      if (error) return json({ error: error.message }, 500);
      return json({ view: data });
    }

    if (op === 'set_default') {
      const id = body.id;
      if (!id) return json({ error: 'id required' }, 400);
      const { data: row } = await supabase
        .from('finance_portal_saved_views')
        .select('id, scope, finance_user_id')
        .eq('id', id)
        .maybeSingle();
      if (!row || row.finance_user_id !== portalUser.id) return json({ error: 'Not found' }, 404);
      await supabase
        .from('finance_portal_saved_views')
        .update({ is_default: false })
        .eq('finance_user_id', portalUser.id)
        .eq('scope', row.scope);
      await supabase
        .from('finance_portal_saved_views')
        .update({ is_default: true })
        .eq('id', id);
      return json({ ok: true });
    }

    if (op === 'delete') {
      const id = body.id;
      if (!id) return json({ error: 'id required' }, 400);
      const { error } = await supabase
        .from('finance_portal_saved_views')
        .delete()
        .eq('id', id)
        .eq('finance_user_id', portalUser.id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    return json({ error: 'Unknown operation' }, 400);
  } catch (err: any) {
    console.error('[finance-portal-saved-views]', err?.stack || err);
    return json({ ...internalError(err, 'finance-portal-saved-views') }, 500);
  }
});
