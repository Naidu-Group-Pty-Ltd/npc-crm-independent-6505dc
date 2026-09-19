/**
 * Reopening a closed AML/CTF case.
 *
 * ── Why there was no way back ─────────────────────────────────────────
 * `TRANSITIONS` declares `closed: []`. Closed was terminal, so no operation
 * anywhere could move a case out of it. Opening a closed client showed
 * Stage 1, "Case closed", and nothing to press — because there genuinely was
 * nothing to press.
 *
 * ── The invariant ─────────────────────────────────────────────────────
 * Reopening restores the ABILITY TO WORK the case. It does not restore
 * PERMISSION TO SERVE. A terminated gate and a revoked passport were
 * deliberate acts by a person, and quietly reversing them because somebody
 * wanted to correct a mis-click is the dangerous version of this feature.
 *
 * That is the first describe block, and it is the one that must never bend.
 */
import { describe, expect, it } from "vitest";

import {
  planCaseReopen,
  resumeStatusFor,
  type CaseReopenFacts,
} from "../../../supabase/functions/_shared/aml/caseReopen.pure";

const NOW = "2026-08-16T12:00:00.000Z";
const daysAgo = (d: number) =>
  new Date(Date.parse(NOW) - d * 24 * 60 * 60 * 1000).toISOString();

const CURRENT = {
  aml_ctf_program: "2026.2",
  privacy_notice: "2026.2",
};

const facts = (over: Partial<CaseReopenFacts> = {}): CaseReopenFacts => ({
  caseId: "c1", caseReference: "AML-2026-00005",
  status: "closed", serviceGateStatus: "terminated",
  consents: [
    { kind: "aml_ctf_program", version: "2026.2" },
    { kind: "privacy_notice", version: "2026.2" },
  ],
  currentConsentVersions: CURRENT,
  hasPortalUser: true,
  screening: [{ state: "completed", lastScreenedAt: daysAgo(2) }],
  roles: ["mlro"],
  reason: "Client returned to complete the purchase after a six-week pause.",
  now: NOW,
  ...over,
});

/* ═════════ The invariant: a reopen is not a re-approval ═════════ */

describe("reopening restores the journey, never the decision", () => {
  it("leaves a terminated service gate terminated, and says why", () => {
    const p = planCaseReopen(facts({ serviceGateStatus: "terminated" }));
    expect(p.allowed).toBe(true);
    expect(p.notRestored.join(" ")).toMatch(/service gate stays terminated/i);
    expect(p.notRestored.join(" ")).toMatch(/not permission to serve/i);
  });

  it("leaves a blocked gate blocked", () => {
    const p = planCaseReopen(facts({ serviceGateStatus: "blocked" }));
    expect(p.notRestored.join(" ")).toMatch(/service gate stays blocked/i);
  });

  it("never re-mints a passport", () => {
    // A passport is evidence held by a third party.
    const p = planCaseReopen(facts());
    expect(p.notRestored.join(" ")).toMatch(/passport stays as it is/i);
    expect(p.notRestored.join(" ")).toMatch(/not re-minted/i);
  });

  it("says what is NOT restored even when the gate was never terminated", () => {
    const p = planCaseReopen(facts({ serviceGateStatus: "cdd_incomplete" }));
    expect(p.notRestored.length).toBeGreaterThan(0);
  });
});

/* ═════════ Nothing already gathered is thrown away ═════════ */

describe("the client is not made to start again", () => {
  it("names what survives, so nobody fears losing it", () => {
    const p = planCaseReopen(facts());
    const kept = p.preserved.join(" ");
    expect(kept).toMatch(/document/i);
    expect(kept).toMatch(/verification/i);
    expect(kept).toMatch(/determinations/i);
    expect(kept).toMatch(/questionnaire/i);
    // Including the closure itself — the audit chain is not rewritten.
    expect(kept).toMatch(/including the closure/i);
  });

  it("resumes from the evidence that exists rather than stage one", () => {
    expect(resumeStatusFor({
      hasSubmission: true, hasCompletedScreening: true, hasRiskAssessment: true,
    })).toBe("under_review");
    expect(resumeStatusFor({
      hasSubmission: true, hasCompletedScreening: false, hasRiskAssessment: false,
    })).toBe("kyc_complete");
    expect(resumeStatusFor({
      hasSubmission: false, hasCompletedScreening: false, hasRiskAssessment: false,
    })).toBe("kyc_in_progress");
  });

  it("does not claim screening is complete just because it once ran", () => {
    // A resumed case with stale screening still refreshes it.
    const p = planCaseReopen(facts({
      screening: [{ state: "completed", lastScreenedAt: daysAgo(200) }],
    }));
    expect(p.reissue).toContain("screening_refresh");
  });
});

