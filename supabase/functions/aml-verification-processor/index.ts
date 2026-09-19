/**
 * The server-side processor for NPC-captured identity verification.
 *
 * This is the only thing that calls Didit's Standalone APIs. The browser never
 * does, and cannot: it has no key, no endpoint and no operation that reaches
 * one. A customer's photographs go from NPC's camera to NPC's private buckets,
 * and this function — running in the Edge Function runtime with the credential
 * — takes them from there.
 *
 * ## Why it is a separate function
 *
 * Because the customer must not wait on it. Three provider calls against three
 * images take seconds, sometimes tens of seconds, and holding the portal's HTTP
 * request open for them means a page that hangs, a tab close that looks like a
 * failure, and a refresh that the customer reads as "start again". Submitting
 * and processing are therefore split: `aml-client-portal` accepts the
 * submission, writes the durable row and returns immediately, and this runs
 * behind it.
 *
 * ## Two callers, and why both exist
 *
 *  - `aml-client-portal` invokes it, signed, the instant a submission is
 *    accepted. That is what makes the customer's wait a few seconds rather
 *    than up to a minute.
 *  - **pg_cron invokes it every minute with no body.** That is the durability
 *    guarantee, and it is not decoration: an Edge Function isolate can be
 *    reclaimed mid-flight, and without a sweep a customer whose submission was
 *    accepted by an isolate that then died would sit on "Checking your
 *    identity" for ever. The sweep finds any queued attempt nobody owns and
 *    runs it.
 *
 * Both race safely. Every path claims the row with a conditional UPDATE before
 * it spends anything, so exactly one of them can ever reach the provider for a
 * given submission — see `standaloneVerification.ts`.
 *
 * ## What it will not do
 *
 * Retry a paid call. Didit bills per 200 response and documents no idempotency
 * key, so a request whose response never arrived has an unknown billing state.
 * The sequence records that and stops; it never re-sends. A stale claim is
 * released to `technical_failure` by the sweep below rather than re-run, and
 * the customer's next submission is a fresh, deliberate attempt that consumes
 * nothing from the failed one.
 *
 * ## The portrait backfill, on the same tick
 *
 * The document portrait was extracted on every run and discarded until
 * recently, so every verification completed before that has a Compliance
 * Passport with no face on it — while the document page it was cropped from
 * is still in NPC's own bucket. That is a defect in this product's own
 * record-keeping, and the sweep repairs it rather than asking an operator to
 * fix it by hand, once per customer, for ever.
 *
 * It does not bend the rule above. A backfill is ONE call per check, ever:
 * the attempt stamp is written whether the call succeeded, failed or produced
 * nothing, and its presence — never its outcome — is what stops a second.
 * There is no path that re-sends. The pass is small and runs only when the
 * verification queue is clear, so a customer's live submission is never
 * delayed by the repair of an old one.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.55.0';
import { enforceJsonBodyLimit, verifySignedInternal } from '../_shared/requestSecurity.ts';
import {
  backfillIdentityPortrait, findPortraitBackfillCandidates,
  processStandaloneCheck, type StandaloneRunResult,
} from '../_shared/aml/standaloneVerification.ts';
import { isStandaloneIdvProvider } from '../_shared/aml/providers/index.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });

/**
 * Attempts taken per sweep.
 *
 * Small on purpose. Each one is three provider calls, and a tick that tries to
 * drain a backlog is a tick that gets killed part-way through somebody's
 * verification. Leaving work for the next minute is always better.
 */
const SWEEP_LIMIT = 5;

/**
 * How long a claim may stand before the sweep gives up on it.
 *
 * Longer than the three provider timeouts plus the downloads, so a genuinely
 * running sequence is never taken away from itself. Finite, because a row
 * stuck at `processing` is a customer stuck on "Checking your identity" with
 * nothing on the way.
 */
const STALE_CLAIM_MS = 5 * 60 * 1000;

/**
 * Wall-clock budget for one invocation.
 *
 * The same rule the workflow dispatcher follows: stop TAKING work well before
 * the platform ceiling, so an attempt is left queued for the next tick rather
 * than claimed and then killed with a paid call half-made.
 */
