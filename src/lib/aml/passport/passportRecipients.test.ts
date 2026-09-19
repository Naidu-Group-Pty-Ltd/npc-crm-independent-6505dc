import { describe, expect, it } from "vitest";

import {
  RECIPIENT_STATE_ORDER,
  passportRecipients,
  type RecipientAgreement,
  type RecipientGrant,
} from "./passportRecipients.pure";

/**
 * Distributing one client's Passport to several partners.
 *
 * The reported defect: "the existing portals do not seem to be receiving the
 * links, notifications or any communication through". The register said
 * every grant existed. Both were true — the grants were minted with no
 * `deliver_to`, so nothing was ever emailed. These tests pin the reading
 * that makes that visible instead of invisible, and the arithmetic that
 * decides which single act each partner is offered.
 */

const NOW = new Date("2026-08-28T00:00:00.000Z");
const at = (days: number) => new Date(NOW.getTime() + days * 864e5).toISOString();

function agreement(over: Partial<RecipientAgreement> = {}): RecipientAgreement {
  return {
    id: "ag-1",
    partner_org_name: "Meridian Finance Group",
    partner_org_type: "finance",
    status: "active",
    next_review_due: at(200),
    partner_org_id: "org-1",
    ...over,
  };
}

function grant(over: Partial<RecipientGrant> = {}): RecipientGrant {
  return {
    id: "gr-1",
    agreement_id: "ag-1",
    granted_at: at(-10),
    expires_at: at(80),
    revoked_at: null,
    revoke_reason: null,
    delivered_to_email: "ops@meridian.example",
    delivered_at: at(-10),
    ...over,
  };
}

const base = { hasAttestation: true, isMlro: true, now: NOW };

describe("holding a Passport and having been SENT one are different facts", () => {
  it("a live grant that was never emailed reads as undelivered, not as live", () => {
    const { rows, holding, undelivered } = passportRecipients({
      ...base,
      agreements: [agreement()],
      grants: [grant({ delivered_to_email: null, delivered_at: null })],
    });
    expect(rows[0].state).toBe("undelivered");
    expect(rows[0].detail).toMatch(/never emailed/i);
    // It is emphatically NOT counted as a partner holding the Passport.
    expect(holding).toBe(0);
    expect(undelivered).toBe(1);
  });

  it("the same grant, emailed, reads as held and names where it went", () => {
    const { rows, holding, undelivered } = passportRecipients({
      ...base, agreements: [agreement()], grants: [grant()],
    });
    expect(rows[0].state).toBe("holds");
    expect(rows[0].detail).toContain("ops@meridian.example");
    expect(holding).toBe(1);
    expect(undelivered).toBe(0);
  });

  it("an undelivered grant is offered a SEND, not a re-issue, in words", () => {
    const { rows } = passportRecipients({
      ...base,
      agreements: [agreement()],
      grants: [grant({ delivered_to_email: null })],
    });
    expect(rows[0].actionLabel).toBe("Send their link");
    // It still supersedes — the token behind the undelivered grant cannot be
    // read back, so the only way to give them a working link is a new one.
    expect(rows[0].reissueOf).toBe("gr-1");
  });
});

describe("a live link can never be re-read, so the act is a replacement", () => {
  it("a holder is offered a re-issue that says the old link stops working", () => {
    const { rows } = passportRecipients({
      ...base, agreements: [agreement()], grants: [grant()],
    });
    expect(rows[0].actionLabel).toBe("Re-issue and send");
    expect(rows[0].actionMeaning).toMatch(/stops working/i);
  });

  it("nothing in the reading ever offers to resend the same link", () => {
    const states = [
      grant(),
      grant({ delivered_to_email: null }),
      grant({ expires_at: at(-1) }),
      grant({ revoked_at: at(-1), revoke_reason: "partner terminated" }),
    ];
    for (const g of states) {
      const { rows } = passportRecipients({
        ...base, agreements: [agreement()], grants: [g],
      });
      expect(rows[0].actionMeaning, rows[0].state).not.toMatch(/same link|resend the link/i);
    }
  });
});

