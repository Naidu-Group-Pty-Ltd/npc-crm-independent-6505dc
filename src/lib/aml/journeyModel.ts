/**
 * The AML/CTF compliance journey — ONE derived reading of where a case is.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * READ THIS BEFORE CHANGING ANYTHING IN THIS FILE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * This module answers a question the workspace could not answer before:
 * *whose move is it, and what is stopping this case?* It answers it the
 * same way `workspaceViewModel.ts` answers its questions — by reading
 * canonical state that already exists — and under the same four rules:
 *
 *   • It never fetches. Callers pass facts in; every function is pure.
 *   • It never persists. There is no `current_stage` column and there must
 *     not be one. A stored stage is a second truth, and a second truth is
 *     how "the journey says verified, the passport says pending" happens.
 *   • It never decides. Navigating to a stage, or reading a stage as
 *     complete, moves nothing: the service gate is still moved only by
 *     `aml-risk set_service_gate`, the Passport is still issued only by
 *     `aml-reliance issue_attestation`, and a partner still receives the
 *     credential only through server-derived distribution readiness.
 *   • It never invents. A fact that was not supplied — not loaded, not
 *     permitted, or a read that failed — produces `unknown` and is named
 *     in `unavailableFacts`. "Could not read" is never "complete".
 *
 * ── Why a tenth stage rather than a sixth phase ────────────────────────
 * `deriveAmlMacroPhase` already maps the fourteen canonical rail steps onto
 * five phases, and it stays exactly as it is: it is the coarse "where in
 * the lifecycle" reading the register and the header use. This module is
 * the *operational* reading — the ten places work actually happens, each
 * with its own owner, blockers and readiness. The two never disagree
 * because both derive from `case_stage` and the same evidence; neither
 * stores anything.
 *
 * ── Vocabulary: reused, not duplicated ─────────────────────────────────
 * `status` is `AmlEvidenceState`, the vocabulary the compliance summary
 * already uses (and which `EVIDENCE_STATE_LABELS` / `EVIDENCE_ICON` /
 * `EVIDENCE_TEXT` already present). A stage that is stopping the case adds
 * `blocking: true` and `attention: "critical"` rather than a parallel
 * `blocked` status that would have to be kept in step with the other five.
 *
 * What is genuinely new is `owner` — whose move it is. Nothing in the
 * repository expressed that, and it is the single most useful thing an
 * operator can be told about a case.
 */

import {
  CASE_STAGE_LABELS,
  SERVICE_GATE_LABELS,
  caseStage,
  clientPortalStatus,
  financePortalStatus,
  serviceGateStatus,
} from "./caseDimensions";
import { deriveFundingObligation } from "./fundingObligation.pure";
import { refreshRemedy } from "./passport";
import {
  EVIDENCE_STATE_LABELS,
  highestAttention,
  type AmlAttentionLevel,
  type AmlEvidenceState,
  type AmlWorkspaceFacts,
  type AmlWorkspaceSection,
} from "./workspaceViewModel";

/* ══════════════════════════════════════════════════════════════════════
   1. The ten stages
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Order is the orchestration, not a label.
 *
 * `stageNumber()` is `indexOf + 1`, the rail renders in this order, and the
 * current stage is the first one that is blocking — so this array decides
 * what an operator is told to do next, not merely what the steps are called.
 *
 * Identity precedes Documents. Verifying who somebody is comes before
 * collecting evidence about them: the identity result determines WHICH
 * documents are required (a failed or partial verification changes the
 * requirement set), and collecting documents for an unverified subject
 * risks gathering evidence about the wrong person. The previous order put
 * Documents third and left cases sitting on "No requirements set" while
 * identity had already passed — which is what made the workspace point at
 * the wrong next action.
 */
export const JOURNEY_STAGES = [
  "activation",
  "intake",
  "identity",
  "documents",
  "screening",
  "funding",
  "submission",
  "decision",
  "passport",
  "distribution",
] as const;
export type AmlJourneyStageId = (typeof JOURNEY_STAGES)[number];

/**
 * Whose move it is. This is the one piece of vocabulary this module adds,
 * because nothing in the repository expressed it and every other reading
 * left "is Aurixa waiting, or is the customer?" to be worked out by hand.
 *
 * `system` means a machine process is running and nobody is being waited
 * on; `none` means the stage is settled.
 */
export const JOURNEY_OWNERS = [
  "system",
  "client",
  "analyst",
  "reviewer",
  "mlro",
  "partner",
  "none",
] as const;
export type AmlJourneyOwner = (typeof JOURNEY_OWNERS)[number];

/** Read aloud, and shown on the stage header. Never colour alone. */
export const JOURNEY_OWNER_LABELS: Record<AmlJourneyOwner, string> = {
  system: "Running — nothing to do",
  client: "Waiting on the client",
  analyst: "Waiting on the analyst",
  reviewer: "Waiting on a reviewer",
  mlro: "Waiting on the MLRO",
  partner: "Waiting on the partner",
  none: "Nothing outstanding",
};

/** One blocker, warning or completed item on a stage. */
export interface AmlJourneyNote {
  key: string;
  /** Short, in the operator's language. */
  label: string;
  detail?: string;
  attention: AmlAttentionLevel;
  /** Where the work is done, when it is somewhere other than this stage. */
  section?: AmlWorkspaceSection;
}

/**
 * A suggestion, never an authorisation. `section` navigates; the control
 * that lands there is the same server-authorised control it always was.
 */
export interface AmlJourneyAction {
  key: string;
  label: string;
  section: AmlWorkspaceSection;
  /** Existing action vocabulary where one applies. Never a new mutation. */
  actionType?: string;
}

export interface AmlJourneyStage {
  id: AmlJourneyStageId;
  /** 1-based position in the journey, for "Stage 4 of 10". */
  number: number;
  label: string;
  shortLabel: string;
  /** What this stage is for, in one sentence. */
  purpose: string;
  status: AmlEvidenceState;
  owner: AmlJourneyOwner;
  ownerLabel: string;
  attention: AmlAttentionLevel;
  /** True when this stage is what is stopping the case progressing. */
  blocking: boolean;
  /**
   * This stage's own evidence is complete, but an earlier applicable stage is
   * not — so the journey has not actually progressed through it.
   *
   * AML evidence genuinely arrives out of order: a client can submit their
   * questionnaire before screening has run. Claiming the submission did not
   * happen would be false. But rendering it as a plain green tick in a
   * numbered rail reads as "the case got this far", which is also false.
   *
   * So the fact is kept and the SEQUENCE is qualified.
   */
  aheadOfSequence: boolean;
  /** One line of substance — counts, not adjectives. */
  summary: string;
  blockers: AmlJourneyNote[];
  warnings: AmlJourneyNote[];
  completedItems: AmlJourneyNote[];
  outstandingItems: AmlJourneyNote[];
  primaryAction: AmlJourneyAction | null;
  secondaryActions: AmlJourneyAction[];
  completedAt: string | null;
  /** The legacy `?section=` key this stage opens on. Deep links are kept. */
  targetSection: AmlWorkspaceSection;
  /** Every section this stage renders, in order. */
  sections: readonly AmlWorkspaceSection[];
  applicable: boolean;
  notApplicableReason: string | null;
  sourceFacts: string[];
  unavailableFacts: string[];
}

export interface AmlJourney {
  stages: AmlJourneyStage[];
  /** The stage an operator should be working, derived — never stored. */
  currentStageId: AmlJourneyStageId;
  /** Applicable stages that have reached `complete`. */
  completeCount: number;
  applicableCount: number;
  /** Loudest thing across the whole journey. */
  attention: AmlAttentionLevel;
}

/* ══════════════════════════════════════════════════════════════════════
   2. Stage definitions — labels, purpose and which sections they render
   ══════════════════════════════════════════════════════════════════════

   `sections` is the whole stage → section mapping and the only place it
   exists. Every one of the twelve existing section keys appears exactly
   once across the ten stages plus the case record, so nothing that was
   reachable before became unreachable, and every `?section=` deep link
   still resolves to the stage that renders it.                            */

interface StageDefinition {
  id: AmlJourneyStageId;
  label: string;
  shortLabel: string;
  purpose: string;
  sections: readonly AmlWorkspaceSection[];
}

/**
 * MUST stay in `JOURNEY_STAGES` order — this array is what the rail emits,
 * and a spec asserts the two agree. They were two independent orderings, so
 * changing one alone silently produced a rail numbered differently from the
 * stage numbers everything else quotes.
 */
