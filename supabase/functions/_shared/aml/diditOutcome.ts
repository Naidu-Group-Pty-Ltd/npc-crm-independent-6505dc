/**
 * Applying a Didit decision to the canonical `aml.verification_checks` row.
 *
 * ## Why this is shared
 *
 * Two things settle a Didit check: the webhook receiver, and the portal when it
 * reconciles an in-flight session before offering a new one. That is the same
 * shape as the pair that produced `verificationOutcome.pure.ts` — the outbox
 * worker and the staff re-run — and that pair drifted, with every difference
 * costing the customer. One function, so these two agree by construction.
 *
 * ## Exactly-once attempt consumption
 *
 * A webhook may be delivered several times: Didit retries on 5xx/timeout, and
 * `event_id` de-duplication in `aml.provider_events` closes the ordinary case.
 * It does not close all of them — two deliveries can be in flight
 * concurrently, a crash can land between the event insert and the row update,
 * and the portal's reconcile can race a webhook for the same session.
 *
 * So de-duplication is NOT the thing protecting the customer's attempt. The
 * database is: the settling UPDATE is conditional on the row still being
 * unsettled, and the conditional update is atomic. The second writer updates
 * zero rows and reports `already_applied`. An attempt cannot be consumed twice
 * even if every layer above this one fails.
 *
 * ## What is written
 *
 * `outcome_detail` receives an ALLOW-LISTED summary — statuses, scores,
 * warning categories — and never the provider payload. Didit returns signed
 * URLs to the customer's ID photograph, their selfie and their liveness video,
 * plus the document data it read; none of that is NPC's to hold when the whole
 * point of a hosted provider is that NPC never touches the biometrics.
 */
import {
  mapDiditDecision,
  summariseDiditDecision,
  assertDecisionCorrelates,
  DiditCorrelationError,
  type DiditMappedDecision,
} from './providers/didit.pure.ts';
import { canonicalOutcome } from './verificationOutcome.pure.ts';
import { stripImagePayloads } from './verificationEvidence.pure.ts';

/** Matches MAX_VERIFICATION_ATTEMPTS in aml-client-portal and the worker. */
export const MAX_VERIFICATION_ATTEMPTS = 3;

/** Processing states a hosted check can still be settled from. */
const UNSETTLED_PROCESSING = ['submitted', 'queued', 'processing'];

export type ApplyResult =
  | { kind: 'applied'; status: string | null; attemptConsumed: boolean; mapped: DiditMappedDecision }
  | { kind: 'already_applied'; mapped: DiditMappedDecision }
  | { kind: 'in_flight'; mapped: DiditMappedDecision }
  | { kind: 'released'; mapped: DiditMappedDecision };

export { DiditCorrelationError };

/** Attempts this party has actually spent. Never the row count. */
async function attemptsConsumed(
  db: any, caseId: string, partyId: string | null,
): Promise<number> {
  let q = db.schema('aml').from('verification_checks')
    .select('id')
    .eq('case_id', caseId)
    .eq('check_type', 'electronic_idv')
    .eq('attempt_consumed', true)
    .is('superseded_at', null);
  q = partyId ? q.eq('party_id', partyId) : q.is('party_id', null);
  const { data, error } = await q;
  if (error) return 0;
  return (data ?? []).length;
}

