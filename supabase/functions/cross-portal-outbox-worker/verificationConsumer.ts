/**
 * aml_verification consumer — processes `aml.verification.requested` events.
 *
 * The worker owns the provider call so the browser never does. It never
 * invents an identity outcome: `status` (the identity result) changes only
 * when the provider actually examined usable captures; every technical
 * condition lands in `processing_status` + `provider_error_category` and is
 * retried/dead-lettered by the platform outbox machinery. A customer attempt
 * (`attempt_consumed`) is recorded ONLY for an authoritative outcome.
 */
import {
  getIdvProvider,
  idvFlowFor,
  isStandaloneIdvProvider,
  resolveTenantProvider,
  runWithMetrics,
  currentEnvironment,
  ProviderResolutionError,
  technicalCategoryForRefusal,
} from '../_shared/aml/providers/index.ts';
import { stripImagePayloads } from '../_shared/aml/verificationEvidence.pure.ts';
import { canonicalOutcome } from '../_shared/aml/verificationOutcome.pure.ts';
import { processStandaloneCheck } from '../_shared/aml/standaloneVerification.ts';

/** Matches MAX_VERIFICATION_ATTEMPTS in aml-client-portal and the DB constraint. */
const MAX_VERIFICATION_ATTEMPTS = 3;

/** Attempts this party has actually spent — never the row count. */
async function attemptsConsumed(db: any, caseId: string, partyId: string | null): Promise<number> {
  let q = db.schema('aml').from('verification_checks')
    .select('id')
    .eq('case_id', caseId)
    .eq('check_type', 'electronic_idv')
    .eq('attempt_consumed', true);
  q = partyId ? q.eq('party_id', partyId) : q.is('party_id', null);
  const { data, error } = await q;
  if (error) return 0; // pre-migration: no escalation rather than a wrong one
  return (data ?? []).length;
}

async function toBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    bin += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export async function processVerificationEvent(db: any, event: any): Promise<void> {
  const checkId = String(event?.payload?.verification_check_id ?? '');
  if (!checkId) return; // malformed event: nothing to do, never retryable

  const { data: check, error: loadErr } = await db.schema('aml').from('verification_checks')
    .select('*').eq('id', checkId).maybeSingle();
  if (loadErr) throw loadErr;
  // Eligibility: stale/duplicate/cancelled events must not reprocess a check
  // that already has an outcome or was withdrawn.
  if (!check) return;
  if (check.superseded_at || check.status !== 'pending') return;
  if (!['submitted', 'queued', 'retry_scheduled'].includes(check.processing_status ?? 'submitted')) return;

  /**
   * A hosted-session check is not this worker's to process.
   *
   * Didit owns the capture: there is no document in `aml-documents` and no
   * selfie in `aml-biometrics`, because the customer never uploaded one to us.
   * Reaching `runProviderForCheck` would download nothing, throw
   * `storage_unreadable:document`, and stamp a technical failure on a check
   * whose outcome is on its way from a webhook — the customer's journey shows
   * an error for a verification that is proceeding normally.
   *
   * The database trigger (20260908000000) already declines to emit
   * `aml.verification.requested` for these, so in a converged deployment no
   * such event exists. This is the second lock: a legacy event still in the
   * outbox from before that migration, or a hand-inserted one, must also find
   * the door shut. Returning without claiming leaves the row untouched.
   */
  if (idvFlowFor(check.provider) === 'hosted_session') return;

  /**
   * Belt and braces for the same defect, expressed as the precondition the
   * body below actually has: this worker downloads `document_reference`, so a
   * check without one can only produce a technical failure. Any future hosted
   * provider is covered by this line without touching it.
   */
  if (!check.document_reference) return;

  /**
   * A Standalone-API check belongs to the shared orchestrator, and it returns
   * WITHOUT throwing whatever happens.
   *
   * That is the important half. Everything below re-throws so the outbox
   * applies backoff and re-delivers, which is right for a free call against a
   * service NPC hosts. Didit's Standalone endpoints are billed per response and
   * document no idempotency key, so the same policy there would turn one
   * customer submission into up to ten unattended purchases of the same
   * verification. The orchestrator records every failure on the row instead,
   * and the retry is a deliberate one — a fresh customer submission, which
   * consumes nothing from the failed attempt.
   *
   * It claims the row conditionally first, so this path, the portal's direct
   * dispatch and the one-minute sweep can all be handed the same check and
   * exactly one of them will reach the provider.
   */
  if (isStandaloneIdvProvider(check.provider)) {
    await processStandaloneCheck(db, checkId);
    return;
  }

  // Optimistic claim — a concurrent worker loses the conditional update and
  // walks away, so the provider is called at most once per event delivery.
  const { data: claimed } = await db.schema('aml').from('verification_checks')
    .update({
      processing_status: 'processing',
      processing_started_at: new Date().toISOString(),
      processing_attempts: (check.processing_attempts ?? 0) + 1,
    })
    .eq('id', checkId)
    .in('processing_status', ['submitted', 'queued', 'retry_scheduled'])
    .select('id').maybeSingle();
  if (!claimed) return;

  const technical = async (category: string, message: string) => {
    await db.schema('aml').from('verification_checks').update({
      processing_status: 'technical_failure',
      provider_error_category: category,
      failure_reason: message.slice(0, 300),
      // status untouched: a technical condition is not an identity outcome
      // and consumes no attempt.
    }).eq('id', checkId);
  };

  try {
    await runProviderForCheck(db, check);
  } catch (err: any) {
    if (err instanceof ProviderResolutionError) {
      await technical(technicalCategoryForRefusal(err.code), err.message);
    } else if (/storage_unreadable/.test(String(err?.message))) {
      await technical('storage_unreadable', String(err.message));
    } else if (/timeout|timed out/i.test(String(err?.message))) {
      await technical('timeout', String(err.message));
    } else {
      await technical('provider_unavailable', String(err?.message ?? 'provider_failure'));
    }
    // Re-throw so the platform outbox machinery applies backoff and
    // dead-lettering. The check row stays technical — never a customer
    // failure, never an attempt.
    throw err;
  }
}

