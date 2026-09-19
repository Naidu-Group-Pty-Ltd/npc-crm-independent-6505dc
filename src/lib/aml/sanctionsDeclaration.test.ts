/**
 * The completeness declaration, and the invariant that outlives every
 * wording change: **nothing the client says waives a determination.**
 *
 * The client is deliberately never asked "are you sanctioned?" — an ordinary
 * property client cannot answer it, and asking implies their answer decides
 * whether we screen. They are asked the one question they can answer and we
 * genuinely need: is the information we screen ON complete?
 *
 * So the first block sweeps every answer through the real policy engine and
 * asserts sanctions and PEP survive all of them. If it ever fails, the change
 * that made it fail is wrong, not the test.
 */
import { describe, expect, it } from "vitest";

import {
  COMPLETENESS_ANSWERS,
  SANCTIONS_ACKNOWLEDGEMENT_VERSION,
  clientFacingScreeningStatus,
  declarationRequiresPartyDisclosure,
  describeDeclaration,
  readSanctionsDeclaration,
} from "../../../supabase/functions/_shared/aml/sanctionsDeclaration.pure";
import {
  decideScreeningPolicy,
  deriveMissingScreeningSubjects,
} from "../../../supabase/functions/_shared/aml/screeningPolicy.pure";

/* ═══════════ 1–4 · No client answer ever waives a determination ═══════════ */

describe("the declaration never waives sanctions or PEP", () => {
  it("is not an input to the screening policy at all", () => {
    // The strongest possible statement: the policy engine has no parameter
    // for it, so no wording change here can ever reach a determination.
    const base = {
      answers: { pep: "no", adverse: "no", thirdParty: "no", overseasFunding: "no" },
      entityType: "Individual", riskRating: null,
      enhancedDueDiligence: false, anyPepFinding: false,
    } as const;
    const decision = decideScreeningPolicy(base);
    expect(decision.required).toContain("sanctions");
    expect(decision.required).toContain("pep");
    expect(Object.keys(base)).not.toContain("completeness");
  });

  it.each([...COMPLETENESS_ANSWERS])(
    "completeness=%s leaves sanctions and PEP mandatory", (completeness) => {
      // Whatever the client answered, the determinations are identical.
      const declaration = readSanctionsDeclaration({
        completeness, acknowledged: true, aliases: [],
      })!;
      expect(declaration.completeness).toBe(completeness);

      for (const pep of ["yes", "no", null] as const) {
        const d = decideScreeningPolicy({
          answers: { pep, adverse: "no", thirdParty: "no", overseasFunding: "no" },
          entityType: "Individual", riskRating: null,
          enhancedDueDiligence: false, anyPepFinding: false,
        });
        expect(d.required, `${completeness}/${pep}`).toContain("sanctions");
        expect(d.required, `${completeness}/${pep}`).toContain("pep");
        expect(d.notRequired.map((n) => n.scope)).not.toContain("sanctions");
        expect(d.notRequired.map((n) => n.scope)).not.toContain("pep");
      }
    },
  );

  it("acknowledging does not create a clear result anywhere", () => {
    const d = readSanctionsDeclaration({
      completeness: "complete", acknowledged: true, aliases: [],
    })!;
    const described = describeDeclaration(d);
    // The operator wording must not be readable as clearance.
    expect(described.detail).toMatch(/not a screening result/i);
    expect(described.label).not.toMatch(/clear|cleared|no match|screened/i);
  });
});

/* ═══════════ 7–8 · Unknown and legacy fail closed ═══════════ */

describe("absence is never a negative answer", () => {
  it("reads an unanswered section as no declaration, not as complete", () => {
    for (const payload of [null, undefined, {}, { acknowledged: true }]) {
      expect(readSanctionsDeclaration(payload as never)).toBeNull();
    }
  });

  it("does not accept an unrecognised completeness value", () => {
    expect(readSanctionsDeclaration({ completeness: "yes", acknowledged: true })).toBeNull();
    expect(readSanctionsDeclaration({ completeness: "", acknowledged: true })).toBeNull();
  });

  it("says so plainly when there is no declaration", () => {
    const d = describeDeclaration(null);
    expect(d.label).toMatch(/No completeness declaration/i);
    expect(d.detail).toMatch(/does not change what must be screened/i);
  });

  it("records that acknowledgement was NOT given rather than assuming it", () => {
    const d = readSanctionsDeclaration({ completeness: "complete", acknowledged: false })!;
    expect(d.acknowledged).toBe(false);
  });
});

/* ═══════════ 9–10 · Aliases and parties reach the canonical path ═══════════ */

