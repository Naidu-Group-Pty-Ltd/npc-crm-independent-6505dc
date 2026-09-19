/**
 * Finance Portal Notifications — list/mark read for the authenticated portal user.
 * Operations: list, mark_read, mark_all_read, unread_count
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";

import { createCorsHeaders as __createCorsHeaders } from "../_shared/auth.ts";
import { internalError } from '../_shared/errorResponse.ts';
import {
  nonFinanceTypeFilter,
  routingModeFromProbe,
  type FinanceRoutingMode,
} from '../_shared/financeNotificationRouting.pure.ts';
import { extractFinanceSessionToken } from '../_shared/financeSessionToken.ts';
// Dynamic per-request CORS — frontend uses `credentials: 'include'`, so ACAO must
// echo the request Origin (never `*`) with `Allow-Credentials: true`.
const corsHeaderDefaults: Record<string, string> = {
  ...__createCorsHeaders(null),
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-finance-session-token, x-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

function jsonResponseWithHeaders(data: any, responseCorsHeaders: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
  });
}

// Delegates to the ONE cookie-aware reader. The local body used to read only
// the header and the request body, so a portal whose session lives in the
// HttpOnly `__Host-finance_session_token` cookie (WP-11B/C) got a 401 on
// every call once its in-memory token was lost to a page load.
function extractToken(headers: Headers, body?: any): string | null {
  return extractFinanceSessionToken(headers, body as Record<string, unknown> | undefined);
}

/**
 * Which enforcement path this database supports, probed once per cold start.
 *
 * The routing columns come from a migration that is applied out of band, and
 * for three weeks it had not been — so this filter ran against columns that did
 * not exist and PostgREST answered `42703` for the whole statement. Every
 * operation here returned 500, and the portal's notification bell showed
 * nothing at all: 238 rows, 236 unread, none of them reachable.
 *
 * The probe is one `limit(0)` read, cached for the life of the isolate, and it
 * only ever downgrades on the specific "column does not exist" error — see
 * `financeNotificationRouting.pure.ts` for why an inconclusive probe must keep
 * the strict path.
 */
let routingModeProbe: Promise<FinanceRoutingMode> | null = null;

function resolveRoutingMode(supabase: any): Promise<FinanceRoutingMode> {
  if (routingModeProbe) return routingModeProbe;
  // Held in a local because assigning the module-level `let` does not narrow
  // away its `null` — the client is `any`, so the chain's type is `any` and the
  // declared type survives the assignment. Returning the local is what makes
  // the non-null return provable; collapsing this back to `return
  // routingModeProbe` fails the edge type-check gate.
  const started: Promise<FinanceRoutingMode> = supabase
    .from('finance_portal_notifications')
    .select('target_portal')
    .limit(0)
    .then((result: { error?: { code?: string; message?: string } | null }) => {
      const mode = routingModeFromProbe(result?.error ?? null);
      if (mode === 'types') {
        console.warn(
          '[finance-portal-notifications] routing columns absent — migration '
          + '20260717000000 has not been applied. Enforcing the finance boundary by '
          + 'notification type instead.',
        );
      }
      return mode;
    })
    .catch(() => 'columns' as FinanceRoutingMode);
  routingModeProbe = started;
  return started;
}

/**
 * Apply the authoritative portal boundary to retrieval and read mutations.
 *
 * Two expressions of one policy. The column filter is stricter and is used
 * wherever the schema carries it; the type filter is the same quarantine list
 * the migration itself writes, applied to data the table has always had. The
 * recipient filter is the caller's and is unconditional either way.
 */
function authorisedFinanceRoute(query: any, mode: FinanceRoutingMode) {
  if (mode === 'types') {
    return query.not('notification_type', 'in', nonFinanceTypeFilter());
  }
  return query
    .eq('target_portal', 'finance_portal')
    .eq('notification_domain', 'finance')
    .eq('command_centre_authorised', true);
}

Deno.serve(async (req) => {
  const corsHeaders = { ...__createCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Headers': corsHeaderDefaults['Access-Control-Allow-Headers'], 'Access-Control-Expose-Headers': corsHeaderDefaults['Access-Control-Expose-Headers'] };
  const jsonResponse = (data: any, status = 200) => jsonResponseWithHeaders(data, corsHeaders, status);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({}));
    const sessionToken = extractToken(req.headers, body);
    if (!sessionToken) return jsonResponse({ error: 'Session token required' }, 401);

    const { data: portalUser } = await supabase
      .from('finance_portal_users')
      .select('id, is_active, revoked_at, session_expires_at')
      .eq('session_token', sessionToken)
      .maybeSingle();

    if (!portalUser || !portalUser.is_active || portalUser.revoked_at) {
      return jsonResponse({ error: 'Invalid session' }, 401);
    }
    if (!portalUser.session_expires_at || new Date(portalUser.session_expires_at) < new Date()) {
      return jsonResponse({ error: 'Session expired' }, 401);
    }

    const { operation } = body;
    if (!operation) return jsonResponse({ error: 'operation required' }, 400);

    const routingMode = await resolveRoutingMode(supabase);

    switch (operation) {
      case 'list': {
        const limit = Math.min(Number(body.limit) || 50, 200);
        const onlyUnread = !!body.only_unread;
        let q = authorisedFinanceRoute(supabase
          .from('finance_portal_notifications')
          .select('*, clients:client_id(id, primary_first_name, primary_surname)')
          .eq('portal_user_id', portalUser.id), routingMode)
          .order('created_at', { ascending: false })
          .limit(limit);
        if (onlyUnread) q = q.eq('is_read', false);
        const { data, error } = await q;
        if (error) return jsonResponse({ error: error.message }, 500);
        return jsonResponse({ notifications: data || [] });
      }

      case 'unread_count': {
        const { count, error } = await authorisedFinanceRoute(supabase
          .from('finance_portal_notifications')
          .select('id', { count: 'exact', head: true })
          .eq('portal_user_id', portalUser.id), routingMode)
          .eq('is_read', false);
        if (error) return jsonResponse({ error: error.message }, 500);
        return jsonResponse({ count: count || 0 });
      }

      case 'mark_read': {
        if (!body.notification_id) return jsonResponse({ error: 'notification_id required' }, 400);
        const { error } = await authorisedFinanceRoute(supabase
          .from('finance_portal_notifications')
          .update({ is_read: true, read_at: new Date().toISOString() })
          .eq('id', body.notification_id)
          .eq('portal_user_id', portalUser.id), routingMode);
        if (error) return jsonResponse({ error: error.message }, 500);
        return jsonResponse({ success: true });
      }

      case 'mark_all_read': {
        const { error } = await authorisedFinanceRoute(supabase
          .from('finance_portal_notifications')
          .update({ is_read: true, read_at: new Date().toISOString() })
          .eq('portal_user_id', portalUser.id)
          .eq('is_read', false), routingMode);
        if (error) return jsonResponse({ error: error.message }, 500);
        return jsonResponse({ success: true });
      }

      default:
        return jsonResponse({ error: `Unknown operation: ${operation}` }, 400);
    }
  } catch (err: any) {
    console.error('finance-portal-notifications error', err);
    return jsonResponse({ ...internalError(err, 'finance-portal-notifications') }, 500);
  }
});
