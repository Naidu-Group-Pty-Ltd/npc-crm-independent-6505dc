import { useCallback, useMemo } from "react";
import { isKnownPlanSlug, toCapabilityKey } from "@/lib/entitlements";
import { useWorkspaceEntitlements } from "./useWorkspaceEntitlements";

/**
 * What this workspace's PLAN entitles it to.
 *
 * Distinct from `usePermissions`, which answers what the signed-in USER is
 * allowed to do. A feature needs both: the workspace has to have bought it,
 * and the user has to be permitted to use it.
 *
 * Backed by the shared WorkspaceEntitlementsProvider — one Mission Control
 * fetch per session with a last-known-good cache — and by the canonical
 * capability resolver. The legacy keys this hook accepts (module permission
 * keys, pricing slugs, sub-module keys) are translated to capability keys at
 * the boundary; a key the registry does not describe is not commercially
 * gated and stays enabled.
 *
 * Failure posture: while loading, gates stay open so the UI does not flash
 * a denial at startup; once Mission Control has answered (or a last-known-
 * good snapshot is in play) the answer is exact. If no snapshot has EVER
 * been obtained, premium capabilities are withheld — see resolver.ts.
 */
export function usePlanEntitlements() {
  const { snapshot, snapshotState, isLoading, resolveWorkspaceCapability } =
    useWorkspaceEntitlements();

  const isEnabled = useCallback(
    (legacyKey: string) => {
      const key = toCapabilityKey(legacyKey);
      if (!key) return true; // not a gated capability
      const decision = resolveWorkspaceCapability(key);
      return decision.enabled || decision.status === "loading";
    },
    [resolveWorkspaceCapability],
  );

  return useMemo(
    () => ({
      planSlug: snapshot?.planSlug ?? null,
      /** True once we know the plan is one the entitlement matrix describes. */
      planKnown: isKnownPlanSlug(snapshot?.planSlug ?? null),
      /** Canonical add-on slugs this workspace holds; undefined until known. */
      addonSlugs: snapshot ? snapshot.addonSlugs : undefined,
      isSubModuleEnabled: isEnabled,
      isModuleIncluded: isEnabled,
      snapshotState,
      loading: isLoading,
    }),
    [snapshot, snapshotState, isLoading, isEnabled],
  );
}
