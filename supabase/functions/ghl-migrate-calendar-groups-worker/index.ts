/**
 * GHL Migrate: CALENDAR GROUPS Worker
 *
 * Lists calendar groups (folders) from the source GHL account and creates
 * them in the target account. Records `(old_ghl_id → new_ghl_id)` in
 * `ghl_id_mapping` under `resource_type='calendar_group'` so the calendars
 * worker can re-parent calendars correctly.
 *
 * Idempotent: if a mapping already exists for a source group, the POST is
 * skipped and the existing mapping is reused.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyInternal } from '../_shared/auth_v2.ts';
import {
  getGhlCredentials,
  validateGhlCredentials,
  buildGhlHeaders,
  resolveGhlAccessTokenForLocation,
  describeGhlWriteAuthFailure,
  parseGhlError,
} from '../_shared/ghl-account.ts';
import {
  startJob, finishJob, recordItem, recordIdMapping, updateJobProgress,
  saveCheckpoint, loadCheckpoint, partialExit, heartbeat, readControlSignal,
} from '../_shared/migration-jobs.ts';
import { tokenKeyFor } from '../_shared/ghl-rate-limiter.ts';
import { createGhlFetchContext } from '../_shared/ghl-worker-fetch.ts';
import { internalError } from '../_shared/errorResponse.ts';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const MAX_RUNTIME_MS = 110_000;

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
    const sourceAccount = body.source_account as 'legacy' | 'new';
    const targetAccount = body.target_account as 'legacy' | 'new';
    const dryRun = body.dry_run !== false;
    if (!jobId) return new Response(JSON.stringify({ error: 'job_id required' }), { status: 400 });

    const sourceCreds = getGhlCredentials(sourceAccount);
    const targetCreds = getGhlCredentials(targetAccount);
    const sErr = validateGhlCredentials(sourceCreds);
    const tErr = validateGhlCredentials(targetCreds);
    if (sErr || tErr) {
      const msg = sErr || tErr || 'creds';
      await finishJob(supabase, jobId, 'failed', msg);
      return new Response(JSON.stringify({ error: msg }), { status: 400 });
    }

    const sourceAccess = await resolveGhlAccessTokenForLocation(sourceCreds);
    const targetAccess = dryRun
      ? { accessToken: targetCreds.apiKey!, diagnostics: null as any }
      : await resolveGhlAccessTokenForLocation(targetCreds);
    const sourceHeaders = buildGhlHeaders(sourceAccess.accessToken);
    const targetHeaders = buildGhlHeaders(targetAccess.accessToken);
    const targetAuthHint = targetAccess.diagnostics
      ? describeGhlWriteAuthFailure(targetAccess.diagnostics)
      : null;

    const ctx = createGhlFetchContext({
      supabase,
      sourceTokenKey: tokenKeyFor(sourceAccount, sourceAccess.accessToken),
      targetTokenKey: tokenKeyFor(targetAccount, targetAccess.accessToken),
      logTag: 'cal-groups-worker',
    });

    console.log(`[cal-groups-worker] job=${jobId} ${sourceAccount}→${targetAccount} dry_run=${dryRun}`);

    // List source groups
    const listRes = await ctx.ghlFetch(
      `${GHL_API_BASE}/calendars/groups?locationId=${sourceCreds.locationId}`,
      { method: 'GET', headers: sourceHeaders },
      3, 'source',
    );
    if (!listRes.ok) {
      const t = await listRes.text();
      throw new Error(`List groups failed ${listRes.status}: ${t.substring(0, 240)}`);
    }
    const listData = await listRes.json();
    const groups: any[] = listData?.groups || listData?.data || [];

    const checkpoint = await loadCheckpoint(supabase, jobId);
    const isResume = body._resume === true || (checkpoint.cursor.offset || 0) > 0;
    const startOffset = Number(checkpoint.cursor.offset) || 0;

    if (!isResume) {
      await startJob(supabase, jobId, groups.length);
    }

    let baseProcessed = 0, baseSucceeded = 0, baseFailed = 0;
    try {
      const { data: jobRow } = await supabase
        .from('migration_jobs')
        .select('processed_items, succeeded_items, failed_items')
        .eq('id', jobId).maybeSingle();
      baseProcessed = Number(jobRow?.processed_items || 0);
      baseSucceeded = Number(jobRow?.succeeded_items || 0);
      baseFailed = Number(jobRow?.failed_items || 0);
    } catch {}

    let totalProcessed = 0, totalSucceeded = 0, totalFailed = 0, totalSkipped = 0;
    let currentOffset = startOffset;
    let timeBudgetExhausted = false;
    let pausedByUser = false;
    let cancelledByUser: 'pause' | 'cancel' | 'kill' | null = null;
    const progressPatch = () => ({
      processed_items: baseProcessed + totalProcessed,
      succeeded_items: baseSucceeded + totalSucceeded,
      failed_items: baseFailed + totalFailed,
    });

    for (let i = startOffset; i < groups.length; i++) {
      if (totalProcessed % 5 === 0) {
        const sig = await readControlSignal(supabase, jobId);
        if (sig === 'kill' || sig === 'cancel') { cancelledByUser = sig; break; }
        if (sig === 'pause') { pausedByUser = true; break; }
      }
      if (Date.now() - startedAt > MAX_RUNTIME_MS) { timeBudgetExhausted = true; break; }

      const g = groups[i];
      totalProcessed++;
      currentOffset = i + 1;
      const oldId = g.id;
      const label = g.name || 'Calendar Group';

      // Already mirrored?
      const { data: existing } = await supabase
        .from('ghl_id_mapping')
        .select('new_ghl_id')
        .eq('resource_type', 'calendar_group')
        .eq('old_ghl_id', oldId)
        .eq('source_account_label', sourceAccount)
        .eq('target_account_label', targetAccount)
        .maybeSingle();
      if (existing?.new_ghl_id) {
        totalSkipped++;
        await recordItem(supabase, {
          job_id: jobId, source_id: oldId, target_id: existing.new_ghl_id,
          entity_label: label, status: 'skipped', error_message: 'Already mirrored',
        });
        continue;
      }

      if (dryRun) {
        totalSucceeded++;
        await recordItem(supabase, {
          job_id: jobId, source_id: oldId, entity_label: label,
          status: 'succeeded', error_message: 'DRY RUN — would create group',
        });
        continue;
      }

      try {
        const payloadBody: Record<string, any> = {
          locationId: targetCreds.locationId,
          name: g.name,
          description: g.description ?? '',
          slug: g.slug,
          isActive: g.isActive !== false,
        };
        const r = await ctx.ghlFetch(`${GHL_API_BASE}/calendars/groups`, {
          method: 'POST', headers: targetHeaders, body: JSON.stringify(payloadBody),
        }, 3, 'target');
        if (!r.ok) {
          const t = await r.text();
          const parsed = parseGhlError(t);
          const code = parsed.error_code || `GHL_${r.status}`;
          const authDetail = (r.status === 401 || r.status === 403) && targetAuthHint ? ` ${targetAuthHint}` : '';
          totalFailed++;
          await recordItem(supabase, {
            job_id: jobId, source_id: oldId, entity_label: label, status: 'failed',
            error_message: `[${code}] ${r.status}: ${(parsed.message || t).substring(0, 260)}${authDetail}`.substring(0, 900),
          });
          continue;
        }
        const data = await r.json();
        const newId = data?.group?.id || data?.id;
        if (newId) {
          await recordIdMapping(supabase, {
            resource_type: 'calendar_group', old_ghl_id: oldId, new_ghl_id: newId,
            source_account_label: sourceAccount, target_account_label: targetAccount, notes: label,
          });
        }
        totalSucceeded++;
        await recordItem(supabase, {
          job_id: jobId, source_id: oldId, target_id: newId || null,
          entity_label: label, status: 'succeeded',
        });
      } catch (e: any) {
        totalFailed++;
        await recordItem(supabase, {
          job_id: jobId, source_id: oldId, entity_label: label, status: 'failed',
          error_message: e.message?.substring(0, 300) || 'Unknown error',
        });
      }

      if (totalProcessed % 10 === 0) {
        await updateJobProgress(supabase, jobId, progressPatch());
        await heartbeat(supabase, jobId);
      }
    }

    await updateJobProgress(supabase, jobId, progressPatch());

    if (cancelledByUser) {
      await finishJob(supabase, jobId, 'cancelled', `Cancelled (${cancelledByUser})`);
      return new Response(JSON.stringify({ success: true, cancelled: true }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (pausedByUser) {
      await partialExit(supabase, jobId, { offset: currentOffset }, progressPatch());
      return new Response(JSON.stringify({ success: true, paused: true }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (timeBudgetExhausted && currentOffset < groups.length) {
      await partialExit(supabase, jobId, { offset: currentOffset }, progressPatch());
      return new Response(JSON.stringify({ success: true, partial: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    await saveCheckpoint(supabase, jobId, {});
    try { await supabase.rpc('release_migration_job_lock', { p_job_id: jobId }); } catch {}
    await finishJob(supabase, jobId,
      totalFailed > 0 && totalSucceeded === 0 ? 'failed' : 'completed',
      totalFailed > 0 ? `Completed with ${totalFailed} failures` : undefined);

    console.log(`[cal-groups-worker] DONE job=${jobId} ok=${totalSucceeded} fail=${totalFailed} skip=${totalSkipped}`);
    return new Response(JSON.stringify({
      success: true, processed: totalProcessed, succeeded: totalSucceeded, failed: totalFailed, skipped: totalSkipped,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err: any) {
    console.error('[cal-groups-worker] FATAL:', err);
    if (jobId && supabase) {
      await finishJob(supabase, jobId, 'failed', err.message || 'Worker crashed').catch(() => {});
    }
    return new Response(JSON.stringify({ ...internalError(err, 'ghl-migrate-calendar-groups-worker'), success: false }), { status: 500 });
  }
});
