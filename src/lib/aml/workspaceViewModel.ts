/**
 * AML case workspace view model — PRESENTATION ONLY.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * READ THIS BEFORE CHANGING ANYTHING IN THIS FILE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Everything here is a *reading* of state that already exists. Nothing in
 * this module is, or may become, an authority for an AML decision:
 *
 *   • It never fetches. Callers pass facts in; the functions are pure.
 *   • It never persists. There is no `next_action` column and there must
 *     not be one — the value is recomputed from canonical state each render.
 *   • It never decides. The service gate is moved by an explicit human
 *     decision recorded server-side (`aml-risk set_service_gate`), and by
 *     nothing else. `deriveAmlServiceReadiness` reads
 *     `service_gate_status` — it does not compute a gate from risk, from
 *     identity, from screening or from how much of the UI is ticked.
 *   • It never invents. Where a fact was not supplied (not loaded, or the
 *     read failed) the derivation says `unknown` and names the missing
 *     fact rather than guessing a friendlier answer.
 *
 * The one job of this module is to let an analyst answer, in seconds:
 * what is this case, where is it, what needs attention, what is blocking
 * it, what is the risk position, what should I do next, what evidence
 * supports that, what happened recently, who else is connected, and may
 * the designated service proceed.
 *
 * Canonical inputs are the workflow dimensions in `caseDimensions.ts`
 * (`case_stage`, `client_portal_status`, `finance_portal_status`,
 * `service_gate_status`), `aml.cases.risk_rating`, and the evidence
 * projections the existing read APIs already return. The *granular*
 * fourteen-step process rail in `caseDimensions.ts` is untouched and still
 * canonical; the five macro phases below are a map drawn over it.
 */

import { deriveFundingObligation } from "./fundingObligation.pure";
import {
  CASE_STAGE_LABELS,
  SERVICE_GATE_LABELS,
  caseStage,
  clientPortalStatus,
  serviceGateStatus,
  type AmlCaseStage,
  type AmlServiceGateStatus,
  type CaseDimensionSource,
} from "./caseDimensions";
import type { AmlRiskRating } from "./amlCasesApi";
import type { AmlPortalAccessFacts } from "./portalAccessState";
import { deriveScreeningStatus } from "./screeningStatus.pure";

/* ══════════════════════════════════════════════════════════════════════
   1. Information architecture — five operator areas over the existing
      sections. The section keys are unchanged, so every `?section=`
      deep link that worked before still works.
   ══════════════════════════════════════════════════════════════════════ */

export const WORKSPACE_SECTIONS = [
  "overview",
  "identity",
  "ownership",
  "counterparty",
  "finance",
  "documents",
  "submission-review",
  "risk",
  "requests",
  "passport",
  "monitoring",
  "timeline",
] as const;
export type AmlWorkspaceSection = (typeof WORKSPACE_SECTIONS)[number];

export const WORKSPACE_AREAS = [
  "overview",
  "customer",
  "transaction",
  "decision",
  "records",
] as const;
export type AmlWorkspaceArea = (typeof WORKSPACE_AREAS)[number];

export const AREA_LABELS: Record<AmlWorkspaceArea, string> = {
  overview: "Overview",
  customer: "Customer",
  transaction: "Transaction",
  decision: "Risk & decision",
  records: "Records",
};

/**
 * Which existing sections live under each area. Grouping only — no section
 * gained or lost capability by moving, and the components mounted by each
 * section are the same components as before.
 */
export const AREA_SECTIONS: Record<AmlWorkspaceArea, readonly AmlWorkspaceSection[]> = {
  overview: ["overview"],
  customer: ["identity", "ownership"],
  transaction: ["counterparty", "finance", "documents", "submission-review"],
  decision: ["risk"],
  records: ["requests", "passport", "monitoring", "timeline"],
};

const SECTION_TO_AREA: Record<AmlWorkspaceSection, AmlWorkspaceArea> = (() => {
  const out = {} as Record<AmlWorkspaceSection, AmlWorkspaceArea>;
  for (const area of WORKSPACE_AREAS) {
    for (const section of AREA_SECTIONS[area]) out[section] = area;
  }
  return out;
})();

export function isWorkspaceSection(value: string | null | undefined): value is AmlWorkspaceSection {
  return !!value && (WORKSPACE_SECTIONS as readonly string[]).includes(value);
}

export function areaForSection(section: AmlWorkspaceSection): AmlWorkspaceArea {
  return SECTION_TO_AREA[section] ?? "overview";
}

/** The section an area opens on when the operator picks the area itself. */
export function defaultSectionForArea(area: AmlWorkspaceArea): AmlWorkspaceSection {
  return AREA_SECTIONS[area][0];
}

/* ══════════════════════════════════════════════════════════════════════
   2. Shared status vocabulary
   ══════════════════════════════════════════════════════════════════════ */

/**
 * How loudly a thing should read. Deliberately short: colour is scarce, so
 * only `critical` and `attention` earn a tone. `waiting` is a neutral
 * "someone else has the ball", `steady` is neutral-positive, `none` is
 * silent.
 */
export type AmlAttentionLevel = "critical" | "attention" | "waiting" | "steady" | "none";

const ATTENTION_ORDER: Record<AmlAttentionLevel, number> = {
  critical: 0,
  attention: 1,
  waiting: 2,
  steady: 3,
  none: 4,
};

export function highestAttention(levels: AmlAttentionLevel[]): AmlAttentionLevel {
  return levels.reduce<AmlAttentionLevel>(
    (worst, level) => (ATTENTION_ORDER[level] < ATTENTION_ORDER[worst] ? level : worst),
    "none",
  );
}

/** State of one evidence line in the compliance summary. */
export type AmlEvidenceState =
  | "complete"
  | "in_progress"
  | "attention"
  | "not_started"
  | "not_applicable"
  | "unknown";

export const EVIDENCE_STATE_LABELS: Record<AmlEvidenceState, string> = {
  complete: "Complete",
  in_progress: "In progress",
  attention: "Attention required",
  not_started: "Not started",
  not_applicable: "Not applicable",
  unknown: "Not available",
};

/* ══════════════════════════════════════════════════════════════════════
   3. Facts — the shapes this module reads
   ══════════════════════════════════════════════════════════════════════

   Every evidence group is optional. `undefined` means "not loaded yet",
   `null` means "we asked and could not read it". Both produce `unknown`
   rather than a cheerful default, and both are named in
   `unavailableFacts` so the operator can see the reading is partial.        */

export interface AmlWorkspaceCaseFacts extends CaseDimensionSource {
  id?: string;
  case_reference?: string;
  subject_display_name?: string;
  subject_type?: string;
  risk_rating?: AmlRiskRating | null;
  closed_at?: string | null;
  updated_at?: string;
  /** Explicit activation contract columns (Phase 1). Null on legacy rows. */
  activation_timing?: string | null;
  agreement_state?: string | null;
}

/** `aml-verification list_verification_checks` rows. */
export interface AmlIdentityFacts {
  checks: Array<{
    party_label?: string | null;
    check_type?: string | null;
    status: string;
    processing_status?: string | null;
    attempt_consumed?: boolean | null;
    superseded_at?: string | null;
  }>;
}

/** `aml-cases list_party_screening` subjects (canonical matches included). */
export interface AmlScreeningFacts {
  subjects: Array<{
    screened_name?: string | null;
    required?: boolean;
    state: string;
    error_category?: string | null;
    /** When the row last changed — how a stalled queue is recognised. */
    updated_at?: string | null;
    matches?: Array<{ status: string; match_type?: string | null; matched_name?: string }>;
    /**
     * The party's current PEP determination, when one exists.
     *
     * `list_party_screening` has always returned it; the journey reading did
     * not ask for it and so could not see the one thing genuinely outstanding
     * on a case whose sanctions obligation had been stood down. Absent means
     * "no determination", which is outstanding — never satisfied.
     */
    pep_determination?: { result?: string | null; review_due_at?: string | null } | null;
  }>;
  /**
   * Whether a PEP determination is owed at all, from the server's recorded
   * scope decision. Absent means unread, which reads as owed: an unread
   * obligation is not an absent one.
   */
  pepRequired?: boolean | null;
}

/** `aml-monitoring case_monitoring_summary`. */
export interface AmlMonitoringFacts {
  monitoring_status?: string | null;
  relationship_ended_at?: string | null;
  open_alerts?: Array<{ id?: string; title?: string; severity?: string | null }>;
  open_edd?: Array<{ id?: string; reason?: string; status?: string | null }>;
  open_reviews?: Array<{ id?: string; due_at?: string | null }>;
  overdue_review_count?: number;
  rescreen_overdue?: boolean;
}

