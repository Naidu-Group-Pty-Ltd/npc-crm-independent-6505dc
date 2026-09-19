/**
 * What Stage 5 is allowed to run without anybody pressing anything.
 *
 * ── The complaint ─────────────────────────────────────────────────────
 * "The screening is simply being placed into a Queued state, which is not an
 * acceptable user experience." Measured on the production case: the subject
 * had sat `queued` for 130 minutes, and the only exit was an operator
 * noticing a button. A status whose only escape is a human is a dead end
 * with a spinner on it.
 *
 * ── The two-sided invariant ───────────────────────────────────────────
 * Automatic recovery has a failure mode in each direction, and this module
 * has to be wrong in neither:
 *
 *   TOO NARROW   the case sits queued for ever, which is the reported bug.
 *
 *   TOO WIDE     the stage calls a paid sanctions provider on every page
 *                view. `processScreeningEvent` claims `queued` and `error`
 *                alike, so including `error` here turns a failing subject
 *                into a retry loop billed per refresh.
 *
 * So `error` is excluded on purpose, and the tests below assert that
 * exclusion as hard as they assert the recovery itself. A failure keeps its
 * explicit Retry, which is a person choosing to spend another attempt.
 *
 * Nothing here produces a screening OUTCOME. This decides only WHICH
 * subjects may be handed to the consumer.
 */
import { describe, expect, it } from "vitest";

import {
  SCREENING_STALL_SECONDS,
  recoverableSubjects,
  type RecoveryCandidate,
} from "../../../supabase/functions/_shared/aml/screeningPolicy.pure";

const NOW = Date.parse("2026-08-16T14:00:00.000Z");
const agoSeconds = (s: number) => new Date(NOW - s * 1000).toISOString();

const candidate = (over: Partial<RecoveryCandidate> = {}): RecoveryCandidate => ({
  id: "s1",
  state: "queued",
  screeningCheckId: null,
  updatedAt: agoSeconds(10),
  required: true,
  ...over,
});

const ids = (rows: RecoveryCandidate[]) => rows.map((r) => r.id);

/* ═════════ The bug: a queue nobody drains ═════════ */

describe("a stalled request recovers itself", () => {
  it("recovers a queued subject past the stall window", () => {
    const out = recoverableSubjects(
      [candidate({ updatedAt: agoSeconds(SCREENING_STALL_SECONDS) })], NOW);
    expect(ids(out)).toEqual(["s1"]);
  });

  it("recovers the 130-minute production case", () => {
    // The measured complaint, expressed as a fact rather than a duration.
    const out = recoverableSubjects(
      [candidate({ updatedAt: agoSeconds(130 * 60) })], NOW);
    expect(out).toHaveLength(1);
  });

  it("treats a stalled 'processing' the same as a stalled 'queued'", () => {
    // Both mean the same thing: something claimed it and never came back.
    const out = recoverableSubjects(
      [candidate({ state: "processing", updatedAt: agoSeconds(SCREENING_STALL_SECONDS + 1) })],
      NOW);
    expect(out).toHaveLength(1);
  });

  it("leaves work that is genuinely in flight alone", () => {
    // Inside the window the queue may still be about to consume it, and
    // releasing it would race a live consumer.
    expect(recoverableSubjects([candidate({ updatedAt: agoSeconds(5) })], NOW)).toEqual([]);
    expect(recoverableSubjects(
      [candidate({ state: "processing", updatedAt: agoSeconds(5) })], NOW)).toEqual([]);
  });

  it("uses the boundary inclusively, so a subject exactly at the window recovers", () => {
    // An off-by-one here is a case that never recovers, which is the bug.
    expect(recoverableSubjects(
      [candidate({ updatedAt: agoSeconds(SCREENING_STALL_SECONDS) })], NOW)).toHaveLength(1);
    expect(recoverableSubjects(
      [candidate({ updatedAt: agoSeconds(SCREENING_STALL_SECONDS - 1) })], NOW)).toEqual([]);
  });

  it("honours a configured stall window", () => {
    const s = [candidate({ updatedAt: agoSeconds(60) })];
    expect(recoverableSubjects(s, NOW, 30)).toHaveLength(1);
    expect(recoverableSubjects(s, NOW, 600)).toEqual([]);
  });
});

describe("a subject nobody ever attempted", () => {
  it("runs 'not_started' immediately, without waiting out a stall window", () => {
    // Nothing has been spent, so there is nothing to be careful about — and
    // making an operator press "Run screening" on a stage the system already
    // knows is required is the click this feature exists to remove.
    expect(recoverableSubjects([candidate({ state: "not_started" })], NOW)).toHaveLength(1);
  });

  it("runs it even with no timestamp at all", () => {
    // A never-attempted subject is not judged on freshness.
    expect(recoverableSubjects(
      [candidate({ state: "not_started", updatedAt: null })], NOW)).toHaveLength(1);
  });
});

