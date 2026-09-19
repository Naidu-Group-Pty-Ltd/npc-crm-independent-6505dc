// Read all token_audit_log + token_usage_history rows for one idempotency key.
// Users may look up keys for their own generations; admins may look up any key.
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

    const idempotencyKey: string = String(body?.idempotencyKey ?? "").trim();
    if (!idempotencyKey) {
      return new Response(JSON.stringify({ error: "missing_idempotency_key" }), {
        status: 400, headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    const { data: roles } = await supabase
      .from("user_roles").select("role").eq("user_id", auth.userId);
    const isAdmin = (roles ?? []).some((r: any) =>
      ["superadmin", "admin"].includes(String(r.role)),
    );

    let auditQ = supabase
      .from("token_audit_log")
      .select("*")
      .eq("idempotency_key", idempotencyKey)
      .order("created_at", { ascending: true });
    let usageQ = supabase
      .from("token_usage_history")
      .select("*")
      .eq("idempotency_key", idempotencyKey)
      .order("created_at", { ascending: true });

    if (!isAdmin) {
      auditQ = auditQ.eq("user_id", auth.userId);
      usageQ = usageQ.eq("user_id", auth.userId);
    }

    const [{ data: events, error: eErr }, { data: outcomes, error: oErr }] = await Promise.all([
      auditQ, usageQ,
    ]);
    if (eErr) throw eErr;
    if (oErr) throw oErr;

    const userIds = Array.from(
      new Set([...(events ?? []), ...(outcomes ?? [])].map((r: any) => r.user_id).filter(Boolean)),
    );
    let users: Record<string, string> = {};
    if (userIds.length) {
      const { data: us } = await supabase
        .from("custom_users").select("id, username, email").in("id", userIds);
      for (const u of us ?? []) users[u.id] = u.username || u.email || u.id;
    }

    return new Response(JSON.stringify({
      idempotencyKey,
      events: events ?? [],
      outcomes: outcomes ?? [],
      users,
      isAdmin,
    }), {
      status: 200, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (e) {
    console.error("[get-token-event-trail]", e);
    return new Response(JSON.stringify(internalError(e, 'get-token-event-trail')), {
      status: 500, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
