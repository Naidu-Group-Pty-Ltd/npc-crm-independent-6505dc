const INTERNAL_EDGE_SECRET = (Deno.env.get('INTERNAL_EDGE_SECRET') || '').trim();
// Shared logic for processing bulk_generation_items. Used by both
// `generate-bulk-reports` (initial run) and `resume-bulk-generation` (cron).
//
// Design:
// - Items are claimed atomically via `claim_next_bulk_item` (FOR UPDATE SKIP LOCKED).
// - Each property is wrapped in an AbortController (REPORT_TIMEOUT_MS).
// - A heartbeat interval keeps `heartbeat_at` fresh so the cron requeuer
//   doesn't yank an actively-running item.
// - On failure, items below `max_attempts` are returned to `pending` for
//   the cron to pick up; otherwise marked `failed`.

// Both of these used to exceed the edge runtime's own ~150s ceiling, so neither
// could ever fire — the platform killed the worker first. They are now sized to
// live inside one invocation, and anything left over is picked up by the next
// cron tick.
const REPORT_TIMEOUT_MS = 130 * 1000; // hard stop for one property's resume chain
const DRAIN_BUDGET_MS = 100 * 1000;   // stop claiming new items past this
const HEARTBEAT_INTERVAL_MS = 30 * 1000; // 30s
const BATCH_SIZE = 2; // concurrent properties per worker invocation

export interface BulkProperty {
  id: string;
  address: string;
  suburb?: string;
  state?: string;
  zipCode?: string;
}

interface ClaimedItem {
  id: string;
  property_listing_id: string;
  property_address: string;
  attempts: number;
  report_id: string | null;
}

function startHeartbeat(supabase: any, itemId: string): number {
  return setInterval(async () => {
    try {
      await supabase
        .from('bulk_generation_items')
        .update({ heartbeat_at: new Date().toISOString() })
        .eq('id', itemId);
    } catch (e) {
      console.warn(`[bulkWorker] heartbeat failed for ${itemId}`, e);
    }
  }, HEARTBEAT_INTERVAL_MS) as unknown as number;
}

async function ensureReportRow(
  supabase: any,
  item: ClaimedItem,
  userId: string,
  jobId: string,
): Promise<string> {
  if (item.report_id) {
    // Make sure existing row is tagged with the bulk job for widget grouping
    await supabase
      .from('investment_reports')
      .update({ bulk_job_id: jobId })
      .eq('id', item.report_id)
      .is('bulk_job_id', null);
    return item.report_id;
  }
  const { data, error } = await supabase
    .from('investment_reports')
    .insert({
      property_address: item.property_address,
      report_content: '',
      status: 'processing',
      generated_by: userId,
      report_scope: 'address',
      bulk_job_id: jobId,
    })
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(`Failed to pre-create report row: ${error?.message}`);
  }
  await supabase
    .from('bulk_generation_items')
    .update({ report_id: data.id })
    .eq('id', item.id);
  return data.id;
}

/**
 * Drive one report to completion.
 *
 * A Compass report needs several minutes of model time and the edge runtime kills an
 * invocation at ~150s, so a single call can never finish one. This used to be a
 * single fire wrapped in an 8-minute AbortController — a timeout that could
 * never be reached, because the inner function died at the platform ceiling
 * first. The call then threw (or worse, the item was marked completed against a
 * report truncated at ~6 sections).
 *
 * The generator now stops at its own wall-clock budget and returns
 * `resumeRequired: true`, so we call it repeatedly with `continueFrom: true`
 * until it reports completion. Returns false when the round ran out of budget
 * with sections still outstanding — the caller must leave the item resumable.
 */