/** `aml-risk gate_contract` — the canonical record of the gate decision. */
export interface AmlGateFacts {
  status?: string | null;
  effective_at?: string | null;
  approved_by?: string | null;
  reason?: string | null;
  decision_id?: string | null;
  conditions?: Array<{ id?: string; label: string; status?: string }>;
}

/** `aml-cases list_requirements`. */
export interface AmlDocumentFacts {
  requirements: Array<{ label?: string; required?: boolean; status?: string | null }>;
}

/** `aml-entities list_entities_for_case`. */
export interface AmlOwnershipFacts {
  links: Array<{ entity_id?: string | null; link_role?: string | null }>;
}

/** `aml-monitoring list_sof`. */
export interface AmlFundingFacts {
  sources: Array<{ verified?: boolean; source_type?: string; description?: string | null }>;
}

/** `aml.cases.metadata.activation`, written once at activation time. */
export interface AmlActivationFacts {
  model?: string | null;
  event?: string | null;
  activated_by_email?: string | null;
  activated_at?: string | null;
  program_version?: string | null;
}

/** `aml-cases consent_status` — the AUSTRAC-referenced consent catalogue. */
export interface AmlConsentFacts {
  satisfied: boolean;
  outstanding: string[];
  version?: string | number | null;
}

/** `aml-transactions list_transactions`, when the role may read the matter. */
export interface AmlTransactionFacts {
  transactions: Array<{
    status?: string | null;
    settlement_date?: string | null;
    property_address?: string | null;
    reference?: string | null;
  }>;
}

/**
 * `aml-reliance get_passport_distribution_status`.
 *
 * Every field here is SERVER-DERIVED and rendered verbatim. The browser has
 * no passport-state derivation of its own and must never gain one: there is
 * one `derivePassportState` and it runs in the edge function, which is what
 * makes "the journey says issued, the Passport says pending" impossible.
 * `enabled: false` means the distribution surface is switched off for this
 * deployment — materially different from "the Passport is not ready".
 */
export interface AmlPassportFacts {
  /**
   * Whether PARTNER DISTRIBUTION is switched on for this deployment. It says
   * nothing about the credential: the server returns the real passport state
   * either way, and reading the state only when distribution is enabled
   * reports "not available" for a Passport whose state is perfectly well
   * known. `undefined` = the state was recovered from the projection, which
   * does not describe distribution at all.
   */
  enabled?: boolean;
  /**
   * `reasons` is the server's own machine-readable account of WHY the state
   * is what it is, and it is load-bearing rather than diagnostic:
   * `refresh_required` covers two different owed acts — a version that is
   * out of date, and a service gate that has not been approved — and only
   * the reasons tell them apart. `refreshRemedy` is the one place that
   * classifies them. Absent on a deployment that predates them.
   */
  state?: {
    code?: string | null; label?: string | null; tone?: string | null;
    reasons?: string[] | null;
  } | null;
  version?: number | null;
  issued_at?: string | null;
  /** `undefined` = not read (absent), `[]` = read and genuinely none. */
  partners?: Array<{
    partner?: { org_id?: string | null; org_name?: string | null; portal_type?: string | null } | null;
    state?: string | null;
    ready?: boolean;
    blockers?: string[];
    legal_route?: string | null;
  }>;
  summary?: { total?: number; ready?: number; already_current?: number; blocked?: number } | null;
}

export interface AmlWorkspaceFacts {
  caseRow: AmlWorkspaceCaseFacts;
  /** Count of client requests still open or awaiting our follow-up. */
  openClientRequests?: number;
  identity?: AmlIdentityFacts | null;
  screening?: AmlScreeningFacts | null;
  monitoring?: AmlMonitoringFacts | null;
  gate?: AmlGateFacts | null;
  documents?: AmlDocumentFacts | null;
  ownership?: AmlOwnershipFacts | null;
  funding?: AmlFundingFacts | null;
  /* ── Added for the journey reading (`journeyModel.ts`). Every one is
        optional and absent means `unknown`, exactly as above — no existing
        derivation reads them, so nothing already shipped changed. ──────── */
  activation?: AmlActivationFacts | null;
  consent?: AmlConsentFacts | null;
  transactions?: AmlTransactionFacts | null;
  passport?: AmlPassportFacts | null;
  /**
   * Whether the client holds a Client Portal login.
   *
   * Distinct from `caseRow.client_portal_status`, which says how far they
   * have got. Absent (`undefined`/`null`) means the read did not happen, and
   * every reader degrades rather than guessing that there is no account.
   */
  portalAccess?: AmlPortalAccessFacts | null;
  /**
   * The recorded perimeter classification, from `sync_screening_stage`.
   *
   * Threaded in the same way `screening.pepRequired` is — the workspace
   * already holds that read, and a second copy of an idempotent compliance
   * read is a second thing to keep in step. Absent means unclassified, which
   * means INSIDE: an unclassified case is not an exempt one.
   */
  perimeter?: {
    classified?: boolean | null;
    classification?: string | null;
    reason_code?: string | null;
  } | null;
}

/* Small readers that keep the "was this loaded?" question in one place. */
const loaded = <T>(v: T | null | undefined): v is T => v !== null && v !== undefined;

/** Only technical failures may be retried — they are ours, not the customer's. */
const RETRYABLE_PROCESSING = new Set(["technical_failure", "dead_lettered"]);

/* ══════════════════════════════════════════════════════════════════════
   4. Macro phase — five presentation stages over the canonical stages
   ══════════════════════════════════════════════════════════════════════ */

export const MACRO_PHASES = ["collect", "verify", "assess", "decide", "monitor"] as const;
export type AmlMacroPhaseKey = (typeof MACRO_PHASES)[number];

export const MACRO_PHASE_LABELS: Record<AmlMacroPhaseKey, string> = {
  collect: "Collect",
  verify: "Verify",
  assess: "Assess",
  decide: "Decide",
  monitor: "Monitor",
};

export const MACRO_PHASE_DESCRIPTIONS: Record<AmlMacroPhaseKey, string> = {
  collect: "Activation, client invitation and information collection.",
  verify: "Identity verification, screening, ownership and funding evidence.",
  assess: "Risk assessment, enhanced due diligence and analyst recommendation.",
  decide: "Reviewer or MLRO decision and the service gate.",
  monitor: "Ongoing customer due diligence, reviews and retention.",
};

export type AmlMacroPhaseState =
  | "complete"
  | "current"
  | "attention"
  | "blocked"
  | "not_started";

export interface AmlMacroPhase {
  key: AmlMacroPhaseKey;
  label: string;
  description: string;
  state: AmlMacroPhaseState;
}

export interface AmlMacroProgress {
  phase: AmlMacroPhaseKey;
  phases: AmlMacroPhase[];
  /** Which canonical facts produced this reading. */
  sourceFacts: string[];
}

/**
 * Canonical stage → macro phase. This is the whole mapping and the only
 * place it exists; the fourteen-step `progressRail` remains untouched and
 * remains the detailed view (Records → Timeline still shows it).
 *
 * `blocked` sits at DECIDE rather than at a phase of its own: a blocked
 * case has stopped at the point where the service gate would be moved,
 * which is exactly where the operator has to act.
 */
export const STAGE_TO_MACRO_PHASE: Record<AmlCaseStage, AmlMacroPhaseKey> = {
  draft: "collect",
  activated: "collect",
  awaiting_client: "collect",
  client_in_progress: "collect",
  additional_info_required: "collect",
  client_submitted: "verify",
  checks_in_progress: "verify",
  enhanced_cdd: "assess",
  staff_review: "assess",
  decision_pending: "decide",
  blocked: "decide",
  cleared: "monitor",
  cleared_with_conditions: "monitor",
  closed: "monitor",
};

export function deriveAmlMacroPhase(facts: AmlWorkspaceFacts): AmlMacroProgress {
  const stage = caseStage(facts.caseRow);
  const gate = serviceGateStatus(facts.caseRow);
  const current = STAGE_TO_MACRO_PHASE[stage] ?? "collect";
  const currentIndex = MACRO_PHASES.indexOf(current);

  const sourceFacts = [
    `case_stage = ${stage}`,
    `service_gate_status = ${gate}`,
  ];

  // Attention overlays. Both come from canonical state, never from how much
  // of the interface has been filled in.
  const attention =
    stage === "additional_info_required" ||
    stage === "enhanced_cdd" ||
    gate === "conditions_outstanding";
  const blocked = stage === "blocked" || gate === "locked" || gate === "terminated";

  const gateSettled = gate === "approved" || gate === "approved_with_controls";

  const phases = MACRO_PHASES.map<AmlMacroPhase>((key, index) => {
    let state: AmlMacroPhaseState =
      index < currentIndex ? "complete" : index === currentIndex ? "current" : "not_started";

    if (index === currentIndex) {
      if (blocked) state = "blocked";
      else if (attention) state = "attention";
    }

    // The gate is an explicit decision, so DECIDE reads from the gate and
    // not from where the stage happens to sit.
    if (key === "decide") {
      if (blocked) state = "blocked";
      else if (gateSettled) state = "complete";
      else if (index < currentIndex) state = "current";
    }

    // A closed case has ended the relationship; MONITOR is where retention
    // lives, so it is current rather than complete.
    if (key === "monitor" && stage === "closed") state = "current";

    return {
      key,
      label: MACRO_PHASE_LABELS[key],
      description: MACRO_PHASE_DESCRIPTIONS[key],
      state,
    };
  });

  return { phase: current, phases, sourceFacts };
}

