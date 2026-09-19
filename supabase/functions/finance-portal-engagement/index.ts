/**
 * Finance Portal — Engagement
 *
 * Powers the daily-habit-loop UX:
 *   - mark_seen       : update last_seen_at + bump today's activity counter
 *   - get_engagement  : streak, badges, "what's changed since last visit"
 *
 * Auth: standard finance portal session token.
 */
import { createClient } from "npm:@supabase/supabase-js@2.55.0";
import { hasFinancePortalPermission } from "../_shared/finance-portal-permissions.ts";

import { createCorsHeaders as __createCorsHeaders } from "../_shared/auth.ts";
import { internalError } from '../_shared/errorResponse.ts';
import { extractFinanceSessionToken } from '../_shared/financeSessionToken.ts';
// Dynamic per-request CORS — frontend uses `credentials: 'include'`, so ACAO must
// echo the request Origin (never `*`) with `Allow-Credentials: true`.
const corsHeaderDefaults: Record<string, string> = {
  ...__createCorsHeaders(null),
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-finance-session-token, x-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

function jsonWithHeaders(data: any, responseCorsHeaders: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
  });
}
// Delegates to the ONE cookie-aware reader. The local body used to read only
// the header and the request body, so a portal whose session lives in the
// HttpOnly `__Host-finance_session_token` cookie (WP-11B/C) got a 401 on
// every call once its in-memory token was lost to a page load.
function extractToken(headers: Headers, body?: any): string | null {
  return extractFinanceSessionToken(headers, body as Record<string, unknown> | undefined);
}
function sydneyToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}
function daysBetween(a: string, b: string): number {
  return Math.round((new Date(a + 'T00:00:00Z').getTime() - new Date(b + 'T00:00:00Z').getTime()) / 86400000);
}

const BADGE_RULES: { key: string; min: number; label: string }[] = [
  { key: 'streak_3', min: 3, label: '3-day streak' },
  { key: 'streak_5', min: 5, label: '5-day streak' },
  { key: 'streak_10', min: 10, label: '10-day streak' },
  { key: 'streak_20', min: 20, label: '20-day streak' },
  { key: 'streak_50', min: 50, label: '50-day streak' },
];

