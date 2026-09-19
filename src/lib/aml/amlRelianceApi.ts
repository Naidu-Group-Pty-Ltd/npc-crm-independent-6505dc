/**
 * Compliance Passport — staff API for the cross-portal reliance engine
 * (AML/CTF Act 2006 Pt 2 Div 7). Partner organisations never use this
 * client: they redeem a bearer token against `aml-reliance` directly from
 * their own portal integration.
 */
import { invokeAmlFunction } from "./invokeAmlFunction";

const invoke = <T = any>(payload: Record<string, unknown>) =>
  invokeAmlFunction<T>("aml-reliance", payload);

export interface RelianceAgreement {
  id: string;
  partner_org_name: string;
  partner_org_type: "finance" | "builder" | "developer" | "solicitor_conveyancer" | "other";
  partner_abn: string | null;
  agreement_reference: string;
  executed_on: string;
  next_review_due: string;
  last_reviewed_at: string | null;
  scope: string[];
  status: "active" | "suspended" | "terminated";
  notes: string | null;
  created_at: string;
  /** Phase 1–2 additions — null/absent on environments before the migrations. */
  partner_org_id?: string | null;
  eligibility_classification?: "unassessed" | "eligible_reporting_entity" | "eligible_foreign_equivalent" | "not_eligible";
  scope_customer_types?: string[] | null;
  scope_procedures?: string[] | null;
  scope_record_classes?: string[] | null;
  record_availability_sla_hours?: number | null;
  executed_document_reference?: string | null;
  effective_from?: string | null;
  expires_on?: string | null;
  agreement_version?: number;
  current_assessment_id?: string | null;
}

export interface ComplianceAttestation {
  id: string;
  case_id: string;
  version: number;
  payload: Record<string, any>;
  payload_sha256: string;
  issued_by_email: string | null;
  issued_at: string;
  superseded_at: string | null;
}

export interface RelianceGrant {
  id: string;
  agreement_id: string;
  attestation_id: string;
  granted_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoke_reason: string | null;
  /** Where the one-time link was emailed. The link itself is never stored. */
  delivered_to_email?: string | null;
  delivered_at?: string | null;
  /** Set when the partner asked for a replacement from an expired link. */
  link_requested_at?: string | null;
  link_request_count?: number | null;
  reissued_by_grant_id?: string | null;
  reliance_agreements?: { partner_org_name: string; partner_org_type: string; status: string };
}

export interface IndependentAssessment {
  id: string;
  case_id: string;
  assessor_name: string;
  assessor_role: string | null;
  based_on_attestation_sha256: string;
  status: "open" | "satisfied" | "not_satisfied" | "records_requested";
  decision_notes: string | null;
  decided_at: string | null;
  created_at: string;
  reliance_agreements?: { partner_org_name: string };
}

export type PartnerLegalRoute =
  | "reliance" | "outsourced_cdd" | "independent_cdd" | "information_share_only";

export interface PartnerOrganisation {
  id: string;
  tenant_id: string;
  legal_name: string;
  trading_name: string | null;
  abn: string | null;
  registration_reference: string | null;
  registration_country: string;
  organisation_type: RelianceAgreement["partner_org_type"];
  portal_types: string[];
  reporting_entity_classification:
    | "unclassified" | "eligible_relying_reporting_entity" | "eligible_foreign_equivalent"
    | "reporting_entity_no_reliance" | "non_reporting_commercial"
    | "outsourcing_principal" | "service_provider";
  regulator_reference: string | null;
  classification_status: "unclassified" | "pending_review" | "classified" | "suspended";
  classification_evidence_reference: string | null;
  classification_notes: string | null;
  verified_at: string | null;
  status: "active" | "suspended" | "ended";
  created_at: string;
}

export interface PartnerCaseLink {
  id: string;
  case_id: string;
  partner_org_id: string;
  purchase_file_id: string | null;
  legal_matter_id: string | null;
  portal_type: string;
  relationship_role: string;
  legal_route: PartnerLegalRoute;
  purpose: string;
  state: "active" | "suspended" | "ended";
  linked_at: string;
  ended_at: string | null;
  end_reason_code: string | null;
  partner_organisations?: {
    legal_name: string; organisation_type: string;
    classification_status: string; status: string;
  };
}