/* ══════════════════════════════════════════════════════════════════════
   5. Service readiness — a reading of the explicit gate decision
   ══════════════════════════════════════════════════════════════════════ */

export type AmlReadinessLevel =
  | "ready"
  | "ready_with_controls"
  | "conditions_outstanding"
  | "under_review"
  | "not_ready"
  | "blocked"
  | "ended";

export interface AmlServiceReadiness {
  level: AmlReadinessLevel;
  gate: AmlServiceGateStatus;
  /** Plain-English headline, phrased as a statement about the service. */
  label: string;
  detail: string;
  attention: AmlAttentionLevel;
  /** Why the designated service may not proceed, drawn from canonical state. */
  reasons: string[];
  openConditions: Array<{ id?: string; label: string }>;
  decidedAt: string | null;
  decidedBy: string | null;
  sourceFacts: string[];
  unavailableFacts: string[];
}

const READINESS_BY_GATE: Record<AmlServiceGateStatus, AmlReadinessLevel> = {
  approved: "ready",
  approved_with_controls: "ready_with_controls",
  conditions_outstanding: "conditions_outstanding",
  under_review: "under_review",
  not_activated: "not_ready",
  cdd_incomplete: "not_ready",
  information_outstanding: "not_ready",
  locked: "blocked",
  terminated: "ended",
};

const READINESS_COPY: Record<AmlReadinessLevel, { label: string; detail: string; attention: AmlAttentionLevel }> = {
  ready: {
    label: "The designated service may proceed",
    detail: "The service gate has been approved by an authorised decision-maker.",
    attention: "steady",
  },
  ready_with_controls: {
    label: "May proceed, with controls",
    detail: "Approved subject to the controls recorded with the decision.",
    attention: "steady",
  },
  conditions_outstanding: {
    label: "Conditions outstanding",
    detail: "The decision is recorded but conditions attached to it are not yet met.",
    attention: "attention",
  },
  under_review: {
    label: "Under review — not yet decided",
    detail: "No gate decision has been recorded for this case yet.",
    attention: "waiting",
  },
  not_ready: {
    label: "The designated service may not proceed",
    detail: "The gate has not been approved.",
    attention: "waiting",
  },
  blocked: {
    label: "Locked — the service may not proceed",
    detail: "The service gate is locked. It reopens only on an explicit decision.",
    attention: "critical",
  },
  ended: {
    label: "Terminated",
    detail: "This case has been terminated; the gate cannot be approved.",
    attention: "none",
  },
};

/** Canonical gate value → the reason it states, in words an operator uses. */
const GATE_REASON: Partial<Record<AmlServiceGateStatus, string>> = {
  not_activated: "The case has not been activated.",
  cdd_incomplete: "Customer due diligence is not complete.",
  information_outstanding: "Information requested from the customer is outstanding.",
  under_review: "A gate decision has not been recorded yet.",
  conditions_outstanding: "Conditions attached to the decision are not yet met.",
  locked: "The gate is locked.",
  terminated: "The case has been terminated.",
};

export function deriveAmlServiceReadiness(facts: AmlWorkspaceFacts): AmlServiceReadiness {
  const gate = serviceGateStatus(facts.caseRow);
  const level = READINESS_BY_GATE[gate];
  const copy = READINESS_COPY[level];

  const sourceFacts = [`service_gate_status = ${gate}`];
  const unavailableFacts: string[] = [];

  const openConditions: Array<{ id?: string; label: string }> = [];
  let decidedAt: string | null = null;
  let decidedBy: string | null = null;

  if (loaded(facts.gate)) {
    sourceFacts.push("aml-risk gate_contract");
    decidedAt = facts.gate.effective_at ?? null;
    decidedBy = facts.gate.approved_by ?? null;
    for (const condition of facts.gate.conditions ?? []) {
      if ((condition.status ?? "open") === "open") {
        openConditions.push({ id: condition.id, label: condition.label });
      }
    }
  } else {
    unavailableFacts.push("service-gate contract (conditions, decision record)");
  }

  const reasons: string[] = [];
  const gateReason = GATE_REASON[gate];
  if (gateReason) reasons.push(gateReason);
  if (openConditions.length > 0) {
    reasons.push(
      `${openConditions.length} condition${openConditions.length === 1 ? "" : "s"} outstanding.`,
    );
  }
  if (loaded(facts.gate) && facts.gate.reason) reasons.push(facts.gate.reason);

  return {
    level,
    gate,
    label: copy.label,
    detail: copy.detail,
    attention: copy.attention,
    reasons,
    openConditions,
    decidedAt,
    decidedBy,
    sourceFacts,
    unavailableFacts,
  };
}

/* ══════════════════════════════════════════════════════════════════════
   6. Compliance summary — one line per evidence stream
   ══════════════════════════════════════════════════════════════════════ */

export interface AmlComplianceRow {
  key:
    | "identity"
    | "screening"
    | "ownership"
    | "funding"
    | "documents"
    | "edd"
    | "monitoring";
  label: string;
  state: AmlEvidenceState;
  /** One short clause of substance — counts, not adjectives. */
  detail: string;
  section: AmlWorkspaceSection;
}

export interface AmlComplianceSummary {
  rows: AmlComplianceRow[];
  sourceFacts: string[];
  unavailableFacts: string[];
}

function identityRow(facts: AmlWorkspaceFacts): AmlComplianceRow {
  const base = { key: "identity" as const, label: "Identity", section: "identity" as const };
  if (!loaded(facts.identity)) {
    return { ...base, state: "unknown", detail: EVIDENCE_STATE_LABELS.unknown };
  }
  const live = facts.identity.checks.filter((c) => !c.superseded_at);
  if (live.length === 0) {
    return { ...base, state: "not_started", detail: "No verification attempt recorded" };
  }

  const technical = live.filter((c) => RETRYABLE_PROCESSING.has(String(c.processing_status ?? "")));
  const referred = live.filter((c) => c.status === "referred");
  const failed = live.filter((c) => c.status === "failed" || c.status === "exhausted");
  const passed = live.filter((c) => c.status === "passed");
  const inFlight = live.filter((c) => c.status === "pending" || c.status === "in_progress");

  // A provider outage is ours, not the customer's — it is separated from an
  // identity outcome everywhere else in the system, so it is separated here.
  if (technical.length > 0) {
    return {
      ...base,
      state: "attention",
      detail: `${technical.length} check${technical.length === 1 ? "" : "s"} stopped on a technical failure`,
    };
  }
  if (referred.length > 0) {
    return {
      ...base,
      state: "attention",
      detail: `${referred.length} referred for review`,
    };
  }
  if (failed.length > 0) {
    return {
      ...base,
      state: "attention",
      detail: `${failed.length} unsuccessful of ${live.length}`,
    };
  }
  if (inFlight.length > 0) {
    return { ...base, state: "in_progress", detail: `${inFlight.length} in progress` };
  }
  if (passed.length === live.length) {
    return {
      ...base,
      state: "complete",
      detail: `${passed.length} verified`,
    };
  }
  return { ...base, state: "in_progress", detail: `${passed.length} of ${live.length} verified` };
}

