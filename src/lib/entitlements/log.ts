// Structured logging for material entitlement events.
//
// One narrow funnel so the events are greppable ("[entitlements]") and so no
// call site is tempted to log snapshot contents wholesale — slugs and states
// only, never client data or credentials.

export type EntitlementEventName =
  | "snapshot_fetched"
  | "snapshot_fetch_failed"
  | "stale_snapshot_used"
  | "no_snapshot_available"
  | "unknown_plan_slug"
  | "unknown_addon_slug"
  | "capability_denied"
  | "entitlements_refreshed";

export function logEntitlementEvent(
  event: EntitlementEventName,
  detail?: Record<string, unknown>,
): void {
  const payload = { event, ...detail };
  if (
    event === "snapshot_fetch_failed" ||
    event === "no_snapshot_available" ||
    event === "unknown_plan_slug" ||
    event === "unknown_addon_slug"
  ) {
    console.warn("[entitlements]", payload);
  } else {
    console.info("[entitlements]", payload);
  }
}
