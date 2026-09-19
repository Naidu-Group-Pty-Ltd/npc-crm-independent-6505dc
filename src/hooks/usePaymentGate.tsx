import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { fetchGateVerdict } from "@/lib/paymentGate/client";
import {
  openVerdict,
  shouldBlock,
  shouldWarn,
  type GateVerdict,
} from "@/lib/paymentGate/state";

/**
 * This workspace's activation gate.
 *
 * ## The initial value is OPEN
 *
 * Not "unknown, please wait". A gate that renders a lock screen while it is
 * still asking would flash a payment wall in front of every user on every cold
 * load, including the ones on the prime who can never be gated at all. The app
 * renders normally until Mission Control has actually said otherwise, and the
 * screen appears on the answer rather than on the absence of one.
 *
 * ## It polls, because the gate moves without the user
 *
 * A window closes on a clock and a payment opens it from a Stripe webhook —
 * neither of which the browser is party to. Five minutes is frequent enough
 * that somebody who has just paid is not left staring at a lock screen, and
 * rare enough to be invisible. A verdict that is COUNTING DOWN is re-read on
 * its own deadline as well, so the moment it locks is the moment it says so.
 */
type GateContextValue = {
  verdict: GateVerdict;
  /** True only when Mission Control has said this workspace is locked. */
  blocked: boolean;
  /** True while the window is open, unpaid, and running out. */
  warning: boolean;
  /** False until the first answer arrives. Never used to block. */
  resolved: boolean;
  refresh: () => Promise<void>;
};

const GateContext = createContext<GateContextValue | null>(null);

const POLL_MS = 5 * 60 * 1000;
/** A verdict that is counting down is re-read a little after its deadline, so
 *  the lock appears on time rather than up to five minutes late. */
const DEADLINE_SLACK_MS = 5_000;

export function PaymentGateProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [verdict, setVerdict] = useState<GateVerdict>(() => openVerdict());
  const [resolved, setResolved] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await fetchGateVerdict();
      setVerdict(next);
      setResolved(true);
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    // Signed out, there is nothing to gate: the login page has to keep
    // working, or a locked workspace could not reach support or its own
    // billing.
    if (!user) {
      setVerdict(openVerdict());
      setResolved(false);
      return;
    }
    void refresh();
  }, [user, refresh]);

  // Poll, and additionally wake on the deadline itself.
  useEffect(() => {
    if (!user) return;
    const schedule = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      let delay = POLL_MS;
      if (verdict.gated && verdict.locksAt && !verdict.locked) {
        const untilDeadline =
          Date.parse(verdict.locksAt) - Date.now() + DEADLINE_SLACK_MS;
        if (Number.isFinite(untilDeadline) && untilDeadline > 0) {
          delay = Math.min(delay, untilDeadline);
        }
      }
      timerRef.current = setTimeout(() => void refresh(), delay);
    };
    schedule();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [user, verdict, refresh]);

  // A tab left open overnight comes back to a stale verdict. Re-reading on
  // focus is what makes "I paid on my phone, then switched back" work.
  useEffect(() => {
    if (!user) return;
    const onFocus = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [user, refresh]);

  const value = useMemo<GateContextValue>(
    () => ({
      verdict,
      blocked: shouldBlock(verdict),
      warning: shouldWarn(verdict),
      resolved,
      refresh,
    }),
    [verdict, resolved, refresh],
  );

  return <GateContext.Provider value={value}>{children}</GateContext.Provider>;
}

/**
 * Read the gate. Safe outside the provider — it answers "open" rather than
 * throwing, so a surface mounted before the provider (or in a test) renders
 * normally instead of blowing up or, worse, locking.
 */
export function usePaymentGate(): GateContextValue {
  const ctx = useContext(GateContext);
  if (ctx) return ctx;
  const fallback = openVerdict();
  return {
    verdict: fallback,
    blocked: false,
    warning: false,
    resolved: false,
    refresh: async () => {},
  };
}
