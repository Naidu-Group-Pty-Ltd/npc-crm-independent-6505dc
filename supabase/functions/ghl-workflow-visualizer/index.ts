/**
 * GHL Workflow Visualizer
 *
 * Superadmin-only read/write endpoint for the manual workflow-rebuild console.
 *
 * Actions:
 *   - { action: 'list' }                              → all snapshots from both
 *                                                       accounts + every
 *                                                       workflow id-mapping
 *                                                       row, plus per-legacy
 *                                                       enrollment counts.
 *   - { action: 'save_notes', id, notes }             → upsert rebuild_notes
 *   - { action: 'mark_done', id, done: bool }         → toggle rebuild_marked_done_at
 *   - { action: 'link', old_ghl_id, new_ghl_id, note? } → manually link legacy→new
 *   - { action: 'unlink', old_ghl_id }                → remove a workflow mapping
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import {
  verifyAuth,
  createCorsHeaders,
  createUnauthorizedResponse,
  createForbiddenResponse,
} from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
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

    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError || !userId) return createUnauthorizedResponse(authError || 'Authentication required', corsHeaders);

    if (userId !== 'service_role') {
      const { data: roleRows } = await supabase.from('user_roles').select('role').eq('user_id', userId);
      const isSuperadmin = (roleRows || []).some((r: any) => r.role === 'superadmin');
      if (!isSuperadmin) return createForbiddenResponse('Superadmin access required', corsHeaders);
    }

    const action = String(body.action || 'list');

    if (action === 'list') {
      const [snapsRes, mapsRes, enrollAgg] = await Promise.all([
        supabase.from('ghl_workflow_snapshots')
          .select('id, account, workflow_id, location_id, name, status, version, raw_json, last_seen_at, fetched_at, rebuild_notes, rebuild_marked_done_at, rebuild_marked_done_by, rebuild_blueprint')
          .order('account', { ascending: true })
          .order('name', { ascending: true })
          .limit(2000),
        supabase.from('ghl_id_mapping')
          .select('old_ghl_id, new_ghl_id, source_account_label, target_account_label, match_confidence, notes, remapped_at')
          .eq('resource_type', 'workflow')
          .limit(2000),
        // enrollment counts grouped by legacy workflow_id
        supabase.from('ghl_contact_workflow_enrollments')
          .select('workflow_id, re_enrollment_status')
          .eq('account', 'legacy')
          .limit(50000),
      ]);

      if (snapsRes.error) throw new Error('snapshots: ' + snapsRes.error.message);
      if (mapsRes.error) throw new Error('mappings: ' + mapsRes.error.message);

      // aggregate enrollment counts
      const enrollCounts: Record<string, { total: number; pending: number; succeeded: number; failed: number; blocked: number }> = {};
      for (const row of (enrollAgg.data || [])) {
        const wid = String(row.workflow_id);
        const e = enrollCounts[wid] = enrollCounts[wid] || { total: 0, pending: 0, succeeded: 0, failed: 0, blocked: 0 };
        e.total++;
        const s = String(row.re_enrollment_status || 'pending');
        if (s === 'pending' || s === 'succeeded' || s === 'failed' || s === 'blocked') (e as any)[s]++;
      }

      return new Response(JSON.stringify({
        success: true,
        snapshots: snapsRes.data || [],
        mappings: mapsRes.data || [],
        enrollment_counts: enrollCounts,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'save_notes') {
      const id = String(body.id || '');
      if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: corsHeaders });
      const { error } = await supabase.from('ghl_workflow_snapshots')
        .update({ rebuild_notes: body.notes ?? null }).eq('id', id);
      if (error) throw new Error(error.message);
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'save_blueprint') {
      const id = String(body.id || '');
      if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: corsHeaders });
      const { error } = await supabase.from('ghl_workflow_snapshots')
        .update({ rebuild_blueprint: body.blueprint ?? null }).eq('id', id);
      if (error) throw new Error(error.message);
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'mark_done') {
      const id = String(body.id || '');
      if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: corsHeaders });
      const done = body.done !== false;
      const { error } = await supabase.from('ghl_workflow_snapshots')
        .update({
          rebuild_marked_done_at: done ? new Date().toISOString() : null,
          rebuild_marked_done_by: done && userId !== 'service_role' ? userId : null,
        }).eq('id', id);
      if (error) throw new Error(error.message);
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'link') {
      const oldId = String(body.old_ghl_id || '');
      const newId = String(body.new_ghl_id || '');
      if (!oldId || !newId) {
        return new Response(JSON.stringify({ error: 'old_ghl_id and new_ghl_id required' }), { status: 400, headers: corsHeaders });
      }
      const { error } = await supabase.from('ghl_id_mapping').upsert({
        resource_type: 'workflow',
        old_ghl_id: oldId,
        new_ghl_id: newId,
        source_account_label: 'legacy',
        target_account_label: 'new',
        match_confidence: 'high',
        notes: body.note || 'Manually linked via Workflow Visualizer',
        remapped_at: new Date().toISOString(),
      }, { onConflict: 'resource_type,old_ghl_id' });
      if (error) throw new Error(error.message);
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'unlink') {
      const oldId = String(body.old_ghl_id || '');
      if (!oldId) return new Response(JSON.stringify({ error: 'old_ghl_id required' }), { status: 400, headers: corsHeaders });
      const { error } = await supabase.from('ghl_id_mapping')
        .delete().eq('resource_type', 'workflow').eq('old_ghl_id', oldId);
      if (error) throw new Error(error.message);
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[workflow-visualizer] error:', err);
    return new Response(JSON.stringify(internalError(err, 'ghl-workflow-visualizer')), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
