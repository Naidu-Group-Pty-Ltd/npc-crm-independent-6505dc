import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  gatePassportComplete, gatePassportPath, gatePassportProgress,
  type GatePassportFacts,
} from "./gatePassportPath.pure";

/**
 * Stage 9's order. Pinned: the Stage 8 outcome pulls through as step 1;
 * the gate step directs to where it is decided; preview is "anytime" and
 * never gates; issuance follows the SERVER's passport code and an
 * unavailable reading is never "not issued"; and the stage's buttons are
 * wired at the source.
 */

const facts = (over: Partial<GatePassportFacts> = {}): GatePassportFacts => ({
  decisionOutcome: "cleared",
  gateStatus: "under_review",
  passportState: "not_issued",
  passportVersion: null,
  canReview: true,
  ...over,
});

const byKey = (steps: ReturnType<typeof gatePassportPath>, key: string) =>
  steps.find((s) => s.key === key)!;

describe("the Stage 8 outcome pulls through", () => {
  it("a cleared case says so as step 1 — the fact the stage used to keep silent", () => {
    const s = byKey(gatePassportPath(facts()), "decision");
    expect(s.state).toBe("done");
    expect(s.detail).toBe("Cleared — recorded on the Decision stage.");
  });

  it("no decision yet makes step 1 the current step, routed to Stage 8", () => {
    const s = byKey(gatePassportPath(facts({ decisionOutcome: null })), "decision");
    expect(s.state).toBe("current");
    expect(s.detail).toMatch(/Decision stage first/);
  });

  it("a blocked case blocks the path and names it", () => {
    const steps = gatePassportPath(facts({ decisionOutcome: "blocked" }));
    expect(byKey(steps, "decision").state).toBe("blocked");
    expect(byKey(steps, "decision").blockedBy).toBe("The case is blocked");
    expect(byKey(steps, "gate").state).toBe("outstanding");
  });
});

describe("the gate step directs", () => {
  it("cleared + unapproved gate: current for a reviewer, with the route named", () => {
    /* The gate travels WITH the cleared decision now, so a cleared case
       still holding an open gate is a row decided before that change. The
       route is the Decision stage's full gate card, which is the only place
       every gate status has ever been recorded. */
    const s = byKey(gatePassportPath(facts()), "gate");
    expect(s.state).toBe("current");
    expect(s.detail).toMatch(/Recording the cleared decision grants this/);
    expect(s.detail).toMatch(/Decision stage/);
  });

  it("a STOPPED gate is named as the MLRO's standing restriction", () => {
    /* Locked and terminated are how a live Passport is suspended or
       revoked. They must never read as an approval somebody forgot. */
    for (const status of ["locked", "terminated"]) {
      const s = byKey(gatePassportPath(facts({ gateStatus: status })), "gate");
      expect(s.detail, status).toMatch(/standing restriction recorded by the MLRO/);
      expect(s.detail, status).not.toMatch(/Recording the cleared decision grants/);
    }
  });

  it("blocked-with-blocker for an operator who cannot review", () => {
    const s = byKey(gatePassportPath(facts({ canReview: false })), "gate");
    expect(s.state).toBe("blocked");
    expect(s.blockedBy).toBe("Requires a reviewer or the MLRO");
  });

  it("an approved gate is done, in the gate's own words", () => {
    const s = byKey(gatePassportPath(facts({ gateStatus: "approved_with_controls" })), "gate");
    expect(s.state).toBe("done");
    expect(s.detail).toMatch(/approved with controls — the designated service may proceed/);
  });
});

