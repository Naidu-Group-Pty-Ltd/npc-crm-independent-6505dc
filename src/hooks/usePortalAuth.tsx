import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import {
  clearPortalSessionToken,
  portalSessionBodyFields,
  portalSessionHeaders,
  setPortalSessionToken,
} from '@/lib/portalSession';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/integrations/supabase/env';

interface PortalUser {
  id: string;
  client_id: string;
  email: string;
  name: string;
  has_completed_onboarding: boolean;
  has_accepted_terms: boolean;
}

interface PortalAuthContextType {
  user: PortalUser | null;
  loading: boolean;
  signIn: (email: string, password: string, turnstileToken?: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<{ error?: string; success?: boolean }>;
  verifyOTP: (email: string, otp: string) => Promise<{ error?: string; success?: boolean }>;
  resetPassword: (email: string, otp: string, newPassword: string) => Promise<{ error?: string; success?: boolean }>;
  completeOnboarding: () => Promise<void>;
  acceptTerms: () => Promise<void>;
}

const PortalAuthContext = createContext<PortalAuthContextType | undefined>(undefined);


async function invokePortalFunction(
  functionName: string,
  body?: Record<string, any>
): Promise<{ data: any; error: any }> {
  try {
    const requestBody = {
      ...body,
      ...portalSessionBodyFields(),
    };

    const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        ...portalSessionHeaders(),
      },
      // WP-11B/C: the HttpOnly `__Host-client_session_token` cookie is the
      // authoritative carrier, so it has to be attached. This was 'omit', which
      // stripped it and forced the token to travel in a body field the browser
      // had to keep readable — see src/lib/portalSession.ts.
      credentials: 'include',
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();
    if (!response.ok) {
      return { data, error: { message: data.error || `HTTP ${response.status}` } };
    }
    return { data, error: null };
  } catch (error: any) {
    return { data: null, error: { message: error.message || 'Network error' } };
  }
}

export function PortalAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PortalUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkSession();
  }, []);

  const checkSession = async () => {
    try {
      // The cookie is authoritative, so ask the server unconditionally. Bailing
      // out when no token is held would sign the user out on every reload now
      // that nothing is persisted to browser storage.
      const { data, error } = await invokePortalFunction('client-portal-verify');
      if (error || !data?.valid) {
        clearAuthState();
      } else {
        setUser(data.user);
        if (data.session_token) {
          setPortalSessionToken(data.session_token);
        }
      }
    } catch {
      clearAuthState();
    } finally {
      setLoading(false);
    }
  };

  const clearAuthState = () => {
    clearPortalSessionToken();
    setUser(null);
  };

  const signIn = useCallback(async (email: string, password: string, turnstileToken?: string) => {
    try {
      const { data, error } = await invokePortalFunction('client-portal-login', {
        email,
        password,
        turnstile_token: turnstileToken,
      });

      if (error || !data?.success) {
        return { error: data?.error || 'Login failed' };
      }

      if (data.session_token) {
        setPortalSessionToken(data.session_token);
      }

      setUser(data.user);
      return {};
    } catch {
      return { error: 'Login failed' };
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await invokePortalFunction('client-portal-logout');
    } catch {}
    clearAuthState();
  }, []);

  const completeOnboarding = useCallback(async () => {
    try {
      await invokePortalFunction('client-portal-verify', { action: 'complete_onboarding' });
      setUser(prev => prev ? { ...prev, has_completed_onboarding: true } : prev);
    } catch (e) {
      console.error('Failed to complete onboarding:', e);
    }
  }, []);

  const acceptTerms = useCallback(async () => {
    try {
      await invokePortalFunction('client-portal-verify', { action: 'accept_terms' });
      setUser(prev => prev ? { ...prev, has_accepted_terms: true } : prev);
    } catch (e) {
      console.error('Failed to accept terms:', e);
      throw e;
    }
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    const { data, error } = await invokePortalFunction('client-portal-forgot-password', { email });
    if (error) return { error: error.message };
    return { success: true };
  }, []);

  const verifyOTP = useCallback(async (email: string, otp: string) => {
    const { data, error } = await invokePortalFunction('client-portal-reset-password', {
      action: 'verify_otp', email, otp,
    });
    if (error || !data?.success) return { error: data?.error || error?.message || 'Invalid code' };
    return { success: true };
  }, []);

  const resetPassword = useCallback(async (email: string, otp: string, newPassword: string) => {
    const { data, error } = await invokePortalFunction('client-portal-reset-password', {
      action: 'reset_password', email, otp, new_password: newPassword,
    });
    if (error || !data?.success) return { error: data?.error || error?.message || 'Failed to reset password' };
    return { success: true };
  }, []);

  return (
    <PortalAuthContext.Provider value={{ user, loading, signIn, signOut, requestPasswordReset, verifyOTP, resetPassword, completeOnboarding, acceptTerms }}>
      {children}
    </PortalAuthContext.Provider>
  );
}

export function usePortalAuth() {
  const context = useContext(PortalAuthContext);
  if (context === undefined) {
    throw new Error('usePortalAuth must be used within a PortalAuthProvider');
  }
  return context;
}
