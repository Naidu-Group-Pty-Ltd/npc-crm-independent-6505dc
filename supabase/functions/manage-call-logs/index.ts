import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createUnauthorizedResponse, createForbiddenResponse, createCorsHeaders } from "../_shared/auth.ts";
import { checkPermission } from "../_shared/permissions.ts";

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
const VAPI_BASE_URL = 'https://api.vapi.ai';
const VAPI_FETCH_TIMEOUT_MS = 5000;
const CALL_LOG_UPDATE_FIELDS = new Set(['resolution_status', 'resolution_notes', 'reviewed_at']);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Fetch the authoritative call state from Vapi. Never throws.
async function vapiGetCall(
  vapiCallId: string,
  apiKey: string,
): Promise<{ ok: boolean; status: number; call: Record<string, any> | null }> {
  try {
    const response = await fetch(`${VAPI_BASE_URL}/call/${vapiCallId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(VAPI_FETCH_TIMEOUT_MS),
    });
    const call = response.ok ? await response.json().catch(() => null) : null;
    return { ok: response.ok, status: response.status, call };
  } catch (error) {
    console.error('[manage-call-logs] Vapi GET /call failed:', error);
    return { ok: false, status: 0, call: null };
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  // Handle CORS preflight
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

    const body = await req.json();

    // Validate authentication (JWT first, then session token)
    const { error: authError, userId, username, authMethod } = await verifyAuth(supabase, req.headers, body);

    if (authError) {
      console.log('[manage-call-logs] Auth error:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }

    console.log(`[manage-call-logs] Authenticated user: ${username} (${userId})`);

    const { operation, callId, data } = body;

    if (!operation) {
      return new Response(
        JSON.stringify({ success: false, error: 'Operation is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Operation: updateTags - update tags for a call
    if (operation === 'updateTags') {
      if (!callId) {
        return new Response(
          JSON.stringify({ success: false, error: 'callId is required for updateTags' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const permission = await checkPermission(supabase, userId!, 'vapi_call_logs', 'update', authMethod);
      if (!permission.allowed) {
        return createForbiddenResponse(permission.reason || 'Call logs edit permission required', corsHeaders);
      }

      console.log(`[manage-call-logs] Updating tags for call: ${callId}`);
      
      const { error } = await supabase
        .from('vapi_call_logs')
        .update({ tags: data.tags })
        .eq('id', callId);

      if (error) {
        console.error('[manage-call-logs] Error updating tags:', error);
        return new Response(
          JSON.stringify({ success: false, error: error.message }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Operation: update - general update for a call
    if (operation === 'update') {
      if (!callId || !data) {
        return new Response(
          JSON.stringify({ success: false, error: 'callId and data are required for update' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (typeof data !== 'object' || Array.isArray(data)) {
        return new Response(
          JSON.stringify({ success: false, error: 'data must be an object' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const permission = await checkPermission(supabase, userId!, 'vapi_call_logs', 'update', authMethod);
      if (!permission.allowed) {
        return createForbiddenResponse(permission.reason || 'Call logs edit permission required', corsHeaders);
      }

      const updateData = Object.fromEntries(
        Object.entries(data).filter(([field]) => CALL_LOG_UPDATE_FIELDS.has(field)),
      );
      if (Object.keys(updateData).length !== Object.keys(data).length || Object.keys(updateData).length === 0) {
        return new Response(
          JSON.stringify({ success: false, error: 'One or more update fields are not allowed' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`[manage-call-logs] Updating call: ${callId}`);
      
      const { error } = await supabase
        .from('vapi_call_logs')
        .update(updateData)
        .eq('id', callId);

      if (error) {
        console.error('[manage-call-logs] Error updating call:', error);
        return new Response(
          JSON.stringify({ success: false, error: error.message }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Operation: killLiveCall - end an active Vapi call and close the local live row
    if (operation === 'killLiveCall') {
      if (!callId) {
        return new Response(
          JSON.stringify({ success: false, error: 'callId is required for killLiveCall' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // This operation terminates a live customer call and updates a call-log
      // record with service-role privileges, so enforce the same server-side
      // call_logs edit permission used by the UI before performing either action.
      const permission = await checkPermission(supabase, userId!, 'vapi_call_logs', 'update', authMethod);
      if (!permission.allowed) {
        console.warn(`[manage-call-logs] Kill live call denied for user ${userId}: ${permission.reason}`);
        return createForbiddenResponse(permission.reason || 'Call logs edit permission required', corsHeaders);
      }

      const { data: callRow, error: callFetchError } = await supabase
        .from('vapi_call_logs')
        .select('id, vapi_call_id, call_status, ended_at, metadata')
        .eq('id', callId)
        .maybeSingle();

      if (callFetchError) {
        console.error('[manage-call-logs] Error fetching live call before kill:', callFetchError);
        return new Response(
          JSON.stringify({ success: false, error: callFetchError.message }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!callRow) {
        return new Response(
          JSON.stringify({ success: false, error: 'Call log not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!['in-progress', 'ringing', 'queued'].includes(callRow.call_status)) {
        return new Response(
          JSON.stringify({ success: false, error: 'Only live calls can be killed' }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const vapiApiKey = Deno.env.get('VAPI_API_KEY');
      if (!vapiApiKey) {
        return new Response(
          JSON.stringify({ success: false, error: 'VAPI_API_KEY is not configured' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`[manage-call-logs] Killing live Vapi call: ${callRow.vapi_call_id}`);

      const baseMetadata = (callRow.metadata && typeof callRow.metadata === 'object' && !Array.isArray(callRow.metadata))
        ? callRow.metadata as Record<string, unknown>
        : {};

      // Close the local row and record who killed the call, how, and what Vapi reported
      const markEnded = async (outcome: string, audit: Record<string, unknown>) => {
        const endedAt = new Date().toISOString();
        const { error: updateError } = await supabase
          .from('vapi_call_logs')
          .update({
            call_status: 'ended',
            call_outcome: outcome,
            ended_at: endedAt,
            metadata: {
              ...baseMetadata,
              killed_by: userId,
              killed_by_username: username,
              killed_at: endedAt,
              kill_source: 'call_logs_live_monitor',
              ...audit,
            },
          })
          .eq('id', callRow.id);
        return updateError;
      };

      const dbErrorResponse = (updateError: { message: string }) => {
        console.error('[manage-call-logs] Error marking killed call ended:', updateError);
        return new Response(
          JSON.stringify({ success: false, error: updateError.message }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      };

      // Authoritative state + Live Call Control URL from Vapi. DELETE /call/{id}
      // only removes the record — a live call can only be ended by POSTing
      // {"type":"end-call"} to the call's monitor.controlUrl.
      const initial = await vapiGetCall(callRow.vapi_call_id, vapiApiKey);
      const initialStatus = typeof initial.call?.status === 'string' ? initial.call.status : null;
      // Resolve the capability URL only from Vapi's authenticated API response.
      // Call-log metadata is user-modifiable through legacy update operations and
      // must never be treated as a URL authority.
      const controlUrl: string | null = typeof initial.call?.monitor?.controlUrl === 'string'
        ? initial.call.monitor.controlUrl
        : null;

      // Idempotent path: the call is already over on Vapi's side
      if (initial.status === 404 || (initial.ok && initialStatus === 'ended')) {
        const endedReason = initial.call?.endedReason ?? null;
        const updateError = await markEnded(endedReason || 'ended', {
          kill_method: 'already-ended',
          kill_verified: true,
          vapi_get_status: initial.status,
          vapi_ended_reason: endedReason,
        });
        if (updateError) return dbErrorResponse(updateError);
        return new Response(
          JSON.stringify({ success: true, result: 'already-ended', verified: true, endedReason }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!controlUrl) {
        // A queued call has not connected yet, so unscheduling it via DELETE is
        // a real termination. For anything in transit we must fail loudly —
        // reporting success without ending the call defeats the security control.
        const effectiveStatus = initialStatus ?? callRow.call_status;
        if (effectiveStatus === 'queued') {
          const deleteResponse = await fetch(`${VAPI_BASE_URL}/call/${callRow.vapi_call_id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${vapiApiKey}` },
            signal: AbortSignal.timeout(VAPI_FETCH_TIMEOUT_MS),
          }).catch((error) => {
            console.error('[manage-call-logs] Vapi DELETE /call failed:', error);
            return null;
          });

          if (deleteResponse && (deleteResponse.ok || deleteResponse.status === 404 || deleteResponse.status === 409)) {
            const updateError = await markEnded('killed', {
              kill_method: 'queued-delete',
              kill_verified: true,
              vapi_get_status: initial.status,
              vapi_delete_status: deleteResponse.status,
            });
            if (updateError) return dbErrorResponse(updateError);
            return new Response(
              JSON.stringify({ success: true, result: 'terminated', verified: true, endedReason: null }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

          return new Response(
            JSON.stringify({ success: false, error: `Vapi rejected the unschedule request (${deleteResponse?.status ?? 'network error'})` }),
            { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.error('[manage-call-logs] No control URL available for live call:', callRow.vapi_call_id, 'GET status:', initial.status);
        return new Response(
          JSON.stringify({ success: false, error: 'Unable to resolve the Vapi control URL for this call. The call was NOT terminated.' }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Send end-call over the Live Call Control channel. The controlUrl is a
      // capability URL — no Authorization header needed.
      let controlStatus = 0;
      try {
        const controlResponse = await fetch(controlUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'end-call' }),
          signal: AbortSignal.timeout(VAPI_FETCH_TIMEOUT_MS),
        });
        controlStatus = controlResponse.status;
        if (!controlResponse.ok) {
          const details = await controlResponse.text().catch(() => '');
          console.error('[manage-call-logs] Vapi control end-call rejected:', controlResponse.status, details);
        }
      } catch (error) {
        console.error('[manage-call-logs] Vapi control end-call request failed:', error);
      }

      if (controlStatus < 200 || controlStatus >= 300) {
        // A dead control channel usually means the call just ended on its own —
        // recheck before reporting failure.
        const recheck = await vapiGetCall(callRow.vapi_call_id, vapiApiKey);
        if (recheck.status === 404 || recheck.call?.status === 'ended') {
          const endedReason = recheck.call?.endedReason ?? null;
          const updateError = await markEnded(endedReason || 'ended', {
            kill_method: 'already-ended',
            kill_verified: true,
            vapi_get_status: recheck.status,
            vapi_control_status: controlStatus,
            vapi_ended_reason: endedReason,
          });
          if (updateError) return dbErrorResponse(updateError);
          return new Response(
            JSON.stringify({ success: true, result: 'already-ended', verified: true, endedReason }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: false, error: `Vapi control endpoint rejected end-call (${controlStatus || 'network error'}). The call was NOT terminated.` }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Verify termination against Vapi — the ack alone is not proof for a
      // security control.
      let verified = false;
      let endedReason: string | null = null;
      let verifyStatus = 0;
      for (const delayMs of [1000, 1500, 2000]) {
        await sleep(delayMs);
        const check = await vapiGetCall(callRow.vapi_call_id, vapiApiKey);
        verifyStatus = check.status;
        if (check.status === 404 || check.call?.status === 'ended') {
          verified = true;
          endedReason = check.call?.endedReason ?? null;
          break;
        }
      }

      // The end-call command was accepted, so close the row either way; the
      // Vapi webhook reconciles the final state if verification lagged.
      const updateError = await markEnded('killed', {
        kill_method: 'control-url-end-call',
        kill_verified: verified,
        vapi_get_status: initial.status,
        vapi_control_status: controlStatus,
        vapi_verify_status: verifyStatus,
        vapi_ended_reason: endedReason,
      });
      if (updateError) return dbErrorResponse(updateError);

      console.log(`[manage-call-logs] Kill result for ${callRow.vapi_call_id}: verified=${verified}, endedReason=${endedReason}`);
      return new Response(
        JSON.stringify({ success: true, result: 'terminated', verified, endedReason }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Operation: delete - delete a call log
    if (operation === 'delete') {
      if (!callId) {
        return new Response(
          JSON.stringify({ success: false, error: 'callId is required for delete' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`[manage-call-logs] Deleting call: ${callId}`);
      
      const { error } = await supabase
        .from('vapi_call_logs')
        .delete()
        .eq('id', callId);

      if (error) {
        console.error('[manage-call-logs] Error deleting call:', error);
        return new Response(
          JSON.stringify({ success: false, error: error.message }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Operation: cleanupTestCalls - delete all calls from specified test phone numbers
    if (operation === 'cleanupTestCalls') {
      const { testNumbers } = data || {};
      
      if (!testNumbers || !Array.isArray(testNumbers) || testNumbers.length === 0) {
        return new Response(
          JSON.stringify({ success: false, error: 'testNumbers array is required for cleanupTestCalls' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`[manage-call-logs] Cleaning up test calls for numbers:`, testNumbers);
      
      // First, count how many calls will be deleted
      const { count, error: countError } = await supabase
        .from('vapi_call_logs')
        .select('*', { count: 'exact', head: true })
        .in('phone_number', testNumbers);

      if (countError) {
        console.error('[manage-call-logs] Error counting test calls:', countError);
        return new Response(
          JSON.stringify({ success: false, error: countError.message }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Delete all calls matching the test numbers
      const { error: deleteError } = await supabase
        .from('vapi_call_logs')
        .delete()
        .in('phone_number', testNumbers);

      if (deleteError) {
        console.error('[manage-call-logs] Error deleting test calls:', deleteError);
        return new Response(
          JSON.stringify({ success: false, error: deleteError.message }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`[manage-call-logs] Successfully deleted ${count} test calls`);

      return new Response(
        JSON.stringify({ success: true, deletedCount: count || 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: `Unknown operation: ${operation}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[manage-call-logs] Unexpected error:', error);
    return new Response(
      JSON.stringify({ ...internalError(error, 'manage-call-logs'), success: false }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
