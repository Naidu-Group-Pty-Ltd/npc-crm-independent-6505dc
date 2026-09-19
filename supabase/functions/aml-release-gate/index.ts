/**
 * Phase 13 — AML Release Gate.
 *
 * Runs a battery of pre-release checks against the AML schema and provider fleet,
 * records a versioned result row, and returns pass/fail with per-check detail.
 * Mirrors the PDF Import Phase 11D release-gate CLI in spirit; can be invoked
 * from CI (with a service_role JWT) or from the Governance UI.
 *
 * POST { op, ...args }
 *   op: 'run'    { version_tag? }         -> { id, status, checks[] }
 *   op: 'list'   { limit? }               -> { runs }
 *   op: 'latest'                          -> { run }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { verifyAuth } from "../_shared/auth.ts";

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
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

type CheckResult = { name: string; status: "pass" | "fail" | "warn"; detail?: string; metric?: number };

async function runChecks(admin: any): Promise<CheckResult[]> {
  const aml = admin.schema("aml");
  const checks: CheckResult[] = [];

  // 1. AML role helpers exist
  try {
    const { data } = await admin.rpc("has_any_aml_role", { _user_id: "00000000-0000-0000-0000-000000000000" });
    checks.push({ name: "role_helpers_present", status: data === false || data === true ? "pass" : "fail" });
  } catch (e) {
    checks.push({ name: "role_helpers_present", status: "fail", detail: String((e as Error).message) });
  }

  // 2. Required AML tables reachable
  const requiredTables = [
    "cases","identity_checks","screening_checks","screening_matches","transactions","reports","report_versions",
    "alerts","edd_cases","source_of_funds","retention_schedules","legal_holds","privacy_requests",
    "tipping_off_rules","records_audit_events","tenant_settings","provider_configs",
    "step_up_challenges","step_up_sessions","ai_action_approvals","release_gates","resilience_drills",
  ];
  for (const t of requiredTables) {
    const { error } = await aml.from(t).select("*", { count: "exact", head: true }).limit(1);
    checks.push({ name: `table:${t}`, status: error ? "fail" : "pass", detail: error?.message });
  }

  // 3. Provider health — anything with >20% failure over last day is a warn.
  try {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
    const { data: metrics, error } = await aml.from("provider_metrics_daily").select("*").gte("metric_date", since);
    if (error) throw error;
    let bad = 0;
    for (const m of metrics ?? []) {
      const calls = Number(m.call_count ?? 0), fails = Number(m.failure_count ?? 0);
      if (calls > 0 && fails / calls > 0.2) bad++;
    }
    checks.push({ name: "provider_health_24h", status: bad === 0 ? "pass" : "warn", metric: bad, detail: bad ? `${bad} provider(s) >20% failure` : "healthy" });
  } catch (e) {
    checks.push({ name: "provider_health_24h", status: "warn", detail: String((e as Error).message) });
  }

  // 4. Retention schedule seeded
  try {
    const { count } = await aml.from("retention_schedules").select("*", { count: "exact", head: true });
    checks.push({ name: "retention_schedules_seeded", status: (count ?? 0) >= 7 ? "pass" : "fail", metric: count ?? 0 });
  } catch (e) {
    checks.push({ name: "retention_schedules_seeded", status: "fail", detail: String((e as Error).message) });
  }

  // 5. At least one tenant configured
  try {
    const { count } = await aml.from("tenant_settings").select("*", { count: "exact", head: true });
    checks.push({ name: "tenant_settings_present", status: (count ?? 0) >= 1 ? "pass" : "warn", metric: count ?? 0 });
  } catch (e) {
    checks.push({ name: "tenant_settings_present", status: "warn", detail: String((e as Error).message) });
  }

  // 6. Audit chain integrity — verify last 50 events
  try {
    const { data: events } = await aml.from("records_audit_events")
      .select("row_hash, prev_hash, created_at").order("created_at", { ascending: false }).limit(50);
    let brokenLinks = 0;
    const arr = (events ?? []).slice().reverse();
    for (let i = 1; i < arr.length; i++) {
      if (arr[i].prev_hash !== arr[i - 1].row_hash) brokenLinks++;
    }
    checks.push({ name: "audit_chain_last_50", status: brokenLinks === 0 ? "pass" : "fail", metric: brokenLinks });
  } catch (e) {
    checks.push({ name: "audit_chain_last_50", status: "warn", detail: String((e as Error).message) });
  }

  return checks;
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
    const aml = admin.schema("aml" as any);

    const body = await req.json().catch(() => ({}));
    const auth = await verifyAuth(admin, req.headers, body);
    if (auth.error || !auth.userId || auth.userId === "service_role") return jr({ error: auth.error || "Authentication required" }, 401);
    const userId = auth.userId;
    const userLabel = auth.username ?? null;

    const { data: hasAml } = await admin.rpc("has_any_aml_role", { _user_id: userId });
    if (!hasAml) return jr({ error: "No AML role" }, 403);
    const { data: isMlro } = await admin.rpc("has_aml_role", { _user_id: userId, _role: "mlro" });

    const op = body?.op as string;

    switch (op) {
      case "run": {
        if (!isMlro) return jr({ error: "Only MLRO can trigger release gate" }, 403);
        const start = Date.now();
        const checks = await runChecks(admin);
        const anyFail = checks.some((c) => c.status === "fail");
        const anyWarn = checks.some((c) => c.status === "warn");
        const status = anyFail ? "fail" : anyWarn ? "warn" : "pass";
        const summary =
          `${checks.length} checks · ${checks.filter(c => c.status === "pass").length} pass · ` +
          `${checks.filter(c => c.status === "warn").length} warn · ${checks.filter(c => c.status === "fail").length} fail`;
        const { data, error } = await aml.from("release_gates").insert({
          gate_name: "aml_release_gate",
          version_tag: body.version_tag ?? null,
          status, checks, summary,
          triggered_by: userId, triggered_by_label: userLabel,
          duration_ms: Date.now() - start,
        }).select("id").single();
        if (error) return jr({ error: error.message }, 500);
        return jr({ id: data.id, status, checks, summary });
      }
      case "list": {
        const limit = Math.min(Number(body.limit ?? 25), 100);
        const { data, error } = await aml.from("release_gates").select("*").order("ran_at", { ascending: false }).limit(limit);
        if (error) return jr({ error: error.message }, 500);
        return jr({ runs: data ?? [] });
      }
      case "latest": {
        const { data } = await aml.from("release_gates").select("*").order("ran_at", { ascending: false }).limit(1).maybeSingle();
        return jr({ run: data });
      }
      default:
        return jr({ error: "Unknown op" }, 400);
    }
  } catch (e) {
    return jr({ ...internalError(e, 'aml-release-gate') }, 500);
  }
});

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
