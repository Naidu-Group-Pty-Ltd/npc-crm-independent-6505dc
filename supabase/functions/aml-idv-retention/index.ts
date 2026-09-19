/**
 * Destroying identity captures when their retention has run out.
 *
 * The only thing in this repository that deletes a customer's identity
 * document or their face. It runs daily, on a signed schedule, with
 * service-role authority, and it can be reached from nowhere else — there is
 * no human route into it, no portal session it would accept, and no parameter
 * through which a caller could name an object.
 *
 * ## Why it is separate from the verification processor
 *
 * They are different responsibilities on different clocks. The processor runs
 * every minute because a customer is watching a spinner; this runs daily
 * because a retention period is measured in years. Coupling them would put
 * deletion of evidence on a one-minute loop, which is the wrong cadence for the
 * most consequential write in the system, and would mean a bug in either one
 * could stop the other.
 *
 * ## What it will not do
 *
 * Guess. `retentionVerdict` fails closed on every unknown, and the two clocks
 * it consults are NPC's, not this file's: §18's recorded retention trigger for
 * the case, and the configured capture window. With no
 * `AML_IDV_CAPTURE_RETENTION_DAYS` it deletes nothing at all and says so —
 * "not configured" is a reportable state, not a reason to fall back to a
 * number somebody made up.
 *
 * It is also safely re-runnable. A pass that removed one object and failed on
 * another records `partial`, leaves the row eligible, and the next pass tries
 * only what is left. An object that is already gone counts as removed, so
 * retrying converges instead of erroring for ever.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.55.0';
import { enforceJsonBodyLimit, verifySignedInternal } from '../_shared/requestSecurity.ts';
import { isStandaloneIdvProvider } from '../_shared/aml/providers/index.ts';
import { readCapturePlan } from '../_shared/aml/standaloneVerification.ts';
import {
  buildRetentionRecord,
  cleanupStatusFor,
  mayDeleteObject,
  parseRetentionDays,
  retentionVerdict,
  CAPTURE_RETENTION_ENV,
  type CaptureObjectRef,
  type ObjectOutcome,
  type RetentionCandidate,
  type RetentionDecision,
} from '../_shared/aml/captureRetention.pure.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });

/**
 * Rows examined per run.
 *
 * Retention is not urgent — a capture that waits one more day for its turn has
 * waited years already — so this is small enough that a run cannot get itself
 * killed part-way through a deletion sequence.
 */
const SCAN_LIMIT = 200;
/** Attempts actually cleaned per run. Deliberately smaller than the scan. */
const DELETE_LIMIT = 50;
const BUDGET_MS = 100_000;

/**
 * The providers whose captures NPC holds.
 *
 * Derived from the registry rather than listed, so a fourth provider shape
 * cannot silently become deletable — or silently stop being deletable — by
 * being added somewhere else.
 */
const STANDALONE_PROVIDERS: ReadonlySet<string> = new Set(
  ['didit_standalone'].filter((key) => isStandaloneIdvProvider(key)),
);

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const parsed = await enforceJsonBodyLimit<Record<string, unknown>>(req, 2048);
  if (!parsed.ok) return parsed.error;

  // Signed internal callers only. This function destroys evidence; the
  // scheduler and the staff AML function are the only things entitled to ask.
  const auth = await verifySignedInternal(
    admin, req, parsed.raw, ['pg_cron', 'aml-verification', 'aml-records'],
  );
  if (!auth.ok) return json({ error: 'Unauthorized' }, 401);

  const startedAt = Date.now();
  const body = parsed.value ?? {};
  /**
   * `dry_run` reports what WOULD be destroyed and deletes nothing.
   *
   * The first thing an operator should run, and the thing a reviewer should
   * ask for before this is scheduled anywhere near production data.
   */
  const dryRun = body.dry_run === true;

  const retentionDays = parseRetentionDays(Deno.env.get(CAPTURE_RETENTION_ENV));

  try {
    /**
     * Candidates: settled Standalone attempts whose captures are still here.
     *
     * Filtered on real columns so the scan uses
     * `idx_aml_verification_capture_retention` rather than reading every check
     * ever written. `capture_deleted_at IS NULL` is the predicate that stops a
     * cleaned row being reconsidered for ever.
     */
    const { data, error } = await admin.schema('aml').from('verification_checks')
      .select('id, case_id, provider, processing_status, status, superseded_at, '
        + 'capture_deleted_at, processing_completed_at, completed_at, outcome_detail')
      .eq('check_type', 'electronic_idv')
      .is('capture_deleted_at', null)
      .not('processing_completed_at', 'is', null)
      .order('processing_completed_at', { ascending: true })
      .limit(SCAN_LIMIT);
    if (error) throw error;
    // PostgREST's row type is inferred from the select string, and a
    // concatenated one it cannot parse degrades to an error union. The shape is
    // asserted by `buildCandidate`, which reads every field explicitly.
    const rows = (data ?? []) as Array<Record<string, any>>;

    const summary: Record<string, number> = {};
    const cleaned: Array<{ check_id: string; status: string; objects: number }> = [];
    let deletedObjects = 0;

    for (const row of rows) {
      if (Date.now() - startedAt > BUDGET_MS) break;
      if (cleaned.length >= DELETE_LIMIT) break;

      const candidate = await buildCandidate(admin, row);
      const verdict = retentionVerdict(
        candidate, retentionDays, Date.now(), STANDALONE_PROVIDERS);
      summary[verdict.decision] = (summary[verdict.decision] ?? 0) + 1;

      if (!verdict.deletable) continue;
      if (dryRun) continue;

      const outcomes = await destroyCaptures(admin, candidate);
      const status = cleanupStatusFor(outcomes);
      deletedObjects += outcomes.filter((o) => o.removed).length;

      const record = buildRetentionRecord({
        retentionDays: retentionDays as number,
        minimumRetentionDate: candidate.minimumRetentionDate,
        decidedAt: new Date().toISOString(),
        outcomes,
        reason: verdict.reason,
      });

      /**
       * The row is stamped only when every object is gone.
       *
       * A `partial` run leaves `capture_deleted_at` null on purpose, so the
       * attempt stays in the candidate scan and the next pass finishes it. The
       * per-object detail is written either way, so a persistent failure is
       * visible rather than silently retried for ever.
       */
      await admin.schema('aml').from('verification_checks').update({
        ...(status === 'deleted' ? { capture_deleted_at: new Date().toISOString() } : {}),
        capture_cleanup_status: status,
        capture_retention_days_used: retentionDays,
        outcome_detail: {
          ...(row.outcome_detail ?? {}),
          standalone: {
            ...(((row.outcome_detail ?? {}) as Record<string, any>).standalone ?? {}),
            capture_retention: record,
          },
        },
        updated_at: new Date().toISOString(),
      }).eq('id', row.id).is('capture_deleted_at', null);

      cleaned.push({ check_id: String(row.id), status, objects: outcomes.length });
    }

    return json({
      configured: retentionDays !== null,
      retention_days: retentionDays,
      dry_run: dryRun,
      scanned: rows.length,
      decisions: summary,
      cleaned: cleaned.length,
      objects_deleted: deletedObjects,
      duration_ms: Date.now() - startedAt,
    });
  } catch (err) {
    console.error('[aml-idv-retention] failed', (err as Error)?.message);
    return json({ error: 'retention_scan_failed' }, 500);
  }
});

