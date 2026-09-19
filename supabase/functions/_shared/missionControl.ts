// Mission Control token client — reserve / commit / cancel / balance / packs.
// Aurixa Mission Control is the single source of truth for billing.
// This module is the ONLY place that talks to its public token API.
//
// API contract: see prime-repo-token-integration_1.md
//   - auth header:        x-clone-api-key
//   - request payload:    snake_case (tenant_ref, estimated_tokens, idempotency_key, …)
//   - balance response:   { tenant, balance: { available, reserved, lifetime_granted, lifetime_spent } }
//   - rate-limited:       60 req/min/key, 429 + Retry-After
//   - idempotent retries: same idempotency_key returns existing job

import { validateFeedbackUrl } from "./feedbackUrlPolicy.ts";

const BASE_URL = (Deno.env.get("MISSION_CONTROL_URL") ?? "").replace(/\/+$/, "");
const API_KEY = Deno.env.get("MISSION_CONTROL_CLONE_API_KEY") ?? "";

// Stable per-agency tenant ref. Single-agency install → Supabase project ref.
const PROJECT_REF =
  Deno.env.get("SUPABASE_URL")?.match(/https:\/\/([^.]+)\./)?.[1] ?? "prime";
export const AGENCY_TENANT_REF = `prime:${PROJECT_REF}`;
export const AGENCY_DISPLAY_NAME = Deno.env.get("MISSION_CONTROL_AGENCY_NAME") ?? "Prime";

export type TokenKind =
  | "report.investment.compass"
  | "report.investment.executive"
  | "report.investment.snapshot"
  | "report.investment.financial"
  | "report.suburb.compass"
  | "report.postcode.compass"
  | "report.market-intelligence"
  | "report.portfolio-review"
  | "report.bulk-item"
  | "report.chart-analysis"
  | "report.qualitative-regen"
  | "aml_identity_check"
  | "aml_screening_check";

export interface ReserveArgs {
  kind: TokenKind;
  estimatedTokens: number;
  idempotencyKey: string;
  userId: string;
  requestPayload?: Record<string, unknown>;
  ttlSeconds?: number;
}

export interface ReserveResult {
  jobId: string;
  reserved: number;
  available: number;
  idempotent?: boolean;
  status?: string;
  /** Operator-assigned tracking id for this tenant/clone (Mission Control). */
  billingUserId?: string | null;
}

export interface BalanceResult {
  /**
   * Priced add-on slugs this workspace currently holds, from Mission Control.
   *
   * Plan-tier gating alone can never decide an add-on — a separately-sold
   * module has an empty tier list, so the gate deliberately falls through
   * rather than lock out a workspace that paid for it. This is what lets it
   * decide. Absent on an older Mission Control, which degrades to today's
   * fall-through behaviour rather than to a lockout.
   */
  addonSlugs?: string[];
  available: number;
  allowance: number;
  used: number;
  reserved: number;
  lifetimeGranted: number;
  lifetimeSpent: number;
  planName: string | null;
  /** Plan slug (launch/growth/scale). Drives plan-tier feature gating. */
  planSlug: string | null;
  overagePolicy: string | null;
  currentPeriodEnd: string | null;
  /** True when Mission Control marks this tenant billing-exempt (no plan,
   * never funds-gated). Set per-tenant in MC, so clone installs of this same
   * code keep normal plan enforcement. */
  exempt: boolean;
  /** Credits lapse this many days after they are issued (platform policy). */
  expiryPolicyDays: number;
  /** Credit lapsing inside Mission Control's warning window. */
  expiringSoon: number;
  /** When the next credit lapses, or null if nothing on file is dated. */
  nextExpiryAt: string | null;
  /** Width of the warning window, in days. */
  expiryWarningDays: number;
}

export interface TopupPack {
  id: string;
  slug: string;
  name: string;
  tokens: number;
  priceCents: number;
  currency: string;
  expiresAfterDays: number | null;
}

export interface TopupPacksResult {
  packs: TopupPack[];
  topupUrl: string | null;
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
    nextOffset: number | null;
  };
}

export class MissionControlError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
    this.name = "MissionControlError";
  }
}

export class InsufficientTokensError extends MissionControlError {
  constructor(public available: number, public requested: number, details?: unknown) {
    super(
      "insufficient_funds",
      `Insufficient tokens: requested ${requested}, available ${available}`,
      402,
      details,
    );
    this.name = "InsufficientTokensError";
  }
}

export class RateLimitedError extends MissionControlError {
  constructor(public retryAfterSeconds: number, details?: unknown) {
    super("rate_limited", `Mission Control rate limited; retry after ${retryAfterSeconds}s`, 429, details);
    this.name = "RateLimitedError";
  }
}

