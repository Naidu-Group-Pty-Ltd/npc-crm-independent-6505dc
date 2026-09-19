// The workspace entitlement provider — ONE Mission Control fetch per
// session, shared by every gate in the app.
//
// Before this existed, `usePlanEntitlements` fetched the balance once per
// hook instance with no refresh, so a plan change was invisible until a full
// reload and thirty pages each paid for their own request. The provider
// loads once, deduplicates concurrent requests, refreshes on the lifecycle
// events that can change entitlement (focus return, token events, billing
// return, manual refresh), and keeps a last-known-good snapshot so a Mission
// Control outage neither exposes premium modules nor strips paid ones.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { fetchTokenBalance } from "@/lib/missionControl";
import { useAuth } from "@/hooks/useAuth";
import {
  loadLastKnownGood,
  logEntitlementEvent,
  resolveCapability,
  saveLastKnownGood,
  snapshotFromBalance,
  type CapabilityDecision,
  type CapabilityKey,
  type SnapshotState,
  type WorkspaceEntitlementSnapshot,
} from "@/lib/entitlements";

/** Single-tenant install: the workspace is the deployment. Mirrors the
 * billing uid used for storefront attribution. */
const WORKSPACE_ID =
  ((import.meta.env.VITE_AURIXA_BILLING_UID as string | undefined) ?? "npc-prime").trim() ||
  "npc-prime";

/** Re-fetch cadence while the app is open. Entitlements move at billing
 * speed; anything volatile arrives sooner via the refresh events below. */
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const FOCUS_THROTTLE_MS = 30 * 1000;

interface WorkspaceEntitlementsValue {
  workspaceId: string;
  snapshot: WorkspaceEntitlementSnapshot | null;
  snapshotState: SnapshotState;
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  refreshEntitlements: () => Promise<void>;
  /** Pure workspace-level decision (no user-permission axis). */
  resolveWorkspaceCapability: (key: CapabilityKey) => CapabilityDecision;
  /** Convenience boolean over resolveWorkspaceCapability. */
  hasCapability: (key: CapabilityKey) => boolean;
}

const WorkspaceEntitlementsContext = createContext<WorkspaceEntitlementsValue | null>(null);

export function WorkspaceEntitlementsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [snapshot, setSnapshot] = useState<WorkspaceEntitlementSnapshot | null>(() =>
    loadLastKnownGood(WORKSPACE_ID),
  );
  const [snapshotState, setSnapshotState] = useState<SnapshotState>(() =>
    snapshot ? "stale" : "loading",
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const lastFetchAt = useRef(0);

  const refresh = useCallback(async () => {
    // Deduplicate: concurrent callers await the same request.
    if (inFlight.current) return inFlight.current;
    const run = (async () => {
      setIsRefreshing(true);
      try {
        const balance = await fetchTokenBalance();
        const next = snapshotFromBalance(balance, WORKSPACE_ID);
        setSnapshot(next);
        setSnapshotState("ready");
        setError(null);
        saveLastKnownGood(next);
        lastFetchAt.current = Date.now();
        logEntitlementEvent("snapshot_fetched", {
          planSlug: next.planSlug,
          addonCount: next.addonSlugs.length,
          source: next.source,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "entitlement fetch failed";
        setError(message);
        logEntitlementEvent("snapshot_fetch_failed", { message });
        setSnapshot((current) => {
          const fallback = current ?? loadLastKnownGood(WORKSPACE_ID);
          if (fallback) {
            setSnapshotState("stale");
            logEntitlementEvent("stale_snapshot_used", {
              fetchedAt: fallback.fetchedAt,
              planSlug: fallback.planSlug,
            });
          } else {
            setSnapshotState("unavailable");
            logEntitlementEvent("no_snapshot_available", {});
          }
          return fallback;
        });
      } finally {
        setIsRefreshing(false);
        inFlight.current = null;
      }
    })();
    inFlight.current = run;
    return run;
  }, []);

  // Initial load + interval refresh — only once a staff session is resolved.
  // Signed out (e.g. sitting on /auth) `mission-control-balance` answers 401,
  // which surfaced as a runtime error on a page that has no entitlements to
  // fetch in the first place.
  useEffect(() => {
    if (!user) return;
    void refresh();
    const interval = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [refresh, user?.id]);

  // Refresh when the user returns to the tab (e.g. back from the storefront
  // checkout, or after an administrator changed the subscription), throttled.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastFetchAt.current < FOCUS_THROTTLE_MS) return;
      void refresh();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  // Token lifecycle events already dispatched by the billing surfaces.
  useEffect(() => {
    const onTokenEvent = () => void refresh();
    window.addEventListener("tokens-used", onTokenEvent);
    window.addEventListener("out-of-tokens", onTokenEvent);
    return () => {
      window.removeEventListener("tokens-used", onTokenEvent);
      window.removeEventListener("out-of-tokens", onTokenEvent);
    };
  }, [refresh]);

  const resolveWorkspaceCapability = useCallback(
    (key: CapabilityKey) => resolveCapability(key, { snapshot, snapshotState }),
    [snapshot, snapshotState],
  );

  const hasCapability = useCallback(
    (key: CapabilityKey) => resolveWorkspaceCapability(key).enabled,
    [resolveWorkspaceCapability],
  );

  const value = useMemo<WorkspaceEntitlementsValue>(
    () => ({
      workspaceId: WORKSPACE_ID,
      snapshot,
      snapshotState,
      isLoading: snapshotState === "loading",
      isRefreshing,
      error,
      refreshEntitlements: refresh,
      resolveWorkspaceCapability,
      hasCapability,
    }),
    [snapshot, snapshotState, isRefreshing, error, refresh, resolveWorkspaceCapability, hasCapability],
  );

  return (
    <WorkspaceEntitlementsContext.Provider value={value}>
      {children}
    </WorkspaceEntitlementsContext.Provider>
  );
}

export function useWorkspaceEntitlements(): WorkspaceEntitlementsValue {
  const ctx = useContext(WorkspaceEntitlementsContext);
  if (!ctx) {
    throw new Error("useWorkspaceEntitlements must be used within WorkspaceEntitlementsProvider");
  }
  return ctx;
}
