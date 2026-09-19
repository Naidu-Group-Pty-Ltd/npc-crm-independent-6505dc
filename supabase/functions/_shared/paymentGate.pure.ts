/**
 * The activation gate, as this workspace sees it.
 *
 * ## This module interprets an answer; it does not make one
 *
 * Mission Control decides whether a workspace is open, and it is the only
 * thing that can: it holds the payment, the operator's overrides and the
 * clock. Re-deriving the verdict here from raw facts would be a second
 * implementation of the same rule in a place that can be edited independently,
 * and two implementations of "may this customer work" is exactly the drift
 * this platform cannot afford. So the transport carries a decided `status`,
 * and everything below is about reading it safely.
 *
 * ## Every failure is OPEN
 *
 * A missing key, an unreachable Mission Control, a 500, a body that will not
 * parse, a reason word this build has never heard of — all of them resolve to
 * an open workspace. That is not laxity, it is where the enforcement lives:
 * Mission Control itself refuses a locked clone's token and seat reservations
 * with 402, so a workspace that talks its way past this screen still cannot
 * spend Aurixa's money. What this screen can do that the server cannot is lock
 * out a PAYING customer over a network blip, and that is the failure worth
 * designing against.
 *
 * Parses under Deno: no `@/` aliases, explicit `.ts` extensions. The browser
 * reaches it through `src/lib/paymentGate/state.ts`.
 */

/** The vocabulary Mission Control answers in. Kept in step with
 *  `clonePaymentGate.pure.ts` there; an unrecognised value is treated as
 *  `unknown` and never as a lock. */
export type GateReason =
  | "not_gated"
  | "operator_unlocked"
  | "operator_locked"
  | "paid"
  | "no_deadline"
  | "within_grace"
  | "grace_expired"
  | "unknown";

const KNOWN_REASONS: readonly GateReason[] = [
  "not_gated",
  "operator_unlocked",
  "operator_locked",
  "paid",
  "no_deadline",
  "within_grace",
  "grace_expired",
];

export type GatePlan = {
  slug: string | null;
  name: string | null;
  amountDueCents: number | null;
  currency: string;
};

export type GateVerdict = {
  /** False when the answer came from a failure rather than from Mission
   *  Control. The workspace is open either way; the difference is whether a
   *  diagnostic surface may claim to know why. */
  known: boolean;
  /** Whether this workspace has an activation gate at all. False is the
   *  prime's answer, and every clone provisioned before the gate existed. */
  gated: boolean;
  locked: boolean;
  paid: boolean;
  reason: GateReason;
  locksAt: string | null;
  msRemaining: number | null;
  /** Open, unpaid and running out — the state a countdown belongs in. */
  counting: boolean;
  plan: GatePlan | null;
  cloneName: string | null;
  /** Where a customer pays if the one-click mint fails. Always a real URL when
   *  gated, never null, because a locked screen with no way out is worse than
   *  no screen. */
  pricingUrl: string | null;
  /** When this verdict was read, so a stale one can be recognised. */
  fetchedAt: string;
};

/** The answer for the prime, for every ungated clone, and for every failure. */
export function openVerdict(
  reason: GateReason = "not_gated",
  known = true,
): GateVerdict {
  return {
    known,
    gated: false,
    locked: false,
    paid: false,
    reason,
    locksAt: null,
    msRemaining: null,
    counting: false,
    plan: null,
    cloneName: null,
    pricingUrl: null,
    fetchedAt: new Date().toISOString(),
  };
}

