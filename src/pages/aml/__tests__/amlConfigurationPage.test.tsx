/**
 * Configuration renders through its load — the crash this pins.
 *
 * ## What happened
 *
 * The page returns early twice: a skeleton while it is loading, and an error
 * state when the summary cannot be read. Support for opening a chosen tab
 * (`?tab=providers`, so Stage 5 can send an administrator to the sanctions
 * register's health) was appended at the point it was USED — after both of
 * those returns — rather than at the top of the component.
 *
 * So the first render called N hooks and the second called N+2. React throws
 * on the mismatch, the error boundary catches it, and the operator is shown
 * "Something went wrong" with no clue why. Configuration crashed on every
 * visit the moment its data arrived.
 *
 * Nothing about the feature was wrong. The placement was. The existing test
 * file for this page only exercised one exported sub-component, so nothing
 * ever rendered the page itself — which is why this reached production.
 *
 * These render it end to end: skeleton, then loaded, then the error branch.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const summary = vi.fn();

vi.mock("@/lib/aml/amlTenantApi", () => ({
  amlTenantApi: { summary: () => summary() },
  AML_PROVIDER_CAPABILITIES: [
    { key: "idv", label: "Identity Verification", suggested: ["didit"] },
    { key: "pep_sanctions", label: "PEP & Sanctions", suggested: ["dowjones"] },
  ],
}));
vi.mock("@/hooks/useAmlAccess", () => ({
  useAmlAccess: () => ({
    roles: new Set(["mlro"]), hasAnyRole: true, canWrite: true, isMlro: true, loading: false,
  }),
}));
vi.mock("@/lib/aml/useAmlV3Flags", () => ({
  useAmlV3Flags: () => ({ metricsRelocation: false, orgSettings: false }),
}));
vi.mock("@/lib/aml/useAmlTerminology", () => ({
  refreshAmlTerminology: vi.fn(),
  useAmlTerminology: () => ({ t: (x: string) => x }),
}));
vi.mock("@/components/aml/SanctionsListHealth", () => ({
  SanctionsListHealth: () => <div data-testid="sanctions-list-health" />,
}));

import AmlConfiguration from "../AmlConfiguration";

const SUMMARY = {
  settings: {
    tenant_id: "default", display_name: "NPC Services", plan_tier: "growth",
    terminology_overrides: {}, brand_primary: null, brand_logo_url: null,
    program_version: "1", legal_approval: true,
  },
  plans: [],
  providers: [],
  overrides: [],
  metrics_30d: { calls: 0, failures: 0, cost_cents: 0 },
  locked_terminology_keys: [],
};

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AmlConfiguration />
    </MemoryRouter>,
  );

beforeEach(() => { summary.mockReset(); });

describe("AmlConfiguration renders through its whole lifecycle", () => {
  it("survives the transition from loading to loaded", async () => {
    /* The regression itself. Before the fix this threw
       "Rendered more hooks than during the previous render" on the second
       render and the page never appeared. */
    summary.mockResolvedValue(SUMMARY);
    renderAt("/admin/aml/configuration");
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /Branding/ })).toBeInTheDocument());
  });

  it("opens the tab the link asked for", async () => {
    // Stage 5 sends an administrator to the sanctions register by name.
    summary.mockResolvedValue(SUMMARY);
    renderAt("/admin/aml/configuration?tab=providers");
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /Providers/ })).toHaveAttribute("aria-selected", "true"));
    // And the panel it was sent for is the one that mounted.
    expect(screen.getByTestId("sanctions-list-health")).toBeInTheDocument();
  });

  it("falls back to the default tab on a value it does not recognise", async () => {
    // A bad link must land somewhere sensible rather than on a tab strip
    // with no panel under it.
    summary.mockResolvedValue(SUMMARY);
    renderAt("/admin/aml/configuration?tab=not-a-tab");
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /Branding/ })).toHaveAttribute("aria-selected", "true"));
  });

  it("still renders the error branch rather than crashing", async () => {
    summary.mockRejectedValue(new Error("nope"));
    renderAt("/admin/aml/configuration");
    await waitFor(() =>
      expect(screen.getByText("Configuration failed to load")).toBeInTheDocument());
  });
});

describe("the rule that keeps it from happening again", () => {
  it("every hook is declared above the first early return", () => {
    /* Pinned as a property of the source rather than left to a reviewer's
       eye: this component early-returns twice, and a hook below either of
       them is a different hook count between renders. */
    const src = readFileSync(
      resolve(process.cwd(), "src/pages/aml/AmlConfiguration.tsx"), "utf8");
    const body = src.slice(src.indexOf("export default function AmlConfiguration()"));
    const componentBody = body.slice(0, body.indexOf("\nfunction "));
    const firstReturn = componentBody.indexOf("  if (loading) {");
    expect(firstReturn).toBeGreaterThan(0);
    const afterFirstReturn = componentBody.slice(firstReturn);
    for (const hook of ["useState(", "useEffect(", "useMemo(", "useRef(", "useSearchParams("]) {
      expect(afterFirstReturn).not.toContain(hook);
    }
  });
});