export interface DirectPartnerAcknowledgement {
  id: string;
  case_id: string;
  partner_org_id: string;
  recipient_name: string;
  recipient_email: string;
  status: "sent" | "viewed" | "accepted" | "declined" | "expired" | "superseded";
  sent_at: string;
  resend_count: number;
  viewed_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  decline_reason: string | null;
  expires_at: string;
  /** Written on acceptance only — this is the passport gate. */
  agreement_id: string | null;
  accepted_by_name: string | null;
  partner_organisations?: { legal_name: string } | null;
}

export interface ArrangementAssessment {
  id: string;
  agreement_id: string;
  assessment_version: number;
  assessed_by_label: string | null;
  assessed_at: string;
  trigger: "initial" | "scheduled" | "significant_change" | "incident" | "other";
  evidence_references: string[];
  findings: string | null;
  decision: "suitable" | "suitable_with_conditions" | "unsuitable";
  conditions: string | null;
  next_due_at: string;
  status: "operative" | "superseded";
  superseded_at: string | null;
}

export interface PartnerRecordsRequest {
  id: string;
  case_id: string;
  partner_case_link_id: string;
  partner_org_id: string;
  requested_record_codes: string[];
  rationale: string;
  scope_evaluation: Array<{ code: string; label: string | null; scope: string }>;
  status: "draft" | "submitted" | "under_review" | "approved" | "partly_approved"
    | "denied" | "delivered" | "expired" | "cancelled";
  requested_at: string;
  requested_by_label: string | null;
  due_at: string | null;
  approved_record_codes: string[];
  denied_record_codes: string[];
  origin_response_message: string | null;
  reviewed_at: string | null;
  partner_organisations?: { legal_name: string; organisation_type: string };
}

export interface PartnerEvidenceDelivery {
  id: string;
  request_id: string;
  record_code: string;
  safe_label: string;
  delivered_version: number;
  delivered_sha256: string | null;
  delivered_at: string;
  expires_at: string;
  revoked_at: string | null;
}

export interface PartnerOrgNameMapping {
  id: string;
  agreement_id: string;
  original_name: string;
  original_org_type: string;
  original_abn: string | null;
  proposed_partner_org_id: string | null;
  status: "pending" | "mapped" | "rejected";
  mapped_at: string | null;
  note: string | null;
}

/**
 * Passport distribution readiness, exactly as the server derives it.
 *
 * `partners[]` is `DistributionReadiness` from
 * `_shared/aml/passport/passportDistribution.pure.ts`. It is typed here
 * through the browser mirror so the two cannot drift, and it is the ONLY
 * source of a partner's route, blockers and evidence classes — the UI never
 * recomputes any of them.
 */
export interface PassportDistributionReadinessResponse {
  enabled: boolean;
  passport: {
    attestation_id: string | null;
    version: number | null;
    payload_sha256: string | null;
    issued_at: string | null;
    /* `reasons` is not decoration: `refresh_required` covers two different
       owed acts — a version that is out of date and a gate that has not
       been approved — and only the reason codes tell them apart. See
       `refreshRemedy` in `passportState.pure.ts`. */
    state: {
      code: string; label: string; tone: string; reasons?: string[];
    } & Record<string, unknown>;
  };
  partners: import("./passport/distributionPresentation.pure").ReadinessView[];
  summary: { total: number; ready: number; already_current: number; blocked: number };
}

/**
 * The result of a distribution. One entry per partner considered — a bulk
 * share never collapses to a single verdict, because one partner failing must
 * not report the others as successful.
 *
 * `access_token` is the partner's raw token, returned exactly once for a
 * newly created grant, mirroring `grant_access`. It is never re-readable.
 */
export interface PassportShareResponse {
  passport: { attestation_id: string | null; version: number | null };
  outcomes: Array<{
    partner_org_id: string | null;
    state: string;
    shared: boolean;
    code?: string | null;
    note?: string | null;
    grant_id?: string | null;
    attestation_version?: number | null;
    access_token?: string;
    evidence_classes?: string[];
  }>;
  summary: { total: number; shared: number; already_current: number; blocked: number };
}

