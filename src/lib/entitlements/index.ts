// Public surface of the entitlement system. Everything the rest of the app
// needs is re-exported here; nothing else in src/lib/entitlements is API.

export type {
  CapabilityDecision,
  CapabilityDefinition,
  CapabilityKey,
  CapabilityStatus,
  EntitlementSource,
  PlanSlug,
  SnapshotState,
  SubscriptionStatus,
  WorkspaceEntitlementSnapshot,
} from "./types";
export { PLAN_ORDER } from "./types";
export {
  canonicaliseAddonSlug,
  canonicaliseAddonSlugs,
  canonicalisePlanSlug,
  isKnownPlanSlug,
  toCapabilityKey,
  LEGACY_KEY_TO_CAPABILITY,
} from "./aliases";
export {
  CAPABILITY_DEFINITIONS,
  allCapabilityKeys,
  cheapestIncludingPlan,
  getCapabilityDefinition,
} from "./registry";
export { resolveCapability, workspaceHasCapability, type ResolveContext } from "./resolver";
export {
  snapshotFromBalance,
  saveLastKnownGood,
  loadLastKnownGood,
  clearLastKnownGood,
  LKG_MAX_AGE_MS,
} from "./snapshot";
export { logEntitlementEvent } from "./log";
