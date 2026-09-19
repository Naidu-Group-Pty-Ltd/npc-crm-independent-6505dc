import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';

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
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json().catch(() => ({}));
    const { limit = 500 } = body;
    
    // SECURITY: Verify authentication
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[archive-old-reports] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[archive-old-reports] Authenticated user: ${userId}`);

    console.log(`📦 Archiving oldest ${limit} investment reports...`);

    // First, get the oldest reports
    const { data: oldestReports, error: fetchError } = await supabase
      .from('investment_reports')
      .select('id, property_address, created_at')
      .eq('is_archived', false)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (fetchError) {
      throw fetchError;
    }

    if (!oldestReports || oldestReports.length === 0) {
      return new Response(
        JSON.stringify({ success: true, archived: 0, message: 'No reports to archive' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const reportIds = oldestReports.map(r => r.id);

    // Update them to archived
    const { error: updateError } = await supabase
      .from('investment_reports')
      .update({ is_archived: true })
      .in('id', reportIds);

    if (updateError) {
      throw updateError;
    }

    console.log(`✅ Archived ${oldestReports.length} reports`);

    return new Response(
      JSON.stringify({
        success: true,
        archived: oldestReports.length,
        oldestDate: oldestReports[0]?.created_at,
        newestDate: oldestReports[oldestReports.length - 1]?.created_at,
        sampleAddresses: oldestReports.slice(0, 5).map(r => r.property_address),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Error:', error);
    return new Response(
      JSON.stringify({ ...internalError(error, 'archive-old-reports'), success: false }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
