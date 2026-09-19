// Report metering middleware.
// Wraps an edge function handler with Mission Control reserve → run → commit/hold/release.
// Adds tokensUsed/tokensReserved/estimatedTokens/durationMs to JSON responses
// and matching x-* headers. Logs every reserve/commit/hold/release event to
// token_audit_log and a final outcome row to token_usage_history.
//
// BILLING INVARIANT: a report that does not finish successfully must cost the
// caller nothing. That needs three things, all of which live here:
//   1. Intermediate chunks of a multi-call generation are HELD, never
//      committed — committing after section 1 closed the Mission Control job
//      and made every later failure unrefundable.
//   2. Any failure (non-2xx, a `success: false` body, or a thrown handler)
//      RELEASES the job — canceling the reservation, or refunding it when an
//      earlier call already committed it.
//   3. Reservations are taken with a TTL long enough to span the whole chunked
//      run, so a held reservation cannot expire mid-generation.

import {
  reserveTokens,
  commitTokens,
  releaseTokens,
  InsufficientTokensError,
  MissionControlError,
  AGENCY_TENANT_REF,
  type ReleaseResult,
  type ReserveResult,
  type TokenKind,
} from "./missionControl.ts";
import {
  applyEstimateOptions,
  estimateTokens,
  type EstimateOptions,
} from "./tokenEstimator.ts";
import {
  decideMeteringOutcome,
  investmentReportRunKeyPrefix,
  resolveReservationTtlSeconds,
} from "./reportMeteringOutcome.pure.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { verifyAuth } from "./auth.ts";

function adminClient() {
  const url = (Deno.env.get("SUPABASE_URL") || "").trim();
  const key = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function resolveUserId(req: Request, body: any): Promise<string | null> {
  try {
    const client = adminClient();
    if (!client) return null;
    const { userId } = await verifyAuth(client, req.headers, body);
    if (userId === "service_role") return body?.userId || body?.created_by || body?.user_id || null;
    return userId || null;
  } catch (e) {
    console.warn("[reportMetering] resolveUserId failed", e);
    return null;
  }
}

export interface MeteringPlan {
  kind: TokenKind;
  userId: string;
  idempotencyKey: string;
  estimateOptions?: EstimateOptions;
  requestPayload?: Record<string, unknown>;
  estimatedTokensOverride?: number;
  functionName?: string;
  /** Reservation lifetime. Defaults to MC_RESERVATION_TTL_SECONDS (2h) so a
   *  held reservation survives a full chunked generation. */
  ttlSeconds?: number;
}

export type PlanResolver = (
  body: any,
  req: Request,
) => Promise<MeteringPlan | null> | MeteringPlan | null;

const baseCors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-session-token, x-portal-session-token",
  "Access-Control-Expose-Headers": "x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms",
};

function corsFor(req: Request) {
  const origin = req.headers.get("origin");
  return origin ? { ...baseCors, "Access-Control-Allow-Origin": origin } : baseCors;
}

/**
 * Header carrying the epoch-ms at which this wrapper first saw the request.
 *
 * The wrapper's own work — auth, the price lookup, the reserve — happens before
 * the handler starts, so a handler that budgets its wall clock from its own
 * first line is blind to however long that took. Usually ~4.5s; when Mission
 * Control stalls it has been 115s, which walked `compare-investment-reports`
 * straight through the browser's 150s abort while every individual piece
 * "worked". Server-side only: the header is set on the rebuilt internal
 * request, never sent by a browser, so no CORS allow-list is involved.
 */
export const METERING_RECEIVED_AT_HEADER = "x-metering-received-at";

function rebuildRequest(req: Request, body: any, receivedAt: number): Request {
  const headers = new Headers(req.headers);
  headers.set(METERING_RECEIVED_AT_HEADER, String(receivedAt));
  if (body === undefined) {
    return new Request(req.url, { method: req.method, headers });
  }
  return new Request(req.url, { method: req.method, headers, body: JSON.stringify(body) });
}

