import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Source-contract tests for the Phase 5 portal integration: the shared
 * workspace is MOUNTED through adapters (never copied), organisation
 * identity never travels from the browser, routes sit inside each portal's
 * existing protected tree, flags gate every surface, and no standalone
 * Developer Portal is invented.
 */

const repo = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");

const app = read("src/App.tsx");
const clientFactory = read("src/lib/partnerWorkspaceClient.ts");
const flagHook = read("src/lib/aml/usePartnerWorkspaceFlags.ts");
/* The Builder portal's page, layout and adapter left this repository with
   the portal (network extraction Phase 7) — /builder/* is one redirect to
   the Builders Network, and a builder partner's channel is the emailed
   Passport link until E4's network→clone surface ships. The two surviving
   portals carry the contract. */
const financePage = read("src/pages/finance-portal/FinancePortalComplianceWorkspace.tsx");
const solicitorPage = read("src/pages/solicitor/SolicitorCompliance.tsx");
const financeLayout = read("src/components/finance-portal/FinancePortalLayout.tsx");
const solicitorLayout = read("src/components/solicitor-portal/SolicitorPortalLayout.tsx");

const PAGES = [
  ["finance", financePage],
  ["solicitor", solicitorPage],
] as const;

describe("one shared implementation, mounted through adapters", () => {
  it("every portal page mounts PartnerComplianceWorkspace from the shared package", () => {
    for (const [, page] of PAGES) {
      expect(page).toContain('from "@/components/partner-compliance"');
      expect(page).toContain("<PartnerComplianceWorkspace");
      expect(page).toContain("makePartnerWorkspaceClient");
    }
  });

  it("no page re-implements workspace panels — pages import only the orchestrator and adapter", () => {
    for (const [, page] of PAGES) {
      for (const sub of [
        "ProcedureEvidenceViewer", "IndependentAssessmentForm", "RecordsRequestBuilder",
        "AuditReceiptPanel", "RefreshBanner", "ComplianceSummaryCard",
      ]) {
        expect(page).not.toContain(sub);
      }
    }
  });

  it("each page pairs its own portal transport with its own adapter", () => {
    expect(financePage).toContain("useFinancePortalAuth");
    expect(financePage).toContain("financePortalAdapter");
    expect(financePage).toContain('"finance"');
    expect(solicitorPage).toContain("invokeSolicitorFunction");
    expect(solicitorPage).toContain("solicitorPortalAdapter");
    expect(solicitorPage).toContain('"solicitor_conveyancer"');
  });
});

describe("identity never travels from the browser", () => {
  it("the client factory adds only op, portal_type and caller link inputs", () => {
    expect(clientFactory).not.toMatch(/partner_org_id|tenant_id|organisation_id|firm_id|user_id/);
    expect(clientFactory).toContain('portal_type: surface');
    // The transport is the portal's own authenticated invoke — the factory
    // never constructs its own fetch with credentials.
    expect(clientFactory).not.toMatch(/fetch\(|localStorage|sessionStorage|document\.cookie/);
  });

  it("no portal page smuggles identifiers either", () => {
    for (const [, page] of PAGES) {
      expect(page).not.toMatch(/partner_org_id|tenant_id|access_token/);
    }
  });
});

describe("routes and navigation", () => {
  it("each route sits inside the portal's existing protected layout tree", () => {
    expect(app).toMatch(/<Route path="compliance" element=\{<FinancePortalComplianceWorkspace \/>\} \/>/);
    expect(app).toMatch(/<Route path="compliance" element=\{<SolicitorCompliance \/>\} \/>/);
    // No new guard, no new provider, no bypass of the existing shells: the
    // additions are children of routes that already existed.
    //
    // Phase 6 of the network extraction unrouted the whole Builder portal:
    // /builder/* is one redirect to the Builders Network, so the builder
    // compliance route left App.tsx WITH the tree it lived in. The page and
    // its adapter stay in the repository (asserted above) until Phase 7
    // deletes them, and the portal handoff names the closed door
    // `portal_moved` until E4's network→clone surface ships.
    expect(app).not.toMatch(/<Route path="compliance" element=\{<BuilderCompliance \/>\} \/>/);
    expect(app).toMatch(/<Route path="\/builder\/\*" element=\{<BuilderPortalMoved \/>\} \/>/);
  });

  it("no standalone Developer Portal route or app exists — that foundation is absent and fails closed", () => {
    expect(app).not.toMatch(/path="\/developer/);
    expect(app).not.toMatch(/DeveloperPortal/);
  });

  it("every nav entry is flag-gated and disappears while the flags are off", () => {
    expect(financeLayout).toContain("usePartnerWorkspaceEnabled('finance')");
    expect(financeLayout).toMatch(/'partnerWorkspace' in item/);
    expect(solicitorLayout).toContain("usePartnerWorkspaceEnabled('solicitor')");
    expect(solicitorLayout).toMatch(/'partnerWorkspace' in item/);
  });

  it("the flag gate fails closed and requires master AND surface flags", () => {
    /* The PROPERTY is unchanged; where it is evaluated is not. It used to be
       a `feature_flags` read from the browser, and that read can never work
       for a partner: the table grants SELECT `TO authenticated`, a portal
       user's client is anon, and RLS filters rather than erroring — so it
       returned `[]` with HTTP 200 and every flag coerced to false. Every
       partner was told "the compliance workspace is not available" however
       the database was set. It is answered by the server now. */
    const fn = read("supabase/functions/aml-reliance/index.ts");
    const op = fn.slice(
      fn.indexOf('if (op === "get_partner_surface_availability")'),
      fn.indexOf("if (PARTNER_WORKSPACE_OPS.has(op))"));
    // Master AND surface, both, still.
    expect(op).toContain("compliance_page: master && surfaceOn");
    expect(op).toContain('flagEnabled(admin, "aml_partner_compliance_workspace")');
    expect(op).toContain("flagEnabled(admin, flagKey)");
    // And the client still fails closed on an unreadable answer.
    expect(flagHook).toContain("UNKNOWN");
    expect(flagHook).toContain("compliancePage: false");
    expect(flagHook).toContain("catch(() => UNKNOWN)");
  });
});

describe("privilege and portal boundaries", () => {
  it("the solicitor mount touches no matter files, notes or communications modules", () => {
    expect(solicitorPage).not.toMatch(/solicitorQueries|legalMatters|MatterDocuments|MatterCommunications|solicitorComms/);
  });

  it("the finance mount leaves the existing funding workflow untouched", () => {
    expect(financePage).not.toMatch(/finance-portal-aml-requests|AmlFinanceRequestsCard|amlFinanceApi/);
  });

  it("portal layouts stay free of direct data clients — gating goes through the hook module", () => {
    for (const layout of [financeLayout, solicitorLayout]) {
      expect(layout).not.toMatch(/supabase\.|\.rpc\(|useQuery\(/);
    }
  });
});
