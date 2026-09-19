/**
 * Phase 14 — AML Launch, Operations & Change Management.
 *
 * POST { op, ...args }
 * Auth required. Reads: any AML role. Writes: MLRO only.
 *
 * Ops:
 *   summary
 *   get_rollout | advance_rollout | rollback_rollout | rollout_history
 *   list_scenarios | upsert_scenario | record_scenario_result | delete_scenario
 *   list_risks | upsert_risk | delete_risk
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

const TENANT = "default";
const STAGES = ["internal_dev_only", "admin_limited", "controlled_team_rollout", "broad_production"] as const;
type Stage = typeof STAGES[number];

async function loadRoles(admin: any, userId: string): Promise<Set<string>> {
  const { data } = await admin.schema("aml").from("role_assignments")
    .select("role").eq("user_id", userId).is("revoked_at", null);
  return new Set((data ?? []).map((r: any) => String(r.role)));
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

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const auth = await verifyAuth(admin, req.headers, body);
    if (auth.error || !auth.userId || auth.userId === "service_role") return jr({ error: auth.error || "Authentication required" }, 401);
    const userId = auth.userId;
    const label = auth.username ?? userId;

    const roles = await loadRoles(admin, userId);
    if (roles.size === 0) return jr({ error: "No AML role assigned" }, 403);
    const isMlro = roles.has("mlro");
    const requireMlro = () => { if (!isMlro) throw new Error("MLRO role required"); };

    const op = String(body?.op ?? "summary");

    switch (op) {
      case "summary": {
        const [{ data: t }, { data: scen }, { data: risks }, { data: history }, { data: gate }] = await Promise.all([
          aml.from("tenant_settings").select("rollout_stage,rollout_stage_since,rollout_notes").eq("tenant_id", TENANT).maybeSingle(),
          aml.from("acceptance_scenarios").select("code,last_status").eq("tenant_id", TENANT),
          aml.from("risk_register").select("code,status,impact").eq("tenant_id", TENANT),
          aml.from("rollout_stage_history").select("id,to_stage,from_stage,changed_by_label,reason,created_at")
            .eq("tenant_id", TENANT).order("created_at", { ascending: false }).limit(5),
          aml.from("release_gates").select("status,ran_at,id").order("ran_at", { ascending: false }).limit(1).maybeSingle(),
        ]);
        const scenariosByStatus: Record<string, number> = {};
        (scen ?? []).forEach((r: any) => scenariosByStatus[r.last_status] = (scenariosByStatus[r.last_status] ?? 0) + 1);
        const risksByStatus: Record<string, number> = {};
        (risks ?? []).forEach((r: any) => risksByStatus[r.status] = (risksByStatus[r.status] ?? 0) + 1);
        const failingScenarios = (scen ?? []).filter((r: any) => r.last_status === "failed" || r.last_status === "blocked").map((r: any) => r.code);
        const openCriticalRisks = (risks ?? []).filter((r: any) => r.status === "open" && r.impact === "critical").map((r: any) => r.code);
        const readiness = {
          gate_pass: gate?.status === "pass",
          gate_status: gate?.status ?? "never_run",
          gate_ran_at: gate?.ran_at ?? null,
          failing_scenarios: failingScenarios,
          open_critical_risks: openCriticalRisks,
          broad_production_ready: gate?.status === "pass" && failingScenarios.length === 0 && openCriticalRisks.length === 0,
        };
        return jr({
          rollout: t ?? { rollout_stage: "internal_dev_only" },
          scenarios: { total: (scen ?? []).length, by_status: scenariosByStatus },
          risks: { total: (risks ?? []).length, by_status: risksByStatus },
          recent_history: history ?? [],
          readiness,
          my_role_is_mlro: isMlro,
        });
      }

      case "get_rollout": {
        const { data } = await aml.from("tenant_settings")
          .select("rollout_stage,rollout_stage_since,rollout_notes").eq("tenant_id", TENANT).maybeSingle();
        return jr({ rollout: data });
      }

      case "advance_rollout":
      case "rollback_rollout": {
        requireMlro();
        const to = String(body?.to_stage ?? "");
        if (!STAGES.includes(to as Stage)) return jr({ error: "Invalid stage" }, 400);
        const { data: current } = await aml.from("tenant_settings").select("rollout_stage").eq("tenant_id", TENANT).maybeSingle();
        const from = current?.rollout_stage as Stage | undefined;
        const fromIdx = from ? STAGES.indexOf(from) : -1;
        const toIdx = STAGES.indexOf(to as Stage);
        if (op === "advance_rollout" && toIdx <= fromIdx) return jr({ error: "advance must move forward" }, 400);
        if (op === "rollback_rollout" && toIdx >= fromIdx) return jr({ error: "rollback must move backward" }, 400);

        // For advance to broad_production, require latest release gate is pass
        // AND zero open risks with critical impact (rollout playbook §Preconditions).
        if (op === "advance_rollout" && to === "broad_production") {
          const { data: gate } = await aml.from("release_gates").select("status,id")
            .order("ran_at", { ascending: false }).limit(1).maybeSingle();
          if (!gate || gate.status !== "pass") return jr({ error: "Latest release gate must be PASS to reach broad_production" }, 400);
          const { data: critOpen } = await aml.from("risk_register")
            .select("id,code,title").eq("tenant_id", TENANT).eq("status", "open").eq("impact", "critical");
          if ((critOpen ?? []).length > 0) {
            return jr({
              error: `Cannot advance to broad_production while ${critOpen!.length} open critical risk(s) remain: ${critOpen!.map((r: any) => r.code).join(", ")}`,
              blocking_risks: critOpen,
            }, 400);
          }
          const { data: failedScen } = await aml.from("acceptance_scenarios")
            .select("code,title,last_status").eq("tenant_id", TENANT).in("last_status", ["failed", "blocked"]);
          if ((failedScen ?? []).length > 0) {
            return jr({
              error: `Cannot advance to broad_production while ${failedScen!.length} acceptance scenario(s) are failing or blocked: ${failedScen!.map((r: any) => r.code).join(", ")}`,
              failing_scenarios: failedScen,
            }, 400);
          }
        }

        const { error: upErr } = await aml.from("tenant_settings")
          .update({ rollout_stage: to, rollout_stage_since: new Date().toISOString(), rollout_notes: body?.notes ?? null })
          .eq("tenant_id", TENANT);
        if (upErr) return jr({ error: upErr.message }, 500);
        await aml.from("rollout_stage_history").insert({
          tenant_id: TENANT, from_stage: from ?? null, to_stage: to,
          changed_by: userId, changed_by_label: label, reason: body?.reason ?? null,
        });
        return jr({ ok: true, to_stage: to });
      }

      case "rollout_history": {
        const { data } = await aml.from("rollout_stage_history").select("*")
          .eq("tenant_id", TENANT).order("created_at", { ascending: false }).limit(50);
        return jr({ history: data ?? [] });
      }

      case "list_scenarios": {
        const { data } = await aml.from("acceptance_scenarios").select("*")
          .eq("tenant_id", TENANT).order("phase", { ascending: true }).order("code", { ascending: true });
        return jr({ scenarios: data ?? [] });
      }

      case "upsert_scenario": {
        requireMlro();
        const row = {
          tenant_id: TENANT,
          code: String(body?.code ?? "").trim(),
          title: String(body?.title ?? "").trim(),
          description: body?.description ?? null,
          phase: body?.phase ?? null,
          category: body?.category ?? null,
          requirement_refs: Array.isArray(body?.requirement_refs) ? body.requirement_refs : [],
          steps: Array.isArray(body?.steps) ? body.steps : [],
          is_active: body?.is_active ?? true,
        };
        if (!row.code || !row.title) return jr({ error: "code and title required" }, 400);
        const { data, error } = await aml.from("acceptance_scenarios")
          .upsert(row, { onConflict: "tenant_id,code" }).select().single();
        if (error) return jr({ error: error.message }, 500);
        return jr({ scenario: data });
      }

      case "record_scenario_result": {
        requireMlro();
        const id = String(body?.id ?? "");
        const status = String(body?.status ?? "");
        if (!["passed", "failed", "blocked", "waived", "not_run"].includes(status)) return jr({ error: "invalid status" }, 400);
        const { data, error } = await aml.from("acceptance_scenarios")
          .update({
            last_status: status,
            last_run_at: new Date().toISOString(),
            last_run_by: userId,
            last_run_by_label: label,
            last_run_notes: body?.notes ?? null,
          })
          .eq("tenant_id", TENANT).eq("id", id).select().single();
        if (error) return jr({ error: error.message }, 500);
        return jr({ scenario: data });
      }

      case "delete_scenario": {
        requireMlro();
        const id = String(body?.id ?? "");
        const { error } = await aml.from("acceptance_scenarios").delete().eq("tenant_id", TENANT).eq("id", id);
        if (error) return jr({ error: error.message }, 500);
        return jr({ ok: true });
      }

      case "list_risks": {
        const { data } = await aml.from("risk_register").select("*")
          .eq("tenant_id", TENANT).order("status", { ascending: true }).order("impact", { ascending: false });
        return jr({ risks: data ?? [] });
      }

      case "upsert_risk": {
        requireMlro();
        const row = {
          tenant_id: TENANT,
          code: String(body?.code ?? "").trim(),
          title: String(body?.title ?? "").trim(),
          description: body?.description ?? null,
          category: body?.category ?? null,
          likelihood: body?.likelihood ?? "medium",
          impact: body?.impact ?? "medium",
          status: body?.status ?? "open",
          owner_label: body?.owner_label ?? null,
          mitigation: body?.mitigation ?? null,
          next_review_at: body?.next_review_at ?? null,
        };
        if (!row.code || !row.title) return jr({ error: "code and title required" }, 400);
        const { data, error } = await aml.from("risk_register")
          .upsert(row, { onConflict: "tenant_id,code" }).select().single();
        if (error) return jr({ error: error.message }, 500);
        return jr({ risk: data });
      }

      case "delete_risk": {
        requireMlro();
        const id = String(body?.id ?? "");
        const { error } = await aml.from("risk_register").delete().eq("tenant_id", TENANT).eq("id", id);
        if (error) return jr({ error: error.message }, 500);
        return jr({ ok: true });
      }

      case "list_certifications": {
        const { data } = await aml.from("launch_certifications").select("*")
          .eq("tenant_id", TENANT).order("created_at", { ascending: false }).limit(50);
        return jr({ certifications: data ?? [] });
      }

      case "certify_launch": {
        requireMlro();
        const stepUpErr = await requireStepUpSession({
          admin, userId, capability: "aml.configure",
          token: body?.step_up_session_token, headers: req.headers,
        });
        if (stepUpErr) return stepUpErr;

        const attestation = String(body?.attestation ?? "").trim();
        if (attestation.length < 20) return jr({ error: "Attestation statement (≥20 chars) is required" }, 400);

        const [{ data: gate }, { data: scen }, { data: risks }, { data: tenant }] = await Promise.all([
          aml.from("release_gates").select("id,status,ran_at,summary").order("ran_at", { ascending: false }).limit(1).maybeSingle(),
          aml.from("acceptance_scenarios").select("code,title,phase,last_status,last_run_at").eq("tenant_id", TENANT).eq("is_active", true),
          aml.from("risk_register").select("code,title,status,impact,likelihood").eq("tenant_id", TENANT),
          aml.from("tenant_settings").select("rollout_stage").eq("tenant_id", TENANT).maybeSingle(),
        ]);

        if (!gate || gate.status !== "pass") return jr({ error: "Latest release gate must be PASS to certify launch" }, 400);
        const failing = (scen ?? []).filter((r: any) => r.last_status === "failed" || r.last_status === "blocked");
        if (failing.length > 0) return jr({ error: `Cannot certify: ${failing.length} scenario(s) failing`, failing_scenarios: failing.map((r: any) => r.code) }, 400);
        const notRun = (scen ?? []).filter((r: any) => r.last_status === "not_run");
        if (notRun.length > 0) return jr({ error: `Cannot certify: ${notRun.length} scenario(s) never run`, not_run: notRun.map((r: any) => r.code) }, 400);
        const critOpen = (risks ?? []).filter((r: any) => r.status === "open" && r.impact === "critical");
        if (critOpen.length > 0) return jr({ error: `Cannot certify while open critical risks remain`, blocking_risks: critOpen.map((r: any) => r.code) }, 400);

        const { data, error } = await aml.from("launch_certifications").insert({
          tenant_id: TENANT, status: "issued",
          attested_by: userId, attested_by_label: label, attestation,
          release_gate_id: gate.id, release_gate_status: gate.status,
          rollout_stage: tenant?.rollout_stage ?? null,
          scenario_snapshot: scen ?? [], risk_snapshot: risks ?? [],
        }).select().single();
        if (error) return jr({ error: error.message }, 500);
        return jr({ certification: data });
      }

      case "revoke_certification": {
        requireMlro();
        const stepUpErr = await requireStepUpSession({
          admin, userId, capability: "aml.configure",
          token: body?.step_up_session_token, headers: req.headers,
        });
        if (stepUpErr) return stepUpErr;
        const id = String(body?.id ?? "");
        const reason = String(body?.reason ?? "").trim();
        if (!id || reason.length < 5) return jr({ error: "id and reason (≥5 chars) required" }, 400);
        const { data, error } = await aml.from("launch_certifications")
          .update({ status: "revoked", revoked_by: userId, revoked_by_label: label, revoked_reason: reason, revoked_at: new Date().toISOString() })
          .eq("tenant_id", TENANT).eq("id", id).eq("status", "issued").select().single();
        if (error) return jr({ error: error.message }, 500);
        return jr({ certification: data });
      }

      default:
        return jr({ error: `Unknown op: ${op}` }, 400);
    }
  } catch (e: any) {
    return jr({ ...internalError(e, 'aml-launch-ops') }, 500);
  }
});

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
