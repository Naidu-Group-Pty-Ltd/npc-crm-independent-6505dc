/**
 * When an open case refetches itself.
 *
 * Every AML surface fetched once, on mount, so a document the client uploaded
 * or a screening result landing never reached a tab that was already open.
 * The rules below are the ones that make polling worth having without making
 * it expensive.
 */
import { describe, expect, it } from "vitest";

import {
  POLL_MS_IN_FLIGHT, POLL_MS_SETTLED, POLL_MS_WAITING,
  decideLivePoll, livePollActivity, type LivePollInput,
} from "./livePolling.pure";

const input = (over: Partial<LivePollInput> = {}): LivePollInput => ({
  visible: true, activity: "in_flight", busy: false, ...over,
});

describe("a hidden tab costs nothing", () => {
  it("does not poll, whatever the case is doing", () => {
    for (const activity of ["in_flight", "waiting_on_others", "settled"] as const) {
      const d = decideLivePoll(input({ visible: false, activity }));
      expect(d.intervalMs).toBeNull();
      expect(d.reason).toMatch(/hidden/);
    }
  });

  it("does not stack a poll behind one already running", () => {
    expect(decideLivePoll(input({ busy: true })).intervalMs).toBeNull();
  });
});

describe("cadence follows what the case is actually doing", () => {
  it("watches closely while work is in flight", () => {
    expect(decideLivePoll(input({ activity: "in_flight" })).intervalMs)
      .toBe(POLL_MS_IN_FLIGHT);
  });

  it("eases off when the wait is on a person", () => {
    expect(decideLivePoll(input({ activity: "waiting_on_others" })).intervalMs)
      .toBe(POLL_MS_WAITING);
  });

  it("still refetches a settled case, but rarely", () => {
    const d = decideLivePoll(input({ activity: "settled" }));
    expect(d.intervalMs).toBe(POLL_MS_SETTLED);
    // Never zero and never null while visible: a case that looks settled can
    // still be changed by somebody else.
    expect(d.intervalMs).toBeGreaterThan(0);
  });

  it("orders the cadences so busier is never slower", () => {
    expect(POLL_MS_IN_FLIGHT).toBeLessThan(POLL_MS_WAITING);
    expect(POLL_MS_WAITING).toBeLessThan(POLL_MS_SETTLED);
    // And nothing polls so hard it becomes a load problem.
    expect(POLL_MS_IN_FLIGHT).toBeGreaterThanOrEqual(5_000);
  });

  it("always explains itself", () => {
    for (const visible of [true, false]) {
      for (const activity of ["in_flight", "waiting_on_others", "settled"] as const) {
        expect(decideLivePoll(input({ visible, activity })).reason).toBeTruthy();
      }
    }
  });
});

describe("what counts as busy", () => {
  it("treats screening in flight as the closest-watched state", () => {
    expect(livePollActivity({
      screeningInFlight: true, awaitingClient: false, outstandingWork: false,
    })).toBe("in_flight");
  });

  it("treats a wait on the client or on work as slower", () => {
    expect(livePollActivity({
      screeningInFlight: false, awaitingClient: true, outstandingWork: false,
    })).toBe("waiting_on_others");
    expect(livePollActivity({
      screeningInFlight: false, awaitingClient: false, outstandingWork: true,
    })).toBe("waiting_on_others");
  });

  it("settles only when nothing is outstanding anywhere", () => {
    expect(livePollActivity({
      screeningInFlight: false, awaitingClient: false, outstandingWork: false,
    })).toBe("settled");
  });

  it("lets in-flight work outrank everything else", () => {
    expect(livePollActivity({
      screeningInFlight: true, awaitingClient: true, outstandingWork: true,
    })).toBe("in_flight");
  });
});
