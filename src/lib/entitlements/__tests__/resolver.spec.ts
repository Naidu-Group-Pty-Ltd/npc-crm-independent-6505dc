import { describe, expect, it } from "vitest";
import { resolveCapability } from "../resolver";
import { snapshotFromBalance } from "../snapshot";
import { canonicalisePlanSlug, canonicaliseAddonSlugs, toCapabilityKey } from "../aliases";
import { CAPABILITY_DEFINITIONS, getCapabilityDefinition } from "../registry";
import type { SnapshotState, WorkspaceEntitlementSnapshot } from "../types";

function snap(over: Partial<WorkspaceEntitlementSnapshot> = {}): WorkspaceEntitlementSnapshot {
  return {
    workspaceId: "test-ws",
    planSlug: "launch",
    subscriptionStatus: "active",
    addonSlugs: [],
    trialSlugs: [],
    overrideSlugs: [],
    billingExempt: false,
    fetchedAt: new Date().toISOString(),
    source: "mission_control",
    ...over,
  };
}

function decide(
  key: Parameters<typeof resolveCapability>[0],
  snapshot: WorkspaceEntitlementSnapshot | null,
  snapshotState: SnapshotState = "ready",
) {
  return resolveCapability(key, { snapshot, snapshotState });
}

describe("Market News Feed: Scale OR active add-on", () => {
  it("denies Launch and Growth without the add-on", () => {
    for (const planSlug of ["launch", "growth"] as const) {
      const d = decide("module.market_news_feed", snap({ planSlug }));
      expect(d.enabled).toBe(false);
      expect(d.status).toBe("plan_excluded");
      expect(d.requiredPlan).toBe("scale");
      expect(d.availableAddons).toContain("market-updates");
    }
  });

  it("enables Launch + add-on and Growth + add-on", () => {
    for (const planSlug of ["launch", "growth"] as const) {
      const d = decide(
        "module.market_news_feed",
        snap({ planSlug, addonSlugs: ["market-updates"] }),
      );
      expect(d.enabled).toBe(true);
      expect(d.effectiveSource).toBe("addon");
    }
  });

  it("enables Scale through the base tier", () => {
    const d = decide("module.market_news_feed", snap({ planSlug: "scale" }));
    expect(d.enabled).toBe(true);
    expect(d.effectiveSource).toBe("base_tier");
  });

  it("keeps Scale enabled through the tier when a duplicate add-on exists", () => {
    const d = decide(
      "module.market_news_feed",
      snap({ planSlug: "scale", addonSlugs: ["market-updates"] }),
    );
    expect(d.enabled).toBe(true);
    expect(d.entitlementSources).toEqual(["base_tier", "addon"]);
    expect(d.effectiveSource).toBe("base_tier");
  });

  it("survives cancellation of the duplicate add-on on Scale", () => {
    const d = decide("module.market_news_feed", snap({ planSlug: "scale", addonSlugs: [] }));
    expect(d.enabled).toBe(true);
  });
});

describe("Commercial & Industrial: Scale OR active add-on", () => {
  it("matches the required access table", () => {
    const cases: Array<[string, string[], boolean]> = [
      ["launch", [], false],
      ["launch", ["commercial-industrial"], true],
      ["growth", [], false],
      ["growth", ["commercial-industrial"], true],
      ["scale", [], true],
      ["scale", ["commercial-industrial"], true],
    ];
    for (const [planSlug, addonSlugs, expected] of cases) {
      expect(
        decide("module.commercial_industrial", snap({ planSlug, addonSlugs })).enabled,
      ).toBe(expected);
    }
  });

  it("an add-on unlocks only its own module, not unrelated Scale capabilities", () => {
    const s = snap({ planSlug: "launch", addonSlugs: ["commercial-industrial"] });
    expect(decide("module.commercial_industrial", s).enabled).toBe(true);
    expect(decide("module.market_news_feed", s).enabled).toBe(false);
    expect(decide("module.finance_portal", s).enabled).toBe(false);
    expect(decide("module.property_marketplace", s).enabled).toBe(false);
    expect(decide("client.send_to_finance", s).enabled).toBe(false);
    // And it does not masquerade as a tier upgrade.
    expect(decide("client.deals", s).enabled).toBe(false);
    expect(decide("report.comparisons", s).enabled).toBe(false);
  });

  it("both add-ons on Launch or Growth unlock exactly both modules", () => {
    for (const planSlug of ["launch", "growth"] as const) {
      const s = snap({
        planSlug,
        addonSlugs: ["commercial-industrial", "market-updates"],
      });
      expect(decide("module.commercial_industrial", s).enabled).toBe(true);
      expect(decide("module.market_news_feed", s).enabled).toBe(true);
      expect(decide("module.agreements", s).enabled).toBe(false);
    }
  });
});

