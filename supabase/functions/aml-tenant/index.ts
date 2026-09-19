/**
 * Phase 12 — AML White-Label & Multi-Tenant Commercialisation.
 *
 * POST { op, ...args }
 * Auth: tenant-scoped AML roles read; tenant MLROs write tenant config.
 *
 * Ops:
 *   summary
 *   get_tenant_settings | update_tenant_settings
 *   list_plans | upsert_plan
 *   list_entitlements | upsert_entitlement_override | delete_entitlement_override | effective_entitlements
 *   list_providers | upsert_provider | delete_provider | set_provider_health
 *   record_provider_metric
 *   provider_metrics_rollup   -- { days?: number, capability?: string }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { verifyAuth } from "../_shared/auth.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { requireStepUpSession } from "../_shared/aml/step-up.ts";
import { withRequestOrigin } from "../_shared/corsOrigin.ts";
import { internalError } from '../_shared/errorResponse.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-session-token, x-command-centre-session-token",
  "Access-Control-Expose-Headers": "x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jr = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const DEFAULT_TENANT = "default";

// Locked control names — terminology overrides MUST NOT rename these.
// These are AUSTRAC / legal terms that any external audit relies on.
const LOCKED_TERMINOLOGY_KEYS = new Set<string>([
  "MLRO", "AUSTRAC", "SMR", "TTR", "IFTI",
  "KYC", "CDD", "EDD", "PEP", "Sanctions",
  "Beneficial Owner", "Tipping-Off", "Threshold Transaction",
]);

async function loadRoles(admin: any, userId: string, tenantId: string): Promise<Set<string>> {
  const { data } = await admin.schema("aml").from("role_assignments")
    .select("role").eq("user_id", userId).eq("tenant_id", tenantId).is("revoked_at", null);
  return new Set((data ?? []).map((r: any) => String(r.role)));
}

async function isSuperadmin(admin: any, userId: string): Promise<boolean> {
  const { data } = await admin.from("user_roles").select("role")
    .eq("user_id", userId).eq("role", "superadmin").maybeSingle();
  return Boolean(data);
}

function sanitizeTerminology(input: Record<string, unknown>): { clean: Record<string, string>; rejected: string[] } {
  const clean: Record<string, string> = {};
  const rejected: string[] = [];
  for (const [k, v] of Object.entries(input ?? {})) {
    if (LOCKED_TERMINOLOGY_KEYS.has(k)) { rejected.push(k); continue; }
    if (typeof v === "string" && v.trim().length > 0 && v.length <= 120) {
      clean[k] = v.trim();
    }
  }
  return { clean, rejected };
}

const __corsWrappedHandler = (async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, service);
    const aml = admin.schema("aml");

    const body = await req.json().catch(() => ({}));
    const auth = await verifyAuth(admin, req.headers, body);
    if (auth.error || !auth.userId || auth.userId === "service_role") return jr({ error: auth.error || "Authentication required" }, 401);
    const userId = auth.userId;

    const { op, ...args } = body;
    if (!op) return jr({ error: "op required" }, 400);

    const tenantId: string = String((args as any).tenant_id ?? DEFAULT_TENANT);
    const [roles, superadmin] = await Promise.all([
      loadRoles(admin, userId, tenantId),
      isSuperadmin(admin, userId),
    ]);
    if (!superadmin && roles.size === 0) return jr({ error: "No AML role for tenant" }, 403);

    const mlroRequired = () => {
      if (!superadmin && !roles.has("mlro")) return jr({ error: "MLRO only" }, 403);
      return null;
    };
    const superadminRequired = () => {
      if (!superadmin) return jr({ error: "Superadmin only" }, 403);
      return null;
    };
    const CONFIG_WRITE_OPS = new Set([
      "update_tenant_settings", "upsert_plan",
      "upsert_provider", "delete_provider", "set_provider_health",
      "upsert_entitlement_override", "delete_entitlement_override",
    ]);
    if (CONFIG_WRITE_OPS.has(op)) {
      const stepUpErr = await requireStepUpSession({
        admin, userId, capability: "aml.configure",
        token: (args as any).step_up_session_token, headers: req.headers,
      });
      if (stepUpErr) return stepUpErr;
    }

    switch (op) {
      case "terminology": {
        const { data: settings, error } = await aml
          .from("tenant_settings")
          .select("terminology_overrides")
          .eq("tenant_id", tenantId)
          .maybeSingle();
        if (error) return jr({ error: error.message }, 500);
        return jr({ terminology_overrides: settings?.terminology_overrides ?? {} });
      }
      case "summary": {
        const [{ data: settings }, { data: plans }, { data: providers }, { data: overrides }, { data: metrics }] = await Promise.all([
          aml.from("tenant_settings").select("*").eq("tenant_id", tenantId).maybeSingle(),
          aml.from("plan_tiers").select("*").order("sort_order", { ascending: true }),
          aml.from("provider_configs").select("*").eq("tenant_id", tenantId),
          aml.from("tenant_entitlement_overrides").select("*").eq("tenant_id", tenantId),
          aml.from("provider_metrics_daily").select("*")
            .eq("tenant_id", tenantId)
            .gte("metric_date", new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)),
        ]);

        const totals = { calls: 0, failures: 0, cost_cents: 0 };
        for (const m of (metrics ?? [])) {
          totals.calls += m.call_count ?? 0;
          totals.failures += m.failure_count ?? 0;
          totals.cost_cents += Number(m.cost_cents_sum ?? 0);
        }
        const providerRows = providers ?? [];
        const liveCount = providerRows.filter((p: any) => p.mode === "live" && p.active).length;
        const simCount = providerRows.filter((p: any) => (p.mode ?? "simulator") === "simulator" && p.active).length;
        const envMode = (Deno.env.get("AML_PROVIDER_MODE") || "simulator").toLowerCase() === "live" ? "live" : "simulator";
        return jr({
          settings: settings ?? null,
          plans: plans ?? [],
          providers: providerRows,
          overrides: overrides ?? [],
          metrics_30d: totals,
          locked_terminology_keys: [...LOCKED_TERMINOLOGY_KEYS],
          orchestration: { env_mode: envMode, live_active: liveCount, simulator_active: simCount },
        });
      }

      case "get_tenant_settings": {
        const { data } = await aml.from("tenant_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
        return jr({ settings: data ?? null });
      }

      case "update_tenant_settings": {
        const err = mlroRequired(); if (err) return err;
        const patch = (args as any).patch ?? {};
        let rejected: string[] = [];
        if (patch.terminology_overrides) {
          const { clean, rejected: r } = sanitizeTerminology(patch.terminology_overrides);
          patch.terminology_overrides = clean;
          rejected = r;
        }
        // Never allow tenant_id key change through here.
        delete patch.tenant_id;
        const { data, error } = await aml.from("tenant_settings")
          .update(patch).eq("tenant_id", tenantId).select("*").maybeSingle();
        if (error) return jr({ error: error.message }, 400);
        return jr({ settings: data, rejected_terminology_keys: rejected });
      }

      case "list_plans": {
        const { data } = await aml.from("plan_tiers").select("*").order("sort_order", { ascending: true });
        return jr({ plans: data ?? [] });
      }
      case "upsert_plan": {
        const err = superadminRequired(); if (err) return err;
        const plan = (args as any).plan ?? {};
        if (!plan.key || !plan.label) return jr({ error: "key + label required" }, 400);
        const { data, error } = await aml.from("plan_tiers").upsert(plan, { onConflict: "key" }).select("*").maybeSingle();
        if (error) return jr({ error: error.message }, 400);
        return jr({ plan: data });
      }

      case "list_entitlements": {
        const { data } = await aml.from("tenant_entitlement_overrides").select("*").eq("tenant_id", tenantId);
        return jr({ overrides: data ?? [] });
      }
      case "upsert_entitlement_override": {
        const err = mlroRequired(); if (err) return err;
        const row = (args as any).override ?? {};
        if (!row.entitlement_key) return jr({ error: "entitlement_key required" }, 400);
        const payload = { ...row, tenant_id: tenantId, created_by: userId };
        const { data, error } = await aml.from("tenant_entitlement_overrides")
          .upsert(payload, { onConflict: "tenant_id,entitlement_key" }).select("*").maybeSingle();
        if (error) return jr({ error: error.message }, 400);
        return jr({ override: data });
      }
      case "delete_entitlement_override": {
        const err = mlroRequired(); if (err) return err;
        const id = (args as any).id;
        if (!id) return jr({ error: "id required" }, 400);
        const { error } = await aml.from("tenant_entitlement_overrides").delete()
          .eq("id", id).eq("tenant_id", tenantId);
        if (error) return jr({ error: error.message }, 400);
        return jr({ ok: true });
      }

      case "effective_entitlements": {
        const [{ data: settings }, { data: plans }, { data: overrides }] = await Promise.all([
          aml.from("tenant_settings").select("plan_tier_key").eq("tenant_id", tenantId).maybeSingle(),
          aml.from("plan_tiers").select("*"),
          aml.from("tenant_entitlement_overrides").select("*").eq("tenant_id", tenantId),
        ]);
        const planKey = settings?.plan_tier_key ?? "starter";
        const plan = (plans ?? []).find((p: any) => p.key === planKey);
        const base = (plan?.entitlements ?? {}) as Record<string, any>;
        const effective: Record<string, any> = { ...base };
        for (const o of overrides ?? []) effective[o.entitlement_key] = o.value;
        return jr({ plan_key: planKey, base, overrides: overrides ?? [], effective });
      }

      case "list_providers": {
        const { data } = await aml.from("provider_configs").select("*")
          .eq("tenant_id", tenantId)
          .order("capability", { ascending: true })
          .order("priority", { ascending: true });
        return jr({ providers: data ?? [] });
      }
      case "upsert_provider": {
        const err = mlroRequired(); if (err) return err;
        const p = (args as any).provider ?? {};
        if (!p.capability || !p.provider_key) return jr({ error: "capability + provider_key required" }, 400);
        const payload = { ...p, tenant_id: tenantId, created_by: userId };
        const { data, error } = await aml.from("provider_configs")
          .upsert(payload, { onConflict: "tenant_id,capability,provider_key" }).select("*").maybeSingle();
        if (error) return jr({ error: error.message }, 400);
        return jr({ provider: data });
      }
      case "delete_provider": {
        const err = mlroRequired(); if (err) return err;
        const id = (args as any).id;
        if (!id) return jr({ error: "id required" }, 400);
        const { error } = await aml.from("provider_configs").delete()
          .eq("id", id).eq("tenant_id", tenantId);
        if (error) return jr({ error: error.message }, 400);
        return jr({ ok: true });
      }
      case "set_provider_health": {
        const err = mlroRequired(); if (err) return err;
        const { id, status, message } = args as any;
        if (!id) return jr({ error: "id required" }, 400);
        const { data, error } = await aml.from("provider_configs").update({
          last_health_at: new Date().toISOString(),
          last_health_status: status ?? "unknown",
          last_health_message: message ?? null,
        }).eq("id", id).eq("tenant_id", tenantId).select("*").maybeSingle();
        if (error) return jr({ error: error.message }, 400);
        return jr({ provider: data });
      }

      case "record_provider_metric": {
        // Records/upserts a per-day counter. MLRO or reviewer/analyst allowed
        // (edge functions can also invoke as service_role and bypass this path).
        const { capability, provider_key, calls = 0, failures = 0, latency_ms = 0, cost_cents = 0 } = args as any;
        if (!capability || !provider_key) return jr({ error: "capability + provider_key required" }, 400);
        const today = new Date().toISOString().slice(0, 10);
        const { data: existing } = await aml.from("provider_metrics_daily").select("*")
          .eq("tenant_id", tenantId).eq("capability", capability)
          .eq("provider_key", provider_key).eq("metric_date", today).maybeSingle();
        if (existing) {
          const { data, error } = await aml.from("provider_metrics_daily").update({
            call_count: (existing.call_count ?? 0) + Number(calls),
            failure_count: (existing.failure_count ?? 0) + Number(failures),
            latency_ms_sum: Number(existing.latency_ms_sum ?? 0) + Number(latency_ms),
            cost_cents_sum: Number(existing.cost_cents_sum ?? 0) + Number(cost_cents),
          }).eq("id", existing.id).eq("tenant_id", tenantId).select("*").maybeSingle();
          if (error) return jr({ error: error.message }, 400);
          return jr({ metric: data });
        }
        const { data, error } = await aml.from("provider_metrics_daily").insert({
          tenant_id: tenantId, capability, provider_key, metric_date: today,
          call_count: Number(calls), failure_count: Number(failures),
          latency_ms_sum: Number(latency_ms), cost_cents_sum: Number(cost_cents),
        }).select("*").maybeSingle();
        if (error) return jr({ error: error.message }, 400);
        return jr({ metric: data });
      }

      case "provider_metrics_rollup": {
        const days = Math.max(1, Math.min(180, Number((args as any).days ?? 30)));
        const capability = (args as any).capability as string | undefined;
        const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
        let q = aml.from("provider_metrics_daily").select("*")
          .eq("tenant_id", tenantId).gte("metric_date", since);
        if (capability) q = q.eq("capability", capability);
        const { data } = await q;
        const rows = data ?? [];

        const byProvider = new Map<string, any>();
        const daily = new Map<string, any>();
        for (const r of rows) {
          const key = `${r.capability}::${r.provider_key}`;
          const acc = byProvider.get(key) ?? {
            capability: r.capability, provider_key: r.provider_key,
            calls: 0, failures: 0, latency_ms: 0, cost_cents: 0,
          };
          acc.calls += r.call_count ?? 0;
          acc.failures += r.failure_count ?? 0;
          acc.latency_ms += Number(r.latency_ms_sum ?? 0);
          acc.cost_cents += Number(r.cost_cents_sum ?? 0);
          byProvider.set(key, acc);

          const d = daily.get(r.metric_date) ?? { metric_date: r.metric_date, calls: 0, failures: 0, cost_cents: 0 };
          d.calls += r.call_count ?? 0;
          d.failures += r.failure_count ?? 0;
          d.cost_cents += Number(r.cost_cents_sum ?? 0);
          daily.set(r.metric_date, d);
        }
        const providers = [...byProvider.values()].map((p) => ({
          ...p,
          failure_rate: p.calls > 0 ? p.failures / p.calls : 0,
          avg_latency_ms: p.calls > 0 ? Math.round(p.latency_ms / p.calls) : 0,
        }));
        const timeline = [...daily.values()].sort((a, b) => a.metric_date.localeCompare(b.metric_date));
        return jr({ providers, timeline, days });
      }

      default:
        return jr({ error: `Unknown op: ${op}` }, 400);
    }
  } catch (e) {
    console.error("[aml-tenant] fatal", e);
    return jr({ ...internalError(e, 'aml-tenant') }, 500);
  }
});

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
