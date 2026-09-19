/**
 * Finance Portal — Briefing Runner
 *
 * Triggered by pg_cron twice a day:
 *   - mode=morning  (07:00 Sydney): triage briefing for the day ahead
 *   - mode=eod      (17:00 Sydney): end-of-day wrap of what moved
 *
 * For each active partner, computes a personalised briefing and writes an
 * in-app notification (which is also routed through the existing notify
 * helper so per-user channel prefs/quiet hours apply).
 *
 * Auth: signed pg_cron requests only — no portal session token.
 */
import { createClient } from "npm:@supabase/supabase-js@2.55.0";

import { createCorsHeaders as __createCorsHeaders } from "../_shared/auth.ts";
import { enforceJsonBodyLimit, verifySignedInternal } from "../_shared/requestSecurity.ts";
import { internalError } from '../_shared/errorResponse.ts';
// Dynamic per-request CORS — frontend uses `credentials: 'include'`, so ACAO must
// echo the request Origin (never `*`) with `Allow-Credentials: true`.
const corsHeaderDefaults: Record<string, string> = {
  ...__createCorsHeaders(null),
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-cron-secret',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};
function jsonWithHeaders(d: any, responseCorsHeaders: Record<string, string>, s = 200) {
  return new Response(JSON.stringify(d), { status: s, headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' } });
}

function addDays(iso: string, n: number) {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function todaySydney() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

Deno.serve(async (req) => {
  const corsHeaders = { ...__createCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Headers': corsHeaderDefaults['Access-Control-Allow-Headers'], 'Access-Control-Expose-Headers': corsHeaderDefaults['Access-Control-Expose-Headers'] };
  const json = (data: any, status = 200) => jsonWithHeaders(data, corsHeaders, status);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    if (!verifyRequiredCronSecret(CRON_SECRET, req.headers.get('x-cron-secret'))) {
      return json({ error: 'unauthorized' }, 401);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const parsed = await enforceJsonBodyLimit<Record<string, unknown>>(req, 1024);
    if (!parsed.ok) return parsed.error;
    const auth = await verifySignedInternal(supabase, req, parsed.raw, ['pg_cron']);
    if (!auth.ok) return json({ error: 'Unauthorized' }, 401);

    const body = parsed.value;
    const mode: 'morning' | 'eod' = body.mode === 'eod' ? 'eod' : 'morning';
    const today = todaySydney();
    const in3 = addDays(today, 3);
    const in7 = addDays(today, 7);

    // All active partners
    const { data: partners } = await supabase
      .from('finance_portal_users')
      .select('id, finance_contact_id, email, last_briefing_sent_at, last_eod_sent_at, last_seen_at')
      .eq('is_active', true)
      .is('revoked_at', null);

    const results: any[] = [];
    for (const p of partners || []) {
      // Dedup: max once per calendar day per mode
      const sentField = mode === 'morning' ? p.last_briefing_sent_at : p.last_eod_sent_at;
      if (sentField) {
        const sentDay = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(new Date(sentField));
        if (sentDay === today) { results.push({ partner: p.id, skipped: 'already_sent' }); continue; }
      }

      // Assigned clients
      const { data: assignments } = await supabase
        .from('finance_portal_client_assignments')
        .select('client_id')
        .eq('finance_user_id', p.id);
      const clientIds = Array.from(new Set((assignments || []).map((a: any) => a.client_id))).filter(Boolean);
      if (clientIds.length === 0) { results.push({ partner: p.id, skipped: 'no_clients' }); continue; }

      const { data: pfs } = await supabase
        .from('purchase_files')
        .select('id, title, client_id, finance_status, finance_clause_date, settlement_date, risk_level, updated_at')
        .in('client_id', clientIds);

      const stats = {
        total: pfs?.length || 0,
        at_risk: (pfs || []).filter((f: any) => f.risk_level === 'high' || f.risk_level === 'critical').length,
        finance_clause_3d: (pfs || []).filter((f: any) => f.finance_clause_date && f.finance_clause_date <= in3 && f.finance_clause_date >= today).length,
        finance_clause_7d: (pfs || []).filter((f: any) => f.finance_clause_date && f.finance_clause_date <= in7 && f.finance_clause_date >= today).length,
        settlement_7d: (pfs || []).filter((f: any) => f.settlement_date && f.settlement_date <= in7 && f.settlement_date >= today).length,
        moved_24h: (pfs || []).filter((f: any) => f.updated_at && (Date.now() - new Date(f.updated_at).getTime()) < 86400000).length,
      };

      // Inbound messages last 24h
      const since24 = new Date(Date.now() - 86400000).toISOString();
      const { count: msgCount } = await supabase
        .from('finance_portal_messages')
        .select('id', { count: 'exact', head: true })
        .in('client_id', clientIds)
        .neq('sender_type', 'finance_partner')
        .gt('created_at', since24);

      let title: string;
      let bodyMd: string;
      if (mode === 'morning') {
        const lines: string[] = [];
        if (stats.finance_clause_3d > 0) lines.push(`🔴 ${stats.finance_clause_3d} finance clause within 3 days`);
        else if (stats.finance_clause_7d > 0) lines.push(`🟡 ${stats.finance_clause_7d} finance clause this week`);
        if (stats.settlement_7d > 0) lines.push(`📅 ${stats.settlement_7d} settling this week`);
        if (stats.at_risk > 0) lines.push(`⚠️ ${stats.at_risk} flagged at risk`);
        if (msgCount && msgCount > 0) lines.push(`💬 ${msgCount} unread message${msgCount === 1 ? '' : 's'} overnight`);
        if (lines.length === 0) lines.push('No urgent items today — focus on pipeline development.');
        title = `Good morning — ${stats.total} active file${stats.total === 1 ? '' : 's'}`;
        bodyMd = lines.join('\n');
      } else {
        const lines: string[] = [];
        lines.push(`${stats.moved_24h} file${stats.moved_24h === 1 ? '' : 's'} updated today`);
        if (msgCount && msgCount > 0) lines.push(`${msgCount} message${msgCount === 1 ? '' : 's'} from clients`);
        if (stats.finance_clause_3d > 0) lines.push(`⏰ ${stats.finance_clause_3d} clause${stats.finance_clause_3d === 1 ? '' : 's'} due in next 3 days`);
        if (lines.length === 1 && stats.moved_24h === 0) lines.push('Quiet day — see you tomorrow.');
        title = `Day wrap — ${new Date().toLocaleDateString('en-AU', { weekday: 'long' })}`;
        bodyMd = lines.join('\n');
      }

      // Direct in-app notification (bypass per-event quiet hours; this is itself a digest)
      const { error: notificationError } = await supabase.from('finance_portal_notifications').insert({
        portal_user_id: p.id,
        notification_type: mode === 'morning' ? 'morning_briefing' : 'eod_wrap',
        title,
        body: bodyMd,
        link_path: '/finance',
        metadata: { stats, mode, generated_at: new Date().toISOString() },
      });
      if (notificationError) {
        console.error('[finance-portal-briefing-runner] notification insert failed', notificationError.message);
        results.push({ partner: p.id, sent: false, error: 'notification_failed' });
        continue;
      }

      // Mark sent
      const { error: sentStateError } = await supabase
        .from('finance_portal_users')
        .update({
          [mode === 'morning' ? 'last_briefing_sent_at' : 'last_eod_sent_at']: new Date().toISOString(),
        })
        .eq('id', p.id);
      if (sentStateError) {
        console.error('[finance-portal-briefing-runner] sent-state update failed', sentStateError.message);
        results.push({ partner: p.id, sent: false, error: 'state_update_failed' });
        continue;
      }

      results.push({ partner: p.id, stats, sent: true });
    }

    return json({ mode, processed: results.length, results });
  } catch (e: any) {
    return json({ ...internalError(e, 'finance-portal-briefing-runner') }, 500);
  }
});