/* ═════════ What has to be re-established ═════════ */

describe("re-establishing the client link", () => {
  it("always reissues portal access", () => {
    // Access is revoked on close, so the customer cannot reach a journey they
    // are being asked to resume.
    expect(planCaseReopen(facts()).reissue).toContain("portal_access");
    expect(planCaseReopen(facts({ hasPortalUser: false })).reissue).toContain("portal_access");
  });

  it("always requires a fresh risk assessment", () => {
    expect(planCaseReopen(facts()).reissue).toContain("risk_reassessment");
  });
});

describe("consents are re-asked only when they have actually moved", () => {
  it("does not re-ask for a consent still on the current version", () => {
    // Asking a customer to re-tick an unchanged document is friction with no
    // compliance value.
    const p = planCaseReopen(facts());
    expect(p.staleConsents).toEqual([]);
    expect(p.reissue).not.toContain("consents");
  });

  it("re-asks when the programme version has moved on", () => {
    const p = planCaseReopen(facts({
      currentConsentVersions: { ...CURRENT, aml_ctf_program: "2027.1" },
    }));
    expect(p.staleConsents).toEqual(["aml_ctf_program"]);
    expect(p.reissue).toContain("consents");
  });

  it("re-asks for a consent that was never given", () => {
    const p = planCaseReopen(facts({ consents: [] }));
    expect(p.staleConsents.sort()).toEqual(["aml_ctf_program", "privacy_notice"]);
  });

  it("re-asks when the accepted version was not recorded", () => {
    // An acceptance with no version cannot evidence WHAT was accepted.
    const p = planCaseReopen(facts({
      consents: [{ kind: "aml_ctf_program", version: null },
        { kind: "privacy_notice", version: "2026.2" }],
    }));
    expect(p.staleConsents).toEqual(["aml_ctf_program"]);
  });
});

describe("screening freshness", () => {
  it("does not refresh a recent result", () => {
    expect(planCaseReopen(facts()).reissue).not.toContain("screening_refresh");
  });

  it("refreshes a result older than the window", () => {
    expect(planCaseReopen(facts({
      screening: [{ state: "completed", lastScreenedAt: daysAgo(91) }],
    })).reissue).toContain("screening_refresh");
  });

  it("refreshes a subject that was never screened", () => {
    expect(planCaseReopen(facts({
      screening: [{ state: "not_started", lastScreenedAt: null }],
    })).reissue).toContain("screening_refresh");
  });

  it("asks for nothing when there are no subjects to refresh", () => {
    expect(planCaseReopen(facts({ screening: [] })).reissue)
      .not.toContain("screening_refresh");
  });

  it("honours a configured window", () => {
    const p = planCaseReopen(facts({
      screening: [{ state: "completed", lastScreenedAt: daysAgo(40) }],
      screeningFreshnessDays: 30,
    }));
    expect(p.reissue).toContain("screening_refresh");
  });
});

/* ═════════ Authority and the recorded reason ═════════ */

describe("who may reopen, and why", () => {
  it("refuses a case that is not closed", () => {
    for (const status of ["kyc_in_progress", "cleared", "blocked"]) {
      const p = planCaseReopen(facts({ status }));
      expect(p.allowed, status).toBe(false);
      expect(p.code).toBe("not_closed");
      expect(p.summary).toMatch(/nothing to reopen/i);
    }
  });

  it("requires a reviewer, the MLRO or an administrator", () => {
    for (const roles of [[], ["analyst"], ["viewer"]]) {
      expect(planCaseReopen(facts({ roles })).code, roles.join()).toBe("role_required");
    }
    for (const roles of [["reviewer"], ["mlro"], ["admin"], ["superadmin"]]) {
      expect(planCaseReopen(facts({ roles })).allowed, roles.join()).toBe(true);
    }
  });

  it("requires a written reason, because an auditor will read it", () => {
    for (const reason of [null, "", "   ", "fix"]) {
      const p = planCaseReopen(facts({ reason }));
      expect(p.allowed, String(reason)).toBe(false);
      expect(p.code).toBe("reason_required");
    }
  });

  it("checks the case state before the role, so the message is the useful one", () => {
    // An analyst looking at an open case should be told it is not closed,
    // not that they lack a role they would not need anyway.
    expect(planCaseReopen(facts({ status: "cleared", roles: ["analyst"] })).code)
      .toBe("not_closed");
  });

  it("always produces a summary", () => {
    for (const over of [
      {}, { status: "cleared" }, { roles: [] }, { reason: null },
    ] as Array<Partial<CaseReopenFacts>>) {
      expect(planCaseReopen(facts(over)).summary).toBeTruthy();
    }
  });
});
