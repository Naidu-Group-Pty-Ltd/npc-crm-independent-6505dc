/**
 * ghl-marketing-dump-enqueue
 *
 * Creates a ghl_marketing_dump_jobs row, builds the asset queue
 * (lists from GHL), seeds total_assets, and fires the worker async.
 * Returns the job_id immediately for polling.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import {
  verifyAuth, createCorsHeaders, createUnauthorizedResponse, createForbiddenResponse,
} from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { getGhlCredentials, validateGhlCredentials, buildGhlHeaders, type GhlAccount } from '../_shared/ghl-account.ts';
import { buildQueue } from '../_shared/ghl-asset-harvester.ts';
import { callInternalFunction } from '../_shared/internalCall.ts';
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
    if (authError || !userId) return createUnauthorizedResponse(authError || 'Auth required', corsHeaders);

    if (userId !== 'service_role') {
      const { data: roles } = await supabase.from('user_roles').select('role').eq('user_id', userId);
      const isSuper = (roles || []).some((r: any) => r.role === 'superadmin');
      if (!isSuper) return createForbiddenResponse('Superadmin only', corsHeaders);
    }

    const account: GhlAccount = body.account === 'new' ? 'new' : 'legacy';
    const useFirecrawl = body.use_firecrawl !== false;
    const downloadAssets = body.download_assets !== false;
    const requested: string[] = Array.isArray(body.resources) && body.resources.length
      ? body.resources : ['form', 'survey', 'funnel', 'workflow'];
    const funnelDomainOverrides: Record<string, string> = (body.funnel_domains && typeof body.funnel_domains === 'object')
      ? body.funnel_domains : {};

    const creds = getGhlCredentials(account);
    const credErr = validateGhlCredentials(creds);
    if (credErr) throw new Error(credErr);
    const headers = buildGhlHeaders(creds.apiKey!);

    // Build the queue NOW so we know total_assets up-front
    const queue = await buildQueue(headers, creds.locationId!, requested, { funnelDomainOverrides });

    const { data: job, error: insErr } = await supabase
      .from('ghl_marketing_dump_jobs')
      .insert({
        status: 'queued',
        account,
        requested_resources: requested,
        use_firecrawl: useFirecrawl,
        download_assets: downloadAssets,
        total_assets: queue.length,
        cursor: { phase: 'process', index: 0, queue },
        created_by: userId === 'service_role' ? null : userId,
      })
      .select('id')
      .single();

    if (insErr || !job) throw new Error(`Failed to create job: ${insErr?.message}`);

    // Fire worker via signed internal call (WP-12).
    const workerCall = callInternalFunction(
      'ghl-marketing-dump-worker',
      { job_id: job.id },
      'ghl-marketing-dump-enqueue',
    ).catch((e: any) => console.error('[enqueue] worker dispatch threw', e));

    // @ts-ignore
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(workerCall);
    }

    return new Response(JSON.stringify({ success: true, job_id: job.id, total_assets: queue.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('[ghl-marketing-dump-enqueue] error:', e);
    return new Response(JSON.stringify({ ...internalError(e, 'ghl-marketing-dump-enqueue'), success: false }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
