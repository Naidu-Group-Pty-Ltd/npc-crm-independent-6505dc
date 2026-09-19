import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  newlyAccepted, readHandover, shouldWatchForAcceptance,
  type HandoverAcknowledgement,
} from "./passportHandover.pure";
import { passportActions } from "./passportActions.pure";

/**
 * The handover — from "the partner accepted" to "the partner has the Passport".
 *
 * The reported symptom: a partner outside the portals accepted the agreement,
 * their own page said so, and the Command Centre showed a row still reading
 * `viewed` with nothing anywhere about what to do next. Everything the
 * acceptance unlocked was true in the database and invisible on the screen.
 */

const NOW = new Date("2026-08-28T06:00:00.000Z");

function ack(over: Partial<HandoverAcknowledgement> = {}): HandoverAcknowledgement {
  return {
    id: "ack-1",
    status: "accepted",
    partner_org_id: "org-1",
    recipient_name: "Jordan Lee",
    recipient_email: "jordan@harbourlegal.example",
    accepted_at: "2026-08-28T02:02:52.000Z",
    accepted_by_name: "Jordan Lee",
    agreement_id: "agr-1",
    partner_organisations: { legal_name: "Harbour Legal" },
    ...over,
  };
}

const agreement = { id: "agr-1", partner_org_name: "Harbour Legal", status: "active" };
const liveGrant = { agreement_id: "agr-1", expires_at: "2026-11-26T00:00:00.000Z", revoked_at: null };

const base = {
  agreements: [agreement], grants: [], hasAttestation: true, isMlro: true, now: NOW,
};

describe("an acceptance names the act it unlocked", () => {
  it("reads as ready to issue, with the partner named", () => {
    const reading = readHandover({ ...base, acknowledgements: [ack()] });

    expect(reading.state).toBe("ready_to_issue");
    expect(reading.headline).toContain("Harbour Legal");
    expect(reading.headline).toContain("has not been issued");
    expect(reading.awaitingIssue).toHaveLength(1);
    expect(reading.awaitingIssue[0].recipientEmail).toBe("jordan@harbourlegal.example");
    expect(reading.awaitingIssue[0].agreementId).toBe("agr-1");
    expect(reading.blockedBy).toBeNull();
  });

  it("an acceptance is NEVER reported as the partner holding anything", () => {
    // The partner has agreed to the terms on which a Passport may be shared.
    // Nothing has been shared. Collapsing the two is how "they accepted"
    // comes to read as "they have it".
    const reading = readHandover({ ...base, acknowledgements: [ack()] });
    expect(reading.state).not.toBe("issued");
    expect(reading.issued).toHaveLength(0);
    expect(reading.headline).not.toMatch(/holds/i);
  });

  it("goes quiet once a live Passport exists", () => {
    const reading = readHandover({ ...base, acknowledgements: [ack()], grants: [liveGrant] });

    expect(reading.state).toBe("issued");
    expect(reading.awaitingIssue).toHaveLength(0);
    expect(reading.issued[0].partnerName).toBe("Harbour Legal");
  });

  it.each([
    ["revoked", { ...liveGrant, revoked_at: "2026-08-28T05:00:00.000Z" }],
    ["expired", { ...liveGrant, expires_at: "2026-08-01T00:00:00.000Z" }],
  ])("a %s grant leaves the partner owed a Passport, not ticked off", (_label, grant) => {
    // The dangerous reading is the reassuring one: an accepted agreement plus
    // a dead link is exactly the state that needs naming.
    const reading = readHandover({ ...base, acknowledgements: [ack()], grants: [grant] });
    expect(reading.state).toBe("ready_to_issue");
    expect(reading.awaitingIssue).toHaveLength(1);
  });
});

describe("what is owed, and by whom", () => {
  it("names the MLRO when the operator cannot issue", () => {
    const reading = readHandover({ ...base, acknowledgements: [ack()], isMlro: false });
    expect(reading.state).toBe("blocked");
    expect(reading.blockedBy).toBe("Requires the MLRO");
    // The arrangement still stands — only the issue is held up.
    expect(reading.detail).toContain("stands");
  });

  it("names the attestation when there is no record to share", () => {
    const reading = readHandover({ ...base, acknowledgements: [ack()], hasAttestation: false });
    expect(reading.state).toBe("blocked");
    expect(reading.blockedBy).toContain("Issue the attestation first");
  });

  it("names a re-send when the acceptance recorded no arrangement", () => {
    const reading = readHandover({
      ...base, acknowledgements: [ack({ agreement_id: null })],
    });
    expect(reading.blockedBy).toContain("re-send the agreement");
  });
});

describe("before anything has been accepted", () => {
  it("says nothing is owed while a request is out", () => {
    const reading = readHandover({ ...base, acknowledgements: [ack({ status: "viewed" })] });
    expect(reading.state).toBe("awaiting");
    expect(reading.awaitingIssue).toHaveLength(0);
    // The page updates itself — the operator should not be reloading it.
    expect(reading.detail).toMatch(/do not need to reload/i);
  });

  it("distinguishes an empty case from a waiting one", () => {
    expect(readHandover({ ...base, acknowledgements: [] }).state).toBe("none");
    expect(readHandover({ ...base, acknowledgements: [ack({ status: "declined" })] }).state)
      .toBe("none");
  });
});

