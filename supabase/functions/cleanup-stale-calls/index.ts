import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse, createForbiddenResponse } from '../_shared/auth.ts';
import { enforceRawBodyLimit, verifySignedInternal } from '../_shared/requestSecurity.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

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
    
    // The signature covers a hash of the raw bytes, so the body is read once as
    // text and parsed from that — `req.json()` consumes the stream and leaves
    // nothing for `verifySignedInternal` to hash.
    const bounded = await enforceRawBodyLimit(req, 8192);
    if (!bounded.ok) return bounded.error;
    let body: any = {};
    try { body = bounded.raw ? JSON.parse(bounded.raw) : {}; } catch { body = {}; }

    /**
     * `cleanup-stale-calls-hourly` asked for a credential this function does
     * not accept, and so had never once run.
     *
     * The job invokes this through `cron_invoke_signed_function`, which sends
     * a signed internal envelope and NO user JWT — while the only path through
     * this handler required an authenticated admin. Every hourly run answered
     * 401 (`auth_required`, measured in `net._http_response`) and pg_cron
     * reported each one as a successful run, because it reports on the SQL
     * that queued the HTTP call and never on the call.
     *
     * The admin path below is untouched: an operator running this by hand
     * still has to be an admin. The scheduled caller gets a branch of its own,
     * which is the whole reason the job exists.
     */
    const internal = await verifySignedInternal(supabase, req, bounded.raw, ['pg_cron']);
    if (!internal.ok) {
      // SECURITY: Verify authentication and admin role (cleanup should be admin-only)
      const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
      if (authError) {
        console.log('[cleanup-stale-calls] Auth failed:', authError);
        return createUnauthorizedResponse(authError, corsHeaders);
      }

      // Check if user has admin role
      const { data: roleData, error: roleError } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .in('role', ['superadmin', 'admin'])
        .single();

      if (roleError || !roleData) {
        console.warn(`User ${userId} attempted to cleanup stale calls without admin role.`);
        return createForbiddenResponse('Forbidden: Admin access required', corsHeaders);
      }
      console.log(`[cleanup-stale-calls] Admin user ${userId} cleaning up stale calls`);
    } else {
      console.log('[cleanup-stale-calls] scheduled run');
    }

    console.log('[Cleanup Stale Calls] Starting cleanup...');

    // Find calls stuck in active states for more than 2 hours
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    // Update stale calls to 'ended' status
    const { data: staleCalls, error: updateError } = await supabase
      .from('vapi_call_logs')
      .update({ 
        call_status: 'ended',
        call_outcome: 'timeout'
      })
      .in('call_status', ['ringing', 'in-progress', 'queued'])
      .lt('started_at', twoHoursAgo)
      .select('id, vapi_call_id, call_status, started_at');

    if (updateError) {
      console.error('[Cleanup Stale Calls] Error updating stale calls:', updateError);
      throw updateError;
    }

    const updatedCount = staleCalls?.length || 0;
    console.log(`[Cleanup Stale Calls] Cleaned up ${updatedCount} stale calls`);

    if (staleCalls && staleCalls.length > 0) {
      console.log('[Cleanup Stale Calls] Cleaned call IDs:', staleCalls.map(c => c.vapi_call_id));
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Cleaned up ${updatedCount} stale calls`,
        cleanedCalls: staleCalls || []
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Cleanup Stale Calls] Error:', error);
    return new Response(
      JSON.stringify({ ...internalError(error, 'cleanup-stale-calls'), success: false }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
