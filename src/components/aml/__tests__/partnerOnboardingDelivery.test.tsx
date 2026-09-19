import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The onboarding wizard, RENDERED, at the moment it grants.
 *
 * ── The defect, in one argument ───────────────────────────────────────
 * `grant_access` emails the Passport link when — and only when — it is given
 * a `deliver_to`. The wizard called it as `grantAccess(caseId, agreement.id)`.
 * Nothing failed: the grant was minted, the register was correct, the audit
 * trail was complete, `delivered_to_email` was null, and the partner was
 * never told anything. The operator was then handed a raw bearer token with
 * the instruction to deliver it "through their usual channel".
 *
 * No source-scanning test could see that, because the call was present and
 * spelled correctly. So this one drives the wizard to the end and asserts on
 * the ARGUMENTS, and on what the final screen leads with.
 */

const upsertPartnerOrganisation = vi.fn();
const createAgreement = vi.fn();
const linkPartnerToCase = vi.fn();
const grantAccess = vi.fn();
const listAgreements = vi.fn();
const listPartnerOrganisations = vi.fn();
const listAttestations = vi.fn();
const sendPartnerAcknowledgement = vi.fn();
const enrolPartnerPortalAccess = vi.fn();

vi.mock("@/lib/aml/amlRelianceApi", () => ({
  amlRelianceApi: {
    upsertPartnerOrganisation: (...a: unknown[]) => upsertPartnerOrganisation(...a),
    createAgreement: (...a: unknown[]) => createAgreement(...a),
    linkPartnerToCase: (...a: unknown[]) => linkPartnerToCase(...a),
    grantAccess: (...a: unknown[]) => grantAccess(...a),
    listAgreements: (...a: unknown[]) => listAgreements(...a),
    listPartnerOrganisations: (...a: unknown[]) => listPartnerOrganisations(...a),
    listAttestations: (...a: unknown[]) => listAttestations(...a),
    sendPartnerAcknowledgement: (...a: unknown[]) => sendPartnerAcknowledgement(...a),
    enrolPartnerPortalAccess: (...a: unknown[]) => enrolPartnerPortalAccess(...a),
  },
}));

const consentStatus = vi.fn();
vi.mock("@/lib/aml/amlCasesApi", () => ({
  amlCasesApi: { consentStatus: (...a: unknown[]) => consentStatus(...a) },
}));

const invokeSecureFunction = vi.fn();
vi.mock("@/lib/secureInvoke", () => ({
  invokeSecureFunction: (...a: unknown[]) => invokeSecureFunction(...a),
}));

const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (...a: unknown[]) => toast(...a) }));

import { PartnerOnboardingWizard } from "../PartnerOnboardingWizard";

const CASE_ID = "8b668f2f-0132-436f-b32c-d6709ea69526";
const CONTACT = "site@ridgeline.example";

beforeEach(() => {
  vi.clearAllMocks();
  listPartnerOrganisations.mockResolvedValue({ partner_organisations: [] });
  listAgreements.mockResolvedValue({ agreements: [] });
  listAttestations.mockResolvedValue({
    attestations: [{ id: "att-1", version: 3, issued_at: "2026-08-27T00:00:00.000Z", payload_sha256: "abc", superseded_at: null }],
  });
  consentStatus.mockResolvedValue({
    documents: [{ code: "compliance_sharing", accepted_at: "2026-08-01T00:00:00.000Z" }],
  });
  // Every portal-provisioning call succeeds; the invite is not under test.
  // One generic answer serves every portal's admin/invite mock: the builder
  // keys are historical (that portal's provisioning is closed now — the
  // portal moved), the solicitor keys drive the enrolment journeys below.
  invokeSecureFunction.mockResolvedValue({
    data: {
      users: [], organisation: { id: "builder-org-1", row_version: 1, status: "active" },
      user: { id: "builder-user-1" },
      firm_id: "firm-1", solicitor_user_id: "sol-user-1",
    },
    error: null,
  });
  enrolPartnerPortalAccess.mockResolvedValue({
    membership: { id: "m1", status: "active", portal_type: "builder" },
    organisation_binding: { column: "builder_organisation_id", portal_organisation_id: "builder-org-1", bound: "set" },
    surface_enabled: false, passport_view_enabled: false,
  });
  upsertPartnerOrganisation.mockResolvedValue({ partner_organisation: { id: "org-1" } });
  createAgreement.mockResolvedValue({ agreement: { id: "ag-1", partner_org_name: "Ridgeline Builders" } });
  linkPartnerToCase.mockResolvedValue({});
  grantAccess.mockResolvedValue({
    grant: { id: "gr-1", expires_at: "2027-08-20T00:00:00.000Z", attestation_version: 3 },
    access_token: "raw-token",
    passport_link: "https://npc.example/passport/raw-token",
    delivered_to: CONTACT,
    link_email_sent: true,
    link_email_error: null,
    note: "ok",
  });
});

