/**
 * start-conversations-export
 *
 * Quickly creates an export_jobs row and fires a fire-and-forget worker
 * (build-conversations-export-worker) that builds the file in the background.
 * Returns the job_id immediately so the client can poll for status.
 *
 * Body: {
 *   conversation_ids: string[],   // ghl_conversations.id values to include
 *   file_format: 'csv' | 'xlsx',
 * }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import {
  verifyAuth,
  createCorsHeaders,
  createUnauthorizedResponse,
} from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
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
    if (authError || !userId) {
      return createUnauthorizedResponse(authError || 'Authentication required', corsHeaders);
    }

    const conversationIds: string[] = Array.isArray(body.conversation_ids) ? body.conversation_ids : [];
    const fileFormat: 'csv' | 'xlsx' = body.file_format === 'csv' ? 'csv' : 'xlsx';

    if (conversationIds.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'conversation_ids must be a non-empty array' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const createdBy = userId === 'service_role' ? null : userId;

    const { data: job, error: insertErr } = await supabase
      .from('export_jobs')
      .insert({
        export_type: 'conversations_full_history',
        file_format: fileFormat,
        status: 'pending',
        scope: { conversation_ids: conversationIds },
        total_items: conversationIds.length,
        created_by: createdBy,
      })
      .select('id')
      .single();

    if (insertErr || !job) {
      throw new Error(`Failed to create export job: ${insertErr?.message || 'unknown'}`);
    }

    // Fire-and-forget the worker via signed internal call (WP-12).
    const workerCall = callInternalFunction(
      'build-conversations-export-worker',
      { job_id: job.id },
      'start-conversations-export',
    ).catch((e: any) => {
      console.error(`[start-conversations-export] worker dispatch threw: ${e?.message || e}`);
    });

    // @ts-ignore — EdgeRuntime is provided by Supabase Deno runtime
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(workerCall);
    }

    return new Response(
      JSON.stringify({ success: true, job_id: job.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e: any) {
    console.error('[start-conversations-export] error:', e?.message || e);
    return new Response(
      JSON.stringify({ ...internalError(e, 'start-conversations-export'), success: false }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