/** Any failure at all. Open, and flagged as an answer nobody gave. */
export function unknownVerdict(): GateVerdict {
  return openVerdict("unknown", false);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Read Mission Control's gate response.
 *
 * A body is only allowed to LOCK when it says so unambiguously: `ok` true,
 * `gated` true, and a `status` of exactly `"locked"`. Everything else — a
 * missing field, a status this build does not recognise, an `ok: false` — is
 * an open workspace.
 */
export function parseGateResponse(body: unknown): GateVerdict {
  if (!body || typeof body !== "object") return unknownVerdict();
  const b = body as Record<string, unknown>;
  if (b.ok !== true) return unknownVerdict();
  if (b.gated !== true) return openVerdict("not_gated");

  const rawReason = str(b.reason);
  const reason: GateReason =
    rawReason && (KNOWN_REASONS as readonly string[]).includes(rawReason)
      ? (rawReason as GateReason)
      : "unknown";

  // The one place a lock is admitted. `status` is the decided answer; `locked`
  // is a convenience mirror and is deliberately NOT trusted on its own.
  const locked = b.status === "locked";

  const planRaw = (b.plan ?? null) as Record<string, unknown> | null;
  const checkoutRaw = (b.checkout ?? null) as Record<string, unknown> | null;
  const cloneRaw = (b.clone ?? null) as Record<string, unknown> | null;

  return {
    known: true,
    gated: true,
    locked,
    paid: b.paid === true,
    reason,
    locksAt: str(b.locks_at),
    msRemaining: num(b.ms_remaining),
    counting: b.counting === true && !locked,
    plan: planRaw
      ? {
          slug: str(planRaw.slug),
          name: str(planRaw.name),
          amountDueCents: num(planRaw.amount_due_cents),
          currency: str(planRaw.currency) ?? "AUD",
        }
      : null,
    cloneName: cloneRaw ? str(cloneRaw.name) : null,
    pricingUrl: checkoutRaw ? str(checkoutRaw.pricing_url) : null,
    fetchedAt: new Date().toISOString(),
  };
}

/** Does this verdict block the dashboard? One expression, so no surface can
 *  decide differently from another. */
export function shouldBlock(verdict: GateVerdict): boolean {
  return verdict.gated && verdict.locked;
}

/**
 * Should the workspace be prompted to activate while it still works?
 *
 * `counting` is the running-out case and was once the whole rule. It missed
 * the gate an operator gave no deadline: `gated`, unpaid, open, and not on a
 * clock — a workspace that owes an activation payment and had no button, link
 * or page anywhere in the product from which to pay it, because the banner is
 * the only payment CTA that exists inside an unlocked dashboard.
 *
 * So the question is "does this workspace owe money it can still settle",
 * which is `payingCanUnlock` minus the locked case the screen handles.
 */
export function shouldWarn(verdict: GateVerdict): boolean {
  return !verdict.locked && payingCanUnlock(verdict);
}

/**
 * Can this customer pay their way out of this state?
 *
 * ## Why this is not `!paid`
 *
 * An operator's standing lock outranks the money. Mission Control's resolver
 * reads the override BEFORE `paid_at`, deliberately — locking is how a
 * workspace is suspended even though it once paid — and settling a payment
 * never clears it. So a pay button on an `operator_locked` gate takes the
 * money, stamps `paid_at`, and leaves the workspace exactly as shut. Mission
 * Control refuses to mint that checkout for the same reason; this is the same
 * rule said on the near side, so the button is not offered and then rejected.
 *
 * ## Why an ALLOW-list
 *
 * The screen used to ask `reason !== "operator_locked"`, which answers "yes"
 * to every reason word this build has never heard of — including the `unknown`
 * this module returns for a body it could not read. That is a full-width
 * demand for money over a verdict whose entire meaning is that we do not know
 * why. Naming the states paying DOES discharge fails closed instead: a new
 * reason shows no CTA until somebody decides it should, and the customer is
 * left with support rather than a charge.
 */
export function payingCanUnlock(verdict: GateVerdict): boolean {
  if (!verdict.gated) return false;
  if (verdict.paid) return false;
  return (
    verdict.reason === "grace_expired" ||
    verdict.reason === "within_grace" ||
    verdict.reason === "no_deadline"
  );
}

/**
 * Recompute the countdown against the wall clock.
 *
 * The server's `ms_remaining` is right at the instant it was read and wrong a
 * minute later, and this screen is one people sit and look at. Derived from
 * `locksAt` so the number on screen is never behind the deadline it names.
 */
export function remainingMs(
  verdict: GateVerdict,
  now: Date = new Date(),
): number | null {
  if (!verdict.locksAt) return verdict.msRemaining;
  const at = Date.parse(verdict.locksAt);
  if (!Number.isFinite(at)) return verdict.msRemaining;
  return Math.max(at - now.getTime(), 0);
}

/** "2 days 4 hours", "3 hours", "12 minutes". Matches Mission Control's own
 *  wording so a customer and an operator describe the same deadline the same
 *  way. */
export function formatRemaining(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms)) return null;
  if (ms <= 0) return "none";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  const dayPart = `${days} day${days === 1 ? "" : "s"}`;
  return restHours > 0
    ? `${dayPart} ${restHours} hour${restHours === 1 ? "" : "s"}`
    : dayPart;
}

export function formatMoney(
  cents: number | null,
  currency = "AUD",
): string | null {
  if (cents === null) return null;
  try {
    return new Intl.NumberFormat("en-AU", {
      style: "currency",
      currency,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/**
 * What the customer is told, by reason.
 *
 * Written about the ACCOUNT and never about the person: nobody reading this
 * did anything wrong, and a workspace that has simply not been activated yet
 * is the ordinary case rather than a delinquency. Two rules follow — it never
 * says "your payment failed" (this build cannot know that), and it never
 * blames an administrator the reader may not have.
 */
export function lockedCopy(verdict: GateVerdict): {
  headline: string;
  body: string;
} {
  if (verdict.reason === "operator_locked") {
    return {
      headline: "This workspace is on hold",
      body: "Access has been paused by Aurixa Systems. Your data is untouched and nothing has been deleted. Get in touch and we will get you moving again.",
    };
  }
  // Locked, and paying is not what lifts it — a reason word this build does
  // not recognise. It must not say "complete the payment", because there is no
  // payment button under it and no reason to believe one would help.
  if (!payingCanUnlock(verdict)) {
    return {
      headline: "This workspace is on hold",
      body: "Access is paused and we cannot confirm why from here. Your data is untouched and nothing has been deleted. Get in touch and we will sort it out.",
    };
  }
  const plan = verdict.plan?.name ?? verdict.plan?.slug ?? null;
  return {
    headline: "Activate your workspace to continue",
    body: plan
      ? `Your ${plan} subscription has not been started yet. Complete the payment to unlock the dashboard — everything set up so far is kept exactly as it is.`
      : "Your subscription has not been started yet. Complete the payment to unlock the dashboard — everything set up so far is kept exactly as it is.",
  };
}

/** The countdown banner's sentence while the window is still open. */
export function warningCopy(
  verdict: GateVerdict,
  now: Date = new Date(),
): string {
  const left = formatRemaining(remainingMs(verdict, now));
  const plan = verdict.plan?.name ?? verdict.plan?.slug ?? "your plan";
  return left && left !== "none"
    ? `Activate ${plan} within ${left} to keep this workspace open.`
    : `Activate ${plan} to keep this workspace open.`;
}
