/**
 * The guidance beside the draft, and the translation in front of the
 * obligation table.
 */
import { describe, it, expect } from "vitest";
import {
  AUSTRAC_KIND_LABEL, KIND_GUIDANCE, draftClock, draftSections,
  draftSectionsForReport, draftSummary, isCustomerReport, narrativeSkeleton,
  toObligationKind, type DraftFacts,
} from "./austracDraftGuidance.pure";
import {
  AUSTRAC_OBLIGATIONS, austracReadiness, deriveAustracPath,
  type AustracReportFacts, type AustracReportKind,
} from "./austracReportPath.pure";

/** Exactly what `reports_kind_check` accepts in the database. */
const WIRE_KINDS = ["smr", "ttr", "ifti", "compliance", "annual"] as const;

const base: DraftFacts = {
  kind: "smr", caseId: null, title: null, narrative: null,
  obligationAt: null, terrorismFinancing: false, periodStart: null, periodEnd: null,
};

describe("the stored kind is translated, never used as a table key", () => {
  it("resolves every value the reports.kind constraint accepts", () => {
    /* This is the guard, not a formality. `AUSTRAC_OBLIGATIONS` is keyed by
       four obligations and the column accepts five values, so reading the
       table with a raw column value returns `undefined` and throws on the
       next property access — which is what the dialog did for a compliance
       or annual report. If a value is ever added to the column it must be
       added here too, and this test is where that is noticed. */
    for (const wire of WIRE_KINDS) {
      const kind = toObligationKind(wire);
      expect(kind, `${wire} has no obligation`).not.toBeNull();
      expect(AUSTRAC_OBLIGATIONS[kind as AustracReportKind]).toBeDefined();
    }
  });

  it("treats compliance and annual as the one obligation", () => {
    expect(toObligationKind("compliance")).toBe("compliance_report");
    expect(toObligationKind("annual")).toBe("compliance_report");
  });

  it("answers null for a kind it cannot place, rather than guessing one", () => {
    expect(toObligationKind("something_new")).toBeNull();
    expect(toObligationKind(null)).toBeNull();
    expect(draftClock({ ...base, kind: "something_new" })).toBeNull();
  });
});

describe("what the operator is told before they type", () => {
  it("gives every obligation a reason, a trigger and a narrative to answer", () => {
    for (const kind of Object.keys(AUSTRAC_OBLIGATIONS) as AustracReportKind[]) {
      const g = KIND_GUIDANCE[kind];
      expect(g.why.length).toBeGreaterThan(40);
      expect(g.informWhen.length).toBeGreaterThan(0);
      expect(g.narrativeAsks.length).toBeGreaterThan(2);
    }
  });

  it("warns about tipping off on the suspicious matter report and nowhere else", () => {
    /* s.123 attaches to a suspicious matter and not to a threshold
       transaction or a transfer instruction. Carrying the warning on all
       four would teach an operator to read past it. */
    expect(KIND_GUIDANCE.smr.tippingOff).toBe(true);
    expect(KIND_GUIDANCE.ttr.tippingOff).toBe(false);
    expect(KIND_GUIDANCE.ifti.tippingOff).toBe(false);
    expect(KIND_GUIDANCE.compliance_report.tippingOff).toBe(false);
  });

  it("never suggests that no report is needed", () => {
    /* "Not this report" routes an operator to the RIGHT report. It must
       never read as permission to lodge nothing — the guidance advises and
       the operator decides, but a sentence that sounds like a clearance is
       the one thing this panel cannot say. */
    const forbidden = /no report is (needed|required)|nothing (to report|need be reported)|not reportable/i;
    for (const g of Object.values(KIND_GUIDANCE)) {
      expect(g.notThis ?? "").not.toMatch(forbidden);
      for (const line of [...g.informWhen, ...g.examples]) expect(line).not.toMatch(forbidden);
    }
  });

  it("inserts questions into an empty narrative and never an answer", () => {
    /* The skeleton is offered into a blank narrative, so whatever it writes
       could be lodged verbatim if nobody edited it. Every line is a
       question, which cannot be read as an assertion about a customer. */
    for (const kind of Object.keys(KIND_GUIDANCE) as AustracReportKind[]) {
      const lines = narrativeSkeleton(kind).split("\n").filter((l) => l.trim());
      expect(lines.length).toBeGreaterThan(2);
      for (const line of lines) expect(line.trim().endsWith("?")).toBe(true);
    }
  });
});

