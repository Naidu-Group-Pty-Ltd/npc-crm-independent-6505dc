import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The passport panel, RENDERED, around the moment a partner accepts.
 *
 * The reported defect was not that a rule was wrong — every fact was right in
 * the database. It was that the screen did not move: the panel fetched once at
 * mount, so an operator waiting on an acceptance (which is precisely what an
 * operator with this case open is doing) kept reading "the partner has opened
 * the agreement but not yet accepted it" while the arrangement, the register
 * and the audit trail all said otherwise.
 *
 * A test that reads the source cannot see that. So this one mounts the panel,
 * answers the second poll differently from the first, and asserts the screen
 * changed — and that the act the acceptance unlocked is now on it.
 */

const listAttestations = vi.fn();
const listGrants = vi.fn();
const listAssessments = vi.fn();
const listAgreements = vi.fn();
const listPartnerCaseLinks = vi.fn();
const listPartnerOrganisations = vi.fn();
const staffListPartnerRecordsRequests = vi.fn();
const listPartnerAcknowledgements = vi.fn();
const getPassportDistributionStatus = vi.fn();
const getPartnerEventsHealth = vi.fn();
const grantAccess = vi.fn();

vi.mock("@/lib/aml/amlRelianceApi", () => ({
  amlRelianceApi: {
    listAttestations: (...a: unknown[]) => listAttestations(...a),
    listGrants: (...a: unknown[]) => listGrants(...a),
    listAssessments: (...a: unknown[]) => listAssessments(...a),
    listAgreements: (...a: unknown[]) => listAgreements(...a),
    listPartnerCaseLinks: (...a: unknown[]) => listPartnerCaseLinks(...a),
    listPartnerOrganisations: (...a: unknown[]) => listPartnerOrganisations(...a),
    staffListPartnerRecordsRequests: (...a: unknown[]) => staffListPartnerRecordsRequests(...a),
    listPartnerAcknowledgements: (...a: unknown[]) => listPartnerAcknowledgements(...a),
    getPassportDistributionStatus: (...a: unknown[]) => getPassportDistributionStatus(...a),
    getPartnerEventsHealth: (...a: unknown[]) => getPartnerEventsHealth(...a),
    grantAccess: (...a: unknown[]) => grantAccess(...a),
  },
}));

const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (...a: unknown[]) => toast(...a) }));

vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));

// The token prompt is a dialog; the panel's behaviour, not the dialog, is
// what is under test here.
const prompt = vi.fn().mockResolvedValue({});
vi.mock("@/components/aml/usePromptDialog", () => ({
  usePromptDialog: () => ({ prompt: (...a: unknown[]) => prompt(...a), dialog: null }),
}));

vi.mock("@/components/aml/PartnerOnboardingWizard", () => ({
  PartnerOnboardingWizard: () => null,
}));

import { ReliancePassportSection } from "../ReliancePassportSection";

const CASE_ID = "8b668f2f-0132-436f-b32c-d6709ea69526";
const AGREEMENT_ID = "5b83cb1e-6676-4457-9b48-3e5fcc7a92a6";

const acknowledgement = (over: Record<string, unknown> = {}) => ({
  id: "ack-1",
  case_id: CASE_ID,
  partner_org_id: "org-1",
  recipient_name: "Rugesh Naidu",
  recipient_email: "partner@example.com",
  status: "viewed",
  sent_at: "2026-08-28T00:58:50.000Z",
  resend_count: 1,
  viewed_at: "2026-08-28T01:00:00.000Z",
  accepted_at: null,
  declined_at: null,
  decline_reason: null,
  expires_at: "2026-09-11T00:58:50.000Z",
  agreement_id: null,
  accepted_by_name: null,
  partner_organisations: { legal_name: "Testing Pty Ltd" },
  ...over,
});

const accepted = acknowledgement({
  status: "accepted",
  accepted_at: "2026-08-28T02:02:52.000Z",
  accepted_by_name: "Rugesh Naidu",
  agreement_id: AGREEMENT_ID,
});

