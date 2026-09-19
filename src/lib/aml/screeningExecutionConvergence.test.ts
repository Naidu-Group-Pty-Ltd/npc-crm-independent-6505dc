/**
 * A screening request must never come to rest on `queued`.
 *
 * ── What was measured ─────────────────────────────────────────────────
 * Production, 2026-08-18. One subject, one case:
 *
 *   party_screening_subjects   state=queued  error_category=NULL
 *                              screening_check_id=NULL
 *                              updated_at=08:05:58   (27 minutes earlier)
 *   case_events                "Released a stalled screening request"
 *                              "Party screening queued"
 *                              …and nothing after it
 *   integration_outbox         6 × aml.screening.requested, attempts = 0
 *                              on every single one
 *   security_events            invalid_internal_signature × 2,839
 *
 * Both execution paths were dead and neither said so:
 *
 *   the WORKER never consumed one event — its cron invocation is rejected
 *   with `invalid_internal_signature`, so `attempts` never left 0;
 *
 *   the INLINE path ran, failed, and put the reason in a response field no
 *   surface reads — leaving the subject exactly as it found it.
 *
 * The stage then told the operator "nothing has picked it up", which was
 * false. Something had picked it up and the failure was discarded.
 *
 * These tests pin the rule that closes it: an attempt is judged by the
 * subject's own state afterwards, never by whether a promise rejected.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  inlineConvergenceDecision,
  screeningClaimDecision,
} from "../../../supabase/functions/_shared/aml/partyScreening.pure";
import { SCREENING_ERROR_DETAIL } from "../../../supabase/functions/_shared/aml/screeningPolicy.pure";

/* ═════════ The convergence rule ═════════ */

describe("an inline attempt is judged by where the subject ended up", () => {
  it("calls the production case a STRAND — queued, no check, no category", () => {
    // The exact row read from production. This is the case that must never
    // be treated as acceptable again.
    expect(inlineConvergenceDecision(
      { state: "queued", error_category: null, screening_check_id: null }, null,
    )).toBe("strand");
  });

  it("strands even when the attempt threw, if nothing was recorded", () => {
    // A rejected promise is not a recorded failure. The old code trusted it.
    expect(inlineConvergenceDecision(
      { state: "queued", error_category: null, screening_check_id: null },
      "TypeError: cannot read properties of undefined",
    )).toBe("strand");
  });

  it("treats a recorded category as settled", () => {
    expect(inlineConvergenceDecision(
      { state: "error", error_category: "list_data_unavailable", screening_check_id: null },
    )).toBe("settled");
  });

  it("treats a persisted check as settled even while still processing", () => {
    // The provider ran and produced durable evidence; the projection may
    // still be finishing. That is progress, not a stall.
    expect(inlineConvergenceDecision(
      { state: "processing", error_category: null, screening_check_id: "chk-1" },
    )).toBe("settled");
  });

  it("treats every terminal state as settled", () => {
    for (const state of [
      "completed", "possible_match", "confirmed_match", "false_positive",
      "error", "not_required", "not_started",
    ]) {
      expect(inlineConvergenceDecision(
        { state, error_category: null, screening_check_id: null }, null,
      ), state).toBe("settled");
    }
  });

  it("leaves a concurrently-held subject alone", () => {
    // The at-most-once guarantee lives in the claim. Forcing a category here
    // would overwrite a live holder's work.
    expect(inlineConvergenceDecision(
      { state: "processing", error_category: null, screening_check_id: null },
      "screening_in_flight: subject abc is being processed by another worker — retry",
    )).toBe("in_flight");
  });

  it("does not accept an unreadable row as evidence of settling", () => {
    for (const after of [null, undefined]) {
      expect(inlineConvergenceDecision(after, null)).toBe("strand");
    }
  });

  it("never returns a screening outcome", () => {
    for (const state of ["queued", "processing", "completed", "error"]) {
      const v = inlineConvergenceDecision({ state }, null);
      expect(["settled", "in_flight", "strand"]).toContain(v);
    }
  });
});

/* ═════════ The claim still guarantees at-most-once ═════════ */

describe("claiming is unchanged where it was already correct", () => {
  it("claims a queued or errored subject", () => {
    expect(screeningClaimDecision({ state: "queued" }, Date.now(), 15)).toBe("claim");
    expect(screeningClaimDecision({ state: "error" }, Date.now(), 15)).toBe("claim");
  });

  it("retries rather than steals a live processing subject", () => {
    const now = Date.now();
    expect(screeningClaimDecision(
      { state: "processing", updated_at: new Date(now - 60_000).toISOString() }, now, 15,
    )).toBe("in_flight_retry");
  });

  it("reclaims a processing subject whose holder died", () => {
    const now = Date.now();
    expect(screeningClaimDecision(
      { state: "processing", updated_at: new Date(now - 16 * 60_000).toISOString() }, now, 15,
    )).toBe("claim");
  });

  it("treats a settled subject as an obsolete delivery", () => {
    expect(screeningClaimDecision({ state: "completed" }, Date.now(), 15)).toBe("obsolete");
  });
});

