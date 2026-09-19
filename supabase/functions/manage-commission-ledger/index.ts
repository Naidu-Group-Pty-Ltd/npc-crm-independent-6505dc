// WP-09B — Commission ledger (hardened)
// - Whitelisted mutable fields on update; state fields service-only
// - Explicit filter validation
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyAuth, createUnauthorizedResponse, createForbiddenResponse, createCorsHeaders } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { requireModulePermission, permForAction } from '../_shared/authz.ts';
import { logSecurityEvent } from '../_shared/auth_v2.ts';
import { isSuperadmin } from '../_shared/wp08Guards.ts';
import { LEDGER_UPDATE_ALLOWED_FIELDS, LEDGER_SERVICE_ONLY_FIELDS, pickAllowed } from '../_shared/wp09Guards.ts';
import { internalError } from '../_shared/errorResponse.ts';

interface Body {
  action: 'list' | 'get' | 'create' | 'update' | 'delete' | 'mark_received' | 'reconcile' | 'forecast_chart';
  id?: string;
  data?: Record<string, any>;
  filters?: Record<string, any>;
  session_token?: string;
}

const LEDGER_CREATE_ALLOWED = new Set([
  ...LEDGER_UPDATE_ALLOWED_FIELDS,
  'broker_id', 'deal_id', 'client_id', 'lender_id',
]);

Deno.serve(async (req) => {
  const cors = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(cors, __csrf);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const body: Body = await req.json();
    const auth = await verifyAuth(supabase, req.headers, body);
    if (auth.error || !auth.userId) return createUnauthorizedResponse(auth.error || 'Auth required', cors);

    const authz = await requireModulePermission(
      supabase,
      { userId: auth.userId, authMethod: auth.authMethod },
      'finance_portal_admin',
      permForAction(body.action),
    );
    if (!authz.ok) {
      await logSecurityEvent(supabase, {
        action: `commission_ledger.${body.action}`, decision: 'deny',
        reason_code: authz.reason_code, actor_type: 'human', actor_id: auth.userId,
      });
      return createForbiddenResponse(authz.error || 'Access denied', cors);
    }

    const isSuper = await isSuperadmin(supabase, auth.userId, auth.authMethod);
    const j = (data: any, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    switch (body.action) {
      case 'list': {
        let q = supabase.from('commission_ledger').select('*').order('created_at', { ascending: false }).limit(1000);
        const f = body.filters || {};
        if (f.broker_id) q = q.eq('broker_id', f.broker_id);
        if (f.deal_id) q = q.eq('deal_id', f.deal_id);
        if (f.client_id) q = q.eq('client_id', f.client_id);
        if (f.status) q = q.eq('status', f.status);
        if (f.lender_id) q = q.eq('lender_id', f.lender_id);
        if (f.from) q = q.gte('expected_date', f.from);
        if (f.to) q = q.lte('expected_date', f.to);
        const { data, error } = await q;
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data });
      }

      case 'get': {
        const { data, error } = await supabase.from('commission_ledger').select('*').eq('id', body.id!).maybeSingle();
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data });
      }

      case 'create': {
        const payload = pickAllowed(body.data, LEDGER_CREATE_ALLOWED, LEDGER_SERVICE_ONLY_FIELDS);
        // 'forecast' is the commission_status enum's opening state; the old
        // 'expected' is not in the enum, so every create was refused by
        // Postgres before a single row ever landed.
        const insertRow = { ...payload, created_by: auth.userId, status: 'forecast' };
        const { data, error } = await supabase.from('commission_ledger').insert(insertRow).select().single();
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data });
      }

      case 'update': {
        const payload = pickAllowed(body.data, LEDGER_UPDATE_ALLOWED_FIELDS, LEDGER_SERVICE_ONLY_FIELDS);
        if (Object.keys(payload).length === 0) return j({ success: false, error: 'No allowed fields to update' }, 400);
        const { data, error } = await supabase.from('commission_ledger').update(payload).eq('id', body.id!).select().single();
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data });
      }

      case 'mark_received': {
        // State transition: forecast/invoiced → received (server-controlled).
        // The old guard demanded 'expected', a value the commission_status
        // enum does not contain, so no real row could ever be marked received.
        const { data: existing } = await supabase.from('commission_ledger').select('status').eq('id', body.id!).maybeSingle();
        if (!existing) return j({ success: false, error: 'Not found' }, 404);
        if (!['forecast', 'invoiced'].includes(existing.status)) return j({ success: false, error: `Invalid transition from ${existing.status}` }, 409);
        const updates = {
          status: 'received',
          received_date: (typeof body.data?.received_date === 'string' && body.data.received_date) || new Date().toISOString().slice(0, 10),
          reference: typeof body.data?.reference === 'string' ? body.data.reference.slice(0, 128) : null,
        };
        const { data, error } = await supabase.from('commission_ledger').update(updates).eq('id', body.id!).select().single();
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data });
      }

      case 'reconcile': {
        // Direct reconcile is superadmin-only; normal path is generate-commission-payout.
        if (!isSuper) return j({ success: false, error: 'Superadmin only' }, 403);
        const { data, error } = await supabase.from('commission_ledger')
          .update({ status: 'reconciled', reconciled_date: new Date().toISOString().slice(0, 10) })
          .eq('id', body.id!).select().single();
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data });
      }

      case 'delete': {
        if (!isSuper) return j({ success: false, error: 'Superadmin only' }, 403);
        const { data: existing } = await supabase.from('commission_ledger').select('status').eq('id', body.id!).maybeSingle();
        if (existing && ['reconciled', 'received'].includes(existing.status)) {
          return j({ success: false, error: 'Cannot delete received/reconciled entry' }, 409);
        }
        const { error } = await supabase.from('commission_ledger').delete().eq('id', body.id!);
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data: { ok: true } });
      }

      case 'forecast_chart': {
        const { data, error } = await supabase.from('vw_revenue_dashboard').select('*');
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data });
      }
    }

    return j({ success: false, error: 'Unknown action' }, 400);
  } catch (e) {
    console.error('[manage-commission-ledger]', e);
    return new Response(JSON.stringify({ ...internalError(e, 'manage-commission-ledger'), success: false }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
