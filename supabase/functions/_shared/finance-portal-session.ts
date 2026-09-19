/**
 * Shared helper for finance portal session resolution.
 * Returns the validated portal user or throws via a Response thunk.
 */
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.55.0";
import {
  extractFinanceCredential,
  extractFinanceSessionToken,
  type FinanceCredential,
} from './financeSessionToken.ts';

export { extractFinanceCredential };
export type { FinanceCredential, FinanceCredentialSource } from './financeSessionToken.ts';

/**
 * The Finance Portal's session credential.
 *
 * ## Why this delegates rather than reading the headers itself
 *
 * It used to be four `??`s over two headers and two body fields, and **it
 * could not see the session cookie**. WP-11B/C had already moved the portal's
 * session into an HttpOnly `__Host-finance_session_token` cookie and
 * deliberately stopped mirroring it into localStorage — the browser client
 * keeps only an in-memory copy, which does not survive a page load. So from
 * the second page view onwards the client sends no header and no body token,
 * only the cookie, and this function returned `null` for a session that was
 * live, unexpired and unrevoked in the database.
 *
 * The consequence was measured in production: `finance-portal-agreements`
 * answered `401 Session token required` to essentially every call a partner
 * made — request body 20 bytes (`{"operation":"list"}`, no token fields),
 * response 54 bytes, cookie present and valid — so the partner's agreements
 * page rendered "No agreements yet" while the Command Centre correctly showed
 * "Delivery confirmed" from the one call that happened to run in the tab that
 * still had the token in memory.
 *
 * `finance-portal-verify` and `finance-portal-logout` had already been moved
 * onto the cookie-aware reader, which is why the portal LOOKED signed in while
 * every data surface was empty: the session check passed and the data calls
 * did not.
 *
 * There must be exactly one implementation of this, and this is the one:
 * `financeSessionToken.ts`, which also refuses the Command Centre's cookie as
 * a finance credential.
 */
export function extractFinanceToken(headers: Headers, body?: any): string | null {
  return extractFinanceSessionToken(headers, body as Record<string, unknown> | undefined);
}

export function makeServiceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

export async function resolveFinancePartner(supabase: SupabaseClient, token: string | null) {
  if (!token) return { error: 'Session token required', status: 401 };
  // WP-11A: dual-read (hash first, plaintext fallback) and backfill.
  let hash: string | null = null;
  try {
    const mod = await import('./sessionHash.ts');
    if (mod.isSessionHashConfigured()) hash = await mod.hashSessionToken(token);
  } catch { /* pepper missing → fallback */ }

  const cols = 'id, email, is_active, revoked_at, session_expires_at, session_idle_expires_at, session_token_hash, global_permissions';
  let portalUser: any = null;
  if (hash) {
    const { data } = await supabase.from('finance_portal_users').select(cols)
      .eq('session_token_hash', hash).maybeSingle();
    portalUser = data ?? null;
  }
  if (!portalUser) {
    const { data } = await supabase.from('finance_portal_users').select(cols)
      .eq('session_token', token).maybeSingle();
    portalUser = data ?? null;
  }
  if (!portalUser || !portalUser.is_active || portalUser.revoked_at) {
    return { error: 'Invalid session', status: 401 };
  }
  if (!portalUser.session_expires_at || new Date(portalUser.session_expires_at) < new Date()) {
    return { error: 'Session expired', status: 401 };
  }
  if (portalUser.session_idle_expires_at && new Date(portalUser.session_idle_expires_at) < new Date()) {
    return { error: 'Session expired', status: 401 };
  }
  try {
    const patch: Record<string, unknown> = { session_last_used_at: new Date().toISOString() };
    if (hash && !portalUser.session_token_hash) patch.session_token_hash = hash;
    await supabase.from('finance_portal_users').update(patch).eq('id', portalUser.id);
  } catch { /* non-fatal */ }
  return { portalUser };
}
