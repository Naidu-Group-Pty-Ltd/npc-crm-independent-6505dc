import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PartnerComplianceWorkspace } from "../PartnerComplianceWorkspace";
import type {
  PartnerPortalAdapter, PartnerWorkspaceClient, PartnerWorkspaceDirectory,
} from "../types";
import { buildPartnerWorkspaceDto } from "../../../../supabase/functions/_shared/aml/partnerWorkspace";
import { buildPassportView } from "@/lib/aml/passport";

/**
 * The Compliance Passport, RENDERED inside a partner's own portal.
 *
 * ── What this is for ──────────────────────────────────────────────────
 * A partner who already holds a portal account asked to review the Passport
 * there rather than keep an email. The risk in granting that is not the
 * document — it is the surface that hosts it: the shared workspace carries
 * eight other panels, chosen by a static per-portal adapter rather than by a
 * flag, several of which would render and then refuse because their own
 * write flags are off.
 *
 * So these tests mount the real workspace under all three portal adapters
 * and assert two things a rule-level test cannot see: that `passport_only`
 * actually draws the booklet, and that it actually suppresses everything
 * else on the page.
 */

const NOW = new Date("2026-08-28T00:00:00Z");

const ALL_PANELS = {
  procedures: true, determination: true, recordsRequests: true,
  deliveries: true, auditReceipt: true, clarification: true,
};

/** The three portals, as they are actually configured. */
const PORTALS: Array<{ name: string; adapter: PartnerPortalAdapter }> = [
  {
    name: "Finance",
    adapter: {
      portalType: "finance", workspaceTitle: "Client compliance",
      matterLabel: "Purchase file", ownReferenceLabel: "File", roleLabel: "Lender / broker",
      formatReference: (l) => `File ${String(l.purchase_file_id ?? l.id).slice(0, 8)}`,
      panels: ALL_PANELS,
      support: { operationalLabel: "Message the team", operationalHref: "/finance/messages", complianceLabel: "your compliance officer" },
    },
  },
  {
    name: "Builder / Developer",
    adapter: {
      portalType: "builder", workspaceTitle: "Client compliance",
      matterLabel: "Lot / contract", ownReferenceLabel: "Contract", roleLabel: "Builder",
      formatReference: (l) => `Matter ${String(l.id).slice(0, 8)}`,
      panels: ALL_PANELS,
      support: { operationalLabel: "Message the team", operationalHref: "/builder/messages", complianceLabel: "your compliance officer" },
    },
  },
  {
    name: "Solicitor / Conveyancer",
    adapter: {
      portalType: "solicitor_conveyancer", workspaceTitle: "Client compliance",
      matterLabel: "Matter", ownReferenceLabel: "Matter", roleLabel: "Acting solicitor",
      formatReference: (l) => `Matter ${String(l.legal_matter_id ?? l.id).slice(0, 8)}`,
      panels: ALL_PANELS,
      support: { operationalLabel: "Message the team", operationalHref: "/solicitor/messages", complianceLabel: "your compliance officer" },
    },
  },
];

const directory = (mode?: string): PartnerWorkspaceDirectory => ({
  organisation: { legal_name: "Ridgeline Builders Pty Ltd", classification_status: "classified" },
  links: [{
    id: "link-0001", relationship_role: "builder", legal_route: "reliance",
    state: "active", portal_type: "builder", linked_at: "2026-08-01T00:00:00Z",
    ended_at: null, end_reason_code: null, purchase_file_id: "pf-000001", legal_matter_id: null,
  }],
  ...(mode ? { surface_mode: mode as never } : {}),
});

const dto = () => buildPartnerWorkspaceDto({
  partnerOrg: { legal_name: "Ridgeline Builders Pty Ltd", classification_status: "classified" },
  originLabel: "AML/CTF Command Centre",
  link: {
    id: "link-0001", relationship_role: "builder", legal_route: "reliance",
    state: "active", portal_type: "builder", linked_at: "2026-08-01T00:00:00Z",
    purchase_file_id: "pf-000001", legal_matter_id: null,
  },
  attestation: {
    schema_version: 2, version: 3, payload_sha256: "abcdef1234567890",
    issued_at: "2026-08-02T00:00:00Z", superseded_at: null,
  },
  grant: { revoked_at: null, expires_at: "2026-11-01T00:00:00Z" },
  procedures: {
    customer_identification: {
      parties: [{ party: "Synthetic Subject", verified: true, method: "document_sighting", completed_at: "2026-08-01T00:00:00Z" }],
      consents_held: [{ code: "compliance_sharing", version: "2026.2" }],
    },
  },
  limitations: [], recordAvailability: ["identity_verification_record"],
  determinations: [], requests: [], deliveries: [],
  now: NOW,
} as never);

