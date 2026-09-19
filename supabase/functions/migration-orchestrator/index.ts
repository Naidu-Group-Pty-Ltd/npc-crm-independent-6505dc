/**
 * Migration Orchestrator (Phase 2B)
 *
 * Superadmin-only entry point that:
 *   1. Creates a migration_jobs row
 *   2. Asynchronously dispatches the appropriate worker edge function
 *   3. Returns the job ID so the dashboard can poll status
 *
 * Workers do the heavy lifting in the background. The orchestrator returns
 * immediately so the UI never blocks on long-running migrations.
 *
 * SAFETY: dry_run defaults to true. Live writes require explicit
 * { dry_run: false } AND a typed confirmation token from the client.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import {
  verifyAuth,
  createCorsHeaders,
  createUnauthorizedResponse,
  createForbiddenResponse,
} from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { createJob, type MigrationDomain } from '../_shared/migration-jobs.ts';
import {
  probeGhlCredentialScopes,
  requiredScopesForDomain,
  GHL_SCOPE_DOCS_URL,
} from '../_shared/ghl-account.ts';

const VALID_DOMAINS: MigrationDomain[] = [
  'contacts','opportunities','conversations','conversations_replay','notes',
  'calendar_groups','calendars','bookings',
  'workflows_snapshot','workflow_enrollments_backfill','workflow_reenroll',
];
const LIVE_WRITE_CONFIRMATION = 'MIGRATE-LIVE';

const WORKER_MAP: Record<MigrationDomain, string> = {
  contacts: 'ghl-migrate-contacts-worker',
  opportunities: 'ghl-migrate-opportunities-worker',
  conversations: 'ghl-migrate-conversations-worker',
  conversations_replay: 'ghl-migrate-conversations-replay-worker',
  notes: 'ghl-migrate-notes-worker',
  calendar_groups: 'ghl-migrate-calendar-groups-worker',
  calendars: 'ghl-migrate-calendars-worker',
  bookings: 'ghl-migrate-bookings-worker',
  workflows_snapshot: 'ghl-migrate-workflows-snapshot-worker',
  workflow_enrollments_backfill: 'ghl-migrate-workflow-enrollments-worker',
  workflow_reenroll: 'ghl-migrate-workflow-reenroll-worker',
};

// Domains that don't write to a target GHL account during their snapshot
// phase — they only READ + persist locally. These bypass the live-write
// confirmation gate AND the target-scope preflight.
const READ_ONLY_DOMAINS: Set<MigrationDomain> = new Set([
  'workflows_snapshot',
  'workflow_enrollments_backfill',
  'conversations',
]);

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

    // Validate inputs
    const domain = body.domain as MigrationDomain;
    if (!VALID_DOMAINS.includes(domain)) {
      return jsonError(corsHeaders, `Invalid domain. Must be one of: ${VALID_DOMAINS.join(', ')}`, 400);
    }

    const source_account = body.source_account === 'new' ? 'new' : 'legacy';
    const target_account = body.target_account === 'new' ? 'new' : 'legacy';
    const dry_run = body.dry_run !== false; // default true

    const isReadOnly = READ_ONLY_DOMAINS.has(domain);

    if (source_account === target_account && !isReadOnly) {
      return jsonError(corsHeaders, 'source_account and target_account must differ', 400);
    }

    // Live writes require typed confirmation (read-only domains exempt — they
    // never write to GHL, only to our own snapshot tables).
    if (!dry_run && !isReadOnly && body.confirmation !== LIVE_WRITE_CONFIRMATION) {
      return jsonError(
        corsHeaders,
        `Live writes require confirmation. Pass { confirmation: "${LIVE_WRITE_CONFIRMATION}" }.`,
        400,
      );
    }

    // Optional payload — workers interpret this (e.g. limits, filters, scope)
    const payload = (body.payload && typeof body.payload === 'object') ? body.payload : {};
    // Skip preflight when:
    //   1. caller explicitly opts out (skip_preflight)
    //   2. this is a resume of an in-progress job (the original dispatch
    //      already audited the token; re-probing burns ~3-4 calls of the
    //      same daily budget the worker is about to need).
    //   3. domain is read-only (no target writes happen)
    const isResume = body._resume === true || body.resume === true;
    const skipPreflight = body.skip_preflight === true || isResume || isReadOnly;

    // ── Scope preflight (live writes only) ────────────────────────────────
    // Probe the TARGET account for the scopes this domain needs. Block if
    // any required scope is missing. Always stamp the audit into payload.
    let tokenAudit: any = null;
    if (!dry_run && !skipPreflight) {
      try {
        tokenAudit = await probeGhlCredentialScopes(target_account, { domains: [domain] });
        const required = requiredScopesForDomain(domain);
        const missingRequired = required.filter((s) => tokenAudit.missing_scopes.includes(s));
        if (missingRequired.length > 0) {
          console.warn(`[migration-orchestrator] Preflight FAILED for ${target_account}/${domain}: missing scopes=${missingRequired.join(', ')}`);
          return new Response(JSON.stringify({
            success: false,
            error: `GHL token for "${target_account}" account is missing required scopes for ${domain}: ${missingRequired.join(', ')}. Update the Private Integration Token's scopes and retry.`,
            preflight_failed: true,
            missing_scopes: missingRequired,
            token_audit: tokenAudit,
            documentation_url: GHL_SCOPE_DOCS_URL,
          }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        console.log(`[migration-orchestrator] Preflight OK for ${target_account}/${domain}: kind=${tokenAudit.token_kind} all required scopes present`);
      } catch (preflightErr: any) {
        console.error('[migration-orchestrator] Preflight threw:', preflightErr.message);
        // Don't fail the job for a transient probe error; record and proceed.
        tokenAudit = { error: preflightErr.message?.substring(0, 240), preflight_threw: true };
      }
    }

    // Create job row
    const jobId = await createJob(supabase, {
      domain,
      source_account,
      target_account,
      dry_run,
      payload: {
        ...payload,
        triggered_by: userId,
        triggered_at: new Date().toISOString(),
        token_audit: tokenAudit,         // run-level audit for live runs
        preflight_skipped: dry_run || skipPreflight,
      },
      created_by: userId === 'service_role' ? null : userId,
    });

    console.log(
      `[migration-orchestrator] Created job ${jobId} domain=${domain} ` +
        `${source_account}→${target_account} dry_run=${dry_run}`,
    );

    // Dispatch worker asynchronously (don't await — fire & forget)
    const workerName = WORKER_MAP[domain];
    const workerUrl = `${supabaseUrl}/functions/v1/${workerName}`;

    // ── Pre-lease the job to suppress duplicate cron dispatch ────────────
    // Without this, the dispatcher cron (every 15s) immediately claims the
    // same pending job and fires a second worker leg in parallel. Pre-stamp
    // status=processing + a short worker_lock_until so claim_migration_jobs()
    // skips it. The worker we directly invoke will refresh the lease via
    // its own startJob/heartbeat path.
    try {
      await supabase.from('migration_jobs').update({
        status: 'processing',
        last_dispatched_at: new Date().toISOString(),
        worker_lock_until: new Date(Date.now() + 180_000).toISOString(),
        dispatch_count: 1,
      }).eq('id', jobId);
    } catch (preLeaseErr: any) {
      console.warn(`[migration-orchestrator] pre-lease failed for ${jobId}: ${preLeaseErr?.message}`);
    }

    // Use EdgeRuntime.waitUntil if available (Supabase Deno) so the worker
    // call survives after we return the response to the client.
    const _anon = (Deno.env.get('SUPABASE_ANON_KEY') || '').trim();
    const _internalSecret = (Deno.env.get('INTERNAL_EDGE_SECRET') || '').trim();
    const dispatch = fetch(workerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // AUTH-002: internal secret, not the service-role key (header or body).
        Authorization: `Bearer ${_anon}`,
        ...(_internalSecret ? { 'x-internal-edge-secret': _internalSecret } : {}),
        'x-internal-call': 'true',
      },
      body: JSON.stringify({
        job_id: jobId,
        source_account,
        target_account,
        dry_run,
        payload,
      }),
    }).then(async (res) => {
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error(`[migration-orchestrator] Worker dispatch failed for job ${jobId}: ${res.status} ${text.substring(0, 200)}`);
      } else {
        console.log(`[migration-orchestrator] Worker dispatched for job ${jobId}`);
      }
    }).catch((err) => {
      console.error(`[migration-orchestrator] Worker dispatch threw for job ${jobId}:`, err.message);
    });

    // @ts-ignore — EdgeRuntime is provided by the Deno deploy environment
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(dispatch);
    }

    return new Response(
      JSON.stringify({
        success: true,
        job_id: jobId,
        domain,
        source_account,
        target_account,
        dry_run,
        worker: workerName,
        message: dry_run
          ? 'Dry-run job dispatched. No data will be written.'
          : 'LIVE migration job dispatched. Data will be written to the target account.',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    console.error('[migration-orchestrator] error:', err);
    return jsonError(corsHeaders, err.message || 'Internal error', 500);
  }
});

function jsonError(corsHeaders: Record<string, string>, message: string, status: number) {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
