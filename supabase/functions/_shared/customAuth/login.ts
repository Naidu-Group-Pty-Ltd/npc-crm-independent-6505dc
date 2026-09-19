/**
 * Command Centre staff login — the handler, shared by both entrypoints.
 *
 * ## Why this is here rather than in the function directory
 *
 * `custom-auth-login` and `custom-auth-login-v2` are both deployed, both
 * ACTIVE, and both mint a full staff session. Only the second had a source
 * directory in this repository.
 *
 * The consequence was not a stale copy. It was a **bypass**: the deploy
 * workflow discovers functions by listing directories under
 * `supabase/functions/`, so the v1 trio was never redeployed after 31 July,
 * while v2 went on to 40 deploys. Everything added to staff login in between
 * — the source-keyed rate limits above all — existed on one URL and not the
 * other, and an attacker spraying credentials picks the URL.
 *
 * Both entrypoints now call this, so there is nothing left to drift. The
 * history and the deletion decision are in
 * `docs/security/WP28_CUSTOM_AUTH_V1.md`.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyPassword, isLegacyPassword, hashPassword } from '../password.ts';
import { createSessionCookie } from '../auth.ts';
import { generateSupabaseJWT } from '../jwt.ts';
import { hashSessionToken, isSessionHashConfigured, computeIdleExpiry } from '../sessionHash.ts';
import { resolveStaffUserByIdentifier } from '../staffIdentifier.ts';
import { authRateLimitedResponse, enforceAuthRateLimit } from '../authRateLimit.ts';
import { parseJsonBody } from '../validate.ts';
import { StaffLoginRequest, AUTH_MAX_BODY_BYTES } from '../authBodySchemas.ts';
import { logEntrypoint, staffAuthCorsHeaders, type StaffAuthEntrypoint } from './cors.ts';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

// Source-keyed ceilings. The per-account lockout below (5 failures → 15 min)
// only ever sees ONE account, so it cannot see a spray: one attempt against
// each of a thousand staff usernames never reaches attempt two on any of them.
// These are the ceilings that do. Deliberately well above a human's retry rate
// — a person who fumbles a password is not the thing being stopped here.
//
// The `scope` below is shared by BOTH entrypoints, deliberately. Two scopes
// would give a caller two budgets and let them alternate URLs to double their
// attempts, which is the bypass in miniature.
const LOGIN_IP_BUDGET = { max: 30, windowSeconds: 900 };
const LOGIN_IDENTIFIER_BUDGET = { max: 12, windowSeconds: 900 };

export async function handleStaffLogin(
  req: Request,
  entrypoint: StaffAuthEntrypoint,
): Promise<Response> {
  const corsHeaders = staffAuthCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  logEntrypoint(entrypoint, 'custom-auth-login', req);

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // WP-27: bounded and shape-checked. This endpoint needs no session, so the
    // read had no size limit and the destructure below no runtime check — a
    // password arriving as an object reached the comparison as one.
    const __body = await parseJsonBody(req, StaffLoginRequest, corsHeaders, AUTH_MAX_BODY_BYTES);
    if (!__body.ok) return __body.response;
    const { username, password, turnstile_token } = __body.data;

    if (!username || !password) {
      return new Response(
        JSON.stringify({ error: 'Username and password are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Throttle before Turnstile so an unauthenticated flood cannot drive one
    // outbound siteverify request per attempt (same ordering as
    // `builder-portal-login`). The identifier is consumed after the source IP,
    // so a caller who is already IP-limited cannot mint limiter rows for
    // usernames they invent.
    const rateLimit = await enforceAuthRateLimit(supabase, req, {
      scope: 'ccl',
      ip: LOGIN_IP_BUDGET,
      identifier: String(username),
      identifierBudget: LOGIN_IDENTIFIER_BUDGET,
    });
    if (!rateLimit.allowed) {
      console.warn('[custom-auth-login] rate limited', { entrypoint, ipTrusted: rateLimit.ipTrusted, degraded: rateLimit.degraded });
      return authRateLimitedResponse(corsHeaders, rateLimit.retryAfterSeconds, 'Too many sign-in attempts. Please try again later.');
    }

    // Verify Turnstile CAPTCHA token.
    // ABUSE-002: with REQUIRE_TURNSTILE=true the login fails closed when the
    // secret is missing instead of silently skipping CAPTCHA.
    const turnstileSecret = Deno.env.get('TURNSTILE_SECRET_KEY');
    if (!turnstileSecret && Deno.env.get('REQUIRE_TURNSTILE') === 'true') {
      console.error('TURNSTILE_SECRET_KEY missing while REQUIRE_TURNSTILE=true — failing closed');
      return new Response(
        JSON.stringify({ error: 'Security verification is unavailable. Please try again later.' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    if (turnstileSecret) {
      if (!turnstile_token) {
        return new Response(
          JSON.stringify({ error: 'Security verification required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          secret: turnstileSecret,
          response: turnstile_token,
        }),
      });
      const verifyData = await verifyRes.json();

      if (!verifyData.success) {
        console.log('Turnstile verification failed:', verifyData);
        return new Response(
          JSON.stringify({ error: 'Security verification failed. Please try again.' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      console.log('Turnstile verification passed');
    }

    // Resolve the identifier against `custom_users` only. Either the username or
    // the account email is accepted, trimmed and case-insensitively — portal
    // accounts sharing that email are irrelevant here and are never consulted.
    const { user, ambiguous } = await resolveStaffUserByIdentifier<Record<string, any>>(
      supabase,
      username,
    );

    if (ambiguous || !user) {
      // Timing normalization: hash a dummy password so unknown accounts take
      // roughly as long as wrong-password attempts (Phase 6 / 11.4).
      await verifyPassword(password, '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy').catch(() => {});
      if (ambiguous) {
        console.warn('Login identifier matched multiple active staff accounts — refusing to guess');
      }
      return new Response(
        JSON.stringify({ error: 'Invalid username or password' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // A locked account is told so, and told for how long.
    //
    // This branch used to be folded into the invalid-credentials response: a
    // locked account and a wrong password both answered 401 "Invalid username
    // or password". The lockout was therefore invisible, and it is entered
    // precisely when someone is already unsure of their password — so the
    // account owner reads five failed attempts as "my password is wrong",
    // resets it, and the very next sign-in still says the password is wrong for
    // up to LOCKOUT_MINUTES. The reset looks broken when nothing about it is.
    //
    // Finance, Solicitor, Client and Builder already answer 429 with the
    // remaining minutes. That does let someone who has just locked an account
    // infer it exists — an inference they can only draw about an account they
    // were already able to lock, and one every other portal in this deployment
    // has accepted. Command Centre was the sole holdout, so it matches them.
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const minutesLeft = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000);
      console.log(`Login refused for user ${username}: account locked for ${minutesLeft} more minute(s)`);
      return new Response(
        JSON.stringify({ error: `Account temporarily locked after too many failed attempts. Try again in ${minutesLeft} minute(s).` }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Validate password using bcrypt (with legacy plaintext fallback)
    const isValid = await verifyPassword(password, user.password_hash);

    if (!isValid) {
      const newAttempts = (user.failed_login_attempts || 0) + 1;
      const updates: Record<string, number | string> = { failed_login_attempts: newAttempts };
      if (newAttempts >= MAX_FAILED_ATTEMPTS) {
        const lockUntil = new Date();
        lockUntil.setMinutes(lockUntil.getMinutes() + LOCKOUT_MINUTES);
        updates.locked_until = lockUntil.toISOString();
        updates.failed_login_attempts = 0;
      }
      await supabase.from('custom_users').update(updates).eq('id', user.id);
      console.log(`Login failed for user ${username}: incorrect password`);
      return new Response(
        JSON.stringify({ error: 'Invalid username or password' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // If using legacy plaintext password, upgrade to bcrypt hash
    if (isLegacyPassword(user.password_hash)) {
      console.log(`Upgrading password hash for user ${username}`);
      const hashedPassword = await hashPassword(password);
      await supabase
        .from('custom_users')
        .update({
          password_hash: hashedPassword,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);
    }

    console.log(`Login successful for user ${username}`);

    // Update last_login_at and clear lockout counters
    await supabase
      .from('custom_users')
      .update({ last_login_at: new Date().toISOString(), failed_login_attempts: 0, locked_until: null })
      .eq('id', user.id);

    // Generate session token
    const sessionToken = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // 24 hour session

    // Create session. WP-11A: store the peppered HMAC hash + idle-expiry
    // alongside the token so a DB dump cannot be replayed as a live cookie and
    // idle-timeout is enforced from issuance. (Plaintext column is still written
    // during the dual-read migration window; it is dropped once every reader
    // uses the hash path.)
    const tokenHash = isSessionHashConfigured() ? await hashSessionToken(sessionToken) : null;
    const { error: sessionError } = await supabase
      .from('user_sessions')
      .insert({
        user_id: user.id,
        token_hash: tokenHash,
        // WP-11A: store ONLY the peppered hash when it is available so no
        // replayable plaintext token is at rest. The plaintext column is written
        // solely as a fallback when the pepper is unconfigured (readers do a
        // hash-first, plaintext-fallback lookup, so both states resolve).
        ...(tokenHash ? {} : { session_token: sessionToken }),
        idle_expires_at: computeIdleExpiry().toISOString(),
        expires_at: expiresAt.toISOString(),
      });

    if (sessionError) {
      console.error('Session creation error:', sessionError);
      return new Response(
        JSON.stringify({ error: 'Failed to create session' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Clean up expired sessions
    await supabase.rpc('cleanup_expired_sessions');

    // Fetch user roles from user_roles table
    const { data: userRoles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    const roles = userRoles?.map((r: { role: string }) => r.role) || [];

    // Generate Supabase-compatible JWT for RLS
    let accessToken: string | null = null;
    try {
      accessToken = await generateSupabaseJWT(user.id, 86400, {
        email: user.email,
        roles: roles,
        userMetadata: {
          username: user.username,
          custom_role: user.role,
        },
      });
      console.log(`Generated JWT for user ${username}`);
    } catch (jwtError) {
      console.error('JWT generation failed:', jwtError);
      // Continue without JWT - session cookie still works for edge functions
    }

    // Create HttpOnly session cookie
    const sessionCookie = createSessionCookie(sessionToken, expiresAt);

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
        },
        roles,
        access_token: accessToken, // Supabase-compatible JWT for direct RLS/realtime
        // WP-11B/C cookie-only: the raw session token is NEVER returned to
        // JavaScript. It is delivered solely as the HttpOnly `__Host-session_token`
        // cookie (Set-Cookie below), so it cannot be exfiltrated or replayed.
        expires_at: expiresAt.toISOString(),
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Set-Cookie': sessionCookie,
        },
      },
    );
  } catch (error) {
    console.error('Login error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
}
