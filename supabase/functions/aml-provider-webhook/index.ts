/**
 * Phase 4 — Signed provider webhook receiver.
 *
 * - HMAC-SHA256 signature via header `x-aml-signature`.
 * - Idempotent via UNIQUE (provider, dedup_key).
 * - Never accepts unsigned or replayed payloads. Failed verification is
 *   rejected before any service-role database access.
 *
 * Providers are opt-in per secret: AML_WEBHOOK_SECRET_<PROVIDER_UPPER>.
 * If the secret is missing, we reject the request rather than accept in the clear.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { verifyWebhookSignature } from "../_shared/aml/providers/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-correlation-id, x-step-up-token, x-aml-signature, x-aml-provider, x-aml-dedup-key",
  "Access-Control-Expose-Headers": "x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jr = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ error: "method_not_allowed" }, 405);

  const provider = (req.headers.get("x-aml-provider") ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "");
  const signature = req.headers.get("x-aml-signature") ?? "";
  const dedupKey = req.headers.get("x-aml-dedup-key") ?? "";
  if (!provider || !signature || !dedupKey) return jr({ error: "missing_headers" }, 400);

  const secretName = `AML_WEBHOOK_SECRET_${provider.toUpperCase().replace(/-/g, "_")}`;
  const secret = Deno.env.get(secretName);
  if (!secret) return jr({ error: `unknown_provider:${provider}` }, 400);

  const raw = await req.text();
  const ok = await verifyWebhookSignature(raw, signature, secret);
  if (!ok) return jr({ ok: false, reason: "invalid_signature" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let payload: any = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { /* keep empty */ }
  const eventType = String(payload?.event_type ?? payload?.type ?? "unknown");

  // Idempotent insert. If dedup_key exists, we treat as replay and short-circuit.
  const { data: existing } = await admin.schema("aml").from("provider_events")
    .select("id, processed_at, signature_ok").eq("provider", provider).eq("dedup_key", dedupKey).maybeSingle();
  if (existing) {
    return jr({ ok: true, replay: true, processed: Boolean(existing.processed_at) });
  }

  const identityCheckId = payload?.identity_check_id ?? null;
  const screeningCheckId = payload?.screening_check_id ?? null;

  const { data: evt, error: insertErr } = await admin.schema("aml").from("provider_events").insert({
    provider,
    event_type: eventType,
    dedup_key: dedupKey,
    signature_ok: ok,
    payload,
    identity_check_id: identityCheckId,
    screening_check_id: screeningCheckId,
  }).select().single();
  if (insertErr) return jr({ error: insertErr.message }, 500);

  // Apply state transitions here for real providers. Simulator has no callbacks.
  try {
    if (identityCheckId && payload?.status) {
      await admin.schema("aml").from("identity_checks").update({
        status: payload.status,
        overall_score: payload.overall_score ?? null,
        result_payload: payload.result ?? {},
        completed_at: new Date().toISOString(),
      }).eq("id", identityCheckId);
    }
    if (screeningCheckId && payload?.status) {
      await admin.schema("aml").from("screening_checks").update({
        status: payload.status,
        result_summary: payload.summary ?? {},
        completed_at: new Date().toISOString(),
      }).eq("id", screeningCheckId);
    }
    await admin.schema("aml").from("provider_events").update({ processed_at: new Date().toISOString() }).eq("id", evt.id);
    return jr({ ok: true, processed: true });
  } catch (e: any) {
    await admin.schema("aml").from("provider_events").update({ error: e?.message ?? "apply_failed" }).eq("id", evt.id);
    return jr({ ok: true, processed: false, error: e?.message }, 202);
  }
});
