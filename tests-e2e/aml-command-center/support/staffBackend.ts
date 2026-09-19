import type { Page, Route } from '@playwright/test';
import type { AmlRole } from '../../../src/hooks/useAmlAccess';

/**
 * Staff Command Center browser fixtures.
 *
 * Why the staff surfaces are driven from here rather than from the preview
 * branch: the branch carries only the AML tables the client-portal function
 * reads. Its parent migration ledger is not replayable (documented
 * pre-existing platform defect — see docs/aml/rollout/full-integration-progress.md),
 * so the ~25 further `aml.*` tables the staff functions query do not exist
 * there, and the ten staff edge functions are not deployed to it.
 *
 * What is therefore under test here is the **rendered SPA**: the real
 * `AmlCaseWorkspace`, `SubmissionReviewPanel`, `VerificationSection`,
 * `PartyVerificationPanel`, `PartyScreeningPanel` and
 * `LegacyVerificationHistoryPanel` components, real routing, real dialogs,
 * real focus behaviour and real responsive layout. The server side of these
 * ops is covered by the source-contract suite and by the production-shaped
 * Postgres rehearsals.
 *
 * Every payload below is shaped to the response contracts declared in
 * `src/lib/aml/amlCasesApi.ts`, and all of it is synthetic: no real customer,
 * document, selfie or biometric, and no notification leaves the browser.
 */

export const STAFF_CASE_ID = 'c5a51000-0000-4000-8000-000000000001';
export const STAFF_CASE_REF = 'AML-SYN-00042';

/** Records the ops the page invoked, so a test can assert what was called. */
export interface OpLog {
  calls: Array<{ fn: string; op: string; body: any }>;
  of: (fn: string, op: string) => any[];
}

const nowIso = (offsetDays = 0) =>
  new Date(Date.UTC(2026, 6, 20 + offsetDays, 3, 0, 0)).toISOString();

/**
 * The nine party types the model actually supports — exactly
 * `aml.party_verification_links_party_type_check`. An earlier fixture invented
 * 'individual', 'settlor', 'partner', 'shareholder' and 'signatory', none of
 * which the database accepts.
 */
export const PARTY_TYPES = [
  'case_subject', 'co_purchaser', 'director', 'trustee', 'beneficial_owner',
  'authorised_representative', 'donor', 'private_lender', 'other',
] as const;

function reconciliationItems() {
  // Exactly the change_kind and resolution_status CHECK vocabularies.
  const kinds = ['new', 'changed', 'removed', 'role_changed', 'unchanged'];
  const statuses = ['open', 'linked', 'created', 'manual_only', 'rejected', 'superseded', 'conflict'];
  return PARTY_TYPES.map((partyType, i) => ({
    id: `re000000-0000-4000-8000-0000000000${String(i + 10).padStart(2, '0')}`,
    declared_role: partyType,
    declared_name: `Synthetic Party ${i + 1}`,
    change_kind: kinds[i % kinds.length],
    resolution_status: statuses[i % statuses.length],
    resolved_party_type: i === 0 ? partyType : null,
    resolved_party_id: i === 0 ? `pa000000-0000-4000-8000-0000000000${String(i + 30).padStart(2, '0')}` : null,
    verification_required: i % 2 === 0,
    screening_required: i % 3 === 0,
    conflicts: i === 2
      ? [{ field: 'date_of_birth', declared: '1980-01-01', canonical: '1980-02-02' }]
      : [],
    similarity_candidates: i === 1
      ? [{ party_type: partyType, party_id: 'pa000000-0000-4000-8000-000000000099', full_name: 'Synthetic Party One', score: 0.86, requires_confirmation: true }]
      : [],
    exact_candidate_id: i === 3 ? 'pa000000-0000-4000-8000-000000000098' : null,
    exact_candidate_type: i === 3 ? partyType : null,
    declared_payload: { synthetic: true, source: 'client_submission_v2' },
    resolution_rationale: i === 0 ? 'Matched on stable identifier' : null,
  }));
}