export const amlRelianceApi = {
  listAgreements: () =>
    invoke<{ agreements: RelianceAgreement[] }>({ op: "list_agreements" }),
  createAgreement: (params: {
    /** The canonical organisation this arrangement is WITH. */
    partner_org_id?: string;
    partner_org_name: string; partner_org_type: RelianceAgreement["partner_org_type"];
    partner_abn?: string; agreement_reference: string;
    executed_on: string; next_review_due: string; notes?: string;
  }) => invoke<{ agreement: RelianceAgreement }>({ op: "create_agreement", ...params }),
  /**
   * Point an existing arrangement at its canonical organisation.
   *
   * The repair for arrangements written before `create_agreement` accepted
   * one. Without it a grant carries no `partner_org_id`, and the partner's
   * own portal — which looks a grant up BY organisation — reports a Passport
   * it holds as never shared. Binds once and refuses to re-point.
   */
  bindAgreementOrganisation: (agreement_id: string, partner_org_id: string) =>
    invoke<{ agreement: RelianceAgreement; bound: "already" | "set" }>({
      op: "bind_agreement_organisation", agreement_id, partner_org_id,
    }),
  reviewAgreement: (agreement_id: string, next_review_due: string, outcome: "continue" | "suspend" | "terminate") =>
    invoke<{ agreement: RelianceAgreement }>({ op: "review_agreement", agreement_id, next_review_due, outcome }),

  issueAttestation: (case_id: string) =>
    invoke<{ attestation: ComplianceAttestation }>({ op: "issue_attestation", case_id }),
  listAttestations: (case_id: string) =>
    invoke<{ attestations: ComplianceAttestation[] }>({ op: "list_attestations", case_id }),

  /**
   * Returns the raw partner token exactly once.
   *
   * `deliver_to` emails the passport link at mint time — the only moment it
   * exists, since only its hash is stored. `reissue_of` revokes the named
   * predecessor once the replacement exists, so a failure leaves the
   * partner with working access rather than none, and every precondition is
   * re-run by construction.
   */
  grantAccess: (
    case_id: string, agreement_id: string,
    options: { deliver_to?: string; reissue_of?: string } = {},
  ) =>
    invoke<{
      grant: { id: string; expires_at: string; attestation_version: number };
      access_token: string; note: string;
      passport_link: string;
      delivered_to: string | null;
      link_email_sent: boolean | null;
      link_email_error: string | null;
    }>({ op: "grant_access", case_id, agreement_id, ...options }),
  /**
   * Map a REAL portal identity to this canonical partner organisation, and
   * bind the organisation to the portal organisation that identity belongs
   * to — in one act, because a membership without the binding is still a
   * locked door and a binding without a membership is a mapping nobody can
   * use.
   *
   * Without this the partner compliance page refuses a partner who has a
   * working portal login, an active arrangement and a live grant, because
   * `partner_portal_memberships` is empty and the organisation
   * cross-reference columns were declared by a migration and written by
   * nothing. The server mints no identity and never re-points an existing
   * binding.
   */
  enrolPartnerPortalAccess: (params: {
    partner_org_id: string;
    portal_user_source: "finance_portal_users" | "builder_portal_users" | "solicitor_portal_users";
    portal_user_id: string;
    portal_type: "finance" | "builder" | "developer" | "solicitor_conveyancer";
    builder_organisation_id?: string;
    organisation_role?: string;
    compliance_role?: "compliance_officer" | "operations" | "read_only";
    status?: "invited" | "active" | "suspended" | "ended";
  }) =>
    invoke<{
      membership: { id: string; status: string; portal_type: string };
      organisation_binding: { column: string; portal_organisation_id: string; bound: "already" | "set" };
      /** Enrolment is necessary, not sufficient — the surface flags decide. */
      surface_enabled: boolean;
      passport_view_enabled: boolean;
    }>({ op: "enrol_partner_portal_access", ...params }),
  revokeGrant: (grant_id: string, reason: string) =>
    invoke<{ grant: RelianceGrant }>({ op: "revoke_grant", grant_id, reason }),
  listGrants: (case_id: string) =>
    invoke<{ grants: RelianceGrant[] }>({ op: "list_grants", case_id }),

  listAssessments: (case_id: string) =>
    invoke<{ assessments: IndependentAssessment[] }>({ op: "list_assessments", case_id }),
  /**
   * The Command Centre Compliance Passport projection. Read-only; any AML
   * role; flag-gated server-side (`aml_passport_command_view` → 404
   * `passport_disabled` when off). The state, credential, stamps and every
   * section arrive derived — the browser renders and never re-decides.
   */
  getPassportView: (case_id: string) =>
    invoke<{ passport: import("./passport").PassportView }>({ op: "get_passport_view", case_id }),
  listAccessLog: (case_id: string) =>
    invoke<{ access_log: any[] }>({ op: "list_access_log", case_id }),

  /* ── Passport partner distribution ────────────────────────────────────
     Readiness is SERVER-DERIVED. These calls send a case id and, at most,
     which partners to consider — never a claim about eligibility, route,
     arrangement currency or Passport state. The browser renders the answer
     and re-decides nothing.

     `partner_org_ids` NARROWS the evaluated set; it cannot widen it. The
     server starts from the active partner links on the case, so naming an
     organisation that is not linked introduces nothing. */

  getPassportDistributionReadiness: (case_id: string, partner_org_ids?: string[]) =>
    invoke<PassportDistributionReadinessResponse>({
      op: "get_passport_distribution_readiness", case_id,
      ...(partner_org_ids ? { partner_org_ids } : {}),
    }),
  getPassportDistributionStatus: (case_id: string) =>
    invoke<PassportDistributionReadinessResponse>({
      op: "get_passport_distribution_status", case_id,
    }),
  /** Distributes to one partner. Returns that partner's individual outcome. */
  sharePassportToPartner: (case_id: string, partner_org_id: string) =>
    invoke<PassportShareResponse>({
      op: "share_passport_to_partner", case_id, partner_org_id,
    }),
  /**
   * Distributes to every eligible linked partner, or to the named subset.
   * Outcomes are per partner: one failure never reports another as shared.
   */
  sharePassportToPartners: (case_id: string, partner_org_ids?: string[]) =>
    invoke<PassportShareResponse>({
      op: "share_passport_to_partners", case_id,
      ...(partner_org_ids ? { partner_org_ids } : {}),
    }),

  /* ── canonical partner identity (Phase 1) ─────────────────────────────── */

  listPartnerOrganisations: () =>
    invoke<{ partner_organisations: PartnerOrganisation[] }>({ op: "list_partner_organisations" }),
  upsertPartnerOrganisation: (params: {
    partner_org_id?: string; legal_name?: string;
    organisation_type?: RelianceAgreement["partner_org_type"];
    trading_name?: string; abn?: string; registration_reference?: string;
    registration_country?: string; portal_types?: string[];
    status?: "active" | "suspended" | "ended";
  }) => invoke<{ partner_organisation: PartnerOrganisation }>({ op: "upsert_partner_organisation", ...params }),
  classifyPartnerOrganisation: (params: {
    partner_org_id: string;
    reporting_entity_classification: PartnerOrganisation["reporting_entity_classification"];
    classification_evidence_reference?: string;
    classification_notes?: string; regulator_reference?: string;
  }) => invoke<{ partner_organisation: PartnerOrganisation }>({ op: "classify_partner_organisation", ...params }),

  listPartnerCaseLinks: (case_id: string) =>
    invoke<{ links: PartnerCaseLink[] }>({ op: "list_partner_case_links", case_id }),
  linkPartnerToCase: (params: {
    case_id: string; partner_org_id: string; portal_type: string;
    relationship_role: string; legal_route: PartnerLegalRoute; purpose: string;
    purchase_file_id?: string; legal_matter_id?: string;
  }) => invoke<{ link: PartnerCaseLink }>({ op: "link_partner_to_case", ...params }),
  setPartnerCaseLinkState: (params: {
    link_id: string; state: "active" | "suspended" | "ended";
    end_reason_code?: "completed" | "withdrawn" | "superseded" | "client_declined" | "other";
  }) => invoke<{ link: PartnerCaseLink }>({ op: "set_partner_case_link_state", ...params }),

  listPartnerMemberships: (partner_org_id: string) =>
    invoke<{ memberships: any[] }>({ op: "list_partner_memberships", partner_org_id }),
  upsertPartnerMembership: (params: {
    partner_org_id: string; portal_type: string;
    portal_user_source: "finance_portal_users" | "builder_portal_users" | "solicitor_portal_users";
    portal_user_id: string; organisation_role?: string;
    compliance_role?: "compliance_officer" | "operations" | "read_only";
    status?: "invited" | "active" | "suspended" | "ended";
  }) => invoke<{ membership: any }>({ op: "upsert_partner_membership", ...params }),

  listPartnerMappings: () =>
    invoke<{ mappings: PartnerOrgNameMapping[] }>({ op: "list_partner_mappings" }),
  resolvePartnerMapping: (params: {
    mapping_id: string; action?: "map" | "reject";
    partner_org_id?: string; note?: string;
  }) => invoke<{ mapping: PartnerOrgNameMapping }>({ op: "resolve_partner_mapping", ...params }),

  /* ── partner workspace: Command Center support (Phase 4) ──────────────── */

  staffListPartnerRecordsRequests: (case_id: string) =>
    invoke<{ requests: PartnerRecordsRequest[]; deliveries: PartnerEvidenceDelivery[] }>(
      { op: "staff_list_partner_records_requests", case_id }),
  reviewPartnerRecordsRequest: (params: {
    request_id: string;
    decision: "under_review" | "approved" | "partly_approved" | "denied";
    approved_record_codes?: string[];
    response_message?: string;
  }) => invoke<{ request: PartnerRecordsRequest }>({ op: "review_partner_records_request", ...params }),
  recordPartnerEvidenceDelivery: (params: {
    request_id: string; record_code: string; safe_label: string;
    delivered_sha256?: string; expires_days?: number;
  }) => invoke<{ delivery: PartnerEvidenceDelivery }>({ op: "record_partner_evidence_delivery", ...params }),

  /* ── direct partner acknowledgement ───────────────────────────────────
     A partner outside the portals accepts the AML/CTF Compliance Passport
     Agreement through a one-time emailed link. The acceptance CREATES the
     reliance arrangement, which is what `grant_access` already requires —
     so no acknowledgement means no passport, enforced by a rule that
     already existed rather than a new one. */

  listPartnerAcknowledgements: (case_id: string) =>
    invoke<{ acknowledgements: DirectPartnerAcknowledgement[] }>(
      { op: "list_partner_acknowledgements", case_id }),
  /**
   * Sends (or re-sends) the agreement for acceptance. Re-sending supersedes
   * the live request, so an older link stops working — which is what makes
   * "send it to a different address" safe.
   */
  sendPartnerAcknowledgement: (params: {
    case_id: string; partner_org_id: string;
    recipient_name: string; recipient_email: string; force?: boolean;
  }) => invoke<{
    acknowledgement: {
      id: string; status: string; expires_at: string;
      recipient_email: string; resend_count: number;
    };
    email_sent: boolean;
    email_error: string | null;
    /** Returned so a failed send can still be delivered by hand. */
    link: string;
  }>({ op: "send_partner_acknowledgement", ...params }),

  /* ── arrangement governance (Phase 2) ─────────────────────────────────── */

  listArrangementAssessments: (agreement_id: string) =>
    invoke<{ assessments: ArrangementAssessment[] }>({ op: "list_arrangement_assessments", agreement_id }),
  recordArrangementAssessment: (params: {
    agreement_id: string;
    trigger: ArrangementAssessment["trigger"];
    decision: ArrangementAssessment["decision"];
    next_due_at: string; findings?: string; conditions?: string;
    evidence_references?: string[];
  }) => invoke<{ assessment: ArrangementAssessment }>({ op: "record_arrangement_assessment", ...params }),
  updateAgreementScope: (params: {
    agreement_id: string;
    eligibility_classification?: "unassessed" | "eligible_reporting_entity" | "eligible_foreign_equivalent" | "not_eligible";
    scope_customer_types?: string[]; scope_procedures?: string[];
    scope_record_classes?: string[]; record_availability_sla_hours?: number;
    jurisdiction?: string; cross_border_terms?: string;
    executed_document_reference?: string;
    effective_from?: string; expires_on?: string;
  }) => invoke<{ agreement: RelianceAgreement }>({ op: "update_agreement_scope", ...params }),

  /* ── reliable events, invalidation and refresh (Phase 6) ──────────────── */

  applyMaterialChange: (params: { case_id: string; mode?: "refresh" | "revoke" }) =>
    invoke<{
      material: boolean;
      changed_groups: string[];
      applied?: Record<string, unknown>;
      message?: string;
    }>({ op: "apply_material_change", ...params }),
  staffListRefreshObligations: (params: { case_id?: string; status?: string } = {}) =>
    invoke<{ obligations: PartnerRefreshObligation[] }>({ op: "staff_list_refresh_obligations", ...params }),
  getPartnerEventsHealth: () =>
    invoke<{ health: PartnerEventsHealth }>({ op: "get_partner_events_health" }),

  /* ── operations, reporting and readiness (Phase 8) ────────────────────── */

  getPartnerOperationsDashboard: () =>
    invoke<{ queues: PartnerQueueEntry[]; sla_note: string; generated_at: string }>(
      { op: "get_partner_operations_dashboard" }),
  listPartnerRegister: (params: { register: string; status?: string; limit?: number }) =>
    invoke<{ register: string; status: string | null; rows: Record<string, unknown>[]; generated_at: string }>(
      { op: "list_partner_register", ...params }),
  getPartnerManagementReport: (params: { from?: string; to?: string } = {}) =>
    invoke<{ report: PartnerManagementReport }>({ op: "get_partner_management_report", ...params }),
  getPartnerReadiness: () =>
    invoke<{ readiness: PartnerReadiness }>({ op: "get_partner_readiness" }),
};

