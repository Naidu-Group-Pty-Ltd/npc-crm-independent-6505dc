import type { PortalAcknowledgementKey } from '@/lib/portalAgreement';
import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/integrations/supabase/env';

interface FinancePortalUser {
  id: string;
  finance_contact_id: string;
  email: string;
  name: string;
  company: string | null;
  contact_type: string | null;
  has_accepted_terms: boolean;
  /**
   * Whether the partner has accepted the terms version that is current *now*.
   * `has_accepted_terms` only records that they once accepted something, so an
   * amended agreement would otherwise never be presented to anyone already
   * through the door.
   *
   * OPTIONAL on purpose. Migrations, edge functions and the site build ship on
   * three separate tracks in this repo, so the app can be running against a
   * `finance-portal-verify` that predates version-aware acceptance and does not
   * send this field. Absent is not the same as false, and treating it as false
   * locks every finance partner out — see `FinancePortalProtectedRoute`.
   */
  has_accepted_current_terms?: boolean;
  current_terms_version?: string | null;
  has_completed_onboarding: boolean;
  must_change_password?: boolean;
}

interface FinancePortalAuthContextType {
  user: FinancePortalUser | null;
  loading: boolean;
  signIn: (email: string, password: string, turnstileToken?: string) => Promise<{ error?: string; mustChangePassword?: boolean }>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<{ error?: string; success?: boolean }>;
  verifyOTP: (email: string, otp: string) => Promise<{ error?: string; success?: boolean }>;
  resetPassword: (email: string, otp: string, newPassword: string) => Promise<{ error?: string; success?: boolean }>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<{ error?: string; success?: boolean }>;
  acceptTerms: (acknowledgements: PortalAcknowledgementKey[]) => Promise<void>;
  completeOnboarding: () => Promise<void>;
  setSessionFromInvite: (sessionToken: string, user: FinancePortalUser) => void;
  invokeFinanceFunction: (
    functionName: string,
    body?: Record<string, any>
  ) => Promise<{ data: any; error: any }>;
  getSessionToken: () => string | null;
  refreshUser: () => Promise<void>;
}

const FinancePortalAuthContext = createContext<FinancePortalAuthContextType | undefined>(undefined);


const FINANCE_SESSION_KEY = 'finance_portal_session_token';
const FINANCE_AUTHED_AT_KEY = 'finance_portal_authed_at';
// Grace window after a successful login/verify during which we suppress
// the auto-clear-on-401 redirect to avoid kicking users right back to the
// login page when an unrelated widget races ahead of the session being
// fully recognised downstream.
const AUTH_GRACE_MS = 15_000;

// WP-11B/C — finance portal session token lives only in the HttpOnly
// `__Host-finance_session_token` cookie once the login response sets it.
// We keep an in-memory copy for legacy header/body fallbacks during rollout;
// no localStorage/sessionStorage mirror is persisted.
let inMemoryFinanceSessionToken: string | null = null;
let inMemoryFinanceAuthedAt = 0;

const getStoredValue = (key: string): string | null => {
  if (key === FINANCE_SESSION_KEY) return inMemoryFinanceSessionToken;
  if (key === FINANCE_AUTHED_AT_KEY) return inMemoryFinanceAuthedAt ? String(inMemoryFinanceAuthedAt) : null;
  try { return sessionStorage.getItem(key); } catch { return null; }
};
const persistStoredValue = (key: string, value: string) => {
  if (key === FINANCE_SESSION_KEY) { inMemoryFinanceSessionToken = value; return; }
  if (key === FINANCE_AUTHED_AT_KEY) { inMemoryFinanceAuthedAt = Number(value) || Date.now(); return; }
  try { sessionStorage.setItem(key, value); } catch {}
};
const clearStoredValue = (key: string) => {
  if (key === FINANCE_SESSION_KEY) { inMemoryFinanceSessionToken = null; return; }
  if (key === FINANCE_AUTHED_AT_KEY) { inMemoryFinanceAuthedAt = 0; return; }
  try { sessionStorage.removeItem(key); } catch {}
  try { localStorage.removeItem(key); } catch {}
};
// Best-effort scrub of legacy persistent mirrors from pre-WP-11B builds.
try { localStorage.removeItem(FINANCE_SESSION_KEY); sessionStorage.removeItem(FINANCE_SESSION_KEY); } catch {}
try { localStorage.removeItem(FINANCE_AUTHED_AT_KEY); sessionStorage.removeItem(FINANCE_AUTHED_AT_KEY); } catch {}

