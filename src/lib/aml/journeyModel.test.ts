/**
 * Tests for the ten-stage AML compliance journey.
 *
 * Four things these tests guard, in order of how much damage getting them
 * wrong would do:
 *
 *  1. **The journey never becomes an authority.** No amount of green on the
 *     rail approves a service gate, issues a Passport or clears a customer.
 *     Every stage is a reading; the gate and the credential are read from
 *     canonical state and from nowhere else.
 *
 *  2. **Missing facts read as missing.** A read that failed, or that a role
 *     may not make, produces `unknown` and is named. It is never rendered
 *     as "complete", and never as a blocker the case does not have.
 *
 *  3. **Whose move it is, is answered.** `owner` is the one genuinely new
 *     thing in this model, and it has to be right: an analyst chasing a
 *     customer who has already responded is wasted work, and an MLRO who
 *     does not know a decision is theirs is a stalled case.
 *
 *  4. **Nothing became unreachable.** Every existing section still belongs
 *     to exactly one stage (or to the case record), so no `?section=` deep
 *     link lost its home.
 */
import { describe, expect, it } from "vitest";

import { CASE_STAGES, type AmlCaseStage } from "./caseDimensions";
import {
  JOURNEY_OWNER_LABELS,
  JOURNEY_OWNERS,
  JOURNEY_RECORD_SECTION,
  JOURNEY_STAGES,
  deriveAmlJourney,
  deriveAmlLivePosition,
  isJourneyStageId,
  journeyStageNumber,
  sectionsForStage,
  stageForSection,
  type AmlJourneyStageId,
} from "./journeyModel";
import {
  WORKSPACE_SECTIONS,
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

/** Nothing loaded at all — the shape a first paint has. */
const bare = (over: Partial<AmlWorkspaceFacts> = {}): AmlWorkspaceFacts => ({
  caseRow: caseRow(),
  ...over,
});

/** Every stream loaded and settled. */
const settled = (over: Partial<AmlWorkspaceFacts> = {}): AmlWorkspaceFacts => ({
  caseRow: caseRow({
    case_stage: "cleared",
    status: "cleared",
    service_gate_status: "approved",
    client_portal_status: "complete",
  }),
  openClientRequests: 0,
  activation: { model: "A", event: "Signed engagement letter", activated_at: "2026-08-01T00:00:00Z" },
  consent: { satisfied: true, outstanding: [] },
  identity: { checks: [{ party_label: "Sarah Williams", status: "passed" }] },
  // A settled case is settled on BOTH Stage 5 obligations: screened, and a
  // PEP determination recorded. Modelling only the first made "settled" mean
  // "half of Stage 5".
  screening: {
    subjects: [{
      screened_name: "Sarah Williams", state: "completed", matches: [],
      pep_determination: { result: "not_pep" },
    }],
    pepRequired: true,
  },
  documents: { requirements: [{ label: "Passport", required: true, status: "accepted" }] },
  ownership: { links: [] },
  funding: { sources: [{ verified: true, source_type: "salary" }] },
  transactions: { transactions: [{ status: "settled", property_address: "12 Bay St" }] },
  monitoring: { monitoring_status: "active", open_alerts: [], open_edd: [], overdue_review_count: 0 },
  gate: { status: "approved", conditions: [] },
  passport: {
    enabled: true,
    state: { code: "issued_current", label: "Issued · Current" },
    version: 2,
    issued_at: "2026-08-10T00:00:00Z",
    partners: [],
    summary: { total: 0, ready: 0, already_current: 0, blocked: 0 },
  },
  ...over,
});

const stage = (facts: AmlWorkspaceFacts, id: AmlJourneyStageId) =>
  deriveAmlJourney(facts).stages.find((s) => s.id === id)!;

/* ══════════════════════════════════════════════════════════════════════
   Structure — nothing lost, nothing invented
   ══════════════════════════════════════════════════════════════════════ */

describe("journey structure", () => {
  it("has ten stages, numbered 1..10 in rail order", () => {
    const journey = deriveAmlJourney(bare());
    expect(journey.stages).toHaveLength(10);
    expect(journey.stages.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(journey.stages.map((s) => s.id)).toEqual([...JOURNEY_STAGES]);
    for (const id of JOURNEY_STAGES) {
      expect(journeyStageNumber(id)).toBe(JOURNEY_STAGES.indexOf(id) + 1);
    }
  });

  it("verifies identity before collecting documents", () => {
    // Not cosmetic. `stageNumber` is `indexOf + 1`, the rail renders in this
    // order, and the current stage is the first blocking one — so this array
    // decides what the operator is told to do next. Identity determines
    // WHICH documents are required, and collecting evidence about an
    // unverified subject risks gathering it about the wrong person.
    const ids = [...JOURNEY_STAGES];
    expect(ids.indexOf("identity")).toBeLessThan(ids.indexOf("documents"));
    expect(journeyStageNumber("identity")).toBe(3);
    expect(journeyStageNumber("documents")).toBe(4);
  });

  it("keeps the two orderings from silently diverging", () => {
    // `JOURNEY_STAGES` and `STAGE_DEFINITIONS` were independent orderings.
    // Changing one alone produced a rail numbered differently from the stage
    // numbers every other surface quotes.
    const emitted = deriveAmlJourney(bare()).stages.map((s) => s.id);
    expect(emitted).toEqual([...JOURNEY_STAGES]);
  });

  it("gives every existing section exactly one home — no deep link was orphaned", () => {
    const claimed = JOURNEY_STAGES.flatMap((id) => [...sectionsForStage(id)]);
    // Every section is claimed by exactly one stage, except the record
    // surface, which is deliberately not a stage.
    for (const section of WORKSPACE_SECTIONS) {
      const owners = claimed.filter((s) => s === section);
      if (section === JOURNEY_RECORD_SECTION) {
        expect(owners, `${section} must not be a journey stage`).toHaveLength(0);
        expect(stageForSection(section)).toBeNull();
      } else {
        expect(owners, `${section} must belong to exactly one stage`).toHaveLength(1);
        expect(stageForSection(section)).not.toBeNull();
      }
    }
    // ...and no stage claims a section that does not exist.
    for (const section of claimed) {
      expect(WORKSPACE_SECTIONS).toContain(section);
    }
  });

  it("keeps identity and screening as separate stages — their meanings never merge", () => {
    expect(stageForSection("identity")).toBe("identity");
    expect(stageForSection("ownership")).toBe("screening");
    expect(sectionsForStage("identity")).not.toContain("ownership");
  });

  it("recognises only real stage ids", () => {
    expect(isJourneyStageId("decision")).toBe(true);
    expect(isJourneyStageId("nonsense")).toBe(false);
    expect(isJourneyStageId(null)).toBe(false);
    expect(isJourneyStageId(undefined)).toBe(false);
  });

  it("labels every owner, so ownership is never colour-only", () => {
    for (const owner of JOURNEY_OWNERS) {
      expect(JOURNEY_OWNER_LABELS[owner]).toBeTruthy();
    }
    for (const s of deriveAmlJourney(bare()).stages) {
      expect(s.ownerLabel).toBe(JOURNEY_OWNER_LABELS[s.owner]);
    }
  });

  it("produces a coherent journey for every canonical case stage", () => {
    for (const caseStage of CASE_STAGES as readonly AmlCaseStage[]) {
      const journey = deriveAmlJourney(bare({ caseRow: caseRow({ case_stage: caseStage }) }));
      expect(journey.stages).toHaveLength(10);
      expect(JOURNEY_STAGES).toContain(journey.currentStageId);
      expect(journey.applicableCount).toBeGreaterThan(0);
      expect(journey.completeCount).toBeLessThanOrEqual(journey.applicableCount);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════
   The journey is never an authority
   ══════════════════════════════════════════════════════════════════════ */

describe("the journey never decides anything", () => {
  it("nine complete stages do not approve the service gate", () => {
    const facts = settled({
      caseRow: caseRow({
        case_stage: "cleared",
        status: "cleared",
        // Everything else is done; the gate has simply not been moved.
        service_gate_status: "cdd_incomplete",
        client_portal_status: "complete",
      }),
    });
    const gateStage = stage(facts, "passport");
    expect(gateStage.status).not.toBe("complete");
    expect(gateStage.blockers.map((b) => b.label).join(" ")).toMatch(/Service gate/);
    expect(gateStage.owner).toBe("mlro");
  });

  it("an approved gate does not issue the Passport", () => {
    const facts = settled({
      passport: {
        enabled: true,
        state: { code: "ready_for_issuance", label: "Ready for issuance" },
        version: null,
        partners: [],
        summary: { total: 0, ready: 0, already_current: 0, blocked: 0 },
      },
    });
    const gateStage = stage(facts, "passport");
    expect(gateStage.status).toBe("attention");
    expect(gateStage.owner).toBe("mlro");
    expect(gateStage.blockers.map((b) => b.key)).toContain("passport_ready");
  });

  it("reads the Passport state the server sent and derives none of its own", () => {
    for (const [code, label] of [
      ["issued_current", "Issued · Current"],
      ["superseded", "Superseded — new version pending"],
      ["suspended", "Suspended"],
      ["revoked", "Revoked"],
    ] as const) {
      const facts = settled({
        passport: {
          enabled: true,
          state: { code, label },
          version: 3,
          partners: [],
          summary: { total: 0, ready: 0, already_current: 0, blocked: 0 },
        },
      });
      const position = deriveAmlLivePosition(facts, deriveAmlJourney(facts));
      expect(position.passportLabel).toBe(label);
      expect(position.passportVersion).toBe(3);
    }
  });

  it("a restricted Passport is a blocker, never a quiet 'in progress'", () => {
    const facts = settled({
      passport: {
        enabled: true,
        state: { code: "suspended", label: "Suspended" },
        version: 1,
        partners: [],
        summary: { total: 0, ready: 0, already_current: 0, blocked: 0 },
      },
    });
    const gateStage = stage(facts, "passport");
    expect(gateStage.blockers.map((b) => b.key)).toContain("passport_restricted");
    expect(gateStage.attention).toBe("critical");
  });

  it("never marks a stage complete from the rail position alone", () => {
    // A case sitting at `cleared` with no evidence loaded must not read as
    // ten green stages: the evidence stages are unknown, not complete.
    const journey = deriveAmlJourney(
      bare({ caseRow: caseRow({ case_stage: "cleared", status: "cleared" }) }),
    );
    const evidenceStages = journey.stages.filter((s) =>
      ["documents", "identity", "screening", "funding"].includes(s.id),
    );
    for (const s of evidenceStages) {
      expect(s.status, `${s.id} must not be complete on no evidence`).not.toBe("complete");
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Missing facts read as missing
   ══════════════════════════════════════════════════════════════════════ */

describe("unknown is never satisfied", () => {
  it("an unread evidence stream is unknown and names itself", () => {
    for (const id of ["documents", "identity"] as const) {
      const s = stage(bare(), id);
      expect(s.status).toBe("unknown");
      expect(s.unavailableFacts.length).toBeGreaterThan(0);
      expect(s.completedItems).toHaveLength(0);
    }
  });

  it("an unread Passport projection is 'not available', not 'not ready'", () => {
    const facts = settled({ passport: null });
    const s = stage(facts, "passport");
    expect(s.unavailableFacts).toContain("passport state");
    expect(deriveAmlLivePosition(facts, deriveAmlJourney(facts)).passportLabel).toBeNull();
  });

  it("a deployment flag is never a fact about a customer's case", () => {
    /* This used to assert the stage WARNED that "Passport distribution is
       not enabled here". It was a true statement about the deployment and a
       meaningless one about the case — and on a deployment where partners
       are onboarded one at a time through `grant_access`, that flag is off
       while partners are being given the Passport successfully, so the
       stage contradicted the roster on the stage before it.

       The stage answers one question now: what keeps this case current. The
       flag's state is not part of the answer, in either direction. */
    const facts = settled({
      passport: { enabled: false, state: null, version: null, partners: [], summary: null },
    });
    const s = stage(facts, "distribution");
    expect(s.blockers).toHaveLength(0);
    expect(s.warnings.map((w) => w.key)).not.toContain("dist_disabled");
    expect(`${s.summary} ${JSON.stringify(s.warnings)}`).not.toMatch(/distribution/i);
  });

  it("an unread consent catalogue does not become 'consents accepted'", () => {
    const s = stage(bare({ caseRow: caseRow({ client_portal_status: "complete" }) }), "intake");
    expect(s.completedItems.map((c) => c.key)).not.toContain("consent");
    expect(s.unavailableFacts).toContain("consent catalogue");
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Whose move is it
   ══════════════════════════════════════════════════════════════════════ */

describe("owner — whose move is it", () => {
  it("waits on the client while their onboarding is open", () => {
    const s = stage(
      bare({
        caseRow: caseRow({ case_stage: "client_in_progress", client_portal_status: "in_progress" }),
        consent: { satisfied: true, outstanding: [] },
        openClientRequests: 0,
      }),
      "intake",
    );
    expect(s.owner).toBe("client");
    expect(s.ownerLabel).toBe("Waiting on the client");
  });

  it("waits on the analyst once a document is uploaded for review", () => {
    const s = stage(
      bare({
        documents: {
          requirements: [
            { label: "Passport", required: true, status: "uploaded" },
            { label: "Bank statement", required: true, status: "accepted" },
          ],
        },
      }),
      "documents",
    );
    expect(s.owner).toBe("analyst");
    expect(s.blockers.map((b) => b.key)).toContain("awaiting_review");
  });

  it("waits on the client when a document was rejected and not replaced", () => {
    const s = stage(
      bare({
        documents: { requirements: [{ label: "Passport", required: true, status: "rejected" }] },
      }),
      "documents",
    );
    expect(s.owner).toBe("client");
    expect(s.warnings.map((w) => w.key)).toContain("rejected");
  });

  it("waits on a reviewer for a confirmed screening match, and on an analyst for a candidate", () => {
    const confirmed = stage(
      bare({
        screening: { subjects: [{ screened_name: "S", state: "confirmed_match", matches: [] }] },
      }),
      "screening",
    );
    expect(confirmed.owner).toBe("reviewer");
    expect(confirmed.attention).toBe("critical");

    const candidate = stage(
      bare({
        screening: {
          subjects: [{ screened_name: "S", state: "possible_match", matches: [{ status: "open" }] }],
        },
      }),
      "screening",
    );
    expect(candidate.owner).toBe("analyst");
    expect(candidate.attention).toBe("attention");
  });

  it("turns complete on a cleared STATUS even when case_stage lags at staff_review", () => {
    // The decide op used to write only the legacy status, so a cleared case
    // carried case_stage = staff_review forever and the Decision stage never
    // turned green in the rail. The server now syncs both; this dual read
    // keeps every row that predates the fix — and any old server — correct.
    const s = stage(
      bare({ caseRow: caseRow({ case_stage: "staff_review", status: "cleared" }) }),
      "decision",
    );
    expect(s.status).toBe("complete");
    expect(s.summary).toContain("A decision has been recorded");
  });

  it("waits on the MLRO once the case is escalated", () => {
    const s = stage(
      bare({ caseRow: caseRow({ case_stage: "decision_pending", status: "escalated_mlro" }) }),
      "decision",
    );
    expect(s.owner).toBe("mlro");
    expect(s.blockers.map((b) => b.key)).toContain("mlro_decision");
    expect(s.primaryAction?.section).toBe("risk");
  });

  it("waits on a reviewer when the case is blocked, and says the case is stopped", () => {
    const journey = deriveAmlJourney(
      bare({ caseRow: caseRow({ case_stage: "blocked", status: "blocked", service_gate_status: "locked" }) }),
    );
    const s = journey.stages.find((x) => x.id === "decision")!;
    expect(s.owner).toBe("reviewer");
    expect(s.blocking).toBe(true);
    expect(s.attention).toBe("critical");
    // A blocking stage becomes the current stage, wherever it sits.
    expect(journey.currentStageId).toBe("decision");
  });

  it("waits on nobody once a stage is settled", () => {
    const s = stage(settled(), "intake");
    expect(s.status).toBe("complete");
    expect(s.owner).toBe("none");
    expect(s.ownerLabel).toBe("Nothing outstanding");
  });

  it("reads a running provider check as the system's move, not the customer's", () => {
    const s = stage(
      bare({ identity: { checks: [{ party_label: "S", status: "in_progress" }] } }),
      "identity",
    );
    expect(s.owner).toBe("system");
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Customer structures
   ══════════════════════════════════════════════════════════════════════ */

describe("conditional journey — not every case needs every pathway", () => {
  it("marks ownership not applicable for an individual, without looking unfinished", () => {
    const s = stage(
      settled({ caseRow: caseRow({ subject_type: "individual", service_gate_status: "approved" }) }),
      "screening",
    );
    const na = s.completedItems.find((c) => c.key === "ownership_na");
    expect(na?.label).toContain("not applicable");
    expect(na?.detail).toContain("Individual customer");
    expect(s.status).toBe("complete");
  });

  it("requires an ownership structure for an entity, and says so", () => {
    const s = stage(
      settled({
        caseRow: caseRow({ subject_type: "entity" }),
        ownership: { links: [] },
      }),
      "screening",
    );
    expect(s.blockers.map((b) => b.key)).toContain("no_structure");
    expect(s.owner).toBe("analyst");
  });

  it("never reads a linked entity structure as fully mapped", () => {
    // Whether the structure is complete depends on the ownership summary
    // this reading does not load. "In progress" is the honest answer.
    const s = stage(
      settled({
        caseRow: caseRow({ subject_type: "trust" }),
        ownership: { links: [{ entity_id: "e1", link_role: "trustee" }] },
      }),
      "screening",
    );
    expect(s.status).toBe("in_progress");
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Stage-by-stage behaviour
   ══════════════════════════════════════════════════════════════════════ */

describe("stage readings", () => {
  it("activation blocks a draft case and completes an activated one", () => {
    const draft = stage(bare({ caseRow: caseRow({ case_stage: "draft", status: "draft" }) }), "activation");
    expect(draft.status).toBe("in_progress");
    expect(draft.blockers.map((b) => b.key)).toContain("not_activated");

    const activated = stage(settled(), "activation");
    expect(activated.status).toBe("complete");
    expect(activated.completedAt).toBe("2026-08-01T00:00:00Z");
  });

  it("a legacy case with no activation metadata is a warning, not a gap in the work", () => {
    const s = stage(
      bare({ caseRow: caseRow({ case_stage: "activated" }), activation: null }),
      "activation",
    );
    expect(s.status).toBe("complete");
    expect(s.warnings.map((w) => w.key)).toContain("legacy_activation");
    expect(s.blockers).toHaveLength(0);
  });

  it("submission review is the checkpoint, and only at client_submitted", () => {
    const waiting = stage(
      bare({ caseRow: caseRow({ case_stage: "client_submitted" }) }),
      "submission",
    );
    expect(waiting.owner).toBe("reviewer");
    expect(waiting.primaryAction?.actionType).toBe("review_submission");

    const past = stage(bare({ caseRow: caseRow({ case_stage: "decision_pending" }) }), "submission");
    expect(past.status).toBe("complete");

    const returned = stage(
      bare({ caseRow: caseRow({ case_stage: "additional_info_required" }) }),
      "submission",
    );
    expect(returned.owner).toBe("client");
  });

  it("a prohibited rating is a critical blocker that only a person can resolve", () => {
    const s = stage(bare({ caseRow: caseRow({ risk_rating: "prohibited" }) }), "decision");
    const blocker = s.blockers.find((b) => b.key === "prohibited");
    expect(blocker?.attention).toBe("critical");
    expect(blocker?.detail).toMatch(/does not move the gate/);
  });

  it("the ongoing-CDD stage reads monitoring, and nothing about partners", () => {
    /* It used to read partner distribution readiness as well, which made it
       a second partner register — the roster on Passport & Partners is the
       first, and the only one with any act on it. Handing this stage a full
       partner summary must change nothing it says. */
    const partners = {
      enabled: true,
      state: { code: "issued_current", label: "Issued · Current" },
      version: 2,
      partners: [
        { partner: { org_name: "Bank" }, state: "READY", ready: true, blockers: [] },
        { partner: { org_name: "Solicitor" }, state: "ACTION_REQUIRED", ready: false, blockers: ["PARTNER_CLASSIFICATION_REQUIRED"] },
      ],
      summary: { total: 2, ready: 1, already_current: 0, blocked: 1 },
    };
    const withPartners = stage(settled({ passport: partners }), "distribution");
    const without = stage(settled(), "distribution");

    expect(withPartners.summary).toBe(without.summary);
    expect(withPartners.outstandingItems.map((o) => o.key)).not.toContain("share");
    expect(withPartners.warnings.map((w) => w.key)).not.toContain("blocked_partners");
    expect(JSON.stringify(withPartners)).not.toMatch(/Bank|Solicitor/);
  });

  it("but it still names where the partners are", () => {
    // Removing a duplicate must not remove the route to the real thing.
    const s = stage(settled(), "distribution");
    expect(s.secondaryActions.map((a) => a.section)).toContain("passport");
  });

  it("an unread monitoring summary is unknown, never 'nothing to do'", () => {
    const s = stage(bare(), "distribution");
    expect(s.unavailableFacts).toContain("monitoring summary");
    expect(s.status).toBe("unknown");
    expect(s.blockers).toHaveLength(0);
  });

  it("keeps ongoing CDD alive after issuance", () => {
    const s = stage(
      settled({
        monitoring: {
          monitoring_status: "active",
          overdue_review_count: 2,
          open_alerts: [],
          open_edd: [],
        },
      }),
      "distribution",
    );
    expect(s.blockers.map((b) => b.key)).toContain("overdue");
    expect(s.owner).toBe("analyst");
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Current stage and live position
   ══════════════════════════════════════════════════════════════════════ */

describe("the current stage is the first real problem, not the furthest reached", () => {
  it("points at an early stage that is still blocking even when the case is late", () => {
    const facts = settled({
      caseRow: caseRow({ case_stage: "decision_pending", status: "escalated_mlro" }),
      documents: { requirements: [{ label: "Passport", required: true, status: "uploaded" }] },
    });
    // Documents (stage 3) is blocking; the case sits at decision (stage 8).
    expect(deriveAmlJourney(facts).currentStageId).toBe("documents");
  });

  it("falls through to the first unsettled stage when nothing is blocking", () => {
    const facts = settled({
      caseRow: caseRow({
        case_stage: "cleared",
        status: "cleared",
        service_gate_status: "under_review",
        client_portal_status: "complete",
      }),
    });
    expect(deriveAmlJourney(facts).currentStageId).toBe("passport");
  });

  it("reports the live position across every dimension", () => {
    const facts = settled();
    const position = deriveAmlLivePosition(facts, deriveAmlJourney(facts));
    expect(position.stageTotal).toBe(10);
    expect(position.caseStageLabel).toBe("Cleared");
    expect(position.clientStatusLabel).toBe("Complete");
    expect(position.financeStatusLabel).toBe("Not requested");
    expect(position.serviceGateLabel).toBe("Approved");
    expect(position.passportLabel).toBe("Issued · Current");
    expect(position.passportVersion).toBe(2);
  });
});
