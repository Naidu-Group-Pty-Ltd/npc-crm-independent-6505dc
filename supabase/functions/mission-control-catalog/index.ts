// Mission Control pricing catalog proxy.
// Authenticated read-only passthrough so the catalogue is reachable from
// the SPA without ever shipping the clone API key. Cached server-side.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders } from "../_shared/auth.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { fetchCatalog, type Catalog } from "../_shared/missionControlCatalog.ts";
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
    try { body = await req.json(); } catch { /* ignore */ }

    const auth = await verifyAuth(supabase, req.headers, body);
    if (auth.error || !auth.userId) {
      return new Response(
        JSON.stringify({ error: auth.error ?? "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "content-type": "application/json" } },
      );
    }

    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "1" || body?.force === true;
    const catalog: Catalog = await fetchCatalog({ force });

    return new Response(JSON.stringify(catalog), {
      status: 200,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (e) {
    const isMc = e instanceof MissionControlError;
    const status = isMc ? e.status : 500;
    const payload = isMc
      ? { error: e.code, message: e.message }
      : { error: "internal_error", message: e instanceof Error ? e.message : String(e) };
    console.error("[mission-control-catalog] error", payload);
    return new Response(JSON.stringify(payload), {
      status,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
