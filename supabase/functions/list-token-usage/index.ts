// Lists recent token_usage_history rows.
// - Regular users: only their own rows.
// - Admin/superadmin: all rows in the agency.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders } from "../_shared/auth.ts";

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
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
    try { body = await req.json(); } catch { /* */ }

    const auth = await verifyAuth(supabase, req.headers, body);
    if (auth.error || !auth.userId) {
      return new Response(JSON.stringify({ error: auth.error ?? "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    const limit = Math.min(Number(body?.limit ?? 100), 500);
    const scope: "mine" | "agency" = body?.scope === "agency" ? "agency" : "mine";

    let isAdmin = false;
    if (scope === "agency") {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", auth.userId);
      isAdmin = (roles ?? []).some((r: any) =>
        ["superadmin", "admin"].includes(String(r.role)),
      );
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: "forbidden" }), {
          status: 403, headers: { ...corsHeaders, "content-type": "application/json" },
        });
      }
    }

    let q = supabase
      .from("token_usage_history")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (scope === "mine") {
      q = q.eq("user_id", auth.userId);
    }

    const { data, error } = await q;
    if (error) throw error;
    return new Response(JSON.stringify({ rows: data ?? [] }), {
      status: 200, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (e) {
    console.error("[list-token-usage]", e);
    return new Response(JSON.stringify(internalError(e, 'list-token-usage')), {
      status: 500, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
