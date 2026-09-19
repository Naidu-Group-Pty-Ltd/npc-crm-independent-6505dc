/**
 * What a customer identity verification costs a workspace.
 *
 * ## The model
 *
 * Didit bills Aurixa in money — USD 0.30 for a complete verification, at the
 * standalone per-operation prices (`id_verification_api` 0.20,
 * `passive_liveness_api` 0.05, `face_match_api` 0.05, none of which carries a
 * free tier). **That cost is the platform's and is not passed on.** A
 * workspace pays in TOKENS instead, on the same balance its reports draw from:
 *
 *   - **5 tokens for the attempt**, whenever an attempt is actually consumed
 *   - **5 tokens more when the verification succeeds**
 *
 * So a verified customer costs 10 and a genuine decline costs 5.
 *
 * ## Why "attempt consumed" is the trigger and not "a call was made"
 *
 * This product already owns a precise definition of an attempt, and it is
 * deliberately narrower than "we spent money". `standaloneVerification.ts`
 * refuses to consume one where the provider looked and could not examine the
 * document (`capture_unusable` — the portal renders it as "please take the
 * photo again"), and records every infrastructure condition — an outage, a
 * timeout, an unreadable object, an exhausted vendor balance — without
 * touching the customer's attempt count at all.
 *
 * Charging tokens on the same signal means **a workspace is never billed for
 * this platform's own failures, or for a photograph the provider could not
 * read.** It also means the token ledger and the customer-facing attempt
 * counter can never disagree about how many attempts were spent, because they
 * are the same fact read once.
 *
 * ## Why the reserve is the maximum
 *
 * The charge is not known until the vendor answers, and the vendor is not
 * asked until the workspace can afford the answer. So the reservation is the
 * WORST case — attempt plus success — and the commit settles the truth. That
 * ordering is what stops a workspace with an empty balance spending the
 * platform's USD 0.30; reserving the attempt alone would let a success land
 * that nobody could pay for.
 *
 * ## ONE number, and it is Mission Control's
 *
 * Mission Control's report cost index (`report_credit_costs`) is the
 * platform's price list, it already carries a row for
 * `aml_identity_check`, and it is what the Aurixa Systems pricing page
 * publishes to customers — so an operator repricing there must reach every
 * workspace without a deploy, which is the whole design of
 * `getCreditCostForKind`. A literal in this file would be a SECOND price
 * list, silently disagreeing with the published one.
 *
 * So the index carries the ATTEMPT price and a verified identity costs it
 * TWICE. One number to reprice, both halves moving together, no second row
 * to forget. Everything below takes that price as a parameter; the constant
 * is the fallback for a Mission Control that cannot be reached, which is the
 * same contract `tokenEstimator.ts` already has for reports.
 */

/**
 * The metering kind, which is also the cost index's slug.
 *
 * Named once. `getCreditCostForKind` matches `metadata.token_kind` first and
 * the slug second, and both are this string on the live row.
 */
export const VERIFICATION_METERING_KIND = 'aml_identity_check';

/**
 * Charged whenever an attempt is consumed, whatever the outcome.
 *
 * FALLBACK ONLY — the live price comes from Mission Control's cost index.
 * It equals the index's current value (5) so an unreachable Mission Control
 * charges what a reachable one would, rather than something a customer was
 * never quoted.
 */
export const VERIFICATION_ATTEMPT_TOKENS = 5;

/** The attempt price, doubled: what is held before the first vendor call. */
export function verificationReserveTokens(
  attemptTokens: number = VERIFICATION_ATTEMPT_TOKENS,
): number {
  return sane(attemptTokens) * 2;
}

/**
 * The fallback reserve.
 *
 * Derived, never a third literal: a number typed here could drift from the
 * attempt price and would do so silently, because a reservation that is too
 * small fails only for the workspace that happens to be near its balance.
 */
export const VERIFICATION_RESERVE_TOKENS = verificationReserveTokens();

