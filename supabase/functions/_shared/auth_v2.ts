/**
 * auth_v2 — versioned strict authentication library (Security Remediation Phase 1)
 *
 * Every result identifies its authentication class explicitly. Authorization
 * code must reject unknown classes rather than falling through.
 *
 * Guarantees:
 *  - Human JWTs are cryptographically verified (HS256 project secret, with a
 *    Supabase Auth server fallback for tokens signed by newer keys). Decoded
 *    claims are NEVER trusted without signature verification.
 *  - Internal service calls use a dedicated HMAC-signed request envelope
 *    (INTERNAL_EDGE_SECRET) with timestamp + nonce replay protection — the
 *    service-role key remains accepted for backwards compatibility during the
 *    migration window but new callers should use signInternalRequest().
 *  - Roles are resolved server-side from the database, with legacy value
 *    mapping (superadmin / super_admin / sub_admin) centralized here.
 */

import { verifySupabaseJWT } from './jwt.ts';
import { verifySession, extractSessionToken } from './auth.ts';

export type AuthType = 'human' | 'internal_service' | 'public';

export interface AuthContext {
  ok: boolean;
  authType: AuthType | null;
  /** custom_users.id for humans; caller function name for internal services */
  actorId: string | null;
  username: string | null;
  /** Canonical roles: 'superadmin' | 'admin' | 'user' */
  roles: string[];
  /** How the credential was presented */
  method: 'jwt' | 'session' | 'internal_hmac' | 'service_role_key' | null;
  correlationId: string;
  errorCode:
    | null
    | 'missing_credentials'
    | 'invalid_jwt'
    | 'invalid_session'
    | 'inactive_actor'
    | 'invalid_internal_signature'
    | 'internal_replay'
    | 'internal_timestamp_skew'
    | 'internal_unknown_key'
    | 'internal_caller_not_allowed';
}

function ctx(partial: Partial<AuthContext>): AuthContext {
  return {
    ok: false,
    authType: null,
    actorId: null,
    username: null,
    roles: [],
    method: null,
    correlationId: crypto.randomUUID(),
    errorCode: null,
    ...partial,
  };
}

/** Map legacy role spellings to canonical values (AUTH-004). */
export function canonicalizeRole(role: string | null | undefined): 'superadmin' | 'admin' | 'user' | null {
  switch ((role || '').toLowerCase()) {
    case 'superadmin':
    case 'super_admin':
      return 'superadmin';
    case 'admin':
      return 'admin';
    case 'sub_admin':
    case 'user':
      return 'user';
    default:
      return null;
  }
}

/**
 * Resolve a user's canonical roles from BOTH legacy stores
 * (custom_users.role and user_roles) — single server-side resolver.
 */
export async function resolveRoles(supabase: any, userId: string): Promise<string[]> {
  const roles = new Set<string>();
  const [{ data: user }, { data: roleRows }] = await Promise.all([
    supabase.from('custom_users').select('role').eq('id', userId).maybeSingle(),
    supabase.from('user_roles').select('role').eq('user_id', userId),
  ]);
  const fromUser = canonicalizeRole(user?.role);
  if (fromUser) roles.add(fromUser);
  for (const row of roleRows ?? []) {
    const r = canonicalizeRole(row.role);
    if (r) roles.add(r);
  }
  if (roles.size === 0) roles.add('user');
  return [...roles];
}

export async function isSuperadmin(supabase: any, userId: string): Promise<boolean> {
  const roles = await resolveRoles(supabase, userId);
  return roles.includes('superadmin');
}

/**
 * Strict human verification: cryptographically verified JWT or a valid
 * opaque session token. Never authorizes from decoded-only claims.
 */
