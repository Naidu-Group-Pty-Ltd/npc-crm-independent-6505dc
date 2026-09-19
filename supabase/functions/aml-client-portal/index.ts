/**
 * AML/CTF Client Portal (Phase 3)
 *
 * Client-facing onboarding surface. Authenticates via `x-portal-session-token`
 * against `client_portal_sessions` and only ever operates on AML cases whose
 * `client_id` matches the signed-in portal user.
 *
 * Ops:
 *   - overview                     { case_id? }         → landing payload
 *   - get_questionnaire            { case_id, section } → current draft
 *   - save_questionnaire           { case_id, section, payload, submit? }
 *   - get_consents                 { case_id }          → current AUSTRAC-referenced catalogue + acceptance state
 *   - record_consent               { case_id, kind, version?, payload? }
 *   - verification_status          { case_id }          → per-party state + which flow to render
 *   - start_hosted_verification    { case_id, party_id?, party_label? }
 *                                                      → provider-hosted session URL (never stored)
 *   - submit_verification          { case_id, ... }     → self-hosted capture path only
 *   - list_requirements            { case_id }
 *   - request_upload_url           { case_id, requirement_id?, filename, mime_type, size_bytes }
 *   - confirm_upload               { case_id, requirement_id?, storage_path, filename, display_name?, mime_type, size_bytes, checksum? }
 *   - list_documents               { case_id }
 *   - get_document_url             { case_id, document_id }
 *                                                      → 120s signed read URL (never stored)
 *   - list_client_requests         { case_id }
 *   - respond_client_request       { request_id, response_payload }
 *   - submit_for_review            { case_id }         → creates submission_versions row
 *
 * Client statuses returned are sanitised — no risk score, no screening results,
 * no MLRO commentary. Only completion + acceptance state.
 */
import { createClient } from "npm:@supabase/supabase-js@2.55.0";
import {
  normaliseQuestionnaireSection, validateQuestionnaireSection,
} from "./questionnaireValidation.ts";
import {
  getIdvProvider,
  getHostedIdvProvider,
  getStandaloneIdvProvider,
  isStandaloneIdvProvider,
  idvFlowFor,
  diditWorkflowId,
  workflowRevisedAt,
  resolveTenantProvider,
  cachedSelfHostedIdvHealth,
  currentEnvironment,
  ProviderResolutionError,
  type IdvFlow,
} from "../_shared/aml/providers/index.ts";
import { callInternalFunction } from "../_shared/internalCall.ts";
import { projectParty } from "../_shared/aml/verificationParties.pure.ts";
// Staff-generated submission records live in `aml.documents` beside the
// client's own files but are never theirs to see: they carry screening
// states and risk readings (a tipping-off hazard). Both the listing and the
// signing op below refuse rows carrying this mark; clients cannot write
// `metadata`, so the mark cannot be forged from this side.
import { SUBMISSION_RECORD_DOCUMENT_KIND } from "../_shared/aml/submissionRecord.pure.ts";
import {
  CLIENT_ACTION_CODES as SHARED_CLIENT_ACTION_CODES,
  QUESTIONNAIRE_SECTION_CODES,
  sanitiseActionCode,
  sanitiseActionTarget,
} from "../_shared/aml/clientRequestContract.pure.ts";
import { buildPassportView } from "../_shared/aml/passport/passportView.pure.ts";
import { buildClientStampInput } from "../_shared/aml/passport/passportStamps.pure.ts";
// The journey is the one canonical statement of where a client is, and four
// portal surfaces render it. It lives in a pure module so it is testable
// without a database — see the header there for the documents defect that
// hiding it in this file concealed.
import {
  buildJourney, documentsJourneyStatus, submissionBlockers, verificationJourneyStatus,
} from "../_shared/aml/portalJourney.pure.ts";
// What a submitted section must have removed before it is stored — the
// declared purchasing structure's entity-only fields, and the detail only a
// declared exposure can carry. Both live at the write boundary so the fields
// on screen and the keys in the stored payload cannot disagree.
import {
  buildVendorData, isStaleHostedSession,
} from "../_shared/aml/providers/didit.pure.ts";
import { DiditApiError, diditConfigured } from "../_shared/aml/providers/diditClient.ts";
import { internalError } from '../_shared/errorResponse.ts';
import { withRequestOrigin } from '../_shared/corsOrigin.ts';
import { sanitiseDocumentName } from '../_shared/aml/documentNaming.pure.ts';
import {
  applyDiditDecision, appendDiditCaseEvent, DiditCorrelationError,
} from "../_shared/aml/diditOutcome.ts";
import {
  parseDocumentChoice, identityReturnUrl, identityDocumentCapturePlan,
  type IdentityDocumentChoice, type IdentityCaptureKind,
} from "../_shared/aml/identityDocuments.pure.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-portal-session-token, x-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Phase 1 portal-safe contract (directive Appendix C.1). Internal case state
// never reaches the wire: the case is presented through the client-portal
// dimension only. Legacy statuses map onto that dimension for rows created
// before the workflow-dimension migration (mirror of
// src/lib/aml/caseDimensions.ts — keep in sync).
const PORTAL_STATUSES = [
  'not_started', 'action_required', 'in_progress', 'submitted', 'under_review',
  'additional_info_required', 'complete', 'contact_adviser',
] as const;

const LEGACY_TO_PORTAL_STATUS: Record<string, string> = {
  draft: 'not_started',
  kyc_in_progress: 'in_progress',
  kyc_complete: 'submitted',
  edd_required: 'additional_info_required',
  under_review: 'under_review',
  escalated_mlro: 'under_review',
  cleared: 'complete',
  blocked: 'contact_adviser',
  closed: 'complete',
};

const PORTAL_STATUS_PRESENTATION: Record<string, { label: string; tone: 'neutral'|'progress'|'positive'|'caution' }> = {
  not_started:              { label: 'Not started',                     tone: 'neutral'  },
  action_required:          { label: 'Action required',                 tone: 'caution'  },
  in_progress:              { label: 'In progress',                     tone: 'progress' },
  submitted:                { label: 'Received — under review',         tone: 'progress' },
  under_review:             { label: 'Under review',                    tone: 'progress' },
  additional_info_required: { label: 'Additional information required', tone: 'caution'  },
  complete:                 { label: 'Complete',                        tone: 'positive' },
  contact_adviser:          { label: 'Please contact your adviser',     tone: 'caution'  },
};

function portalStatusFor(caseRow: any): string {
  const explicit = caseRow?.client_portal_status;
  if (typeof explicit === 'string' && (PORTAL_STATUSES as readonly string[]).includes(explicit)) {
    return explicit;
  }
  return LEGACY_TO_PORTAL_STATUS[caseRow?.status] ?? 'in_progress';
}

// Phase 5 — versioned conditional questionnaire engine (directive §14.2).
// The section list is SERVER-DRIVEN: `overview` computes the applicable
// sections for this case from the declared purchasing structure and funding
// sources, and the portal renders whatever the server returns. Existing
// version-1 submissions (the four base sections) remain valid unchanged.
import {
  applicableQuestionnaireSections,
} from "../_shared/aml/questionnaireSections.pure.ts";
import {
  backfillStampFor, captureObjectsFor,
} from "../_shared/aml/passport/identityPortrait.pure.ts";
import { attachPortraitUrls } from "../_shared/aml/passport/attachPortraitUrls.ts";

const QUESTIONNAIRE_VERSION = '2';

const BASE_SECTIONS = ['purchasing_structure', 'personal_details', 'purchase_profile', 'funding'] as const;
const CONDITIONAL_SECTIONS = ['entity_details', 'related_parties'] as const;
/** The full section vocabulary is the shared contract's — the same list a
 *  request's `section_code` is validated against, so a section this function
 *  will accept a write for is exactly a section a request may route to. */
const ALL_SECTIONS: readonly string[] = QUESTIONNAIRE_SECTION_CODES;


const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

/**
 * Content types a document may be served INLINE under — everything else is
 * served as an attachment.
 *
 * `request_upload_url` does not constrain what is stored, and the storage
 * origin is the same host as this API, so a document served inline under a
 * scriptable type would execute there. That is why every document used to be
 * served `Content-Disposition: attachment` — safe, and the reason a customer
 * pressing "View" on their own PDF got a download instead of a document.
 *
 * The list is therefore the whole of the security argument, and it is a
 * closed one: three formats the portal actually accepts (PDF, JPEG, PNG) plus
 * the two other raster types a browser may be handed, and nothing that can
 * carry script. `image/svg+xml` is the trap — it matches the upload control's
 * `image/*` and it is a document with a script element in it, so it is an
 * image everywhere except here. `text/html` is absent for the same reason.
 *
 * `application/octet-stream` is absent for a second one. Storage answers a
 * signed object with no `X-Content-Type-Options` header — measured, not
 * assumed — so the declared type is load-bearing: a browser honours
 * `application/pdf` and `image/png` and will not sniff past them, but it does
 * sniff a generic or absent type, which is precisely the set left out here.
 *
 * Lower-cased and stripped of any `; charset=` before it is consulted.
 */
const INLINE_VIEWABLE_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  // Not a registered type, but a non-browser uploader can declare it and a
  // browser renders it as JPEG either way.
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function sanitiseFilename(name: string): string {
  return String(name || 'upload').replace(/[^\w.\-]+/g, '_').slice(0, 180);
}

/* ───────────────────────── Consent (AUSTRAC-referenced) ─────────────────────
 * Consent used to be three hard-coded checkboxes gated by localStorage, which
 * is not evidence: nothing recorded what the client was actually shown, and
 * the gate could be stepped around client-side. The catalogue in
 * aml.consent_documents is now the single source of truth, and the gate below
 * is enforced on the server for every op that collects client data.
 *
 * If the catalogue table is unreachable we FAIL CLOSED — a portal that
 * silently collects identity data without a recorded consent is worse than
 * one that is briefly unavailable.
 * ------------------------------------------------------------------------- */

type ConsentDocument = {
  id: string;
  code: string;
  version: string;
  acknowledgement_type: 'consent' | 'notice';
  title: string;
  summary: string;
  body: string;
  statutory_basis: string[];
  reference_links: Array<{ label: string; url: string }>;
  required: boolean;
  sort_order: number;
};

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Text the acceptance hash is taken over — the exact wording presented. */
function consentCanonicalText(doc: ConsentDocument): string {
  return [doc.code, doc.version, doc.title, doc.summary, doc.body,
    (doc.statutory_basis ?? []).join('|')].join('\n');
}

