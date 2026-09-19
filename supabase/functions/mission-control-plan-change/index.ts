// Mission Control plan-change proxy.
//
// Same shape as mission-control-balance and for the same reasons: the clone
// API key never leaves the server, the session cookie is verified here, and
// CORS echoes the exact allow-listed origin because the app calls this with
// credentials included.
//
// GET  — plan changes this workspace has not been shown yet.
// POST — acknowledge one, so it is shown exactly once.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders } from "../_shared/auth.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import {
  acknowledgePlanChange,
  getPlanChanges,
  MissionControlError,
} from "../_shared/missionControl.ts";

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Acknowledging is a state change, so it goes through the same exact-origin
  // CSRF guard as every other mutating function here. No-op for GET.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // deno-lint-ignore no-explicit-any
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      /* GET, or an empty POST */
    }

    const auth = await verifyAuth(supabase, req.headers, body);
    if (auth.error || !auth.userId) {
      return json({ error: auth.error ?? "Unauthorized" }, 401);
    }

    // The client always POSTs (invokeSecureFunction has no GET mode), so the
    // presence of `id` — not the HTTP verb — decides acknowledge vs. list.
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    if (id) {
      return json({ acknowledged: await acknowledgePlanChange(id) });
    }


    return json({ changes: await getPlanChanges() });
  } catch (e) {
    // A banner is the least important thing on this page. An unreachable or
    // not-yet-provisioned Mission Control means no notice on this load — the
    // change is still recorded and gets announced next time — never a broken
    // screen.
    if (e instanceof MissionControlError) {
      console.warn("[mission-control-plan-change]", e.message);
      return json({ changes: [] });
    }
    console.error("[mission-control-plan-change] unexpected", e);
    return json({ changes: [] });
  }
});