beforeEach(() => {
  vi.clearAllMocks();
  listAttestations.mockResolvedValue({
    attestations: [{
      id: "att-1", version: 1, issued_at: "2026-08-27T08:28:28.000Z",
      payload_sha256: "28099ae9048b1397aaaa", superseded_at: null,
    }],
  });
  listGrants.mockResolvedValue({ grants: [] });
  listAssessments.mockResolvedValue({ assessments: [] });
  listAgreements.mockResolvedValue({
    agreements: [{
      id: AGREEMENT_ID, partner_org_name: "Testing Pty Ltd", partner_org_type: "other",
      partner_abn: null, agreement_reference: "ref", executed_on: "2026-08-28",
      next_review_due: "2027-08-28", last_reviewed_at: null, scope: ["customer_identification"],
      status: "active", notes: null, created_at: "2026-08-28T02:02:52.000Z",
    }],
  });
  listPartnerCaseLinks.mockResolvedValue({ links: [] });
  listPartnerOrganisations.mockResolvedValue({ partner_organisations: [] });
  staffListPartnerRecordsRequests.mockResolvedValue({ requests: [] });
  getPassportDistributionStatus.mockResolvedValue({ passport: { state: { code: "current" } } });
  getPartnerEventsHealth.mockResolvedValue({ health: { outbox_enabled: false } });
});

afterEach(() => { vi.useRealTimers(); });

describe("the acceptance reaches the screen without a reload", () => {
  it("moves from waiting to ready-to-issue on the next poll", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    listPartnerAcknowledgements
      .mockResolvedValueOnce({ acknowledgements: [acknowledgement()] })
      .mockResolvedValue({ acknowledgements: [accepted] });

    render(<ReliancePassportSection caseId={CASE_ID} isMlro />);

    expect(await screen.findByText(/Waiting on the partner to accept/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Issue the Passport/i })).not.toBeInTheDocument();

    // The partner accepts from their email; nobody touches this tab.
    await vi.advanceTimersByTimeAsync(31_000);

    await waitFor(() =>
      expect(screen.getByText(/accepted the agreement — the Passport has not been issued/i))
        .toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: /Issue the Passport/i }).length).toBeGreaterThan(0);
  });

  it("announces the acceptance, because the operator may be looking elsewhere", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    listPartnerAcknowledgements
      .mockResolvedValueOnce({ acknowledgements: [acknowledgement()] })
      .mockResolvedValue({ acknowledgements: [accepted] });

    render(<ReliancePassportSection caseId={CASE_ID} isMlro />);
    await screen.findByText(/Waiting on the partner to accept/i);
    await vi.advanceTimersByTimeAsync(31_000);

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringContaining("Testing Pty Ltd accepted the compliance agreement"),
    })));
  });

  it("says nothing on the first reading of an acceptance that already happened", async () => {
    listPartnerAcknowledgements.mockResolvedValue({ acknowledgements: [accepted] });

    render(<ReliancePassportSection caseId={CASE_ID} isMlro />);
    await screen.findByText(/accepted the agreement — the Passport has not been issued/i);

    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringContaining("accepted the compliance agreement"),
    }));
  });
});