/**
 * Gather everything the decision needs, from canonical tables only.
 *
 * The two lookups are the point: §18's retention trigger and the legal-hold
 * register are where NPC records whether a case may be disposed of at all, and
 * asking them per candidate is what keeps this worker subordinate to the
 * programme's own policy rather than a second opinion about it.
 */
async function buildCandidate(admin: any, row: any): Promise<RetentionCandidate> {
  const plan = readCapturePlan(row);
  const objects: CaptureObjectRef[] = [];
  if (plan) {
    /* `id_portrait` is the face the provider extracted from the document —
       derived during processing rather than captured, and the one image that
       may appear on a Compliance Passport. It is destroyed on exactly the
       same clock as the captures it came from: an image this product stores
       and never deletes would be worse than one it never stored. */
    for (const ref of [plan.objects.document_front, plan.objects.document_back,
      plan.objects.selfie, plan.objects.id_portrait]) {
      if (ref?.bucket && ref?.path) objects.push({ bucket: ref.bucket, path: ref.path });
    }
  }

  // §18 — the latest live trigger for this case. `minimum_retention_date` is
  // stored rather than derived, so the clock cannot move under a scan.
  const { data: trigger } = await admin.schema('aml').from('retention_triggers')
    .select('minimum_retention_date')
    .eq('case_id', row.case_id)
    .is('superseded_at', null)
    .order('minimum_retention_date', { ascending: false })
    .limit(1).maybeSingle();

  // A hold on the case OR on this specific check. Either one stops everything.
  const { data: holds } = await admin.schema('aml').from('legal_holds')
    .select('id')
    .eq('active', true)
    .is('released_at', null)
    .or(`case_id.eq.${row.case_id},entity_id.eq.${row.id}`)
    .limit(1);

  return {
    checkId: String(row.id),
    caseId: String(row.case_id),
    provider: row.provider ?? null,
    processingStatus: row.processing_status ?? null,
    status: row.status ?? null,
    // The attempt is settled when the pipeline finished with it; `completed_at`
    // is only set for an authoritative outcome, so it cannot stand alone.
    settledAt: row.processing_completed_at ?? row.completed_at ?? null,
    supersededAt: row.superseded_at ?? null,
    captureDeletedAt: row.capture_deleted_at ?? null,
    objects,
    minimumRetentionDate: trigger?.minimum_retention_date ?? null,
    legalHoldActive: (holds ?? []).length > 0,
  };
}

/**
 * Remove the recorded objects, one at a time, each re-checked first.
 *
 * `mayDeleteObject` is applied per object even though every path came off the
 * row this function is processing. That is deliberate: the check costs a set
 * lookup and a prefix compare, and what it guards against is a row whose
 * stored plan is wrong — hand-edited, corrupted, or written by a future bug —
 * naming a bucket or a case that is not this one. A refusal is recorded and
 * reported rather than swallowed.
 */
async function destroyCaptures(
  admin: any, candidate: RetentionCandidate,
): Promise<ObjectOutcome[]> {
  const outcomes: ObjectOutcome[] = [];

  for (const object of candidate.objects) {
    const permitted = mayDeleteObject(object, candidate.caseId);
    if (!permitted.allowed) {
      outcomes.push({
        bucket: object.bucket, path: object.path, removed: false,
        detail: `refused: ${permitted.reason}`,
      });
      continue;
    }

    const { error } = await admin.storage.from(object.bucket).remove([object.path]);
    if (error) {
      outcomes.push({
        bucket: object.bucket, path: object.path, removed: false,
        detail: `storage error: ${String(error.message ?? error).slice(0, 120)}`,
      });
      continue;
    }
    // Supabase answers a removal of something that is not there without an
    // error, which is the behaviour that makes a retry converge: an object a
    // previous partial run already destroyed reads as removed here.
    outcomes.push({ bucket: object.bucket, path: object.path, removed: true });
  }

  return outcomes;
}

export type { RetentionDecision };
