// Mission Control activation-gate proxy.
//
// The browser asks this function whether the workspace is open; this function
// asks Mission Control, which is the only thing that knows. The clone API key
// never leaves the server, exactly as in `mission-control-balance`.
//
// ## Two operations, one function
//
//   { }                       → the current verdict
//   { action: "checkout" }    → mint the activation Stripe Checkout URL
//
// ## It answers 200 with an OPEN verdict on every failure
//
// A gate screen that appears because Mission Control was briefly unreachable
// locks a paying customer out of their own dashboard. The enforcement that
// actually protects revenue is on Mission Control's side — it refuses a locked
// clone's token and seat reservations with 402 — so this surface is free to be
// generous. Every error path here therefore returns `gated: false`, and says
// `known: false` so a diagnostic can tell "definitely not gated" from "nobody
// answered".
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders } from "../_shared/auth.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import {
  fetchGateVerdict,
  startActivationCheckout,
} from "../_shared/paymentGate.ts";
import { unknownVerdict } from "../_shared/paymentGate.pure.ts";

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

  // The gate describes this workspace's billing state, so it is behind the
  // session like every other Mission Control proxy. A signed-out visitor is
  // never gated — the login page has to keep working, or a locked workspace
  // could not even reach support.
  const auth = await verifyAuth(supabase, req.headers, body);
  if (auth.error || !auth.userId) {
    return json({ error: auth.error ?? "Unauthorized" }, 401);
  }

  try {
    if (body.action === "checkout") {
      const result = await startActivationCheckout({
        returnUrl: typeof body.return_url === "string" ? body.return_url : null,
        contact:
          body.contact && typeof body.contact === "object"
            ? (body.contact as Record<string, string | null>)
            : null,
      });
      // A refusal is still a 200: the caller needs the fallback pricing URL out
      // of the body, and an error status sends it down a path that has none.
      return json(result);
    }

    const verdict = await fetchGateVerdict();
    return json(verdict);
  } catch (err) {
    console.error("[mission-control-gate] unexpected", err);
    // Open. See the header.
    return json(unknownVerdict());
  }
});