function assertConfigured() {
  if (!BASE_URL || !API_KEY) {
    throw new MissionControlError(
      "unconfigured",
      "MISSION_CONTROL_URL or MISSION_CONTROL_CLONE_API_KEY missing",
      500,
    );
  }
}

/**
 * Wall-clock bound on a single Mission Control HTTP attempt.
 *
 * These calls run OUTSIDE any handler's analysis budget — the metering wrapper
 * reserves before the handler starts and commits after it returns — so an
 * unbounded fetch here silently spends the browser's whole request timeout.
 * That is not hypothetical: on 2026-08-26 a catalog lookup took 83s and the
 * reserve after it 31s, so `compare-investment-reports` reached its model call
 * 115s into a request the browser aborts at 150s. The comparison completed,
 * was stored and was charged — and the person who asked for it was told
 * "Request timed out".
 *
 * Ten seconds is an eternity for these endpoints (they answer in well under a
 * second when healthy) and short enough that even the worst path — every
 * attempt timing out, every retry taken — stays inside the caller's budget.
 * Fail-closed semantics are unchanged: a reserve that times out is refused
 * exactly like any other reserve error.
 */
export const MC_FETCH_TIMEOUT_MS = (() => {
  const raw = Number(Deno.env.get("MC_FETCH_TIMEOUT_MS") ?? "");
  return Number.isFinite(raw) && raw > 0 ? raw : 10_000;
})();

function isAbortError(e: unknown): boolean {
  const name = (e as { name?: string })?.name;
  return name === "AbortError" || name === "TimeoutError";
}

