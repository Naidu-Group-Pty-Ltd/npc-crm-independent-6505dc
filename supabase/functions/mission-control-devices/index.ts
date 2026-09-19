// Authenticated proxy for the Mission Control device-cap endpoints.
// Actions: register, heartbeat, release, list, revoke.
// All actions are scoped to the calling user. Superadmins may pass an
// explicit `external_user_id` to manage another user's devices.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders } from "../_shared/auth.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
import {
  registerDevice,
  heartbeatDevice,
  releaseDevice,
  listDevices,
} from "../_shared/missionControlDevices.ts";

Deno.serve(async (req) => {
  // Credentialed CORS: the app invokes this function with
  // credentials:'include' (HttpOnly session cookie), and browsers reject a
  // wildcard Access-Control-Allow-Origin at preflight for credentialed
  // requests — the POST never leaves the browser and the UI surfaces it as
  // "Failed to load". createCorsHeaders echoes the exact allow-listed origin
  // and sets Access-Control-Allow-Credentials.
  const corsHeaders = createCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let body: any = {};
    try { body = await req.json(); } catch { /* empty */ }

    const auth = await verifyAuth(supabase, req.headers, body);
    if (auth.error || !auth.userId) return json({ error: "Unauthorized" }, 401);

    const action = String(body?.action ?? "").toLowerCase();
    if (!action) return json({ error: "missing_action" }, 400);

    // Resolve target user — only superadmins can target someone else.
    let targetUserId = auth.userId;
    if (body?.external_user_id && body.external_user_id !== auth.userId) {
      const { data: role } = await supabase
        .from("user_roles").select("role")
        .eq("user_id", auth.userId).eq("role", "superadmin").maybeSingle();
      if (!role) return json({ error: "forbidden" }, 403);
      targetUserId = String(body.external_user_id);
    }

    switch (action) {
      case "register": {
        const fp = String(body?.device_fingerprint ?? "");
        if (!fp) return json({ error: "missing_device_fingerprint" }, 400);
        const result = await registerDevice({
          externalUserId: targetUserId,
          deviceFingerprint: fp,
          deviceLabel: body?.device_label ?? undefined,
          userAgent: body?.user_agent ?? undefined,
          platform: body?.platform ?? undefined,
        });
        if (!result.ok && result.error === "device_limit_reached") {
          return json(result, 402);
        }
        if (!result.ok) {
          console.warn("[mission-control-devices] register failed", result);
          return json(result, 200);
        }
        return json(result, 200);
      }
      case "heartbeat": {
        const id = String(body?.device_id ?? "");
        if (!id) return json({ error: "missing_device_id" }, 400);
        const result = await heartbeatDevice(id);
        return json(result, 200);
      }
      case "release": {
        const result = await releaseDevice({
          deviceId: body?.device_id ?? undefined,
          externalUserId: body?.device_id ? undefined : targetUserId,
          deviceFingerprint: body?.device_fingerprint ?? undefined,
          reason: body?.reason ?? "user_signed_out",
        });
        return json(result, 200);
      }
      case "list": {
        const result = await listDevices(targetUserId);
        return json(result, 200);
      }
      case "revoke": {
        const id = String(body?.device_id ?? "");
        if (!id) return json({ error: "missing_device_id" }, 400);
        const result = await releaseDevice({
          deviceId: id,
          reason: body?.reason ?? "user_revoked",
        });
        return json(result, 200);
      }
      default:
        return json({ error: "unknown_action" }, 400);
    }
  } catch (e) {
    console.error("[mission-control-devices]", e);
    return json({
      ...internalError(e, 'mission-control-devices'),
      error: "internal_error",
    }, 500);
  }
});
