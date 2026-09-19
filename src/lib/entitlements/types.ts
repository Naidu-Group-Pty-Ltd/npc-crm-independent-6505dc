// The shared vocabulary of the entitlement system.
//
// Three questions used to be answered by one blurred check, and this module
// exists to keep them apart:
//
//   1. What has the WORKSPACE bought?   → WorkspaceEntitlementSnapshot
//   2. What does a purchase UNLOCK?     → CapabilityDefinition (registry.ts)
//   3. May THIS USER use it here?       → CapabilityDecision (resolver.ts)
//
// A capability decision is the only thing UI or backend code should consume.
// Nothing outside src/lib/entitlements should ever compare plan slugs or
// add-on slugs directly — that is how tier logic ended up scattered across
// sidebars, pages and palettes in the first place.

/** The three base subscription tiers, lowest first. Order matters: higher
 * tiers include everything below them, and `requiredPlan` reporting picks the
 * cheapest tier that would unlock a capability. */
export const PLAN_ORDER = ["launch", "growth", "scale"] as const;

export type PlanSlug = (typeof PLAN_ORDER)[number];

export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "cancelled"
  | "expired"
  | "unknown";

/**
 * The normalised commercial state of a workspace, as Mission Control last
 * described it. Everything is canonicalised at the boundary (aliases.ts):
 * plan SKUs like `launch-with-aml` arrive here as `planSlug: "launch"` plus
 * `addonSlugs: ["aml-ctf"]`, and legacy add-on spellings arrive as their
 * canonical slug. Nothing downstream re-normalises.
 */
export interface WorkspaceEntitlementSnapshot {
  /** Mission Control tenant reference for this deployment. */
  workspaceId: string;
  /** Canonical base tier, or the raw slug when it is not a known tier. */
  planSlug: PlanSlug | string;
  subscriptionStatus: SubscriptionStatus;
  /** Canonical slugs of active add-on purchases (includes `past_due` — a
   * failed card must not strip a feature mid-period). */
  addonSlugs: string[];
  /** Canonical slugs granted by an active trial. */
  trialSlugs: string[];
  /** Canonical slugs granted by an explicit, audited workspace override
   * (support mode, billing-exempt tenant). */
  overrideSlugs: string[];
  /** True when Mission Control marks the tenant billing-exempt: an explicit,
   * recorded commercial decision that everything is available. */
  billingExempt: boolean;
  /** End of the current billing period, when Mission Control reported one. */
  expiresAt?: string;
  /** Raw plan slug exactly as Mission Control sent it, for diagnostics. */
  rawPlanSlug?: string | null;
  /** Raw add-on slugs exactly as Mission Control sent them, for diagnostics. */
  rawAddonSlugs?: string[];
  /** True when AML/CTF entitlement was assumed from the catalogue's
   * headline-SKU rule rather than stated by Mission Control. Diagnostics
   * surface this so a future without-AML SKU rollout can be verified. */
  amlAssumed?: boolean;
  /** ISO timestamp of when this snapshot was fetched from Mission Control. */
  fetchedAt: string;
  /** Where the snapshot came from. `cache` marks a last-known-good snapshot
   * served while Mission Control was unreachable. */
  source: "mission_control" | "cache" | "administrative_override";
  /** Monotonic-ish version for diagnostics (Mission Control updated_at when
   * available, else fetchedAt). */
  version?: string;
}

/** How far the provider has got in obtaining a snapshot. */
export type SnapshotState =
  /** No answer yet and no cached snapshot — still asking Mission Control. */
  | "loading"
  /** A snapshot straight from Mission Control this session. */
  | "ready"
  /** Mission Control failed but a valid last-known-good snapshot exists. */
  | "stale"
  /** Mission Control failed and no snapshot has ever been obtained. */
  | "unavailable";

/**
 * Canonical capability keys.
 *
 * `module.*` gates a whole product surface (navigation + routes + data).
 * `client.*` gates one tab or action inside the client workspace.
 * `report.*` / `cashflow.*` gate separately commercialised report features.
 */