const STAGE_DEFINITIONS: readonly StageDefinition[] = [
  {
    id: "activation",
    label: "Activation",
    shortLabel: "Activation",
    purpose: "The recorded trigger that opened this case, and the terms it opened under.",
    sections: ["overview"],
  },
  {
    id: "intake",
    label: "Client intake",
    shortLabel: "Intake",
    purpose: "Consents, the client's own information, and anything we have asked them for.",
    sections: ["requests"],
  },
  {
    id: "identity",
    label: "Identity verification",
    shortLabel: "Identity",
    purpose: "Verification of every party the case requires, and the evidence behind it.",
    sections: ["identity"],
  },
  {
    id: "documents",
    label: "Documents & evidence",
    shortLabel: "Documents",
    purpose: "What was required, what arrived, and what we accepted or sent back.",
    sections: ["documents"],
  },
  {
    id: "screening",
    label: "Screening & ownership",
    shortLabel: "Screening",
    purpose: "Sanctions, PEP and adverse screening, and who ultimately owns or controls the customer.",
    sections: ["ownership"],
  },
  {
    id: "funding",
    label: "Funding & transaction",
    shortLabel: "Funding",
    purpose: "The matter, how it is funded, and the counterparties on the other side of it.",
    sections: ["finance", "counterparty"],
  },
  {
    id: "submission",
    label: "Submission review",
    shortLabel: "Submission",
    purpose: "Whether there is enough evidence to take this case into risk and decision.",
    sections: ["submission-review"],
  },
  {
    id: "decision",
    label: "Risk & MLRO decision",
    shortLabel: "Decision",
    purpose: "The risk position, the evidence behind it, and the recorded human decision.",
    sections: ["risk"],
  },
  /*
   * ── Why these two are named the way they are ───────────────────────
   * They were "Service gate & Passport" and "Partners & ongoing CDD", and
   * that cut put PARTNERS in both places: the roster, with every act — send,
   * re-issue, withdraw, onboard — sat on the Passport stage, while the next
   * stage carried a read-only echo of the same organisations with no acts at
   * all. An operator could not tell which one was the partner surface.
   *
   * The cut follows the work. Issuing a credential and handing it to the
   * partners entitled to rely on it are one piece of work — you cannot share
   * what has not been issued, and the roster is where sharing happens. What
   * keeps the case current afterwards is a different question on a different
   * horizon: years, not days.
   *
   * "Service gate" also left the name: the gate is granted by the cleared
   * decision now, so it is reported on this stage rather than decided here.
   */
  {
    id: "passport",
    label: "Passport & Partners",
    shortLabel: "Passport & Partners",
    purpose: "The credential itself — issued, previewed, and shared with the partners entitled to rely on it.",
    sections: ["passport"],
  },
  {
    id: "distribution",
    label: "Ongoing CDD",
    shortLabel: "Ongoing CDD",
    purpose: "What keeps this case current once the service is under way: the review cycle, trigger reviews, screening refresh and the end of the relationship.",
    sections: ["monitoring"],
  },
] as const;

/** The record surface. Not a journey stage — casework does not happen here. */
export const JOURNEY_RECORD_SECTION: AmlWorkspaceSection = "timeline";

const STAGE_BY_ID = new Map<AmlJourneyStageId, StageDefinition>(
  STAGE_DEFINITIONS.map((d) => [d.id, d]),
);

const STAGE_FOR_SECTION: Record<string, AmlJourneyStageId> = (() => {
  const out: Record<string, AmlJourneyStageId> = {};
  for (const def of STAGE_DEFINITIONS) {
    for (const section of def.sections) out[section] = def.id;
  }
  return out;
})();

export function isJourneyStageId(value: string | null | undefined): value is AmlJourneyStageId {
  return !!value && (JOURNEY_STAGES as readonly string[]).includes(value);
}

/**
 * Which stage renders a given `?section=`. The record section deliberately
 * has no stage — it is reached from the rail's own record link.
 */
export function stageForSection(section: AmlWorkspaceSection): AmlJourneyStageId | null {
  return STAGE_FOR_SECTION[section] ?? null;
}

export function sectionsForStage(id: AmlJourneyStageId): readonly AmlWorkspaceSection[] {
  return STAGE_BY_ID.get(id)?.sections ?? [];
}

export function journeyStageNumber(id: AmlJourneyStageId): number {
  return JOURNEY_STAGES.indexOf(id) + 1;
}

/* ══════════════════════════════════════════════════════════════════════
   3. Small shared readers
   ══════════════════════════════════════════════════════════════════════ */

const loaded = <T>(v: T | null | undefined): v is T => v !== null && v !== undefined;

/** Only technical failures may be retried — they are ours, not the customer's. */
const RETRYABLE_PROCESSING = new Set(["technical_failure", "dead_lettered"]);

const note = (
  key: string,
  label: string,
  attention: AmlAttentionLevel,
  extra: { detail?: string; section?: AmlWorkspaceSection } = {},
): AmlJourneyNote => ({ key, label, attention, ...extra });

/**
 * What a stage's derivation returns before the shared scaffolding (labels,
 * numbers, sections) is put around it.
 */
interface StageReading {
  status: AmlEvidenceState;
  owner: AmlJourneyOwner;
  summary: string;
  blockers?: AmlJourneyNote[];
  warnings?: AmlJourneyNote[];
  completedItems?: AmlJourneyNote[];
  outstandingItems?: AmlJourneyNote[];
  primaryAction?: AmlJourneyAction | null;
  secondaryActions?: AmlJourneyAction[];
  completedAt?: string | null;
  applicable?: boolean;
  notApplicableReason?: string | null;
  sourceFacts?: string[];
  unavailableFacts?: string[];
  /** Overrides the attention derived from the notes. */
  attention?: AmlAttentionLevel;
  blocking?: boolean;
}

/** Attention follows the loudest note unless the reading states otherwise. */
function attentionFor(reading: StageReading): AmlAttentionLevel {
  if (reading.attention) return reading.attention;
  const levels = [
    ...(reading.blockers ?? []).map((b) => b.attention),
    ...(reading.warnings ?? []).map((w) => w.attention),
  ];
  if (levels.length > 0) return highestAttention(levels);
  if (reading.status === "complete") return "steady";
  if (reading.status === "unknown") return "none";
  if (reading.owner === "client" || reading.owner === "partner" || reading.owner === "system") {
    return "waiting";
  }
  return "none";
}

/* ══════════════════════════════════════════════════════════════════════
   4. Stage 1 — Activation
   ══════════════════════════════════════════════════════════════════════ */

function activationStage(facts: AmlWorkspaceFacts): StageReading {
  const stage = caseStage(facts.caseRow);
  const activation = facts.activation ?? null;
  const isDraft = stage === "draft";
  const sourceFacts = [`case_stage = ${stage}`];

  if (isDraft) {
    return {
      status: "in_progress",
      owner: "analyst",
      summary: "The case is a draft. Activation records the trigger and opens the client's portal.",
      blockers: [
        note("not_activated", "The case has not been activated", "attention", {
          detail: "Nothing downstream can start until an authorised activation is recorded.",
        }),
      ],
      outstandingItems: [note("activate", "Record the activation event", "attention")],
      primaryAction: { key: "activate", label: "Record activation", section: "overview" },
      sourceFacts,
    };
  }

  const completed: AmlJourneyNote[] = [
    note("activated", "Activation recorded", "steady"),
  ];
  if (facts.caseRow.activation_timing) {
    completed.push(note("timing", "Activation timing recorded", "steady"));
  }
  if (facts.caseRow.agreement_state) {
    completed.push(note("agreement", "Agreement state recorded", "steady"));
  }

  // A legacy case carries no activation metadata. That is a property of when
  // it was opened, not a gap in the work — say so rather than showing a gap.
  const warnings = activation
    ? []
    : [
        note("legacy_activation", "No activation metadata on this case", "waiting", {
          detail: "The case predates the activation contract. Its history is unaffected.",
        }),
      ];

  return {
    status: "complete",
    owner: "none",
    summary: activation
      ? `Activated under ${activation.model ? `Model ${activation.model}` : "the recorded model"}${activation.event ? ` — ${activation.event}` : ""}.`
      : "Activated. This case predates the activation metadata contract.",
    completedItems: completed,
    warnings,
    completedAt: activation?.activated_at ?? null,
    sourceFacts,
  };
}

/* ══════════════════════════════════════════════════════════════════════
   5. Stage 2 — Client intake
   ══════════════════════════════════════════════════════════════════════ */

const INTAKE_COMPLETE_PORTAL = new Set(["submitted", "under_review", "complete"]);

