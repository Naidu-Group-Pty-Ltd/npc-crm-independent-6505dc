/**
 * The Standalone identity verification sequence.
 *
 * One customer submission → three billed provider calls → one canonical
 * `aml.verification_checks` outcome. This module owns the order, the money and
 * the settlement; it is the only place any of the three is decided.
 *
 * ## Where it runs
 *
 * Server-side only, and never inside the request that the customer is waiting
 * on. Two callers, one implementation:
 *
 *   - `aml-verification-processor`, invoked directly by the portal the moment a
 *     submission is accepted (so the wait is seconds) and by pg_cron as the
 *     watchdog (so a killed isolate does not strand anybody);
 *   - `cross-portal-outbox-worker`, if the durable `aml.verification.requested`
 *     event is ever driven.
 *
 * All three race safely, because every one of them has to win the same
 * conditional claim before it can spend a cent.
 *
 * ## The rule that shapes everything else: these calls cost money
 *
 * Didit bills per 200 response and publishes no idempotency key —
 * `vendor_data` is documented as an opaque correlation string and explicitly
 * NOT as one. Three consequences run through this file:
 *
 *  1. **One owner per attempt.** `claimCheck` is a conditional UPDATE from a
 *     queued state to `processing`. A double-click, a second tab, a re-fired
 *     cron sweep and a redelivered outbox event all lose it and walk away, so
 *     the sequence runs at most once per submission.
 *  2. **Nothing here ever throws to trigger a retry.** The outbox machinery
 *     retries a throwing consumer with exponential backoff up to ten times.
 *     For a free consumer that is correct; for this one it would be ten
 *     unattended purchases of the same verification. Every failure is recorded
 *     on the row and the function returns normally. The retry is a human or a
 *     fresh customer submission — a controlled one.
 *  3. **An ambiguous timeout stops the sequence.** A request that left and
 *     whose response never arrived has an unknown billing state. It is recorded
 *     as `timeout` with `billing_unknown`, it consumes no attempt, and nothing
 *     re-sends it.
 *
 * ## What the customer's allowance is spent on
 *
 * Only an authoritative examination. `canonicalOutcome` — shared with the
 * self-hosted path and the staff re-run — is the single place that decides,
 * and it consumes nothing for a capture the provider could not examine. Every
 * technical condition on this path lands in `processing_status` +
 * `provider_error_category` and leaves `status` alone.
 */

import {
  getStandaloneIdvProvider,
  isStandaloneIdvProvider,
  resolveTenantProvider,
  runWithMetrics,
  currentEnvironment,
  ProviderResolutionError,
  technicalCategoryForRefusal,
  type StandaloneIdvProvider,
} from './providers/index.ts';
import {
  composeStandaloneOutcome,
  readFaceMatch,
  readIdVerification,
  readLiveness,
  mayProceed,
  type IdVerificationReading,
  type LivenessReading,
  type FaceMatchReading,
  type StandaloneErrorCategory,
} from './providers/diditStandalone.pure.ts';
import {
  DiditStandaloneError, resolveReferenceImage, readStandaloneEnvConfig,
} from './providers/diditStandaloneClient.ts';
import { canonicalOutcome } from './verificationOutcome.pure.ts';
import { stripImagePayloads } from './verificationEvidence.pure.ts';
import { buildVendorData } from './providers/didit.pure.ts';
import {
  backfillPending, backfillStampFor, captureObjectsFor, identityPortraitObject,
  readBackfillStamp,
} from './passport/identityPortrait.pure.ts';
import {
  parseDocumentChoice, identityDocumentCapturePlan,
  type IdentityDocumentChoice,
} from './identityDocuments.pure.ts';
import {
  VERIFICATION_ATTEMPT_TOKENS, VERIFICATION_METERING_KIND, WORKSPACE_OUT_OF_TOKENS,
  describeVerificationCharge, verificationReserveTokens, verificationTokenCharge,
} from './verificationTokenPrice.pure.ts';
import {
  cancelTokens, commitTokens, reserveTokens, InsufficientTokensError,
} from '../missionControl.ts';
import { getCreditCostForKind } from '../missionControlCatalog.ts';

/** Matches MAX_VERIFICATION_ATTEMPTS in aml-client-portal and the DB counter. */
export const MAX_VERIFICATION_ATTEMPTS = 3;

/** Processing states a check may be claimed from. */
export const CLAIMABLE_STATES = ['submitted', 'queued', 'retry_scheduled'] as const;

/**
 * The capture plan the portal wrote when it prepared the attempt.
 *
 * Held on the row rather than recomputed, so the objects the server generated
 * paths for are exactly the objects it later downloads. Recomputing would open
 * the gap this design exists to close: the browser tells us an attempt id and
 * nothing else, and every path comes from here.
 */
export interface StandaloneCapturePlan {
  document_choice: IdentityDocumentChoice;
  objects: {
    document_front: { bucket: string; path: string };
    document_back: { bucket: string; path: string } | null;
    selfie: { bucket: string; path: string };
    /**
     * The face the provider extracted from the DOCUMENT.
     *
     * Not a capture: the customer never takes this one. It is derived during
     * processing from the document they photographed, and it is the only one
     * of the four images that may appear on a Compliance Passport — a face
     * crop carries no document number, no MRZ, no date of birth and no
     * signature. See `passport/identityPortrait.pure.ts`.
     *
     * Optional throughout: every verification recorded before this existed
     * has none, and every surface renders exactly as it did.
     */
    id_portrait?: { bucket: string; path: string } | null;
  };
}

