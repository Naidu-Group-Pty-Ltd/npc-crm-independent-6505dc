import { describe, expect, it } from "vitest";
import {
  describeOutstanding, pepDeterminationRequirements,
} from "@/lib/aml/pepDeterminationSteps";
import { assessPepEvidence, normalisePepMethods } from "@/lib/aml/pepEvidence";

/**
 * Everything outstanding, at once — instead of one closed door at a time.
 *
 * ── What the operator saw ─────────────────────────────────────────────
 * The dialog rendered `verdict.errors[0]?.message`. Before an outcome is
 * chosen the only error is "Choose what was determined.", so every other
 * requirement was invisible. Pick an outcome, discover you need an
 * independent source; supply one, discover you need a rationale; write one,
 * discover a source has no recorded result.
 *
 * Every message was correct. The sequence was a corridor of closed doors, and
 * the information to open all of them existed the whole time with no
 * arrangement — which is the same finding Stage 5 itself had, one level down.
 */

const method = (over = {}) => ({
  kind: "official_register", source: "Parliament of Australia",
  reference: "Pat Example", result: "No entry returned.", ...over,
});
const declaration = () => ({
  kind: "client_declaration", source: "The customer's declaration in the client portal",
  reference: "Answered: no", result: "The customer said no.",
});

const reqs = (input: {
  outcome: "not_pep" | "pep" | "defer" | null;
  methods?: unknown[];
  rationale?: string;
}) => {
  const methods = normalisePepMethods((input.methods ?? []) as never);
  const errors = input.outcome === "defer" ? [] : assessPepEvidence({
    result: input.outcome === "pep" ? "pep" : "not_pep",
    methods, rationale: input.rationale ?? "",
  }).errors;
  return pepDeterminationRequirements({
    outcome: input.outcome, methodCount: methods.length, errors,
  });
};
const outstanding = (rs: ReturnType<typeof reqs>) =>
  rs.filter((r) => !r.met && !r.pending).map((r) => r.id);

describe("the list is visible before an outcome exists", () => {
  it("names the evidence work up front, not only the missing outcome", () => {
    /*
     * The whole defect in one assertion. With nothing filled in, the operator
     * used to be told exactly one thing: choose an outcome.
     */
    const ids = outstanding(reqs({ outcome: null }));
    expect(ids).toContain("outcome");
    expect(ids).toContain("sources");
    expect(ids).toContain("rationale");
    expect(ids.length).toBeGreaterThan(1);
  });

  it("what a PEP outcome would additionally need is named but NOT failed", () => {
    // An unmet requirement is work to do; a question nobody has asked yet is
    // not, and a red cross against the second misstates the progress made.
    const rs = reqs({ outcome: null });
    const pending = rs.find((r) => r.id === "pep_details")!;
    expect(pending.pending).toBe(true);
    expect(pending.met).toBe(false);
    expect(outstanding(rs)).not.toContain("pep_details");
    expect(describeOutstanding(rs)).not.toMatch(/pending/i);
  });
});

describe("it is derived from the assessment, never a second list of rules", () => {
  it("an independent source clears the sources requirement", () => {
    // The customer's own declaration is evidence towards a determination and
    // never the whole of it — the same rule the server enforces.
    expect(outstanding(reqs({ outcome: "not_pep", methods: [declaration()] })))
      .toContain("sources");
    expect(outstanding(reqs({
      outcome: "not_pep", methods: [declaration(), method()],
    }))).not.toContain("sources");
  });

  it("a source with no recorded result is its own outstanding item", () => {
    const ids = outstanding(reqs({
      outcome: "not_pep", methods: [method({ result: "" })], rationale: "x".repeat(20),
    }));
    expect(ids).toContain("results");
  });

  it("a sanctions register named as PEP evidence appears only once it is made", () => {
    /*
     * A mistake, not an outstanding task. Listing it up front would read as an
     * instruction to go and check one — and absence from a sanctions register
     * is not evidence that somebody is not politically exposed.
     */
    expect(outstanding(reqs({ outcome: "not_pep" }))).not.toContain("wrong_source_kind");
    const ids = outstanding(reqs({
      outcome: "not_pep",
      methods: [method({ source: "DFAT Consolidated List" })],
    }));
    expect(ids).toContain("wrong_source_kind");
  });

  it("everything recorded means nothing outstanding", () => {
    const rs = reqs({
      outcome: "not_pep", methods: [declaration(), method()],
      rationale: "Searched the registers named above and found no entry for this party.",
    });
    expect(outstanding(rs)).toEqual([]);
    expect(describeOutstanding(rs)).toMatch(/everything needed has been recorded/i);
  });
});

describe("the evidence bar does not depend on which way it goes", () => {
  it("the same sources and rationale produce the same errors for pep and not_pep", () => {
    /*
     * This is the invariant that makes an up-front checklist honest.
     *
     * `assessPepEvidence` takes a `result` and never reads it: the standard of
     * evidence cannot be lower for the conclusion that closes the file. That
     * is what lets the evidence requirements be shown before an outcome
     * exists — and if anyone ever makes the bar depend on the answer, this
     * fails rather than the screen quietly misleading somebody.
     */
    for (const methods of [
      [], [declaration()], [declaration(), method()], [method({ result: "" })],
    ]) {
      for (const rationale of ["", "Checked the registers named above."]) {
        const m = normalisePepMethods(methods as never);
        expect(assessPepEvidence({ result: "pep", methods: m, rationale }).errors)
          .toEqual(assessPepEvidence({ result: "not_pep", methods: m, rationale }).errors);
      }
    }
  });
});

describe("a deferral is not a determination and does not borrow its list", () => {
  it("asks for what is missing, never for a rationale", () => {
    // Asking somebody recording that they could NOT reach a conclusion to
    // justify the conclusion is asking for the thing they have just said they
    // do not have.
    const ids = pepDeterminationRequirements({
      outcome: "defer", methodCount: 0,
      errors: [{ field: "reason", message: "" }, { field: "needed", message: "" }],
    }).map((r) => r.id);
    expect(ids).toEqual(["defer_reason", "defer_needed"]);
    expect(ids).not.toContain("rationale");
    expect(ids).not.toContain("outcome");
  });
});

describe("every requirement points at where to do it", () => {
  it("carries the step number it belongs to", () => {
    for (const outcome of ["not_pep", "pep", null] as const) {
      for (const r of reqs({ outcome })) {
        expect([1, 2, 3]).toContain(r.step);
        expect(r.label.length).toBeGreaterThan(5);
      }
    }
  });

  it("a PEP outcome asks the three questions a PEP record needs", () => {
    /*
     * These three errors are raised by the dialog rather than by
     * `assessPepEvidence` — the category, who holds the position and whether
     * it is still held are properties of a PEP record, not of the evidence
     * standard. So they are passed in here explicitly rather than pretending
     * the shared assessment produces them.
     */
    const ids = pepDeterminationRequirements({
      outcome: "pep", methodCount: 1,
      errors: [
        { field: "pep_type", message: "" },
        { field: "relationship", message: "" },
        { field: "currently_held", message: "" },
      ],
    }).filter((r) => !r.met && !r.pending).map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(
      ["pep_type", "relationship", "currently_held"]));
    // And no "if a PEP…" placeholder once the outcome IS a PEP.
    expect(ids).not.toContain("pep_details");
  });
});
