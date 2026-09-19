/**
 * GHL Legacy Account Wipe — Orchestrator
 *
 * Superadmin-only entry point that:
 *   1. Validates a typed confirmation token (live runs only)
 *   2. Probes legacy credentials (must have delete-capable scopes)
 *   3. Creates a `legacy_wipe_jobs` row (rejecting overlap with active jobs)
 *   4. Asynchronously dispatches `ghl-legacy-wipe-worker`
 *   5. Returns the job_id so the dashboard can poll status
 *
 * Body: { dry_run?: boolean, confirmation?: string }
 *   dry_run defaults to TRUE.
 *   Live runs require confirmation === 'DESTROY-LEGACY'.
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
  validateGhlCredentials,
} from '../_shared/ghl-account.ts';

const LIVE_CONFIRMATION = 'DESTROY-LEGACY';

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

    // Authn
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError || !userId) {
      return createUnauthorizedResponse(authError || 'Authentication required', corsHeaders);
    }

    // Authz: superadmin only
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

    // ─── Read-only modes (status / list) ───────────────────────────────
    const action = body.action || (body.list ? 'list' : (body.job_id && !body.dry_run && !body.confirmation ? 'status' : 'dispatch'));

    if (action === 'list') {
      const { data, error } = await supabase
        .from('legacy_wipe_jobs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(Math.min(Number(body.limit) || 10, 50));
      if (error) throw new Error(error.message);
      return new Response(JSON.stringify({ success: true, jobs: data || [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'status') {
      const { data, error } = await supabase
        .from('legacy_wipe_jobs').select('*').eq('id', body.job_id).maybeSingle();
      if (error) throw new Error(error.message);
      return new Response(JSON.stringify({ success: true, job: data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'cancel') {
      const { error } = await supabase
        .from('legacy_wipe_jobs')
        .update({ status: 'cancelled', completed_at: new Date().toISOString(), worker_lock_until: null })
        .eq('id', body.job_id)
        .in('status', ['pending', 'processing']);
      if (error) throw new Error(error.message);
      return new Response(JSON.stringify({ success: true, cancelled: body.job_id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ─── Dispatch a new job ────────────────────────────────────────────
    const dry_run = body.dry_run !== false; // default true

    if (!dry_run && body.confirmation !== LIVE_CONFIRMATION) {
      return jsonError(corsHeaders,
        `Live wipe requires { confirmation: "${LIVE_CONFIRMATION}" }.`, 400);
    }

    // Validate legacy credentials are present
    const creds = getGhlCredentials('legacy');
    const credsErr = validateGhlCredentials(creds);
    if (credsErr) {
      return jsonError(corsHeaders, credsErr, 400);
    }

    // Reject if an active wipe job already exists
    const { data: active } = await supabase
      .from('legacy_wipe_jobs')
      .select('id, status, created_at, dry_run')
      .in('status', ['pending', 'processing'])
      .order('created_at', { ascending: false })
      .limit(1);

    if (active && active.length > 0) {
      return jsonError(corsHeaders,
        `An active wipe job already exists (id=${active[0].id}, status=${active[0].status}). Wait for it to finish or cancel it first.`,
        409);
    }

    // For live runs, require a recent (≤30 min) successful dry-run
    if (!dry_run) {
      const cutoff = new Date(Date.now() - 30 * 60_000).toISOString();
      const { data: recentDry } = await supabase
        .from('legacy_wipe_jobs')
        .select('id, completed_at, status, progress')
        .eq('dry_run', true)
        .eq('status', 'completed')
        .gte('completed_at', cutoff)
        .order('completed_at', { ascending: false })
        .limit(1);

      if (!recentDry || recentDry.length === 0) {
        return jsonError(corsHeaders,
          'Live wipe blocked: no successful dry-run completed in the last 30 minutes. Run a dry-run first.',
          412);
      }
    }

    // Create job row
    const { data: created, error: insertErr } = await supabase
      .from('legacy_wipe_jobs')
      .insert({
        status: 'pending',
        dry_run,
        confirmation_received: dry_run ? null : LIVE_CONFIRMATION,
        created_by: userId === 'service_role' ? null : userId,
        progress: {},
      })
      .select('id')
      .single();

    if (insertErr || !created) {
      throw new Error(`Failed to create wipe job: ${insertErr?.message || 'unknown'}`);
    }

    const jobId = created.id as string;
    console.log(`[legacy-wipe-orchestrator] created job ${jobId} dry_run=${dry_run} by=${userId}`);

    // Pre-lease so any cron dispatcher won't double-dispatch
    await supabase.from('legacy_wipe_jobs').update({
      status: 'processing',
      worker_lock_until: new Date(Date.now() + 180_000).toISOString(),
      dispatch_count: 1,
      started_at: new Date().toISOString(),
    }).eq('id', jobId);

    // Dispatch worker async (fire & forget)
    const workerUrl = `${supabaseUrl}/functions/v1/ghl-legacy-wipe-worker`;
    const _anon = (Deno.env.get('SUPABASE_ANON_KEY') || '').trim();
    const _internalSecret = (Deno.env.get('INTERNAL_EDGE_SECRET') || '').trim();
    const dispatch = fetch(workerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // AUTH-002: internal secret, not the service-role key.
        Authorization: `Bearer ${_anon}`,
        ...(_internalSecret ? { 'x-internal-edge-secret': _internalSecret } : {}),
        'x-internal-call': 'true',
      },
      body: JSON.stringify({
        job_id: jobId,
      }),
    }).then(async (res) => {
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error(`[legacy-wipe-orchestrator] worker dispatch failed for ${jobId}: ${res.status} ${text.substring(0, 200)}`);
      } else {
        console.log(`[legacy-wipe-orchestrator] worker dispatched for job ${jobId}`);
      }
    }).catch((err) => {
      console.error(`[legacy-wipe-orchestrator] worker dispatch threw for ${jobId}:`, err.message);
    });

    // @ts-ignore — EdgeRuntime is provided by Supabase Deno deploy
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(dispatch);
    }

    return new Response(JSON.stringify({
      success: true,
      job_id: jobId,
      dry_run,
      message: dry_run
        ? 'Dry-run wipe dispatched. No data will be deleted.'
        : 'LIVE wipe dispatched. Legacy GHL account is being destroyed.',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[legacy-wipe-orchestrator] error:', err);
    return jsonError(corsHeaders, err.message || 'Internal error', 500);
  }
});

function jsonError(corsHeaders: Record<string, string>, message: string, status: number) {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
