/**
 * GHL Migrate: WORKFLOW ENROLLMENTS BACKFILL Worker
 *
 * For every workflow snapshotted on the SOURCE account, fetch its enrolled
 * contacts and upsert them into `ghl_contact_workflow_enrollments`. This is
 * the one-shot mirror that becomes our system-of-record once the legacy
 * account is decommissioned.
 *
 * Uses partialExit() so it can resume across multiple ≤90s legs:
 *   cursor: { workflow_index, page }
 *
 * GHL endpoint used:
 *   GET /workflows/{workflowId}/contacts?locationId=...&limit=...&page=...
 *
 * If the endpoint returns 404 for a given workflow (deleted, no contacts API,
 * or scope-restricted), we record it skipped and move on.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyInternal } from '../_shared/auth_v2.ts';
import { internalError } from '../_shared/errorResponse.ts';
import {
  getGhlCredentials, validateGhlCredentials, buildGhlHeaders,
  resolveGhlAccessTokenForLocation,
} from '../_shared/ghl-account.ts';
import {
  startJob, finishJob, partialExit, loadCheckpoint,
  updateJobProgress, heartbeat, readControlSignal, recordItem,
} from '../_shared/migration-jobs.ts';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const MAX_RUNTIME_MS = 85_000;
const PAGE_LIMIT = 100;

Deno.serve(async (req) => {
  const startedAt = Date.now();
  if (req.method === 'OPTIONS') return new Response('ok');
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let supabase: any;
  let jobId: string | null = null;
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const rawBody = await req.text();
    let body: any = {};
    try { body = rawBody ? JSON.parse(rawBody) : {}; } catch { body = {}; }
    if (!(await verifyInternal(createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!), req, rawBody, { strict: true, allowedCallers: ['migration-dispatcher'] })).ok) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    }
    supabase = createClient(supabaseUrl, serviceRoleKey);

    jobId = body.job_id as string;
    const sourceAccount = (body.source_account as 'legacy' | 'new') || 'legacy';
    if (!jobId) return new Response(JSON.stringify({ error: 'job_id required' }), { status: 400 });

    const creds = getGhlCredentials(sourceAccount);
    const credErr = validateGhlCredentials(creds);
    if (credErr) {
      await finishJob(supabase, jobId, 'failed', credErr);
      return new Response(JSON.stringify({ error: credErr }), { status: 400 });
    }
    const access = await resolveGhlAccessTokenForLocation(creds);
    const headers = buildGhlHeaders(access.accessToken);

    // Load all snapshotted workflows for this account
    const { data: workflows, error: wfErr } = await supabase
      .from('ghl_workflow_snapshots')
      .select('workflow_id, name')
      .eq('account', sourceAccount)
      .order('workflow_id');
    if (wfErr) throw new Error(`load workflows failed: ${wfErr.message}`);
    const wfList = (workflows || []) as Array<{ workflow_id: string; name: string | null }>;

    if (wfList.length === 0) {
      await startJob(supabase, jobId, 0);
      await finishJob(supabase, jobId, 'completed', null as any);
      return new Response(JSON.stringify({ success: true, message: 'No workflows snapshotted yet — run workflows_snapshot first.' }));
    }

    const checkpoint = await loadCheckpoint(supabase, jobId);
    const isResume = body._resume === true || (checkpoint.cursor.workflow_index || 0) > 0 || (checkpoint.cursor.page || 0) > 0;
    if (!isResume) await startJob(supabase, jobId, wfList.length);

    let wfIdx = Number(checkpoint.cursor.workflow_index) || 0;
    let page = Number(checkpoint.cursor.page) || 1;

    let baseProcessed = 0, baseSucceeded = 0, baseFailed = 0;
    try {
      const { data: jr } = await supabase.from('migration_jobs')
        .select('processed_items, succeeded_items, failed_items')
        .eq('id', jobId).maybeSingle();
      baseProcessed = Number(jr?.processed_items || 0);
      baseSucceeded = Number(jr?.succeeded_items || 0);
      baseFailed = Number(jr?.failed_items || 0);
    } catch {}

    let processedThisLeg = 0, succeededThisLeg = 0, failedThisLeg = 0;
    let timeBudgetExhausted = false, killed = false;

    while (wfIdx < wfList.length) {
      if (Date.now() - startedAt > MAX_RUNTIME_MS) { timeBudgetExhausted = true; break; }
      const sig = await readControlSignal(supabase, jobId);
      if (sig === 'kill' || sig === 'cancel') { killed = true; break; }
      if (sig === 'pause') break;

      const wf = wfList[wfIdx];
      try {
        const url = `${GHL_API_BASE}/workflows/${wf.workflow_id}/contacts?locationId=${creds.locationId}&limit=${PAGE_LIMIT}&page=${page}`;
        const r = await fetch(url, { method: 'GET', headers });

        if (r.status === 404 || r.status === 422) {
          // Workflow has no contacts endpoint or was deleted; skip cleanly.
          await recordItem(supabase, {
            job_id: jobId, source_id: wf.workflow_id,
            entity_label: wf.name || 'Workflow', status: 'skipped',
            error_message: `Source returned ${r.status} on enrollments fetch (workflow may not expose enrollments via API).`,
          });
          succeededThisLeg++; processedThisLeg++; wfIdx++; page = 1;
          continue;
        }
        if (!r.ok) {
          const t = await r.text().catch(() => '');
          throw new Error(`HTTP ${r.status}: ${t.substring(0, 200)}`);
        }
        const data = await r.json();
        const contacts: any[] =
          data?.contacts || data?.data || data?.results || [];

        if (contacts.length > 0) {
          const rows = contacts.map((c: any) => ({
            account: sourceAccount,
            contact_id: String(c.id || c.contactId || c.contact_id),
            workflow_id: wf.workflow_id,
            status: c.status || c.workflowStatus || 'unknown',
            enrolled_at: c.dateAdded || c.createdAt || null,
            raw_json: c,
          })).filter((r: any) => r.contact_id && r.contact_id !== 'undefined');
          if (rows.length > 0) {
            const { error: upErr } = await supabase
              .from('ghl_contact_workflow_enrollments')
              .upsert(rows, { onConflict: 'account,contact_id,workflow_id' });
            if (upErr) console.error(`[wfenroll] upsert failed for wf=${wf.workflow_id}: ${upErr.message}`);
          }
        }

        // Pagination — assume more pages if we got a full page
        if (contacts.length >= PAGE_LIMIT) {
          page++;
          await heartbeat(supabase, jobId);
          continue;
        }

        // Workflow done
        await recordItem(supabase, {
          job_id: jobId, source_id: wf.workflow_id,
          entity_label: wf.name || 'Workflow', status: 'succeeded',
          error_message: null,
        });
        succeededThisLeg++; processedThisLeg++; wfIdx++; page = 1;
      } catch (e: any) {
        await recordItem(supabase, {
          job_id: jobId, source_id: wf.workflow_id,
          entity_label: wf.name || 'Workflow', status: 'failed',
          error_message: e.message?.substring(0, 500),
        });
        failedThisLeg++; processedThisLeg++; wfIdx++; page = 1;
      }
      await heartbeat(supabase, jobId);
    }

    const progress = {
      processed_items: baseProcessed + processedThisLeg,
      succeeded_items: baseSucceeded + succeededThisLeg,
      failed_items: baseFailed + failedThisLeg,
    };

    if (killed) {
      await updateJobProgress(supabase, jobId, progress);
      await finishJob(supabase, jobId, 'cancelled', 'Cancelled by user');
    } else if (timeBudgetExhausted || wfIdx < wfList.length) {
      await partialExit(supabase, jobId, { workflow_index: wfIdx, page }, progress);
    } else {
      await updateJobProgress(supabase, jobId, progress);
      await finishJob(supabase, jobId, 'completed', null as any);
    }

    return new Response(JSON.stringify({ success: true, processed_this_leg: processedThisLeg }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[wfenroll] error:', err);
    if (jobId && supabase) await finishJob(supabase, jobId, 'failed', err.message?.substring(0, 500));
    return new Response(JSON.stringify(internalError(err, 'ghl-migrate-workflow-enrollments-worker')), { status: 500 });
  }
});
