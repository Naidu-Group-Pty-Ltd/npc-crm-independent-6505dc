import { readFileSync } from "node:fs";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The partner's Passport page, RENDERED.
 *
 * The reported defect was visible in one screenshot and invisible to every
 * test in the repository: the page drew `JSON.stringify(attestation)` in a
 * `<pre>`. The pure composer is tested next door; what needs mounting is that
 * the page actually draws the booklet, that the reader can enlarge it, and
 * that the raw payload survives as a disclosure rather than as the offer.
 */

vi.mock("react-router-dom", () => ({ useParams: () => ({ token: "a".repeat(64) }) }));

vi.mock("@/components/branding/BrandAssets", () => ({
  BrandLockup: () => <div data-testid="brand-lockup" />,
}));

const redeem = vi.fn();
vi.mock("@/lib/aml/partnerAcknowledgementPublic", () => ({
  passportPublicApi: {
    redeem: (...a: unknown[]) => redeem(...a),
    requestNewLink: vi.fn(),
    recordIndependentAssessment: vi.fn(),
  },
}));

import PublicPassport from "@/pages/PublicPassport";
import { buildBooklet, buildPassportView, type PassportViewInput } from "@/lib/aml/passport";

/** A case with every family populated, as the server would send it. */
function partnerViewInput(): PassportViewInput {
  return {
    issuer_org: "NPC Services command centre",
    officer_label: "P. Naidu · MLRO",
    case: {
      id: "case-1", case_reference: "AML-2026-00005",
      subject_display_name: "Rugesh Naidu", subject_type: "individual",
      status: "cleared", case_stage: "cleared", service_gate_status: "approved",
      opened_at: "2026-08-01T00:00:00Z", closed_at: null,
    },
    attestations: [{
      version: 1, issued_at: "2026-08-27T08:28:28.000Z", superseded_at: null,
      payload_sha256: "b".repeat(64), schema_version: 2,
    }],
    material_inputs_current: true,
    open_refresh_obligations: 0,
    personal_details: { full_name: "Rugesh Naidu", date_of_birth: "1980-01-01" },
    entity_details: null,
    documents: [{
      id: "doc-1", requirement_label: "Passport", requirement_code: "passport",
      required: true, status: "accepted", created_at: "2026-08-10T00:00:00Z", version_number: 1,
    }],
    transactions: [],
    ownership: [{
      name: "Rugesh Naidu", party_kind: "beneficial_owner", relationship: "sole",
      ownership_percent: 100, control_type: "ownership", is_ubo: true,
      verification_state: "verified",
    }],
    screening: {
      subjects: [{ state: "completed", completed_at: "2026-08-20T15:16:00Z", party_label: "Rugesh Naidu" }],
      pep_result: "not_pep", pep_determined_at: "2026-08-20T00:00:00Z",
      list_freshness: { un: "2026-08-26T20:01:53Z", dfat: "2026-08-26T20:02:33Z" },
    },
    funding: {
      sof: [{ verified: true, verified_at: "2026-08-18T00:00:00Z" }],
      sow: [{ verified: true, verified_at: "2026-08-18T00:00:00Z" }],
      edd: [],
    },
    partners: null,
    events: [{ id: "e1", category: "system", summary: "internal", actor_label: "MLRO", created_at: "2026-08-20T00:00:00Z" }],
    client_requests: [],
    stamp_input: {
      issuer_org: "NPC Services command centre",
      attestations: [{ version: 1, issued_at: "2026-08-27T08:28:28.000Z", superseded_at: null }],
      consents: [{ id: null, kind: "compliance_sharing", accepted_at: "2026-08-15T16:51:54Z", actor_label: "Client" }],
      verification_checks: [{
        id: null, party_label: "Rugesh Naidu", check_type: "electronic_idv", status: "passed",
        completed_at: "2026-08-20T15:16:00Z",
      }],
      documents: [{ status: "accepted", reviewed_at: "2026-08-11T00:00:00Z", created_at: "2026-08-10T00:00:00Z" }],
      screening_subjects: [{ state: "completed", completed_at: "2026-08-20T15:16:00Z" }],
      owners: [{ verification_state: "verified", verified_at: "2026-08-19T00:00:00Z" }],
      source_of_funds: [{ verified: true, verified_at: "2026-08-18T00:00:00Z" }],
      source_of_wealth: [{ verified: true, verified_at: "2026-08-18T00:00:00Z" }],
      edd_cases: [],
      grants: [],
      assessments: [],
      refresh_obligations: [],
      transactions: [],
    },
  } as PassportViewInput;
}

