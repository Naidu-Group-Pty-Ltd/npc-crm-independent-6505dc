/**
 * One screening status, spoken the same way everywhere.
 *
 * ── What the MLRO was looking at ──────────────────────────────────────
 * Three surfaces described Stage 5 and none agreed. The stage card said
 * "Screening has not started" — correct, the queue was dead. The live rail
 * said "Screening is running · Go there", and the button landed on a stage
 * that offered nothing to do. The journey rail said "Not started".
 *
 * Three answers to one question, and no way to choose between them. That is
 * the dead end this vocabulary exists to close.
 *
 * The invariant running through it: **`queued` only means "in progress" if
 * something is consuming the queue.** Measured in production, a request sat
 * `queued` with `attempts = 0` indefinitely while the screen said the engine
 * was working.
 */
import { describe, expect, it } from "vitest";

import {
  SCREENING_STALL_MS,
  deriveScreeningStatus,
  type ScreeningSubjectFact,
} from "./screeningStatus.pure";

const NOW = Date.parse("2026-08-16T12:00:00.000Z");
const agoMs = (ms: number) => new Date(NOW - ms).toISOString();

const subject = (over: Partial<ScreeningSubjectFact> = {}): ScreeningSubjectFact => ({
  required: true, state: "not_started", updated_at: agoMs(1000), matches: [], ...over,
});

describe("a queue nobody drains is not screening in progress", () => {
  it("reports work as in progress inside the stall window", () => {
    const r = deriveScreeningStatus(
      [subject({ state: "queued", updated_at: agoMs(30_000) })], NOW);
    expect(r.status).toBe("in_progress");
    expect(r.label).toBe("Screening in progress");
    expect(r.owner).toBe("system");
  });

  it("stops claiming progress once nothing has picked it up", () => {
    const r = deriveScreeningStatus(
      [subject({ state: "queued", updated_at: agoMs(SCREENING_STALL_MS) })], NOW);
    expect(r.status).toBe("required");
    expect(r.detail).toMatch(/nothing picking them up/i);
    expect(r.detail).toMatch(/refused rather than sent twice/i);
    expect(r.owner).toBe("administrator");
  });

  it("treats a stalled 'processing' the same as a stalled 'queued'", () => {
    const r = deriveScreeningStatus(
      [subject({ state: "processing", updated_at: agoMs(SCREENING_STALL_MS + 1) })], NOW);
    expect(r.status).toBe("required");
  });

  it("never calls a subject stalled on a timestamp it does not have", () => {
    // Not reading is not evidence of a stall.
    const r = deriveScreeningStatus([subject({ state: "queued", updated_at: null })], NOW);
    expect(r.status).toBe("in_progress");
  });
});

describe("the five statuses an MLRO reads", () => {
  it("required — nobody has run it", () => {
    const r = deriveScreeningStatus([subject()], NOW);
    expect(r.status).toBe("required");
    expect(r.blocking).toBe(true);
    expect(r.owner).toBe("analyst");
  });

  it("manual review — a candidate needs adjudication", () => {
    for (const s of [
      subject({ state: "possible_match" }),
      subject({ state: "completed", matches: [{ status: "open" }] }),
    ]) {
      const r = deriveScreeningStatus([s], NOW);
      expect(r.status).toBe("manual_review");
      expect(r.owner).toBe("reviewer");
    }
  });

  it("manual review — a technical failure, owned by an administrator", () => {
    const r = deriveScreeningStatus([subject({ state: "error" })], NOW);
    expect(r.status).toBe("manual_review");
    expect(r.owner).toBe("administrator");
    // A failure never reads as clear.
    expect(r.detail).toMatch(/never reads as clear/i);
    expect(r.blocking).toBe(true);
  });

  it("completed — every required subject resolved", () => {
    for (const state of ["completed", "false_positive", "confirmed_match"]) {
      const r = deriveScreeningStatus([subject({ state })], NOW);
      expect(r.status, state).toBe("completed");
      expect(r.blocking, state).toBe(false);
    }
  });

  it("completed is evidence, never a service-gate clearance", () => {
    const r = deriveScreeningStatus([subject({ state: "completed" })], NOW);
    expect(r.detail).toMatch(/not a service-gate clearance/i);
  });

  it("not required — no subject requires screening, and it says what that means", () => {
    const r = deriveScreeningStatus([subject({ required: false })], NOW);
    expect(r.status).toBe("not_required");
    expect(r.blocking).toBe(false);
    // Must never be readable as "everyone is clear".
    expect(r.detail).toMatch(/scoping outcome, not a clearance/i);
    expect(r.detail).not.toMatch(/clear\b(?!ance)/i);
  });

  it("treats a not_required STATE as out of scope too", () => {
    expect(deriveScreeningStatus([subject({ state: "not_required" })], NOW).status)
      .toBe("not_required");
  });
});

describe("precedence — the most blocking thing wins", () => {
  it("puts adjudication ahead of an unstarted subject", () => {
    const r = deriveScreeningStatus(
      [subject({ state: "possible_match" }), subject({ state: "not_started" })], NOW);
    expect(r.status).toBe("manual_review");
  });

  it("puts adjudication ahead of a technical failure", () => {
    const r = deriveScreeningStatus(
      [subject({ state: "error" }), subject({ state: "possible_match" })], NOW);
    expect(r.status).toBe("manual_review");
    expect(r.owner).toBe("reviewer");
  });

  it("does not report completed while one subject is outstanding", () => {
    const r = deriveScreeningStatus(
      [subject({ state: "completed" }), subject({ state: "not_started" })], NOW);
    expect(r.status).toBe("required");
  });

  it("does not report completed while one subject is stalled", () => {
    const r = deriveScreeningStatus([
      subject({ state: "completed" }),
      subject({ state: "queued", updated_at: agoMs(SCREENING_STALL_MS + 1) }),
    ], NOW);
    expect(r.status).toBe("required");
  });

  it("ignores a party the server marked not required", () => {
    const r = deriveScreeningStatus([
      subject({ state: "completed" }),
      subject({ required: false, state: "not_started" }),
    ], NOW);
    expect(r.status).toBe("completed");
  });
});

describe("an unread position is never a settled one", () => {
  it("does not report 'not required' when the list could not be read", () => {
    // An empty list and an unread list are different facts, and only one of
    // them means nobody needs screening.
    const r = deriveScreeningStatus(null, NOW);
    expect(r.status).toBe("required");
    expect(r.blocking).toBe(true);
    expect(r.detail).toMatch(/could not be read/i);
  });

  it("always produces a label, a detail and an owner", () => {
    const cases: Array<ScreeningSubjectFact[] | null> = [
      null, [], [subject()], [subject({ state: "error" })],
      [subject({ state: "possible_match" })], [subject({ state: "completed" })],
      [subject({ state: "queued", updated_at: agoMs(SCREENING_STALL_MS + 1) })],
    ];
    for (const c of cases) {
      const r = deriveScreeningStatus(c, NOW);
      expect(r.label).toBeTruthy();
      expect(r.detail).toBeTruthy();
      expect(r.owner).toBeTruthy();
      // Only a settled stage is non-blocking.
      expect(r.blocking).toBe(!["completed", "not_required"].includes(r.status));
    }
  });
});
