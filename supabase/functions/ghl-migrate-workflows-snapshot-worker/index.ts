/**
 * GHL Migrate: WORKFLOWS SNAPSHOT Worker
 *
 * Inventories every workflow on BOTH the source AND target accounts and
 * upserts them into `ghl_workflow_snapshots`. Then attempts a name-based
 * (case-insensitive, normalized whitespace) match between source and
 * target, recording each match in `ghl_id_mapping` with resource_type
 * = 'workflow' and match_confidence='medium' (medium because GHL workflow
 * APIs only expose name + id + status — no deep equality is possible).
 *
 * This worker is idempotent — running it again refreshes last_seen_at and
 * picks up any new workflows in either account.
 *
 * NOTE: GHL has no "create workflow" API — workflows must be rebuilt
 * manually. This worker does NOT write to GHL; it only reads + maps.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyInternal } from '../_shared/auth_v2.ts';
import {
  getGhlCredentials,
  validateGhlCredentials,
  buildGhlHeaders,
  resolveGhlAccessTokenForLocation,
} from '../_shared/ghl-account.ts';
import { startJob, finishJob, recordItem, recordIdMapping, updateJobProgress } from '../_shared/migration-jobs.ts';
import { internalError } from '../_shared/errorResponse.ts';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';

function normalizeName(name: string | null | undefined): string {
  return String(name ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

async function listWorkflows(accessToken: string, locationId: string): Promise<any[]> {
  const url = `${GHL_API_BASE}/workflows/?locationId=${locationId}`;
  const r = await fetch(url, { method: 'GET', headers: buildGhlHeaders(accessToken) });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`List workflows failed ${r.status}: ${t.substring(0, 240)}`);
  }
  const data = await r.json();
  return data?.workflows || data?.data || [];
}

async function snapshotAccount(
  supabase: any,
  account: 'legacy' | 'new',
): Promise<{ count: number; workflows: any[] }> {
  const creds = getGhlCredentials(account);
  const err = validateGhlCredentials(creds);
  if (err) throw new Error(err);
  const access = await resolveGhlAccessTokenForLocation(creds);
  const workflows = await listWorkflows(access.accessToken, creds.locationId!);

  const now = new Date().toISOString();
  // Upsert in batches of 100
  for (let i = 0; i < workflows.length; i += 100) {
    const batch = workflows.slice(i, i + 100).map((wf) => ({
      account,
      workflow_id: String(wf.id),
      location_id: creds.locationId,
      name: wf.name || null,
      status: wf.status || null,
      version: typeof wf.version === 'number' ? wf.version : null,
      raw_json: wf,
      last_seen_at: now,
      fetched_at: now,
    }));
    const { error } = await supabase
      .from('ghl_workflow_snapshots')
      .upsert(batch, { onConflict: 'account,workflow_id' });
    if (error) throw new Error(`upsert snapshot batch failed: ${error.message}`);
  }
  return { count: workflows.length, workflows };
}

Deno.serve(async (req) => {
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
    if (!jobId) return new Response(JSON.stringify({ error: 'job_id required' }), { status: 400 });

    console.log(`[workflows-snapshot] job=${jobId} ${sourceAccount}→${targetAccount}`);

    // Phase 1: snapshot source
    const src = await snapshotAccount(supabase, sourceAccount);
    // Phase 2: snapshot target
    const tgt = await snapshotAccount(supabase, targetAccount);

    const total = src.count + tgt.count;
    await startJob(supabase, jobId, total);

    // Phase 3: name-based matching → record mappings
    const targetByName = new Map<string, any>();
    for (const wf of tgt.workflows) {
      const k = normalizeName(wf.name);
      if (k && !targetByName.has(k)) targetByName.set(k, wf);
    }

    let matched = 0, unmatched = 0;
    for (const wf of src.workflows) {
      const k = normalizeName(wf.name);
      const match = k ? targetByName.get(k) : null;
      if (match) {
        await recordIdMapping(supabase, {
          resource_type: 'workflow' as any,
          old_ghl_id: String(wf.id),
          new_ghl_id: String(match.id),
          source_account_label: sourceAccount,
          target_account_label: targetAccount,
          notes: `Name match: "${wf.name}"`,
          match_confidence: 'medium',
        });
        await recordItem(supabase, {
          job_id: jobId, source_id: String(wf.id), target_id: String(match.id),
          entity_label: wf.name || 'Workflow', status: 'succeeded',
        });
        matched++;
      } else {
        await recordItem(supabase, {
          job_id: jobId, source_id: String(wf.id),
          entity_label: wf.name || 'Workflow', status: 'skipped',
          error_message: 'No matching workflow name in target — needs to be rebuilt manually in the new GHL account.',
        });
        unmatched++;
      }
    }

    await updateJobProgress(supabase, jobId, {
      processed_items: total,
      succeeded_items: matched,
      failed_items: 0,
    });
    await finishJob(supabase, jobId, 'completed', null as any);

    return new Response(JSON.stringify({
      success: true,
      source_count: src.count,
      target_count: tgt.count,
      matched,
      unmatched_source: unmatched,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err: any) {
    console.error('[workflows-snapshot] error:', err);
    if (jobId && supabase) await finishJob(supabase, jobId, 'failed', err.message?.substring(0, 500));
    return new Response(JSON.stringify(internalError(err, 'ghl-migrate-workflows-snapshot-worker')), { status: 500 });
  }
});
