import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { drainJob, type BulkProperty } from '../_shared/bulkReportWorker.ts';
import { internalError } from '../_shared/errorResponse.ts';
// Per-item token metering happens inside `generate-investment-report` (called by the bulk worker).

interface BulkGenerationRequest {
  properties: BulkProperty[];
  userId: string;
}

const __bulkReportHandler = async (req: Request): Promise<Response> => {
  console.log('🚀 Bulk report generation function invoked');

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
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase configuration');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { properties, userId }: BulkGenerationRequest = body;

    const { error: authError, userId: authenticatedUserId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[generate-bulk-reports] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }

    if (userId && userId !== authenticatedUserId) {
      return new Response(JSON.stringify({
        error: 'User ID mismatch. You can only generate reports for yourself.',
        success: false,
      }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const finalUserId = authenticatedUserId || userId;
    console.log(`📦 Bulk request: ${properties?.length} properties from user ${finalUserId}`);

    if (!properties || properties.length === 0) {
      return new Response(JSON.stringify({ error: 'No properties provided', success: false }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (properties.length > 10) {
      return new Response(JSON.stringify({ error: 'Maximum 10 properties allowed per batch', success: false }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!finalUserId) {
      return new Response(JSON.stringify({ error: 'User ID is required', success: false }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const propertyIds = properties.map(p => p.id);
    const propertyAddresses = properties.map(p => p.address);

    const { data: job, error: jobError } = await supabase
      .from('bulk_generation_jobs')
      .insert({
        created_by: finalUserId,
        status: 'processing',
        total_reports: properties.length,
        completed_reports: 0,
        failed_reports: 0,
        property_ids: propertyIds,
        property_addresses: propertyAddresses,
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (jobError || !job) {
      throw new Error(`Failed to create job: ${jobError?.message}`);
    }

    const items = properties.map(p => ({
      job_id: job.id,
      property_listing_id: p.id,
      property_address: p.address,
      status: 'pending',
    }));

    const { error: itemsError } = await supabase
      .from('bulk_generation_items')
      .insert(items);

    if (itemsError) {
      await supabase.from('bulk_generation_jobs').update({
        status: 'failed',
        error_message: `Failed to create items: ${itemsError.message}`,
        completed_at: new Date().toISOString(),
      }).eq('id', job.id);
      throw new Error(`Failed to create items: ${itemsError.message}`);
    }

    console.log(`✅ Job ${job.id} created with ${items.length} items`);

    // Background drain. Cron resume worker will pick up anything left over.
    const workerId = `initial-${job.id.slice(0, 8)}`;
    // EdgeRuntime is supplied by the Supabase Deno runtime, not by the type
    // graph the gate checks against — reach it off globalThis rather than
    // suppressing the diagnostic, so a missing runtime degrades to awaiting
    // nothing instead of throwing.
    (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil(
      drainJob(supabase, job.id, finalUserId, workerId).catch(err =>
        console.error(`[generate-bulk-reports] drain failed for ${job.id}:`, err),
      ),
    );

    return new Response(JSON.stringify({
      success: true,
      jobId: job.id,
      message: `Started bulk generation for ${properties.length} properties`,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('❌ Error in bulk generation:', error);
    return new Response(JSON.stringify({
      ...internalError(error, 'generate-bulk-reports'),
      success: false,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
};

// Bulk endpoint only kicks off the job; per-item metering happens inside
// generate-investment-report (called by the bulk worker). No reservation here.
Deno.serve(__bulkReportHandler);
