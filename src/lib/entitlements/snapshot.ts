// Snapshot normalisation and the last-known-good cache.
//
// Mission Control's balance response is the transport; this module turns it
// into a canonical WorkspaceEntitlementSnapshot exactly once, at the
// boundary. It also keeps the last good snapshot in localStorage so a
// Mission Control outage neither exposes premium modules (the old fail-open
// behaviour) nor locks a paying customer out of what they bought.

import type { TokenBalance } from "@/lib/missionControl";
import type { SubscriptionStatus, WorkspaceEntitlementSnapshot } from "./types";
import { canonicaliseAddonSlugs, canonicalisePlanSlug, isKnownPlanSlug } from "./aliases";
import { logEntitlementEvent } from "./log";

/**
 * Mirrors `TIER_INCLUDES_AML` in Mission Control's catalogue: every tier's
 * headline SKU — the one Stripe actually charges — includes the AML/CTF
 * module. Until Mission Control reports per-tenant without-AML SKUs, a
 * workspace on a known tier is therefore assumed AML-entitled, and the
 * assumption is recorded on the snapshot (`amlAssumed`) so diagnostics can
 * show it and a future SKU rollout can be verified. A SKU that arrives as
 * `*-without-aml` disables the assumption; an explicit `aml-ctf` add-on
 * makes it moot.
 */
const HEADLINE_SKU_INCLUDES_AML = true;

const CACHE_KEY_PREFIX = "aurixa.entitlements.lkg.v1";
/** A cached snapshot older than this is discarded rather than trusted. */
export const LKG_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function subscriptionStatusFrom(balance: TokenBalance): SubscriptionStatus {
  // Mission Control's tenant status arrives indirectly; the balance response
  // does not carry it as a first-class field yet, so infer conservatively.
  if (balance.unprovisioned) return "unknown";
  if (balance.currentPeriodEnd) {
    const end = Date.parse(balance.currentPeriodEnd);
    if (Number.isFinite(end) && end < Date.now() - 24 * 60 * 60 * 1000) return "expired";
  }
  return "active";
}

/** Normalise a Mission Control balance response into a snapshot. */
export function snapshotFromBalance(
  balance: TokenBalance,
  workspaceId: string,
): WorkspaceEntitlementSnapshot {
  const plan = canonicalisePlanSlug(balance.planSlug);
  const addons = canonicaliseAddonSlugs([
    ...(balance.addonSlugs ?? []),
    ...plan.impliedAddons,
  ]);

  let amlAssumed = false;
  if (
    HEADLINE_SKU_INCLUDES_AML &&
    !plan.amlExcluded &&
    !addons.includes("aml-ctf") &&
    isKnownPlanSlug(plan.planSlug)
  ) {
    addons.push("aml-ctf");
    addons.sort();
    amlAssumed = true;
  }

  if (balance.planSlug && !isKnownPlanSlug(plan.planSlug)) {
    logEntitlementEvent("unknown_plan_slug", { planSlug: balance.planSlug });
  }

  return {
    workspaceId,
    planSlug: plan.planSlug,
    subscriptionStatus: subscriptionStatusFrom(balance),
    addonSlugs: addons,
    trialSlugs: [],
    overrideSlugs: [],
    // `exempt` covers billing-exempt tenants and unprovisioned dev clones —
    // both explicit Mission Control answers, recorded as an override source.
    billingExempt: balance.exempt === true,
    expiresAt: balance.currentPeriodEnd ?? undefined,
    rawPlanSlug: balance.planSlug ?? null,
    rawAddonSlugs: balance.addonSlugs ? [...balance.addonSlugs] : undefined,
    amlAssumed,
    fetchedAt: new Date().toISOString(),
    source: balance.source === "cache" ? "cache" : "mission_control",
    version: balance.updatedAt ?? undefined,
  };
}

function cacheKey(workspaceId: string): string {
  return `${CACHE_KEY_PREFIX}:${workspaceId}`;
}

export function saveLastKnownGood(snapshot: WorkspaceEntitlementSnapshot): void {
  try {
    window.localStorage.setItem(cacheKey(snapshot.workspaceId), JSON.stringify(snapshot));
  } catch {
    // Storage full or unavailable — the cache is an optimisation, not a need.
  }
}

export function loadLastKnownGood(workspaceId: string): WorkspaceEntitlementSnapshot | null {
  try {
    const raw = window.localStorage.getItem(cacheKey(workspaceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorkspaceEntitlementSnapshot;
    if (!parsed || parsed.workspaceId !== workspaceId || !parsed.fetchedAt) return null;
    const age = Date.now() - Date.parse(parsed.fetchedAt);
    if (!Number.isFinite(age) || age > LKG_MAX_AGE_MS) return null;
    return { ...parsed, source: "cache" };
  } catch {
    return null;
  }
}

export function clearLastKnownGood(workspaceId: string): void {
  try {
    window.localStorage.removeItem(cacheKey(workspaceId));
  } catch {
    // Ignore.
  }
}
