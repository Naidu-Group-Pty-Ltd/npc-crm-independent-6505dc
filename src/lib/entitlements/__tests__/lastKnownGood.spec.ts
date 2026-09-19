import { beforeEach, describe, expect, it } from "vitest";
import {
  clearLastKnownGood,
  loadLastKnownGood,
  saveLastKnownGood,
  LKG_MAX_AGE_MS,
} from "../snapshot";
import type { WorkspaceEntitlementSnapshot } from "../types";

function snap(over: Partial<WorkspaceEntitlementSnapshot> = {}): WorkspaceEntitlementSnapshot {
  return {
    workspaceId: "lkg-ws",
    planSlug: "growth",
    subscriptionStatus: "active",
    addonSlugs: ["commercial-industrial"],
    trialSlugs: [],
    overrideSlugs: [],
    billingExempt: false,
    fetchedAt: new Date().toISOString(),
    source: "mission_control",
    ...over,
  };
}

describe("last-known-good snapshot cache", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("round-trips a snapshot, re-marked as cache-sourced", () => {
    saveLastKnownGood(snap());
    const loaded = loadLastKnownGood("lkg-ws");
    expect(loaded).not.toBeNull();
    expect(loaded!.planSlug).toBe("growth");
    expect(loaded!.addonSlugs).toEqual(["commercial-industrial"]);
    // A revived snapshot is always labelled as cache so diagnostics and
    // logging can tell it apart from a live answer.
    expect(loaded!.source).toBe("cache");
  });

  it("is scoped by workspace", () => {
    saveLastKnownGood(snap());
    expect(loadLastKnownGood("some-other-ws")).toBeNull();
  });

  it("discards a snapshot older than the maximum age", () => {
    saveLastKnownGood(
      snap({ fetchedAt: new Date(Date.now() - LKG_MAX_AGE_MS - 1000).toISOString() }),
    );
    expect(loadLastKnownGood("lkg-ws")).toBeNull();
  });

  it("survives corrupted storage without throwing", () => {
    window.localStorage.setItem("aurixa.entitlements.lkg.v1:lkg-ws", "{not json");
    expect(loadLastKnownGood("lkg-ws")).toBeNull();
  });

  it("clears on demand", () => {
    saveLastKnownGood(snap());
    clearLastKnownGood("lkg-ws");
    expect(loadLastKnownGood("lkg-ws")).toBeNull();
  });
});