function intakeStage(facts: AmlWorkspaceFacts): StageReading {
  const stage = caseStage(facts.caseRow);
  const portal = clientPortalStatus(facts.caseRow);
  const openRequests = facts.openClientRequests;
  const sourceFacts = [`client_portal_status = ${portal}`];
  const unavailableFacts: string[] = [];

  const blockers: AmlJourneyNote[] = [];
  const warnings: AmlJourneyNote[] = [];
  const completed: AmlJourneyNote[] = [];
  const outstanding: AmlJourneyNote[] = [];

  // ── Consents. The catalogue is the authority; an unread catalogue is
  //    `unknown`, never "accepted".
  if (loaded(facts.consent)) {
    sourceFacts.push("consent catalogue");
    if (facts.consent.satisfied) {
      completed.push(note("consent", "Required consents accepted", "steady"));
    } else {
      const n = facts.consent.outstanding.length;
      blockers.push(
        note("consent_outstanding", "Required consents not yet accepted", "attention", {
          detail: n > 0 ? `${n} outstanding in the current catalogue.` : undefined,
          section: "identity",
        }),
      );
      outstanding.push(note("consent", "Client consents", "attention"));
    }
  } else {
    unavailableFacts.push("consent catalogue");
  }

  // ── The client's own progress through their portal.
  if (INTAKE_COMPLETE_PORTAL.has(portal)) {
    completed.push(note("portal", "Client information submitted", "steady"));
  } else if (portal === "not_started") {
    /*
     * "Send or chase the onboarding invitation" was one sentence covering
     * two different situations, and it was wrong in the more urgent one.
     * `client_portal_status` says how far the client has got; it says
     * nothing about whether they can log in. On this deployment
     * AML-2026-00005 was activated, notified at `/client/aml`, and has no
     * portal account at all — so there was nothing to chase, and the
     * workspace asked an operator to chase it anyway.
     *
     * The portal-access fact is read from the same endpoint that issues
     * access. Absent, it degrades to the old wording rather than guessing.
     */
    const access = facts.portalAccess;
    if (access && !access.exists) {
      blockers.push(
        note("portal_no_access", "The client has no portal login yet", "attention", {
          detail: "Issue portal access so they can complete their compliance check.",
        }),
      );
      outstanding.push(note("portal", "Client portal access", "attention"));
    } else {
      blockers.push(
        note("portal_not_started", "The client has not started onboarding", "attention", {
          detail: access?.exists
            ? "The client can sign in but has not begun. Chase them."
            : "Send or chase the onboarding invitation.",
        }),
      );
      outstanding.push(note("portal", "Client onboarding", "attention"));
    }
  } else if (portal === "contact_adviser") {
    blockers.push(
      note("portal_contact", "The client has been asked to contact their adviser", "attention"),
    );
  } else {
    outstanding.push(note("portal", "Client onboarding in progress", "waiting"));
  }

  // ── Anything we have explicitly asked for.
  if (openRequests === undefined) {
    unavailableFacts.push("client requests");
  } else if (openRequests > 0) {
    sourceFacts.push(`open client requests = ${openRequests}`);
    warnings.push(
      note(
        "open_requests",
        `${openRequests} open request${openRequests === 1 ? "" : "s"} with the client`,
        "waiting",
        { section: "requests" },
      ),
    );
    outstanding.push(note("requests", "Client responses", "waiting"));
  }

  const awaitingUs = stage === "client_submitted" || stage === "staff_review";
  const settled = blockers.length === 0 && outstanding.length === 0;

  const status: AmlEvidenceState =
    unavailableFacts.length > 0 && blockers.length === 0 && !settled
      ? "unknown"
      : settled
        ? "complete"
        : blockers.length > 0
          ? "attention"
          : "in_progress";

  const owner: AmlJourneyOwner = settled
    ? "none"
    : awaitingUs
      ? "analyst"
      : "client";

  return {
    status,
    owner,
    summary: settled
      ? "Consents accepted and the client's information is in."
      : blockers.length > 0
        ? blockers[0].label
        : "The client is still working through their portal.",
    blockers,
    warnings,
    completedItems: completed,
    outstandingItems: outstanding,
    primaryAction: settled
      ? null
      /*
         `actionType` matters as much as `section` here. Navigating to a
         section the operator is ALREADY on does nothing visible, and this
         action's own section is the one Stage 2 opens on — so the button
         named a specific act and then, from the place it is most often
         pressed, performed none of it.
      */
      : {
        key: "request", label: "Ask the client for something",
        section: "requests", actionType: "client_request",
      },
    secondaryActions: [{ key: "requests", label: "Open request history", section: "requests" }],
    sourceFacts,
    unavailableFacts,
  };
}

/* ══════════════════════════════════════════════════════════════════════
   6. Stage 3 — Documents & evidence
   ══════════════════════════════════════════════════════════════════════ */

function documentsStage(facts: AmlWorkspaceFacts): StageReading {
  if (!loaded(facts.documents)) {
    return {
      status: "unknown",
      owner: "none",
      summary: "Document requirements could not be read.",
      unavailableFacts: ["document requirements"],
    };
  }

  const all = facts.documents.requirements;
  const sourceFacts = [`document_requirements (${all.length})`];
  const statusOf = (r: { status?: string | null }) => String(r.status ?? "pending");
  const required = all.filter((r) => r.required !== false);
  const awaitingReview = all.filter((r) => statusOf(r) === "uploaded");
  const rejected = all.filter((r) => statusOf(r) === "rejected");
  const accepted = required.filter((r) => ["accepted", "waived"].includes(statusOf(r)));
  const outstandingRequired = required.filter(
    (r) => !["accepted", "waived", "uploaded", "rejected"].includes(statusOf(r)),
  );

  if (all.length === 0) {
    return {
      status: "not_started",
      owner: "analyst",
      summary: "No document requirements have been set for this case.",
      blockers: [
        note("no_requirements", "No requirements set", "attention", {
          detail: "The client sees nothing to upload until the requirement set exists.",
        }),
      ],
      outstandingItems: [note("seed", "Document requirements", "attention")],
      primaryAction: { key: "requirements", label: "Set requirements", section: "documents" },
      sourceFacts,
    };
  }

  const blockers: AmlJourneyNote[] = [];
  const warnings: AmlJourneyNote[] = [];

  if (awaitingReview.length > 0) {
    blockers.push(
      note(
        "awaiting_review",
        `${awaitingReview.length} document${awaitingReview.length === 1 ? "" : "s"} awaiting review`,
        "attention",
        { detail: "Uploaded and waiting to be accepted or rejected." },
      ),
    );
  }
  if (rejected.length > 0) {
    warnings.push(
      note(
        "rejected",
        `${rejected.length} rejected, replacement requested`,
        "attention",
        { detail: "The client has been told what was wrong and what to send instead." },
      ),
    );
  }
  if (outstandingRequired.length > 0) {
    warnings.push(
      note(
        "outstanding",
        `${outstandingRequired.length} required document${outstandingRequired.length === 1 ? "" : "s"} not yet supplied`,
        "waiting",
      ),
    );
  }

  const complete = required.length > 0 && accepted.length === required.length;

  return {
    status: complete
      ? "complete"
      : awaitingReview.length > 0 || rejected.length > 0
        ? "attention"
        : accepted.length === 0
          ? "not_started"
          : "in_progress",
    owner: complete
      ? "none"
      : awaitingReview.length > 0
        ? "analyst"
        : "client",
    summary: `${accepted.length} of ${required.length} required document${required.length === 1 ? "" : "s"} accepted.`,
    blockers,
    warnings,
    completedItems: accepted.map((r, i) =>
      note(`doc-ok-${i}`, r.label ?? "Requirement satisfied", "steady"),
    ),
    outstandingItems: [
      ...awaitingReview.map((r, i) => note(`doc-review-${i}`, r.label ?? "Awaiting review", "attention")),
      ...rejected.map((r, i) => note(`doc-rej-${i}`, r.label ?? "Rejected", "attention")),
      ...outstandingRequired.map((r, i) => note(`doc-out-${i}`, r.label ?? "Not supplied", "waiting")),
    ],
    primaryAction:
      awaitingReview.length > 0
        ? { key: "review", label: "Review uploaded documents", section: "documents", actionType: "review_document" }
        : complete
          ? null
          : { key: "request_doc", label: "Request a document", section: "requests" },
    sourceFacts,
  };
}

/* ══════════════════════════════════════════════════════════════════════
   7. Stage 4 — Identity verification
   ══════════════════════════════════════════════════════════════════════ */

function identityStage(facts: AmlWorkspaceFacts): StageReading {
  if (!loaded(facts.identity)) {
    return {
      status: "unknown",
      owner: "none",
      summary: "Verification checks could not be read.",
      unavailableFacts: ["verification checks"],
    };
  }

  const live = facts.identity.checks.filter((c) => !c.superseded_at);
  const sourceFacts = [`verification_checks (${live.length} live)`];

  if (live.length === 0) {
    return {
      status: "not_started",
      owner: "analyst",
      summary: "No verification attempt has been recorded for this case.",
      blockers: [note("no_idv", "Identity verification not started", "attention")],
      outstandingItems: [note("start", "Identity verification", "attention")],
      primaryAction: { key: "start_idv", label: "Start identity verification", section: "identity" },
      sourceFacts,
    };
  }

  const technical = live.filter((c) => RETRYABLE_PROCESSING.has(String(c.processing_status ?? "")));
  const referred = live.filter((c) => c.status === "referred");
  const failed = live.filter((c) => c.status === "failed" || c.status === "exhausted");
  const passed = live.filter((c) => c.status === "passed");
  const inFlight = live.filter((c) => c.status === "pending" || c.status === "in_progress");

  const blockers: AmlJourneyNote[] = [];
  const warnings: AmlJourneyNote[] = [];

  // A provider outage is ours, not the customer's, and it is separated from
  // an identity outcome everywhere else in the system.
  if (technical.length > 0) {
    warnings.push(
      note(
        "technical",
        `${technical.length} check${technical.length === 1 ? "" : "s"} stopped on a technical failure`,
        "attention",
        { detail: "Retrying runs the provider again and consumes no attempt." },
      ),
    );
  }
  if (referred.length > 0) {
    blockers.push(
      note(
        "referred",
        `${referred.length} referred for a human outcome`,
        "attention",
      ),
    );
  }
  if (failed.length > 0) {
    blockers.push(
      note("failed", `${failed.length} unsuccessful of ${live.length}`, "attention", {
        detail: "The customer needs a further attempt, or the manual route.",
      }),
    );
  }

  const complete = passed.length === live.length;

  return {
    status: complete
      ? "complete"
      : blockers.length > 0 || technical.length > 0
        ? "attention"
        : inFlight.length > 0
          ? "in_progress"
          : "in_progress",
    owner: complete
      ? "none"
      : referred.length > 0
        ? "analyst"
        : technical.length > 0
          ? "analyst"
          : failed.length > 0
            ? "client"
            : inFlight.length > 0
              ? "system"
              : "analyst",
    summary: complete
      ? `${passed.length} of ${live.length} verified.`
      : `${passed.length} of ${live.length} verified${inFlight.length > 0 ? `, ${inFlight.length} in progress` : ""}.`,
    blockers,
    warnings,
    completedItems: passed.map((c, i) =>
      note(`idv-ok-${i}`, c.party_label ?? "Party verified", "steady"),
    ),
    outstandingItems: live
      .filter((c) => c.status !== "passed")
      .map((c, i) => note(`idv-out-${i}`, c.party_label ?? "Verification outstanding", "attention")),
    primaryAction: complete
      ? null
      : { key: "idv", label: "Open identity verification", section: "identity", actionType: "identity_review" },
    sourceFacts,
  };
}