Deno.serve(async (req) => {
  const corsHeaders = { ...__createCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Headers': corsHeaderDefaults['Access-Control-Allow-Headers'], 'Access-Control-Expose-Headers': corsHeaderDefaults['Access-Control-Expose-Headers'] };
  const json = (data: any, status = 200) => jsonWithHeaders(data, corsHeaders, status);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({}));
    const sessionToken = extractToken(req.headers, body);
    if (!sessionToken) return json({ error: 'Session token required' }, 401);

    const { data: portalUser } = await supabase
      .from('finance_portal_users')
      .select('id, finance_contact_id, email, last_seen_at, is_active, revoked_at, session_expires_at, global_permissions')
      .eq('session_token', sessionToken)
      .maybeSingle();

    if (!portalUser || !portalUser.is_active || portalUser.revoked_at) {
      return json({ error: 'Invalid session' }, 401);
    }
    if (!portalUser.session_expires_at || new Date(portalUser.session_expires_at) < new Date()) {
      return json({ error: 'Session expired' }, 401);
    }
    const partnerId = portalUser.finance_contact_id;
    const portalUserId = portalUser.id;
    const previousSeenAt = portalUser.last_seen_at as string | null;
    const operation = body.operation || 'get_engagement';

    // ───────── mark_seen ─────────
    if (operation === 'mark_seen') {
      const today = sydneyToday();
      await supabase.rpc('bump_finance_partner_activity', { _contact_id: partnerId });
      await supabase
        .from('finance_portal_users')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', portalUserId);
      return json({ ok: true, today });
    }

    // ───────── get_engagement ─────────
    if (operation === 'get_engagement') {
      // Activity log → streak
      const { data: activity } = await supabase
        .from('finance_partner_daily_activity')
        .select('activity_date, action_count')
        .eq('finance_contact_id', partnerId)
        .order('activity_date', { ascending: false })
        .limit(120);

      const today = sydneyToday();
      const dateSet = new Set((activity || []).map((r: any) => r.activity_date));
      let streak = 0;
      // Allow today-not-yet-counted by starting at yesterday if today missing
      let cursor = today;
      if (!dateSet.has(today)) {
        const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1);
        cursor = d.toISOString().slice(0, 10);
      }
      while (dateSet.has(cursor)) {
        streak += 1;
        const d = new Date(cursor + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1);
        cursor = d.toISOString().slice(0, 10);
      }

      // Active days last 7 / 30
      const days7 = (activity || []).filter((r: any) => daysBetween(today, r.activity_date) < 7).length;
      const days30 = (activity || []).filter((r: any) => daysBetween(today, r.activity_date) < 30).length;

      // Award streak badges (idempotent)
      const earnable = BADGE_RULES.filter(r => streak >= r.min);
      if (earnable.length > 0) {
        await supabase
          .from('finance_partner_engagement_badges')
          .upsert(
            earnable.map(r => ({
              finance_contact_id: partnerId,
              badge_key: r.key,
              metadata: { streak, label: r.label, awarded_for: 'streak' },
            })),
            { onConflict: 'finance_contact_id,badge_key', ignoreDuplicates: true },
          );
      }
      const { data: badges } = await supabase
        .from('finance_partner_engagement_badges')
        .select('badge_key, earned_at, metadata')
        .eq('finance_contact_id', partnerId)
        .order('earned_at', { ascending: false });

      // ── What's changed since last visit ──
      const sinceIso = previousSeenAt || new Date(Date.now() - 24 * 3600_000).toISOString();
      const sinceTs = new Date(sinceIso).getTime();

      // Assigned clients
      const { data: assignments } = await supabase
        .from('finance_portal_client_assignments')
        .select('client_id, purchase_file_id, permissions')
        .eq('finance_user_id', portalUserId);

      const purchaseFileAssignments = (assignments || []).filter((assignment: any) =>
        hasFinancePortalPermission(
          portalUser.global_permissions,
          assignment.permissions,
          'purchase_files',
          'view',
          true,
        )
      );
      const clientIds = Array.from(new Set(purchaseFileAssignments
        .filter((assignment: any) => !assignment.purchase_file_id)
        .map((assignment: any) => assignment.client_id)))
        .filter(Boolean);
      const assignedPfIds = Array.from(new Set(purchaseFileAssignments
        .map((assignment: any) => assignment.purchase_file_id)))
        .filter(Boolean);

      // A null purchase_file_id grants client-wide access; otherwise the assignment
      // is restricted to the explicitly linked purchase file.
      const [{ data: clientPfs }, { data: assignedPfs }] = await Promise.all([
        clientIds.length
          ? supabase
              .from('purchase_files')
              .select('id, title, client_id, finance_status, updated_at, created_at')
              .in('client_id', clientIds)
          : Promise.resolve({ data: [] as any[] }),
        assignedPfIds.length
          ? supabase
              .from('purchase_files')
              .select('id, title, client_id, finance_status, updated_at, created_at')
              .in('id', assignedPfIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      const pfs = Array.from(new Map(
        [...(clientPfs || []), ...(assignedPfs || [])].map((pf: any) => [pf.id, pf]),
      ).values());
      const pfIds = (pfs || []).map((p: any) => p.id);
      const pfById = new Map((pfs || []).map((p: any) => [p.id, p]));
      const documentPfIds = pfs
        .filter((pf: any) => purchaseFileAssignments.some((assignment: any) =>
          assignment.client_id === pf.client_id
          && (!assignment.purchase_file_id || assignment.purchase_file_id === pf.id)
          && hasFinancePortalPermission(
            portalUser.global_permissions,
            assignment.permissions,
            'documents',
            'view',
            true,
          )
        ))
        .map((pf: any) => pf.id);
      const documentPfIdSet = new Set(documentPfIds);

      const changed: Array<{ type: string; label: string; link?: string; at: string }> = [];

      // New PFs
      for (const pf of pfs || []) {
        if (new Date(pf.created_at).getTime() > sinceTs) {
          changed.push({
            type: 'pf_created',
            label: `New file opened — ${pf.title}`,
            link: `/finance/purchase-files/${pf.id}`,
            at: pf.created_at,
          });
        }
      }

      if (pfIds.length) {
        // PF activity feed (status, decisions, conditions, docs, etc.)
        const { data: events } = await supabase
          .from('purchase_file_activity_feed')
          .select('purchase_file_id, event_type, to_value, source, created_at')
          .in('purchase_file_id', pfIds)
          .gt('created_at', sinceIso)
          .order('created_at', { ascending: false })
          .limit(30);
        for (const ev of events || []) {
          if (ev.source === 'document' && !documentPfIdSet.has(ev.purchase_file_id)) continue;
          const pf: any = pfById.get(ev.purchase_file_id);
          const verb = String(ev.event_type || 'updated').replace(/_/g, ' ');
          const value = ev.to_value ? ` → ${String(ev.to_value).replace(/_/g, ' ')}` : '';
          changed.push({
            type: ev.event_type || 'activity',
            label: `${pf?.title || 'File'}: ${verb}${value}`,
            link: `/finance/purchase-files/${ev.purchase_file_id}`,
            at: ev.created_at,
          });
        }
      }

      if (documentPfIds.length) {
        const { data: docs } = await supabase
          .from('finance_portal_documents')
          .select('id, original_filename, purchase_file_id, created_at')
          .in('purchase_file_id', documentPfIds)
          .is('deleted_at', null)
          .gt('created_at', sinceIso)
          .order('created_at', { ascending: false })
          .limit(20);
        for (const d of docs || []) {
          const pf: any = pfById.get(d.purchase_file_id);
          changed.push({
            type: 'document_uploaded',
            label: `Document uploaded — ${d.original_filename || 'file'} (${pf?.title || ''})`,
            link: `/finance/purchase-files/${d.purchase_file_id}`,
            at: d.created_at,
          });
        }
      }

      // Client-level messages cannot be safely attributed to a deal-scoped assignment.
      const messageClientIds = Array.from(new Set((assignments || [])
        .filter((assignment: any) =>
          !assignment.purchase_file_id
          && hasFinancePortalPermission(
            portalUser.global_permissions,
            assignment.permissions,
            'messages',
            'view',
            true,
          )
        )
        .map((assignment: any) => assignment.client_id)))
        .filter(Boolean);
      if (messageClientIds.length) {
        const { data: msgs } = await supabase
          .from('finance_portal_messages')
          .select('id, client_id, sender_type, created_at')
          .in('client_id', messageClientIds)
          .neq('sender_type', 'finance_partner')
          .gt('created_at', sinceIso)
          .order('created_at', { ascending: false })
          .limit(20);
        for (const m of msgs || []) {
          changed.push({
            type: 'message',
            label: `New ${m.sender_type === 'client' ? 'client' : 'team'} message`,
            link: `/finance/messages`,
            at: m.created_at,
          });
        }
      }

      changed.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

      return json({
        previous_seen_at: previousSeenAt,
        streak,
        active_days_7: days7,
        active_days_30: days30,
        badges: badges || [],
        what_changed: changed.slice(0, 12),
      });
    }

    return json({ error: `Unknown operation: ${operation}` }, 400);
  } catch (e: any) {
    return json({ ...internalError(e, 'finance-portal-engagement') }, 500);
  }
});