/** Current (non-retired, in-force) catalogue, ordered for presentation. */
async function loadConsentCatalogue(admin: any): Promise<{ version: string | null; documents: ConsentDocument[] }> {
  const { data, error } = await admin.schema('aml').from('consent_documents')
    .select('*')
    .is('retired_at', null)
    .lte('effective_from', new Date().toISOString())
    .order('version', { ascending: false })
    .order('sort_order', { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as ConsentDocument[];
  if (rows.length === 0) return { version: null, documents: [] };
  // Highest in-force version wins; a partially-published newer version never
  // mixes with an older one.
  const version = rows[0].version;
  return {
    version,
    documents: rows.filter((r) => r.version === version)
      .sort((a, b) => a.sort_order - b.sort_order),
  };
}

type ConsentState = {
  version: string | null;
  documents: ConsentDocument[];
  accepted: Array<{ code: string; version: string; accepted_at: string }>;
  outstanding: string[];
  satisfied: boolean;
};

async function loadConsentState(admin: any, caseId: string): Promise<ConsentState> {
  const { version, documents } = await loadConsentCatalogue(admin);
  const { data: rows, error } = await admin.schema('aml').from('consents')
    .select('kind, version, accepted_at').eq('case_id', caseId);
  if (error) throw error;
  // Annotated because `admin` is `any`, so `rows` is too — leaving `accepted`
  // inferred made it `any` and the callbacks below implicitly-any, which
  // `deno check` rejects. The shape is already declared on ConsentState.
  const accepted: ConsentState['accepted'] = (rows ?? []).map((r: any) => ({
    code: String(r.kind), version: String(r.version), accepted_at: r.accepted_at,
  }));
  // Acceptance is version-specific: republishing the catalogue re-asks.
  const acceptedCurrent = new Set(
    accepted.filter((a) => a.version === version).map((a) => a.code));
  const outstanding = documents
    .filter((d) => d.required && !acceptedCurrent.has(d.code))
    .map((d) => d.code);
  return {
    version, documents, accepted, outstanding,
    // No published catalogue → nothing can be satisfied. Fail closed.
    satisfied: Boolean(version) && documents.length > 0 && outstanding.length === 0,
  };
}

/* ─────────────────────────── identity verification ──────────────────────── */

/** Owner decision of 2026-07-28: one attempt plus two retries. */
const MAX_VERIFICATION_ATTEMPTS = 3;

/**
 * How long a check may sit claimed before it stops counting as in flight.
 *
 * Comfortably longer than the provider timeout plus outbox backoff, so a
 * genuinely running check is never treated as abandoned — but finite, because
 * an unbounded "processing" row is a permanent dead end for the client.
 */
const STALE_PROCESSING_MS = 15 * 60 * 1000;

/** Closed client-action vocabulary (Stage 12) — mirrored by the CHECK
 * constraint in 20260831000100. Anything else projects as null.
 *
 * Read from the shared contract rather than restated: this list and the one
 * `aml-cases` writes with must be the same list, or a code the writer accepts
 * is a code the reader drops — which reaches the client as a request with no
 * button rather than as an error anybody sees. */
const CLIENT_ACTION_CODES: readonly string[] = SHARED_CLIENT_ACTION_CODES;

/**
 * Attempts already CONSUMED by this party on the electronic path.
 *
 * The truth is aml.verification_attempts_used(): only rows whose provider
 * examination produced an authoritative outcome (attempt_consumed) count —
 * outages, unusable captures, worker retries and simulations never do.
 * MAX(attempt_number) is kept solely as the legacy fallback for a database
 * that has not applied 20260831000000 yet, where every historical row
 * implied a consumed attempt by construction.
 */
async function verificationAttemptsUsed(
  admin: any, caseId: string, partyId: string | null,
): Promise<number> {
  const { data: counted, error: rpcError } = await admin.schema('aml')
    .rpc('verification_attempts_used', { p_case_id: caseId, p_party_id: partyId });
  if (!rpcError && typeof counted === 'number') return counted;

  // RPC unavailable (pre-migration). Count authoritative outcomes rather than
  // rows: `attempt_number` is a capture sequence, so reading it here charged a
  // client for captures the provider could not even examine.
  let q = admin.schema('aml').from('verification_checks')
    .select('status')
    .eq('case_id', caseId)
    .eq('check_type', 'electronic_idv')
    .in('status', ['passed', 'failed', 'referred', 'exhausted']);
  q = partyId ? q.eq('party_id', partyId) : q.is('party_id', null);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).length;
}

/**
 * The next per-party capture row number.
 *
 * `uq_aml_verification_attempt` is unique on
 * `(case_id, coalesce(party_id, case_id), check_type, attempt_number)`, so
 * `attempt_number` identifies a ROW, not a consumed attempt. Deriving it from
 * the consumed-attempt count meant a capture that consumed nothing — an
 * unusable capture, a provider outage, a cancelled run — left the counter at
 * its previous value, so the next capture reused the same `attempt_number`,
 * hit 23505, and the client was told "your verification is already being
 * checked" forever. A client whose first capture was unreadable could never
 * recapture. Found by the production-shaped database rehearsal.
 *
 * The customer's ALLOWANCE stays on `aml.verification_attempts_used()` — that
 * is what gates exhaustion and what `attempts_remaining` reports. This is only
 * the row sequence.
 */
async function nextCaptureSequence(
  admin: any, caseId: string, partyId: string | null,
): Promise<number> {
  let q = admin.schema('aml').from('verification_checks')
    .select('attempt_number')
    .eq('case_id', caseId)
    .eq('check_type', 'electronic_idv');
  q = partyId ? q.eq('party_id', partyId) : q.is('party_id', null);
  const { data, error } = await q.order('attempt_number', { ascending: false }).limit(1);
  if (error) throw error;
  return Number((data ?? [])[0]?.attempt_number ?? 0) + 1;
}

/* ────────────────── NPC-captured (Standalone) attempts ──────────────────── */

/**
 * Which bucket each capture belongs in.
 *
 * The selfie is separated from the document deliberately and always has been:
 * `aml-biometrics` carries the tighter access policy and the read log, because
 * a facial image is sensitive information under the Privacy Act and the two
 * documents are not the same thing. Both buckets are private; neither has ever
 * been public.
 */
const CAPTURE_BUCKET: Record<IdentityCaptureKind, string> = {
  document_front: 'aml-documents',
  document_back: 'aml-documents',
  selfie: 'aml-biometrics',
};

/**
 * The object paths for one prepared attempt.
 *
 * Generated by the server, from the attempt id, and stored on the row. The
 * browser is never asked for one and never sends one — which is what removes
 * the whole class of "name somebody else's object" from the submission. The old
 * `submit_verification` took two paths from the request body and checked they
 * began with the case id; this design has nothing to check because there is
 * nothing to supply.
 */
function capturePaths(caseId: string, attemptId: string) {
  const prefix = `${caseId}/verification/${attemptId}`;
  return {
    document_front: { bucket: CAPTURE_BUCKET.document_front, path: `${prefix}/document-front.jpg` },
    document_back: { bucket: CAPTURE_BUCKET.document_back, path: `${prefix}/document-back.jpg` },
    selfie: { bucket: CAPTURE_BUCKET.selfie, path: `${prefix}/selfie.jpg` },
  };
}

/** MIME types a capture may be stored under. Everything is re-encoded to JPEG. */
const ACCEPTED_CAPTURE_MIME = ['image/jpeg', 'image/jpg'];
/** Below this an object is not a photograph — an empty or truncated upload. */
const MIN_CAPTURE_BYTES = 2_048;
/**
 * Above this the provider refuses it anyway: the ID endpoint caps at 10 MB and
 * the face endpoints at 5 MB. The browser downscales to 2000px before upload,
 * so anything near this is a client that did not.
 */
const MAX_CAPTURE_BYTES = 5 * 1024 * 1024;

/**
 * The prepared-but-unsubmitted attempt for this party, if there is one.
 *
 * At most one exists — `uq_aml_verification_draft_capture` enforces it — so a
 * refresh, a second tab and a double tap all resume the same attempt and the
 * same three storage paths rather than accumulating drafts.
 */
async function draftCaptureAttempt(
  admin: any, caseId: string, partyId: string | null,
): Promise<any | null> {
  let q = admin.schema('aml').from('verification_checks')
    .select('id, case_id, party_id, party_label, outcome_detail, capture_sequence, '
      + 'processing_status, biometric_consent_id')
    .eq('case_id', caseId)
    .eq('check_type', 'electronic_idv')
    .eq('processing_status', 'draft')
    .is('superseded_at', null);
  q = partyId ? q.eq('party_id', partyId) : q.is('party_id', null);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(1);
  if (error) {
    // Pre-migration database: no `draft` state exists, so no draft can.
    if (/processing_status|draft/i.test(error.message ?? '')) return null;
    throw error;
  }
  return (data ?? [])[0] ?? null;
}

/**
 * Confirm an object the server told the browser to write actually exists, and
 * is plausibly the photograph it was supposed to be.
 *
 * Reads size and content type from storage metadata rather than trusting
 * anything the client said about them — the client says nothing about them.
 */
async function inspectCapture(
  admin: any, bucket: string, path: string,
): Promise<{ present: boolean; size: number; mime: string | null }> {
  const slash = path.lastIndexOf('/');
  const dir = slash > -1 ? path.slice(0, slash) : '';
  const name = slash > -1 ? path.slice(slash + 1) : path;
  const { data, error } = await admin.storage.from(bucket)
    .list(dir, { search: name, limit: 100 });
  if (error) return { present: false, size: 0, mime: null };
  const found = (data ?? []).find((entry: any) => entry?.name === name);
  if (!found) return { present: false, size: 0, mime: null };
  return {
    present: true,
    size: Number(found?.metadata?.size ?? 0),
    mime: typeof found?.metadata?.mimetype === 'string' ? found.metadata.mimetype : null,
  };
}

/**
 * An in-flight electronic check for this party (submitted/queued/processing/
 * retry_scheduled). A second submission while one is processing would burn
 * provider work and confuse the journey — the portal refuses it safely.
 */
async function activeProcessingCheck(
  admin: any, caseId: string, partyId: string | null,
): Promise<{ id: string; processing_status: string } | null> {
  let q = admin.schema('aml').from('verification_checks')
    .select('id, processing_status, processing_started_at, created_at')
    .eq('case_id', caseId)
    .eq('check_type', 'electronic_idv')
    .in('processing_status', ['submitted', 'queued', 'processing', 'retry_scheduled'])
    // A claim the worker never finished — an edge function killed mid-provider
    // call leaves `processing` set forever. Without a bound that row blocked
    // both resubmission and the selfie upload URL permanently, with no path
    // back for the client. The outbox retries and dead-letters the event
    // itself, so treating a long-stale claim as not-in-flight cannot lose one.
    .gte('created_at', new Date(Date.now() - STALE_PROCESSING_MS).toISOString());
  q = partyId ? q.eq('party_id', partyId) : q.is('party_id', null);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(1);
  if (error) {
    // Legacy schema without processing_status: nothing can be "in flight".
    if (/processing_status/i.test(error.message ?? '')) return null;
    throw error;
  }
  return (data ?? [])[0] ?? null;
}

/**
 * Client-safe electronic-IDV availability. Internal readiness (provider keys,
 * environment classification, secret presence) NEVER crosses this boundary —
 * the portal learns only whether capture may proceed.
 */
/**
 * The in-flight hosted-session check for this party, if any.
 *
 * Deliberately has NO staleness bound, unlike `activeProcessingCheck`. A
 * hosted session lives for days, so timing one out would offer a second
 * (chargeable) session to a customer who still has one open. Release is by
 * reconciliation instead: the caller asks the provider what actually happened
 * to the session and retires it only on a real expiry or abandonment.
 */
async function activeHostedCheck(
  admin: any, caseId: string, partyId: string | null,
): Promise<any | null> {
  let q = admin.schema('aml').from('verification_checks')
    .select('id, case_id, party_id, party_label, provider, provider_reference, '
      + 'outcome_detail, processing_status, status, attempt_consumed, '
      // `capture_sequence` is the attempt encoded in vendor_data, and
      // `created_at` is what the stale-workflow guard compares.
      + 'capture_sequence, created_at')
    .eq('case_id', caseId)
    .eq('check_type', 'electronic_idv')
    .eq('provider', 'didit')
    .in('processing_status', ['submitted', 'queued', 'processing'])
    .is('superseded_at', null);
  q = partyId ? q.eq('party_id', partyId) : q.is('party_id', null);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(1);
  if (error) throw error;
  const row = (data ?? [])[0] ?? null;
  // A row whose session creation never completed holds no session to resume.
  return row?.provider_reference ? row : null;
}

/**
 * Retire a hosted check without touching identity state.
 *
 * `status` and `attempt_consumed` are left alone on purpose: releasing a
 * session the customer never finished is housekeeping, not a finding against
 * them. The guard on `attempt_consumed` makes it impossible to retire a check
 * that already produced an outcome.
 */
async function releaseHostedCheck(
  admin: any, checkId: string, reason: string,
): Promise<void> {
  await admin.schema('aml').from('verification_checks').update({
    processing_status: 'cancelled',
    superseded_at: new Date().toISOString(),
    superseded_reason: reason.slice(0, 200),
    updated_at: new Date().toISOString(),
  })
    .eq('id', checkId)
    .eq('attempt_consumed', false)
    .in('processing_status', ['submitted', 'queued', 'processing']);
}

/**
 * The origin the customer is returned to when the hosted flow finishes.
 *
 * Compiled in, with `PUBLIC_APP_URL` as the deployment override — the same
 * pair `consentLinkFor` uses. Deliberately NOT the request's `Origin` header:
 * this string is handed to the provider as a redirect target, so accepting one
 * from the caller would let any origin that can reach this function have NPC
 * mint a redirect to it and hand it to a customer mid-verification.
 */
const RETURN_ORIGIN_FALLBACK = 'https://command-centre.npcservices.com.au';

function hostedReturnUrl(): string {
  return identityReturnUrl(Deno.env.get('PUBLIC_APP_URL'), RETURN_ORIGIN_FALLBACK);
}

/**
 * The document choice a hosted session was minted under, if it recorded one.
 *
 * Sessions created before document selection existed have none, and are
 * reusable for any choice — they were minted with no document restriction at
 * all, so the provider still offers the customer every supported document.
 */
function sessionDocumentChoice(check: any): IdentityDocumentChoice | null {
  return parseDocumentChoice(check?.outcome_detail?.didit_session?.document_choice);
}

type IdvAvailability = 'available' | 'temporarily_unavailable' | 'manual_verification_required';

/**
 * Availability AND which of the two experiences to render, resolved together.
 *
 * The flow is server-decided and the browser is told only `capture` or
 * `hosted` — never the provider key, never the workflow id, never whether a
 * secret is present. A client that could name the provider could reason about
 * NPC's configuration; one that could choose it would be selecting its own
 * authority.
 */
async function clientSafeIdvState(
  admin: any,
): Promise<{ availability: IdvAvailability; flow: IdvFlow; standalone: boolean }> {
  let flow: IdvFlow = 'capture';
  let standalone = false;
  try {
    const resolved = await resolveTenantProvider(admin, 'default', 'idv');
    flow = idvFlowFor(resolved?.providerKey);
    standalone = isStandaloneIdvProvider(resolved?.providerKey);

    if (standalone) {
      /**
       * Construction is the readiness check, and it is the whole check.
       *
       * `getStandaloneIdvProvider` throws unless the credential AND both
       * decline thresholds are present and in range, so a deployment that has
       * not stated its liveness and face-match policy reads as unavailable
       * rather than quietly inheriting the provider's own permissive default.
       *
       * Deliberately no network probe. The Standalone endpoints are billed per
       * call and have no free health route — probing one on every portal page
       * load would charge NPC for the privilege of drawing a page. Nothing is
       * collected from the customer until this has already passed.
       */
      getStandaloneIdvProvider({ resolved, admin });
      return { availability: 'available', flow, standalone };
    }

    /**
     * The hosted session is available again, and it is a deliberate reversal.
     *
     * It was refused here — `manual_verification_required` — as the third lock
     * of the standalone cutover, whose product decision was that no customer is
     * sent to a verification vendor's page. **That decision stands**, and no
     * tenant resolves this branch: `didit_standalone` is the active provider.
     *
     * The branch exists rather than refusing, because provider selection is
     * configuration and a tenant that is genuinely on a hosted provider must
     * get a working journey rather than a dead end. The provider-side audit
     * record the business wanted comes from `save_api_request=true` on the
     * Standalone calls instead (Manual Checks), which needed no change of
     * customer experience — see docs/aml/DIDIT_STANDALONE_IDV.md.
     *
     * Readiness is the adapter's own: `getHostedIdvProvider` resolves the
     * credential, and `diditConfigured` requires the webhook secret and a
     * workflow id as well — a deployment holding only the API key would create
     * chargeable sessions whose results could never be accepted.
     */
    if (flow === 'hosted_session') {
      getHostedIdvProvider({ resolved, admin });
      if (!diditConfigured(diditWorkflowId(resolved))) {
        return { availability: 'temporarily_unavailable', flow, standalone };
      }
      return { availability: 'available', flow, standalone };
    }

    const provider = getIdvProvider({ resolved, admin });

    // Resolution only proves the provider is *configured*. Two secrets can
    // point at a dead container, and offering a camera against one collects a
    // face with no purpose that can be served (APP 3). So the live path is
    // also probed — cached, because this runs on every portal page load.
    if (provider.name === 'selfhosted') {
      const health = await cachedSelfHostedIdvHealth();
      if (!health.reachable || health.status !== 'ok') {
        return { availability: 'temporarily_unavailable', flow, standalone };
      }
    }
    return { availability: 'available', flow, standalone };
  } catch (err: any) {
    if (err instanceof ProviderResolutionError) {
      // Not configured / simulator blocked → the adviser will arrange manual
      // sighting; transient misconfiguration reads as temporary.
      return {
        availability: err.code === 'provider_misconfigured'
          ? 'temporarily_unavailable'
          : 'manual_verification_required',
        flow,
        standalone,
      };
    }
    return { availability: 'temporarily_unavailable', flow, standalone };
  }
}

/** Back-compat shim for the call sites that only need the availability word. */
async function clientSafeIdvAvailability(admin: any): Promise<IdvAvailability> {
  return (await clientSafeIdvState(admin)).availability;
}


/**
 * Stable per-party identifier derived from the case and the declared name.
 *
 * Parties the CLIENT declared live in their questionnaire, not in the staff
 * ownership model, so they have no database id of their own. A deterministic
 * uuid keeps the attempt ceiling enforceable per party across requests
 * without inventing a row the client can see.
 */
async function derivedPartyId(caseId: string, name: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(`${caseId}|${name.trim().toLowerCase()}`));
  const h = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return [h.slice(0, 8), h.slice(8, 12), '5' + h.slice(13, 16),
    ((parseInt(h[16], 16) & 0x3 | 0x8).toString(16)) + h.slice(17, 20), h.slice(20, 32)].join('-');
}

