import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'
import { verifyPassword } from "../_shared/password.ts"
import { createCorsHeaders, createFinanceSessionCookie } from "../_shared/auth.ts"
import { authRateLimitedResponse, enforceAuthRateLimit } from "../_shared/authRateLimit.ts"
import { parseJsonBody } from '../_shared/validate.ts';
import { PortalLoginRequest, AUTH_MAX_BODY_BYTES } from '../_shared/authBodySchemas.ts';

const SESSION_HOURS = 12; // Finance portal sessions are shorter than client portal
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

// The per-account lockout below cannot see a spray across many accounts; these
// source-keyed ceilings are what bound that shape. See _shared/authRateLimit.ts.
const LOGIN_IP_BUDGET = { max: 30, windowSeconds: 900 };
const LOGIN_IDENTIFIER_BUDGET = { max: 12, windowSeconds: 900 };

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

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

    // Throttle before Turnstile so an unauthenticated flood cannot drive one
    // outbound siteverify request per attempt.
    const rateLimit = await enforceAuthRateLimit(supabase, req, {
      scope: 'fpl',
      ip: LOGIN_IP_BUDGET,
      identifier: String(email),
      identifierBudget: LOGIN_IDENTIFIER_BUDGET,
    });
    if (!rateLimit.allowed) {
      console.warn('[finance-portal-login] rate limited', { ipTrusted: rateLimit.ipTrusted, degraded: rateLimit.degraded });
      return authRateLimitedResponse(corsHeaders, rateLimit.retryAfterSeconds, 'Too many sign-in attempts. Please try again later.');
    }

    // Turnstile verification.
    // ABUSE-002: with REQUIRE_TURNSTILE=true the login fails closed when the
    // secret is missing instead of silently skipping CAPTCHA.
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

    const normalizedEmail = email.toLowerCase().trim();

    // Look up the finance portal user (joined to finance_agent_contacts for display info)
    const { data: portalUser, error: userError } = await supabase
      .from('finance_portal_users')
      .select(`
        id, finance_contact_id, email, password_hash, is_active,
        has_accepted_terms, has_completed_onboarding,
        failed_login_attempts, locked_until, revoked_at,
        last_login_at, must_change_password,
        finance_agent_contacts:finance_contact_id (id, name, email, company, contact_type, is_active)
      `)
      .eq('email', normalizedEmail)
      .maybeSingle()

    if (userError || !portalUser) {
      return new Response(
        JSON.stringify({ error: 'Invalid email or password' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check active status / revocation
    if (!portalUser.is_active || portalUser.revoked_at) {
      return new Response(
        JSON.stringify({ error: 'Your access has been revoked. Please contact your administrator.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const contact = portalUser.finance_agent_contacts as any;
    if (!contact || !contact.is_active) {
      return new Response(
        JSON.stringify({ error: 'The finance contact linked to this account is no longer active.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Lockout check
    if (portalUser.locked_until && new Date(portalUser.locked_until) > new Date()) {
      const minutesLeft = Math.ceil((new Date(portalUser.locked_until).getTime() - Date.now()) / 60000);
      return new Response(
        JSON.stringify({ error: `Account temporarily locked. Try again in ${minutesLeft} minute(s).` }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Must have accepted invite (has password_hash)
    if (!portalUser.password_hash) {
      return new Response(
        JSON.stringify({ error: 'Please accept your invite first to set up your password.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Verify password
    const isValid = await verifyPassword(password, portalUser.password_hash)
    if (!isValid) {
      const newAttempts = (portalUser.failed_login_attempts || 0) + 1;
      const updates: Record<string, any> = { failed_login_attempts: newAttempts };
      if (newAttempts >= MAX_FAILED_ATTEMPTS) {
        const lockUntil = new Date();
        lockUntil.setMinutes(lockUntil.getMinutes() + LOCKOUT_MINUTES);
        updates.locked_until = lockUntil.toISOString();
        updates.failed_login_attempts = 0;
      }
      await supabase.from('finance_portal_users').update(updates).eq('id', portalUser.id);

      return new Response(
        JSON.stringify({ error: 'Invalid email or password' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Generate session
    const sessionToken = crypto.randomUUID() + '-' + crypto.randomUUID();
    const expiresAt = new Date()
    expiresAt.setHours(expiresAt.getHours() + SESSION_HOURS)

    await supabase
      .from('finance_portal_users')
      .update({
        session_token: sessionToken,
        // A rotated token must not retain a hash for the prior session.
        session_token_hash: null,
        session_expires_at: expiresAt.toISOString(),
        last_login_at: new Date().toISOString(),
        failed_login_attempts: 0,
        locked_until: null,
      })
      .eq('id', portalUser.id)

    // (The agreement-delivery sweep that used to run here is gone: the
    // platform no longer issues agreements, so there is nothing pending to
    // deliver on login.)

    // Activity log
    // Record the address only when the platform vouched for it. Reading
    // `x-forwarded-for[0]` meant a caller could write any address they liked
    // into the partner's audit trail.
    const ipAddress = rateLimit.ipTrusted ? rateLimit.ip : null;
    const userAgent = req.headers.get('user-agent') || null;
    await supabase.from('finance_portal_activity_log').insert({
      finance_user_id: portalUser.id,
      actor_user_id: portalUser.id,
      actor_type: 'finance_user',
      action: 'login',
      entity_type: 'session',
      ip_address: ipAddress,
      user_agent: userAgent,
      metadata: { email: normalizedEmail },
    });

    // Whether this partner has accepted the terms version that is current now.
    // Read here so the app knows at sign-in, rather than discovering it on the
    // first verify call.
    const { data: currentTerms } = await supabase
      .from('portal_terms_versions')
      .select('id, version')
      .eq('portal', 'finance')
      .is('retired_at', null)
      .lte('effective_at', new Date().toISOString())
      .order('effective_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const { data: currentAcceptance } = currentTerms
      ? await supabase
          .from('portal_terms_acceptances')
          .select('id')
          .eq('terms_version_id', currentTerms.id)
          .eq('finance_user_id', portalUser.id)
          .maybeSingle()
      : { data: null }
    const hasAcceptedCurrentTerms = Boolean(currentTerms && currentAcceptance)
    const currentTermsVersion = currentTerms?.version ?? null

    const sessionCookie = createFinanceSessionCookie(sessionToken, expiresAt)

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: portalUser.id,
          finance_contact_id: portalUser.finance_contact_id,
          email: portalUser.email,
          name: contact.name,
          company: contact.company,
          contact_type: contact.contact_type,
          has_accepted_terms: portalUser.has_accepted_terms,
          // Version-aware, so an amended agreement is presented at the next
          // sign-in rather than only to partners who never accepted anything.
          has_accepted_current_terms: hasAcceptedCurrentTerms,
          current_terms_version: currentTermsVersion,
          has_completed_onboarding: portalUser.has_completed_onboarding,
          must_change_password: !!portalUser.must_change_password,
        },
        must_change_password: !!portalUser.must_change_password,
        session_token: sessionToken,
        expires_at: expiresAt.toISOString(),
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Set-Cookie': sessionCookie,
        }
      }
    )
  } catch (error: any) {
    console.error('Finance portal login error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
