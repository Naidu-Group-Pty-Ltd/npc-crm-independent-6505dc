/**
 * Resetting a client journey, and the records that must survive it.
 *
 * ── What made this necessary ──────────────────────────────────────────
 * `aml.cases.client_id` is `ON DELETE SET NULL`, measured in production. So
 * deleting a client neither fails nor cascades — it ORPHANS the AML case.
 * The customer vanishes from the register while the case, its screening
 * subjects, its determinations, its documents and its event chain remain,
 * attached to nobody.
 *
 * That is the worst outcome available: the operator believes the data is
 * gone, and the compliance record is now unattributable.
 *
 * So the safeguard is not a confirmation dialog. It is that the system knows
 * what it is holding and refuses on its own — the first describe block.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  AML_PURGE_ORDER,
  AML_UNLINKED_CASE_TABLES,
  decideClientReset,
  retentionBlockers,
  type CaseRetentionFacts,
  type ClientResetFacts,
} from "../../../supabase/functions/_shared/aml/clientResetPolicy.pure";

const cleanCase = (over: Partial<CaseRetentionFacts> = {}): CaseRetentionFacts => ({
  caseId: "c1", caseReference: "AML-2026-00005",
  hasSubmittedReport: false, hasServiceGateDecision: false,
  hasConfirmedMatch: false, hasIssuedPassport: false,
  underLegalHold: false, hasMlroDecision: false,
  ...over,
});

const facts = (over: Partial<ClientResetFacts> = {}): ClientResetFacts => ({
  clientId: "cl-1", clientName: "Rugesh Naidu",
  cases: [cleanCase()],
  typedConfirmation: "Rugesh Naidu",
  roles: ["mlro"],
  requestedMode: "purge",
  ...over,
});

/* ═════════════ Evidence that must never be deleted ═════════════ */

describe("a purge refuses on anything that must be retained", () => {
  const EVIDENCE: Array<[keyof CaseRetentionFacts, RegExp]> = [
    ["underLegalHold", /legal hold/i],
    ["hasSubmittedReport", /regulatory report/i],
    ["hasConfirmedMatch", /confirmed screening match/i],
    ["hasServiceGateDecision", /service-gate decision/i],
    ["hasMlroDecision", /MLRO decision/i],
    ["hasIssuedPassport", /passport/i],
  ];

  it.each(EVIDENCE)("refuses when %s is present", (flag, reason) => {
    const d = decideClientReset(facts({ cases: [cleanCase({ [flag]: true })] }));
    expect(d.allowed).toBe(false);
    expect(d.code).toBe("retention_evidence");
    expect(d.blockers.join(" ")).toMatch(reason);
  });

  it("names every blocking record, not just the first", () => {
    // An operator who is refused deserves to know which record is holding it
    // — usually the thing they had forgotten existed.
    const d = decideClientReset(facts({
      cases: [cleanCase({
        underLegalHold: true, hasSubmittedReport: true, hasConfirmedMatch: true,
      })],
    }));
    expect(d.blockers.length).toBeGreaterThanOrEqual(3);
  });

  it("names the case reference on every blocker", () => {
    const d = decideClientReset(facts({
      cases: [cleanCase({ caseReference: "AML-2026-00009", hasSubmittedReport: true })],
    }));
    expect(d.blockers.every((b) => b.includes("AML-2026-00009"))).toBe(true);
  });

  it("checks every case, not only the first", () => {
    const d = decideClientReset(facts({
      cases: [cleanCase(), cleanCase({ caseId: "c2", caseReference: "AML-2", underLegalHold: true })],
    }));
    expect(d.allowed).toBe(false);
    expect(d.blockers.join(" ")).toContain("AML-2");
  });

  it("offers the safe alternative rather than a dead end", () => {
    const d = decideClientReset(facts({ cases: [cleanCase({ hasIssuedPassport: true })] }));
    expect(d.summary).toMatch(/Restart the journey instead/i);
    expect(d.summary).toMatch(/without destroying the record/i);
  });

  it("allows a purge only when the case carries none of it", () => {
    const d = decideClientReset(facts());
    expect(d.allowed).toBe(true);
    expect(d.blockers).toEqual([]);
    expect(retentionBlockers(cleanCase())).toEqual([]);
  });
});

/* ═════════════ Restart destroys nothing, so it is always available ═══════ */

