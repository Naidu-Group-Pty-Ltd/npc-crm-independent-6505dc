/**
 * Backfill Opportunity Mappings (one-off recovery)
 *
 * Walks every `migration_job_items` row that ended in `succeeded` for the
 * `opportunities` domain and ensures `ghl_id_mapping` has a matching row.
 * For "succeeded" items that have a `target_id` recorded but no mapping row
 * (the kill-mid-batch race), inserts the mapping directly.
 * For "failed" items that hit GHL_400 "duplicate opportunity", searches the
 * target account for the existing opp on (contactId, pipelineId) and
 * inserts a recovery mapping with `match_confidence='low'` so future runs
 * skip them instead of looping.
 *
 * Superadmin only. Returns a summary.
 *
 * IMPORTANT: This is a one-off — safe to leave deployed because it is a
 * read-only-on-GHL + idempotent-upsert-only-on-Supabase operation.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import {
  verifyAuth,
  createCorsHeaders,
  createUnauthorizedResponse,
  createForbiddenResponse,
} from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import {
  getGhlCredentials,
  buildGhlHeaders,
  resolveGhlAccessTokenForLocation,
} from '../_shared/ghl-account.ts';
import { recordIdMapping } from '../_shared/migration-jobs.ts';
import { createGhlFetchContext } from '../_shared/ghl-worker-fetch.ts';
import { tokenKeyFor } from '../_shared/ghl-rate-limiter.ts';
import { internalError } from '../_shared/errorResponse.ts';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const body = await req.json().catch(() => ({}));

    // Authn + authz
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError || !userId) return createUnauthorizedResponse(authError || 'Authentication required', corsHeaders);
    if (userId !== 'service_role') {
      const { data: roleRows } = await supabase.from('user_roles').select('role').eq('user_id', userId);
      const isSuperadmin = (roleRows || []).some((r: any) => r.role === 'superadmin');
      if (!isSuperadmin) return createForbiddenResponse('Superadmin access required', corsHeaders);
    }

    const sourceAccount = (body.source_account === 'new' ? 'new' : 'legacy') as 'legacy' | 'new';
    const targetAccount = (body.target_account === 'new' ? 'new' : 'legacy') as 'legacy' | 'new';
    const dryRun = body.dry_run === true;
    const includeFailedDuplicates = body.include_failed_duplicates !== false; // default true

    const targetCreds = getGhlCredentials(targetAccount);
    if (!targetCreds.apiKey || !targetCreds.locationId) {
      throw new Error(`Missing GHL credentials for target=${targetAccount}`);
    }
    const targetResolved = await resolveGhlAccessTokenForLocation(targetCreds);
    const targetHeaders = buildGhlHeaders(targetResolved.accessToken);
    const ctx = createGhlFetchContext({
      supabase,
      sourceTokenKey: tokenKeyFor(sourceAccount, targetCreds.locationId),
      targetTokenKey: tokenKeyFor(targetAccount, targetCreds.locationId),
      logTag: 'backfill-opp-mappings',
    });

    // ── Phase A: Backfill from succeeded items that have target_id ─────
    const { data: succeededRows } = await supabase
      .from('migration_job_items')
      .select('source_id, target_id, entity_label, job_id')
      .eq('status', 'succeeded')
      .not('target_id', 'is', null)
      .in('job_id',
        (await supabase.from('migration_jobs').select('id').eq('domain', 'opportunities')).data?.map((r: any) => r.id) || [],
      );

    let phaseAInserted = 0, phaseAExisting = 0;
    const seen = new Set<string>();
    for (const row of (succeededRows || [])) {
      if (seen.has(row.source_id)) continue;
      seen.add(row.source_id);
      const { data: existing } = await supabase
        .from('ghl_id_mapping').select('new_ghl_id')
        .eq('resource_type', 'opportunity').eq('old_ghl_id', row.source_id)
        .maybeSingle();
      if (existing?.new_ghl_id) { phaseAExisting++; continue; }
      if (dryRun) { phaseAInserted++; continue; }
      await recordIdMapping(supabase, {
        resource_type: 'opportunity', old_ghl_id: row.source_id, new_ghl_id: row.target_id!,
        source_account_label: sourceAccount, target_account_label: targetAccount,
        notes: row.entity_label || 'backfill: prior succeeded item',
      });
      phaseAInserted++;
    }

    // ── Phase B: Recover from failed-duplicate items via GHL search ────
    let phaseBRecovered = 0, phaseBUnresolved = 0, phaseBSkipped = 0;
    const failedSeen = new Set<string>();
    if (includeFailedDuplicates) {
      const { data: failedRows } = await supabase
        .from('migration_job_items')
        .select('source_id, entity_label, error_message, job_id')
        .eq('status', 'failed')
        .ilike('error_message', '%duplicate opportunity%')
        .in('job_id',
          (await supabase.from('migration_jobs').select('id').eq('domain', 'opportunities')).data?.map((r: any) => r.id) || [],
        );

      // We need contactId per source opp to search; fetch the source opportunities
      // in batch from GHL legacy. For simplicity, look up via the source GHL
      // /opportunities/{id} endpoint per item (rate-limited by ctx.ghlFetch).
      const sourceCreds = getGhlCredentials(sourceAccount);
      const srcResolved = await resolveGhlAccessTokenForLocation(sourceCreds);
      const sourceHeaders = buildGhlHeaders(srcResolved.accessToken);

      for (const row of (failedRows || [])) {
        if (failedSeen.has(row.source_id)) continue;
        failedSeen.add(row.source_id);

        // Skip if we already have a mapping (could have been backfilled above)
        const { data: existing } = await supabase
          .from('ghl_id_mapping').select('new_ghl_id')
          .eq('resource_type', 'opportunity').eq('old_ghl_id', row.source_id)
          .maybeSingle();
        if (existing?.new_ghl_id) { phaseBSkipped++; continue; }

        try {
          // 1. Look up the source opp to get its contactId
          const srcRes = await ctx.ghlFetch(
            `${GHL_API_BASE}/opportunities/${row.source_id}`,
            { headers: sourceHeaders }, 2, 'source',
          );
          if (!srcRes.ok) { phaseBUnresolved++; continue; }
          const srcBody = await srcRes.json();
          const srcOpp = srcBody?.opportunity || srcBody;
          const srcContactId = srcOpp?.contactId || srcOpp?.contact?.id;
          if (!srcContactId) { phaseBUnresolved++; continue; }

          // 2. Translate source contactId → target contactId via mapping
          const { data: contactMap } = await supabase
            .from('ghl_id_mapping').select('new_ghl_id')
            .eq('resource_type', 'contact').eq('old_ghl_id', srcContactId)
            .maybeSingle();
          if (!contactMap?.new_ghl_id) { phaseBUnresolved++; continue; }

          // 3. Translate source pipelineId → target pipelineId via mapping
          //    so we can scope the search. Without this, we'd silently bind
          //    mappings to opps in the wrong pipeline (the original bug).
          const srcPipelineId = srcOpp?.pipelineId;
          if (!srcPipelineId) { phaseBUnresolved++; continue; }
          const { data: pipelineMap } = await supabase
            .from('ghl_id_mapping').select('new_ghl_id')
            .eq('resource_type', 'pipeline').eq('old_ghl_id', srcPipelineId)
            .maybeSingle();
          if (!pipelineMap?.new_ghl_id) { phaseBUnresolved++; continue; }

          // 4. Search target SCOPED to the correct pipeline
          const params = new URLSearchParams({
            location_id: targetCreds.locationId!,
            contact_id: contactMap.new_ghl_id,
            pipeline_id: pipelineMap.new_ghl_id,
            limit: '100',
          });
          const tRes = await ctx.ghlFetch(
            `${GHL_API_BASE}/opportunities/search?${params}`,
            { headers: targetHeaders }, 2, 'target',
          );
          if (!tRes.ok) { phaseBUnresolved++; continue; }
          const tBody = await tRes.json();
          // Belt-and-braces: filter again client-side in case GHL ignores the
          // pipeline_id param.
          const tOpps: any[] = (tBody?.opportunities || []).filter(
            (o: any) => o.pipelineId === pipelineMap.new_ghl_id,
          );
          if (tOpps.length === 0) { phaseBUnresolved++; continue; }

          // Best match: name (case-insensitive trim) + monetaryValue if available
          const wantedName = (srcOpp.name || '').trim().toLowerCase();
          const wantedValue = typeof srcOpp.monetaryValue === 'number' ? srcOpp.monetaryValue : null;
          let pick: any | null = null;
          let confidence: 'medium' | 'low' = 'low';

          if (wantedName) {
            const nameMatches = tOpps.filter((o) => (o.name || '').trim().toLowerCase() === wantedName);
            if (nameMatches.length === 1 && (wantedValue == null || Math.abs((Number(nameMatches[0].monetaryValue) || 0) - wantedValue) < 1)) {
              pick = nameMatches[0]; confidence = 'medium';
            } else if (nameMatches.length >= 1) {
              pick = nameMatches[0]; confidence = 'low';
            }
          }
          if (!pick) {
            pick = tOpps[0]; confidence = 'low';
          }

          if (dryRun) { phaseBRecovered++; continue; }
          await recordIdMapping(supabase, {
            resource_type: 'opportunity', old_ghl_id: row.source_id, new_ghl_id: pick.id,
            source_account_label: sourceAccount, target_account_label: targetAccount,
            notes: row.entity_label || 'backfill: recovered from duplicate-400',
            match_confidence: confidence,
          });
          phaseBRecovered++;
        } catch (e: any) {
          console.warn(`[backfill-opp-mappings] error on source_id=${row.source_id}: ${e.message}`);
          phaseBUnresolved++;
        }
      }
    }

    const summary = {
      success: true,
      dry_run: dryRun,
      phase_a: {
        description: 'Mappings inserted from prior-succeeded items with target_id',
        inserted: phaseAInserted,
        already_existed: phaseAExisting,
        scanned: seen.size,
      },
      phase_b: {
        description: 'Recovered mappings from failed duplicate-400 items via GHL search',
        recovered: phaseBRecovered,
        unresolved: phaseBUnresolved,
        skipped_already_mapped: phaseBSkipped,
        scanned: failedSeen.size,
      },
    };
    console.log('[backfill-opp-mappings] summary:', JSON.stringify(summary));
    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[backfill-opp-mappings] error:', err);
    return new Response(JSON.stringify({ ...internalError(err, 'backfill-opportunity-mappings'), success: false }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
