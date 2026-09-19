/**
 * entitlements — server-side workspace COMMERCIAL entitlement gate.
 *
 * `requireModulePermission` (authz.ts) answers "may this USER"; this module
 * answers "has this WORKSPACE bought it". Both must pass on premium
 * operations — frontend gating is presentation, this is enforcement.
 *
 * Source of truth is Mission Control's balance response (plan slug + active
 * add-on slugs), with the `token_balance_cache` row as the last-known-good
 * fallback so a Mission Control blip neither exposes premium modules nor
 * strips a paying customer mid-session. When NEITHER source has ever
 * answered, premium operations deny — fail-closed, with a distinct reason
 * code so the client can show "temporarily unavailable" rather than an
 * upsell.
 *
 * Superadministrators do NOT bypass this gate. Commercial bypass exists only
 * as Mission Control's audited billing-exempt flag (workspace override), or
 * a verified internal service call.
 */

import { AGENCY_TENANT_REF, getBalance, MissionControlError } from "./missionControl.ts";

export type CapabilitySlug =
  | "market-updates"
  | "commercial-industrial"
  | "opportunity-marketplace"
  | "report-comparisons"
  | "cashflow-comparisons"
  | "deal-pipeline"
  | "portfolio-analysis"
  | "send-portfolio"
  | "borrowing-capacity"
  | "client-ai"
  | "agreements"
  | "marketing"
  | "model-hub"
  | "finance-portal"
  | "api-usage"
  | "aml-ctf"
  | "email-copilot"
  | "call-logs"
  | "intelligence-hub"
  | "integrations"
  | "aurixa-agent";

/**
 * Tiers whose base subscription includes each capability. Mirrors the
 * client-side registry (src/lib/entitlements/registry.ts) — the two are
 * pinned together by src/lib/entitlements/__tests__/serverMatrixParity.spec.ts.
 *
 * COMMERCIAL RULES: Market News Feed and Commercial & Industrial are
 * Scale-bundled OR separately purchased — never included below Scale.
 * AML/CTF follows the purchased SKU (headline SKUs include it), never the
 * tier list.
 */
export const CAPABILITY_TIERS: Record<CapabilitySlug, readonly string[]> = {
  "market-updates": ["scale"],
  "commercial-industrial": ["scale"],
  "opportunity-marketplace": ["scale"],
  "report-comparisons": ["growth", "scale"],
  "cashflow-comparisons": ["growth", "scale"],
  "deal-pipeline": ["growth", "scale"],
  "portfolio-analysis": ["scale"],
  "send-portfolio": ["scale"],
  "borrowing-capacity": ["scale"],
  "client-ai": ["scale"],
  agreements: ["scale"],
  marketing: ["scale"],
  "model-hub": ["scale"],
  "finance-portal": ["scale"],
  "api-usage": ["scale"],
  "aml-ctf": [],
  "email-copilot": [],
  "call-logs": [],
  "intelligence-hub": [],
  integrations: [],
  "aurixa-agent": [],
};

const KNOWN_PLANS = ["launch", "growth", "scale"] as const;

/** Every tier's headline SKU includes AML/CTF (Mission Control catalogue,
 * TIER_INCLUDES_AML). A `*-without-aml` SKU turns the assumption off. */
const HEADLINE_SKU_INCLUDES_AML = true;

const ADDON_ALIASES: Record<string, CapabilitySlug> = {
  "market-news-feed": "market-updates",
  market_updates: "market-updates",
  commercial: "commercial-industrial",
  industrial: "commercial-industrial",
  listings: "opportunity-marketplace",
  "property-marketplace": "opportunity-marketplace",
  deals: "deal-pipeline",
  deal_pipeline: "deal-pipeline",
  aml: "aml-ctf",
  "cash-flow-comparisons": "cashflow-comparisons",
};

export interface WorkspaceEntitlements {
  planSlug: string | null;
  addonSlugs: string[];
  exempt: boolean;
  source: "mission_control" | "cache" | "none";
}

export interface EntitlementResult {
  ok: boolean;
  error?: string;
  /** `entitlement_required` (403) | `entitlement_unavailable` (503). */
  reason_code?: "entitlement_required" | "entitlement_unavailable";
  status?: number;
  entitlements?: WorkspaceEntitlements;
}

function canonicalisePlan(raw: string | null | undefined): { plan: string | null; impliedAml: boolean | null } {
  const slug = (raw ?? "").trim().toLowerCase().replace(/_/g, "-");
  if (!slug) return { plan: null, impliedAml: null };
  const withAml = /-with-aml(-ctf)?$/.test(slug);
  const withoutAml = /-without-aml(-ctf)?$/.test(slug);
  const base = slug.replace(/-(with|without)-aml(-ctf)?$/, "");
  const mapped = base === "professional" ? "growth" : base;
  return { plan: mapped, impliedAml: withAml ? true : withoutAml ? false : null };
}

function canonicaliseAddons(raw: readonly unknown[]): string[] {
  const out = new Set<string>();
  for (const value of raw) {
    if (typeof value !== "string") continue;
    const slug = value.trim().toLowerCase();
    out.add(ADDON_ALIASES[slug] ?? ADDON_ALIASES[slug.replace(/-/g, "_")] ?? slug);
  }
  return [...out];
}