/* ═════════ Every category an operator can now be shown ═════════ */

describe("every failure category explains itself", () => {
  const REQUIRED = [
    "list_data_unavailable", "provider_not_configured", "provider_misconfigured",
    "timeout", "provider_unavailable",
    // Added because each was previously a silent stall.
    "screening_claim_failed", "worker_not_invoked", "invalid_subject",
  ];

  it.each(REQUIRED)("%s has operator-facing detail", (category) => {
    const detail = SCREENING_ERROR_DETAIL[category];
    expect(detail, category).toBeTruthy();
    expect(detail.length, category).toBeGreaterThan(40);
  });

  it("never describes a failure as a screening result", () => {
    for (const [category, detail] of Object.entries(SCREENING_ERROR_DETAIL)) {
      expect(detail, category).not.toMatch(/\bis clear\b|no match found|screened clean/i);
    }
  });

  it("names who must act", () => {
    // A category with no owner is a dead end with extra words.
    for (const c of ["provider_not_configured", "provider_misconfigured", "worker_not_invoked"]) {
      expect(SCREENING_ERROR_DETAIL[c], c).toMatch(/administrator/i);
    }
  });

  it("says a re-run is safe where it is", () => {
    for (const c of ["timeout", "provider_unavailable", "screening_claim_failed"]) {
      expect(SCREENING_ERROR_DETAIL[c], c).toMatch(/re-running is safe|consumes no attempt/i);
    }
  });
});

/* ═════════ Source guards — the defects that hid inside the safety code ═════════ */

describe("the execution paths cannot silently swallow again", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const consumer = read("supabase/functions/_shared/aml/screeningConsumer.ts");
  const cases = read("supabase/functions/aml-cases/index.ts");

  it("the claim captures its database error", () => {
    /*
     * The original read `const { data: claimed } = await …`. PostgREST
     * returns `{ data: null, error }` on ANY failure, and `data: null` is
     * also what losing the race looks like — so every database fault was
     * reported as "another worker has it, retry", which converges nowhere.
     */
    expect(consumer).toMatch(/const \{ data: claimed, error: claimError \}/);
    expect(consumer).toContain("screening_claim_failed");
  });

  it("a claim failure is recorded against the subject, not just thrown", () => {
    const claimBlock = consumer.slice(
      consumer.indexOf("if (claimError)"), consumer.indexOf("if (!claimed)"));
    expect(claimBlock).toContain("recordTechnicalFailure");
  });

  it("a genuine race is still distinguished from a database failure", () => {
    expect(consumer).toContain("screening_in_flight");
    expect(consumer.indexOf("if (claimError)"))
      .toBeLessThan(consumer.indexOf("if (!claimed)"));
  });

  it("the failure recorder always sets an error state and a category", () => {
    const fn = consumer.slice(
      consumer.indexOf("export async function recordTechnicalFailure"),
      consumer.indexOf("export async function processScreeningEvent"));
    expect(fn).toContain("state: 'error'");
    expect(fn).toContain("error_category: category");
    // No screening was performed, so the freshness clock must not move.
    expect(fn).not.toContain("last_screened_at");
  });

  it("inline execution re-reads the subject and converges it", () => {
    const fn = cases.slice(
      cases.indexOf("async function runScreeningInline"),
      cases.indexOf("async function ensureScreeningSubjects"));
    expect(fn).toContain("inlineConvergenceDecision");
    expect(fn).toContain("recordTechnicalFailure");
    expect(fn).toContain("worker_not_invoked");
  });

  it("no execution path calls the consumer without converging afterwards", () => {
    // Exactly one raw call remains — the one inside the convergence helper.
    const raw = [...cases.matchAll(/await processScreeningEvent\(/g)].length;
    expect(raw).toBe(1);
  });

  it("a provider that cannot run fails the request instead of leaving it queued", () => {
    // The self-healing gate had no else-branch: when the provider was not
    // ready, a stalled subject simply stayed queued for ever.
    //
    // The condition now also requires the sanctions scope to be REQUIRED.
    // That is not a weakening: a case the policy exempted has no request to
    // converge, and failing its subject with `provider_not_configured` would
    // report a blocker on a scope nobody asked for. The else-branch still
    // exists for every case that does require screening.
    expect(cases).toContain(
      "if (canWrite && scope.sanctions.required && !providerReadyForAuto)");
    expect(cases).toMatch(/notReadyCategory/);
  });

  it("auto-execution never runs a scope the policy did not require", () => {
    // Auto-recovery bills a provider call. Doing that for an exempt case
    // would spend money on a check nobody asked for, and would produce
    // screening evidence the policy record says was not obtained.
    expect(cases).toContain(
      "const providerReadyForAuto = providerReady && scope.sanctions.required;");
  });
});
