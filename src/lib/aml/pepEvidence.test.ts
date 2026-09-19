import { describe, expect, it } from "vitest";
import {
  PEP_DECLARATION_KIND,
  PEP_DEFERRAL_REASONS,
  PEP_SOURCE_KINDS,
  assessPepDeferral,
  assessPepEvidence,
  independentMethods,
  namesSanctionsRegister,
  normalisePepMethod,
  normalisePepMethods,
  sanctionsSignalForPep,
  type PepMethod,
} from "@/lib/aml/pepEvidence";

/**
 * What a PEP determination has to rest on.
 *
 * The statutory test is that the position is established **on reasonable
 * grounds** — an objective standard, so the record has to show HOW the
 * conclusion was reached. These pin the three Aurixa controls that turn that
 * into something a dialog can enforce, and the one defect that prompted them:
 * the product's own worked example of a source was a sanctions register.
 */

const method = (over: Partial<PepMethod> = {}): PepMethod => ({
  kind: "government_directory",
  source: "Australian Government Directory",
  reference: "Pat Example",
  result: "No entry for this name",
  note: null,
  ...over,
});

describe("a sanctions register is not a source of political-exposure information", () => {
  /*
   * The asymmetry is the point, and the instinct to use the list is not
   * silly: designation lists are full of ministers and state-enterprise
   * directors, so a HIT is genuine evidence towards exposure. A MISS says
   * nothing at all. A source that can only ever support the negative
   * conclusion is a source that can only ever mislead.
   */
  it("recognises the registers by the names they are actually written under", () => {
    for (const text of [
      "DFAT consolidated list — screened via case screening",
      "The Consolidated List",
      "UN consolidated list",
      "OFAC SDN list",
      "checked the sanctions register",
      "targeted financial sanctions screening",
    ]) expect(namesSanctionsRegister(text)).toBe(true);
  });

  it("does not swallow a legitimate source that merely mentions sanctions", () => {
    // A broad pattern would reject this, and it is a perfectly good source.
    expect(namesSanctionsRegister(
      "Register of members' interests — checked for a sanctions-related directorship",
    )).toBe(false);
    expect(namesSanctionsRegister("Parliament of Australia")).toBe(false);
    expect(namesSanctionsRegister(null)).toBe(false);
  });

  it("refuses the determination when a source names one — in either field", () => {
    const bySource = assessPepEvidence({
      result: "not_pep",
      methods: [method({ source: "DFAT consolidated list", kind: "other" })],
      rationale: "Nothing came back against the list.",
    });
    expect(bySource.ok).toBe(false);
    expect(bySource.errors.some((e) => e.message.includes("is a sanctions register"))).toBe(true);

    const byReference = assessPepEvidence({
      result: "not_pep",
      methods: [method({ source: "Screening run", reference: "OFAC SDN list" })],
      rationale: "Nothing came back against the list.",
    });
    expect(byReference.ok).toBe(false);
    expect(byReference.errors[0].field).toBe("methods.0");
  });
});

describe("what evidence has to contain", () => {
  it("accepts an independent source that recorded what came back", () => {
    expect(assessPepEvidence({
      result: "not_pep",
      methods: [method()],
      rationale: "No public office found in the directory or in open sources.",
    })).toEqual({ ok: true, errors: [] });
  });

  it("refuses a determination with no sources at all", () => {
    const v = assessPepEvidence({
      result: "not_pep", methods: [], rationale: "Satisfied they are not a PEP.",
    });
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.field === "methods")).toBe(true);
  });

  it("refuses the customer's own declaration as the whole of the evidence", () => {
    // It is the thing being tested, so it can never be the test.
    const v = assessPepEvidence({
      result: "not_pep",
      methods: [method({ kind: PEP_DECLARATION_KIND, source: "Client portal answer" })],
      rationale: "The customer answered no to the political-exposure question.",
    });
    expect(v.ok).toBe(false);
    expect(v.errors.some(
      (e) => e.message.includes("independent of the customer"))).toBe(true);
  });

  it("a declaration counts once an independent source stands beside it", () => {
    const v = assessPepEvidence({
      result: "not_pep",
      methods: [
        method({ kind: PEP_DECLARATION_KIND, source: "Client portal answer", result: null }),
        method(),
      ],
      rationale: "The declaration is consistent with the directory search.",
    });
    expect(v.ok).toBe(true);
  });

  it("a searched source must say what came back", () => {
    const v = assessPepEvidence({
      result: "not_pep",
      methods: [method({ result: null })],
      rationale: "No public office found in any consulted source.",
    });
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.field === "methods.0.result")).toBe(true);
  });

  it("but a declaration is not a search, so it needs no result", () => {
    const v = assessPepEvidence({
      result: "not_pep",
      methods: [method({ kind: PEP_DECLARATION_KIND, result: null }), method()],
      rationale: "The declaration is consistent with the directory search.",
    });
    expect(v.errors.some((e) => e.field === "methods.0.result")).toBe(false);
  });

  it("a rationale is required, and a shrug is not one", () => {
    const v = assessPepEvidence({
      result: "not_pep", methods: [method()], rationale: "n/a",
    });
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.field === "rationale")).toBe(true);
  });

  it("holds a PEP result to the same standard as a not-PEP one", () => {
    // Both conclusions are determinations. Only one of them is habitually
    // treated as the one needing evidence.
    const v = assessPepEvidence({ result: "pep", methods: [], rationale: "" });
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.field === "methods")).toBe(true);
  });
});

