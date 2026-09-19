import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'
import { verifyPassword } from "../_shared/password.ts"
import { createCorsHeaders, createClientPortalSessionCookie } from "../_shared/auth.ts"
import { sendPortalNotificationEmail } from "../_shared/portal-notification-email.ts"
import { authRateLimitedResponse, enforceAuthRateLimit } from "../_shared/authRateLimit.ts"
import { parseJsonBody } from '../_shared/validate.ts';
import { PortalLoginRequest, AUTH_MAX_BODY_BYTES } from '../_shared/authBodySchemas.ts';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

// The per-account lockout below cannot see a spray across many accounts; these
// source-keyed ceilings are what bound that shape. See _shared/authRateLimit.ts.
const LOGIN_IP_BUDGET = { max: 30, windowSeconds: 900 };
const LOGIN_IDENTIFIER_BUDGET = { max: 12, windowSeconds: 900 };

function smartCapitalizeStr(name: string): string {
  if (!name) return '';
  return name.trim().split(/\s+/).map((word, i) => {
    const lower = word.toLowerCase();
    if (lower.startsWith("o'") && lower.length > 2) return "O'" + lower.charAt(2).toUpperCase() + lower.slice(3);
    if (/^(mc|mac)(.+)$/i.test(lower)) {
      const m = lower.match(/^(mc|mac)(.+)$/i)!;
      return m[1].charAt(0).toUpperCase() + m[1].slice(1) + m[2].charAt(0).toUpperCase() + m[2].slice(1);
    }
    if (word.includes('-')) return word.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join('-');
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(' ');
}


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
      scope: 'cpl',
      ip: LOGIN_IP_BUDGET,
      identifier: String(email),
      identifierBudget: LOGIN_IDENTIFIER_BUDGET,
    });
    if (!rateLimit.allowed) {
      console.warn('[client-portal-login] rate limited', { ipTrusted: rateLimit.ipTrusted, degraded: rateLimit.degraded });
      return authRateLimitedResponse(corsHeaders, rateLimit.retryAfterSeconds, 'Too many sign-in attempts. Please try again later.');
    }

    // Verify Turnstile CAPTCHA token.
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

    // Query client_portal_users
    const { data: portalUser, error: userError } = await supabase
      .from('client_portal_users')
      .select('*, clients:client_id (id, primary_first_name, primary_surname, primary_email)')
      .eq('email', email.toLowerCase().trim())
      .eq('status', 'active')
      .maybeSingle()

    if (userError || !portalUser) {
      // Timing normalization: hash a dummy password so unknown accounts take
      // roughly as long as wrong-password attempts (Phase 6 / 11.4).
      await verifyPassword(password, '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy').catch(() => {});
      return new Response(
        JSON.stringify({ error: 'Invalid email or password' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Verify password
    const isValid = await verifyPassword(password, portalUser.password_hash)
    const isLocked = portalUser.locked_until && new Date(portalUser.locked_until) > new Date()
    if (!isValid || isLocked) {
      if (!isValid && !isLocked) {
        const newAttempts = (portalUser.failed_login_attempts || 0) + 1
        const updates: Record<string, number | string> = { failed_login_attempts: newAttempts }
        if (newAttempts >= MAX_FAILED_ATTEMPTS) {
          const lockUntil = new Date()
          lockUntil.setMinutes(lockUntil.getMinutes() + LOCKOUT_MINUTES)
          updates.locked_until = lockUntil.toISOString()
          updates.failed_login_attempts = 0
        }
        await supabase.from('client_portal_users').update(updates).eq('id', portalUser.id)
      }
      return new Response(
        JSON.stringify({ error: 'Invalid email or password' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Clear lockout counters on success
    await supabase
      .from('client_portal_users')
      .update({ failed_login_attempts: 0, locked_until: null })
      .eq('id', portalUser.id);

    // Generate session
    const sessionToken = crypto.randomUUID()
    const expiresAt = new Date()
    expiresAt.setHours(expiresAt.getHours() + 24)

    const { error: sessionError } = await supabase
      .from('client_portal_sessions')
      .insert({
        user_id: portalUser.id,
        session_token: sessionToken,
        expires_at: expiresAt.toISOString()
      })

    if (sessionError) {
      console.error('Session creation error:', sessionError)
      return new Response(
        JSON.stringify({ error: 'Failed to create session' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Update last login
    const previousLoginAt = portalUser.last_login_at;
    await supabase
      .from('client_portal_users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', portalUser.id)

    // Cleanup expired sessions
    await supabase.rpc('cleanup_expired_portal_sessions')

    // Create welcome notification on first login
    if (!previousLoginAt) {
      try {
        const clientData = portalUser.clients as any;
        const firstName = clientData?.primary_first_name || 'there';
        const welcomeTitle = 'Welcome to Your Client Portal!';
        const welcomeMessage = `Hi ${smartCapitalizeStr(firstName)}, welcome to your secure client portal. Here you can track your deals, view reports, manage your properties, and book appointments with your advisor.`;
        
        await supabase.from('client_portal_notifications').insert({
          client_id: portalUser.client_id,
          title: welcomeTitle,
          message: welcomeMessage,
          type: 'info',
          category: 'general',
          action_url: '/client',
        });

        // Send welcome email
        const { data: wl } = await supabase.from('whitelabel_settings').select('company_name').limit(1).maybeSingle();
        await sendPortalNotificationEmail({
          to: portalUser.email,
          clientFirstName: smartCapitalizeStr(firstName),
          title: welcomeTitle,
          message: welcomeMessage,
          type: 'info',
          category: 'account',
          actionUrl: '/client',
          companyName: wl?.company_name || 'Property Consulting',
        });
      } catch (notifErr) {
        console.warn('[client-portal-login] Failed to create welcome notification:', notifErr);
      }
    }

    const clientData = portalUser.clients as any;
    const sessionCookie = createClientPortalSessionCookie(sessionToken, expiresAt)

    const rawName = clientData ? `${clientData.primary_first_name || ''} ${clientData.primary_surname || ''}`.trim() : '';
    const displayName = rawName ? smartCapitalizeStr(rawName) : portalUser.email;

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: portalUser.id,
          client_id: portalUser.client_id,
          email: portalUser.email,
          name: displayName,
          has_completed_onboarding: portalUser.has_completed_onboarding ?? false,
          has_accepted_terms: portalUser.has_accepted_terms ?? false,
        },
        session_token: sessionToken,
        expires_at: expiresAt.toISOString()
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Set-Cookie': sessionCookie
        }
      }
    )
  } catch (error) {
    console.error('Client portal login error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