async function callInvestmentReport(
  reportId: string,
  property: { address: string; suburb?: string; state?: string; zipCode?: string },
  signal: AbortSignal,
): Promise<boolean> {
  const supabaseUrl = (Deno.env.get('SUPABASE_URL') || '').trim();
  const anonKey = (Deno.env.get('SUPABASE_ANON_KEY') || '').trim();

  // Bounds the resume chain so a report that never advances cannot spin here.
  // Sized against the section list: 17 sections at ~4 per budgeted call needed ~5,
  // and the v3.0 list is 12, so this is now generous rather than tight. It is a
  // runaway backstop, not a budget — leave headroom if the list grows again.
  const MAX_RESUME_ROUNDS = 12;
  let lastSectionCompleted = -1;
  let stalledRounds = 0;

  for (let round = 0; round < MAX_RESUME_ROUNDS; round++) {
    const response = await fetch(
      `${supabaseUrl}/functions/v1/generate-investment-report`,
      {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${INTERNAL_EDGE_SECRET}`,
          'apikey': anonKey,
        },
        body: JSON.stringify({
          reportId,
          propertyAddress: property.address,
          propertyDetails: {
            suburb: property.suburb,
            state: property.state,
            zipCode: property.zipCode,
            queryType: 'address',
          },
          // Round 0 starts the report; every later round resumes it. Without
          // continueFrom a resume would discard the banked sections and start
          // over, and the report could never converge.
          ...(round > 0 ? { continueFrom: true } : {}),
        }),
      },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    const json = await response.json();
    if (!json?.success) {
      throw new Error(json?.error || 'Inner function returned success=false');
    }

    // A run that finished post-processing reports success with no resume flag.
    if (json.isComplete === true || !json.resumeRequired) return true;

    const sectionCompleted = typeof json.sectionCompleted === 'number' ? json.sectionCompleted : -1;
    if (sectionCompleted <= lastSectionCompleted) {
      // Two rounds without a new section: something is wrong with this report
      // specifically. Stop burning API credits and let the watchdog decide.
      if (++stalledRounds >= 2) {
        console.warn(`[bulkWorker] ${property.address}: no progress past section ${sectionCompleted}, deferring`);
        return false;
      }
    } else {
      stalledRounds = 0;
      lastSectionCompleted = sectionCompleted;
    }
  }

  console.warn(`[bulkWorker] ${property.address}: still incomplete after ${MAX_RESUME_ROUNDS} rounds, deferring`);
  return false;
}

async function processOneItem(
  supabase: any,
  item: ClaimedItem,
  userId: string,
  jobId: string,
): Promise<{ success: boolean; error?: string }> {
  const startedAt = Date.now();
  const heartbeat = startHeartbeat(supabase, item.id);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('per-property timeout'), REPORT_TIMEOUT_MS);

  let reportId: string | null = null;
  try {
    reportId = await ensureReportRow(supabase, item, userId, jobId);
    const finished = await callInvestmentReport(
      reportId,
      { address: item.property_address },
      controller.signal,
    );

    const elapsed = Math.round((Date.now() - startedAt) / 1000);

    if (!finished) {
      // The report made progress but is not done. Marking the item 'completed'
      // here is what used to ship half-written reports to clients — the item
      // read as finished while the report sat truncated partway through its sections.
      // Return it to 'pending' (without consuming an attempt, since nothing
      // failed) so the bulk cron picks it up; the investment-report watchdog
      // will also drive it independently.
      await supabase
        .from('bulk_generation_items')
        .update({
          status: 'pending',
          heartbeat_at: null,
          claimed_at: null,
          worker_id: null,
          attempts: Math.max(0, item.attempts - 1),
        })
        .eq('id', item.id);

      console.log(`[bulkWorker] ⏸️ ${item.property_address} incomplete after ${elapsed}s — requeued for resume`);
      return { success: false, error: 'incomplete — requeued for resume' };
    }

    await supabase
      .from('bulk_generation_items')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        processing_time_seconds: elapsed,
        heartbeat_at: null,
        claimed_at: null,
        worker_id: null,
      })
      .eq('id', item.id);

    console.log(`[bulkWorker] ✅ ${item.property_address} in ${elapsed}s (attempt ${item.attempts})`);
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[bulkWorker] ❌ ${item.property_address} (attempt ${item.attempts}): ${msg}`);

    // Retry policy: if under max_attempts, requeue as pending so cron picks it up.
    // Otherwise terminal failure.
    const { data: row } = await supabase
      .from('bulk_generation_items')
      .select('max_attempts')
      .eq('id', item.id)
      .single();
    const maxAttempts = row?.max_attempts ?? 3;
    const willRetry = item.attempts < maxAttempts;

    await supabase
      .from('bulk_generation_items')
      .update({
        status: willRetry ? 'pending' : 'failed',
        error_message: msg,
        last_error_at: new Date().toISOString(),
        completed_at: willRetry ? null : new Date().toISOString(),
        heartbeat_at: null,
        claimed_at: null,
        worker_id: null,
      })
      .eq('id', item.id);

    if (!willRetry && reportId) {
      await supabase
        .from('investment_reports')
        .update({ status: 'failed', error_message: msg })
        .eq('id', reportId);
    }
    return { success: false, error: msg };
  } finally {
    clearTimeout(timeout);
    clearInterval(heartbeat);
  }
}

async function refreshJobCounts(supabase: any, jobId: string): Promise<{ done: boolean }> {
  const { data: rows } = await supabase
    .from('bulk_generation_items')
    .select('status')
    .eq('job_id', jobId);
  const items = rows || [];
  const completed = items.filter((r: any) => r.status === 'completed').length;
  const failed = items.filter((r: any) => r.status === 'failed').length;
  const remaining = items.length - completed - failed;
  const done = remaining === 0;
  await supabase
    .from('bulk_generation_jobs')
    .update({
      completed_reports: completed,
      failed_reports: failed,
      updated_at: new Date().toISOString(),
      ...(done
        ? {
            status: failed === items.length ? 'failed' : 'completed',
            completed_at: new Date().toISOString(),
            ...(failed === items.length
              ? { error_message: 'All items failed' }
              : {}),
          }
        : {}),
    })
    .eq('id', jobId);
  return { done };
}

/**
 * Drain pending items for a job, processing up to BATCH_SIZE concurrently.
 * Stops when no more items can be claimed or after `maxIterations` to keep
 * within the worker's wall budget.
 */
export async function drainJob(
  supabase: any,
  jobId: string,
  userId: string,
  workerId: string,
  maxIterations = 50,
): Promise<{ processed: number; succeeded: number; failed: number }> {
  let processed = 0, succeeded = 0, failed = 0;
  // This runs inside an edge invocation, so iteration count alone was never a
  // real bound — the platform could kill us mid-property regardless. Stop
  // claiming new work once we are close to the ceiling; unclaimed items simply
  // wait for the next cron tick.
  const drainStartedAt = Date.now();

  for (let iter = 0; iter < maxIterations; iter++) {
    if (Date.now() - drainStartedAt > DRAIN_BUDGET_MS) {
      console.log(`[bulkWorker] job ${jobId} drain budget reached after ${iter} iteration(s); deferring the rest`);
      break;
    }
    // Claim up to BATCH_SIZE items
    const claims: ClaimedItem[] = [];
    for (let i = 0; i < BATCH_SIZE; i++) {
      const { data, error } = await supabase.rpc('claim_next_bulk_item', {
        p_job_id: jobId,
        p_worker: workerId,
      });
      if (error) {
        console.error(`[bulkWorker] claim error for job ${jobId}:`, error);
        break;
      }
      const claimed = Array.isArray(data) && data.length ? data[0] : null;
      if (!claimed) break;
      claims.push(claimed as ClaimedItem);
    }

    if (claims.length === 0) break;

    const results = await Promise.allSettled(
      claims.map((c) => processOneItem(supabase, c, userId, jobId)),
    );
    for (const r of results) {
      processed++;
      if (r.status === 'fulfilled' && r.value.success) succeeded++;
      else failed++;
    }

    await refreshJobCounts(supabase, jobId);
  }

  // Final reconciliation
  const { done } = await refreshJobCounts(supabase, jobId);
  console.log(`[bulkWorker] job ${jobId} drain finished — processed=${processed}, done=${done}`);

  return { processed, succeeded, failed };
}
