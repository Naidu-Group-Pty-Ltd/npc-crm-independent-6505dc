/**
 * AML/CTF Case Engine (Phase 1)
 *
 * Ops:
 *  - list           { status?, risk?, assigned_to_me?, search?, limit?, offset? }
 *  - get            { case_id }
 *  - create         { subject_display_name, subject_type?, client_id?, purchase_file_id?, risk_rating?, notes? }
 *  - update         { case_id, patch: { subject_display_name?, risk_rating?, risk_score?, assigned_analyst_id?, assigned_mlro_id?, metadata? } }
 *  - transition     { case_id, to_status, reason? }
 *  - append_event   { case_id, category, summary, payload? }
 *  - list_events    { case_id, limit? }
 *
 * All writes are appended to `aml.case_events` with a per-case SHA-256 hash chain
 * (prev_hash + row_hash) for tamper-evidence. Reads require any AML role; writes
 * require action-specific analyst/reviewer/mlro authorization. Because this
 * function uses the service role, these checks enforce the underlying RLS role
 * boundaries in code as well.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { verifyAuth } from "../_shared/auth.ts";
import {
  diffSubmissions, submissionDiffIsMaterial,
  CLIENT_SAFE_REJECTION_REASONS, CLIENT_SAFE_REJECTION_COPY, isClientSafeRejectionReason,
} from "../_shared/aml/submissionReview.ts";
import {
  CLIENT_SEARCH_SELECT,
  buildClientSearchOrFilter,
  sanitizeClientSearchQuery,
  selectActivationMatches,
  selectActivationPage,
  tokenizeClientSearch,
  toActivationClientResult,
  isBrowseQuery,
  isClientPickerStatus,
  orderBrowsedClients,
  clampPageSize,
  clampOffset,
  type ClientSearchRow,
  type ClientPickerStatus,
} from "../_shared/aml/clientSearchMatch.pure.ts";
import { sanitiseDocumentName } from "../_shared/aml/documentNaming.pure.ts";
// The submission record: one structure, three presentations (read on screen,
// downloaded, stored on the case). Shared with the browser so what the
// reviewer read and what the case retains cannot disagree.
import {
  SUBMISSION_RECORD_DOCUMENT_KIND, buildSubmissionRecord, renderSubmissionRecordHtml,
} from "../_shared/aml/submissionRecord.pure.ts";
import {
  processScreeningEvent, recordTechnicalFailure,
} from "../_shared/aml/screeningConsumer.ts";
import { readSanctionsDeclaration } from "../_shared/aml/sanctionsDeclaration.pure.ts";
// What the customer said about political exposure. Evidence towards the
// determination a reviewer or the MLRO records; never the determination.
import { readPepDeclaration } from "../_shared/aml/pepDeclaration.pure.ts";
// What a determination must rest on, and why a sanctions register is not a
// PEP source. Shared with the dialog that collects it.
import {
  assessPepDeferral, assessPepEvidence, normalisePepMethods,
} from "../_shared/aml/pepEvidence.pure.ts";
// The public office-holder index: what a search of it may and may not say.
import {
  PEP_INDEX_SOURCES, describeCoverage, indexIsUsable, searchVerdict,
  type PepIndexCandidate,
} from "../_shared/aml/pepOfficeholderIndex.pure.ts";
import { assessIndexRecency } from "../_shared/aml/pepOfficeholderIndex.pure.ts";
import {
  admitCandidate, comparePepDob, rankCandidate, resolveSubjectDob,
} from "../_shared/aml/pepCandidateMatch.pure.ts";
import { normaliseName, scoreNames } from "../_shared/aml/matching.ts";
// The screening engine: what the platform can establish by itself, and the
// line it may never cross. It screens; it never determines.
import {
  SERVER_UNREACHABLE_SOURCES, buildScreeningRun, runIsEvidence, runToMethodDraft,
  type PepScreeningCandidate, type PepScreeningSourceResult,
} from "../_shared/aml/pepScreeningEngine.pure.ts";
// `aml.cases` has no tenant_id column. This is the only place that knows it.
import {
  DEFAULT_AML_TENANT, readCase, tenantForCase,
} from "../_shared/aml/caseTenant.ts";
import { planCaseReopen, resumeStatusFor } from "../_shared/aml/caseReopen.pure.ts";
import {
  AML_PURGE_ORDER, AML_UNLINKED_CASE_TABLES, decideClientReset,
} from "../_shared/aml/clientResetPolicy.pure.ts";
import {
  ALL_SCREENING_SCOPES,
  decideScreeningPolicy,
  deriveMissingScreeningSubjects,
  deriveScreeningNextAction,
  deriveScreeningScope,
  PERIMETER_REASON_CODES,
  PRIMARY_SUBJECT_PARTY_TYPE,
  providerReadinessRelevant,
  reconcileSubjectToScope,
  SCREENING_POLICY_VERSION,
  SCREENING_STALL_SECONDS,
  recoverableSubjects,
  type ScreeningScopeDecision,
  type ScreeningScopeKey,
} from "../_shared/aml/screeningPolicy.pure.ts";
import {
  manualScreeningAdmissible,
  planManualScreening,
  projectManualScreeningToSubject,
} from "../_shared/aml/manualScreening.pure.ts";
import {
  computeRefreshDueAt,
  inlineConvergenceDecision,
  isPartyScreeningMissing,
  projectPartyScreeningState,
} from "../_shared/aml/partyScreening.pure.ts";

import {
  sanitiseActionCode, sanitiseActionTarget,
} from "../_shared/aml/clientRequestContract.pure.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { withRequestOrigin } from "../_shared/corsOrigin.ts";
import { internalError } from '../_shared/errorResponse.ts';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-session-token, x-command-centre-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const CASE_STATUSES = [
  'draft', 'kyc_in_progress', 'kyc_complete', 'edd_required',
  'under_review', 'escalated_mlro', 'cleared', 'blocked', 'closed',
] as const;

const RISK_RATINGS = ['low', 'medium', 'high', 'prohibited'] as const;
/** The subject types the schema accepts. The `list` filter allow-lists against this. */
const SUBJECT_TYPES = ['individual', 'entity', 'trust'];

const EVENT_CATEGORIES = [
  'case_created', 'status_changed', 'risk_rescored', 'document_added',
  'idv_result', 'pep_sanctions_hit', 'edd_note', 'mlro_decision',
  'austrac_report', 'system',
] as const;

const MLRO_ONLY_EVENT_CATEGORIES = new Set<string>(['mlro_decision', 'system']);

/**
 * The consent versions currently in force.
 *
 * A reopen re-asks only for consents whose version has moved since the client
 * accepted — an acceptance is evidence of what they agreed to at the time,
 * not authority for a document that has since changed.
 */
const CURRENT_CONSENT_VERSIONS: Record<string, string> = {
  aml_ctf_program: '2026.2',
  privacy_notice: '2026.2',
  identity_verification: '2026.2',
  biometric_collection: '2026.2',
  compliance_sharing: '2026.2',
  record_keeping: '2026.2',
  regulatory_reporting: '2026.2',
};

// Allowed transitions (defence-in-depth on top of MLRO overrides)
const TRANSITIONS: Record<string, string[]> = {
  draft: ['kyc_in_progress', 'closed'],
  kyc_in_progress: ['kyc_complete', 'edd_required', 'blocked', 'closed'],
  kyc_complete: ['under_review', 'edd_required', 'cleared', 'closed'],
  edd_required: ['under_review', 'escalated_mlro', 'blocked', 'closed'],
  under_review: ['cleared', 'escalated_mlro', 'edd_required', 'blocked', 'closed'],
  escalated_mlro: ['cleared', 'blocked', 'closed'],
  cleared: ['under_review', 'closed'],
  blocked: ['under_review', 'closed'],
  closed: [],
};

