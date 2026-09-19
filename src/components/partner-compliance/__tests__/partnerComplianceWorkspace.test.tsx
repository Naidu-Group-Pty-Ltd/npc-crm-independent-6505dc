import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PartnerComplianceWorkspace } from "../PartnerComplianceWorkspace";
import type {
  PartnerPortalAdapter, PartnerWorkspaceClient, PartnerWorkspaceDirectory,
} from "../types";
import { RESPONSIBILITY_NOTICE } from "../types";
import { buildPartnerWorkspaceDto } from "../../../../supabase/functions/_shared/aml/partnerWorkspace";

/**
 * Rendering tests for the SHARED workspace. The same component tree is
 * rendered under two different adapters — proving portal differences are
 * adapter configuration, not duplicate implementations — and the rendered
 * output is swept for internal AML vocabulary. Synthetic data only.
 */

const NOW = new Date("2026-08-05T00:00:00Z");

const adapter = (over: Partial<PartnerPortalAdapter> = {}): PartnerPortalAdapter => ({
  portalType: "finance",
  workspaceTitle: "Client compliance",
  matterLabel: "Purchase file",
  roleLabel: "Lender / broker",
  formatReference: (l) => `File ${String(l.purchase_file_id ?? l.id).slice(0, 8)}`,
  panels: {
    procedures: true, determination: true, recordsRequests: true,
    deliveries: true, auditReceipt: true, clarification: true,
  },
  support: {
    operationalLabel: "Message the team",
    operationalHref: "/finance/messages",
    complianceLabel: "your organisation's compliance officer",
  },
  ...over,
});

const directory: PartnerWorkspaceDirectory = {
  organisation: { legal_name: "Synthetic Finance Pty Ltd", classification_status: "classified" },
  links: [{
    id: "link-0001", relationship_role: "lender", legal_route: "reliance",
    state: "active", portal_type: "finance", linked_at: "2026-08-01T00:00:00Z",
    ended_at: null, end_reason_code: null, purchase_file_id: "pf-000001", legal_matter_id: null,
  }],
};

const dto = (over: Record<string, unknown> = {}) => buildPartnerWorkspaceDto({
  partnerOrg: { legal_name: "Synthetic Finance Pty Ltd", classification_status: "classified" },
  originLabel: "AML/CTF Command Centre",
  link: {
    id: "link-0001", relationship_role: "lender", legal_route: "reliance",
    state: "active", portal_type: "finance", linked_at: "2026-08-01T00:00:00Z",
    purchase_file_id: "pf-000001", legal_matter_id: null,
  },
  attestation: {
    schema_version: 2, version: 3, payload_sha256: "abcdef1234567890",
    issued_at: "2026-08-02T00:00:00Z", superseded_at: null,
  },
  grant: { revoked_at: null, expires_at: "2026-11-01T00:00:00Z" },
  procedures: {
    customer_identification: {
      parties: [{ party: "Synthetic Subject", verified: true, method: "document_sighting", completed_at: "2026-08-01T00:00:00Z", document_type: "drivers_licence" }],
      consents_held: [{ code: "compliance_sharing", version: "2026.2" }],
    },
    screening: { performed: true, last_performed_at: "2026-08-02T00:00:00Z", list_freshness: { dfat: "2026-08-04T18:10:00Z" } },
  },
  limitations: ["documents_not_verified_against_issuing_authority"],
  recordAvailability: ["identity_verification_record"],
  determinations: [], requests: [], deliveries: [],
  now: NOW,
  ...over,
} as any);

const client = (workspace = dto()): PartnerWorkspaceClient => ({
  getDirectory: vi.fn(async () => ({ data: directory, error: null })),
  getWorkspace: vi.fn(async () => ({ data: { workspace }, error: null })),
  requestRecords: vi.fn(async () => ({ data: { request: {} }, error: null })),
  listRequests: vi.fn(async () => ({ data: { requests: [] }, error: null })),
  recordDetermination: vi.fn(async () => ({ data: { assessment: {} }, error: null })),
  listDeliveries: vi.fn(async () => ({ data: { deliveries: [] }, error: null })),
  getAuditReceipt: vi.fn(async () => ({ data: { receipt: {} }, error: null })),
});

const mount = (a: PartnerPortalAdapter, c: PartnerWorkspaceClient) =>
  render(
    <MemoryRouter>
      <PartnerComplianceWorkspace adapter={a} client={c} />
    </MemoryRouter>,
  );