describe("normalisation", () => {
  it("drops a row with no source, so a half-filled row is never evidence", () => {
    expect(normalisePepMethod({ source: "   ", result: "nothing" })).toBeNull();
    expect(normalisePepMethods([{ source: "" }, { source: "Directory" }])).toHaveLength(1);
  });

  it("keeps an unknown kind as `other` rather than discarding the typing", () => {
    expect(normalisePepMethod({ kind: "vibes", source: "Directory" })?.kind).toBe("other");
  });

  it("empties become null, not empty strings", () => {
    const m = normalisePepMethod({ source: "Directory", reference: "  ", note: "" });
    expect(m?.reference).toBeNull();
    expect(m?.note).toBeNull();
  });

  it("caps the row count and the field lengths", () => {
    expect(normalisePepMethods(
      Array.from({ length: 40 }, () => ({ source: "Directory" })))).toHaveLength(20);
    expect(normalisePepMethod({ source: "x".repeat(900) })?.source).toHaveLength(300);
  });

  it("a non-array is no methods, never a throw", () => {
    expect(normalisePepMethods(null)).toEqual([]);
    expect(normalisePepMethods("directory")).toEqual([]);
  });

  it("independence is decided by kind, not by wording", () => {
    expect(independentMethods([
      method({ kind: PEP_DECLARATION_KIND }), method(),
    ])).toHaveLength(1);
  });
});

describe("a deferral is not a third outcome", () => {
  it("needs a reason from the list and a statement of what is missing", () => {
    const v = assessPepDeferral({ reason: "because", needed: "dunno", methods: [] });
    expect(v.ok).toBe(false);
    expect(v.errors.map((e) => e.field)).toEqual(["reason", "needed"]);
  });

  it("accepts a named reason with what is needed", () => {
    expect(assessPepDeferral({
      reason: "identity_ambiguous",
      needed: "Date of birth, to separate them from a same-named member of parliament.",
      methods: [method()],
    })).toEqual({ ok: true, errors: [] });
  });

  it("does not demand an independent source — nothing is being concluded", () => {
    expect(assessPepDeferral({
      reason: "sources_inconclusive",
      needed: "A response from the customer about the overseas directorship.",
      methods: [],
    }).ok).toBe(true);
  });

  it("still refuses a sanctions register among what was checked", () => {
    const v = assessPepDeferral({
      reason: "sources_inconclusive",
      needed: "A response from the customer about the overseas directorship.",
      methods: [method({ source: "DFAT consolidated list" })],
    });
    expect(v.ok).toBe(false);
  });

  it("every reason has a label, and every source kind has one", () => {
    expect(new Set(PEP_DEFERRAL_REASONS).size).toBe(PEP_DEFERRAL_REASONS.length);
    expect(new Set(PEP_SOURCE_KINDS).size).toBe(PEP_SOURCE_KINDS.length);
  });
});

describe("a sanctions result is a signal, and only in one direction", () => {
  it("a confirmed match is a reason to look harder at exposure", () => {
    expect(sanctionsSignalForPep("confirmed")).toContain("prominent public functions");
  });

  it("an unadjudicated candidate is named as one", () => {
    expect(sanctionsSignalForPep("candidate")).toContain("candidate");
  });

  it("a clear result says NOTHING — silence, not reassurance", () => {
    // "Screened, no match" carries no information about political exposure,
    // and anything said here would be read as though it did.
    expect(sanctionsSignalForPep("none")).toBeNull();
  });
});