function screeningSubjects() {
  // Exactly aml.party_screening_subjects_state_check, verified against the
  // constraint on the rehearsal database. An earlier fixture invented 'clear'
  // and 'stale', so the panel was being asserted against states that cannot
  // exist.
  const states = [
    'not_required', 'not_started', 'queued', 'processing', 'completed',
    'possible_match', 'confirmed_match', 'false_positive', 'error',
  ];
  return states.map((state, i) => {
    const screeningCheckId = state === 'not_started' || state === 'not_required'
      ? null : `ch000000-0000-4000-8000-0000000000${String(i + 50).padStart(2, '0')}`;
    return {
      id: `sc000000-0000-4000-8000-0000000000${String(i + 10).padStart(2, '0')}`,
      case_id: STAFF_CASE_ID,
      party_type: PARTY_TYPES[i % PARTY_TYPES.length],
      party_id: `pa000000-0000-4000-8000-0000000000${String(i + 40).padStart(2, '0')}`,
      screened_name: `Synthetic Screened ${i + 1}`,
      required: true,
      state,
      last_screened_at: state === 'not_started' || state === 'not_required' ? null : nowIso(-3),
      refresh_due_at: state === 'completed' ? nowIso(-1) : nowIso(30),
      adjudicated_at: state === 'confirmed_match' ? nowIso(-1) : null,
      adjudication_note: state === 'confirmed_match' ? 'Synthetic adjudication note' : null,
      screening_check_id: screeningCheckId,
      error_category: state === 'error' ? 'provider_unavailable' : null,
      // Canonical candidates: adjudication happens per screening match, so a
      // possible_match subject carries the open candidates staff inspect.
      matches: state === 'possible_match'
        ? [{
            id: 'sm000000-0000-4000-8000-000000000001',
            screening_check_id: screeningCheckId,
            match_type: 'sanctions', list_name: 'DFAT Consolidated List (Australia)',
            matched_name: 'Synthetic Listed Person', score: 0.91, jurisdiction: 'AU',
            status: 'open', details: { external_id: 'DFAT-SYN-1' },
          }]
        : state === 'confirmed_match'
          ? [{
              id: 'sm000000-0000-4000-8000-000000000002',
              screening_check_id: screeningCheckId,
              match_type: 'sanctions', list_name: 'UN Consolidated List',
              matched_name: 'Synthetic Confirmed Person', score: 0.95, jurisdiction: 'UN',
              status: 'confirmed', details: { external_id: 'UN-SYN-2' },
            }]
          : [],
      pep_determination: state === 'completed'
        ? {
            id: 'pd000000-0000-4000-8000-000000000001',
            party_screening_subject_id: `sc000000-0000-4000-8000-0000000000${String(i + 10).padStart(2, '0')}`,
            subject_name: `Synthetic Screened ${i + 1}`, result: 'not_pep',
            pep_type: null, pep_relationship: null,
            determined_at: nowIso(-2), determined_by_label: 'synthetic-reviewer',
            review_due_at: nowIso(300), superseded_at: null,
          }
        : null,
    };
  });
}

function verificationRows() {
  return [
    { id: 'vc000000-0000-4000-8000-000000000001', party_id: null, party_label: 'Synthetic Applicant', check_type: 'electronic_idv', status: 'referred', processing_status: 'completed', authoritative: true, execution_mode: 'live', attempt_consumed: true, provider: 'selfhosted', completed_at: nowIso(-4), provider_error_category: null },
    { id: 'vc000000-0000-4000-8000-000000000002', party_id: null, party_label: 'Synthetic Applicant', check_type: 'electronic_idv', status: 'pending', processing_status: 'technical_failure', authoritative: true, execution_mode: 'live', attempt_consumed: false, provider: 'selfhosted', completed_at: null, provider_error_category: 'provider_unavailable' },
    { id: 'vc000000-0000-4000-8000-000000000003', party_id: null, party_label: 'Synthetic Applicant', check_type: 'electronic_idv', status: 'pending', processing_status: 'capture_unusable', authoritative: true, execution_mode: 'live', attempt_consumed: false, provider: 'selfhosted', completed_at: null, provider_error_category: 'capture_unusable' },
    { id: 'vc000000-0000-4000-8000-000000000004', party_id: null, party_label: 'Synthetic Applicant', check_type: 'electronic_idv', status: 'failed', processing_status: 'completed', authoritative: false, execution_mode: 'simulation', attempt_consumed: false, provider: 'simulator', completed_at: nowIso(-6), provider_error_category: null },
    { id: 'vc000000-0000-4000-8000-000000000005', party_id: null, party_label: 'Synthetic Applicant', check_type: 'electronic_idv', status: 'pending', processing_status: 'processing', authoritative: true, execution_mode: 'live', attempt_consumed: false, provider: 'selfhosted', completed_at: null, provider_error_category: null },
  ];
}