async function mcFetchRaw(path: string, init: RequestInit): Promise<Response> {
  assertConfigured();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MC_FETCH_TIMEOUT_MS);
  // A caller's own signal is COMBINED with the ceiling above, never replaced by
  // it. `{ ...init, signal: controller.signal }` discarded it: `getBalance`
  // asks for 8s and was silently given 10, and any future caller wanting to
  // cancel would have been ignored just as quietly. Combining can only ever
  // abort sooner, so the ceiling still holds for callers that pass nothing.
  const signal = init.signal
    ? AbortSignal.any([init.signal, controller.signal])
    : controller.signal;
  try {
    return await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-clone-api-key": API_KEY,
        ...(init.headers ?? {}),
      },
      signal,
    });
  } catch (e) {
    if (isAbortError(e)) {
      throw new MissionControlError(
        "mc_timeout",
        `Mission Control did not answer ${path} within ${MC_FETCH_TIMEOUT_MS}ms`,
        504,
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch with one retry on 429 (honoring Retry-After), 5xx (500ms back-off)
 *  and a timed-out attempt — a stall can be a transient stall, but two in a row
 *  mean Mission Control is down for this request's purposes. */
async function mcFetch(path: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await mcFetchRaw(path, init);
    } catch (e) {
      if (e instanceof MissionControlError && e.code === "mc_timeout" && attempt === 0) {
        continue;
      }
      throw e;
    }
    if (res.status === 429 && attempt === 0) {
      const ra = Number(res.headers.get("retry-after") ?? "1");
      const waitMs = Math.min(Math.max(ra, 1), 10) * 1000;
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    if (res.status >= 500 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    return res;
  }
  // Unreachable, but TypeScript-safe fallback.
  return await mcFetchRaw(path, init);
}

async function parseOrThrow(res: Response): Promise<any> {
  const text = await res.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { /* keep raw */ }

  // MC uses `ok: false` envelope even on 200 for some errors (e.g. insufficient_funds).
  const okFlag = body?.ok !== false;
  if (res.ok && okFlag) return body;

  const code = body?.error ?? body?.code ?? "mc_error";
  const message = body?.message ?? (typeof code === "string" ? code : `Mission Control ${res.status}`);

  if (code === "insufficient_funds") {
    throw new InsufficientTokensError(
      Number(body?.available ?? 0),
      Number(body?.required ?? body?.requested ?? 0),
      body,
    );
  }
  if (code === "rate_limited" || res.status === 429) {
    throw new RateLimitedError(
      Number(body?.retry_after_seconds ?? res.headers.get("retry-after") ?? 1),
      body,
    );
  }
  throw new MissionControlError(code, message, res.status || 500, body);
}

export async function reserveTokens(args: ReserveArgs): Promise<ReserveResult> {
  const res = await mcFetch("/api/public/tokens/reserve", {
    method: "POST",
    body: JSON.stringify({
      tenant_ref: AGENCY_TENANT_REF,
      display_name: AGENCY_DISPLAY_NAME,
      kind: args.kind,
      estimated_tokens: args.estimatedTokens,
      idempotency_key: args.idempotencyKey,
      ttl_seconds: args.ttlSeconds,
      request_payload: {
        user_id: args.userId,
        ...(args.requestPayload ?? {}),
      },
    }),
  });
  const body = await parseOrThrow(res);
  return {
    jobId: body.job_id ?? body.jobId,
    reserved: Number(body.reserved_tokens ?? body.reserved ?? args.estimatedTokens),
    available: Number(body.available_after ?? body.available ?? 0),
    idempotent: Boolean(body.idempotent),
    status: body.status,
    billingUserId: body.billing_user_id ?? null,
  };
}

export async function commitTokens(jobId: string, actualTokens: number, resultMeta?: Record<string, unknown>): Promise<void> {
  // Commit must always succeed eventually. Retry once on 5xx — commit is idempotent on completed jobs.
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try {
      res = await mcFetchRaw("/api/public/tokens/commit", {
        method: "POST",
        body: JSON.stringify({
          job_id: jobId,
          actual_tokens: actualTokens,
          result_meta: resultMeta,
        }),
      });
    } catch (e) {
      // A timed-out attempt is retryable like a 5xx; the last one propagates so
      // the caller records the commit as failed rather than silently succeeded.
      if (e instanceof MissionControlError && e.code === "mc_timeout" && attempt < 2) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      throw e;
    }
    if (res.ok) { await res.text(); return; }
    if (res.status === 429) {
      const ra = Number(res.headers.get("retry-after") ?? "1");
      await new Promise((r) => setTimeout(r, Math.min(ra, 10) * 1000));
      continue;
    }
    if (res.status < 500 || attempt === 2) {
      await parseOrThrow(res);
      return;
    }
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
}

export interface ReleaseResult {
  /** True when Mission Control confirmed the job is no longer billable. */
  ok: boolean;
  /** 'canceled' (reservation released), 'refunded' (charge reversed),
   *  'noop' (already released), or 'unknown' against an older Mission Control. */
  outcome: "canceled" | "refunded" | "noop" | "unknown";
  releasedTokens: number;
  error?: string;
}

/**
 * Release a job so it costs the tenant nothing.
 *
 * `refundIfCommitted` is the important flag: `cancel_token_reservation` is a
 * no-op on a job that already reached `completed`, so without it a generation
 * that failed AFTER an earlier chunk was committed stayed charged. Mission
 * Control's cancel endpoint branches to `refund_job` when the flag is set.
 * Older Mission Control deployments simply ignore the unknown field (their Zod
 * schema strips it) and fall back to cancel-only semantics, so this is safe to
 * ship ahead of the Mission Control release.
 */
export async function releaseTokens(
  jobId: string,
  reason?: string,
  opts: { refundIfCommitted?: boolean } = {},
): Promise<ReleaseResult> {
  const payload = JSON.stringify({
    job_id: jobId,
    reason: reason?.slice(0, 280) ?? "generation_failed",
    refund_if_committed: opts.refundIfCommitted !== false,
  });

  // Releasing is the difference between "the customer paid for a failed report"
  // and "they didn't", so unlike the old fire-and-forget cancel this retries
  // transient failures and reports whether it actually landed.
  let lastError = "release_failed";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await mcFetchRaw("/api/public/tokens/cancel", {
        method: "POST",
        body: payload,
      });
      const text = await res.text();
      let body: any = {};
      try { body = text ? JSON.parse(text) : {}; } catch { /* keep raw */ }

      if (res.ok && body?.ok !== false) {
        return {
          ok: true,
          outcome: (body?.outcome as ReleaseResult["outcome"]) ?? "unknown",
          releasedTokens: Number(body?.released_tokens ?? body?.refunded_tokens ?? 0),
        };
      }

      lastError = String(body?.error ?? body?.message ?? `mc_${res.status}`);
      // 4xx is terminal (job_not_found / forbidden / invalid) — retrying cannot help.
      if (res.status < 500 && res.status !== 429) break;
    } catch (e) {
      lastError = e instanceof Error ? e.message : "release_threw";
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }

  // Never let a release failure mask the original error; the reservation still
  // expires with its TTL, and the caller logs this outcome to the audit trail.
  console.error("[missionControl] release failed", { jobId, reason, lastError });
  return { ok: false, outcome: "unknown", releasedTokens: 0, error: lastError };
}

/** Back-compat alias — cancel a reservation without refunding a committed job. */
export async function cancelTokens(jobId: string, reason?: string): Promise<ReleaseResult> {
  return await releaseTokens(jobId, reason, { refundIfCommitted: false });
}

export async function getBalance(): Promise<BalanceResult> {
  const q = new URLSearchParams({
    tenant_ref: AGENCY_TENANT_REF,
    display_name: AGENCY_DISPLAY_NAME,
  });
  // Balance is display data and mission-control-balance has a durable local
  // snapshot to fall back to. Do not let a stalled upstream socket consume the
  // browser's full request deadline: abort promptly so the edge handler can
  // return that authenticated, tenant-scoped snapshot instead.
  const res = await mcFetch(`/api/public/tokens/balance?${q.toString()}`, {
    method: "GET",
    signal: AbortSignal.timeout(8_000),
  });
  const body = await parseOrThrow(res);

  const tenant = body?.tenant ?? {};
  const plan = tenant?.billing_plans ?? null;
  const balance = body?.balance ?? body ?? {};

  const allowance = Number(plan?.monthly_allowance ?? body?.allowance ?? 0);
  const lifetimeGranted = Number(balance?.lifetime_granted ?? 0);
  const lifetimeSpent = Number(balance?.lifetime_spent ?? balance?.used ?? 0);
  const available = Number(balance?.available ?? 0);
  const reserved = Number(balance?.reserved ?? 0);

  // `used` should reflect CURRENT PERIOD consumption (matches the "of N allowance"
  // progress bar in the UI), not lifetime spend. Prefer an MC-provided period figure
  // when available; otherwise derive it from allowance − available − reserved and
  // cap at the allowance so the pill can't show implausible multi-million totals
  // caused by legacy lifetime_spent bleed-through.
  const periodUsedRaw = Number(
    balance?.period_used ?? balance?.current_period_spent ?? body?.period_used ?? NaN,
  );
  const derivedUsed = Math.max(0, allowance - available - reserved);
  const used = Number.isFinite(periodUsedRaw) && periodUsedRaw >= 0
    ? Math.min(periodUsedRaw, allowance > 0 ? allowance : periodUsedRaw)
    : allowance > 0
      ? Math.min(derivedUsed, allowance)
      : 0;

  // Expiry. Credits live 30 days from issue, so a balance can shrink without
  // anyone spending anything — the UI needs to be able to say so in advance.
  // Absent on an older Mission Control, which degrades to "no warning".
  const expiry = body?.expiry ?? {};

  return {
    available,
    reserved,
    allowance,
    used,
    lifetimeGranted,
    lifetimeSpent,
    planName: plan?.name ?? null,
    planSlug: plan?.slug ?? null,
    overagePolicy: plan?.overage_policy ?? null,
    currentPeriodEnd: tenant?.current_period_end ?? null,
    exempt: Boolean(tenant?.billing_exempt),
    expiryPolicyDays: Number(expiry?.policy_days ?? 0),
    expiringSoon: Number(expiry?.expiring_soon ?? 0),
    nextExpiryAt: expiry?.next_expiry_at ?? null,
    expiryWarningDays: Number(expiry?.warning_days ?? 7),
    addonSlugs: Array.isArray(body?.entitlements?.addons)
      ? (body.entitlements.addons as unknown[]).filter(
          (a): a is string => typeof a === "string",
        )
      : undefined,
  };
}

export async function listTopupPacks(
  opts: {
    limit?: number;
    offset?: number;
    /** When set, Mission Control mints the topup_url as an attributed handoff
     * deep link carrying this user (user-attributed pricing workflow). */
    originUserId?: string;
    originUsername?: string | null;
  } = {},
): Promise<TopupPacksResult> {
  const q = new URLSearchParams({ tenant_ref: AGENCY_TENANT_REF });
  if (opts.limit) q.set("limit", String(Math.min(opts.limit, 100)));
  if (opts.offset) q.set("offset", String(opts.offset));
  if (opts.originUserId) {
    q.set("origin_user_id", opts.originUserId.slice(0, 200));
    if (opts.originUsername) q.set("origin_username", opts.originUsername.slice(0, 200));
  }
  const res = await mcFetch(`/api/public/tokens/packs?${q.toString()}`, { method: "GET" });
  const body = await parseOrThrow(res);
  const pagination = body?.pagination ?? {};
  return {
    packs: Array.isArray(body?.packs)
      ? body.packs.map((p: any) => ({
          id: p.id,
          slug: p.slug,
          name: p.name,
          tokens: Number(p.tokens ?? 0),
          priceCents: Number(p.price_cents ?? 0),
          currency: String(p.currency ?? "USD"),
          expiresAfterDays: p.expires_after_days ?? null,
        }))
      : [],
    topupUrl: body?.topup_url ?? null,
    pagination: {
      limit: Number(pagination.limit ?? 50),
      offset: Number(pagination.offset ?? 0),
      total: Number(pagination.total ?? 0),
      hasMore: Boolean(pagination.has_more),
      nextOffset: pagination.next_offset ?? null,
    },
  };
}

// ── Billing handoff (user-attributed pricing workflow) ─────────────────────
// Mints a single-use, expiring deep link into Mission Control's pricing page
// that carries the initiating command-center user server-to-server. The
// browser only ever sees the opaque `?h=<uuid>` token.

/** Buyer details forwarded to Stripe so the payment page arrives prefilled. */
export interface BillingContactArgs {
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  phone?: string | null;
  company?: string | null;
  /** Business tax ID (ABN). Mission Control validates the checksum and drops
   *  anything malformed, so Stripe asks the buyer rather than recording junk. */
  taxId?: string | null;
  /** Stripe tax ID type; defaults to 'au_abn' at Mission Control. */
  taxIdType?: string | null;
}

export interface HandoffArgs {
  originUserId: string;
  originUsername?: string | null;
  /** '<mode>' or '<mode>:<item_id>' — restricts what the handoff can buy. */
  intent?: string;
  /** Absolute https URL back into this app for the post-checkout return CTA. */
  returnUrl?: string;
  /** Buyer contact block. Travels server-to-server under the clone API key —
   *  the browser only ever receives the opaque handoff URL, so these details
   *  cannot be read or forged from the link. */
  contact?: BillingContactArgs | null;
}

export interface HandoffResult {
  url: string;
  handoffId: string;
  expiresAt: string | null;
}

export async function createBillingHandoff(args: HandoffArgs): Promise<HandoffResult> {
  const contact = args.contact
    ? {
        email: args.contact.email ?? undefined,
        first_name: args.contact.firstName ?? undefined,
        last_name: args.contact.lastName ?? undefined,
        full_name: args.contact.fullName ?? undefined,
        phone: args.contact.phone ?? undefined,
        company: args.contact.company ?? undefined,
        tax_id: args.contact.taxId ?? undefined,
        tax_id_type: args.contact.taxIdType ?? undefined,
      }
    : undefined;
  const hasContact = contact && Object.values(contact).some((v) => v !== undefined);

  const payload: Record<string, unknown> = {
    tenant_ref: AGENCY_TENANT_REF,
    display_name: AGENCY_DISPLAY_NAME,
    origin_user_id: args.originUserId,
    origin_username: args.originUsername ?? undefined,
    intent: args.intent,
    return_url: args.returnUrl,
    // Omitted entirely when we know nothing, so an older Mission Control that
    // doesn't understand the field is never sent a stray empty object.
    ...(hasContact ? { contact } : {}),
  };

  let res = await mcFetch("/api/public/billing/handoff", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  // A misconfigured clone deploy_url must not kill attribution: retry once
  // without the return link if Mission Control rejects it.
  if (res.status === 400 && args.returnUrl) {
    const text = await res.clone().text().catch(() => "");
    if (text.includes("return_url")) {
      delete payload.return_url;
      res = await mcFetch("/api/public/billing/handoff", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    }
  }

  const body = await parseOrThrow(res);
  return {
    url: body.url,
    handoffId: body.handoff_id,
    expiresAt: body.expires_at ?? null,
  };
}

// ── Purchase history read-back (user-attributed pricing workflow) ──────────

export interface PurchaseRecord {
  id: string;
  createdAt: string;
  completedAt: string | null;
  status: string;
  mode: string;
  itemSlug: string | null;
  itemName: string | null;
  quantity: number;
  amountCents: number | null;
  currency: string | null;
  paymentStatus: string | null;
  originUserId: string | null;
  originUsername: string | null;
  originSource: string;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
}

export interface PurchaseHistoryResult {
  purchases: PurchaseRecord[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
    nextOffset: number | null;
  };
}

export async function listPurchases(
  opts: { limit?: number; offset?: number; status?: string } = {},
): Promise<PurchaseHistoryResult> {
  const q = new URLSearchParams({ tenant_ref: AGENCY_TENANT_REF });
  if (opts.limit) q.set("limit", String(Math.min(opts.limit, 100)));
  if (opts.offset) q.set("offset", String(opts.offset));
  if (opts.status) q.set("status", opts.status);
  const res = await mcFetch(`/api/public/purchases?${q.toString()}`, { method: "GET" });
  const body = await parseOrThrow(res);
  const pagination = body?.pagination ?? {};
  return {
    purchases: Array.isArray(body?.purchases)
      ? body.purchases.map((p: any) => ({
          id: p.id,
          createdAt: p.created_at,
          completedAt: p.completed_at ?? null,
          status: String(p.status ?? "completed"),
          mode: String(p.mode ?? ""),
          itemSlug: p.item_slug ?? null,
          itemName: p.item_name ?? null,
          quantity: Number(p.quantity ?? 1),
          amountCents: p.amount_cents ?? null,
          currency: p.currency ?? null,
          paymentStatus: p.payment_status ?? null,
          originUserId: p.origin_user_id ?? null,
          originUsername: p.origin_username ?? null,
          originSource: String(p.origin_source ?? ""),
          stripeCheckoutSessionId: p.stripe_checkout_session_id ?? null,
          stripePaymentIntentId: p.stripe_payment_intent_id ?? null,
        }))
      : [],
    pagination: {
      limit: Number(pagination.limit ?? 25),
      offset: Number(pagination.offset ?? 0),
      total: Number(pagination.total ?? 0),
      hasMore: Boolean(pagination.has_more),
      nextOffset: pagination.next_offset ?? null,
    },
  };
}

// ── Saved payment methods (billing & usage workflow) ───────────────────────
// Display references only (brand / last4 / expiry) — the cards themselves
// live at Stripe. Priority 1 = primary, 2 = secondary, 3 = backup (max 3).

export interface PaymentMethodRecord {
  id: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  funding: string | null;
  /** Cardholder name/email captured by Stripe on the card-save page. */
  billingName: string | null;
  billingEmail: string | null;
  priority: number;
  role: string;
  originUsername: string | null;
  createdAt: string;
  /** Stripe's own id for this card. */
  stripePaymentMethodId: string | null;
  /** Whether Stripe will charge this card. null = Stripe not reachable. */
  isStripeDefault: boolean | null;
  /** Whether Stripe still has this card attached. null = not reachable. */
  attachedAtStripe: boolean | null;
}

export interface PaymentMethodsResult {
  paymentMethods: PaymentMethodRecord[];
  maxPaymentMethods: number;
  /** False when Mission Control could not reach Stripe on this call. */
  stripeVerified: boolean;
  /** The Stripe payment method that will actually be charged. */
  stripeDefaultPaymentMethodId: string | null;
}

function mapPaymentMethods(body: any): PaymentMethodsResult {
  return {
    paymentMethods: Array.isArray(body?.payment_methods)
      ? body.payment_methods.map((m: any) => ({
          id: m.id,
          brand: m.brand ?? null,
          last4: m.last4 ?? null,
          expMonth: m.exp_month ?? null,
          expYear: m.exp_year ?? null,
          funding: m.funding ?? null,
          billingName: m.billing_name ?? null,
          billingEmail: m.billing_email ?? null,
          priority: Number(m.priority ?? 0),
          role: String(m.role ?? ""),
          originUsername: m.origin_username ?? null,
          createdAt: m.created_at,
          stripePaymentMethodId: m.stripe_payment_method_id ?? null,
          // null (not false) when Stripe could not be consulted — the UI must
          // be able to say "couldn't confirm" rather than assert a mismatch.
          isStripeDefault: typeof m.is_stripe_default === "boolean" ? m.is_stripe_default : null,
          attachedAtStripe: typeof m.attached_at_stripe === "boolean" ? m.attached_at_stripe : null,
        }))
      : [],
    maxPaymentMethods: Number(body?.max_payment_methods ?? 3),
    stripeVerified: body?.stripe_verified === true,
    stripeDefaultPaymentMethodId: body?.stripe_default_payment_method_id ?? null,
  };
}

export async function listPaymentMethods(): Promise<PaymentMethodsResult> {
  const q = new URLSearchParams({ tenant_ref: AGENCY_TENANT_REF });
  const res = await mcFetch(`/api/public/billing/payment-methods?${q.toString()}`, {
    method: "GET",
  });
  return mapPaymentMethods(await parseOrThrow(res));
}

export type PaymentMethodAction =
  | { action: "make_primary"; paymentMethodId: string }
  | { action: "reorder"; orderedIds: string[] }
  | { action: "remove"; paymentMethodId: string }
  | { action: "sync_default" };

export async function managePaymentMethod(
  action: PaymentMethodAction,
): Promise<PaymentMethodsResult> {
  const payload: Record<string, unknown> = {
    action: action.action,
    tenant_ref: AGENCY_TENANT_REF,
  };
  if (action.action === "reorder") payload.ordered_ids = action.orderedIds;
  else if (action.action !== "sync_default") payload.payment_method_id = action.paymentMethodId;

  const res = await mcFetch("/api/public/billing/payment-methods", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return mapPaymentMethods(await parseOrThrow(res));
}

// ── Invoices (billing & usage workflow) ─────────────────────────────────────

export interface InvoiceRecord {
  id: string;
  createdAt: string;
  issuedAt: string | null;
  paidAt: string | null;
  number: string | null;
  status: string | null;
  description: string | null;
  mode: string | null;
  itemSlug: string | null;
  itemName: string | null;
  amountDueCents: number | null;
  amountPaidCents: number | null;
  subtotalCents: number | null;
  taxCents: number | null;
  totalCents: number | null;
  currency: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
  originUsername: string | null;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface InvoiceHistoryResult {
  invoices: InvoiceRecord[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
    nextOffset: number | null;
  };
}

export async function listInvoices(
  opts: { limit?: number; offset?: number; status?: string } = {},
): Promise<InvoiceHistoryResult> {
  const q = new URLSearchParams({ tenant_ref: AGENCY_TENANT_REF });
  if (opts.limit) q.set("limit", String(Math.min(opts.limit, 100)));
  if (opts.offset) q.set("offset", String(opts.offset));
  if (opts.status) q.set("status", opts.status);
  const res = await mcFetch(`/api/public/billing/invoices?${q.toString()}`, { method: "GET" });
  const body = await parseOrThrow(res);
  const pagination = body?.pagination ?? {};
  return {
    invoices: Array.isArray(body?.invoices)
      ? body.invoices.map((i: any) => ({
          id: i.id,
          createdAt: i.created_at,
          issuedAt: i.issued_at ?? null,
          paidAt: i.paid_at ?? null,
          number: i.number ?? null,
          status: i.status ?? null,
          description: i.description ?? null,
          mode: i.mode ?? null,
          itemSlug: i.item_slug ?? null,
          itemName: i.item_name ?? null,
          amountDueCents: i.amount_due_cents ?? null,
          amountPaidCents: i.amount_paid_cents ?? null,
          subtotalCents: i.subtotal_cents ?? null,
          taxCents: i.tax_cents ?? null,
          totalCents: i.total_cents ?? null,
          currency: i.currency ?? null,
          hostedInvoiceUrl: i.hosted_invoice_url ?? null,
          invoicePdfUrl: i.invoice_pdf_url ?? null,
          originUsername: i.origin_username ?? null,
          periodStart: i.period_start ?? null,
          periodEnd: i.period_end ?? null,
        }))
      : [],
    pagination: {
      limit: Number(pagination.limit ?? 25),
      offset: Number(pagination.offset ?? 0),
      total: Number(pagination.total ?? 0),
      hasMore: Boolean(pagination.has_more),
      nextOffset: pagination.next_offset ?? null,
    },
  };
}

/**
 * Convenience wrapper: reserve → run → commit/cancel.
 * `run` receives the reservation and must return { actualTokens, result }.
 */
export async function withTokenReservation<T>(
  args: ReserveArgs,
  run: (reservation: ReserveResult) => Promise<{ actualTokens: number; result: T; resultMeta?: Record<string, unknown> }>,
): Promise<T> {
  const reservation = await reserveTokens(args);
  try {
    const { actualTokens, result, resultMeta } = await run(reservation);
    await commitTokens(reservation.jobId, actualTokens, resultMeta);
    return result;
  } catch (err) {
    await cancelTokens(reservation.jobId, err instanceof Error ? err.message : "error");
    throw err;
  }
}

// ── Plan changes ────────────────────────────────────────────────────────────
// A billing plan change is worth telling the workspace about exactly once: the
// tier moved and an allowance landed in the balance. Both are things the team
// will otherwise discover by noticing a different number.

export interface PlanChangeEvent {
  id: string;
  fromPlanSlug: string | null;
  fromPlanName: string | null;
  toPlanSlug: string;
  toPlanName: string;
  /** Credits added by the change. Zero when the period was already credited. */
  creditsGranted: number;
  creditsExpireAt: string | null;
  createdAt: string;
}

/**
 * Plan changes this workspace has not been shown yet, newest first.
 *
 * Reading deliberately does not acknowledge — see acknowledgePlanChange. A
 * notice retired on fetch is lost to anyone whose page failed to render, and
 * this is the only time it is shown.
 */
export async function getPlanChanges(): Promise<PlanChangeEvent[]> {
  const q = new URLSearchParams({
    tenant_ref: AGENCY_TENANT_REF,
    display_name: AGENCY_DISPLAY_NAME,
  });
  const res = await mcFetch(`/api/public/tokens/plan-change?${q.toString()}`, { method: "GET" });
  const body = await parseOrThrow(res);
  const rows = Array.isArray(body?.changes) ? body.changes : [];
  // deno-lint-ignore no-explicit-any
  return rows.map((c: any) => ({
    id: String(c.id),
    fromPlanSlug: c.from_plan_slug ?? null,
    fromPlanName: c.from_plan_name ?? null,
    toPlanSlug: String(c.to_plan_slug ?? ""),
    toPlanName: String(c.to_plan_name ?? ""),
    creditsGranted: Number(c.credits_granted ?? 0),
    creditsExpireAt: c.credits_expire_at ?? null,
    createdAt: c.created_at ?? null,
  }));
}

/** Retires a notice, so the workspace is told once and not again. */
export async function acknowledgePlanChange(id: string): Promise<boolean> {
  const res = await mcFetch(`/api/public/tokens/plan-change`, {
    method: "POST",
    body: JSON.stringify({
      id,
      tenant_ref: AGENCY_TENANT_REF,
      display_name: AGENCY_DISPLAY_NAME,
    }),
  });
  const body = await parseOrThrow(res);
  return body?.acknowledged === true;
}

// ── Product feedback prompts ────────────────────────────────────────────────
// The cadence — first 30 days, then quarterly — is decided by Mission Control
// rather than here, so a clone created next year inherits it without the rule
// being copied into code that deploys separately and drifts.

export interface FeedbackPrompt {
  due: boolean;
  campaignKey: string | null;
  reason: "onboarding" | "quarterly" | null;
  rewardAvailable: boolean;
  rewardTokens: number;
  /** Where to send them. Carries an attributed handoff when we know who asked. */
  feedbackUrl: string | null;
}

const NOT_DUE: FeedbackPrompt = {
  due: false,
  campaignKey: null,
  reason: null,
  rewardAvailable: false,
  rewardTokens: 0,
  feedbackUrl: null,
};

/**
 * Should this workspace be asked for feedback, and where do they go?
 *
 * The URL is minted by Mission Control, not built here: the feedback form
 * lives on a marketing domain with no login, so the workspace and the person
 * have to be carried across in a handoff created server-to-server. Passing the
 * user makes the response attributable; without it the answer is still
 * recorded against the workspace, just with no author.
 */
export async function getFeedbackPrompt(
  opts: {
    originUserId?: string | null;
    originUsername?: string | null;
  } = {},
): Promise<FeedbackPrompt> {
  const q = new URLSearchParams({
    tenant_ref: AGENCY_TENANT_REF,
    display_name: AGENCY_DISPLAY_NAME,
  });
  if (opts.originUserId) {
    q.set("origin_user_id", opts.originUserId.slice(0, 200));
    if (opts.originUsername) q.set("origin_username", opts.originUsername.slice(0, 200));
    q.set("origin_source", "prime_dashboard");
  }
  const res = await mcFetch(`/api/public/tokens/feedback-prompt?${q.toString()}`, {
    method: "GET",
  });
  const body = await parseOrThrow(res);
  if (body?.due !== true) return NOT_DUE;
  return {
    due: true,
    campaignKey: body.campaign_key ?? null,
    reason: body.reason === "onboarding" ? "onboarding" : "quarterly",
    rewardAvailable: body.reward_available !== false,
    rewardTokens: Number(body.reward_tokens ?? 100),
    feedbackUrl: validateFeedbackUrl(body.feedback_url),
  };
}

// ─── API-key usage metering ──────────────────────────────────────────────────
//
// This deployment may be running on API keys it does not own. A workspace
// provisioned by Mission Control boots with the prime's OpenAI, Resend, Domain
// and Cotality keys forwarded into its Supabase project, and every call made on
// one of those is billed to the prime's vendor account. Mission Control
// recharges that usage per tenant — and charges nothing for a key this
// workspace supplied itself, which it knows from its own record of what it
// forwarded rather than from anything we assert here.
//
// Batched, never on the request path. The caller is a cron-driven worker
// draining `api_usage_log`; a metering hop in front of a client's report would
// trade user-visible latency for a billing nicety, and would lose the call
// outright whenever Mission Control was slow.

export interface UsageReportEvent {
  secret_name: string;
  quantity: number;
  idempotency_key: string;
  model?: string | null;
  feature?: string | null;
  status?: "success" | "error";
  occurred_at?: string;
  metadata?: Record<string, unknown>;
}

export interface UsageReportOutcome {
  idempotency_key: string;
  ok: boolean;
  billable?: boolean;
  billing_reason?: string;
  duplicate?: boolean;
  error?: string;
}

export interface UsageReportResult {
  accepted: number;
  rejected: number;
  billable: number;
  results: UsageReportOutcome[];
}

/** Mission Control's own cap on one batch. Sending more is a 400, not a truncation. */
export const USAGE_REPORT_MAX_EVENTS = 200;

/**
 * Report a batch of third-party API calls for metering.
 *
 * Per-event outcomes come back rather than one verdict: a malformed event must
 * not cost us the other 199 in the batch, and the caller needs to know exactly
 * which rows to mark as delivered.
 */
export async function reportApiUsage(events: UsageReportEvent[]): Promise<UsageReportResult> {
  if (events.length === 0) return { accepted: 0, rejected: 0, billable: 0, results: [] };
  if (events.length > USAGE_REPORT_MAX_EVENTS) {
    throw new MissionControlError(
      "batch_too_large",
      `reportApiUsage accepts at most ${USAGE_REPORT_MAX_EVENTS} events, got ${events.length}`,
      400,
    );
  }
  const res = await mcFetch("/api/public/usage/report", {
    method: "POST",
    body: JSON.stringify({
      tenant_ref: AGENCY_TENANT_REF,
      display_name: AGENCY_DISPLAY_NAME,
      events,
    }),
  });
  const body = await parseOrThrow(res);
  return {
    accepted: Number(body.accepted ?? 0),
    rejected: Number(body.rejected ?? 0),
    billable: Number(body.billable ?? 0),
    results: Array.isArray(body.results) ? (body.results as UsageReportOutcome[]) : [],
  };
}
