// Batch 7E.2 — Analytics query proxy over read-only views
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyAuth, createUnauthorizedResponse, createForbiddenResponse, createCorsHeaders } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { requireModulePermission } from '../_shared/authz.ts';
import { logSecurityEvent } from '../_shared/auth_v2.ts';
import { internalError } from '../_shared/errorResponse.ts';

interface Body {
  view: 'vw_pipeline_funnel' | 'vw_lender_mix' | 'vw_broker_scorecard' | 'vw_revenue_dashboard';
  session_token?: string;
}

const ALLOWED_VIEWS = ['vw_pipeline_funnel', 'vw_lender_mix', 'vw_broker_scorecard', 'vw_revenue_dashboard'];

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

    // AUTHZ: these views expose org-wide financial data (revenue, broker
    // scorecard, lender mix, pipeline funnel). The allowlist prevents arbitrary
    // table selection but not unauthorized reads — gate on the
    // finance_portal_admin module view permission (deny-by-default; superadmin +
    // verified service bypass).
    const authz = await requireModulePermission(
      supabase,
      { userId: auth.userId, authMethod: auth.authMethod },
      'finance_portal_admin',
      'can_view',
    );
    if (!authz.ok) {
      await logSecurityEvent(supabase, {
        action: `analytics_query.${body.view}`, decision: 'deny',
        reason_code: authz.reason_code, actor_type: 'human', actor_id: auth.userId,
      });
      return createForbiddenResponse(authz.error || 'Access denied', cors);
    }

    const j = (data: any, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    if (!ALLOWED_VIEWS.includes(body.view)) return j({ success: false, error: 'Unknown view' }, 400);
    const { data, error } = await supabase.from(body.view).select('*');
    if (error) return j({ success: false, error: error.message }, 500);
    return j({ success: true, data });
  } catch (e) {
    console.error('[analytics-query]', e);
    return new Response(JSON.stringify({ ...internalError(e, 'analytics-query'), success: false }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