describe("a row is an ARRANGEMENT, never a person", () => {
  it("only ACTIVE arrangements are rows — a suspended one cannot be sent to", () => {
    const { rows } = passportRecipients({
      ...base,
      agreements: [
        agreement(),
        agreement({ id: "ag-2", partner_org_name: "Lapsed Legal", status: "suspended" }),
      ],
      grants: [],
    });
    expect(rows.map((r) => r.partnerName)).toEqual(["Meridian Finance Group"]);
  });

  it("several arrangements are several rows — multiple distribution is the norm", () => {
    const { rows, holding } = passportRecipients({
      ...base,
      agreements: [
        agreement(),
        agreement({ id: "ag-2", partner_org_name: "Ridgeline Builders", partner_org_type: "builder", partner_org_id: "org-2" }),
        agreement({ id: "ag-3", partner_org_name: "Ashgrove Conveyancing", partner_org_type: "solicitor_conveyancer", partner_org_id: "org-3" }),
      ],
      grants: [
        grant(),
        grant({ id: "gr-2", agreement_id: "ag-2", delivered_to_email: "site@ridgeline.example" }),
      ],
    });
    expect(rows).toHaveLength(3);
    expect(holding).toBe(2);
    // The one nobody has sent to is still a row, with an act on offer.
    const unsent = rows.find((r) => r.partnerName === "Ashgrove Conveyancing")!;
    expect(unsent.state).toBe("never");
    expect(unsent.actionLabel).toBe("Send the Passport");
  });

  it("a grant superseded by a re-issue is history, never a standing", () => {
    const { rows } = passportRecipients({
      ...base,
      agreements: [agreement()],
      grants: [
        grant({ id: "gr-old", granted_at: at(-30), revoked_at: at(-10), revoke_reason: "superseded_by_reissue" }),
        grant({ id: "gr-new", granted_at: at(-10) }),
      ],
    });
    expect(rows[0].state).toBe("holds");
    expect(rows[0].reissueOf).toBe("gr-new");
  });
});

describe("standings that are not 'live'", () => {
  it("an expiry inside the warning window says so before it lapses", () => {
    const { rows, holding } = passportRecipients({
      ...base, agreements: [agreement()], grants: [grant({ expires_at: at(5) })],
    });
    expect(rows[0].state).toBe("expiring");
    // Still live — an expiring Passport is one the partner can still open.
    expect(holding).toBe(1);
  });

  it("a lapsed link is not counted as held", () => {
    const { rows, holding } = passportRecipients({
      ...base, agreements: [agreement()], grants: [grant({ expires_at: at(-1) })],
    });
    expect(rows[0].state).toBe("lapsed");
    expect(rows[0].reissueOf).toBeNull();
    expect(holding).toBe(0);
  });

  it("a withdrawal reads as withdrawn and sending is a fresh decision", () => {
    const { rows } = passportRecipients({
      ...base,
      agreements: [agreement()],
      grants: [grant({ revoked_at: at(-2), revoke_reason: "partner terminated" })],
    });
    expect(rows[0].state).toBe("revoked");
    expect(rows[0].detail).toMatch(/withdrawn/i);
    // A revoked grant is never superseded — a new one is minted outright.
    expect(rows[0].reissueOf).toBeNull();
  });
});

describe("what stops a send is named before the click", () => {
  it("a non-MLRO is told who can do it rather than shown a dead button", () => {
    const { rows } = passportRecipients({
      ...base, isMlro: false, agreements: [agreement()], grants: [],
    });
    expect(rows[0].blockedBy).toMatch(/MLRO/);
  });

  it("no attestation blocks every row, because there is nothing to send", () => {
    const { rows } = passportRecipients({
      ...base, hasAttestation: false, agreements: [agreement()], grants: [],
    });
    expect(rows[0].blockedBy).toMatch(/attestation/i);
  });

  it("an overdue arrangement review blocks only ITS row", () => {
    const { rows } = passportRecipients({
      ...base,
      agreements: [
        agreement({ next_review_due: at(-1) }),
        agreement({ id: "ag-2", partner_org_name: "Ridgeline Builders", partner_org_id: "org-2" }),
      ],
      grants: [],
    });
    const overdue = rows.find((r) => r.partnerName === "Meridian Finance Group")!;
    const fine = rows.find((r) => r.partnerName === "Ridgeline Builders")!;
    expect(overdue.blockedBy).toMatch(/review is overdue/i);
    expect(fine.blockedBy).toBeNull();
  });
});

