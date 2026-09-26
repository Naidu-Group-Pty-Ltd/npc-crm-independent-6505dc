import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Source-text contracts (the repo's established *.security.test.ts pattern):
// pin the load-bearing gating lines so a refactor cannot silently reopen a
// premium surface.

describe("comparison gating contracts", () => {
  const generatedReports = readFileSync("src/pages/GeneratedReports.tsx", "utf8");

  it("Generated Reports resolves the comparison capability", () => {
    expect(generatedReports).toContain("useCapability('report.comparisons')");
  });

  it("comparison fetch and basket are capability-gated", () => {
    expect(generatedReports).toContain("if (comparisonsEnabled) tasks.push(fetchComparisons())");
    expect(generatedReports).toContain("comparisonsEnabled && selectedReports.length > 0");
  });

  it("the ?tab=comparisons deep link redirects without the capability", () => {
    expect(generatedReports).toContain("tabParam === 'comparisons' && !comparisonsEnabled");
  });

  it("a capability still loading is not a denial: nothing is taken away until it is decided", () => {
    expect(generatedReports).toContain("const comparisonsDecided = comparisonsCapability.status !== 'loading'");
    expect(generatedReports).toContain("tabParam === 'comparisons' && !comparisonsEnabled && comparisonsDecided");
    expect(generatedReports).toContain("comparisonsDecided && !comparisonsEnabled && activeTab === 'comparisons'");
  });

  const cashFlowModal = readFileSync("src/components/reports/CashFlowAnalysisModal.tsx", "utf8");

  it("Cash-flow comparison mode cannot activate without the capability", () => {
    expect(cashFlowModal).toContain("useCapability('cashflow.comparisons')");
    expect(cashFlowModal).toContain("cashflowComparisonsEnabled ? value : false");
  });

  const controlPanel = readFileSync("src/components/cash-flow/modal/CashFlowControlPanel.tsx", "utf8");

  it("the comparison toggle is removed when unavailable", () => {
    expect(controlPanel).toContain("comparisonsAvailable && (");
  });
});

describe("Commercial & Industrial report gating contracts", () => {
  const generatedReports = readFileSync("src/pages/GeneratedReports.tsx", "utf8");

  it("Generated Reports resolves the module capability for its C&I tab", () => {
    expect(generatedReports).toContain("useCapability('module.commercial_industrial')");
  });

  it("the C&I read and tab are capability-gated", () => {
    expect(generatedReports).toContain("useCommercialDocumentsLibrary(commercialEnabled)");
    expect(generatedReports).toContain("{commercialEnabled && (");
  });

  it("the ?tab=commercial deep link redirects without the capability", () => {
    expect(generatedReports).toContain("tabParam === 'commercial' && !commercialEnabled");
  });

  it("a capability still loading is not a denial: the C&I tab is not taken away until it is decided", () => {
    expect(generatedReports).toContain("const commercialDecided = commercialCapability.status !== 'loading'");
    expect(generatedReports).toContain("tabParam === 'commercial' && !commercialEnabled && commercialDecided");
    expect(generatedReports).toContain("commercialDecided && !commercialEnabled && activeTab === 'commercial'");
  });

  const inventory = readFileSync("src/hooks/useClientReportInventory.ts", "utf8");

  it("the client Reports tab reads C&I documents only with the module", () => {
    expect(inventory).toContain("useCapability('client.commercial_industrial')");
    expect(inventory).toContain("enabled: canFetchReports && commercialIndustrial");
  });
});

describe("Overview gating contracts", () => {
  const overview = readFileSync("src/pages/Overview.tsx", "utf8");

  it("does not fetch listings without the Property Marketplace capability", () => {
    expect(overview).toContain("if (!marketplaceEnabled) {");
    expect(overview).toContain("resolveOverviewCapability('module.property_marketplace')");
  });

  it("mounts the commercial widgets only when entitled", () => {
    expect(overview).toContain("{commercialEnabled && (");
  });

  it("mounts the market news widget only when entitled", () => {
    expect(overview).toContain("{marketNewsEnabled && (");
  });
});

describe("backend enforcement contracts", () => {
  it.each([
    ["manage-commercial-data", "commercial-industrial"],
    ["manage-industrial-data", "commercial-industrial"],
    ["manage-ci-assessments", "commercial-industrial"],
    ["compare-investment-reports", "report-comparisons"],
    ["compare-cash-flow-reports", "cashflow-comparisons"],
    ["market-updates-status", "market-updates"],
    ["market-updates-archive", "market-updates"],
    ["calculate-borrowing-capacity", "borrowing-capacity"],
    ["manage-agency-agreements", "agreements"],
    ["generate-portfolio-analysis", "portfolio-analysis"],
    ["airtable-proxy", "opportunity-marketplace"],
  ])("%s asserts the %s workspace capability", (fn, capability) => {
    const source = readFileSync(`supabase/functions/${fn}/index.ts`, "utf8");
    expect(source).toContain("requireWorkspaceCapability");
    expect(source).toContain(`'${capability}'`);
  });
});