/* ══════════════════════════════════════════════════════════════════════
   8. Stage 5 — Screening & ownership
   ══════════════════════════════════════════════════════════════════════

   Two evidence streams, one navigation stage, and never one meaning: a
   screening outcome and an ownership map answer different questions and
   are kept as separate readings inside the stage.                          */

function screeningStage(facts: AmlWorkspaceFacts): StageReading {
  const blockers: AmlJourneyNote[] = [];
  const warnings: AmlJourneyNote[] = [];
  const completed: AmlJourneyNote[] = [];
  const outstanding: AmlJourneyNote[] = [];
  const sourceFacts: string[] = [];
  const unavailableFacts: string[] = [];

  let screeningState: AmlEvidenceState = "unknown";
  let screeningSummary = "Screening could not be read.";
  let owner: AmlJourneyOwner = "none";

  if (loaded(facts.screening)) {
    const enrolled = facts.screening.subjects;
    const subjects = enrolled.filter((s) => s.state !== "not_required");
    sourceFacts.push(`party_screening_subjects (${subjects.length} of ${enrolled.length} in scope)`);
    const openMatches = subjects.reduce(
      (n, s) => n + (s.matches ?? []).filter((m) => m.status === "open").length,
      0,
    );
    const confirmed = subjects.filter((s) => s.state === "confirmed_match");
    const possible = subjects.filter((s) => s.state === "possible_match");
    const errored = subjects.filter((s) => s.state === "error");
    const pending = subjects.filter((s) => ["not_started", "queued", "processing"].includes(s.state));
    const settled = subjects.filter((s) => ["completed", "false_positive"].includes(s.state));

    if (subjects.length === 0 && enrolled.length > 0) {
      /*
       * Enrolled, and nothing to screen.
       *
       * Every party's screening obligation was stood down by the recorded
       * perimeter decision, so there is no screening to run. This branch used
       * to fall through to "Screening has not been run" — an obligation
       * reported as an unfinished task — which sat on the page beside a card
       * correctly saying sanctions was not required, and left an operator
       * reconciling two true statements that appeared to contradict.
       *
       * Not run and not owed are different facts. This one is settled.
       */
      screeningState = "complete";
      screeningSummary = "No screening is required for this case.";
      completed.push(
        note("screening_not_required", "Screening not required under the recorded scope", "steady", {
          detail: "No obligation arose, so nobody was screened. This is a policy decision, "
            + "not a screening result.",
        }),
      );
    } else if (subjects.length === 0) {
      screeningState = "not_started";
      screeningSummary = "No screening subjects recorded.";
      owner = "analyst";
      blockers.push(note("no_subjects", "Screening has not been run", "attention"));
    } else if (confirmed.length > 0) {
      screeningState = "attention";
      screeningSummary = `${confirmed.length} confirmed match${confirmed.length === 1 ? "" : "es"}.`;
      owner = "reviewer";
      blockers.push(
        note("confirmed", `${confirmed.length} confirmed screening match`, "critical", {
          detail: "This is a finding, not a candidate. A reviewer must record the outcome.",
        }),
      );
    } else if (possible.length > 0 || openMatches > 0) {
      const n = Math.max(possible.length, openMatches);
      screeningState = "attention";
      screeningSummary = `${n} match${n === 1 ? "" : "es"} awaiting adjudication.`;
      owner = "analyst";
      blockers.push(
        note("possible", `${n} potential match${n === 1 ? "" : "es"} awaiting adjudication`, "attention"),
      );
    } else if (errored.length > 0) {
      screeningState = "attention";
      screeningSummary = `${errored.length} screening run${errored.length === 1 ? "" : "s"} did not complete.`;
      owner = "analyst";
      warnings.push(
        note("errored", `${errored.length} screening run did not complete`, "attention", {
          detail: "A technical failure leaves the subject outstanding — it never reads as clear.",
        }),
      );
    } else if (pending.length > 0) {
      screeningState = "in_progress";
      screeningSummary = `${settled.length} of ${subjects.length} screened.`;
      owner = "system";
      outstanding.push(note("pending_screen", `${pending.length} screening run in progress`, "waiting"));
    } else {
      screeningState = "complete";
      screeningSummary = `${subjects.length} screened, no open matches.`;
      completed.push(note("screening_done", "Screening completed for every subject", "steady"));
    }
  } else {
    unavailableFacts.push("party screening");
  }

  /*
   * ── The PEP determination ─────────────────────────────────────────
   * Read here because it is a Stage 5 obligation and this stage could not
   * see it. On the reported case sanctions was stood down and the PEP
   * determination was the ONLY thing outstanding — so the stage reported
   * "screening has not been run", named no owner for the real work, and the
   * one item holding Stage 5 open appeared nowhere in the rail.
   *
   * Established by a recorded determination per party. Absent is outstanding.
   */
  let pepState: AmlEvidenceState = "unknown";
  if (loaded(facts.screening)) {
    const enrolled = facts.screening.subjects;
    /*
     * Three answers, not two.
     *
     *   false      no determination is owed — excluded from the stage
     *   true       owed, so the determinations decide the state
     *   unread     `unknown`, which fails closed for stage completion
     *              WITHOUT inventing an outstanding item or claiming an
     *              owner. Reporting unread work as outstanding work is its
     *              own kind of lie, and it would fire on every case whose
     *              scope read has not landed yet.
     */
    const pepOwed = facts.screening.pepRequired;
    if (pepOwed === false) {
      pepState = "not_applicable";
    } else if (pepOwed !== true) {
      pepState = "unknown";
      unavailableFacts.push("PEP scope decision");
    } else {
      const undetermined = enrolled.filter((s) => !s.pep_determination?.result);
      if (enrolled.length === 0) {
        // Nobody enrolled cannot mean everybody determined.
        pepState = "not_started";
        blockers.push(note("pep_no_parties", "PEP determination outstanding", "attention", {
          detail: "No party is enrolled yet, so no determination can have been made.",
        }));
        if (owner === "none") owner = "analyst";
      } else if (undetermined.length > 0) {
        pepState = "not_started";
        /*
         * A BLOCKER, not a waiting item.
         *
         * It was `outstanding`/`waiting`, which reads as "somebody else is
         * working on it" — so the stage never set `blocking`, the rail let a
         * LATER stage claim the journey position, and the Attention panel
         * could say "nothing on this case is unresolved" while Stage 5
         * plainly had a required determination with no record against it.
         * Nobody is working on it; it is owed, and it holds the stage.
         */
        blockers.push(
          note("pep_outstanding",
            `PEP determination outstanding for ${undetermined.length} part${undetermined.length === 1 ? "y" : "ies"}`,
            "attention", {
              detail: "Recorded by a reviewer or the MLRO with the sources checked and a "
                + "rationale. A client declaration is evidence that supports it; it is "
                + "never the determination itself.",
            }),
        );
        // Only when nothing more urgent already owns the stage. A candidate
        // awaiting adjudication outranks an outstanding determination.
        if (owner === "none") owner = "reviewer";
      } else {
        pepState = "complete";
        completed.push(note("pep_done", "PEP determination recorded for every party", "steady"));
      }
    }
  }

  // ── Ownership & control. Individual customers genuinely have none — that
  //    is a property of the case, not an unfinished task.
  const subjectType = facts.caseRow.subject_type;
  let ownershipState: AmlEvidenceState = "unknown";

  if (subjectType === "individual") {
    ownershipState = "not_applicable";
    completed.push(
      note("ownership_na", "Ownership & control — not applicable", "steady", {
        detail: "Individual customer with no entity ownership structure.",
      }),
    );
  } else if (loaded(facts.ownership)) {
    sourceFacts.push("linked entities");
    const links = facts.ownership.links.filter((l) => l.entity_id);
    if (links.length === 0) {
      ownershipState = "attention";
      blockers.push(
        note("no_structure", "No entity structure linked", "attention", {
          detail: "A non-individual customer needs its ownership and control mapped.",
        }),
      );
      if (owner === "none") owner = "analyst";
    } else {
      // Never `complete`: whether a structure is fully mapped depends on the
      // ownership summary this reading does not load.
      ownershipState = "in_progress";
      outstanding.push(
        note("structure", `${links.length} linked entit${links.length === 1 ? "y" : "ies"} open to review`, "waiting"),
      );
      if (owner === "none") owner = "analyst";
    }
  } else {
    unavailableFacts.push("linked entities");
  }

  // Whether the PEP determination is the thing actually holding this stage.
  const pepIsTheWork = blockers.some((b) => b.key.startsWith("pep_"))
    && !blockers.some((b) => ["confirmed", "possible", "no_subjects"].includes(b.key));

  const states: AmlEvidenceState[] = [screeningState, pepState, ownershipState].filter(
    (s) => s !== "not_applicable",
  );
  const status: AmlEvidenceState = states.includes("attention")
    ? "attention"
    : states.includes("unknown")
      ? "unknown"
      : states.includes("in_progress")
        ? "in_progress"
        : states.includes("not_started")
          ? "not_started"
          : "complete";

  return {
    status,
    owner: status === "complete" ? "none" : owner,
    summary: [
      screeningSummary,
      pepState === "not_applicable" ? null
        : pepState === "complete" ? "PEP determined."
          : pepState === "not_started" ? "PEP determination outstanding."
            : null,
      ownershipState === "not_applicable" ? null
        : `Ownership: ${EVIDENCE_STATE_LABELS[ownershipState].toLowerCase()}.`,
    ].filter(Boolean).join(" "),
    blockers,
    warnings,
    completedItems: completed,
    outstandingItems: outstanding,
    primaryAction:
      status === "complete"
        ? null
        : {
            key: "screening",
            label: blockers.some((b) => b.key === "confirmed" || b.key === "possible")
              ? "Adjudicate screening"
              // Name the actual work. "Open screening & ownership" on a case
              // whose only outstanding item is a PEP determination tells an
              // operator where to click and nothing about what to do there.
              : pepIsTheWork
                ? "Record PEP determination"
                : "Open screening & ownership",
            section: "ownership",
            // Naming the act is only half of it — the workspace opens the
            // determination dialog for this type rather than navigating to a
            // section the operator is usually already looking at.
            actionType: pepIsTheWork ? "record_pep" : "screening_adjudication",
          },
    sourceFacts,
    unavailableFacts,
  };
}