describe("restart is the compliance-correct way to start again", () => {
  it("is permitted even when a purge is refused", () => {
    // The case that matters: a real customer with real evidence, where the
    // operator still legitimately needs a fresh journey.
    const blocked = facts({
      cases: [cleanCase({ hasSubmittedReport: true, underLegalHold: true })],
    });
    expect(decideClientReset(blocked).allowed).toBe(false);
    expect(decideClientReset({ ...blocked, requestedMode: "restart" }).allowed).toBe(true);
  });

  it("says plainly that nothing is deleted", () => {
    const d = decideClientReset(facts({ requestedMode: "restart" }));
    expect(d.effects.join(" ")).toMatch(/nothing is deleted/i);
    expect(d.effects.join(" ")).toMatch(/revoked/i);
  });

  it("states the irreversibility of a purge before it happens", () => {
    const d = decideClientReset(facts());
    expect(d.effects.join(" ")).toMatch(/cannot be undone/i);
    expect(d.effects.join(" ")).toMatch(/purge receipt/i);
  });
});

/* ═════════════ Authority and confirmation ═════════════ */

describe("who may reset, and how they confirm", () => {
  it("requires the MLRO or an administrator", () => {
    for (const roles of [[], ["analyst"], ["reviewer"], ["viewer"]]) {
      const d = decideClientReset(facts({ roles }));
      expect(d.allowed, roles.join()).toBe(false);
      expect(d.code).toBe("role_required");
    }
    for (const roles of [["mlro"], ["admin"], ["superadmin"], ["analyst", "admin"]]) {
      expect(decideClientReset(facts({ roles })).allowed, roles.join()).toBe(true);
    }
  });

  it("requires the typed name for a restart too, not only a purge", () => {
    // Restarting closes real cases. That is not a mis-click either.
    const d = decideClientReset(facts({ requestedMode: "restart", typedConfirmation: null }));
    expect(d.allowed).toBe(false);
    expect(d.code).toBe("confirmation_mismatch");
  });

  it("rejects a near-miss confirmation", () => {
    for (const typed of ["Rugesh", "Rugesh Naidoo", "", null, "  "]) {
      expect(decideClientReset(facts({ typedConfirmation: typed })).allowed, String(typed))
        .toBe(false);
    }
  });

  it("is tolerant of case and spacing, because a name is not a password", () => {
    for (const typed of ["rugesh naidu", "  Rugesh   Naidu  ", "RUGESH NAIDU"]) {
      expect(decideClientReset(facts({ typedConfirmation: typed })).allowed, typed).toBe(true);
    }
  });

  it("still shows what would happen while the confirmation is wrong", () => {
    // The operator needs to read the consequences before typing the name,
    // not after.
    const d = decideClientReset(facts({ typedConfirmation: null }));
    expect(d.effects.length).toBeGreaterThan(0);
  });

  it("refuses an unresolved client before anything else", () => {
    expect(decideClientReset(facts({ clientId: "", roles: ["mlro"] })).code)
      .toBe("unknown_client");
    expect(decideClientReset(facts({ clientName: "" })).code).toBe("unknown_client");
  });
});

/* ═════════════ The column names, which were wrong three times ═════════════ */