// Phase 1 canonical workflow dimensions. The legacy `status` column remains the
// compatibility source of truth; these deterministic maps keep the new
// dimension columns coherent while V2 surfaces still drive `status` only.
// Must stay in sync with src/lib/aml/caseDimensions.ts and the backfill in
// supabase/migrations/20260725153000_aml_case_workflow_dimensions.sql.
const STATUS_TO_STAGE: Record<string, string> = {
  draft: 'draft',
  kyc_in_progress: 'client_in_progress',
  kyc_complete: 'client_submitted',
  edd_required: 'enhanced_cdd',
  under_review: 'staff_review',
  escalated_mlro: 'decision_pending',
  cleared: 'cleared',
  blocked: 'blocked',
  closed: 'closed',
};
const STATUS_TO_CLIENT_PORTAL: Record<string, string> = {
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
// Conservative gate sync for legacy-driven transitions. Explicit gate
// decisions (Phase 8) will supersede this; only `cleared` reads as approved.
const STATUS_TO_SERVICE_GATE: Record<string, string> = {
  draft: 'not_activated',
  kyc_in_progress: 'cdd_incomplete',
  kyc_complete: 'under_review',
  edd_required: 'information_outstanding',
  under_review: 'under_review',
  escalated_mlro: 'under_review',
  cleared: 'approved',
  blocked: 'locked',
  closed: 'terminated',
};

/**
 * True when a write failed only because the Phase 1 dimension columns have not
 * been migrated in this environment yet (edge functions deploy independently
 * of migrations). Callers retry without the new columns so the legacy contract
 * keeps working — fail-open on columns, never on authorization.
 */
function isMissingColumnError(error: any): boolean {
  const msg = String(error?.message ?? '');
  return error?.code === 'PGRST204'
    || /column .* does not exist/i.test(msg)
    || /Could not find the '.*' column/i.test(msg);
}

/**
 * True when an RPC call failed only because the function has not been migrated
 * in this environment yet (edge functions deploy independently of migrations).
 * Same fail-open-on-schema, never-on-authorization posture as
 * isMissingColumnError above.
 */
function isMissingFunctionError(error: any): boolean {
  const msg = String(error?.message ?? '');
  return error?.code === 'PGRST202'
    || /Could not find the function/i.test(msg)
    || /function .* does not exist/i.test(msg);
}

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Make sure everyone this case must screen actually holds a subject row.
 *
 * ── Why this is a repair and not a feature ────────────────────────────
 * `party_screening_subjects` was only ever written when an operator resolved
 * a RELATED-PARTY reconciliation item. The case subject — the customer the
 * case is about — was never enrolled by anything, despite
 * `partyScreening.pure.ts` stating that "the case subject is always
 * assessed". A straightforward individual purchase declares no related
 * parties, so it produced no reconciliation items, no subjects, and a Stage 5
 * with nothing to screen and nothing to press. Measured on this deployment:
 * 0 subjects across every case, including one with three submissions.
 *
 * It runs on READ as well as on sync, and returns only what is missing, so
 * every existing case self-heals the first time somebody opens it. It is
 * idempotent by identity (party type + party id + name), never by a flag.
 *
 * It enrols people. It screens nobody and decides no outcome.
 */
/**
 * Run a screening request NOW, and guarantee it lands somewhere.
 *
 * ── The silence this closes ───────────────────────────────────────────
 * Inline execution already existed, and its failure went into a field on the
 * response that no surface reads. Measured in production on 2026-08-18: a
 * subject queued at 08:05:58 was still `queued` twenty-seven minutes later
 * with `error_category` null, no screening check, and no case event — while
 * the stage told the operator "nothing has picked it up".
 *
 * Something HAD picked it up. It failed, and the failure was discarded.
 *
 * Meanwhile the durable path behind it was dead too: every
 * `aml.screening.requested` row in that deployment carries `attempts = 0`,
 * because the worker's cron invocation is rejected with
 * `invalid_internal_signature` (2,839 denials recorded in `security_events`).
 * So neither path converged and neither said so.
 *
 * ── The rule ──────────────────────────────────────────────────────────
 * An operator action must never come to rest on `queued`. After the attempt
 * this RE-READS the subject, and if it is still unclaimed with no check and
 * no recorded category, it records one. A person then sees a reason instead
 * of a spinner, and the explicit Retry has something concrete to retry.
 *
 * It produces no screening OUTCOME. `state: 'error'` leaves the scope
 * outstanding and the stage blocked; nothing here can read as clear.
 */
async function runScreeningInline(
  admin: any,
  subjectId: string,
): Promise<{ ran: boolean; converged: boolean; error?: string; category?: string }> {
  let failure: string | null = null;
  try {
    await processScreeningEvent(admin, {
      payload: { party_screening_subject_id: subjectId },
    });
  } catch (e) {
    failure = (e instanceof Error ? e.message : String(e)).slice(0, 300);
  }

  const { data: after } = await admin.schema('aml').from('party_screening_subjects')
    .select('id, case_id, screened_name, state, error_category, screening_check_id')
    .eq('id', subjectId).maybeSingle();

  const verdict = inlineConvergenceDecision(after, failure);
  if (verdict === 'settled') {
    return { ran: failure === null, converged: true, error: failure ?? undefined };
  }
  if (verdict === 'in_flight') {
    // A concurrent holder owns it and will converge it. Touching it here
    // would break the at-most-once guarantee the claim provides.
    return { ran: false, converged: true, error: failure ?? undefined };
  }

  const category = 'worker_not_invoked';
  await recordTechnicalFailure(
    admin,
    { id: subjectId, case_id: after.case_id, screened_name: after.screened_name },
    category,
    failure ?? 'inline execution returned without claiming the subject, and the '
      + 'outbox worker has not consumed the queued request',
  );
  return { ran: false, converged: true, error: failure ?? undefined, category };
}

/**
 * The re-screening interval, read from the same monitoring rule the automated
 * consumer reads (`_shared/aml/screeningConsumer.ts`).
 *
 * A manual result has to age on exactly the clock an automated one ages on,
 * or the two methods would disagree about when a party is due again — and the
 * whole point of recording a manual screening as a canonical check is that
 * nothing downstream has to know which method produced it.
 */
async function rescreenIntervalDays(admin: any): Promise<number> {
  const { data } = await admin.schema('aml').from('monitoring_rules')
    .select('criteria').eq('trigger_kind', 'rescreen_due').eq('is_enabled', true)
    .limit(1).maybeSingle();
  const days = Number((data?.criteria as any)?.interval_days ?? 365);
  return Number.isFinite(days) && days > 0 ? days : 365;
}

/**
 * Read the case's operative perimeter classification.
 *
 * Anything absent, superseded or unreadable is INSIDE the perimeter, which
 * is what `readPerimeter` in the pure module also concludes. Two layers
 * agreeing on fail-closed is deliberate: this is the one read whose failure
 * mode would be a silent sanctions exemption.
 */
async function readCasePerimeter(admin: any, caseId: string): Promise<any | null> {
  const { data, error } = await admin.schema('aml').from('case_screening_perimeter')
    .select('*').eq('case_id', caseId).is('superseded_at', null).maybeSingle();
  if (error) return null;
  return data ?? null;
}

/**
 * Record the scope decision, and reconcile what it implies for the subjects.
 *
 * ── Why the decision is STORED and not just computed ──────────────────
 * It used to be recomputed on every read and written only as a case event.
 * That is enough to explain one case to one person and not enough for
 * anything else: nothing could gate on it, and "which cases were exempted
 * from sanctions screening, on what basis, under which policy version" —
 * the question an audit actually asks — had no answer at all.
 *
 * Rows are superseded rather than updated, so a case that moves between
 * policy versions carries both decisions and the earlier one stays exactly
 * as it was made.
 *
 * ── The mapping onto subjects ─────────────────────────────────────────
 * `PARTY_SCREENING_SCOPE` in the consumer is `['sanctions']`: a party
 * screening run IS a sanctions run. So `party_screening_subjects.required`
 * means "this party must be sanctions-screened", and it follows the
 * sanctions scope exactly. PEP is unaffected — it is established through
 * `pep_determinations`, not by this provider — which is what lets sanctions
 * be not_required while PEP stays mandatory.
 *
 * ── The one thing an exemption does NOT do ────────────────────────────
 * A subject that already holds a FINDING keeps `required = true`, whatever
 * the perimeter says. Once a candidate or confirmed match exists you cannot
 * un-know it, and the obligation to deal with a positive result comes from
 * the sanction itself rather than from the screening obligation that
 * surfaced it. Standing that down would be the one genuinely dangerous
 * reading of "not required".
 *
 * Evidence is never destroyed either: a completed check keeps its result and
 * its `screening_check_id`; only the obligation flag moves.
 */
async function syncScreeningScopeDecision(
  admin: any,
  caseId: string,
  scope: ScreeningScopeDecision,
  perimeterId: string | null,
  subjects: any[],
): Promise<{ changed: ScreeningScopeKey[]; subjectsChanged: number; recorded: boolean }> {
  /*
   * ── The migration may not have been applied yet ────────────────────
   *
   * Migrations here are applied by a dispatched workflow, one file at a
   * time, while functions deploy on merge. So the two can land in either
   * order, and this repository has already paid for assuming otherwise:
   * `finance-portal-notifications` filtered every read on columns from a
   * migration that was merged and never applied, PostgREST answered 42703
   * for the whole statement, and the feed returned 500 for three weeks.
   *
   * So the table is PROBED. Without it the decision is still derived and
   * still governs the stage — it simply is not recorded yet, and the next
   * sync after the migration lands records it. What it must never do is
   * take the stage down, and it must never let an unreadable table look
   * like an exemption: with no perimeter row readable, `deriveScreeningScope`
   * has already concluded sanctions is required.
   */
  const { data: current, error: readError } = await admin.schema('aml')
    .from('case_screening_scopes')
    .select('*').eq('case_id', caseId).is('superseded_at', null);
  if (readError) {
    return { changed: [], subjectsChanged: 0, recorded: false };
  }
  /*
   * ── ONE LIVE DECISION PER SCOPE, MADE STRUCTURAL ──────────────────────
   *
   * This was `new Map(current.map((r) => [r.scope, r]))`, which keeps only
   * the LAST row for a scope and discards the rest. The loop below then
   * supersedes the one row the map kept — so if a scope ever holds two live
   * rows, one of them survives for ever.
   *
   * No case in production holds duplicates today, and this path cannot
   * create them on its own: it always supersedes before it inserts. What it
   * does not survive is a RACE. `sync_screening_stage` runs on every page
   * load, so two tabs opening one case can both read the single live row,
   * both supersede it, and both insert — leaving two live rows that disagree
   * about whether screening is required.
   *
   * That is worth closing rather than watching for, because of what reads
   * these rows. `deriveAmlScreeningScope` resolved them last-wins over a
   * `SELECT` with no `ORDER BY`, so a contradiction would have been settled
   * by row order — and the scope most likely to flip is `sanctions`, the one
   * obligation in this product that binds every dealing and cannot be stood
   * down by risk.
   *
   * So: every live row for a scope is collected, the newest is the decision,
   * and any older ones are superseded whether or not the decision changed.
   * A case that ever acquires duplicates repairs itself the next time
   * anything syncs it — the same self-healing-on-read pattern
   * `ensureScreeningSubjects` uses. The reader was also made to resolve a
   * contradiction toward the obligation rather than toward row order.
   */
  const liveByScope = new Map<string, any[]>();
  for (const r of current ?? []) {
    const list = liveByScope.get(String(r.scope)) ?? [];
    list.push(r);
    liveByScope.set(String(r.scope), list);
  }
  const newestFirst = (a: any, b: any) =>
    String(b.decided_at ?? b.created_at ?? '').localeCompare(
      String(a.decided_at ?? a.created_at ?? ''));
  for (const list of liveByScope.values()) list.sort(newestFirst);

  const changed: ScreeningScopeKey[] = [];
  const nowIso = new Date().toISOString();

  /*
   * Retire the duplicates first, and for EVERY scope — including the ones
   * whose decision has not changed and would `continue` below before
   * reaching any write.
   */
  for (const [scopeKey, list] of liveByScope) {
    if (list.length < 2) continue;
    const stale = list.slice(1).map((r: any) => r.id);
    const { error: dedupeError } = await admin.schema('aml')
      .from('case_screening_scopes')
      .update({ superseded_at: nowIso }).in('id', stale);
    if (dedupeError) {
      console.error('case_screening_scopes dedupe failed', scopeKey, dedupeError);
      return { changed: [], subjectsChanged: 0, recorded: false };
    }
  }

  for (const key of ALL_SCREENING_SCOPES) {
    const decided = scope[key];
    const existing = (liveByScope.get(key) ?? [])[0];
    // Re-recording an unchanged decision on every page load would bury the
    // trail it exists to provide. A CHANGE is what deserves a new row.
    const same = existing &&
      existing.required === decided.required &&
      String(existing.reason_code) === decided.reasonCode &&
      String(existing.policy_version) === scope.policyVersion;
    if (same) continue;
    if (existing) {
      await admin.schema('aml').from('case_screening_scopes')
        .update({ superseded_at: nowIso }).eq('id', existing.id);
    }
    const { error: insertError } = await admin.schema('aml')
      .from('case_screening_scopes').insert({
      case_id: caseId,
      scope: key,
      required: decided.required,
      optional: decided.optional,
      state: decided.required ? 'required' : 'not_required',
      reason_code: decided.reasonCode,
      reason: decided.reason,
      policy_version: scope.policyVersion,
      decision_source: 'server_policy',
      material_inputs: scope.evidence,
      perimeter_id: perimeterId,
    });
    if (insertError) return { changed: [], subjectsChanged: 0, recorded: false };
    changed.push(key);
  }

  /* ── Reconcile the subjects with the sanctions scope ────────────── */
  // The DECISION is `reconcileSubjectToScope` in the pure module, unit-tested
  // there. This applies it and does nothing else, so the interesting rules
  // cannot only be checked by reading this file.
  const sanctionsRequired = scope.sanctions.required;
  let subjectsChanged = 0;

  for (const s of subjects ?? []) {
    const decision = reconcileSubjectToScope(
      {
        state: String(s.state),
        required: s.required === true,
        voluntaryRunAt: s.voluntary_run_at ?? null,
      },
      sanctionsRequired,
    );
    if (!decision.patch) continue;
    /*
     * Retire any queued request BEFORE standing the subject down. A pending
     * outbox row that a worker claims a second later would run the provider
     * for a scope the policy just said is not required — and bill for it.
     * Scoped by aggregate_id, which the emitting trigger sets to the subject
     * id; retiring on event_type alone would retire every other case's
     * pending request too.
     */
    if (decision.retireQueued) {
      await admin.from('integration_outbox')
        .update({
          processed_at: nowIso, locked_at: null, locked_by: null,
          last_error: 'superseded_by_scope_decision',
        })
        .eq('event_type', 'aml.screening.requested')
        .eq('aggregate_id', s.id)
        .is('processed_at', null);
    }
    await admin.schema('aml').from('party_screening_subjects')
      .update({ ...decision.patch, updated_at: nowIso }).eq('id', s.id);
    subjectsChanged++;
  }

  return { changed, subjectsChanged, recorded: true };
}

async function ensureScreeningSubjects(
  admin: any,
  caseId: string,
  actorId: string | null,
  actorLabel: string | null,
): Promise<{ subjects: any[]; enrolled: number; personalDetails: Record<string, unknown> | null; hasSubmission: boolean }> {
  const [{ data: caseRow }, { data: submission }, { data: recon }, { data: existing }] =
    await Promise.all([
      admin.schema('aml').from('cases')
        .select('id, subject_display_name').eq('id', caseId).maybeSingle(),
      admin.schema('aml').from('submission_versions')
        .select('snapshot, submitted_at').eq('case_id', caseId).is('superseded_at', null)
        .order('version_number', { ascending: false }).limit(1).maybeSingle(),
      admin.schema('aml').from('party_reconciliation_items').select('*').eq('case_id', caseId),
      admin.schema('aml').from('party_screening_subjects')
        .select('*').eq('case_id', caseId).order('created_at', { ascending: true }),
    ]);

  const sections = (((submission?.snapshot ?? {}) as any).sections ?? []) as any[];
  const sectionPayload = (name: string): Record<string, unknown> | null => {
    const found = sections.find((x: any) => x?.section === name);
    return found?.payload && typeof found.payload === 'object' ? found.payload : null;
  };
  const personalDetails = sectionPayload('personal_details');
  // Names the client disclosed under Australian Sanctions & Compliance
  // Screening. They widen what the matcher searches on; they never change
  // whether the subject is screened.
  const declaration = readSanctionsDeclaration(sectionPayload('sanctions_screening'));
  const hasSubmission = Boolean(submission);

  if (!caseRow) return { subjects: existing ?? [], enrolled: 0, personalDetails, hasSubmission };

  const missing = deriveMissingScreeningSubjects({
    subjectDisplayName: caseRow.subject_display_name ?? null,
    personalDetails,
    declaredAliases: declaration?.aliases ?? null,
    reconciled: (recon ?? []).map((r: any) => ({
      id: String(r.id),
      declaredName: String(r.declared_name ?? ''),
      declaredRole: String(r.declared_role ?? ''),
      resolvedPartyType: r.resolved_party_type ?? null,
      resolvedPartyId: r.resolved_party_id ?? null,
      screeningRequired: Boolean(r.screening_required),
      resolutionStatus: String(r.resolution_status ?? ''),
      declaredPayload: (r.declared_payload ?? null) as Record<string, unknown> | null,
    })),
    existing: (existing ?? []).map((e: any) => ({
      partyType: String(e.party_type), partyId: e.party_id ?? null,
      screenedName: String(e.screened_name ?? ''),
    })),
  });

  if (missing.length === 0) {
    return { subjects: existing ?? [], enrolled: 0, personalDetails, hasSubmission };
  }

  const { error: insertError } = await admin.schema('aml').from('party_screening_subjects')
    .insert(missing.map((m) => ({
      case_id: caseId,
      party_type: m.partyType,
      party_id: m.partyId,
      reconciliation_item_id: m.reconciliationItemId,
      screened_name: m.screenedName,
      aliases: m.aliases,
      date_of_birth: m.dateOfBirth,
      country: m.country,
      required: true,
      state: 'not_started',
    })));
  // An enrolment failure must not take the read down with it — the caller
  // still gets the subjects that do exist, and the next action reports the
  // shortfall rather than offering a check with nobody to run it on.
  if (insertError) {
    return { subjects: existing ?? [], enrolled: 0, personalDetails, hasSubmission };
  }

  await appendEvent(admin, caseId, 'system',
    `Enrolled ${missing.length} part${missing.length === 1 ? 'y' : 'ies'} for screening`,
    {
      enrolled: missing.map((m) => ({ party_type: m.partyType, name: m.screenedName })),
      reason: 'screening_enrolment',
    },
    actorId, actorLabel);

  const { data: refreshed } = await admin.schema('aml').from('party_screening_subjects')
    .select('*').eq('case_id', caseId).order('created_at', { ascending: true });
  return {
    subjects: refreshed ?? existing ?? [], enrolled: missing.length,
    personalDetails, hasSubmission,
  };
}

async function appendEvent(
  admin: any,
  caseId: string,
  category: string,
  summary: string,
  payload: Record<string, any>,
  actorId: string | null,
  actorLabel: string | null,
) {
  const { data: prev } = await admin
    .schema('aml')
    .from('case_events')
    .select('row_hash, created_at')
    .eq('case_id', caseId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const prevHash = prev?.row_hash ?? null;
  const now = new Date().toISOString();
  const canonical = JSON.stringify({
    case_id: caseId,
    category,
    summary,
    payload: payload ?? {},
    actor_id: actorId,
    actor_label: actorLabel,
    prev_hash: prevHash,
    created_at: now,
  });
  const rowHash = await sha256Hex(canonical);

  const { data, error } = await admin
    .schema('aml')
    .from('case_events')
    .insert({
      case_id: caseId,
      category,
      summary,
      payload: payload ?? {},
      actor_id: actorId,
      actor_label: actorLabel,
      prev_hash: prevHash,
      row_hash: rowHash,
      created_at: now,
    })
    .select('id, created_at, category, summary, prev_hash, row_hash')
    .single();

  if (error) throw error;
  return data;
}

async function generateCaseReference(admin: any): Promise<string> {
  const year = new Date().getUTCFullYear();
  const prefix = `AML-${year}-`;
  const { count } = await admin
    .schema('aml')
    .from('cases')
    .select('id', { count: 'exact', head: true })
    .ilike('case_reference', `${prefix}%`);
  const seq = String((count ?? 0) + 1).padStart(5, '0');
  return `${prefix}${seq}`;
}

/**
 * The complete submission review for one case, composed once.
 *
 * `get_submission_review` answers the screen from it and
 * `store_submission_record` renders the stored record from it — the same
 * queries, the same staleness reading, the same first-submission rule. Two
 * compositions would be two opinions about what the review contains, and the
 * stored record's whole value is that it says what the screen said.
 */
async function composeSubmissionReview(
  admin: any,
  caseId: string,
  versionNumber: number | null,
  includeInternalNotes: boolean,
): Promise<{ status: number; payload: any }> {
  const { data: caseRow } = await admin.schema('aml').from('cases')
    .select('*').eq('id', caseId).maybeSingle();
  if (!caseRow) return { status: 404, payload: { error: 'Case not found' } };

  const { data: versions } = await admin.schema('aml').from('submission_versions')
    .select('*').eq('case_id', caseId).order('version_number', { ascending: false });
  const all = versions ?? [];
  const current = versionNumber ? all.find((v: any) => v.version_number === versionNumber) : all[0];
  if (!current) {
    return { status: 200, payload: { submission: null, versions: [], message: 'No client submission yet.' } };
  }
  const previous = all.find((v: any) => v.version_number < current.version_number) ?? null;

  const snap = (current.snapshot ?? {}) as any;
  /*
   * Only diff when there is a previous version to differ FROM.
   *
   * This compared against `previous?.snapshot ?? {}`, so a FIRST
   * submission was diffed against nothing: every answered field became
   * a "change", the diff came back material, and
   * `material_information_changed` joined the risk-stale reasons — the
   * screen then showed a red "20 · material" badge directly above the
   * sentence "This is the first submission." A first submission is not
   * changed information; it is the information.
   */
  const prevSnap = (previous?.snapshot ?? {}) as any;
  const diff = previous
    ? diffSubmissions(snap.sections ?? [], prevSnap.sections ?? [])
    : [];

  const [{ data: reqs }, { data: docs }, { data: consents }, { data: recon },
         { data: checks }, { data: screening }, { data: openReqs }, { data: assessment },
         { data: pepDets }] = await Promise.all([
    admin.schema('aml').from('document_requirements').select('*').eq('case_id', caseId),
    admin.schema('aml').from('documents')
      .select('id, requirement_id, filename, mime_type, size_bytes, status, uploaded_at, reviewed_at, client_safe_rejection_reason, internal_review_note, version_number, previous_document_id, replacement_document_id, metadata')
      .eq('case_id', caseId).order('uploaded_at', { ascending: false }),
    admin.schema('aml').from('consents').select('kind, version, accepted_at, document_hash').eq('case_id', caseId),
    admin.schema('aml').from('party_reconciliation_items').select('*').eq('case_id', caseId),
    admin.schema('aml').from('verification_checks')
      .select('id, party_id, party_label, check_type, status, processing_status, attempt_consumed, authoritative, execution_mode, provider, completed_at, provider_error_category')
      .eq('case_id', caseId).order('created_at', { ascending: false }),
    admin.schema('aml').from('party_screening_subjects').select('*').eq('case_id', caseId),
    admin.schema('aml').from('client_requests').select('id, kind, subject, status, action_code, created_at')
      .eq('case_id', caseId).in('status', ['open', 'responded']),
    admin.schema('aml').from('risk_assessments').select('id, created_at, rating, score')
      .eq('case_id', caseId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    admin.schema('aml').from('pep_determinations')
      .select('id, determined_at').eq('case_id', caseId),
  ]);

  /*
   * A stored submission record is an export OF this review, never evidence
   * IN it: listing it among the client's documents would make every stored
   * record change the next one, and would count a staff export as client
   * evidence. Filtered in code — a PostgREST `.neq()` on `metadata->>kind`
   * would also drop every row where the key is absent, because in SQL
   * `null <> 'x'` is null.
   */
  const evidenceDocs = (docs ?? []).filter(
    (d: any) => d?.metadata?.kind !== SUBMISSION_RECORD_DOCUMENT_KIND,
  );

  // Risk staleness: any canonical verification outcome or reconciliation
  // change after the latest assessment makes it stale, with reasons.
  const staleReasons: string[] = [];
  if (assessment?.created_at) {
    const since = new Date(assessment.created_at).getTime();
    if ((checks ?? []).some((c: any) => c.completed_at && new Date(c.completed_at).getTime() > since)) staleReasons.push('verification_changed');
    if ((recon ?? []).some((r: any) => new Date(r.updated_at ?? r.created_at).getTime() > since)) staleReasons.push('party_reconciliation_changed');
    if ((screening ?? []).some((s: any) => s.adjudicated_at && new Date(s.adjudicated_at).getTime() > since)) staleReasons.push('screening_adjudicated');
    if ((pepDets ?? []).some((d: any) => d.determined_at && new Date(d.determined_at).getTime() > since)) staleReasons.push('pep_determination_recorded');
    if (new Date(current.submitted_at).getTime() > since) staleReasons.push('new_submission');
    if (submissionDiffIsMaterial(diff)) staleReasons.push('material_information_changed');
  } else {
    staleReasons.push('no_assessment');
  }

  const missing: string[] = [];
  for (const r of (reqs ?? [])) {
    if (r.required && !['uploaded', 'accepted'].includes(r.status)) missing.push(`document:${r.code}`);
  }
  for (const r of (recon ?? [])) {
    if (r.resolution_status === 'open') missing.push(`party_reconciliation:${r.declared_name}`);
  }
  // Every non-terminal state is outstanding — queued and processing are
  // work not yet done, and a technical error must stay outstanding and
  // retryable, never read as clear. A satisfied screening past its
  // refresh date is outstanding again. (Shared rule: partyScreening.pure.ts.)
  const nowIso = new Date().toISOString();
  for (const s of (screening ?? [])) {
    if (isPartyScreeningMissing(s, nowIso)) missing.push(`screening:${s.screened_name}`);
  }

  return { status: 200, payload: {
    case: {
      id: caseRow.id, reference: caseRow.case_reference, subject: caseRow.subject_display_name,
      status: caseRow.status, case_stage: caseRow.case_stage,
      client_portal_status: caseRow.client_portal_status,
      // Read-only context: acceptance never moves the gate.
      service_gate_status: caseRow.service_gate_status,
    },
    submission: {
      id: current.id, version_number: current.version_number,
      review_status: current.review_status ?? 'submitted',
      submitted_at: current.submitted_at, submitted_by_type: current.submitted_by_type,
      submitted_by: current.submitted_by,
      review_reason: current.review_reason ?? null,
      reviewed_at: current.review_decided_at ?? current.reviewed_at ?? null,
      questionnaire_version: snap.questionnaire_version ?? null,
      consent_version: snap.consent_version ?? null,
      applicable_sections: snap.applicable_sections ?? [],
      sections: snap.sections ?? [],
      superseded_at: current.superseded_at ?? null,
    },
    previous_version: previous ? { id: previous.id, version_number: previous.version_number, submitted_at: previous.submitted_at } : null,
    differences: diff,
    differences_material: submissionDiffIsMaterial(diff),
    versions: all.map((v: any) => ({
      id: v.id, version_number: v.version_number, submitted_at: v.submitted_at,
      review_status: v.review_status ?? 'submitted',
    })),
    consent_evidence: (consents ?? []).map((c: any) => ({
      kind: c.kind, version: c.version, accepted_at: c.accepted_at, document_hash: c.document_hash,
    })),
    related_parties: (recon ?? []).map((r: any) => ({
      id: r.id, declared_role: r.declared_role, declared_name: r.declared_name,
      change_kind: r.change_kind, resolution_status: r.resolution_status,
      resolved_party_type: r.resolved_party_type, resolved_party_id: r.resolved_party_id,
      verification_required: r.verification_required, screening_required: r.screening_required,
      conflicts: r.conflicts ?? [], similarity_candidates: r.similarity_candidates ?? [],
      exact_candidate_id: r.exact_candidate_id, exact_candidate_type: r.exact_candidate_type,
    })),
    requirements: reqs ?? [],
    documents: evidenceDocs.map((d: any) => ({
      ...d,
      // Internal reviewer reasoning is staff-only; auditors and analysts
      // may read it, but it never leaves this staff response.
      internal_review_note: includeInternalNotes ? d.internal_review_note : null,
    })),
    verification: (checks ?? []).map((c: any) => ({
      id: c.id, party_id: c.party_id, party_label: c.party_label, check_type: c.check_type,
      status: c.status, processing_status: c.processing_status,
      authoritative: c.authoritative, execution_mode: c.execution_mode,
      attempt_consumed: c.attempt_consumed, provider: c.provider,
      completed_at: c.completed_at, provider_error_category: c.provider_error_category,
    })),
    screening: screening ?? [],
    open_requests: openReqs ?? [],
    missing_mandatory: missing,
    risk: { latest_assessment_at: assessment?.created_at ?? null, stale: staleReasons.length > 0, stale_reasons: staleReasons },
  } };
}

const __corsWrappedHandler = (async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const auth = await verifyAuth(admin, req.headers, body);
    if (auth.error || !auth.userId || auth.userId === 'service_role') {
      return jsonResponse({ error: auth.error || 'Authentication required' }, 401);
    }
    const userId = auth.userId;
    const userEmail = auth.username ?? null;

    // Confirm caller has any AML role
    const { data: hasAny } = await admin.rpc('has_any_aml_role', { _user_id: userId });
    if (!hasAny) return jsonResponse({ error: 'AML role required' }, 403);

    // Load caller's roles for write-gating
    const { data: roleRows } = await admin
      .schema('aml')
      .from('role_assignments')
      .select('role')
      .eq('user_id', userId)
      .is('revoked_at', null);
    const roles = new Set<string>((roleRows ?? []).map((r: any) => r.role));
    const canWrite = roles.has('analyst') || roles.has('reviewer') || roles.has('mlro');
    const canCreate = roles.has('analyst') || roles.has('mlro');
    const isMlro = roles.has('mlro');

    const op = String(body?.op ?? '');
    if (!op) return jsonResponse({ error: 'op is required' }, 400);

    switch (op) {
      case 'list': {
        const limit = Math.min(Number(body.limit ?? 50), 200);
        const offset = Math.max(Number(body.offset ?? 0), 0);
        let q = admin
          .schema('aml')
          .from('cases')
          .select('*', { count: 'exact' })
          .order('opened_at', { ascending: false })
          .range(offset, offset + limit - 1);
        if (body.status && CASE_STATUSES.includes(body.status)) q = q.eq('status', body.status);
        if (body.risk && RISK_RATINGS.includes(body.risk)) q = q.eq('risk_rating', body.risk);
        /* Allow-listed like `status` and `risk`, never interpolated: this is
           the same shape those two use, and a subject type that is not one of
           the three the schema accepts is ignored rather than passed through.
           `not_individual` is its own value because the question a caller
           actually asks is "does this tenant hold any entity or trust case" —
           expressing that as a negation client-side means paging through
           every case to answer it. */
        if (body.subject_type === 'not_individual') {
          q = q.neq('subject_type', 'individual');
        } else if (SUBJECT_TYPES.includes(body.subject_type)) {
          q = q.eq('subject_type', body.subject_type);
        }
        if (body.assigned_to_me) q = q.or(`assigned_analyst_id.eq.${userId},assigned_mlro_id.eq.${userId}`);
        if (body.search) {
          const s = String(body.search).replace(/[%,]/g, ' ').trim();
          if (s) q = q.or(`subject_display_name.ilike.%${s}%,case_reference.ilike.%${s}%`);
        }
        const { data, count, error } = await q;
        if (error) throw error;
        return jsonResponse({ cases: data ?? [], total: count ?? 0, limit, offset });
      }

      case 'get': {
        if (!body.case_id) return jsonResponse({ error: 'case_id is required' }, 400);
        const { data: caseRow, error } = await admin
          .schema('aml').from('cases').select('*').eq('id', body.case_id).maybeSingle();
        if (error) throw error;
        if (!caseRow) return jsonResponse({ error: 'Not found' }, 404);
        const { data: events } = await admin
          .schema('aml').from('case_events').select('*')
          .eq('case_id', body.case_id).order('created_at', { ascending: false }).limit(200);
        return jsonResponse({ case: caseRow, events: events ?? [] });
      }

      case 'create': {
        // Phase 3 (directive §10.4) — manual, unlinked case creation is no
        // longer an ordinary production pathway. The only supported route is
        // activate_client (human-confirmed, linked to an active client).
        // `create` remains solely as an authorised exception channel: MLRO
        // only, with a recorded exception category, authority and reason.
        if (!isMlro) {
          return jsonResponse({
            error: 'Manual case creation is restricted. Activate the client from their client record instead; an MLRO can record an authorised exception if this is a migration or remediation case.',
            code: 'manual_creation_restricted',
          }, 403);
        }
        const EXCEPTION_CATEGORIES = [
          'data_migration', 'legacy_remediation', 'regulator_directed', 'approved_testing',
        ];
        const exception = body.exception ?? {};
        const exceptionCategory = String(exception.category ?? '').trim();
        const exceptionReason = String(exception.reason ?? '').trim();
        const exceptionAuthority = String(exception.authority ?? '').trim();
        if (!EXCEPTION_CATEGORIES.includes(exceptionCategory)) {
          return jsonResponse({
            error: 'exception.category is required (data_migration, legacy_remediation, regulator_directed or approved_testing)',
          }, 400);
        }
        if (exceptionReason.length < 10) {
          return jsonResponse({ error: 'exception.reason must be at least 10 characters' }, 400);
        }
        if (!exceptionAuthority) {
          return jsonResponse({ error: 'exception.authority is required (who approved this exception)' }, 400);
        }
        const subject = String(body.subject_display_name ?? '').trim();
        if (!subject) return jsonResponse({ error: 'subject_display_name is required' }, 400);
        const subjectType = ['individual', 'entity', 'trust'].includes(body.subject_type)
          ? body.subject_type : 'individual';
        const risk = RISK_RATINGS.includes(body.risk_rating) ? body.risk_rating : null;
        const exceptionRecord = {
          category: exceptionCategory,
          reason: exceptionReason,
          authority: exceptionAuthority,
          intended_client_id: body.client_id ?? null,
          recorded_by: userId,
          recorded_by_email: userEmail,
          recorded_at: new Date().toISOString(),
        };

        const ref = await generateCaseReference(admin);
        const baseCreate = {
          case_reference: ref,
          subject_display_name: subject,
          subject_type: subjectType,
          client_id: body.client_id ?? null,
          purchase_file_id: body.purchase_file_id ?? null,
          risk_rating: risk,
          assigned_analyst_id: userId,
          created_by: userId,
          metadata: { ...(body.metadata ?? {}), creation_exception: exceptionRecord },
        };
        const createDimensions = {
          case_stage: 'draft',
          client_portal_status: 'not_started',
          finance_portal_status: 'not_requested',
          service_gate_status: 'not_activated',
        };
        let { data: created, error } = await admin
          .schema('aml').from('cases')
          .insert({ ...baseCreate, ...createDimensions }).select('*').single();
        if (error && isMissingColumnError(error)) {
          ({ data: created, error } = await admin
            .schema('aml').from('cases').insert(baseCreate).select('*').single());
        }
        if (error) {
          if (error.code === '23505') {
            return jsonResponse({ error: 'An open AML case already exists for this client' }, 409);
          }
          throw error;
        }

        await appendEvent(admin, created.id, 'case_created',
          `Case ${ref} opened by authorised exception (${exceptionCategory}) for ${subject}`,
          {
            subject_type: subjectType, initial_risk: risk, notes: body.notes ?? null,
            creation_exception: exceptionRecord,
          },
          userId, userEmail);

        return jsonResponse({ case: created });
      }

      case 'activate_client': {
        // Phase 3 — Hybrid Activation Engine (Model A/B).
        //
        // Cases can only be opened for a real active client after a
        // **human-confirmed** activation event (AGENTS.md §2). Marketing
        // leads / imports never reach this path.
        //
        // Model A: designated-service activation — allowed whenever an AML
        //          role holder confirms the trigger.
        // Model B: pre-service / earlier activation — REQUIRES tenant-level
        //          `aml_activation_program.legal_approval === true` and a
        //          non-empty `program_version` string. Otherwise 409.
        if (!canCreate) return jsonResponse({ error: 'Analyst or MLRO role required' }, 403);

        const clientId = String(body.client_id ?? '').trim();
        const displayName = String(body.subject_display_name ?? '').trim();
        const model = String(body.activation_model ?? '').toUpperCase();
        const event = String(body.activation_event ?? '').trim();
        const reason = String(body.reason ?? '').trim();
        const confirmed = Boolean(body.human_confirmed);

        if (!clientId) return jsonResponse({ error: 'client_id is required' }, 400);
        if (!/^[0-9a-f-]{36}$/i.test(clientId)) {
          return jsonResponse({ error: 'client_id must be a UUID' }, 400);
        }
        if (!displayName) return jsonResponse({ error: 'subject_display_name is required' }, 400);
        if (!['A', 'B'].includes(model)) {
          return jsonResponse({ error: 'activation_model must be "A" or "B"' }, 400);
        }
        if (event.length < 3) return jsonResponse({ error: 'activation_event is required' }, 400);
        if (reason.length < 10) {
          return jsonResponse({ error: 'reason must be at least 10 characters' }, 400);
        }
        if (!confirmed) {
          return jsonResponse({ error: 'Human confirmation is required to open an AML case' }, 400);
        }

        // Verify the client exists. An inactive client is NOT rejected here:
        // this human-confirmed form is the sanctioned place an authorised user
        // confirms an existing client is active, so the flip to active happens
        // atomically with case creation below instead of being demanded of
        // some other screen first.
        const { data: client, error: clientErr } = await admin
          .from('clients')
          .select('id, is_active')
          .eq('id', clientId)
          .maybeSingle();
        if (clientErr) throw clientErr;
        if (!client) return jsonResponse({ error: 'Client not found' }, 404);
        const clientWasInactive = client.is_active !== true;

        // Duplicate-open guard: one open case per client at a time.
        const { data: existing } = await admin
          .schema('aml').from('cases')
          .select('*')
          .eq('client_id', clientId)
          .not('status', 'in', '("cleared","closed","blocked")')
          .limit(1)
          .maybeSingle();
        if (existing) {
          const priorActivation = (existing.metadata as any)?.activation ?? {};
          const isSameConfirmedActivation =
            priorActivation.human_confirmed === true
            && String(priorActivation.model ?? '') === model
            && String(priorActivation.event ?? '').trim() === event
            && String(priorActivation.reason ?? '').trim() === reason
            && String(existing.subject_display_name ?? '').trim() === displayName;
          if (isSameConfirmedActivation) {
            return jsonResponse({
              case: existing,
              activation: priorActivation,
              client_activation: { was_inactive: false, marked_active: false },
              client_portal: {
                has_portal_access: false,
                notified: false,
                note: 'This activation had already completed. The existing AML case has been reopened.',
              },
              reconciled: true,
            });
          }
          return jsonResponse({
            error: 'An open AML case already exists for this client',
            case: existing,
          }, 409);
        }

        // Model B guardrail: legal approval + program version.
        let programVersion: string | null = null;
        if (model === 'B') {
          // Surface read errors and tolerate multi-row tables: a silent read
          // failure here previously disabled Model B with a misleading
          // `model_b_not_approved` message.
          const { data: settingsRows, error: settingsErr } = await admin
            .schema('aml').from('tenant_settings')
            .select('metadata')
            .limit(1);
          if (settingsErr) throw settingsErr;
          const settings = (settingsRows ?? [])[0] ?? null;
          const program = ((settings as any)?.metadata ?? {})?.aml_activation_program ?? {};
          if (program?.legal_approval !== true || !String(program?.program_version ?? '').trim()) {
            return jsonResponse({
              error:
                'Model B activation is disabled. An MLRO must record legal approval and a program version in Configuration before Model B can be used.',
              code: 'model_b_not_approved',
            }, 409);
          }
          programVersion = String(program.program_version).trim();
        }

        const activation = {
          model,
          event,
          reason,
          program_version: programVersion,
          human_confirmed: true,
          client_was_inactive: clientWasInactive,
          activated_by: userId,
          activated_by_email: userEmail,
          activated_at: new Date().toISOString(),
        };

        // Phase 1 explicit activation contract (§17). Model labels are
        // preserved in legacy_activation_model; meaning is carried by the
        // explicit timing/agreement/gate fields.
        const dimensionFields: Record<string, any> = {
          case_stage: 'activated',
          client_portal_status: 'not_started',
          finance_portal_status: 'not_requested',
          service_gate_status: 'cdd_incomplete',
          activation_timing: model === 'A' ? 'post_agreement_trigger' : 'conditional_agreement',
          agreement_state: model === 'A' ? 'operative' : 'conditional_executed',
          activation_policy_version: programVersion,
          legacy_activation_model: model,
        };

        const ref = await generateCaseReference(admin);
        const baseInsert = {
          case_reference: ref,
          subject_display_name: displayName,
          subject_type: body.subject_type && ['individual', 'entity', 'trust'].includes(body.subject_type)
            ? body.subject_type : 'individual',
          client_id: clientId,
          purchase_file_id: body.purchase_file_id ?? null,
          risk_rating: null,
          assigned_analyst_id: userId,
          created_by: userId,
          metadata: { activation },
        };
        const activationAuditEvent = {
          category: 'case_created',
          summary: `Case ${ref} activated (Model ${model}) for ${displayName}` +
            (clientWasInactive ? ' — client record marked active' : ''),
          payload: {
            activation,
            client_id: clientId,
            client_activation: {
              was_inactive: clientWasInactive,
              marked_active: clientWasInactive,
            },
            activation_contract: {
              activation_timing: dimensionFields.activation_timing,
              agreement_state: dimensionFields.agreement_state,
              service_gate_status: dimensionFields.service_gate_status,
              activation_policy_version: programVersion,
            },
          },
          actor_id: userId,
          actor_label: userEmail,
        };
        let created: any = null;
        let clientMarkedActive = false;

        if (clientWasInactive) {
          // Atomic path ONLY (Part 5): mark the client active and open the
          // case in ONE database transaction. The RPC locks the client row,
          // flips is_active, inserts the case and rolls the whole thing back
          // on any error — including the duplicate-open unique index, which
          // still surfaces as the same 409 contract.
          //
          // There is deliberately NO non-transactional fallback. A compensated
          // flip/insert/revert sequence can race a concurrent activation into
          // deactivating a client who holds a valid open case, and its revert
          // can itself fail, leaving an active client with no case. If the RPC
          // has not been installed yet, this path fails closed with a clear
          // configuration error and mutates nothing.
          const { data: txResult, error: txErr } = await admin.rpc(
            'aml_activate_client_open_case',
            {
              p_client_id: clientId,
              p_case: {
                ...baseInsert,
                ...dimensionFields,
                activation_audit_event: activationAuditEvent,
              },
            },
          );
          if (txErr) {
            if (isMissingFunctionError(txErr)) {
              // Fail closed: no client update, no case insert, no case event.
              // Deployment order requires the migration installing the RPC to
              // be applied before this function serves inactive activations.
              return jsonResponse({
                error: 'AML client activation is temporarily unavailable because the required database function has not been installed.',
                code: 'aml_activation_rpc_unavailable',
              }, 503);
            }
            if (txErr.code === '23505' || /aml_cases_one_open_per_client|already exists/i.test(String(txErr.message ?? ''))) {
              return jsonResponse({ error: 'An open AML case already exists for this client' }, 409);
            }
            if (txErr.code === 'P0002') return jsonResponse({ error: 'Client not found' }, 404);
            throw txErr;
          }
          created = (txResult as any)?.case ?? null;
          clientMarkedActive = Boolean((txResult as any)?.client_marked_active);
          if (!created) throw new Error('Activation transaction returned no case');
        } else {
          // Already-active client: existing case-creation behaviour unchanged.
          let { data: createdRow, error: createErr } = await admin
            .schema('aml').from('cases')
            .insert({ ...baseInsert, ...dimensionFields }).select('*').single();
          if (createErr && isMissingColumnError(createErr)) {
            ({ data: createdRow, error: createErr } = await admin
              .schema('aml').from('cases').insert(baseInsert).select('*').single());
          }
          if (createErr) {
            // Partial unique index aml_cases_one_open_per_client closes the
            // read-then-write race above; surface it as the same 409 contract.
            if (createErr.code === '23505') {
              return jsonResponse({ error: 'An open AML case already exists for this client' }, 409);
            }
            throw createErr;
          }
          created = createdRow;
        }

        const clientActivation = {
          was_inactive: clientWasInactive,
          marked_active: clientMarkedActive,
        };

        // The inactive-client RPC writes this required event in the SAME
        // transaction as the active flag and case. Already-active clients keep
        // the direct insert path and append their event here.
        if (!clientWasInactive) {
          await appendEvent(
            admin,
            created.id,
            activationAuditEvent.category,
            activationAuditEvent.summary,
            activationAuditEvent.payload,
            userId,
            userEmail,
          );
        }

        // Hand the client the way in. Activation is meaningless to them until
        // something in their portal points at the screening flow, so post a
        // notification carrying the deep link, and report back whether they
        // can actually reach it — a client with no portal login needs an
        // invite, and the operator should learn that here rather than a week
        // later when nothing has been submitted.
        let portalAccess: { has_portal_access: boolean; notified: boolean; note: string };
        const { data: portalUsers } = await admin
          .from('client_portal_users')
          .select('id, status')
          .eq('client_id', clientId)
          .eq('status', 'active')
          .limit(1);
        const hasPortalAccess = (portalUsers ?? []).length > 0;

        let notified = false;
        // Portal-safe by construction (Appendix C.1): reference and next step
        // only — no risk, screening or internal state.
        const { error: notifyErr } = await admin
          .from('client_portal_notifications')
          .insert({
            client_id: clientId,
            title: 'Identity verification required',
            message:
              'Your identity and compliance check is ready to complete. It takes about 10 minutes ' +
              'and covers the consents and documents we are required to collect before we can act for you.',
            type: 'action',
            category: 'document',
            action_url: '/client/aml',
            metadata: { aml_case_reference: created.case_reference, source: 'aml_activation' },
          });
        if (notifyErr) {
          // A failed notification must not roll back a recorded activation —
          // surface it instead so it can be re-sent.
          console.error('aml-cases: portal notification insert failed', notifyErr);
        } else {
          notified = true;
        }

        portalAccess = {
          has_portal_access: hasPortalAccess,
          notified,
          note: hasPortalAccess
            ? 'The client has been notified in their portal with a link to the compliance check.'
            : 'This client has no active portal login yet. Send them a portal invitation so they can complete the compliance check.',
        };

        await appendEvent(admin, created.id, 'system',
          hasPortalAccess
            ? 'Client notified in portal — compliance check available'
            : 'Portal notification queued — client has no active portal login yet',
          { client_portal: portalAccess, action_url: '/client/aml' },
          userId, userEmail);

        return jsonResponse({
          case: created,
          activation,
          client_activation: clientActivation,
          client_portal: portalAccess,
        });
      }

      case 'update': {
        if (!canWrite) return jsonResponse({ error: 'Write role required' }, 403);
        if (!body.case_id) return jsonResponse({ error: 'case_id is required' }, 400);
        const patch = body.patch ?? {};
        const allowed: Record<string, any> = {};
        for (const k of ['subject_display_name', 'risk_score', 'assigned_analyst_id', 'assigned_mlro_id', 'metadata']) {
          if (patch[k] !== undefined) allowed[k] = patch[k];
        }
        if (patch.risk_rating !== undefined) {
          if (patch.risk_rating !== null && !RISK_RATINGS.includes(patch.risk_rating)) {
            return jsonResponse({ error: 'Invalid risk_rating' }, 400);
          }
          allowed.risk_rating = patch.risk_rating;
        }
        if (Object.keys(allowed).length === 0) return jsonResponse({ error: 'Empty patch' }, 400);

        const { data: before } = await admin.schema('aml').from('cases')
          .select('risk_rating, risk_score').eq('id', body.case_id).maybeSingle();

        const { data: updated, error } = await admin.schema('aml').from('cases')
          .update(allowed).eq('id', body.case_id).select('*').single();
        if (error) throw error;

        if (patch.risk_rating !== undefined || patch.risk_score !== undefined) {
          await appendEvent(admin, body.case_id, 'risk_rescored',
            `Risk updated → ${updated.risk_rating ?? 'unrated'} (score ${updated.risk_score ?? 'n/a'})`,
            { before, after: { risk_rating: updated.risk_rating, risk_score: updated.risk_score } },
            userId, userEmail);
        }

        return jsonResponse({ case: updated });
      }

      case 'transition': {
        if (!canWrite) return jsonResponse({ error: 'Write role required' }, 403);
        if (!body.case_id || !body.to_status) {
          return jsonResponse({ error: 'case_id and to_status are required' }, 400);
        }
        if (!CASE_STATUSES.includes(body.to_status)) {
          return jsonResponse({ error: 'Invalid to_status' }, 400);
        }
        const { data: caseRow, error: fetchErr } = await admin.schema('aml').from('cases')
          .select('id, status').eq('id', body.case_id).maybeSingle();
        if (fetchErr) throw fetchErr;
        if (!caseRow) return jsonResponse({ error: 'Not found' }, 404);

        const from = caseRow.status;
        const to = body.to_status;
        const legal = TRANSITIONS[from] ?? [];
        if (from === 'escalated_mlro' && !isMlro) {
          return jsonResponse({ error: 'MLRO role required for escalated case decisions' }, 403);
        }
        if (!legal.includes(to) && !isMlro) {
          return jsonResponse({
            error: `Illegal transition ${from} → ${to} (MLRO override required)`,
          }, 400);
        }

        const patch: Record<string, any> = { status: to };
        if (to === 'closed') patch.closed_at = new Date().toISOString();

        // Keep the Phase 1 dimension columns coherent while legacy `status`
        // is still the driver. Gate sync is the conservative legacy mapping;
        // explicit gate decisions (Phase 8) will replace it.
        const dimensionPatch: Record<string, any> = {
          case_stage: STATUS_TO_STAGE[to] ?? null,
          client_portal_status: STATUS_TO_CLIENT_PORTAL[to] ?? null,
          service_gate_status: STATUS_TO_SERVICE_GATE[to] ?? null,
        };

        let { data: updated, error: upErr } = await admin.schema('aml').from('cases')
          .update({ ...patch, ...dimensionPatch }).eq('id', body.case_id).select('*').single();
        if (upErr && isMissingColumnError(upErr)) {
          ({ data: updated, error: upErr } = await admin.schema('aml').from('cases')
            .update(patch).eq('id', body.case_id).select('*').single());
        }
        if (upErr) throw upErr;

        await appendEvent(admin, body.case_id, 'status_changed',
          `Status ${from} → ${to}${!legal.includes(to) ? ' (MLRO override)' : ''}`,
          {
            from, to, reason: body.reason ?? null, override: !legal.includes(to),
            dimensions_synced: dimensionPatch,
          },
          userId, userEmail);

        return jsonResponse({ case: updated });
      }

      case 'append_event': {
        if (!canWrite) return jsonResponse({ error: 'Write role required' }, 403);
        if (!body.case_id || !body.category || !body.summary) {
          return jsonResponse({ error: 'case_id, category, summary required' }, 400);
        }
        if (!EVENT_CATEGORIES.includes(body.category)) {
          return jsonResponse({ error: 'Invalid category' }, 400);
        }
        if (MLRO_ONLY_EVENT_CATEGORIES.has(body.category) && !isMlro) {
          return jsonResponse({ error: 'MLRO role required for this event category' }, 403);
        }
        const ev = await appendEvent(admin, body.case_id, body.category,
          String(body.summary), body.payload ?? {}, userId, userEmail);
        return jsonResponse({ event: ev });
      }

      case 'list_events': {
        if (!body.case_id) return jsonResponse({ error: 'case_id is required' }, 400);
        const limit = Math.min(Number(body.limit ?? 200), 500);
        const { data, error } = await admin.schema('aml').from('case_events')
          .select('*').eq('case_id', body.case_id)
          .order('created_at', { ascending: false }).limit(limit);
        if (error) throw error;
        return jsonResponse({ events: data ?? [] });
      }

      case 'consent_status': {
        // Command-centre confirmation that the client accepted the current
        // AUSTRAC-referenced consent set, and exactly which wording they saw.
        if (!body.case_id) return jsonResponse({ error: 'case_id is required' }, 400);
        const { data: docs, error: docErr } = await admin.schema('aml').from('consent_documents')
          .select('id, code, version, title, acknowledgement_type, required, sort_order, effective_from')
          .is('retired_at', null)
          .lte('effective_from', new Date().toISOString())
          .order('version', { ascending: false })
          .order('sort_order', { ascending: true });
        if (docErr) return jsonResponse({ error: docErr.message }, 400);
        const currentVersion = (docs ?? [])[0]?.version ?? null;
        const current = (docs ?? []).filter((d: any) => d.version === currentVersion);

        const { data: accepted, error: accErr } = await admin.schema('aml').from('consents')
          .select('kind, version, accepted_at, actor_type, actor_label, document_hash, ip_address')
          .eq('case_id', body.case_id)
          .order('accepted_at', { ascending: true });
        if (accErr) return jsonResponse({ error: accErr.message }, 400);

        const acceptedCurrent = new Map(
          (accepted ?? []).filter((a: any) => a.version === currentVersion)
            .map((a: any) => [a.kind, a]));
        const outstanding = current
          .filter((d: any) => d.required && !acceptedCurrent.has(d.code))
          .map((d: any) => ({ code: d.code, title: d.title }));

        return jsonResponse({
          version: currentVersion,
          satisfied: Boolean(currentVersion) && current.length > 0 && outstanding.length === 0,
          outstanding,
          documents: current.map((d: any) => {
            const a: any = acceptedCurrent.get(d.code);
            return {
              code: d.code, title: d.title, required: d.required,
              acknowledgement_type: d.acknowledgement_type,
              accepted_at: a?.accepted_at ?? null,
              accepted_by: a?.actor_label ?? null,
              actor_type: a?.actor_type ?? null,
              // Ties the acceptance to the exact text presented.
              document_hash: a?.document_hash ?? null,
            };
          }),
          // Superseded acceptances are retained, never overwritten.
          history: (accepted ?? []).filter((a: any) => a.version !== currentVersion),
        });
      }

      case 'search_clients': {
        // Client picker for activation (directive §13.4: no raw-UUID entry).
        //
        // The general client-data broker only returns the full client list to
        // superadmins — a compliance officer who created none of the clients
        // and is assigned to none would see an empty picker. Activation is an
        // AML-role action, so this op provides its own minimal, AML-gated
        // lookup instead of widening that broker.
        //
        // Deliberately narrow: canonical `clients` table only, tokenised name
        // match, capped result set, identification projection only (never
        // financial data). Both ACTIVE and INACTIVE clients are returned and
        // selectable — the activation form is the sanctioned place an
        // authorised user confirms an existing client is active, so inactive
        // records are offered (clearly labelled) instead of hidden behind a
        // "mark them active somewhere else first" dead end. Matching lives in
        // _shared/aml/clientSearchMatch.pure.ts so it is unit-testable.
        // ── BROWSE vs SEARCH ────────────────────────────────────────────
        // This op used to answer `{ clients: [] }` to anything shorter than
        // two characters, so the picker was an empty box until an operator
        // typed a name they had to already know and spell. On this
        // deployment that hid 775 clients — 40 active, 735 inactive — and is
        // why activation felt like it wanted clients re-entered that the
        // platform already held.
        //
        // Browse is the SAME op, projection and permission gate as search;
        // only the database filter differs. A separate "list clients"
        // endpoint would be a second source of truth about which clients an
        // AML operator may see, and the two would drift.
        if (!canWrite) return jsonResponse({ error: 'Insufficient permissions' }, 403);
        const q = sanitizeClientSearchQuery(body.query);
        const status: ClientPickerStatus =
          isClientPickerStatus(body.status) ? body.status : 'all';
        const limit = clampPageSize(body.limit);
        const offset = clampOffset(body.offset);
        const browsing = isBrowseQuery(body.query);

        /** Apply the status slice identically to every path. */
        // deno-lint-ignore no-explicit-any
        const withStatus = (qb: any): any => {
          if (status === 'active') return qb.eq('is_active', true);
          // `is_active` is nullable, and a null is not active. Filtering on
          // `eq false` alone would silently drop those rows from the inactive
          // slice — present in neither tab, which reads as a missing client
          // rather than as a filter.
          if (status === 'inactive') return qb.or('is_active.eq.false,is_active.is.null');
          return qb;
        };

        let page: ClientSearchRow[];
        let total: number;

        if (browsing) {
          // Count and page are taken in the database: 775 rows is already
          // past the point where pulling everything to sort it is sensible.
          const countQuery = withStatus(
            admin.from('clients').select('id', { count: 'exact', head: true }));
          const rowsQuery = withStatus(
            admin.from('clients').select(CLIENT_SEARCH_SELECT))
            .order('is_active', { ascending: false })
            .order('primary_surname', { ascending: true })
            .order('primary_first_name', { ascending: true })
            .range(offset, offset + limit - 1);

          const [{ count, error: countErr }, { data: rows, error: rowsErr }] =
            await Promise.all([countQuery, rowsQuery]);
          if (countErr) return jsonResponse({ error: countErr.message }, 400);
          if (rowsErr) return jsonResponse({ error: rowsErr.message }, 400);
          page = orderBrowsedClients((rows ?? []) as ClientSearchRow[]);
          total = count ?? page.length;
        } else {
          const terms = tokenizeClientSearch(q);
          if (terms.length === 0) {
            return jsonResponse({ clients: [], total: 0, has_more: false, browsing });
          }
          // The `or=` pre-filter is deliberately wide; the strict
          // all-tokens-on-one-person rule is applied in memory afterwards,
          // and the page is taken after that rather than before it.
          const { data: candidates, error: searchErr } = await withStatus(
            admin.from('clients').select(CLIENT_SEARCH_SELECT))
            .or(buildClientSearchOrFilter(terms))
            .order('primary_surname', { ascending: true })
            .limit(400);
          if (searchErr) return jsonResponse({ error: searchErr.message }, 400);
          const result = selectActivationPage(
            (candidates ?? []) as ClientSearchRow[], q, limit, offset);
          page = result.rows;
          total = result.total;
        }

        // Flag clients that already hold an open case so the operator does not
        // start a duplicate (the unique index would reject it at 409 anyway).
        const ids = page.map((r) => r.id);
        let openCaseIds = new Set<string>();
        const openCaseRefs = new Map<string, string>();
        if (ids.length > 0) {
          const { data: openCases } = await admin.schema('aml').from('cases')
            .select('client_id, case_reference')
            .in('client_id', ids)
            .not('status', 'in', '("cleared","blocked","closed")');
          for (const c of openCases ?? []) {
            const cid = String((c as any).client_id);
            openCaseIds.add(cid);
            // Naming the case is what turns "you cannot do this" into
            // "here is the case that already covers it".
            if ((c as any).case_reference) {
              openCaseRefs.set(cid, String((c as any).case_reference));
            }
          }
        }

        return jsonResponse({
          clients: page.map((r) => {
            const id = String(r.id);
            const projected = toActivationClientResult(r, openCaseIds.has(id));
            const reference = openCaseRefs.get(id);
            return reference
              ? { ...projected, open_case: { case_reference: reference } }
              : projected;
          }),
          total,
          has_more: offset + page.length < total,
          browsing,
        });
      }

      case 'get_client_for_activation': {
        // Route-based handoff (…/admin/aml/cases?activateClientId=<id>): the
        // browser supplies ONLY the client ID; the display name, contact
        // details and active status are loaded here from the authoritative
        // record, so the URL carries no personal information and cannot
        // misrepresent the client's status.
        if (!canWrite) return jsonResponse({ error: 'Insufficient permissions' }, 403);
        const clientId = String(body.client_id ?? '').trim();
        if (!/^[0-9a-f-]{36}$/i.test(clientId)) {
          return jsonResponse({ error: 'client_id must be a UUID' }, 400);
        }
        const { data: row, error: rowErr } = await admin
          .from('clients')
          .select(CLIENT_SEARCH_SELECT)
          .eq('id', clientId)
          .maybeSingle();
        if (rowErr) throw rowErr;
        if (!row) return jsonResponse({ error: 'Client not found' }, 404);

        const { data: openCase } = await admin.schema('aml').from('cases')
          .select('id, case_reference, status')
          .eq('client_id', clientId)
          .not('status', 'in', '("cleared","blocked","closed")')
          .limit(1)
          .maybeSingle();

        return jsonResponse({
          client: {
            ...toActivationClientResult(row as unknown as ClientSearchRow, Boolean(openCase)),
            open_case: openCase
              ? { id: openCase.id, case_reference: openCase.case_reference }
              : null,
          },
        });
      }


      case 'client_summary': {
        // Phase 4 — persistent AML summary for the master client record.
        // Read-only; any AML role. Returns the client's current case (open
        // first, else most recent), requirement progress and open-request
        // counts so the Client page can show status without duplicating the
        // case workspace.
        const clientId = String(body.client_id ?? '').trim();
        if (!clientId) return jsonResponse({ error: 'client_id is required' }, 400);
        const { data: caseRows, error: caseErr } = await admin
          .schema('aml').from('cases').select('*')
          .eq('client_id', clientId)
          .order('opened_at', { ascending: false })
          .limit(5);
        if (caseErr) throw caseErr;
        const rows = caseRows ?? [];
        const OPEN_BLOCKING = new Set(['cleared', 'blocked', 'closed']);
        const openCase = rows.find((r: any) => !OPEN_BLOCKING.has(r.status)) ?? null;
        const current = openCase ?? rows[0] ?? null;
        if (!current) {
          return jsonResponse({ case: null, has_open_case: false });
        }
        const [{ data: reqRows }, { data: requestRows }] = await Promise.all([
          admin.schema('aml').from('document_requirements')
            .select('required, status').eq('case_id', current.id),
          admin.schema('aml').from('client_requests')
            .select('id, status').eq('case_id', current.id).in('status', ['open', 'responded']),
        ]);
        const required = (reqRows ?? []).filter((r: any) => r.required);
        const completed = required.filter((r: any) => ['uploaded', 'accepted'].includes(r.status));
        return jsonResponse({
          case: current,
          has_open_case: Boolean(openCase),
          requirement_progress: { completed: completed.length, total: required.length },
          open_client_requests: (requestRows ?? []).length,
        });
      }

      case 'list_requirements': {
        if (!body.case_id) return jsonResponse({ error: 'case_id is required' }, 400);
        const { data, error } = await admin.schema('aml').from('document_requirements')
          .select('*').eq('case_id', body.case_id).order('created_at', { ascending: true });
        if (error) throw error;
        return jsonResponse({ requirements: data ?? [] });
      }

      case 'seed_default_requirements': {
        if (!canWrite) return jsonResponse({ error: 'Write role required' }, 403);
        if (!body.case_id) return jsonResponse({ error: 'case_id is required' }, 400);
        const defaults = [
          { code: 'photo_id_primary', label: 'Photo ID — primary (passport or driver licence)', required: true },
          { code: 'photo_id_secondary', label: 'Photo ID — secondary', required: false },
          { code: 'proof_of_address', label: 'Proof of address (utility bill or bank statement < 3 months)', required: true },
          { code: 'source_of_funds', label: 'Source of funds evidence', required: true },
          { code: 'source_of_wealth', label: 'Source of wealth statement', required: false },
        ];
        const rows = defaults.map((d) => ({ ...d, case_id: body.case_id, created_by_type: 'staff', created_by: userId }));
        const { data, error } = await admin.schema('aml').from('document_requirements')
          .upsert(rows, { onConflict: 'case_id,code' }).select('*');
        if (error) throw error;
        await appendEvent(admin, body.case_id, 'document_added',
          `Seeded ${rows.length} default document requirements`,
          { codes: defaults.map((d) => d.code) }, userId, userEmail);
        return jsonResponse({ requirements: data ?? [] });
      }

      case 'upsert_requirement': {
        if (!canWrite) return jsonResponse({ error: 'Write role required' }, 403);
        const r = body.requirement ?? {};
        if (!r.case_id || !r.code || !r.label) {
          return jsonResponse({ error: 'case_id, code, label required' }, 400);
        }
        const row = {
          case_id: r.case_id, code: String(r.code), label: String(r.label),
          description: r.description ?? null, required: r.required !== false,
          assigned_to_party: r.assigned_to_party ?? null, due_at: r.due_at ?? null,
          metadata: r.metadata ?? {}, created_by_type: 'staff', created_by: userId,
        };
        const { data, error } = await admin.schema('aml').from('document_requirements')
          .upsert(row, { onConflict: 'case_id,code' }).select('*').single();
        if (error) throw error;
        return jsonResponse({ requirement: data });
      }

      case 'list_documents': {
        if (!body.case_id) return jsonResponse({ error: 'case_id is required' }, 400);
        /*
         * The requirement comes back WITH the document.
         *
         * It was always in the row — every client upload carries a correct
         * `requirement_id` — but this op selected `*` and the reviewer got a
         * list of camera filenames with no way to tell a passport from a bank
         * statement without opening each one. The category is read from the
         * requirement and never inferred from a filename: a filename is a
         * claim by whoever uploaded it, a requirement is a record of what was
         * asked for.
         */
        const { data, error } = await admin.schema('aml').from('documents')
          .select('*, requirement:requirement_id (id, code, label, required)')
          .eq('case_id', body.case_id).neq('status', 'deleted')
          .order('uploaded_at', { ascending: false });
        if (error) throw error;
        return jsonResponse({ documents: data ?? [] });
      }

      case 'rename_document': {
        /*
         * Renaming is presentation only. `filename` is never touched — it is
         * the audit record of the bytes the client sent — and no foreign key
         * moves, so the document's case, requirement, client and Passport
         * bindings are exactly what they were.
         */
        if (!canWrite) return jsonResponse({ error: 'Write role required' }, 403);
        if (!body.document_id) return jsonResponse({ error: 'document_id is required' }, 400);
        const nextName = sanitiseDocumentName(body.display_name);

        const { data: before, error: beforeErr } = await admin.schema('aml').from('documents')
          .select('id, case_id, filename, display_name')
          .eq('id', String(body.document_id)).maybeSingle();
        if (beforeErr) throw beforeErr;
        if (!before) return jsonResponse({ error: 'Not found' }, 404);

        const { data: doc, error } = await admin.schema('aml').from('documents')
          .update({ display_name: nextName })
          .eq('id', before.id)
          .select('*, requirement:requirement_id (id, code, label, required)')
          .single();
        if (error) throw error;

        // What changed, from what, to what, and by whom — a rename is a
        // compliance-visible edit and leaves the same trail as any other.
        await appendEvent(admin, before.case_id, 'document_added',
          nextName
            ? `Document renamed to "${nextName}"`
            : 'Document name cleared — it now shows its requirement',
          {
            document_id: before.id,
            previous_display_name: before.display_name ?? null,
            new_display_name: nextName,
            // Preserved so the trail always names the file that arrived.
            original_filename: before.filename,
          },
          userId, userEmail);

        return jsonResponse({ document: doc });
      }

      case 'get_document_download_url': {
        if (!body.document_id) return jsonResponse({ error: 'document_id is required' }, 400);
        const { data: doc, error } = await admin.schema('aml').from('documents')
          .select('storage_path, filename').eq('id', body.document_id).maybeSingle();
        if (error) throw error;
        if (!doc) return jsonResponse({ error: 'Not found' }, 404);
        const { data: signed, error: sErr } = await admin.storage.from('aml-documents')
          .createSignedUrl(doc.storage_path, 300, { download: doc.filename });
        if (sErr) throw sErr;
        return jsonResponse({ url: signed.signedUrl, filename: doc.filename });
      }

      case 'review_document': {
        if (!canWrite) return jsonResponse({ error: 'Write role required' }, 403);
        if (!body.document_id || !['accepted','rejected'].includes(body.decision)) {
          return jsonResponse({ error: 'document_id + decision(accepted|rejected) required' }, 400);
        }
        const patch: Record<string, any> = {
          status: body.decision, reviewed_by: userId, reviewed_at: new Date().toISOString(),
        };
        if (body.decision === 'rejected') patch.rejection_reason = body.reason ?? null;
        const { data: doc, error } = await admin.schema('aml').from('documents')
          .update(patch).eq('id', body.document_id).select('*').single();
        if (error) throw error;
        if (doc.requirement_id) {
          await admin.schema('aml').from('document_requirements')
            .update({ status: body.decision === 'accepted' ? 'accepted' : 'rejected' })
            .eq('id', doc.requirement_id);
        }
        await appendEvent(admin, doc.case_id, 'document_added',
          `Document "${doc.filename}" ${body.decision}`,
          { document_id: doc.id, decision: body.decision, reason: body.reason ?? null },
          userId, userEmail);
        return jsonResponse({ document: doc });
      }

      case 'list_submissions': {
        if (!body.case_id) return jsonResponse({ error: 'case_id is required' }, 400);
        const { data, error } = await admin.schema('aml').from('submission_versions')
          .select('*').eq('case_id', body.case_id)
          .order('version_number', { ascending: false });
        if (error) throw error;
        return jsonResponse({ submissions: data ?? [] });
      }

      case 'review_submission': {
        if (!canWrite) return jsonResponse({ error: 'Write role required' }, 403);
        if (!body.submission_id || !['accepted','rejected','changes_requested'].includes(body.decision)) {
          return jsonResponse({ error: 'submission_id + decision required' }, 400);
        }
        const { data: sub, error } = await admin.schema('aml').from('submission_versions')
          .update({
            status: body.decision, reviewer_id: userId,
            reviewer_notes: body.notes ?? null, reviewed_at: new Date().toISOString(),
          }).eq('id', body.submission_id).select('*').single();
        if (error) throw error;
        await appendEvent(admin, sub.case_id, 'edd_note',
          `Submission v${sub.version_number} ${body.decision}`,
          { submission_id: sub.id, decision: body.decision, notes: body.notes ?? null },
          userId, userEmail);
        return jsonResponse({ submission: sub });
      }

      case 'list_client_requests': {
        if (!body.case_id) return jsonResponse({ error: 'case_id is required' }, 400);
        const { data, error } = await admin.schema('aml').from('client_requests')
          .select('*').eq('case_id', body.case_id)
          .order('created_at', { ascending: false });
        if (error) throw error;
        return jsonResponse({ requests: data ?? [] });
      }

      case 'create_client_request': {
        if (!canWrite) return jsonResponse({ error: 'Write role required' }, 403);
        const r = body.request ?? {};
        if (!r.case_id || !r.kind || !r.subject || !r.message) {
          return jsonResponse({ error: 'case_id, kind, subject, message required' }, 400);
        }
        if (!['additional_info','new_document','clarification','re_consent'].includes(r.kind)) {
          return jsonResponse({ error: 'Invalid kind' }, 400);
        }
        // Closed action vocabulary and closed routing, both from the shared
        // contract. An unrecognised code is dropped rather than stored, so the
        // portal can never be handed a route it does not know.
        //
        // `sanitiseActionTarget` also carries `section_code`, which this path
        // used to discard: the portal routes questionnaire amendments by it,
        // so a request created anywhere except Submission Review reached the
        // client with nowhere to go. It is validated against the questionnaire
        // vocabulary rather than merely copied.
        const actionCode = sanitiseActionCode(r.action_code);
        const actionTarget = sanitiseActionTarget(r.action_target);

        // Idempotency: one unresolved request per action on a case. A repeated
        // click (or a double-submit) returns the request that already exists
        // instead of creating a second one the client would see twice.
        if (actionCode) {
          const { data: existing } = await admin.schema('aml').from('client_requests')
            .select('*').eq('case_id', r.case_id).eq('action_code', actionCode)
            .not('status', 'in', '("resolved","cancelled")')
            .order('created_at', { ascending: false }).limit(1).maybeSingle();
          if (existing) return jsonResponse({ request: existing, deduplicated: true });
        }

        const { data, error } = await admin.schema('aml').from('client_requests').insert({
          case_id: r.case_id, kind: r.kind, subject: String(r.subject).slice(0, 200),
          message: String(r.message), request_payload: r.request_payload ?? {},
          action_code: actionCode, action_target: actionTarget,
          requested_by: userId, requested_by_label: userEmail,
        }).select('*').single();
        if (error) throw error;
        await appendEvent(admin, r.case_id, 'edd_note',
          `Client request sent: ${data.subject}`,
          { request_id: data.id, kind: data.kind }, userId, userEmail);
        return jsonResponse({ request: data });
      }

      case 'resolve_client_request': {
        if (!canWrite) return jsonResponse({ error: 'Write role required' }, 403);
        if (!body.request_id) return jsonResponse({ error: 'request_id is required' }, 400);
        const { data, error } = await admin.schema('aml').from('client_requests')
          .update({ status: 'resolved', resolved_at: new Date().toISOString(), resolved_by: userId })
          .eq('id', body.request_id).select('*').single();
        if (error) throw error;
        return jsonResponse({ request: data });
      }

      /* ═══════════ Submission review (Stage 3) ═══════════ */
      case 'get_submission_review': {
        const caseId = String(body.case_id ?? '');
        if (!caseId) return jsonResponse({ error: 'case_id required' }, 400);
        const composed = await composeSubmissionReview(
          admin, caseId,
          body.version_number ? Number(body.version_number) : null,
          canWrite || roles.has('auditor'));
        return jsonResponse(composed.payload, composed.status);
      }

      /**
       * Store the submission record on the case — the entirety of the review
       * as one inert HTML document, rendered by the SAME shared module the
       * screen's reading view and the browser download use, so the stored
       * copy says what the reviewer saw.
       *
       * Each stored record is a point-in-time export: storing again after
       * the case moves is a new record, never an overwrite. The row is
       * deliberately `status: 'accepted'` — the uploaded/accepted/rejected
       * cycle reviews CLIENT evidence, and a record the platform generated
       * would otherwise sit in a review queue it can never leave.
       *
       * The metadata `kind` mark is what keeps it out of the client portal:
       * the record carries screening states and risk readings, which are
       * staff-only (a tipping-off hazard in a client's hands). The portal's
       * list and signing ops refuse documents carrying the mark, and clients
       * can never write `metadata`, so the mark is trustworthy as a gate.
       */
      case 'store_submission_record': {
        if (!canWrite) return jsonResponse({ error: 'Write role required' }, 403);
        const caseId = String(body.case_id ?? '');
        if (!caseId) return jsonResponse({ error: 'case_id required' }, 400);
        const composed = await composeSubmissionReview(
          admin, caseId,
          body.version_number ? Number(body.version_number) : null,
          canWrite || roles.has('auditor'));
        if (composed.status !== 200) return jsonResponse(composed.payload, composed.status);
        const review = composed.payload;
        if (!review.submission) {
          return jsonResponse({ error: 'No client submission to record yet.' }, 400);
        }

        const generatedAt = new Date().toISOString();
        const record = buildSubmissionRecord(review, { generatedAt, generatedBy: userEmail ?? null });
        const html = renderSubmissionRecordHtml(record);
        const bytes = new TextEncoder().encode(html);
        const contentHash = await sha256Hex(html);

        // Object name carries the hash prefix so repeated stores of one
        // version never collide and never overwrite.
        const storagePath = `${caseId}/submission-v${review.submission.version_number}-record-${contentHash.slice(0, 12)}.html`;
        const { error: upErr } = await admin.storage.from('aml-documents')
          .upload(storagePath, bytes, { contentType: 'text/html; charset=utf-8', upsert: true });
        if (upErr) throw upErr;

        const { data: doc, error: docErr } = await admin.schema('aml').from('documents').insert({
          case_id: caseId,
          requirement_id: null,
          filename: record.filename,
          display_name: `Submission v${review.submission.version_number} — review record`,
          storage_path: storagePath,
          mime_type: 'text/html',
          size_bytes: bytes.byteLength,
          checksum: contentHash,
          status: 'accepted',
          uploaded_by_type: 'staff',
          uploaded_by: userId,
          reviewed_by: userId,
          reviewed_at: generatedAt,
          metadata: {
            kind: SUBMISSION_RECORD_DOCUMENT_KIND,
            submission_id: review.submission.id,
            submission_version: review.submission.version_number,
            content_sha256: contentHash,
            generated_at: generatedAt,
            generated_by: userEmail ?? null,
          },
        }).select('*').single();
        if (docErr) throw docErr;

        await appendEvent(admin, caseId, 'document_added',
          `Submission v${review.submission.version_number} review record stored`,
          {
            document_id: doc.id,
            submission_id: review.submission.id,
            submission_version: review.submission.version_number,
            content_sha256: contentHash,
            review_status_at_generation: review.submission.review_status,
          },
          userId, userEmail);

        return jsonResponse({ document: doc, content_hash: contentHash });
      }

      case 'accept_submission':
      case 'request_submission_changes':
      case 'request_submission_document':
      case 'request_submission_clarification':
      case 'escalate_submission':
      case 'supersede_submission': {
        if (!canWrite) return jsonResponse({ error: 'Write role required' }, 403);
        const needsReviewer = op === 'accept_submission' || op === 'escalate_submission';
        if (needsReviewer && !(roles.has('reviewer') || roles.has('mlro'))) {
          return jsonResponse({ error: 'Reviewer or MLRO role required' }, 403);
        }
        const submissionId = String(body.submission_id ?? '');
        const reason = String(body.reason ?? '').trim();
        if (!submissionId) return jsonResponse({ error: 'submission_id required' }, 400);
        if (op !== 'accept_submission' && reason.length < 10) {
          return jsonResponse({ error: 'A reason of at least 10 characters is required' }, 400);
        }
        const { data: sub } = await admin.schema('aml').from('submission_versions')
          .select('*, cases:case_id(id, status, case_stage)').eq('id', submissionId).maybeSingle();
        if (!sub) return jsonResponse({ error: 'Submission not found' }, 404);
        if (body.case_id && String(body.case_id) !== String(sub.case_id)) {
          return jsonResponse({ error: 'Submission does not belong to that case' }, 403);
        }

        const nextStatus = op === 'accept_submission' ? 'accepted'
          : op === 'escalate_submission' ? 'escalated'
          : op === 'supersede_submission' ? 'superseded'
          : 'changes_requested';

        const patch: Record<string, unknown> = {
          review_status: nextStatus,
          review_decided_by: userId,
          review_decided_at: new Date().toISOString(),
          review_reason: reason || null,
        };
        if (op === 'supersede_submission') {
          patch.superseded_at = new Date().toISOString();
          patch.superseded_reason = reason;
        }
        // The snapshot column is NEVER written here: prior submitted content
        // is immutable by contract.
        const { data: updated, error: upErr } = await admin.schema('aml').from('submission_versions')
          .update(patch).eq('id', submissionId).select('*').single();
        if (upErr) throw upErr;

        // Client-safe workflow state. The service gate is deliberately absent:
        // only an authorised reviewer/MLRO decision moves it, elsewhere.
        const casePatch: Record<string, unknown> = {};
        if (op === 'accept_submission') {
          casePatch.client_portal_status = 'under_review';
          casePatch.case_stage = 'staff_review';
        } else if (op === 'escalate_submission') {
          casePatch.client_portal_status = 'under_review';
        } else if (nextStatus === 'changes_requested') {
          casePatch.client_portal_status = 'additional_info_required';
        }
        if (Object.keys(casePatch).length > 0) {
          const { error: caseErr } = await admin.schema('aml').from('cases').update(casePatch).eq('id', sub.case_id);
          if (caseErr) await admin.schema('aml').from('cases')
            .update({ client_portal_status: casePatch.client_portal_status }).eq('id', sub.case_id);
        }

        // Changes/document/clarification requests create the actionable client
        // request; its trigger writes the notification and outbox event in the
        // same transaction.
        let createdRequest: any = null;
        if (['request_submission_changes', 'request_submission_document', 'request_submission_clarification'].includes(op)) {
          const actionCode = op === 'request_submission_document' ? 'upload_document'
            : op === 'request_submission_clarification' ? 'provide_clarification'
            : 'review_and_submit';
          // Through the same validator as every other request. This path used
          // to take `String(body.section_code)` verbatim — an unvalidated
          // routing value is a routing value the caller chooses.
          const actionTarget = sanitiseActionTarget({
            requirement_id: body.requirement_id,
            section_code: body.section_code,
            target_step: op === 'request_submission_document' ? 'documents' : 'review',
          });
          const { data: reqRow, error: reqErr } = await admin.schema('aml').from('client_requests').insert({
            case_id: sub.case_id,
            kind: op === 'request_submission_document' ? 'new_document'
              : op === 'request_submission_clarification' ? 'clarification' : 'additional_info',
            subject: String(body.subject ?? 'Information needed on your submission').slice(0, 200),
            message: String(body.client_message ?? reason).slice(0, 4000),
            action_code: actionCode,
            action_target: actionTarget,
            requested_by: userId, requested_by_label: userEmail,
          }).select('*').single();
          if (reqErr) throw reqErr;
          createdRequest = reqRow;
        }

        await appendEvent(admin, sub.case_id, 'edd_note',
          `Submission v${sub.version_number} ${nextStatus.replace('_', ' ')}`,
          { submission_id: submissionId, review_status: nextStatus, reason: reason || null,
            client_request_id: createdRequest?.id ?? null,
            service_gate_unchanged: true },
          userId, userEmail);

        return jsonResponse({ submission: updated, client_request: createdRequest });
      }

      /* ═══════════ Document review with dual reasons (Stage 9) ═══════════ */
      case 'review_document_v2': {
        if (!canWrite) return jsonResponse({ error: 'Write role required' }, 403);
        const documentId = String(body.document_id ?? '');
        const decision = String(body.decision ?? '');
        if (!documentId || !['accepted', 'rejected'].includes(decision)) {
          return jsonResponse({ error: 'document_id and decision (accepted|rejected) required' }, 400);
        }
        const { data: doc } = await admin.schema('aml').from('documents')
          .select('*').eq('id', documentId).maybeSingle();
        if (!doc) return jsonResponse({ error: 'Document not found' }, 404);

        const internalNote = String(body.internal_review_note ?? '').trim();
        const safeReasonCode = String(body.client_safe_reason_code ?? '');
        if (decision === 'rejected') {
          if (!isClientSafeRejectionReason(safeReasonCode)) {
            return jsonResponse({
              error: 'A client-safe rejection reason code is required',
              allowed: CLIENT_SAFE_REJECTION_REASONS,
            }, 400);
          }
          if (internalNote.length < 5) {
            return jsonResponse({ error: 'An internal review reason is required' }, 400);
          }
        }
        const safeCopy = decision === 'rejected'
          ? String(body.client_safe_message ?? CLIENT_SAFE_REJECTION_COPY[safeReasonCode]).slice(0, 500)
          : null;

        const { data: updated, error: docErr } = await admin.schema('aml').from('documents').update({
          status: decision,
          // Legacy column keeps the client-safe text so older readers stay
          // correct; internal reasoning lives only in internal_review_note.
          rejection_reason: safeCopy,
          client_safe_rejection_reason: safeCopy,
          internal_review_note: internalNote || null,
          reviewed_by: userId, reviewed_at: new Date().toISOString(),
        }).eq('id', documentId).select('*').single();
        if (docErr) throw docErr;

        if (doc.requirement_id) {
          await admin.schema('aml').from('document_requirements')
            .update({ status: decision === 'accepted' ? 'accepted' : 'outstanding' })
            .eq('id', doc.requirement_id);
        }

        let createdRequest: any = null;
        if (decision === 'rejected') {
          const { data: reqRow } = await admin.schema('aml').from('client_requests').insert({
            case_id: doc.case_id, kind: 'new_document',
            subject: 'A document needs replacing',
            message: safeCopy ?? 'Please upload a replacement document.',
            action_code: 'upload_document',
            action_target: { requirement_id: doc.requirement_id ?? null, target_step: 'documents' },
            requested_by: userId, requested_by_label: userEmail,
          }).select('*').single();
          createdRequest = reqRow ?? null;
        }

        await appendEvent(admin, doc.case_id, 'system',
          `Document ${decision}: ${doc.filename}`,
          { document_id: documentId, decision, client_safe_reason_code: decision === 'rejected' ? safeReasonCode : null,
            requirement_id: doc.requirement_id ?? null, client_request_id: createdRequest?.id ?? null },
          userId, userEmail);

        return jsonResponse({ document: updated, client_request: createdRequest });
      }

      /* ═══════════ Party reconciliation (Stages 13/14) ═══════════ */
      case 'list_party_reconciliation': {
        const caseId = String(body.case_id ?? '');
        if (!caseId) return jsonResponse({ error: 'case_id required' }, 400);
        const { data } = await admin.schema('aml').from('party_reconciliation_items')
          .select('*').eq('case_id', caseId).order('created_at', { ascending: true });
        return jsonResponse({ items: data ?? [] });
      }

      case 'resolve_party_reconciliation': {
        if (!canWrite) return jsonResponse({ error: 'Write role required' }, 403);
        const itemId = String(body.item_id ?? '');
        const resolution = String(body.resolution ?? '');
        const rationale = String(body.rationale ?? '').trim();
        const allowed = ['linked', 'created', 'manual_only', 'rejected', 'superseded', 'conflict'];
        if (!itemId || !allowed.includes(resolution)) {
          return jsonResponse({ error: `item_id and resolution (${allowed.join('|')}) required` }, 400);
        }
        if (rationale.length < 5) return jsonResponse({ error: 'A rationale is required' }, 400);
        const { data: item } = await admin.schema('aml').from('party_reconciliation_items')
          .select('*').eq('id', itemId).maybeSingle();
        if (!item) return jsonResponse({ error: 'Item not found' }, 404);

        let partyType = item.resolved_party_type;
        let partyId = item.resolved_party_id;
        if (resolution === 'linked') {
          partyType = String(body.party_type ?? '');
          partyId = String(body.party_id ?? '');
          if (!partyType || !partyId) return jsonResponse({ error: 'party_type and party_id required to link' }, 400);
          // Cross-case / cross-tenant linking is refused: the canonical party
          // must belong to an entity on THIS case.
          const { data: owner } = await admin.schema('aml')
            .from(partyType === 'beneficial_owner' ? 'beneficial_owners' : 'authorised_representatives')
            .select('id, entity_id, aml_entities:entity_id(case_id)').eq('id', partyId).maybeSingle();
          const ownerCase = (owner as any)?.aml_entities?.case_id ?? null;
          if (!owner || (ownerCase && String(ownerCase) !== String(item.case_id))) {
            return jsonResponse({ error: 'That party does not belong to this case', code: 'cross_case_denied' }, 403);
          }
        }

        const { data: updated, error } = await admin.schema('aml').from('party_reconciliation_items').update({
          resolution_status: resolution,
          resolved_party_type: partyType ?? null,
          resolved_party_id: partyId ?? null,
          resolution_rationale: rationale,
          resolved_by: userId,
          resolved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', itemId).select('*').single();
        if (error) throw error;

        // Field-level provenance for every declared value at resolution time.
        const provenance = Object.entries((item.declared_payload ?? {}) as Record<string, unknown>)
          .filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
          .slice(0, 40)
          .map(([field, value]) => ({
            case_id: item.case_id, reconciliation_item_id: item.id,
            party_type: partyType ?? null, party_id: partyId ?? null,
            source_submission_id: item.submission_id, source_section: 'related_parties',
            source_field: field, submitted_value: String(value).slice(0, 500),
            canonical_value: resolution === 'linked' || resolution === 'created' ? String(value).slice(0, 500) : null,
            resolution_status: resolution, actor_id: userId, actor_label: userEmail, rationale,
          }));
        if (provenance.length > 0) {
          await admin.schema('aml').from('party_field_provenance').insert(provenance);
        }

        // Screening work follows reconciliation, never precedes it. The
        // subject carries every identifying detail the declaration already
        // holds — matching on a bare display name wastes the matcher's
        // DOB/alias tolerance. Nothing is invented: absent stays absent.
        if (['linked', 'created'].includes(resolution) && item.screening_required) {
          const declared = (item.declared_payload ?? {}) as Record<string, unknown>;
          const declaredDob = typeof declared.date_of_birth === 'string' ? declared.date_of_birth : null;
          const declaredCountry = typeof declared.country === 'string' ? declared.country
            : typeof declared.nationality === 'string' ? declared.nationality : null;
          const declaredAliases = Array.isArray(declared.aliases)
            ? declared.aliases.filter((a) => typeof a === 'string').slice(0, 20)
            : [];
          await admin.schema('aml').from('party_screening_subjects').insert({
            case_id: item.case_id, party_type: partyType ?? item.declared_role,
            party_id: partyId ?? null, reconciliation_item_id: item.id,
            screened_name: item.declared_name, required: true, state: 'not_started',
            aliases: declaredAliases,
            date_of_birth: declaredDob,
            country: declaredCountry,
          });
        }

        await appendEvent(admin, item.case_id, 'system',
          `Party reconciliation ${resolution}: ${item.declared_name}`,
          { reconciliation_item_id: itemId, resolution, party_type: partyType, party_id: partyId },
          userId, userEmail);
        return jsonResponse({ item: updated });
      }

      /* ═══════════ Party verification links (Stage 15) ═══════════ */
      case 'list_party_verification_links': {
        const caseId = String(body.case_id ?? '');
        if (!caseId) return jsonResponse({ error: 'case_id required' }, 400);
        const [{ data: links }, { data: checks }] = await Promise.all([
          admin.schema('aml').from('party_verification_links')
            .select('*').eq('case_id', caseId).is('unlinked_at', null),
          admin.schema('aml').from('verification_checks')
            .select('id, party_label, check_type, status, authoritative, execution_mode, completed_at')
            .eq('case_id', caseId).order('created_at', { ascending: false }),
        ]);
        return jsonResponse({ links: links ?? [], eligible_checks: (checks ?? []).filter((c: any) => c.authoritative !== false) });
      }

      case 'link_party_verification': {
        if (!canWrite) return jsonResponse({ error: 'Write role required' }, 403);
        const caseId = String(body.case_id ?? '');
        const partyType = String(body.party_type ?? '');
        const checkId = String(body.verification_check_id ?? '');
        if (!caseId || !partyType || !checkId) {
          return jsonResponse({ error: 'case_id, party_type and verification_check_id required' }, 400);
        }
        const { data: check } = await admin.schema('aml').from('verification_checks')
          .select('id, case_id, status, authoritative, execution_mode, check_type').eq('id', checkId).maybeSingle();
        if (!check) return jsonResponse({ error: 'Verification check not found' }, 404);
        // Cross-case linking is impossible by contract.
        if (String(check.case_id) !== caseId) {
          return jsonResponse({ error: 'That check belongs to a different case', code: 'cross_case_denied' }, 403);
        }
        if (check.execution_mode === 'simulation' || check.authoritative === false) {
          return jsonResponse({ error: 'A simulated or non-authoritative check cannot be evidence', code: 'not_authoritative' }, 409);
        }
        const { data: link, error } = await admin.schema('aml').from('party_verification_links').insert({
          case_id: caseId, party_type: partyType, party_id: body.party_id ? String(body.party_id) : null,
          verification_check_id: checkId, relationship: String(body.relationship ?? 'identity_evidence'),
          authoritative: check.authoritative !== false, linked_by: userId,
          metadata: { check_type: check.check_type, linked_status: check.status },
        }).select('*').single();
        if (error) throw error;
        // Convenience pointer on the canonical party row — derived, never a
        // substitute for the link evidence.
        if (body.party_id && ['beneficial_owner', 'authorised_representative'].includes(partyType)) {
          await admin.schema('aml')
            .from(partyType === 'beneficial_owner' ? 'beneficial_owners' : 'authorised_representatives')
            .update({ verification_check_id: checkId }).eq('id', String(body.party_id));
        }
        await appendEvent(admin, caseId, 'system', 'Party verification evidence linked',
          { party_type: partyType, party_id: body.party_id ?? null, verification_check_id: checkId },
          userId, userEmail);
        return jsonResponse({ link });
      }

      case 'unlink_party_verification': {
        if (!canWrite) return jsonResponse({ error: 'Write role required' }, 403);
        const linkId = String(body.link_id ?? '');
        const reason = String(body.reason ?? '').trim();
        if (!linkId) return jsonResponse({ error: 'link_id required' }, 400);
        if (reason.length < 5) return jsonResponse({ error: 'An unlink reason is required' }, 400);
        const { data: link, error } = await admin.schema('aml').from('party_verification_links')
          .update({ unlinked_at: new Date().toISOString(), unlink_reason: reason })
          .eq('id', linkId).is('unlinked_at', null).select('*').single();
        if (error) throw error;
        await appendEvent(admin, link.case_id, 'system', 'Party verification evidence unlinked',
          { link_id: linkId, reason }, userId, userEmail);
        return jsonResponse({ link });
      }

      /* ═══════════ Party-scoped screening (Stage 16) ═══════════ */
      /**
       * One idempotent read that answers all of Stage 5.
       *
       * It enrols whoever is missing, works out which scopes are
       * proportionate for this case, records that decision once with the
       * client's own answers attached, and returns the single next action a
       * person actually has to take.
       *
       * It never produces a screening OUTCOME. It does not write "clear", it
       * does not write a PEP result, and it does not advance a stage — the
       * stage is derived from evidence, and completing it is not a
       * service-gate approval.
       */
      case 'sync_screening_stage': {
        const caseId = String(body.case_id ?? '');
        if (!caseId) return jsonResponse({ error: 'case_id required' }, 400);

        let { data: caseRow } = await admin.schema('aml').from('cases')
          .select('id, status, case_stage, closed_at, service_gate_status, risk_rating, subject_display_name')
          .eq('id', caseId).maybeSingle();
        if (!caseRow) {
          // A deployment without the dimension columns still answers, on the
          // legacy shape it has always had.
          ({ data: caseRow } = await admin.schema('aml').from('cases')
            .select('id, status, risk_rating, subject_display_name')
            .eq('id', caseId).maybeSingle());
        }
        if (!caseRow) return jsonResponse({ error: 'Case not found' }, 404);

        /*
         * Closed, read from the CANONICAL dimension with the legacy one as
         * the fallback. Either saying closed is enough: they are two views of
         * one lifecycle and disagreement between them is a defect, not a
         * third state, so the safe reading is the one that does not present a
         * retained record as a live journey.
         */
        const caseClosed = String(caseRow.case_stage ?? '') === 'closed'
          || String(caseRow.status ?? '') === 'closed';

        const enrol = await ensureScreeningSubjects(admin, caseId, userId, userEmail);

        const [{ data: submission }, { data: determinations }, { data: provider },
               { data: syncs }] = await Promise.all([
          admin.schema('aml').from('submission_versions')
            .select('snapshot').eq('case_id', caseId).is('superseded_at', null)
            .order('version_number', { ascending: false }).limit(1).maybeSingle(),
          admin.schema('aml').from('pep_determinations')
            .select('id, party_screening_subject_id, result, review_due_at, superseded_at')
            .eq('case_id', caseId).is('superseded_at', null),
          // Several tenants may hold a row for this capability; take the one
          // the dispatcher would. maybeSingle() would error on more than one.
          admin.schema('aml').from('provider_configs')
            .select('provider_key, mode, active, priority').eq('capability', 'pep_sanctions')
            .order('priority', { ascending: true }).limit(1),
          admin.schema('aml').from('sanctions_list_syncs')
            .select('list_code, status, entry_count, completed_at, started_at')
            .order('started_at', { ascending: false }).limit(50),
        ]);

        /*
         * How long the oldest unprocessed screening request has been waiting.
         * `queued` only means "running" if something is consuming the queue,
         * and for months nothing was — a request sat with attempts = 0 while
         * the workspace reported the engine was working.
         */
        const { data: pending } = await admin.from('integration_outbox')
          .select('occurred_at')
          .eq('event_type', 'aml.screening.requested')
          .is('processed_at', null)
          .order('occurred_at', { ascending: true }).limit(1);
        const oldestQueued = Array.isArray(pending) ? pending[0] ?? null : null;
        const oldestQueuedSeconds = oldestQueued?.occurred_at
          ? Math.max(0, Math.floor(
            (Date.now() - new Date(oldestQueued.occurred_at).getTime()) / 1000))
          : null;

        const sections = (((submission?.snapshot ?? {}) as any).sections ?? []) as any[];
        const payload = (name: string): Record<string, unknown> =>
          (sections.find((x: any) => x?.section === name)?.payload ?? {}) as Record<string, unknown>;
        const yesNo = (v: unknown) => (v === 'yes' || v === true ? 'yes'
          : v === 'no' || v === false ? 'no' : null) as 'yes' | 'no' | null;

        const personal = payload('personal_details');
        const purchase = payload('purchase_profile');
        const funding = payload('funding');
        const structure = payload('purchasing_structure');

        const nowIso = new Date().toISOString();
        const detBySubject = new Map<string, any>();
        for (const d of determinations ?? []) {
          if (d.party_screening_subject_id) detBySubject.set(String(d.party_screening_subject_id), d);
        }
        const currentDetermination = (subjectId: string) => {
          const d = detBySubject.get(subjectId);
          if (!d || d.superseded_at) return null;
          if (d.review_due_at && String(d.review_due_at) < nowIso) return null;
          return d;
        };

        // Read from the enrolled subjects: `required` is derived from the
        // scope decision this block feeds, so it does not exist yet.
        const anyPepFinding = (enrol.subjects ?? []).some((s: any) =>
          currentDetermination(String(s.id))?.result === 'pep');


        /*
         * ── The scope decision, before anything acts on it ────────────
         *
         * This has to happen here rather than further down, because every
         * decision below depends on it: whether the sanctions provider's
         * readiness is even relevant, whether a subject may be auto-run, and
         * what the stage tells the operator to do next. Deciding scope after
         * provider readiness is what made an unloaded DFAT list block cases
         * that never needed it.
         */
        const perimeterRow = await readCasePerimeter(admin, caseId);
        const policyInput = {
          answers: {
            pep: yesNo(personal.pep), adverse: yesNo(personal.adverse),
            thirdParty: yesNo(purchase.third_party), overseasFunding: yesNo(funding.overseas),
          },
          entityType: typeof structure.entity_type === 'string' ? structure.entity_type : null,
          riskRating: caseRow.risk_rating ?? null,
          enhancedDueDiligence: caseRow.status === 'edd_required',
          anyPepFinding,
        };
        const scope = deriveScreeningScope({ ...policyInput, perimeter: perimeterRow });
        const scopeSync = await syncScreeningScopeDecision(
          admin, caseId, scope, perimeterRow?.id ?? null, enrol.subjects ?? []);
        if (scopeSync.subjectsChanged > 0) {
          const { data: afterScope } = await admin.schema('aml')
            .from('party_screening_subjects')
            .select('*').eq('case_id', caseId).order('created_at', { ascending: true });
          if (afterScope) enrol.subjects = afterScope;
        }

        /*
         * Provider readiness and the required-subject list, computed before
         * recovery because recovery depends on both: the stage only runs a
         * check itself when the provider could actually serve it.
         */
        const dfatRows = (syncs ?? []).filter((x: any) => x.list_code === 'dfat');
        const dfatLoaded = dfatRows.some(
          (x: any) => x.status === 'succeeded' && Number(x.entry_count) > 0);
        const providerRow: any = Array.isArray(provider) ? provider[0] ?? null : provider ?? null;
        const providerReady = providerRow !== null && providerRow.active === true &&
          providerRow.mode === 'live' && dfatLoaded;
        const requiredOf = (rows: any[] | null | undefined) => (rows ?? []).filter((s: any) =>
          s.required && s.state !== 'not_required');

        /*
         * ── Readiness is a property of a SCOPE, not of the stage ───────
         *
         * `providerReady` answers one question: could the sanctions provider
         * run right now. Whether that MATTERS is a different question, and
         * conflating them is what let an unloaded DFAT list block a case
         * with no sanctions obligation at all.
         *
         * `providerRelevant` is the second question. When it is false the
         * stage neither waits for the provider nor reports it as a blocker —
         * and, critically, the list being empty is not a defect to fix but a
         * fact that does not apply.
         */
        const providerRelevant = providerReadinessRelevant(scope);
        // Auto-execution needs a provider that can actually answer AND a
        // scope that actually requires it. Without the first, recovery would
        // burn a claim to produce the same refusal the stage already reports;
        // without the second it would run — and bill — a check nobody asked
        // for.
        const providerReadyForAuto = providerReady && scope.sanctions.required;

        /*
         * ── Self-healing ─────────────────────────────────────────────
         *
         * A queued request that nothing consumed used to sit there until an
         * operator noticed and pressed a button. Measured on this case: 130
         * minutes, and the only way out was a human. That is a dead end
         * dressed as a status.
         *
         * The stage now recovers itself on read, and does it in exactly two
         * situations — bounded deliberately, because "run screening
         * automatically" must never become "run the provider on every page
         * load":
         *
         *   NEVER ATTEMPTED   `not_started` with no check: nothing has been
         *                     spent, so starting it costs one attempt and
         *                     removes a click the operator should not need.
         *
         *   STALLED           queued or processing past the stall window with
         *                     no check: the queue did not consume it, so
         *                     releasing and running it is recovery, not a
         *                     second attempt.
         *
         * `error` is deliberately EXCLUDED. `processScreeningEvent` claims
         * `queued` and `error` alike, so auto-running an errored subject
         * would re-run the provider on every page view — a retry loop, paid
         * for per view. A failure keeps its explicit Retry.
         *
         * Safety is the consumer's own: it claims each subject with a
         * conditional UPDATE, so two concurrent readers cannot both run it,
         * and a terminal check is resumed rather than repeated.
         */
        let required = requiredOf(enrol.subjects);
        if (canWrite && providerReadyForAuto) {
          const recoverable = recoverableSubjects(
            required.map((s: any) => ({
              id: String(s.id), state: String(s.state),
              screeningCheckId: s.screening_check_id ?? null,
              updatedAt: s.updated_at ?? null, required: true,
            })),
            Date.now(),
          );
          const recovered: string[] = [];
          for (const subject of recoverable.slice(0, 5)) {
            try {
              if (subject.state !== 'not_started') {
                /*
                 * Retire this subject's dead queue entries first, so one
                 * cannot be claimed late and race this run.
                 *
                 * Scoped by `aggregate_id`, which the emitting trigger sets to
                 * the subject id. Retiring on event_type alone would retire
                 * every OTHER case's pending request too — including ones a
                 * worker was about to consume legitimately.
                 */
                await admin.from('integration_outbox')
                  .update({
                    processed_at: new Date().toISOString(),
                    locked_at: null, locked_by: null,
                    last_error: 'superseded_by_auto_recovery',
                  })
                  .eq('event_type', 'aml.screening.requested')
                  .eq('aggregate_id', subject.id)
                  .is('processed_at', null);
                await admin.schema('aml').from('party_screening_subjects')
                  .update({ state: 'queued', error_category: null,
                    updated_at: new Date().toISOString() })
                  .eq('id', subject.id);
              }
              // Convergence-checked like every other execution path: a
              // recovery that silently fails to claim would put the subject
              // straight back into the state recovery exists to leave.
              const outcome = await runScreeningInline(admin, subject.id);
              if (outcome.ran) recovered.push(subject.id);
            } catch {
              // The consumer has already recorded the error category against
              // the subject. A failed recovery must not fail the read that
              // triggered it — the operator still gets their page, now with a
              // determinate state on it.
            }
          }
          if (recoverable.length > 0) {
            const { data: refreshed } = await admin.schema('aml')
              .from('party_screening_subjects')
              .select('*').eq('case_id', caseId).order('created_at', { ascending: true });
            if (refreshed) {
              enrol.subjects = refreshed;
              // Everything downstream — the policy decision, the PEP finding
              // sweep, the next action — reads `required`. Leaving it pointing
              // at the pre-recovery rows would report the state the operator
              // came here to escape.
              required = requiredOf(refreshed);
            }
          }
          if (recovered.length > 0) {
            /*
             * Recorded, because an AML audit must be able to see WHY a
             * provider was called when no person pressed anything. An
             * unattributed screening run is worse than a slow one.
             */
            await appendEvent(admin, caseId, 'system',
              recovered.length === 1
                ? 'Screening ran automatically for 1 subject'
                : `Screening ran automatically for ${recovered.length} subjects`,
              {
                reason: 'screening_auto_recovery',
                party_screening_subject_ids: recovered,
                stall_seconds: SCREENING_STALL_SECONDS,
              }, userId, userEmail);
          }
        }

        /*
         * ── The other half of never sitting queued ───────────────────
         *
         * The recovery above is gated on the provider being able to answer,
         * which is right: re-running against a dead provider only burns a
         * claim. But the gate had no else-branch, so when the provider was
         * NOT ready a stalled request simply stayed `queued` — for ever, with
         * no category and nothing to press. That is the silent state this
         * whole stage is supposed to make impossible, and it was reachable
         * from the moment provider readiness failed.
         *
         * A subject that cannot be run because the PLATFORM is not ready is
         * still a subject that must say so. It is converged to `error` with
         * the reason the stage already knows, using the existing vocabulary:
         * the list, the mode, or the absence of a provider row.
         *
         * It produces no screening outcome, it is fully reversible by Retry
         * once the provider is fixed, and the scope stays outstanding.
         */
        if (canWrite && scope.sanctions.required && !providerReadyForAuto) {
          const notReadyCategory = providerRow === null
            ? 'provider_not_configured'
            : !dfatLoaded
              ? 'list_data_unavailable'
              : 'provider_misconfigured';
          const stranded = recoverableSubjects(
            required.map((s: any) => ({
              id: String(s.id), state: String(s.state),
              screeningCheckId: s.screening_check_id ?? null,
              updatedAt: s.updated_at ?? null, required: true,
            })),
            Date.now(),
          ).filter((s) => s.state !== 'not_started' && !((required.find(
            (r: any) => String(r.id) === s.id) ?? {}).error_category));
          for (const subject of stranded.slice(0, 10)) {
            const row = required.find((r: any) => String(r.id) === subject.id);
            await recordTechnicalFailure(
              admin,
              { id: subject.id, case_id: caseId, screened_name: row?.screened_name },
              notReadyCategory,
              'the screening provider cannot execute, so the queued request was failed '
                + 'rather than left waiting',
            );
          }
          if (stranded.length > 0) {
            const { data: refreshed } = await admin.schema('aml')
              .from('party_screening_subjects')
              .select('*').eq('case_id', caseId).order('created_at', { ascending: true });
            if (refreshed) { enrol.subjects = refreshed; required = requiredOf(refreshed); }
          }
        }


        // The legacy shape, from the SAME inputs the scope decision used, so
        // the two cannot describe different cases.
        const policy = decideScreeningPolicy(policyInput);

        /*
         * Two populations, and using the wrong one produced a next action
         * that contradicted the same card's own determination rows.
         *
         * `required` is the subjects whose SCREENING is owed. On a case whose
         * perimeter stood sanctions down that list is empty — so
         * `subjectCount: required.length` was 0 and the stage answered
         * "Nobody is enrolled for screening yet · Prepare screening" for a
         * case that had an enrolled party and needed no screening at all.
         * `anyMissingPep` was `.some()` over the same empty list, so the one
         * genuinely outstanding obligation could never be the next action.
         *
         * Enrolment is about the PARTIES; screening is about the obligation.
         */
        const enrolled = (enrol.subjects ?? []) as any[];
        const nextAction = deriveScreeningNextAction({
          hasSubmission: enrol.hasSubmission,
          subjectCount: enrolled.length,
          // A provider nobody needs is never the blocker.
          providerReady: providerRelevant ? providerReady : true,
          anyUnscreened: required.some((s: any) =>
            !['completed', 'false_positive', 'confirmed_match', 'queued', 'processing'].includes(s.state)),
          anyProcessing: required.some((s: any) => ['queued', 'processing'].includes(s.state)),
          anyPossibleMatch: required.some((s: any) => s.state === 'possible_match'),
          anyConfirmedMatch: required.some((s: any) => s.state === 'confirmed_match'),
          /*
           * PEP is owed per PARTY under its own scope decision, so it is read
           * over the enrolled parties and only when the scope requires it. A
           * party whose sanctions obligation was stood down still needs a PEP
           * determination, and an empty list is never "everybody determined".
           */
          anyMissingPep: scope.pep.required === true
            && (enrolled.length === 0
              || enrolled.some((s: any) => !currentDetermination(String(s.id)))),
          pepRoute: policy.pepRoute,
          // An undecided perimeter is a question to ask before a provider is
          // a problem to fix. The default it falls back to is unchanged.
          perimeterClassified: scope.perimeter.classified,
          // A retained record is not a stage in progress.
          caseClosed,
          /*
           * Whether the MANUAL route could discharge what the automated one
           * cannot. It is a fact about this case — a required sanctions scope
           * exists — and never about who is asking: the operation itself
           * enforces MLRO, and offering the route to a reader who may not take
           * it is how they learn who can.
           */
          manualAvailable: scope.sanctions.required === true,
          oldestQueuedSeconds,
          errorCategory: required.find((s: any) => s.state === 'error')?.error_category ?? null,
        });

        /*
         * Record the scope decision once, with the answers that produced it.
         * Re-recording an unchanged decision on every page load would bury
         * the audit trail, so it is written only when it differs from the
         * last one — which also makes a CHANGE (a new risk rating, a revised
         * answer) visible as its own entry rather than as noise.
         */
        const { data: priorEvents } = await admin.schema('aml').from('case_events')
          .select('payload, created_at').eq('case_id', caseId)
          .order('created_at', { ascending: false }).limit(60);
        const priorDecision = (priorEvents ?? [])
          .map((e: any) => e?.payload)
          .find((p: any) => p?.reason === 'screening_scope_decision');
        const fingerprint = JSON.stringify({
          required: policy.required, evidence: policy.evidence,
          route: policy.pepRoute, version: policy.policyVersion,
        });
        let decisionRecorded = false;
        if (!priorDecision || String(priorDecision.fingerprint ?? '') !== fingerprint) {
          await appendEvent(admin, caseId, 'system',
            policy.notRequired.length > 0
              ? 'Screening scope reduced to sanctions and PEP under AML/CTF policy '
                + policy.policyVersion
              : 'Screening scope: full, under AML/CTF policy ' + policy.policyVersion,
            {
              reason: 'screening_scope_decision',
              fingerprint,
              policy_version: policy.policyVersion,
              required_scopes: policy.required,
              not_required: policy.notRequired,
              triggers: policy.triggers,
              pep_route: policy.pepRoute,
              client_answers: policy.evidence,
            },
            userId, userEmail);
          decisionRecorded = true;
        }

        return jsonResponse({
          enrolled: enrol.enrolled,
          subjects: enrol.subjects,
          policy,
          /*
           * The canonical per-scope decision. The UI renders THIS rather than
           * deriving its own view of what is required — a compliance scope
           * decided in a browser tab is not a decision anyone can audit, and
           * two derivations of one rule is how they drift.
           */
          scopes: ALL_SCREENING_SCOPES.map((k) => ({
            scope: k,
            required: scope[k].required,
            optional: scope[k].optional,
            state: scope[k].required ? 'required' : 'not_required',
            reason_code: scope[k].reasonCode,
            reason: scope[k].reason,
          })),
          perimeter: {
            classification: scope.perimeter.classification,
            classified: scope.perimeter.classified,
            reason_code: scope.perimeter.reasonCode,
            scopes_excluded: scope.perimeter.scopesExcluded,
            recorded_by_label: scope.perimeter.recordedByLabel,
            recorded_at: scope.perimeter.recordedAt,
          },
          policy_version: scope.policyVersion,
          provider_ready: providerReady,
          /* Whether that readiness bears on this case at all. */
          provider_relevant: providerRelevant,
          /*
           * The canonical lifecycle, so Stage 5 can say "retained record"
           * rather than rendering a closed case as live onboarding. Reported,
           * never decided, here.
           */
          case_closed: caseClosed,
          case_stage: caseRow.case_stage ?? null,
          service_gate_status: caseRow.service_gate_status ?? null,
          next_action: nextAction,
          /*
           * What the CUSTOMER declared about political exposure, verbatim.
           *
           * The reviewer recording the determination had the client's answer
           * nowhere on the stage — it existed only as `personal_details.pep`
           * inside the policy's material inputs, one collapse down, as the
           * string "no". So the person making the determination could not see
           * what the person it is about had said without leaving the case.
           *
           * It is EVIDENCE and never the determination: nothing here records
           * one, prefills a conclusion or changes an obligation, and the
           * reading reports an unanswered question as unanswered rather than
           * as a "no".
           */
          pep_declaration: readPepDeclaration(personal),
          decision_recorded: decisionRecorded,
          scope_changed: scopeSync.changed,
          /* False when the scope tables are not present yet. */
          scope_recorded: scopeSync.recorded,
        });
      }

      /**
       * Reopen a closed case and resume the journey.
       *
       * `TRANSITIONS` declares `closed: []` — closed is terminal, and
       * deliberately so: a case must not drift back out of closure through
       * the ordinary status machinery. This operation is the ONE way back,
       * which is why it carries its own authority check, its own recorded
       * reason and its own audit entry rather than relaxing that table.
       *
       * It restores the ability to WORK the case. It does not restore
       * permission to SERVE — a terminated gate stays terminated and a
       * passport is never re-minted. Reversing those quietly is the dangerous
       * version of this feature.
       */
      case 'reopen_case': {
        const caseId = String(body.case_id ?? '');
        const reason = typeof body.reason === 'string' ? body.reason : null;
        if (!caseId) return jsonResponse({ error: 'case_id required' }, 400);

        let { data: caseRow } = await admin.schema('aml').from('cases')
          .select('id, case_reference, status, case_stage, service_gate_status, client_id')
          .eq('id', caseId).maybeSingle();
        if (!caseRow) {
          ({ data: caseRow } = await admin.schema('aml').from('cases')
            .select('id, case_reference, status, service_gate_status, client_id')
            .eq('id', caseId).maybeSingle());
        }
        if (!caseRow) return jsonResponse({ error: 'Case not found' }, 404);

        const [{ data: consents }, { data: subjects }, { data: submission },
               { data: assessment }] = await Promise.all([
          admin.schema('aml').from('consents')
            .select('kind, version').eq('case_id', caseId),
          admin.schema('aml').from('party_screening_subjects')
            .select('state, last_screened_at').eq('case_id', caseId),
          admin.schema('aml').from('submission_versions')
            .select('id').eq('case_id', caseId).limit(1).maybeSingle(),
          admin.schema('aml').from('risk_assessments')
            .select('id').eq('case_id', caseId).limit(1).maybeSingle(),
        ]);

        const plan = planCaseReopen({
          caseId, caseReference: String(caseRow.case_reference ?? caseId),
          status: String(caseRow.status ?? ''),
          // The canonical dimension, so a case the rest of the product calls
          // closed can actually be reopened — and reopening is what puts the
          // two dimensions back into agreement.
          caseStage: caseRow.case_stage ?? null,
          serviceGateStatus: caseRow.service_gate_status ?? null,
          consents: (consents ?? []).map((c: any) => ({
            kind: String(c.kind), version: c.version ?? null,
          })),
          currentConsentVersions: CURRENT_CONSENT_VERSIONS,
          hasPortalUser: true,
          screening: (subjects ?? []).map((s: any) => ({
            state: String(s.state), lastScreenedAt: s.last_screened_at ?? null,
          })),
          roles: [...roles],
          reason,
        });

        if (!plan.allowed) {
          return jsonResponse({
            error: plan.summary, code: plan.code,
            not_restored: plan.notRestored, preserved: plan.preserved,
          }, plan.code === 'role_required' ? 403 : 409);
        }

        const resumeStatus = resumeStatusFor({
          hasSubmission: Boolean(submission),
          hasCompletedScreening: (subjects ?? []).some(
            (s: any) => ['completed', 'false_positive'].includes(String(s.state))),
          hasRiskAssessment: Boolean(assessment),
        });

        /*
         * The gate is deliberately NOT touched. Reopening restores the work,
         * not the permission — `STATUS_TO_SERVICE_GATE[resumeStatus]` would
         * revive a terminated gate, which is the one thing this must never do.
         *
         * `case_stage` and `closed_at` ARE written, and their absence here was
         * a real defect. `status` is the legacy dimension; `case_stage` is the
         * canonical one every other surface reads. Reopening moved the first
         * and left the second, so a reopened case rendered as "Case stage:
         * Closed" in the Live Position rail and simultaneously offered the
         * ordinary status transitions of its resumed legacy status — the
         * contradiction that was reported. `transition` has always kept the
         * two coherent through the same map; this is the other write that
         * changes `status` and it did not.
         */
        const reopenPatch: Record<string, unknown> = {
          status: resumeStatus,
          client_portal_status: plan.reissue.includes('consents')
            ? 'awaiting_client' : 'in_progress',
          case_stage: STATUS_TO_STAGE[resumeStatus] ?? null,
          // A case being worked again is not closed, and a stale `closed_at`
          // is read as one by anything that asks the date rather than the
          // status.
          closed_at: null,
          updated_at: new Date().toISOString(),
        };
        let { error: updateError } = await admin.schema('aml').from('cases')
          .update(reopenPatch).eq('id', caseId);
        if (updateError && isMissingColumnError(updateError)) {
          // A deployment without the dimension columns keeps the old
          // behaviour rather than failing the reopen outright.
          ({ error: updateError } = await admin.schema('aml').from('cases').update({
            status: resumeStatus,
            client_portal_status: reopenPatch.client_portal_status,
            updated_at: reopenPatch.updated_at,
          }).eq('id', caseId));
        }
        if (updateError) throw updateError;

        /*
         * Portal access is NOT flipped here. `client_portal_status` is set to
         * `awaiting_client` above, which surfaces the existing portal-access
         * step through the ordinary next-action machinery, and that routes to
         * the one canonical provisioning control.
         *
         * Flipping `is_active` from this function would be a second source of
         * truth for portal access and a compensating write outside any
         * transaction — the precise pattern `amlActivationPathway.source.test`
         * forbids, because the old version of it could revert a concurrent
         * activation's client to inactive and the revert could itself fail.
         */

        /*
         * A consent given to a superseded version evidences what the client
         * agreed to THEN, not authority for what we do now. Those are marked
         * for re-acceptance; the rest are left alone, because re-ticking an
         * unchanged document is friction with no compliance value.
         */
        if (plan.staleConsents.length > 0) {
          await admin.schema('aml').from('consents')
            .delete().eq('case_id', caseId).in('kind', plan.staleConsents);
        }

        await appendEvent(admin, caseId, 'system',
          `Case reopened by ${userEmail ?? 'an operator'} — resumed at ${resumeStatus}`,
          {
            reason: 'case_reopened',
            reopen_reason: reason,
            resumed_status: resumeStatus,
            reissued: plan.reissue,
            consents_to_reaccept: plan.staleConsents,
            not_restored: plan.notRestored,
            service_gate_status: caseRow.service_gate_status ?? null,
            // Stated on the trail: the gate did NOT move, the stage did.
            case_stage: STATUS_TO_STAGE[resumeStatus] ?? null,
          },
          userId, userEmail);

        return jsonResponse({
          reopened: true, resumed_status: resumeStatus,
          reissued: plan.reissue, consents_to_reaccept: plan.staleConsents,
          not_restored: plan.notRestored, preserved: plan.preserved,
          summary: plan.summary,
        });
      }

      /**
       * Reset a client's AML/CTF journey, without orphaning a compliance record.
       *
       * `aml.cases.client_id` is ON DELETE SET NULL, so deleting a client
       * through the generic client API neither fails nor cascades — it leaves
       * the case, its screening subjects, its determinations and its event
       * chain attached to nobody. This operation exists because that outcome
       * is worse than either deleting or keeping: the operator believes the
       * data is gone and the record is unattributable.
       *
       * Two modes, and the policy module decides which is permitted:
       *   restart  close every open case, revoke portal access, delete nothing
       *   purge    remove the client and everything hanging off them, but only
       *            when no case carries evidence that must be retained
       */
      case 'reset_client_journey': {
        const clientId = String(body.client_id ?? '');
        const mode = body.mode === 'purge' ? 'purge' : 'restart';
        if (!clientId) return jsonResponse({ error: 'client_id required' }, 400);

        /*
         * `primary_first_name` / `primary_surname` — the columns `clients`
         * actually has. The first version of this selected `first_name,
         * last_name, email`, none of which exist: PostgREST refused the
         * statement, `client` came back null, and the policy answered
         * `unknown_client` to every request ever made of it.
         *
         * The same shape of mistake appears three times in this operation's
         * history, and it is invisible every time — a column that does not
         * exist and a column that is empty are indistinguishable in the
         * result, so the failure reads as a working safety rule.
         */
        const { data: client, error: clientReadError } = await admin.from('clients')
          .select('id, primary_first_name, primary_surname, primary_email')
          .eq('id', clientId).maybeSingle();
        if (clientReadError) {
          return jsonResponse({
            error: 'The client record could not be read, so nothing was changed.',
            code: 'client_unreadable', details: clientReadError.message,
          }, 500);
        }
        const clientName = client
          ? [client.primary_first_name, client.primary_surname]
            .filter(Boolean).join(' ').trim()
          : '';

        const { data: caseRows } = await admin.schema('aml').from('cases')
          .select('id, case_reference, service_gate_status, status').eq('client_id', clientId);
        const caseIds = (caseRows ?? []).map((c: any) => String(c.id));

        // Retention evidence, read rather than assumed. Each probe is
        // failure-tolerant: a table this deployment does not have cannot make
        // a purge look safe, so an unreadable probe counts as PRESENT.
        const probe = async (
          table: string, column = 'case_id', filter?: (q: any) => any,
        ): Promise<Set<string>> => {
          if (caseIds.length === 0) return new Set();
          try {
            let q = admin.schema('aml').from(table).select(column).in(column, caseIds);
            if (filter) q = filter(q);
            const { data, error } = await q;
            if (error) return new Set(caseIds); // unreadable ⇒ treat as blocking
            return new Set((data ?? []).map((r: any) => String(r[column])));
          } catch {
            return new Set(caseIds);
          }
        };

        /*
         * `aml.reports` — NOT `report_submissions`, which has no `case_id`
         * column at all. Probing it selected a column that does not exist,
         * PostgREST answered with an error, and the fail-closed branch below
         * turned that into "every case has a submitted report". The refusal
         * was total and looked exactly like the safety rule working.
         *
         * A report that exists but was never filed is a draft, and a draft is
         * not evidence anybody relied on — so the retention bar is a report
         * that actually went out.
         */
        const [reports, gateDecisions, confirmedMatches, holds, decisions] = await Promise.all([
          probe('reports', 'case_id', (q: any) => q.not('submitted_at', 'is', null)),
          probe('service_gate_decisions'),
          probe('party_screening_subjects', 'case_id',
            (q: any) => q.eq('state', 'confirmed_match')),
          probe('legal_holds', 'case_id', (q: any) => q.is('released_at', null)),
          probe('decisions'),
        ]);

        const decision = decideClientReset({
          clientId: client ? String(client.id) : '',
          clientName,
          typedConfirmation: typeof body.confirmation === 'string' ? body.confirmation : null,
          roles: [...roles],
          requestedMode: mode,
          cases: (caseRows ?? []).map((c: any) => ({
            caseId: String(c.id),
            caseReference: String(c.case_reference ?? c.id),
            hasSubmittedReport: reports.has(String(c.id)),
            hasServiceGateDecision: gateDecisions.has(String(c.id)),
            hasConfirmedMatch: confirmedMatches.has(String(c.id)),
            hasIssuedPassport: String(c.service_gate_status ?? '') === 'approved',
            underLegalHold: holds.has(String(c.id)),
            hasMlroDecision: decisions.has(String(c.id)),
          })),
        });

        if (!decision.allowed) {
          return jsonResponse({
            error: decision.summary, code: decision.code,
            blockers: decision.blockers, effects: decision.effects,
          }, decision.code === 'role_required' ? 403 : 409);
        }

        if (mode === 'restart') {
          // Nothing is deleted. Every open case is closed with a reason and
          // the portal invitation is retired so it cannot be reused.
          for (const c of caseRows ?? []) {
            if (['closed', 'cleared'].includes(String(c.status))) continue;
            await admin.schema('aml').from('cases').update({
              status: 'closed',
              client_portal_status: 'complete',
              updated_at: new Date().toISOString(),
            }).eq('id', c.id);
            await appendEvent(admin, String(c.id), 'system',
              `Journey restarted — case closed by ${userEmail ?? 'an operator'}`,
              { reason: 'journey_restart', mode }, userId, userEmail);
          }
          /*
           * Revoke portal access through `status`, which is the column that
           * exists. The first version of this set `is_active: false` — a
           * column `client_portal_users` does not have — so PostgREST
           * refused the statement, the unchecked result discarded the error,
           * and the customer kept a live login to a journey that had just
           * been closed underneath them.
           *
           * `disabled` is the value already in production for a revoked
           * login. The invitation token goes with it, so the old email
           * cannot be used to walk back in.
           */
          const { error: revokeError } = await admin.from('client_portal_users')
            .update({ status: 'disabled', invite_token: null, updated_at: new Date().toISOString() })
            .eq('client_id', clientId);
          return jsonResponse({
            mode, closed: (caseRows ?? []).length, deleted: 0, summary: decision.summary,
            portal_access_revoked: !revokeError,
            ...(revokeError ? { warning: 'The cases were closed but portal access could '
              + 'not be revoked. Revoke it manually before reissuing.' } : {}),
          });
        }

        /*
         * Purge, in three steps that are in this order for a reason.
         *
         * 1. The UNLINKED rows go first. 47 of the 49 foreign keys to
         *    `aml.cases` are ON DELETE CASCADE, so the case takes almost
         *    everything with it. What it does not take is the eight tables
         *    carrying a `case_id` with no constraint behind it — Postgres has
         *    no idea they are related, so nothing cascades and nothing
         *    complains. Those are what this loop is for.
         *
         * 2. The case is deleted, and the cascade does the other 47.
         *
         * 3. Nothing is left behind — VERIFIED, not assumed. The list in
         *    step 1 is a constant and the schema is not, so a re-count is the
         *    only thing that can catch a table nobody thought of.
         */
        const removed: Record<string, number> = {};
        const deleteBy = async (table: string, column: string, ids: string[]) => {
          if (ids.length === 0) return;
          try {
            const { count } = await admin.schema('aml').from(table)
              .delete({ count: 'exact' }).in(column, ids);
            if (count) removed[table] = count;
          } catch { /* absent table: nothing to remove */ }
        };

        for (const table of AML_PURGE_ORDER) await deleteBy(table, 'case_id', caseIds);
        await deleteBy('cases', 'id', caseIds);

        /*
         * The client row is only removed once the case rows are demonstrably
         * gone. Deleting it while an AML row survives would produce exactly
         * the orphan this operation exists to prevent — and in production one
         * case in six is already in that state, so this is a defect that has
         * happened rather than one that might.
         */
        const residue: Record<string, number> = {};
        if (caseIds.length > 0) {
          const { count: casesLeft } = await admin.schema('aml').from('cases')
            .select('id', { count: 'exact', head: true }).in('id', caseIds);
          if (casesLeft) residue.cases = casesLeft;
          for (const table of AML_UNLINKED_CASE_TABLES) {
            try {
              const { count, error } = await admin.schema('aml').from(table)
                .select('case_id', { count: 'exact', head: true }).in('case_id', caseIds);
              if (!error && count) residue[table] = count;
            } catch { /* absent table cannot hold a row */ }
          }
        }
        if (Object.keys(residue).length > 0) {
          return jsonResponse({
            error: 'The client was NOT deleted — AML records remain that would have been '
              + 'orphaned. Nothing further was removed.',
            code: 'orphan_risk', removed, remaining: residue,
          }, 409);
        }

        // The receipt is written BEFORE the client row goes, and to a table
        // that is not hanging off it — a purge that leaves no trace of having
        // happened is not an auditable operation.
        await admin.from('activity_logs').insert({
          action_type: 'aml_client_journey_purged',
          entity_type: 'client',
          entity_id: clientId,
          metadata: {
            client_name: clientName,
            case_references: (caseRows ?? []).map((c: any) => c.case_reference),
            removed,
            performed_by: userEmail,
            performed_at: new Date().toISOString(),
          },
        }).then(() => undefined, () => undefined);

        const { error: clientError } = await admin.from('clients').delete().eq('id', clientId);
        if (clientError) {
          return jsonResponse({
            error: 'The AML records were removed but the client row could not be deleted',
            details: clientError.message, removed,
          }, 500);
        }

        return jsonResponse({ mode, deleted: 1, removed, summary: decision.summary });
      }

      case 'list_party_screening': {
        const caseId = String(body.case_id ?? '');
        if (!caseId) return jsonResponse({ error: 'case_id required' }, 400);
        // Enrolment runs on read so every existing case self-heals the first
        // time somebody opens it. Idempotent: it returns only what is missing.
        const enrolment = await ensureScreeningSubjects(admin, caseId, userId, userEmail);
        const [{ data: subjects }, { data: determinations }] = await Promise.all([
          Promise.resolve({ data: enrolment.subjects }),
          admin.schema('aml').from('pep_determinations')
            .select('id, party_screening_subject_id, subject_name, result, pep_type, pep_relationship, determined_at, determined_by_label, review_due_at, superseded_at')
            .eq('case_id', caseId).is('superseded_at', null),
        ]);
        // Staff adjudicate the actual canonical candidates, so the panel
        // needs to show them. Staff-side only — this response never reaches
        // the Client or Finance portals.
        const checkIds = (subjects ?? []).map((s: any) => s.screening_check_id).filter(Boolean);
        let matchesByCheck: Record<string, any[]> = {};
        if (checkIds.length > 0) {
          const { data: matches } = await admin.schema('aml').from('screening_matches')
            .select('id, screening_check_id, match_type, list_name, matched_name, score, jurisdiction, status, details')
            .in('screening_check_id', checkIds).order('score', { ascending: false });
          for (const m of matches ?? []) {
            (matchesByCheck[m.screening_check_id] ??= []).push(m);
          }
        }
        const detBySubject = new Map<string, any>();
        for (const d of determinations ?? []) {
          if (d.party_screening_subject_id) detBySubject.set(String(d.party_screening_subject_id), d);
        }
        const caseLevelPep = (determinations ?? []).find((d: any) => !d.party_screening_subject_id) ?? null;

        /*
         * Manual attempts, so Stage 5 shows ONE screening history per party
         * rather than an automated one and a manual one side by side. A
         * manual check is an ordinary `screening_checks` row, so this is a
         * filter on the same table the automated path writes — not a second
         * store.
         *
         * The columns arrive with a migration, and this function deploys
         * independently of it. A missing column must degrade to "no manual
         * history", never to a 500 that takes the whole panel with it.
         */
        const manualBySubject: Record<string, any[]> = {};
        {
          const { data: manualChecks, error: manualError } = await admin.schema('aml')
            .from('screening_checks')
            .select('id, scope, status, screening_method, manual_outcome, unable_reason, '
              + 'rationale, sources_checked, searched_names, performed_at, policy_required, '
              + 'voluntary, metadata')
            .eq('case_id', caseId).eq('screening_method', 'manual')
            .order('performed_at', { ascending: false }).limit(100);
          if (manualError && !isMissingColumnError(manualError)) throw manualError;
          for (const c of (manualChecks ?? []) as any[]) {
            const sid = String((c.metadata as any)?.party_screening_subject_id ?? '');
            if (sid) (manualBySubject[sid] ??= []).push(c);
          }
        }

        return jsonResponse({
          subjects: (subjects ?? []).map((s: any) => ({
            ...s,
            matches: s.screening_check_id ? (matchesByCheck[s.screening_check_id] ?? []) : [],
            pep_determination: detBySubject.get(String(s.id)) ?? null,
            manual_checks: manualBySubject[String(s.id)] ?? [],
          })),
          case_pep_determination: caseLevelPep,
        });
      }

      /**
       * Record whether this case is inside the sanctions perimeter.
       *
       * ── The only lever that can stand sanctions down ───────────────
       * Targeted financial sanctions are not risk-based. No rating, profile
       * or questionnaire answer reduces them, and nothing in this function
       * lets one try. What CAN be true is that a case is not a dealing at
       * all — an enquiry that never became an engagement, an administrative
       * duplicate, a service declined before it commenced — and that is what
       * this records.
       *
       * Reviewer or MLRO only. Standing down a sanctions obligation is a
       * compliance act, not data entry, and `canWrite` includes analysts.
       *
       * The client never reaches this. `required` is not an input anywhere
       * in this function: the caller names a CLASSIFICATION and a REASON
       * CODE from a fixed list, and the policy module derives the scope from
       * them. A payload claiming `required: false` is ignored because
       * nothing reads it.
       */
      case 'classify_screening_perimeter': {
        if (!roles.has('reviewer') && !roles.has('mlro')) {
          return jsonResponse({
            error: 'Reviewer or MLRO role required to classify the screening perimeter',
            code: 'insufficient_role',
          }, 403);
        }
        const caseId = String(body.case_id ?? '');
        if (!caseId) return jsonResponse({ error: 'case_id required' }, 400);
        const { data: caseRow } = await admin.schema('aml').from('cases')
          .select('id').eq('id', caseId).maybeSingle();
        if (!caseRow) return jsonResponse({ error: 'Case not found' }, 404);

        const classification = String(body.classification ?? '');
        if (!['designated_service', 'outside_perimeter'].includes(classification)) {
          return jsonResponse({
            error: 'classification must be designated_service or outside_perimeter',
          }, 400);
        }
        let reasonCode: string | null = null;
        let scopesExcluded: string[] = [];
        if (classification === 'outside_perimeter') {
          reasonCode = String(body.reason_code ?? '');
          if (!(PERIMETER_REASON_CODES as readonly string[]).includes(reasonCode)) {
            return jsonResponse({
              error: 'reason_code must be one of: ' + PERIMETER_REASON_CODES.join(', '),
              code: 'invalid_reason_code',
            }, 400);
          }
          scopesExcluded = Array.isArray(body.scopes_excluded)
            ? [...new Set((body.scopes_excluded as unknown[]).map((x) => String(x)))]
              .filter((x) => (ALL_SCREENING_SCOPES as readonly string[]).includes(x))
            : [];
          if (scopesExcluded.length === 0) {
            return jsonResponse({
              error: 'Name at least one scope the finding removes. A perimeter finding that '
                + 'excludes nothing exempts nothing.',
              code: 'no_scopes_excluded',
            }, 400);
          }
        }
        const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : null;

        const nowIso = new Date().toISOString();
        // Supersede rather than edit: the basis a past decision rested on is
        // never rewritten, and the partial unique index makes two concurrent
        // writers impossible rather than merely unlikely.
        await admin.schema('aml').from('case_screening_perimeter')
          .update({ superseded_at: nowIso })
          .eq('case_id', caseId).is('superseded_at', null);
        const { data: recorded, error: perimeterError } = await admin.schema('aml')
          .from('case_screening_perimeter').insert({
            case_id: caseId,
            classification,
            reason_code: reasonCode,
            scopes_excluded: scopesExcluded,
            note,
            recorded_by: userId,
            recorded_by_label: userEmail,
            policy_version: SCREENING_POLICY_VERSION,
          }).select('*').single();
        if (perimeterError) throw perimeterError;

        await appendEvent(admin, caseId, 'system',
          classification === 'outside_perimeter'
            ? `Screening perimeter: outside — ${scopesExcluded.join(', ')} not required (${reasonCode})`
            : 'Screening perimeter: inside — a designated service is provided',
          {
            reason: 'screening_perimeter_classified',
            classification,
            reason_code: reasonCode,
            scopes_excluded: scopesExcluded,
            note,
            policy_version: SCREENING_POLICY_VERSION,
          },
          userId, userEmail);

        return jsonResponse({ perimeter: recorded });
      }

      /**
       * Run a screening the policy does not require, because someone asked.
       *
       * ── What "optional" has to mean to be worth anything ───────────
       * A scope recorded as `not_required` still gets screened if an
       * authorised operator wants the evidence. The run is the NORMAL one —
       * same provider, same claim, same check and matches, same audit — and
       * the only difference is that the obligation never existed.
       *
       * So this must not, and does not, rewrite the policy decision.
       * `required` stays false throughout. What gets recorded is that a named
       * person chose to run it and when, which is the distinction between a
       * policy obligation and voluntarily obtained evidence.
       *
       * ── Refusing without blocking ──────────────────────────────────
       * If the provider genuinely cannot run, this says so and changes
       * nothing. It does NOT mark the subject in error and it does NOT make
       * the stage wait: the case never needed this screening, and an
       * unavailable provider for an optional extra is not a compliance
       * blocker.
       */
      case 'run_optional_screening': {
        if (!canWrite) return jsonResponse({ error: 'Write role required' }, 403);
        const subjectId = String(body.subject_id ?? '');
        if (!subjectId) return jsonResponse({ error: 'subject_id required' }, 400);
        const { data: subject } = await admin.schema('aml').from('party_screening_subjects')
          .select('*').eq('id', subjectId).maybeSingle();
        if (!subject) return jsonResponse({ error: 'Subject not found' }, 404);

        // The scope must actually be optional. Running this against a
        // REQUIRED scope would record a mandatory screening as voluntary.
        const { data: scopeRow } = await admin.schema('aml').from('case_screening_scopes')
          .select('*').eq('case_id', subject.case_id).eq('scope', 'sanctions')
          .is('superseded_at', null).maybeSingle();
        if (!scopeRow || scopeRow.required === true) {
          return jsonResponse({
            error: 'Sanctions screening is required for this case, so it is not optional. '
              + 'Use the normal screening action.',
            code: 'scope_is_required',
          }, 409);
        }
        if (['queued', 'processing'].includes(String(subject.state))) {
          return jsonResponse({ skipped: true, code: 'already_in_progress', subject });
        }
        if (['possible_match', 'confirmed_match'].includes(String(subject.state))) {
          return jsonResponse({
            error: 'This subject has candidate or confirmed matches — adjudicate them before re-screening',
            code: 'adjudication_required',
          }, 409);
        }

        // Readiness matters for THIS run and for nothing else. A refusal here
        // leaves the scope not_required and the stage unblocked.
        const [{ data: optProvider }, { data: optSyncs }] = await Promise.all([
          admin.schema('aml').from('provider_configs')
            .select('provider_key, mode, active, priority').eq('capability', 'pep_sanctions')
            .order('priority', { ascending: true }).limit(1),
          admin.schema('aml').from('sanctions_list_syncs')
            .select('list_code, status, entry_count').eq('list_code', 'dfat'),
        ]);
        const optProviderRow: any = Array.isArray(optProvider) ? optProvider[0] ?? null : optProvider;
        const optListLoaded = (optSyncs ?? []).some(
          (x: any) => x.status === 'succeeded' && Number(x.entry_count) > 0);
        const optReady = optProviderRow !== null && optProviderRow.active === true &&
          optProviderRow.mode === 'live' && optListLoaded;
        if (!optReady) {
          return jsonResponse({
            ran: false,
            code: 'provider_unavailable_for_optional_run',
            message: 'Optional sanctions screening cannot run: the provider or its list is '
              + 'not currently ready. This case does not require sanctions screening, so '
              + 'nothing is blocked.',
            provider_ready: false,
            scope_required: false,
            subject,
          }, 200);
        }

        const nowIso = new Date().toISOString();
        // Stamp the voluntariness BEFORE the run, so a check created by it can
        // never exist without the record of who asked for it.
        await admin.schema('aml').from('party_screening_subjects').update({
          voluntary_run_at: nowIso,
          voluntary_run_by: userId,
          voluntary_run_by_label: userEmail,
          state: 'queued',
          error_category: null,
          updated_at: nowIso,
        }).eq('id', subjectId);

        await appendEvent(admin, subject.case_id, 'system',
          `Optional sanctions screening started for ${subject.screened_name} — `
            + 'not required under policy, run at an operator\'s request',
          {
            reason: 'optional_screening_requested',
            party_screening_subject_id: subjectId,
            policy_required: false,
            scope: 'sanctions',
            scope_decision_id: scopeRow.id,
            scope_reason_code: scopeRow.reason_code,
            policy_version: scopeRow.policy_version,
          },
          userId, userEmail);

        // The normal pipeline, unchanged.
        const outcome = await runScreeningInline(admin, subjectId);

        const { data: after } = await admin.schema('aml').from('party_screening_subjects')
          .select('*').eq('id', subjectId).maybeSingle();
        // The check the run produced carries the same distinction, so evidence
        // read on its own still says it was voluntary.
        if (after?.screening_check_id) {
          const { data: chk } = await admin.schema('aml').from('screening_checks')
            .select('metadata').eq('id', after.screening_check_id).maybeSingle();
          await admin.schema('aml').from('screening_checks').update({
            requested_by: userId,
            metadata: {
              ...((chk?.metadata ?? {}) as Record<string, unknown>),
              voluntary: true,
              policy_required: false,
              scope_decision_id: scopeRow.id,
              scope_policy_version: scopeRow.policy_version,
              requested_by_label: userEmail,
            },
          }).eq('id', after.screening_check_id);
        }

        return jsonResponse({
          ran: outcome.ran,
          converged: outcome.converged,
          /* The policy is unchanged by anyone choosing to run it. */
          scope_required: false,
          subject: after ?? subject,
        });
      }

      /**
       * Record a screening the MLRO performed themselves.
       *
       * ── Method, not policy ─────────────────────────────────────────
       * Choosing manual never changes WHETHER screening was required. The
       * obligation is read from the recorded scope decision and stamped onto
       * the attempt as `policy_required`, so a voluntary manual check on an
       * exempt case can never be read back as a mandatory one, or the
       * reverse. Nothing here writes `case_screening_scopes`.
       *
       * ── MLRO only, and the server decides who that is ──────────────
       * `canWrite` includes analysts. Performing and concluding a screening
       * by hand is the MLRO's own act, so it is gated here rather than in the
       * browser, and `performed_by` is taken from the authenticated session —
       * never from the request. A client cannot nominate another actor, forge
       * the timestamp, or claim the obligation status.
       *
       * ── The same records an automated run writes ───────────────────
       * A canonical `screening_checks` row and, for a finding, canonical
       * `screening_matches` rows — so a manual candidate enters the existing
       * adjudication workflow rather than a parallel one, and every consumer
       * of those tables keeps working without knowing this exists.
       */
      case 'record_manual_screening': {
        if (!roles.has('mlro')) {
          return jsonResponse({
            error: 'MLRO role required to perform a manual screening',
            code: 'insufficient_role',
          }, 403);
        }
        const subjectId = String(body.subject_id ?? '');
        if (!subjectId) return jsonResponse({ error: 'subject_id required' }, 400);

        const { data: subject } = await admin.schema('aml').from('party_screening_subjects')
          .select('*').eq('id', subjectId).maybeSingle();
        if (!subject) return jsonResponse({ error: 'Subject not found' }, 404);

        /*
         * The case comes from the SUBJECT, never from the request. A caller
         * supplying a subject from another case (or another tenant) reaches
         * that case's own row and nothing else; there is no path here where a
         * body-supplied case_id decides what is written.
         */
        const caseId = String(subject.case_id);
        /*
         * Same defect: this selected `cases.tenant_id`, a column the table
         * does not have, so the read answered 42703 and every manual
         * screening was refused as "Case not found".
         *
         * The comparison it guarded was also circular — `caseId` comes from
         * `subject.case_id`, so the subject already belongs to this case.
         * What is worth checking is that the subject carries THIS
         * deployment's tenant, which is what the write will stamp.
         */
        const caseRead = await readCase<{ id: string }>(admin, caseId, 'id');
        if (caseRead.failed) {
          console.error('record_manual_screening: case read failed', caseRead.error);
          return jsonResponse({
            error: 'The case could not be read. Nothing was recorded.',
            code: 'case_read_failed',
          }, 503);
        }
        if (!caseRead.row) return jsonResponse({ error: 'Case not found' }, 404);
        if (String(subject.tenant_id ?? DEFAULT_AML_TENANT) !== caseRead.tenantId) {
          return jsonResponse({ error: 'Subject does not belong to this case', code: 'tenant_mismatch' }, 403);
        }

        const admissible = manualScreeningAdmissible({ state: String(subject.state) });
        if (!admissible.ok) {
          return jsonResponse({ error: admissible.message, code: admissible.code }, 409);
        }

        /*
         * PEP is deliberately NOT here. A manually established PEP conclusion
         * already has its own record (`aml.pep_determinations`, with sources,
         * rationale and a review date), and giving it a second home would
         * mean two answers to "is this party a PEP" that can disagree.
         *
         * An unrecognised scope is REFUSED rather than defaulted. Coercing it
         * to sanctions would record a screening against a scope the operator
         * did not choose, which is worse than an error.
         */
        const MANUAL_SCOPES = ['sanctions', 'adverse_media', 'watchlist'];
        const scopeKey = body.scope === undefined || body.scope === null
          ? 'sanctions' : String(body.scope);
        if (!MANUAL_SCOPES.includes(scopeKey)) {
          return jsonResponse({
            error: `scope must be one of: ${MANUAL_SCOPES.join(', ')}. A PEP determination `
              + 'is recorded through record_pep_determination, not here.',
            code: 'unsupported_scope',
          }, 400);
        }

        const plan = planManualScreening({
          outcome: body.outcome,
          sources: Array.isArray(body.sources) ? body.sources : [],
          searchedNames: Array.isArray(body.searched_names) ? body.searched_names : [],
          rationale: String(body.rationale ?? ''),
          unableReason: body.unable_reason ?? null,
          candidates: Array.isArray(body.candidates) ? body.candidates : [],
        });
        if (!plan.ok) return jsonResponse({ error: plan.message, code: plan.code }, 400);

        /*
         * Whether POLICY required this, read from the recorded decision — not
         * from the request, and not inferred from the fact that somebody
         * chose to screen. A missing scope row means the default, which is
         * required.
         */
        const { data: scopeRow } = await admin.schema('aml').from('case_screening_scopes')
          .select('required, policy_version').eq('case_id', caseId).eq('scope', scopeKey)
          .is('superseded_at', null).maybeSingle();
        const policyRequired = scopeRow ? scopeRow.required === true : true;

        const nowIso = new Date().toISOString();
        const { data: check, error: checkError } = await admin.schema('aml')
          .from('screening_checks').insert({
            case_id: caseId,
            subject_label: subject.screened_name,
            subject_type: subject.party_type === 'entity' ? 'entity' : 'individual',
            // Named for what it is. A manual check is NOT provider output and
            // must never read as though a list returned it.
            provider: 'manual_mlro',
            scope: [scopeKey],
            status: plan.checkStatus,
            screening_method: 'manual',
            // `execution_mode` stays live-vs-simulator: this ran against real
            // sources, by a person, so it is live and authoritative.
            execution_mode: 'live',
            authoritative: true,
            performed_by: userId,
            performed_at: nowIso,
            requested_by: userId,
            completed_at: nowIso,
            rationale: plan.rationale,
            sources_checked: plan.normalisedSources,
            searched_names: plan.normalisedNames,
            manual_outcome: plan.outcome,
            unable_reason: plan.unableReason,
            policy_required: policyRequired,
            voluntary: !policyRequired,
            result_summary: {
              manual: true,
              outcome: plan.outcome,
              source_count: plan.normalisedSources.length,
              names_searched: plan.normalisedNames.length,
              scopes_covered: [scopeKey],
            },
            metadata: {
              party_screening_subject_id: subjectId,
              party_type: subject.party_type,
              performed_by_label: userEmail,
              policy_version: scopeRow?.policy_version ?? SCREENING_POLICY_VERSION,
            },
          }).select('*').single();
        if (checkError) throw checkError;

        // Candidates go into the CANONICAL match table, so adjudication,
        // escalation and the risk system all treat them identically to an
        // automated finding.
        if (plan.candidateStatus) {
          /*
           * Built from the PLAN, never from the request body. The candidates
           * were normalised, trimmed and capped by `planManualScreening`, so
           * the columns a caller can reach are fixed by that module's shape:
           * extra keys on a submitted candidate cannot widen this row.
           */
          const rows = plan.normalisedCandidates.map((c) => ({
            screening_check_id: check.id,
            case_id: caseId,
            match_type: scopeKey,
            matched_name: c.matchedName,
            list_name: c.listName,
            jurisdiction: c.jurisdiction,
            status: plan.candidateStatus,
            details: {
              manual: true,
              reference: c.reference,
              match_basis: c.matchBasis,
              notes: c.notes,
              recorded_by_label: userEmail,
            },
          }));
          if (rows.length > 0) {
            const { error: matchError } = await admin.schema('aml')
              .from('screening_matches').insert(rows);
            if (matchError) throw matchError;
          }
        }

        /*
         * Project the subject. `required` is NOT touched: the obligation is
         * the policy's and this is an execution record.
         *
         * What may change depends on whether policy required the screening,
         * and the decision is `projectManualScreeningToSubject`'s rather than
         * this handler's — a voluntary clear leaves `not_required` standing,
         * because the policy decision and the screening result are answers to
         * different questions. A FINDING moves the state either way: a
         * sanctions match reaches the same adjudication whoever went looking.
         */
        const projection = projectManualScreeningToSubject(plan, { policyRequired });
        const patch: Record<string, unknown> = {
          screening_check_id: check.id,
          screening_method: 'manual',
          provider_key: 'manual_mlro',
          updated_at: nowIso,
        };
        if (projection.state !== null) {
          patch.state = projection.state;
          patch.error_category = projection.errorCategory;
        }
        if (projection.advancesFreshness) {
          patch.last_screened_at = nowIso;
          patch.refresh_due_at = computeRefreshDueAt(nowIso, await rescreenIntervalDays(admin));
        }
        await admin.schema('aml').from('party_screening_subjects')
          .update(patch).eq('id', subjectId);

        await appendEvent(admin, caseId, 'system',
          `Manual ${scopeKey.replace(/_/g, ' ')} screening recorded for ${subject.screened_name}: `
            + `${plan.outcome.replace(/_/g, ' ')}`
            + (policyRequired
              ? ''
              : ' — voluntary; the case still does not require this screening'),
          {
            reason: 'manual_screening_recorded',
            party_screening_subject_id: subjectId,
            screening_check_id: check.id,
            scope: scopeKey,
            screening_method: 'manual',
            outcome: plan.outcome,
            policy_required: policyRequired,
            voluntary: !policyRequired,
            source_count: plan.normalisedSources.length,
            sources: plan.normalisedSources.map((x) => x.source_name),
            names_searched: plan.normalisedNames,
            unable_reason: plan.unableReason,
            satisfies_obligation: plan.satisfiesObligation,
            // What this did NOT change is the part an auditor reads.
            party_state_unchanged: projection.state === null,
            policy_version: scopeRow?.policy_version ?? SCREENING_POLICY_VERSION,
          },
          userId, userEmail);

        return jsonResponse({
          check,
          outcome: plan.outcome,
          /* The policy is unchanged by anyone choosing to screen manually. */
          policy_required: policyRequired,
          voluntary: !policyRequired,
          satisfies_obligation: plan.satisfiesObligation,
          /* Null when the policy state was deliberately left standing. */
          party_state: projection.state,
        });
      }

      case 'queue_party_screening': {
        if (!canWrite) return jsonResponse({ error: 'Write role required' }, 403);
        const subjectId = String(body.subject_id ?? '');
        if (!subjectId) return jsonResponse({ error: 'subject_id required' }, 400);
        const { data: subject } = await admin.schema('aml').from('party_screening_subjects')
          .select('*').eq('id', subjectId).maybeSingle();
        if (!subject) return jsonResponse({ error: 'Subject not found' }, 404);
        // Already in flight — the queued event exists; do not emit another.
        if (['queued', 'processing'].includes(subject.state)) {
          return jsonResponse({ skipped: true, code: 'already_in_progress', subject });
        }
        // Candidates must be adjudicated through the canonical matches, not
        // papered over by a re-screen.
        if (['possible_match', 'confirmed_match'].includes(subject.state)) {
          return jsonResponse({
            error: 'This subject has candidate or confirmed matches — adjudicate them before re-screening',
            code: 'adjudication_required',
          }, 409);
        }
        // Freshness window: do not re-screen the same party inside it.
        const freshnessDays = Math.min(Math.max(Number(body.freshness_days ?? 90) || 90, 1), 365);
        if (subject.last_screened_at &&
            Date.now() - new Date(subject.last_screened_at).getTime() < freshnessDays * 864e5 &&
            ['completed', 'false_positive'].includes(subject.state)) {
          return jsonResponse({ skipped: true, code: 'within_freshness_window', subject });
        }
        // The transition to 'queued' emits aml.screening.requested through the
        // transactional outbox trigger; the cross-portal worker executes it
        // against the canonical screening engine.
        const { data: updated, error } = await admin.schema('aml').from('party_screening_subjects')
          .update({ state: 'queued', error_category: null, updated_at: new Date().toISOString() })
          .eq('id', subjectId).select('*').single();
        if (error) throw error;
        await appendEvent(admin, subject.case_id, 'system',
          `Party screening queued: ${subject.screened_name}`,
          { party_screening_subject_id: subjectId }, userId, userEmail);

        /*
         * Run it NOW, and keep the queue as the guarantee behind it.
         *
         * The transition to 'queued' emits `aml.screening.requested` through
         * the outbox trigger, and the worker was the only thing that ever
         * executed it. That made a background worker the CRITICAL path for
         * an action a person just pressed — so when the worker could not
         * authenticate, "Run screening" produced a spinner that never
         * resolved and no way to tell why.
         *
         * This is the same shape `aml-verification-processor` already has:
         * `aml-client-portal` invokes it directly the moment a submission is
         * accepted (the fast path, so the wait is seconds) and the cron sweep
         * is the durable guarantee behind it. Screening only ever had the
         * guarantee.
         *
         * Safety comes from `processScreeningEvent` itself, unchanged: it
         * claims the subject with a CONDITIONAL update, so a worker running
         * the same event concurrently loses the race and the provider runs at
         * most once. On failure it records the error category on the subject
         * — which is what turns a silent hang into "the DFAT list has never
         * been loaded" on the operator's screen.
         *
         * The outbox row is deliberately left in place. If this inline run
         * dies mid-flight, the queue still holds the work.
         */
        const inline = await runScreeningInline(admin, subjectId);

        const { data: after } = await admin.schema('aml').from('party_screening_subjects')
          .select('*').eq('id', subjectId).maybeSingle();
        return jsonResponse({ subject: after ?? updated, inline });
      }

      /**
       * Release a screening request that nothing ever picked up.
       *
       * `queue_party_screening` refuses a subject already `queued` — correctly,
       * because a second provider attempt costs money and can race the first.
       * That refusal assumed the queue was being consumed. It was not: the
       * outbox worker had no cron entry, so a request sat with attempts = 0
       * for ever and the only way out was a database edit.
       *
       * This is bounded and evidence-driven. It refuses unless the subject is
       * genuinely stuck — queued, with no screening check, and with a queue
       * entry older than the stall window — so it can never cancel work that
       * is actually in flight. It retires the dead outbox rows rather than
       * leaving them to be claimed later and race the retry, and it produces
       * no screening outcome.
       */
      case 'retry_stalled_screening': {
        if (!canWrite) return jsonResponse({ error: 'Write role required' }, 403);
        const subjectId = String(body.subject_id ?? '');
        if (!subjectId) return jsonResponse({ error: 'subject_id required' }, 400);
        const { data: subject } = await admin.schema('aml').from('party_screening_subjects')
          .select('*').eq('id', subjectId).maybeSingle();
        if (!subject) return jsonResponse({ error: 'Subject not found' }, 404);
        if (!['queued', 'processing'].includes(subject.state)) {
          return jsonResponse({ skipped: true, code: 'not_queued', subject });
        }
        if (subject.screening_check_id) {
          // A check exists, so the provider was reached. That is in flight or
          // finished, and releasing it would risk a duplicate attempt.
          return jsonResponse({ skipped: true, code: 'check_in_flight', subject });
        }

        const { data: pending } = await admin.from('integration_outbox')
          .select('id, occurred_at')
          .eq('event_type', 'aml.screening.requested')
          .is('processed_at', null)
          .order('occurred_at', { ascending: true });
        const stale = (pending ?? []).filter((e: any) =>
          Date.now() - new Date(e.occurred_at).getTime() >= SCREENING_STALL_SECONDS * 1000);
        if (stale.length === 0) {
          return jsonResponse({ skipped: true, code: 'not_stalled', subject });
        }

        // Retire the dead entries first, so the fresh request cannot race one
        // of them being claimed late.
        await admin.from('integration_outbox')
          .update({
            processed_at: new Date().toISOString(),
            locked_at: null, locked_by: null,
            last_error: 'superseded_by_operator_retry',
          })
          .in('id', stale.map((e: any) => e.id));

        const { data: released, error: releaseError } = await admin.schema('aml')
          .from('party_screening_subjects')
          .update({ state: 'not_started', error_category: null, updated_at: new Date().toISOString() })
          .eq('id', subjectId).select('*').single();
        if (releaseError) throw releaseError;

        await appendEvent(admin, subject.case_id, 'system',
          `Released a stalled screening request: ${subject.screened_name}`,
          {
            reason: 'screening_stall_released',
            party_screening_subject_id: subjectId,
            retired_outbox_events: stale.length,
          },
          userId, userEmail);
        return jsonResponse({ subject: released, retired: stale.length });
      }

      case 'adjudicate_party_screening': {
        if (!(roles.has('reviewer') || roles.has('mlro'))) {
          return jsonResponse({ error: 'Reviewer or MLRO role required' }, 403);
        }
        // Adjudication happens on the CANONICAL screening match, exactly as
        // aml-verification resolve_match does it — hash-chained resolution
        // row, match status change, then the party state is re-derived from
        // the full canonical match set. Updating party_screening_subjects
        // alone can no longer manufacture or bury a sanctions finding.
        const subjectId = String(body.subject_id ?? '');
        const matchId = String(body.match_id ?? '');
        const outcome = String(body.outcome ?? '');
        const note = String(body.note ?? '').trim();
        if (!subjectId || !['confirmed_match', 'false_positive'].includes(outcome)) {
          return jsonResponse({ error: 'subject_id and outcome (confirmed_match|false_positive) required' }, 400);
        }
        if (!matchId) {
          return jsonResponse({
            error: 'match_id required — party adjudication resolves the canonical screening match, not the projection',
            code: 'canonical_match_required',
          }, 400);
        }
        if (note.length < 5) return jsonResponse({ error: 'An adjudication note is required' }, 400);

        const { data: subject } = await admin.schema('aml').from('party_screening_subjects')
          .select('*').eq('id', subjectId).maybeSingle();
        if (!subject) return jsonResponse({ error: 'Subject not found' }, 404);
        if (!subject.screening_check_id) {
          return jsonResponse({
            error: 'No canonical screening exists for this subject yet — run the screening first',
            code: 'no_canonical_screening',
          }, 409);
        }
        const { data: match } = await admin.schema('aml').from('screening_matches')
          .select('*').eq('id', matchId).maybeSingle();
        if (!match) return jsonResponse({ error: 'Match not found' }, 404);
        if (String(match.screening_check_id) !== String(subject.screening_check_id)) {
          return jsonResponse({ error: 'That match does not belong to this subject\'s screening', code: 'cross_check_denied' }, 403);
        }

        const disposition = outcome === 'confirmed_match' ? 'confirmed' : 'dismissed';
        const { data: prevRes } = await admin.schema('aml').from('match_resolutions')
          .select('row_hash').eq('match_id', matchId).order('created_at', { ascending: false }).limit(1).maybeSingle();
        const prevHash = prevRes?.row_hash ?? null;
        const now = new Date().toISOString();
        const resHashInput = JSON.stringify({
          match_id: matchId, case_id: match.case_id, disposition, rationale: note,
          resolved_by: userId, prev_hash: prevHash, created_at: now,
        });
        const resHashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(resHashInput));
        const rowHash = Array.from(new Uint8Array(resHashBuf)).map((x) => x.toString(16).padStart(2, '0')).join('');

        const { data: resolution, error: resErr } = await admin.schema('aml').from('match_resolutions').insert({
          match_id: matchId, case_id: match.case_id, disposition, rationale: note,
          resolved_by: userId, resolved_by_label: userEmail,
          prev_hash: prevHash, row_hash: rowHash, created_at: now,
        }).select('*').single();
        if (resErr) throw resErr;
        await admin.schema('aml').from('screening_matches')
          .update({ status: disposition }).eq('id', matchId);

        // Party state is a projection of the canonical match set.
        const { data: allMatches } = await admin.schema('aml').from('screening_matches')
          .select('status').eq('screening_check_id', subject.screening_check_id);
        const projected = projectPartyScreeningState((allMatches ?? []).map((m: any) => m.status));
        const { data: updated, error } = await admin.schema('aml').from('party_screening_subjects').update({
          state: projected, adjudicated_by: userId, adjudicated_at: now,
          adjudication_note: note, updated_at: now,
        }).eq('id', subjectId).select('*').single();
        if (error) throw error;

        await appendEvent(admin, updated.case_id, 'mlro_decision',
          `Party screening match ${match.matched_name} ${disposition} for ${updated.screened_name} → ${projected}`,
          { party_screening_subject_id: subjectId, match_id: matchId, disposition,
            resolution_id: resolution?.id, projected_state: projected }, userId, userEmail);
        return jsonResponse({ subject: updated, match: { ...match, status: disposition }, resolution });
      }

      /* ═══════════ PEP determinations (screening repair) ═══════════ */
      // A determination records who was assessed, the result, how it was
      // reached, by whom, when, and why the conclusion was reasonable —
      // AUSTRAC's "records to show how you've established if a person is a
      // PEP". Staff-side only; never projected to Client or Finance portals.
      case 'list_pep_determinations': {
        const caseId = String(body.case_id ?? '');
        if (!caseId) return jsonResponse({ error: 'case_id required' }, 400);
        const { data } = await admin.schema('aml').from('pep_determinations')
          .select('*').eq('case_id', caseId).order('determined_at', { ascending: false });
        return jsonResponse({ determinations: data ?? [] });
      }

      case 'record_pep_determination': {
        if (!(roles.has('reviewer') || roles.has('mlro'))) {
          return jsonResponse({ error: 'Reviewer or MLRO role required' }, 403);
        }
        const caseId = String(body.case_id ?? '');
        const subjectName = String(body.subject_name ?? '').trim();
        const result = String(body.result ?? '');
        const rationale = String(body.rationale ?? '').trim();
        const pepType = body.pep_type ? String(body.pep_type) : null;
        const pepRelationship = body.pep_relationship ? String(body.pep_relationship) : null;
        const methods = Array.isArray(body.methods) ? body.methods : [];
        const partySubjectId = body.party_screening_subject_id ? String(body.party_screening_subject_id) : null;

        if (!caseId) return jsonResponse({ error: 'case_id required' }, 400);
        if (!['not_pep', 'pep'].includes(result)) {
          return jsonResponse({ error: 'result must be not_pep or pep' }, 400);
        }
        if (result === 'pep') {
          if (!['foreign', 'domestic', 'international_organisation'].includes(pepType ?? '')) {
            return jsonResponse({ error: 'pep_type (foreign|domestic|international_organisation) is required for a pep result' }, 400);
          }
          if (!['self', 'family_member', 'close_associate'].includes(pepRelationship ?? '')) {
            return jsonResponse({ error: 'pep_relationship (self|family_member|close_associate) is required for a pep result' }, 400);
          }
        }
        /*
         * The evidence the conclusion rests on, judged by the SAME module the
         * dialog renders from (`pepEvidence.pure.ts`), so what an operator is
         * asked for and what this accepts cannot drift into two standards.
         *
         * It enforces three things this used to leave to the operator's
         * judgement, each of which had produced a defensible-looking record
         * that was not actually defensible:
         *
         *   - a SANCTIONS register is refused as a PEP source. The dialog's
         *     own example was "DFAT consolidated list", which is a targeted
         *     financial sanctions register: absence from it is not evidence
         *     that somebody is not politically exposed.
         *   - at least one source INDEPENDENT of the customer. Their own
         *     declaration is the thing being tested.
         *   - a searched source must record what came back.
         *
         * `rationale` is judged there too, against the statutory wording.
         */
        const cleanMethods = normalisePepMethods(methods);
        const evidence = assessPepEvidence({ result: result as 'not_pep' | 'pep',
          methods: cleanMethods, rationale });
        if (!evidence.ok) {
          return jsonResponse({
            error: evidence.errors[0].message,
            code: 'pep_evidence_insufficient',
            errors: evidence.errors,
          }, 400);
        }
        /*
         * `aml.cases` has NO `tenant_id` column, and this select used to name
         * it. PostgREST answered 42703, the discarded `error` left `data`
         * null, and the handler reported "Case not found" about the case the
         * operator was looking at — which is why `pep_determinations` was
         * empty from the day it was created and why Stage 5's button appeared
         * to do nothing. `readCase` refuses the column and keeps a failed
         * READ distinct from an absent ROW.
         */
        const caseRead = await readCase<{ id: string; subject_display_name: string | null }>(
          admin, caseId, 'id, subject_display_name');
        if (caseRead.failed) {
          console.error('record_pep_determination: case read failed', caseRead.error);
          return jsonResponse({
            error: 'The case could not be read. Nothing was recorded.',
            code: 'case_read_failed',
          }, 503);
        }
        const caseRow = caseRead.row;
        if (!caseRow) return jsonResponse({ error: 'Case not found' }, 404);

        // Subject identity is DERIVED, never asserted: the determination is
        // evidence about a specific person, and a caller-supplied name could
        // attach an assessment of X to the record of Y. The party subject row
        // (or the case subject) is the identity; a mismatched caller name is
        // an error, not an override.
        let derivedName = String(caseRow.subject_display_name ?? '').trim();
        let derivedPartyType: string | null = null;
        let derivedPartyId: string | null = null;
        if (partySubjectId) {
          const { data: partySubject } = await admin.schema('aml').from('party_screening_subjects')
            .select('id, case_id, screened_name, party_type, party_id').eq('id', partySubjectId).maybeSingle();
          if (!partySubject || String(partySubject.case_id) !== caseId) {
            return jsonResponse({ error: 'party_screening_subject_id does not belong to this case' }, 400);
          }
          derivedName = String(partySubject.screened_name ?? '').trim();
          derivedPartyType = partySubject.party_type ?? null;
          derivedPartyId = partySubject.party_id ?? null;
        }
        if (!derivedName) {
          return jsonResponse({ error: 'The subject has no recorded name to determine against' }, 409);
        }
        if (subjectName && subjectName.toLowerCase() !== derivedName.toLowerCase()) {
          return jsonResponse({
            error: `subject_name does not match the recorded subject ("${derivedName}") — the determination is recorded against the canonical identity`,
            code: 'subject_identity_mismatch',
          }, 400);
        }

        const now = new Date().toISOString();
        // Freshness: reconsidered during ongoing CDD. Default review cycle 12
        // months; callers may set an earlier date but never disable review.
        const reviewMonths = Math.min(Math.max(Number(body.review_months ?? 12) || 12, 1), 36);
        const reviewDue = new Date();
        reviewDue.setUTCMonth(reviewDue.getUTCMonth() + reviewMonths);

        // Hash-chain within the case, like match_resolutions.
        const { data: prevDet } = await admin.schema('aml').from('pep_determinations')
          .select('id, row_hash').eq('case_id', caseId)
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        const detHashInput = JSON.stringify({
          case_id: caseId, party_screening_subject_id: partySubjectId, subject_name: derivedName,
          result, pep_type: pepType, pep_relationship: pepRelationship,
          methods: cleanMethods, rationale, determined_by: userId,
          prev_hash: prevDet?.row_hash ?? null, created_at: now,
        });
        const detHashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(detHashInput));
        const detRowHash = Array.from(new Uint8Array(detHashBuf)).map((x) => x.toString(16).padStart(2, '0')).join('');

        // Supersession of the prior current determination is NOT done here:
        // the BEFORE INSERT trigger closes it in the same transaction as this
        // insert, and the partial unique index guarantees a single current
        // determination per subject scope even under concurrent writes.
        const { data: determination, error: detErr } = await admin.schema('aml').from('pep_determinations').insert({
          tenant_id: caseRead.tenantId,
          case_id: caseId,
          party_screening_subject_id: partySubjectId,
          party_type: derivedPartyType,
          party_id: derivedPartyId,
          subject_name: derivedName.slice(0, 300),
          result,
          pep_type: result === 'pep' ? pepType : null,
          pep_relationship: result === 'pep' ? pepRelationship : null,
          position_held: typeof body.position_held === 'string' ? body.position_held.slice(0, 300) : null,
          jurisdiction: typeof body.jurisdiction === 'string' ? body.jurisdiction.slice(0, 100) : null,
          holds_position_currently: typeof body.holds_position_currently === 'boolean'
            ? body.holds_position_currently : null,
          methods: cleanMethods,
          rationale,
          determined_by: userId,
          determined_by_label: userEmail,
          determined_at: now,
          review_due_at: reviewDue.toISOString(),
          prev_hash: prevDet?.row_hash ?? null,
          row_hash: detRowHash,
        }).select('*').single();
        if (detErr) {
          if (String((detErr as any).code) === '23505') {
            return jsonResponse({
              error: 'Another determination for this subject was recorded at the same moment — reload and review it before recording again',
              code: 'concurrent_determination',
            }, 409);
          }
          throw detErr;
        }

        await appendEvent(admin, caseId, result === 'pep' ? 'pep_sanctions_hit' : 'mlro_decision',
          result === 'pep'
            ? `PEP determination recorded for ${derivedName}: ${pepType} PEP (${pepRelationship})`
            : `PEP determination recorded for ${derivedName}: not a PEP`,
          {
            pep_determination_id: determination.id,
            party_screening_subject_id: partySubjectId,
            result, pep_type: result === 'pep' ? pepType : null,
            pep_relationship: result === 'pep' ? pepRelationship : null,
            methods: cleanMethods, review_due_at: determination.review_due_at,
          }, userId, userEmail);

        return jsonResponse({ determination });
      }

      /**
       * Record that a PEP determination CANNOT be made yet.
       *
       * ── Why this is not a third determination outcome ─────────────
       * `pep_determinations` records determinations. A row in it means
       * somebody established a position on reasonable grounds — that is what
       * every reader of that table, and every downstream control, takes it to
       * mean.
       *
       * An operator who has reached the end of the available checking and is
       * NOT satisfied has established nothing. Until now the dialog offered
       * only "not a PEP" or "PEP", so the way out of that position was to
       * assert one of them: an unfounded conclusion, written down, indexed,
       * and indistinguishable afterwards from a real one. AUSTRAC expressly
       * contemplates the opposite — that further information is collected
       * when the entity is not yet satisfied.
       *
       * So this writes NO determination. It records what was checked, why it
       * did not settle the question and what is needed, on the case audit
       * trail. The PEP scope stays outstanding, the step stays blocking, and
       * the stage stays open — which is the honest state.
       */
      /*
       * Search the public office-holder index for a party.
       *
       * ── The one rule this operation exists to keep ────────────────────
       * A HIT is a candidate. A MISS is NOTHING.
       *
       * The index is partial by construction — no public source lists every
       * prominent public function, and none lists family members or close
       * associates at all. So this never returns a bare candidate list: the
       * verdict, the coverage of every source and the currency of each load
       * travel with it, and `searchVerdict` will not produce the word
       * "clear" in any branch. A caller cannot render "0 candidates" without
       * also having what was and was not looked at.
       *
       * An index that has never loaded, or whose last load FAILED, reads as
       * `unavailable` rather than as no candidates. That distinction is the
       * whole lesson of `sanctions_entries`, which was empty from the day
       * the platform was built while every screening against it would have
       * returned exactly this shape of nothing.
       *
       * Read-only. It writes no determination, no source row and no case
       * event: what the operator records is what they saw when they
       * confirmed a candidate against the official register, which is a
       * different act performed by a person.
       */
      /*
       * What the office-holder index HOLDS, without searching it.
       *
       * The coverage was reachable only as a side-effect of a search, so an
       * operator could not tell whether the index was loaded until after they
       * had already searched — and the reading that matters most is the one
       * they get BEFORE they rely on it. Read-only, no identity, no party.
       *
       * It returns the same `describeCoverage` rows the search attaches, so
       * the two surfaces cannot disagree about what is loaded.
       */
      case 'pep_officeholder_index_status': {
        const coverage = [];
        let failed = false;
        for (const source of PEP_INDEX_SOURCES) {
          const { data: sync, error } = await admin.schema('aml')
            .from('pep_officeholder_syncs')
            .select('entry_count, source_as_at, completed_at, started_at, status, detail')
            .eq('source_code', source.code)
            .order('started_at', { ascending: false }).limit(1).maybeSingle();
          if (error) { failed = true; break; }
          coverage.push(describeCoverage(source.code, sync ?? null));
        }
        if (failed) {
          // Unknown is not empty. An index whose state could not be read must
          // never render as an index holding nothing.
          return jsonResponse({
            error: 'The office-holder index state could not be read.',
            code: 'pep_index_status_failed',
          }, 503);
        }
        return jsonResponse({ coverage, usable: indexIsUsable(coverage) });
      }

      /*
       * Run the PEP screening for one party, against the registers the
       * platform holds, and record what it searched.
       *
       * ── The line ─────────────────────────────────────────────────────
       * This SCREENS. It never determines. It writes a row to
       * `pep_screening_runs`, not to `pep_determinations`, and the two
       * vocabularies deliberately share no value — there is no `clear`, no
       * `not_pep`. A run that returns nothing has established that some
       * registers hold nothing under that name, which is a fact about the
       * search and not about the person.
       *
       * ── Why every source here is local ───────────────────────────────
       * Measured, not assumed. Wikidata's action API answered 429 on the
       * first call from this deployment's egress; its SPARQL endpoint
       * answered 504 to a query it could not finish in sixty seconds; and
       * directory.gov.au and aph.gov.au both answer 403 to a scripted client
       * on every path while serving a browser normally. A compliance
       * decision cannot depend on somebody else's rate limiter, so the
       * registers are loaded on a schedule and read locally at decision
       * time — instant, reproducible, and independent of anyone's uptime.
       *
       * The two that cannot be reached are NAMED as unsearched rather than
       * omitted, because a source nobody mentions reads as a source nobody
       * needed.
       */
      case 'run_pep_screening': {
        if (!(roles.has('reviewer') || roles.has('mlro'))) {
          return jsonResponse({ error: 'Reviewer or MLRO role required' }, 403);
        }
        const caseId = String(body.case_id ?? '');
        if (!caseId) return jsonResponse({ error: 'case_id required' }, 400);
        const partySubjectId = body.party_screening_subject_id
          ? String(body.party_screening_subject_id) : null;

        const caseRead = await readCase<{ id: string; subject_display_name: string | null }>(
          admin, caseId, 'id, subject_display_name');
        if (caseRead.failed) {
          console.error('run_pep_screening: case read failed', caseRead.error);
          return jsonResponse({
            error: 'The case could not be read. Nothing was screened.',
            code: 'case_read_failed',
          }, 503);
        }
        if (!caseRead.row) return jsonResponse({ error: 'Case not found' }, 404);

        // Identity is DERIVED, exactly as it is for a determination.
        let subjectName = String(caseRead.row.subject_display_name ?? '').trim();
        let partySubjectRow: { date_of_birth?: unknown } | null = null;
        let sanctionsSignal: 'none' | 'candidate' | 'confirmed' = 'none';
        if (partySubjectId) {
          const { data: partySubject } = await admin.schema('aml')
            .from('party_screening_subjects')
            .select('id, case_id, screened_name, state, date_of_birth')
            .eq('id', partySubjectId).maybeSingle();
          if (!partySubject || String(partySubject.case_id) !== caseId) {
            return jsonResponse({
              error: 'party_screening_subject_id does not belong to this case',
            }, 400);
          }
          subjectName = String(partySubject.screened_name ?? '').trim();
          partySubjectRow = partySubject;
          sanctionsSignal = partySubject.state === 'confirmed_match' ? 'confirmed'
            : partySubject.state === 'possible_match' ? 'candidate' : 'none';
        }

        /*
         * The submission snapshot, read ONCE and used twice — for the party's
         * date of birth here, and for the political-exposure declaration in
         * section 3 below.
         *
         * It is hoisted rather than read twice because a screening run is a
         * record of what was true when it ran: two reads could straddle a
         * customer resubmitting, and the run would then hold a date of birth
         * from one version and a declaration from another, with nothing on
         * the record to show it.
         */
        const { data: submissionRow } = await admin.schema('aml')
          .from('submission_versions')
          .select('snapshot').eq('case_id', caseId).is('superseded_at', null)
          .order('version_number', { ascending: false }).limit(1).maybeSingle();
        const snapshotSections = (((submissionRow?.snapshot ?? {}) as any).sections ?? []) as any[];
        const personalSection = (snapshotSections
          .find((x: any) => x?.section === 'personal_details')?.payload ?? null) as
          Record<string, unknown> | null;
        const subjectDob = resolveSubjectDob({
          partySubject: partySubjectRow, personalDetails: personalSection,
        });

        const tokens = normaliseName(subjectName);
        const sources: PepScreeningSourceResult[] = [];
        const candidates: PepScreeningCandidate[] = [];
        const registerVersions: Record<string, unknown> = {};

        /* ── 1 · the office-holder index ──────────────────────────────── */
        for (const source of PEP_INDEX_SOURCES) {
          const { data: sync } = await admin.schema('aml').from('pep_officeholder_syncs')
            .select('entry_count, source_as_at, completed_at, started_at, status, detail')
            .eq('source_code', source.code)
            .order('started_at', { ascending: false }).limit(1).maybeSingle();
          const cov = describeCoverage(source.code, sync ?? null);
          registerVersions[source.code] = {
            entry_count: cov.entryCount, source_as_at: cov.sourceAsAt,
            last_sync_status: cov.lastSyncStatus,
          };
          const usable = cov.entryCount > 0 && cov.lastSyncStatus === 'succeeded';
          if (!usable) {
            sources.push({
              key: source.code, label: cov.label, status: 'unavailable',
              coverage: cov.covers, excludes: cov.excludes, foundCount: 0,
              asAt: cov.sourceAsAt,
              detail: 'The index has not loaded, so nothing was searched against it.',
            });
            continue;
          }
          /*
           * How current it is, recorded ON THE RUN.
           *
           * Usability and currency stay separate: a stale register is still
           * searched, because its rows are still leads and refusing to read
           * it would remove the only assistance there is. What it cannot do
           * is support the claim `currently_held` makes, and the run is the
           * record of what was searched — so the age belongs in it rather
           * than only on the screen at the moment somebody looked.
           */
          const recency = assessIndexRecency(cov, Date.now());
          registerVersions[source.code] = {
            ...(registerVersions[source.code] as Record<string, unknown>),
            age_days: recency.ageDays, recency: recency.reading,
          };
          if (tokens.length === 0) {
            sources.push({
              key: source.code, label: cov.label, status: 'searched',
              coverage: cov.covers, excludes: cov.excludes, foundCount: 0,
              asAt: cov.sourceAsAt,
            });
            continue;
          }
          /*
           * `.eq('source_code', …)` is load-bearing and was not here.
           *
           * This query sits INSIDE a loop over the index sources, and each
           * iteration reports its rows under that source's label, coverage
           * statement and as-at date. With one source loaded that was
           * invisible. With two it means every candidate is returned twice,
           * and half of them are described by the wrong register's coverage
           * — a Wikidata row presented as a Parliament record, with
           * Parliament's "authoritative, current" prose attached to it.
           *
           * A coverage statement bound to the wrong rows is worse than no
           * coverage statement, because it is the sentence the operator is
           * being asked to rely on.
           */
          const { data: rows, error: idxErr } = await admin.schema('aml')
            .from('pep_officeholders')
            .select('external_id, source_code, full_name, aliases, position_title, '
              + 'jurisdiction, position_start, position_end, currently_held, confirm_url, '
              + 'date_of_birth')
            .eq('source_code', source.code)
            .overlaps('normalised_names', tokens).limit(500);
          if (idxErr) {
            // A read that FAILED is not a register that is EMPTY.
            console.error('run_pep_screening: index read failed', idxErr);
            sources.push({
              key: source.code, label: cov.label, status: 'failed',
              coverage: cov.covers, excludes: cov.excludes, foundCount: 0,
              asAt: cov.sourceAsAt,
              detail: 'The register could not be read. That is a technical condition, '
                + 'not a result.',
            });
            continue;
          }
          const found = (rows ?? []).map((r: any) => {
            const names = [String(r.full_name), ...((r.aliases ?? []) as string[])];
            const score = Math.max(...names.map((n) => scoreNames(subjectName, n).score), 0);
            return {
              id: `${r.source_code}:${r.external_id}`,
              sourceKey: String(r.source_code),
              name: String(r.full_name),
              aliases: (r.aliases ?? []) as string[],
              positionTitle: r.position_title ?? null,
              jurisdiction: r.jurisdiction ?? null,
              positionStart: r.position_start ?? null,
              positionEnd: r.position_end ?? null,
              currentlyHeld: r.currently_held ?? null,
              confirmUrl: r.confirm_url ?? null,
              dateOfBirth: r.date_of_birth ?? null,
              /*
               * Stored on the RUN, so the record of what was searched shows
               * what the operator was shown. It ordered the list and it never
               * shortened it — `admitCandidate` reads the name score alone.
               */
              dob: comparePepDob(subjectDob, r.date_of_birth ?? null),
              score,
            } as PepScreeningCandidate;
          }).filter((c) => admitCandidate(c.score))
            .sort((a, b) => rankCandidate(b.score, b.dob!.agreement)
              - rankCandidate(a.score, a.dob!.agreement))
            .slice(0, 25);
          candidates.push(...found);
          sources.push({
            key: source.code, label: cov.label, status: 'searched',
            coverage: cov.covers, excludes: cov.excludes,
            foundCount: found.length, asAt: cov.sourceAsAt,
            currency: recency.reading,
            // Only when there is something to say. A fresh register does not
            // need a sentence about its freshness on every result.
            detail: recency.reading === 'fresh' ? null : recency.reason,
          });
        }

        /* ── 2 · the sources a server cannot reach, named as unsearched ── */
        for (const s of SERVER_UNREACHABLE_SOURCES) {
          sources.push({
            key: s.key, label: s.label, status: 'not_reachable',
            coverage: s.coverage, excludes: s.excludes, foundCount: 0,
            detail: s.detail,
          });
        }

        /* ── 3 · what the customer declared ───────────────────────────── */
        /*
         * From the snapshot read above — the same `personal_details` section
         * `sync_screening_stage` reads, and the same one the date of birth
         * came from. Read from the server rather than passed in, because a
         * screening run is a record of what was true when it ran and must not
         * depend on what a caller chose to send.
         */
        const declaration = readPepDeclaration(personalSection);

        const run = buildScreeningRun({
          searchedNames: subjectName ? [subjectName] : [],
          sources, candidates, sanctionsSignal,
          declaration: declaration
            ? { answered: declaration.answered, answer: declaration.answer,
                summary: declaration.summary }
            : null,
        });

        const { data: saved, error: saveErr } = await admin.schema('aml')
          .from('pep_screening_runs').insert({
            tenant_id: caseRead.tenantId,
            case_id: caseId,
            party_screening_subject_id: partySubjectId,
            subject_name: subjectName.slice(0, 300) || 'unknown',
            searched_names: run.searchedNames,
            verdict: run.verdict,
            requires_manual_review: run.requiresManualReview,
            sources: run.sources,
            candidates: run.candidates,
            indicators: run.indicators,
            not_reached: run.notReached,
            register_versions: registerVersions,
            run_by: userId,
            run_by_label: userEmail ?? null,
          }).select('id, created_at').single();
        if (saveErr) {
          console.error('run_pep_screening: could not record the run', saveErr);
          return jsonResponse({
            error: 'The screening ran but could not be recorded. Nothing was saved.',
            code: 'screening_run_not_recorded',
          }, 503);
        }

        await appendEvent(admin, caseId, 'pep_screening_run',
          `PEP screening run for ${subjectName}: ${run.verdict}`,
          {
            run_id: saved.id,
            party_screening_subject_id: partySubjectId,
            verdict: run.verdict,
            candidate_count: run.candidates.length,
            not_reached: run.notReached,
            /* Said in the record itself, so no future reader can mistake a
               search for a conclusion. */
            determination_recorded: false,
          }, userId, userEmail);

        return jsonResponse({
          run: { ...run, id: saved.id, created_at: saved.created_at },
          evidence: runIsEvidence(run) ? runToMethodDraft(run) : null,
        });
      }

      /*
       * A candidate is a lead, and somebody has to say whether it is this
       * person. A rejection must say HOW that was told — "dismissed" with no
       * reason is indistinguishable from nobody having looked, and it is the
       * line an auditor will ask about first.
       */
      case 'review_pep_screening_candidate': {
        if (!(roles.has('reviewer') || roles.has('mlro'))) {
          return jsonResponse({ error: 'Reviewer or MLRO role required' }, 403);
        }
        const runId = String(body.run_id ?? '');
        const candidateId = String(body.candidate_id ?? '');
        const decision = String(body.decision ?? '');
        const reason = String(body.reason ?? '').trim();
        if (!runId || !candidateId) {
          return jsonResponse({ error: 'run_id and candidate_id are required' }, 400);
        }
        if (!['accepted', 'rejected'].includes(decision)) {
          return jsonResponse({ error: 'decision must be accepted or rejected' }, 400);
        }
        if (reason.length < 10) {
          return jsonResponse({
            error: 'Say how you told this is or is not the customer. A decision with no '
              + 'reason reads, later, exactly like nobody having looked.',
            code: 'candidate_reason_required',
          }, 400);
        }

        const { data: runRow, error: runErr } = await admin.schema('aml')
          .from('pep_screening_runs')
          .select('id, case_id, candidates').eq('id', runId).maybeSingle();
        if (runErr) {
          console.error('review_pep_screening_candidate: run read failed', runErr);
          return jsonResponse({
            error: 'The screening run could not be read.', code: 'run_read_failed',
          }, 503);
        }
        if (!runRow) return jsonResponse({ error: 'Screening run not found' }, 404);

        // The candidate must belong to the run. A caller-supplied id could
        // otherwise attach a decision to something never searched for.
        const candidate = ((runRow.candidates ?? []) as PepScreeningCandidate[])
          .find((c) => c.id === candidateId);
        if (!candidate) {
          return jsonResponse({
            error: 'That candidate is not part of this screening run',
            code: 'candidate_not_in_run',
          }, 400);
        }

        const { data: review, error: reviewErr } = await admin.schema('aml')
          .from('pep_screening_candidate_reviews').upsert({
            tenant_id: tenantForCase(String(runRow.case_id)),
            run_id: runId,
            candidate_id: candidateId,
            candidate_name: String(candidate.name).slice(0, 300),
            decision, reason: reason.slice(0, 2000),
            reviewed_by: userId, reviewed_by_label: userEmail ?? null,
          }, { onConflict: 'run_id,candidate_id' }).select('*').single();
        if (reviewErr) {
          console.error('review_pep_screening_candidate: write failed', reviewErr);
          return jsonResponse({
            error: 'The decision could not be recorded.', code: 'candidate_review_failed',
          }, 503);
        }

        await appendEvent(admin, String(runRow.case_id), 'pep_screening_candidate_review',
          `Screening candidate ${decision}: ${candidate.name}`,
          {
            run_id: runId, candidate_id: candidateId, decision,
            determination_recorded: false,
          }, userId, userEmail);

        return jsonResponse({ review });
      }

      /* The runs recorded for a case, newest first, with their reviews. */
      case 'list_pep_screening_runs': {
        const caseId = String(body.case_id ?? '');
        if (!caseId) return jsonResponse({ error: 'case_id required' }, 400);
        const { data: runs, error: listErr } = await admin.schema('aml')
          .from('pep_screening_runs').select('*')
          .eq('case_id', caseId).order('created_at', { ascending: false }).limit(25);
        if (listErr) {
          console.error('list_pep_screening_runs failed', listErr);
          return jsonResponse({
            error: 'The screening history could not be read.', code: 'runs_read_failed',
          }, 503);
        }
        const ids = (runs ?? []).map((r: any) => r.id);
        const { data: reviews } = ids.length
          ? await admin.schema('aml').from('pep_screening_candidate_reviews')
            .select('*').in('run_id', ids)
          : { data: [] as any[] };
        return jsonResponse({ runs: runs ?? [], reviews: reviews ?? [] });
      }

      case 'search_pep_officeholders': {
        if (!(roles.has('reviewer') || roles.has('mlro'))) {
          return jsonResponse({ error: 'Reviewer or MLRO role required' }, 403);
        }
        const caseId = String(body.case_id ?? '');
        if (!caseId) return jsonResponse({ error: 'case_id required' }, 400);

        // Identity is DERIVED, exactly as it is for a determination. A
        // caller-supplied name would let one party's screen be searched
        // under another party's name.
        const partySubjectId = body.party_screening_subject_id
          ? String(body.party_screening_subject_id) : null;
        const { data: caseRow } = await admin.schema('aml').from('cases')
          .select('id, subject_display_name').eq('id', caseId).maybeSingle();
        if (!caseRow) return jsonResponse({ error: 'Case not found' }, 404);
        let searchName = String(caseRow.subject_display_name ?? '').trim();
        let partySubjectRow: { date_of_birth?: unknown } | null = null;
        if (partySubjectId) {
          const { data: partySubject } = await admin.schema('aml')
            .from('party_screening_subjects')
            .select('id, case_id, screened_name, date_of_birth')
            .eq('id', partySubjectId).maybeSingle();
          if (!partySubject || String(partySubject.case_id) !== caseId) {
            return jsonResponse({
              error: 'party_screening_subject_id does not belong to this case',
            }, 400);
          }
          searchName = String(partySubject.screened_name ?? '').trim();
          partySubjectRow = partySubject;
        }

        /*
         * The party's date of birth, resolved by the SAME module the recorded
         * run uses. Deriving it twice would let the list an operator browses
         * rank a person differently from the record kept of what was
         * searched, and both would look right on their own.
         */
        const { data: searchSubmission } = await admin.schema('aml')
          .from('submission_versions')
          .select('snapshot').eq('case_id', caseId).is('superseded_at', null)
          .order('version_number', { ascending: false }).limit(1).maybeSingle();
        const searchDob = resolveSubjectDob({
          partySubject: partySubjectRow,
          personalDetails: (((searchSubmission?.snapshot ?? {}) as any).sections ?? [])
            .find((x: any) => x?.section === 'personal_details')?.payload ?? null,
        });

        // Coverage FIRST, and unconditionally. It is attached to every
        // reading including the empty one, which is the reading that needs
        // it most.
        const coverage = [];
        for (const source of PEP_INDEX_SOURCES) {
          const { data: sync } = await admin.schema('aml').from('pep_officeholder_syncs')
            // `detail` carries what the load actually reached. The coverage
            // an operator sees is derived from it rather than from a
            // sentence, because a sentence cannot be checked against a load.
            .select('entry_count, source_as_at, completed_at, started_at, status, detail')
            .eq('source_code', source.code)
            .order('started_at', { ascending: false }).limit(1).maybeSingle();
          coverage.push(describeCoverage(source.code, sync ?? null));
        }

        const tokens = normaliseName(searchName);
        if (tokens.length === 0) {
          return jsonResponse(searchVerdict({
            hasSearchableName: false, candidates: [], coverage,
          }));
        }

        // Overlap on ANY token, then score in code — recall first, exactly
        // as the sanctions provider does. Requiring every token would miss
        // the partial-name cases the search exists to catch.
        const { data: rows, error: searchErr } = await admin.schema('aml')
          .from('pep_officeholders')
          .select('external_id, source_code, full_name, aliases, position_title, pep_type, '
            + 'jurisdiction, position_start, position_end, currently_held, confirm_url, '
            + 'date_of_birth')
          .overlaps('normalised_names', tokens)
          .limit(500);
        if (searchErr) {
          // A database fault is a technical condition and must never be
          // returned as "nothing found" — that is how an error becomes an
          // outcome. The sanctions consumers made exactly this mistake by
          // discarding a claim's error.
          console.error('search_pep_officeholders failed', searchErr);
          return jsonResponse({
            error: 'The office-holder index could not be searched.',
            code: 'pep_index_search_failed',
          }, 503);
        }

        /*
         * A date of birth ORDERS candidates and annotates them. It never
         * removes one — `admitCandidate` takes the name score and nothing
         * else, and the sort is the only place the comparison acts. See
         * `_shared/aml/pepCandidateMatch.pure.ts`.
         */
        const candidates: PepIndexCandidate[] = (rows ?? []).map((r: any) => {
          const names = [String(r.full_name), ...((r.aliases ?? []) as string[])];
          const score = Math.max(...names.map((n) => scoreNames(searchName, n).score), 0);
          const dob = comparePepDob(searchDob, r.date_of_birth ?? null);
          return {
            externalId: String(r.external_id),
            sourceCode: String(r.source_code),
            fullName: String(r.full_name),
            aliases: (r.aliases ?? []) as string[],
            positionTitle: String(r.position_title),
            /*
             * NULL when the index holds no category, and it never holds one.
             * This used to read `r.pep_type ?? 'domestic'`, which asserted an
             * AUSTRAC category the loader deliberately refuses to write, the
             * column deliberately leaves null and the migration's own comment
             * says belongs to the determination rather than to the index.
             * Nothing rendered it yet, so it was a fabricated field waiting
             * for its first consumer.
             */
            pepType: r.pep_type ?? null,
            jurisdiction: r.jurisdiction ?? null,
            positionStart: r.position_start ?? null,
            positionEnd: r.position_end ?? null,
            currentlyHeld: r.currently_held ?? null,
            confirmUrl: r.confirm_url ?? null,
            dateOfBirth: r.date_of_birth ?? null,
            dob,
            score,
          };
        })
          .filter((c) => admitCandidate(c.score))
          .sort((a, b) => rankCandidate(b.score, b.dob!.agreement)
            - rankCandidate(a.score, a.dob!.agreement))
          .slice(0, 25);

        return jsonResponse(searchVerdict({
          hasSearchableName: true, candidates, coverage,
        }));
      }

      case 'defer_pep_determination': {
        if (!(roles.has('reviewer') || roles.has('mlro'))) {
          return jsonResponse({ error: 'Reviewer or MLRO role required' }, 403);
        }
        const caseId = String(body.case_id ?? '');
        if (!caseId) return jsonResponse({ error: 'case_id required' }, 400);
        const partySubjectId = body.party_screening_subject_id
          ? String(body.party_screening_subject_id) : null;

        const deferMethods = normalisePepMethods(body.methods);
        const verdict = assessPepDeferral({
          reason: body.reason ?? null,
          needed: body.needed ?? null,
          methods: deferMethods,
        });
        if (!verdict.ok) {
          return jsonResponse({
            error: verdict.errors[0].message,
            code: 'pep_deferral_incomplete',
            errors: verdict.errors,
          }, 400);
        }

        const { data: caseRow } = await admin.schema('aml').from('cases')
          .select('id, subject_display_name').eq('id', caseId).maybeSingle();
        if (!caseRow) return jsonResponse({ error: 'Case not found' }, 404);

        // Identity is derived, exactly as it is for a determination: a
        // caller-supplied name could attach one person's deferral to another.
        let subjectName = String(caseRow.subject_display_name ?? '').trim();
        if (partySubjectId) {
          const { data: partySubject } = await admin.schema('aml')
            .from('party_screening_subjects')
            .select('id, case_id, screened_name').eq('id', partySubjectId).maybeSingle();
          if (!partySubject || String(partySubject.case_id) !== caseId) {
            return jsonResponse({
              error: 'party_screening_subject_id does not belong to this case',
            }, 400);
          }
          subjectName = String(partySubject.screened_name ?? '').trim();
        }

        await appendEvent(admin, caseId, 'pep_determination_deferred',
          `PEP determination deferred for ${subjectName}: ${String(body.reason)}`,
          {
            party_screening_subject_id: partySubjectId,
            subject_name: subjectName.slice(0, 300),
            reason: String(body.reason),
            needed: String(body.needed).slice(0, 2000),
            methods: deferMethods,
            /* Stated in the record itself, so no future reader can mistake
               this event for a determination that was reached. */
            determination_recorded: false,
          }, userId, userEmail);

        return jsonResponse({ deferred: true, subject_name: subjectName });
      }

      default:
        return jsonResponse({ error: `Unknown op: ${op}` }, 400);
    }
  } catch (err: any) {
    console.error('aml-cases error', err);
    return jsonResponse({ ...internalError(err, 'aml-cases') }, 500);
  }
});

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