async function logAudit(row: Record<string, unknown>) {
  try {
    const client = adminClient();
    if (!client) return;
    await client.from("token_audit_log").insert(row);
  } catch (e) {
    console.warn("[reportMetering] audit log failed", e);
  }
}

async function logUsage(row: Record<string, unknown>) {
  try {
    const client = adminClient();
    if (!client) return;
    await client.from("token_usage_history").insert(row);
  } catch (e) {
    console.warn("[reportMetering] usage log failed", e);
  }
}

const reservationTtlSeconds = resolveReservationTtlSeconds(
  Deno.env.get("MC_RESERVATION_TTL_SECONDS"),
);

export function withReportMetering(
  resolvePlan: PlanResolver,
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    if (req.method === "OPTIONS") return handler(req);

    const receivedAt = Date.now();
    let body: any = undefined;
    try {
      const text = await req.text();
      body = text ? JSON.parse(text) : undefined;
    } catch { body = undefined; }
    const forwardReq = rebuildRequest(req, body, receivedAt);
    const cors = corsFor(req);

    let plan: MeteringPlan | null = null;
    try { plan = await resolvePlan(body, req); }
    catch (e) {
      console.warn("[reportMetering] plan resolver threw, bypassing metering", e);
      plan = null;
    }

    console.log("[reportMetering] plan resolved", {
      hasPlan: !!plan,
      hasUserId: !!plan?.userId,
      hasIdempotencyKey: !!plan?.idempotencyKey,
      kind: plan?.kind,
    });

    if (!plan || !plan.userId || !plan.idempotencyKey) {
      console.warn("[reportMetering] bypassing metering — plan/userId/idempotencyKey missing", {
        hasBody: body !== undefined,
        hasPlan: !!plan,
        userId: plan?.userId ?? null,
        idempotencyKey: plan?.idempotencyKey ?? null,
      });
      return handler(forwardReq);
    }

    const functionName = plan.functionName || (() => {
      try { return new URL(req.url).pathname.split("/").filter(Boolean).pop() || "unknown"; }
      catch { return "unknown"; }
    })();

    // ── What does this report cost? ────────────────────────────────────────
    // Mission Control's report cost index is the price list, and it has a row
    // for EVERY kind this repo meters — so an operator repricing a report
    // there changes what we charge with no deploy here.
    //
    // Resolution order, and why:
    //   1. the index, keyed by the metering `kind` we resolved server-side.
    //      Keyed by kind rather than a caller-supplied slug so it applies to
    //      every report automatically and cannot be steered from the request.
    //   2. an explicit `__catalog.report_slug`, for callers that price a
    //      specific catalogue product rather than a generic kind. The slug is
    //      still resolved AGAINST the index — a `credit_cost` in the request
    //      body is ignored, because the browser must not be able to name its
    //      own price.
    //   3. the local heuristic in tokenEstimator.ts, when Mission Control is
    //      unreachable or the kind is unlisted. Pricing must never be able to
    //      block a report.
    //
    // The balance is denominated in billing credits, so a credit_cost maps 1:1
    // onto reserved balance. MC_TOKENS_PER_CREDIT stays a knob (default 1) in
    // case the balance is ever re-scaled to raw tokens — it must NOT re-inflate
    // credits back into thousands of LLM tokens.
    let catalogTokens: number | null = null;
    let priceSource = "heuristic";
    let indexVersion = "";
    try {
      const { getCreditCostForKind, getReportCreditCost, getReportCostIndexVersion } =
        await import("./missionControlCatalog.ts");

      const slugHint = body?.__catalog?.report_slug;
      let credits = await getCreditCostForKind(plan.kind);
      if (credits != null) priceSource = "index:kind";

      if (credits == null && slugHint) {
        credits = await getReportCreditCost(String(slugHint));
        if (credits != null) priceSource = "index:slug";
      }

      if (credits != null && credits > 0) {
        const perCredit = Number(Deno.env.get("MC_TOKENS_PER_CREDIT") ?? "1");
        catalogTokens = Math.max(1, Math.ceil(credits * (isFinite(perCredit) ? perCredit : 1)));
      } else if (credits === 0) {
        // A deliberate zero-cost report. Distinct from "unpriced": reserve
        // nothing rather than falling through to the heuristic.
        catalogTokens = 0;
      }
      indexVersion = await getReportCostIndexVersion();
    } catch (e) {
      console.warn("[reportMetering] cost index lookup failed", e);
    }

    // The catalogue controls the base price, while server-resolved options
    // scale that price for the amount of work in this request. Applying the
    // same modifiers to both catalogue and fallback prices prevents a large
    // report from being charged as a single flat unit whenever the index is
    // available. A deliberately free catalogue entry remains free.
    const adjustedCatalogTokens = catalogTokens == null
      ? null
      : catalogTokens === 0
      ? 0
      : applyEstimateOptions(catalogTokens, plan.estimateOptions);
    const estimated =
      adjustedCatalogTokens ??
      (plan.estimatedTokensOverride && plan.estimatedTokensOverride > 0
        ? plan.estimatedTokensOverride
        : estimateTokens(plan.kind, plan.estimateOptions));

    console.log("[reportMetering] priced", {
      kind: plan.kind,
      estimated,
      source: catalogTokens != null ? priceSource : priceSource,
      indexVersion,
    });

    const startedAt = Date.now();
    let reservation: ReserveResult | null = null;
    // Operator-assigned tracking id for this tenant/clone, echoed by Mission
    // Control on reserve. Stamped onto usage/audit rows so token usage joins
    // Stripe payments (which carry the same billing_user_id) on one key.
    let billingUserId: string | null = null;
    try {
      reservation = await reserveTokens({
        kind: plan.kind,
        estimatedTokens: estimated,
        idempotencyKey: plan.idempotencyKey,
        userId: plan.userId,
        requestPayload: plan.requestPayload,
        // Mission Control only honours the TTL on the call that CREATES the
        // job; later chunks reserve idempotently against the same key. It must
        // therefore be long enough for the whole run up front.
        ttlSeconds: plan.ttlSeconds ?? reservationTtlSeconds,
      });
      billingUserId = reservation.billingUserId ?? null;
      await logAudit({
        event: "reserve",
        user_id: plan.userId,
        billing_user_id: billingUserId,
        agency_ref: AGENCY_TENANT_REF,
        function_name: functionName,
        kind: plan.kind,
        idempotency_key: plan.idempotencyKey,
        job_id: reservation.jobId,
        requested_tokens: estimated,
        reserved_tokens: reservation.reserved,
        available_tokens: reservation.available,
        status: "ok",
        request_payload: plan.requestPayload ?? null,
      });
    } catch (e) {
      if (e instanceof InsufficientTokensError) {
        await logAudit({
          event: "reserve",
          user_id: plan.userId,
          agency_ref: AGENCY_TENANT_REF,
          function_name: functionName,
          kind: plan.kind,
          idempotency_key: plan.idempotencyKey,
          requested_tokens: estimated,
          available_tokens: e.available,
          status: "insufficient_funds",
          error_message: e.message,
          request_payload: plan.requestPayload ?? null,
        });
        await logUsage({
          user_id: plan.userId,
          agency_ref: AGENCY_TENANT_REF,
          function_name: functionName,
          kind: plan.kind,
          idempotency_key: plan.idempotencyKey,
          estimated_tokens: estimated,
          status: "insufficient_funds",
          error_message: e.message,
          duration_ms: Date.now() - startedAt,
          request_payload: plan.requestPayload ?? null,
        });
        return new Response(
          JSON.stringify({
            success: false,
            error: {
              code: "insufficient_funds",
              message: e.message,
              available: e.available,
              requested: e.requested,
            },
          }),
          { status: 402, headers: { ...cors, "Content-Type": "application/json" } },
        );
      }
      if (e instanceof MissionControlError && e.code === "unconfigured") {
        // Metering is intentionally OFF in environments where Mission Control
        // is not set up at all — bypass is by design, not a dependency failure.
        console.warn("[reportMetering] Mission Control unconfigured — bypassing");
        return handler(forwardReq);
      }
      // FAIL CLOSED (Phase 9): Mission Control IS configured but the reserve
      // errored (transient / network / 5xx). Previously we ran the paid handler
      // for free, so an attacker could exhaust paid credits by forcing MC
      // errors. Refuse the request instead; the caller can retry.
      const msg = e instanceof Error ? e.message : "metering_unavailable";
      console.error("[reportMetering] reserve failed — failing closed", e);
      await logAudit({
        event: "reserve",
        user_id: plan.userId,
        agency_ref: AGENCY_TENANT_REF,
        function_name: functionName,
        kind: plan.kind,
        idempotency_key: plan.idempotencyKey,
        requested_tokens: estimated,
        status: "error",
        error_message: msg,
        request_payload: plan.requestPayload ?? null,
      });
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: "metering_unavailable",
            message: "Usage metering is temporarily unavailable. Please retry shortly.",
          },
        }),
        { status: 503, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // Release helper shared by every failure path below. Refunds when the job
    // was already committed by an earlier chunk of the same run, so a late
    // failure still leaves the caller charged nothing.
    const releaseForFailure = async (reason: string): Promise<ReleaseResult> => {
      const release = await releaseTokens(reservation!.jobId, reason);
      await logAudit({
        event: "release",
        user_id: plan!.userId,
        billing_user_id: billingUserId,
        agency_ref: AGENCY_TENANT_REF,
        function_name: functionName,
        kind: plan!.kind,
        idempotency_key: plan!.idempotencyKey,
        job_id: reservation!.jobId,
        reserved_tokens: reservation!.reserved,
        used_tokens: 0,
        status: release.ok ? "ok" : "error",
        reason: `${reason}:${release.outcome}`,
        error_message: release.error ?? null,
      });
      return release;
    };

    let response: Response;
    try {
      response = await handler(forwardReq);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "handler_threw";
      const release = await releaseForFailure(msg);
      await logUsage({
        user_id: plan.userId,
        billing_user_id: billingUserId,
        agency_ref: AGENCY_TENANT_REF,
        function_name: functionName,
        kind: plan.kind,
        idempotency_key: plan.idempotencyKey,
        estimated_tokens: estimated,
        reserved_tokens: reservation!.reserved,
        actual_tokens: 0,
        status: release.ok ? "failed" : "failed_release_pending",
        error_message: msg,
        duration_ms: Date.now() - startedAt,
        job_id: reservation!.jobId,
      });
      throw err;
    }

    const durationMs = Date.now() - startedAt;
    const contentType = response.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");
    let responseBody: unknown = undefined;
    if (isJson) {
      try { responseBody = await response.clone().json(); } catch { responseBody = undefined; }
    }

    const headerUsedRaw = response.headers.get("x-mc-tokens-used");
    const outcome = decideMeteringOutcome({
      ok: response.ok,
      status: response.status,
      body: responseBody,
      headerUsedTokens: headerUsedRaw ? Number(headerUsedRaw) : 0,
      estimatedTokens: estimated,
    });

    if (outcome.action === "release") {
      const release = await releaseForFailure(outcome.reason);
      await logUsage({
        user_id: plan.userId,
        billing_user_id: billingUserId,
        agency_ref: AGENCY_TENANT_REF,
        function_name: functionName,
        kind: plan.kind,
        idempotency_key: plan.idempotencyKey,
        estimated_tokens: estimated,
        reserved_tokens: reservation!.reserved,
        actual_tokens: 0,
        status: release.ok ? "failed" : "failed_release_pending",
        error_message: outcome.reason,
        duration_ms: durationMs,
        job_id: reservation!.jobId,
        request_payload: plan.requestPayload ?? null,
      });
      return response;
    }

    if (outcome.action === "hold") {
      // A chunk landed but the report is not finished. Leave the reservation
      // open — no commit, no usage-history row (that table records final
      // outcomes only) — so a failure in a later chunk can still release it.
      await logAudit({
        event: "hold",
        user_id: plan.userId,
        billing_user_id: billingUserId,
        agency_ref: AGENCY_TENANT_REF,
        function_name: functionName,
        kind: plan.kind,
        idempotency_key: plan.idempotencyKey,
        job_id: reservation!.jobId,
        reserved_tokens: reservation!.reserved,
        used_tokens: 0,
        status: "ok",
        reason: outcome.reason,
      });
      return annotate(response, responseBody, isJson, {
        tokensUsed: 0,
        tokensPending: reservation!.reserved,
        tokensReserved: reservation!.reserved,
        estimatedTokens: estimated,
        durationMs,
      });
    }

    const actual = outcome.actualTokens;
    let committed = true;
    try {
      await commitTokens(reservation!.jobId, actual);
      await logAudit({
        event: "commit",
        user_id: plan.userId,
        billing_user_id: billingUserId,
        agency_ref: AGENCY_TENANT_REF,
        function_name: functionName,
        kind: plan.kind,
        idempotency_key: plan.idempotencyKey,
        job_id: reservation!.jobId,
        reserved_tokens: reservation!.reserved,
        used_tokens: actual,
        status: "ok",
      });
    } catch (e) {
      // The work succeeded but the debit did not land. Surface it on the audit
      // trail instead of swallowing it — silently under-charging is a defect
      // in the same ledger the over-charging fix protects.
      committed = false;
      const msg = e instanceof Error ? e.message : "commit_failed";
      console.error("[reportMetering] commit failed", e);
      await logAudit({
        event: "commit",
        user_id: plan.userId,
        billing_user_id: billingUserId,
        agency_ref: AGENCY_TENANT_REF,
        function_name: functionName,
        kind: plan.kind,
        idempotency_key: plan.idempotencyKey,
        job_id: reservation!.jobId,
        reserved_tokens: reservation!.reserved,
        used_tokens: actual,
        status: "error",
        error_message: msg,
      });
    }

    await logUsage({
      user_id: plan.userId,
      billing_user_id: billingUserId,
      agency_ref: AGENCY_TENANT_REF,
      function_name: functionName,
      kind: plan.kind,
      idempotency_key: plan.idempotencyKey,
      estimated_tokens: estimated,
      reserved_tokens: reservation!.reserved,
      actual_tokens: committed ? actual : 0,
      duration_ms: durationMs,
      status: committed ? "success" : "success_uncharged",
      job_id: reservation!.jobId,
      request_payload: plan.requestPayload ?? null,
    });

    return annotate(response, responseBody, isJson, {
      tokensUsed: committed ? actual : 0,
      tokensReserved: reservation!.reserved,
      estimatedTokens: estimated,
      durationMs,
    });
  };
}

