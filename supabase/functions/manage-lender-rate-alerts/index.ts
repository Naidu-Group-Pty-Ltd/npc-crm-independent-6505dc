// Batch 7D.2 — Lender rate alerts CRUD
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyAuth, createUnauthorizedResponse, createCorsHeaders } from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
interface Body {
  action: 'list' | 'create' | 'update' | 'delete' | 'toggle';
  id?: string;
  lender_id?: string;
  lender_name?: string;
  threshold_rate?: number;
  loan_purpose?: 'OWNER_OCCUPIED' | 'INVESTMENT' | null;
  repayment_type?: 'PRINCIPAL_AND_INTEREST' | 'INTEREST_ONLY' | null;
  lvr_max?: number | null;
  is_enabled?: boolean;
  session_token?: string;
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
    if (auth.error || !auth.userId || auth.userId === 'service_role') {
      return createUnauthorizedResponse(auth.error || 'Auth required', cors);
    }
    const userId = auth.userId;
    const j = (data: any, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    switch (body.action) {
      case 'list': {
        const { data, error } = await supabase
          .from('lender_rate_alerts').select('*').eq('user_id', userId)
          .order('created_at', { ascending: false });
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data });
      }
      case 'create': {
        if (!body.lender_id || !body.lender_name || body.threshold_rate == null)
          return j({ success: false, error: 'lender_id, lender_name, threshold_rate required' }, 400);
        const { data, error } = await supabase.from('lender_rate_alerts').insert({
          user_id: userId,
          lender_id: body.lender_id,
          lender_name: body.lender_name,
          threshold_rate: body.threshold_rate,
          loan_purpose: body.loan_purpose ?? null,
          repayment_type: body.repayment_type ?? null,
          lvr_max: body.lvr_max ?? null,
          is_enabled: body.is_enabled ?? true,
        }).select().single();
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data });
      }
      case 'update': {
        if (!body.id) return j({ success: false, error: 'id required' }, 400);
        const patch: Record<string, any> = {};
        for (const k of ['threshold_rate','loan_purpose','repayment_type','lvr_max','is_enabled'] as const) {
          if (body[k] !== undefined) patch[k] = body[k];
        }
        const { data, error } = await supabase.from('lender_rate_alerts')
          .update(patch).eq('id', body.id).eq('user_id', userId).select().single();
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data });
      }
      case 'toggle': {
        if (!body.id) return j({ success: false, error: 'id required' }, 400);
        const { data: cur } = await supabase.from('lender_rate_alerts')
          .select('is_enabled').eq('id', body.id).eq('user_id', userId).maybeSingle();
        const { data, error } = await supabase.from('lender_rate_alerts')
          .update({ is_enabled: !cur?.is_enabled }).eq('id', body.id).eq('user_id', userId).select().single();
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data });
      }
      case 'delete': {
        if (!body.id) return j({ success: false, error: 'id required' }, 400);
        const { error } = await supabase.from('lender_rate_alerts')
          .delete().eq('id', body.id).eq('user_id', userId);
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true });
      }
      default:
        return j({ success: false, error: 'Invalid action' }, 400);
    }
  } catch (e: any) {
    return new Response(JSON.stringify({ ...internalError(e, 'manage-lender-rate-alerts'), success: false }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