/** The partner-audience projection, from the SAME builder the server uses. */
const passportView = () => buildPassportView("partner", {
  issuer_org: "Naidu Property Consulting Services",
  officer_label: "P. Naidu · MLRO",
  case: {
    id: "c1", case_reference: "AML-2026-0007", subject_display_name: "Synthetic Subject",
    subject_type: "individual", status: "cleared", case_stage: "cleared",
    service_gate_status: "approved", opened_at: "2026-07-01T00:00:00Z", closed_at: null,
  },
  attestations: [{
    version: 3, issued_at: "2026-08-02T00:00:00Z", superseded_at: null,
    payload_sha256: "a".repeat(64), schema_version: 2,
  }],
  material_inputs_current: true,
  open_refresh_obligations: 0,
  personal_details: null,
  entity_details: null,
  documents: [],
  transactions: [],
  screening: null,
  funding: null,
  partners: [],
  events: [],
  client_requests: [],
  stamp_input: {
    issuer_org: "Naidu Property Consulting Services",
    attestations: [{ version: 3, issued_at: "2026-08-02T00:00:00Z", superseded_at: null }],
    consents: [], verification_checks: [], documents: [], screening_subjects: [], owners: [],
    source_of_funds: [], source_of_wealth: [], edd_cases: [], grants: [],
    assessments: [], refresh_obligations: [], transactions: [],
  },
} as never);

const client = (over: Partial<Record<string, unknown>> = {}): PartnerWorkspaceClient => ({
  getDirectory: vi.fn(async () => ({ data: directory("passport_only"), error: null })),
  getWorkspace: vi.fn(async () => ({
    data: {
      workspace: dto(),
      surface_mode: "passport_only",
      passport: passportView(),
      passport_availability: { code: "disclosable", message: "" },
      ...over,
    },
    error: null,
  })),
  requestRecords: vi.fn(async () => ({ data: { request: {} }, error: null })),
  listRequests: vi.fn(async () => ({ data: { requests: [] }, error: null })),
  recordDetermination: vi.fn(async () => ({ data: { assessment: {} }, error: null })),
  listDeliveries: vi.fn(async () => ({ data: { deliveries: [] }, error: null })),
  getAuditReceipt: vi.fn(async () => ({ data: { receipt: {} }, error: null })),
} as never);

const mount = (
  adapter: PartnerPortalAdapter, c: PartnerWorkspaceClient, entry = "/builder/compliance",
) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <PartnerComplianceWorkspace adapter={adapter} client={c} />
    </MemoryRouter>,
  );

describe("the Passport reaches every portal, because there is one workspace", () => {
  for (const { name, adapter } of PORTALS) {
    it(`${name}: draws the Passport on the compliance page`, async () => {
      mount(adapter, client());
      await waitFor(() => {
        // The booklet draws its own cover AND the bookbar names the
        // instrument — several matches means it rendered, not one.
        expect(screen.getAllByText(/AML\/CTF Compliance Passport/i).length)
          .toBeGreaterThan(0);
      });
      // The credential, so a partner can see it is the same instrument the
      // issuer holds rather than a summary of it.
      expect(screen.getAllByText(/AML-2026-0007/).length).toBeGreaterThan(0);
    });

    it(`${name}: passport_only suppresses every unreviewed panel`, async () => {
      mount(adapter, client());
      await waitFor(() => {
        expect(screen.getAllByText(/AML\/CTF Compliance Passport/i).length)
          .toBeGreaterThan(0);
      });
      /* The adapter permits all six. The mode must remove them — this is the
         guarantee that "show them the Passport" cannot mean "expose seven
         features nobody has reviewed". */
      for (const testId of [
        "partner-compliance-summary", "partner-procedures", "partner-assessment-form",
        "partner-records-request",
      ]) {
        expect(screen.queryByTestId(testId), testId).toBeNull();
      }
      /* What is never withheld: the statutory statement and a way to ask.
         The standing page banner that used to carry the statement is gone
         from every portal — it restated an acknowledgement already given in
         the written arrangement, on every state, on every visit. So the
         statement is asserted where it now lives, which is where it is worth
         more: attached to the document it qualifies. Narrowing the page must
         never be able to take it off the screen. */
      expect(screen.getByTestId("partner-reliance-notice")).toBeTruthy();
      expect(screen.getByText(/remains responsible for its own AML\/CTF compliance/i)).toBeTruthy();
      expect(screen.getByTestId("partner-support")).toBeTruthy();
    });
  }
});