describe("shared partner compliance workspace", () => {
  it("the denial renders as the page, with a heading and a route out", async () => {
    /* This used to assert the standing responsibility banner appeared even
       here. That banner is gone from every portal — a partner reaches this
       page only after signing the written arrangement and giving its
       acknowledgements, so restating it on every visit, including on a page
       that is refusing them, was repetition rather than notice.

       What the denial must still do is the reason the test exists: name
       itself, say why, and leave the emailed link standing. A partner who
       followed "Open it in your Finance Portal" and landed on one grey
       sentence cannot tell a broken product from a wrong turn. */
    const denied: PartnerWorkspaceClient = {
      ...client(),
      getDirectory: vi.fn(async () => ({
        data: null,
        error: { message: "Your account is not enrolled for the compliance workspace.", code: "membership_missing" },
      })),
    };
    mount(adapter(), denied);
    await waitFor(() => {
      expect(screen.getByTestId("partner-compliance-workspace")).toBeTruthy();
    });
    expect(screen.getByText(/This page is not available to your account yet/i)).toBeTruthy();
    expect(screen.getByText(/that link still works/i)).toBeTruthy();
    // And it does NOT carry the banner any more, in any state.
    expect(screen.queryByTestId("partner-responsibility-notice")).toBeNull();
    expect(screen.queryByText(RESPONSIBILITY_NOTICE)).toBeNull();
  });

  it("renders the full workspace with summary, procedures, determination and requests", async () => {
    mount(adapter(), client());
    await waitFor(() => {
      expect(screen.getByTestId("partner-compliance-summary")).toBeTruthy();
    });
    expect(screen.getByTestId("partner-procedures")).toBeTruthy();
    expect(screen.getByTestId("partner-assessment-form")).toBeTruthy();
    expect(screen.getByTestId("partner-records-request")).toBeTruthy();
    expect(screen.getByTestId("partner-support")).toBeTruthy();
  });

  it("shows refresh and revoked states clearly, without the sensitive reason", async () => {
    const superseded = dto({
      attestation: {
        schema_version: 2, version: 3, payload_sha256: "abcdef1234567890",
        issued_at: "2026-08-02T00:00:00Z", superseded_at: "2026-08-04T00:00:00Z",
      },
    });
    mount(adapter(), client(superseded));
    await waitFor(() => {
      expect(screen.getByTestId("partner-refresh-banner")).toBeTruthy();
    });
    const banner = screen.getByTestId("partner-refresh-banner");
    expect(banner.textContent).toContain("Attestation refreshed");
    // The banner explains WHAT to do, never WHY the origin refreshed.
    expect(banner.textContent).not.toMatch(/material change|screening|risk|investigation/i);
  });

  it("two different adapters render through the same component implementation", async () => {
    const solicitorAdapter = adapter({
      portalType: "solicitor_conveyancer",
      workspaceTitle: "Matter compliance",
      matterLabel: "Matter",
      roleLabel: "Acting solicitor",
      panels: {
        procedures: true, determination: true, recordsRequests: true,
        deliveries: true, auditReceipt: false, clarification: false,
      },
    });
    const first = mount(adapter(), client());
    await waitFor(() => expect(screen.getAllByTestId("partner-compliance-summary").length).toBeGreaterThan(0));
    first.unmount();
    mount(solicitorAdapter, client());
    await waitFor(() => {
      expect(screen.getByTestId("partner-compliance-summary")).toBeTruthy();
    });
    // Adapter differences are presentation only: hidden panels disappear,
    // the same testids render — there is no second implementation.
    expect(screen.getAllByText("Matter compliance").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("partner-audit-receipt")).toBeNull();
  });

  it("leaks no internal AML vocabulary anywhere in the rendered output", async () => {
    const { container } = mount(adapter(), client());
    await waitFor(() => expect(screen.getByTestId("partner-compliance-summary")).toBeTruthy());
    const text = (container.textContent ?? "").toLowerCase();
    for (const banned of [
      "risk rating", "risk score", "potential match", "adverse media", "reviewer note",
      "suspicious matter", "discrepanc", "case_stage", "service_gate",
    ]) {
      expect(text).not.toContain(banned);
    }
    // Short internal acronyms are word-bounded so element concatenation in
    // textContent ("verified"+"document" → "…edd…") cannot false-positive.
    for (const acronym of [/\bmlro\b/, /\bedd\b/, /\bsmr\b/]) {
      expect(text).not.toMatch(acronym);
    }
  });

  it("supports keyboard interaction: matters are real buttons with aria-current", async () => {
    /* The chip row became a searchable filing list — a partner accumulates
       Passports, and "Matter …6a5a49" does not survive ten of them. The
       property is unchanged: each matter is a real button, and the selected
       one is marked for assistive technology. */
    mount(adapter(), client());
    await waitFor(() => expect(screen.getByTestId("partner-compliance-summary")).toBeTruthy());
    const nav = screen.getByRole("navigation", { name: /matters shared with your organisation/i });
    const buttons = nav.querySelectorAll("button");
    expect(buttons.length).toBe(1);
    expect(buttons[0].getAttribute("aria-current")).toBe("true");
  });
});