/**
 * Is some party on this case determined to be a PEP?
 *
 * A confirmed finding only — a candidate is not one, and an absent
 * determination is not a negative. `false` here means "no recorded PEP
 * finding", which is exactly what the funding obligation needs: a reason to
 * escalate, never a reason to relax.
 */
function pepFindingOnCase(facts: AmlWorkspaceFacts): boolean {
  if (!loaded(facts.screening)) return false;
  return facts.screening.subjects.some((s) => s.pep_determination?.result === "pep");
}

/* ══════════════════════════════════════════════════════════════════════
   9. Stage 6 — Funding & transaction
   ══════════════════════════════════════════════════════════════════════ */

function fundingStage(facts: AmlWorkspaceFacts): StageReading {
  const blockers: AmlJourneyNote[] = [];
  const warnings: AmlJourneyNote[] = [];
  const completed: AmlJourneyNote[] = [];
  const outstanding: AmlJourneyNote[] = [];
  const sourceFacts: string[] = [];
  const unavailableFacts: string[] = [];

  /*
   * ── Is this stage owed at all? ────────────────────────────────────────
   * Decided first, and decided explicitly. Stage 6 used to have no answer to
   * this question: it reported on the evidence it found and said nothing
   * about whether any was owed, so a case with nothing recorded was
   * indistinguishable from a case that owed nothing — and the journey went
   * from Stage 5 to Stage 7 with no account of the one in between.
   */
  const obligation = deriveFundingObligation({
    perimeter: facts.perimeter ?? null,
    riskRating: facts.caseRow?.risk_rating ?? null,
    enhancedDueDiligence: facts.caseRow?.status === "edd_required",
    pepFinding: pepFindingOnCase(facts),
  });
  sourceFacts.push(...obligation.sourceFacts);

  if (obligation.reading === "not_required") {
    /*
     * Skipped, and SAID. `applicable: false` is what takes it out of the
     * journey's own count; `notApplicableReason` is what stops that being a
     * silent disappearance. A stage that vanishes without a reason is the
     * defect, not the skip.
     */
    return {
      status: "not_applicable",
      owner: "none",
      summary: obligation.reason,
      applicable: false,
      notApplicableReason: obligation.reason,
      completedItems: [note("funding_na", "Funding & transaction — not required", "steady", {
        detail: obligation.reason,
      })],
      blockers: [], warnings: [], outstandingItems: [],
      primaryAction: null,
      secondaryActions: [
        { key: "counterparty", label: "Purchase & counterparty", section: "counterparty" },
      ],
      sourceFacts,
      unavailableFacts: [],
    };
  }

  let status: AmlEvidenceState = "unknown";
  let owner: AmlJourneyOwner = "none";
  let summary = "Funding evidence could not be read.";

  if (loaded(facts.funding)) {
    const items = facts.funding.sources;
    sourceFacts.push(`source_of_funds (${items.length})`);
    const verified = items.filter((i) => i.verified);
    if (items.length === 0) {
      status = "not_started";
      owner = "analyst";
      summary = obligation.nonWaivable
        ? "No source of funds recorded, and enhanced due diligence requires it."
        : "No source of funds recorded.";
      blockers.push(note("no_sof", "Source of funds not recorded", "attention", {
        detail: obligation.reason,
      }));
      outstanding.push(note("sof", "Source of funds", "attention"));
    } else if (verified.length === items.length) {
      status = "complete";
      summary = `${verified.length} source${verified.length === 1 ? "" : "s"} verified.`;
      completed.push(note("sof_done", "Source of funds verified", "steady"));
    } else {
      status = "in_progress";
      owner = "analyst";
      summary = `${verified.length} of ${items.length} sources verified.`;
      warnings.push(
        note("sof_unverified", `${items.length - verified.length} source not verified`, "attention"),
      );
      outstanding.push(note("sof_open", "Source of funds evidence", "attention"));
    }
  } else {
    unavailableFacts.push("source of funds");
  }

  if (loaded(facts.transactions)) {
    const list = facts.transactions.transactions;
    sourceFacts.push(`transactions (${list.length})`);
    if (list.length === 0) {
      warnings.push(
        note("no_transaction", "No transaction recorded", "waiting", {
          detail: "Threshold obligations are driven by the transaction record.",
        }),
      );
    } else {
      completed.push(
        note("transaction", `${list.length} transaction${list.length === 1 ? "" : "s"} recorded`, "steady"),
      );
    }
  } else {
    unavailableFacts.push("transactions");
  }

  return {
    status,
    owner: status === "complete" ? "none" : owner,
    summary,
    blockers,
    warnings,
    completedItems: completed,
    outstandingItems: outstanding,
    primaryAction:
      status === "complete" ? null : { key: "funding", label: "Open funding & finance", section: "finance" },
    secondaryActions: [
      { key: "counterparty", label: "Purchase & counterparty", section: "counterparty" },
    ],
    sourceFacts,
    unavailableFacts,
  };
}

/* ══════════════════════════════════════════════════════════════════════
   10. Stage 7 — Submission review
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Stages at or beyond which the submission has already been taken in.
 *
 * `closed` is deliberately NOT here, and that omission is the fix for a real
 * defect: a case can close from ANY stage, including one that never reached
 * submission. With `closed` in this set, closing a case at Stage 5 rendered
 * Stage 7 with a green tick — the rail claimed the submission had been taken
 * into review when nothing of the sort had happened.
 *
 * Closure is an ending, not a progression. It says where the case stopped,
 * never how far it got.
 */
const PAST_SUBMISSION = new Set([
  "staff_review",
  "checks_in_progress",
  "enhanced_cdd",
  "decision_pending",
  "cleared",
  "cleared_with_conditions",
  "blocked",
]);

function submissionStage(facts: AmlWorkspaceFacts): StageReading {
  const stage = caseStage(facts.caseRow);
  const sourceFacts = [`case_stage = ${stage}`];

  if (stage === "client_submitted") {
    return {
      status: "attention",
      owner: "reviewer",
      summary: "The client has submitted and the case is waiting for review.",
      blockers: [
        note("awaiting_review", "Submission awaiting review", "attention", {
          detail: "Accept it, return it for more information, or escalate.",
        }),
      ],
      outstandingItems: [note("review", "Submission review", "attention")],
      primaryAction: {
        key: "review_submission",
        label: "Review the submission",
        section: "submission-review",
        actionType: "review_submission",
      },
      sourceFacts,
    };
  }

  if (stage === "additional_info_required") {
    return {
      status: "attention",
      owner: "client",
      summary: "The submission was returned and further information was requested.",
      warnings: [note("returned", "Further information requested", "attention", { section: "requests" })],
      outstandingItems: [note("info", "Client response", "waiting")],
      primaryAction: { key: "requests", label: "Open the open requests", section: "requests" },
      sourceFacts,
    };
  }

  if (PAST_SUBMISSION.has(stage)) {
    return {
      status: "complete",
      owner: "none",
      summary: "The submission has been taken in; the case is past this checkpoint.",
      completedItems: [note("accepted", "Submission accepted into review", "steady")],
      sourceFacts,
    };
  }

  if (stage === "closed") {
    // The case ended here. Whether the submission was ever taken into review
    // is not established by the fact of closure, so this reports the ending
    // rather than inventing a completion.
    return {
      status: "not_started",
      owner: "none",
      summary: "The case closed without this checkpoint being recorded as completed.",
      outstandingItems: [note("closed", "Case closed before submission review", "waiting")],
      sourceFacts,
    };
  }

  return {
    status: "not_started",
    owner: "client",
    summary: "The client has not submitted yet.",
    outstandingItems: [note("await", "Client submission", "waiting")],
    sourceFacts,
  };
}