describe("comparisons and deals: Growth+, or add-on", () => {
  it("holds comparisons back from Launch, opens at Growth and Scale", () => {
    expect(decide("report.comparisons", snap({ planSlug: "launch" })).enabled).toBe(false);
    expect(decide("report.comparisons", snap({ planSlug: "growth" })).enabled).toBe(true);
    expect(decide("report.comparisons", snap({ planSlug: "scale" })).enabled).toBe(true);
    expect(decide("cashflow.comparisons", snap({ planSlug: "launch" })).enabled).toBe(false);
    expect(decide("cashflow.comparisons", snap({ planSlug: "growth" })).enabled).toBe(true);
  });

  it("the comparison add-ons unlock Launch", () => {
    expect(
      decide("report.comparisons", snap({ planSlug: "launch", addonSlugs: ["report-comparisons"] }))
        .enabled,
    ).toBe(true);
    expect(
      decide(
        "cashflow.comparisons",
        snap({ planSlug: "launch", addonSlugs: ["cashflow-comparisons"] }),
      ).enabled,
    ).toBe(true);
  });

  it("client deals and deal pipeline follow Growth+", () => {
    expect(decide("client.deals", snap({ planSlug: "launch" })).enabled).toBe(false);
    expect(decide("client.deals", snap({ planSlug: "growth" })).enabled).toBe(true);
    expect(decide("module.deal_pipeline", snap({ planSlug: "launch" })).enabled).toBe(false);
    expect(decide("module.deal_pipeline", snap({ planSlug: "growth" })).enabled).toBe(true);
  });

  it("standard reports and cash flow stay complete on Launch", () => {
    expect(decide("report.investment", snap({ planSlug: "launch" })).enabled).toBe(true);
    expect(decide("cashflow.standard", snap({ planSlug: "launch" })).enabled).toBe(true);
  });
});

describe("AML/CTF follows the SKU, not the tier list", () => {
  it("module.aml_ctf is in no tier's included list", () => {
    expect(getCapabilityDefinition("module.aml_ctf")?.includedInPlans).toEqual([]);
  });

  it("a with-AML SKU decomposes into base tier + aml-ctf add-on", () => {
    const plan = canonicalisePlanSlug("launch-with-aml");
    expect(plan.planSlug).toBe("launch");
    expect(plan.impliedAddons).toEqual(["aml-ctf"]);
    const s = snap({ planSlug: plan.planSlug, addonSlugs: plan.impliedAddons });
    expect(decide("module.aml_ctf", s).enabled).toBe(true);
    expect(decide("module.aml_ctf", s).effectiveSource).toBe("addon");
  });

  it("a without-AML SKU does not entitle AML", () => {
    const plan = canonicalisePlanSlug("growth-without-aml");
    expect(plan.planSlug).toBe("growth");
    expect(plan.amlExcluded).toBe(true);
    const s = snap({ planSlug: plan.planSlug, addonSlugs: [] });
    expect(decide("module.aml_ctf", s).enabled).toBe(false);
  });

  it("the snapshot normaliser assumes AML only for headline SKUs and records it", () => {
    const withAml = snapshotFromBalance(
      { available: 1, allowance: 1, used: 0, reserved: 0, planSlug: "launch" } as never,
      "ws",
    );
    expect(withAml.addonSlugs).toContain("aml-ctf");
    expect(withAml.amlAssumed).toBe(true);

    const withoutAml = snapshotFromBalance(
      { available: 1, allowance: 1, used: 0, reserved: 0, planSlug: "launch-without-aml" } as never,
      "ws",
    );
    expect(withoutAml.addonSlugs).not.toContain("aml-ctf");
    expect(withoutAml.amlAssumed).toBe(false);

    const explicit = snapshotFromBalance(
      {
        available: 1,
        allowance: 1,
        used: 0,
        reserved: 0,
        planSlug: "scale",
        addonSlugs: ["aml-ctf"],
      } as never,
      "ws",
    );
    expect(explicit.addonSlugs).toContain("aml-ctf");
    expect(explicit.amlAssumed).toBe(false);
  });
});

