/**
 * Phase 13 — Shared step-up enforcement.
 *
 * Verifies that the caller holds a live short-lived step-up session for the
 * requested capability. Session tokens are issued by `aml-step-up` and stored
 * hashed in `aml.step_up_sessions`.
 *
 * Returns null when the caller is authorised (or bypass=true). Returns a Response
 * error when the token is missing, mismatched, revoked, or expired.
 */
import { createCorsHeaders } from "../auth.ts";

async function sha256Hex(input: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

export interface RequireStepUpArgs {
  admin: any;
  userId: string;
  capability: "aml.report" | "aml.configure" | "aml.investigate" | "aml.view";
  token?: string | null;
  headers?: Headers;
  /**
   * The caller's own per-origin CORS headers. Optional: derived from
   * `headers`' Origin when absent, so a caller that forgets still emits a
   * refusal the browser will release to JS.
   */
  cors?: Record<string, string>;
}

export async function requireStepUpSession(args: RequireStepUpArgs): Promise<Response | null> {
  // Per-origin headers, never a wildcard. This path is LIVE - AmlGuard mounts
  // StepUpAuthDialog on ~20 routes - and a wildcard `Access-Control-Allow-Origin`
  // on a `credentials: 'include'` request is refused by the browser, so the
  // caller sees an opaque `Failed to fetch` instead of `step_up_required` and
  // is sent to diagnose a deployment that is healthy.
  const corsHeaders = args.cors ?? createCorsHeaders(args.headers?.get("origin") ?? null);
  const token = (args.token ?? args.headers?.get("x-aml-step-up-token") ?? "").toString().trim();
  if (!token) {
    return new Response(JSON.stringify({
      error: "Step-up required",
      code: "step_up_required",
      capability: args.capability,
    }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const hash = await sha256Hex(`${args.userId}:${args.capability}:${token}`);
  const { data, error } = await args.admin.schema("aml").from("step_up_sessions")
    .select("id, expires_at, revoked_at")
    .eq("user_id", args.userId).eq("capability", args.capability).eq("token_hash", hash)
    .maybeSingle();
  if (error || !data) {
    return new Response(JSON.stringify({
      error: "Invalid step-up session",
      code: "step_up_invalid",
      capability: args.capability,
    }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const live = !data.revoked_at && new Date(data.expires_at).getTime() > Date.now();
  if (!live) {
    return new Response(JSON.stringify({
      error: "Step-up session expired",
      code: "step_up_expired",
      capability: args.capability,
    }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  return null;
}
