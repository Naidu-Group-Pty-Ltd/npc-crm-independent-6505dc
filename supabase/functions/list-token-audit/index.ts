// Admin audit log reader for Mission Control reserve/commit/hold/release events.
// Restricted to admin / superadmin roles. Returns rows across the agency.
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

    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", auth.userId);
    const isAdmin = (roles ?? []).some((r: any) =>
      ["superadmin", "admin"].includes(String(r.role)),
    );
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    const limit = Math.min(Number(body?.limit ?? 200), 1000);
    const filterUser: string | null = body?.userId || null;
    const filterEvent: string | null = body?.event || null;

    let q = supabase
      .from("token_audit_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (filterUser) q = q.eq("user_id", filterUser);
    if (filterEvent) q = q.eq("event", filterEvent);

    const { data, error } = await q;
    if (error) throw error;

    // Hydrate usernames for display
    const userIds = Array.from(new Set((data ?? []).map((r: any) => r.user_id).filter(Boolean)));
    let userMap: Record<string, string> = {};
    if (userIds.length) {
      const { data: users } = await supabase
        .from("custom_users")
        .select("id, username, email")
        .in("id", userIds);
      for (const u of users ?? []) {
        userMap[u.id] = u.username || u.email || u.id;
      }
    }

    return new Response(JSON.stringify({ rows: data ?? [], users: userMap }), {
      status: 200, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (e) {
    console.error("[list-token-audit]", e);
    return new Response(JSON.stringify(internalError(e, 'list-token-audit')), {
      status: 500, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
