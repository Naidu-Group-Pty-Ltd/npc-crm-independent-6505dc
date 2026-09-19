import { useEffect, useState, useCallback, useRef } from "react";
import { fetchTokenBalance, type TokenBalance } from "@/lib/missionControl";
import { onTokensUsed, onOutOfTokens } from "@/lib/tokenEvents";
import { isAuthExhausted } from "@/lib/secureInvoke";
import { useAuth } from "@/hooks/useAuth";

// Absolute low-balance thresholds (billing credits) used when the tenant has
// no plan allowance to compute a percentage against — e.g. the prime install
// (no plan) or top-up-only tenants. A full Investor Compass run costs ~18
// credits, so "low" ≈ two reports left and "critical" ≈ less than one.
const LOW_TOKENS_ABS = 40;
const CRITICAL_TOKENS_ABS = 15;

interface UseTokenBalanceOptions {
  /** Auto-refetch interval in ms. 0 = no polling. Default 3 minutes. */
  pollMs?: number;
  /** Skip the initial fetch (e.g. while auth resolves). */
  enabled?: boolean;
  /** Also refetch when the tab regains focus / becomes visible. Default true. */
  refetchOnFocus?: boolean;
  /** Also refetch when a token event fires (tokens-used / out-of-tokens). Default true. */
  refetchOnTokenEvent?: boolean;
}

export function useTokenBalance(opts: UseTokenBalanceOptions = {}) {
  const {
    pollMs = 180_000,
    enabled = true,
    refetchOnFocus = true,
    refetchOnTokenEvent = true,
  } = opts;
  const { user } = useAuth();
  const [balance, setBalance] = useState<TokenBalance | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const lastFetchRef = useRef(0);

  const refresh = useCallback(async () => {
    // The staff session lives in an HttpOnly cookie that JS cannot read, so a
    // missing tab-scoped access token does NOT mean "signed out" — the fetch
    // below still authenticates via the cookie (and the native supabase-js
    // session fallback). Gating on hasActiveSession() here made the pill show
    // a permanent zero balance for cookie-only sessions. Only skip once the
    // global auth circuit breaker has tripped (genuinely signed out).
    // No resolved staff session means `mission-control-balance` can only 401.
    if (isAuthExhausted() || !user) {
      setBalance(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    lastFetchRef.current = Date.now();
    try {
      const b = await fetchTokenBalance();
      setBalance(b);
      setError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Treat auth failures as "no balance yet" instead of a hard error to prevent UI crashes.
      if (/401|unauthor|session/i.test(msg)) {
        setBalance(null);
        setError(null);
      } else {
        setError(e instanceof Error ? e : new Error(msg));
      }
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  // Initial + polling
  useEffect(() => {
    if (!enabled || !user) return;
    refresh();
    if (pollMs > 0) {
      const id = setInterval(refresh, pollMs);
      return () => clearInterval(id);
    }
  }, [enabled, pollMs, refresh]);

  // Refetch on tab focus / visibility (throttled to once / 30s)
  useEffect(() => {
    if (!enabled || !refetchOnFocus) return;
    const maybeRefresh = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastFetchRef.current < 30_000) return;
      refresh();
    };
    window.addEventListener("focus", maybeRefresh);
    document.addEventListener("visibilitychange", maybeRefresh);
    return () => {
      window.removeEventListener("focus", maybeRefresh);
      document.removeEventListener("visibilitychange", maybeRefresh);
    };
  }, [enabled, refetchOnFocus, refresh]);

  // Refetch immediately when a generator emits a token event so the pill reflects spend in real-time.
  useEffect(() => {
    if (!enabled || !refetchOnTokenEvent) return;
    const offUsed = onTokensUsed(() => {
      // small debounce so we don't hammer when multiple chunks land at once
      setTimeout(() => refresh(), 750);
    });
    const offOut = onOutOfTokens(() => refresh());
    return () => {
      offUsed();
      offOut();
    };
  }, [enabled, refetchOnTokenEvent, refresh]);

  // Low/critical fire on the allowance percentage when a plan allowance
  // exists, and on absolute credit thresholds otherwise. The old
  // `allowance > 0 &&` guard meant tenants without a plan (allowance 0) never
  // saw ANY low/critical warning, even at a zero balance. Billing-exempt
  // tenants are never funds-gated, so warnings stay suppressed for them.
  const criticalBalance =
    balance != null && !balance.exempt &&
    (balance.allowance > 0
      ? balance.available / balance.allowance < 0.05
      : balance.available <= CRITICAL_TOKENS_ABS);
  const lowBalance =
    balance != null && !balance.exempt && !criticalBalance &&
    (balance.allowance > 0
      ? balance.available / balance.allowance < 0.1
      : balance.available <= LOW_TOKENS_ABS);

  return { balance, loading, error, refresh, lowBalance, criticalBalance };
}
