import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { logActivity } from '@/hooks/useActivityLogger';
import { resetAuthFailures, AUTH_EXHAUSTED_EVENT } from '@/lib/secureInvoke';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import {
  registerCurrentDevice,
  heartbeatCurrentDevice,
  releaseCurrentDevice,
  type DeviceRow,
} from '@/lib/deviceSession';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/integrations/supabase/env';

interface User {
  id: string;
  username: string;
  role: string;
}

export interface DeviceLimitInfo {
  devices_active: number;
  device_limit: number;
  devices: DeviceRow[];
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isSuperadmin: boolean;
  isAdmin: boolean;
  roles: string[];
  accessToken: string | null;
  signIn: (
    username: string,
    password: string,
    turnstileToken?: string,
  ) => Promise<{ error?: string; deviceLimit?: DeviceLimitInfo }>;
  signOut: () => Promise<void>;
  /** Retry device registration after the user revokes a device in the dialog. */
  retryDeviceRegistration: () => Promise<{ error?: string; deviceLimit?: DeviceLimitInfo }>;
  /** Cancel a sign-in that is blocked on the device cap and log out the tokens. */
  cancelPendingSession: () => Promise<void>;
}


const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Supabase Edge Function base URL

// Access token storage keys
const ACCESS_TOKEN_KEY = 'supabase_access_token';
const SESSION_TOKEN_KEY = 'session_token';

const COMMAND_CENTRE_AUTH_FUNCTIONS = {
  login: 'custom-auth-login-v2',
  verify: 'custom-auth-verify-v2',
  logout: 'custom-auth-logout-v2',
} as const;

// ── Auth version epoch ──
// Bump this number whenever the auth flow changes in a way that invalidates old tokens.
// On mount, if the stored version doesn't match, stale tokens are auto-cleared
// so users don't need to manually clear browser data.
// v5 (WP-11B/C cookie-only): purge any legacy JS-stored session_token from
// earlier builds so nothing replayable lingers in browser storage.
const AUTH_VERSION = 5;
const AUTH_VERSION_KEY = 'auth_version';

// WP-11B/C — cookie-only staff sessions.
//
// Access-token JWT: kept in tab-scoped `sessionStorage` ONLY (no localStorage
// mirror). It survives reloads within the same tab but not durable exfil.
// Session token: no longer persisted — the browser holds it as the HttpOnly
// `__Host-session_token` cookie, which every edge-function fetch attaches via
// `credentials: 'include'`. An in-memory copy is kept for legacy header
// fallbacks (`x-session-token`) so cookie-blocked environments still work.
let inMemorySessionToken: string | null = null;

const getStoredValue = (key: string): string | null => {
  if (key === SESSION_TOKEN_KEY) return inMemorySessionToken;
  try { return sessionStorage.getItem(key); } catch { return null; }
};

const persistStoredValue = (key: string, value: string) => {
  if (key === SESSION_TOKEN_KEY) { inMemorySessionToken = value; return; }
  try { sessionStorage.setItem(key, value); } catch { /* ignore */ }
};

const clearStoredValue = (key: string) => {
  if (key === SESSION_TOKEN_KEY) { inMemorySessionToken = null; return; }
  try { sessionStorage.removeItem(key); } catch { /* ignore */ }
  // Best-effort scrub any legacy localStorage mirror from earlier builds.
  try { localStorage.removeItem(key); } catch { /* ignore */ }
};

/**
 * Check if stored auth version matches current. If not, purge stale tokens.
 * This prevents the "clear browser data" requirement after deployments.
 */
function enforceAuthVersion(): void {
  try {
    const stored = localStorage.getItem(AUTH_VERSION_KEY);
    const storedVersion = stored ? parseInt(stored, 10) : 0;

    if (storedVersion !== AUTH_VERSION) {
      console.log(`[Auth] Version mismatch (stored=${storedVersion}, current=${AUTH_VERSION}). Clearing stale tokens.`);
      clearStoredValue(ACCESS_TOKEN_KEY);
      clearStoredValue(SESSION_TOKEN_KEY);
      try { sessionStorage.removeItem('current_user'); } catch { /* ignore */ }
      // Wipe any legacy localStorage mirrors from pre-WP-11B builds.
      try { localStorage.removeItem(ACCESS_TOKEN_KEY); } catch { /* ignore */ }
      try { localStorage.removeItem(SESSION_TOKEN_KEY); } catch { /* ignore */ }

      localStorage.setItem(AUTH_VERSION_KEY, String(AUTH_VERSION));

      if ('caches' in window) {
        caches.keys().then(names => {
          names.forEach(name => caches.delete(name));
        });
      }
    }
  } catch (e) {
    console.warn('[Auth] Version check failed:', e);
  }
}