describe("trials and overrides", () => {
  it("a trial slug entitles like an add-on, recorded as trial", () => {
    const d = decide(
      "module.market_news_feed",
      snap({ planSlug: "launch", trialSlugs: ["market-updates"] }),
    );
    expect(d.enabled).toBe(true);
    expect(d.effectiveSource).toBe("trial");
  });

  it("a workspace override entitles and is recorded as workspace_override", () => {
    const d = decide(
      "module.commercial_industrial",
      snap({ planSlug: "launch", overrideSlugs: ["commercial-industrial"] }),
    );
    expect(d.enabled).toBe(true);
    expect(d.effectiveSource).toBe("workspace_override");
  });

  it("billing-exempt workspaces resolve everything via workspace_override", () => {
    const s = snap({ planSlug: "", billingExempt: true });
    for (const key of ["module.market_news_feed", "module.commercial_industrial"] as const) {
      const d = decide(key, s);
      expect(d.enabled).toBe(true);
      expect(d.effectiveSource).toBe("workspace_override");
    }
  });
});

describe("failure posture: loading, outage, never-fetched", () => {
  it("reports loading while the first fetch is in flight", () => {
    const d = decide("module.market_news_feed", null, "loading");
    expect(d.enabled).toBe(false);
    expect(d.status).toBe("loading");
  });

  it("a stale last-known-good snapshot keeps purchased features alive", () => {
    const d = decide(
      "module.commercial_industrial",
      snap({ planSlug: "scale", source: "cache" }),
      "stale",
    );
    expect(d.enabled).toBe(true);
  });

  it("with no snapshot ever obtained, premium is withheld but core survives", () => {
    expect(decide("module.market_news_feed", null, "unavailable").status).toBe("unknown");
    expect(decide("module.market_news_feed", null, "unavailable").enabled).toBe(false);
    expect(decide("module.commercial_industrial", null, "unavailable").enabled).toBe(false);
    // Core platform stays usable.
    expect(decide("module.clients", null, "unavailable").enabled).toBe(true);
    expect(decide("module.reports", null, "unavailable").enabled).toBe(true);
    expect(decide("cashflow.standard", null, "unavailable").enabled).toBe(true);
  });

  it("an unknown Mission Control plan slug withholds premium but honours add-ons", () => {
    const s = snap({ planSlug: "enterprise-legacy", addonSlugs: ["market-updates"] });
    expect(decide("module.market_news_feed", s).enabled).toBe(true); // via add-on
    expect(decide("module.commercial_industrial", s).enabled).toBe(false);
  });
});

describe("permission axis", () => {
  it("permission denial is reported distinctly from plan exclusion", () => {
    const s = snap({ planSlug: "scale" });
    const d = resolveCapability("module.market_news_feed", {
      snapshot: s,
      snapshotState: "ready",
      hasPermission: false,
    });
    expect(d.enabled).toBe(false);
    expect(d.status).toBe("permission_denied");
    expect(d.entitlementSources).toContain("base_tier");
  });

  it("plan exclusion wins over permission state", () => {
    const d = resolveCapability("module.market_news_feed", {
      snapshot: snap({ planSlug: "launch" }),
      snapshotState: "ready",
      hasPermission: true,
    });
    expect(d.status).toBe("plan_excluded");
  });
});

describe("product availability and dependencies", () => {
  it("coming_soon capabilities never enable and never upsell", () => {
    const d = decide("client.lenders", snap({ planSlug: "scale" }));
    expect(d.enabled).toBe(false);
    expect(d.status).toBe("product_unavailable");
    expect(d.requiredPlan).toBeUndefined();
  });

  it("client capabilities depend on the clients module", () => {
    expect(getCapabilityDefinition("client.deals")?.parentCapability).toBe("module.clients");
  });
});

