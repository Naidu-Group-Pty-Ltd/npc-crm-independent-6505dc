import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  humanPartnerType, humanRoute, partnerRoster,
  type RosterAgreement, type RosterFacts, type RosterGrant, type RosterLink,
} from "./partnerRoster.pure";

/**
 * One partner, one row, one next step.
 *
 * The reported eyesore: the same three organisations listed four times, in
 * four vocabularies, drawing eleven amber badges between them — and not one
 * of them saying what to do. These pin the arithmetic that replaced it.
 */

const NOW = new Date("2026-08-28T00:00:00.000Z");
const at = (days: number) => new Date(NOW.getTime() + days * 864e5).toISOString();

const agreement = (over: Partial<RosterAgreement> = {}): RosterAgreement => ({
  id: "ag-1",
  partner_org_id: "org-1",
  partner_org_name: "Ridgeline Builders Pty Ltd",
  partner_org_type: "builder",
  status: "active",
  next_review_due: at(200),
  eligibility_classification: "eligible_reporting_entity",
  current_assessment_id: "as-1",
  ...over,
});

const link = (over: Partial<RosterLink> = {}): RosterLink => ({
  id: "L1", partner_org_id: "org-1", relationship_role: "builder_developer",
  legal_route: "reliance", state: "active", portal_type: "builder",
  partner_organisations: { legal_name: "Ridgeline Builders Pty Ltd", classification_status: "classified" },
  ...over,
});

const grant = (over: Partial<RosterGrant> = {}): RosterGrant => ({
  id: "gr-1", agreement_id: "ag-1", granted_at: at(-10), expires_at: at(80),
  revoked_at: null, revoke_reason: null, delivered_to_email: "site@ridgeline.example",
  ...over,
});

const facts = (over: Partial<RosterFacts> = {}): RosterFacts => ({
  agreements: [agreement()],
  links: [link()],
  acknowledgements: [],
  grants: [],
  hasAttestation: true,
  isMlro: true,
  now: NOW,
  ...over,
});

describe("one row per partner, however many records they have", () => {
  it("a partner with an arrangement, two links and a grant is ONE row", () => {
    const { rows } = partnerRoster(facts({
      links: [link(), link({ id: "L2", relationship_role: "developer" })],
      grants: [grant()],
    }));
    expect(rows).toHaveLength(1);
    expect(rows[0].linkIds).toEqual(["L1", "L2"]);
  });

  it("a terminated arrangement is not a row at all", () => {
    const { rows } = partnerRoster(facts({
      agreements: [agreement({ status: "terminated" })],
    }));
    expect(rows).toHaveLength(0);
  });
});

describe("database vocabulary never reaches the operator", () => {
  it("translates the role and the legal route", () => {
    const { rows } = partnerRoster(facts({ grants: [grant()] }));
    expect(rows[0].partnerTypeLabel).toBe("Builder / developer");
    expect(rows[0].routeLabel).toBe("Reliance (Pt 2 Div 7)");
  });

  it("an unmapped value degrades to readable words rather than a raw column", () => {
    expect(humanPartnerType("some_new_kind")).toBe("Some new kind");
    expect(humanRoute("some_new_route")).toBe("some new route");
    expect(humanPartnerType(null)).toBe("Partner");
    expect(humanRoute(null)).toBeNull();
  });

  it("no row ever carries an underscore-cased identifier", () => {
    const { rows } = partnerRoster(facts({ grants: [grant()] }));
    const rendered = [
      rows[0].partnerTypeLabel, rows[0].routeLabel, rows[0].step.label,
      rows[0].step.detail, ...rows[0].flags.map((f) => f.label),
    ].join(" ");
    expect(rendered).not.toMatch(/[a-z]_[a-z]/);
  });
});