const markAuthed = () => persistStoredValue(FINANCE_AUTHED_AT_KEY, String(Date.now()));
const recentlyAuthed = (): boolean => {
  const ts = Number(getStoredValue(FINANCE_AUTHED_AT_KEY) || 0);
  return ts > 0 && Date.now() - ts < AUTH_GRACE_MS;
};

async function invokeFinanceFunction(
  functionName: string,
  body?: Record<string, any>
): Promise<{ data: any; error: any }> {
  try {
    const sessionToken = getStoredValue(FINANCE_SESSION_KEY);
    const requestBody = {
      ...(body || {}),
      ...(sessionToken ? { finance_session_token: sessionToken, session_token: sessionToken } : {}),
    };

    const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        ...(sessionToken ? { 'x-finance-session-token': sessionToken } : {}),
      },
      credentials: 'include',
      body: JSON.stringify(requestBody),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errorMessage = typeof data?.error === 'object' && data.error?.message
        ? data.error.message
        : data?.error || data?.message || data?.details || `HTTP ${response.status}`;
      const msgStr = String(errorMessage);
      const isAuthLikeFn = functionName === 'finance-portal-login'
        || functionName === 'finance-portal-verify'
        || functionName === 'finance-portal-forgot-password'
        || functionName === 'finance-portal-reset-password';
      if (
        response.status === 401 &&
        !isAuthLikeFn &&
        sessionToken &&
        !recentlyAuthed() &&
        /invalid session|session expired|invalid or expired session/i.test(msgStr)
      ) {
        try {
          const verifyResp = await fetch(`${SUPABASE_URL}/functions/v1/finance-portal-verify`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
              'x-finance-session-token': sessionToken,
            },
            credentials: 'include',
            body: JSON.stringify({ finance_session_token: sessionToken, session_token: sessionToken }),
          });
          const verifyData = await verifyResp.json().catch(() => ({}));
          if (verifyResp.ok && verifyData?.valid) {
            markAuthed();
          } else {
            try { clearStoredValue(FINANCE_SESSION_KEY); } catch {}
            try {
              if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/finance/login')) {
                const ret = encodeURIComponent(window.location.pathname + window.location.search);
                window.location.replace(`/finance/login?reason=expired&return=${ret}`);
              }
            } catch {}
          }
        } catch {
          // Network blip — don't redirect; let the user keep working.
        }
      }

      return { data, error: { message: msgStr, status: response.status } };
    }
    return { data, error: null };
  } catch (error: any) {
    return { data: null, error: { message: error.message || 'Network error' } };
  }
}