/* ══════════════════════════════════════════════════════════════════════
   11. Stage 8 — Risk & MLRO decision
   ══════════════════════════════════════════════════════════════════════ */

function decisionStage(facts: AmlWorkspaceFacts): StageReading {
  const stage = caseStage(facts.caseRow);
  const risk = facts.caseRow.risk_rating ?? null;
  const sourceFacts = [`case_stage = ${stage}`, `risk_rating = ${risk ?? "unrated"}`];

  const blockers: AmlJourneyNote[] = [];
  const warnings: AmlJourneyNote[] = [];
  const completed: AmlJourneyNote[] = [];
  const outstanding: AmlJourneyNote[] = [];

  if (risk) {
    completed.push(note("rated", `Risk rated ${risk.toUpperCase()}`, "steady"));
  } else {
    outstanding.push(note("unrated", "Risk assessment", "attention"));
  }

  if (risk === "prohibited") {
    blockers.push(
      note("prohibited", "Prohibited risk rating recorded", "critical", {
        detail: "A decision-maker must record the outcome. The rating does not move the gate by itself.",
      }),
    );
  }

  if (loaded(facts.monitoring)) {
    const openEdd = facts.monitoring.open_edd ?? [];
    if (openEdd.length > 0) {
      blockers.push(
        note("edd", `${openEdd.length} enhanced due diligence case open`, "attention"),
      );
    }
  }

  /*
   * Each terminal branch reads the canonical stage OR the legacy status —
   * the escalated branch below always has. The decide op used to write only
   * `status`, so a cleared case could carry case_stage = staff_review
   * forever; the server now syncs both, and this dual read keeps every row
   * that predates the fix (and any old server) reading correctly.
   */
  if (stage === "blocked" || facts.caseRow.status === "blocked") {
    return {
      status: "attention",
      owner: "reviewer",
      summary: "The case is blocked. It reopens only on an explicit decision.",
      attention: "critical",
      blocking: true,
      blockers: [
        note("blocked", "The case is blocked", "critical", {
          detail: "Nothing downstream progresses until a reviewer reopens it.",
        }),
        ...blockers,
      ],
      outstandingItems: outstanding,
      completedItems: completed,
      primaryAction: { key: "risk", label: "Open risk & decision", section: "risk" },
      sourceFacts,
    };
  }

  if (stage === "decision_pending" || facts.caseRow.status === "escalated_mlro") {
    return {
      status: "attention",
      owner: "mlro",
      summary: "The case has been escalated and is waiting on an authorised decision-maker.",
      blockers: [
        note("mlro_decision", "MLRO decision required", "attention", {
          detail: "Every fact needed to decide is consolidated in the decision dossier.",
        }),
        ...blockers,
      ],
      warnings,
      completedItems: completed,
      outstandingItems: [note("decision", "MLRO decision", "attention"), ...outstanding],
      primaryAction: {
        key: "mlro_decision",
        label: "Open the decision dossier",
        section: "risk",
        actionType: "mlro_decision",
      },
      sourceFacts,
    };
  }

  if (stage === "cleared" || stage === "cleared_with_conditions" || facts.caseRow.status === "cleared") {
    const label = stage === "cleared" || stage === "cleared_with_conditions"
      ? CASE_STAGE_LABELS[stage]
      : CASE_STAGE_LABELS.cleared;
    return {
      status: "complete",
      owner: "none",
      summary: `A decision has been recorded — ${label}.`,
      completedItems: [note("decided", "Compliance decision recorded", "steady"), ...completed],
      warnings,
      sourceFacts,
    };
  }

  if (stage === "enhanced_cdd") {
    return {
      status: "attention",
      owner: "analyst",
      summary: "The case is in enhanced due diligence.",
      blockers: [note("edd_stage", "Enhanced due diligence is open", "attention"), ...blockers],
      completedItems: completed,
      outstandingItems: outstanding,
      primaryAction: { key: "risk", label: "Open risk & decision", section: "risk" },
      sourceFacts,
    };
  }

  if (stage === "staff_review") {
    return {
      status: "in_progress",
      owner: "analyst",
      summary: "The case is in staff review and the assessment can be completed.",
      blockers,
      warnings,
      completedItems: completed,
      outstandingItems: outstanding,
      /*
       * `actionType` matters: without one the workspace's action switch fell
       * to its default — a scroll to a screening anchor that does not exist
       * on the risk section — so the stage's primary button changed nothing
       * visible for an operator already standing on stage 8.
       */
      primaryAction: {
        key: "risk", label: "Complete the risk assessment", section: "risk",
        actionType: "complete_assessment",
      },
      sourceFacts,
    };
  }

  return {
    status: risk ? "in_progress" : "not_started",
    owner: blockers.length > 0 ? "reviewer" : "none",
    summary: risk
      ? `Rated ${risk.toUpperCase()}. No decision has been recorded yet.`
      : "Not yet assessed. Evidence is still being collected.",
    blockers,
    warnings,
    completedItems: completed,
    outstandingItems: outstanding,
    sourceFacts,
  };
}

/* ══════════════════════════════════════════════════════════════════════
   12. Stage 9 — Service gate & Passport
   ══════════════════════════════════════════════════════════════════════

   Four concepts, kept apart on purpose: the compliance decision (stage 8),
   the service gate, the Passport credential, and its distribution (stage
   10). Nothing here collapses them into one "approved" boolean.            */

const GATE_APPROVED = new Set(["approved", "approved_with_controls"]);

/** Passport state codes that mean the credential is currently in force. */
const PASSPORT_IN_FORCE = new Set(["issued_current"]);
/** Passport state codes that need somebody to act. */
const PASSPORT_NEEDS_ACTION = new Set([
  "ready_for_issuance",
  "refresh_required",
  "superseded",
]);

