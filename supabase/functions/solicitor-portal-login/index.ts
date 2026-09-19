import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'
import { verifyPassword } from "../_shared/password.ts"
import { createCorsHeaders, createSolicitorSessionCookie } from "../_shared/auth.ts"
import { validateSolicitorPortalRequest } from "../_shared/solicitorSessionToken.ts"
import { auditSolicitorIdentity, GENERIC_AUTH_ERROR, issueSolicitorSession } from "../_shared/solicitorSessions.ts"
import { authRateLimitedResponse, enforceAuthRateLimit } from "../_shared/authRateLimit.ts"
import { parseJsonBody } from '../_shared/validate.ts';
import { PortalLoginRequest, AUTH_MAX_BODY_BYTES } from '../_shared/authBodySchemas.ts';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

const LOGIN_IP_BUDGET = { max: 30, windowSeconds: 900 };
const LOGIN_IDENTIFIER_BUDGET = { max: 12, windowSeconds: 900 };
// A fixed bcrypt hash keeps missing and passwordless accounts on the same
// expensive verification path as accounts with a stored bcrypt password.
const DUMMY_PASSWORD_HASH = '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi.';

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (!validateSolicitorPortalRequest(req)) return new Response(JSON.stringify({ error: GENERIC_AUTH_ERROR }), { status: 401, headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // WP-27: bounded and shape-checked. This endpoint needs no session, so the
    // read had no size limit and the destructure below no runtime check — a
    // password arriving as an object reached the comparison as one.
    const __body = await parseJsonBody(req, PortalLoginRequest, corsHeaders, AUTH_MAX_BODY_BYTES)
    if (!__body.ok) return __body.response
    const { email, password, turnstile_token } = __body.data

    if (!email || !password) {
      return new Response(
        JSON.stringify({ error: 'Email and password are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Turnstile — fails closed when REQUIRE_TURNSTILE=true but the secret is absent.
    const turnstileSecret = Deno.env.get('TURNSTILE_SECRET_KEY')
    if (!turnstileSecret && Deno.env.get('REQUIRE_TURNSTILE') === 'true') {
      console.error('TURNSTILE_SECRET_KEY missing while REQUIRE_TURNSTILE=true — failing closed')
      return new Response(
        JSON.stringify({ error: 'Security verification is unavailable. Please try again later.' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    if (turnstileSecret) {
      if (!turnstile_token) {
        return new Response(
          JSON.stringify({ error: 'Security verification required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret: turnstileSecret, response: turnstile_token }),
      })
      const verifyData = await verifyRes.json()
      if (!verifyData.success) {
        return new Response(
          JSON.stringify({ error: 'Security verification failed. Please try again.' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    const normalizedEmail = String(email).toLowerCase().trim();

    // Previously keyed on `x-forwarded-for[0]` (caller-controlled, so the ceiling
    // was one header away from gone) and read only `allowed === false`, so an RPC
    // error fell through as allowed. See _shared/authRateLimit.ts.
    const rateLimit = await enforceAuthRateLimit(supabase, req, {
      scope: 'spl',
      ip: LOGIN_IP_BUDGET,
      identifier: normalizedEmail,
      identifierBudget: LOGIN_IDENTIFIER_BUDGET,
    });
    if (!rateLimit.allowed) {
      console.warn('[solicitor-portal-login] rate limited', { ipTrusted: rateLimit.ipTrusted, degraded: rateLimit.degraded });
      return authRateLimitedResponse(corsHeaders, rateLimit.retryAfterSeconds, GENERIC_AUTH_ERROR);
    }

    const { data: portalUser, error: userError } = await supabase
      .from('solicitor_portal_users')
      .select(`
        id, firm_id, email, name, phone, position, portal_role,
        password_hash, is_active, revoked_at,
        has_accepted_terms, has_completed_onboarding,
        failed_login_attempts, locked_until, must_change_password,
        solicitor_firms:firm_id (id, name, trading_name, practising_states, is_active)
      `)
      .eq('email', normalizedEmail)
      .maybeSingle()

    if (userError || !portalUser) {
      return new Response(
        JSON.stringify({ error: GENERIC_AUTH_ERROR }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!portalUser.is_active || portalUser.revoked_at) {
      return new Response(
        JSON.stringify({ error: GENERIC_AUTH_ERROR }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const firm = portalUser.solicitor_firms as any;
    if (!firm || !firm.is_active) {
      return new Response(
        JSON.stringify({ error: GENERIC_AUTH_ERROR }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (portalUser.locked_until && new Date(portalUser.locked_until) > new Date()) {
      const minutesLeft = Math.ceil((new Date(portalUser.locked_until).getTime() - Date.now()) / 60000);
      return new Response(
        JSON.stringify({ error: GENERIC_AUTH_ERROR }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!portalUser.password_hash) {
      return new Response(
        JSON.stringify({ error: GENERIC_AUTH_ERROR }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const isValid = await verifyPassword(password, portalUser.password_hash)
    if (!isValid) {
      const newAttempts = (portalUser.failed_login_attempts || 0) + 1;
      const updates: Record<string, any> = { failed_login_attempts: newAttempts };
      if (newAttempts >= MAX_FAILED_ATTEMPTS) {
        const lockUntil = new Date();
        lockUntil.setMinutes(lockUntil.getMinutes() + LOCKOUT_MINUTES);
        updates.locked_until = lockUntil.toISOString();
        updates.failed_login_attempts = 0;
        await auditSolicitorIdentity(supabase, req, { userId: portalUser.id, firmId: portalUser.firm_id, action: 'login_lockout' });
      }
      await supabase.from('solicitor_portal_users').update(updates).eq('id', portalUser.id);
      await supabase.rpc('record_portal_operational_event',{_event_name:newAttempts>=MAX_FAILED_ATTEMPTS?'excessive_authentication_failures':'solicitor_login_failure',_severity:newAttempts>=MAX_FAILED_ATTEMPTS?'high':'warning',_correlation_id:crypto.randomUUID(),_request_id:req.headers.get('x-request-id'),_actor_type:'solicitor_user',_actor_id:portalUser.id,_portal:'solicitor',_case_id:null,_matter_id:null,_firm_id:portalUser.firm_id,_duration_ms:null,_success:false,_metadata:{attempt_bucket:newAttempts>=MAX_FAILED_ATTEMPTS?'lockout':'below_lockout'}});

      return new Response(
        JSON.stringify({ error: 'Invalid email or password' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { error: loginUpdateError } = await supabase
      .from('solicitor_portal_users')
      .update({
        last_login_at: new Date().toISOString(),
        failed_login_attempts: 0,
        locked_until: null,
        session_token: null,
        session_expires_at: null,
      })
      .eq('id', portalUser.id)
    if (loginUpdateError) throw loginUpdateError;
    const issued = await issueSolicitorSession(supabase, portalUser.id, req, { deviceLabel: req.headers.get('user-agent') || undefined });

    await auditSolicitorIdentity(supabase, req, { userId: portalUser.id, firmId: portalUser.firm_id, action: 'login', sessionId: issued.id });
    await supabase.rpc('record_portal_operational_event',{_event_name:'solicitor_login_success',_severity:'info',_correlation_id:crypto.randomUUID(),_request_id:req.headers.get('x-request-id'),_actor_type:'solicitor_user',_actor_id:portalUser.id,_portal:'solicitor',_case_id:null,_matter_id:null,_firm_id:portalUser.firm_id,_duration_ms:null,_success:true,_metadata:{session_id:issued.id}});

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: portalUser.id,
          firm_id: portalUser.firm_id,
          email: portalUser.email,
          name: portalUser.name,
          phone: portalUser.phone,
          position: portalUser.position,
          portal_role: portalUser.portal_role,
          firm_name: firm.trading_name || firm.name,
          practising_states: firm.practising_states || [],
          has_accepted_terms: portalUser.has_accepted_terms,
          has_completed_onboarding: portalUser.has_completed_onboarding,
          must_change_password: !!portalUser.must_change_password,
        },
        must_change_password: !!portalUser.must_change_password,
        session: { id: issued.id, absolute_expires_at: issued.absoluteExpiresAt.toISOString(), idle_expires_at: issued.idleExpiresAt.toISOString() },
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Set-Cookie': createSolicitorSessionCookie(issued.token, issued.absoluteExpiresAt),
        }
      }
    )
  } catch (error: any) {
    console.error('Solicitor portal login error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...createCorsHeaders(origin), 'Content-Type': 'application/json' } }
    )
  }
})
