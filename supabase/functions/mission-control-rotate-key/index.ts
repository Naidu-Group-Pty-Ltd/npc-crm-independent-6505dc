// Rotates the Mission Control clone API key.
// 1. POST /api/public/clones/rotate-key with current key + { grace_hours, reason }
// 2. Persist new key into the MISSION_CONTROL_CLONE_API_KEY Supabase secret
//    via the Supabase Management API. Warm workers will pick it up on next
//    cold start; in the meantime the previous key continues to work for the
//    full grace period MC returns.
// Superadmin only.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders } from "../_shared/auth.ts";

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
const MC_BASE = (Deno.env.get("MISSION_CONTROL_URL") ?? "").replace(/\/+$/, "");
const MC_KEY = Deno.env.get("MISSION_CONTROL_CLONE_API_KEY") ?? "";
const SUPABASE_ACCESS_TOKEN = Deno.env.get("SUPABASE_ACCESS_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const PROJECT_REF = SUPABASE_URL.match(/https:\/\/([^.]+)\./)?.[1] ?? "";

async function updateSecret(name: string, value: string): Promise<void> {
  if (!SUPABASE_ACCESS_TOKEN || !PROJECT_REF) {
    throw new Error("SUPABASE_ACCESS_TOKEN or project ref not configured");
  }
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/secrets`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SUPABASE_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([{ name, value }]),
    },
  );
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Management API ${res.status}: ${txt}`);
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
  if (req.method !== "POST") {
    return new Response("method_not_allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    let body: any = {};
    try { body = await req.json(); } catch { /* empty */ }

    const auth = await verifyAuth(supabase, req.headers, body);
    if (auth.error || !auth.userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }
    const { data: role } = await supabase
      .from("user_roles").select("role")
      .eq("user_id", auth.userId).eq("role", "superadmin").maybeSingle();
    if (!role) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    const graceHours = Math.max(0, Math.min(168, Number(body?.grace_hours ?? 1)));
    const reason = String(body?.reason ?? "manual_rotation").slice(0, 280);

    if (!MC_BASE || !MC_KEY) {
      throw new Error("Mission Control not configured");
    }

    const mcRes = await fetch(`${MC_BASE}/api/public/clones/rotate-key`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-clone-api-key": MC_KEY,
      },
      body: JSON.stringify({ grace_hours: graceHours, reason }),
    });
    const mcText = await mcRes.text();
    let mcBody: any = {};
    try { mcBody = mcText ? JSON.parse(mcText) : {}; } catch { /* ignore */ }

    if (!mcRes.ok) {
      console.error("[mc-rotate] MC error", mcRes.status, mcText);
      return new Response(JSON.stringify({
        error: mcBody?.error ?? "mc_error",
        message: mcBody?.message ?? `Mission Control ${mcRes.status}`,
        status: mcRes.status,
      }), {
        status: mcRes.status,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    const newKey = mcBody?.key as string | undefined;
    const newPrefix = mcBody?.key_prefix as string | undefined;
    const revokeAt = mcBody?.revoke_at as string | undefined;

    if (!newKey) throw new Error("MC did not return a new key");

    // Persist into project secret (next cold-start picks it up).
    await updateSecret("MISSION_CONTROL_CLONE_API_KEY", newKey);

    // Audit log (never log the raw secret).
    await supabase.from("token_audit_log").insert({
      event: "key.rotated.manual",
      status: "ok",
      request_payload: {
        rotated_by: auth.userId,
        grace_hours: graceHours,
        reason,
        new_key_prefix: newPrefix ?? null,
        revoke_at: revokeAt ?? null,
      },
    });

    return new Response(JSON.stringify({
      ok: true,
      keyPrefix: newPrefix ?? null,
      revokeAt: revokeAt ?? null,
      note: "Secret updated. Warm workers will adopt the new key on next cold start; the previous key remains valid until revoke_at.",
    }), {
      status: 200,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (e) {
    console.error("[mission-control-rotate-key]", e);
    return new Response(JSON.stringify({ ...internalError(e, 'mission-control-rotate-key'), error: "internal_error" }), {
      status: 500, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
