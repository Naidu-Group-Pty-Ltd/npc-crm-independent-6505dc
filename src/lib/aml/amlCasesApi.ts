import { invokeSecureFunction } from "@/lib/secureInvoke";

import { invokeAmlFunction } from "./invokeAmlFunction";
import type { PepDeclarationReading } from "./pepDeclaration";
import type { PepDeferralReason, PepSourceKind } from "./pepEvidence";
import type { PepIndexCoverage, PepIndexVerdict } from "./pepOfficeholderIndex";
import type { PepScreeningRun } from "./pepScreeningEngine";

/** What a reset returns, whether it ran or was refused. */
export interface AmlClientResetResult {
  mode?: "restart" | "purge";
  closed?: number;
  deleted?: number;
  /** Rows removed per table, on a completed purge. */
  removed?: Record<string, number>;
  /** Rows that would have been orphaned, on an aborted purge. */
  remaining?: Record<string, number>;
  summary?: string;
  error?: string;
  code?: string;
  /** Why a purge was refused — one line per record holding it. */
  blockers?: string[];
  /** What the operation will do, stated before it happens. */
  effects?: string[];
}

export type AmlCaseStatus =
  | "draft" | "kyc_in_progress" | "kyc_complete" | "edd_required"
  | "under_review" | "escalated_mlro" | "cleared" | "blocked" | "closed";

export type AmlRiskRating = "low" | "medium" | "high" | "prohibited";

export type AmlEventCategory =
  | "case_created" | "status_changed" | "risk_rescored" | "document_added"
  | "idv_result" | "pep_sanctions_hit" | "edd_note" | "mlro_decision"
  | "austrac_report" | "system"
  // A screening is not a determination: these three categories record that a
  // search was RUN, that a candidate was adjudicated, and that a
  // determination was deferred. None of them is an outcome.
  | "pep_screening_run" | "pep_screening_candidate_review"
  | "pep_determination_deferred";

