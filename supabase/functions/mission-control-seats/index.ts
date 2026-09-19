// Superadmin-only proxy for the Mission Control seat entitlement + list APIs.
// Used by the Settings → Plan & Seats card. The clone API key never leaves
// the server.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders } from "../_shared/auth.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { getSeatEntitlement, listSeats } from "../_shared/missionControlSeats.ts";
import { MissionControlError } from "../_shared/missionControl.ts";

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

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

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

    const includeList = body?.include_list !== false;
    const status = (body?.status ?? "active") as "active" | "reserved" | "removed";
    const limit = Math.min(200, Math.max(1, Number(body?.limit ?? 50)));
    const offset = Math.max(0, Number(body?.offset ?? 0));

    const [entitlement, seats] = await Promise.all([
      getSeatEntitlement(),
      includeList ? listSeats({ status, limit, offset }) : Promise.resolve(null),
    ]);

    return new Response(JSON.stringify({
      entitlement,
      seats: seats?.seats ?? [],
      total: seats?.total ?? 0,
    }), {
      status: 200,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (e) {
    console.error("[mission-control-seats]", e);
    const isMc = e instanceof MissionControlError;
    const status = isMc ? (e.status === 401 ? 502 : e.status) : 500;
    const payload = isMc
      ? {
          error: e.code,
          message:
            e.code === "unauthorized"
              ? "Mission Control rejected the seat-entitlement request. The clone API key may not be entitled for the seats endpoints — please verify in Mission Control."
              : e.message,
          mc_status: e.status,
        }
      : { error: "internal_error", message: e instanceof Error ? e.message : String(e) };
    return new Response(JSON.stringify(payload), {
      status,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
