/**
 * Phase 5 — Finance Portal automation runner.
 *
 * Scans purchase files and trackers; emits notifications for:
 *   - Missing documents requested >48h ago, still unfulfilled
 *   - Finance clause due in 5 or 2 calendar days
 *   - Valuations ordered >3 days ago with no returned_date
 *   - Settlements due in 7 days
 *
 * Designed to be called by pg_cron / scheduler. Idempotent within a 24h window
 * (per-file + per-rule de-dupe via notifications metadata).
 */
import { createClient } from 'npm:@supabase/supabase-js@2.55.0';

import { createCorsHeaders as __createCorsHeaders } from "../_shared/auth.ts";
// Dynamic per-request CORS — frontend uses `credentials: 'include'`, so ACAO must
// echo the request Origin (never `*`) with `Allow-Credentials: true`.
const corsHeaderDefaults: Record<string, string> = {
  ...__createCorsHeaders(null),
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

function jsonWithHeaders(data: unknown, responseCorsHeaders: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
  });
}

function daysFromToday(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00Z');
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  return Math.round((d.getTime() - now.getTime()) / 86_400_000);
}

Deno.serve(async (req) => {
  const corsHeaders = { ...__createCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Headers': corsHeaderDefaults['Access-Control-Allow-Headers'], 'Access-Control-Expose-Headers': corsHeaderDefaults['Access-Control-Expose-Headers'] };
  const json = (data: any, status = 200) => jsonWithHeaders(data, corsHeaders, status);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Simple shared-secret guard (cron passes ?secret= or x-automation-secret header)
  const expected = Deno.env.get('AUTOMATION_RUNNER_SECRET');
  const url = new URL(req.url);
  const provided = req.headers.get('x-automation-secret') || url.searchParams.get('secret');
  if (expected && provided !== expected) return json({ error: 'Forbidden' }, 403);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const results: Record<string, number> = {
    missing_docs_reminder: 0,
    finance_clause_t5: 0,
    finance_clause_t2: 0,
    valuation_overdue: 0,
    settlement_t7: 0,
  };

  // Helper: only insert a notification if no identical type+file event in the past 24h
  async function emit(userId: string, type: string, title: string, message: string, fileId: string, extra: Record<string, unknown> = {}) {
    if (!userId) return false;
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const { data: existing } = await supabase
      .from('notifications')
      .select('id')
      // `notifications` addresses a recipient with `target_user_id`; it has no
      // `user_id`. This is the 24-hour duplicate guard, so the failed read left
      // `existing` null and every run emitted the notification again.
      .eq('target_user_id', userId)
      .eq('type', type)
      .gte('created_at', since)
      .contains('metadata', { purchase_file_id: fileId })
      .limit(1)
      .maybeSingle();
    if (existing) return false;
    await supabase.from('notifications').insert({
      target_user_id: userId, type, title, message,
      metadata: { purchase_file_id: fileId, ...extra },
    });
    return true;
  }

  // 1. Load all open purchase files
  const { data: files } = await supabase
    .from('purchase_files')
    .select('id, client_id, title, finance_clause_date, settlement_date, assigned_finance_user_id, assigned_team_user_id')
    .is('archived_at', null);

  for (const f of files || []) {
    // We notify the assigned team user (internal NPC); finance partner gets in-portal indicators
    const recipient = f.assigned_team_user_id;
    if (!recipient) continue;

    // Finance clause T-5 / T-2
    const fcDays = daysFromToday(f.finance_clause_date);
    if (fcDays === 5) {
      if (await emit(recipient, 'purchase_file_finance_clause_t5',
        'Finance clause in 5 days', `${f.title || 'Purchase file'} finance clause expires in 5 days.`, f.id))
        results.finance_clause_t5++;
    }
    if (fcDays === 2) {
      if (await emit(recipient, 'purchase_file_finance_clause_t2',
        'Finance clause in 2 days', `${f.title || 'Purchase file'} finance clause expires in 2 days.`, f.id))
        results.finance_clause_t2++;
    }

    // Settlement T-7
    if (daysFromToday(f.settlement_date) === 7) {
      if (await emit(recipient, 'purchase_file_settlement_t7',
        'Settlement in 7 days', `${f.title || 'Purchase file'} settles in 7 days.`, f.id))
        results.settlement_t7++;
    }
  }

  // 2. Missing documents >48h
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { data: docs } = await supabase
    .from('document_requirement_instances')
    .select('id, purchase_file_id, label, requested_at, status, purchase_files!inner(id, title, assigned_team_user_id, archived_at)')
    .lt('requested_at', cutoff)
    .in('status', ['requested'])
    .is('purchase_files.archived_at', null);

  for (const d of (docs as any[]) || []) {
    const pf = d.purchase_files;
    if (!pf?.assigned_team_user_id) continue;
    if (await emit(pf.assigned_team_user_id, 'purchase_file_missing_docs_reminder',
      'Documents pending >48h',
      `Client still hasn't uploaded "${d.label}" for ${pf.title || 'purchase file'}.`,
      pf.id, { document_instance_id: d.id }))
      results.missing_docs_reminder++;
  }

  // 3. Valuations ordered >3d without returned_date
  const valCutoff = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
  const { data: vals } = await supabase
    .from('purchase_file_valuations')
    .select('id, purchase_file_id, valuer, ordered_date, returned_date, purchase_files!inner(id, title, assigned_team_user_id, archived_at)')
    .lt('ordered_date', valCutoff)
    .is('returned_date', null)
    .neq('status', 'cancelled')
    .is('purchase_files.archived_at', null);

  for (const v of (vals as any[]) || []) {
    const pf = v.purchase_files;
    if (!pf?.assigned_team_user_id) continue;
    if (await emit(pf.assigned_team_user_id, 'purchase_file_valuation_overdue',
      'Valuation outstanding >3 days',
      `Valuation by ${v.valuer || 'valuer'} for ${pf.title || 'purchase file'} has not returned.`,
      pf.id, { valuation_id: v.id }))
      results.valuation_overdue++;
  }

  // 4. Nudge runner — fire any due drip-sequence steps
  let nudgeResult: any = null;
  try {
    const r = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/finance-portal-nudges`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // AUTH-002: runner_tick authenticates via the dedicated
          // x-automation-secret; the service-role Bearer was redundant. Use the
          // anon key only for gateway routing.
          'x-automation-secret': expected || '',
          'apikey': Deno.env.get('SUPABASE_ANON_KEY') || '',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY') || ''}`,
        },
        body: JSON.stringify({ operation: 'runner_tick' }),
      },
    );
    nudgeResult = await r.json().catch(() => null);
  } catch (e) {
    console.error('[automations] nudge runner failed', e);
  }

  return json({ success: true, emitted: results, scanned_files: files?.length || 0, nudges: nudgeResult });
});