/**
 * Parties the client still has to verify: themselves, plus anyone they
 * declared in the related-parties section of their own questionnaire.
 *
 * The staff ownership model is deliberately NOT read here. Beneficial-owner
 * records carry internal analysis (control assessments, screening state), and
 * the portal boundary is drawn at the table rather than per-field so that it
 * cannot be eroded one column at a time. Everything below comes from what the
 * client typed themselves.
 */
async function verificationParties(admin: any, caseId: string) {
  const { data: caseRow } = await admin.schema('aml').from('cases')
    .select('subject_display_name').eq('id', caseId).maybeSingle();

  const { data: sections } = await admin.schema('aml').from('questionnaire_responses')
    .select('section, payload').eq('case_id', caseId).eq('section', 'related_parties');

  const declared: string[] = [];
  const payload = (sections ?? [])[0]?.payload ?? {};
  for (const entry of (Array.isArray(payload?.parties) ? payload.parties : [])) {
    const name = String((entry as any)?.full_name ?? (entry as any)?.name ?? '').trim();
    if (name) declared.push(name.slice(0, 200));
  }

  // `attempt_consumed` and `processing_status` are what separate a customer's
  // attempt from a row. Legacy-schema retry keeps the portal readable before
  // the canonical migration is applied.
  const CHECK_COLUMNS =
    'party_id, attempt_number, status, check_type, attempt_consumed, processing_status, capture_sequence';
  let { data: checks, error: checksError } = await admin.schema('aml').from('verification_checks')
    .select(CHECK_COLUMNS).eq('case_id', caseId);
  let canonicalColumns = true;
  if (checksError) {
    if (!/attempt_consumed|processing_status|capture_sequence/i.test(checksError.message ?? '')) {
      throw checksError;
    }
    canonicalColumns = false;
    ({ data: checks } = await admin.schema('aml').from('verification_checks')
      .select('party_id, attempt_number, status, check_type').eq('case_id', caseId));
  }

  const targets: Array<{ id: string | null; label: string }> = [
    { id: null, label: String(caseRow?.subject_display_name ?? 'You') },
  ];
  for (const name of declared) {
    targets.push({ id: await derivedPartyId(caseId, name), label: name });
  }

  // Attempt accounting and status collapse live in the pure module so the
  // lockout they caused stays covered by tests rather than by inspection.
  return targets.map((t) =>
    projectParty(t, (checks ?? []) as any, MAX_VERIFICATION_ATTEMPTS, canonicalColumns));
}

function consentRequiredResponse(state: ConsentState) {
  return jsonResponse({
    error: state.version
      ? 'Please review and accept the consents and disclosures before continuing.'
      : 'Consents and disclosures are being updated. Please try again shortly or contact your adviser.',
    code: 'consent_required',
    consent: {
      version: state.version,
      outstanding: state.outstanding,
      satisfied: state.satisfied,
    },
  }, 403);
}