// How long a session probe may hold the sign-in form hostage.
//
// `fetch` has no default timeout, so a request that is accepted and then never
// answered — an edge function cold-booting behind a stalled boot, a captive
// portal, a corporate proxy holding the socket — leaves the promise pending for
// ever. `checkSession` runs on mount and `loading` only clears in its `finally`,
// so that pending promise rendered /auth as a permanent "Loading" spinner with
// no sign-in form and nothing to click. Production answers this call in under
// 2s for 99.9% of requests (slowest genuine answer measured: 3.7s), so 8s
// distinguishes "slow" from "never" with room to spare.
const SESSION_VERIFY_TIMEOUT_MS = 8000;

// Sign-in does bcrypt work and an outbound Turnstile siteverify, so it is
// legitimately slower than a session probe. It still must not hang for ever:
// without a bound the Sign In button spins until the tab is closed.
const AUTH_REQUEST_TIMEOUT_MS = 30000;

/**
 * Invoke edge function with `credentials: 'include'` so the browser sends the
 * HttpOnly `__Host-session_token` cookie. Legacy header/body fallbacks are
 * preserved only for the in-memory session token during rollout.
 *
 * Every call is bounded by `timeoutMs`. A timeout is reported as
 * `error.timeout === true` so callers can tell "the server said no" (which
 * invalidates a session) from "we never heard back" (which must not).
 */