/**
 * A price that can actually be charged.
 *
 * A negative, fractional or non-numeric cost is a data problem in the index,
 * not a free verification — the same judgement `getCreditCostForKind` makes,
 * repeated here because this module is also called with a hand-passed value.
 */
function sane(tokens: number): number {
  return Number.isFinite(tokens) && tokens >= 0
    ? Math.ceil(tokens)
    : VERIFICATION_ATTEMPT_TOKENS;
}

/**
 * Every spelling of "the identity was verified", because there are two.
 *
 * This product carries two status vocabularies for the same fact and both
 * reach this module:
 *
 *   - **canonical** — `aml.verification_checks.status`, written by
 *     `canonicalOutcome`, where success is **`passed`**;
 *   - **provider** — `aml.identity_checks.status` on the legacy staff route,
 *     which stores the adapter's own word, where success is **`verified`**.
 *
 * Naming one and hoping is how a success charge silently never fires: the
 * standalone path settles `passed` and a `=== 'verified'` test would have
 * charged 5 for every verified customer in production while looking correct
 * in review. Both are named here, once, and `verificationTokenPriceSpec`
 * asserts the set against what each route actually writes.
 *
 * Nothing else is a success. A referral (`referred` / `manual_review`) is a
 * case a human must still decide, so the identity is not verified and the
 * surcharge is not earned; `failed` and `exhausted` are declines. All of them
 * consumed an attempt and all of them cost the attempt charge alone.
 */
export const VERIFIED_OUTCOMES: ReadonlySet<string> = new Set(['passed', 'verified']);

/** True only where the run actually verified the customer's identity. */
export function isVerifiedOutcome(outcome: string | null | undefined): boolean {
  return typeof outcome === 'string' && VERIFIED_OUTCOMES.has(outcome);
}

export interface VerificationChargeInput {
  /** The product's own decision, read from the check row — never re-derived. */
  readonly attemptConsumed: boolean;
  /** The settled status, in either vocabulary above. */
  readonly outcome: string | null | undefined;
}

/**
 * Tokens owed for one settled verification run.
 *
 * Total: 0 where no attempt was consumed, 5 for a consumed attempt, 10 where
 * that attempt also verified the customer.
 */
export function verificationTokenCharge(
  input: VerificationChargeInput,
  attemptTokens: number = VERIFICATION_ATTEMPT_TOKENS,
): number {
  if (!input.attemptConsumed) return 0;
  const attempt = sane(attemptTokens);
  return isVerifiedOutcome(input.outcome) ? attempt * 2 : attempt;
}

/** How the charge is described on the ledger and in the case event. */
export function describeVerificationCharge(
  input: VerificationChargeInput,
  attemptTokens: number = VERIFICATION_ATTEMPT_TOKENS,
): string {
  const total = verificationTokenCharge(input, attemptTokens);
  if (total === 0) return 'no attempt consumed — nothing charged';
  const attempt = sane(attemptTokens);
  return isVerifiedOutcome(input.outcome)
    ? `${attempt} attempt + ${attempt} verified = ${total} tokens`
    : `${attempt} attempt (${input.outcome ?? 'unsettled'}) = ${total} tokens`;
}

/**
 * The condition recorded when a workspace cannot afford the reservation.
 *
 * It is a `provider_error_category` value because that is the column the
 * surfaces already render, but it is deliberately NOT one of the provider's
 * own categories, and in particular it is not `insufficient_credits` — that
 * one means DIDIT's balance is empty (a 403 carrying "credit") and sends an
 * operator to top up the vendor account. This one means the WORKSPACE's token
 * balance is empty and sends them to Mission Control. Collapsing the two
 * would send every operator to the wrong remedy, which is the defect this
 * module's own area has already shipped once.
 *
 * `processing_status` stays `technical_failure`: no attempt is consumed, no
 * customer outcome is written, and `retry_verification_processing` can re-run
 * the check once the balance is topped up.
 */
export const WORKSPACE_OUT_OF_TOKENS = 'workspace_out_of_tokens';
