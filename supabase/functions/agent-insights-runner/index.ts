// Aurixa Agent — Proactive Insights Runner (Phase 5)
// Runs on a cron (default: daily 06:00 AEST via pg_cron) and generates
// per-user briefings, anomaly alerts, and stale-deal reminders. Inserts
// rows into public.agent_insights_feed so the UI can surface them and
// pushes matching entries into public.notifications for the bell.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyAuth, createUnauthorizedResponse } from '../_shared/auth.ts';
import { requireModulePermission } from '../_shared/authz.ts';
import { csrfDenied, enforceCsrf } from '../_shared/csrfGuard.ts';
import { withRequestOrigin } from "../_shared/corsOrigin.ts";
import { internalError } from '../_shared/errorResponse.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

interface InsightDraft {
  user_id: string;
  kind: string;
  title: string;
  summary?: string;
  body_markdown?: string;
  severity?: 'info' | 'success' | 'warning' | 'critical';
  payload?: Record<string, unknown>;
  expires_at?: string;
}

async function upsertInsight(sb: any, draft: InsightDraft) {
  // avoid duplicates: same kind+title in last 24h
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: existing } = await sb.from('agent_insights_feed')
    .select('id').eq('user_id', draft.user_id).eq('kind', draft.kind).eq('title', draft.title)
    .gte('created_at', cutoff).maybeSingle();
  if (existing) return { skipped: true };
  const { error } = await sb.from('agent_insights_feed').insert({
    user_id: draft.user_id, kind: draft.kind, title: draft.title,
    summary: draft.summary ?? null, body_markdown: draft.body_markdown ?? null,
    severity: draft.severity ?? 'info', payload: draft.payload ?? {},
    source: 'insights-runner', expires_at: draft.expires_at ?? null,
  });
  if (error) return { error: error.message };
  // Notifications bell (best-effort)
  try {
    await sb.from('notifications').insert({
      target_user_id: draft.user_id, type: 'agent_insight',
      title: draft.title, message: draft.summary ?? draft.title,
      link: '/agent-insights', read: false,
    });
  } catch { /* best-effort */ }
  return { inserted: true };
}

