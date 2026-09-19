/**
 * Tests for the AML workspace view model.
 *
 * Two things these tests are really guarding:
 *
 *  1. The derivations are a *reading* of canonical state. A low risk rating,
 *     a passed identity check and a tidy compliance summary must never add
 *     up to an approved service gate — only `service_gate_status` decides
 *     that, and only a person moves it.
 *
 *  2. Missing facts read as missing. When an evidence read fails, the
 *     workspace must say "not available", not "complete" and not "no action
 *     required".
 */
import { describe, expect, it } from "vitest";

import { CASE_STAGES, SERVICE_GATE_STATUSES, type AmlCaseStage } from "./caseDimensions";
import {
  AREA_SECTIONS,
  MACRO_PHASES,
  STAGE_TO_MACRO_PHASE,
  WORKSPACE_AREAS,
  WORKSPACE_SECTIONS,
  areaForSection,
  defaultSectionForArea,
  deriveAmlCaseAttention,
  deriveAmlComplianceSummary,
  deriveAmlConnectedPortals,
  deriveAmlMacroPhase,
  deriveAmlNextAction,
  deriveAmlOutstandingItems,
  deriveAmlServiceReadiness,
  deriveAmlWorkspaceSummary,
  highestAttention,
  isWorkspaceSection,
  serviceReadinessLabel,
  type AmlWorkspaceCaseFacts,
  type AmlWorkspaceFacts,
} from "./workspaceViewModel";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const caseRow = (over: Partial<AmlWorkspaceCaseFacts> = {}): AmlWorkspaceCaseFacts => ({
  id: "case-1",
  case_reference: "AML-2026-00184",
  subject_display_name: "Sarah Williams",
  subject_type: "individual",
  status: "under_review",
  case_stage: "staff_review",
  service_gate_status: "under_review",
  client_portal_status: "under_review",
  risk_rating: "medium",
  ...over,
});

/** A reading with every evidence stream loaded and nothing outstanding. */
const quietFacts = (over: Partial<AmlWorkspaceFacts> = {}): AmlWorkspaceFacts => ({
  caseRow: caseRow({ case_stage: "cleared", status: "cleared", service_gate_status: "approved" }),
  openClientRequests: 0,
  identity: { checks: [{ status: "passed", processing_status: "completed" }] },
  screening: { subjects: [{ state: "completed", required: true, matches: [] }] },
  monitoring: {
    monitoring_status: "active",
    open_alerts: [],
    open_edd: [],
    open_reviews: [],
    overdue_review_count: 0,
    rescreen_overdue: false,
  },
  gate: { status: "approved", conditions: [], effective_at: "2026-08-01T00:00:00Z" },
  documents: { requirements: [{ label: "Passport", required: true, status: "accepted" }] },
  ownership: { links: [] },
  funding: { sources: [{ verified: true, source_type: "salary" }] },
  ...over,
});

/* ------------------------------------------------------------------ */
/* Information architecture                                            */
/* ------------------------------------------------------------------ */

