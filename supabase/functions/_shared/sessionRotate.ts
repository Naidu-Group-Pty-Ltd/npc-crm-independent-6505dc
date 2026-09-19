/**
 * WP-11B/C Phase 3 — session rotation on privilege elevation.
 *
 * Any time a caller crosses a privilege boundary (successful step-up, MFA
 * assertion, role change, password change) the pre-existing session token
 * must be invalidated and a fresh one issued. This defeats session-fixation
 * attacks where an attacker seeds a cookie into the victim's browser and
 * waits for the victim to authenticate.
 *
 * Callers:
 *   - `security-step-up` on successful proof consumption
 *   - `custom-auth-change-password` after password reset
 *   - `admin-user-management` on role/permission escalation
 *
 * The new token is returned so the caller can:
 *   1. Set it as `__Host-session_token` cookie via `createSessionCookie()`.
 *   2. Store the hashed form via `_shared/sessionHash.ts` on write.
 *
 * The old row is soft-revoked (revoked_at) rather than deleted so the audit
 * trail survives. `verifySession()` already rejects rows with `revoked_at`.
 */

import { hashSessionToken, isSessionHashConfigured, computeIdleExpiry } from './sessionHash.ts';

export interface RotationResult {
  ok: boolean;
  newSessionToken?: string;
  newSessionId?: string;
  expiresAt?: Date;
  error?: string;
}

/** Generate a fresh 256-bit URL-safe token. */
function mintSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  // base64url
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Rotate the session bound to `oldSessionId`.
 * - Marks the old row `revoked_at = now()` with reason.
 * - Inserts a new row inheriting user_id + ip/ua metadata.
 *
 * SECURITY: This function trusts the caller has already authenticated the
 * user and confirmed the elevation event. It does NOT re-verify credentials.
 */
export async function rotateSession(
  supabase: any,
  oldSessionId: string,
  reason: 'step_up' | 'password_change' | 'privilege_change' | 'mfa_verified',
  ttlSeconds = 60 * 60 * 8, // 8h default; existing sessions cap at expires_at
): Promise<RotationResult> {
  try {
    const { data: old, error: fetchErr } = await supabase
      .from('user_sessions')
      .select('id, user_id, ip_address, user_agent, expires_at')
      .eq('id', oldSessionId)
      .maybeSingle();

    if (fetchErr || !old) {
      return { ok: false, error: 'session_not_found' };
    }

    const newToken = mintSessionToken();
    const now = new Date();
    // Preserve original absolute expiry — rotation must not extend the
    // total session lifetime; it only rebinds the token identifier.
    const absoluteExpiresAt = new Date(old.expires_at);
    const cappedExpiresAt = new Date(Math.min(
      absoluteExpiresAt.getTime(),
      now.getTime() + ttlSeconds * 1000,
    ));
    const idleExpiresAt = computeIdleExpiry();

    const insertRow: Record<string, unknown> = {
      user_id: old.user_id,
      expires_at: cappedExpiresAt.toISOString(),
      idle_expires_at: idleExpiresAt.toISOString(),
      ip_address: old.ip_address,
      user_agent: old.user_agent,
      rotated_from_session_id: oldSessionId,
    };
    // WP-11A: store only the peppered hash when available; write plaintext solely
    // as a fallback when the pepper is unconfigured (hash-first readers resolve both).
    if (isSessionHashConfigured()) {
      insertRow.token_hash = await hashSessionToken(newToken);
    } else {
      insertRow.session_token = newToken;
    }

    const { data: inserted, error: insErr } = await supabase
      .from('user_sessions')
      .insert(insertRow)
      .select('id')
      .maybeSingle();

    if (insErr || !inserted) {
      console.error('[rotateSession] insert failed:', insErr?.message);
      return { ok: false, error: 'insert_failed' };
    }

    const { error: revErr } = await supabase
      .from('user_sessions')
      .update({
        revoked_at: now.toISOString(),
        revocation_reason: `rotated:${reason}`,
      })
      .eq('id', oldSessionId);

    if (revErr) {
      console.error('[rotateSession] revoke of old session failed:', revErr.message);
      return { ok: false, error: 'revoke_failed' };
    }

    return {
      ok: true,
      newSessionToken: newToken,
      newSessionId: inserted.id,
      expiresAt: cappedExpiresAt,
    };
  } catch (err) {
    console.error('[rotateSession] unexpected error:', (err as Error).message);
    return { ok: false, error: 'unexpected' };
  }
}
