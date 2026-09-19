import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createUnauthorizedResponse, createCorsHeaders, createForbiddenResponse } from "../_shared/auth.ts";

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
/**
 * Edge function to manage automation settings
 * Tables: auto_report_master_settings, auto_report_switches, auto_report_processed_listings
 * Also handles: ghl_pipelines, ghl_pipeline_stages, clients (pipeline updates)
 */

interface RequestBody {
  operation: 
    // Master settings
    | 'getMasterSettings' 
    | 'updateMasterSettings'
    // Switches
    | 'getSwitches'
    | 'createSwitch'
    | 'updateSwitch'
    | 'deleteSwitch'
    // Sync stats
    | 'getSyncStats'
    // GHL pipelines
    | 'getPipelines'
    | 'getStages'
    // Client pipeline updates
    | 'updateClientPipeline'
    // Clear stuck reports
    | 'clearStuckReports';
  
  // Data for various operations
  data?: Record<string, any>;
  switchId?: string;
  clientId?: string;
  session_token?: string;
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
      console.log('[manage-automation-settings] Auth error:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    
    // Check if user has admin role (automation settings should be admin-only)
    // IMPORTANT: Do NOT use .single()/.maybeSingle() here because some users legitimately
    // have multiple roles (e.g. both admin and superadmin). We just need to know whether
    // at least one allowed role exists.
    const { data: roleRows, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .in('role', ['superadmin', 'admin']);

    if (roleError || !roleRows || roleRows.length === 0) {
      console.warn(
        `User ${userId} attempted to manage automation settings without admin role. ` +
          `Error: ${roleError?.message || 'No matching role found'}`
      );
      return createForbiddenResponse('Forbidden: Admin access required', corsHeaders);
    }
    console.log(`[manage-automation-settings] Admin user: ${username || userId}, Operation: ${body.operation}`);

    const { operation, data, switchId, clientId } = body;

    // ==================== MASTER SETTINGS ====================
    if (operation === 'getMasterSettings') {
      const { data: settings, error } = await supabase
        .from('auto_report_master_settings')
        .select('*')
        .single();

      if (error) {
        return new Response(
          JSON.stringify({ success: false, error: error.message }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, settings }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (operation === 'updateMasterSettings') {
      // Get current settings ID first
      const { data: current } = await supabase
        .from('auto_report_master_settings')
        .select('id')
        .single();

      if (!current?.id) {
        return new Response(
          JSON.stringify({ success: false, error: 'Master settings not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { error } = await supabase
        .from('auto_report_master_settings')
        .update({ 
          is_enabled: data?.is_enabled, 
          updated_at: new Date().toISOString(),
          updated_by: userId 
        })
        .eq('id', current.id);

      if (error) {
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

    // ==================== SWITCHES ====================
    if (operation === 'getSwitches') {
      const { data: switches, error } = await supabase
        .from('auto_report_switches')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        return new Response(
          JSON.stringify({ success: false, error: error.message }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, switches }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (operation === 'createSwitch') {
      const { data: newSwitch, error } = await supabase
        .from('auto_report_switches')
        .insert({
          ...data,
          created_by: userId
        })
        .select()
        .single();

      if (error) {
        return new Response(
          JSON.stringify({ success: false, error: error.message }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, switch: newSwitch }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (operation === 'updateSwitch') {
      if (!switchId) {
        return new Response(
          JSON.stringify({ success: false, error: 'switchId is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { error } = await supabase
        .from('auto_report_switches')
        .update({ ...data, updated_at: new Date().toISOString() })
        .eq('id', switchId);

      if (error) {
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

    if (operation === 'deleteSwitch') {
      if (!switchId) {
        return new Response(
          JSON.stringify({ success: false, error: 'switchId is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { error } = await supabase
        .from('auto_report_switches')
        .delete()
        .eq('id', switchId);

      if (error) {
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

    // ==================== SYNC STATS ====================
    if (operation === 'getSyncStats') {
      // Get total count and last processed
      const { data: lastProcessed, count: totalCount } = await supabase
        .from('auto_report_processed_listings')
        .select('*', { count: 'exact', head: false })
        .order('processed_at', { ascending: false })
        .limit(1);

      // Get generated count (not skipped)
      const { count: generatedCount } = await supabase
        .from('auto_report_processed_listings')
        .select('*', { count: 'exact', head: true })
        .eq('skipped', false);

      return new Response(
        JSON.stringify({ 
          success: true, 
          stats: {
            total: totalCount || 0,
            generated: generatedCount || 0,
            lastSync: lastProcessed?.[0]?.processed_at
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ==================== GHL PIPELINES ====================
    if (operation === 'getPipelines') {
      const { data: pipelines, error } = await supabase
        .from('ghl_pipelines')
        .select('*')
        .eq('is_active', true)
        .order('position', { ascending: true });

      if (error) {
        return new Response(
          JSON.stringify({ success: false, error: error.message }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, pipelines }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (operation === 'getStages') {
      const { data: stages, error } = await supabase
        .from('ghl_pipeline_stages')
        .select('*')
        .order('position', { ascending: true });

      if (error) {
        return new Response(
          JSON.stringify({ success: false, error: error.message }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, stages }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ==================== CLIENT PIPELINE UPDATES ====================
    if (operation === 'updateClientPipeline') {
      if (!clientId) {
        return new Response(
          JSON.stringify({ success: false, error: 'clientId is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { error } = await supabase
        .from('clients')
        .update({
          pipeline_status: data?.pipeline_status,
          follow_up_date: data?.follow_up_date,
          borrowing_capacity: data?.borrowing_capacity,
          proposed_rental_income: data?.proposed_rental_income,
          equity_release: data?.equity_release,
          pipeline_notes: data?.pipeline_notes,
          current_stage_id: data?.current_stage_id,
          pipeline_updated_at: new Date().toISOString()
        })
        .eq('id', clientId);

      if (error) {
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

    // ==================== CLEAR STUCK REPORTS ====================
    if (operation === 'clearStuckReports') {
      const { data: deleted, error } = await supabase
        .from('investment_reports')
        .delete()
        .in('status', ['processing', 'pending', 'failed'])
        .select('id');

      if (error) {
        return new Response(
          JSON.stringify({ success: false, error: error.message }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, deletedCount: deleted?.length || 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: `Unknown operation: ${operation}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[manage-automation-settings] Unexpected error:', error);
    return new Response(
      JSON.stringify({ ...internalError(error, 'manage-automation-settings'), success: false }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
