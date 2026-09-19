/**
 * Party screening projection and PEP control rules — pure functions, no I/O.
 *
 * `aml.party_screening_subjects.state` is a PROJECTION of canonical screening
 * evidence (`aml.screening_checks` + `aml.screening_matches`), never a first
 * truth of its own. These functions are the single place that projection and
 * the gate's notion of "outstanding" are defined, so aml-cases, aml-risk,
 * aml-monitoring and the outbox worker cannot drift apart. Imported by the
 * edge functions AND unit-tested directly from vitest.
 */

/** Canonical match statuses (aml.screening_matches.status). */
export type ScreeningMatchStatus = "open" | "confirmed" | "dismissed" | "escalated";

/** party_screening_subjects.state values (see 20260901000000 CHECK). */
export type PartyScreeningState =
  | "not_required" | "not_started" | "queued" | "processing" | "completed"
  | "possible_match" | "confirmed_match" | "false_positive" | "error";

/**
 * Derive the party screening state from the canonical matches of its
 * screening check. Precedence: a confirmed finding outranks anything still
 * open; anything open or escalated outranks a set of dismissals.
 */
export function projectPartyScreeningState(
  matchStatuses: ScreeningMatchStatus[],
): "completed" | "possible_match" | "confirmed_match" | "false_positive" {
  if (matchStatuses.length === 0) return "completed";
  if (matchStatuses.some((s) => s === "confirmed")) return "confirmed_match";
  if (matchStatuses.some((s) => s === "open" || s === "escalated")) return "possible_match";
  return "false_positive";
}

/**
 * States in which required screening work has NOT produced a usable outcome.
 * A technical error stays outstanding — it must never read as clear.
 */
export const SCREENING_INCOMPLETE_STATES: PartyScreeningState[] = [
  "not_started", "queued", "processing", "error",
];

/** Terminal states that satisfy a required screening (subject cleared). */
export const SCREENING_SATISFIED_STATES: PartyScreeningState[] = [
  "completed", "false_positive",
];

export type ScreeningOutstandingReason =
  | "incomplete"        // not_started / queued / processing / error
  | "unresolved"        // candidate matches await human adjudication
  | "confirmed_match"   // adjudicated finding — handled by the mandatory-hold path
  | "stale"             // satisfied once, but past its refresh due date
  | null;               // nothing outstanding

/**
 * Why (if at all) a party screening subject still stands between the case and
 * clearance. `confirmed_match` is reported distinctly: it is not "missing
 * work", it is a finding the risk system consumes as a mandatory hold.
 */
export function partyScreeningOutstanding(
  subject: {
    required: boolean;
    state: string;
    refresh_due_at?: string | null;
  },
  nowIso: string,
): ScreeningOutstandingReason {
  if (!subject.required || subject.state === "not_required") return null;
  if (SCREENING_INCOMPLETE_STATES.includes(subject.state as PartyScreeningState)) {
    return "incomplete";
  }
  if (subject.state === "possible_match") return "unresolved";
  if (subject.state === "confirmed_match") return "confirmed_match";
  if (
    SCREENING_SATISFIED_STATES.includes(subject.state as PartyScreeningState) &&
    subject.refresh_due_at && subject.refresh_due_at < nowIso
  ) {
    return "stale";
  }
  return null;
}

/**
 * The states get_submission_review counts as missing_mandatory. Everything
 * non-terminal is outstanding; stale satisfied screenings are outstanding too.
 */
export function isPartyScreeningMissing(
  subject: { required: boolean; state: string; refresh_due_at?: string | null },
  nowIso: string,
): boolean {
  const reason = partyScreeningOutstanding(subject, nowIso);
  return reason === "incomplete" || reason === "unresolved" || reason === "stale";
}

/** Refresh due date from the last screening and the rescreen interval. */
export function computeRefreshDueAt(lastScreenedAtIso: string, intervalDays: number): string {
  const base = new Date(lastScreenedAtIso).getTime();
  const days = Number.isFinite(intervalDays) && intervalDays > 0 ? intervalDays : 365;
  return new Date(base + days * 24 * 3600 * 1000).toISOString();
}

/* ───────────────────────────── PEP controls ─────────────────────────────── */

export type PepType = "foreign" | "domestic" | "international_organisation";
export type PepRelationship = "self" | "family_member" | "close_associate";

export interface PepDeterminationLike {
  result: "not_pep" | "pep";
  pep_type?: PepType | string | null;
  pep_relationship?: PepRelationship | string | null;
  superseded_at?: string | null;
  review_due_at?: string | null;
}

/**
 * Which extra PEP controls apply, per current AUSTRAC guidance (verified
 * 2026-08 against austrac.gov.au CDD / PEP / senior-manager pages):
 *
 *   - A FOREIGN PEP always requires enhanced CDD — including establishing
 *     source of funds and source of wealth — and senior manager approval to
 *     provide (or continue providing) the designated service.
 *   - A DOMESTIC or INTERNATIONAL ORGANISATION PEP requires the same measures
 *     only where the customer's ML/TF risk is high.
 *   - Being a PEP is NEVER an automatic reason to refuse or exit — the
 *     controls are approvals and diligence, not rejection.
 *
 * Family members and close associates of a PEP carry the PEP's category, so
 * the relationship does not change which controls apply — the type does.
 */
