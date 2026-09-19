// WP-09B — Commission payout (hardened, maker/checker via SECURITY DEFINER RPCs)
// - Transaction-safe generation via public.generate_commission_payout
// - Maker/checker enforced in public.mark_commission_payout_paid (approver ≠ generator)
// - Compensating cancellation via public.cancel_commission_payout
// - Step-up gate for mark_paid
// - Idempotency key required for generate
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyAuth, createUnauthorizedResponse, createForbiddenResponse, createCorsHeaders } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { requireModulePermission, permForAction } from '../_shared/authz.ts';
import { logSecurityEvent } from '../_shared/auth_v2.ts';
import { normalizeIdempotencyKey } from '../_shared/wp09Guards.ts';
import { isSuperadmin } from '../_shared/wp08Guards.ts';
import { requireStepUp } from '../_shared/stepUp.ts';
import { internalError } from '../_shared/errorResponse.ts';

interface Body {
  action: 'list' | 'generate' | 'mark_paid' | 'cancel';
  id?: string;
  data?: Record<string, any>;
  filters?: Record<string, any>;
  session_token?: string;
  idempotency_key?: string;
}

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
        action: `commission_payout.${body.action}`, decision: 'deny',
        reason_code: authz.reason_code, actor_type: 'human', actor_id: auth.userId,
      });
      return createForbiddenResponse(authz.error || 'Access denied', cors);
    }

    const isSuper = await isSuperadmin(supabase, auth.userId, auth.authMethod);
    const j = (data: any, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    switch (body.action) {
      case 'list': {
        let q = supabase.from('commission_payouts').select('*').order('period_end', { ascending: false }).limit(200);
        if (body.filters?.broker_id) q = q.eq('broker_id', body.filters.broker_id);
        if (body.filters?.status) q = q.eq('status', body.filters.status);
        const { data, error } = await q;
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data });
      }

      case 'generate': {
        const broker_id = body.data?.broker_id;
        const broker_name = body.data?.broker_name || null;
        const period_start = body.data?.period_start;
        const period_end = body.data?.period_end;
        if (!broker_id || !period_start || !period_end) {
          return j({ success: false, error: 'broker_id, period_start, period_end required' }, 400);
        }
        const idem = normalizeIdempotencyKey(body.idempotency_key) ||
                     normalizeIdempotencyKey(`gen:${broker_id}:${period_start}:${period_end}:${auth.userId}`);
        const { data, error } = await supabase.rpc('generate_commission_payout', {
          p_broker_id: broker_id,
          p_broker_name: broker_name,
          p_period_start: period_start,
          p_period_end: period_end,
          p_actor_id: auth.userId,
          p_idempotency_key: idem,
        });
        if (error) return j({ success: false, error: error.message }, 409);
        return j({ success: true, data: { payout: data } });
      }

      case 'mark_paid': {
        if (!body.id) return j({ success: false, error: 'Missing id' }, 400);
        // Step-up gate for money-move
        if (!isSuper) {
          const gate = await requireStepUp(supabase, {
            userId: auth.userId,
            capability: 'commission.payout.mark_paid',
            req,
            body,
          });
          if (gate) return gate;
        }
        const { data, error } = await supabase.rpc('mark_commission_payout_paid', {
          p_payout_id: body.id,
          p_approver_id: auth.userId,
          p_payment_reference: typeof body.data?.payment_reference === 'string' ? body.data.payment_reference.slice(0, 128) : null,
          p_payment_method: typeof body.data?.payment_method === 'string' ? body.data.payment_method.slice(0, 64) : null,
          p_approval_note: typeof body.data?.approval_note === 'string' ? body.data.approval_note.slice(0, 1000) : null,
        });
        if (error) {
          const msg = error.message || '';
          if (msg.includes('maker_checker_violation')) {
            await logSecurityEvent(supabase, {
              action: 'commission_payout.mark_paid', decision: 'deny',
              reason_code: 'maker_checker_violation', actor_type: 'human', actor_id: auth.userId,
            });
            return j({ success: false, error: 'Generator cannot approve their own payout', code: 'maker_checker_violation' }, 403);
          }
          return j({ success: false, error: msg }, 409);
        }
        return j({ success: true, data });
      }

      case 'cancel': {
        if (!body.id) return j({ success: false, error: 'Missing id' }, 400);
        const { data, error } = await supabase.rpc('cancel_commission_payout', {
          p_payout_id: body.id,
          p_actor_id: auth.userId,
          p_reason: typeof body.data?.reason === 'string' ? body.data.reason.slice(0, 500) : null,
        });
        if (error) return j({ success: false, error: error.message }, 409);
        return j({ success: true, data });
      }
    }

    return j({ success: false, error: 'Unknown action' }, 400);
  } catch (e) {
    console.error('[generate-commission-payout]', e);
    return new Response(JSON.stringify({ ...internalError(e, 'generate-commission-payout'), success: false }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
