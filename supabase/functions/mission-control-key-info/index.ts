// Returns metadata about the current Mission Control clone API key
// (prefix only, never the secret) plus the last successful metering call.
// Superadmin only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders } from "../_shared/auth.ts";

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
function prefixOf(key: string | undefined): string | null {
  if (!key) return null;
  // mck_xxxxxxxxxxxx -> "mck_xxxxxx…"
  const head = key.slice(0, 10);
  const tail = key.slice(-4);
  return `${head}…${tail}`;
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

    const key = Deno.env.get("MISSION_CONTROL_CLONE_API_KEY") ?? "";
    const baseUrl = Deno.env.get("MISSION_CONTROL_URL") ?? "";

    // Best-effort: last successful audit row for any MC call.
    const { data: lastOk } = await supabase
      .from("token_audit_log")
      .select("created_at, event")
      .eq("status", "ok")
      .order("created_at", { ascending: false })
      .limit(1).maybeSingle();

    // Last rotation event (from webhook).
    const { data: lastRotated } = await supabase
      .from("token_audit_log")
      .select("created_at, request_payload")
      .eq("event", "webhook:tokens.key.rotated")
      .order("created_at", { ascending: false })
      .limit(1).maybeSingle();

    return new Response(JSON.stringify({
      configured: Boolean(key),
      keyPrefix: prefixOf(key),
      keyLength: key.length,
      baseUrl: baseUrl || null,
      lastSuccessfulCallAt: lastOk?.created_at ?? null,
      lastRotatedAt: lastRotated?.created_at ?? null,
    }), {
      status: 200,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (e) {
    console.error("[mission-control-key-info]", e);
    return new Response(JSON.stringify({ ...internalError(e, 'mission-control-key-info'), error: "internal_error" }), {
      status: 500, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