export function readCapturePlan(check: any): StandaloneCapturePlan | null {
  const raw = check?.outcome_detail?.standalone_capture;
  if (!raw || typeof raw !== 'object') return null;
  const choice = parseDocumentChoice(raw.document_choice);
  const objects = raw.objects;
  if (!choice || !objects || typeof objects !== 'object') return null;
  const object = (v: unknown) => {
    if (!v || typeof v !== 'object') return null;
    const bucket = String((v as any).bucket ?? '');
    const path = String((v as any).path ?? '');
    return bucket && path ? { bucket, path } : null;
  };
  const front = object(objects.document_front);
  const selfie = object(objects.selfie);
  if (!front || !selfie) return null;
  return {
    document_choice: choice,
    objects: {
      document_front: front,
      document_back: object(objects.document_back),
      selfie,
      id_portrait: object(objects.id_portrait),
    },
  };
}

/**
 * Store the extracted document portrait beside the captures it came from.
 *
 * ── Where, and why it matters ──────────────────────────────────────────
 * `aml-biometrics`, under the same case/attempt prefix as the selfie. Two
 * reasons, and the second is the important one: the bucket is private, and it
 * is one of the two buckets `aml-idv-retention` may delete from — so the
 * portrait is destroyed on the same clock as everything else about the
 * attempt, by the job that already exists, with `id_portrait` added to the
 * objects it enumerates. An image this product stores and never deletes would
 * be a worse defect than not storing it at all.
 *
 * Returns null on any failure. The caller treats null as "no portrait", which
 * is the ordinary state for every verification recorded before this existed.
 */
async function storeIdentityPortrait(
  db: any,
  plan: StandaloneCapturePlan,
  caseId: string,
  checkId: string,
  bytes: Uint8Array,
): Promise<{ bucket: string; path: string } | null> {
  try {
    /* Beside the selfie, in the selfie's bucket — derived from the plan
       rather than rebuilt, so the prefix can never drift from the attempt's
       own. */
    const bucket = plan.objects.selfie.bucket;
    const prefix = plan.objects.selfie.path.replace(/\/[^/]*$/, '');
    if (!bucket || !prefix) return null;
    const path = `${prefix}/id-portrait.jpg`;
    const { error } = await db.storage.from(bucket).upload(path, bytes, {
      contentType: 'image/jpeg', upsert: true,
    });
    if (error) return null;
    return { bucket, path };
  } catch {
    return null;
  }
}

async function download(db: any, bucket: string, path: string): Promise<Uint8Array> {
  const res = await db.storage.from(bucket).download(path);
  if (res.error || !res.data) throw new Error(`storage_unreadable:${bucket}/${path}`);
  return new Uint8Array(await res.data.arrayBuffer());
}

/**
 * Take exclusive ownership of a check.
 *
 * The conditional `in(...)` is the whole concurrency model: Postgres serialises
 * the UPDATE, the winner gets a row back and the losers get null. Nothing below
 * this line can run twice for one submission, which is what stops a
 * double-click from becoming two invoices.
 */