function screeningRow(facts: AmlWorkspaceFacts): AmlComplianceRow {
  const base = { key: "screening" as const, label: "Screening", section: "identity" as const };
  if (!loaded(facts.screening)) {
    return { ...base, state: "unknown", detail: EVIDENCE_STATE_LABELS.unknown };
  }
  const enrolled = facts.screening.subjects;
  const subjects = enrolled.filter((s) => s.state !== "not_required");
  if (subjects.length === 0 && enrolled.length > 0) {
    /*
     * Enrolled, and every party's screening obligation stood down by the
     * recorded scope. Not owed is not the same as not done, and reporting it
     * as `not_started` put "No screening subjects recorded" on a compliance
     * summary for a case that had a subject and needed no screening.
     */
    return { ...base, state: "not_applicable", detail: "Not required under the recorded scope" };
  }
  if (subjects.length === 0) {
    return { ...base, state: "not_started", detail: "No screening subjects recorded" };
  }

  const openMatches = subjects.reduce(
    (n, s) => n + (s.matches ?? []).filter((m) => m.status === "open").length,
    0,
  );
  const possible = subjects.filter((s) => s.state === "possible_match");
  const confirmed = subjects.filter((s) => s.state === "confirmed_match");
  const errored = subjects.filter((s) => s.state === "error");
  const pending = subjects.filter((s) => ["not_started", "queued", "processing"].includes(s.state));
  const settled = subjects.filter((s) => ["completed", "false_positive"].includes(s.state));

  if (confirmed.length > 0) {
    return {
      ...base,
      state: "attention",
      detail: `${confirmed.length} confirmed match${confirmed.length === 1 ? "" : "es"}`,
    };
  }
  if (possible.length > 0 || openMatches > 0) {
    const n = Math.max(possible.length, openMatches);
    return { ...base, state: "attention", detail: `${n} unresolved match${n === 1 ? "" : "es"}` };
  }
  // A screening run that failed technically stays outstanding — it never
  // reads as clear.
  if (errored.length > 0) {
    return {
      ...base,
      state: "attention",
      detail: `${errored.length} screening run${errored.length === 1 ? "" : "s"} did not complete`,
    };
  }
  if (pending.length > 0) {
    return { ...base, state: "in_progress", detail: `${pending.length} of ${subjects.length} outstanding` };
  }
  if (settled.length === subjects.length) {
    return { ...base, state: "complete", detail: `${subjects.length} screened, no open matches` };
  }
  return { ...base, state: "in_progress", detail: `${settled.length} of ${subjects.length} screened` };
}

function ownershipRow(facts: AmlWorkspaceFacts): AmlComplianceRow {
  const base = {
    key: "ownership" as const,
    label: "Ownership & control",
    section: "ownership" as const,
  };
  const subjectType = facts.caseRow.subject_type;
  if (!loaded(facts.ownership)) {
    // An individual customer has no ownership structure — that is a property
    // of the case, not of a read we failed to make.
    if (subjectType === "individual") {
      return { ...base, state: "not_applicable", detail: "Individual customer" };
    }
    return { ...base, state: "unknown", detail: EVIDENCE_STATE_LABELS.unknown };
  }
  const links = facts.ownership.links.filter((l) => l.entity_id);
  if (links.length === 0) {
    return subjectType === "individual"
      ? { ...base, state: "not_applicable", detail: "Individual customer" }
      : { ...base, state: "attention", detail: "No entity structure linked" };
  }
  // Deliberately never `complete`: whether a structure is fully mapped
  // depends on the ownership summary for the entity, which this reading
  // does not load. Saying "in progress" is the honest answer.
  return {
    ...base,
    state: "in_progress",
    detail: `${links.length} linked entit${links.length === 1 ? "y" : "ies"} — open to review`,
  };
}

function fundingRow(facts: AmlWorkspaceFacts): AmlComplianceRow {
  const base = { key: "funding" as const, label: "Source of funds", section: "finance" as const };
  if (!loaded(facts.funding)) {
    return { ...base, state: "unknown", detail: EVIDENCE_STATE_LABELS.unknown };
  }
  const items = facts.funding.sources;
  if (items.length === 0) {
    return { ...base, state: "not_started", detail: "No source of funds recorded" };
  }
  const verified = items.filter((i) => i.verified).length;
  if (verified === items.length) {
    return { ...base, state: "complete", detail: `${verified} source${verified === 1 ? "" : "s"} verified` };
  }
  return { ...base, state: "in_progress", detail: `${verified} of ${items.length} verified` };
}

function documentsRow(facts: AmlWorkspaceFacts): AmlComplianceRow {
  const base = {
    key: "documents" as const,
    label: "Documents & evidence",
    section: "documents" as const,
  };
  if (!loaded(facts.documents)) {
    return { ...base, state: "unknown", detail: EVIDENCE_STATE_LABELS.unknown };
  }
  const all = facts.documents.requirements;
  if (all.length === 0) {
    return { ...base, state: "not_started", detail: "No requirements set" };
  }
  const required = all.filter((r) => r.required !== false);
  const status = (r: { status?: string | null }) => String(r.status ?? "pending");
  const awaitingReview = all.filter((r) => status(r) === "uploaded");
  const rejected = all.filter((r) => status(r) === "rejected");
  const settled = required.filter((r) => ["accepted", "waived"].includes(status(r)));

  if (awaitingReview.length > 0) {
    return {
      ...base,
      state: "attention",
      detail: `${awaitingReview.length} awaiting review`,
    };
  }
  if (rejected.length > 0) {
    return { ...base, state: "attention", detail: `${rejected.length} rejected, re-upload requested` };
  }
  if (required.length > 0 && settled.length === required.length) {
    return { ...base, state: "complete", detail: `${settled.length} of ${required.length} accepted` };
  }
  return {
    ...base,
    state: settled.length === 0 ? "not_started" : "in_progress",
    detail: `${settled.length} of ${required.length} accepted`,
  };
}

function eddRow(facts: AmlWorkspaceFacts): AmlComplianceRow {
  const base = { key: "edd" as const, label: "Enhanced due diligence", section: "risk" as const };
  const stage = caseStage(facts.caseRow);
  if (!loaded(facts.monitoring)) {
    return stage === "enhanced_cdd"
      ? { ...base, state: "attention", detail: "Enhanced due diligence is open" }
      : { ...base, state: "unknown", detail: EVIDENCE_STATE_LABELS.unknown };
  }
  const open = facts.monitoring.open_edd ?? [];
  if (open.length > 0) {
    return { ...base, state: "attention", detail: `${open.length} open` };
  }
  if (stage === "enhanced_cdd") {
    return { ...base, state: "attention", detail: "Case stage is enhanced due diligence" };
  }
  return { ...base, state: "not_applicable", detail: "None open" };
}

function monitoringRow(facts: AmlWorkspaceFacts): AmlComplianceRow {
  const base = { key: "monitoring" as const, label: "Monitoring", section: "monitoring" as const };
  if (!loaded(facts.monitoring)) {
    return { ...base, state: "unknown", detail: EVIDENCE_STATE_LABELS.unknown };
  }
  const m = facts.monitoring;
  if (m.relationship_ended_at) {
    return { ...base, state: "not_applicable", detail: "Relationship ended" };
  }
  const overdue = m.overdue_review_count ?? 0;
  const alerts = (m.open_alerts ?? []).length;
  if (overdue > 0) {
    return { ...base, state: "attention", detail: `${overdue} review${overdue === 1 ? "" : "s"} overdue` };
  }
  if (m.rescreen_overdue) {
    return { ...base, state: "attention", detail: "Screening refresh overdue" };
  }
  if (alerts > 0) {
    return { ...base, state: "attention", detail: `${alerts} open alert${alerts === 1 ? "" : "s"}` };
  }
  if (m.monitoring_status === "paused") {
    return { ...base, state: "attention", detail: "Monitoring is paused" };
  }
  return { ...base, state: "complete", detail: "Active, nothing overdue" };
}

export function deriveAmlComplianceSummary(facts: AmlWorkspaceFacts): AmlComplianceSummary {
  const rows = [
    identityRow(facts),
    screeningRow(facts),
    ownershipRow(facts),
    fundingRow(facts),
    documentsRow(facts),
    eddRow(facts),
    monitoringRow(facts),
  ];

  const sourceFacts: string[] = [];
  const unavailableFacts: string[] = [];
  const note = (label: string, present: boolean) =>
    (present ? sourceFacts : unavailableFacts).push(label);

  note("verification checks", loaded(facts.identity));
  note("party screening subjects", loaded(facts.screening));
  note("case monitoring summary", loaded(facts.monitoring));
  note("document requirements", loaded(facts.documents));
  note("linked entities", loaded(facts.ownership));
  note("source of funds", loaded(facts.funding));

  return { rows, sourceFacts, unavailableFacts };
}

/* ══════════════════════════════════════════════════════════════════════
   7. Next action
   ══════════════════════════════════════════════════════════════════════

   The ranking below is the whole priority policy, expressed once, in
   order. It is guidance for the operator: it moves nothing, and the fact
   that the interface suggests an action confers no authority to take it —
   every button underneath still calls the same server operation with the
   same server-side authorisation it always had.                            */

export interface AmlNextAction {
  key: string;
  /** Imperative, short, in the operator's language. */
  label: string;
  /** One sentence saying why, in terms of the facts that produced it. */
  explanation: string;
  attention: AmlAttentionLevel;
  /** Where in the workspace the work is done. */
  section: AmlWorkspaceSection;
  /** Whether this is stopping the case progressing. */
  blocking: boolean;
  /** Existing action vocabulary, where one applies. Never a new mutation. */
  actionType?: string;
  /** Canonical facts this reading used. */
  sourceFacts: string[];
  /** Facts that could not be read, so the reading is partial. */
  unavailableFacts: string[];
  /** True when a fact needed to rank confidently was missing. */
  partial: boolean;
  /**
   * Which journey stage this action belongs to, and where it sits in the ten.
   *
   * The MLRO is walking a numbered journey, and an action that just says "Go
   * to it" gives them no way to tell whether they are being sent forward past
   * work that is still outstanding. Naming the stage is what makes a jump
   * legible — and ordering by it is what stops most jumps happening at all.
   */
  stageOrder: number;
  stageSection: AmlWorkspaceSection;
}

