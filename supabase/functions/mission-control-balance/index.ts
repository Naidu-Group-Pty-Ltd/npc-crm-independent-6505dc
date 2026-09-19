// Mission Control balance proxy.
// Frontend reads token balance via this function so the API key never leaves the server.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders } from "../_shared/auth.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import {
  AGENCY_TENANT_REF,
  getBalance,
  MissionControlError,
  type BalanceResult,
} from "../_shared/missionControl.ts";

type BalancePayload = BalanceResult & {
  source: "live" | "cache" | "unprovisioned";
  stale: boolean;
  updatedAt: string | null;
  unprovisioned?: boolean;
};

/**
 * The cache is deliberately read through the service-role client only after
 * verifyAuth succeeds. RLS therefore remains closed to browsers and the exact
 * agency tenant ref prevents one clone from ever receiving another's balance.
 */
async function readCachedBalance(supabase: any): Promise<BalancePayload | null> {
  try {
    const { data, error } = await supabase
      .from("token_balance_cache")
      .select(
        "available,reserved,lifetime_granted,lifetime_spent,plan_name,plan_slug,addon_slugs,monthly_allowance,current_period_end,updated_at",
      )
      .eq("tenant_ref", AGENCY_TENANT_REF)
      .maybeSingle();

    if (error || !data) {
      if (error) console.warn("[mission-control-balance] cache read failed", error.message);
      return null;
    }

    const allowance = Number(data.monthly_allowance ?? 0);
    const available = Number(data.available ?? 0);
    const reserved = Number(data.reserved ?? 0);
    return {
      available,
      reserved,
      allowance,
      used: allowance > 0 ? Math.min(Math.max(allowance - available - reserved, 0), allowance) : 0,
      lifetimeGranted: Number(data.lifetime_granted ?? 0),
      lifetimeSpent: Number(data.lifetime_spent ?? 0),
      planName: data.plan_name ?? null,
      planSlug: data.plan_slug ?? null,
      // Cached alongside the plan so entitlement gating survives a Mission
      // Control outage. Without it a cache hit would report the plan but no
      // add-ons, and a workspace would briefly lose modules it pays for —
      // which is the one failure mode gating must never cause.
      addonSlugs: Array.isArray(data.addon_slugs) ? data.addon_slugs : undefined,
      overagePolicy: null,
      currentPeriodEnd: data.current_period_end ?? null,
      // A stale cache entry must never grant a billing exemption. Only a live,
      // authenticated Mission Control response may make that authorization-relevant decision.
      exempt: false,
      source: "cache",
      stale: true,
      updatedAt: data.updated_at ?? null,
    };
  } catch (error) {
    console.warn("[mission-control-balance] cache read failed", error);
    return null;
  }
}

async function refreshCache(supabase: any, balance: BalanceResult): Promise<void> {
  try {
    const { error } = await supabase.from("token_balance_cache").upsert({
      tenant_ref: AGENCY_TENANT_REF,
      available: balance.available,
      reserved: balance.reserved,
      lifetime_granted: balance.lifetimeGranted,
      lifetime_spent: balance.lifetimeSpent,
      plan_name: balance.planName,
      plan_slug: balance.planSlug,
      addon_slugs: balance.addonSlugs ?? [],
      monthly_allowance: balance.allowance,
      current_period_end: balance.currentPeriodEnd,
      updated_at: new Date().toISOString(),
    }, { onConflict: "tenant_ref" });
    if (error) console.warn("[mission-control-balance] cache refresh failed", error.message);
  } catch (error) {
    console.warn("[mission-control-balance] cache refresh failed", error);
  }
}

Deno.serve(async (req) => {
  // Credentialed CORS: the app invokes this function with
  // credentials:'include' (HttpOnly session cookie), and browsers reject a
  // wildcard Access-Control-Allow-Origin at preflight for credentialed
  // requests — the POST never leaves the browser and the UI surfaces it as
  // "Failed to load". createCorsHeaders echoes the exact allow-listed origin
  // and sets Access-Control-Allow-Credentials.
  const corsHeaders = createCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    let body: any = {};
    try { body = await req.json(); } catch { /* GET / empty */ }

    const auth = await verifyAuth(supabase, req.headers, body);
    if (auth.error || !auth.userId) {
      return new Response(
        JSON.stringify({ error: auth.error ?? "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "content-type": "application/json" } },
      );
    }

    const balance = await getBalance();
    // Await the best-effort write so Edge runtimes do not terminate it early;
    // failures are contained and never turn a live balance into an error.
    await refreshCache(supabase, balance);
    // Surface both detailed MC fields and the legacy frontend shape (available/allowance/used/reserved).
    return new Response(JSON.stringify({
      ...balance,
      source: "live",
      stale: false,
      updatedAt: new Date().toISOString(),
    } satisfies BalancePayload), {
      status: 200,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (e) {
    const isMc = e instanceof MissionControlError;
    // Mission Control returns 404 when the tenant has not been provisioned
    // yet on this clone. That's not a user-facing failure — return a safe
    // zero-balance placeholder so the header pill and Billing UI can render
    // instead of blank-screening on a 404. Same for the "unconfigured" case
    // (MC secrets missing in a preview environment).
    if (isMc && (e.status === 404 || e.code === "unconfigured")) {
      const empty = {
        available: 0,
        allowance: 0,
        used: 0,
        reserved: 0,
        lifetimeGranted: 0,
        lifetimeSpent: 0,
        planName: null,
        planSlug: null,
        overagePolicy: null,
        currentPeriodEnd: null,
        exempt: true,
        unprovisioned: true,
        source: "unprovisioned",
        stale: false,
        updatedAt: null,
      };
      return new Response(JSON.stringify(empty), {
        status: 200,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    // Mission Control can be briefly unavailable or rate limited. Once the
    // caller has authenticated, prefer the last webhook/live snapshot over an
    // unusable header. This is display resilience only: cached responses can
    // never convey billing exemption, while report generation continues to
    // perform its own authoritative server-side reservation.
    const cached = await readCachedBalance(supabase);
    if (cached) {
      console.warn("[mission-control-balance] serving cached balance", {
        upstreamStatus: isMc ? e.status : 500,
        updatedAt: cached.updatedAt,
      });
      return new Response(JSON.stringify(cached), {
        status: 200,
        headers: {
          ...corsHeaders,
          "content-type": "application/json",
          "cache-control": "private, no-store",
          warning: '110 - "Response is stale"',
        },
      });
    }
    const status = isMc ? e.status : 500;
    const payload = isMc
      ? { error: e.code, message: e.message }
      : { error: "internal_error", message: e instanceof Error ? e.message : String(e) };
    console.error("[mission-control-balance] error", payload);
    return new Response(JSON.stringify(payload), {
      status,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