describe("the live indicator only speaks when something changed", () => {
  it("says nothing on the first reading after mount", () => {
    // Otherwise every page load announces an acceptance from last Tuesday,
    // which is how an operator learns to dismiss these unread.
    expect(newlyAccepted(null, [ack()])).toHaveLength(0);
  });

  it("announces an acceptance that arrived while the page was open", () => {
    const arrivals = newlyAccepted([ack({ status: "viewed" })], [ack()]);
    expect(arrivals).toHaveLength(1);
    expect(arrivals[0].partnerName).toBe("Harbour Legal");
    expect(arrivals[0].acceptedByName).toBe("Jordan Lee");
  });

  it("does not re-announce one it has already reported", () => {
    expect(newlyAccepted([ack()], [ack()])).toHaveLength(0);
  });
});

describe("watching costs a request, so it is bounded", () => {
  it("watches only while something is out with a partner", () => {
    expect(shouldWatchForAcceptance([{ status: "sent" }])).toBe(true);
    expect(shouldWatchForAcceptance([{ status: "viewed" }])).toBe(true);
  });

  it("stops once every request is settled", () => {
    expect(shouldWatchForAcceptance([])).toBe(false);
    expect(shouldWatchForAcceptance([{ status: "accepted" }, { status: "declined" }])).toBe(false);
    expect(shouldWatchForAcceptance([{ status: "superseded" }, { status: "expired" }])).toBe(false);
  });
});

describe("the action list reflects the acceptance", () => {
  const facts = {
    attestationVersion: 1, issuedAt: "2026-08-27T00:00:00.000Z",
    passportStateCode: "current", activeAgreements: 1, activeGrants: 0, isMlro: true,
  };

  it("the grant row names who is waiting instead of reading as empty", () => {
    const grant = passportActions({
      ...facts, awaitingPassportIssue: 1, awaitingPassportName: "Harbour Legal",
    }).find((r) => r.key === "grant")!;

    expect(grant.detail).toContain("Harbour Legal accepted the agreement");
    expect(grant.detail).toContain("no Passport yet");
    expect(grant.detail).not.toContain("No partner has access yet");
  });

  it("is unchanged when nobody is waiting", () => {
    const grant = passportActions(facts).find((r) => r.key === "grant")!;
    expect(grant.detail).toContain("No partner has access yet");
  });
});

describe("the workspace and the partner's page both say what happens next", () => {
  const section = readFileSync("src/components/aml/ReliancePassportSection.tsx", "utf8");
  const page = readFileSync("src/pages/PartnerAcknowledgement.tsx", "utf8");

  it("the workspace polls only while it is watching, and never when hidden", () => {
    expect(section).toContain("shouldWatchForAcceptance(acknowledgements)");
    expect(section).toContain('document.visibilityState === "visible"');
    expect(section).toContain("if (watching)");
  });

  it("the workspace offers the act on the row that reports the acceptance", () => {
    /* Still true, and now truer: the acceptance and the act are on the SAME
       row rather than in two lists that had to be read together. The roster
       derives "they accepted; the Passport has not been issued" as that
       partner's one next step, and the button is on it. */
    const roster = readFileSync("src/lib/aml/passport/partnerRoster.pure.ts", "utf8");
    expect(roster).toContain('kind: "issue_passport"');
    expect(roster).toContain('ack?.status === "accepted"');
    expect(section).toContain("PartnerRosterPanel");
    expect(section).toContain("onSend: sendFromRoster");
    // The handover banner still names the act while an acceptance is fresh.
    expect(section).toContain("Issue the Passport");
  });

  it("issuing emails the address the partner accepted from", () => {
    // Retyping the partner's name into a field that must match an agreement
    // exactly is how a completed acceptance ends up sitting there unissued.
    expect(section).toContain("deliver_to: partner.recipientEmail");
  });

  it("the partner is told what arrives, where, and for how long", () => {
    expect(page).toContain("Sent to");
    expect(page).toContain("{view.recipient_email}");
    expect(page).toContain("90 days, re-issuable");
    // And that their own independent CDD is always available to them.
    expect(page).toMatch(/independent\s*\n?\s*customer due diligence remains available/);
  });
});

describe("a notification producer can report its own failure", () => {
  const fn = readFileSync("supabase/functions/aml-reliance/index.ts", "utf8");

  it("reads the PostgREST error rather than trusting the try/catch", () => {
    // A PostgREST failure is RETURNED, not thrown; the catch only ever saw a
    // network fault. That is the failure mode notificationsContract.test.ts
    // was written for.
    const helper = fn.slice(fn.indexOf("async function notifyCommandCentre"));
    expect(helper.slice(0, 1800)).toContain("const { error } = await admin.from(\"notifications\")");
    expect(helper.slice(0, 1800)).toContain("notification insert rejected");
  });
});
