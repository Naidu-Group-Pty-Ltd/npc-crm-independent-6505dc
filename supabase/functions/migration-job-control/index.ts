/**
 * Migration Job Control (Phase 2D)
 *
 * Superadmin-only endpoint for granular control of in-flight migration jobs.
 *
 * Body:
 *   { job_id: uuid, action: 'pause' | 'resume' | 'cancel' | 'kill' }
 *
 * Behavior:
 *   - pause   → sets control_signal='pause' + auto_resume=false. Worker
 *               (if running) writes its current page, releases lease, exits.
 *               Dispatcher will NOT re-claim while paused.
 *   - resume  → clears signal, re-enables auto_resume, releases lease,
 *               re-opens status. Dispatcher picks it up on the next tick (≤15s).
 *   - cancel  → graceful: signal='cancel', worker finishes current item,
 *               then calls finishJob('cancelled') and exits.
 *   - kill    → immediate: signal='kill', worker drops the next page entirely
 *               on its next signal check, then finishJob('cancelled').
 *
 * Workers poll `read_migration_control_signal` between pages.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import {
  verifyAuth,
  createCorsHeaders,
  createUnauthorizedResponse,
  createForbiddenResponse,
} from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
type Action = 'pause' | 'resume' | 'cancel' | 'kill';
const VALID_ACTIONS: Action[] = ['pause', 'resume', 'cancel', 'kill'];

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
    if (authError || !userId) {
      return createUnauthorizedResponse(authError || 'Authentication required', corsHeaders);
    }

    if (userId !== 'service_role') {
      const { data: roleRows } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId);
      const isSuperadmin = (roleRows || []).some((r: any) => r.role === 'superadmin');
      if (!isSuperadmin) {
        return createForbiddenResponse('Superadmin access required', corsHeaders);
      }
    }

    const jobId = String(body.job_id || '').trim();
    const action = String(body.action || '').trim() as Action;

    if (!jobId) {
      return jsonError(corsHeaders, 'job_id is required', 400);
    }
    if (!VALID_ACTIONS.includes(action)) {
      return jsonError(corsHeaders, `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}`, 400);
    }

    // Verify the job exists
    const { data: job, error: jobErr } = await supabase
      .from('migration_jobs')
      .select('id, status, domain, source_account, target_account')
      .eq('id', jobId)
      .maybeSingle();
    if (jobErr) throw new Error(jobErr.message);
    if (!job) return jsonError(corsHeaders, 'Job not found', 404);

    let rpcName: string;
    let rpcArgs: Record<string, any>;
    let messageVerb: string;

    switch (action) {
      case 'pause':
        rpcName = 'pause_migration_job';
        rpcArgs = { p_job_id: jobId };
        messageVerb = 'paused';
        break;
      case 'resume':
        rpcName = 'resume_migration_job';
        rpcArgs = { p_job_id: jobId };
        messageVerb = 'resumed';
        break;
      case 'cancel':
        rpcName = 'cancel_migration_job';
        rpcArgs = { p_job_id: jobId, p_immediate: false };
        messageVerb = 'cancelled (graceful)';
        break;
      case 'kill':
        rpcName = 'cancel_migration_job';
        rpcArgs = { p_job_id: jobId, p_immediate: true };
        messageVerb = 'killed (immediate)';
        break;
    }

    const { error: rpcErr } = await supabase.rpc(rpcName, rpcArgs);
    if (rpcErr) {
      console.error(`[migration-job-control] ${rpcName} failed:`, rpcErr.message);
      throw new Error(rpcErr.message);
    }

    // If resuming, fire the dispatcher immediately so the user doesn't wait
    // for the next cron tick (~15s).
    if (action === 'resume') {
      const dispatchUrl = `${supabaseUrl}/functions/v1/migration-dispatcher`;
      const _anon = (Deno.env.get('SUPABASE_ANON_KEY') || '').trim();
      const _internalSecret = (Deno.env.get('INTERNAL_EDGE_SECRET') || '').trim();
      fetch(dispatchUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // AUTH-002: internal secret, not the service-role key.
          Authorization: `Bearer ${_anon}`,
          ...(_internalSecret ? { 'x-internal-edge-secret': _internalSecret } : {}),
          'x-internal-call': 'true',
        },
        body: JSON.stringify({ _triggered_by: 'migration-job-control:resume' }),
      }).catch((e) => console.error('[migration-job-control] dispatcher kick failed:', e?.message));
    }

    console.log(`[migration-job-control] job=${jobId} action=${action} by=${userId}`);

    // Read the latest row to return to the client
    const { data: updatedJob } = await supabase
      .from('migration_jobs')
      .select('*')
      .eq('id', jobId)
      .maybeSingle();

    return new Response(
      JSON.stringify({
        success: true,
        job_id: jobId,
        action,
        message: `Migration job ${messageVerb}`,
        job: updatedJob,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    console.error('[migration-job-control] error:', err);
    return jsonError(corsHeaders, err.message || 'Internal error', 500);
  }
});

function jsonError(corsHeaders: Record<string, string>, message: string, status: number) {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