describe("what the client discloses actually reaches the screening subject", () => {
  it("carries disclosed aliases onto the enrolled subject", () => {
    // The whole point of asking. An undisclosed former name is a real
    // screening gap, and a list is only as good as the names put to it.
    const [subject] = deriveMissingScreeningSubjects({
      subjectDisplayName: "Rugesh Naidu",
      personalDetails: { full_name: "Rugesh Naidu", dob: "1993-12-10" },
      declaredAliases: ["R. Naidu", "Rugesh Naidoo"],
      reconciled: [],
      existing: [],
    });
    expect(subject.aliases).toEqual(
      expect.arrayContaining(["R. Naidu", "Rugesh Naidoo"]));
  });

  it("merges with questionnaire aliases without duplicating", () => {
    const [subject] = deriveMissingScreeningSubjects({
      subjectDisplayName: "Rugesh Naidu",
      personalDetails: { aliases: ["R. Naidu"] },
      declaredAliases: ["R. Naidu", " Rugesh Naidoo "],
      reconciled: [],
      existing: [],
    });
    expect(subject.aliases.filter((a) => a === "R. Naidu")).toHaveLength(1);
    expect(subject.aliases).toContain("Rugesh Naidoo");
  });

  it("changes nothing about WHETHER the subject is screened", () => {
    const withAliases = deriveMissingScreeningSubjects({
      subjectDisplayName: "Rugesh Naidu", personalDetails: {},
      declaredAliases: ["R. Naidu"], reconciled: [], existing: [],
    });
    const without = deriveMissingScreeningSubjects({
      subjectDisplayName: "Rugesh Naidu", personalDetails: {},
      declaredAliases: null, reconciled: [], existing: [],
    });
    expect(withAliases).toHaveLength(1);
    expect(without).toHaveLength(1);
    expect(withAliases[0].partyType).toBe(without[0].partyType);
  });

  it("routes further disclosure through the existing declared-parties path", () => {
    // No parallel "sanctions people" model: a person named because of this
    // section reaches reconciliation exactly like any other declared party.
    expect(declarationRequiresPartyDisclosure(
      readSanctionsDeclaration({ completeness: "additions", acknowledged: true }))).toBe(true);
    expect(declarationRequiresPartyDisclosure(
      readSanctionsDeclaration({ completeness: "unsure", acknowledged: true }))).toBe(true);
    expect(declarationRequiresPartyDisclosure(
      readSanctionsDeclaration({ completeness: "complete", acknowledged: true }))).toBe(false);
    // And an unanswered section never conjures a party step.
    expect(declarationRequiresPartyDisclosure(null)).toBe(false);
  });

  it("caps and trims aliases rather than storing whatever arrives", () => {
    const d = readSanctionsDeclaration({
      completeness: "complete", acknowledged: true,
      aliases: [...Array(60).keys()].map((i) => ` name ${i} `).concat(["", "   ", 7 as never]),
    })!;
    expect(d.aliases.length).toBeLessThanOrEqual(25);
    expect(d.aliases.every((a) => a === a.trim() && a.length > 0)).toBe(true);
  });
});

/* ═══════════ 24–25 · What the client is allowed to see ═══════════ */

describe("the client never sees internal compliance states", () => {
  const INTERNAL = [
    "possible_match", "confirmed_match", "error", "queued", "processing",
    "lists_stale", "provider_unavailable", "simulator_mode",
  ];

  it.each(INTERNAL)("collapses %s to a neutral sentence", (state) => {
    const text = clientFacingScreeningStatus(state);
    // Nothing alarming, nothing that could tip anybody off, and no internal
    // vocabulary whatsoever.
    expect(text).not.toMatch(/match|sanction|adjudicat|escalat|MLRO|provider|stale|fail|error/i);
    expect(text).toMatch(/No action is currently required from you/i);
  });

  it("tells a finished client they are finished", () => {
    for (const state of ["completed", "false_positive"]) {
      expect(clientFacingScreeningStatus(state)).toMatch(/complete/i);
      expect(clientFacingScreeningStatus(state)).not.toMatch(/match|positive/i);
    }
  });

  it("never leaves the client without a sentence", () => {
    for (const state of [...INTERNAL, "completed", "not_required", "anything_new"]) {
      expect(clientFacingScreeningStatus(state).length).toBeGreaterThan(20);
    }
  });
});

describe("the acknowledgement is an auditable record", () => {
  it("stamps the version the client actually agreed to", () => {
    const d = readSanctionsDeclaration({
      completeness: "complete", acknowledged: true,
      acknowledgement_version: "2025.01",
    })!;
    // A submission made months ago must not be read as agreeing to today's
    // wording, so the stored version wins over the current constant.
    expect(d.acknowledgementVersion).toBe("2025.01");
  });

  it("falls back to the current version only when none was stored", () => {
    const d = readSanctionsDeclaration({ completeness: "complete", acknowledged: true })!;
    expect(d.acknowledgementVersion).toBe(SANCTIONS_ACKNOWLEDGEMENT_VERSION);
  });
});