describe("a badge means something is unmet — never that a record is healthy", () => {
  it("a complete, active, classified partner has NO flags", () => {
    /* `active`, `reliance` and the organisation type are how a correct
       record looks. Rendering them as warning chips beside genuine problems
       is what made eleven badges unreadable. */
    const { rows } = partnerRoster(facts({ grants: [grant()] }));
    expect(rows[0].flags).toEqual([]);
  });

  it("an overdue review is BLOCKING and says what it stops", () => {
    const { rows } = partnerRoster(facts({
      agreements: [agreement({ next_review_due: at(-1) })], grants: [grant()],
    }));
    const flag = rows[0].flags.find((f) => f.code === "review")!;
    expect(flag.severity).toBe("blocking");
    expect(flag.consequence).toMatch(/blocks sending/i);
  });

  it("an unrecorded eligibility is a RECORD, and says it stops nothing today", () => {
    const { rows } = partnerRoster(facts({
      agreements: [agreement({ eligibility_classification: "unassessed" })], grants: [grant()],
    }));
    const flag = rows[0].flags.find((f) => f.code === "eligibility")!;
    expect(flag.severity).toBe("record");
    expect(flag.consequence).toMatch(/does not stop sending/i);
    // And it is not treated as a finding about the partner.
    expect(flag.label).not.toMatch(/ineligible|fail|refus/i);
  });

  it("a missing classification is a record, not a blocker", () => {
    const { rows } = partnerRoster(facts({
      links: [link({ partner_organisations: { classification_status: "unclassified" } })],
      grants: [grant()],
    }));
    expect(rows[0].flags.find((f) => f.code === "classification")!.severity).toBe("record");
    expect(rows[0].step.actionable).toBe(false);
    expect(rows[0].step.kind).toBe("settled");
  });
});

describe("exactly one next step, and it is the one that matters", () => {
  it("nothing sent → send it", () => {
    const { rows } = partnerRoster(facts());
    expect(rows[0].step.kind).toBe("send_passport");
    expect(rows[0].step.actionable).toBe(true);
  });

  it("a grant nobody emailed outranks everything else", () => {
    const { rows } = partnerRoster(facts({
      grants: [grant({ delivered_to_email: null })],
    }));
    expect(rows[0].step.kind).toBe("deliver_link");
    expect(rows[0].step.detail).toMatch(/never emailed/i);
  });

  it("an accepted agreement with no Passport names the acceptance", () => {
    const { rows } = partnerRoster(facts({
      acknowledgements: [{
        id: "ack-1", partner_org_id: "org-1", recipient_name: "Dana",
        recipient_email: "dana@ridgeline.example", status: "accepted",
        accepted_at: at(-2), accepted_by_name: "Dana Reyes", expires_at: at(10),
      }],
    }));
    expect(rows[0].step.kind).toBe("issue_passport");
    expect(rows[0].step.detail).toMatch(/They accepted on/);
  });

  it("an agreement out and unaccepted is WAITING, with no button", () => {
    const { rows } = partnerRoster(facts({
      acknowledgements: [{
        id: "ack-1", partner_org_id: "org-1", recipient_name: "Dana",
        recipient_email: "dana@ridgeline.example", status: "viewed",
        expires_at: at(10),
      }],
    }));
    expect(rows[0].step.kind).toBe("awaiting_partner");
    expect(rows[0].step.waiting).toBe(true);
    expect(rows[0].step.actionable).toBe(false);
  });

  it("no attestation blocks every row, and says why", () => {
    const { rows } = partnerRoster(facts({ hasAttestation: false }));
    expect(rows[0].step.kind).toBe("blocked_no_attestation");
    expect(rows[0].step.actionable).toBe(false);
  });

  it("an overdue review blocks only ITS row", () => {
    const { rows } = partnerRoster(facts({
      agreements: [
        agreement({ next_review_due: at(-1) }),
        agreement({ id: "ag-2", partner_org_id: "org-2", partner_org_name: "Meridian Finance" }),
      ],
      links: [link(), link({ id: "L2", partner_org_id: "org-2" })],
    }));
    const overdue = rows.find((r) => r.partnerName === "Ridgeline Builders Pty Ltd")!;
    const fine = rows.find((r) => r.partnerName === "Meridian Finance")!;
    expect(overdue.step.kind).toBe("blocked_review");
    expect(fine.step.actionable).toBe(true);
  });

  it("an analyst is told who can act, once, rather than shown dead buttons", () => {
    const { rows, actionable } = partnerRoster(facts({ isMlro: false }));
    expect(rows[0].step.kind).toBe("blocked_role");
    expect(rows[0].step.actionable).toBe(false);
    expect(actionable).toHaveLength(0);
  });

  it("a live, delivered Passport is SETTLED — nothing owed", () => {
    const { rows } = partnerRoster(facts({ grants: [grant()] }));
    expect(rows[0].step.kind).toBe("settled");
    expect(rows[0].step.actionable).toBe(false);
  });
});