/** Merge usage metadata into a JSON response body and mirror it onto headers. */
function annotate(
  response: Response,
  parsedBody: unknown,
  isJson: boolean,
  usageMeta: Record<string, number>,
): Response {
  const headers = new Headers(response.headers);
  headers.set("x-tokens-used", String(usageMeta.tokensUsed));
  headers.set("x-tokens-reserved", String(usageMeta.tokensReserved));
  headers.set("x-tokens-estimated", String(usageMeta.estimatedTokens));
  headers.set("x-duration-ms", String(usageMeta.durationMs));

  if (isJson && parsedBody !== undefined) {
    const merged =
      parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody)
        ? { ...(parsedBody as Record<string, unknown>), ...usageMeta }
        : { data: parsedBody, ...usageMeta };
    return new Response(JSON.stringify(merged), { status: response.status, headers });
  }
  return new Response(response.body, { status: response.status, headers });
}

export function buildIdempotencyKey(
  prefix: string,
  parts: Array<string | number | null | undefined>,
): string {
  const safe = parts.map((p) => String(p ?? "").trim().toLowerCase()).join("|");
  return `${prefix}:${safe}`;
}

// ── Out-of-band release ─────────────────────────────────────────────────────
// Chunked generation is driven from the browser: the client calls the edge
// function once per section. When the client gives up (a section exhausted its
// retries, the tab was closed, a request timed out client-side) the last edge
// call may well have returned 200, so the wrapper above never sees the
// failure. The reservation is only HELD at that point — it would eventually
// expire without ever being debited — but the report is already marked
// `failed`, and leaving credits pinned for hours is its own kind of wrong.
// This releases them immediately, and refunds the run if some earlier call did
// commit it.