async function runForUser(sb: any, userId: string) {
  const results: string[] = [];

  // 1. Stale deals (>7d without update) → warning
  const staleCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: staleDeals } = await sb.from('client_deals')
    .select('id, property_address, current_stage, updated_at, client_id')
    .eq('created_by', userId)
    .lt('updated_at', staleCutoff)
    .not('current_stage', 'in', '(settled,lost)')
    .limit(20);
  if (staleDeals && staleDeals.length) {
    const r = await upsertInsight(sb, {
      user_id: userId, kind: 'stale_deals', severity: 'warning',
      title: `${staleDeals.length} deal${staleDeals.length > 1 ? 's' : ''} sitting >7 days without an update`,
      summary: 'These need a nudge or a stage change.',
      body_markdown: staleDeals.map((d: any) => `- **${d.property_address || 'Untitled deal'}** — stage \`${d.current_stage}\` (last updated ${new Date(d.updated_at).toLocaleDateString('en-AU')})`).join('\n'),
      payload: { deal_ids: staleDeals.map((d: any) => d.id) },
    });
    if (r.inserted) results.push('stale_deals');
  }

  // 2. Overdue reminders → critical
  const nowIso = new Date().toISOString();
  const { data: overdue } = await sb.from('client_reminders')
    .select('id, title, due_date, client_id')
    .eq('user_id', userId).eq('status', 'pending').lt('due_date', nowIso).limit(15);
  if (overdue && overdue.length) {
    const r = await upsertInsight(sb, {
      user_id: userId, kind: 'overdue_reminders', severity: 'critical',
      title: `${overdue.length} reminder${overdue.length > 1 ? 's are' : ' is'} overdue`,
      summary: 'Clear these first — they were due before today.',
      body_markdown: overdue.map((r: any) => `- **${r.title}** — due ${new Date(r.due_date).toLocaleDateString('en-AU')}`).join('\n'),
      payload: { reminder_ids: overdue.map((r: any) => r.id) },
    });
    if (r.inserted) results.push('overdue_reminders');
  }

  // 3. Settlement countdown (next 14 days) → info
  const twoWeeks = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data: settling } = await sb.from('client_deals')
    .select('id, property_address, settlement_date, client_id')
    .eq('created_by', userId)
    .gte('settlement_date', nowIso).lte('settlement_date', twoWeeks).limit(10);
  if (settling && settling.length) {
    const r = await upsertInsight(sb, {
      user_id: userId, kind: 'settlement_countdown', severity: 'info',
      title: `${settling.length} settlement${settling.length > 1 ? 's' : ''} in the next 14 days`,
      body_markdown: settling.map((d: any) => `- **${d.property_address || 'Untitled deal'}** — settles ${new Date(d.settlement_date).toLocaleDateString('en-AU')}`).join('\n'),
      payload: { deal_ids: settling.map((d: any) => d.id) },
    });
    if (r.inserted) results.push('settlement_countdown');
  }

  // 4. Daily briefing (once per day) → info
  const briefCutoff = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();
  const { data: alreadyBriefed } = await sb.from('agent_insights_feed')
    .select('id').eq('user_id', userId).eq('kind', 'daily_briefing').gte('created_at', briefCutoff).maybeSingle();
  if (!alreadyBriefed) {
    const [{ count: activeClients }, { count: activeDeals }, { count: activeReminders }] = await Promise.all([
      sb.from('clients').select('id', { count: 'exact', head: true }).eq('assigned_user_id', userId).eq('status', 'active'),
      sb.from('client_deals').select('id', { count: 'exact', head: true }).eq('assigned_user_id', userId).not('stage', 'in', '(settled,lost)'),
      sb.from('client_reminders').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'pending'),
    ]);
    await upsertInsight(sb, {
      user_id: userId, kind: 'daily_briefing', severity: 'info',
      title: `Today's briefing`,
      summary: `${activeClients ?? 0} active clients · ${activeDeals ?? 0} live deals · ${activeReminders ?? 0} open reminders`,
      body_markdown: `Your book at a glance:\n- **${activeClients ?? 0}** active clients\n- **${activeDeals ?? 0}** live deals\n- **${activeReminders ?? 0}** open reminders\n\nAsk the Aurixa Agent anything about them.`,
      payload: { active_clients: activeClients, active_deals: activeDeals, active_reminders: activeReminders },
    });
    results.push('daily_briefing');
  }

  return results;
}

const __corsWrappedHandler = (async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  // This runner INSERTS into agent_insights_feed and notifications, and it
  // accepts a cookie-carried staff session through verifyAuth — so a
  // cross-site POST was a cookie-authenticated write. enforceCsrf lets
  // GET/HEAD/OPTIONS and header-only (no-cookie) callers through untouched,
  // so the pg_cron caller is unaffected.
  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(corsHeaders, csrf);
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  try {
    const body = await req.json().catch(() => ({}));
    const { error: authError, userId, authMethod } = await verifyAuth(sb, req.headers, body);
    if (authError) return createUnauthorizedResponse(authError, corsHeaders);

    const permission = await requireModulePermission(
      sb,
      { userId, authMethod },
      'agent',
      'can_view',
    );
    if (!permission.ok) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Human callers may refresh only their own feed. Verified service callers
    // retain the scheduled all-user sweep used by cron jobs.
    let userIds: string[] = [];
    if (authMethod !== 'service_role') {
      if (body.user_id && body.user_id !== userId) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      userIds = [userId!];
    } else if (body.user_id) userIds = [body.user_id];
    else {
      const { data: users } = await sb.from('custom_users').select('id').eq('is_active', true);
      userIds = (users || []).map((u: any) => u.id);
    }
    const summary: Record<string, string[]> = {};
    for (const uid of userIds) {
      try { summary[uid] = await runForUser(sb, uid); }
      catch (err: any) { summary[uid] = [`error:${err.message}`]; }
    }
    return new Response(JSON.stringify({ success: true, users: userIds.length, summary }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[agent-insights-runner] Error:', error);
    return new Response(JSON.stringify(internalError(error, 'agent-insights-runner')), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