function submissionReview(versionNumber = 2) {
  const v1 = { id: 'sv000000-0000-4000-8000-000000000001', version_number: 1, submitted_at: nowIso(-8), review_status: 'changes_requested' };
  const v2 = { id: 'sv000000-0000-4000-8000-000000000002', version_number: 2, submitted_at: nowIso(-6), review_status: 'under_review' };
  const current = versionNumber === 1 ? v1 : v2;
  return {
    case: {
      id: STAFF_CASE_ID, reference: STAFF_CASE_REF, subject: 'Synthetic Trust Structure',
      status: 'client_submitted', case_stage: 'client_submitted',
      client_portal_status: 'submitted', service_gate_status: 'allowed_pending_verification',
    },
    submission: {
      ...current,
      submitted_by_type: 'client',
      submitted_by: 'pu000000-0000-4000-8000-000000000001',
      review_reason: versionNumber === 1 ? 'Synthetic: source of funds detail required' : null,
      reviewed_at: versionNumber === 1 ? nowIso(-7) : null,
      questionnaire_version: 'q-2026.1',
      consent_version: 'v1',
      applicable_sections: ['personal_details', 'entity_details', 'related_parties', 'funding', 'source_of_wealth'],
      sections: [
        { section: 'personal_details', status: 'submitted', payload: { full_name: 'Synthetic Applicant', date_of_birth: '1980-01-01', residential_address: '1 Synthetic Street' } },
        { section: 'entity_details', status: 'submitted', payload: { entity_name: 'Synthetic Trust', abn: '00000000000' } },
        { section: 'related_parties', status: 'submitted', payload: { parties: [{ role: 'trustee', full_name: 'Synthetic Party 5' }] } },
        { section: 'funding', status: 'submitted', payload: { deposit_source: 'savings', amount: 250000 } },
        { section: 'source_of_wealth', status: 'draft', payload: {} },
      ],
      superseded_at: versionNumber === 1 ? nowIso(-6) : null,
    },
    previous_version: versionNumber === 2 ? v1 : null,
    differences: versionNumber === 2
      ? [
          { section: 'related_parties', field: 'parties[1]', previous: null, current: 'Synthetic Party 6', kind: 'added' },
          { section: 'funding', field: 'amount', previous: 200000, current: 250000, kind: 'changed' },
          { section: 'personal_details', field: 'phone', previous: '0400000000', current: null, kind: 'removed' },
        ]
      : [],
    differences_material: versionNumber === 2,
    versions: [v1, v2],
    consent_evidence: [
      { kind: 'aml_collection', version: 'v1', accepted_at: nowIso(-9), document_hash: 'synthetic-consent-hash' },
    ],
    related_parties: reconciliationItems(),
    requirements: [
      { id: 'rq000000-0000-4000-8000-000000000001', code: 'photo_id', label: 'Photo identification', required: true, status: 'outstanding' },
      { id: 'rq000000-0000-4000-8000-000000000002', code: 'proof_of_address', label: 'Proof of address', required: true, status: 'satisfied' },
    ],
    documents: [
      { id: 'dc000000-0000-4000-8000-000000000001', filename: 'synthetic-photo-id-v1.png', status: 'rejected', version_number: 1, client_safe_rejection_reason: 'unreadable', internal_review_note: 'Synthetic internal note — staff only', replacement_document_id: 'dc000000-0000-4000-8000-000000000002', uploaded_at: nowIso(-8) },
      { id: 'dc000000-0000-4000-8000-000000000002', filename: 'synthetic-photo-id-v2.png', status: 'uploaded', version_number: 2, client_safe_rejection_reason: null, internal_review_note: null, previous_document_id: 'dc000000-0000-4000-8000-000000000001', uploaded_at: nowIso(-5) },
    ],
    verification: verificationRows(),
    screening: screeningSubjects(),
    open_requests: [
      { id: 'cr000000-0000-4000-8000-000000000001', action_code: 'upload_document', subject: 'Replace your photo identification', status: 'open', created_at: nowIso(-4) },
    ],
    missing_mandatory: ['source_of_wealth'],
    risk: {
      latest_assessment_at: nowIso(-7),
      stale: true,
      stale_reasons: ['canonicalIdv', 'confirmed_screening_match'],
    },
  };
}

