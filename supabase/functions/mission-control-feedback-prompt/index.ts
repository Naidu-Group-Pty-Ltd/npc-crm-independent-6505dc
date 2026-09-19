// Should this workspace be asked for feedback right now?
//
// Same shape as mission-control-balance: the clone API key never leaves the
// server, the session is verified here, and CORS echoes the exact allow-listed
// origin because the app calls this with credentials included.
//
// The signed-in user is passed through so Mission Control can mint an
// attributed link — that is what makes a response traceable to a person rather
// than only to a workspace.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders } from "../_shared/auth.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { getFeedbackPrompt, MissionControlError } from "../_shared/missionControl.ts";

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

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
      /* empty */
    }

    const auth = await verifyAuth(supabase, req.headers, body);
    if (auth.error || !auth.userId) return json({ error: auth.error ?? "Unauthorized" }, 401);

    // The display name is best-effort — a prompt is not worth a second round
    // trip, and Mission Control records the id regardless.
    let username: string | null = null;
    try {
      const { data } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", auth.userId)
        .maybeSingle();
      username = data?.full_name ?? data?.email ?? null;
    } catch {
      /* not fatal */
    }

    return json(
      await getFeedbackPrompt({
        originUserId: auth.userId,
        originUsername: username,
      }),
    );
  } catch (e) {
    // A prompt is the least important thing on a dashboard. Unreachable or
    // unprovisioned means "not due" this load, never a broken screen.
    if (e instanceof MissionControlError) {
      console.warn("[mission-control-feedback-prompt]", e.message);
    } else {
      console.error("[mission-control-feedback-prompt] unexpected", e);
    }
    return json({ due: false });
  }
});