export async function claimCheck(db: any, checkId: string): Promise<any | null> {
  // `processing_attempts` is read first so the increment reflects the row we
  // are about to claim; a lost race writes nothing at all, so it cannot drift.
  const { data: before } = await db.schema('aml').from('verification_checks')
    .select('processing_attempts').eq('id', checkId).maybeSingle();

  const { data } = await db.schema('aml').from('verification_checks')
    .update({
      processing_status: 'processing',
      processing_started_at: new Date().toISOString(),
      processing_attempts: Number(before?.processing_attempts ?? 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', checkId)
    .in('processing_status', CLAIMABLE_STATES as unknown as string[])
    .is('superseded_at', null)
    .eq('status', 'pending')
    .select('*').maybeSingle();
  return data ?? null;
}

/** Attempts this party has actually spent — never the row count. */
async function attemptsConsumed(
  db: any, caseId: string, partyId: string | null,
): Promise<number> {
  const { data, error } = await db.schema('aml')
    .rpc('verification_attempts_used', { p_case_id: caseId, p_party_id: partyId });
  if (!error && typeof data === 'number') return data;
  let q = db.schema('aml').from('verification_checks')
    .select('id').eq('case_id', caseId).eq('check_type', 'electronic_idv')
    .eq('attempt_consumed', true);
  q = partyId ? q.eq('party_id', partyId) : q.is('party_id', null);
  const fallback = await q;
  return (fallback.data ?? []).length;
}

/**
 * Record a technical condition and stop.
 *
 * `status` is deliberately untouched. A provider outage, an empty credit
 * balance, a rate limit, an unreadable object and an ambiguous timeout are all
 * conditions of NPC's infrastructure or its supplier — none of them is
 * something the customer did, so none of them may look like one.
 */
async function recordTechnical(
  db: any, check: any, category: StandaloneErrorCategory | string,
  message: string, extra: Record<string, unknown> = {},
): Promise<void> {
  await db.schema('aml').from('verification_checks').update({
    processing_status: 'technical_failure',
    provider_error_category: category,
    failure_reason: String(message).slice(0, 300),
    processing_completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    outcome_detail: stripImagePayloads({
      ...(check.outcome_detail ?? {}),
      standalone: { ...(check.outcome_detail?.standalone ?? {}), ...extra },
    }),
  }).eq('id', check.id);
}

export interface StandaloneRunResult {
  checkId: string;
  /**
   * The settled status, in the CANONICAL vocabulary.
   *
   * `passed`, not `verified`: the settle write stores `canonicalOutcome`'s
   * `CanonicalStatus`, and this union said `verified` for a long time while
   * the row said `passed`. Nothing compared against it, so nothing broke —
   * but it is the kind of stale type that makes the next reader's `===` test
   * silently never fire, which is exactly what it did to the token charge
   * before `VERIFIED_OUTCOMES` was written down.
   */
  outcome:
  | 'passed' | 'failed' | 'referred' | 'exhausted'
  | 'retake_required' | 'technical_failure' | 'not_claimed';
}

/**
 * A token reservation held across one verification run.
 *
 * Mission Control is asked for the WORST case before the first paid call and
 * told the truth once the run settles — see
 * `verificationTokenPrice.pure.ts` for the price and for why the trigger is
 * the product's own `attempt_consumed` signal rather than "we made a call".
 *
 * `jobId` is null when nothing is held. That is not an error state: Mission
 * Control being unreachable, slow or broken must not stop a customer being
 * verified, so the run proceeds unmetered and says so. Only an explicit
 * refusal blocks — the same asymmetry the activation gate turns on, and for
 * the same reason: the enforcement that protects revenue is Mission Control's
 * own 402, while the failure this could otherwise cause is refusing to verify
 * somebody who has paid.
 */
interface TokenHold {
  readonly jobId: string | null;
  /**
   * The attempt price this hold was taken at.
   *
   * Carried rather than re-read at settle time. Mission Control's cost index
   * can be repriced between the reserve and the commit — the catalog is
   * cached for minutes, not for the length of a run — and settling at a price
   * the reservation was not taken at is how a workspace comes to be asked for
   * more than was held.
   */
  readonly attemptTokens: number;
  /** What the ledger reads back on the row. */
  readonly note: Record<string, unknown>;
  /** Settle at what the run actually owes; 0 gives the whole hold back. */
  settle(tokens: number, meta: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** Give the whole hold back — nothing is owed. */
  release(reason: string): Promise<Record<string, unknown>>;
}

/**
 * Record what the run cost the workspace, beside the evidence it produced.
 *
 * `verification_checks` carries no `mc_job_id` column — `identity_checks` and
 * `screening_checks` do, this table never did — so the ledger handle lives in
 * `outcome_detail.standalone.token_charge`, which is where every other fact
 * about a standalone run already lives and which needs no migration on a
 * clone. Mission Control's own job row remains the authority on what was
 * charged; this is what a reconciliation joins it back to.
 */
function withTokenCharge(
  evidence: Record<string, unknown>, tokenCharge: Record<string, unknown>,
): Record<string, unknown> {
  const standalone = (evidence.standalone ?? {}) as Record<string, unknown>;
  return { ...evidence, standalone: { ...standalone, token_charge: tokenCharge } };
}

/** A hold that reserved nothing, so settling and releasing are both no-ops. */
function unmeteredHold(reason: string, attemptTokens: number): TokenHold {
  const note = { metered: false, reason };
  return {
    jobId: null,
    attemptTokens,
    note,
    settle: async () => note,
    release: async () => note,
  };
}

/** A hold, or the refusal that stops the run before anything is spent. */
type HoldResult =
  | { held: TokenHold }
  /** Mission Control said no. `reserve` is what it was asked for. */
  | { held: null; reserve: number };

/**
 * Take the reservation, or say why the run may not proceed.
 *
 * Answers a refusal ONLY where Mission Control refused explicitly — every
 * other failure yields an unmetered hold and lets the verification run.
 */
async function holdVerificationTokens(
  check: any, checkId: string,
): Promise<HoldResult> {
  /* Mission Control's cost index is the price list — the same one the Aurixa
     Systems pricing page publishes — so an operator repricing an identity
     check there reaches every workspace without a deploy here. A literal in
     this repo would be a second price list disagreeing with the published
     one. It answers null when the catalog is unreachable or the kind is
     unlisted, and the fallback is what a reachable Mission Control would have
     said today.

     Guarded even though `safeFetchCatalog` promises never to throw. That
     promise is another module's, this call sits before the try that owns the
     reservation, and an exception here would leave the check CLAIMED, at
     `processing`, with nothing to settle it — the shape of the stall a
     customer sits in on "Checking your identity". Looking up a price must
     never be able to cost somebody their verification. */
  let attemptTokens = VERIFICATION_ATTEMPT_TOKENS;
  try {
    attemptTokens = (await getCreditCostForKind(VERIFICATION_METERING_KIND))
      ?? VERIFICATION_ATTEMPT_TOKENS;
  } catch (err: any) {
    console.warn('[aml-verification] token price unreadable', JSON.stringify({
      check_id: checkId, error: String(err?.code ?? err?.message ?? err),
    }));
  }
  const reserve = verificationReserveTokens(attemptTokens);

  let reservation: { jobId: string; reserved: number };
  try {
    reservation = await reserveTokens({
      kind: VERIFICATION_METERING_KIND,
      estimatedTokens: reserve,
      // Per CHECK, not per case or per customer: a re-run of the same row is
      // the same reservation, and a fresh attempt is a fresh row.
      idempotencyKey: `aml-idv-standalone-${checkId}`,
      // No staff user is on this path — the customer submitted and a worker
      // is spending. The check is what the charge is about, and it is what a
      // reconciliation against `verification_checks` needs to find.
      userId: checkId,
      requestPayload: {
        case_id: check.case_id,
        party_id: check.party_id ?? null,
        capture_sequence: check.capture_sequence ?? check.attempt_number ?? 1,
        integration_mode: 'didit_standalone',
      },
    });
  } catch (err: any) {
    if (err instanceof InsufficientTokensError) return { held: null, reserve };
    // Unreachable, timed out, rate limited, or answered something we could not
    // read. Verify the customer and record that nothing was held.
    console.warn('[aml-verification] token reserve unavailable', JSON.stringify({
      check_id: checkId, error: String(err?.code ?? err?.message ?? err),
    }));
    return { held: unmeteredHold(String(err?.code ?? 'reserve_unavailable'), attemptTokens) };
  }

  const jobId = reservation.jobId;
  if (!jobId) return { held: unmeteredHold('reserve_returned_no_job', attemptTokens) };

  const base = {
    metered: true, job_id: jobId, reserved: reserve, attempt_tokens: attemptTokens,
  };

  const settle = async (
    tokens: number, meta: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    try {
      if (tokens <= 0) {
        await cancelTokens(jobId, String(meta.reason ?? 'nothing_owed'));
        return { ...base, charged: 0, ...meta };
      }
      await commitTokens(jobId, tokens, meta);
      return { ...base, charged: tokens, ...meta };
    } catch (err: any) {
      // A settle that never lands leaves a reservation Mission Control will
      // expire on its own. It must never turn a completed verification into a
      // failure, so it is recorded rather than thrown — this is the one fact a
      // token reconciliation needs and nothing else records.
      console.error('[aml-verification] token settle failed', JSON.stringify({
        check_id: checkId, job_id: jobId, tokens,
        error: String(err?.code ?? err?.message ?? err),
      }));
      return {
        ...base, charged: null, settle_failed: true,
        settle_error: String(err?.code ?? err?.message ?? err), ...meta,
      };
    }
  };

  return {
    held: {
      jobId,
      attemptTokens,
      note: base,
      settle,
      release: (reason: string) => settle(0, { reason }),
    },
  };
}

/**
 * Run the whole sequence for one claimed check.
 *
 * `check` must already be claimed — call `claimCheck` first. Splitting the two
 * keeps the claim testable on its own and makes it impossible to write a caller
 * that runs the sequence without one.
 */
export async function runStandaloneVerification(
  db: any, check: any,
): Promise<StandaloneRunResult> {
  const checkId = String(check.id);

  const plan = readCapturePlan(check);
  if (!plan) {
    // The row was prepared by something that did not write a plan, or the plan
    // was damaged. Nothing can be downloaded and no call may be made.
    await recordTechnical(db, check, 'worker_failure',
      'standalone check has no capture plan');
    return { checkId, outcome: 'technical_failure' };
  }

  const required = identityDocumentCapturePlan(plan.document_choice);

  let provider: StandaloneIdvProvider;
  let resolved: Awaited<ReturnType<typeof resolveTenantProvider>> = null;
  try {
    resolved = await resolveTenantProvider(db, 'default', 'idv');
    provider = getStandaloneIdvProvider({ resolved, admin: db });
  } catch (err: any) {
    const category = err instanceof ProviderResolutionError
      ? technicalCategoryForRefusal(err.code)
      : 'provider_not_configured';
    await recordTechnical(db, check, category, String(err?.message ?? err));
    return { checkId, outcome: 'technical_failure' };
  }

  /**
   * Which Didit deployment this run is about to spend against.
   *
   * The Standalone APIs leave nothing to inspect in the Didit console
   * (`save_api_request=false` persists no session there), so when a charge
   * appears against an unexpected balance the only evidence is here. The
   * key suffix matches the `…XXXX` preview the Didit console shows for each
   * application's key, so one log line answers "which application, which
   * environment" — and nothing logged is secret: no key, no token, no URL
   * with credentials, no customer data.
   */
  const envConfig = readStandaloneEnvConfig();
  console.info('[aml-verification] standalone run', JSON.stringify({
    check_id: checkId,
    environment: currentEnvironment(),
    provider: provider.name,
    api_base: Deno.env.get('DIDIT_API_BASE_URL') || 'https://verification.didit.me',
    api_key_suffix: envConfig.apiKey ? `…${envConfig.apiKey.slice(-4)}` : null,
  }));

  // Captures first: a missing object costs nothing to discover and must be
  // discovered before any paid call.
  let frontBytes: Uint8Array;
  let backBytes: Uint8Array | null = null;
  let selfieBytes: Uint8Array;
  try {
    frontBytes = await download(
      db, plan.objects.document_front.bucket, plan.objects.document_front.path);
    if (required.document_back) {
      if (!plan.objects.document_back) throw new Error('storage_unreadable:document_back');
      backBytes = await download(
        db, plan.objects.document_back.bucket, plan.objects.document_back.path);
    }
    selfieBytes = await download(db, plan.objects.selfie.bucket, plan.objects.selfie.path);
  } catch (err: any) {
    await recordTechnical(db, check, 'storage_unreadable', String(err?.message ?? err));
    return { checkId, outcome: 'technical_failure' };
  }

  /**
   * The workspace pays for this attempt, and it pays before the vendor is
   * asked.
   *
   * Didit's USD 0.30 is the platform's and is never passed on; the workspace
   * is charged 5 tokens for a consumed attempt and 5 more where the identity
   * is actually verified. The reservation is the worst case (both), because
   * the charge is not known until the vendor answers and the vendor must not
   * be asked until the answer can be paid for — reserving the attempt alone
   * would let a success land that nobody could afford.
   *
   * Last of the free steps, first of the paid ones. Everything above costs
   * nothing to discover (a damaged plan, an unresolvable provider, a missing
   * object), so none of it holds a workspace's balance; everything below
   * spends money.
   */
  const holdResult = await holdVerificationTokens(check, checkId);
  /* Read through `in` rather than off the narrowed branch: this repo's
     typecheck runs without strict null checks, so `held: null` does not
     discriminate the union and the reserve has to be reached explicitly. */
  const refusedReserve = 'reserve' in holdResult ? holdResult.reserve : null;
  if (holdResult.held === null) {
    // Mission Control refused explicitly. Nothing was called, no attempt was
    // consumed and no customer outcome is written — see
    // `verificationTokenPrice.pure.ts` for why this is its own category and
    // not the provider's `insufficient_credits`.
    await recordTechnical(db, check, WORKSPACE_OUT_OF_TOKENS,
      `workspace has fewer than ${refusedReserve} tokens available`,
      {
        token_charge: {
          metered: true, charged: 0, reserve: refusedReserve,
          refused: 'insufficient_funds',
        },
      });
    return { checkId, outcome: 'technical_failure' };
  }
  const hold = holdResult.held;

  /**
   * The correlation handle sent to the provider.
   *
   * Opaque, internal, and never a name, an email or a document number. It is
   * echoed back on the response and stored on the persisted request, so it is
   * what ties a Manual Checks entry in Didit's console back to an NPC
   * applicant.
   *
   * PERSON-scoped — `npc:<case>:<party|primary>`, no attempt suffix. Didit
   * groups persisted requests by this exact string, so an attempt suffix would
   * scatter one applicant's checks across several identities in the console,
   * which is the opposite of what persisting them is for. The attempt is still
   * recorded, in `metadata` below and on NPC's own row.
   *
   * It is NOT an idempotency key and is never treated as one — Didit does not
   * document it as one, and these endpoints do not upsert on it the way
   * `POST /v3/session/` does.
   */
  const vendorData = buildVendorData(check.case_id, check.party_id ?? null);
  const metadata = {
    npc_verification_check_id: checkId,
    npc_capture_sequence: check.capture_sequence ?? check.attempt_number ?? 1,
  };

  /**
   * The policy in force for THIS attempt, recorded with it.
   *
   * A threshold is a compliance decision, and it can be changed. Without this,
   * a reviewer six months from now reading a face-match score of 62 would have
   * no way to know whether it passed under the policy that applied on the day.
   * Staff-only: nothing in the portal projection reads it.
   */
  const evidenceBase: Record<string, unknown> = {
    integration_mode: 'standalone',
    provider: provider.name,
    // True since 2026-08-14: each call is persisted by Didit and appears in
    // the Business Console under Manual Checks. Recorded per attempt because
    // it decides where the provider-side evidence for THIS check lives.
    save_api_request: true,
    document_choice: plan.document_choice,
    required_captures: required,
    thresholds_applied: {
      liveness_decline_below: provider.thresholds.liveness,
      face_match_decline_below: provider.thresholds.faceMatch,
    },
    started_at: new Date().toISOString(),
  };

  const persistProgress = async (extra: Record<string, unknown>) => {
    await db.schema('aml').from('verification_checks').update({
      outcome_detail: stripImagePayloads({
        ...(check.outcome_detail ?? {}),
        /* The PLAN, re-persisted from the in-memory copy.
           `aml-idv-retention` reads its object list from
           `standalone_capture` — not from `standalone.capture_objects` — so
           an object added during processing (the extracted portrait) has to
           be written back here or the retention job would never enumerate
           it, and the one image this product derives would be the one it
           never deletes. */
        standalone_capture: {
          ...((check.outcome_detail ?? {}).standalone_capture ?? {}),
          objects: plan.objects,
        },
        standalone: { ...evidenceBase, ...extra },
      }),
      updated_at: new Date().toISOString(),
    }).eq('id', checkId);
  };

  /**
   * Meter one billed step, at that step's own price.
   *
   * `runWithMetrics` adds `costCents` to `provider_metrics_daily.cost_cents_sum`
   * once per successful call, and the Command Centre renders that sum as the
   * 30-day spend. Didit prices the three endpoints separately — ID 20c,
   * liveness 5c, face match 5c — so passing one flat figure for all three would
   * misreport every attempt: three times over on a full pass, and by more on a
   * sequence that stopped at the first step.
   *
   * Per-step pricing makes the fail-fast sequence account correctly by
   * construction. A declined document records 20 and nothing else, because the
   * later steps genuinely never happened. `cost_per_unit_cents` is the fallback
   * when a deployment's config predates the map.
   */
  const unitCosts = (resolved?.config?.['standalone_unit_costs_cents'] ?? {}) as
    Record<string, unknown>;
  const stepCost = (step: 'id_verification' | 'passive_liveness' | 'face_match'): number => {
    const value = unitCosts[step];
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? value
      : (resolved?.costCents ?? 0);
  };

  const meter = <T>(
    step: 'id_verification' | 'passive_liveness' | 'face_match', fn: () => Promise<T>,
  ) => runWithMetrics(db, {
    tenantId: 'default', capability: 'idv', providerKey: provider.name,
    costCents: stepCost(step), configId: resolved?.configId ?? null,
  }, fn);

  /* ── Step A: ID verification ─────────────────────────────────────────── */

  let id: IdVerificationReading;
  try {
    const body = await meter('id_verification', () => provider.verifyIdentityDocument({
      frontImage: frontBytes,
      backImage: required.document_back ? backBytes : null,
      vendorData, metadata,
    }));
    id = readIdVerification(body);
  } catch (err: any) {
    return await handleProviderError(db, check, 'id_verification', err, evidenceBase, checkId, hold);
  }

  /**
   * The Face Match reference.
   *
   * `save_api_request=true` returns `portrait_image` as a short-lived media URL
   * rather than inline base64, so this resolves whichever shape arrived — see
   * `resolveReferenceImage`, which is bounded and answers null rather than
   * throwing. A null here is not an error: it means Face Match has no
   * reference, the step does not run, and the composition settles as a
   * referral.
   *
   * The portrait exists in this variable and nowhere else. It is never
   * persisted, never logged and never returned — `id.sanitised` (what goes to
   * the database) has the field removed by name, whether it held bytes or a URL.
   */
  const portraitBytes = await resolveReferenceImage(id.portraitBase64);

  /* ── The one image a Compliance Passport may show ───────────────────
     The portrait is the face the provider extracted from the DOCUMENT, and
     until now it existed in this variable and nowhere else. A Passport that
     proves an identity was verified and shows no face is a certificate; the
     artefact this product is modelled on shows the holder.

     It is the only one of the four images that may travel, and the reason is
     what it does NOT contain: no document number, no MRZ, no date of birth,
     no address, no signature. The document page itself (`document_front`)
     carries every one of those and stays staff-only, and the selfie stays out
     by the rule that has always kept liveness media out of this document.

     Everything about this is additive and fail-soft. A storage failure
     records nothing and changes nothing — the verification proceeds exactly
     as it did, and a case with no portrait renders the Passport this product
     has always produced. */
  const portraitObject = portraitBytes
    ? await storeIdentityPortrait(db, plan, check.case_id, checkId, portraitBytes)
    : null;
  if (portraitObject) plan.objects.id_portrait = portraitObject;

  await persistProgress({ id_verification: id.sanitised, id_verdict: id.verdict });

  let liveness: LivenessReading | null = null;
  let faceMatch: FaceMatchReading | null = null;

  /* ── Step B: passive liveness — only if A was conclusive and clean ───── */

  if (mayProceed(id.verdict)) {
    try {
      const body = await meter('passive_liveness', () => provider.checkPassiveLiveness({
        userImage: selfieBytes, vendorData, metadata,
      }));
      liveness = readLiveness(body);
    } catch (err: any) {
      return await handleProviderError(db, check, 'passive_liveness', err, {
        ...evidenceBase, id_verification: id.sanitised, id_verdict: id.verdict,
      }, checkId, hold);
    }
    await persistProgress({
      id_verification: id.sanitised, id_verdict: id.verdict,
      liveness: liveness.sanitised, liveness_verdict: liveness.verdict,
    });
  }

  /* ── Step C: face match 1:1 — only if B was conclusive and clean ─────── */

  //
  // A missing portrait is NOT an error and does not reach the provider. The
  // document was approved but carried no usable cropped face, so there is
  // nothing to compare a selfie against: `faceMatch` stays null, the
  // composition reads that as a step that never ran, and the attempt settles as
  // a referral. Calling Face Match with the whole document page instead would
  // be paying for a comparison against a photograph of a page.
  if (liveness && mayProceed(liveness.verdict) && portraitBytes) {
    try {
      const body = await meter('face_match', () => provider.compareFaces({
        userImage: selfieBytes, refImage: portraitBytes, vendorData, metadata,
      }));
      faceMatch = readFaceMatch(body);
    } catch (err: any) {
      return await handleProviderError(db, check, 'face_match', err, {
        ...evidenceBase, id_verification: id.sanitised, id_verdict: id.verdict,
        liveness: liveness.sanitised, liveness_verdict: liveness.verdict,
      }, checkId, hold);
    }
  }

  /* ── Settle ──────────────────────────────────────────────────────────── */

  const composition = composeStandaloneOutcome({
    claimed: plan.document_choice, id, liveness, faceMatch,
  });

  const outcome = canonicalOutcome(
    { status: composition.status, raw: {} },
    {
      attemptsConsumed: await attemptsConsumed(db, check.case_id, check.party_id ?? null),
      maxAttempts: MAX_VERIFICATION_ATTEMPTS,
    },
  );

  const evidence = stripImagePayloads({
    ...(check.outcome_detail ?? {}),
    standalone: {
      ...evidenceBase,
      completed_at: new Date().toISOString(),
      id_verification: id.sanitised,
      id_verdict: id.verdict,
      liveness: liveness?.sanitised ?? null,
      liveness_verdict: liveness?.verdict ?? 'not_reached',
      liveness_score: liveness?.score ?? null,
      face_match: faceMatch?.sanitised ?? null,
      face_match_verdict: faceMatch?.verdict ?? 'not_reached',
      face_match_score: faceMatch?.score ?? null,
      face_match_reference: portraitBytes ? 'id_portrait' : 'unavailable',
      document_classification: composition.consistency,
      checks: composition.checks,
      provider_request_ids: {
        id_verification: id.requestId,
        passive_liveness: liveness?.requestId ?? null,
        face_match: faceMatch?.requestId ?? null,
      },
      /* `capture_objects` is deliberately NOT written here.
         It was a second copy of `standalone_capture.objects`, composed once
         at the end of a run and never updated — and every reader preferred
         it. So an object added to the plan afterwards (the extracted
         portrait) was in storage, named by the plan, and on the retention
         job's list, while every Passport drew an empty frame because it was
         reading the older of two lists. One list, in one place: the plan.
         `captureObjectsFor` still merges the legacy copy for rows written
         before this. */
    },
  });

  if (outcome.processingStatus === 'capture_unusable') {
    // The provider looked and could not examine identity. No identity outcome,
    // NO attempt consumed — the customer photographs it again. The platform
    // paid Didit for the look and the workspace pays nothing, which is the
    // whole point of charging on `attempt_consumed`.
    const tokenCharge = await hold.release('capture_unusable');
    await db.schema('aml').from('verification_checks').update({
      processing_status: outcome.processingStatus,
      provider_error_category: outcome.providerErrorCategory,
      provider: provider.name,
      provider_attempt_reference: id.requestId,
      outcome_detail: withTokenCharge(evidence, tokenCharge),
      processing_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', checkId);
    return { checkId, outcome: 'retake_required' };
  }

  /* What the workspace owes, read from the two facts the row is about to
     carry and from nowhere else. Settled BEFORE the write so one update
     records both the identity outcome and what it cost; nobody is waiting on
     this request (the portal polls the row), so the extra round trip costs a
     customer nothing. */
  const charge = { attemptConsumed: outcome.attemptConsumed, outcome: outcome.status };
  const tokenCharge = await hold.settle(verificationTokenCharge(charge, hold.attemptTokens), {
    reason: describeVerificationCharge(charge, hold.attemptTokens),
    check_id: checkId,
    status: outcome.status,
    attempt_consumed: outcome.attemptConsumed,
  });

  await db.schema('aml').from('verification_checks').update({
    status: outcome.status,
    processing_status: outcome.processingStatus,
    attempt_consumed: outcome.attemptConsumed,
    authoritative: true,
    execution_mode: 'live',
    environment: currentEnvironment(),
    provider: provider.name,
    provider_reference: id.requestId,
    provider_attempt_reference: id.requestId,
    outcome_detail: withTokenCharge(evidence, tokenCharge),
    completed_at: new Date().toISOString(),
    processing_completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', checkId);

  return { checkId, outcome: outcome.status as StandaloneRunResult['outcome'] };
}

/**
 * A provider call failed. Record what kind of failure, and never a customer
 * outcome.
 *
 * `capture_unreadable` is the one that is about the photograph rather than the
 * infrastructure — a 400 carrying `COULD_NOT_RECOGNIZE_DOCUMENT`. It is
 * recorded as `capture_unusable`, which is the state the portal already renders
 * as "please take the photo again" and which consumes no attempt. Every other
 * category is a technical failure.
 */
async function handleProviderError(
  db: any, check: any, step: string, err: unknown,
  evidence: Record<string, unknown>, checkId: string, hold: TokenHold,
): Promise<StandaloneRunResult> {
  const standalone = err instanceof DiditStandaloneError ? err : null;
  const category: string = standalone?.category ?? 'provider_unavailable';
  const message = String((err as Error)?.message ?? err);

  /* Neither branch below consumes an attempt, so neither owes anything. The
     platform may already have paid Didit for the steps that landed, and it
     absorbs that: a workspace is never charged for this product's own failure
     or for a photograph the provider could not read. */
  const tokenCharge = await hold.release(`provider_error:${category}`);

  const detail = {
    ...evidence,
    failed_step: step,
    failed_category: category,
    // The one fact a reconciliation needs and nothing else records: we sent a
    // request whose outcome — and whose billing — we never learned.
    billing_unknown: standalone?.billingUnknown ?? false,
    token_charge: tokenCharge,
    failed_at: new Date().toISOString(),
  };

  if (category === 'capture_unreadable') {
    await db.schema('aml').from('verification_checks').update({
      processing_status: 'capture_unusable',
      provider_error_category: 'capture_unusable',
      failure_reason: message.slice(0, 300),
      outcome_detail: stripImagePayloads({
        ...(check.outcome_detail ?? {}), standalone: detail,
      }),
      processing_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', checkId);
    return { checkId, outcome: 'retake_required' };
  }

  await recordTechnical(db, check, category, message, detail);
  return { checkId, outcome: 'technical_failure' };
}

/**
 * Claim and run, in one call.
 *
 * Returns `not_claimed` when somebody else already owns the check — which is a
 * normal, expected result of the design and not an error: it is what a second
 * tab, a re-fired sweep and a redelivered event are supposed to get.
 */
export async function processStandaloneCheck(
  db: any, checkId: string,
): Promise<StandaloneRunResult> {
  const claimed = await claimCheck(db, checkId);
  if (!claimed) return { checkId, outcome: 'not_claimed' };
  return await runStandaloneVerification(db, claimed);
}

/* ────────────────────────────────────────────────────────────────────────
 * Backfilling the document portrait for verifications that predate it
 * ──────────────────────────────────────────────────────────────────────── */

export type PortraitBackfillOutcome =
  | 'stored'
  | 'already_present'
  | 'not_applicable'
  | 'provider_unavailable'
  | 'no_portrait_in_document'
  | 'storage_failed';

export interface PortraitBackfillResult {
  checkId: string;
  outcome: PortraitBackfillOutcome;
  /** The provider's verdict on the re-read, recorded but never acted on. */
  providerVerdict?: string | null;
  detail?: string;
}

/**
 * Outcomes that leave a stamp, and therefore end the matter.
 *
 * Everything that got as far as making the call does. `not_applicable` does
 * not — nothing was spent and nothing was learned, so a check that becomes
 * eligible later (the plan is repaired, the provider is configured) is still
 * a candidate. `provider_unavailable` DOES stamp when the call itself failed,
 * for the reason in `backfillIdentityPortrait`'s header.
 */

/**
 * Fetch the portrait for a verification that completed before portraits were
 * stored, and put it on the Passport.
 *
 * ── Why this runs by itself ───────────────────────────────────────────
 * `resolveReferenceImage` extracted the document portrait on every run and
 * deliberately discarded it — it lived in one local variable and was never
 * persisted. So every verification completed before that changed has a
 * Compliance Passport with no face on it, even though the document page it
 * was cropped from is still in NPC's own bucket.
 *
 * That is a defect in this product's own record-keeping, and repairing it is
 * this product's job. **Asking an operator to click a button on each case is
 * asking them to fix our bug by hand**, once per customer, for ever — and it
 * makes a Passport's completeness depend on whether anybody happened to open
 * it. The one-minute sweep that already exists finds these and fills them in.
 *
 * ── What it is, precisely ─────────────────────────────────────────────
 * **It re-derives an IMAGE. It never re-decides an identity.** The check's
 * status, verdict, thresholds, scores and `completed_at` are not read here
 * and not written: the verification stands exactly as it was recorded, and
 * the only things this adds to the row are
 * `standalone_capture.objects.id_portrait` and the attempt stamp beside it.
 * A re-read that disagrees with the recorded verdict is returned for the
 * caller to log and acted on by nobody — silently adopting a second opinion
 * nobody asked for would be far worse than the missing photograph.
 *
 * ── Exactly one attempt, ever ─────────────────────────────────────────
 * This makes one billed ID-verification call, and the stamp it leaves is
 * written whether the call succeeded, failed or produced nothing. The stamp's
 * PRESENCE is the guard, never its outcome: retrying a paid call against the
 * same unreadable document would spend every minute for ever, which is the
 * unattended spending the processor above this refuses by design. A record
 * that cannot be repaired settles as `unavailable` on the page and stays
 * there.
 */
export async function backfillIdentityPortrait(
  db: any, checkId: string,
): Promise<PortraitBackfillResult> {
  const { data: check, error } = await db.schema('aml').from('verification_checks')
    .select('id, case_id, party_id, party_label, status, provider, check_type, '
      + 'capture_sequence, attempt_number, outcome_detail')
    .eq('id', checkId).maybeSingle();
  /* A read that FAILED is not a row that is ABSENT. Neither leaves a stamp:
     nothing was spent, and a database fault must not permanently disqualify
     a check from ever being repaired. */
  if (error) {
    return { checkId, outcome: 'not_applicable', detail: `check_unreadable: ${error.message}` };
  }
  if (!check) return { checkId, outcome: 'not_applicable', detail: 'check_not_found' };

  // Only a verification that PASSED. A portrait taken off a failed or
  // superseded attempt is not the evidence this party was verified on, and
  // putting it on the Passport would say that it was.
  if (check.status !== 'passed') {
    return { checkId, outcome: 'not_applicable', detail: 'check_not_passed' };
  }
  if (!isStandaloneIdvProvider(check.provider)) {
    return { checkId, outcome: 'not_applicable', detail: 'not_a_standalone_check' };
  }

  const store = check.outcome_detail?.standalone_capture ?? null;
  if (readBackfillStamp(store)) {
    return { checkId, outcome: 'not_applicable', detail: 'already_attempted' };
  }

  const plan = readCapturePlan(check);
  if (!plan) return { checkId, outcome: 'not_applicable', detail: 'no_capture_plan' };
  /* Checked against the MERGED view of the object lists, not the plan alone.
     A portrait recorded in either place is a portrait we hold, and paying to
     fetch one we already have is the mistake this whole area exists to stop.
     `captureObjectsFor` is the same reader every Passport surface uses. */
  if (identityPortraitObject(captureObjectsFor(check.outcome_detail))) {
    return { checkId, outcome: 'already_present' };
  }

  let provider: StandaloneIdvProvider;
  let resolved: Awaited<ReturnType<typeof resolveTenantProvider>> = null;
  try {
    resolved = await resolveTenantProvider(db, 'default', 'idv');
    provider = getStandaloneIdvProvider({ resolved, admin: db });
  } catch (err: any) {
    /* No stamp: nothing was spent, and a deployment that has not finished
       configuring its provider must not lose the repair permanently. */
    return {
      checkId, outcome: 'not_applicable',
      detail: `provider_unresolved: ${String(err?.message ?? err)}`,
    };
  }

  // The source image, read before anything is spent. A document page the
  // retention job has already deleted costs nothing to discover — and leaves
  // no stamp, because there was never anything here to repair.
  let frontBytes: Uint8Array;
  try {
    frontBytes = await download(
      db, plan.objects.document_front.bucket, plan.objects.document_front.path);
  } catch (err: any) {
    return { checkId, outcome: 'not_applicable', detail: String(err?.message ?? err) };
  }

  const unitCosts = (resolved?.config?.['standalone_unit_costs_cents'] ?? {}) as
    Record<string, unknown>;
  const rawCost = unitCosts['id_verification'];
  const costCents = typeof rawCost === 'number' && Number.isFinite(rawCost) && rawCost >= 0
    ? rawCost
    : (resolved?.costCents ?? 0);

  let reading: IdVerificationReading | null = null;
  let callDetail: string | null = null;
  try {
    const body = await runWithMetrics(db, {
      tenantId: 'default', capability: 'idv', providerKey: provider.name,
      costCents, configId: resolved?.configId ?? null,
    }, () => provider.verifyIdentityDocument({
      frontImage: frontBytes,
      backImage: null,
      vendorData: buildVendorData(check.case_id, check.party_id ?? null),
      metadata: {
        npc_verification_check_id: checkId,
        npc_capture_sequence: check.capture_sequence ?? check.attempt_number ?? 1,
        npc_purpose: 'portrait_backfill',
      },
    }));
    reading = readIdVerification(body);
  } catch (err: any) {
    callDetail = err instanceof DiditStandaloneError
      ? err.category : String(err?.message ?? err);
  }

  /* From here the call HAS been made, so every path stamps. A request whose
     response never arrived has an unknown billing state, and re-sending it is
     precisely what this codebase refuses. */
  const bytes = reading ? await resolveReferenceImage(reading.portraitBase64) : null;
  const stored = bytes
    ? await storeIdentityPortrait(db, plan, check.case_id, checkId, bytes)
    : null;

  const outcome: PortraitBackfillOutcome = stored
    ? 'stored'
    : !reading
      ? 'provider_unavailable'
      : bytes
        ? 'storage_failed'
        : 'no_portrait_in_document';

  /* The ONLY write, and it is one statement so the stamp and the object can
     never disagree. `standalone_capture` is where `aml-idv-retention`
     enumerates from, so writing the object here is also what puts it on the
     same deletion clock as the captures it came from. Nothing under
     `standalone` is touched: that block is the recorded verification, and
     this call did not perform one. */
  const detail = check.outcome_detail ?? {};
  const { error: writeError } = await db.schema('aml').from('verification_checks')
    .update({
      outcome_detail: {
        ...detail,
        standalone_capture: {
          ...(detail.standalone_capture ?? {}),
          objects: stored ? { ...plan.objects, id_portrait: stored } : plan.objects,
          portrait_backfill: { attempted_at: new Date().toISOString(), outcome },
        },
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', checkId)
    // Re-checked in the UPDATE. A check that stopped being `passed` between
    // the read and here must not gain a portrait for the Passport.
    .eq('status', 'passed');

  return {
    checkId,
    outcome: writeError ? 'storage_failed' : outcome,
    providerVerdict: reading?.verdict ?? null,
    detail: writeError?.message ?? callDetail ?? undefined,
  };
}

/**
 * Checks whose Passport is missing a photograph we can still fetch.
 *
 * Bounded and ordered newest-first: the customers whose Passports are being
 * read now are repaired first, and a long tail drains over subsequent ticks
 * rather than in one burst of billed calls.
 *
 * The two JSON filters narrow the scan server-side; `backfillPending` decides.
 * The predicate is re-applied in code deliberately — a filter that silently
 * stopped matching would turn a bounded repair into repeated spending, and
 * this is the one place where being wrong costs money.
 */
export async function findPortraitBackfillCandidates(
  db: any, limit: number,
): Promise<string[]> {
  const { data, error } = await db.schema('aml').from('verification_checks')
    .select('id, provider, outcome_detail')
    .eq('check_type', 'electronic_idv')
    .eq('status', 'passed')
    .is('superseded_at', null)
    .is('outcome_detail->standalone_capture->objects->>id_portrait', null)
    .is('outcome_detail->standalone_capture->>portrait_backfill', null)
    .order('completed_at', { ascending: false })
    .limit(limit * 8);
  if (error || !data) return [];

  const ids: string[] = [];
  for (const row of data) {
    if (ids.length >= limit) break;
    if (!isStandaloneIdvProvider(row.provider)) continue;
    if (!backfillPending(
      backfillStampFor(row.outcome_detail), captureObjectsFor(row.outcome_detail),
    )) continue;
    ids.push(String(row.id));
  }
  return ids;
}
