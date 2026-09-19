/**
 * Drain `api_usage_log` into Mission Control's per-tenant API-key metering.
 *
 * WHY THIS EXISTS
 * ---------------
 * A workspace provisioned by Mission Control boots with the prime's own vendor
 * keys — OPENAI_API_KEY, RESEND_API_KEY, DOMAIN_API_KEY, COTALITY_API_KEY and
 * the rest — written into its Supabase project. Every call made on one of those
 * is billed to the prime's account, so Mission Control recharges it. A key the
 * workspace supplied itself costs the prime nothing and is charged at nothing:
 * that decision is made in Mission Control, from its own record of what it
 * forwarded, and never from anything this function claims.
 *
 * WHY IT IS A WORKER AND NOT AN INLINE CALL
 * -----------------------------------------
 * Metering on the request path would put a network hop in front of a client's
 * report to buy a billing nicety, and would lose the call outright whenever
 * Mission Control was slow. Rows queue in `api_usage_log` instead and this
 * drains them, so an outage delays revenue rather than destroying it. The row
 * id is the idempotency key, so a retried batch is recognised as the same calls
 * rather than metered twice.
 *
 * AUTH: pg_cron / internal callers only — `x-internal-edge-secret`, or the
 * dedicated MARKET_INGESTION_CRON_SECRET-style token this repo already uses for
 * scheduled work. Never public: it reads a billing queue.
 */
import { createClient } from "npm:@supabase/supabase-js@2.55.0";
import { toReportableEvent, type UsageLogRow } from "../_shared/apiUsageBilling.pure.ts";
import { verifyRequiredCronSecret } from "../_shared/requestSecurity.ts";
import {
  reportApiUsage,
  USAGE_REPORT_MAX_EVENTS,
  MissionControlError,
} from "../_shared/missionControl.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** Constant-time string compare — a timing oracle on a cron secret is still an oracle. */

function authorized(req: Request): boolean {
  // WP-24: this used to read `x-internal-edge-secret` off the request and
  // compare it here. Two things were wrong with that.
  //
  // A static shared secret in a header is the legacy internal-auth path WP-12
  // Phase C hard-locked: a genuine edge-function caller must use
  // `callInternalFunction`, which signs the body, so a leaked header value is
  // not by itself a key to the billing queue. `check-internal-legacy-fallback.mjs`
  // has been failing on exactly this line, on `main`, for as long as the job it
  // lives in has been red.
  //
  // And the comparison was hand-rolled. `verifyRequiredCronSecret` is the shared
  // one — constant-time, and it refuses a secret shorter than the minimum rather
  // than quietly accepting a weak one, which the `length < 16` check below it
  // was doing by hand and only for two specific variables.
  //
  // What remains is the scheduled-caller path: a cron secret presented as
  // `Authorization: Bearer …` or `X-Cron-Secret`, which is how every other
  // scheduled worker in this repo is invoked.
  const cron = Deno.env.get("MARKET_INGESTION_CRON_SECRET") ?? "";
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const cronHeader = (req.headers.get("x-cron-secret") ?? "").trim();

  return verifyRequiredCronSecret(cron, bearer) || verifyRequiredCronSecret(cron, cronHeader);
}

/**
 * How many batches one invocation drains. Five × 200 covers a busy hour with
 * room to spare, and stops well short of the edge wall-clock ceiling — a run
 * that times out mid-batch would leave rows claimed but unmarked, which the
 * retry counter then burns through for nothing.
 */
const MAX_BATCHES = 5;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  if (!authorized(req)) {
    return json({ error: "unauthorized" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const summary = {
    batches: 0,
    scanned: 0,
    reported: 0,
    billable: 0,
    unmappable: 0,
    failed: 0,
    errors: [] as string[],
  };

  try {
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const { data: rows, error } = await supabase.rpc("claim_api_usage_for_forwarding", {
        _limit: USAGE_REPORT_MAX_EVENTS,
      });
      if (error) throw new Error(`claim failed: ${error.message}`);
      if (!rows || rows.length === 0) break;

      summary.batches += 1;
      summary.scanned += rows.length;

      const events = [];
      const eventRowIds = new Map<string, string>();
      const unmappable: Array<{ id: string; error: string }> = [];

      for (const row of rows as UsageLogRow[]) {
        const event = toReportableEvent(row);
        if (!event) {
          // Either the service has no known credential, or the call consumed
          // nothing. Both are terminal for this row — count the attempt so it
          // ages out of the queue instead of being re-read forever, and keep
          // the reason so an unmapped vendor is visible rather than silent.
          unmappable.push({ id: row.id, error: `unmappable_service:${row.service_name}` });
          continue;
        }
        events.push(event);
        eventRowIds.set(event.idempotency_key, row.id);
      }
      summary.unmappable += unmappable.length;

      const reported: Array<{ id: string; reason: string }> = [];
      const failed: Array<{ id: string; error: string }> = [...unmappable];

      if (events.length > 0) {
        try {
          const result = await reportApiUsage(events);
          summary.billable += result.billable;
          for (const outcome of result.results) {
            const rowId = eventRowIds.get(outcome.idempotency_key);
            if (!rowId) continue;
            if (outcome.ok) {
              reported.push({ id: rowId, reason: outcome.billing_reason ?? "accepted" });
            } else {
              failed.push({ id: rowId, error: outcome.error ?? "rejected" });
            }
          }
        } catch (e) {
          // A transport failure is not the rows' fault. Count the attempt on
          // every event in the batch and stop: hammering a down Mission Control
          // for four more batches only burns the retry budget.
          const message = e instanceof MissionControlError ? `${e.code}: ${e.message}` : String(e);
          summary.errors.push(message.slice(0, 300));
          for (const [, rowId] of eventRowIds) failed.push({ id: rowId, error: message.slice(0, 300) });
          await supabase.rpc("mark_api_usage_forwarded", { _reported: [], _failed: failed });
          summary.failed += failed.length;
          return json({ ok: false, ...summary }, 502);
        }
      }

      const { error: markError } = await supabase.rpc("mark_api_usage_forwarded", {
        _reported: reported,
        _failed: failed,
      });
      if (markError) {
        // The events are metered but we could not record that. Mission Control
        // is idempotent on the row id, so the next run re-sends them and they
        // land as duplicates rather than a second charge — say so loudly and
        // stop rather than draining more.
        throw new Error(`mark failed after reporting ${reported.length}: ${markError.message}`);
      }

      summary.reported += reported.length;
      summary.failed += failed.length;

      // A short batch means the queue is drained.
      if (rows.length < USAGE_REPORT_MAX_EVENTS) break;
    }

    return json({ ok: true, ...summary });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[report-api-usage] drain failed:", message);
    summary.errors.push(message.slice(0, 300));
    return json({ ok: false, ...summary }, 500);
  }
});