export interface AmlCase {
  id: string;
  case_reference: string;
  client_id: string | null;
  purchase_file_id: string | null;
  subject_type: string;
  subject_display_name: string;
  status: AmlCaseStatus;
  risk_rating: AmlRiskRating | null;
  risk_score: number | null;
  assigned_analyst_id: string | null;
  assigned_mlro_id: string | null;
  opened_at: string;
  closed_at: string | null;
  metadata: Record<string, any>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Phase 1 canonical workflow dimensions (nullable until the
  // workflow-dimension migration has been applied and rows backfilled).
  // Derive effective values via src/lib/aml/caseDimensions.ts helpers.
  case_stage?: string | null;
  client_portal_status?: string | null;
  finance_portal_status?: string | null;
  service_gate_status?: string | null;
  service_gate_effective_at?: string | null;
  service_gate_policy_version?: string | null;
  activation_timing?: string | null;
  agreement_state?: string | null;
  activation_policy_version?: string | null;
  legacy_activation_model?: "A" | "B" | null;
  migration_classification?: string | null;
}

export interface AmlCaseEvent {
  id: string;
  case_id: string;
  category: AmlEventCategory;
  summary: string;
  payload: Record<string, any>;
  actor_id: string | null;
  actor_label: string | null;
  prev_hash: string | null;
  row_hash: string | null;
  created_at: string;
}

/**
 * Activation picker projection — identification only, never financial data.
 * Inactive clients are returned and selectable: the activation form is where
 * an authorised user confirms an existing client is active.
 */
export interface AmlActivationClient {
  id: string;
  label: string;
  email: string | null;
  mobile: string | null;
  is_active: boolean;
  has_open_case: boolean;
  /**
   * Present when an open case exists. `get_client_for_activation` carries the
   * id too; the picker's list carries the reference alone, which is all it
   * needs to say WHICH case already covers this client rather than only that
   * one does.
   */
  open_case?: { id?: string; case_reference: string } | null;
}

/** Which slice of the client register the picker is asking for. */
export type AmlClientPickerStatus = "all" | "active" | "inactive";

export interface AmlClientPickerPage {
  clients: AmlActivationClient[];
  /** How many clients matched in total — not how many were returned. */
  total: number;
  has_more: boolean;
  /** True when the server answered a browse rather than a search. */
  browsing: boolean;
}

async function invoke<T = any>(payload: Record<string, any>): Promise<T> {
  return invokeAmlFunction<T>("aml-cases", payload);
}

export const amlCasesApi = {
  list: (params: {
    status?: AmlCaseStatus; risk?: AmlRiskRating; assigned_to_me?: boolean;
    /**
     * `not_individual` asks the server "does this tenant hold any entity or
     * trust case", which is the question the navigation needs and the one a
     * client cannot answer without paging through every case.
     */
    subject_type?: "individual" | "entity" | "trust" | "not_individual";
    search?: string; limit?: number; offset?: number;
  } = {}) => invoke<{ cases: AmlCase[]; total: number }>({ op: "list", ...params }),

  get: (case_id: string) =>
    invoke<{ case: AmlCase; events: AmlCaseEvent[] }>({ op: "get", case_id }),

  /**
   * Authorised-exception case creation (directive §10.4). Not an ordinary
   * production pathway: MLRO only, and the server requires a recorded
   * exception category, authority and reason. Normal cases are opened via
   * activateClient from the client record.
   */
  create: (params: {
    subject_display_name: string; subject_type?: "individual" | "entity" | "trust";
    client_id?: string; purchase_file_id?: string; risk_rating?: AmlRiskRating; notes?: string;
    exception: {
      category: "data_migration" | "legacy_remediation" | "regulator_directed" | "approved_testing";
      reason: string;
      authority: string;
    };
  }) => invoke<{ case: AmlCase }>({ op: "create", ...params }),

  /**
   * Phase 3 — Hybrid Activation Engine.
   *
   * Opens a case for a **real active client** after a human-confirmed
   * activation event. Model B additionally requires tenant-level legal
   * approval + a program version (enforced server-side).
   */
  activateClient: (params: {
    client_id: string;
    subject_display_name: string;
    subject_type?: "individual" | "entity" | "trust";
    activation_model: "A" | "B";
    activation_event: string;
    reason: string;
    human_confirmed: true;
    purchase_file_id?: string;
  }) => invoke<{
    case: AmlCase;
    activation: Record<string, any>;
    /** Whether this activation flipped an inactive client to active (Part 5). */
    client_activation?: { was_inactive: boolean; marked_active: boolean };
    /** Whether the client can actually reach the screening link we just posted. */
    client_portal?: { has_portal_access: boolean; notified: boolean; note: string };
  }>({ op: "activate_client", ...params }),

  update: (case_id: string, patch: Partial<AmlCase>) =>
    invoke<{ case: AmlCase }>({ op: "update", case_id, patch }),

  transition: (case_id: string, to_status: AmlCaseStatus, reason?: string) =>
    invoke<{ case: AmlCase }>({ op: "transition", case_id, to_status, reason }),

  appendEvent: (case_id: string, category: AmlEventCategory, summary: string, payload: Record<string, any> = {}) =>
    invoke<{ event: AmlCaseEvent }>({ op: "append_event", case_id, category, summary, payload }),

  listEvents: (case_id: string, limit = 200) =>
    invoke<{ events: AmlCaseEvent[] }>({ op: "list_events", case_id, limit }),

  /** Phase 4 — persistent AML summary for the master client record. */
  /** Command-centre view of the client's AUSTRAC consent acceptances. */
  consentStatus: (case_id: string) =>
    invoke<{
      version: string | null;
      satisfied: boolean;
      outstanding: Array<{ code: string; title: string }>;
      documents: Array<{
        code: string; title: string; required: boolean;
        acknowledgement_type: "consent" | "notice";
        accepted_at: string | null; accepted_by: string | null;
        actor_type: string | null; document_hash: string | null;
      }>;
      history: Array<{ kind: string; version: string; accepted_at: string }>;
    }>({ op: "consent_status", case_id }),

  /**
   * Activation client picker — AML-role-gated (§13.4). Tokenised full-name
   * search over the canonical `clients` table; returns active AND inactive
   * clients (inactive ones are activated through the confirmation form).
   *
   * With an empty query this BROWSES the register rather than returning
   * nothing, which is what makes every client the platform already holds
   * available without anybody having to type a name they must already know.
   * Same op, same projection, same permission gate — only the filter differs,
   * so there is no second source of truth about which clients an AML operator
   * may see.
   */
  listClientsForActivation: (opts: {
    query?: string;
    status?: AmlClientPickerStatus;
    limit?: number;
    offset?: number;
  } = {}) =>
    invoke<AmlClientPickerPage>({
      op: "search_clients",
      query: opts.query ?? "",
      status: opts.status ?? "all",
      limit: opts.limit,
      offset: opts.offset,
    }),


  /**
   * Route-based activation handoff: load and validate the exact client by ID.
   * The browser is never trusted for the client's name or active status —
   * both come from the authoritative record via this call.
   */
  getClientForActivation: (client_id: string) =>
    invoke<{ client: AmlActivationClient }>({ op: "get_client_for_activation", client_id }),


  clientSummary: (client_id: string) =>
    invoke<{
      case: AmlCase | null;
      has_open_case: boolean;
      requirement_progress?: { completed: number; total: number };
      open_client_requests?: number;
    }>({ op: "client_summary", client_id }),

  // Staff-side wrappers for existing case-scoped server ops (requirements,
  // documents, submissions, client requests) used by the full-page workspace.
  listRequirements: (case_id: string) =>
    invoke<{ requirements: any[] }>({ op: "list_requirements", case_id }),
  seedDefaultRequirements: (case_id: string) =>
    invoke<{ requirements: any[] }>({ op: "seed_default_requirements", case_id }),
  /**
   * Rename a document for review.
   *
   * Presentation only: `filename` is preserved as the record of what
   * arrived, and no relationship moves — the document's case, requirement,
   * client and Passport bindings are untouched. An empty name clears the
   * override and the document shows its requirement again.
   */
  renameDocument: (document_id: string, display_name: string) =>
    invoke<{ document: any }>({ op: "rename_document", document_id, display_name }),

  listDocuments: (case_id: string) =>
    invoke<{ documents: any[] }>({ op: "list_documents", case_id }),
  getDocumentDownloadUrl: (document_id: string) =>
    invoke<{ url: string; filename: string }>({ op: "get_document_download_url", document_id }),
  reviewDocument: (document_id: string, decision: "accepted" | "rejected", reason?: string) =>
    invoke<{ document: any }>({ op: "review_document", document_id, decision, reason }),
  listSubmissions: (case_id: string) =>
    invoke<{ submissions: any[] }>({ op: "list_submissions", case_id }),
  reviewSubmission: (submission_id: string, decision: "accepted" | "rejected" | "changes_requested", notes?: string) =>
    invoke<{ submission: any }>({ op: "review_submission", submission_id, decision, notes }),
  listClientRequests: (case_id: string) =>
    invoke<{ requests: any[] }>({ op: "list_client_requests", case_id }),
  createClientRequest: (request: {
    case_id: string;
    kind: "additional_info" | "new_document" | "clarification" | "re_consent";
    subject: string;
    message: string;
    request_payload?: Record<string, any>;
    /** Canonical action vocabulary (`CLIENT_ACTION_CODES`). The portal only
     *  renders an action button for a code it recognises. */
    action_code?: string;
    /** Whitelisted routing only — `target_step` / `requirement_id` /
     *  `section_code`. Every field is re-validated server-side against the
     *  shared contract's closed vocabularies, so this type is a convenience
     *  and never the guarantee. The portal never accepts a URL. */
    action_target?: { target_step?: string; requirement_id?: string; section_code?: string };
  }) => invoke<{ request: any }>({ op: "create_client_request", request }),
  resolveClientRequest: (request_id: string) =>
    invoke<{ request: any }>({ op: "resolve_client_request", request_id }),

  /* ── Submission review (integration Stage 3/4) ── */
  getSubmissionReview: (case_id: string, version_number?: number) =>
    invoke<AmlSubmissionReview>({ op: "get_submission_review", case_id, version_number }),
  /** Store the submission record on the case: the entirety of the review as
   *  one inert HTML document in `aml-documents`, rendered by the same shared
   *  module the reading view and the browser download use. Each store is a
   *  point-in-time export — a new document, never an overwrite. */
  storeSubmissionRecord: (case_id: string, version_number?: number) =>
    invoke<{ document: any; content_hash: string }>({ op: "store_submission_record", case_id, version_number }),
  acceptSubmission: (submission_id: string, reason?: string) =>
    invoke<{ submission: any }>({ op: "accept_submission", submission_id, reason }),
  requestSubmissionChanges: (submission_id: string, reason: string, client_message?: string, subject?: string) =>
    invoke<{ submission: any; client_request: any }>({ op: "request_submission_changes", submission_id, reason, client_message, subject }),
  requestSubmissionDocument: (submission_id: string, reason: string, requirement_id?: string, client_message?: string) =>
    invoke<{ submission: any; client_request: any }>({ op: "request_submission_document", submission_id, reason, requirement_id, client_message }),
  requestSubmissionClarification: (submission_id: string, reason: string, client_message?: string) =>
    invoke<{ submission: any; client_request: any }>({ op: "request_submission_clarification", submission_id, reason, client_message }),
  escalateSubmission: (submission_id: string, reason: string) =>
    invoke<{ submission: any }>({ op: "escalate_submission", submission_id, reason }),
  supersedeSubmission: (submission_id: string, reason: string) =>
    invoke<{ submission: any }>({ op: "supersede_submission", submission_id, reason }),

  /* ── Document review with separated reasons (Stage 9/10) ── */
  reviewDocumentV2: (args: {
    document_id: string; decision: "accepted" | "rejected";
    internal_review_note?: string; client_safe_reason_code?: string; client_safe_message?: string;
  }) => invoke<{ document: any; client_request: any }>({ op: "review_document_v2", ...args }),

  /* ── Party reconciliation (Stage 13/14) ── */
  listPartyReconciliation: (case_id: string) =>
    invoke<{ items: AmlReconciliationItem[] }>({ op: "list_party_reconciliation", case_id }),
  resolvePartyReconciliation: (args: {
    item_id: string; resolution: "linked" | "created" | "manual_only" | "rejected" | "superseded" | "conflict";
    rationale: string; party_type?: string; party_id?: string;
  }) => invoke<{ item: AmlReconciliationItem }>({ op: "resolve_party_reconciliation", ...args }),

  /* ── Party verification links (Stage 15) ── */
  listPartyVerificationLinks: (case_id: string) =>
    invoke<{ links: AmlPartyVerificationLink[]; eligible_checks: any[] }>({ op: "list_party_verification_links", case_id }),
  linkPartyVerification: (args: { case_id: string; party_type: string; party_id?: string; verification_check_id: string; relationship?: string }) =>
    invoke<{ link: AmlPartyVerificationLink }>({ op: "link_party_verification", ...args }),
  unlinkPartyVerification: (link_id: string, reason: string) =>
    invoke<{ link: AmlPartyVerificationLink }>({ op: "unlink_party_verification", link_id, reason }),

  /* ── Party-scoped screening (Stage 16) ── */
  listPartyScreening: (case_id: string) =>
    invoke<{ subjects: AmlPartyScreeningSubject[]; case_pep_determination: AmlPepDetermination | null }>({ op: "list_party_screening", case_id }),
  /**
   * Queue AND run the check. The server executes it inline rather than
   * leaving a background worker on the critical path of a button press; the
   * outbox row stays as the durable fallback. `inline.error` is the provider's
   * own refusal, so the operator sees why in the same breath as the click.
   */
  queuePartyScreening: (subject_id: string, freshness_days?: number) =>
    invoke<{
      subject: AmlPartyScreeningSubject; skipped?: boolean; code?: string;
      inline?: { ran: boolean; error?: string };
    }>({ op: "queue_party_screening", subject_id, freshness_days }),
  // Adjudication resolves the CANONICAL screening match (same semantics as
  // aml-verification resolve_match); the party state is a projection of it.
  adjudicatePartyScreening: (subject_id: string, match_id: string, outcome: "confirmed_match" | "false_positive", note: string) =>
    invoke<{ subject: AmlPartyScreeningSubject; match: AmlScreeningCandidateMatch }>({ op: "adjudicate_party_screening", subject_id, match_id, outcome, note }),
  /**
   * One idempotent read that answers all of Stage 5: it enrols whoever is
   * missing, decides which scopes are proportionate, records that decision
   * with the client's answers attached, and returns the single next action.
   * It produces no screening outcome and advances no stage.
   */
  syncScreeningStage: (case_id: string) =>
    invoke<AmlScreeningStageSync>({ op: "sync_screening_stage", case_id }),
  /**
   * Record whether the case is inside the sanctions perimeter.
   *
   * Reviewer or MLRO only, server-enforced. The caller names a
   * classification and a reason code from a fixed list — there is no
   * `required` flag to send, because the server derives the scope and
   * ignores anything a caller claims about it.
   */
  classifyScreeningPerimeter: (args: {
    case_id: string;
    classification: "designated_service" | "outside_perimeter";
    reason_code?: string;
    scopes_excluded?: AmlScreeningScopeKey[];
    note?: string;
  }) => invoke<{ perimeter: Record<string, unknown> }>({
    op: "classify_screening_perimeter", ...args,
  }),
  /**
   * Run a screening the policy does not require.
   *
   * Uses the normal provider pipeline and persists a real check. It never
   * changes the obligation: `scope_required` comes back false whatever the
   * run produces. When the provider cannot run, this returns `ran: false`
   * with a reason and changes nothing — the stage is not blocked, because
   * the case never needed this screening.
   */
  runOptionalScreening: (subject_id: string) =>
    invoke<{
      ran?: boolean; converged?: boolean; scope_required: false;
      code?: string; message?: string; provider_ready?: boolean;
      subject?: AmlPartyScreeningSubject;
    }>({ op: "run_optional_screening", subject_id }),
  /**
   * Record a screening the MLRO performed by hand.
   *
   * This is a METHOD, never an exemption. The server sets who performed it,
   * when, and whether policy required it — none of which this call can
   * supply — and it never changes the case's obligation. A `no_match` is
   * refused unless it carries the sources checked, the names searched and a
   * rationale, by this contract, by the edge function and by the table.
   */
  recordManualScreening: (args: {
    subject_id: string;
    /**
     * PEP is absent by design: a manual PEP conclusion is a
     * `pep_determinations` record, and the server refuses it here.
     */
    scope?: Exclude<AmlScreeningScopeKey, "pep">;
    outcome: AmlManualOutcome;
    sources: AmlManualScreeningSource[];
    searched_names: string[];
    rationale: string;
    unable_reason?: AmlManualUnableReason | null;
    candidates?: Array<{
      matchedName: string; listName?: string | null; reference?: string | null;
      matchBasis?: string | null; jurisdiction?: string | null; notes?: string | null;
    }>;
  }) => invoke<{
    check: AmlManualScreeningCheck;
    outcome: AmlManualOutcome;
    policy_required: boolean;
    voluntary: boolean;
    satisfies_obligation: boolean;
  }>({ op: "record_manual_screening", ...args }),
  /** Release a screening request nothing ever picked up. Refuses live work. */
  retryStalledScreening: (subject_id: string) =>
    invoke<{ subject?: AmlPartyScreeningSubject; retired?: number; skipped?: boolean; code?: string }>(
      { op: "retry_stalled_screening", subject_id }),
  /**
   * Reopen a closed case and resume the journey.
   *
   * Restores the ability to WORK the case, never permission to SERVE — a
   * terminated gate stays terminated and a passport is never re-minted.
   */
  reopenCase: (case_id: string, reason: string) =>
    invoke<{
      reopened: boolean; resumed_status: string; reissued: string[];
      consents_to_reaccept: string[]; not_restored: string[];
      preserved: string[]; summary: string;
    }>({ op: "reopen_case", case_id, reason }),
  /**
   * Reset a client's AML/CTF journey.
   *
   * `restart` closes the open cases and revokes portal access, deleting
   * nothing. `purge` removes the client and the AML records that would
   * otherwise be orphaned — and is refused by the server whenever a case
   * carries evidence that must be retained.
   *
   * Called with a mismatched `confirmation` it returns the effects and the
   * blockers without doing anything, which is how the dialog shows the
   * operator what they are about to do before they can agree to it.
   */
  resetClientJourney: async (payload: {
    client_id: string;
    mode: "restart" | "purge";
    confirmation?: string | null;
  }): Promise<AmlClientResetResult> => {
    /*
     * Deliberately NOT routed through `invoke`. That helper throws whenever
     * the body carries `error`, which is the right default everywhere else
     * and exactly wrong here: a refusal IS the payload this screen needs. The
     * blockers naming which record is holding the client ride on the 409, and
     * collapsing them into a thrown string would leave the operator with
     * "this cannot be deleted" and no way to find out why — which is the
     * dead end they reported in the first place.
     */
    const { data, error } = await invokeSecureFunction<AmlClientResetResult>(
      "aml-cases", { op: "reset_client_journey", ...payload }, { timeoutMs: 60000 },
    );
    if (data) return data;
    return { error: error?.message ?? "The reset could not be completed." };
  },
  listPepDeterminations: (case_id: string) =>
    invoke<{ determinations: AmlPepDetermination[] }>({ op: "list_pep_determinations", case_id }),
  recordPepDetermination: (payload: {
    case_id: string; subject_name: string; result: "not_pep" | "pep";
    party_screening_subject_id?: string | null; party_type?: string; party_id?: string;
    pep_type?: "foreign" | "domestic" | "international_organisation";
    pep_relationship?: "self" | "family_member" | "close_associate";
    position_held?: string; jurisdiction?: string; holds_position_currently?: boolean;
    /*
     * Structured rows, not free text. The server already stored `methods` as
     * jsonb with a reference and a note per source; the old dialog collapsed
     * every source into one textarea and sent `{ source }` alone, throwing
     * away the two fields that make a check reconstructable later. `kind` and
     * `result` complete it: what sort of source, and what came back.
     */
    methods: Array<{
      kind?: PepSourceKind; source: string;
      reference?: string | null; result?: string | null; note?: string | null;
    }>;
    rationale: string; review_months?: number;
  }) =>
    invoke<{ determination: AmlPepDetermination }>({ op: "record_pep_determination", ...payload }),

  /**
   * Record that a determination cannot be reached yet.
   *
   * Deliberately NOT a third `result`: nothing is written to
   * `pep_determinations`, the scope stays outstanding and Stage 5 stays
   * blocked. What is recorded is what was checked, why it did not settle the
   * question, and what is needed.
   */
  /**
   * Search the public office-holder index for one party.
   *
   * Returns the verdict, the candidates and the index's own COVERAGE — the
   * three together, always. A caller that renders "0 candidates" without the
   * coverage beside it has turned a partial index into a clearance, which is
   * the one thing this index must never be able to say.
   */
  /**
   * Run the PEP screening for one party against the registers the platform
   * holds, and record what it searched.
   *
   * It screens; it never determines. The result is a `pep_screening_runs`
   * row, whose verdict vocabulary shares no value with a determination's.
   */
  runPepScreening: (payload: {
    case_id: string;
    party_screening_subject_id?: string | null;
  }) =>
    invoke<{
      run: PepScreeningRun & { id: string; created_at: string };
      evidence: { kind: string; source: string; reference: string; result: string } | null;
    }>({ op: "run_pep_screening", ...payload }),

  /**
   * Accept or reject one candidate a run surfaced.
   *
   * A rejection must say how it was told this is somebody else — "dismissed"
   * with no reason reads, later, exactly like nobody having looked.
   */
  reviewPepScreeningCandidate: (payload: {
    run_id: string;
    candidate_id: string;
    decision: "accepted" | "rejected";
    reason: string;
  }) =>
    invoke<{ review: Record<string, unknown> }>(
      { op: "review_pep_screening_candidate", ...payload }),

  listPepScreeningRuns: (case_id: string) =>
    invoke<{ runs: Array<Record<string, unknown>>; reviews: Array<Record<string, unknown>> }>(
      { op: "list_pep_screening_runs", case_id }),

  /**
   * What the office-holder index holds, WITHOUT searching it.
   *
   * The coverage used to be reachable only as a side-effect of a search, so
   * an operator could not tell whether the index was loaded until after they
   * had relied on it. This is the reading that belongs on the step itself.
   */
  pepOfficeholderIndexStatus: () =>
    invoke<{ coverage: PepIndexCoverage[]; usable: boolean }>(
      { op: "pep_officeholder_index_status" }),

  searchPepOfficeholders: (payload: {
    case_id: string;
    party_screening_subject_id?: string | null;
  }) =>
    invoke<PepIndexVerdict>({ op: "search_pep_officeholders", ...payload }),

  deferPepDetermination: (payload: {
    case_id: string;
    party_screening_subject_id?: string | null;
    reason: PepDeferralReason;
    needed: string;
    methods: Array<{
      kind?: PepSourceKind; source: string;
      reference?: string | null; result?: string | null; note?: string | null;
    }>;
  }) =>
    invoke<{ deferred: boolean; subject_name: string }>(
      { op: "defer_pep_determination", ...payload }),
};

export interface AmlReconciliationItem {
  id: string; declared_role: string; declared_name: string;
  change_kind: string; resolution_status: string;
  resolved_party_type: string | null; resolved_party_id: string | null;
  verification_required: boolean; screening_required: boolean;
  conflicts: any[]; similarity_candidates: Array<{ party_type: string; party_id: string; full_name: string; score: number; requires_confirmation: boolean }>;
  exact_candidate_id: string | null; exact_candidate_type: string | null;
  declared_payload?: Record<string, unknown>;
  resolution_rationale?: string | null;
}

export interface AmlPartyVerificationLink {
  id: string; case_id: string; party_type: string; party_id: string | null;
  verification_check_id: string; relationship: string; authoritative: boolean;
  linked_at: string; unlinked_at: string | null; unlink_reason: string | null;
  metadata?: Record<string, unknown>;
}

export interface AmlScreeningCandidateMatch {
  id: string; screening_check_id: string; match_type: string;
  list_name: string | null; matched_name: string; score: number | null;
  jurisdiction: string | null; status: "open" | "confirmed" | "dismissed" | "escalated";
  details?: Record<string, unknown>;
}

export interface AmlPepDetermination {
  id: string; party_screening_subject_id: string | null; subject_name: string;
  result: "not_pep" | "pep";
  pep_type: "foreign" | "domestic" | "international_organisation" | null;
  pep_relationship: "self" | "family_member" | "close_associate" | null;
  determined_at: string; determined_by_label: string | null;
  review_due_at: string | null; superseded_at: string | null;
}

export type AmlScreeningScopeKey = "sanctions" | "pep" | "adverse_media" | "watchlist";

/**
 * Returned verbatim from `decideScreeningPolicy` in
 * `_shared/aml/screeningPolicy.pure.ts`, so the field names are the pure
 * module's own — camelCase, not the snake_case of a table row.
 */
export interface AmlScreeningPolicyDecision {
  required: AmlScreeningScopeKey[];
  notRequired: Array<{ scope: AmlScreeningScopeKey; basis: string }>;
  triggers: string[];
  pepRoute: "declaration_supported" | "manual_review";
  /** The client's own answers, verbatim, that produced this decision. */
  evidence: Record<string, string>;
  policyVersion: string;
  summary: string;
}

export type AmlScreeningActionOwner =
  "system" | "analyst" | "reviewer" | "administrator" | "client" | "none";

export type AmlScreeningNextActionKey =
  "none" | "await_submission" | "classify_perimeter" | "fix_provider"
  | "enrol_subjects" | "run_screening"
  | "adjudicate_match" | "record_pep" | "await_provider_result" | "screening_stalled"
  | "escalate"
  /** A closed case resumes by an explicit reopen, never a status advance. */
  | "reopen_case"
  /** A required screening the provider cannot do and the MLRO can. */
  | "complete_manually";

export interface AmlScreeningNextAction {
  key: AmlScreeningNextActionKey;
  label: string | null;
  headline: string;
  detail: string;
  owner: AmlScreeningActionOwner;
  /**
   * The other lawful route to the same blockage, owned by another role.
   *
   * Decided by the server alongside the primary, so the browser only chooses
   * which to show first. An alternative is a different METHOD of discharging
   * an obligation and never a way round one.
   */
  alternative?: {
    key: AmlScreeningNextActionKey;
    label: string;
    headline: string;
    detail: string;
    owner: AmlScreeningActionOwner;
  } | null;
}

/** One scope's obligation, exactly as `aml.case_screening_scopes` holds it. */
export interface AmlCaseScreeningScope {
  scope: AmlScreeningScopeKey;
  required: boolean;
  /** Whether an authorised operator may run it voluntarily. */
  optional: boolean;
  state: "required" | "not_required";
  reason_code: string;
  reason: string;
}

export interface AmlScreeningPerimeter {
  classification: "designated_service" | "outside_perimeter";
  /**
   * Whether anybody has DECIDED this. An unclassified case and one recorded
   * as inside both read `designated_service` — same obligation, different
   * operator situation.
   */
  classified?: boolean;
  reason_code: string | null;
  scopes_excluded: AmlScreeningScopeKey[];
  recorded_by_label: string | null;
  recorded_at: string | null;
}

export interface AmlScreeningStageSync {
  enrolled: number;
  subjects: AmlPartyScreeningSubject[];
  policy: AmlScreeningPolicyDecision;
  /** The canonical per-scope decision. The authority on what is required. */
  scopes: AmlCaseScreeningScope[];
  perimeter: AmlScreeningPerimeter;
  policy_version: string;
  provider_ready: boolean;
  /**
   * Whether provider readiness bears on this case at all. False when no
   * required scope needs the sanctions provider — in which case an unloaded
   * list is a fact that does not apply, not a blocker to clear.
   */
  provider_relevant: boolean;
  next_action: AmlScreeningNextAction;
  decision_recorded: boolean;
  scope_changed: AmlScreeningScopeKey[];
  /**
   * The case's canonical lifecycle, reported so Stage 5 can present a
   * retained record as one. Absent on a server that predates it, which reads
   * as "not closed" — the behaviour this product had before.
   */
  case_closed?: boolean;
  case_stage?: string | null;
  service_gate_status?: string | null;
  /**
   * What the customer declared about political exposure.
   *
   * Optional because a server that predates it sends nothing — and an absent
   * reading is rendered as "not established", never as an answer of "no".
   */
  pep_declaration?: PepDeclarationReading;
}

export interface AmlPartyScreeningSubject {
  id: string; case_id: string; party_type: string; party_id: string | null;
  screened_name: string; required: boolean; state: string;
  last_screened_at: string | null; refresh_due_at: string | null;
  adjudicated_at: string | null; adjudication_note: string | null;
  screening_check_id: string | null; error_category: string | null;
  /** Set when an operator ran this screening voluntarily. */
  voluntary_run_at?: string | null;
  voluntary_run_by_label?: string | null;
  /** Canonical candidate matches for this subject's screening check (staff-side). */
  matches?: AmlScreeningCandidateMatch[];
  /** Current (non-superseded) PEP determination for this party, if any. */
  pep_determination?: AmlPepDetermination | null;
  /**
   * How the CURRENT position was reached: by the provider, or by the MLRO.
   *
   * Absent on every historical subject and on any deployment where the
   * migration has not run, which reads as automated — the method this
   * product had until manual screening existed.
   */
  screening_method?: "automated" | "manual" | null;
  /**
   * Manual attempts against this party, newest first.
   *
   * These are ordinary `screening_checks` rows; they are surfaced separately
   * only so the panel can render one history without re-querying.
   */
  manual_checks?: AmlManualScreeningCheck[];
}

/** The MLRO's conclusion. Mirrors `_shared/aml/manualScreening.pure.ts`. */
export type AmlManualOutcome =
  | "no_match" | "possible_match" | "confirmed_match" | "unable_to_complete";

export type AmlManualUnableReason =
  | "insufficient_identity" | "source_unavailable"
  | "evidence_inconclusive" | "other_documented_reason";

export interface AmlManualScreeningSource {
  source_type: string;
  source_name: string;
  source_reference?: string | null;
  searched_name?: string | null;
  searched_at?: string | null;
  notes?: string | null;
}

export interface AmlManualScreeningCheck {
  id: string;
  scope: string[] | null;
  status: string;
  screening_method?: string | null;
  manual_outcome: AmlManualOutcome | null;
  unable_reason: AmlManualUnableReason | null;
  rationale: string | null;
  sources_checked: AmlManualScreeningSource[] | null;
  searched_names: string[] | null;
  performed_at: string | null;
  /** Whether POLICY required the screening this attempt discharges. */
  policy_required: boolean | null;
  voluntary: boolean | null;
  metadata?: Record<string, unknown> | null;
}

export interface AmlSubmissionReview {
  case: {
    id: string; reference: string; subject: string; status: string;
    case_stage: string | null; client_portal_status: string | null; service_gate_status: string | null;
  };
  submission: {
    id: string; version_number: number; review_status: string; submitted_at: string;
    submitted_by_type: string | null; submitted_by: string | null; review_reason: string | null;
    reviewed_at: string | null; questionnaire_version: string | null; consent_version: string | null;
    applicable_sections: string[]; sections: Array<{ section: string; status?: string; payload?: any }>;
    superseded_at: string | null;
  } | null;
  previous_version: { id: string; version_number: number; submitted_at: string } | null;
  differences: Array<{ section: string; field: string; previous: unknown; current: unknown; kind: string }>;
  differences_material: boolean;
  versions: Array<{ id: string; version_number: number; submitted_at: string; review_status: string }>;
  consent_evidence: Array<{ kind: string; version: string; accepted_at: string; document_hash: string | null }>;
  related_parties: AmlReconciliationItem[];
  requirements: any[];
  documents: any[];
  verification: Array<{
    id: string; party_id: string | null; party_label: string | null; check_type: string;
    status: string; processing_status: string | null; authoritative: boolean | null;
    execution_mode: string | null; attempt_consumed: boolean | null; provider: string | null;
    completed_at: string | null; provider_error_category: string | null;
  }>;
  screening: AmlPartyScreeningSubject[];
  open_requests: any[];
  missing_mandatory: string[];
  risk: { latest_assessment_at: string | null; stale: boolean; stale_reasons: string[] };
  message?: string;
}