const redemption = {
  attestation_sha256: "28099ae9048b1397aa11bb22cc33dd44ee55ff6677889900aabbccddeeff0011",
  issued_at: "2026-08-27T08:28:28.000Z",
  attestation_version: 1,
  agreement: {
    partner_org_name: "Testing Pty Ltd",
    agreement_reference: "AML/CTF Compliance Passport Agreement",
    scope: ["customer_identification"],
  },
  notice: "You may rely on the customer identification procedures described here.",
  attestation: {
    issuer: "NPC Services command centre",
    case_reference: "AML-2026-00005",
    subject: "Rugesh Naidu",
    subject_type: "individual",
    customer_identification: {
      parties: [{
        party: "Rugesh Naidu", verified: true, method: "electronic_idv",
        completed_at: "2026-08-20T15:16:00.000Z",
      }],
      sections_submitted: 6,
      consents_held: [
        { code: "compliance_sharing", version: "2026.2", accepted_at: "2026-08-15T16:51:54.000Z" },
      ],
    },
    screening: {
      performed: true, last_performed_at: "2026-08-20T15:16:00.000Z",
      scope: ["sanctions"], list_freshness: { un: "2026-08-26T20:01:53.000Z" },
    },
    limitations: ["documents_not_verified_against_issuing_authority"],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  redeem.mockResolvedValue(redemption);
});

describe("the partner is handed a document", () => {
  it("draws the booklet — cover first, with its bearer on it", async () => {
    render(<PublicPassport />);

    expect(await screen.findByLabelText("Passport cover")).toBeInTheDocument();
    expect(screen.getAllByText("Rugesh Naidu").length).toBeGreaterThan(0);
    // The bar names the document and the cover prints it — both deliberate.
    expect(screen.getAllByText("AML/CTF Compliance Passport").length).toBeGreaterThan(0);
  });

  it("offers the pages of the record, not one wall of text", async () => {
    render(<PublicPassport />);
    await screen.findByLabelText("Passport cover");

    // Every leaf of the instrument is reachable from the page chips — the
    // same leaves, in the same order, as the Command Centre's document.
    for (const title of [
      "Client Identity", "Compliance Summary", "Identity Verification",
      "Screening", "Disclosure & Access", "Review & Renewal",
    ]) {
      expect(screen.getByRole("button", { name: new RegExp(title, "i") })).toBeInTheDocument();
    }
    // Including the ones a relying entity may not read: present and named,
    // never silently dropped.
    expect(screen.getByRole("button", { name: /Funding & Due Diligence/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Journey Record/i })).toBeInTheDocument();
  });

  it("names the credential exactly as the Command Centre does", async () => {
    render(<PublicPassport />);
    await screen.findByLabelText("Passport cover");

    expect(screen.getAllByText(/AUX-AML-2026-00005-V1/).length).toBeGreaterThan(0);
  });

  it("offers no raw payload — the document IS the record", async () => {
    render(<PublicPassport />);
    await screen.findByLabelText("Passport cover");

    // A fold-out of the object the document was drawn from invited a relying
    // entity to read the source instead of the instrument. An integration
    // that needs the object still redeems the same token and receives it.
    expect(screen.queryByText(/View the underlying record/i)).not.toBeInTheDocument();
    expect(document.querySelector("details")).toBeNull();
    expect(document.querySelector("pre")).toBeNull();
  });

  it("still leads with the responsibility notice", async () => {
    render(<PublicPassport />);
    expect(await screen.findByText(/You may rely on the customer identification/i))
      .toBeInTheDocument();
    expect(screen.getByText(/Make your own determination/i)).toBeInTheDocument();
  });
});

