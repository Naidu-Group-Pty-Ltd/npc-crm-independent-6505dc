/**
 * Migration Job Status (Phase 2B)
 *
 * Superadmin-only read endpoint returning:
 *   - The full migration_jobs row(s)
 *   - Aggregate item status breakdown
 *   - Optionally the last N items (for live progress UI)
 *
 * Modes:
 *   - { job_id }       → single job + breakdown + recent items
 *   - { list: true }   → recent jobs across all domains
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

    if (body.workflow_stats) {
      const [legacyWf, newWf, mapped, enrollments, pending, succeeded, failed, blocked] = await Promise.all([
        supabase.from('ghl_workflow_snapshots').select('id', { count: 'exact', head: true }).eq('account', 'legacy'),
        supabase.from('ghl_workflow_snapshots').select('id', { count: 'exact', head: true }).eq('account', 'new'),
        supabase.from('ghl_id_mapping').select('id', { count: 'exact', head: true }).eq('resource_type', 'workflow'),
        supabase.from('ghl_contact_workflow_enrollments').select('id', { count: 'exact', head: true }).eq('account', 'legacy'),
        supabase.from('ghl_contact_workflow_enrollments').select('id', { count: 'exact', head: true }).eq('account', 'legacy').eq('re_enrollment_status', 'pending'),
        supabase.from('ghl_contact_workflow_enrollments').select('id', { count: 'exact', head: true }).eq('account', 'legacy').eq('re_enrollment_status', 'succeeded'),
        supabase.from('ghl_contact_workflow_enrollments').select('id', { count: 'exact', head: true }).eq('account', 'legacy').eq('re_enrollment_status', 'failed'),
        supabase.from('ghl_contact_workflow_enrollments').select('id', { count: 'exact', head: true }).eq('account', 'legacy').eq('re_enrollment_status', 'blocked'),
      ]);
      return new Response(JSON.stringify({
        success: true,
        workflow_stats: {
          legacyWorkflows: legacyWf.count || 0,
          newWorkflows: newWf.count || 0,
          matched: mapped.count || 0,
          enrollments: enrollments.count || 0,
          pending: pending.count || 0,
          succeeded: succeeded.count || 0,
          failed: failed.count || 0,
          blocked: blocked.count || 0,
        },
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (body.list) {
      const limit = Math.min(Number(body.limit) || 25, 100);
      const { data: jobs, error } = await supabase
        .from('migration_jobs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message);
      const enriched = (jobs || []).map((j: any) => annotateHealth(j));
      return new Response(JSON.stringify({ success: true, jobs: enriched }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const jobId = body.job_id;
    if (!jobId) {
      return new Response(JSON.stringify({ success: false, error: 'job_id or list=true required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: job, error: jobErr } = await supabase
      .from('migration_jobs')
      .select('*')
      .eq('id', jobId)
      .maybeSingle();
    if (jobErr) throw new Error(jobErr.message);
    if (!job) {
      return new Response(JSON.stringify({ success: false, error: 'Job not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Recent items (latest 50 by processed_at desc)
    const { data: items } = await supabase
      .from('migration_job_items')
      .select('source_id, target_id, entity_label, status, error_message, error_category, is_retryable, processed_at')
      .eq('job_id', jobId)
      .order('processed_at', { ascending: false, nullsFirst: false })
      .limit(50);

    // Status breakdown + error category breakdown
    const breakdown: Record<string, number> = { pending: 0, succeeded: 0, failed: 0, skipped: 0 };
    const errorCategories: Record<string, number> = {};
    let retryableFailures = 0;
    let nonRetryableFailures = 0;

    const { data: allItems } = await supabase
      .from('migration_job_items')
      .select('status, error_category, is_retryable')
      .eq('job_id', jobId);
    (allItems || []).forEach((i: any) => {
      breakdown[i.status] = (breakdown[i.status] || 0) + 1;
      if (i.status === 'failed') {
        const cat = i.error_category || 'unknown';
        errorCategories[cat] = (errorCategories[cat] || 0) + 1;
        if (i.is_retryable) retryableFailures++; else nonRetryableFailures++;
      }
    });

    // Optional: full failed-item dump for CSV export (capped at 5000)
    let failed_items: any[] | undefined;
    if (body.include_failed_items === true) {
      const { data: fails } = await supabase
        .from('migration_job_items')
        .select('source_id, target_id, entity_label, status, error_message, error_category, is_retryable, processed_at, attempts')
        .eq('job_id', jobId)
        .eq('status', 'failed')
        .order('processed_at', { ascending: false, nullsFirst: false })
        .limit(5000);
      failed_items = fails || [];
    }

    return new Response(
      JSON.stringify({
        success: true,
        job: annotateHealth(job),
        breakdown,
        error_categories: errorCategories,
        retryable_failures: retryableFailures,
        non_retryable_failures: nonRetryableFailures,
        recent_items: items || [],
        items: items || [], // back-compat with UI that reads `items`
        failed_items,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    console.error('[migration-job-status] error:', err);
    return new Response(JSON.stringify({ ...internalError(err, 'migration-job-status'), success: false }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

/**
 * Decorate a migration_jobs row with derived health fields used by the
 * dashboard health panel:
 *
 *   - heartbeat_age_seconds   – seconds since the worker last checked in
 *   - lease_expires_in_seconds – seconds until worker_lock_until expires
 *                                (negative ⇒ lease already expired)
 *   - is_stalled              – true if status='processing' AND either:
 *                                 • no heartbeat in the last 180s, OR
 *                                 • lease expired > 60s ago AND no recent
 *                                   completion update
 *                                Indicates a worker likely died without
 *                                calling finishJob/partialExit.
 *   - current_offset          – best-effort summary of resume_cursor for UI
 */
