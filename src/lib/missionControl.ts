import { validateFeedbackUrl } from "@/lib/feedbackUrlPolicy";
import { applyPricingMockRouting } from "@/lib/pricingMock";

/**
 * Frontend client for Mission Control token balance + top-up packs.
 * All requests go through the `mission-control-*` edge functions so the clone API key
 * never leaves the server. Pre-flight estimates live here so UI can gate "Generate" CTAs.
 */
import { supabase } from "@/integrations/supabase/client";

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
  | "report.qualitative-regen";

export interface TokenBalance {
  /** Credit lapsing inside the warning window (0 when nothing is due). */
  expiringSoon?: number;
  /** When the next credit lapses. */
  nextExpiryAt?: string | null;
  /** Platform token lifetime in days. */
  expiryPolicyDays?: number;
  expiryWarningDays?: number;
  available: number;
  allowance: number;
  used: number;
  reserved: number;
  // Optional extended fields surfaced by mission-control-balance.
  lifetimeGranted?: number;
  lifetimeSpent?: number;
  planName?: string | null;
  /** Plan slug (launch/growth/scale) — what plan-tier gating keys on. */
  planSlug?: string | null;
  /**
   * Priced add-on slugs this workspace holds. Undefined means Mission Control
   * did not say — which the gate treats as "fall through to permissions",
   * never as "denied".
   */
  addonSlugs?: string[];
  overagePolicy?: string | null;
  currentPeriodEnd?: string | null;
  /** Mission Control marked this tenant billing-exempt (no plan, never
   * funds-gated). Per-tenant flag in MC — clones are unaffected. */
  exempt?: boolean;
  /** Provenance supplied by the balance proxy. Cached values remain
   * display-only; report reservations always re-check Mission Control. */
  source?: "live" | "cache" | "unprovisioned";
  stale?: boolean;
  updatedAt?: string | null;
  unprovisioned?: boolean;
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

export class InsufficientTokensError extends Error {
  constructor(public available: number, public requested: number) {
    super(`Insufficient tokens: need ${requested}, have ${available}`);
    this.name = "InsufficientTokensError";
  }
}

/**
 * Mirror of server-side estimator. Keep in sync with
 * supabase/functions/_shared/tokenEstimator.ts.
 *
 * UNIT: billing credits (same unit as the balance/allowance/packs), NOT raw
 * LLM tokens. A report costs a handful of credits — keep this scale.
 */
const BASE: Record<TokenKind, number> = {
  "report.investment.compass": 12,
  "report.investment.executive": 8,
  "report.investment.snapshot": 4,
  "report.investment.financial": 5,
  "report.suburb.compass": 10,
  "report.postcode.compass": 10,
  "report.market-intelligence": 6,
  "report.portfolio-review": 8,
  "report.bulk-item": 8,
  "report.chart-analysis": 2,
  "report.qualitative-regen": 3,
};

export function estimateTokens(
  kind: TokenKind,
  opts: { extraSections?: number; aiNarrative?: boolean; multiplier?: number } = {},
): number {
  let n = BASE[kind] ?? 5;
  if (opts.extraSections && opts.extraSections > 0) n *= 1 + 0.2 * opts.extraSections;
  if (opts.aiNarrative) n *= 1.5;
  if (opts.multiplier && opts.multiplier > 0) n *= opts.multiplier;
  return Math.ceil(n);
}

export async function fetchTokenBalance(): Promise<TokenBalance> {
  const { invokeSecureFunction } = await import("@/lib/secureInvoke");
  const { data, error } = await invokeSecureFunction<TokenBalance>(
    "mission-control-balance",
    {},
  );
  if (error) throw new Error(error.message ?? "Failed to fetch balance");
  if (!data || typeof (data as any).available !== "number") {
    throw new Error("Invalid balance response");
  }
  return data as TokenBalance;
}

export async function fetchTopupPacks(): Promise<TopupPacksResult> {
  const { invokeSecureFunction } = await import("@/lib/secureInvoke");
  const { data, error } = await invokeSecureFunction<TopupPacksResult>(
    "mission-control-packs",
    {},
  );
  if (error) throw new Error(error.message ?? "Failed to fetch top-up packs");
  return (
    data ?? {
      packs: [],
      topupUrl: null,
      pagination: { limit: 50, offset: 0, total: 0, hasMore: false, nextOffset: null },
    }
  );
}

/** Throws InsufficientTokensError if available < estimate. Returns balance otherwise. */
export async function preflightTokens(estimate: number): Promise<TokenBalance> {
  const balance = await fetchTokenBalance();
  if (!balance.exempt && balance.available < estimate) {
    throw new InsufficientTokensError(balance.available, estimate);
  }
  return balance;
}

/**
 * THE customer pricing page — the Aurixa Systems website's storefront
 * (user-attributed pricing workflow, Revision 2). All user-centric
 * monetisation (tokens, plans, seats) flows through this page; Mission
 * Control's own billing pages are operator consoles.
 *
 * Handoff-minted deep links already point here (Mission Control mints them
 * against its PUBLIC_PRICING_SITE_URL); this constant is the LAST-RESORT
 * fallback when the handoff mint is unavailable. It carries this workspace's
 * stable billing uid (Mission Control tenants.billing_user_id — 'npc-prime'
 * for the prime install, seeded by MC migration 20260714180000) so that even
 * a failed mint lands on the pricing page with purchase CTAs LIVE and
 * correctly attributed, never on a browse-only dead end.
 */
const AURIXA_BILLING_UID =
  ((import.meta.env.VITE_AURIXA_BILLING_UID as string | undefined) ?? "npc-prime").trim();

export const AURIXA_PRICING_URL = AURIXA_BILLING_UID
  ? `https://www.aurixasystems.com.au/pricing?uid=${encodeURIComponent(AURIXA_BILLING_UID)}`
  : "https://www.aurixasystems.com.au/pricing";

/**
 * Fallback for the "Add card" CTA when the handoff mint is unavailable: the
 * pricing page recognises `action=save-card` (plus the uid credential) and
 * auto-launches the Stripe-hosted card-save flow.
 */
export const AURIXA_SAVE_CARD_URL = `${AURIXA_PRICING_URL}${
  AURIXA_PRICING_URL.includes("?") ? "&" : "?"
}action=save-card`;

export function openMissionControl(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

/** Public documentation for the Command Center, hosted on Aurixa Systems. */
export const AURIXA_DOCS_URL = "https://www.aurixasystems.com.au/docs";

/**
 * Open the documentation for a guide section.
 *
 * The docs site has no login, so it learns this workspace's plan and add-ons by
 * resolving a handoff token server-to-server against Mission Control — the same
 * mechanism the pricing page uses. The browser only ever carries the opaque
 * `?h=` token, so a reader cannot widen their own entitlement by editing the
 * URL: the plan is never read from the request.
 *
 * Without a token the docs site still loads, showing the public index with every
 * priced module locked. So a failed mint degrades to "less documentation", never
 * to a broken link — which is why this never blocks on the mint succeeding.
 *
 * The window is opened synchronously inside the click handler because popup
 * blockers only permit that, then steered once the token resolves.
 */
export async function openDocumentation(sectionId?: string): Promise<void> {
  const anchor = sectionId ? `#${sectionId}` : "";
  const win = window.open("", "_blank");
  if (win) {
    try {
      win.opener = null;
    } catch {
      /* cross-origin quirks — the redirect below still works */
    }
  }

  let url = `${AURIXA_DOCS_URL}${anchor}`;
  try {
    const { invokeSecureFunction } = await import("@/lib/secureInvoke");
    const { data } = await invokeSecureFunction<{ handoffId?: string | null }>(
      "mission-control-handoff",
      { intent: "docs", returnPath: window.location.pathname },
    );
    if (data?.handoffId) {
      url = `${AURIXA_DOCS_URL}?h=${encodeURIComponent(data.handoffId)}${anchor}`;
    }
  } catch {
    /* fall through to the unauthenticated docs URL */
  }

  if (win) win.location.href = url;
  else window.open(url, "_blank", "noopener,noreferrer");
}

// ── Attributed handoff (user-attributed pricing workflow) ───────────────────

export type HandoffIntent =
  | "topup"
  | "seat_plan"
  | "setup_package"
  | "save_card"
  | "pricing"
  | "catalog";

/**
 * Asks the `mission-control-handoff` edge function for a single-use attributed
 * deep link (the user's identity travels server-to-server; the browser only
 * carries an opaque token). Returns null on ANY failure — callers fall back to
 * the static Mission Control URL so a purchase is never blocked.
 */
export async function fetchBillingHandoffUrl(
  intent: HandoffIntent,
  itemId?: string,
): Promise<string | null> {
  try {
    const { invokeSecureFunction } = await import("@/lib/secureInvoke");
    const { data, error } = await invokeSecureFunction<{ url: string | null }>(
      "mission-control-handoff",
      { intent, itemId, returnPath: window.location.pathname },
    );
    if (error || !data?.url) return null;
    return data.url;
  } catch {
    return null;
  }
}

/**
 * Display-only username for the pricing page's "Purchasing for … as <user>"
 * chip. Read from the session cache useAuth maintains; never used for
 * authorization — the server re-resolves the purchase scope at checkout.
 */
function getDisplayUsername(): string | null {
  try {
    const raw = sessionStorage.getItem("current_user");
    if (!raw) return null;
    const name = (JSON.parse(raw)?.username ?? "").toString().trim();
    return name ? name.slice(0, 80) : null;
  } catch {
    return null;
  }
}

/**
 * The static fallback link identifies only the workspace (?uid=…), so the
 * storefront can't show WHO is buying. Attach the signed-in username as a
 * display-only `u` hint; attributed handoffs (?h=…) carry the user
 * server-side and don't need it.
 */
function withUsernameHint(url: string): string {
  const name = getDisplayUsername();
  if (!name) return url;
  try {
    const u = new URL(url);
    u.searchParams.set("u", name);
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Preferred entry point for all purchase CTAs.
 *
 * Popup-blocker note: the window is opened synchronously inside the click
 * handler (blockers only allow that), showing a brief interstitial, and is
 * steered to the attributed URL once the handoff resolves. If the popup was
 * blocked anyway, we fall back to a plain open of the resolved URL.
 */
export async function openMissionControlWithAttribution(
  intent: HandoffIntent,
  fallbackUrl: string,
  itemId?: string,
): Promise<void> {
  const win = window.open("", "_blank");
  if (win) {
    try {
      win.opener = null;
      win.document.write(
        '<title>Opening secure checkout…</title>' +
          '<body style="margin:0;display:grid;place-items:center;height:100vh;' +
          'font-family:system-ui,sans-serif;background:#0b0f14;color:#94a3b8">' +
          "<p>Opening secure checkout…</p></body>",
      );
    } catch {
      /* cross-origin quirks — the redirect below still works */
    }
  }

  const resolved =
    (await fetchBillingHandoffUrl(intent, itemId)) ?? withUsernameHint(fallbackUrl);

  // Last step, and deliberately after the handoff has been resolved: while the
  // A$1 test catalogue is switched on, every money-moving CTA is steered to it.
  // Rewriting the constants instead would be a no-op whenever the mint
  // succeeded — see src/lib/pricingMock.ts. A no-op when the mode is off.
  const url = applyPricingMockRouting(resolved, intent);

  if (win && !win.closed) {
    win.location.href = url;
  } else {
    // Popup was blocked; a direct open is the best remaining option.
    openMissionControl(url);
  }
}

// ── Purchase history read-back (user-attributed pricing workflow) ───────────

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

export async function fetchPurchaseHistory(
  opts: { limit?: number; offset?: number; status?: string } = {},
): Promise<PurchaseHistoryResult> {
  const { invokeSecureFunction } = await import("@/lib/secureInvoke");
  const { data, error } = await invokeSecureFunction<PurchaseHistoryResult>(
    "mission-control-purchases",
    opts,
  );
  if (error) throw new Error(error.message ?? "Failed to fetch purchase history");
  return (
    data ?? {
      purchases: [],
      pagination: { limit: 25, offset: 0, total: 0, hasMore: false, nextOffset: null },
    }
  );
}

// ── Saved payment methods (billing & usage page) ────────────────────────────
// Display references only (brand / last4 / expiry). The cards live at Stripe;
// adding one goes through the Aurixa storefront's Stripe-hosted capture page.

export interface PaymentMethodRecord {
  id: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  funding: string | null;
  /** Cardholder name/email as entered on Stripe's page. Display only. */
  billingName: string | null;
  billingEmail: string | null;
  /** 1 = primary, 2 = secondary, 3 = backup. */
  priority: number;
  role: string;
  originUsername: string | null;
  createdAt: string;
  /** Stripe's own id for this card. */
  stripePaymentMethodId?: string | null;
  /**
   * Whether Stripe will actually charge this card.
   *
   * Distinct from `priority`, which is only this platform's record of intent.
   * They diverge when a sync fails, a card is changed in the Stripe dashboard,
   * or a subscription flow moves the default — and a badge that says "Primary"
   * while Stripe charges a different card is the failure worth surfacing.
   *
   * `null` means Stripe could not be reached, which is not the same as false.
   */
  isStripeDefault?: boolean | null;
  /** Whether Stripe still has this card attached. null = not reachable. */
  attachedAtStripe?: boolean | null;
}

export interface PaymentMethodsResult {
  paymentMethods: PaymentMethodRecord[];
  maxPaymentMethods: number;
  /** False when Mission Control could not reach Stripe on this call. */
  stripeVerified?: boolean;
  stripeDefaultPaymentMethodId?: string | null;
}

export async function fetchPaymentMethods(): Promise<PaymentMethodsResult> {
  const { invokeSecureFunction } = await import("@/lib/secureInvoke");
  const { data, error } = await invokeSecureFunction<PaymentMethodsResult>(
    "mission-control-payment-methods",
    { action: "list" },
  );
  if (error) throw new Error(error.message ?? "Failed to fetch payment methods");
  return data ?? { paymentMethods: [], maxPaymentMethods: 3 };
}

export type PaymentMethodUpdate =
  | { action: "make_primary"; paymentMethodId: string }
  | { action: "reorder"; orderedIds: string[] }
  | { action: "remove"; paymentMethodId: string }
  /** Push the primary card back onto the Stripe customer as its default. */
  | { action: "sync_default" };

/** Admin-only server-side; throws with the server's error message otherwise. */
export async function updatePaymentMethods(
  update: PaymentMethodUpdate,
): Promise<PaymentMethodsResult> {
  const { invokeSecureFunction } = await import("@/lib/secureInvoke");
  const { data, error } = await invokeSecureFunction<PaymentMethodsResult>(
    "mission-control-payment-methods",
    update as unknown as Record<string, unknown>,
  );
  if (error) throw new Error(error.message ?? "Failed to update payment methods");
  return data ?? { paymentMethods: [], maxPaymentMethods: 3 };
}

// ── Invoices (billing & usage page) ─────────────────────────────────────────

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

export async function fetchInvoices(
  opts: { limit?: number; offset?: number; status?: string } = {},
): Promise<InvoiceHistoryResult> {
  const { invokeSecureFunction } = await import("@/lib/secureInvoke");
  const { data, error } = await invokeSecureFunction<InvoiceHistoryResult>(
    "mission-control-invoices",
    opts,
  );
  if (error) throw new Error(error.message ?? "Failed to fetch invoices");
  return (
    data ?? {
      invoices: [],
      pagination: { limit: 25, offset: 0, total: 0, hasMore: false, nextOffset: null },
    }
  );
}

/** Formats integer cents as localised currency (defaults to AUD). */
export function formatMoney(cents: number | null | undefined, currency?: string | null): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  try {
    return new Intl.NumberFormat("en-AU", {
      style: "currency",
      currency: (currency ?? "AUD").toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency ?? ""}`.trim();
  }
}

/**
 * A billing plan change the workspace has not been shown yet.
 *
 * Announced once. A record with an acknowledgement rather than anything
 * derived from the current plan, because current state can say which plan you
 * are on and never whether you have been told you moved to it — and two
 * changes in a month would collapse into one.
 */
export interface PlanChangeNotice {
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
 * The newest unseen plan change, or null.
 *
 * Never throws. This drives a banner, and a workspace must not fail to load
 * because a banner lookup did.
 */
export async function fetchPlanChange(): Promise<PlanChangeNotice | null> {
  try {
    const { invokeSecureFunction } = await import("@/lib/secureInvoke");
    const { data, error } = await invokeSecureFunction<{ changes?: PlanChangeNotice[] }>(
      "mission-control-plan-change",
      {},
    );
    if (error) return null;
    return data?.changes?.[0] ?? null;
  } catch {
    return null;
  }
}

/** Retires a notice so it is never shown again. */
export async function acknowledgePlanChange(id: string): Promise<void> {
  try {
    const { invokeSecureFunction } = await import("@/lib/secureInvoke");
    await invokeSecureFunction("mission-control-plan-change", { id });
  } catch {
    // Worst case it shows once more. Not worth surfacing.
  }
}

/**
 * Whether this workspace is due to be asked for feedback.
 *
 * The cadence lives in Mission Control — first 30 days, then quarterly — so
 * every clone inherits it. Never throws: a prompt is the least important thing
 * on a dashboard.
 */
export interface FeedbackPrompt {
  due: boolean;
  campaignKey: string | null;
  reason: "onboarding" | "quarterly" | null;
  rewardAvailable: boolean;
  rewardTokens: number;
  feedbackUrl: string | null;
}

export async function fetchFeedbackPrompt(): Promise<FeedbackPrompt | null> {
  try {
    const { invokeSecureFunction } = await import("@/lib/secureInvoke");
    const { data, error } = await invokeSecureFunction<FeedbackPrompt>(
      "mission-control-feedback-prompt",
      {},
    );
    if (error || !data?.due) return null;
    const feedbackUrl = validateFeedbackUrl(data.feedbackUrl);
    if (!feedbackUrl) return null;
    return { ...data, feedbackUrl };
  } catch {
    return null;
  }
}