async function invokeEdgeFunction(
  functionName: string,
  body?: Record<string, any>,
  timeoutMs: number = AUTH_REQUEST_TIMEOUT_MS,
): Promise<{ data: any; error: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // WP-11B/C cookie-only: staff session travels solely in the HttpOnly
    // `__Host-session_token` cookie (`credentials: 'include'`). No raw session
    // token is read from JS storage or sent in the body/header. The access-token
    // JWT is still used as the Bearer for RLS-scoped direct queries.
    const accessToken = getStoredValue(ACCESS_TOKEN_KEY);
    const bearerToken = accessToken || SUPABASE_ANON_KEY;

    const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${bearerToken}`,
      },
      credentials: 'include',
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });

    const data = await response.json();

    if (!response.ok) {
      return { data, error: { message: data.error || `HTTP ${response.status}`, status: response.status } };
    }

    return { data, error: null };
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      return {
        data: null,
        error: { message: `${functionName} did not respond within ${Math.round(timeoutMs / 1000)}s`, timeout: true },
      };
    }
    return { data: null, error: { message: error.message || 'Network error' } };
  } finally {
    clearTimeout(timer);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<string[]>([]);
  const [accessToken, setAccessToken] = useState<string | null>(() => {
    // Enforce version BEFORE reading tokens — purges stale ones
    enforceAuthVersion();
    return getStoredValue(ACCESS_TOKEN_KEY);
  });

  // Super admin check
  const isSuperadmin = roles.includes('superadmin') || user?.role === 'super_admin';
  const isAdmin = roles.includes('admin') || isSuperadmin || user?.role === 'sub_admin';

  // The realtime setAuth call was removed with the HS256 token (ES256
  // remediation): there is no project JWT to authorise the socket with, and
  // passing the anon key only made an unauthorised socket look authorised.
  // Surfaces that relied on it poll through the authenticated gateway instead.

  // Check for existing session on mount
  useEffect(() => {
    checkSession();
  }, []);

  // A revoked/expired session makes every poller 401 (balance, internal
  // messaging, market updates…). When the circuit breaker trips, clear local
  // auth state so ProtectedRoute sends the user to /auth instead of leaving a
  // blank screen behind a dead session.
  useEffect(() => {
    const onExhausted = () => clearAuthState();
    window.addEventListener(AUTH_EXHAUSTED_EVENT, onExhausted);
    return () => window.removeEventListener(AUTH_EXHAUSTED_EVENT, onExhausted);
  }, []);


  // Heartbeat the registered device every 5 min while signed in.
  const heartbeatRef = useRef<number | null>(null);
  useEffect(() => {
    if (!user) return;
    // Fire one immediately so the device's `last_seen_at` updates on page load.
    heartbeatCurrentDevice().catch(() => { /* best effort */ });
    const id = window.setInterval(() => {
      heartbeatCurrentDevice().catch(() => { /* best effort */ });
    }, 5 * 60 * 1000);
    heartbeatRef.current = id;
    return () => {
      if (heartbeatRef.current != null) window.clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    };
  }, [user?.id]);



  const checkSession = async () => {
    try {
      // WP-11B/C — the session token now lives only in the HttpOnly
      // `__Host-session_token` cookie, so we cannot preflight its presence
      // from JavaScript. Always ask the server; `credentials: 'include'`
      // sends the cookie. If neither the cookie nor a stored access token
      // is available the server returns `valid:false` and we clear state.
      const { data, error } = await invokeEdgeFunction(
        COMMAND_CENTRE_AUTH_FUNCTIONS.verify,
        undefined,
        SESSION_VERIFY_TIMEOUT_MS,
      );


      if (error) {
        if (error.timeout) {
          // Same posture as any other transport failure: silence is not proof
          // the session is invalid, so the cookie and tab JWT are preserved and
          // the user simply gets the sign-in form. What must NOT happen is the
          // spinner staying up — `finally` below releases it either way.
          console.warn('[Auth] Session verification timed out; showing the sign-in form.');
        } else if (error.status === 400 || error.status === 401) {
          // Definitive auth failure — clear stale tokens so we don't keep retrying
          console.log('[Auth] Session verify failed (status:', error.status, '), clearing stale tokens');
          clearAuthState();
        } else {
          // Network/server/CORS errors are not proof that the server-side
          // session is invalid. Preserve the tab JWT and cookie so a temporary
          // outage cannot sign the user out or destroy recovery state.
          console.warn('[Auth] Session verification error (transient):', error.message);
        }
      } else if (!data?.valid) {
        clearAuthState();
      } else {
        // Valid session
        setUser(data.user);
        setRoles(data.roles || []);
        resetAuthFailures();
        
        if (data.access_token) {
          persistStoredValue(ACCESS_TOKEN_KEY, data.access_token);
          setAccessToken(data.access_token);
        } else if (data.jwt_unavailable) {
          // The session is valid but no RLS token was issued. Direct PostgREST
          // queries will run as `anon` and return empty results rather than
          // errors, so this must not pass unremarked — an empty notification
          // bell looked like "nothing happened" for a month.
          console.error(
            '[Auth] Signed in without an RLS access token: direct Supabase queries '
            + 'will return no rows. Check that JWT_SECRET / SUPABASE_JWT_SECRET is set '
            + 'for the custom-auth edge functions.',
          );
          clearStoredValue(ACCESS_TOKEN_KEY);
          setAccessToken(null);
        }
        // Cookie-only: the session token is never returned or persisted in JS.

        sessionStorage.setItem('current_user', JSON.stringify({
          id: data.user.id,
          username: data.user.username
        }));
      }
    } catch (error: any) {
      // Only explicit 400/401 responses above invalidate auth. An exception is
      // a transport failure and must not erase an otherwise valid session.
      console.warn('Session check failed:', error?.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const clearAuthState = () => {
    sessionStorage.removeItem('current_user');
    clearStoredValue(ACCESS_TOKEN_KEY);
    clearStoredValue(SESSION_TOKEN_KEY);
    setUser(null);
    setRoles([]);
    setAccessToken(null);
  };

  // Holds an authenticated session that has NOT yet been granted a device
  // slot. We keep the tokens stored so the Manage Devices dialog can revoke
  // other devices, but we don't set `user`/`roles` until the device slot is
  // acquired — that's what gates access to protected routes.
  const pendingSessionRef = useRef<null | {
    user: User;
    roles: string[];
  }>(null);

  const cancelPendingSession = async () => {
    pendingSessionRef.current = null;
    try { await invokeEdgeFunction(COMMAND_CENTRE_AUTH_FUNCTIONS.logout); } catch { /* ignore */ }
    clearAuthState();
  };

  const finalizePendingSession = () => {
    const pending = pendingSessionRef.current;
    if (!pending) return;
    pendingSessionRef.current = null;
    setUser(pending.user);
    setRoles(pending.roles);
    resetAuthFailures();
    sessionStorage.setItem('current_user', JSON.stringify({
      id: pending.user.id,
      username: pending.user.username,
    }));
    logActivity({
      userId: pending.user.id,
      username: pending.user.username,
      actionType: 'login',
      entityType: 'session',
      entityName: pending.user.username,
      metadata: { roles: pending.roles }
    });
  };

  const retryDeviceRegistration = async (): Promise<{ error?: string; deviceLimit?: DeviceLimitInfo }> => {
    if (!pendingSessionRef.current) return { error: 'No pending sign-in to retry.' };
    const deviceResult = await registerCurrentDevice();
    if (deviceResult.ok) {
      finalizePendingSession();
      return {};
    }
    if (deviceResult.code === 'device_limit_reached') {
      return {
        error: `You have reached the maximum of ${deviceResult.device_limit} active devices for your plan.`,
        deviceLimit: {
          devices_active: deviceResult.devices_active,
          device_limit: deviceResult.device_limit,
          devices: deviceResult.devices,
        },
      };
    }
    const message = deviceResult.code === 'error' ? deviceResult.message : 'Device registration failed.';
    return { error: message };
  };

  const signIn = async (username: string, password: string, turnstileToken?: string) => {
    try {
      // Clear any stale tokens BEFORE login
      clearStoredValue(ACCESS_TOKEN_KEY);
      clearStoredValue(SESSION_TOKEN_KEY);
      pendingSessionRef.current = null;

      const { data, error } = await invokeEdgeFunction(COMMAND_CENTRE_AUTH_FUNCTIONS.login, {
        username,
        password,
        turnstile_token: turnstileToken,
      });

      if (error || !data?.success) {
        return { error: data?.error || 'Login failed' };
      }

      // Persist tokens so the device-management edge function can authenticate,
      // but DO NOT set user/roles until a device slot is acquired.
      if (data.access_token) {
        persistStoredValue(ACCESS_TOKEN_KEY, data.access_token);
        setAccessToken(data.access_token);
      }
      // Cookie-only: no session token is returned/persisted; the HttpOnly
      // `__Host-session_token` cookie (Set-Cookie on the login response) is the
      // sole carrier.
      try { localStorage.setItem(AUTH_VERSION_KEY, String(AUTH_VERSION)); } catch { /* ignore */ }

      pendingSessionRef.current = {
        user: data.user,
        roles: data.roles || [],
      };

      const deviceResult = await registerCurrentDevice();
      if (!deviceResult.ok) {
        if (deviceResult.code === 'device_limit_reached') {
          // Tokens stay in place so the dialog can revoke another device.
          // The caller MUST resolve this by calling either
          // `retryDeviceRegistration` or `cancelPendingSession`.
          return {
            error: `You have reached the maximum of ${deviceResult.device_limit} active devices for your plan. Sign out of another device to continue.`,
            deviceLimit: {
              devices_active: deviceResult.devices_active,
              device_limit: deviceResult.device_limit,
              devices: deviceResult.devices,
            },
          };
        }
        if (deviceResult.code === 'error') {
          console.warn('[Auth] Device registration failed:', deviceResult.message);
        }
      }

      finalizePendingSession();
      return {};
    } catch (error) {
      console.error('Sign in error:', error);
      pendingSessionRef.current = null;
      return { error: 'Login failed' };
    }
  };


  const signOut = async () => {
    const currentUser = user;

    // Release the device slot BEFORE the session token is invalidated so
    // the edge function can still authenticate the request.
    try { await releaseCurrentDevice('user_signed_out'); } catch { /* best effort */ }

    try {
      await invokeEdgeFunction(COMMAND_CENTRE_AUTH_FUNCTIONS.logout);
    } catch (error) {
      console.error('Logout error:', error);
    }

    if (currentUser) {
      logActivity({
        userId: currentUser.id,
        username: currentUser.username,
        actionType: 'logout',
        entityType: 'session',
        entityName: currentUser.username
      });
    }

    clearAuthState();
  };


  return (
    <AuthContext.Provider value={{ user, loading, isSuperadmin, isAdmin, roles, accessToken, signIn, signOut, retryDeviceRegistration, cancelPendingSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
