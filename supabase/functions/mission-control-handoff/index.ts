// Mission Control billing handoff proxy (user-attributed pricing workflow).
// Verifies the signed-in command-center user, then asks Mission Control to
// mint a single-use attributed deep link into the Aurixa Systems storefront
// pricing page — the user's identity travels server-to-server under the clone
// API key; the browser only ever receives the opaque handoff URL.
//
// The handoff also carries the buyer's contact details. Mission Control seeds
// the tenant's Stripe Customer from them, which is what makes Stripe's hosted
// checkout and card-save pages arrive prefilled — Checkout takes its email from
// the attached Customer, so a Customer with no email means every buyer retypes
// it. Two sources, deliberately:
//   • the PERSON  — email, first/last name, phone from their `custom_users` row
//   • the WORKSPACE — company name and ABN from the branding settings, which
//     are the same for every staff member and already configured once
//
// Contract with the frontend: ALWAYS returns 200 with `{ url: string | null }`
// (plus handoffId/expiresAt on success). A null url tells the caller to fall
// back to the static storefront pricing URL (AURIXA_PRICING_URL) — a purchase
// CTA must never hard-fail because attribution was unavailable.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders } from "../_shared/auth.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { createBillingHandoff } from "../_shared/missionControl.ts";
import { getBrandConfig } from "../_shared/brand-config.ts";
import { normalizeAustralianBusinessNumber } from "../_shared/billingIdentity.ts";

// "save_card" is the wallet flow: the storefront auto-launches a Stripe
// setup-mode Checkout instead of a purchase (billing & usage page).
const MODES = new Set(["topup", "seat_plan", "setup_package", "save_card"]);

// Intents that are not purchase modes but should still be recorded on the
// handoff. "docs" mints a token the documentation site resolves to learn this
// workspace's plan and add-ons; recording it means a docs handoff is
// distinguishable from a checkout one in Mission Control's audit trail.
const RECORDED_INTENTS = new Set(["docs"]);

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
    try { body = await req.json(); } catch { /* allow empty */ }

    const auth = await verifyAuth(supabase, req.headers, body);
    if (auth.error || !auth.userId) {
      return new Response(
        JSON.stringify({ error: auth.error ?? "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "content-type": "application/json" } },
      );
    }

    // intent: a purchase mode ('topup' | 'seat_plan' | 'setup_package'),
    // optionally narrowed to one item; anything else ('pricing', 'catalog')
    // means "browse the whole catalog" and sends no restriction.
    const rawIntent = typeof body?.intent === "string" ? body.intent : "";
    const itemId = typeof body?.itemId === "string" ? body.itemId.slice(0, 100) : "";
    const intent = MODES.has(rawIntent)
      ? itemId
        ? `${rawIntent}:${itemId}`
        : rawIntent
      : RECORDED_INTENTS.has(rawIntent)
        ? rawIntent
        : undefined;

    // Return link back into this app; Mission Control validates the host
    // against this clone's registered deploy_url.
    const originHeader = req.headers.get("origin") ?? "";
    const returnPath = typeof body?.returnPath === "string" && body.returnPath.startsWith("/")
      ? body.returnPath
      : "/";
    const returnUrl = originHeader.startsWith("https://")
      ? `${originHeader}${returnPath}`
      : undefined;

    // Buyer contact details, so Stripe's hosted page arrives prefilled instead
    // of asking for an email and name we already hold. Best-effort: a lookup
    // failure degrades to the previous behaviour rather than blocking the CTA.
    // Nothing here is read from the request body — the identity comes from the
    // verified session, so a caller cannot inject someone else's details.
    let contact: {
      email?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      phone?: string | null;
      company?: string | null;
      taxId?: string | null;
      taxIdType?: string | null;
    } | undefined;
    if (auth.userId !== "service_role") {
      try {
        const { data: profile } = await supabase
          .from("custom_users")
          .select("email, first_name, last_name, phone")
          .eq("id", auth.userId)
          .maybeSingle();
        if (profile) {
          contact = {
            email: profile.email ?? null,
            firstName: profile.first_name ?? null,
            lastName: profile.last_name ?? null,
            phone: profile.phone ?? null,
          };
        }
      } catch (e) {
        console.warn("[mission-control-handoff] contact lookup failed", e);
      }
    }

    // Company name and ABN come from the workspace, not the person: they are
    // the same for every staff member and are already configured once under
    // Templates → Global Report Settings (`global_report_settings.contact_details`). Sending
    // them means the buyer never types either — the company name becomes the
    // Stripe Customer's name on every tax invoice, and a checksum-valid ABN is
    // pre-attached so Stripe's tax-ID form doesn't even appear.
    try {
      const brand = await getBrandConfig(supabase);
      const billingAbn = normalizeAustralianBusinessNumber(brand.abn);
      if (brand.companyName || billingAbn) {
        contact = {
          ...(contact ?? {}),
          company: brand.companyName || null,
          taxId: billingAbn,
          taxIdType: billingAbn ? "au_abn" : null,
        };
      }
    } catch (e) {
      console.warn("[mission-control-handoff] brand lookup failed", e);
    }

    try {
      const handoff = await createBillingHandoff({
        originUserId: auth.userId,
        originUsername: auth.username ?? null,
        intent,
        returnUrl,
        contact,
      });
      return new Response(
        JSON.stringify({
          url: handoff.url,
          handoffId: handoff.handoffId,
          expiresAt: handoff.expiresAt,
        }),
        { status: 200, headers: { ...corsHeaders, "content-type": "application/json" } },
      );
    } catch (e) {
      // Attribution is best-effort — degrade to the static URL client-side.
      console.error("[mission-control-handoff] mint failed", e);
      return new Response(JSON.stringify({ url: null }), {
        status: 200,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }
  } catch (e) {
    console.error("[mission-control-handoff] error", e);
    return new Response(
      JSON.stringify({ url: null, error: e instanceof Error ? e.message : String(e) }),
      { status: 200, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }
});