describe("preview never gates; issuance follows the server's code", () => {
  it("preview is anytime — a look, not a step owed", () => {
    const s = byKey(gatePassportPath(facts()), "preview");
    expect(s.state).toBe("anytime");
    expect(s.detail).toMatch(/exactly as the client and partners will see it/);
  });

  it("ready_for_issuance is the current step whatever the gate column says", () => {
    const s = byKey(gatePassportPath(facts({ passportState: "ready_for_issuance" })), "issue");
    expect(s.state).toBe("current");
    expect(s.detail).toMatch(/authorised decision-maker issues it/);
  });

  it("issued_current completes the path", () => {
    const steps = gatePassportPath(facts({
      gateStatus: "approved", passportState: "issued_current", passportVersion: 3,
    }));
    expect(byKey(steps, "issue").detail).toMatch(/v3 is in force/);
    expect(gatePassportComplete(steps)).toBe(true);
  });

  it("an unavailable passport reading is never read as not issued", () => {
    const s = byKey(gatePassportPath(facts({ passportState: null, gateStatus: "approved" })), "issue");
    expect(s.state).toBe("outstanding");
    expect(s.detail).toMatch(/could not be read/);
  });

  it("a caution a NEW VERSION would clear calls for a reissue", () => {
    for (const [code, reason] of [
      ["refresh_required", "material_inputs_changed"],
      ["superseded", "all_versions_superseded"],
    ] as const) {
      const s = byKey(gatePassportPath(facts({
        passportState: code, passportReasons: [reason],
      })), "issue");
      expect(s.state, code).toBe("current");
      expect(s.detail, code).toMatch(/newer version is needed/);
    }
  });

  it("with no reasons at all it behaves exactly as it did", () => {
    /* An older deployment sends the code and not the reasons. Reading
       silence as "the gate is the only problem" would suppress a reissue
       that IS owed, so absence falls back to the previous wording. */
    const s = byKey(gatePassportPath(facts({ passportState: "refresh_required" })), "issue");
    expect(s.state).toBe("current");
    expect(s.detail).toMatch(/newer version is needed/);
  });
});

describe("a remedy that cannot discharge the reason is never offered", () => {
  /**
   * The reported case, from production: attestation v1, issued, not
   * superseded, `refresh_required_at` NULL, zero open refresh obligations —
   * and the Passport read "Refresh required · v1" for exactly one reason,
   * `service_gate_regressed`, because the gate was `under_review`.
   *
   * Stage 9 said "a newer version is needed" and the reliance panel offered
   * "Reissue as v2". Issuing it would have superseded a perfectly good v1
   * and changed nothing, because v2 is flagged for the same reason while
   * the gate is unapproved. A loop, with an audit trail.
   */
  const gateOnly = facts({
    passportState: "refresh_required",
    passportReasons: ["service_gate_regressed"],
    passportVersion: 1,
  });

  it("never tells the operator a newer version is needed", () => {
    const s = byKey(gatePassportPath(gateOnly), "issue");
    expect(s.detail).not.toMatch(/newer version is needed/);
    expect(s.detail).toMatch(/no new version is needed/i);
    expect(s.detail).toMatch(/v1 is issued/);
  });

  it("the issuance debt is DISCHARGED — a version exists", () => {
    /* Leaving it outstanding counts one fact twice: the gate step already
       carries "the gate is not approved". That double count is why "one
       step left" could never fire, which is the missing distinction that
       was reported. */
    const s = byKey(gatePassportPath(gateOnly), "issue");
    expect(s.state).toBe("done");
    expect(s.label).toBe("Passport issued");
  });

  it("but the STAGE is not complete — the gate is still owed", () => {
    const steps = gatePassportPath(gateOnly);
    expect(gatePassportComplete(steps)).toBe(false);
    expect(byKey(steps, "gate").state).toBe("current");
  });

  it("and approving the gate completes it outright", () => {
    /* The server re-derives `issued_current` the moment the gate is
       approved — `service_gate_regressed` was the only reason. So the
       promise the card makes ("completing it finishes this stage") is one
       the product actually keeps. */
    const steps = gatePassportPath(facts({
      gateStatus: "approved", passportState: "issued_current",
      passportReasons: ["current_attestation_gate_approved"], passportVersion: 1,
    }));
    expect(gatePassportComplete(steps)).toBe(true);
  });

  it("a gate reason ALONGSIDE a document reason still calls for the reissue", () => {
    const s = byKey(gatePassportPath(facts({
      passportState: "refresh_required",
      passportReasons: ["service_gate_regressed", "open_refresh_obligation"],
    })), "issue");
    expect(s.state).toBe("current");
    expect(s.detail).toMatch(/newer version is needed/);
  });
});

