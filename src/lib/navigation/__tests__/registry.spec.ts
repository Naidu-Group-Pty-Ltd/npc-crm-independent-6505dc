import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ADMIN_NAVIGATION_ITEMS,
  NAVIGATION_GROUP_ORDER,
  NAVIGATION_ITEMS,
  navItemIsActive,
} from "../registry";
import { resolveCapability, toCapabilityKey } from "@/lib/entitlements";
import type { SnapshotState, WorkspaceEntitlementSnapshot } from "@/lib/entitlements";

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

/** Mirror of useNavigationVisibility's workspace-level rule (permission axis
 * granted, as for a fully-permissioned user). */
function visibleTitles(snapshot: WorkspaceEntitlementSnapshot, state: SnapshotState = "ready") {
  return NAVIGATION_ITEMS.filter((item) => {
    if (item.moduleKey === "__always__") return true;
    const key = toCapabilityKey(item.moduleKey);
    if (!key) return true; // user-permission only — treat as granted here
    const d = resolveCapability(key, { snapshot, snapshotState: state, hasPermission: true });
    return d.enabled || d.status === "loading";
  }).map((item) => item.title);
}

describe("navigation registry — one source, capability-filtered", () => {
  it("hides Market News Feed and Commercial / Industrial from Launch and Growth", () => {
    for (const plan of ["launch", "growth"]) {
      const titles = visibleTitles(snap(plan));
      expect(titles).not.toContain("Market News Feed");
      expect(titles).not.toContain("Commercial / Industrial");
      expect(titles).not.toContain("Property Marketplace");
    }
  });

  it("shows both to Scale, and to qualifying add-on purchasers", () => {
    expect(visibleTitles(snap("scale"))).toEqual(
      expect.arrayContaining(["Market News Feed", "Commercial / Industrial", "Property Marketplace"]),
    );
    expect(visibleTitles(snap("launch", ["market-updates"]))).toContain("Market News Feed");
    expect(visibleTitles(snap("launch", ["market-updates"]))).not.toContain("Commercial / Industrial");
    expect(visibleTitles(snap("growth", ["commercial-industrial"]))).toContain("Commercial / Industrial");
  });

  it("keeps the universal core visible on every tier", () => {
    for (const plan of ["launch", "growth", "scale"]) {
      const titles = visibleTitles(snap(plan));
      for (const core of ["Overview", "Calendar", "Clients", "Reports", "Generated Reports", "Cash Flow Analysis", "Reminders", "Billing & Usage", "User Guide"]) {
        expect(titles, `${core} on ${plan}`).toContain(core);
      }
    }
  });

  it("gates Deal Pipeline at Growth and the Scale operations modules at Scale", () => {
    expect(visibleTitles(snap("launch"))).not.toContain("Deal Pipeline");
    expect(visibleTitles(snap("growth"))).toContain("Deal Pipeline");
    expect(visibleTitles(snap("growth"))).not.toContain("Marketing");
    expect(visibleTitles(snap("scale"))).toContain("Marketing");
    expect(visibleTitles(snap("growth"))).not.toContain("Agreements");
  });

  it("has no `__always__` escape on any commercially priced module", () => {
    for (const item of [...NAVIGATION_ITEMS, ...ADMIN_NAVIGATION_ITEMS]) {
      if (item.moduleKey !== "__always__") continue;
      // Only genuinely universal surfaces may be always-visible.
      expect(["Portal Messages", "Billing & Usage", "Feedback", "Support"]).toContain(item.title);
    }
  });

  it("declares every item inside an ordered group", () => {
    for (const item of NAVIGATION_ITEMS) {
      expect(NAVIGATION_GROUP_ORDER, item.title).toContain(item.group);
    }
  });

  it("keeps Commercial / Industrial active across nested and /industrial routes", () => {
    const ci = NAVIGATION_ITEMS.find((i) => i.title === "Commercial / Industrial")!;
    for (const path of ["/commercial", "/commercial/calculators", "/industrial", "/industrial/123"]) {
      expect(navItemIsActive(ci, path), path).toBe(true);
    }
    expect(navItemIsActive(ci, "/clients")).toBe(false);
  });
});

describe("navigation consumers use the shared registry", () => {
  it.each([
    "src/components/layout/DashboardSidebar.tsx",
    "src/components/layout/MobileSidebar.tsx",
    "src/components/layout/GlobalCommandPalette.tsx",
    "src/components/layout/MobileNav.tsx",
  ])("%s renders from the registry, not a private list", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).toMatch(/useNavigationVisibility|@\/lib\/navigation\/registry/);
    // The old drift pattern: a locally defined, hand-synchronised nav array.
    expect(source).not.toContain("const navigationItems = [");
    expect(source).not.toContain("const ENTRIES: NavEntry[]");
  });
});

describe("premium routes are guarded in App.tsx", () => {
  const appSource = readFileSync("src/App.tsx", "utf8");

  it("wraps Market News Feed routes in ModuleGuard", () => {
    expect(appSource).toContain('path="market-updates" element={<ModuleGuard moduleKey="market_updates">');
    expect(appSource).toContain('path="market-updates/archived" element={<ModuleGuard moduleKey="market_updates">');
  });

  it("wraps every Commercial & Industrial route in ModuleGuard", () => {
    for (const path of [
      "commercial",
      "commercial/calculators",
      "commercial/assessments/:id",
      "commercial/:id",
      "industrial",
      "industrial/calculators",
      "calculators",
      "industrial/:id",
    ]) {
      expect(appSource).toContain(`path="${path}" element={<ModuleGuard moduleKey="commercial">`);
    }
  });

  it("keeps the marketplace and model-hub routes guarded", () => {
    expect(appSource).toContain('path="listings" element={<ModuleGuard moduleKey="listings">');
    expect(appSource).toContain('path="model-hub" element={<ModuleGuard moduleKey="model_hub"');
  });
});