/**
 * Installs the staff backend. Returns an op log so tests can assert that a
 * button really invoked the op it claims to (and with a reason).
 */
export async function installStaffBackend(
  page: Page,
  opts: { roles: AmlRole[]; isSuperadmin?: boolean; versionNumber?: number } = { roles: ['analyst'] },
): Promise<OpLog> {
  const calls: OpLog['calls'] = [];
  const log: OpLog = { calls, of: (fn, op) => calls.filter((c) => c.fn === fn && c.op === op).map((c) => c.body) };

  const json = (route: Route, payload: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });

  // Playwright matches routes in REVERSE registration order, so this
  // AML-shaped catch-all is registered FIRST: later, more specific handlers
  // take precedence over it. Registered at all so an op nobody stubbed
  // answers empty instead of failing and masking a real assertion.
  await page.route('**/functions/v1/aml-*', (route) => json(route, {}));

  // Staff session: the cookie-only custom auth flow. Synthetic identity only.
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem('supabase_access_token', 'synthetic.staff.access.token');
      sessionStorage.setItem('current_user', JSON.stringify({ id: 'su000000-0000-4000-8000-000000000001', username: 'synthetic.staff', role: 'staff' }));
      localStorage.setItem('auth_version', '5');
    } catch { /* ignore */ }
  });

  await page.route('**/functions/v1/custom-auth-verify-v2', (route) =>
    json(route, {
      valid: true,
      user: { id: 'su000000-0000-4000-8000-000000000001', username: 'synthetic.staff', role: 'staff' },
      roles: ['staff'],
      access_token: 'synthetic.staff.access.token',
    }),
  );

  await page.route('**/functions/v1/aml-access', (route) =>
    json(route, { flagEnabled: true, roles: opts.roles }),
  );

  // Unrelated shell traffic answered empty so a 404 cascade cannot mask an
  // AML assertion, trip the auth circuit breaker, or fill the console with
  // noise that hides a real AML error. These are Command Centre chrome, not
  // the surface under test.
  const SHELL_FUNCTIONS = [
    'notifications-feed-v2', 'mission-control-balance', 'mission-control-plan-change',
    'mission-control-feedback-prompt', 'admin-user-management', 'user-permissions',
    'get-whitelabel-settings', 'get-investment-reports', 'internal-messaging',
    'get-portal-client-data', 'client-portal-notifications',
  ];
  for (const fn of SHELL_FUNCTIONS) {
    await page.route(`**/functions/v1/${fn}`, (route) => json(route, {}));
  }
  // Two of them are checked for `success`, so an empty object is treated as a
  // failure and logs an error that would drown the AML console assertion.
  await page.route('**/functions/v1/notifications-feed-v2', (route) =>
    json(route, { success: true, notifications: [], unread_count: 0 }),
  );
  await page.route('**/functions/v1/admin-user-management', (route) =>
    json(route, { success: true, permissions: [] }),
  );

  const handlers: Record<string, (op: string, body: any) => unknown> = {
    'aml-cases': (op, body) => {
      switch (op) {
        case 'get':
          return {
            case: {
              id: STAFF_CASE_ID, case_reference: STAFF_CASE_REF, subject_display_name: 'Synthetic Trust Structure',
              subject_type: 'trust', status: 'client_submitted', case_stage: 'client_submitted',
              client_portal_status: 'submitted', service_gate_status: 'allowed_pending_verification',
              risk_rating: 'high', opened_at: nowIso(-10), updated_at: nowIso(-1),
              created_at: nowIso(-10), client_id: 'cl000000-0000-4000-8000-000000000001',
              metadata: {}, purchase_file_id: null, risk_score: null,
              assigned_analyst_id: null, assigned_mlro_id: null, closed_at: null, created_by: null,
            },
            events: [
              { id: 'ev000000-0000-4000-8000-000000000001', category: 'submission', summary: 'Client submitted version 2', created_at: nowIso(-6), payload: { synthetic: true } },
            ],
          };
        case 'get_submission_review':
          return submissionReview(body?.version_number ?? opts.versionNumber ?? 2);
        case 'list_party_reconciliation':
          return { items: reconciliationItems() };
        case 'resolve_party_reconciliation':
          return { item: { ...reconciliationItems()[0], resolution_status: 'linked', resolution_rationale: body?.rationale ?? null } };
        case 'list_party_verification_links':
          return {
            links: [
              { id: 'pl000000-0000-4000-8000-000000000001', case_id: STAFF_CASE_ID, party_type: 'case_subject', party_id: 'pa000000-0000-4000-8000-000000000030', verification_check_id: 'vc000000-0000-4000-8000-000000000001', relationship: 'subject', authoritative: true, linked_at: nowIso(-4), unlinked_at: null, unlink_reason: null },
            ],
            // Only authoritative, non-simulated checks may be offered.
            eligible_checks: verificationRows().filter((v) => v.authoritative && v.execution_mode !== 'simulation'),
          };
        case 'link_party_verification':
          return { link: { id: 'pl000000-0000-4000-8000-000000000002', case_id: STAFF_CASE_ID, party_type: body?.party_type, party_id: body?.party_id ?? null, verification_check_id: body?.verification_check_id, relationship: 'subject', authoritative: true, linked_at: nowIso(), unlinked_at: null, unlink_reason: null } };
        case 'unlink_party_verification':
          return { link: { id: body?.link_id, case_id: STAFF_CASE_ID, party_type: 'case_subject', party_id: null, verification_check_id: 'vc000000-0000-4000-8000-000000000001', relationship: 'subject', authoritative: true, linked_at: nowIso(-4), unlinked_at: nowIso(), unlink_reason: body?.reason ?? null } };
        case 'list_party_screening':
          return { subjects: screeningSubjects(), case_pep_determination: null };
        case 'queue_party_screening':
          return { subject: { ...screeningSubjects()[1], id: body?.subject_id } };
        case 'adjudicate_party_screening':
          // Canonical semantics: the resolved match comes back with the
          // re-projected subject.
          return {
            subject: { ...screeningSubjects()[4], id: body?.subject_id, adjudication_note: body?.note ?? null },
            match: { id: body?.match_id, status: body?.outcome === 'confirmed_match' ? 'confirmed' : 'dismissed' },
          };
        case 'list_pep_determinations':
          return { determinations: [] };
        case 'record_pep_determination':
          return {
            determination: {
              id: 'pd000000-0000-4000-8000-000000000099',
              party_screening_subject_id: body?.party_screening_subject_id ?? null,
              subject_name: body?.subject_name ?? 'Synthetic Screened',
              result: body?.result ?? 'not_pep',
              pep_type: body?.pep_type ?? null, pep_relationship: body?.pep_relationship ?? null,
              determined_at: nowIso(), determined_by_label: 'synthetic-reviewer',
              review_due_at: nowIso(365), superseded_at: null,
            },
          };
        case 'accept_submission':
        case 'escalate_submission':
        case 'supersede_submission':
          return { submission: { id: body?.submission_id, review_status: op === 'accept_submission' ? 'accepted' : op === 'escalate_submission' ? 'escalated' : 'superseded', review_reason: body?.reason ?? null } };
        case 'request_submission_changes':
        case 'request_submission_document':
        case 'request_submission_clarification':
          return {
            submission: { id: body?.submission_id, review_status: 'changes_requested', review_reason: body?.reason ?? null },
            client_request: { id: 'cr000000-0000-4000-8000-000000000009', action_code: op === 'request_submission_document' ? 'upload_document' : op === 'request_submission_clarification' ? 'provide_clarification' : 'update_questionnaire_section', status: 'open', notification_status: 'queued' },
          };
        case 'review_document_v2':
          return { document: { id: body?.document_id, status: body?.decision === 'accept' ? 'accepted' : 'rejected' }, client_request: body?.decision === 'reject' ? { id: 'cr000000-0000-4000-8000-000000000010', action_code: 'upload_document', status: 'open' } : null };
        case 'list_documents':
          return { documents: submissionReview().documents };
        case 'list_requirements':
          return { requirements: submissionReview().requirements };
        case 'list_submissions':
          return { submissions: submissionReview().versions };
        case 'list_client_requests':
          return { requests: submissionReview().open_requests };
        case 'list_events':
          return { events: [] };
        case 'consent_status':
          // Shape matches aml-cases' consent_status response exactly.
          return {
            version: 'v1',
            satisfied: true,
            outstanding: [],
            documents: [
              { code: 'aml_collection', title: 'AML/CTF collection notice', required: true, acknowledgement_type: 'tick', accepted_at: nowIso(-9), accepted_by: 'Synthetic Applicant', actor_type: 'client', document_hash: 'synthetic-consent-hash' },
            ],
            history: [],
          };
        default:
          return {};
      }
    },
    'aml-verification': (op) => {
      switch (op) {
        case 'list_verification_checks':
          return { checks: verificationRows(), attempts_used: 1, attempts_allowed: 3 };
        case 'list_idv':
          // Legacy read-only history: one simulated row that must be labelled
          // as a test simulation and must consume no attempt.
          return {
            identity_checks: [
              { id: 'ic000000-0000-4000-8000-000000000001', case_id: STAFF_CASE_ID, method: 'electronic', status: 'failed', execution_mode: 'simulation', authoritative: false, environment: 'staging', created_at: nowIso(-9) },
              { id: 'ic000000-0000-4000-8000-000000000002', case_id: STAFF_CASE_ID, method: 'electronic', status: 'verified', execution_mode: 'live', authoritative: true, environment: 'staging', created_at: nowIso(-8) },
            ],
          };
        case 'list_screening':
          return { screening_checks: [] };
        case 'list_matches':
          return { matches: [] };
        case 'list_biometric_access':
          return { access_log: [] };
        case 'provider_readiness':
          // Shape matches ProviderReadiness in amlVerificationApi.ts.
          return {
            environment: 'staging',
            simulator_blocked: false,
            note: 'synthetic',
            idv: { capability: 'idv', configured_provider: 'selfhosted', mode: 'live', adapter_wired: true, secrets_present: { AML_VERIFICATION_SERVICE_URL: true, AML_VERIFICATION_SERVICE_TOKEN: true }, last_health: null, state: 'ready_live' },
            screening: { capability: 'pep_sanctions', configured_provider: 'local_lists', mode: 'live', adapter_wired: true, secrets_present: {}, last_health: null, state: 'ready_live' },
          };
        case 'retry_verification_processing':
          return { check: { ...verificationRows()[1], processing_status: 'retry_scheduled' } };
        default:
          return {};
      }
    },
    'aml-risk': (op) => {
      switch (op) {
        case 'list_assessments':
          return { assessments: [{ id: 'ra000000-0000-4000-8000-000000000001', case_id: STAFF_CASE_ID, rating: 'high', assessed_at: nowIso(-7), stale: true, stale_reasons: ['canonicalIdv'], factors: [] }] };
        case 'latest_decision':
          return { decision: null };
        case 'list_decisions':
          return { decisions: [] };
        case 'list_overrides':
          return { overrides: [] };
        case 'list_factors':
          return { factors: [] };
        case 'list_triggers':
          return { triggers: [] };
        default:
          return {};
      }
    },
    'aml-records': (op) => (op === 'list_schedules' ? { schedules: [] } : {}),
    'aml-entities': () => ({ entities: [] }),
    'aml-monitoring': () => ({ alerts: [] }),
    'aml-tenant': () => ({ terminology: {} }),
    'aml-step-up': () => ({ token: 'synthetic-step-up', expires_at: nowIso(1) }),
  };

  for (const [fn, handler] of Object.entries(handlers)) {
    await page.route(`**/functions/v1/${fn}`, async (route) => {
      let body: any = {};
      try { body = JSON.parse(route.request().postData() || '{}'); } catch { /* ignore */ }
      const op = String(body?.op ?? '');
      calls.push({ fn, op, body });
      await json(route, handler(op, body));
    });
  }

  return log;
}

export const staffCaseUrl = (base: string) => `${base}/admin/aml/cases/${STAFF_CASE_ID}`;