/**
 * The real processing body, separated so the capture download and provider
 * call are testable and the metadata payload is built exactly once.
 */
export async function runProviderForCheck(db: any, check: any): Promise<void> {
  const resolved = await resolveTenantProvider(db, 'default', 'idv');
  const provider = getIdvProvider({ resolved, admin: db });

  const docBlob = await db.storage.from('aml-documents').download(check.document_reference);
  if (docBlob.error || !docBlob.data) throw new Error('storage_unreadable:document');
  const documentImage = await toBase64(docBlob.data);

  let selfieImage = '';
  if (check.biometric_storage_path) {
    const selfieBlob = await db.storage.from('aml-biometrics').download(check.biometric_storage_path);
    if (selfieBlob.error || !selfieBlob.data) throw new Error('storage_unreadable:selfie');
    selfieImage = await toBase64(selfieBlob.data);
  }

  const result = await runWithMetrics(db, {
    tenantId: 'default', capability: 'idv',
    providerKey: provider.name, costCents: resolved?.costCents ?? 0,
    configId: resolved?.configId ?? null,
  }, () => provider.runIdv({
    caseId: check.case_id,
    subjectLabel: check.party_label ?? 'Customer',
    method: selfieImage ? 'document_and_liveness' : 'document_only',
    metadata: { document_image_b64: documentImage, selfie_image_b64: selfieImage },
  }));

  // Shared with the staff re-run in aml-verification, so the two writers of
  // this row cannot drift apart again.
  const outcome = canonicalOutcome(result, {
    attemptsConsumed: await attemptsConsumed(db, check.case_id, check.party_id ?? null),
    maxAttempts: MAX_VERIFICATION_ATTEMPTS,
  });

  if (outcome.processingStatus === 'capture_unusable') {
    // The provider looked but could not examine identity. No identity outcome,
    // NO attempt consumed — the client recaptures.
    await db.schema('aml').from('verification_checks').update({
      processing_status: outcome.processingStatus,
      provider_error_category: outcome.providerErrorCategory,
      provider_attempt_reference: result.providerReference,
      outcome_detail: stripImagePayloads({
        ...(check.outcome_detail ?? {}), capture: result.raw?.face ?? null,
      }),
      processing_completed_at: new Date().toISOString(),
    }).eq('id', check.id);
    return;
  }

  // Authoritative outcome: the one place a customer attempt is consumed.
  await db.schema('aml').from('verification_checks').update({
    status: outcome.status,
    processing_status: outcome.processingStatus,
    attempt_consumed: outcome.attemptConsumed,
    authoritative: provider.mode !== 'simulator',
    execution_mode: provider.mode === 'simulator' ? 'simulation' : 'live',
    environment: currentEnvironment(),
    provider: provider.name,
    provider_reference: result.providerReference,
    provider_attempt_reference: result.providerReference,
    // The adapter's `raw` goes straight into the case record, so it is
    // filtered at the boundary rather than trusted to stay image-free.
    outcome_detail: stripImagePayloads(result.raw),
    completed_at: new Date().toISOString(),
    processing_completed_at: new Date().toISOString(),
  }).eq('id', check.id);
}