describe("the path counts itself, and says what finishes the stage", () => {
  it("`anytime` is excluded — a look is not a debt", () => {
    const p = gatePassportProgress(gatePassportPath(facts({
      gateStatus: "approved", passportState: "issued_current",
    })));
    // decision + gate + issue. Preview is not counted.
    expect(p.total).toBe(3);
    expect(p.done).toBe(3);
    expect(p.complete).toBe(true);
    expect(p.remaining).toBe(0);
  });

  it("one owed step left, and it is the gate — so it finishes the stage", () => {
    const p = gatePassportProgress(gatePassportPath(facts({
      passportState: "refresh_required",
      passportReasons: ["service_gate_regressed"],
      passportVersion: 1,
    })));
    expect(p.remaining).toBe(1);
    expect(p.next?.key).toBe("gate");
    expect(p.finishesStage).toBe(true);
  });

  it("a BLOCKED last step never promises a completion this operator cannot deliver", () => {
    const p = gatePassportProgress(gatePassportPath(facts({
      passportState: "refresh_required",
      passportReasons: ["service_gate_regressed"],
      canReview: false,
    })));
    expect(p.remaining).toBe(1);
    expect(p.next?.state).toBe("blocked");
    expect(p.finishesStage).toBe(false);
  });

  it("two owed steps is not one — the promise is exact or absent", () => {
    const p = gatePassportProgress(gatePassportPath(facts({
      passportState: "refresh_required",
      passportReasons: ["material_inputs_changed"],
    })));
    expect(p.remaining).toBe(2);
    expect(p.finishesStage).toBe(false);
  });
});

describe("wired at the source", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  const journey = readFileSync("src/lib/aml/journeyModel.ts", "utf8");
  const workspace = readFileSync("src/pages/aml/AmlCaseWorkspace.tsx", "utf8");
  const passports = readFileSync("src/pages/aml/AmlPassports.tsx", "utf8");

  it("the stage's primary button carries a type the workspace handles — and lands where the act is", () => {
    expect(journey).toContain('actionType: "record_gate"');
    expect(workspace).toContain('case "record_gate":');
    /* It goes to the DECISION stage now. The gate is granted by the cleared
       decision, so a cleared case still holding an open gate is one an MLRO
       stopped or one decided before that change — and both are recorded on
       the Decision stage's full gate card. Landing on a card Stage 9 no
       longer mounts is the dead-button class this label escaped once. */
    expect(journey).toMatch(/section: "risk", actionType: "record_gate"/);
    expect(workspace).toContain('document.getElementById("decision-step-gate")');
  });

  it("Stage 9 owes no gate act at all — and the approval card is DELETED", () => {
    /* It asked a reviewer to decide again what they had just decided, with
       a second reason, behind a button that was disabled while it still
       read "Approve the gate — Approved". A dormant component is one import
       away from putting it back. */
    expect(workspace).not.toContain("GateApprovalCard");
    expect(workspace).not.toContain('anchorId="aml-passport-gate"');
    expect(() => read("src/components/aml/GateApprovalCard.tsx")).toThrow();
    // Nor may the Decision stage's full card be duplicated onto Stage 9.
    expect(workspace).not.toContain("ServiceGateCardStandalone");
    expect(workspace).not.toContain("AmlServiceReadinessCard");
  });

  it("preview deep-links the passport hub to THIS case, and the hub honours it", () => {
    expect(workspace).toContain("/admin/aml/passport?case=${caseRow.id}");
    expect(passports).toContain('searchParams.get("case")');
    // An unknown id falls back to the first row, never a blank selection.
    expect(passports).toMatch(/some\(\(r\) => r\.id === requestedCaseId\)/);
  });

  it("Stage 9's count is said ONCE, by the path", () => {
    /* The header rendered "0 of 3 items on this stage complete" and the rail
       rendered "0 of 3 items complete" beside a four-step list. Both were
       true and neither was about the list underneath them — the same defect
       Stage 5 already fixed. */
    expect(workspace).toMatch(/deferToSurfaceBelow=\{[\s\S]{0,200}section === "passport"/);
    expect(workspace).toMatch(/deferReadinessToSurfaceBelow=\{[\s\S]{0,200}section === "passport"/);
  });

  it("the SERVER's reasons reach the path — the code alone cannot tell them apart", () => {
    expect(workspace).toContain("passportReasons: facts.passport?.state?.reasons ?? null");
  });

  it("the issue step lands on the reliance panel where issuance lives", () => {
    expect(workspace).toContain('id="aml-passport-issue"');
    expect(workspace).toContain('getElementById("aml-passport-issue")');
  });
});
