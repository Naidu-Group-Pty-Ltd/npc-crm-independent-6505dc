/**
 * Keep an open case current without anybody pressing refresh.
 *
 * The workspace fetched once, on mount. A document the client uploaded, a
 * screening result landing, a stage completing — none of it reached a tab
 * that was already open. This drives the existing refetches on a cadence
 * that follows what the case is actually doing (`livePolling.pure.ts`), and
 * refetches immediately when the tab comes back into view.
 *
 * It owns no data and fetches nothing itself: it calls the refresh functions
 * the page already has, so there is one code path for a manual refresh and
 * an automatic one, and nothing can drift between them.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  decideLivePoll, livePollActivity, type LivePollActivity,
} from "./livePolling.pure";

export interface LiveCaseRefreshState {
  /** When the last successful refresh completed. */
  lastRefreshedAt: Date | null;
  refreshing: boolean;
  /** Refresh now. Safe to call while one is running — it is ignored. */
  refreshNow: () => void;
}

export function useLiveCaseRefresh(
  refresh: () => void | Promise<void>,
  facts: {
    enabled: boolean;
    screeningInFlight: boolean;
    awaitingClient: boolean;
    outstandingWork: boolean;
  },
): LiveCaseRefreshState {
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // The callback identity changes on most renders; a ref keeps the timer
  // from being torn down and rebuilt on each one.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const busyRef = useRef(false);

  const run = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setRefreshing(true);
    try {
      await refreshRef.current();
      setLastRefreshedAt(new Date());
    } catch {
      // A failed refresh leaves the previous picture in place. It is stale,
      // which is what `lastRefreshedAt` is on screen to say — it is never
      // replaced with an empty or reassuring one.
    } finally {
      busyRef.current = false;
      setRefreshing(false);
    }
  }, []);

  const activity: LivePollActivity = livePollActivity(facts);

  /* Refetch the moment the tab is looked at again. */
  useEffect(() => {
    if (!facts.enabled) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [facts.enabled, run]);

  /* And poll while it is being looked at. */
  useEffect(() => {
    if (!facts.enabled) return;
    const visible = typeof document === "undefined"
      ? true : document.visibilityState === "visible";
    const { intervalMs } = decideLivePoll({ visible, activity, busy: false });
    if (intervalMs === null) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void run();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [facts.enabled, activity, run]);

  return { lastRefreshedAt, refreshing, refreshNow: () => void run() };
}