describe("full mode is unchanged — this cannot cost an existing deployment a panel", () => {
  it("a deployment already running the workspace still gets all of it", async () => {
    const full = client({ surface_mode: "full", passport: null, passport_availability: undefined });
    (full.getDirectory as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: directory("full"), error: null,
    });
    mount(PORTALS[0].adapter, full);
    await waitFor(() => {
      expect(screen.getByTestId("partner-compliance-summary")).toBeTruthy();
    });
    expect(screen.getByTestId("partner-procedures")).toBeTruthy();
    expect(screen.getByTestId("partner-assessment-form")).toBeTruthy();
    expect(screen.getByTestId("partner-records-request")).toBeTruthy();
  });
});

describe("a withheld Passport says why — an empty page is never the answer", () => {
  it("a lapsed grant names the remedy and keeps the partner's own route open", async () => {
    const withheld = client({
      passport: null,
      passport_availability: {
        code: "expired",
        message: "Access to this Compliance Passport has expired. Ask the issuing organisation to issue it again.",
      },
    });
    mount(PORTALS[1].adapter, withheld);
    await waitFor(() => {
      expect(screen.getByText(/The Compliance Passport is not available/i)).toBeTruthy();
    });
    expect(screen.getByText(/issue it again/i)).toBeTruthy();
    // Reliance is optional, always — their own CDD route is never closed.
    expect(screen.getByText(/independent customer due diligence/i)).toBeTruthy();
  });

  it("with the surface simply not enabled, nothing is said about our configuration", async () => {
    const off = client({
      passport: null, passport_availability: { code: "not_enabled", message: "" },
    });
    mount(PORTALS[2].adapter, off);
    await waitFor(() => {
      expect(screen.getByTestId("partner-compliance-workspace")).toBeTruthy();
    });
    expect(screen.queryByText(/not available/i)).toBeNull();
    expect(screen.queryByText(/enabled/i)).toBeNull();
  });
});