interface Candidate {
  key: string;
  label: string;
  explanation: string;
  attention: AmlAttentionLevel;
  section: AmlWorkspaceSection;
  blocking: boolean;
  actionType?: string;
  facts: string[];
}

/**
 * Deterministic ranking. Earlier entries win; within an entry the facts are
 * evaluated in the order written. The ordering follows the module's own
 * rules rather than a generic list: a locked gate or a confirmed screening
 * match stops everything, an undecided escalation outranks routine work,
 * and "awaiting the client" sits below anything we can act on ourselves.
 */
function nextActionCandidates(facts: AmlWorkspaceFacts): Candidate[] {
  const out: Candidate[] = [];
  const stage = caseStage(facts.caseRow);
  const gate = serviceGateStatus(facts.caseRow);
  const portal = clientPortalStatus(facts.caseRow);
  const risk = facts.caseRow.risk_rating ?? null;
  const openRequests = facts.openClientRequests ?? 0;

  /* ── 1. Blocked, locked, terminated, prohibited ──────────────────── */
  if (stage === "blocked" || gate === "locked") {
    out.push({
      key: "blocked",
      label: "Resolve the block on this case",
      explanation:
        "The case is blocked and the service gate is locked. Nothing else progresses until a reviewer reopens it.",
      attention: "critical",
      section: "risk",
      blocking: true,
      facts: [`case_stage = ${stage}`, `service_gate_status = ${gate}`],
    });
  }
  if (risk === "prohibited") {
    out.push({
      key: "prohibited_risk",
      label: "Record a decision on a prohibited-risk case",
      explanation:
        "The case carries a prohibited risk rating. A decision-maker has to record the outcome; the rating does not move the service gate by itself.",
      attention: "critical",
      section: "risk",
      blocking: true,
      facts: ["risk_rating = prohibited"],
    });
  }

  /* ── 2. Screening: confirmed matches, then unresolved candidates,
        then runs that never completed. ─────────────────────────────── */
  if (loaded(facts.screening)) {
    const subjects = facts.screening.subjects;
    const confirmed = subjects.filter((s) => s.state === "confirmed_match");
    const openMatches = subjects.filter(
      (s) => s.state === "possible_match" || (s.matches ?? []).some((m) => m.status === "open"),
    );
    const errored = subjects.filter((s) => s.state === "error");
    const unscreened = subjects.filter(
      (s) => s.required !== false && s.state === "not_started",
    );

    /*
     * ── The PEP determination ─────────────────────────────────────
     * There was no candidate for it at all, so this derivation could not
     * name the one thing genuinely holding Stage 5 — and the rail fell
     * through to a LATER stage's blocker ("Review the client submission ·
     * Go to stage 7") while Stage 5 said "PEP determination outstanding".
     * One case, two derivations, two answers.
     *
     * It reads the same facts the journey reads, so the two agree by
     * construction rather than by being kept in step. `section: "ownership"`
     * places it at journey position 5, ahead of anything later.
     *
     * Ranked BELOW a match: a candidate or a confirmed finding is a fact
     * about a customer and still leads.
     */
    if (facts.screening.pepRequired === true) {
      // `subjects` here is every ENROLLED party, unfiltered — which is the
      // right population: PEP is owed per party under its own scope, not per
      // party whose sanctions screening is owed.
      const undetermined = subjects.filter((s) => !s.pep_determination?.result);
      // Nobody enrolled cannot mean everybody determined.
      if (subjects.length === 0 || undetermined.length > 0) {
        out.push({
          key: "pep_determination",
          label: "Record PEP determination",
          explanation: subjects.length === 0
            ? "No party is enrolled yet, so no PEP determination can have been made."
            : `${undetermined.length} part${undetermined.length === 1 ? "y needs" : "ies need"} `
              + "a politically-exposed-person determination. A client declaration is "
              + "evidence that supports it; it is never the determination itself.",
          attention: "attention",
          section: "ownership",
          blocking: true,
          actionType: "record_pep",
          facts: ["case_screening_scopes.pep.required = true",
            `pep_determinations missing (${undetermined.length || "no parties"})`],
        });
      }
    }

    if (confirmed.length > 0) {
      out.push({
        key: "screening_confirmed",
        label: "Act on a confirmed screening match",
        explanation: `${confirmed.length} screening subject${confirmed.length === 1 ? " has" : "s have"} a confirmed match. This is a finding, not a candidate.`,
        attention: "critical",
        section: "ownership",
        blocking: true,
        actionType: "screening_adjudication",
        facts: [`party_screening_subjects.state = confirmed_match (${confirmed.length})`],
      });
    }
    if (openMatches.length > 0) {
      out.push({
        key: "screening_adjudicate",
        label: "Resolve a potential screening match",
        explanation: `${openMatches.length} subject${openMatches.length === 1 ? "" : "s"} ${openMatches.length === 1 ? "has" : "have"} candidate matches awaiting human adjudication.`,
        attention: "attention",
        section: "ownership",
        blocking: true,
        actionType: "screening_adjudication",
        facts: [`party screening candidates open (${openMatches.length})`],
      });
    }
    if (errored.length > 0) {
      out.push({
        key: "screening_error",
        label: "Re-run screening that did not complete",
        explanation: `${errored.length} screening run${errored.length === 1 ? "" : "s"} failed technically. A technical failure leaves the subject outstanding — it never reads as clear.`,
        attention: "attention",
        section: "ownership",
        blocking: true,
        facts: [`party_screening_subjects.state = error (${errored.length})`],
      });
    }
    const inFlight = subjects.filter(
      (s) => s.required !== false && (s.state === "queued" || s.state === "processing"),
    );
    if (inFlight.length > 0) {
      /*
       * "Running" is a claim about something happening, and the whole reading
       * is derived once in `screeningStatus.pure.ts` so the stage card, this
       * rail and the journey cannot disagree — which they did, giving an MLRO
       * three answers to one question and no way to choose between them.
       *
       * Past the stall window nothing has picked the request up, and saying
       * "running" there is how an operator waits for ever.
       */
      const reading = deriveScreeningStatus(subjects);
      const stuck = reading.status === "required";
      out.push({
        key: stuck ? "screening_stalled" : "screening_in_flight",
        label: stuck ? "Screening has not started" : reading.label,
        explanation: reading.detail,
        attention: stuck ? "attention" : "waiting",
        section: "ownership",
        blocking: true,
        facts: [`party_screening_subjects.state in (queued, processing) (${inFlight.length})`],
      });
    }
    if (unscreened.length > 0) {
      out.push({
        key: "screening_start",
        label: "Start screening for outstanding parties",
        explanation: `${unscreened.length} required subject${unscreened.length === 1 ? " has" : "s have"} not been screened yet.`,
        attention: "attention",
        section: "ownership",
        blocking: true,
        facts: [`party_screening_subjects.state = not_started (${unscreened.length})`],
      });
    }
  }

  /* ── 3. A decision is required of a person ───────────────────────── */
  if (stage === "decision_pending" || facts.caseRow.status === "escalated_mlro") {
    out.push({
      key: "mlro_decision",
      label: "MLRO decision required",
      explanation:
        "The case has been escalated and is waiting on an authorised decision-maker.",
      attention: "attention",
      section: "risk",
      blocking: true,
      actionType: "mlro_decision",
      facts: [`case_stage = ${stage}`, `status = ${facts.caseRow.status}`],
    });
  }

  /* ── 4. Identity evidence needing a human ────────────────────────── */
  if (loaded(facts.identity)) {
    const live = facts.identity.checks.filter((c) => !c.superseded_at);
    const technical = live.filter((c) =>
      RETRYABLE_PROCESSING.has(String(c.processing_status ?? "")),
    );
    const referred = live.filter((c) => c.status === "referred");

    if (referred.length > 0) {
      out.push({
        key: "identity_referred",
        label: "Review identity verification",
        explanation: `${referred.length} verification check${referred.length === 1 ? " has" : "s have"} been referred and need${referred.length === 1 ? "s" : ""} a human outcome.`,
        attention: "attention",
        section: "identity",
        blocking: true,
        actionType: "identity_review",
        facts: [`verification_checks.status = referred (${referred.length})`],
      });
    }
    if (technical.length > 0) {
      out.push({
        key: "identity_technical",
        label: "Retry identity verification processing",
        explanation: `${technical.length} check${technical.length === 1 ? "" : "s"} stopped on a technical failure. Retrying runs the provider again and consumes no attempt.`,
        attention: "attention",
        section: "identity",
        blocking: false,
        actionType: "retry_processing",
        facts: [`verification_checks.processing_status retryable (${technical.length})`],
      });
    }
  }

  /* ── 5. A submission is waiting for us ───────────────────────────── */
  if (stage === "client_submitted") {
    out.push({
      key: "submission_review",
      label: "Review the client submission",
      explanation: "The client has submitted their information and it is waiting for review.",
      attention: "attention",
      section: "submission-review",
      blocking: true,
      actionType: "review_submission",
      facts: ["case_stage = client_submitted"],
    });
  }

  /* ── 6. Evidence gaps we can close ourselves ─────────────────────── */
  if (loaded(facts.documents)) {
    const awaiting = facts.documents.requirements.filter(
      (r) => String(r.status ?? "pending") === "uploaded",
    );
    if (awaiting.length > 0) {
      out.push({
        key: "documents_review",
        label: "Review uploaded documents",
        explanation: `${awaiting.length} uploaded document${awaiting.length === 1 ? "" : "s"} ${awaiting.length === 1 ? "is" : "are"} waiting to be accepted or rejected.`,
        attention: "attention",
        section: "documents",
        blocking: false,
        actionType: "review_document",
        facts: [`document_requirements.status = uploaded (${awaiting.length})`],
      });
    }
  }
  if (loaded(facts.monitoring) && (facts.monitoring.open_edd ?? []).length > 0) {
    out.push({
      key: "edd_open",
      label: "Complete enhanced due diligence",
      explanation: `${(facts.monitoring.open_edd ?? []).length} enhanced due diligence case${(facts.monitoring.open_edd ?? []).length === 1 ? " is" : "s are"} open.`,
      attention: "attention",
      section: "risk",
      blocking: true,
      facts: ["open enhanced due diligence"],
    });
  }
  if (gate === "conditions_outstanding") {
    out.push({
      key: "conditions",
      label: "Resolve the outstanding conditions",
      explanation:
        "The gate decision is recorded but its conditions are not met, so the service still may not proceed.",
      attention: "attention",
      section: "risk",
      blocking: true,
      facts: ["service_gate_status = conditions_outstanding"],
    });
  }
  /*
   * ── Stage 6, which used to be silent ──────────────────────────────
   *
   * There was one funding candidate and it was gated on
   * `sources.length > 0 && unverified.length > 0` — it spoke only once
   * somebody had ALREADY started. A case with nothing recorded, which is
   * every case at the moment Stage 5 finishes, produced no candidate at all.
   *
   * This ranking orders by journey position, so with Stage 6 saying nothing
   * the winner became Stage 7 and the operator was sent from Screening
   * straight to Submission review — under a line reading "Stages 2–6 have
   * nothing outstanding on this reading", while Stage 6's own journey
   * reading carried an unmet blocker. Two derivations of the same case,
   * disagreeing, one of them on screen.
   *
   * Whether it is owed is decided in `fundingObligation.pure.ts` and never
   * inferred from whether anybody has got round to it.
   */
  if (loaded(facts.funding)) {
    const fundingObligation = deriveFundingObligation({
      perimeter: facts.perimeter ?? null,
      riskRating: facts.caseRow?.risk_rating ?? null,
      enhancedDueDiligence: facts.caseRow?.status === "edd_required",
      pepFinding: loaded(facts.screening)
        && facts.screening.subjects.some((s) => s.pep_determination?.result === "pep"),
    });
    const unverified = facts.funding.sources.filter((s) => !s.verified);
    if (fundingObligation.reading === "required" && facts.funding.sources.length === 0) {
      out.push({
        key: "funding_start",
        label: "Record source of funds",
        explanation: `${fundingObligation.reason} Nothing has been recorded yet.`,
        attention: "attention",
        section: "finance",
        blocking: false,
        facts: ["source-of-funds items (0)", ...fundingObligation.sourceFacts],
      });
    } else if (facts.funding.sources.length > 0 && unverified.length > 0) {
      out.push({
        key: "funding_review",
        label: "Review source of funds",
        explanation: `${unverified.length} recorded source${unverified.length === 1 ? " has" : "s have"} not been verified.`,
        attention: "attention",
        section: "finance",
        blocking: false,
        facts: [`unverified source-of-funds items (${unverified.length})`],
      });
    }
  }

  /* ── 7. Waiting on someone else ──────────────────────────────────── */
  if (openRequests > 0) {
    out.push({
      key: "awaiting_client_request",
      label: "Awaiting client response",
      explanation: `${openRequests} request${openRequests === 1 ? "" : "s"} ${openRequests === 1 ? "is" : "are"} open with the client. Chase it if it has been outstanding.`,
      attention: "waiting",
      section: "requests",
      blocking: true,
      actionType: "client_request",
      facts: [`open client requests (${openRequests})`],
    });
  }
  if (stage === "additional_info_required" || stage === "enhanced_cdd") {
    out.push({
      key: "additional_info",
      label: "Request the outstanding information",
      explanation: "The case needs further information before it can move on.",
      attention: "attention",
      section: "requests",
      blocking: true,
      facts: [`case_stage = ${stage}`],
    });
  }
  if (stage === "awaiting_client" || stage === "client_in_progress" || stage === "activated") {
    out.push({
      key: "awaiting_client",
      label: "Awaiting client",
      explanation: `The client's onboarding is ${portal === "not_started" ? "not started" : "in progress"}. Check the requirement checklist and chase anything overdue.`,
      attention: "waiting",
      section: "documents",
      blocking: true,
      facts: [`case_stage = ${stage}`, `client_portal_status = ${portal}`],
    });
  }

  /* ── 8. Routine ongoing work ─────────────────────────────────────── */
  if (loaded(facts.monitoring)) {
    const overdue = facts.monitoring.overdue_review_count ?? 0;
    if (overdue > 0) {
      out.push({
        key: "reviews_overdue",
        label: "Complete an overdue review",
        explanation: `${overdue} scheduled review${overdue === 1 ? " is" : "s are"} past their deadline.`,
        attention: "attention",
        section: "monitoring",
        blocking: false,
        facts: [`overdue_review_count = ${overdue}`],
      });
    }
    if (facts.monitoring.rescreen_overdue) {
      out.push({
        key: "rescreen_due",
        label: "Refresh screening",
        explanation: "The scheduled screening refresh for this case is overdue.",
        attention: "attention",
        section: "monitoring",
        blocking: false,
        facts: ["rescreen_overdue = true"],
      });
    }
    if ((facts.monitoring.open_alerts ?? []).length > 0) {
      const n = (facts.monitoring.open_alerts ?? []).length;
      out.push({
        key: "alerts_open",
        label: "Work the open monitoring alerts",
        explanation: `${n} monitoring alert${n === 1 ? " is" : "s are"} open on this case.`,
        attention: "attention",
        section: "monitoring",
        blocking: false,
        facts: [`open monitoring alerts (${n})`],
      });
    }
  }
  if (stage === "staff_review") {
    out.push({
      key: "complete_assessment",
      label: "Complete the risk assessment",
      explanation: "The case is in staff review and is ready for the risk assessment to be finished.",
      attention: "attention",
      section: "risk",
      blocking: false,
      facts: ["case_stage = staff_review"],
    });
  }
  if (stage === "checks_in_progress") {
    out.push({
      key: "checks_in_progress",
      label: "Continue the outstanding checks",
      explanation: "Verification and screening checks are still running for this case.",
      attention: "waiting",
      section: "identity",
      blocking: false,
      facts: ["case_stage = checks_in_progress"],
    });
  }
  if (stage === "draft") {
    out.push({
      key: "activate",
      label: "Activate this case",
      explanation: "The case is a draft. Activation records the trigger and invites the client.",
      attention: "attention",
      section: "overview",
      blocking: true,
      facts: ["case_stage = draft"],
    });
  }

  return out;
}