describe("registry hygiene", () => {
  it("keeps tier inclusion monotonic — no capability is lost by upgrading", () => {
    for (const def of CAPABILITY_DEFINITIONS) {
      if (def.includedInPlans.includes("launch")) {
        expect(def.includedInPlans).toContain("growth");
      }
      if (def.includedInPlans.includes("growth")) {
        expect(def.includedInPlans).toContain("scale");
      }
    }
  });

  it("maps every legacy sub-module key onto a registered capability", () => {
    for (const legacy of [
      "generated-reports.comparisons",
      "cash-flow-analysis.comparisons",
      "clients.deals",
      "clients.borrowing-capacity",
      "clients.ai",
      "market_updates",
      "commercial",
      "listings",
    ]) {
      const key = toCapabilityKey(legacy);
      expect(key, legacy).not.toBeNull();
      expect(getCapabilityDefinition(key!), legacy).toBeDefined();
    }
  });

  it("canonicalises every known add-on spelling", () => {
    expect(canonicaliseAddonSlugs(["market-news-feed", "market-updates"])).toEqual([
      "market-updates",
    ]);
    expect(canonicaliseAddonSlugs(["deals"])).toEqual(["deal-pipeline"]);
    expect(canonicaliseAddonSlugs(["listings"])).toEqual(["opportunity-marketplace"]);
    expect(canonicaliseAddonSlugs(["AML"])).toEqual(["aml-ctf"]);
  });
});

describe("platform operator override", () => {
  function asOperator(
    key: Parameters<typeof resolveCapability>[0],
    snapshot: WorkspaceEntitlementSnapshot | null,
    snapshotState: SnapshotState = "ready",
  ) {
    return resolveCapability(key, { snapshot, snapshotState, isPlatformOperator: true });
  }

  // The regression this override exists for: Email Copilot and Call Logs are
  // add-on-only, so NO tier reaches them and every superadmin on every plan
  // was shown "not included in your subscription" on two ordinary CRM pages.
  it("opens add-on-only modules that no tier can reach", () => {
    for (const key of ["module.email_copilot", "module.call_logs"] as const) {
      for (const planSlug of ["launch", "growth", "scale"] as const) {
        expect(decide(key, snap({ planSlug })).status, `${key}/${planSlug}`).toBe("plan_excluded");

        const d = asOperator(key, snap({ planSlug }));
        expect(d.enabled, `${key}/${planSlug}`).toBe(true);
        expect(d.effectiveSource).toBe("operator_override");
        expect(d.operatorOnly).toBe(true);
      }
    }
  });

  it("covers every other capability an operator could not otherwise open", () => {
    const s = snap({ planSlug: "launch" });
    for (const def of CAPABILITY_DEFINITIONS) {
      if (def.productStatus === "coming_soon" || def.productStatus === "unavailable") continue;
      expect(asOperator(def.key, s).enabled, def.key).toBe(true);
    }
  });

  it("still reports what the workspace would need to buy", () => {
    const d = asOperator("module.market_news_feed", snap({ planSlug: "launch" }));
    expect(d.requiredPlan).toBe("scale");
    expect(d.availableAddons).toContain("market-updates");
  });

  it("does not claim an operator grant when the workspace holds the capability", () => {
    const d = asOperator("module.market_news_feed", snap({ planSlug: "scale" }));
    expect(d.enabled).toBe(true);
    expect(d.effectiveSource).toBe("base_tier");
    expect(d.operatorOnly).toBeFalsy();
  });

  it("overrides the user-permission axis as well", () => {
    const d = resolveCapability("module.market_news_feed", {
      snapshot: snap({ planSlug: "scale" }),
      snapshotState: "ready",
      hasPermission: false,
      isPlatformOperator: true,
    });
    expect(d.enabled).toBe(true);
    expect(d.status).toBe("enabled");
  });

  it("does not wait on a snapshot, and survives one never arriving", () => {
    expect(asOperator("module.call_logs", null, "loading").enabled).toBe(true);
    expect(asOperator("module.call_logs", null, "unavailable").enabled).toBe(true);
  });

  // Purchase state is negotiable; whether the thing runs is not.
  it("cannot open a capability that is not built yet", () => {
    const d = asOperator("client.lenders", snap({ planSlug: "scale" }));
    expect(d.enabled).toBe(false);
    expect(d.status).toBe("product_unavailable");
  });
});
