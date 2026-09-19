/**
 * The AUSTRAC path — the rules that make it a compliance record rather than
 * a form.
 */
import { describe, it, expect, vi } from "vitest";
import {
  AUSTRAC_OBLIGATIONS, TERRORISM_FINANCING_HOURS, approvalConfirmation,
  outstandingBeforeApproval,
  addBusinessDays, austracHeadline, austracReadiness, deriveAustracPath,
  lodgementClock, type AustracReportFacts,
} from "./austracReportPath.pure";

/**
 * The default obligation is TODAY, so the default report is inside its window.
 *
 * An SMR is due three business days after the obligation, and this default
 * used to be the literal `2026-08-27` — a Thursday, due 2026-09-01T00:00Z.
 * At 00:45Z that morning "asks nothing of an approver whose report is clean"
 * began failing on a suite nobody had touched, because a clean report had
 * quietly become an overdue one. The clock is what these tests measure; it
 * must not also be what they trip over.
 *
 * The tests BELOW that pass an explicit `obligationAt` keep their literal
 * dates on purpose: those are the specification of the business-day rule
 * itself — a Thursday is due the following Tuesday whatever today is — and a
 * relative date there would assert nothing.
 */
const facts = (over: Partial<AustracReportFacts> = {}): AustracReportFacts => ({
  kind: "smr", status: "draft", caseId: "case-1", subjectLabel: "Rugesh Naidu",
  title: "SMR — unusual cash deposits",
  narrative: "Third-party funds arrived with no explained connection to the buyer.",
  periodStart: null, periodEnd: null, mlroSignedAt: null, submittedAt: null,
  externalReference: null, receiptReference: null,
  obligationAt: new Date().toISOString(), ...over,
});

describe("the statutory clock", () => {
  it("counts BUSINESS days, not calendar days", () => {
    /* A suspicion formed on a Thursday is due the following Tuesday. A naive
       +3 would say Sunday, which is not a day AUSTRAC counts. */
    const thursday = new Date("2026-08-27T00:00:00.000Z");
    expect(thursday.getUTCDay()).toBe(4);
    expect(addBusinessDays(thursday, 3).toISOString().slice(0, 10)).toBe("2026-09-01");
  });

  it("gives each report the window the Act gives it, and names the section", () => {
    expect(AUSTRAC_OBLIGATIONS.smr.businessDays).toBe(3);
    expect(AUSTRAC_OBLIGATIONS.ttr.businessDays).toBe(10);
    expect(AUSTRAC_OBLIGATIONS.ifti.businessDays).toBe(10);
    // The annual compliance report is not a per-report clock.
    expect(AUSTRAC_OBLIGATIONS.compliance_report.businessDays).toBeNull();
    for (const o of Object.values(AUSTRAC_OBLIGATIONS)) {
      expect(o.basis).toMatch(/AML\/CTF Act 2006 \(Cth\) s\.\d+/);
    }
  });

  it("tightens an SMR to 24 hours where terrorism financing is suspected", () => {
    /* The same report under a tighter clock, not a different kind — drafting
       "the wrong one" and reconciling later is not a thing an operator
       should be able to do. */
    const c = lodgementClock({
      kind: "smr", obligationAt: "2026-08-27T00:00:00.000Z", terrorismFinancing: true,
    });
    expect(c.window).toContain(String(TERRORISM_FINANCING_HOURS));
    expect(c.dueAt).toBe("2026-08-28T00:00:00.000Z");
  });

  it("says it is overdue rather than hiding it", () => {
    const c = lodgementClock({
      kind: "smr", obligationAt: "2026-08-01T00:00:00.000Z", now: new Date("2026-09-01T00:00:00Z"),
    });
    expect(c.overdue).toBe(true);
    expect(c.daysRemaining).toBeLessThan(0);
  });

  it("answers with no deadline rather than a wrong one", () => {
    expect(lodgementClock({ kind: "smr", obligationAt: null }).dueAt).toBeNull();
    expect(lodgementClock({ kind: "smr", obligationAt: "not-a-date" }).dueAt).toBeNull();
  });
});

describe("the pre-lodgement checks", () => {
  it("treats a report filed against nobody as the blocker it is", () => {
    /* `reports.case_id` existed from the first migration and the draft
       dialog never set it. A report about a customer that is not on that
       customer's file is not on file. */
    const c = austracReadiness(facts({ caseId: null })).find((x) => x.key === "customer")!;
    expect(c.state).toBe("blocked");
    expect(austracHeadline(facts({ caseId: null }))).toMatch(/not yet filed against a customer/i);
  });

  it("says the platform never lodges, on the step where it matters", () => {
    const c = austracReadiness(facts({ mlroSignedAt: "2026-08-28T00:00:00Z" }))
      .find((x) => x.key === "lodgement")!;
    expect(c.detail).toMatch(/your own AUSTRAC Online account/i);
    expect(c.detail).toMatch(/never submits on your behalf/i);
  });

  it("never blocks what the SERVER is responsible for refusing", () => {
    /* Two gates is how one of them becomes wrong. The server already
       refuses an unapproved report, a submission with no evidence, an SMR
       with no AUSTRAC reference and a missing tipping-off attestation. */
    const states = austracReadiness(facts()).map((c) => c.state);
    expect(states).not.toContain(undefined);
    // Only two things can read `blocked`: no customer, and past the clock.
    const blocked = austracReadiness(facts({ caseId: null, obligationAt: "2020-01-01T00:00:00Z" }))
      .filter((c) => c.state === "blocked").map((c) => c.key);
    expect(blocked.sort()).toEqual(["clock", "customer"]);
  });

  it("keeps the receipt as evidence the obligation was discharged", () => {
    const done = austracReadiness(facts({
      mlroSignedAt: "a", submittedAt: "b", externalReference: "AUS-1", receiptReference: "RCPT-9",
    }));
    expect(done.every((c) => c.state === "done")).toBe(true);
  });
});

