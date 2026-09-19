/**
 * GHL Test Credentials
 *
 * Superadmin-only one-shot probe that calls a battery of lightweight GHL
 * endpoints — one per required scope — and reports whether the configured
 * NEW (or LEGACY) token is authorised for each. Used by the migration UI
 * before kicking off live jobs and by the orchestrator as a preflight.
 *
 * Body: { account?: 'legacy' | 'new', domains?: string[] }
 * Returns: { success, audit: GhlCredentialAudit }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import {
  verifyAuth,
  createCorsHeaders,
  createUnauthorizedResponse,
  createForbiddenResponse,
} from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
import {
  getGhlCredentials,
  validateGhlCredentials,
  probeGhlCredentialScopes,
  type GhlAccount,
} from '../_shared/ghl-account.ts';

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const body = await req.json().catch(() => ({}));

    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError || !userId) return createUnauthorizedResponse(authError || 'Auth required', corsHeaders);

    if (userId !== 'service_role') {
      const { data: roleRows } = await supabase.from('user_roles').select('role').eq('user_id', userId);
      const isSuperadmin = (roleRows || []).some((r: any) => r.role === 'superadmin');
      if (!isSuperadmin) return createForbiddenResponse('Superadmin access required', corsHeaders);
    }

    const account: GhlAccount = body.account === 'legacy' ? 'legacy' : 'new';
    const domains: string[] | undefined = Array.isArray(body.domains) && body.domains.length > 0
      ? body.domains
      : undefined;

    const creds = getGhlCredentials(account);
    const credErr = validateGhlCredentials(creds);
    if (credErr) {
      return new Response(JSON.stringify({ success: false, error: credErr }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[ghl-test-credentials] account=${account} user=${userId} domains=${domains?.join(',') || 'all'}`);
    const audit = await probeGhlCredentialScopes(account, { domains });

    console.log(`[ghl-test-credentials] result account=${account} kind=${audit.token_kind} ok=${audit.required_scopes_ok} missing=${audit.missing_scopes.join(',') || 'none'}`);

    return new Response(JSON.stringify({ success: true, audit }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[ghl-test-credentials] error:', err);
    return new Response(JSON.stringify({ ...internalError(err, 'ghl-test-credentials'), success: false }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