describe("the list orders itself by what needs doing", () => {
  it("actionable first, then waiting, then settled", () => {
    const { rows } = partnerRoster(facts({
      agreements: [
        agreement({ id: "ag-settled", partner_org_id: "o1", partner_org_name: "Aaa Settled" }),
        agreement({ id: "ag-todo", partner_org_id: "o2", partner_org_name: "Zzz Todo" }),
        agreement({ id: "ag-wait", partner_org_id: "o3", partner_org_name: "Mmm Waiting" }),
      ],
      links: [
        link({ id: "L1", partner_org_id: "o1" }),
        link({ id: "L2", partner_org_id: "o2" }),
        link({ id: "L3", partner_org_id: "o3" }),
      ],
      grants: [grant({ agreement_id: "ag-settled" })],
      acknowledgements: [{
        id: "ack-1", partner_org_id: "o3", recipient_name: "X",
        recipient_email: "x@y.example", status: "sent", expires_at: at(10),
      }],
    }));
    expect(rows.map((r) => r.partnerName))
      .toEqual(["Zzz Todo", "Mmm Waiting", "Aaa Settled"]);
  });

  it("the headline counts, and is never a compliance verdict", () => {
    const { headline } = partnerRoster(facts({ grants: [grant()] }));
    for (const forbidden of [/\bclear\b/i, /\bcompliant\b/i, /\bverified\b/i, /\bsatisfied\b/i]) {
      expect(headline).not.toMatch(forbidden);
    }
  });

  it("names how many need something, because that is the operator's question", () => {
    const { headline } = partnerRoster(facts());
    expect(headline).toMatch(/1 of 1 needs something from you/i);
  });
});

describe("wired at the source", () => {
  const section = readFileSync("src/components/aml/ReliancePassportSection.tsx", "utf8");

  it("the four lists became one — the roster is the partner surface", () => {
    expect(section).toContain("PartnerRosterPanel");
    /* The HEADINGS are gone, not merely the words: the comment that records
       why they went still names them, and should. */
    for (const gone of [
      "/> Written arrangements",
      "/> Compliance agreement — sent for acceptance",
      "/> Partner links",
    ]) {
      expect(section, gone).not.toContain(gone);
    }
    expect(section).not.toContain("PassportRecipientsPanel");
  });

  it("every act the removed lists carried is still reachable", () => {
    // Nothing was deleted as a capability — only as a second place to look.
    for (const act of [
      "onRecordAssessment", "onResendAgreement", "onDownloadAgreement",
      "onEndLink", "onRevoke", "onSend",
    ]) {
      expect(section, act).toContain(act);
    }
    // And the matter-level records that belong to no partner row.
    expect(section).toContain("Record an organisation");
    expect(section).toContain("Link a partner to this matter");
    expect(section).toContain("Record an arrangement");
  });

  it("sending still goes through ONE implementation of what a send does", () => {
    /* Two implementations of "what does sending do to the link they hold" is
       exactly how this feature has gone wrong before, so the roster
       translates its row onto the recipients reading rather than deciding
       supersession a second time. */
    expect(section).toContain("const recipientFor = (row: RosterRow)");
    expect(section).toContain("passportRecipients({");
    expect(section).toContain("if (recipient) void sendPassport(recipient)");
  });
});