export type CapabilityKey =
  // Core modules — part of every active subscription.
  | "module.overview"
  | "module.calendar"
  | "module.clients"
  | "module.client_tracker"
  | "module.reminders"
  | "module.checklists"
  | "module.game_plan"
  | "module.reports"
  | "module.generated_reports"
  | "module.cashflow"
  | "module.report_requests"
  | "module.user_guide"
  | "module.billing"
  | "module.settings"
  | "module.user_management"
  | "module.branding"
  | "module.client_portal"
  // Premium modules — tier-bundled and/or separately purchasable.
  | "module.market_news_feed"
  | "module.commercial_industrial"
  | "module.property_marketplace"
  | "module.deal_pipeline"
  | "module.intelligence_hub"
  | "module.email_copilot"
  | "module.call_logs"
  | "module.finance_portal"
  | "module.agreements"
  | "module.marketing"
  | "module.model_hub"
  | "module.api_usage"
  | "module.integrations"
  | "module.aurixa_agent"
  | "module.aml_ctf"
  // Report & cash-flow sub-capabilities.
  | "report.investment"
  | "report.comparisons"
  | "cashflow.standard"
  | "cashflow.comparisons"
  // Client workspace sub-capabilities (tabs and actions).
  | "client.overview"
  | "client.personal"
  | "client.properties"
  | "client.deals"
  | "client.employment"
  | "client.financials"
  | "client.reports"
  | "client.sent_reports"
  | "client.requests"
  | "client.emails"
  | "client.conversations"
  | "client.appointments"
  | "client.portal_messages"
  | "client.finance_messages"
  | "client.notes"
  | "client.reminders"
  | "client.forms"
  | "client.files"
  | "client.activity"
  | "client.review"
  | "client.download_pdf"
  | "client.portal_access"
  | "client.view_as_client"
  | "client.send_to_finance"
  | "client.portfolio_analysis"
  | "client.send_portfolio"
  | "client.send_agreement"
  | "client.borrowing_capacity"
  | "client.commercial_industrial"
  | "client.lenders"
  | "client.ai";

export type ProductStatus = "active" | "beta" | "coming_soon" | "unavailable";

export interface CapabilityDefinition {
  key: CapabilityKey;
  label: string;
  description?: string;
  /**
   * Tiers whose base subscription includes this capability. Empty array means
   * add-on only; `"*"`-like universality is expressed by listing all three.
   * Higher tiers must always be listed explicitly — no implicit inheritance,
   * so the matrix can be asserted monotonic in tests.
   */
  includedInPlans: readonly PlanSlug[];
  /** Canonical add-on slugs that unlock this capability when active. */
  addonSlugs?: readonly string[];
  /**
   * USER-permission module key (`usePermissions` vocabulary) that must also
   * be granted. Plan entitlement and user permission are independent axes;
   * both must pass.
   */
  permissionKey?: string;
  /** Capability that must be enabled for this one to make sense (e.g. every
   * `client.*` capability depends on `module.clients`). */
  parentCapability?: CapabilityKey;
  /** Other capabilities this one needs (integration readiness etc.). */
  dependencies?: readonly CapabilityKey[];
  /** Operational availability, independent of purchase. */
  productStatus?: ProductStatus;
  /** Legacy identifiers (pricing slugs, sub-module keys, permission keys)
   * that older code and Mission Control responses use for this capability. */
  aliases?: readonly string[];
}

export type CapabilityStatus =
  | "enabled"
  | "plan_excluded"
  | "permission_denied"
  | "dependency_missing"
  | "product_unavailable"
  | "loading"
  | "unknown";

export type EntitlementSource =
  | "base_tier"
  | "addon"
  | "trial"
  | "workspace_override"
  /**
   * The signed-in user is a platform superadministrator. Superadmins operate
   * the deployment — they configure it, support it, and are the only role that
   * can reach the platform-engineering consoles — so a capability they cannot
   * open is a capability they cannot administer. Recorded as its own source
   * rather than folded into `workspace_override` so diagnostics, denial
   * screens and the audit trail can always tell "the workspace bought this"
   * apart from "an operator is looking at it".
   */
  | "operator_override";

/**
 * The full answer to "may this workspace, and this user, use this capability
 * right now" — with the reasoning, not just the boolean, so denial screens
 * and diagnostics can explain themselves.
 */
export interface CapabilityDecision {
  capability: CapabilityKey;
  enabled: boolean;
  status: CapabilityStatus;
  /** Every source that would grant the capability. A Scale workspace holding
   * a duplicate Market News Feed add-on lists both `base_tier` and `addon`,
   * which is what keeps the module alive when the duplicate is cancelled. */
  entitlementSources: EntitlementSource[];
  /** The source the decision actually rests on (first of the list). */
  effectiveSource?: EntitlementSource;
  /** True when the capability is open ONLY because the viewer is a platform
   * superadministrator and the workspace itself holds no commercial source
   * for it. Surfaces use this to say so on the page, so an operator is never
   * left believing the customer sees what they see. */
  operatorOnly?: boolean;
  /** Cheapest tier that would include this capability, for denial screens. */
  requiredPlan?: PlanSlug;
  /** Add-ons that would unlock it without a tier change. */
  availableAddons?: string[];
  /** Unsatisfied dependency capabilities, when status is dependency_missing. */
  missingDependencies?: CapabilityKey[];
  permissionKey?: string;
  planSlug?: string;
  workspaceId?: string;
}