function passportStage(facts: AmlWorkspaceFacts): StageReading {
  const gate = serviceGateStatus(facts.caseRow);
  const sourceFacts = [`service_gate_status = ${gate}`];
  const unavailableFacts: string[] = [];

  const blockers: AmlJourneyNote[] = [];
  const warnings: AmlJourneyNote[] = [];
  const completed: AmlJourneyNote[] = [];
  const outstanding: AmlJourneyNote[] = [];

  const gateApproved = GATE_APPROVED.has(gate);
  const gateStopped = gate === "locked" || gate === "terminated";
  /* Dual-read like decisionStage: a cleared case may still carry only the
   * legacy status column. An open gate on a CLEARED case is a step waiting
   * for an authorised approval — not doubt about the case. */
  const caseCleared =
    caseStage(facts.caseRow) === "cleared" || facts.caseRow.status === "cleared";

  if (gateApproved) {
    completed.push(
      note("gate", `Service gate: ${SERVICE_GATE_LABELS[gate]}`, "steady", {
        detail: "Recorded by an authorised decision-maker.",
      }),
    );
  } else if (gateStopped) {
    blockers.push(
      note("gate_stopped", `Service gate: ${SERVICE_GATE_LABELS[gate]}`, "critical", {
        detail: "The designated service may not proceed.",
      }),
    );
  } else {
    blockers.push(
      note("gate_open", `Service gate: ${SERVICE_GATE_LABELS[gate]}`, "attention", {
        detail: caseCleared
          ? "The case is cleared — the gate is its own explicit decision, awaiting an authorised approval."
          : "The gate is an explicit decision; evidence and risk do not move it.",
      }),
    );
    outstanding.push(note("gate_decision", "Service-gate decision", "attention"));
  }

  if (loaded(facts.gate)) {
    sourceFacts.push("aml-risk gate_contract");
    const openConditions = (facts.gate.conditions ?? []).filter(
      (c) => (c.status ?? "open") === "open",
    );
    for (const condition of openConditions) {
      warnings.push(
        note(`condition-${condition.id ?? condition.label}`, condition.label, "attention", {
          detail: "Attached to the gate decision and not yet met.",
        }),
      );
    }
  } else {
    unavailableFacts.push("service-gate contract");
  }

  // ── The Passport credential. Its state is SERVER-derived and embedded in
  //    the projection; nothing here recomputes it.
  //
  //    `enabled` describes PARTNER DISTRIBUTION and nothing else. The server
  //    returns the real credential state either way, so reading it only when
  //    distribution is switched on would report "not available" for a
  //    Passport whose state is perfectly well known — which is what this
  //    deployment does, and what stage 9 was wrongly saying.
  let passportCode: string | null = null;
  let passportLabel: string | null = null;
  let issuedAt: string | null = null;

  if (loaded(facts.passport) && facts.passport.state?.code) {
    sourceFacts.push("passport state (server-derived)");
    passportCode = facts.passport.state?.code ?? null;
    passportLabel = facts.passport.state?.label ?? null;
    issuedAt = facts.passport.issued_at ?? null;

    if (passportCode && PASSPORT_IN_FORCE.has(passportCode)) {
      completed.push(
        note(
          "passport",
          `Passport ${passportLabel ?? "issued"}${facts.passport.version ? ` · v${facts.passport.version}` : ""}`,
          "steady",
        ),
      );
    } else if (passportCode === "ready_for_issuance") {
      outstanding.push(note("issue", "Passport issuance", "attention"));
      blockers.push(
        note("passport_ready", "Passport ready for issuance", "attention", {
          detail: "The credential can be issued by an authorised decision-maker.",
        }),
      );
    } else if (passportCode && PASSPORT_NEEDS_ACTION.has(passportCode)) {
      /* ── One fact, counted once ────────────────────────────────────
       * `refresh_required` covers two different owed acts. Where the
       * server's ONLY reason is the unapproved gate, the version is fine
       * and stays in force — listing "Passport version" as outstanding
       * beside "Service-gate decision" reports one fact as two owed
       * items, and tells the operator a reissue is owed that cannot
       * change anything. `refreshRemedy` is the one place that knows. */
      if (refreshRemedy(facts.passport.state?.reasons) === "approve_gate") {
        completed.push(
          note("passport", `Passport issued${facts.passport.version ? ` · v${facts.passport.version}` : ""}`, "steady", {
            detail: "In force once the service gate is approved — no new version is needed.",
          }),
        );
      } else {
        warnings.push(
          note("passport_action", `Passport: ${passportLabel ?? passportCode}`, "attention"),
        );
        outstanding.push(note("passport_refresh", "Passport version", "attention"));
      }
    } else if (passportCode === "suspended" || passportCode === "revoked") {
      blockers.push(
        note("passport_restricted", `Passport: ${passportLabel ?? passportCode}`, "critical"),
      );
    } else if (passportCode === "not_issued") {
      outstanding.push(note("passport_not_issued", "Passport not issued", "waiting"));
    }
  } else {
    unavailableFacts.push("passport state");
  }

  /* Issued, and held back by nothing but the gate. */
  const gateOnlyPassport = passportCode !== null
    && PASSPORT_NEEDS_ACTION.has(passportCode)
    && loaded(facts.passport)
    && refreshRemedy(facts.passport.state?.reasons) === "approve_gate";

  const complete = gateApproved && passportCode !== null && PASSPORT_IN_FORCE.has(passportCode);

  const owner: AmlJourneyOwner = complete
    ? "none"
    : gateStopped
      ? "reviewer"
      : !gateApproved
        ? "mlro"
        : passportCode === "ready_for_issuance"
          ? "mlro"
          : passportCode === null
            ? "none"
            : "mlro";

  return {
    status: complete
      ? "complete"
      : blockers.length > 0
        ? "attention"
        : unavailableFacts.length > 0 && !gateApproved
          ? "unknown"
          : "in_progress",
    owner,
    summary: complete
      ? `The service may proceed and the Passport is in force${facts.passport?.version ? ` at v${facts.passport.version}` : ""}.`
      : gateApproved
        ? `Gate approved. Passport: ${passportLabel ?? "state unavailable"}.`
        : caseCleared && !gateStopped
          /* Says what approving actually finishes. The stage completed the
             moment the gate was approved on a case in this position, and
             nothing on the screen said so before the click. */
          ? `The case is cleared — the service gate (${SERVICE_GATE_LABELS[gate]}) awaits an authorised approval${
              gateOnlyPassport ? ", which is all that is left on this stage" : ""
            }.`
          : `${SERVICE_GATE_LABELS[gate]} — the designated service may not proceed yet.`,
    blockers,
    warnings,
    completedItems: completed,
    outstandingItems: outstanding,
    completedAt: issuedAt,
    primaryAction: complete
      ? null
      : !gateApproved
        /* `actionType` matters — without one this button fell to the
         * workspace switch's default, a scroll to a screening anchor that
         * does not exist, and changed nothing visible. Same class as the
         * Stage 6/7/8 buttons before it.
         *
         * It lands on the DECISION stage now. The gate is granted by the
         * cleared decision itself, so a cleared case still holding an open
         * gate is either one an MLRO stopped or one decided before that
         * change — and both are recorded on the Decision stage's full gate
         * card. Sending the operator to a card Stage 9 no longer mounts is
         * the dead-button class this label was written to escape. */
        ? {
            key: "gate", label: "Open the gate controls on the Decision stage",
            section: "risk", actionType: "record_gate",
          }
        : { key: "passport", label: "Open the Compliance Passport", section: "passport" },
    secondaryActions: [{ key: "passport_open", label: "Passport & reliance", section: "passport" }],
    sourceFacts,
    unavailableFacts,
  };
}

/* ══════════════════════════════════════════════════════════════════════
   13. Stage 10 — Ongoing CDD
   ══════════════════════════════════════════════════════════════════════

   ── What this stage stopped being ──────────────────────────────────────
   It used to read partner DISTRIBUTION readiness as well as monitoring, and
   that half was both a duplicate and, on a deployment like this one, a
   contradiction.

   A duplicate, because the partner roster — every organisation, and every
   act on it — lives on Passport & Partners; this stage only ever restated
   the same organisations with no act attached.

   A contradiction, because `facts.passport.partners` comes from
   `get_passport_distribution_readiness`, which is gated by
   `aml_passport_partner_distribution`. That flag is off wherever partners
   are onboarded one at a time through `grant_access` — as they are here —
   so the stage announced "Passport distribution is not enabled for this
   deployment" immediately after six partners had been given the Passport
   successfully. Both readings were about different things and only one of
   them was about this case.

   So the stage answers one question now: what keeps this case current once
   the service is under way. Issuance is not the end of AML.                */

function distributionStage(facts: AmlWorkspaceFacts): StageReading {
  const blockers: AmlJourneyNote[] = [];
  const warnings: AmlJourneyNote[] = [];
  const completed: AmlJourneyNote[] = [];
  const outstanding: AmlJourneyNote[] = [];
  const sourceFacts: string[] = [];
  const unavailableFacts: string[] = [];

  let owner: AmlJourneyOwner = "none";
  let summary = "The monitoring position could not be read.";

  let monitoringState: AmlEvidenceState = "unknown";
  if (loaded(facts.monitoring)) {
    sourceFacts.push("case monitoring summary");
    const m = facts.monitoring;
    const overdue = m.overdue_review_count ?? 0;
    const alerts = (m.open_alerts ?? []).length;
    if (m.relationship_ended_at) {
      monitoringState = "not_applicable";
      summary = "The business relationship has ended. The records are retained for the statutory period.";
      completed.push(note("ended", "Relationship ended — records retained", "steady"));
    } else if (overdue > 0) {
      monitoringState = "attention";
      owner = "analyst";
      summary = `${overdue} review${overdue === 1 ? " is" : "s are"} overdue.`;
      blockers.push(note("overdue", `${overdue} review${overdue === 1 ? "" : "s"} overdue`, "attention"));
    } else if (m.rescreen_overdue) {
      monitoringState = "attention";
      owner = "analyst";
      summary = "Screening refresh is overdue for this customer.";
      warnings.push(note("rescreen", "Screening refresh overdue", "attention"));
    } else if (alerts > 0) {
      monitoringState = "attention";
      owner = "analyst";
      summary = `${alerts} monitoring alert${alerts === 1 ? " is" : "s are"} open.`;
      warnings.push(note("alerts", `${alerts} open monitoring alert${alerts === 1 ? "" : "s"}`, "attention"));
    } else if (m.monitoring_status === "paused") {
      monitoringState = "attention";
      summary = "Monitoring is paused on this case.";
      warnings.push(note("paused", "Monitoring is paused", "attention"));
    } else {
      monitoringState = "complete";
      /* Says WHEN, not just "active": a review cycle nobody can name the end
         of reads as an empty state rather than as a standing obligation.
         The date comes from the open reviews the summary already carries —
         nothing new is fetched and nothing is derived. */
      const nextDue = (m.open_reviews ?? [])
        .map((r) => r.due_at)
        .filter((d): d is string => Boolean(d))
        .sort()[0];
      summary = nextDue
        ? `Monitoring is active. The next review is due ${new Date(nextDue).toLocaleDateString('en-AU')}.`
        : "Monitoring is active and nothing is overdue.";
      completed.push(note("monitoring", "Monitoring active, nothing overdue", "steady"));
    }
  } else {
    unavailableFacts.push("monitoring summary");
  }

  const status: AmlEvidenceState = monitoringState;

  return {
    status,
    owner: status === "complete" ? owner : owner === "none" ? "analyst" : owner,
    summary,
    blockers,
    warnings,
    completedItems: completed,
    outstandingItems: outstanding,
    primaryAction:
      status === "complete" || status === "not_applicable"
        ? null
        : { key: "monitoring", label: "Open ongoing CDD", section: "monitoring" },
    /* The partners are on the previous stage, with the Passport they hold —
       named here as a route rather than restated as a second register. */
    secondaryActions: [{ key: "passport", label: "Passport & partners", section: "passport" }],
    sourceFacts,
    unavailableFacts,
  };
}

/* ══════════════════════════════════════════════════════════════════════
   14. Assembly
   ══════════════════════════════════════════════════════════════════════ */

const STAGE_READERS: Record<AmlJourneyStageId, (facts: AmlWorkspaceFacts) => StageReading> = {
  activation: activationStage,
  intake: intakeStage,
  documents: documentsStage,
  identity: identityStage,
  screening: screeningStage,
  funding: fundingStage,
  submission: submissionStage,
  decision: decisionStage,
  passport: passportStage,
  distribution: distributionStage,
};

/**
 * Which stage the operator should be working.
 *
 * The first stage that is blocking wins; otherwise the first stage that is
 * not settled; otherwise the last stage. Deliberately NOT "the furthest
 * stage reached" — a case whose Passport is issued but whose documents were
 * never accepted has a real problem at stage 3, and the rail should say so.
 */