const BUDGET_MS = 100_000;

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const parsed = await enforceJsonBodyLimit<Record<string, unknown>>(req, 2048);
  if (!parsed.ok) return parsed.error;

  // Signed internal callers only. There is no human path into this function and
  // no portal session it would accept: it holds the provider credential and
  // spends money, so the only things allowed to reach it are the scheduler and
  // the portal function that already authenticated the customer.
  const auth = await verifySignedInternal(
    admin, req, parsed.raw, ['pg_cron', 'aml-client-portal', 'aml-verification'],
  );
  if (!auth.ok) return json({ error: 'Unauthorized' }, 401);

  const startedAt = Date.now();
  const body = parsed.value ?? {};

  try {
    /* ── Targeted: one check, dispatched by the portal on submission ────── */
    if (typeof body.check_id === 'string' && body.check_id) {
      const result = await processStandaloneCheck(admin, body.check_id);
      return json({ processed: 1, results: [result] });
    }

    /* ── Sweep: the durability guarantee ───────────────────────────────── */

    await releaseStaleClaims(admin);

    const { data: queued, error } = await admin.schema('aml').from('verification_checks')
      .select('id, provider, created_at')
      .eq('check_type', 'electronic_idv')
      .eq('processing_status', 'queued')
      .is('superseded_at', null)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(SWEEP_LIMIT * 4);
    if (error) throw error;

    const results: StandaloneRunResult[] = [];
    for (const row of queued ?? []) {
      if (results.length >= SWEEP_LIMIT) break;
      if (Date.now() - startedAt > BUDGET_MS) break;
      // The self-hosted capture path is the outbox worker's, not this
      // function's. Taking it here would post NPC's captures to a service this
      // function knows nothing about.
      if (!isStandaloneIdvProvider(row.provider)) continue;
      results.push(await processStandaloneCheck(admin, String(row.id)));
    }

    /* ── The portrait backfill ──────────────────────────────────────────
       Last, and only when nothing live was taken this tick. A customer
       waiting on "Checking your identity" outranks a photograph missing from
       a Passport issued months ago, and the budget check keeps the repair out
       of the way of the guarantee. */
    const portraits = results.length === 0 && Date.now() - startedAt < BUDGET_MS
      ? await runPortraitBackfill(admin, startedAt)
      : [];

    return json({
      processed: results.length,
      results,
      portraits_backfilled: portraits.filter((p) => p.outcome === 'stored').length,
      portraits,
      duration_ms: Date.now() - startedAt,
    });
  } catch (err) {
    console.error('[aml-verification-processor] failed', (err as Error)?.message);
    return json({ error: 'processing_failed' }, 500);
  }
});

/**
 * Retire a claim nobody is honouring.
 *
 * An isolate reclaimed mid-sequence leaves `processing` set with nothing
 * running. Re-running it is not an option — we do not know which of the three
 * paid calls had already been made, and repeating them is exactly the
 * unattended spending this design refuses. So the row is settled as a technical
 * failure, which consumes NO attempt, and the customer is offered a fresh
 * submission with their full allowance intact.
 *
 * `status` is left at `pending` throughout: an abandoned claim says nothing
 * about anybody's identity.
 */
async function releaseStaleClaims(admin: any): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  const { data: stale } = await admin.schema('aml').from('verification_checks')
    .select('id, provider')
    .eq('check_type', 'electronic_idv')
    .eq('processing_status', 'processing')
    .eq('status', 'pending')
    .is('superseded_at', null)
    .lt('processing_started_at', cutoff)
    .limit(20);

  for (const row of stale ?? []) {
    if (!isStandaloneIdvProvider(row.provider)) continue;
    await admin.schema('aml').from('verification_checks').update({
      processing_status: 'technical_failure',
      provider_error_category: 'worker_failure',
      failure_reason: 'processing claim expired without completing; not re-run '
        + '(paid provider calls are never repeated on an unknown outcome)',
      processing_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
      .eq('id', row.id)
      // Re-checked in the UPDATE: the row may have completed between the read
      // and here, and overwriting a real outcome with a technical failure would
      // be far worse than missing a stale claim.
      .eq('processing_status', 'processing')
      .eq('status', 'pending');
  }
}

/**
 * How many old Passports are repaired per tick.
 *
 * Two. Each is one billed provider call, and this runs every minute: a
 * backlog of any size drains within hours without a burst of spending that
 * nobody chose, and a tick that tried to drain it all is a tick that gets
 * killed part-way through. Leaving work for the next minute is always better.
 */
const PORTRAIT_BACKFILL_LIMIT = 2;

/**
 * Fill in the photographs the product failed to keep.
 *
 * Fail-soft throughout: this is a repair, and a repair that could take the
 * verification sweep down with it would be worse than the defect it fixes.
 */
async function runPortraitBackfill(admin: any, startedAt: number) {
  try {
    const ids = await findPortraitBackfillCandidates(admin, PORTRAIT_BACKFILL_LIMIT);
    const out = [];
    for (const id of ids) {
      if (Date.now() - startedAt > BUDGET_MS) break;
      const result = await backfillIdentityPortrait(admin, id);
      out.push(result);
      /* Recorded and acted on by nobody: this re-derived an IMAGE, it did not
         re-decide an identity. A disagreement with the recorded verdict is
         for a human to notice, never for this to adopt. */
      if (result.outcome === 'stored') {
        console.info('[aml-verification] portrait backfilled', JSON.stringify({
          check_id: result.checkId, provider_verdict_on_reread: result.providerVerdict,
        }));
      }
    }
    return out;
  } catch (err) {
    console.warn('[aml-verification] portrait backfill failed', (err as Error)?.message);
    return [];
  }
}