describe("the operation reads columns that exist", () => {
  /*
   * Every one of these was wrong in the first version, and every one failed
   * INVISIBLY. PostgREST answers `undefined` for a column that does not
   * exist exactly as it does for one that is empty, and this operation's
   * error paths all fail closed — so a mistyped name did not surface as a
   * bug, it surfaced as a safety rule working perfectly:
   *
   *   clients.first_name / last_name   → do not exist (primary_first_name,
   *                                      primary_surname). `client` came
   *                                      back null and the policy answered
   *                                      `unknown_client` to EVERY request.
   *
   *   report_submissions.case_id       → does not exist. The probe errored,
   *                                      the fail-closed branch read it as
   *                                      "every case has a filed report",
   *                                      and every purge was refused for
   *                                      ever.
   *
   *   client_portal_users.is_active    → does not exist (status). The update
   *                                      was refused, the unchecked result
   *                                      discarded the error, and the
   *                                      customer kept a live login.
   *
   * Verified against the production schema on 2026-08-16. This test reads
   * the edge source so a regression is caught here rather than by an
   * operator who cannot delete a client and is told nothing about why.
   */
  // Vitest rewrites `import.meta.url` to a non-file scheme, so resolve from
  // the working directory — the same way the other source guards do.
  const source = readFileSync(
    join(process.cwd(), "supabase/functions/aml-cases/index.ts"), "utf8");
  const op = source.slice(
    source.indexOf("case 'reset_client_journey': {"),
    source.indexOf("case 'list_party_screening': {"),
  );

  it("finds the operation", () => {
    expect(op.length).toBeGreaterThan(500);
  });

  it("reads the client's name from the columns clients has", () => {
    expect(op).toContain("primary_first_name");
    expect(op).toContain("primary_surname");
  });

  /*
   * Asserted against CODE, not prose. The comments in that operation name
   * the wrong columns deliberately — recording what the mistake was is the
   * point of them — so a bare source-wide `not.toContain` would fail on the
   * explanation of the very bug it is guarding.
   */
  const code = op.split("\n")
    .filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l))
    .join("\n");

  it("probes aml.reports rather than report_submissions", () => {
    expect(code).toContain("probe('reports'");
    expect(code).not.toContain("report_submissions");
  });

  it("revokes portal access through status, never a column that does not exist", () => {
    expect(code).toContain("status: 'disabled'");
    expect(code).not.toMatch(/is_active/);
  });

  it("does not silently discard a failed client read", () => {
    // The whole class of defect above is an unchecked result. This one is
    // the gate on everything after it, so it must be checked.
    expect(op).toContain("clientReadError");
  });

  it("verifies nothing was orphaned before deleting the client", () => {
    // The list is a constant and the schema is not. A re-count is the only
    // thing that catches a table nobody thought of.
    expect(op).toContain("orphan_risk");
    expect(op.indexOf("orphan_risk")).toBeLessThan(op.indexOf("from('clients').delete()"));
  });
});

/* ═════════════ Nothing may outlive its case ═════════════ */

describe("what the cascade will not take", () => {
  /*
   * Read from the production FK graph on 2026-08-16:
   *
   *   confdeltype 'c' (CASCADE)   47 constraints
   *   confdeltype 'n' (SET NULL)   2 — legal_holds, reports
   *   no constraint at all         8 — a case_id column and nothing behind it
   *
   * The first version of this list enumerated seventeen tables it believed
   * were the case's children. Twelve of them cascade anyway, and it missed
   * three of the eight that do not. It read as complete and was not, which
   * is the only failure mode that matters here.
   */
  const NO_FOREIGN_KEY = [
    "party_screening_subjects", "pep_determinations", "party_verification_links",
    "party_field_provenance", "party_reconciliation_items", "idv_evidence_references",
    "reliance_access_log", "transaction_obligations",
  ];
  const SET_NULL = ["legal_holds", "reports"];

  it("names every table Postgres will not cascade", () => {
    // A table missing here is a row that outlives its case — the exact
    // orphaning this whole feature exists to prevent.
    for (const table of [...NO_FOREIGN_KEY, ...SET_NULL]) {
      expect(AML_UNLINKED_CASE_TABLES, table).toContain(table);
    }
  });

  it("names nothing the cascade already handles", () => {
    // Listing a cascading table is not harmless: it is what made the first
    // list look exhaustive while it was missing three real orphans.
    for (const table of [
      "screening_checks", "screening_matches", "case_events", "documents",
      "document_requirements", "questionnaire_responses", "submission_versions",
      "consents", "risk_assessments", "client_requests", "verification_checks",
      "decisions", "service_gate_decisions",
    ]) {
      expect(AML_UNLINKED_CASE_TABLES, table).not.toContain(table);
    }
  });

  it("never deletes the two tables that survive a case by design", () => {
    // SET NULL on legal_holds and reports is a retention decision somebody
    // made on purpose. The purge must SEE them and must not remove them.
    for (const table of SET_NULL) {
      expect(AML_UNLINKED_CASE_TABLES).toContain(table);
      expect(AML_PURGE_ORDER, table).not.toContain(table);
    }
  });

  it("deletes exactly the unconstrained tables and nothing else", () => {
    expect([...AML_PURGE_ORDER].sort()).toEqual([...NO_FOREIGN_KEY].sort());
  });

  it("never deletes the case row through this list", () => {
    // The case is deleted separately, after these, so the cascade fires with
    // the unlinked rows already gone.
    expect(AML_PURGE_ORDER).not.toContain("cases");
    expect(AML_UNLINKED_CASE_TABLES).not.toContain("cases");
  });

  it("lists each table once", () => {
    expect(new Set(AML_UNLINKED_CASE_TABLES).size).toBe(AML_UNLINKED_CASE_TABLES.length);
    expect(new Set(AML_PURGE_ORDER).size).toBe(AML_PURGE_ORDER.length);
  });
});