describe("the deep link from the emailed Passport lands on the right matter", () => {
  /** Two live matters, so "it picked one" is not the same as "it picked THIS one". */
  const twoMatters = (): PartnerWorkspaceDirectory => ({
    organisation: { legal_name: "Ridgeline Builders Pty Ltd", classification_status: "classified" },
    surface_mode: "passport_only" as never,
    links: [
      {
        id: "link-0001", relationship_role: "builder", legal_route: "reliance",
        state: "active", portal_type: "builder", linked_at: "2026-08-01T00:00:00Z",
        ended_at: null, end_reason_code: null, purchase_file_id: "pf-000001", legal_matter_id: null,
      },
      {
        id: "link-0002", relationship_role: "builder", legal_route: "reliance",
        state: "active", portal_type: "builder", linked_at: "2026-08-02T00:00:00Z",
        ended_at: null, end_reason_code: null, purchase_file_id: "pf-000002", legal_matter_id: null,
      },
    ],
  });

  const clientWithTwo = () => {
    const c = client();
    (c.getDirectory as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: twoMatters(), error: null,
    });
    return c;
  };

  it("?matter= opens THAT matter, not merely the first one", async () => {
    const c = clientWithTwo();
    mount(PORTALS[1].adapter, c, "/builder/compliance?matter=link-0002");
    await waitFor(() => expect(c.getWorkspace).toHaveBeenCalled());
    expect((c.getWorkspace as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("link-0002");
  });

  it("two matters and NO parameter asks rather than guessing", async () => {
    const c = clientWithTwo();
    mount(PORTALS[1].adapter, c, "/builder/compliance");
    await waitFor(() => {
      expect(screen.getByRole("navigation", { name: /matters shared/i })).toBeTruthy();
    });
    expect(c.getWorkspace).not.toHaveBeenCalled();
  });

  it("a stale matter falls through to the page rather than to a failure", async () => {
    /* An old email may name a matter this partner no longer holds. The
       server's directory is the authority; an unrecognised value is simply
       not selected, and the compliance page still opens. */
    const c = clientWithTwo();
    mount(PORTALS[1].adapter, c, "/builder/compliance?matter=link-does-not-exist");
    await waitFor(() => {
      expect(screen.getByTestId("partner-compliance-workspace")).toBeTruthy();
    });
    expect(c.getWorkspace).not.toHaveBeenCalled();
    expect(screen.queryByText(/not available/i)).toBeNull();
  });
});

describe("the filing cabinet — a partner holds many Passports", () => {
  const many = (count: number): PartnerWorkspaceDirectory => ({
    organisation: { legal_name: "Ridgeline Builders Pty Ltd", classification_status: "classified" },
    surface_mode: "passport_only" as never,
    links: Array.from({ length: count }, (_, i) => ({
      id: `link-${String(i).padStart(4, "0")}`,
      relationship_role: "builder_developer", legal_route: "reliance",
      state: "active", portal_type: "builder",
      linked_at: `2026-08-${String(10 + i).padStart(2, "0")}T00:00:00Z`,
      ended_at: null, end_reason_code: null,
      purchase_file_id: `pf-${String(i).padStart(6, "0")}`, legal_matter_id: null,
      passport_state: i % 2 === 0 ? "available" : "not_shared",
      subject_label: i % 2 === 0 ? `Client Number ${i}` : null,
      case_reference: i % 2 === 0 ? `AML-2026-${String(i).padStart(5, "0")}` : null,
    })) as never,
  });

  const clientWithDirectory = (dir: PartnerWorkspaceDirectory) => {
    const c = client();
    (c.getDirectory as ReturnType<typeof vi.fn>).mockResolvedValue({ data: dir, error: null });
    return c;
  };

  it("names the client on a readable matter — never a truncated row id", async () => {
    /* "Matter …6a5a49" was the reported defect: six characters of a UUID
       rendered as the only control on the page. */
    mount(PORTALS[1].adapter, clientWithDirectory(many(4)));
    expect(await screen.findByText("Client Number 0")).toBeInTheDocument();
    const list = screen.getByRole("navigation", { name: /matters shared/i });
    expect(list.textContent ?? "").not.toMatch(/Matter …[0-9a-f]{6}/);
  });

  it("a WITHHELD matter is listed without naming whose it is", async () => {
    mount(PORTALS[1].adapter, clientWithDirectory(many(4)));
    await screen.findByText("Client Number 0");
    const list = screen.getByRole("navigation", { name: /matters shared/i });
    // The odd-numbered ones are not shared and carry no subject.
    expect(list).toHaveTextContent(/Nothing shared yet/);
    /* The withheld rows carry the partner's OWN reference and no customer:
       naming them there would be a disclosure made by a list. */
    expect(list).toHaveTextContent(/Contract …0000/);
    expect(list).not.toHaveTextContent("Client Number 1");
  });

  it("a search box appears once there is enough to search", async () => {
    mount(PORTALS[1].adapter, clientWithDirectory(many(3)));
    await screen.findByText("Client Number 0");
    expect(screen.queryByRole("textbox", { name: /search your matters/i })).toBeNull();

    mount(PORTALS[1].adapter, clientWithDirectory(many(8)));
    expect(await screen.findByRole("textbox", { name: /search your matters/i }))
      .toBeInTheDocument();
  });

  it("searching narrows the list to what matches", async () => {
    mount(PORTALS[1].adapter, clientWithDirectory(many(8)));
    const search = await screen.findByRole("textbox", { name: /search your matters/i });
    fireEvent.change(search, { target: { value: "Client Number 4" } });
    const list = screen.getByRole("navigation", { name: /matters shared/i });
    expect(list).toHaveTextContent("Client Number 4");
    expect(list).not.toHaveTextContent("Client Number 0");
  });

  it("choosing a matter opens THAT matter", async () => {
    const c = clientWithDirectory(many(4));
    mount(PORTALS[1].adapter, c);
    fireEvent.click(await screen.findByText("Client Number 2"));
    await waitFor(() => expect(c.getWorkspace).toHaveBeenCalled());
    expect((c.getWorkspace as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0])
      .toBe("link-0002");
  });

  it("with several matters and none chosen, it says to choose one", async () => {
    mount(PORTALS[1].adapter, clientWithDirectory(many(4)));
    expect(await screen.findByText(/Choose a matter to open its Compliance Passport/i))
      .toBeInTheDocument();
  });
});