/* ── Phase 6 types ───────────────────────────────────────────────────────── */

export interface PartnerRefreshObligation {
  id: string;
  case_id: string;
  partner_org_id: string;
  partner_case_link_id: string;
  safe_reason_code: string;
  required_action: "review_and_redetermine" | "acknowledge_access_change";
  status: "open" | "completed" | "cancelled" | "expired";
  due_at: string | null;
  created_at: string;
  completed_at: string | null;
  partner_organisations?: { legal_name: string } | null;
}

export interface PartnerQueueEntry {
  key: string;
  label: string;
  ownerRole: "mlro" | "reviewer" | "analyst" | "partner_organisation";
  count: number;
  oldestAt: string | null;
  age: "ok" | "warn" | "escalate";
  register: string;
  registerStatus: string | null;
}

export interface PartnerManagementReport {
  tenant_id: string;
  range: { from: string | null; to: string | null };
  partners: {
    links_by_legal_route: Record<string, number>;
    grants_active: number;
    grants_revoked: number;
    grants_expired: number;
    access_events: number;
    records_requests_by_status: Record<string, number>;
    evidence_deliveries: number;
    determinations_by_outcome: Record<string, number>;
    refresh_required_open: number;
  };
  arrangements: {
    overdue_reviews: number;
    eligibility_states: Record<string, number>;
  };
  records: {
    operative_triggers: number;
    active_legal_holds: number;
    retention_due_items: number;
    blocked_disposals: number;
    scan_approvals: number;
    disposal_failures: number;
    disposal_evidence_receipts: number;
  };
  generated_at: string;
}

export interface PartnerReadinessItem {
  key: string;
  label: string;
  state: string;
  evidence: string;
}

export interface PartnerReadiness {
  preflight: boolean;
  read_only: boolean;
  items: PartnerReadinessItem[];
  notice: string;
  generated_at: string;
}

export interface PartnerEventsHealth {
  outbox_enabled: boolean;
  pending_count: number;
  retrying_count: number;
  dead_letter_count: number;
  oldest_pending_at: string | null;
  open_obligation_count: number;
  overdue_obligation_count: number;
  refresh_required_attestation_count: number;
  arrangement_reviews_due_count: number;
  pending_events: Array<{ id: string; event_type: string; occurred_at: string; attempts: number; last_error: string | null }>;
  dead_letters: Array<{ id: string; event_type: string; failed_at: string; attempts: number }>;
  open_obligations: Array<{ id: string; case_id: string; safe_reason_code: string; required_action: string; due_at: string | null; created_at: string }>;
  refresh_required_attestations: Array<{ id: string; case_id: string; version: number; refresh_required_at: string }>;
  arrangement_reviews_due: Array<{ id: string; partner_org_name: string; next_review_due: string }>;
  generated_at: string;
}