export function pepControlsRequired(
  determination: PepDeterminationLike | null | undefined,
  caseRiskRating: string | null | undefined,
): { eddRequired: boolean; seniorManagerApprovalRequired: boolean } {
  if (!determination || determination.result !== "pep" || determination.superseded_at) {
    return { eddRequired: false, seniorManagerApprovalRequired: false };
  }
  const highRisk = caseRiskRating === "high" || caseRiskRating === "prohibited";
  const applies = determination.pep_type === "foreign" ||
    ((determination.pep_type === "domestic" ||
      determination.pep_type === "international_organisation") && highRisk);
  return { eddRequired: applies, seniorManagerApprovalRequired: applies };
}

/** A determination is current when not superseded and not past review. */
export function pepDeterminationCurrent(
  determination: PepDeterminationLike | null | undefined,
  nowIso: string,
): boolean {
  if (!determination || determination.superseded_at) return false;
  if (determination.review_due_at && determination.review_due_at < nowIso) return false;
  return true;
}

/**
 * Party roles for which a PEP determination is required. This mirrors the
 * program's own identification list (VERIFICATION_REQUIRED_ROLES in
 * submissionReview.ts): the customer, co-purchasers, and the individuals who
 * own or act for an entity customer — the same individuals AUSTRAC's initial
 * CDD guidance says must be assessed for PEP status. The case subject is
 * always assessed; this list covers reconciled related parties.
 */
export const PEP_DETERMINATION_REQUIRED_ROLES = [
  "co_purchaser", "director", "trustee", "beneficial_owner", "authorised_representative",
] as const;

export function pepDeterminationRequiredForRole(partyType: string): boolean {
  return (PEP_DETERMINATION_REQUIRED_ROLES as readonly string[]).includes(partyType);
}

/**
 * Whether the PEP controls are satisfied by evidence LINKED to the current
 * determination, as one chain:
 *
 *   current PEP determination
 *     → a qualifying EDD case COMPLETED AFTER that determination
 *       → verified source of funds BELONGING to that EDD case
 *       → verified source of wealth BELONGING to that EDD case
 *
 * An EDD case completed before the PEP was known never considered it. A
 * verified SoF/SoW row from an older or unrelated EDD — or attached to no
 * EDD at all — establishes nothing about this finding, so only rows whose
 * `edd_case_id` is the qualifying EDD count. A superseding determination
 * moves `latestPepDeterminedAt` forward, which structurally invalidates the
 * previous finding's EDD and approval evidence. Missing evidence fails
 * closed: the controls stay outstanding; nothing here is a customer finding.
 */
export function pepEvidenceSatisfied(args: {
  /** determined_at of the latest current (non-superseded) pep finding. */
  latestPepDeterminedAt: string;
  /** Completed + MLRO-approved EDD cases on the AML case. */
  completedEddCases: Array<{ id: string; completed_at?: string | null }>;
  /** `edd_case_id` of every VERIFIED source_of_funds row on the case. */
  verifiedSofEddCaseIds: Array<string | null | undefined>;
  /** `edd_case_id` of every VERIFIED source_of_wealth row on the case. */
  verifiedSowEddCaseIds: Array<string | null | undefined>;
  /** resolved_at of the newest approved pep_service_approval, if any. */
  approvalResolvedAt?: string | null;
}): { eddComplete: boolean; approvalGranted: boolean; qualifyingEddCaseId: string | null } {
  const sofEdds = new Set(args.verifiedSofEddCaseIds.filter(Boolean).map(String));
  const sowEdds = new Set(args.verifiedSowEddCaseIds.filter(Boolean).map(String));
  const qualifying = args.completedEddCases.find((edd) =>
    Boolean(edd.completed_at && edd.completed_at >= args.latestPepDeterminedAt) &&
    sofEdds.has(String(edd.id)) && sowEdds.has(String(edd.id)));
  const approvalGranted = Boolean(
    args.approvalResolvedAt && args.approvalResolvedAt >= args.latestPepDeterminedAt,
  );
  return {
    eddComplete: Boolean(qualifying),
    approvalGranted,
    qualifyingEddCaseId: qualifying ? String(qualifying.id) : null,
  };
}

/* ─────────────────────────── worker claim rules ─────────────────────────── */

export type ScreeningClaimDecision =
  /** Claim and run the screening. */
  | "claim"
  /** Terminal or reset state — a duplicate/stale event; succeed silently. */
  | "obsolete"
  /**
   * Another worker appears to hold it. The event must be RETRIED, not
   * succeeded: succeeding would mark the event processed, and if the holder
   * died the subject would stay 'processing' forever with nothing left to
   * wake it. Retrying lets a later delivery either see the terminal state
   * (holder finished) or reclaim after the staleness window (holder died).
   */
  | "in_flight_retry";