describe("the address the send box opens with", () => {
  it("is the one the link last went to", () => {
    const { rows } = passportRecipients({
      ...base, agreements: [agreement()], grants: [grant()],
    });
    expect(rows[0].suggestedEmail).toBe("ops@meridian.example");
  });

  it("falls back to the address that ACCEPTED the agreement", () => {
    const { rows } = passportRecipients({
      ...base,
      agreements: [agreement()],
      grants: [],
      acknowledgements: [
        { partner_org_id: "org-1", recipient_email: "principal@meridian.example", status: "accepted" },
      ],
    });
    expect(rows[0].suggestedEmail).toBe("principal@meridian.example");
  });

  it("is null rather than a guess when no address was ever recorded", () => {
    const { rows } = passportRecipients({
      ...base, agreements: [agreement({ partner_org_id: null })], grants: [],
    });
    expect(rows[0].suggestedEmail).toBeNull();
  });

  it("never borrows another organisation's address", () => {
    const { rows } = passportRecipients({
      ...base,
      agreements: [agreement()],
      grants: [],
      acknowledgements: [
        { partner_org_id: "org-2", recipient_email: "someone@elsewhere.example", status: "accepted" },
      ],
    });
    expect(rows[0].suggestedEmail).toBeNull();
  });
});

describe("what the panel header says", () => {
  it("names the undelivered grants, because that is the reported symptom", () => {
    const { headline } = passportRecipients({
      ...base,
      agreements: [agreement()],
      grants: [grant({ delivered_to_email: null })],
    });
    expect(headline).toMatch(/never emailed/i);
  });

  it("is a count and never a compliance verdict", () => {
    const { headline } = passportRecipients({
      ...base, agreements: [agreement()], grants: [grant()],
    });
    for (const forbidden of [/\bclear\b/i, /\bcompliant\b/i, /\bverified\b/i, /\bsatisfied\b/i]) {
      expect(headline).not.toMatch(forbidden);
    }
  });

  it("says plainly that nothing has an arrangement when nothing does", () => {
    const { headline, rows } = passportRecipients({ ...base, agreements: [], grants: [] });
    expect(rows).toHaveLength(0);
    expect(headline).toMatch(/no partner has a written arrangement/i);
  });
});

describe("ordering puts what needs doing first", () => {
  it("an undelivered grant outranks a healthy one whatever the names are", () => {
    const { rows } = passportRecipients({
      ...base,
      agreements: [
        agreement({ id: "ag-a", partner_org_name: "Aardvark Finance", partner_org_id: "org-a" }),
        agreement({ id: "ag-z", partner_org_name: "Zenith Builders", partner_org_id: "org-z" }),
      ],
      grants: [
        grant({ id: "g-a", agreement_id: "ag-a" }),
        grant({ id: "g-z", agreement_id: "ag-z", delivered_to_email: null }),
      ],
    });
    expect(rows.map((r) => r.partnerName)).toEqual(["Zenith Builders", "Aardvark Finance"]);
  });

  it("every state has a place in the order — none can sort to the end by accident", () => {
    const states = new Set(RECIPIENT_STATE_ORDER);
    expect(states.size).toBe(RECIPIENT_STATE_ORDER.length);
    for (const s of ["undelivered", "never", "lapsed", "expiring", "revoked", "holds"]) {
      expect(states.has(s as never)).toBe(true);
    }
  });
});