/**
 * Where each section sits in the ten-stage journey.
 *
 * ── The defect this fixes ─────────────────────────────────────────────
 * The winner used to be `candidates[0]` — the first rule that happened to
 * fire, in the order the rules were WRITTEN. "Review the client submission"
 * is authored above documents and funding, so a case at `client_submitted`
 * sent the MLRO straight to Stage 7 while Stages 3, 5 and 6 still had
 * outstanding work. From the Activation screen it read as one blocking
 * action with a button, and the button skipped five stages.
 *
 * Ordering by journey position instead means the operator is always sent to
 * the EARLIEST unaddressed stage, which is the order the journey is meant to
 * be walked in and the order an auditor reads it back in.
 *
 * This map is duplicated from `JOURNEY_STAGES` rather than imported, because
 * `journeyModel` imports this module and the cycle would be worse than the
 * duplication. A spec asserts the two agree, so a stage reorder cannot
 * silently desynchronise them — that exact drift has bitten here before.
 */
export const SECTION_JOURNEY_ORDER: Record<AmlWorkspaceSection, number> = {
  overview: 1,        // Activation
  requests: 2,        // Client intake
  identity: 3,        // Identity verification
  documents: 4,       // Documents & evidence
  ownership: 5,       // Screening & ownership
  finance: 6,         // Funding & transaction
  counterparty: 6,    // …same stage
  "submission-review": 7,
  risk: 8,            // Decision
  passport: 9,        // Gate & passport
  monitoring: 10,     // Distribution & monitoring
  timeline: 10,
};