function annotateHealth(job: any): any {
  if (!job) return job;
  const now = Date.now();
  const hbAt = job.heartbeat_at ? new Date(job.heartbeat_at).getTime() : null;
  const leaseAt = job.worker_lock_until ? new Date(job.worker_lock_until).getTime() : null;
  const updAt = job.updated_at ? new Date(job.updated_at).getTime() : null;

  const heartbeatAge = hbAt ? Math.floor((now - hbAt) / 1000) : null;
  const leaseExpiresIn = leaseAt ? Math.floor((leaseAt - now) / 1000) : null;
  const updatedAge = updAt ? Math.floor((now - updAt) / 1000) : null;

  let isStalled = false;
  let stallReason: string | null = null;
  if (job.status === 'processing') {
    // Heartbeat older than 180s → almost certainly dead worker.
    if (heartbeatAge !== null && heartbeatAge > 180) {
      isStalled = true;
      stallReason = `No heartbeat for ${heartbeatAge}s`;
    } else if (leaseExpiresIn !== null && leaseExpiresIn < -60 && (updatedAge ?? 999) > 60) {
      // Lease expired more than a minute ago AND no progress updates →
      // worker died without releasing the lock or finishing the job.
      isStalled = true;
      stallReason = `Lease expired ${Math.abs(leaseExpiresIn)}s ago with no updates`;
    } else if (heartbeatAge === null && (updatedAge ?? 0) > 240) {
      // Never sent a heartbeat AND nothing else happened recently.
      isStalled = true;
      stallReason = `No heartbeat ever, idle for ${updatedAge}s`;
    }
  }

  let currentOffset: string | number | null = null;
  const cur = job.resume_cursor || {};
  if (typeof cur.offset === 'number') currentOffset = cur.offset;
  else if (cur.startAfterId) currentOffset = String(cur.startAfterId).substring(0, 12);
  else if (cur.nextPage) currentOffset = String(cur.nextPage).substring(0, 12);

  if (isStalled) {
    console.warn(
      `[migration-job-status] STALLED job=${job.id} domain=${job.domain} ` +
      `processed=${job.processed_items}/${job.total_items} reason="${stallReason}"`,
    );
  }

  return {
    ...job,
    heartbeat_age_seconds: heartbeatAge,
    lease_expires_in_seconds: leaseExpiresIn,
    updated_age_seconds: updatedAge,
    is_stalled: isStalled,
    stall_reason: stallReason,
    current_offset: currentOffset,
  };
}