// One fetch per edge instance per minute — entitlements move at billing speed.
let cached: { at: number; value: WorkspaceEntitlements } | null = null;
const CACHE_TTL_MS = 60_000;

/** Read the workspace's commercial entitlements: Mission Control first, the
 * last-known-good `token_balance_cache` row on failure. */
export async function getWorkspaceEntitlements(supabase: any): Promise<WorkspaceEntitlements> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  let result: WorkspaceEntitlements | null = null;
  try {
    const balance = await getBalance();
    result = normalise(balance.planSlug, balance.addonSlugs ?? [], balance.exempt === true, "mission_control");
  } catch (err) {
    // An unprovisioned clone (Mission Control 404 / unconfigured) is an
    // explicit answer, not a failure: dev installs keep working, recorded as
    // exempt — the same treatment the balance endpoint gives it.
    if (err instanceof MissionControlError && (err.status === 404 || err.code === "unconfigured")) {
      result = { planSlug: null, addonSlugs: [], exempt: true, source: "mission_control" };
    } else {
      console.warn("[entitlements] Mission Control unavailable, trying cache", {
        tenant: AGENCY_TENANT_REF,
        message: err instanceof Error ? err.message : String(err),
      });
      try {
        const { data } = await supabase
          .from("token_balance_cache")
          .select("plan_slug, addon_slugs")
          .eq("tenant_ref", AGENCY_TENANT_REF)
          .maybeSingle();
        if (data && (data.plan_slug || (data.addon_slugs ?? []).length > 0)) {
          result = normalise(data.plan_slug, data.addon_slugs ?? [], false, "cache");
        }
      } catch (cacheErr) {
        console.warn("[entitlements] cache read failed", {
          message: cacheErr instanceof Error ? cacheErr.message : String(cacheErr),
        });
      }
    }
  }

  const value = result ?? { planSlug: null, addonSlugs: [], exempt: false, source: "none" as const };
  cached = { at: Date.now(), value };
  return value;
}

function normalise(
  rawPlan: string | null | undefined,
  rawAddons: readonly unknown[],
  exempt: boolean,
  source: "mission_control" | "cache",
): WorkspaceEntitlements {
  const { plan, impliedAml } = canonicalisePlan(rawPlan);
  const addons = canonicaliseAddons(rawAddons);
  if (impliedAml === true && !addons.includes("aml-ctf")) addons.push("aml-ctf");
  if (
    HEADLINE_SKU_INCLUDES_AML &&
    impliedAml !== false &&
    !addons.includes("aml-ctf") &&
    plan !== null &&
    (KNOWN_PLANS as readonly string[]).includes(plan)
  ) {
    addons.push("aml-ctf");
  }
  return { planSlug: plan, addonSlugs: addons, exempt, source };
}

/** Test hook: reset the per-instance cache. */
export function _resetEntitlementCache(): void {
  cached = null;
}

/**
 * Require the workspace to hold a capability (fail-closed for premium).
 *
 *  - Verified internal/service calls bypass (cron, function-to-function).
 *  - A billing-exempt or unprovisioned workspace passes (workspace override,
 *    recorded by Mission Control).
 *  - Included tier, or an active add-on, passes.
 *  - An UNKNOWN plan with no snapshot ever obtained DENIES with
 *    `entitlement_unavailable` (503) — distinct from `entitlement_required`
 *    (403) so clients never show an upsell for an outage.
 */
export async function requireWorkspaceCapability(
  supabase: any,
  actor: { userId?: string | null; authMethod?: string | null },
  capability: CapabilitySlug,
): Promise<EntitlementResult> {
  if (actor.authMethod === "service_role" || actor.userId === "service_role") {
    return { ok: true };
  }

  const tiers = CAPABILITY_TIERS[capability];
  if (!tiers) return { ok: true }; // not a commercially gated capability

  const entitlements = await getWorkspaceEntitlements(supabase);
  if (entitlements.exempt) return { ok: true, entitlements };
  if (entitlements.addonSlugs.includes(capability)) return { ok: true, entitlements };
  if (entitlements.planSlug && tiers.includes(entitlements.planSlug)) {
    return { ok: true, entitlements };
  }

  if (entitlements.source === "none") {
    console.warn("[entitlements] denied — entitlement unknown", { capability });
    return {
      ok: false,
      error: "Workspace entitlement could not be confirmed. Please try again shortly.",
      reason_code: "entitlement_unavailable",
      status: 503,
      entitlements,
    };
  }

  console.warn("[entitlements] denied — not entitled", {
    capability,
    planSlug: entitlements.planSlug,
    source: entitlements.source,
  });
  return {
    ok: false,
    error: `This capability ("${capability}") is not included in the workspace subscription.`,
    reason_code: "entitlement_required",
    status: 403,
    entitlements,
  };
}

/** JSON Response for a failed entitlement check, with machine-readable code. */
export function entitlementDeniedResponse(result: EntitlementResult, corsHeaders: Record<string, string>): Response {
  const code = result.reason_code === "entitlement_unavailable" ? "PRODUCT_UNAVAILABLE" : "ENTITLEMENT_REQUIRED";
  return new Response(
    JSON.stringify({ error: result.error ?? "Not entitled", code, reason_code: result.reason_code }),
    {
      status: result.status ?? 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}