/** Statuses that represent real, readable, outstanding work. */
const WORKING_STATES: ReadonlyArray<AmlEvidenceState> = [
  "attention", "in_progress", "not_started",
];

function currentStage(stages: AmlJourneyStage[]): AmlJourneyStageId {
  /*
   * THE SEQUENCE DECIDES, and it decides first.
   *
   * This used to scan every stage for `blocking` before considering order,
   * so a LATER blocking stage outranked an EARLIER stage that merely had
   * outstanding work. Measured on the reopened case: Stage 5 held a required
   * PEP determination with no record (`not_started`, no blocker) while Stage
   * 7 had a submission to review (`attention`, blocking) — and the journey
   * reported "6 of 10" and then "Go to stage 7", stepping straight over a
   * requirement that genuinely holds Stage 5.
   *
   * The stages are sequential. A case cannot be AT stage 7 while stage 5 is
   * unfinished, whatever the relative urgency, so the first applicable stage
   * with real outstanding work wins.
   *
   * `unknown` is deliberately not "work". It means the fact could not be
   * read, and parking the whole journey on a failed read would be noise —
   * `unavailableFacts` already reports it honestly. It is still not
   * `complete`, so the fallback below catches it once nothing is outstanding.
   */
  /*
   * A stage that is BLOCKING outranks one that is merely unfinished, and the
   * earliest blocking stage wins. Both halves matter:
   *
   *   without "blocking first", a stage waiting on the CLIENT (intake, still
   *   in progress) claimed the position ahead of a determination the MLRO
   *   actually owed at stage 5 — measured in production, the rail read
   *   "2 of 10 · Client intake" while Stage 5 held the only actionable work;
   *
   *   without "earliest", a later blocking stage claimed it instead — which
   *   is how "6 of 10" and "Go to stage 7" appeared over the same blocker.
   */
  const blocking = stages.find((s) => s.applicable && s.blocking);
  if (blocking) return blocking.id;

  const working = stages.find(
    (s) => s.applicable && WORKING_STATES.includes(s.status),
  );
  if (working) return working.id;

  // Nothing is outstanding: rest on the first stage that is merely unread,
  // and on the last stage only when every applicable one is settled. This is
  // the behaviour the original second rule had.
  const open = stages.find(
    (s) => s.applicable && s.status !== "complete" && s.status !== "not_applicable",
  );
  return open?.id ?? stages[stages.length - 1].id;
}

/**
 * A finished case has no next move, and must not be given one.
 *
 * Found against the production register: `AML-2026-00002` is closed with a
 * terminated gate and — because it closed before requirements were ever set
 * — stage 3 read "No requirements set" as a blocker, which made Documents
 * the current stage and told an operator to go and chase a customer whose
 * relationship had ended. The facts on each stage stay exactly as they are;
 * what changes is that nothing on a closed case shouts, and the rail rests
 * on the retention end of the journey where the remaining obligations
 * actually live.
 *
 * `deriveAmlNextAction` has always short-circuited on the same two
 * conditions. This is the journey saying the same thing.
 */
function isFinished(facts: AmlWorkspaceFacts): boolean {
  /*
   * The LIFECYCLE decides this, and the service gate does not.
   *
   * `|| terminated` was added for `AML-2026-00002`, which is closed AND
   * terminated — but the two are different facts and only one of them means
   * the work is over. A terminated gate says the customer may not be SERVED;
   * it says nothing about whether the case is being worked.
   *
   * Reopening is exactly the state where they diverge: it restores the
   * ability to work the case and deliberately leaves the gate terminated. So
   * the reopened case reported "10 of 10 · Partners & ongoing CDD", rested on
   * the retention end of the journey, silenced Stage 5's outstanding PEP
   * determination, and told the operator "Case closed" — which made reopening
   * a no-op in every surface that mattered.
   */
  return caseStage(facts.caseRow) === "closed";
}

export function deriveAmlJourney(facts: AmlWorkspaceFacts): AmlJourney {
  const finished = isFinished(facts);
  const stages: AmlJourneyStage[] = STAGE_DEFINITIONS.map((def, index) => {
    const reading = STAGE_READERS[def.id](facts);
    const attention = attentionFor(reading);
    const applicable = reading.applicable !== false && reading.status !== "not_applicable";

    // A blocker is by definition outstanding. Enforcing that here rather
    // than in ten separate readers is what keeps the readiness count
    // honest: without it a stage could report "1 of 1 complete" while
    // something was visibly stopping it.
    const outstanding = [...(reading.outstandingItems ?? [])];
    for (const blocker of reading.blockers ?? []) {
      if (!outstanding.some((o) => o.key === blocker.key)) {
        outstanding.push({ ...blocker, key: `blocker:${blocker.key}` });
      }
    }

    return {
      id: def.id,
      number: index + 1,
      label: def.label,
      shortLabel: def.shortLabel,
      purpose: def.purpose,
      status: reading.status,
      // Filled in below, once every stage has been read — a stage cannot know
      // whether it is ahead of the sequence until its predecessors are known.
      aheadOfSequence: false,
      owner: reading.owner,
      ownerLabel: JOURNEY_OWNER_LABELS[reading.owner],
      attention,
      blocking:
        finished
          ? false
          : (reading.blocking ??
            ((reading.blockers ?? []).length > 0 &&
              (attention === "critical" || attention === "attention"))),
      summary: reading.summary,
      blockers: reading.blockers ?? [],
      warnings: reading.warnings ?? [],
      completedItems: reading.completedItems ?? [],
      outstandingItems: outstanding,
      primaryAction: reading.primaryAction ?? null,
      secondaryActions: reading.secondaryActions ?? [],
      completedAt: reading.completedAt ?? null,
      targetSection: def.sections[0],
      sections: def.sections,
      applicable,
      notApplicableReason: reading.notApplicableReason ?? null,
      sourceFacts: reading.sourceFacts ?? [],
      unavailableFacts: reading.unavailableFacts ?? [],
    };
  });

  const applicableStages = stages.filter((s) => s.applicable);

  /*
   * Qualify the sequence, without denying the evidence.
   *
   * A stage whose own evidence is complete while an EARLIER applicable stage
   * is not has not actually been progressed through — the rail is numbered,
   * and a green tick at 7 above an outstanding 5 reads as "the case got this
   * far". It did not.
   *
   * The status stays `complete`, because the evidence is real and every
   * count, gate and readiness figure derived from it must stay true. Only the
   * sequence is flagged, for the rail to render differently.
   */
  for (let i = 0; i < stages.length; i++) {
    if (stages[i].status !== "complete" || !stages[i].applicable) continue;
    stages[i].aheadOfSequence = stages
      .slice(0, i)
      .some((earlier) => earlier.applicable && earlier.status !== "complete");
  }

  return {
    stages,
    currentStageId: finished
      ? stages[stages.length - 1].id
      : currentStage(stages),
    completeCount: applicableStages.filter((s) => s.status === "complete").length,
    applicableCount: applicableStages.length,
    attention: highestAttention(stages.map((s) => s.attention)),
  };
}

/* ══════════════════════════════════════════════════════════════════════
   15. Live position — the four scalars the right rail always shows
   ══════════════════════════════════════════════════════════════════════ */

export interface AmlLivePosition {
  stageLabel: string;
  stageNumber: number;
  stageTotal: number;
  caseStageLabel: string;
  clientStatusLabel: string;
  financeStatusLabel: string;
  serviceGateLabel: string;
  /** Server-derived; `null` when the projection was not available. */
  passportLabel: string | null;
  passportVersion: number | null;
}

const CLIENT_STATUS_LABELS: Record<string, string> = {
  not_started: "Not started",
  action_required: "Action required",
  in_progress: "In progress",
  submitted: "Submitted",
  under_review: "Under review",
  additional_info_required: "Information requested",
  complete: "Complete",
  contact_adviser: "Asked to contact adviser",
};

const FINANCE_STATUS_LABELS: Record<string, string> = {
  not_requested: "Not requested",
  information_required: "Information required",
  submitted: "Submitted",
  clarification_required: "Clarification required",
  under_review: "Under review",
  accepted: "Accepted",
  no_further_action: "No further action",
};

export function deriveAmlLivePosition(
  facts: AmlWorkspaceFacts,
  journey: AmlJourney,
): AmlLivePosition {
  const active = journey.stages.find((s) => s.id === journey.currentStageId) ?? journey.stages[0];
  const portal = clientPortalStatus(facts.caseRow);
  const finance = financePortalStatus(facts.caseRow);

  return {
    stageLabel: active.label,
    stageNumber: active.number,
    stageTotal: JOURNEY_STAGES.length,
    caseStageLabel: CASE_STAGE_LABELS[caseStage(facts.caseRow)],
    clientStatusLabel: CLIENT_STATUS_LABELS[portal] ?? portal,
    financeStatusLabel: FINANCE_STATUS_LABELS[finance] ?? finance,
    serviceGateLabel: SERVICE_GATE_LABELS[serviceGateStatus(facts.caseRow)],
    // Again: `enabled` gates distribution, not the credential. The label is
    // whatever the server derived, or `null` when nothing was readable.
    passportLabel: facts.passport?.state?.label ?? null,
    passportVersion: facts.passport?.version ?? null,
  };
}