describe("information architecture", () => {
  it("assigns every section to exactly one of the five areas", () => {
    const assigned = WORKSPACE_AREAS.flatMap((a) => [...AREA_SECTIONS[a]]);
    expect([...assigned].sort()).toEqual([...WORKSPACE_SECTIONS].sort());
    expect(new Set(assigned).size).toBe(assigned.length);
  });

  it("resolves a section back to its area and an area to a real section", () => {
    expect(areaForSection("identity")).toBe("customer");
    expect(areaForSection("finance")).toBe("transaction");
    expect(areaForSection("risk")).toBe("decision");
    expect(areaForSection("timeline")).toBe("records");
    expect(areaForSection("overview")).toBe("overview");
    for (const area of WORKSPACE_AREAS) {
      expect(WORKSPACE_SECTIONS).toContain(defaultSectionForArea(area));
      expect(areaForSection(defaultSectionForArea(area))).toBe(area);
    }
  });

  it("keeps every section key the previous workspace deep-linked to", () => {
    // ?section=<key> links that worked before must still resolve.
    for (const legacy of [
      "overview", "identity", "ownership", "counterparty", "finance",
      "documents", "submission-review", "risk", "monitoring", "requests", "timeline",
    ]) {
      expect(isWorkspaceSection(legacy)).toBe(true);
    }
    expect(isWorkspaceSection("nope")).toBe(false);
    expect(isWorkspaceSection(null)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Macro phase                                                         */
/* ------------------------------------------------------------------ */

describe("deriveAmlMacroPhase", () => {
  it("maps every canonical stage to exactly one macro phase", () => {
    for (const stage of CASE_STAGES) {
      expect(MACRO_PHASES).toContain(STAGE_TO_MACRO_PHASE[stage as AmlCaseStage]);
    }
    expect(Object.keys(STAGE_TO_MACRO_PHASE).sort()).toEqual([...CASE_STAGES].sort());
  });

  it("always returns the five phases in order", () => {
    for (const stage of CASE_STAGES) {
      const { phases } = deriveAmlMacroPhase({ caseRow: caseRow({ case_stage: stage }) });
      expect(phases.map((p) => p.key)).toEqual([...MACRO_PHASES]);
    }
  });

  it("marks earlier phases complete and later phases not started", () => {
    const { phase, phases } = deriveAmlMacroPhase({
      caseRow: caseRow({ case_stage: "staff_review", service_gate_status: "under_review" }),
    });
    expect(phase).toBe("assess");
    expect(phases[0].state).toBe("complete"); // collect
    expect(phases[1].state).toBe("complete"); // verify
    expect(phases[2].state).toBe("current"); // assess
    expect(phases[3].state).toBe("not_started"); // decide
    expect(phases[4].state).toBe("not_started"); // monitor
  });

  it("shows the current phase as needing attention on an information-outstanding case", () => {
    const { phases } = deriveAmlMacroPhase({
      caseRow: caseRow({ case_stage: "additional_info_required", status: "edd_required" }),
    });
    expect(phases[0].state).toBe("attention");
  });

  it("shows blocked at DECIDE when the case is blocked or the gate is locked", () => {
    const blocked = deriveAmlMacroPhase({
      caseRow: caseRow({ case_stage: "blocked", status: "blocked", service_gate_status: "locked" }),
    });
    expect(blocked.phase).toBe("decide");
    expect(blocked.phases[3].state).toBe("blocked");

    const lockedOnly = deriveAmlMacroPhase({
      caseRow: caseRow({ case_stage: "staff_review", service_gate_status: "locked" }),
    });
    expect(lockedOnly.phases[3].state).toBe("blocked");
  });

  it("completes DECIDE only from the gate, never from the stage or the risk rating", () => {
    const lowRiskNotApproved = deriveAmlMacroPhase({
      caseRow: caseRow({
        case_stage: "decision_pending",
        service_gate_status: "under_review",
        risk_rating: "low",
      }),
    });
    expect(lowRiskNotApproved.phases[3].state).not.toBe("complete");

    const approved = deriveAmlMacroPhase({
      caseRow: caseRow({
        case_stage: "cleared",
        status: "cleared",
        service_gate_status: "approved",
        risk_rating: "high",
      }),
    });
    expect(approved.phases[3].state).toBe("complete");
  });

  it("keeps MONITOR current on a closed case, because retention runs there", () => {
    const { phases } = deriveAmlMacroPhase({
      caseRow: caseRow({ case_stage: "closed", status: "closed", service_gate_status: "terminated" }),
    });
    expect(phases[4].state).toBe("current");
  });

  it("names the canonical fields it read", () => {
    const { sourceFacts } = deriveAmlMacroPhase({ caseRow: caseRow() });
    expect(sourceFacts.join(" ")).toContain("case_stage");
    expect(sourceFacts.join(" ")).toContain("service_gate_status");
  });
});

/* ------------------------------------------------------------------ */
/* Service readiness                                                   */
/* ------------------------------------------------------------------ */

describe("deriveAmlServiceReadiness", () => {
  it("covers every canonical gate value", () => {
    for (const gate of SERVICE_GATE_STATUSES) {
      const r = deriveAmlServiceReadiness({ caseRow: caseRow({ service_gate_status: gate }) });
      expect(r.gate).toBe(gate);
      expect(r.label.length).toBeGreaterThan(0);
    }
  });

  it("reads ready only from an approved gate — never from risk or evidence", () => {
    const lowRiskAllPassed = deriveAmlServiceReadiness(
      quietFacts({
        caseRow: caseRow({
          case_stage: "staff_review",
          service_gate_status: "cdd_incomplete",
          risk_rating: "low",
        }),
      }),
    );
    expect(lowRiskAllPassed.level).toBe("not_ready");
    expect(lowRiskAllPassed.reasons.join(" ")).toContain("due diligence is not complete");

    const highRiskApproved = deriveAmlServiceReadiness({
      caseRow: caseRow({ service_gate_status: "approved", risk_rating: "high" }),
    });
    expect(highRiskApproved.level).toBe("ready");
  });

  it("lists open conditions as reasons and ignores resolved ones", () => {
    const r = deriveAmlServiceReadiness({
      caseRow: caseRow({ service_gate_status: "conditions_outstanding" }),
      gate: {
        status: "conditions_outstanding",
        conditions: [
          { id: "c1", label: "Sight the original passport", status: "open" },
          { id: "c2", label: "Confirm the deposit source", status: "resolved" },
        ],
      },
    });
    expect(r.openConditions).toHaveLength(1);
    expect(r.openConditions[0].label).toBe("Sight the original passport");
    expect(r.reasons.join(" ")).toContain("1 condition outstanding");
  });

  it("says the gate contract is unavailable rather than assuming no conditions", () => {
    const r = deriveAmlServiceReadiness({ caseRow: caseRow(), gate: null });
    expect(r.unavailableFacts.join(" ")).toContain("service-gate contract");
    expect(r.openConditions).toEqual([]);
  });

  it("treats a locked gate as critical and a terminated gate as silent", () => {
    expect(
      deriveAmlServiceReadiness({ caseRow: caseRow({ service_gate_status: "locked" }) }).attention,
    ).toBe("critical");
    expect(
      deriveAmlServiceReadiness({ caseRow: caseRow({ service_gate_status: "terminated" }) }).attention,
    ).toBe("none");
  });

  it("gives the register the same reading in compact form", () => {
    expect(serviceReadinessLabel(caseRow({ service_gate_status: "approved" }))).toEqual({
      label: "Ready",
      level: "ready",
    });
    expect(serviceReadinessLabel(caseRow({ service_gate_status: "locked" })).label).toBe("Blocked");
    expect(serviceReadinessLabel(caseRow({ service_gate_status: "cdd_incomplete" })).label).toBe(
      "Not ready",
    );
  });
});

/* ------------------------------------------------------------------ */
/* Compliance summary                                                  */
/* ------------------------------------------------------------------ */

describe("deriveAmlComplianceSummary", () => {
  const row = (facts: AmlWorkspaceFacts, key: string) =>
    deriveAmlComplianceSummary(facts).rows.find((r) => r.key === key)!;

  it("reads every stream as unknown when nothing was loaded", () => {
    const summary = deriveAmlComplianceSummary({ caseRow: caseRow({ subject_type: "entity" }) });
    for (const r of summary.rows) expect(r.state).toBe("unknown");
    expect(summary.sourceFacts).toEqual([]);
    expect(summary.unavailableFacts.length).toBeGreaterThan(0);
  });

  it("separates a technical processing failure from an identity outcome", () => {
    const technical = row(
      {
        caseRow: caseRow(),
        identity: {
          checks: [{ status: "in_progress", processing_status: "technical_failure" }],
        },
      },
      "identity",
    );
    expect(technical.state).toBe("attention");
    expect(technical.detail).toContain("technical failure");

    const referred = row(
      { caseRow: caseRow(), identity: { checks: [{ status: "referred" }] } },
      "identity",
    );
    expect(referred.detail).toContain("referred");
  });

  it("reads identity complete only when every live check passed", () => {
    expect(
      row(
        {
          caseRow: caseRow(),
          identity: { checks: [{ status: "passed" }, { status: "passed" }] },
        },
        "identity",
      ).state,
    ).toBe("complete");
    expect(
      row(
        {
          caseRow: caseRow(),
          identity: { checks: [{ status: "passed" }, { status: "pending" }] },
        },
        "identity",
      ).state,
    ).toBe("in_progress");
  });

  it("ignores superseded verification checks", () => {
    const r = row(
      {
        caseRow: caseRow(),
        identity: {
          checks: [
            { status: "failed", superseded_at: "2026-01-01T00:00:00Z" },
            { status: "passed" },
          ],
        },
      },
      "identity",
    );
    expect(r.state).toBe("complete");
  });

  it("never reads a failed screening run as clear", () => {
    const r = row(
      {
        caseRow: caseRow(),
        screening: {
          subjects: [
            { state: "completed", matches: [] },
            { state: "error", error_category: "provider_timeout" },
          ],
        },
      },
      "screening",
    );
    expect(r.state).toBe("attention");
    expect(r.detail).toContain("did not complete");
  });

  it("surfaces confirmed matches above unresolved candidates", () => {
    const confirmed = row(
      {
        caseRow: caseRow(),
        screening: {
          subjects: [{ state: "confirmed_match" }, { state: "possible_match" }],
        },
      },
      "screening",
    );
    expect(confirmed.detail).toContain("confirmed");
  });

  it("counts an open canonical match even when the subject state has not caught up", () => {
    const r = row(
      {
        caseRow: caseRow(),
        screening: {
          subjects: [{ state: "completed", matches: [{ status: "open", match_type: "pep" }] }],
        },
      },
      "screening",
    );
    expect(r.state).toBe("attention");
    expect(r.detail).toContain("unresolved");
  });

  it("marks ownership not applicable for an individual and attention for an unlinked entity", () => {
    expect(
      row({ caseRow: caseRow({ subject_type: "individual" }), ownership: { links: [] } }, "ownership")
        .state,
    ).toBe("not_applicable");
    expect(
      row({ caseRow: caseRow({ subject_type: "entity" }), ownership: { links: [] } }, "ownership")
        .state,
    ).toBe("attention");
  });

  it("never claims ownership is complete — the structure summary is not loaded here", () => {
    const r = row(
      {
        caseRow: caseRow({ subject_type: "entity" }),
        ownership: { links: [{ entity_id: "e1", link_role: "subject" }] },
      },
      "ownership",
    );
    expect(r.state).toBe("in_progress");
  });

  it("reads documents from requirement status, flagging anything awaiting review", () => {
    expect(
      row(
        {
          caseRow: caseRow(),
          documents: {
            requirements: [
              { required: true, status: "accepted" },
              { required: true, status: "uploaded" },
            ],
          },
        },
        "documents",
      ).state,
    ).toBe("attention");
    expect(
      row(
        {
          caseRow: caseRow(),
          documents: {
            requirements: [
              { required: true, status: "accepted" },
              { required: true, status: "waived" },
            ],
          },
        },
        "documents",
      ).state,
    ).toBe("complete");
  });

  it("counts source-of-funds verification honestly", () => {
    expect(
      row({ caseRow: caseRow(), funding: { sources: [] } }, "funding").state,
    ).toBe("not_started");
    expect(
      row(
        { caseRow: caseRow(), funding: { sources: [{ verified: true }, { verified: false }] } },
        "funding",
      ).detail,
    ).toBe("1 of 2 verified");
  });

  it("keeps EDD visible from the stage even when monitoring could not be read", () => {
    const r = row({ caseRow: caseRow({ case_stage: "enhanced_cdd" }), monitoring: null }, "edd");
    expect(r.state).toBe("attention");
  });

  it("reports overdue monitoring work", () => {
    expect(
      row(
        {
          caseRow: caseRow(),
          monitoring: { overdue_review_count: 2, open_alerts: [], open_edd: [] },
        },
        "monitoring",
      ).detail,
    ).toContain("2 reviews overdue");
  });
});

/* ------------------------------------------------------------------ */
/* Next action                                                         */
/* ------------------------------------------------------------------ */

describe("deriveAmlNextAction", () => {
  it("puts a blocked case above everything else", () => {
    const action = deriveAmlNextAction({
      caseRow: caseRow({ case_stage: "blocked", status: "blocked", service_gate_status: "locked" }),
      openClientRequests: 3,
      screening: { subjects: [{ state: "possible_match" }] },
      identity: { checks: [{ status: "referred" }] },
      monitoring: { overdue_review_count: 5, open_alerts: [], open_edd: [] },
      documents: { requirements: [] },
      funding: { sources: [] },
    });
    expect(action.key).toBe("blocked");
    expect(action.attention).toBe("critical");
    expect(action.blocking).toBe(true);
    expect(action.section).toBe("risk");
  });

  it("ranks a confirmed screening match above an escalated decision", () => {
    const action = deriveAmlNextAction({
      caseRow: caseRow({ case_stage: "decision_pending", status: "escalated_mlro" }),
      screening: { subjects: [{ state: "confirmed_match" }] },
    });
    expect(action.key).toBe("screening_confirmed");
  });

  it("ranks an escalated decision above identity review and document review", () => {
    const action = deriveAmlNextAction({
      caseRow: caseRow({ case_stage: "decision_pending", status: "escalated_mlro" }),
      identity: { checks: [{ status: "referred" }] },
      documents: { requirements: [{ status: "uploaded" }] },
    });
    expect(action.key).toBe("mlro_decision");
  });

  it("ranks work we can do above waiting on the client", () => {
    const action = deriveAmlNextAction({
      caseRow: caseRow({ case_stage: "client_in_progress", status: "kyc_in_progress" }),
      openClientRequests: 2,
      identity: { checks: [{ status: "referred" }] },
    });
    expect(action.key).toBe("identity_referred");
  });

  it("falls through to awaiting client when nothing is with us", () => {
    const action = deriveAmlNextAction({
      caseRow: caseRow({
        case_stage: "awaiting_client",
        status: "kyc_in_progress",
        client_portal_status: "not_started",
      }),
      openClientRequests: 0,
      identity: { checks: [] },
      screening: { subjects: [] },
      monitoring: { open_alerts: [], open_edd: [], overdue_review_count: 0 },
      documents: { requirements: [] },
      // Settled, not merely empty. Zero recorded sources is now stage 6's
      // own outstanding work rather than silence the ranking walks past.
      funding: { sources: [{ verified: true }] },
    });
    expect(action.key).toBe("awaiting_client");
    expect(action.attention).toBe("waiting");
    expect(action.partial).toBe(false);
  });

  it("routes each action at the section that does the work", () => {
    expect(
      deriveAmlNextAction({
        caseRow: caseRow({ case_stage: "client_submitted", status: "kyc_complete" }),
      }).section,
    ).toBe("submission-review");
    // Screening is Stage 5 (`ownership`), not Stage 3. Every screening
    // action used to route at `identity`, so an MLRO told to resolve a match
    // was sent to Identity verification.
    expect(
      deriveAmlNextAction({
        caseRow: caseRow(),
        screening: { subjects: [{ state: "possible_match" }] },
      }).section,
    ).toBe("ownership");
  });

  it("is deterministic — the same facts always give the same answer", () => {
    const facts: AmlWorkspaceFacts = {
      caseRow: caseRow({ case_stage: "staff_review" }),
      openClientRequests: 1,
      identity: { checks: [{ status: "referred" }] },
      screening: { subjects: [{ state: "error" }] },
      documents: { requirements: [{ status: "uploaded" }] },
      monitoring: { overdue_review_count: 1, open_alerts: [], open_edd: [] },
      funding: { sources: [{ verified: false }] },
    };
    const runs = Array.from({ length: 5 }, () => deriveAmlNextAction(facts).key);
    expect(new Set(runs).size).toBe(1);
    // Was `screening_error`, because the winner used to be the first rule
    // that fired in AUTHORSHIP order. Candidates are now ranked by journey
    // position, and the referred identity check at Stage 3 comes before the
    // screening error at Stage 5 — which is the order the journey is walked.
    expect(runs[0]).toBe("identity_referred");
  });

  it("says the reading is partial rather than claiming no action when facts are missing", () => {
    const action = deriveAmlNextAction({
      caseRow: caseRow({ case_stage: "cleared", status: "cleared", service_gate_status: "approved" }),
    });
    expect(action.key).toBe("review_case");
    expect(action.partial).toBe(true);
    expect(action.unavailableFacts).toContain("verification checks");
  });

  it("says no action required only when the reading was complete", () => {
    const action = deriveAmlNextAction(quietFacts());
    expect(action.key).toBe("none");
    expect(action.partial).toBe(false);
    expect(action.attention).toBe("none");
  });

  it("reports a closed case as closed rather than ranking work on it", () => {
    const action = deriveAmlNextAction({
      caseRow: caseRow({ case_stage: "closed", status: "closed", service_gate_status: "terminated" }),
      openClientRequests: 4,
    });
    expect(action.label).toBe("Case closed");
    expect(action.blocking).toBe(false);
  });

  it("always names the facts it used", () => {
    const action = deriveAmlNextAction({
      caseRow: caseRow(),
      screening: { subjects: [{ state: "possible_match" }] },
    });
    expect(action.sourceFacts.length).toBeGreaterThan(0);
    expect(action.sourceFacts.join(" ")).toContain("party screening");
  });

  it("only ever suggests an existing action vocabulary", () => {
    const known = new Set([
      "screening_adjudication",
      "mlro_decision",
      "identity_review",
      "retry_processing",
      "review_submission",
      "review_document",
      "client_request",
      // `closed` is terminal in the transition table by design, so reopening
      // is its own authorised server operation rather than a status edit.
      // It belongs in this vocabulary because it IS one — the guard exists to
      // stop the next action suggesting something the system cannot perform.
      "reopen_case",
      undefined,
    ]);
    for (const stage of CASE_STAGES) {
      const action = deriveAmlNextAction({ caseRow: caseRow({ case_stage: stage }) });
      expect(known.has(action.actionType)).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Outstanding items                                                   */
/* ------------------------------------------------------------------ */

describe("deriveAmlOutstandingItems", () => {
  it("lists the runners-up without repeating the headline action", () => {
    const facts: AmlWorkspaceFacts = {
      caseRow: caseRow({ case_stage: "staff_review" }),
      openClientRequests: 1,
      identity: { checks: [{ status: "referred" }] },
      documents: { requirements: [{ status: "uploaded" }] },
    };
    const next = deriveAmlNextAction(facts);
    const items = deriveAmlOutstandingItems(facts, { exclude: next.key });
    expect(items.map((i) => i.key)).not.toContain(next.key);
    expect(items.map((i) => i.key)).toContain("documents_review");
    expect(items.map((i) => i.key)).toContain("awaiting_client_request");
  });

  it("is empty on a quiet case", () => {
    expect(deriveAmlOutstandingItems(quietFacts())).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Register attention                                                  */
/* ------------------------------------------------------------------ */

describe("deriveAmlCaseAttention", () => {
  it("produces a reading for every canonical stage", () => {
    for (const stage of CASE_STAGES) {
      const a = deriveAmlCaseAttention(caseRow({ case_stage: stage, risk_rating: "low" }));
      expect(a.label.length).toBeGreaterThan(0);
      expect(a.detail.length).toBeGreaterThan(0);
    }
  });

  it("flags blocked and prohibited as critical", () => {
    expect(deriveAmlCaseAttention(caseRow({ case_stage: "blocked" })).level).toBe("critical");
    expect(
      deriveAmlCaseAttention(caseRow({ service_gate_status: "locked", case_stage: "staff_review" }))
        .level,
    ).toBe("critical");
    expect(
      deriveAmlCaseAttention(caseRow({ risk_rating: "prohibited", case_stage: "staff_review" }))
        .level,
    ).toBe("critical");
  });

  it("does not call a cleared low-risk case attention-needing", () => {
    const a = deriveAmlCaseAttention(
      caseRow({ case_stage: "cleared", status: "cleared", service_gate_status: "approved", risk_rating: "low" }),
    );
    expect(a.needsAttention).toBe(false);
    expect(a.level).toBe("steady");
  });

  it("treats awaiting-client as waiting, not as attention", () => {
    const a = deriveAmlCaseAttention(caseRow({ case_stage: "awaiting_client" }));
    expect(a.level).toBe("waiting");
    expect(a.needsAttention).toBe(false);
  });

  it("uses only the case row — no evidence reads are needed for the register", () => {
    // The signature takes a case row and nothing else; a register of 100
    // rows costs zero extra requests.
    expect(deriveAmlCaseAttention.length).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* Combined summary                                                    */
/* ------------------------------------------------------------------ */

describe("deriveAmlWorkspaceSummary", () => {
  it("returns every part of the reading in one call", () => {
    const summary = deriveAmlWorkspaceSummary(quietFacts());
    expect(summary.macro.phases).toHaveLength(5);
    expect(summary.compliance.rows).toHaveLength(7);
    expect(summary.readiness.level).toBe("ready");
    expect(summary.nextAction.key).toBe("none");
    // Approved-and-quiet reads as steady, not silent: the case is fine, and
    // "fine" is a state worth showing rather than a blank.
    expect(summary.attention).toBe("steady");
  });

  it("escalates the overall attention to the loudest thing on the case", () => {
    const summary = deriveAmlWorkspaceSummary({
      caseRow: caseRow({ case_stage: "staff_review" }),
      screening: { subjects: [{ state: "confirmed_match" }] },
    });
    expect(summary.attention).toBe("critical");
  });

  it("does not let a good compliance summary imply an approved gate", () => {
    const summary = deriveAmlWorkspaceSummary(
      quietFacts({
        caseRow: caseRow({
          case_stage: "staff_review",
          status: "under_review",
          service_gate_status: "under_review",
          risk_rating: "low",
        }),
      }),
    );
    expect(summary.compliance.rows.find((r) => r.key === "identity")!.state).toBe("complete");
    expect(summary.compliance.rows.find((r) => r.key === "screening")!.state).toBe("complete");
    expect(summary.readiness.level).toBe("under_review");
    expect(summary.readiness.label).not.toMatch(/may proceed/i);
  });
});

/* ------------------------------------------------------------------ */
/* Connected portals                                                   */
/* ------------------------------------------------------------------ */

describe("deriveAmlConnectedPortals", () => {
  const find = (rows: ReturnType<typeof deriveAmlConnectedPortals>, key: string) =>
    rows.find((r) => r.key === key)!;

  it("always returns the five portals", () => {
    const rows = deriveAmlConnectedPortals(caseRow());
    expect(rows.map((r) => r.key)).toEqual([
      "client", "finance", "builder", "developer", "solicitor_conveyancer",
    ]);
  });

  it("never claims a partner is 'independently compliant'", () => {
    const rows = deriveAmlConnectedPortals(caseRow(), {
      grants: [
        { agreement_id: "a1", reliance_agreements: { partner_org_type: "solicitor_conveyancer" } },
      ],
      assessments: [{ agreement_id: "a1", status: "satisfied" }],
    });
    const solicitor = find(rows, "solicitor_conveyancer");
    expect(solicitor.status).toBe("Partner assessment satisfied");
    for (const row of rows) {
      expect(row.status.toLowerCase()).not.toContain("independently compliant");
    }
  });

  it("distinguishes not-connected, shared and under-partner-review", () => {
    const notConnected = find(deriveAmlConnectedPortals(caseRow(), { grants: [] }), "builder");
    expect(notConnected.status).toBe("Not connected");

    const shared = find(
      deriveAmlConnectedPortals(caseRow(), {
        grants: [{ agreement_id: "a2", reliance_agreements: { partner_org_type: "builder" } }],
        assessments: [],
      }),
      "builder",
    );
    expect(shared.status).toBe("Compliance passport shared");

    const underReview = find(
      deriveAmlConnectedPortals(caseRow(), {
        grants: [{ agreement_id: "a3", reliance_agreements: { partner_org_type: "developer" } }],
        assessments: [{ agreement_id: "a3", status: "open" }],
      }),
      "developer",
    );
    expect(underReview.status).toBe("Under partner review");
  });

  it("ignores revoked grants", () => {
    const rows = deriveAmlConnectedPortals(caseRow(), {
      grants: [
        {
          agreement_id: "a4",
          revoked_at: "2026-05-01T00:00:00Z",
          reliance_agreements: { partner_org_type: "builder" },
        },
      ],
    });
    expect(find(rows, "builder").status).toBe("Not connected");
  });

  it("says partner state is unavailable rather than 'not connected' when the read failed", () => {
    const rows = deriveAmlConnectedPortals(caseRow(), { grants: null });
    expect(find(rows, "builder").status).toBe("Not available");
    expect(find(rows, "builder").tone).toBe("unknown");
    // The client's own portal state comes from the case row, so it survives.
    expect(find(rows, "client").status).not.toBe("Not available");
  });

  it("reads the client and finance portals from their canonical dimensions", () => {
    const rows = deriveAmlConnectedPortals(
      caseRow({ client_portal_status: "complete", finance_portal_status: "accepted" }),
      { grants: [] },
    );
    expect(find(rows, "client").status).toBe("Complete");
    expect(find(rows, "finance").status).toBe("Accepted");
  });
});

describe("highestAttention", () => {
  it("picks the loudest level and defaults to silence", () => {
    expect(highestAttention([])).toBe("none");
    expect(highestAttention(["steady", "waiting", "attention"])).toBe("attention");
    expect(highestAttention(["attention", "critical"])).toBe("critical");
    expect(highestAttention(["none", "steady"])).toBe("steady");
  });
});
