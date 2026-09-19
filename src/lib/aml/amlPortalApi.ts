/**
 * Client Portal → AML/CTF onboarding API.
 *
 * The session rides the `x-portal-session-token` header, carrying the in-memory
 * token that `client-portal-verify` repopulates from the HttpOnly cookie on each
 * load. This used to read the token straight out of `localStorage`, where it
 * survived restarts and was readable by any script. See src/lib/portalSession.ts.
 */
import { portalSessionBodyFields, portalSessionHeaders } from '@/lib/portalSession';
import type {
  IdentityCapturePlan, IdentityCaptureKind, IdentityDocumentChoice,
} from '@/lib/aml/identityDocuments';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/integrations/supabase/env';


async function call<T = any>(op: string, payload: Record<string, any> = {}): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/aml-client-portal`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      ...portalSessionHeaders(),
    },
    // NOT `credentials: 'include'`: `aml-client-portal` answers with a wildcard
    // `Access-Control-Allow-Origin`, which is invalid for a credentialed request
    // — the browser would block the response. The session rides the
    // `x-portal-session-token` header instead.
    body: JSON.stringify({ op, ...payload, ...portalSessionBodyFields() }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    // The server's `code` is the machine-readable half of the refusal
    // (`manual_verification_required`, `attempts_exhausted`, …). Dropping it
    // left callers matching on prose, so a provider-readiness refusal was
    // indistinguishable from a capture failure and the client was told to try
    // again against a provider that could never serve them.
    const err = new Error(json?.error || `HTTP ${res.status}`) as Error & {
      code?: string; status?: number;
    };
    err.code = typeof json?.code === 'string' ? json.code : undefined;
    err.status = res.status;
    throw err;
  }
  return json as T;
}

export type AmlSection =
  | 'purchasing_structure' | 'personal_details' | 'purchase_profile' | 'funding'
  // Phase 5 — conditional sections; the server decides which apply per case.
  | 'entity_details' | 'related_parties'
  // Screening declaration step, rendered by `SanctionsScreeningForm`.
  | 'sanctions_screening';

/**
 * Where the client is, as the SERVER says — the one canonical journey.
 *
 * `aml-client-portal` has derived this since Stage 22 and the browser had
 * never had a type for it, so every consumer read `overview.sections` instead
 * and inferred the rest. That is why the stepper could only ever turn
 * questionnaire steps green: consent, documents, identity and submission carry
 * no `section`, so nothing client-side could see them complete.
 *
 * Nothing here is internal AML state. Each entry is a machine key, a
 * presentation-neutral status, and two strings written to be read by the
 * customer — no score, no threshold, no provider, no reviewer.
 */
export type AmlPortalJourneyStatus =
  | 'complete'
  | 'in_progress'
  | 'action_required'
  | 'not_started'
  | 'blocked';

export interface AmlPortalJourneyStep {
  /** `consent | questionnaire | documents | verification | submission | review` */
  step: string;
  status: AmlPortalJourneyStatus;
  action_required: boolean;
  safe_label: string;
  safe_description: string;
  /** The portal step that answers this one. */
  target_step: string;
  completed_at?: string | null;
}

export interface AmlPortalOverview {
  case: {
    id: string; reference: string; subject: string;
    opened_at: string;
    /** Portal-safe status token (Phase 1 contract) — never the internal case state. */
    status: string; portal_status?: string;
    status_label: string;
    status_tone: 'neutral'|'progress'|'positive'|'caution';
  } | null;
  message?: string;
  /** Phase 5 — versioned conditional engine metadata (server-driven). */
  questionnaire_version?: string;
  structure_type?: string | null;
  sections?: { section: AmlSection; status: string; updated_at: string | null }[];
  requirements?: any[];
  requirement_progress?: { completed: number; total: number };
  open_requests?: any[];
  recent_submissions?: any[];
  /** Server-owned consent gate — the stepper mirrors this, never a local flag. */
  consent?: AmlConsentState;
  /**
   * The canonical journey. Optional only because an older deployed function
   * may not send it; every read site degrades to "not started" rather than
   * inventing a completion the server did not state.
   */
  journey?: AmlPortalJourneyStep[];
}

/** Acceptance state for the current AUSTRAC-referenced consent catalogue. */
export interface AmlConsentState {
  version: string | null;
  satisfied: boolean;
  outstanding: string[];
  required_count?: number;
}

/** Portal-safe verification view — deliberately carries no score or threshold. */
export interface AmlVerificationParty {
  party_id: string | null;
  label: string;
  status: 'not_started' | 'in_review' | 'verified' | 'action_required' | 'contact_adviser';
  attempts_used: number;
  attempts_remaining: number;
  can_attempt: boolean;
  /**
   * The last capture could not be examined — no face found, or too blurred.
   * It consumed no attempt, and the client needs to be asked for a new photo
   * rather than left waiting on a review that is not happening.
   */
  retake_required?: boolean;
  /**
   * A secure identity check is already open for this party, server-side.
   *
   * Survives a page refresh, which nothing in the browser does: the window
   * handle and the session URL are gone the moment the page reloads, so
   * without this the client is offered "Start" while their verification
   * window is still open behind the browser.
   *
   * A boolean and nothing else — no session, no URL, no provider — so it can
   * change which sentence is shown and nothing more. It is NOT a status:
   * an open check is neither a pass nor a failure.
   */
  verification_in_progress?: boolean;
}

export interface AmlVerificationStatus {
  enabled: boolean;
  max_attempts: number;
  biometric_consent_accepted: boolean;
  /**
   * Whether electronic capture may proceed at all. The server has always sent
   * this and the step ignored it, so a client whose case had no live provider
   * was offered "Start", allowed to photograph their face, and refused at the
   * upload URL. Client-safe by construction — never a provider name.
   */
  availability?: 'available' | 'temporarily_unavailable' | 'manual_verification_required';
  /**
   * Which verification experience to render, decided server-side.
   *
   * `capture` — NPC's own camera flow, uploading to NPC storage.
   * `hosted`  — the provider runs the capture on its own UI, embedded here.
   *
   * Deliberately two words and no more. The portal never learns which provider
   * is configured, and cannot ask for one: sending a provider name from the
   * browser would be a client selecting its own authority. Absent on an older
   * server, which is why it defaults to `capture` at every read site.
   */
  provider_flow?: 'capture' | 'hosted';
  parties: AmlVerificationParty[];
}

export interface AmlConsentDocument {
  code: string;
  title: string;
  summary: string;
  body: string;
  /** `consent` must be agreed to; `notice` must be acknowledged as read. */
  acknowledgement_type: 'consent' | 'notice';
  statutory_basis: string[];
  reference_links: { label: string; url: string }[];
  required: boolean;
  accepted_at: string | null;
}

/**
 * An uploaded document, as the portal is allowed to see it.
 *
 * This mirrors the `list_documents` projection exactly, and the omissions are
 * the point: there is no `storage_path`, no bucket, no checksum, no uploader
 * id and no reviewer. The client cannot construct a storage URL because it is
 * never given the pieces — opening a document goes back through the server,
 * which re-checks that the case is theirs.
 *
 * `rejection_reason` is the one staff-authored string that crosses: it is
 * written specifically to tell the customer what to send instead, and a
 * rejection with no reason is worse than useless to them.
 */
export interface AmlPortalDocument {
  id: string;
  /** Null for an upload the client made outside any requirement. */
  requirement_id: string | null;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  /** `uploaded | accepted | rejected | superseded`. `deleted` never arrives. */
  status: string;
  uploaded_at: string;
  rejection_reason: string | null;
}

export const amlPortalApi = {
  overview: (case_id?: string) => call<AmlPortalOverview>('overview', { case_id }),
  getQuestionnaire: (case_id: string, section: AmlSection) =>
    call<{ response: any }>('get_questionnaire', { case_id, section }),
  saveQuestionnaire: (case_id: string, section: AmlSection, payload: Record<string, any>, submit = false) =>
    call<{ response: any }>('save_questionnaire', { case_id, section, payload, submit }),
  /** Identity-verification state per party (portal-safe: no scores). */
  verificationStatus: (case_id: string) =>
    call<AmlVerificationStatus>('verification_status', { case_id }),
  /** Signed upload URL. Selfies are routed to the biometrics bucket. */
  requestVerificationUpload: (case_id: string, kind: 'document' | 'selfie') =>
    call<{ upload_url: string; token: string; path: string; bucket: string }>(
      'request_verification_upload_url', { case_id, kind }),
  /**
   * Create (or resume) the provider-hosted verification session.
   *
   * Returns a URL and nothing else that matters — no provider name, no
   * workflow id, no session token of NPC's own, no threshold and no key. The
   * URL is handed straight to `window.location.replace` on a window this
   * bundle opened, and is never stored: it embeds the customer's session token,
   * so writing it to storage would leave a live credential on the device.
   *
   * `resumed: true` means the customer already had a session and is being
   * returned to it rather than being given a second one. That distinction is
   * the customer-visible half of the duplicate-charge protection — the
   * authoritative half is the server's, which refuses to mint a second session
   * while one is in flight and refuses outright once a party is verified.
   *
   * Creating a session is NOT a verification and never marks anybody verified.
   * The outcome arrives only on a signed webhook, is re-read server-to-server
   * before it settles anything, and reaches this bundle only as the same
   * portal-safe status every other surface reads.
   */
  startHostedVerification: (case_id: string, params: {
    party_id?: string | null; party_label?: string;
    document_type?: string | null;
  } = {}) => call<{
    started: boolean; resumed?: boolean; verification_url?: string;
    message?: string; code?: string;
  }>('start_hosted_verification', { case_id, ...params }),
  submitVerification: (case_id: string, params: {
    party_id?: string | null; party_label?: string;
    document_storage_path: string; selfie_storage_path: string;
  }) => call<{
    submitted: boolean; attempt_number: number; attempts_remaining: number;
    status: string; message: string;
  }>('submit_verification', { case_id, ...params }),

  /**
   * Prepare an identity attempt before the camera opens.
   *
   * One call, and it is the gate: the server checks the session, the case, the
   * party, both consents, provider readiness, the attempt ceiling and
   * one-in-flight BEFORE it hands back anywhere to write. If it refuses, no
   * photograph has been taken and nothing exists to clean up — which is the
   * whole reason this replaced the two separate upload-grant calls, where the
   * gate sat on the second one and the first had already written a customer's
   * identity document to storage.
   *
   * Preparing costs nothing. It creates a draft, not an attempt: the customer
   * can prepare, look at the camera, change their mind and come back with all
   * three attempts intact, as many times as they like.
   *
   * What comes back carries no provider name, no endpoint, no threshold and no
   * key. The browser learns which photographs to take and where to put them,
   * and those places were named by the server — it never chooses a storage
   * path, which is what makes "name somebody else's object" not a thing that
   * can be attempted.
   */
  prepareVerificationAttempt: (case_id: string, params: {
    party_id?: string | null; party_label?: string;
    document_type: IdentityDocumentChoice;
  }) => call<{
    attempt_id: string;
    required: IdentityCapturePlan;
    uploads: Partial<Record<IdentityCaptureKind, { upload_url: string; token: string }>>;
    attempts_remaining: number;
    max_attempts: number;
  }>('prepare_verification_attempt', { case_id, ...params }),

  /**
   * Submit a prepared attempt once every required photograph is uploaded.
   *
   * Sends an attempt id and nothing else — no storage path, no provider, no
   * status, no score, no threshold. Every one of those is server-owned, and
   * there is no field here through which a browser could assert one.
   *
   * Returns as soon as the submission is durable. The three provider checks run
   * behind it, so the customer may close the tab: the result is read back from
   * `verificationStatus`, which is the server's answer and never this one.
   */
  submitVerificationAttempt: (case_id: string, attempt_id: string) => call<{
    submitted: boolean; attempt_id: string; attempt_number: number;
    attempts_remaining: number; status: string; message: string;
    code?: string; retake?: IdentityCaptureKind[];
  }>('submit_verification_attempt', { case_id, attempt_id }),

  /** Current consent catalogue + what this case has already accepted. */
  getConsents: (case_id: string) =>
    call<AmlConsentState & { documents: AmlConsentDocument[] }>('get_consents', { case_id }),
  /** `version` is optional — the server pins the acceptance to the live revision. */
  recordConsent: (case_id: string, kind: string, version?: string, payload: Record<string, any> = {}) =>
    call<{ consent: any; consent_state: AmlConsentState }>(
      'record_consent', { case_id, kind, version, payload, accepted: true }),
  listRequirements: (case_id: string) => call<{ requirements: any[] }>('list_requirements', { case_id }),
  requestUploadUrl: (case_id: string, params: {
    filename: string; mime_type: string; size_bytes: number; requirement_id?: string | null;
  }) => call<{ upload_url: string; token: string; path: string }>('request_upload_url', { case_id, ...params }),
  confirmUpload: (case_id: string, params: {
    storage_path: string; filename: string; mime_type: string; size_bytes: number;
    requirement_id?: string | null; checksum?: string;
  }) => call<{ document: any }>('confirm_upload', { case_id, ...params }),
  /**
   * Every document this case holds, newest first, minus deleted ones.
   *
   * The canonical list and the only one — the portal does not keep a second
   * copy of what has been uploaded, so what the customer sees is what the
   * server has.
   */
  listDocuments: (case_id: string) =>
    call<{ documents: AmlPortalDocument[] }>('list_documents', { case_id }),
  /**
   * A short-lived link to one of this case's own documents.
   *
   * Both ids are sent and both are checked: the case must belong to this
   * portal session and the document must belong to that case. A document id
   * alone reaches nothing — that is what stops one client opening another's
   * file by guessing an id.
   *
   * The URL it returns is a credential with a deadline. It is handed straight
   * to the browser and never stored, logged, or put in analytics.
   */
  documentUrl: (case_id: string, document_id: string) =>
    call<{ url: string; filename: string }>('get_document_url', { case_id, document_id }),
  listRequests: (case_id: string) => call<{ requests: any[] }>('list_client_requests', { case_id }),
  respondRequest: (request_id: string, response_payload: Record<string, any>) =>
    call<{ request: any }>('respond_client_request', { request_id, response_payload }),
  submitForReview: (case_id: string) => call<{ submission: any }>('submit_for_review', { case_id }),

  /**
   * The client's own Compliance Passport — a dedicated server-side sanitised
   * projection (never the staff payload trimmed client-side). Flag-gated
   * server-side (`aml_passport_client_view` → 404 `passport_disabled` when
   * off); `passport: null` means no case exists yet.
   */
  getPassport: (case_id?: string) =>
    call<{ passport: import('./passport').PassportView | null }>('get_passport', case_id ? { case_id } : {}),
};

/** Upload a File via signed URL then confirm on the server. */
export async function uploadAmlDocument(caseId: string, file: File, requirementId: string | null = null) {
  const meta = await amlPortalApi.requestUploadUrl(caseId, {
    filename: file.name, mime_type: file.type || 'application/octet-stream', size_bytes: file.size,
    requirement_id: requirementId,
  });
  const put = await fetch(meta.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!put.ok) throw new Error(`Upload failed: ${put.status}`);
  return amlPortalApi.confirmUpload(caseId, {
    storage_path: meta.path, filename: file.name,
    mime_type: file.type || 'application/octet-stream', size_bytes: file.size,
    requirement_id: requirementId,
  });
}