const __corsWrappedHandler = async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({}));
    const token = req.headers.get('x-portal-session-token') ||
      body?.portal_session_token || req.headers.get('x-session-token') ||
      body?.session_token;
    if (!token) return jsonResponse({ error: 'Portal session token required' }, 401);

    // Session lookup mirrors get-portal-client-data (the proven production
    // contract): select ONLY columns that exist on client_portal_users in
    // every environment. This function once embedded a `full_name` column the
    // production table does not have; PostgREST rejected the whole select,
    // the error object was discarded, and every op answered 401 — which the
    // portal then rendered as "no case yet". Never widen this select without
    // checking the deployed schema, and never discard the error.
    const { data: session, error: sessionError } = await admin
      .from('client_portal_sessions')
      .select('user_id, expires_at, revoked_at, client_portal_users:user_id(id, client_id, email, status)')
      .eq('session_token', token)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (sessionError) {
      console.error('aml-client-portal session lookup failed', sessionError.message);
      return jsonResponse({
        error: 'We could not confirm your session. Please sign in again.',
        code: 'portal_session_lookup_failed',
      }, 401);
    }

    const portalUser = (session as any)?.client_portal_users;
    if (!portalUser || portalUser.status !== 'active' || (session as any)?.revoked_at) {
      return jsonResponse({
        error: 'Invalid or expired session',
        code: 'portal_session_invalid',
      }, 401);
    }
    const clientId: string = portalUser.client_id;
    const portalUserId: string = portalUser.id;
    const actorLabel: string = portalUser.email || 'client-portal';

    const op = String(body?.op ?? '');
    if (!op) return jsonResponse({ error: 'op is required' }, 400);

    // Resolve target case scoped to this client.
    async function resolveCase(caseId?: string) {
      let q = admin.schema('aml').from('cases').select('*').eq('client_id', clientId);
      if (caseId) q = q.eq('id', caseId);
      const { data, error } = await q.order('opened_at', { ascending: false }).limit(1);
      if (error) throw error;
      return (data ?? [])[0] ?? null;
    }

    switch (op) {
      case 'overview': {
        const c = await resolveCase(body.case_id);
        // The portal renders this string verbatim, so it must be the copy a
        // client should read — not an API status line. "No AML onboarding case
        // yet." rendered as the whole empty state and read like something had
        // gone wrong; the reassuring sentence lives here rather than in the SPA
        // so every consumer (portal, mobile) shows the same words.
        if (!c) {
          return jsonResponse({
            case: null,
            message:
              'Your adviser hasn’t opened an identity and compliance case for you yet. '
              + 'You’ll be notified when it’s ready — there is nothing for you to do now.',
          });
        }
        const [
          { data: sections }, { data: requirements }, { data: documentFacts },
          { data: openRequests }, { data: submissions },
        ] = await Promise.all([
          admin.schema('aml').from('questionnaire_responses')
            .select('section,status,updated_at,payload').eq('case_id', c.id),
          admin.schema('aml').from('document_requirements')
            .select('*').eq('case_id', c.id).order('created_at', { ascending: true }),
          // The two columns the journey needs and nothing else. A requirement
          // is a REQUEST for a document; this is the record of what arrived,
          // and without it a case with no formal requirements could never
          // complete its documents step however much the client uploaded.
          //
          // No filename, no storage path, no checksum, no uploader: none of
          // that reaches the wire, and this projection is not shipped to the
          // client at all — it is consumed here to derive one status.
          admin.schema('aml').from('documents')
            .select('requirement_id,status').eq('case_id', c.id).neq('status', 'deleted'),
          admin.schema('aml').from('client_requests')
            .select('*').eq('case_id', c.id).in('status', ['open','responded'])
            .order('created_at', { ascending: false }),
          admin.schema('aml').from('submission_versions')
            .select('version_number,status,submitted_at,reviewed_at')
            .eq('case_id', c.id).order('version_number', { ascending: false }).limit(3),
        ]);
        const reqs = requirements ?? [];
        const totalReq = reqs.filter((r: any) => r.required).length;
        const completedReq = reqs.filter((r: any) => r.required && ['uploaded','accepted'].includes(r.status)).length;
        const sectionMap = new Map((sections ?? []).map((s: any) => [s.section, s]));
        const active = applicableQuestionnaireSections(
          (name) => sectionMap.get(name)?.payload ?? null);
        const portalStatus = portalStatusFor(c);
        const presentation = PORTAL_STATUS_PRESENTATION[portalStatus] ?? { label: 'In progress', tone: 'progress' as const };
        // Server-owned consent state — the portal stepper mirrors this rather
        // than trusting a browser-local flag.
        const consentState = await loadConsentState(admin, c.id);
        return jsonResponse({
          case: {
            id: c.id, reference: c.case_reference, subject: c.subject_display_name,
            opened_at: c.opened_at,
            // Portal-safe dimension token — internal case state is not shipped.
            status: portalStatus, portal_status: portalStatus,
            status_label: presentation.label, status_tone: presentation.tone,
          },
          questionnaire_version: QUESTIONNAIRE_VERSION,
          consent: {
            version: consentState.version,
            satisfied: consentState.satisfied,
            outstanding: consentState.outstanding,
            required_count: consentState.documents.filter((d) => d.required).length,
          },
          structure_type: String(sectionMap.get('purchasing_structure')?.payload?.entity_type ?? '') || null,
          sections: active.map((s) => ({
            section: s, status: sectionMap.get(s)?.status ?? 'not_started',
            updated_at: sectionMap.get(s)?.updated_at ?? null,
          })),
          requirements: reqs.map((r: any) => ({
            id: r.id, code: r.code, label: r.label, description: r.description,
            required: r.required, status: r.status, due_at: r.due_at, assigned_to_party: r.assigned_to_party,
          })),
          requirement_progress: { completed: completedReq, total: totalReq },
          open_requests: (openRequests ?? []).map((r: any) => ({
            id: r.id, kind: r.kind, subject: r.subject, message: r.message,
            status: r.status, created_at: r.created_at,
            // Closed action vocabulary only — anything uncatalogued projects
            // as null, and routing fields are the safe whitelisted subset.
            // Arbitrary URLs from request payloads never reach the client.
            action_code: sanitiseActionCode(r.action_code),
            action_target: sanitiseActionTarget(r.action_target),
            due_at: r.due_at ?? null,
          })),
          recent_submissions: submissions ?? [],
          journey: buildJourney({
            consentSatisfied: consentState.satisfied,
            activeSections: active,
            sectionMap,
            requirements: reqs,
            documents: documentFacts ?? [],
            parties: await verificationParties(admin, c.id),
            submissions: submissions ?? [],
            // Only requests still waiting on the CLIENT. `responded` is waiting
            // on the adviser: counting it kept the journey saying "your adviser
            // has asked for something" after the client had answered.
            openRequestCount: (openRequests ?? [])
              .filter((r: any) => r.status === 'open').length,
            portalStatus,
          }),
        });
      }

      case 'get_passport': {
        // The client's own Compliance Passport — a DEDICATED server-side
        // sanitised projection built by the shared pure assembler. It is
        // never the Command payload with fields hidden client-side: the
        // restricted case families are not read by this function at all
        // (a pinned source contract enforces that), and post-issuance
        // milestone facts come from the ISSUED, SANITISED attestation
        // payload — what the MLRO attested outward is exactly what the
        // client may see. The assembler's fail-closed tripwire re-checks
        // the finished view before it ships.
        {
          const { data: flagRow } = await admin.from('feature_flags')
            .select('value').eq('key', 'aml_passport_client_view').maybeSingle();
          const fv = flagRow?.value;
          const flagOn = fv === true || fv === 'true' ||
            (fv && typeof fv === 'object' && (fv as any).enabled === true);
          if (!flagOn) {
            return jsonResponse({ error: 'The Compliance Passport is not available yet.', code: 'passport_disabled' }, 404);
          }
        }
        const c = await resolveCase(body.case_id);
        if (!c) return jsonResponse({ passport: null });

        const [
          { data: attRows }, { data: consents }, { data: checks }, { data: docs },
          { data: reqs }, { data: txns }, { data: grants },
          { data: assessments }, { data: refreshObs }, { data: requests },
          { data: personal }, { data: entity }, { data: tenant },
        ] = await Promise.all([
          admin.schema('aml').from('compliance_attestations')
            .select('id, version, issued_at, superseded_at, payload_sha256, schema_version, refresh_required_at, payload')
            .eq('case_id', c.id).order('version', { ascending: true }),
          admin.schema('aml').from('consents')
            .select('id, kind, accepted_at').eq('case_id', c.id),
          admin.schema('aml').from('verification_checks')
            /* `outcome_detail` for the one image the Passport may show — the
               face the provider extracted from the identity document. Read
               only through `identityPortrait.pure.ts`, an allow-list of one
               key: the document page and the selfie are never published. */
            .select('id, party_label, check_type, status, completed_at, outcome_detail').eq('case_id', c.id),
          admin.schema('aml').from('documents')
            .select('id, requirement_id, status, created_at, reviewed_at, version_number')
            .eq('case_id', c.id).neq('status', 'deleted'),
          admin.schema('aml').from('document_requirements')
            .select('id, code, label, required').eq('case_id', c.id),
          admin.schema('aml').from('transactions')
            .select('id, kind, status, property_address, contract_date, settlement_date, purchase_price')
            .eq('case_id', c.id).is('archived_at', null),
          admin.schema('aml').from('reliance_grants')
            .select('id, granted_at, revoked_at, attestation_id, reliance_agreements:agreement_id(partner_org_name, partner_org_type)')
            .eq('case_id', c.id),
          admin.schema('aml').from('independent_assessments')
            .select('id, status, decided_at, assessor_name, reliance_agreements:agreement_id(partner_org_name, partner_org_type)')
            .eq('case_id', c.id),
          admin.schema('aml').from('partner_refresh_obligations')
            .select('id, created_at, status, completed_at, cancelled_at, due_at').eq('case_id', c.id),
          admin.schema('aml').from('client_requests')
            .select('id, kind, subject, status, created_at').eq('case_id', c.id)
            .order('created_at', { ascending: false }),
          admin.schema('aml').from('questionnaire_responses')
            .select('payload').eq('case_id', c.id).eq('section', 'personal_details').maybeSingle(),
          admin.schema('aml').from('questionnaire_responses')
            .select('payload').eq('case_id', c.id).eq('section', 'entity_details').maybeSingle(),
          admin.schema('aml').from('tenant_settings')
            .select('display_name').eq('tenant_id', 'default').maybeSingle(),
        ]);

        const attFacts = (attRows ?? []).map((a: any) => ({
          version: a.version,
          issued_at: a.issued_at,
          superseded_at: a.superseded_at,
          payload_sha256: a.payload_sha256,
          schema_version: a.schema_version ?? 1,
        }));
        const currentAtt = (attRows ?? []).filter((a: any) => !a.superseded_at)
          .sort((a: any, b: any) => b.version - a.version)[0] ?? null;
        const versionByAttId = new Map<string, number>((attRows ?? []).map((a: any) => [a.id, a.version]));
        const reqById = new Map<string, any>((reqs ?? []).map((r: any) => [r.id, r]));
        const issuerOrg = tenant?.display_name ?? 'Your adviser';
        // Derivation inputs only — the raw case enum and gate token feed the
        // shared state derivation server-side and are never shipped; the
        // client receives the derived passport state (label + tone). The
        // local rename makes that boundary visible in the source.
        const internalCaseStatus: string | null = c.status ?? null;
        const caseFactsForDerivation = {
          id: c.id,
          case_reference: c.case_reference,
          subject_display_name: c.subject_display_name,
          subject_type: c.subject_type,
          status: internalCaseStatus,
          case_stage: c.case_stage ?? null,
          service_gate_status: c.service_gate_status ?? null,
          opened_at: c.opened_at,
          closed_at: c.closed_at ?? null,
        };

        const view = buildPassportView('client', {
          issuer_org: issuerOrg,
          officer_label: null,
          case: caseFactsForDerivation,
          attestations: attFacts,
          material_inputs_current: currentAtt
            ? (currentAtt.refresh_required_at ? false : ((currentAtt.schema_version ?? 1) === 2 ? true : null))
            : null,
          open_refresh_obligations: (refreshObs ?? []).filter((r: any) => r.status === 'open').length,
          personal_details: (personal?.payload && typeof personal.payload === 'object') ? personal.payload : null,
          entity_details: (entity?.payload && typeof entity.payload === 'object') ? entity.payload : null,
          documents: (docs ?? []).map((d: any) => ({
            id: d.id,
            requirement_label: reqById.get(d.requirement_id)?.label ?? null,
            requirement_code: reqById.get(d.requirement_id)?.code ?? null,
            required: reqById.get(d.requirement_id)?.required ?? null,
            status: d.status,
            created_at: d.created_at,
            version_number: d.version_number,
          })),
          transactions: txns ?? [],
          client_requests: requests ?? [],
          stamp_input: buildClientStampInput({
            issuer_org: issuerOrg,
            attestations: attFacts.map((a: any) => ({
              version: a.version, issued_at: a.issued_at, superseded_at: a.superseded_at,
            })),
            consents: consents ?? [],
            verification_checks: (checks ?? []).map((vc: any) => {
              /* Named fields only — `outcome_detail` is a provider payload
                 and never travels into the projection whole. */
              const sa = vc.outcome_detail?.standalone ?? {};
              return {
                id: vc.id, party_label: vc.party_label, check_type: vc.check_type,
                status: vc.status, completed_at: vc.completed_at,
                /* ONE reader, shared with the Command Centre — see
                   `captureObjectsFor`. This used to prefer the evidence
                   block's copy of the object list, which is written once and
                   never updated. */
                capture_objects: captureObjectsFor(vc.outcome_detail),
                document_choice: sa.document_choice
                  ?? vc.outcome_detail?.standalone_capture?.document_choice ?? null,
                issuing_state: sa.id_verification?.id_verification?.issuing_state ?? null,
                portrait_backfill: backfillStampFor(vc.outcome_detail),
              };
            }),
            documents: (docs ?? []).map((d: any) => ({
              status: d.status, reviewed_at: d.reviewed_at, created_at: d.created_at,
            })),
            grants: (grants ?? []).map((g: any) => ({
              id: g.id,
              created_at: g.granted_at,
              revoked_at: g.revoked_at,
              partner_org_name: g.reliance_agreements?.partner_org_name ?? null,
              partner_org_type: g.reliance_agreements?.partner_org_type ?? null,
              attestation_version: versionByAttId.get(g.attestation_id) ?? null,
            })),
            assessments: (assessments ?? []).map((a: any) => ({
              id: a.id, status: a.status, decided_at: a.decided_at, assessor_name: a.assessor_name,
              partner_org_name: a.reliance_agreements?.partner_org_name ?? null,
              partner_org_type: a.reliance_agreements?.partner_org_type ?? null,
            })),
            refresh_obligations: (refreshObs ?? []).map((r: any) => ({
              id: r.id, created_at: r.created_at, status: r.status,
              completed_at: r.completed_at ?? null,
              cancelled_at: r.cancelled_at ?? null,
              due_at: r.due_at ?? null,
            })),
            transactions: (txns ?? []).map((t: any) => ({
              id: t.id, status: t.status, settlement_date: t.settlement_date,
              property_address: t.property_address,
            })),
            attestation_payload: currentAtt?.payload ?? null,
          }),
        });

        /* The photograph is signed for THIS reader, at the moment of
           service, by the SAME function the Command Centre and the partners
           use. This was twenty inline lines that had to be corrected in step
           with their twin in `aml-reliance`; the client's Passport and the
           issuer's are the same document, and that has to be a property of
           one implementation. */
        await attachPortraitUrls(admin, view, checks ?? []);

        return jsonResponse({ passport: view });
      }

      case 'get_questionnaire': {
        const c = await resolveCase(body.case_id);
        if (!c) return jsonResponse({ error: 'No case' }, 404);
        if (!ALL_SECTIONS.includes(body.section)) return jsonResponse({ error: 'Invalid section' }, 400);
        const { data } = await admin.schema('aml').from('questionnaire_responses')
          .select('*').eq('case_id', c.id).eq('section', body.section).maybeSingle();
        return jsonResponse({ response: data ?? null });
      }

      case 'save_questionnaire': {
        const c = await resolveCase(body.case_id);
        if (!c) return jsonResponse({ error: 'No case' }, 404);
        // Consent precedes collection (Privacy Act 1988, APP 3/5). Enforced
        // here, not only in the UI stepper.
        const consentState = await loadConsentState(admin, c.id);
        if (!consentState.satisfied) return consentRequiredResponse(consentState);
        // Validated against the full catalogue (not the currently-applicable
        // subset) so an in-flight save is never rejected by a concurrent
        // structure change; superseded answers are retained, never deleted.
        if (!ALL_SECTIONS.includes(body.section)) return jsonResponse({ error: 'Invalid section' }, 400);
        const submittedPayload = body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
          ? body.payload
          : {};
        /**
         * Answers the declared structure cannot give never reach the row.
         *
         * The client drops them too, on the change that makes them
         * inapplicable — but the row is what an analyst reads and what
         * `submit_for_review` freezes into the snapshot, so the guarantee is
         * made HERE and holds for any caller. A pack declaring an Individual
         * purchaser and carrying a company name and an ABN is a purchaser
         * record that contradicts itself; this is what stops one being stored.
         */
        const payload = normaliseQuestionnaireSection(
          body.section, submittedPayload as Record<string, unknown>,
        );
        if (body.submit) {
          const { data: structureResponse } = body.section === 'entity_details'
            ? await admin.schema('aml').from('questionnaire_responses')
              .select('payload').eq('case_id', c.id).eq('section', 'purchasing_structure').maybeSingle()
            : { data: null };
          const invalidFields = validateQuestionnaireSection(
            body.section,
            payload,
            structureResponse?.payload,
          );
          if (invalidFields.length > 0) {
            return jsonResponse({
              error: 'Cannot submit — section contains invalid or missing fields',
              invalid_fields: invalidFields,
            }, 400);
          }
        }
        const row: Record<string, any> = {
          case_id: c.id, section: body.section, payload,
          status: body.submit ? 'submitted' : 'draft',
          submitted_at: body.submit ? new Date().toISOString() : null,
          submitted_by_type: 'client', submitted_by: portalUserId,
        };
        const { data, error } = await admin.schema('aml').from('questionnaire_responses')
          .upsert(row, { onConflict: 'case_id,section' }).select('*').single();
        if (error) throw error;
        return jsonResponse({ response: data });
      }

      case 'get_consents': {
        const c = await resolveCase(body.case_id);
        if (!c) return jsonResponse({ error: 'No case' }, 404);
        const state = await loadConsentState(admin, c.id);
        const acceptedAt = new Map(
          state.accepted.filter((a) => a.version === state.version).map((a) => [a.code, a.accepted_at]));
        return jsonResponse({
          version: state.version,
          satisfied: state.satisfied,
          outstanding: state.outstanding,
          documents: state.documents.map((d) => ({
            code: d.code,
            title: d.title,
            summary: d.summary,
            body: d.body,
            acknowledgement_type: d.acknowledgement_type,
            statutory_basis: d.statutory_basis ?? [],
            reference_links: d.reference_links ?? [],
            required: d.required,
            accepted_at: acceptedAt.get(d.code) ?? null,
          })),
        });
      }

      case 'record_consent': {
        const c = await resolveCase(body.case_id);
        if (!c) return jsonResponse({ error: 'No case' }, 404);
        const code = String(body.kind ?? body.code ?? '').trim();
        if (!code) return jsonResponse({ error: 'kind is required' }, 400);
        if (body.accepted === false) {
          return jsonResponse({ error: 'Acceptance is required to record a consent' }, 400);
        }

        // The acceptance must name a document that is actually published and
        // current — otherwise the record could not be tied back to wording.
        const { version, documents } = await loadConsentCatalogue(admin);
        const doc = documents.find((d) => d.code === code);
        if (!doc) {
          return jsonResponse({
            error: 'Unknown or superseded consent document', code: 'consent_document_unknown',
            current_version: version,
          }, 400);
        }
        if (body.version && String(body.version) !== doc.version) {
          return jsonResponse({
            error: 'This consent has been updated. Please reload and review the current wording.',
            code: 'consent_version_stale', current_version: doc.version,
          }, 409);
        }

        const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
        const ua = req.headers.get('user-agent') ?? null;
        // Hash of the exact text presented, so the acceptance stays meaningful
        // even if the catalogue row is later corrected or retired.
        const documentHash = await sha256Hex(consentCanonicalText(doc));
        const row = {
          case_id: c.id, kind: doc.code, version: doc.version,
          actor_type: 'client', actor_id: portalUserId, actor_label: actorLabel,
          ip_address: ip, user_agent: ua,
          document_id: doc.id, document_hash: documentHash,
          payload: {
            ...(body.payload && typeof body.payload === 'object' ? body.payload : {}),
            acknowledgement_type: doc.acknowledgement_type,
            title: doc.title,
            statutory_basis: doc.statutory_basis ?? [],
          },
        };
        let { data, error } = await admin.schema('aml').from('consents')
          .upsert(row, { onConflict: 'case_id,kind,version' }).select('*').single();
        if (error && /document_id|document_hash|no unique|constraint/i.test(error.message ?? '')) {
          // Catalogue migration not applied yet — record the acceptance rather
          // than losing it, and let the state read decide the gate.
          const { document_id: _d, document_hash: _h, ...legacy } = row as any;
          ({ data, error } = await admin.schema('aml').from('consents')
            .insert(legacy).select('*').single());
        }
        if (error) throw error;

        const state = await loadConsentState(admin, c.id);
        return jsonResponse({
          consent: data,
          consent_state: {
            version: state.version, satisfied: state.satisfied, outstanding: state.outstanding,
          },
        });
      }

      case 'verification_status': {
        const c = await resolveCase(body.case_id);
        if (!c) return jsonResponse({ parties: [], enabled: false });
        const consentState = await loadConsentState(admin, c.id);
        const parties = await verificationParties(admin, c.id);
        // Client-safe availability only — never provider names, environment
        // classification, secret presence or internal health detail.
        // `standalone` stays server-side too: the portal is told `capture`,
        // which is the experience to render, and never which integration is
        // behind it.
        const { availability, flow, standalone } = await clientSafeIdvState(admin);

        /**
         * Whether this party already has a secure check open.
         *
         * One boolean, and it is what lets the portal survive a refresh: the
         * window handle, the session URL and every scrap of local state are
         * gone after one, so without asking the server the client is shown
         * "Start" while their verification window is still sitting open behind
         * the browser. They then start again — which the backend correctly
         * de-duplicates, but only after telling them nothing about why.
         *
         * Deliberately a boolean and not the session. It carries no URL, no
         * session id, no provider and no token, so the strongest thing it can
         * do is change which sentence the client reads.
         */
        /*
         * The hosted branch is back, and it answers the same question the
         * capture branch does: "is a check already open for this party?"
         *
         * It is what produces "Continue verification" rather than "Start",
         * which is what stops a refreshed page — which has lost the window
         * handle and every scrap of local state — from asking the customer to
         * begin again while their session is still sitting open behind the
         * browser. Still a boolean: no session id, no URL, no token.
         */
        if (flow === 'hosted_session') {
          for (const party of parties) {
            party.verification_in_progress = Boolean(
              await activeHostedCheck(admin, c.id, party.party_id));
          }
        }

        if (standalone) {
          /**
           * The same boolean, for the capture journey.
           *
           * It answers the question a refreshed page cannot: "are my photos
           * already being checked?" Without it, somebody who submitted and then
           * reloaded is offered "Start" and takes their photographs a second
           * time while the first set is mid-provider — which is a wasted
           * capture for them and a second attempt they did not intend.
           *
           * Still a boolean and nothing more. No attempt id, no provider, no
           * step, no score: the strongest thing it can do is change which
           * sentence is on the screen, and it can never mark anybody verified.
           */
          for (const party of parties) {
            party.verification_in_progress = Boolean(
              await activeProcessingCheck(admin, c.id, party.party_id));
          }
        }

        return jsonResponse({
          enabled: true,
          availability,
          /*
           * Which experience to render, resolved server-side and never sent by
           * the browser: `hosted` opens the provider's own window, `capture` is
           * NPC's camera journey. The provider KEY, the workflow id and the
           * environment stay server-side — the portal learns one of two words.
           */
          provider_flow: flow === 'hosted_session' ? 'hosted' : 'capture',
          max_attempts: MAX_VERIFICATION_ATTEMPTS,
          // The biometric consent is separate (APP 3.3) and is what unlocks
          // the facial check specifically.
          biometric_consent_accepted: !consentState.outstanding.includes('biometric_collection')
            && consentState.documents.some((d) => d.code === 'biometric_collection'),
          parties,
        });
      }

      /**
       * Start (or recover) a provider-hosted verification session.
       *
       * Everything the self-hosted path gates on is gated here too — portal
       * session, case ownership, party, the consent catalogue, the separate
       * biometric consent, the attempt ceiling, one-in-flight, and provider
       * readiness. What is deliberately absent is any capture: when a hosted
       * provider is active NPC never asks the customer to upload an identity
       * document or a selfie into its own storage, because the provider does
       * that itself and a second copy would be collection without purpose.
       *
       * Returns the hosted URL and nothing else. The URL embeds the customer's
       * session token, so it is handed to their browser and never persisted,
       * logged, or written to the timeline.
       */
      /**
       * Start (or resume) the provider-hosted verification session.
       *
       * REACTIVATED. This op was stubbed to a 409 `hosted_flow_retired` by the
       * standalone cutover; the body below is that cutover's own preserved
       * implementation, restored rather than rewritten, because it already
       * carries the reconciliation, correlation and one-session-per-party
       * rules that were proven against the live API.
       *
       * What changed on reactivation is exactly one line — `vendorData` is now
       * person-scoped (no attempt suffix), so the applicant is ONE Didit
       * Directory user rather than one per attempt. See `buildVendorData`.
       */
      case 'start_hosted_verification': {
        const c = await resolveCase(body.case_id);
        if (!c) return jsonResponse({ error: 'No case' }, 404);

        const consentState = await loadConsentState(admin, c.id);
        if (!consentState.satisfied) return consentRequiredResponse(consentState);

        const partyId = body.party_id ? String(body.party_id) : null;
        const partyLabel = String(body.party_label ?? c.subject_display_name ?? 'Customer').slice(0, 200);

        /**
         * The document the customer says they will present.
         *
         * The ONLY thing the browser is permitted to declare about the
         * session, and it is matched against a closed list rather than
         * forwarded. What it cannot say — and what this handler reads from
         * server state alone — is the provider, the workflow, the environment,
         * the country, the callback, or anything about the outcome.
         *
         * Absent is allowed and means "not declared": an older portal build,
         * or a caller resuming a session. Present-but-unrecognised is refused,
         * because a typo that silently became an unrestricted session would
         * put the country and document pickers back in front of the customer
         * with nothing to show that it had happened.
         */
        const documentChoice = parseDocumentChoice(body.document_type);
        if (body.document_type !== undefined && body.document_type !== null && !documentChoice) {
          return jsonResponse({
            error: 'That is not a document we can verify. Please choose one of the options shown.',
            code: 'unsupported_document_type',
          }, 400);
        }

        // The biometric consent must exist BEFORE a face is captured, and the
        // hosted flow captures one. Consent after collection is not consent
        // (APP 3.3) — and the provider's UI opens the camera immediately, so
        // this gate has to sit in front of the session, not the result.
        const { data: bioConsent } = await admin.schema('aml').from('consents')
          .select('id, version').eq('case_id', c.id).eq('kind', 'biometric_collection')
          .order('accepted_at', { ascending: false }).limit(1).maybeSingle();
        if (!bioConsent) {
          return jsonResponse({
            error: 'Please accept the facial verification consent before continuing.',
            code: 'biometric_consent_required',
          }, 403);
        }

        const { availability, flow } = await clientSafeIdvState(admin);
        if (flow !== 'hosted_session') {
          // The tenant is not on a hosted provider. Never fall back to one on
          // a client's say-so: provider selection is server-side.
          return jsonResponse({
            error: 'Verification is temporarily unavailable. Please try again shortly.',
            code: 'temporarily_unavailable',
          }, 409);
        }
        if (availability !== 'available') {
          return jsonResponse({
            error: availability === 'manual_verification_required'
              ? 'Electronic verification is not available for your case. Your adviser will arrange verification another way.'
              : 'Verification is temporarily unavailable. Please try again shortly — nothing has been used up.',
            code: availability,
          }, 409);
        }

        /**
         * A verified party never buys another session.
         *
         * The exhaustion gate below cannot catch this: a verified party has
         * typically consumed one of their three attempts. The portal hides the
         * button once a party projects as verified, but the endpoint is the
         * boundary — a refresh, a stale tab or a direct call must meet the same
         * refusal. `projectParty` is the one place "verified" is decided
         * (electronic pass or accepted staff sighting), so it is consulted
         * rather than re-derived.
         */
        const startingParty = (await verificationParties(admin, c.id))
          .find((p) => (p.party_id ?? null) === (partyId ?? null));
        if (startingParty?.status === 'verified') {
          return jsonResponse({
            error: 'Your identity has already been verified. There is nothing more to do for this step.',
            code: 'already_verified',
          }, 409);
        }

        const used = await verificationAttemptsUsed(admin, c.id, partyId);
        if (used >= MAX_VERIFICATION_ATTEMPTS) {
          return jsonResponse({
            error: 'You have used all available attempts. A member of our team will contact you to complete verification another way.',
            code: 'attempts_exhausted',
            attempts_used: used,
            max_attempts: MAX_VERIFICATION_ATTEMPTS,
          }, 409);
        }

        const resolved = await resolveTenantProvider(admin, 'default', 'idv');
        const provider = getHostedIdvProvider({ resolved, admin });
        const workflowId = diditWorkflowId(resolved) ?? '';
        const environment = currentEnvironment();

        /**
         * An existing in-flight session for this party.
         *
         * This is what makes a double-click, a refresh, a second tab and a
         * backend timeout-after-creation all safe: the customer is returned to
         * the session they already have rather than being given a second
         * (chargeable) one. The URL is re-read from the provider, because NPC
         * never stored it.
         */
        let existing = await activeHostedCheck(admin, c.id, partyId);

        /**
         * ...unless it was minted under a configuration the operator has since
         * replaced.
         *
         * `POST /v3/session/` upserts on `workflow_id + vendor_data`, and a
         * session lives for seven days, so a customer who pressed Start before
         * a workflow change was pinned to the old one until it expired — a
         * reconfiguration simply never reached them. That is what put a
         * cross-device QR screen in front of customers after the workflow had
         * already been corrected to allow desktop capture.
         *
         * The provider's version number cannot detect it. Measured on this
         * account: changing a SETTING (`is_desktop_allowed`) left the published
         * workflow at version 1, while editing the GRAPH created version 2. So
         * a session and the live workflow can report the same version across a
         * change that matters, and a different version across one that does
         * not. The marker is therefore ours —
         * `config.workflow_revised_at`, set by whoever changes the workflow.
         * Any session created before it is stale by definition.
         *
         * Releasing is a technical supersede: `status` and `attempt_consumed`
         * are untouched, so this costs the customer nothing and is not a
         * verification failure.
         */
        if (existing) {
          if (isStaleHostedSession(existing.created_at, workflowRevisedAt(resolved))) {
            await releaseHostedCheck(admin, String(existing.id), 'workflow_revised');
            await appendDiditCaseEvent(admin, c.id,
              `Identity verification session superseded for ${partyLabel}: the verification `
              + `workflow was reconfigured after it was created`,
              {
                verification_check_id: existing.id,
                provider: 'didit',
                provider_reference: existing.provider_reference,
                reason: 'workflow_revised',
                category: 'technical',
                attempt_consumed: false,
                scope: 'identity_verification_only',
              });
            existing = null;
          }
        }

        if (existing) {
          try {
            const decision = await provider.fetchDecision(String(existing.provider_reference));
            const result = await applyDiditDecision({
              db: admin, check: existing as any, decision,
              expectedWorkflowId: workflowId, source: 'portal_reconcile', environment,
            });
            if (result.kind === 'in_flight') {
              const url = typeof decision['session_url'] === 'string' ? decision['session_url'] : '';
              /**
               * A session minted for a different document cannot serve this
               * request — its `expected_document_types` restricts the provider
               * to the document the customer chose last time, so handing it
               * back to somebody who has since picked their passport dead-ends
               * them on a picker that will not offer it.
               *
               * Only replaced while the customer has not begun. `Not Started`
               * is the provider's word for a session whose link has never been
               * opened, so nothing is lost and no work is discarded; once they
               * are `In Progress` or `Awaiting User` the session in their hands
               * is the one that matters and they are returned to it, whatever
               * they picked on this screen.
               *
               * The replacement is a technical supersede — `status` and
               * `attempt_consumed` untouched — for the same reason a workflow
               * revision is: changing your mind about which card to hold up is
               * not a failed identity check.
               */
              const startedAlready = String(decision['status'] ?? '') !== 'Not Started';
              if (documentChoice && !startedAlready
                && sessionDocumentChoice(existing) !== documentChoice) {
                await releaseHostedCheck(admin, String(existing.id), 'document_choice_changed');
                await appendDiditCaseEvent(admin, c.id,
                  `Identity verification session superseded for ${partyLabel}: a different `
                  + `identity document was chosen before the check was started`,
                  {
                    verification_check_id: existing.id,
                    provider: 'didit',
                    provider_reference: existing.provider_reference,
                    reason: 'document_choice_changed',
                    category: 'technical',
                    attempt_consumed: false,
                    scope: 'identity_verification_only',
                  });
                existing = null;
              } else if (url) {
                return jsonResponse({
                  started: true, resumed: true, verification_url: url,
                  message: 'Your verification is already open. Continue where you left off.',
                });
              }
              // No URL to return them to; treat the session as unusable and
              // fall through to creating a fresh one below.
            }
            if (result.kind === 'applied' || result.kind === 'already_applied') {
              // It finished while nobody was looking. Report the settled state
              // rather than starting another session.
              return jsonResponse({
                started: false, code: 'already_processing',
                message: 'Your verification has been received. We will update you shortly.',
              });
            }
            // 'released' — expired/abandoned. The slot is free; carry on.
            existing = null;
          } catch (e) {
            if (e instanceof DiditCorrelationError) {
              // The stored session does not correlate. Do not reuse it and do
              // not settle anything from it; retire it and start cleanly.
              await releaseHostedCheck(admin, String(existing.id), `correlation_failed:${e.code}`);
              existing = null;
            } else if (e instanceof DiditApiError) {
              // Cannot tell whether the old session is still usable. Refusing
              // is the safe answer: creating another would risk two live
              // sessions for one party. Nothing is consumed.
              return jsonResponse({
                error: 'Verification is temporarily unavailable. Please try again shortly — nothing has been used up.',
                code: 'temporarily_unavailable',
              }, 409);
            } else {
              throw e;
            }
          }
        }

        // Row first, session second. The canonical check is what the webhook
        // correlates against, so it has to exist before a session can arrive
        // — the reverse order loses any decision that beats the insert.
        const captureSequence = await nextCaptureSequence(admin, c.id, partyId);
        const idempotencyKey = 'portal-didit-' + await sha256Hex(
          `${c.id}|${partyId ?? 'subject'}|${captureSequence}`);

        let created: any;
        const { data: inserted, error: insErr } = await admin.schema('aml')
          .from('verification_checks').insert({
            case_id: c.id,
            party_id: partyId,
            party_label: partyLabel,
            check_type: 'electronic_idv',
            attempt_number: captureSequence,
            capture_sequence: captureSequence,
            status: 'pending',
            provider: 'didit',
            processing_status: 'queued',
            attempt_consumed: false,
            execution_mode: 'live',
            environment,
            idempotency_key: idempotencyKey,
            // No document_reference and no biometric_storage_path: the
            // provider owns the capture, so NPC holds no copy. The outbox
            // trigger keys on document_reference being NULL to keep this row
            // out of the self-hosted image worker.
            biometric_consent_id: bioConsent.id,
            outcome_detail: { submitted_from: 'client_portal', flow: 'hosted_session' },
          }).select('*').single();

        if (insErr) {
          // 23505 on the active-session index: a concurrent request won.
          // Idempotent success — the customer has a session, they just did not
          // create this one.
          if (insErr.code === '23505') {
            return jsonResponse({
              started: false, code: 'already_processing',
              message: 'Your verification is already open. Please continue in the window that opened.',
            });
          }
          if (insErr.code === '23514') {
            return jsonResponse({
              error: 'You have used all available attempts.', code: 'attempts_exhausted',
            }, 409);
          }
          throw insErr;
        }
        created = inserted;

        try {
          const session = await provider.createSession({
            /*
             * Opaque, person-scoped, and never a name, email, document number
             * or DOB.
             *
             * The attempt is deliberately NOT part of it. Didit groups
             * sessions into a Directory user by this exact string, so a key
             * carrying the attempt made one applicant several users in the
             * provider's console — measured on this account. Person-scoped, it
             * also makes `POST /v3/session/` idempotent for an unstarted
             * session: a refresh or a double-click returns the same session
             * instead of buying another. See `buildVendorData`.
             */
            vendorData: buildVendorData(c.id, partyId),
            // Internal identifiers only — echoed back on every webhook.
            metadata: {
              verification_check_id: created.id,
              capture_sequence: captureSequence,
            },
            /**
             * Where the customer lands when the hosted flow finishes.
             *
             * Server-built from a compiled-in origin, never from the request.
             * The page it names is a receipt and nothing more — it reads no
             * status out of the redirect and settles nothing; the identity
             * outcome still arrives only on the signed webhook. Its job is to
             * stop the journey ending on a page NPC does not own.
             */
            callbackUrl: hostedReturnUrl(),
            // Narrows the provider's own document picker to the one the
            // customer said they would present, and pins the country to
            // Australia. Translated to provider vocabulary inside the adapter.
            documentChoice,
          });

          await admin.schema('aml').from('verification_checks').update({
            provider_reference: session.sessionId,
            provider_attempt_reference: session.sessionId,
            processing_status: 'processing',
            processing_started_at: new Date().toISOString(),
            outcome_detail: {
              ...(created.outcome_detail ?? {}),
              didit_session: {
                /**
                 * Identifiers only. The hosted URL and the session token are
                 * NOT stored: the URL embeds the token, so persisting it would
                 * put a live credential in the case record — one that opens
                 * that customer's verification flow to anyone who can read the
                 * row. Resuming does not need it: the URL is re-read from the
                 * decision endpoint over an authenticated call and handed
                 * straight to that customer's browser.
                 */
                session_id: session.sessionId,
                // The correlation key this session was minted under, stored so
                // a later reader can see WHICH Didit user this attempt belongs
                // to without re-deriving it from code that may have changed.
                vendor_data: buildVendorData(c.id, partyId),
                workflow_id: session.workflowId,
                workflow_version: session.workflowVersion,
                // Which NPC attempt this session belongs to, and the workflow
                // revision it was minted under. Together they are what lets a
                // later request tell a current session from a superseded one
                // — Didit's own `workflow_version` does not move when a
                // published workflow is edited.
                attempt: captureSequence,
                workflow_revised_at: resolved?.config?.['workflow_revised_at'] ?? null,
                // What the customer said they would present. NPC's own
                // vocabulary, not the provider's code — it is read back by the
                // reuse check above, and it is the audit record of what the
                // session was restricted to. Not a verification finding: the
                // document actually presented is whatever the decision says.
                document_choice: documentChoice,
                status: session.status,
                expires_at: session.expiresAt,
              },
            },
            updated_at: new Date().toISOString(),
          }).eq('id', created.id);

          await appendDiditCaseEvent(admin, c.id,
            `Identity verification session created for ${partyLabel}`,
            {
              verification_check_id: created.id,
              provider: 'didit',
              provider_reference: session.sessionId,
              capture_sequence: captureSequence,
              attempt_consumed: false,
              scope: 'identity_verification_only',
            });

          return jsonResponse({
            started: true,
            resumed: false,
            // The one thing the browser gets. Not stored anywhere on our side.
            verification_url: session.url,
            message: 'Follow the steps to verify your identity.',
          });
        } catch (e) {
          /**
           * Session creation failed. This is OUR failure and it must cost the
           * customer nothing: the row is retired rather than left in flight
           * (which would block their next attempt behind the active-session
           * index), `status` stays `pending`, and no attempt is consumed.
           */
          const category = e instanceof DiditApiError
            ? (e.category === 'timeout' ? 'timeout'
              : e.category === 'provider_not_configured' ? 'provider_not_configured'
                : e.category === 'provider_rejected_request' ? 'provider_misconfigured'
                  : 'provider_unavailable')
            : 'provider_unavailable';
          await admin.schema('aml').from('verification_checks').update({
            processing_status: 'cancelled',
            provider_error_category: category,
            superseded_at: new Date().toISOString(),
            superseded_reason: 'session_creation_failed',
            failure_reason: String((e as Error)?.message ?? 'session_creation_failed').slice(0, 300),
            updated_at: new Date().toISOString(),
          }).eq('id', created.id).eq('attempt_consumed', false);

          console.error('[aml-client-portal] didit session creation failed', category);
          return jsonResponse({
            error: 'Verification is temporarily unavailable. Please try again shortly — nothing has been used up.',
            code: 'temporarily_unavailable',
          }, 409);
        }
      }

      case 'submit_verification': {
        const c = await resolveCase(body.case_id);
        if (!c) return jsonResponse({ error: 'No case' }, 404);

        const consentState = await loadConsentState(admin, c.id);
        if (!consentState.satisfied) return consentRequiredResponse(consentState);

        // A hosted provider owns the capture. Accepting NPC-stored images here
        // would create the duplicate collection this integration exists to
        // avoid, and would queue a check the self-hosted worker would then try
        // to process.
        const legacySubmitState = await clientSafeIdvState(admin);
        if (legacySubmitState.flow === 'hosted_session') {
          return jsonResponse({
            error: 'Please complete verification in the window provided.',
            code: 'hosted_verification_required',
          }, 409);
        }
        /**
         * This operation writes `provider: 'selfhosted'` and hands two
         * browser-supplied paths to the image worker. Under the Standalone
         * provider both are wrong: the worker would resolve a provider with no
         * `runIdv()` and stamp a technical failure on a customer who did
         * everything right, and the paths would not be ones the server named.
         *
         * Kept rather than deleted because the self-hosted adapter is still
         * wired and still selectable; refused here so that only one capture
         * path can be live at a time.
         */
        if (legacySubmitState.standalone) {
          return jsonResponse({
            error: 'Please start the identity check again from the verification step.',
            code: 'capture_flow_superseded',
          }, 409);
        }

        const partyId = body.party_id ? String(body.party_id) : null;
        const partyLabel = String(body.party_label ?? c.subject_display_name ?? 'Customer').slice(0, 200);

        // Attempt ceiling is the database's job too, but check here so the
        // client gets a clear message rather than a constraint violation.
        const used = await verificationAttemptsUsed(admin, c.id, partyId);
        if (used >= MAX_VERIFICATION_ATTEMPTS) {
          return jsonResponse({
            error: 'You have used all available attempts. A member of our team will contact you to complete verification another way.',
            code: 'attempts_exhausted',
            attempts_used: used,
            max_attempts: MAX_VERIFICATION_ATTEMPTS,
          }, 409);
        }

        // The biometric consent must be recorded BEFORE a face is captured —
        // consent after collection is not consent (APP 3.3).
        const { data: bioConsent } = await admin.schema('aml').from('consents')
          .select('id, version').eq('case_id', c.id).eq('kind', 'biometric_collection')
          .order('accepted_at', { ascending: false }).limit(1).maybeSingle();
        if (!bioConsent) {
          return jsonResponse({
            error: 'Please accept the facial verification consent before continuing.',
            code: 'biometric_consent_required',
          }, 403);
        }

        const documentPath = String(body.document_storage_path ?? '').trim();
        const selfiePath = String(body.selfie_storage_path ?? '').trim();
        if (!documentPath || !selfiePath) {
          return jsonResponse({ error: 'document_storage_path and selfie_storage_path are required' }, 400);
        }
        // Both objects must live under this case's prefix — a client must not
        // be able to name someone else's upload.
        for (const [label, p] of [['document', documentPath], ['selfie', selfiePath]] as const) {
          if (!p.startsWith(`${c.id}/`)) {
            return jsonResponse({ error: `Invalid ${label} path` }, 400);
          }
        }

        // Live-provider readiness gates the SUBMISSION, not just the UI: a
        // capture must never sit against a provider that cannot examine it.
        const availability = await clientSafeIdvAvailability(admin);
        if (availability !== 'available') {
          return jsonResponse({
            error: availability === 'manual_verification_required'
              ? 'Electronic verification is not available for your case. Your adviser will arrange verification another way.'
              : 'Verification is temporarily unavailable. Please try again shortly — nothing has been used up.',
            code: availability,
          }, 409);
        }

        // One in-flight check per party: a duplicate submission neither
        // creates a second row nor calls the provider twice.
        const active = await activeProcessingCheck(admin, c.id, partyId);
        if (active) {
          return jsonResponse({
            submitted: true,
            status: 'processing',
            code: 'already_processing',
            message: 'Your verification is already being checked. We will update you shortly.',
          });
        }

        // Stable per-capture idempotency: resubmitting the SAME captures
        // collapses onto one row (unique index), while a new capture pair is
        // a genuinely new submission.
        const idempotencyKey = 'portal-idv-' + await sha256Hex(`${c.id}|${partyId ?? 'subject'}|${documentPath}|${selfiePath}`);

        // Row sequence, NOT the consumed-attempt count — see
        // nextCaptureSequence(). Using `used + 1` here stranded any client
        // whose previous capture consumed no attempt.
        const captureSequence = await nextCaptureSequence(admin, c.id, partyId);

        const baseRow = {
          case_id: c.id,
          party_id: partyId,
          party_label: partyLabel,
          check_type: 'electronic_idv',
          attempt_number: captureSequence,
          status: 'pending',
          provider: 'selfhosted',
          biometric_kind: 'face_image',
          biometric_storage_path: selfiePath,
          biometric_captured_at: new Date().toISOString(),
          biometric_consent_id: bioConsent.id,
          document_reference: documentPath,
          outcome_detail: { submitted_from: 'client_portal' },
        };
        // Canonical-model columns stamped at creation; the AFTER-trigger from
        // 20260831000100 emits aml.verification.requested in the same
        // transaction, and the worker takes it from there. Legacy-schema
        // retry keeps the portal working before the migration is applied.
        let { data: created, error: insErr } = await admin.schema('aml')
          .from('verification_checks').insert({
            ...baseRow,
            processing_status: 'queued',
            capture_sequence: captureSequence,
            attempt_consumed: false,
            execution_mode: 'live',
            idempotency_key: idempotencyKey,
          }).select('*').single();
        if (insErr && /processing_status|capture_sequence|attempt_consumed|execution_mode|idempotency_key/i.test(insErr.message ?? '')) {
          ({ data: created, error: insErr } = await admin.schema('aml')
            .from('verification_checks').insert(baseRow).select('*').single());
        }
        if (insErr) {
          if (insErr.code === '23514') {
            return jsonResponse({
              error: 'You have used all available attempts.', code: 'attempts_exhausted',
            }, 409);
          }
          if (insErr.code === '23505') {
            const onIdempotencyKey = /idempotency/i.test(
              `${insErr.message ?? ''} ${(insErr as any).details ?? ''}`);
            if (onIdempotencyKey) {
              // Genuinely the same captures again — idempotent success.
              return jsonResponse({
                submitted: true, status: 'processing', code: 'already_processing',
                message: 'Your verification is already being checked. We will update you shortly.',
              });
            }
            // Attempt-number collision: another submission for this party
            // landed between the sequence read and the insert. Re-sequence and
            // retry once. Reporting "already processing" here was what stranded
            // a client after an unusable capture.
            const retrySequence = await nextCaptureSequence(admin, c.id, partyId);
            const retry = await admin.schema('aml').from('verification_checks').insert({
              ...baseRow,
              attempt_number: retrySequence,
              processing_status: 'queued',
              capture_sequence: retrySequence,
              attempt_consumed: false,
              execution_mode: 'live',
              idempotency_key: idempotencyKey,
            }).select('*').single();
            if (retry.error) throw retry.error;
            created = retry.data;
            insErr = null;
          } else {
            throw insErr;
          }
        }

        // Adjudication happens staff-side. The portal deliberately does not
        // learn the score, the threshold, or why a check was referred —
        // that is internal AML information (Appendix C.1). Attempts shown
        // are CONSUMED attempts: a technical failure will not move them.
        return jsonResponse({
          submitted: true,
          attempt_number: created.attempt_number,
          attempts_remaining: MAX_VERIFICATION_ATTEMPTS - used,
          status: 'processing',
          message: 'Thank you. We are checking your identity documents and will be in touch if anything else is needed.',
        });
      }

      /**
       * Prepare an NPC-captured identity attempt.
       *
       * Everything that could refuse the customer is checked HERE, before a
       * camera opens and before a single byte of their identity document or
       * their face exists anywhere: the portal session, the case, the party,
       * the consent catalogue, the separate biometric consent, provider
       * readiness, the attempt ceiling and one-in-flight.
       *
       * That ordering is the lesson this operation exists to hold. The old flow
       * asked for one upload grant, wrote the document, and only then hit the
       * gate on the second grant — so a case with no live provider uploaded a
       * customer's identity document and abandoned the submission. Production
       * accumulated nine orphaned documents and not one verification row.
       *
       * ## Preparing consumes NOTHING
       *
       * The row it creates is a `draft`: `attempt_consumed` is false, the
       * outbox trigger declines to emit for it, and
       * `aml.verification_attempts_used()` — which counts consumed attempts —
       * cannot see it. A customer may prepare, open the camera, change their
       * mind, close the tab and come back, as many times as they like, at no
       * cost to their allowance. `uq_aml_verification_draft_capture` makes the
       * operation idempotent: a second tab resumes the same attempt and the
       * same three paths rather than minting a second set.
       *
       * ## What comes back
       *
       * An attempt id, which sides to photograph, and three short-lived signed
       * upload permissions for objects the SERVER named. No provider name, no
       * endpoint, no workflow, no threshold, no key — nothing the browser could
       * use to reach a verification vendor, because it never does.
       */
      case 'prepare_verification_attempt': {
        const c = await resolveCase(body.case_id);
        if (!c) return jsonResponse({ error: 'No case' }, 404);

        const consentState = await loadConsentState(admin, c.id);
        if (!consentState.satisfied) return consentRequiredResponse(consentState);

        const documentChoice = parseDocumentChoice(body.document_type);
        if (!documentChoice) {
          return jsonResponse({
            error: 'Please choose one of the identity documents listed.',
            code: 'unsupported_document_type',
          }, 400);
        }

        const { availability, standalone } = await clientSafeIdvState(admin);
        if (!standalone) {
          // The tenant is on the hosted session or the self-hosted service.
          // Neither is prepared this way, and answering with upload grants
          // would collect captures nothing would ever examine.
          return jsonResponse({
            error: 'Please continue with the verification step shown on your screen.',
            code: 'capture_flow_unavailable',
          }, 409);
        }
        if (availability !== 'available') {
          return jsonResponse({
            error: availability === 'manual_verification_required'
              ? 'Electronic verification is not available for your case. Your adviser will arrange verification another way.'
              : 'Verification is temporarily unavailable. Please try again shortly — nothing has been used up.',
            code: availability,
          }, 409);
        }

        const partyId = body.party_id ? String(body.party_id) : null;
        const partyLabel = String(
          body.party_label ?? c.subject_display_name ?? 'Customer').slice(0, 200);

        /**
         * A verified party never buys another sequence.
         *
         * Every standalone attempt is up to three billed provider calls, and a
         * verified party has typically consumed only one of their three
         * attempts — so the exhaustion gate below cannot catch this. The
         * portal hides the button once a party projects as verified, but the
         * endpoint is the boundary: a refresh, a stale tab or a direct call
         * must meet the same refusal. `projectParty` is the one place
         * "verified" is decided (electronic pass or accepted staff sighting),
         * so it is consulted rather than re-derived.
         */
        const preparingParty = (await verificationParties(admin, c.id))
          .find((p) => (p.party_id ?? null) === (partyId ?? null));
        if (preparingParty?.status === 'verified') {
          return jsonResponse({
            error: 'Your identity has already been verified. There is nothing more to do for this step.',
            code: 'already_verified',
          }, 409);
        }

        const used = await verificationAttemptsUsed(admin, c.id, partyId);
        if (used >= MAX_VERIFICATION_ATTEMPTS) {
          return jsonResponse({
            error: 'You have used all available attempts. A member of our team will contact you to complete verification another way.',
            code: 'attempts_exhausted',
            attempts_used: used, max_attempts: MAX_VERIFICATION_ATTEMPTS,
          }, 409);
        }

        const active = await activeProcessingCheck(admin, c.id, partyId);
        if (active) {
          return jsonResponse({
            error: 'Your previous submission is still being checked.',
            code: 'already_processing',
          }, 409);
        }

        // Consent to collect a facial image must exist BEFORE the camera opens.
        // Consent after collection is not consent (APP 3.3).
        const { data: bioConsent } = await admin.schema('aml').from('consents')
          .select('id, version').eq('case_id', c.id).eq('kind', 'biometric_collection')
          .order('accepted_at', { ascending: false }).limit(1).maybeSingle();
        if (!bioConsent) {
          return jsonResponse({
            error: 'Please accept the facial verification consent before continuing.',
            code: 'biometric_consent_required',
          }, 403);
        }

        const required = identityDocumentCapturePlan(documentChoice);

        // Resume rather than create. The customer may have prepared already —
        // in this tab, in another one, or before a refresh — and a second draft
        // would mean a second set of storage paths for one attempt.
        let draft = await draftCaptureAttempt(admin, c.id, partyId);

        if (!draft) {
          const captureSequence = await nextCaptureSequence(admin, c.id, partyId);
          const attemptId = crypto.randomUUID();
          const objects = capturePaths(c.id, attemptId);
          const insert = await admin.schema('aml').from('verification_checks').insert({
            id: attemptId,
            case_id: c.id,
            party_id: partyId,
            party_label: partyLabel,
            check_type: 'electronic_idv',
            attempt_number: captureSequence,
            capture_sequence: captureSequence,
            status: 'pending',
            processing_status: 'draft',
            attempt_consumed: false,
            execution_mode: 'live',
            provider: 'didit_standalone',
            biometric_consent_id: bioConsent.id,
            outcome_detail: {
              submitted_from: 'client_portal',
              // The plan the processor will read. Paths are recorded at
              // preparation so the objects downloaded later are exactly the
              // ones the server named, with nothing from the browser in
              // between.
              standalone_capture: {
                document_choice: documentChoice,
                required,
                objects: {
                  document_front: objects.document_front,
                  document_back: required.document_back ? objects.document_back : null,
                  selfie: objects.selfie,
                },
              },
            },
          }).select('*').single();

          if (insert.error) {
            // 23505 on the draft index: another tab prepared between our read
            // and our insert. That is the index doing its job — adopt theirs.
            if (insert.error.code === '23505') {
              draft = await draftCaptureAttempt(admin, c.id, partyId);
              if (!draft) throw insert.error;
            } else {
              throw insert.error;
            }
          } else {
            draft = insert.data;
          }
        } else {
          /**
           * A resumed draft may be for a different document.
           *
           * Someone who chose "driver licence", saw that it wants both sides,
           * and went back to pick their passport must not keep a plan that
           * still requires a back. The plan is rewritten in place, on the same
           * row and the same paths — so the change costs nothing and cannot
           * strand an already-uploaded front.
           */
          const existingChoice = parseDocumentChoice(
            draft.outcome_detail?.standalone_capture?.document_choice);
          if (existingChoice !== documentChoice) {
            const objects = capturePaths(c.id, String(draft.id));
            const updated = await admin.schema('aml').from('verification_checks').update({
              party_label: partyLabel,
              biometric_consent_id: bioConsent.id,
              outcome_detail: {
                ...(draft.outcome_detail ?? {}),
                standalone_capture: {
                  document_choice: documentChoice,
                  required,
                  objects: {
                    document_front: objects.document_front,
                    document_back: required.document_back ? objects.document_back : null,
                    selfie: objects.selfie,
                  },
                },
              },
              updated_at: new Date().toISOString(),
            }).eq('id', draft.id).eq('processing_status', 'draft').select('*').maybeSingle();
            if (updated.data) draft = updated.data;
          }
        }

        const objects = capturePaths(c.id, String(draft.id));
        const uploads: Record<string, { upload_url: string; token: string }> = {};
        for (const kind of ['document_front', 'document_back', 'selfie'] as const) {
          if (!required[kind]) continue;
          const target = objects[kind];
          /**
           * `upsert: true` so a retake after a failed submission can overwrite.
           *
           * Without it the second grant for a path that already holds an object
           * is refused at PUT time, and a customer whose first submission hit a
           * network error could never re-upload — they would be stuck on an
           * attempt they could not complete and could not restart.
           */
          const { data, error } = await admin.storage.from(target.bucket)
            .createSignedUploadUrl(target.path, { upsert: true });
          if (error) throw error;
          uploads[kind] = { upload_url: data.signedUrl, token: data.token };
        }

        return jsonResponse({
          attempt_id: draft.id,
          required,
          uploads,
          attempts_remaining: MAX_VERIFICATION_ATTEMPTS - used,
          max_attempts: MAX_VERIFICATION_ATTEMPTS,
        });
      }

      /**
       * Submit a prepared attempt for checking.
       *
       * The browser sends a case and an attempt id. It does not send a storage
       * path, a provider, a status, a score or a threshold, and there is no
       * field in which it could: everything this operation acts on comes from
       * the draft row the server wrote when it prepared the attempt.
       *
       * The transition itself is the concurrency control. `draft → queued` is a
       * conditional UPDATE, so a double tap, a second tab and a retried request
       * all attempt it and exactly one succeeds; the losers are answered with
       * the submission that already exists. The outbox trigger fires on that
       * one update, writing the durable `aml.verification.requested` event.
       *
       * Processing then happens behind the response. The customer is told their
       * photographs were received and may close the page.
       */
      case 'submit_verification_attempt': {
        const c = await resolveCase(body.case_id);
        if (!c) return jsonResponse({ error: 'No case' }, 404);

        const consentState = await loadConsentState(admin, c.id);
        if (!consentState.satisfied) return consentRequiredResponse(consentState);

        const attemptId = String(body.attempt_id ?? '').trim();
        if (!/^[0-9a-f-]{36}$/i.test(attemptId)) {
          return jsonResponse({ error: 'attempt_id is required' }, 400);
        }

        /**
         * The attempt must belong to THIS case.
         *
         * `resolveCase` has already proved the case belongs to this portal
         * session, so scoping the lookup by `case_id` is what makes an attempt
         * id from another customer's case unreachable — it simply does not
         * match, and the answer is the same 404 an invented id would get.
         */
        const { data: attempt, error: attemptErr } = await admin.schema('aml')
          .from('verification_checks')
          .select('*')
          .eq('id', attemptId)
          .eq('case_id', c.id)
          .eq('check_type', 'electronic_idv')
          .maybeSingle();
        if (attemptErr) throw attemptErr;
        if (!attempt) return jsonResponse({ error: 'No such verification attempt' }, 404);

        // Already submitted, already processing, already settled. Answer with
        // what is true rather than creating a second one.
        if (attempt.processing_status !== 'draft') {
          return jsonResponse({
            submitted: true, status: 'processing', code: 'already_processing',
            message: 'Your verification is already being checked. We will update you shortly.',
          });
        }

        const plan = attempt.outcome_detail?.standalone_capture;
        const documentChoice = parseDocumentChoice(plan?.document_choice);
        if (!documentChoice || !plan?.objects) {
          return jsonResponse({
            error: 'Please start the identity check again.', code: 'attempt_incomplete',
          }, 409);
        }
        const required = identityDocumentCapturePlan(documentChoice);

        // Readiness is re-checked at submission, not just at preparation: a
        // provider can go away while somebody is taking photographs, and
        // queueing a capture nothing can examine strands them on "checking".
        const { availability, standalone } = await clientSafeIdvState(admin);
        if (!standalone || availability !== 'available') {
          return jsonResponse({
            error: availability === 'manual_verification_required'
              ? 'Electronic verification is not available for your case. Your adviser will arrange verification another way.'
              : 'Verification is temporarily unavailable. Please try again shortly — nothing has been used up.',
            code: standalone ? availability : 'capture_flow_unavailable',
          }, 409);
        }

        // Re-checked at submission, same as availability: a draft prepared
        // before the party became verified (a second tab, a staff sighting
        // recorded in between) must not turn into three billed calls now.
        const submittingParty = (await verificationParties(admin, c.id))
          .find((p) => (p.party_id ?? null) === (attempt.party_id ?? null));
        if (submittingParty?.status === 'verified') {
          return jsonResponse({
            error: 'Your identity has already been verified. There is nothing more to do for this step.',
            code: 'already_verified',
          }, 409);
        }

        const used = await verificationAttemptsUsed(admin, c.id, attempt.party_id ?? null);
        if (used >= MAX_VERIFICATION_ATTEMPTS) {
          return jsonResponse({
            error: 'You have used all available attempts. A member of our team will contact you.',
            code: 'attempts_exhausted',
          }, 409);
        }

        /**
         * Every required object must exist, and be a photograph.
         *
         * Checked against storage rather than against anything the browser
         * claimed. A missing back on a two-sided document is the case this
         * catches most often, and it is worth catching: half a driver licence
         * is a document the provider would judge on evidence NPC chose not to
         * give it.
         */
        const missing: string[] = [];
        const rejected: string[] = [];
        for (const kind of ['document_front', 'document_back', 'selfie'] as const) {
          if (!required[kind]) continue;
          const target = plan.objects?.[kind];
          if (!target?.bucket || !target?.path) { missing.push(kind); continue; }
          const info = await inspectCapture(admin, String(target.bucket), String(target.path));
          if (!info.present || info.size < MIN_CAPTURE_BYTES) { missing.push(kind); continue; }
          if (info.size > MAX_CAPTURE_BYTES) { rejected.push(kind); continue; }
          if (info.mime && !ACCEPTED_CAPTURE_MIME.includes(info.mime.toLowerCase())) {
            rejected.push(kind);
          }
        }
        if (missing.length > 0 || rejected.length > 0) {
          return jsonResponse({
            error: 'Some of your photos did not upload properly. Please take them again.',
            code: 'capture_incomplete',
            // Which photograph to redo. A capture kind is not internal
            // information — the customer took it and has to take it again.
            retake: [...missing, ...rejected],
          }, 409);
        }

        /**
         * draft → queued, conditionally.
         *
         * `document_reference` and `biometric_storage_path` are promoted here
         * and not at preparation, for two reasons. The row constraint
         * `biometric_requires_consent` demands a real `biometric_captured_at`
         * alongside the path, and stamping one before the photograph existed
         * would be a false record. And the outbox trigger keys on
         * `document_reference IS NOT NULL`, which is exactly the condition that
         * separates "a capture is waiting to be processed" from everything
         * else.
         */
        const { data: queued } = await admin.schema('aml').from('verification_checks')
          .update({
            processing_status: 'queued',
            document_reference: String(plan.objects.document_front.path),
            biometric_kind: 'face_image',
            biometric_storage_path: String(plan.objects.selfie.path),
            biometric_captured_at: new Date().toISOString(),
            idempotency_key: `portal-idv-${attemptId}`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', attemptId)
          .eq('processing_status', 'draft')
          .select('id, capture_sequence').maybeSingle();

        if (!queued) {
          // Lost the transition to a concurrent submit. That submission is the
          // real one; this is not a second attempt and creates nothing.
          return jsonResponse({
            submitted: true, status: 'processing', code: 'already_processing',
            message: 'Your verification is already being checked. We will update you shortly.',
          });
        }

        /**
         * Start the processing behind the response.
         *
         * Not awaited: three provider calls against three images take seconds,
         * and holding the customer's request open for them is what makes a
         * portal look broken. The durable record already exists — the row is
         * `queued` and the outbox event is written — so if this dispatch never
         * lands, never returns, or dies with the isolate, the one-minute
         * `aml-verification-processor` sweep picks the attempt up instead.
         * Losing this call costs a minute, never a submission.
         */
        const dispatch = callInternalFunction(
          'aml-verification-processor', { check_id: attemptId }, 'aml-client-portal',
          { timeoutMs: 120_000 },
        ).catch((e) => {
          console.warn('[aml-client-portal] processor dispatch failed', (e as Error)?.message);
        });
        try {
          (globalThis as any).EdgeRuntime?.waitUntil?.(dispatch);
        } catch { /* not on the edge runtime; the sweep is the fallback */ }

        return jsonResponse({
          submitted: true,
          attempt_id: attemptId,
          attempt_number: queued.capture_sequence,
          attempts_remaining: MAX_VERIFICATION_ATTEMPTS - used,
          status: 'processing',
          message: 'Thank you. Your photos were received securely and we are checking them now.',
        });
      }

      case 'request_verification_upload_url': {
        const c = await resolveCase(body.case_id);
        if (!c) return jsonResponse({ error: 'No case' }, 404);
        const consentState = await loadConsentState(admin, c.id);
        if (!consentState.satisfied) return consentRequiredResponse(consentState);

        const kind = String(body.kind ?? '');
        if (!['document', 'selfie'].includes(kind)) {
          return jsonResponse({ error: 'kind must be "document" or "selfie"' }, 400);
        }
        // A biometric is only ever COLLECTED when a live provider can examine
        // it, attempts remain, and nothing is already processing. Collecting
        // a face against a dead provider would be collection without purpose
        // (APP 3) — the gate sits on the upload URL, before any capture UI.
        if (kind === 'selfie') {
          const { availability, flow, standalone } = await clientSafeIdvState(admin);
          // When the provider owns the capture, NPC has no purpose for a
          // selfie of its own — collecting one anyway would be collection
          // without a purpose that can be served (APP 3), and would put a
          // second copy of the customer's face in our storage for nothing.
          if (flow === 'hosted_session') {
            return jsonResponse({
              error: 'Please complete verification in the window provided.',
              code: 'hosted_verification_required',
            }, 409);
          }
          // Under the Standalone provider the capture paths are minted by
          // `prepare_verification_attempt` and bound to an attempt row. A
          // free-floating grant from here would write an object no attempt
          // references and nothing would ever read — collection with no
          // purpose, in the bucket whose whole point is that it has one.
          if (standalone) {
            return jsonResponse({
              error: 'Please start the identity check again from the verification step.',
              code: 'capture_flow_superseded',
            }, 409);
          }
          if (availability !== 'available') {
            return jsonResponse({
              error: availability === 'manual_verification_required'
                ? 'Electronic verification is not available for your case. Your adviser will arrange verification another way.'
                : 'Verification is temporarily unavailable. Please try again shortly.',
              code: availability,
            }, 409);
          }
          const uploadPartyId = body.party_id ? String(body.party_id) : null;
          const used = await verificationAttemptsUsed(admin, c.id, uploadPartyId);
          if (used >= MAX_VERIFICATION_ATTEMPTS) {
            return jsonResponse({
              error: 'You have used all available attempts. A member of our team will contact you.',
              code: 'attempts_exhausted',
            }, 409);
          }
          const active = await activeProcessingCheck(admin, c.id, uploadPartyId);
          if (active) {
            return jsonResponse({
              error: 'Your previous submission is still being checked.',
              code: 'already_processing',
            }, 409);
          }
        }
        // Selfies go to the biometrics bucket, never to aml-documents: the
        // tighter access policy and the access log both hang off that bucket.
        const bucket = kind === 'selfie' ? 'aml-biometrics' : 'aml-documents';
        const key = `${c.id}/${kind}-${crypto.randomUUID()}.jpg`;
        const { data, error } = await admin.storage.from(bucket).createSignedUploadUrl(key);
        if (error) throw error;
        return jsonResponse({
          upload_url: data.signedUrl, token: data.token, path: key, bucket,
        });
      }

      case 'list_requirements': {
        const c = await resolveCase(body.case_id);
        if (!c) return jsonResponse({ requirements: [] });
        const { data } = await admin.schema('aml').from('document_requirements')
          .select('*').eq('case_id', c.id).order('created_at', { ascending: true });
        return jsonResponse({ requirements: data ?? [] });
      }

      case 'request_upload_url': {
        const c = await resolveCase(body.case_id);
        if (!c) return jsonResponse({ error: 'No case' }, 404);
        const uploadConsent = await loadConsentState(admin, c.id);
        if (!uploadConsent.satisfied) return consentRequiredResponse(uploadConsent);
        const filename = sanitiseFilename(body.filename);
        const mime = String(body.mime_type ?? 'application/octet-stream');
        const size = Number(body.size_bytes ?? 0);
        if (!filename) return jsonResponse({ error: 'filename required' }, 400);
        if (size > MAX_UPLOAD_BYTES) return jsonResponse({ error: 'File exceeds 25 MB limit' }, 413);
        const key = `${c.id}/${crypto.randomUUID()}-${filename}`;
        const { data, error } = await admin.storage.from('aml-documents')
          .createSignedUploadUrl(key);
        if (error) throw error;
        return jsonResponse({
          upload_url: data.signedUrl, token: data.token, path: key,
          filename, mime_type: mime, size_bytes: size,
        });
      }

      case 'confirm_upload': {
        const c = await resolveCase(body.case_id);
        if (!c) return jsonResponse({ error: 'No case' }, 404);
        const confirmConsent = await loadConsentState(admin, c.id);
        if (!confirmConsent.satisfied) return consentRequiredResponse(confirmConsent);
        if (!body.storage_path || !body.filename) return jsonResponse({ error: 'storage_path + filename required' }, 400);
        const storagePath = String(body.storage_path);
        const pathParts = storagePath.split('/');
        if (pathParts.length !== 2 || pathParts[0] !== c.id || !pathParts[1]) {
          return jsonResponse({ error: 'Invalid path' }, 400);
        }
        const objectName = pathParts[1];
        const { data: storedObjects, error: storageError } = await admin.storage
          .from('aml-documents')
          .list(c.id, { search: objectName, limit: 100 });
        if (storageError) throw storageError;
        if (!(storedObjects ?? []).some((object) => object.name === objectName && object.id)) {
          return jsonResponse({ error: 'Uploaded file not found' }, 400);
        }
        let reqId: string | null = body.requirement_id ?? null;
        if (reqId) {
          const { data: rr } = await admin.schema('aml').from('document_requirements')
            .select('id, case_id').eq('id', reqId).maybeSingle();
          if (!rr || rr.case_id !== c.id) reqId = null;
        }
        /*
         * The client may name what they are sending. A phone camera produces
         * `17868163460724899975067990115218.jpg`, which tells a reviewer
         * nothing — and three of them in a list tell them nothing three
         * times over.
         *
         * `filename` still records the file that actually arrived; the name
         * is stored beside it, never over it. An absent or empty name is
         * fine: the reader derives one from the requirement instead.
         */
        const displayName = sanitiseDocumentName(body.display_name);
        const { data: doc, error } = await admin.schema('aml').from('documents').insert({
          case_id: c.id, requirement_id: reqId,
          filename: sanitiseFilename(body.filename),
          display_name: displayName,
          storage_path: storagePath,
          mime_type: body.mime_type ?? null, size_bytes: body.size_bytes ?? null,
          checksum: body.checksum ?? null,
          uploaded_by_type: 'client', uploaded_by: portalUserId,
        }).select('*').single();
        if (error) throw error;
        if (reqId) {
          await admin.schema('aml').from('document_requirements')
            .update({ status: 'uploaded' }).eq('id', reqId);
        }
        return jsonResponse({ document: doc });
      }

      case 'list_documents': {
        const c = await resolveCase(body.case_id);
        if (!c) return jsonResponse({ documents: [] });
        const { data } = await admin.schema('aml').from('documents')
          .select('id, requirement_id, filename, display_name, mime_type, size_bytes, status, uploaded_at, rejection_reason, metadata, requirement:requirement_id (code, label)')
          .eq('case_id', c.id).neq('status', 'deleted')
          .order('uploaded_at', { ascending: false });
        /*
         * Staff submission records are filtered in code, not with a
         * PostgREST `.neq()` on `metadata->>kind` — in SQL `null <> 'x'` is
         * null, so that filter would also drop every document with no mark,
         * which is all of the client's own files. `metadata` itself stays on
         * this side of the response: it can carry internal context.
         */
        const documents = (data ?? [])
          .filter((d: any) => d?.metadata?.kind !== SUBMISSION_RECORD_DOCUMENT_KIND)
          .map(({ metadata: _metadata, ...d }: any) => d);
        return jsonResponse({ documents });
      }

      /**
       * A short-lived link to one of this case's own documents.
       *
       * Two ownership checks, and both are needed. `resolveCase` proves the
       * case belongs to the portal session; `.eq('case_id', c.id)` proves the
       * document belongs to that case. Without the second, a document id — a
       * value the client legitimately holds for its OWN files, and could guess
       * for others — would be enough to open any document in the system.
       *
       * The bucket is written here and the path is read from the row. Neither
       * comes from the request: a caller-supplied path is a directory
       * traversal waiting to happen, and a caller-supplied bucket turns this
       * into a general-purpose read of the project's storage.
       *
       * The disposition is decided per document rather than fixed. `download`
       * — `Content-Disposition: attachment` — used to be set unconditionally,
       * because `request_upload_url` does not constrain the stored content
       * type and the storage origin is the same host as this API, so an HTML
       * upload served inline would execute there. That reasoning is sound and
       * the conclusion was too broad: it also meant a customer pressing "View"
       * on their own PDF was handed a download rather than a document.
       *
       * So the type is checked instead of assumed. A content type in
       * `INLINE_VIEWABLE_MIME_TYPES` is served inline and everything else
       * keeps the attachment disposition exactly as before — including, on
       * purpose, `image/svg+xml`, which the upload control's `image/*` admits
       * and which is a scriptable document wearing an image's name.
       *
       * The type consulted is the one STORAGE WILL SERVE, read back from the
       * object, and not the row's `mime_type`. They come from the same client
       * but by different routes — the content type was set on the PUT, the
       * column was sent afterwards by `confirm_upload` — so they can disagree,
       * and the served value is the only one that decides how a browser treats
       * the response. An unreadable or unknown type is not in the set, so the
       * failure direction is a download.
       *
       * 120 seconds: long enough for the browser to follow it, short enough
       * that a URL captured from history or a proxy log is already dead.
       */
      case 'get_document_url': {
        const c = await resolveCase(body.case_id);
        if (!c) return jsonResponse({ error: 'No case' }, 404);
        if (!body.document_id) return jsonResponse({ error: 'document_id required' }, 400);

        const { data: doc } = await admin.schema('aml').from('documents')
          .select('id, filename, storage_path, status, metadata')
          .eq('id', String(body.document_id))
          .eq('case_id', c.id)
          .neq('status', 'deleted')
          .maybeSingle();
        // One answer for "not yours", "not there" and "deleted". Telling them
        // apart would confirm that a document id exists on another case.
        // A staff submission record gets the SAME answer: it never appears in
        // the client's listing, so distinguishing it here would only confirm
        // that a staff-only document exists.
        if (!doc || (doc as any)?.metadata?.kind === SUBMISSION_RECORD_DOCUMENT_KIND) {
          return jsonResponse({ error: 'Document not found' }, 404);
        }

        // What storage holds against this path, for its content type alone.
        // Same `list`-with-`search` shape `confirm_upload` uses to prove an
        // upload landed. The path comes from the row, never the request.
        const slash = doc.storage_path.lastIndexOf('/');
        const objectDir = slash > 0 ? doc.storage_path.slice(0, slash) : '';
        const objectFile = doc.storage_path.slice(slash + 1);
        const { data: objects } = await admin.storage
          .from('aml-documents')
          .list(objectDir, { search: objectFile, limit: 100 });
        const servedType = String(
          (objects ?? []).find((o) => o.name === objectFile)?.metadata?.mimetype ?? '',
        ).split(';')[0].trim().toLowerCase();
        const inline = INLINE_VIEWABLE_MIME_TYPES.has(servedType);

        const { data: signed, error: signErr } = await admin.storage
          .from('aml-documents')
          .createSignedUrl(doc.storage_path, 120, inline ? {} : { download: doc.filename });
        if (signErr || !signed?.signedUrl) {
          // Never echo the storage error: it carries the path and the bucket.
          console.error('[aml-client-portal] document url signing failed');
          return jsonResponse({
            error: 'We could not open that document just now. Please try again shortly.',
            code: 'document_unavailable',
          }, 502);
        }
        return jsonResponse({ url: signed.signedUrl, filename: doc.filename });
      }

      case 'list_client_requests': {
        const c = await resolveCase(body.case_id);
        if (!c) return jsonResponse({ requests: [] });
        const { data } = await admin.schema('aml').from('client_requests')
          .select('id, kind, subject, message, status, created_at, responded_at, response_payload')
          .eq('case_id', c.id).order('created_at', { ascending: false });
        return jsonResponse({ requests: data ?? [] });
      }

      case 'respond_client_request': {
        if (!body.request_id) return jsonResponse({ error: 'request_id required' }, 400);
        const { data: rr } = await admin.schema('aml').from('client_requests')
          .select('*, cases:case_id(client_id)').eq('id', body.request_id).maybeSingle();
        if (!rr || (rr as any).cases?.client_id !== clientId) return jsonResponse({ error: 'Not found' }, 404);
        // Versioned response contract (v1): one shape both sides read.
        // Historical free-form payloads stay readable staff-side through the
        // compatibility projection; new writes are always v1.
        const raw = body.response_payload && typeof body.response_payload === 'object' && !Array.isArray(body.response_payload)
          ? body.response_payload : {};
        const responsePayload = {
          version: 1,
          text: String(raw.text ?? raw.message ?? '').slice(0, 4000),
          attachments: Array.isArray(raw.attachments)
            ? raw.attachments.filter((a: unknown) => typeof a === 'string').slice(0, 10)
            : [],
          completed_action: CLIENT_ACTION_CODES.includes(String(raw.completed_action ?? ''))
            ? raw.completed_action : null,
          submitted_at: new Date().toISOString(),
        };
        if (!responsePayload.text && responsePayload.attachments.length === 0 && !responsePayload.completed_action) {
          return jsonResponse({ error: 'A response needs text, an attachment reference or a completed action.' }, 400);
        }
        const { data, error } = await admin.schema('aml').from('client_requests').update({
          status: 'responded', responded_at: new Date().toISOString(),
          responded_by: portalUserId, response_payload: responsePayload,
          response_version: 1,
        }).eq('id', body.request_id).select('*').single();
        if (error) throw error;
        return jsonResponse({ request: data });
      }

      /**
       * Submission eligibility — the rule, written down.
       *
       * Three gates and exactly three: the current consent catalogue accepted,
       * every APPLICABLE questionnaire section submitted and valid, and every
       * REQUIRED document requirement met. Identity verification is
       * deliberately NOT a gate, and never has been.
       *
       * That asymmetry is intentional rather than an oversight. Everything
       * above is work only the client can do; an identity outcome is produced
       * by a provider and a reviewer on our side, on their own clock, and
       * holding the client's pack hostage to it would leave them staring at a
       * disabled button waiting on us. The pack is what they owe us. The
       * verification is what we owe them.
       *
       * The journey states this rule the same way (`readyToSubmit` in
       * portalJourney.pure.ts), and the review screen says so in words rather
       * than implying an all-clear it cannot give. Changing it means changing
       * all three, plus the tests that pin them.
       */
      case 'submit_for_review': {
        const c = await resolveCase(body.case_id);
        if (!c) return jsonResponse({ error: 'No case' }, 404);
        const submitConsent = await loadConsentState(admin, c.id);
        if (!submitConsent.satisfied) return consentRequiredResponse(submitConsent);
        const [{ data: sections }, { data: reqs }, { data: docs }, { data: consents }] = await Promise.all([
          admin.schema('aml').from('questionnaire_responses').select('*').eq('case_id', c.id),
          admin.schema('aml').from('document_requirements').select('*').eq('case_id', c.id),
          admin.schema('aml').from('documents').select('*').eq('case_id', c.id).neq('status', 'deleted'),
          admin.schema('aml').from('consents')
            .select('kind, version, accepted_at, document_hash').eq('case_id', c.id),
        ]);
        const missingRequired = (reqs ?? []).filter((r: any) => r.required && !['uploaded','accepted'].includes(r.status));
        if (missingRequired.length > 0) {
          return jsonResponse({
            error: 'Cannot submit — required documents missing',
            missing: missingRequired.map((r: any) => ({ code: r.code, label: r.label })),
          }, 400);
        }
        // Phase 5: every currently-applicable section must be submitted before
        // the client can finalise (the checklist itself is conditional).
        const bySection = new Map((sections ?? []).map((s: any) => [s.section, s]));
        const active = applicableQuestionnaireSections(
          (name) => bySection.get(name)?.payload ?? null);
        const missingSections = active.filter((s) => {
          const response = bySection.get(s);
          return !['submitted', 'accepted', 'complete'].includes(response?.status ?? '') ||
            validateQuestionnaireSection(
              s,
              response?.payload,
              bySection.get('purchasing_structure')?.payload,
            ).length > 0;
        });
        if (missingSections.length > 0) {
          return jsonResponse({
            error: 'Cannot submit — some sections are incomplete',
            missing_sections: missingSections,
          }, 400);
        }
        /**
         * The canonical gate — the SAME rule the journey renders as "ready to
         * send" (`submissionBlockers` in portalJourney.pure.ts). The two checks
         * above stay for their detailed error payloads; this is the authority,
         * and it closes the two holes they left: identity verification was
         * never consulted at all, and a rejected document against a
         * requirement row still marked `uploaded` slipped the row-only check.
         * Documents with NO requirement rows stay optional here exactly as
         * they are in the journey — see `stepHoldsSubmission`. A caller who
         * skips the portal UI meets exactly the same rule the UI shows.
         */
        const submitBlockers = submissionBlockers({
          consent: 'complete',       // gated above by loadConsentState
          questionnaire: 'complete', // gated above via missingSections
          documents: documentsJourneyStatus({
            requirements: reqs ?? [],
            documents: (docs ?? []).map((d: any) => ({
              requirement_id: d.requirement_id, status: d.status,
            })),
          }),
          verification: verificationJourneyStatus(await verificationParties(admin, c.id)),
        });
        if (submitBlockers.length > 0) {
          const blockerLabels: Record<string, string> = {
            documents: 'documents', verification: 'identity verification',
            consent: 'consents', questionnaire: 'your information',
          };
          return jsonResponse({
            error: `Cannot submit — still outstanding: ${
              submitBlockers.map((b) => blockerLabels[b] ?? b).join(', ')}`,
            code: 'submission_requirements_incomplete',
            blockers: submitBlockers,
          }, 400);
        }
        const { data: lastSub } = await admin.schema('aml').from('submission_versions')
          .select('version_number').eq('case_id', c.id).order('version_number', { ascending: false }).limit(1);
        const nextVersion = ((lastSub ?? [])[0]?.version_number ?? 0) + 1;
        const snapshot = {
          case: { id: c.id, reference: c.case_reference, subject: c.subject_display_name },
          questionnaire_version: QUESTIONNAIRE_VERSION,
          consent_version: submitConsent.version,
          applicable_sections: active,
          sections: sections ?? [], requirements: reqs ?? [], documents: docs ?? [], consents: consents ?? [],
          submitted_by: { id: portalUserId, label: actorLabel },
        };
        const { data: sub, error } = await admin.schema('aml').from('submission_versions').insert({
          case_id: c.id, version_number: nextVersion, snapshot,
          submitted_by_type: 'client', submitted_by: portalUserId,
        }).select('*').single();
        if (error) throw error;
        // Push case status forward (draft → kyc_in_progress → kyc_complete for
        // review) and keep the Phase 1 dimension columns coherent; retry
        // without them when the workflow-dimension migration is not applied.
        if (['draft','kyc_in_progress'].includes(c.status)) {
          const { error: upErr } = await admin.schema('aml').from('cases')
            .update({ status: 'kyc_complete', case_stage: 'client_submitted', client_portal_status: 'submitted' })
            .eq('id', c.id);
          if (upErr) {
            await admin.schema('aml').from('cases').update({ status: 'kyc_complete' }).eq('id', c.id);
          }
        }
        return jsonResponse({ submission: sub, next_version: nextVersion });
      }

      default:
        return jsonResponse({ error: `Unknown op: ${op}` }, 400);
    }
  } catch (err: any) {
    console.error('aml-client-portal error', err);
    return jsonResponse({ ...internalError(err, 'aml-client-portal') }, 500);
  }
};

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. This function is browser-reachable and its callers
// send `credentials: 'include'`, and the Fetch spec makes the browser reject a
// credentialed response carrying `Access-Control-Allow-Origin: *` — opaquely,
// as "Failed to fetch". See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));