/**
 * The few things that must be surfaced whatever stage they belong to.
 *
 * A confirmed sanctions match or a prohibited rating is not "Stage 8 work to
 * be reached in due course" — it stops the case now, and burying it behind an
 * outstanding document at Stage 4 would be a worse failure than the skipping
 * this ordering exists to fix. Everything NOT named here is ordered purely by
 * journey position.
 */
/**
 * Waits on the CLIENT, which never headline while we have work of our own.
 *
 * "Awaiting client response" sits at Stage 2, so pure journey order would
 * hand it to an operator who has a referred identity check at Stage 3 they
 * could actually do — hiding real work behind something nobody can act on.
 * These are still listed under Also outstanding.
 *
 * Our OWN pipeline running is deliberately not in this set. "Screening is
 * running" is the journey's current position, not an absence of work, and
 * demoting it is precisely how an MLRO came to be pointed at Stage 7 while
 * Stage 5 was still in flight.
 */
const CLIENT_WAIT_KEYS = new Set(["awaiting_client_request", "awaiting_client"]);

const PRE_EMPTING_KEYS = new Set([
  "blocked", "prohibited_risk", "screening_confirmed", "mlro_decision",
]);

/**
 * Rank candidates the way the journey is walked.
 *
 * Pre-empting findings first, then journey position, then the order the rules
 * were written as a stable tiebreak within a stage. Blocking work outranks
 * non-blocking work at the SAME stage, so an operator is never sent to a
 * stage's optional tidying while that stage still has something stopping it.
 */
function rankCandidates(candidates: Candidate[]): Candidate[] {
  return candidates
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      const pa = PRE_EMPTING_KEYS.has(a.c.key) ? 0 : 1;
      const pb = PRE_EMPTING_KEYS.has(b.c.key) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      const wa = CLIENT_WAIT_KEYS.has(a.c.key) ? 1 : 0;
      const wb = CLIENT_WAIT_KEYS.has(b.c.key) ? 1 : 0;
      if (wa !== wb) return wa - wb;
      const sa = SECTION_JOURNEY_ORDER[a.c.section] ?? 99;
      const sb = SECTION_JOURNEY_ORDER[b.c.section] ?? 99;
      if (sa !== sb) return sa - sb;
      if (a.c.blocking !== b.c.blocking) return a.c.blocking ? -1 : 1;
      return a.i - b.i;
    })
    .map((x) => x.c);
}

const NO_ACTION: Omit<
  AmlNextAction, "sourceFacts" | "unavailableFacts" | "partial" | "stageOrder" | "stageSection"
> = {
  key: "none",
  label: "No action required",
  explanation: "Nothing on this case is waiting on you right now.",
  attention: "none",
  section: "overview",
  blocking: false,
};

const REVIEW_CASE: Omit<
  AmlNextAction, "sourceFacts" | "unavailableFacts" | "partial" | "stageOrder" | "stageSection"
> = {
  key: "review_case",
  label: "Review the case",
  explanation:
    "No action could be determined from the state that loaded. Work through the sections directly.",
  attention: "waiting",
  section: "overview",
  blocking: false,
};

function missingFactLabels(facts: AmlWorkspaceFacts): string[] {
  const missing: string[] = [];
  if (!loaded(facts.identity)) missing.push("verification checks");
  if (!loaded(facts.screening)) missing.push("party screening");
  if (!loaded(facts.monitoring)) missing.push("monitoring summary");
  if (!loaded(facts.documents)) missing.push("document requirements");
  if (!loaded(facts.funding)) missing.push("source of funds");
  if (facts.openClientRequests === undefined) missing.push("client requests");
  return missing;
}

export function deriveAmlNextAction(facts: AmlWorkspaceFacts): AmlNextAction {
  const stage = caseStage(facts.caseRow);
  const gate = serviceGateStatus(facts.caseRow);
  const unavailableFacts = missingFactLabels(facts);

  /*
   * A finished case is finished. Say so plainly rather than ranking work
   * against a relationship that has ended.
   *
   * The LIFECYCLE decides it. A terminated gate is a statement about SERVING
   * the customer, not about whether the case is being worked — and reopening
   * deliberately leaves the gate terminated, so keying off it announced
   * "Case closed" on a case that had just been reopened and had real work
   * outstanding. `isFinished` in the journey model holds the same line.
   */
  if (stage === "closed") {
    return {
      ...NO_ACTION,
      label: "Case closed",
      explanation:
        "This case is closed. Its records stay available and remain subject to the "
        + "retention rules. It can be reopened and resumed — nothing already gathered "
        + "is lost, and reopening does not restore permission to serve.",
      // `closed: []` in the transition table makes this terminal by design, so
      // the one way back is its own authorised operation rather than a status
      // edit. Naming it here is what stops a closed case being a dead end.
      actionType: "reopen_case",
      section: "timeline",
      sourceFacts: [`case_stage = ${stage}`, `service_gate_status = ${gate}`],
      unavailableFacts: [],
      partial: false,
      stageOrder: SECTION_JOURNEY_ORDER.timeline,
      stageSection: "timeline",
    };
  }

  const candidates = rankCandidates(nextActionCandidates(facts));
  if (candidates.length === 0) {
    // Nothing fired. If the reading was complete, that genuinely means
    // nothing is outstanding; if facts are missing, say so instead of
    // reassuring the operator on evidence we do not have.
    const base = unavailableFacts.length > 0 ? REVIEW_CASE : NO_ACTION;
    return {
      ...base,
      sourceFacts: [`case_stage = ${stage}`, `service_gate_status = ${gate}`],
      unavailableFacts,
      partial: unavailableFacts.length > 0,
      stageOrder: SECTION_JOURNEY_ORDER[base.section] ?? 99,
      stageSection: base.section,
    };
  }

  const winner = candidates[0];
  return {
    key: winner.key,
    label: winner.label,
    explanation: winner.explanation,
    attention: winner.attention,
    section: winner.section,
    blocking: winner.blocking,
    actionType: winner.actionType,
    sourceFacts: winner.facts,
    unavailableFacts,
    partial: unavailableFacts.length > 0,
    stageOrder: SECTION_JOURNEY_ORDER[winner.section] ?? 99,
    stageSection: winner.section,
  };
}

/* ══════════════════════════════════════════════════════════════════════
   8. Outstanding items — everything that fired, not just the winner
   ══════════════════════════════════════════════════════════════════════ */

export interface AmlOutstandingItem {
  key: string;
  label: string;
  detail: string;
  attention: AmlAttentionLevel;
  section: AmlWorkspaceSection;
  blocking: boolean;
}

/**
 * The same ranked candidates the next action came from, minus the one
 * already shown as the headline. Only actionable or blocking things appear
 * here — this is not a second copy of the compliance summary.
 */
export function deriveAmlOutstandingItems(
  facts: AmlWorkspaceFacts,
  options: { exclude?: string } = {},
): AmlOutstandingItem[] {
  return nextActionCandidates(facts)
    .filter((c) => c.key !== options.exclude)
    .map((c) => ({
      key: c.key,
      label: c.label,
      detail: c.explanation,
      attention: c.attention,
      section: c.section,
      blocking: c.blocking,
    }));
}

/* ══════════════════════════════════════════════════════════════════════
   9. Register attention — the case-row-only reading
   ══════════════════════════════════════════════════════════════════════

   The register lists up to a hundred cases. Loading evidence for each one
   would be a hundred round trips, so this reading uses the case row alone
   — the same canonical dimensions, no extra reads — and says so. It is the
   same ranking policy, restricted to the facts a row carries.              */

export interface AmlCaseAttention {
  level: AmlAttentionLevel;
  /** Short enough for a table cell. */
  label: string;
  /** Longer form for a title attribute / screen readers. */
  detail: string;
  needsAttention: boolean;
}