describe("the four numbered sections", () => {
  it("asks for the date the clock starts, and settles once it has it", () => {
    expect(draftSections(base)[0].state).toBe("outstanding");
    expect(draftSections({ ...base, obligationAt: "2026-08-27T09:00:00Z" })[0].state).toBe("complete");
  });

  it("owes a customer on a customer report and never on the annual one", () => {
    expect(draftSections(base)[1].state).toBe("outstanding");
    expect(draftSections({ ...base, caseId: "c1" })[1].state).toBe("complete");
    /* An annual compliance report is about the business. Asking it to name
       a customer leaves a section that can never complete. */
    expect(draftSections({ ...base, kind: "annual" })[1].state).toBe("complete");
  });

  it("asks for a narrative and never for a length", () => {
    /* AUSTRAC sets no character threshold, and the one this carried rendered
       as `298 / 200 characters` — the shape of an overrun, on the one field
       where running out of room would be a serious problem. A narrative is
       written or it is not, and the questions under the box are the guidance
       on substance. */
    const empty = draftSections({ ...base, title: "t", narrative: "   " })[2];
    expect(empty.state).toBe("outstanding");
    expect(empty.outstanding).not.toMatch(/character/i);
    const brief = draftSections({ ...base, title: "t", narrative: "Cash paid at settlement." })[2];
    expect(brief.state).toBe("complete");
  });

  it("treats the period as optional for a customer report and owed for the annual one", () => {
    expect(draftSections(base)[3].state).toBe("optional");
    expect(draftSections({ ...base, kind: "compliance" })[3].state).toBe("outstanding");
  });

  it("summarises what is still owed without ever claiming it is ready to lodge", () => {
    expect(draftSummary(draftSections(base))).toMatch(/outstanding/);
    const complete = draftSections({
      ...base, caseId: "c1", title: "t", narrative: "Cash paid at settlement.",
      obligationAt: "2026-08-27T09:00:00Z",
    });
    expect(draftSummary(complete)).toBe("Everything this report needs has been recorded.");
  });
});

describe("the deadline shown while the date is typed", () => {
  it("tightens a terrorism-financing suspicion to twenty-four hours", () => {
    const ordinary = draftClock({ ...base, obligationAt: "2026-08-27T09:00:00Z" });
    const tf = draftClock({ ...base, obligationAt: "2026-08-27T09:00:00Z", terrorismFinancing: true });
    expect(new Date(tf!.dueAt!).getTime()).toBeLessThan(new Date(ordinary!.dueAt!).getTime());
    expect(tf!.window).toMatch(/24 hours/);
  });

  it("gives the annual report no per-report clock", () => {
    expect(draftClock({ ...base, kind: "annual", obligationAt: "2026-08-27T09:00:00Z" })!.dueAt).toBeNull();
  });
});

describe("an annual report is not a customer report", () => {
  const annual: AustracReportFacts = {
    kind: "compliance_report", status: "draft", caseId: null, subjectLabel: null,
    title: "Annual", narrative: null, periodStart: null, periodEnd: null,
    mlroSignedAt: null, submittedAt: null, externalReference: null,
    receiptReference: null, obligationAt: null,
  };

  it("is never blocked for failing to name a customer it cannot have", () => {
    const customer = austracReadiness(annual).find((c) => c.key === "customer");
    expect(customer?.state).not.toBe("blocked");
  });

  it("can complete the first step of the path", () => {
    /* Otherwise a correctly drafted annual report shows a permanent red,
       which teaches an operator to read past the checks. */
    expect(deriveAustracPath(annual)[0].state).toBe("done");
  });

  it("still blocks a customer report that names nobody", () => {
    const smr = austracReadiness({ ...annual, kind: "smr" }).find((c) => c.key === "customer");
    expect(smr?.state).toBe("blocked");
    expect(isCustomerReport("smr")).toBe(true);
    expect(isCustomerReport("compliance_report")).toBe(false);
  });
});

describe("one label map, and one section model", () => {
  it("names every kind the column accepts", () => {
    /* There were two copies — the hub's table and the draft form each
       carried their own — and a report is one thing whichever screen names
       it. */
    for (const wire of WIRE_KINDS) {
      expect(AUSTRAC_KIND_LABEL[wire]).toBeTruthy();
    }
  });

  it("reads a stored report row without the caller restating the mapping", () => {
    /* The form and the page both ask "what is still owed" about the same
       draft. Two mappings from a row to `DraftFacts` is how they come to
       disagree. */
    const owed = draftSectionsForReport({
      kind: "smr", case_id: null, title: "t", narrative: "Cash paid at settlement.",
      metadata: { obligation_at: "2026-08-27T09:00:00Z" },
    });
    expect(owed[0].state).toBe("complete");
    expect(owed[1].state).toBe("outstanding");
    expect(owed[2].state).toBe("complete");
  });
});