export interface ReportRunReleaseSummary {
  jobsReleased: number;
  tokensReleased: number;
  failures: number;
}

/**
 * Release every Mission Control job taken for the CURRENT generation run of an
 * investment report.
 *
 * Scoping is deliberately tight. `investment_reports.current_version` only
 * advances when a report finishes successfully, so the current version's
 * reservations are exactly this (failed) run's — a previously completed,
 * legitimately paid version carries a lower version in its idempotency key and
 * is never touched.
 */
export async function releaseInvestmentReportRunTokens(
  reportId: string,
  reason: string,
): Promise<ReportRunReleaseSummary> {
  const summary: ReportRunReleaseSummary = { jobsReleased: 0, tokensReleased: 0, failures: 0 };
  if (!reportId) return summary;

  const client = adminClient();
  if (!client) return summary;

  try {
    const { data: report } = await client
      .from("investment_reports")
      .select("current_version")
      .eq("id", reportId)
      .maybeSingle();

    const prefix = investmentReportRunKeyPrefix(reportId, report?.current_version ?? "");
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: rows, error } = await client
      .from("token_audit_log")
      .select("job_id, idempotency_key, user_id, billing_user_id, kind, function_name, reserved_tokens")
      .eq("agency_ref", AGENCY_TENANT_REF)
      .like("idempotency_key", `${prefix}%`)
      .not("job_id", "is", null)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.warn("[reportMetering] release lookup failed", error.message);
      return summary;
    }

    const seen = new Set<string>();
    for (const row of rows ?? []) {
      const jobId = String((row as any).job_id ?? "");
      if (!jobId || seen.has(jobId)) continue;
      seen.add(jobId);

      // Idempotent in Mission Control: a job that is already canceled or
      // refunded comes back as a no-op rather than a double refund.
      const release = await releaseTokens(jobId, reason);
      if (release.ok) {
        summary.jobsReleased += 1;
        summary.tokensReleased += release.releasedTokens;
      } else {
        summary.failures += 1;
      }

      await logAudit({
        event: "release",
        user_id: (row as any).user_id ?? null,
        billing_user_id: (row as any).billing_user_id ?? null,
        agency_ref: AGENCY_TENANT_REF,
        function_name: (row as any).function_name ?? "release-report-run",
        kind: (row as any).kind ?? null,
        idempotency_key: (row as any).idempotency_key,
        job_id: jobId,
        reserved_tokens: (row as any).reserved_tokens ?? 0,
        used_tokens: 0,
        status: release.ok ? "ok" : "error",
        reason: `${reason}:${release.outcome}`,
        error_message: release.error ?? null,
      });
    }
  } catch (e) {
    console.warn("[reportMetering] releaseInvestmentReportRunTokens failed", e);
  }

  return summary;
}