const renderWizard = () => render(
  <PartnerOnboardingWizard
    open
    caseId={CASE_ID}
    attestationVersion={3}
    organisations={[]}
    agreements={[]}
    onOpenChange={() => {}}
    onDone={async () => {}}
  />,
);

/**
 * Drive the three steps to the confirm button, on the Builder / Developer
 * portal — the case the defect was reported against, and the one where the
 * organisation cross-reference is strictly enforced by the session resolver.
 */
async function runWizard() {
  renderWizard();
  fireEvent.change(await screen.findByLabelText(/Legal name/i), {
    target: { value: "Ridgeline Builders Pty Ltd" },
  });
  fireEvent.click(screen.getByRole("radio", { name: /Builder \/ Developer portal/i }));
  fireEvent.change(screen.getByLabelText(/Contact email/i), { target: { value: CONTACT } });
  fireEvent.change(screen.getByLabelText(/Contact name/i), { target: { value: "Dana Reyes" } });
  fireEvent.click(screen.getByRole("button", { name: /^Continue$/ }));
  fireEvent.click(await screen.findByRole("button", { name: /^Continue$/ }));
  fireEvent.click(await screen.findByRole("button", { name: /Record, invite & grant/i }));
}

/**
 * The same journey through the Solicitors & conveyancers portal — the
 * enrolment rules' remaining live surface. The builder journey above still
 * exercises delivery, but its enrolment half is CLOSED (the portal moved to
 * the Builders Network), so the behavioural coverage of enrolment drives
 * through a portal this workspace still serves.
 */
async function runSolicitorWizard() {
  renderWizard();
  fireEvent.change(await screen.findByLabelText(/Legal name/i), {
    target: { value: "Harbour & Vale Conveyancing" },
  });
  fireEvent.click(screen.getByRole("radio", { name: /Solicitors & conveyancers/i }));
  fireEvent.change(screen.getByLabelText(/Contact email/i), { target: { value: CONTACT } });
  fireEvent.change(screen.getByLabelText(/Contact name/i), { target: { value: "Dana Reyes" } });
  fireEvent.click(screen.getByRole("button", { name: /^Continue$/ }));
  fireEvent.click(await screen.findByRole("button", { name: /^Continue$/ }));
  fireEvent.click(await screen.findByRole("button", { name: /Record, invite & grant/i }));
}

describe("a grant is not finished until it has been delivered", () => {
  it("passes deliver_to — the argument whose absence emailed nobody", async () => {
    await runWizard();
    await waitFor(() => expect(grantAccess).toHaveBeenCalled());
    const [caseId, , options] = grantAccess.mock.calls[0];
    expect(caseId).toBe(CASE_ID);
    expect(options).toBeDefined();
    expect(options.deliver_to).toBe(CONTACT);
  });

  it("the link goes to the same address the portal invite did", async () => {
    await runWizard();
    await waitFor(() => expect(grantAccess).toHaveBeenCalled());
    // One person, one address: the Passport and the account it is read
    // alongside must not reach two different inboxes.
    expect(grantAccess.mock.calls[0][2].deliver_to).toBe(CONTACT);
  });

  it("the review screen states the Passport delivery BEFORE the click", async () => {
    renderWizard();
    fireEvent.change(await screen.findByLabelText(/Legal name/i), {
      target: { value: "Meridian Finance Group Pty Ltd" },
    });
    fireEvent.change(screen.getByLabelText(/Contact email/i), { target: { value: CONTACT } });
    fireEvent.change(screen.getByLabelText(/Contact name/i), { target: { value: "Dana Reyes" } });
    fireEvent.click(screen.getByRole("button", { name: /^Continue$/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Continue$/ }));
    expect(await screen.findByText(/Passport link:/i)).toBeInTheDocument();
  });
});

