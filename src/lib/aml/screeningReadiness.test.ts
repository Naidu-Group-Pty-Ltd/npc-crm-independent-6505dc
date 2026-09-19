/**
 * Screening readiness, read against the state production is actually in.
 *
 * The operator saw one refusal, was told to flip the provider to live, and
 * would then have hit a second, different refusal — because
 * `aml.sanctions_entries` and `aml.sanctions_list_syncs` are both empty.
 * These tests pin that BOTH are reported at once.
 */
import { describe, expect, it } from "vitest";

import {
  deriveAmlScreeningReadiness,
  SCREENING_MAX_AGE_HOURS_DEFAULT,
  type AmlScreeningReadinessFacts,
} from "./screeningReadiness";

const NOW = Date.parse("2026-08-15T18:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3600 * 1000).toISOString();

/** Exactly what `aml.provider_configs` holds for pep_sanctions today. */
const productionProvider = { providerKey: "local_lists", mode: "simulator", active: true };
const freshDfat = {
  listCode: "dfat", lastSuccessAt: hoursAgo(2), entryCount: 8421,
  latestAttemptStatus: "succeeded",
};

const facts = (over: Partial<AmlScreeningReadinessFacts> = {}): AmlScreeningReadinessFacts => ({
  provider: { providerKey: "local_lists", mode: "live", active: true },
  lists: [freshDfat],
  now: NOW,
  ...over,
});

describe("an unread configuration is never 'not configured'", () => {
  it("reports unavailable and blames nobody", () => {
    const r = deriveAmlScreeningReadiness(null);
    expect(r.code).toBe("unavailable");
    expect(r.canRun).toBe(false);
    expect(r.owner).toBe("none");
    expect(r.blockers).toEqual([]);
  });
});

describe("the state production is in right now", () => {
  const productionToday = facts({ provider: productionProvider, lists: [] });

  it("names BOTH blockers, not just the one the toast showed", () => {
    // The whole point. Fixing the mode and rediscovering the list problem is
    // what made this feel broken rather than unconfigured. `lists: []` is
    // exactly what production holds: the evidence was read, and there is
    // none.
    const r = deriveAmlScreeningReadiness(productionToday);
    expect(r.canRun).toBe(false);
    expect(r.blockers).toHaveLength(2);
    expect(r.blockers[0]).toMatch(/simulator mode/i);
    expect(r.blockers[1]).toMatch(/DFAT sanctions list has never been successfully loaded/i);
  });

  it("names both when the required list is known to be missing", () => {
    const r = deriveAmlScreeningReadiness(facts({
      provider: productionProvider,
      lists: [{ listCode: "dfat", lastSuccessAt: null, entryCount: 0, latestAttemptStatus: null }],
    }));
    expect(r.blockers).toHaveLength(2);
    expect(r.blockers[0]).toMatch(/simulator mode/i);
    expect(r.blockers[1]).toMatch(/DFAT sanctions list has never been successfully loaded/i);
    // The first thing to fix names the reading; the list carries the rest.
    expect(r.code).toBe("simulator_mode");
    expect(r.canRun).toBe(false);
  });

  it("points at an administrator, because a reviewer cannot fix either", () => {
    const r = deriveAmlScreeningReadiness(facts({
      provider: productionProvider,
      lists: [{ listCode: "dfat", lastSuccessAt: null, entryCount: 0, latestAttemptStatus: null }],
    }));
    expect(r.owner).toBe("administrator");
  });
});

describe("the list check does not depend on the provider being fixed first", () => {
  it("reports a missing list even while the provider is in simulator mode", () => {
    const r = deriveAmlScreeningReadiness(facts({
      provider: productionProvider,
      lists: [{ listCode: "dfat", lastSuccessAt: null, entryCount: 0, latestAttemptStatus: null }],
    }));
    expect(r.blockers.some((b) => /never been successfully loaded/.test(b))).toBe(true);
  });

  it("says nothing about lists that were not read", () => {
    // An unread list must not be reported as missing.
    const r = deriveAmlScreeningReadiness(facts({ provider: productionProvider, lists: null }));
    expect(r.blockers).toHaveLength(1);
    expect(r.blockers[0]).toMatch(/simulator mode/i);
  });
});

describe("list freshness", () => {
  it("treats a successful sync that published nothing as never loaded", () => {
    // A zero-entry publish is not screening data.
    const r = deriveAmlScreeningReadiness(facts({
      lists: [{ listCode: "dfat", lastSuccessAt: hoursAgo(1), entryCount: 0, latestAttemptStatus: "succeeded" }],
    }));
    expect(r.code).toBe("lists_never_loaded");
  });

  it("refuses a list older than the freshness window", () => {
    const r = deriveAmlScreeningReadiness(facts({
      lists: [{ ...freshDfat, lastSuccessAt: hoursAgo(SCREENING_MAX_AGE_HOURS_DEFAULT + 1) }],
    }));
    expect(r.code).toBe("lists_stale");
    expect(r.blockers[0]).toMatch(/older than the 72-hour limit/);
  });

  it("accepts a list inside the window", () => {
    const r = deriveAmlScreeningReadiness(facts({
      lists: [{ ...freshDfat, lastSuccessAt: hoursAgo(SCREENING_MAX_AGE_HOURS_DEFAULT - 1) }],
    }));
    expect(r.code).toBe("ready");
  });

  it("flags a failed latest attempt even behind a fresh success", () => {
    // Designations published since the failure may be missing.
    const r = deriveAmlScreeningReadiness(facts({
      lists: [{ ...freshDfat, latestAttemptStatus: "failed" }],
    }));
    expect(r.code).toBe("last_sync_failed");
    expect(r.canRun).toBe(false);
    expect(r.blockers[0]).toMatch(/most recent DFAT sync attempt failed/i);
  });
});

describe("provider states", () => {
  it("reports no provider at all", () => {
    const r = deriveAmlScreeningReadiness(facts({ provider: null }));
    expect(r.code).toBe("no_provider");
  });

  it("reports a configured but inactive provider", () => {
    const r = deriveAmlScreeningReadiness(facts({
      provider: { providerKey: "local_lists", mode: "live", active: false },
    }));
    expect(r.code).toBe("provider_inactive");
  });

  it("is ready only when the provider is live, active and the list is current", () => {
    const r = deriveAmlScreeningReadiness(facts());
    expect(r.code).toBe("ready");
    expect(r.canRun).toBe(true);
    expect(r.owner).toBe("none");
    expect(r.blockers).toEqual([]);
  });
});

describe("every reading is renderable", () => {
  it("always has a label and a sentence, and only 'ready' can run", () => {
    const cases: Array<AmlScreeningReadinessFacts | null> = [
      null,
      facts(),
      facts({ provider: null }),
      facts({ provider: productionProvider, lists: [] }),
      facts({ lists: [{ listCode: "dfat", lastSuccessAt: null, entryCount: 0, latestAttemptStatus: null }] }),
    ];
    for (const f of cases) {
      const r = deriveAmlScreeningReadiness(f);
      expect(r.label).toBeTruthy();
      expect(r.detail).toBeTruthy();
      expect(r.canRun).toBe(r.code === "ready");
    }
  });
});
