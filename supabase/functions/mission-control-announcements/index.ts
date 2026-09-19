// Mission Control announcements proxy.
//
// The browser asks this function what platform notices the dashboard should
// be showing; this function asks Mission Control, which is the only thing
// that knows. The clone API key never leaves the server, exactly as in
// `mission-control-gate`.
//
// ## It answers 200 with an EMPTY list on every failure
//
// An announcement is the one thing on the dashboard that is allowed to
// simply not be there. Mission Control unreachable, unconfigured, slow,
// refusing — every one of those renders as "no notices", because the only
// alternative is a dashboard that errors over a message that was never
// critical to the workspace's own operation. Mission Control decides who
// sees what; this surface only carries the answer.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders } from "../_shared/auth.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { fetchAnnouncementsFromMissionControl } from "../_shared/announcements.ts";

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is the read */
  }

  // Behind the session like every other Mission Control proxy: notices are
  // for people using the workspace, and an unauthenticated caller learns
  // nothing — not even that the channel exists.
  const auth = await verifyAuth(supabase, req.headers, body);
  if (auth.error || !auth.userId) {
    return json({ error: auth.error ?? "Unauthorized" }, 401);
  }

  try {
    const payload = await fetchAnnouncementsFromMissionControl();
    return json(payload);
  } catch (err) {
    console.error("[mission-control-announcements] unexpected", err);
    // Empty. See the header.
    return json({ announcements: [] });
  }
});