describe("the reader can enlarge it", () => {
  it("starts at the fit and steps up from there", async () => {
    render(<PublicPassport />);
    await screen.findByLabelText("Passport cover");

    const reset = screen.getByRole("button", { name: /Magnification 100 percent/i });
    expect(reset).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Zoom out$/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /^Zoom in$/i }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Magnification 125 percent/i }))
        .toBeInTheDocument());
    expect(screen.getByRole("button", { name: /^Zoom out$/i })).not.toBeDisabled();
  });

  it("returns to the fit when the reader asks", async () => {
    render(<PublicPassport />);
    await screen.findByLabelText("Passport cover");

    fireEvent.click(screen.getByRole("button", { name: /^Zoom in$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Magnification 125 percent/i }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Magnification 100 percent/i })).toBeDisabled());
  });

  it("offers one page at a time, which is the cheapest magnification there is", async () => {
    render(<PublicPassport />);
    await screen.findByLabelText("Passport cover");

    const toggle = screen.getByRole("button", { name: /Show one page at a time/i });
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Show two pages side by side/i }))
        .toBeInTheDocument());
  });
});

describe("the mark on a page an outsider sees", () => {
  it("is constrained, so the document is the subject of the page", () => {
    // `BrandLogo` sets a size floor now, because the three pages that forgot
    // to pass one are the three an outsider sees. The page constrains it
    // explicitly as well — this is its letterhead, not its subject.
    const source = readFileSync("src/pages/PublicPassport.tsx", "utf8");
    expect(source).toContain('logoClassName="h-10 w-auto object-contain sm:h-12"');

    const brand = readFileSync("src/components/branding/BrandAssets.tsx", "utf8");
    expect(brand).toContain("const LOGO_DEFAULT =");
    // The floor must not win over a caller that sizes its own mark.
    expect(brand).toContain("cn(LOGO_DEFAULT, className)");
  });
});

/**
 * One document, proved by construction.
 *
 * The partner's copy is not a composition that resembles the Command
 * Centre's — it is `buildBooklet` over the same projection, so "identical" is
 * a property of the code rather than a claim in a comment.
 */
describe("the partner's document IS the Command Centre's", () => {
  it("renders the command composer's pages when the server sends the view", async () => {
    const view = buildPassportView("partner", partnerViewInput());
    redeem.mockResolvedValue({ ...redemption, passport: view });

    render(<PublicPassport />);
    await screen.findByLabelText("Passport cover");

    // Every leaf `buildBooklet` emits for this projection is on the page.
    for (const page of buildBooklet(view).filter((p) => p.variant === "leaf")) {
      expect(
        screen.getByRole("button", { name: new RegExp(page.title.replace(/[&]/g, "\\&"), "i") }),
      ).toBeInTheDocument();
    }
  });

  it("shows the due-diligence leaves a relying entity needs, in full", async () => {
    const view = buildPassportView("partner", partnerViewInput());
    redeem.mockResolvedValue({ ...redemption, passport: view });

    render(<PublicPassport />);
    await screen.findByLabelText("Passport cover");

    // Not "withheld" placeholders: the actual leaves, from the actual records.
    for (const title of ["Screening", "Funding & Due Diligence", "Ownership & Control"]) {
      expect(screen.getByRole("button", { name: new RegExp(title, "i") })).toBeInTheDocument();
    }
    expect(screen.queryByText(/Not disclosed to a relying entity/i)).not.toBeInTheDocument();
  });

  it("falls back to the payload composition when an older server sends no view", async () => {
    // A deployment mid-publish must degrade to a thinner document, never to
    // no document.
    redeem.mockResolvedValue(redemption);
    render(<PublicPassport />);
    expect(await screen.findByLabelText("Passport cover")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Client Identity/i })).toBeInTheDocument();
  });
});
