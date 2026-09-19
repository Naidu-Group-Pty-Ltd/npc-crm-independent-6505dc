import { useMemo } from 'react';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { useAuth } from './useAuth';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/integrations/supabase/env';

/**
 * Authenticated data access for the custom staff session.
 *
 * ## Why this no longer sends a token
 *
 * This client used to attach `supabase_access_token` — an HS256 JWT minted by
 * `_shared/jwt.ts`. Both Supabase projects sign with ES256 (their JWKS publish
 * ES256; the HS256 key is `previously_used`), so that token was rejected. Worse,
 * when it was absent the client was built with the anon key and NO
 * `Authorization` header, so every query silently ran as `anon` against tables
 * whose RLS is enabled and came back empty instead of failing. Fourteen tables
 * across sixteen modules were affected.
 *
 * The browser now sends no token at all. It sends its existing HttpOnly session
 * cookie to the `authenticated-data` Edge Function, which verifies the session
 * and resolves the user, roles and tenant server-side before touching data.
 *
 * ## How the whole surface migrated at once
 *
 * Callers keep using `supabase.from('table').select()...` unchanged. The custom
 * `fetch` below rewrites the PostgREST URL to the gateway, so the query string —
 * filters, ordering, ranges, `Prefer` headers, `content-range` counts — passes
 * through untouched. That is why sixteen modules needed no edits: the change is
 * in one place, and no module can accidentally keep the old path.
 *
 * `credentials: 'include'` is what carries the cookie cross-site; the cookie is
 * `SameSite=None; Secure`, so it is sent to the Supabase origin over HTTPS only.
 *
 * ## Failing visibly
 *
 * There is no anon fallback any more. An unauthenticated caller gets a real 401
 * from the gateway, so an empty result now means "genuinely empty" rather than
 * "quietly unauthorised".
 */


const REST_PREFIX = '/rest/v1/';
const GATEWAY_PREFIX = '/functions/v1/authenticated-data/';

/** Rewrites a PostgREST request onto the cookie-authenticated gateway. */
export function gatewayFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  let url = raw;
  try {
    const parsed = new URL(raw);
    if (parsed.pathname.startsWith(REST_PREFIX)) {
      parsed.pathname = GATEWAY_PREFIX + parsed.pathname.slice(REST_PREFIX.length);
      url = parsed.toString();
    }
  } catch { /* non-absolute URL: leave it alone */ }

  return fetch(url, {
    ...init,
    // The HttpOnly custom-session cookie is the credential. Without this the
    // gateway sees an anonymous request and refuses it.
    credentials: 'include',
  });
}

let cachedClient: SupabaseClient<Database> | null = null;

function gatewayClient(): SupabaseClient<Database> {
  if (cachedClient) return cachedClient;
  cachedClient = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { fetch: gatewayFetch },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'npc-custom-auth-query-client',
    },
  });
  return cachedClient;
}

/**
 * Data client for the current staff session.
 *
 * ```tsx
 * const { supabase, isAuthenticated } = useAuthenticatedSupabase();
 * const { data } = await supabase.from('workflows').select('*');
 * ```
 */
export function useAuthenticatedSupabase() {
  const { user } = useAuth();
  const supabase = useMemo<SupabaseClient<Database>>(() => gatewayClient(), []);

  return {
    supabase,
    // Authority is the cookie, which JavaScript cannot read. A resolved user
    // from custom-auth-verify-v2 is the browser's evidence that one exists.
    isAuthenticated: !!user,
    userId: user?.id || null,
  };
}

/** Same client, for use outside React components. */
export function getAuthenticatedSupabaseClient(): SupabaseClient<Database> {
  return gatewayClient();
}