/* ═════════ The other failure mode: a provider called on every refresh ═════════ */

describe("automatic must never mean 'on every page view'", () => {
  it("NEVER auto-runs a subject in error", () => {
    // The consumer claims `queued` and `error` alike. Auto-running an errored
    // subject re-runs a paid provider on every read of the page, for ever.
    for (const updatedAt of [agoSeconds(1), agoSeconds(10_000), null]) {
      expect(recoverableSubjects([candidate({ state: "error", updatedAt })], NOW),
        String(updatedAt)).toEqual([]);
    }
  });

  it("never auto-runs a subject that already holds a check", () => {
    // A check means the provider WAS reached. That execution is in flight or
    // finished, and re-running it duplicates a completed attempt.
    for (const state of ["queued", "processing", "not_started"]) {
      expect(recoverableSubjects([candidate({
        state, screeningCheckId: "chk-1", updatedAt: agoSeconds(10_000),
      })], NOW), state).toEqual([]);
    }
  });

  it("never re-runs a settled subject", () => {
    // Completed, adjudicated or matched: all terminal. Re-running one would
    // overwrite a determination a person made.
    for (const state of [
      "completed", "false_positive", "confirmed_match", "possible_match", "not_required",
    ]) {
      expect(recoverableSubjects(
        [candidate({ state, updatedAt: agoSeconds(10_000) })], NOW), state).toEqual([]);
    }
  });

  it("ignores a subject the policy did not require", () => {
    // Screening someone the scope decision stood down is unauthorised work,
    // however stalled their row looks.
    expect(recoverableSubjects([candidate({
      required: false, state: "queued", updatedAt: agoSeconds(10_000),
    })], NOW)).toEqual([]);
    expect(recoverableSubjects(
      [candidate({ required: false, state: "not_started" })], NOW)).toEqual([]);
  });

  it("does not call a subject stalled on a timestamp it cannot read", () => {
    // Not reading a timestamp is not evidence of a stall. An unparseable
    // value must fail closed, or a malformed row is re-screened on every read.
    for (const updatedAt of [null, "", "not a date", "0000-00-00"]) {
      expect(recoverableSubjects([candidate({ updatedAt })], NOW),
        String(updatedAt)).toEqual([]);
    }
  });
});

/* ═════════ Behaviour across a real subject list ═════════ */

describe("across a case's whole subject list", () => {
  const mixed: RecoveryCandidate[] = [
    candidate({ id: "fresh", updatedAt: agoSeconds(5) }),
    candidate({ id: "stalled", updatedAt: agoSeconds(SCREENING_STALL_SECONDS + 60) }),
    candidate({ id: "new", state: "not_started" }),
    candidate({ id: "failed", state: "error", updatedAt: agoSeconds(10_000) }),
    candidate({ id: "done", state: "completed", updatedAt: agoSeconds(10_000) }),
    candidate({ id: "in-flight", screeningCheckId: "chk", updatedAt: agoSeconds(10_000) }),
    candidate({ id: "out-of-scope", required: false, updatedAt: agoSeconds(10_000) }),
  ];

  it("picks exactly the stalled and the never-attempted", () => {
    expect(ids(recoverableSubjects(mixed, NOW)).sort()).toEqual(["new", "stalled"]);
  });

  it("preserves the caller's order, so recovery is deterministic", () => {
    expect(ids(recoverableSubjects(mixed, NOW))).toEqual(["stalled", "new"]);
  });

  it("does not mutate what it was given", () => {
    const before = JSON.stringify(mixed);
    recoverableSubjects(mixed, NOW);
    expect(JSON.stringify(mixed)).toBe(before);
  });

  it("returns nothing for an empty list", () => {
    expect(recoverableSubjects([], NOW)).toEqual([]);
  });

  it("is stable when called twice on the same facts", () => {
    // The stage calls this on every read. Two reads a second apart must not
    // disagree about what may run.
    expect(recoverableSubjects(mixed, NOW)).toEqual(recoverableSubjects(mixed, NOW + 1000));
  });
});

/* ═════════ The window itself ═════════ */

describe("the stall window", () => {
  it("is the same constant the rest of the stage reasons with", () => {
    // Two windows would mean the UI calling a subject stalled while the
    // server refuses to recover it — the dead end, restored.
    expect(SCREENING_STALL_SECONDS).toBe(300);
  });
});
