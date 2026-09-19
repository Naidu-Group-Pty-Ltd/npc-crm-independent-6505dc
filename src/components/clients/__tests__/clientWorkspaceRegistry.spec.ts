import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CLIENT_TABS, CLIENT_ACTION_CAPABILITIES, resolveClientTab } from "../clientWorkspaceRegistry";
import { resolveCapability } from "@/lib/entitlements";
import type { WorkspaceEntitlementSnapshot } from "@/lib/entitlements";

function snap(planSlug: string, addonSlugs: string[] = []): WorkspaceEntitlementSnapshot {
  return {
    workspaceId: "ws",
    planSlug,
    subscriptionStatus: "active",
    addonSlugs,
    trialSlugs: [],
    overrideSlugs: [],
    billingExempt: false,
    fetchedAt: new Date().toISOString(),
    source: "mission_control",
  };
}

function visibleTabValues(snapshot: WorkspaceEntitlementSnapshot): string[] {
  return CLIENT_TABS.filter(
    (tab) => resolveCapability(tab.capability, { snapshot, snapshotState: "ready" }).enabled,
  ).map((tab) => tab.value);
}

describe("client workspace tabs by tier", () => {
  it("gives Launch the complete core client workspace", () => {
    const tabs = visibleTabValues(snap("launch"));
    for (const core of [
      "overview", "personal", "properties", "employment", "financials",
      "reports", "sent-reports", "report-requests", "portal-messages",
      "notes", "reminders", "formara-forms", "files", "activity",
    ]) {
      expect(tabs, core).toContain(core);
    }
  });

  it("withholds the premium tabs from Launch", () => {
    const tabs = visibleTabValues(snap("launch"));
    for (const premium of ["deals", "conversations", "appointments", "finance-messages", "borrowing", "insights", "emails", "lenders"]) {
      expect(tabs, premium).not.toContain(premium);
    }
  });

  it("adds Deals at Growth and the finance/AI set at Scale", () => {
    expect(visibleTabValues(snap("growth"))).toContain("deals");
    expect(visibleTabValues(snap("growth"))).not.toContain("borrowing");
    const scale = visibleTabValues(snap("scale"));
    for (const tab of ["deals", "conversations", "appointments", "finance-messages", "borrowing", "insights"]) {
      expect(scale, tab).toContain(tab);
    }
  });

  it("keeps Emails and Lenders off even on Scale (add-on / coming soon)", () => {
    const scale = visibleTabValues(snap("scale"));
    expect(scale).not.toContain("emails");
    expect(scale).not.toContain("lenders");
    expect(visibleTabValues(snap("scale", ["email-copilot"]))).toContain("emails");
  });

  it("tab order and swipe order are the same list by construction", () => {
    const values = CLIENT_TABS.map((tab) => tab.value);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("initialTab / deep-link validation", () => {
  const launchTabs = visibleTabValues(snap("launch"));

  it("honours a valid requested tab", () => {
    expect(resolveClientTab("notes", launchTabs)).toBe("notes");
  });

  it("redirects an unentitled deep link to the first visible tab", () => {
    expect(resolveClientTab("borrowing", launchTabs)).toBe("overview");
    expect(resolveClientTab("insights", launchTabs)).toBe("overview");
  });

  it("rejects unknown tab values", () => {
    expect(resolveClientTab("not-a-tab", launchTabs)).toBe("overview");
    expect(resolveClientTab(null, launchTabs)).toBe("overview");
  });
});

describe("client actions by tier", () => {
  const decide = (capability: string, snapshot: WorkspaceEntitlementSnapshot) =>
    resolveCapability(capability as never, { snapshot, snapshotState: "ready" }).enabled;

  it("Launch keeps the universal actions and loses the Scale ones", () => {
    const s = snap("launch");
    expect(decide(CLIENT_ACTION_CAPABILITIES.downloadPdf, s)).toBe(true);
    expect(decide(CLIENT_ACTION_CAPABILITIES.review, s)).toBe(true);
    expect(decide(CLIENT_ACTION_CAPABILITIES.portalAccess, s)).toBe(true);
    expect(decide(CLIENT_ACTION_CAPABILITIES.viewAsClient, s)).toBe(true);
    expect(decide(CLIENT_ACTION_CAPABILITIES.sendToFinance, s)).toBe(false);
    expect(decide(CLIENT_ACTION_CAPABILITIES.portfolioAnalysis, s)).toBe(false);
    expect(decide(CLIENT_ACTION_CAPABILITIES.sendPortfolio, s)).toBe(false);
    expect(decide(CLIENT_ACTION_CAPABILITIES.sendAgreement, s)).toBe(false);
  });

  it("Scale receives the full action set", () => {
    const s = snap("scale");
    for (const capability of Object.values(CLIENT_ACTION_CAPABILITIES)) {
      expect(decide(capability, s), capability).toBe(true);
    }
  });
});

describe("modal source contracts", () => {
  const modalSource = readFileSync("src/components/clients/ClientDetailsModal.tsx", "utf8");

  it("renders tabs from the registry, not a hardcoded trigger list", () => {
    expect(modalSource).toContain("visibleTabs.map((tab)");
    expect(modalSource).not.toContain("const tabOrder = ['overview'");
  });

  it("skips the deals fetch when the capability is off", () => {
    expect(modalSource).toContain("deals: can('client.deals')");
  });

  it("validates initialTab against the visible set", () => {
    expect(modalSource).toContain("resolveClientTab(initialTab, tabOrder)");
  });
});
