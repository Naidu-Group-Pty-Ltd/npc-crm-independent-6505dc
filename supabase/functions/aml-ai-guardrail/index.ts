/**
 * Phase 13 — AML AI Guardrail.
 *
 * Aurixa Agent proposes any AML write action here. The proposal is stored and
 * a human MLRO must approve/reject before it can be executed. The AI itself
 * NEVER executes; execution is recorded only when a human calls `execute`
 * (which returns the payload for the caller to apply through the normal edge fn).
 *
 * POST { op, ...args }
 *   op: 'propose'  { tool_name, action_summary, arguments, proposer_context } -> { id }
 *   op: 'list'     { status? } -> { approvals }
 *   op: 'decide'   { id, decision: 'approved'|'rejected', reason? } -> { ok }
 *   op: 'execute'  { id, execution_result } -> { ok }   (called after human runs the action)
 *   op: 'expire_stale' -> { expired }
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

async function sha256Hex(input: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function audit(admin: any, category: string, summary: string, payload: any, actorId: string | null, actorLabel: string | null) {
  const aml = admin.schema("aml");
  const { data: prev } = await aml.from("records_audit_events")
    .select("row_hash").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const prevHash = prev?.row_hash ?? null;
  const now = new Date().toISOString();
  const rowHash = await sha256Hex(JSON.stringify({ category, summary, payload, actor_id: actorId, actor_label: actorLabel, prev_hash: prevHash, created_at: now }));
  await aml.from("records_audit_events").insert({
    category, summary, payload, actor_id: actorId, actor_label: actorLabel,
    prev_hash: prevHash, row_hash: rowHash, created_at: now,
  });
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
    const { data: canWrite } = await admin.rpc("has_aml_write_role", { _user_id: userId });
    const { data: isMlro } = await admin.rpc("has_aml_role", { _user_id: userId, _role: "mlro" });

    const op = body?.op as string;

    switch (op) {
      case "propose": {
        if (!canWrite) return jr({ error: "Write role required" }, 403);
        const tool_name = String(body.tool_name ?? "").trim();
        const action_summary = String(body.action_summary ?? "").trim();
        const args = body.arguments ?? {};
        if (!tool_name || !action_summary) return jr({ error: "tool_name and action_summary required" }, 400);
        const { data, error } = await aml.from("ai_action_approvals").insert({
          tool_name, action_summary, arguments: args,
          proposer: userLabel ?? userId,
          proposer_context: body.proposer_context ?? null,
        }).select("id, expires_at").single();
        if (error) return jr({ error: error.message }, 500);
        await audit(admin, "ai_guardrail", `AI proposed: ${tool_name}`, { id: data.id, action_summary }, userId, userLabel);
        return jr({ id: data.id, expires_at: data.expires_at });
      }
      case "list": {
        const status = body.status as string | undefined;
        let q = aml.from("ai_action_approvals").select("*").order("created_at", { ascending: false }).limit(200);
        if (status) q = q.eq("status", status);
        const { data, error } = await q;
        if (error) return jr({ error: error.message }, 500);
        return jr({ approvals: data ?? [] });
      }
      case "decide": {
        if (!isMlro) return jr({ error: "Only MLRO can decide AI proposals" }, 403);
        const id = String(body.id ?? "");
        const decision = body.decision as "approved" | "rejected";
        if (!id || !["approved", "rejected"].includes(decision)) return jr({ error: "Bad id/decision" }, 400);
        const { data: row } = await aml.from("ai_action_approvals").select("status, tool_name").eq("id", id).maybeSingle();
        if (!row) return jr({ error: "Not found" }, 404);
        if (row.status !== "pending") return jr({ error: `Already ${row.status}` }, 409);
        const { error } = await aml.from("ai_action_approvals").update({
          status: decision, decided_by: userId, decided_by_label: userLabel,
          decided_at: new Date().toISOString(), decision_reason: body.reason ?? null,
        }).eq("id", id);
        if (error) return jr({ error: error.message }, 500);
        await audit(admin, "ai_guardrail", `AI proposal ${decision}: ${row.tool_name}`, { id, reason: body.reason ?? null }, userId, userLabel);
        return jr({ ok: true });
      }
      case "execute": {
        if (!isMlro) return jr({ error: "Only MLRO can mark executed" }, 403);
        const id = String(body.id ?? "");
        if (!id) return jr({ error: "Missing id" }, 400);
        const { data: row } = await aml.from("ai_action_approvals").select("status, tool_name").eq("id", id).maybeSingle();
        if (!row) return jr({ error: "Not found" }, 404);
        if (row.status !== "approved") return jr({ error: `Cannot execute from status ${row.status}` }, 409);
        const { error } = await aml.from("ai_action_approvals").update({
          status: "executed", execution_result: body.execution_result ?? null,
        }).eq("id", id);
        if (error) return jr({ error: error.message }, 500);
        await audit(admin, "ai_guardrail", `AI proposal executed by human: ${row.tool_name}`, { id }, userId, userLabel);
        return jr({ ok: true });
      }
      case "expire_stale": {
        const { data, error } = await aml.from("ai_action_approvals")
          .update({ status: "expired" })
          .eq("status", "pending").lt("expires_at", new Date().toISOString())
          .select("id");
        if (error) return jr({ error: error.message }, 500);
        return jr({ expired: (data ?? []).length });
      }
      default:
        return jr({ error: "Unknown op" }, 400);
    }
  } catch (e) {
    return jr({ ...internalError(e, 'aml-ai-guardrail') }, 500);
  }
});

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
