import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyAuth, createUnauthorizedResponse, createCorsHeaders } from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
interface ActivityLogsRequest {
  session_token?: string;
  action_filter?: string | string[];
  entity_filter?: string | string[];
  user_filter?: string | string[];
  start_date?: string; // ISO
  end_date?: string;   // ISO
  page?: number;       // 1-based
  page_size?: number;
  limit?: number;      // legacy fallback (no pagination)
  include_stats?: boolean;
}

const FAILURE_ACTIONS = new Set([
  'report_deleted','comparison_deleted','cash_flow_deleted','qa_conversation_deleted',
  'automation_switch_deleted','template_deleted','branding_profile_deleted','user_deactivated',
  'password_reset_initiated','client_deleted','client_file_deleted','deal_deleted',
  'appointment_deleted','checklist_deleted','alert_rule_deleted',
]);

function toArray(v: string | string[] | undefined): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(x => x && x !== 'all');
  if (v === 'all') return [];
  return [v];
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: ActivityLogsRequest = await req.json();
    const {
      action_filter,
      entity_filter,
      user_filter,
      start_date,
      end_date,
      page,
      page_size,
      limit,
      include_stats,
    } = body;

    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      return createUnauthorizedResponse(authError, corsHeaders);
    }

    const { data: userData, error: userError } = await supabase
      .from('custom_users')
      .select('id, username, role')
      .eq('id', userId)
      .single();

    if (userError || !userData) {
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: userRoles } = await supabase
      .from('user_roles').select('role').eq('user_id', userId);
    const roles = userRoles?.map(r => r.role) || [];
    const isAdmin = roles.includes('superadmin') || roles.includes('admin')
      || userData.role === 'superadmin' || userData.role === 'admin';

    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Access denied. Admin privileges required.' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const actions = toArray(action_filter);
    const entities = toArray(entity_filter);
    const users = toArray(user_filter);

    const applyFilters = (q: any) => {
      if (actions.length === 1) q = q.eq('action_type', actions[0]);
      else if (actions.length > 1) q = q.in('action_type', actions);
      if (entities.length === 1) q = q.eq('entity_type', entities[0]);
      else if (entities.length > 1) q = q.in('entity_type', entities);
      if (users.length === 1) q = q.eq('username', users[0]);
      else if (users.length > 1) q = q.in('username', users);
      if (start_date) q = q.gte('created_at', start_date);
      if (end_date) q = q.lte('created_at', end_date);
      return q;
    };

    let query = applyFilters(
      supabase.from('activity_logs').select('*', { count: 'exact' }).order('created_at', { ascending: false })
    );

    if (typeof page === 'number' && typeof page_size === 'number' && page_size > 0) {
      const from = (Math.max(1, page) - 1) * page_size;
      const to = from + page_size - 1;
      query = query.range(from, to);
    } else {
      query = query.limit(limit ?? 500);
    }

    const { data: logs, error: logsError, count } = await query;

    if (logsError) {
      console.error('[get-activity-logs] Error fetching logs:', logsError);
      return new Response(JSON.stringify({ error: logsError.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Unique usernames (unfiltered) for the dropdown
    const { data: userRows } = await supabase
      .from('activity_logs')
      .select('username')
      .not('username', 'is', null)
      .order('username', { ascending: true })
      .limit(2000);
    const uniqueUsers = [...new Set((userRows || []).map(r => r.username).filter(Boolean))];

    // Stats over filtered range (capped sample for performance)
    let stats: any = null;
    if (include_stats !== false) {
      const { data: sample } = await applyFilters(
        supabase.from('activity_logs')
          .select('action_type, username, created_at')
          .order('created_at', { ascending: false })
      ).limit(5000);

      const rows = sample || [];
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const todayIso = startOfToday.toISOString();

      let eventsToday = 0;
      const userSet = new Set<string>();
      const actionCounts = new Map<string, number>();
      let failures = 0;

      for (const r of rows as any[]) {
        if (r.created_at >= todayIso) eventsToday++;
        if (r.username) userSet.add(r.username);
        if (r.action_type) {
          actionCounts.set(r.action_type, (actionCounts.get(r.action_type) || 0) + 1);
          if (FAILURE_ACTIONS.has(r.action_type)) failures++;
        }
      }

      let topAction: { type: string; count: number } | null = null;
      for (const [type, c] of actionCounts) {
        if (!topAction || c > topAction.count) topAction = { type, count: c };
      }

      stats = {
        eventsToday,
        uniqueUsers: userSet.size,
        topAction,
        failures,
        sampleSize: rows.length,
        sampleCapped: rows.length >= 5000,
      };
    }

    return new Response(
      JSON.stringify({
        success: true,
        logs: logs || [],
        uniqueUsers,
        total: count ?? (logs?.length ?? 0),
        stats,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[get-activity-logs] Unexpected error:', error);
    return new Response(JSON.stringify(internalError(error, 'get-activity-logs')), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