export async function verifyHuman(
  supabase: any,
  req: Request,
  body?: { session_token?: string; command_centre_session_token?: string }
): Promise<AuthContext> {
  const authHeader = req.headers.get('authorization') || '';
  const anonKey = (Deno.env.get('SUPABASE_ANON_KEY') || '').trim();

  let bearerWasRejected = false;
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token && token !== anonKey && token.includes('.')) {
      const payload = await verifySupabaseJWT(token);
      if (payload && payload.sub && payload.role === 'authenticated') {
        const { data: user } = await supabase
          .from('custom_users')
          .select('id, username, is_active')
          .eq('id', payload.sub)
          .maybeSingle();
        if (!user || user.is_active === false) {
          return ctx({ errorCode: 'inactive_actor' });
        }
        return ctx({
          ok: true,
          authType: 'human',
          actorId: user.id,
          username: user.username ?? null,
          roles: await resolveRoles(supabase, user.id),
          method: 'jwt',
          errorCode: null,
        });
      }
      // A Bearer JWT that fails verification is not identity. A separate
      // opaque session can still authenticate the request during migration.
      bearerWasRejected = true;
    } else {
      // The public anon key, a malformed JWT, or an arbitrary Bearer string
      // must never silently become an anonymous caller.
      bearerWasRejected = true;
    }
  }

  const sessionToken = extractSessionToken(req.headers, body);
  if (sessionToken) {
    const session = await verifySession(supabase, sessionToken);
    if (!session.error && session.userId) {
      return ctx({
        ok: true,
        authType: 'human',
        actorId: session.userId,
        username: session.username,
        roles: await resolveRoles(supabase, session.userId),
        method: 'session',
        errorCode: null,
      });
    }
    return ctx({ errorCode: 'invalid_session' });
  }

  return ctx({ errorCode: bearerWasRejected ? 'invalid_jwt' : 'missing_credentials' });
}

// ── Internal service authentication (AUTH-002 / WP-12) ────────────────────
//
// Signed request envelope:
//   X-Internal-Timestamp: unix seconds
//   X-Internal-Nonce:     128-bit random hex
//   X-Internal-Caller:    calling function name
//   X-Internal-Key-Id:    key version id (default "v1"). Enables overlap rotation.
//   X-Internal-Signature: hex(HMAC-SHA256(secret, method\npath\ntimestamp\nnonce\ncaller\nkeyId\nsha256(body)))
//
// Key rotation: signer picks the newest configured key (V2 if set, else V1).
// Verifier honours the presented key id against BOTH the current and previous
// secret so a rotation can run with a documented overlap window.
//
// Replay defence: a single-use nonce (stored in `internal_request_nonces` when
// available, else per-instance memory) plus a bounded timestamp window.
//
// ## Why the window is ASYMMETRIC
//
// A signed internal request is minted by `cron_signed_internal_headers`, which
// stamps `clock_timestamp()` — the wall clock at ENQUEUE — and then hands the
// request to `pg_net`, which delivers it from a background queue. So the
// window has to cover the queue wait, and the queue wait is not bounded by
// anything this code controls.
//
// Measured on the prime, 19-20 Sep 2026: 19 refusals in 24 hours, sporadic
// rather than constant, and arriving in tight clusters — FOUR denials inside
// 27 ms at 16:32:32, three inside 47 ms at 16:26:15. Four requests landing in
// the same 27 milliseconds, all stale, is one pg_net batch flushing after a
// stall. A wrong secret or a wrong unit would have refused every request
// instead of one in a few hundred, and a drifting clock would not arrive in
// batches. The cost was real: `resume-investment-reports` is the watchdog that
// continues a report after it hands off on its wall-clock budget, so while it
// was being refused a Compass only finished if somebody had a browser tab
// open. `migration-dispatcher` and `conversation-sync-cron` were refused the
// same way.
//
// The two directions are not the same claim:
//
//   * A timestamp in the FUTURE is an anomaly — a clock ahead of ours, or a
//     forged stamp. Nothing legitimate produces one, so it stays tight.
//   * A timestamp in the PAST is ordinary queue latency. What stops a captured
//     signature being reused is the NONCE, which is single-use and durable;
//     the window only bounds how long a captured signature is worth trying
//     against the degraded in-memory nonce store. Fifteen minutes is bounded,
//     survives a batch stall, and is the same order as the pg_net queue's own
//     worst observed drain.
//
// Widening BOTH sides would have been the wrong fix: it would have loosened
// the one direction that carries a real signal to buy tolerance the other
// direction needed.

/** A stamp ahead of our clock. Nothing legitimate produces one. */
const INTERNAL_SKEW_FUTURE_SECONDS = 90;
/** A stamp behind our clock: pg_net queue latency, bounded by the nonce. */
const INTERNAL_SKEW_PAST_SECONDS = 900;
/** Retained for the memory-nonce sweep below, which wants the wider bound. */
const INTERNAL_SKEW_SECONDS = INTERNAL_SKEW_PAST_SECONDS;
const memoryNonces = new Map<string, number>();

