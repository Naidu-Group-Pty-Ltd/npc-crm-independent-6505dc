// Saved payment methods proxy (billing & usage page).
// Lists / manages this install's wallet in Mission Control: display
// references only (brand / last4 / expiry) — card data itself lives at
// Stripe and is captured on the Aurixa storefront via a Stripe-hosted page.
// Reads and mutations (reorder / make-primary / remove) are restricted to
// admins because even display-only card metadata is sensitive billing data.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders } from "../_shared/auth.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { requireAdmin } from "../_shared/authz.ts";
import {
  listPaymentMethods,
  managePaymentMethod,
  MissionControlError,
  type PaymentMethodAction,
} from "../_shared/missionControl.ts";

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let body: any = {};
    try { body = await req.json(); } catch { /* allow empty */ }

    const auth = await verifyAuth(supabase, req.headers, body);
    if (auth.error || !auth.userId) {
      return json({ error: auth.error ?? "Unauthorized" }, 401);
    }

    const authorization = await requireAdmin(supabase, auth);
    if (!authorization.ok) return json({ error: "forbidden" }, 403);

    const action = String(body?.action ?? "list");

    if (action === "list") {
      const result = await listPaymentMethods();
      return json(result);
    }

    let mcAction: PaymentMethodAction;
    if (action === "sync_default") {
      // No payload: Mission Control re-reads the wallet and pushes the primary
      // card onto the Stripe customer. Repairs drift without reordering cards.
      mcAction = { action: "sync_default" };
    } else if (action === "make_primary" && typeof body?.paymentMethodId === "string") {
      mcAction = { action: "make_primary", paymentMethodId: body.paymentMethodId };
    } else if (action === "remove" && typeof body?.paymentMethodId === "string") {
      mcAction = { action: "remove", paymentMethodId: body.paymentMethodId };
    } else if (
      action === "reorder" &&
      Array.isArray(body?.orderedIds) &&
      body.orderedIds.every((id: unknown) => typeof id === "string")
    ) {
      mcAction = { action: "reorder", orderedIds: body.orderedIds };
    } else {
      return json({ error: "invalid_action" }, 400);
    }

    const result = await managePaymentMethod(mcAction);
    return json(result);
  } catch (e) {
    const isMc = e instanceof MissionControlError;
    const status = isMc ? e.status : 500;
    const payload = isMc
      ? { error: e.code, message: e.message }
      : { error: "internal_error", message: e instanceof Error ? e.message : String(e) };
    console.error("[mission-control-payment-methods] error", payload);
    return json(payload, status);
  }
});
