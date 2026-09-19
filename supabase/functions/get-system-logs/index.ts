import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createUnauthorizedResponse, createCorsHeaders, createForbiddenResponse } from "../_shared/auth.ts";

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
/**
 * Edge function to fetch system logs and error data
 * Tables: auto_report_generation_log, api_health_log, investment_reports (stuck/failed)
 */

interface RequestBody {
  mode?: 'generation_errors' | 'api_errors' | 'stuck_reports' | 'failed_reports' | 'all';
  cutoffDate?: string; // ISO date string
  limit?: number;
  session_token?: string;
  // RPC support for monitoring page
  operation?: 'rpc';
  rpcName?: string;
  rpcParams?: Record<string, any>;
}

Deno.serve(async (req) => {
  // IMPORTANT: Declare corsHeaders BEFORE try block so it's available in catch
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

    const body: RequestBody = await req.json();
    
    // SECURITY: Verify authentication and admin role
    const { error: authError, userId, username } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[get-system-logs] Auth error:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    
    // Check if user has admin role (system logs should be admin-only)
    const { data: roleData, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .in('role', ['superadmin', 'admin'])
      .single();

    if (roleError || !roleData) {
      console.warn(`User ${userId} attempted to access system logs without admin role.`);
      return createForbiddenResponse('Forbidden: Admin access required', corsHeaders);
    }
    console.log(`[get-system-logs] Admin user: ${username || userId} (${userId})`);

    const { operation, rpcName, rpcParams, mode = 'all', cutoffDate, limit = 100 } = body;

    // Handle RPC calls for monitoring page
    if (operation === 'rpc' && rpcName) {
      console.log(`[get-system-logs] Executing RPC: ${rpcName}`);
      
      const { data, error } = await supabase.rpc(rpcName, rpcParams || {});
      
      if (error) {
        console.error(`[get-system-logs] RPC error for ${rpcName}:`, error);
        return new Response(
          JSON.stringify({ success: false, error: error.message }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Standard log fetching mode
    const results: Record<string, any[]> = {};

    // Helper to apply date filter
    const applyDateFilter = (query: any, dateColumn: string) => {
      if (cutoffDate) {
        return query.gte(dateColumn, cutoffDate);
      }
      return query;
    };

    // Fetch generation errors from auto_report_generation_log
    if (mode === 'generation_errors' || mode === 'all') {
      let query = supabase
        .from('auto_report_generation_log')
        .select('*')
        .eq('status', 'failed')
        .order('created_at', { ascending: false })
        .limit(limit);

      query = applyDateFilter(query, 'created_at');
      const { data, error } = await query;

      if (error) {
        console.error('[get-system-logs] Error fetching generation_errors:', error);
      } else {
        results.generationErrors = data || [];
      }
    }

    // Fetch API health errors
    if (mode === 'api_errors' || mode === 'all') {
      let query = supabase
        .from('api_health_log')
        .select('*')
        .eq('status', 'error')
        .order('created_at', { ascending: false })
        .limit(limit);

      query = applyDateFilter(query, 'created_at');
      const { data, error } = await query;

      if (error) {
        console.error('[get-system-logs] Error fetching api_errors:', error);
      } else {
        results.apiErrors = data || [];
      }
    }

    // Fetch stuck reports (processing for >30 min)
    if (mode === 'stuck_reports' || mode === 'all') {
      const stuckThreshold = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      let query = supabase
        .from('investment_reports')
        .select('id, property_address, status, created_at, updated_at, error_message')
        .eq('status', 'processing')
        .lt('created_at', stuckThreshold)
        .order('created_at', { ascending: false })
        .limit(limit);

      query = applyDateFilter(query, 'created_at');
      const { data, error } = await query;

      if (error) {
        console.error('[get-system-logs] Error fetching stuck_reports:', error);
      } else {
        results.stuckReports = data || [];
      }
    }

    // Fetch failed reports
    if (mode === 'failed_reports' || mode === 'all') {
      let query = supabase
        .from('investment_reports')
        .select('id, property_address, status, created_at, error_message')
        .eq('status', 'failed')
        .order('created_at', { ascending: false })
        .limit(limit);

      query = applyDateFilter(query, 'created_at');
      const { data, error } = await query;

      if (error) {
        console.error('[get-system-logs] Error fetching failed_reports:', error);
      } else {
        results.failedReports = data || [];
      }
    }

    return new Response(
      JSON.stringify({ success: true, ...results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[get-system-logs] Unexpected error:', error);
    return new Response(
      JSON.stringify({ ...internalError(error, 'get-system-logs'), success: false }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
