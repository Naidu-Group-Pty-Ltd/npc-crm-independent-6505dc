/**
 * GHL Migrate: WORKFLOW RE-ENROLLMENT Worker
 *
 * Reads pending rows from `ghl_contact_workflow_enrollments` (account=legacy,
 * re_enrollment_status='pending') and adds each contact to the corresponding
 * NEW-account workflow via:
 *   POST /contacts/{newContactId}/workflow/{newWorkflowId}
 *
 * Resolution chain:
 *   - new_workflow_id: ghl_id_mapping (resource_type='workflow', source=legacy)
 *   - new_contact_id:  ghl_id_mapping (resource_type='contact',  source=legacy)
 *
 * Rows where mappings don't yet exist are marked 'blocked' (caller must
 * either run the contacts migration or rebuild the missing workflow first
 * + re-run workflows_snapshot).
 *
 * Honours dry_run — in dry-run mode it reports what *would* happen
 * without firing the GHL POST and without mutating row status.
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
const BATCH = 50;

async function lookup(supabase: any, resource: string, oldId: string): Promise<string | null> {
  if (!oldId) return null;
  const { data } = await supabase
    .from('ghl_id_mapping')
    .select('new_ghl_id')
    .eq('resource_type', resource)
    .eq('old_ghl_id', oldId)
    .maybeSingle();
  return data?.new_ghl_id || null;
}

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
    const targetAccount = (body.target_account as 'legacy' | 'new') || 'new';
    const dryRun = body.dry_run !== false;
    const payload = body.payload || {};
    const onlyActive = payload.only_active !== false; // default: skip non-active enrollments
    if (!jobId) return new Response(JSON.stringify({ error: 'job_id required' }), { status: 400 });

    const targetCreds = getGhlCredentials(targetAccount);
    const credErr = validateGhlCredentials(targetCreds);
    if (!dryRun && credErr) {
      await finishJob(supabase, jobId, 'failed', credErr);
      return new Response(JSON.stringify({ error: credErr }), { status: 400 });
    }
    const targetAccess = dryRun
      ? { accessToken: targetCreds.apiKey || '' }
      : await resolveGhlAccessTokenForLocation(targetCreds);
    const headers = buildGhlHeaders(targetAccess.accessToken);

    // Total = count of pending rows for the source account
    const totalQ = supabase
      .from('ghl_contact_workflow_enrollments')
      .select('id', { count: 'exact', head: true })
      .eq('account', sourceAccount)
      .eq('re_enrollment_status', 'pending');
    if (onlyActive) totalQ.in('status', ['active', 'in-progress', 'inProgress']);
    const { count: totalPending } = await totalQ;
    const totalRowCount = Number(totalPending || 0);

    const checkpoint = await loadCheckpoint(supabase, jobId);
    const isResume = body._resume === true || (checkpoint.cursor.cursor_id || null) !== null;
    if (!isResume) await startJob(supabase, jobId, totalRowCount);

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
    let cursorId: string | null = checkpoint.cursor.cursor_id || null;
    let timeBudgetExhausted = false, killed = false;

    while (true) {
      if (Date.now() - startedAt > MAX_RUNTIME_MS) { timeBudgetExhausted = true; break; }
      const sig = await readControlSignal(supabase, jobId);
      if (sig === 'kill' || sig === 'cancel') { killed = true; break; }
      if (sig === 'pause') break;

      let q = supabase
        .from('ghl_contact_workflow_enrollments')
        .select('id, contact_id, workflow_id, status')
        .eq('account', sourceAccount)
        .eq('re_enrollment_status', 'pending')
        .order('id', { ascending: true })
        .limit(BATCH);
      if (onlyActive) q = q.in('status', ['active', 'in-progress', 'inProgress']);
      if (cursorId) q = q.gt('id', cursorId);
      const { data: rows, error } = await q;
      if (error) throw new Error(`fetch pending failed: ${error.message}`);
      if (!rows || rows.length === 0) break;

      for (const row of rows) {
        cursorId = row.id;
        const newWorkflowId = await lookup(supabase, 'workflow', row.workflow_id);
        const newContactId = await lookup(supabase, 'contact', row.contact_id);
        const updateBase: Record<string, any> = {
          re_enrollment_attempted_at: new Date().toISOString(),
          new_workflow_id: newWorkflowId,
          new_contact_id: newContactId,
        };

        if (!newWorkflowId || !newContactId) {
          const reason = !newWorkflowId
            ? `No mapping for workflow ${row.workflow_id} (rebuild it in NEW account, then re-run workflows_snapshot).`
            : `No mapping for contact ${row.contact_id} (run contacts migration first).`;
          if (!dryRun) {
            await supabase.from('ghl_contact_workflow_enrollments').update({
              ...updateBase, re_enrollment_status: 'blocked', re_enrollment_error: reason,
            }).eq('id', row.id);
          }
          await recordItem(supabase, {
            job_id: jobId, source_id: `${row.contact_id}@${row.workflow_id}`,
            status: 'skipped', error_message: reason,
          });
          failedThisLeg++; processedThisLeg++;
          continue;
        }

        if (dryRun) {
          await recordItem(supabase, {
            job_id: jobId, source_id: `${row.contact_id}@${row.workflow_id}`,
            target_id: `${newContactId}@${newWorkflowId}`,
            status: 'succeeded',
            error_message: 'DRY-RUN: would POST to /contacts/{id}/workflow/{wfId}',
          });
          succeededThisLeg++; processedThisLeg++;
          continue;
        }

        try {
          const url = `${GHL_API_BASE}/contacts/${newContactId}/workflow/${newWorkflowId}`;
          const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify({}) });
          if (r.ok || r.status === 200 || r.status === 201) {
            await supabase.from('ghl_contact_workflow_enrollments').update({
              ...updateBase, re_enrollment_status: 'succeeded', re_enrollment_error: null,
            }).eq('id', row.id);
            await recordItem(supabase, {
              job_id: jobId, source_id: `${row.contact_id}@${row.workflow_id}`,
              target_id: `${newContactId}@${newWorkflowId}`, status: 'succeeded',
            });
            succeededThisLeg++;
          } else {
            const t = await r.text().catch(() => '');
            const errMsg = `HTTP ${r.status}: ${t.substring(0, 240)}`;
            await supabase.from('ghl_contact_workflow_enrollments').update({
              ...updateBase, re_enrollment_status: 'failed', re_enrollment_error: errMsg,
            }).eq('id', row.id);
            await recordItem(supabase, {
              job_id: jobId, source_id: `${row.contact_id}@${row.workflow_id}`,
              status: 'failed', error_message: errMsg,
            });
            failedThisLeg++;
          }
        } catch (e: any) {
          const errMsg = e.message?.substring(0, 500);
          await supabase.from('ghl_contact_workflow_enrollments').update({
            ...updateBase, re_enrollment_status: 'failed', re_enrollment_error: errMsg,
          }).eq('id', row.id);
          await recordItem(supabase, {
            job_id: jobId, source_id: `${row.contact_id}@${row.workflow_id}`,
            status: 'failed', error_message: errMsg,
          });
          failedThisLeg++;
        }
        processedThisLeg++;
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
    } else if (timeBudgetExhausted) {
      await partialExit(supabase, jobId, { cursor_id: cursorId }, progress);
    } else {
      await updateJobProgress(supabase, jobId, progress);
      await finishJob(supabase, jobId, 'completed', null as any);
    }

    return new Response(JSON.stringify({
      success: true,
      processed_this_leg: processedThisLeg,
      succeeded: succeededThisLeg,
      failed: failedThisLeg,
      dry_run: dryRun,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err: any) {
    console.error('[wf-reenroll] error:', err);
    if (jobId && supabase) await finishJob(supabase, jobId, 'failed', err.message?.substring(0, 500));
    return new Response(JSON.stringify(internalError(err, 'ghl-migrate-workflow-reenroll-worker')), { status: 500 });
  }
});