/** Ordered map of accepted key ids → secret. First entry is the current signer. */
function loadInternalKeys(): Array<{ id: string; secret: string }> {
  const out: Array<{ id: string; secret: string }> = [];
  const v2 = (Deno.env.get('INTERNAL_EDGE_SECRET_V2') || '').trim();
  const v1 = (Deno.env.get('INTERNAL_EDGE_SECRET') || '').trim();
  if (v2.length >= 16) out.push({ id: 'v2', secret: v2 });
  if (v1.length >= 16) out.push({ id: 'v1', secret: v1 });
  return out;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Fail-closed webhook secret gate. Returns true only when a sufficiently strong
 * secret is configured AND the presented value matches it (constant-time).
 * A missing/weak secret returns false — production webhooks must refuse to run
 * rather than process unauthenticated input.
 */
export function verifyWebhookSecret(
  configured: string | null | undefined,
  presented: string | null | undefined,
  minLength = 16,
): boolean {
  const secret = (configured || '').trim();
  const given = (presented || '').trim();
  if (secret.length < minLength) return false;
  if (given.length === 0) return false;
  return constantTimeEqual(secret, given);
}

function internalMessage(method: string, path: string, timestamp: string, nonce: string, caller: string, keyId: string, bodyHash: string): string {
  return [method.toUpperCase(), path, timestamp, nonce, caller, keyId, bodyHash].join('\n');
}

/** Produce signed headers for an internal edge-function-to-edge-function call. */
export async function signInternalRequest(
  method: string,
  path: string,
  body: string,
  callerFunction: string
): Promise<Record<string, string>> {
  const keys = loadInternalKeys();
  if (keys.length === 0) throw new Error('INTERNAL_EDGE_SECRET is not configured or is too short');
  const { id: keyId, secret } = keys[0]; // newest key signs
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
  const nonce = [...nonceBytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  const bodyHash = await sha256Hex(body);
  const signature = await hmacHex(secret, internalMessage(method, path, timestamp, nonce, callerFunction, keyId, bodyHash));
  return {
    'X-Internal-Timestamp': timestamp,
    'X-Internal-Nonce': nonce,
    'X-Internal-Caller': callerFunction,
    'X-Internal-Key-Id': keyId,
    'X-Internal-Signature': signature,
  };
}

/**
 * Verify an internal signed request. `rawBody` must be the exact request body
 * string.
 *
 * WP-12 Phase C: strict signed is now HARD-LOCKED. The legacy static-secret
 * and service-role-Bearer trust paths have been removed entirely — every
 * internal call MUST present a valid HMAC-signed envelope. The
 * `allowLegacyStaticSecret` / `allowLegacyServiceRoleKey` / `strict` options
 * and the `INTERNAL_STRICT_SIGNED` env flag are retained as accepted-but-
 * ignored parameters for API compatibility; enabling a legacy fallback is
 * impossible.
 */
export async function verifyInternal(
  supabase: any,
  req: Request,
  rawBody: string,
  options: {
    /** @deprecated WP-12 Phase C — ignored; strict signed is hard-locked. */
    allowLegacyStaticSecret?: boolean;
    /** @deprecated WP-12 Phase C — ignored; strict signed is hard-locked. */
    allowLegacyServiceRoleKey?: boolean;
    allowedCallers?: string[];
    /** @deprecated WP-12 Phase C — ignored; strict signed is hard-locked. */
    strict?: boolean;
  } = {},
): Promise<AuthContext> {
  // WP-12 Phase C: guard against a caller that still expects the legacy paths
  // to be reachable. `true` here is a coding bug — the CI gate blocks it in
  // source, and we log-and-continue at runtime so the strict path still wins.
  if (options.allowLegacyStaticSecret === true || options.allowLegacyServiceRoleKey === true) {
    console.warn('[auth_v2] verifyInternal: legacy-fallback option requested but ignored (WP-12 Phase C hard-lock)');
  }
  const allowedCallers = options.allowedCallers && options.allowedCallers.length > 0
    ? new Set(options.allowedCallers)
    : null;

  const enforceCallerAllowlist = (caller: string | null): AuthContext | null => {
    if (!allowedCallers) return null;
    if (!caller || !allowedCallers.has(caller)) {
      console.warn('[auth_v2] internal caller not in receiver allowlist', { caller });
      return ctx({ errorCode: 'internal_caller_not_allowed' });
    }
    return null;
  };

  const keys = loadInternalKeys();

  // Preferred: signed envelope.
  const timestamp = req.headers.get('x-internal-timestamp');
  const nonce = req.headers.get('x-internal-nonce');
  const caller = req.headers.get('x-internal-caller');
  const signature = req.headers.get('x-internal-signature');
  const keyId = (req.headers.get('x-internal-key-id') || 'v1').trim();
  if (keys.length === 0 || !timestamp || !nonce || !caller || !signature) {
    return ctx({ errorCode: 'missing_credentials' });
  }
  const keyEntry = keys.find((k) => k.id === keyId);
  if (!keyEntry) return ctx({ errorCode: 'internal_unknown_key' });

  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(timestamp, 10);
  // The delta is LOGGED, because without it this refusal cannot be diagnosed:
  // queue latency, a drifting clock and a wrong unit all present as the same
  // word. Every wrong conclusion in this area came from reading the code
  // instead of the number.
  const skew = Number.isFinite(ts) ? now - ts : null;
  if (skew === null || skew > INTERNAL_SKEW_PAST_SECONDS || skew < -INTERNAL_SKEW_FUTURE_SECONDS) {
    console.warn('[auth_v2] internal timestamp outside the accepted window', {
      caller,
      keyId,
      skewSeconds: skew,
      direction: skew === null ? 'unparseable' : skew > 0 ? 'late' : 'ahead',
      acceptedPast: INTERNAL_SKEW_PAST_SECONDS,
      acceptedFuture: INTERNAL_SKEW_FUTURE_SECONDS,
    });
    return ctx({ errorCode: 'internal_timestamp_skew' });
  }

  // Accept either the raw pathname (`/foo`) or the gateway-prefixed form
  // (`/functions/v1/foo`). Callers sign the prefixed path, but the edge
  // runtime strips `/functions/v1` before this handler runs, so we compute
  // both candidates and accept a match on either.
  const rawPath = new URL(req.url).pathname;
  const prefixedPath = rawPath.startsWith('/functions/v1/')
    ? rawPath
    : `/functions/v1${rawPath.startsWith('/') ? '' : '/'}${rawPath}`;
  const bodyHash = await sha256Hex(rawBody);
  const expectedRaw = await hmacHex(keyEntry.secret, internalMessage(req.method, rawPath, timestamp, nonce, caller, keyId, bodyHash));
  const expectedPrefixed = rawPath === prefixedPath
    ? expectedRaw
    : await hmacHex(keyEntry.secret, internalMessage(req.method, prefixedPath, timestamp, nonce, caller, keyId, bodyHash));
  if (!constantTimeEqual(expectedRaw, signature) && !constantTimeEqual(expectedPrefixed, signature)) {
    return ctx({ errorCode: 'invalid_internal_signature' });
  }


  const denied = enforceCallerAllowlist(caller);
  if (denied) return denied;

  // Nonce replay check: durable table first, per-instance memory as fallback.
  try {
    const { error } = await supabase
      .from('internal_request_nonces')
      .insert({ nonce, caller_function: caller });
    if (error) {
      if (String(error.code) === '23505') {
        return ctx({ errorCode: 'internal_replay' });
      }
      if (memoryNonces.has(nonce)) return ctx({ errorCode: 'internal_replay' });
      memoryNonces.set(nonce, now);
    }
  } catch (_e) {
    if (memoryNonces.has(nonce)) return ctx({ errorCode: 'internal_replay' });
    memoryNonces.set(nonce, now);
  }
  if (memoryNonces.size > 10000) {
    for (const [n, t] of memoryNonces) if (now - t > INTERNAL_SKEW_SECONDS * 2) memoryNonces.delete(n);
  }

  return ctx({
    ok: true,
    authType: 'internal_service',
    actorId: caller,
    username: 'system',
    roles: [],
    method: 'internal_hmac',
    errorCode: null,
  });
}

/**
 * Record a security event (best-effort; never throws). Uses the
 * security_events table created in the Phase 1 migration.
 */
export async function logSecurityEvent(
  supabase: any,
  event: {
    action: string;
    decision: 'allow' | 'deny';
    reason_code?: string;
    actor_type?: string;
    actor_id?: string | null;
    target_type?: string;
    target_id?: string | null;
    correlation_id?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await supabase.from('security_events').insert({
      action: event.action,
      decision: event.decision,
      reason_code: event.reason_code ?? null,
      actor_type: event.actor_type ?? 'unknown',
      actor_id: event.actor_id ?? null,
      target_type: event.target_type ?? null,
      target_id: event.target_id ?? null,
      correlation_id: event.correlation_id ?? crypto.randomUUID(),
      metadata_redacted: event.metadata ?? {},
    });
  } catch (_e) {
    // Logging must never break the request path.
  }
}