describe("the path", () => {
  it("has exactly one open step, and it is the first unfinished one", () => {
    const open = deriveAustracPath(facts()).filter((s) => s.state === "open");
    expect(open).toHaveLength(1);
    /* The approval. It was "review" — a step whose only completion was
       routing the report to the MLRO, which on an entity where the drafter
       IS the MLRO was a report sent from somebody to themselves. Without
       the routing it counted the same fact as the approval beside it. */
    expect(open[0].key).toBe("approve");
  });

  it("opens on the customer when there is none", () => {
    expect(deriveAustracPath(facts({ caseId: null }))[0].state).toBe("open");
  });

  it("runs out of open steps once the receipt is on file", () => {
    const done = deriveAustracPath(facts({
      mlroSignedAt: "a", submittedAt: "b", receiptReference: "c", status: "acknowledged",
    }));
    expect(done.every((s) => s.state === "done")).toBe(true);
    expect(austracHeadline(facts({
      mlroSignedAt: "a", submittedAt: "b", receiptReference: "c",
    }))).toMatch(/discharged/i);
  });

  it("counts the approval once, not as a review and an approval", () => {
    /* Two steps completing on the same fact is how a header comes to read
       "2 of 6 done" above a list where nothing else can move. */
    const keys = deriveAustracPath(facts()).map((s) => s.key);
    expect(keys).toEqual(["identify", "assemble", "approve", "lodge", "receipt"]);
    expect(keys).not.toContain("review");
    expect(keys).not.toContain("signoff");
  });

  it("keeps the approval as the control it always was", () => {
    /* Removing a ceremony must never remove a control. The hand-off went;
       the MLRO's decision is still what completes the step, and still what
       the step is named for. */
    const step = deriveAustracPath(facts()).find((s) => s.key === "approve")!;
    expect(step.state).toBe("open");
    expect(step.label).toMatch(/approve/i);
    expect(step.detail).toMatch(/MLRO/);
    expect(deriveAustracPath(facts({ mlroSignedAt: "2026-08-30T00:00:00Z" }))
      .find((s) => s.key === "approve")!.state).toBe("done");
  });

  it("does not need a report to have been routed to the MLRO first", () => {
    /* `mlro_signoff` accepts a plain draft and always did, so a report that
       was never handed off still reaches the approval as its open step. */
    const open = deriveAustracPath(facts({ status: "draft" })).find((s) => s.state === "open");
    expect(open?.key).toBe("approve");
  });

  it("still reads a report that WAS routed, because that status still exists", () => {
    /* Nothing routes to `awaiting_mlro` from the product now, but the column
       accepts it and rows may already carry it. */
    const path = deriveAustracPath(facts({ status: "awaiting_mlro" }));
    expect(path.find((s) => s.state === "open")?.key).toBe("approve");
  });

  it("asks nothing of an approver whose report is clean", () => {
    /* A clean report approves in one click; only a real gap interrupts. */
    expect(approvalConfirmation(facts())).toBeNull();
    expect(outstandingBeforeApproval(facts())).toEqual([]);
  });

  it("still asks nothing of that approver in five years' time", () => {
    /* The property the fixture above depends on, asserted rather than
       assumed. This suite went red at 00:45 on 1 September 2026 with no
       change to the repository: the default obligation was a literal date
       whose three-business-day window had just closed. A default measured
       from `now` is inside its window on every day the suite is ever run,
       and this is the test that says so — jump the clock five years, three
       days, and onto a weekend, and a clean report is still clean. */
    const originals = [
      new Date("2031-09-01T02:13:00.000Z"), // five years on, a Monday
      new Date("2031-09-06T23:59:59.000Z"), // a Saturday night
      new Date("2032-02-29T12:00:00.000Z"), // a leap day
    ];
    for (const when of originals) {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(when);
        expect(approvalConfirmation(facts()), when.toISOString()).toBeNull();
        expect(outstandingBeforeApproval(facts()), when.toISOString()).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    }
  });

  it("never asks the approver to answer for the steps their own decision unlocks", () => {
    /* Lodgement and the receipt come AFTER approval, and the MLRO check IS
       the decision. */
    const keys = outstandingBeforeApproval(facts({ caseId: null, narrative: "" }))
      .map((c) => c.key);
    expect(keys).toContain("customer");
    expect(keys).toContain("narrative");
    for (const after of ["mlro", "lodgement", "receipt"]) expect(keys).not.toContain(after);
  });

  it("names what is outstanding, and says the approval is recorded", () => {
    const asked = approvalConfirmation(facts({ caseId: null }))!;
    expect(asked).toContain("Filed against a customer");
    expect(asked).toMatch(/recorded against you/i);
  });

  it("never tells the reader where something is on the page", () => {
    /* The same step text is drawn on the hub, inside the report and in the
       draft page's orientation list, and the checks sit in a different
       place in each. "The checks below" was true on one screen and wrong on
       the next the moment they were reordered. */
    for (const step of deriveAustracPath(facts())) {
      expect(`${step.label} ${step.detail}`).not.toMatch(/\b(below|above)\b/i);
    }
  });

  it("is numbered from one, in order", () => {
    expect(deriveAustracPath(facts()).map((s) => s.n)).toEqual([1, 2, 3, 4, 5]);
  });
});