async function sha256Hex(input: string): Promise<string> {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Append to the hash-chained case timeline.
 *
 * Payloads carry identifiers and safe categories only. The hosted session URL
 * and the session token are never written here — the timeline is read by staff
 * and exported, and the URL is a live credential for that customer's session.
 */
export async function appendDiditCaseEvent(
  db: any, caseId: string, summary: string, payload: Record<string, unknown>,
): Promise<void> {
  try {
    const { data: prev } = await db.schema('aml').from('case_events')
      .select('row_hash').eq('case_id', caseId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    const prevHash = prev?.row_hash ?? null;
    const now = new Date().toISOString();
    const record = {
      case_id: caseId, category: 'idv_result', summary, payload,
      actor_id: null, actor_label: 'didit', prev_hash: prevHash, created_at: now,
    };
    await db.schema('aml').from('case_events').insert({
      ...record, row_hash: await sha256Hex(JSON.stringify(record)),
    });
  } catch (e) {
    // The timeline is evidence, not control flow. Failing to append must never
    // roll back an identity outcome that has already been recorded.
    console.warn('[aml/didit] case event append failed', (e as Error)?.message);
  }
}

/**
 * The canonical columns this module needs off `aml.verification_checks`.
 *
 * Declared explicitly because postgrest-js infers row types from the literal
 * text of `.select()`, and gives up on a string it cannot parse — returning
 * `GenericStringError` instead of a row. Callers select these columns and
 * assert this type, so the shape is stated once here rather than being at the
 * mercy of how the select string happens to be formatted.
 */
export interface HostedCheckRow {
  id: string;
  case_id: string;
  party_id: string | null;
  party_label: string | null;
  provider: string | null;
  provider_reference: string | null;
  outcome_detail: Record<string, unknown> | null;
  processing_status: string | null;
  status: string | null;
  attempt_consumed: boolean | null;
  /** Capture sequence — the attempt encoded in this session's `vendor_data`. */
  capture_sequence: number | null;
}

/** The exact column list callers must select to satisfy `HostedCheckRow`. */
export const HOSTED_CHECK_COLUMNS =
  'id, case_id, party_id, party_label, provider, provider_reference, '
  + 'outcome_detail, processing_status, status, attempt_consumed, capture_sequence';

export interface ApplyDecisionArgs {
  db: any;
  /** The canonical row, loaded fresh. */
  check: HostedCheckRow;
  /** The authoritative decision, retrieved server-side. Never a webhook body. */
  decision: Record<string, unknown>;
  expectedWorkflowId: string;
  /** 'webhook' | 'portal_reconcile' — recorded for diagnostics only. */
  source: string;
  environment: string;
}

/**
 * Settle (or deliberately decline to settle) a hosted-session check.
 *
 * Returns without writing an identity outcome whenever the provider has not
 * reached one. That covers the customer who is still mid-flow, and the one who
 * closed the tab — neither is a finding against them and neither costs an
 * attempt.
 */
export async function applyDiditDecision(args: ApplyDecisionArgs): Promise<ApplyResult> {
  const { db, check, decision, expectedWorkflowId, source, environment } = args;

  // Correlation first. A decision that does not belong to this row must never
  // touch it, and every mismatch is an integration fault rather than a
  // customer outcome — it throws, and the caller records a technical state.
  assertDecisionCorrelates(decision, {
    expectedWorkflowId,
    expectedCaseId: check.case_id,
    expectedPartyId: check.party_id ?? null,
    expectedSessionId: String(check.provider_reference ?? ''),
    expectedAttempt: check.capture_sequence ?? null,
  });

  const mapped = mapDiditDecision(decision);
  const summary = summariseDiditDecision(decision, mapped);

  // Belt and braces: the summary is already allow-listed, but it passes
  // through the same image filter every other provider's evidence does, so a
  // future field added to the summary cannot bypass it.
  const evidence = stripImagePayloads({
    ...(check.outcome_detail ?? {}),
    didit: summary,
    settled_by: source,
  });

  // ── Still in the customer's hands. Record progress, decide nothing.
  if (!mapped.terminal && mapped.status === 'pending'
      && !mapped.reason.startsWith('session_closed_without_decision')) {
    await db.schema('aml').from('verification_checks').update({
      outcome_detail: evidence,
      updated_at: new Date().toISOString(),
    }).eq('id', check.id).in('processing_status', UNSETTLED_PROCESSING);
    return { kind: 'in_flight', mapped };
  }

  // ── Closed without a decision: expired, abandoned, or KYC-expired.
  //
  // The customer did not fail; they did not finish. The slot is released so a
  // new session can be created, `status` stays `pending`, and no attempt is
  // consumed. Conditional on the row still being unsettled so a late
  // "Abandoned" cannot overwrite a decision that already landed.
  if (!mapped.terminal) {
    const { data: released } = await db.schema('aml').from('verification_checks').update({
      processing_status: 'cancelled',
      superseded_at: new Date().toISOString(),
      superseded_reason: mapped.reason,
      outcome_detail: evidence,
      processing_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      // status untouched, attempt_consumed untouched: not finishing is not
      // failing.
    })
      .eq('id', check.id)
      .eq('attempt_consumed', false)
      .in('processing_status', UNSETTLED_PROCESSING)
      .select('id');

    if ((released ?? []).length > 0) {
      await appendDiditCaseEvent(db, check.case_id,
        `Identity verification for ${check.party_label ?? 'customer'}: session closed without a `
        + 'decision — no attempt consumed, a new session may be started',
        {
          verification_check_id: check.id, provider: 'didit',
          provider_reference: check.provider_reference,
          reason: mapped.reason, attempt_consumed: false, source,
        });
      return { kind: 'released', mapped };
    }
    return { kind: 'already_applied', mapped };
  }

  // ── Authoritative identity outcome.
  //
  // canonicalOutcome() is the SAME function the self-hosted worker and the
  // staff re-run use, so exhaustion, attempt accounting and the
  // technical-vs-identity boundary behave identically whichever provider
  // produced the result.
  const outcome = canonicalOutcome(
    { status: mapped.status, raw: {} },
    {
      attemptsConsumed: await attemptsConsumed(db, check.case_id, check.party_id ?? null),
      maxAttempts: MAX_VERIFICATION_ATTEMPTS,
    },
  );

  const now = new Date().toISOString();
  // THE idempotency guard. Conditional on the row still being unsettled, so a
  // duplicate delivery, a concurrent delivery, a retry after a crash and a
  // portal reconcile racing a webhook all resolve to exactly one consumed
  // attempt and exactly one timeline entry.
  const { data: settled, error } = await db.schema('aml').from('verification_checks').update({
    ...(outcome.status ? { status: outcome.status } : {}),
    processing_status: outcome.processingStatus,
    attempt_consumed: outcome.attemptConsumed,
    provider_error_category: outcome.providerErrorCategory,
    authoritative: true,
    execution_mode: 'live',
    environment,
    provider: 'didit',
    provider_attempt_reference: check.provider_reference,
    outcome_detail: evidence,
    failure_reason: outcome.status === 'failed' || outcome.status === 'exhausted'
      ? mapped.reason.slice(0, 300) : null,
    completed_at: now,
    processing_completed_at: now,
    updated_at: now,
  })
    .eq('id', check.id)
    .eq('attempt_consumed', false)
    .in('processing_status', UNSETTLED_PROCESSING)
    .select('id');
  if (error) throw error;

  if ((settled ?? []).length === 0) {
    // Someone else settled it first. Same final state, no second attempt, no
    // duplicate timeline entry — and no state regression, because the update
    // could not match a row that had already moved on.
    return { kind: 'already_applied', mapped };
  }

  const consumedNow = await attemptsConsumed(db, check.case_id, check.party_id ?? null);
  await appendDiditCaseEvent(db, check.case_id,
    `Identity verification for ${check.party_label ?? 'customer'}: ${outcome.status} `
    + `(attempt ${consumedNow} of ${MAX_VERIFICATION_ATTEMPTS})`,
    {
      verification_check_id: check.id,
      provider: 'didit',
      provider_reference: check.provider_reference,
      status: outcome.status,
      attempt_consumed: outcome.attemptConsumed,
      reason: mapped.reason,
      required_features_complete: mapped.requiredFeaturesComplete,
      features: mapped.features.map((f) => ({
        feature: f.feature, status: f.status, executed: f.executed,
      })),
      source,
      // Identity only. A Didit approval is evidence of identity and nothing
      // else: sanctions, PEP, EDD, source of funds and the service gate are
      // unchanged and still outstanding.
      scope: 'identity_verification_only',
    });

  return {
    kind: 'applied',
    status: outcome.status,
    attemptConsumed: outcome.attemptConsumed,
    mapped,
  };
}