export function screeningClaimDecision(
  subject: { state: string; updated_at?: string | null },
  nowMs: number,
  staleMinutes: number,
): ScreeningClaimDecision {
  if (subject.state === "queued" || subject.state === "error") return "claim";
  if (subject.state === "processing") {
    const updated = subject.updated_at ? new Date(subject.updated_at).getTime() : 0;
    return nowMs - updated >= staleMinutes * 60_000 ? "claim" : "in_flight_retry";
  }
  return "obsolete";
}

/**
 * Did an inline screening attempt actually go anywhere?
 *
 * ── Why this is a decision and not an assumption ──────────────────────
 * Inline execution used to `catch` and move on, trusting that the consumer
 * had recorded a category. Measured in production on 2026-08-18, that trust
 * was misplaced: a subject queued at 08:05:58 was still `queued` 27 minutes
 * later with `error_category` null, no screening check and no case event.
 * Something had tried and failed, and the failure was discarded.
 *
 * So the attempt is now judged by the SUBJECT'S OWN STATE afterwards rather
 * than by whether a promise rejected:
 *
 *   settled     it moved, or it carries a check or a category — the attempt
 *               reached a conclusion and nothing further is owed.
 *   in_flight   a concurrent holder claimed it. Leaving it alone is correct;
 *               the holder converges it and this delivery retries.
 *   strand      it is still resting on queued/processing with nothing to
 *               show. This is the silent state, and the caller must name it.
 */
export type InlineConvergence = "settled" | "in_flight" | "strand";

export function inlineConvergenceDecision(
  after: {
    state?: string | null;
    error_category?: string | null;
    screening_check_id?: string | null;
  } | null | undefined,
  failureMessage?: string | null,
): InlineConvergence {
  // Nothing readable afterwards is not evidence that it settled.
  if (!after) return "strand";
  const state = String(after.state ?? "");
  const resting = state === "queued" || state === "processing";
  if (!resting) return "settled";
  if (after.error_category || after.screening_check_id) return "settled";
  // The one legitimate reason to leave a resting subject alone.
  if (failureMessage && /screening_in_flight/.test(failureMessage)) return "in_flight";
  return "strand";
}

/**
 * What to do with the screening check a claimed subject already points to.
 *
 *   - "resume_completed": the check holds a valid TERMINAL provider result
 *     but the subject's projection never landed (the worker died between
 *     persisting the result and finishing downstream work). The provider
 *     must NOT run again and no second check may be created — the retry
 *     finishes the interrupted persistence from the durable result.
 *   - "rerun_provider": an unfinished attempt (in_progress / pending /
 *     failed) — reuse the same check row and execute the provider.
 *   - "new_check": no reusable attempt — either no check, a non-result
 *     status, or a PREVIOUS round whose projection already completed (a
 *     re-queued subject wants a fresh screening, not a replay of the old
 *     result).
 *
 * The previous-round discriminator: completion writes the same timestamp to
 * check.completed_at and subject.last_screened_at, so last_screened_at >=
 * completed_at means that round finished; anything less (or null) means the
 * terminal result was never projected.
 */
export type CheckReuseDecision = "resume_completed" | "rerun_provider" | "new_check";

const TERMINAL_CHECK_STATUSES = ["clear", "review", "matched"];
const UNFINISHED_CHECK_STATUSES = ["in_progress", "pending", "failed"];

export function checkReuseDecision(
  check: { status?: string | null; completed_at?: string | null } | null | undefined,
  subject: { last_screened_at?: string | null },
): CheckReuseDecision {
  if (!check || !check.status) return "new_check";
  if (UNFINISHED_CHECK_STATUSES.includes(String(check.status))) return "rerun_provider";
  if (TERMINAL_CHECK_STATUSES.includes(String(check.status))) {
    const projected = Boolean(
      subject.last_screened_at && check.completed_at &&
      subject.last_screened_at >= check.completed_at,
    );
    return projected ? "new_check" : "resume_completed";
  }
  return "new_check";
}

/**
 * Whether a terminal check's durable state is sufficient to finish the
 * interrupted persistence without the provider. Matches are persisted BEFORE
 * the terminal status, so a terminal check normally has every candidate row;
 * fewer rows than the recorded match_count means the durable state predates
 * that ordering (or was damaged) and the attempt must re-run instead —
 * reusing the same check row, never creating a second one.
 */
export function resumableFromDurableState(
  summaryMatchCount: number,
  matchRowCount: number,
): boolean {
  return matchRowCount >= summaryMatchCount;
}

/**
 * Stable identity for a screening match within one check, so redelivered
 * events cannot double-insert candidates. The list's own external id wins;
 * a provider that supplies none falls back to what the reviewer sees.
 */
export function matchDedupKey(match: {
  details?: Record<string, unknown> | null;
  matchedName?: string; matched_name?: string;
  listName?: string | null; list_name?: string | null;
}): string {
  const externalId = String((match.details ?? {})["external_id"] ?? "");
  if (externalId) return `ext:${externalId}`;
  const name = match.matchedName ?? match.matched_name ?? "";
  const list = match.listName ?? match.list_name ?? "";
  return `name:${name}|${list}`;
}
