import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CAPABILITY_DEFINITIONS, getCapabilityDefinition } from "../registry";

// The server-side gate (supabase/functions/_shared/entitlements.ts) carries
// its own copy of the tier matrix — it runs under Deno and cannot share this
// module. This source-text contract pins the two together: if either side's
// commercial rules move, this test forces the other to move with it.

const serverSource = readFileSync("supabase/functions/_shared/entitlements.ts", "utf8");

describe("server entitlement matrix agrees with the client registry", () => {
  it("pins the anchor commercial rules in the server matrix", () => {
    expect(serverSource).toContain('"market-updates": ["scale"]');
    expect(serverSource).toContain('"commercial-industrial": ["scale"]');
    expect(serverSource).toContain('"opportunity-marketplace": ["scale"]');
    expect(serverSource).toContain('"report-comparisons": ["growth", "scale"]');
    expect(serverSource).toContain('"cashflow-comparisons": ["growth", "scale"]');
    expect(serverSource).toContain('"deal-pipeline": ["growth", "scale"]');
    expect(serverSource).toContain('"aml-ctf": []');
  });

  it("never lets a superadmin check into the server gate", () => {
    // The client resolver DOES grant superadmins an operator override, so
    // this boundary is now a deliberate asymmetry rather than a shared rule.
    // Single-tenant clone architecture: every customer's own principal holds
    // `superadmin` in their clone, and honouring the override at the
    // enforcement layer would hand each clone the whole catalogue for free.
    // Only the audited billing-exempt override or a verified internal call
    // passes here. See docs/entitlements/ARCHITECTURE.md.
    expect(serverSource).not.toContain("actorIsSuperadmin");
    expect(serverSource).not.toContain("requireSuperadmin");
  });

  it("client registry expresses the same anchors", () => {
    expect(getCapabilityDefinition("module.market_news_feed")?.includedInPlans).toEqual(["scale"]);
    expect(getCapabilityDefinition("module.market_news_feed")?.addonSlugs).toEqual(["market-updates"]);
    expect(getCapabilityDefinition("module.commercial_industrial")?.includedInPlans).toEqual(["scale"]);
    expect(getCapabilityDefinition("module.aml_ctf")?.includedInPlans).toEqual([]);
    expect(getCapabilityDefinition("report.comparisons")?.includedInPlans).toEqual(["growth", "scale"]);
    expect(getCapabilityDefinition("cashflow.comparisons")?.includedInPlans).toEqual(["growth", "scale"]);
  });

  it("every capability with an add-on slug uses canonical catalogue slugs", () => {
    const canonical = new Set([
      "market-updates", "commercial-industrial", "opportunity-marketplace",
      "intelligence-hub", "report-comparisons", "cashflow-comparisons",
      "email-copilot", "call-logs", "portfolio-analysis", "send-portfolio",
      "client-forms", "borrowing-capacity", "lenders", "client-ai",
      "agreements", "marketing", "deal-pipeline", "aml-ctf", "model-hub",
      "finance-portal", "integrations", "api-usage", "aurixa-agent",
    ]);
    for (const def of CAPABILITY_DEFINITIONS) {
      for (const slug of def.addonSlugs ?? []) {
        expect(canonical.has(slug), `${def.key} uses non-catalogue slug ${slug}`).toBe(true);
      }
    }
  });
});
