// Mission Control → Prime webhook receiver.
// Public endpoint (no JWT) — security is enforced via HMAC-SHA256 signature
// of the raw request body using MISSION_CONTROL_WEBHOOK_SECRET.
//
// Events handled:
//   tokens.balance.updated  → cache snapshot in token_balance_cache (best-effort)
//   tokens.key.rotated      → log audit + ops note
//   tokens.key.revoked      → log audit + ops note
//   tokens.alert            → log audit
//   tokens.test             → no-op success (used by MC's "Test" button)
//
// Delivery is at-least-once with retries; receiver MUST be idempotent.
// We de-dupe via token_webhook_events (id + event PK).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "content-type, x-correlation-id, x-step-up-token, x-mc-event, x-mc-signature, x-mc-idempotency-key",
  "Access-Control-Expose-Headers": "x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (clean.length % 2 !== 0) return new Uint8Array();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) return new Uint8Array();
    out[i] = byte;
  }
  return out;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length === 0 || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function hmacSha256Hex(secret: string, body: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return new Uint8Array(sig);
}

function adminClient() {
  const url = (Deno.env.get("SUPABASE_URL") || "").trim();
  const key = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  if (!url || !key) return null;
  return createClient(url, key);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("method_not_allowed", { status: 405, headers: corsHeaders });
  }

  const secret = Deno.env.get("MISSION_CONTROL_WEBHOOK_SECRET");
  if (!secret) {
    console.error("[mission-control-webhook] MISSION_CONTROL_WEBHOOK_SECRET not configured");
    return new Response("unconfigured", { status: 500, headers: corsHeaders });
  }

  const signature = req.headers.get("x-mc-signature") ?? "";
  const event = req.headers.get("x-mc-event") ?? "";
  const idemKey = req.headers.get("x-mc-idempotency-key") ?? "";
  const raw = await req.text();

  const expected = await hmacSha256Hex(secret, raw);
  const provided = hexToBytes(signature);
  if (!constantTimeEqual(provided, expected)) {
    console.warn("[mission-control-webhook] invalid signature", { event });
    return new Response("invalid_signature", { status: 401, headers: corsHeaders });
  }

  let payload: any = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { /* keep empty */ }
  const data = payload?.data ?? payload ?? {};

  const client = adminClient();

  /*
   * Can this deployment actually REACH the identity provider?
   *
   * Mission Control's door to the same probe the Command Centre offers a
   * reviewer. The question cannot be answered from Mission Control's side
   * alone: on the brokered route the clone's own Mission Control key, its
   * scopes, Mission Control's Didit credential and the vendor all sit between
   * this function and an answer, and only a call made HERE crosses all four.
   * Every readiness reading either end holds was green on three tenants that
   * had never completed a verification, which is why this is a call rather
   * than a flag.
   *
   * ANSWERED BEFORE THE DE-DUPE, deliberately. Everything below this line is
   * an event to be applied exactly once; a probe is a question asked NOW, and
   * asking it twice must ask it twice. Keyed like an event it would answer
   * the second caller from a table without making the call — which is
   * precisely the stale reading it exists to replace.
   *
   * It spends nothing (the request is deliberately incomplete, so the vendor
   * rejects it at validation), writes no record, and is never metered. The
   * result travels in the RESPONSE and is stored nowhere.
   */
  if (event === "verification.selftest") {
    const { probeStandaloneRoute } = await import(
      "../_shared/aml/providers/diditStandaloneClient.ts"
    );
    const probe = await probeStandaloneRoute();
    return new Response(JSON.stringify({ ok: true, event, probe }), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  /*
   * The full loop, with real image parts.
   *
   * Separate from the probe on purpose. The probe's guarantee is that it
   * spends nothing; this one sends real captures and a 2xx from any of the
   * three calls is a billable unit, so folding them into one event would make
   * a free diagnostic quietly start billing. A caller has to ask for this by
   * name.
   *
   * Answered before the de-dupe for the same reason the probe is: it is a
   * question asked now, not an event to be applied once.
   */
  if (event === "verification.loopcheck") {
    const { runStandaloneLoopCheck } = await import(
      "../_shared/aml/providers/diditStandaloneLoopCheck.ts"
    );
    const report = await runStandaloneLoopCheck();
    return new Response(JSON.stringify({ ok: true, event, report }), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  /*
   * Can this deployment actually reach ANTHROPIC?
   *
   * The same question as the verification probe above and the same reason for
   * asking it here: on the federated route this clone's own Mission Control
   * key, that key's scope, Mission Control's signing key, whether Anthropic
   * can fetch the published key set and whether the federation rule still
   * matches this clone's subject all sit between an edge function and an
   * answer — and only a call made HERE crosses all five. Every one of them
   * fails silently, at inference time, on a report somebody is waiting for.
   *
   * Answered before the de-dupe for the reason the verification probe is: a
   * probe is a question asked NOW, and keyed like an event it would answer the
   * second caller out of a table without making the call.
   *
   * It spends nothing — a federated exchange is not billable and the model
   * list is metadata, so no tokens are consumed — and it is deliberately not a
   * message, which would cost money on every click. It takes a FRESH
   * credential rather than the cached one, because a cached token outlives the
   * chain that minted it by up to an hour and would answer green for that hour
   * after federation broke. Nothing is written and no credential value ever
   * leaves this function.
   */
  if (event === "anthropic.selftest") {
    const { describeAnthropicReach } = await import("../_shared/anthropicCredential.ts");
    const { reach } = await describeAnthropicReach({ freshCredential: true });
    return new Response(JSON.stringify({ ok: true, event, reach }), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  // De-dupe on (event, idempotency-key), falling back to a digest of the raw
  // body. NEVER key on tenant id alone: that made the FIRST balance event for
  // a tenant permanently block every later one, freezing token_balance_cache.
  // Retries of the same delivery share a body (same occurred_at) so the
  // digest still de-dupes them; distinct events hash differently.
  let dedupeId = idemKey;
  if (!dedupeId && raw) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${event}:${raw}`));
    dedupeId = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  if (!dedupeId) dedupeId = crypto.randomUUID();
  if (client) {
    try {
      const { error } = await client.from("token_webhook_events").insert({
        id: dedupeId,
        event,
        payload: data,
      });
      if (error && !String(error.message).includes("duplicate")) {
        console.warn("[mission-control-webhook] dedupe insert failed", error.message);
      } else if (error) {
        // Already processed — return ok to stop retries.
        return new Response("ok", { headers: corsHeaders });
      }
    } catch (e) {
      console.warn("[mission-control-webhook] dedupe table missing or insert errored", e);
    }
  }

  try {
    switch (event) {
      case "tokens.test":
        // MC dashboard "Test" button — no-op success.
        break;

      case "tokens.balance.updated": {
        if (client) {
          const tenant = data?.tenant ?? {};
          const balance = data?.balance ?? {};
          await client.from("token_balance_cache").upsert({
            tenant_ref: tenant?.external_ref ?? tenant?.ref ?? null,
            available: Number(balance?.available ?? 0),
            reserved: Number(balance?.reserved ?? 0),
            lifetime_granted: Number(balance?.lifetime_granted ?? 0),
            lifetime_spent: Number(balance?.lifetime_spent ?? 0),
            plan_name: tenant?.billing_plans?.name ?? null,
            monthly_allowance: Number(tenant?.billing_plans?.monthly_allowance ?? 0),
            current_period_end: tenant?.current_period_end ?? null,
            updated_at: new Date().toISOString(),
          }, { onConflict: "tenant_ref" });
        }
        break;
      }
      case "tokens.key.rotated": {
        // If MC pushed the new secret to us, update the project secret so
        // workers adopt it on next cold start. (Manual rotation does this inline.)
        const newKey: string | undefined = data?.new_key ?? data?.key ?? data?.secret;
        let secretUpdated = false;
        if (newKey && typeof newKey === "string" && newKey.length > 8) {
          try {
            const token = Deno.env.get("SUPABASE_ACCESS_TOKEN") ?? "";
            const ref = (Deno.env.get("SUPABASE_URL") ?? "").match(/https:\/\/([^.]+)\./)?.[1] ?? "";
            if (token && ref) {
              const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/secrets`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify([{ name: "MISSION_CONTROL_CLONE_API_KEY", value: newKey }]),
              });
              secretUpdated = r.ok;
              if (!r.ok) console.error("[mc-webhook] secret update failed", r.status, await r.text());
            }
          } catch (err) {
            console.error("[mc-webhook] secret update error", err);
          }
        }
        if (client) {
          await client.from("token_audit_log").insert({
            event: "webhook:tokens.key.rotated",
            agency_ref: data?.tenant?.external_ref ?? null,
            status: "ok",
            request_payload: {
              key_prefix: data?.key_prefix ?? null,
              revoke_at: data?.revoke_at ?? null,
              secret_updated: secretUpdated,
              had_new_key: Boolean(newKey),
            },
          });
        }
        break;
      }
      case "tokens.key.revoked":
      case "tokens.alert": {
        // Mission Control cascading a report-cost reprice. Drop this
        // instance's catalog cache so the next report it prices reads the new
        // index immediately instead of waiting out the TTL. Other warm
        // instances pick it up on their own 5-minute refresh — the catalog is
        // pull-based, so the cascade makes propagation prompt, not atomic.
        if (event === "tokens.alert" && data?.alert === "report_cost_index_updated") {
          try {
            const { invalidateCatalogCache } = await import("../_shared/missionControlCatalog.ts");
            invalidateCatalogCache();
            console.log("[mission-control-webhook] report cost index updated", {
              version: data?.version ?? null,
              changed: Array.isArray(data?.changed_slugs) ? data.changed_slugs : [],
            });
          } catch (e) {
            console.warn("[mission-control-webhook] catalog invalidate failed", e);
          }
        }
        if (client) {
          const { error: auditError } = await client.from("token_audit_log").insert({
            event: `webhook:${event}`,
            agency_ref: data?.tenant?.external_ref ?? null,
            status: event.endsWith("revoked") ? "error" : "ok",
            request_payload: data,
            error_message: event === "tokens.key.revoked"
              ? `MC key ${data?.key_id ?? "?"} revoked`
              : null,
          });
          if (auditError) {
            console.warn("[mission-control-webhook] audit insert", auditError.message);
          }
        }
        break;
      }

      // ── Seat events ──
      case "seats.reserved":
      case "seats.committed":
      case "seats.released":
        if (client) {
          await client.from("token_audit_log").insert({
            event: `webhook:${event}`,
            agency_ref: data?.tenant?.external_ref ?? null,
            status: "ok",
            request_payload: data,
          });
        }
        break;
      case "seats.limit.approaching":
        if (client) {
          await client.from("system_alerts").insert({
            kind: "seats.limit.approaching",
            severity: "warning",
            message: `Seat usage at ${data?.seats_used ?? "?"}/${data?.seat_limit ?? "?"} on plan ${data?.plan ?? "?"} — approaching limit.`,
            payload: data,
          });
          await client.from("token_audit_log").insert({
            event: `webhook:${event}`,
            agency_ref: data?.tenant?.external_ref ?? null,
            status: "ok",
            request_payload: data,
          });
        }
        break;
      case "seats.limit.reached":
        if (client) {
          await client.from("system_alerts").insert({
            kind: "seats.limit.reached",
            severity: "critical",
            message: `Seat limit reached (${data?.seat_limit ?? "?"}) on plan ${data?.plan ?? "?"} — new invites are blocked until you upgrade.`,
            payload: data,
          });
          await client.from("token_audit_log").insert({
            event: `webhook:${event}`,
            agency_ref: data?.tenant?.external_ref ?? null,
            status: "error",
            request_payload: data,
            error_message: "seat_limit_reached",
          });
        }
        break;
      case "seats.plan.changed":
        if (client) {
          await client.from("system_alerts").insert({
            kind: "seats.plan.changed",
            severity: "info",
            message: `Plan changed to ${data?.plan?.name ?? data?.plan ?? "new plan"} (seat limit ${data?.plan?.seat_limit ?? "?"}).`,
            payload: data,
          });
          await client.from("token_audit_log").insert({
            event: `webhook:${event}`,
            agency_ref: data?.tenant?.external_ref ?? null,
            status: "ok",
            request_payload: data,
          });
        }
        break;

      // ── Device-cap events ──
      case "devices.registered":
      case "devices.released":
        if (client) {
          await client.from("token_audit_log").insert({
            event: `webhook:${event}`,
            agency_ref: data?.tenant?.external_ref ?? null,
            status: "ok",
            request_payload: data,
          });
        }
        break;
      case "devices.limit.reached":
        if (client) {
          await client.from("system_alerts").insert({
            kind: "devices.limit.reached",
            severity: "warning",
            message: `Device limit reached for user ${data?.external_user_id ?? "?"} (${data?.devices_active ?? "?"}/${data?.device_limit ?? "?"}).`,
            payload: data,
          });
          await client.from("token_audit_log").insert({
            event: `webhook:${event}`,
            agency_ref: data?.tenant?.external_ref ?? null,
            status: "error",
            request_payload: data,
            error_message: "device_limit_reached",
          });
        }
        break;

      default:
        console.log("[mission-control-webhook] unhandled event", event);
    }
  } catch (e) {
    console.error("[mission-control-webhook] handler error", e);
    // Still return 200 so MC does not retry indefinitely on our internal errors.
  }

  return new Response("ok", { headers: corsHeaders });
});