describe("the act the acceptance unlocked", () => {
  it("issues against the accepted arrangement and emails the address they signed from", async () => {
    listPartnerAcknowledgements.mockResolvedValue({ acknowledgements: [accepted] });
    grantAccess.mockResolvedValue({
      grant: { id: "grant-1", expires_at: "2026-11-26T00:00:00.000Z" },
      access_token: "one-time-token",
      passport_link: "https://command-centre.example/passport/one-time-token",
      delivered_to: "partner@example.com",
      link_email_sent: true,
      link_email_error: null,
      note: "note",
    });

    render(<ReliancePassportSection caseId={CASE_ID} isMlro />);
    const buttons = await screen.findAllByRole("button", { name: /Issue the Passport/i });
    fireEvent.click(buttons[0]);

    await waitFor(() => expect(grantAccess).toHaveBeenCalledWith(
      CASE_ID, AGREEMENT_ID, { deliver_to: "partner@example.com" },
    ));

    // The credential exists in this moment and never again — it is stored
    // hashed — so it must be present as a VALUE that can be selected and
    // copied. It used to be passed as a field placeholder, which is not a
    // value: the box read as empty and could not be copied at all.
    const field = await screen.findByLabelText(/One-time Passport link/i);
    expect(field).toHaveValue("https://command-centre.example/passport/one-time-token");
    expect(field).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: /^Copy$/i })).toBeInTheDocument();
    expect(screen.getByText(/Emailed to/i)).toBeInTheDocument();
  });

  it("says the email did not send rather than reporting a delivery that failed", async () => {
    listPartnerAcknowledgements.mockResolvedValue({ acknowledgements: [accepted] });
    grantAccess.mockResolvedValue({
      grant: { id: "grant-1", expires_at: "2026-11-26T00:00:00.000Z" },
      access_token: "one-time-token",
      passport_link: "https://command-centre.example/passport/one-time-token",
      delivered_to: "partner@example.com",
      link_email_sent: false,
      link_email_error: "RESEND_API_KEY not configured",
      note: "note",
    });

    render(<ReliancePassportSection caseId={CASE_ID} isMlro />);
    const buttons = await screen.findAllByRole("button", { name: /Issue the Passport/i });
    fireEvent.click(buttons[0]);

    // The credential is shown once. Claiming it was emailed when it was not
    // leaves the operator waiting on a message that is never coming, holding
    // the only copy behind a button they have already dismissed.
    expect(await screen.findByText(/did not send/i)).toBeInTheDocument();
    expect(await screen.findByLabelText(/One-time Passport link/i))
      .toHaveValue("https://command-centre.example/passport/one-time-token");
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      variant: "destructive",
    })));
  });

  it("shows who signed and when, not just that something was acknowledged", async () => {
    listPartnerAcknowledgements.mockResolvedValue({ acknowledgements: [accepted] });

    render(<ReliancePassportSection caseId={CASE_ID} isMlro />);
    // The banner names them and the row records the signature; both are
    // deliberate, so this asserts the row's own wording.
    const signed = await screen.findAllByText(/Accepted by Rugesh Naidu on/i);
    expect(signed.length).toBeGreaterThan(0);
  });

  it("offers no issue button to somebody who is not the MLRO", async () => {
    listPartnerAcknowledgements.mockResolvedValue({ acknowledgements: [accepted] });

    render(<ReliancePassportSection caseId={CASE_ID} isMlro={false} />);
    await screen.findAllByText(/accepted the agreement/i);

    expect(screen.queryByRole("button", { name: /Issue the Passport/i })).not.toBeInTheDocument();
    expect(screen.getAllByText(/Requires the MLRO/i).length).toBeGreaterThan(0);
  });

  it("stops saying anything is owed once a live Passport exists", async () => {
    listPartnerAcknowledgements.mockResolvedValue({ acknowledgements: [accepted] });
    listGrants.mockResolvedValue({
      grants: [{
        id: "grant-1", agreement_id: AGREEMENT_ID, attestation_id: "att-1",
        granted_at: "2026-08-28T03:00:00.000Z",
        expires_at: new Date(Date.now() + 60 * 864e5).toISOString(),
        revoked_at: null, revoke_reason: null,
        /* A LIVE Passport is one that was actually emailed. The fixture used
           to omit this and still be called live, which is precisely the
           distinction this product got wrong in production: a grant nobody
           was sent is access with no channel. */
        delivered_to_email: "partner@example.com",
        delivered_at: "2026-08-28T03:00:01.000Z",
      }],
    });

    render(<ReliancePassportSection caseId={CASE_ID} isMlro />);
    /* The property is that the workspace stops ASKING for something already
       done. It used to say so in a banner that repeated the recipients row
       directly beneath it — same partner, same standing, twice — so the
       banner is gone and the row is where a live Passport is reported. */
    const panel = await screen.findByRole("region", { name: /partners on this matter/i });
    expect(panel).toHaveTextContent(/Testing Pty Ltd/);
    // Settled: the roster reports it and offers no act at all.
    expect(panel).toHaveTextContent(/Nothing owed/i);
    expect(panel).toHaveTextContent(/They hold a live Passport/i);
    expect(screen.queryByRole("button", { name: /Issue the Passport/i })).not.toBeInTheDocument();
    // And the acceptance banner does not re-announce it.
    expect(screen.queryByText(/holds a live Compliance Passport/i)).toBeNull();
  });
});