describe("the final screen leads with delivery, not with a bearer token", () => {
  it("says where the link went", async () => {
    await runWizard();
    expect((await screen.findAllByText(/has been emailed to/i)).length).toBeGreaterThan(0);
  });

  it("hands over the LINK as a real, copyable value", async () => {
    await runWizard();
    const field = await screen.findByLabelText(/Their Passport link/i);
    expect(field).toHaveValue("https://npc.example/passport/raw-token");
  });

  it("shows the raw bearer token NOWHERE — the link is the same credential", async () => {
    /* The token and the `/passport/<token>` link are one secret: the link is
       that token with a URL around it. The only consumer in this platform is
       the public page, which reads it back out of the URL. Showing it a
       second time doubled the places a live credential was copied and
       invited an operator to send "the code" instead of the link — a defect
       this product has already had once. */
    await runWizard();
    await screen.findByLabelText(/Their Passport link/i);
    expect(screen.queryByText(/access token/i)).toBeNull();
    expect(screen.queryByText(/system-to-system/i)).toBeNull();
    // The bare token must not appear anywhere on the screen, in any element.
    expect(document.body.textContent).not.toMatch(/(^|[^/])raw-token/);
  });

  it("a failed email says so, and the link is still the copy that survives", async () => {
    grantAccess.mockResolvedValue({
      grant: { id: "gr-1", expires_at: "2027-08-20T00:00:00.000Z", attestation_version: 3 },
      access_token: "raw-token",
      passport_link: "https://npc.example/passport/raw-token",
      delivered_to: CONTACT,
      link_email_sent: false,
      link_email_error: "The mail provider refused it.",
      note: "ok",
    });
    await runWizard();
    expect(await screen.findByText(/did not send/i)).toBeInTheDocument();
    expect(await screen.findByLabelText(/Their Passport link/i))
      .toHaveValue("https://npc.example/passport/raw-token");
  });
});

describe("the partner's own portal is enrolled on the way through", () => {
  it("maps a REAL portal identity, and never an email address", async () => {
    await runSolicitorWizard();
    await waitFor(() => expect(enrolPartnerPortalAccess).toHaveBeenCalled());
    const args = enrolPartnerPortalAccess.mock.calls[0][0];
    expect(args.portal_user_source).toBe("solicitor_portal_users");
    expect(args.portal_user_id).toBe("sol-user-1");
    expect(args.portal_user_id).not.toContain("@");
    /* Active immediately: the MLRO has already decided this partner may
       rely, and an `invited` state nothing ever promotes is one more silent
       lock-out of the page. */
    expect(args.status).toBe("active");
  });

  it("says the Passport is also in their portal — only when that is true", async () => {
    enrolPartnerPortalAccess.mockResolvedValue({
      membership: { id: "m1", status: "active", portal_type: "solicitor_conveyancer" },
      organisation_binding: { column: "solicitor_firm_id", portal_organisation_id: "firm-1", bound: "set" },
      surface_enabled: true, passport_view_enabled: true,
    });
    await runSolicitorWizard();
    await screen.findByLabelText(/Their Passport link/i);
    expect(await screen.findByText(/AML\/CTF Compliance/i)).toBeInTheDocument();
  });

  it("with the surface off, it says the emailed link is the only way", async () => {
    enrolPartnerPortalAccess.mockResolvedValue({
      membership: { id: "m1", status: "active", portal_type: "solicitor_conveyancer" },
      organisation_binding: { column: "solicitor_firm_id", portal_organisation_id: "firm-1", bound: "set" },
      surface_enabled: false, passport_view_enabled: false,
    });
    await runSolicitorWizard();
    await screen.findByLabelText(/Their Passport link/i);
    expect(await screen.findByText(/only way they reach this Passport today/i)).toBeInTheDocument();
  });

  it("a failed enrolment NEVER blocks the grant, and is reported", async () => {
    enrolPartnerPortalAccess.mockRejectedValue(new Error("that firm is not one this portal user belongs to"));
    await runSolicitorWizard();
    // The Passport still issued and still delivered.
    await waitFor(() => expect(grantAccess).toHaveBeenCalled());
    expect(await screen.findByLabelText(/Their Passport link/i)).toBeInTheDocument();
    expect(await screen.findByText(/could not be enrolled/i)).toBeInTheDocument();
  });

  it("a builder partner is neither provisioned nor enrolled — the portal moved", async () => {
    /* Phase 6/7 of the network extraction: /builder/* redirects to the
       Builders Network and the admin plane here is a frozen archive, so the
       wizard walks no doomed step — no organisation, user, membership or
       invite call, no enrolment — and SAYS so, while the grant and its
       emailed link are untouched. */
    await runWizard();
    await waitFor(() => expect(grantAccess).toHaveBeenCalled());
    expect(await screen.findByLabelText(/Their Passport link/i)).toBeInTheDocument();
    expect(enrolPartnerPortalAccess).not.toHaveBeenCalled();
    for (const op of ["upsert_organisation", "create_user", "upsert_membership"]) {
      expect(
        invokeSecureFunction.mock.calls.some(
          ([, payload]: [unknown, { operation?: string }]) => payload?.operation === op),
        op,
      ).toBe(false);
    }
    expect(
      invokeSecureFunction.mock.calls.some(([fn]: [string]) => fn === "builder-portal-invite"),
    ).toBe(false);
    expect(await screen.findByText(/No workspace portal invite was sent/i)).toBeInTheDocument();
    expect(await screen.findByText(/no in-portal compliance page for builder partners/i)).toBeInTheDocument();
  });
});