export function FinancePortalAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<FinancePortalUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void checkSession();
  }, []);

  const clearAuthState = () => {
    clearStoredValue(FINANCE_SESSION_KEY);
    clearStoredValue(FINANCE_AUTHED_AT_KEY);
    setUser(null);
  };

  const checkSession = async () => {
    try {
      // WP-11B/C — cookie is authoritative; ask the server unconditionally.
      const { data, error } = await invokeFinanceFunction('finance-portal-verify');
      if (error || !data?.valid) {
        clearAuthState();
      } else {
        setUser(data.user);
        markAuthed();
        if (data.session_token) {
          persistStoredValue(FINANCE_SESSION_KEY, data.session_token);
        }
      }
    } catch {
      clearAuthState();
    } finally {
      setLoading(false);
    }
  };


  const refreshUser = useCallback(async () => {
    const sessionToken = getStoredValue(FINANCE_SESSION_KEY);
    if (!sessionToken) return;
    const { data, error } = await invokeFinanceFunction('finance-portal-verify');
    if (!error && data?.valid) setUser(data.user);
  }, []);

  const signIn = useCallback(async (email: string, password: string, turnstileToken?: string) => {
    try {
      const { data, error } = await invokeFinanceFunction('finance-portal-login', {
        email,
        password,
        turnstile_token: turnstileToken,
      });
      if (error || !data?.success) {
        return { error: data?.error || error?.message || 'Login failed' };
      }
      if (data.session_token) {
        persistStoredValue(FINANCE_SESSION_KEY, data.session_token);
      }
      markAuthed();
      setUser(data.user);
      return { mustChangePassword: !!data.user?.must_change_password || !!data.must_change_password };
    } catch {
      return { error: 'Login failed' };
    }
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const { data, error } = await invokeFinanceFunction('finance-portal-change-password', {
      current_password: currentPassword,
      new_password: newPassword,
    });
    if (error || !data?.success) {
      return { error: data?.error || error?.message || 'Failed to change password' };
    }
    if (data.session_token) {
      persistStoredValue(FINANCE_SESSION_KEY, data.session_token);
    }
    // Update local user to clear must_change_password
    setUser(prev => prev ? { ...prev, must_change_password: false } : prev);
    return { success: true };
  }, []);

  const signOut = useCallback(async () => {
    try { await invokeFinanceFunction('finance-portal-logout'); } catch {}
    clearAuthState();
  }, []);

  // The four acknowledgments are contractual statements, not a checkbox: the
  // server refuses an acceptance that is missing any of them and stores the
  // ones asserted as the acknowledgment history.
  const acceptTerms = useCallback(async (acknowledgements: PortalAcknowledgementKey[]) => {
    try {
      const { data, error } = await invokeFinanceFunction('finance-portal-verify', {
        action: 'accept_terms',
        acknowledgements,
      });
      if (error || !data?.success) {
        const msg = data?.error || error?.message || 'Failed to accept terms';
        console.error('Failed to accept finance portal terms:', msg);
        throw new Error(msg);
      }
      setUser(prev => prev ? { ...prev, has_accepted_terms: true, has_accepted_current_terms: true } : prev);
    } catch (e) {
      console.error('Failed to accept terms:', e);
      throw e;
    }
  }, []);

  const completeOnboarding = useCallback(async () => {
    try {
      const { data, error } = await invokeFinanceFunction('finance-portal-verify', { action: 'complete_onboarding' });
      if (error || !data?.success) {
        const msg = data?.error || error?.message || 'Failed to complete onboarding';
        console.error('Failed to complete finance portal onboarding:', msg);
        throw new Error(msg);
      }
      setUser(prev => prev ? { ...prev, has_completed_onboarding: true } : prev);
    } catch (e) {
      console.error('Failed to complete onboarding:', e);
      throw e;
    }
  }, []);

  const setSessionFromInvite = useCallback((sessionToken: string, nextUser: FinancePortalUser) => {
    persistStoredValue(FINANCE_SESSION_KEY, sessionToken);
    markAuthed();
    setUser(nextUser);
    setLoading(false);
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    const { data, error } = await invokeFinanceFunction('finance-portal-forgot-password', { email });
    if (error) return { error: error.message };
    return { success: true };
  }, []);

  const verifyOTP = useCallback(async (email: string, otp: string) => {
    const { data, error } = await invokeFinanceFunction('finance-portal-reset-password', {
      action: 'verify_otp', email, otp,
    });
    if (error || !data?.success) return { error: data?.error || error?.message || 'Invalid code' };
    return { success: true };
  }, []);

  const resetPassword = useCallback(async (email: string, otp: string, newPassword: string) => {
    const { data, error } = await invokeFinanceFunction('finance-portal-reset-password', {
      action: 'reset_password', email, otp, new_password: newPassword,
    });
    if (error || !data?.success) return { error: data?.error || error?.message || 'Failed to reset password' };
    return { success: true };
  }, []);

  const getSessionToken = useCallback(() => getStoredValue(FINANCE_SESSION_KEY), []);

  return (
    <FinancePortalAuthContext.Provider
      value={{
        user, loading, signIn, signOut,
        requestPasswordReset, verifyOTP, resetPassword, changePassword,
        acceptTerms, completeOnboarding, setSessionFromInvite,
        invokeFinanceFunction, getSessionToken, refreshUser,
      }}
    >
      {children}
    </FinancePortalAuthContext.Provider>
  );
}

export function useFinancePortalAuth() {
  const context = useContext(FinancePortalAuthContext);
  if (context === undefined) {
    throw new Error('useFinancePortalAuth must be used within a FinancePortalAuthProvider');
  }
  return context;
}