export function deriveAmlCaseAttention(caseRow: AmlWorkspaceCaseFacts): AmlCaseAttention {
  const stage = caseStage(caseRow);
  const gate = serviceGateStatus(caseRow);
  const risk = caseRow.risk_rating ?? null;

  const at = (
    level: AmlAttentionLevel,
    label: string,
    detail: string,
  ): AmlCaseAttention => ({
    level,
    label,
    detail,
    needsAttention: level === "critical" || level === "attention",
  });

  if (stage === "blocked" || gate === "locked") {
    return at("critical", "Blocked", "The case is blocked and the service gate is locked.");
  }
  if (risk === "prohibited") {
    return at("critical", "Prohibited risk", "Rated prohibited — a decision must be recorded.");
  }
  if (stage === "decision_pending") {
    return at("attention", "Decision required", "Escalated and awaiting an authorised decision.");
  }
  if (stage === "client_submitted") {
    return at("attention", "Submission to review", "The client has submitted and it is waiting for review.");
  }
  if (gate === "conditions_outstanding") {
    return at("attention", "Conditions outstanding", "The decision is recorded but its conditions are unmet.");
  }
  if (stage === "enhanced_cdd" || stage === "additional_info_required") {
    return at("attention", "Information outstanding", "Further information is needed before the case moves on.");
  }
  if (stage === "staff_review") {
    return at("attention", "In staff review", "Assessment work is with us.");
  }
  if (stage === "awaiting_client" || stage === "client_in_progress") {
    return at("waiting", "Awaiting client", "The client's onboarding is still in progress.");
  }
  if (stage === "checks_in_progress") {
    return at("waiting", "Checks running", "Verification and screening are still in progress.");
  }
  if (stage === "draft" || stage === "activated") {
    return at("waiting", "Not yet started", "The case has not begun collecting information.");
  }
  if (stage === "closed") {
    return at("none", "Closed", "The case is closed.");
  }
  if (stage === "cleared" || stage === "cleared_with_conditions") {
    return at("steady", "Cleared", "Cleared — under ongoing monitoring.");
  }
  return at("steady", CASE_STAGE_LABELS[stage], `Stage: ${CASE_STAGE_LABELS[stage]}.`);
}

/** Compact, register-safe readiness label from the case row alone. */
export function serviceReadinessLabel(caseRow: AmlWorkspaceCaseFacts): {
  label: string;
  level: AmlReadinessLevel;
} {
  const gate = serviceGateStatus(caseRow);
  const level = READINESS_BY_GATE[gate];
  const label =
    level === "ready"
      ? "Ready"
      : level === "ready_with_controls"
        ? "Ready (controls)"
        : level === "conditions_outstanding"
          ? "Conditions"
          : level === "under_review"
            ? "Under review"
            : level === "blocked"
              ? "Blocked"
              : level === "ended"
                ? "Ended"
                : "Not ready";
  return { label, level };
}

/** The gate's own words, for anywhere the compact label is not enough. */
export function serviceGateLabel(caseRow: AmlWorkspaceCaseFacts): string {
  return SERVICE_GATE_LABELS[serviceGateStatus(caseRow)];
}

/* ══════════════════════════════════════════════════════════════════════
   10. Connected portals — a compact reading of the sharing position
   ══════════════════════════════════════════════════════════════════════

   The reliance / compliance-passport architecture is unchanged; this only
   describes it. In particular a partner's own assessment stays the
   partner's: `IndependentAssessment.status === "satisfied"` means that
   partner recorded itself satisfied with the records we shared. It is not
   a claim about that partner's — or this case's — own compliance position,
   and nothing here makes one.                                               */

export const CONNECTED_PORTAL_KEYS = [
  "client",
  "finance",
  "builder",
  "developer",
  "solicitor_conveyancer",
] as const;
export type AmlConnectedPortalKey = (typeof CONNECTED_PORTAL_KEYS)[number];

export const CONNECTED_PORTAL_LABELS: Record<AmlConnectedPortalKey, string> = {
  client: "Client",
  finance: "Finance",
  builder: "Builder",
  developer: "Developer",
  solicitor_conveyancer: "Solicitor / conveyancer",
};

export interface AmlConnectedPortal {
  key: AmlConnectedPortalKey;
  label: string;
  status: string;
  tone: "connected" | "in_progress" | "idle" | "unknown";
}

export interface AmlConnectedPortalFacts {
  /** Live (unrevoked) passport grants. `null` when the read was unavailable. */
  grants?: Array<{
    revoked_at?: string | null;
    agreement_id?: string;
    reliance_agreements?: { partner_org_type?: string; partner_org_name?: string } | null;
  }> | null;
  assessments?: Array<{
    status: string;
    agreement_id?: string;
  }> | null;
}

const CLIENT_PORTAL_SHARING_LABEL: Record<string, string> = {
  not_started: "Not started",
  action_required: "Action required",
  in_progress: "In progress",
  submitted: "Submitted",
  under_review: "Under review",
  additional_info_required: "Information requested",
  complete: "Complete",
  contact_adviser: "Asked to contact adviser",
};

const FINANCE_PORTAL_SHARING_LABEL: Record<string, string> = {
  not_requested: "Not connected",
  information_required: "Information required",
  submitted: "Submitted",
  clarification_required: "Clarification required",
  under_review: "Under review",
  accepted: "Accepted",
  no_further_action: "No further action",
};

export function deriveAmlConnectedPortals(
  caseRow: AmlWorkspaceCaseFacts,
  facts: AmlConnectedPortalFacts = {},
): AmlConnectedPortal[] {
  const portal = clientPortalStatus(caseRow);
  const finance = String(caseRow.finance_portal_status ?? "not_requested");
  const grantsLoaded = loaded(facts.grants);
  const live = (facts.grants ?? []).filter((g) => !g.revoked_at);

  const grantsFor = (type: string) =>
    live.filter((g) => g.reliance_agreements?.partner_org_type === type);

  const assessmentFor = (type: string): string | null => {
    if (!loaded(facts.assessments)) return null;
    const agreementIds = new Set(grantsFor(type).map((g) => g.agreement_id));
    const match = facts.assessments.find((a) => a.agreement_id && agreementIds.has(a.agreement_id));
    return match?.status ?? null;
  };

  const partnerRow = (key: AmlConnectedPortalKey): AmlConnectedPortal => {
    const label = CONNECTED_PORTAL_LABELS[key];
    if (!grantsLoaded) return { key, label, status: "Not available", tone: "unknown" };
    const shared = grantsFor(key);
    if (shared.length === 0) return { key, label, status: "Not connected", tone: "idle" };
    switch (assessmentFor(key)) {
      case "satisfied":
        // The partner's own assessment, described as exactly that.
        return { key, label, status: "Partner assessment satisfied", tone: "connected" };
      case "not_satisfied":
        return { key, label, status: "Partner assessment not satisfied", tone: "in_progress" };
      case "records_requested":
        return { key, label, status: "Partner requested records", tone: "in_progress" };
      case "open":
        return { key, label, status: "Under partner review", tone: "in_progress" };
      default:
        return { key, label, status: "Compliance passport shared", tone: "in_progress" };
    }
  };

  return [
    {
      key: "client",
      label: CONNECTED_PORTAL_LABELS.client,
      status: CLIENT_PORTAL_SHARING_LABEL[portal] ?? portal,
      tone: portal === "complete" ? "connected" : portal === "not_started" ? "idle" : "in_progress",
    },
    {
      key: "finance",
      label: CONNECTED_PORTAL_LABELS.finance,
      status:
        grantsLoaded && grantsFor("finance").length > 0
          ? "Compliance passport shared"
          : (FINANCE_PORTAL_SHARING_LABEL[finance] ?? finance.replace(/_/g, " ")),
      tone:
        grantsLoaded && grantsFor("finance").length > 0
          ? "in_progress"
          : finance === "accepted"
            ? "connected"
            : finance === "not_requested"
              ? "idle"
              : "in_progress",
    },
    partnerRow("builder"),
    partnerRow("developer"),
    partnerRow("solicitor_conveyancer"),
  ];
}

/* ══════════════════════════════════════════════════════════════════════
   11. One call for the whole workspace summary
   ══════════════════════════════════════════════════════════════════════ */

export interface AmlWorkspaceSummary {
  macro: AmlMacroProgress;
  nextAction: AmlNextAction;
  readiness: AmlServiceReadiness;
  compliance: AmlComplianceSummary;
  outstanding: AmlOutstandingItem[];
  /** Loudest thing on the case, for the header and the register. */
  attention: AmlAttentionLevel;
}

export function deriveAmlWorkspaceSummary(facts: AmlWorkspaceFacts): AmlWorkspaceSummary {
  const macro = deriveAmlMacroPhase(facts);
  const nextAction = deriveAmlNextAction(facts);
  const readiness = deriveAmlServiceReadiness(facts);
  const compliance = deriveAmlComplianceSummary(facts);
  const outstanding = deriveAmlOutstandingItems(facts, { exclude: nextAction.key });

  return {
    macro,
    nextAction,
    readiness,
    compliance,
    outstanding,
    attention: highestAttention([
      nextAction.attention,
      readiness.attention,
      ...outstanding.map((o) => o.attention),
    ]),
  };
}
