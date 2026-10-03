import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createUnauthorizedResponse, createCorsHeaders, createForbiddenResponse } from "../_shared/auth.ts";
import { BULK_DELETE_BUDGET_MS, removeDeletedReportStorage } from "../_shared/reports/investment/reportStorageRemoval.ts";

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
import { requireModulePermission, type ModulePerm } from '../_shared/authz.ts';
import { canAccessClient } from '../_shared/clientAccess.ts';
import { pickAllowed } from '../_shared/wp09Guards.ts';
import {
  CLIENT_PIPELINE_WRITE_COLUMNS,
  isPipelineUuid,
  planClientPipelineWrite,
  readPipelineUpdate,
  type StageRow,
} from '../_shared/clientPipelineUpdate.pure.ts';
import { placeNativeOpportunity } from '../_shared/crm/nativeOpportunityWriter.ts';
/**
 * Edge function to manage automation settings
 * Tables: auto_report_master_settings, auto_report_switches, auto_report_processed_listings
 * Also handles: ghl_pipelines, ghl_pipeline_stages, clients (pipeline updates)
 *
 * ── Who may ask ────────────────────────────────────────────────────────────
 *
 * The automation settings are an administrator's. The pipeline operations are
 * the Client Tracker's, and they used to sit behind the same admin-only check,
 * so a member of staff given the tracker opened it to "No Pipelines" and could
 * not move a card: the board's first two reads were refused. They answer to the
 * tracker's own module permission now (`TRACKER_PERMISSION`), viewing to read
 * the board and editing to change it, with the administrator role still
 * admitted so nobody who reached the board before loses it; a move is refused for a client the
 * person may not act for (`canAccessClient`) with the not-found the client
 * broker gives, so this cannot be used to learn which ids exist.
 */

/** The operations the Client Tracker asks for, and the permission each needs.
 *  Every other operation is an administrator's. */
const TRACKER_PERMISSION: Record<string, ModulePerm> = {
  getPipelines: 'can_view',
  getStages: 'can_view',
  updateClientPipeline: 'can_edit',
  createPipeline: 'can_edit',
};

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
    // A pipeline this deployment's own CRM creates (no vendor to sync it from)
    | 'createPipeline'
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
    
    // SECURITY: Verify authentication, then the permission the operation needs
    const { error: authError, userId, username, authMethod } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[manage-automation-settings] Auth error:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    const actor = { userId, authMethod };

    // Whether the caller holds an administrator role. IMPORTANT: Do NOT use
    // .single()/.maybeSingle() here because some users legitimately have
    // multiple roles (e.g. both admin and superadmin). We just need to know
    // whether at least one allowed role exists.
    const isAdministrator = async (): Promise<boolean> => {
      const { data: roleRows, error: roleError } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .in('role', ['superadmin', 'admin']);
      if (roleError || !roleRows || roleRows.length === 0) {
        console.warn(
          `User ${userId} asked for ${body.operation} without an admin role. ` +
            `Error: ${roleError?.message || 'No matching role found'}`
        );
        return false;
      }
      return true;
    };

    const trackerPermission = TRACKER_PERMISSION[body.operation];
    if (trackerPermission) {
      // The tracker's own permission, or the administrator role these
      // operations answered to before, so nobody who reached the board loses it.
      const permission = await requireModulePermission(supabase, actor, 'client_tracker', trackerPermission);
      if (!permission.ok && !(await isAdministrator())) {
        return createForbiddenResponse(
          trackerPermission === 'can_view'
            ? 'You do not have access to the Client Tracker.'
            : 'You can view the Client Tracker but not change it.',
          corsHeaders,
        );
      }
    } else if (!(await isAdministrator())) {
      // The automation settings are an administrator's.
      return createForbiddenResponse('Forbidden: Admin access required', corsHeaders);
    }
    console.log(`[manage-automation-settings] User: ${username || userId}, Operation: ${body.operation}`);

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

    // ==================== NATIVE PIPELINE CREATION ====================
    // On the CRM-independent line nothing syncs pipelines in, so Client Tracker
    // would have no stages to move a card across. This writes one pipeline and
    // its stages into the tables the tracker already reads. Their `ghl_id` is a
    // `native:` key: the column is NOT NULL and unique, and a value that can
    // never be a vendor id says plainly where the row came from.
    if (operation === 'createPipeline') {
      const json = (status: number, payload: Record<string, unknown>) =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });

      const name = typeof data?.name === 'string' ? data.name.trim() : '';
      const rawStages: unknown[] = Array.isArray(data?.stages) ? data.stages : [];
      const stages = Array.from(
        new Set(
          rawStages
            .filter((v): v is string => typeof v === 'string')
            .map((v) => v.trim())
            .filter((v) => v.length > 0),
        ),
      );
      if (name.length === 0 || name.length > 200) {
        return json(400, { success: false, error: 'A pipeline needs a name of 1 to 200 characters.' });
      }
      if (stages.length === 0 || stages.length > 30 || stages.some((v) => v.length > 200)) {
        return json(400, { success: false, error: 'A pipeline needs between 1 and 30 stages, each up to 200 characters.' });
      }

      const { data: last } = await supabase
        .from('ghl_pipelines')
        .select('position')
        .order('position', { ascending: false, nullsFirst: false })
        .limit(1);
      const position = ((last?.[0]?.position as number | null) ?? -1) + 1;

      const { data: pipeline, error: pipelineError } = await supabase
        .from('ghl_pipelines')
        .insert({ ghl_id: `native:${crypto.randomUUID()}`, name, position, is_active: true })
        .select('*')
        .single();
      if (pipelineError || !pipeline) {
        return json(503, { success: false, error: 'Could not create the pipeline.' });
      }

      const { error: stagesError } = await supabase.from('ghl_pipeline_stages').insert(
        stages.map((stageName, i) => ({
          ghl_id: `native:${crypto.randomUUID()}`,
          pipeline_id: pipeline.id,
          name: stageName,
          position: i,
        })),
      );
      if (stagesError) {
        // Never leave a pipeline with no stages behind: it would draw an empty board.
        await supabase.from('ghl_pipelines').delete().eq('id', pipeline.id);
        return json(503, { success: false, error: 'Could not create the pipeline stages.' });
      }

      return json(200, { success: true, pipeline });
    }

    // ==================== CLIENT PIPELINE UPDATES ====================
    // The rules for what a save writes are `clientPipelineUpdate.pure.ts`'s:
    // a stage is looked up rather than described, and leaving a pipeline
    // touches only that pipeline.
    if (operation === 'updateClientPipeline') {
      const json = (status: number, payload: Record<string, unknown>) =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });

      if (!isPipelineUuid(clientId)) {
        return json(400, { success: false, error: 'clientId is required' });
      }
      if (!await canAccessClient(supabase, actor, clientId)) {
        return json(404, { success: false, error: 'Client not found' });
      }

      const reading = readPipelineUpdate(data);
      if (!reading.ok) return json(400, { success: false, error: reading.message });

      const { data: client, error: clientError } = await supabase
        .from('clients')
        .select('id, current_stage_id, current_pipeline_id, ghl_contact_id, primary_first_name, primary_surname')
        .eq('id', clientId)
        .maybeSingle();
      if (clientError) return json(503, { success: false, error: 'Could not read the client. Please try again.' });
      if (!client) return json(404, { success: false, error: 'Client not found' });

      let stage: StageRow | null = null;
      if (reading.stage.kind === 'set') {
        const { data: row, error: stageError } = await supabase
          .from('ghl_pipeline_stages')
          .select('id, name, pipeline_id')
          .eq('id', reading.stage.stageId)
          .maybeSingle();
        if (stageError) return json(503, { success: false, error: 'Could not read the stage. Please try again.' });
        if (!row || !row.pipeline_id) {
          return json(400, { success: false, error: 'That stage no longer exists. Refresh the board and try again.' });
        }
        stage = { id: row.id, name: row.name ?? '', pipeline_id: row.pipeline_id };
      }

      // A row saved before `current_pipeline_id` was written carries only its
      // stage; leaving a pipeline needs to know which pipeline that stage is in.
      let currentStagePipelineId: string | null = null;
      if (
        reading.stage.kind === 'clear' && reading.stage.pipelineId &&
        !client.current_pipeline_id && client.current_stage_id
      ) {
        const { data: row, error: placedError } = await supabase
          .from('ghl_pipeline_stages')
          .select('pipeline_id')
          .eq('id', client.current_stage_id)
          .maybeSingle();
        // A read that failed is not a client placed nowhere: taken as one, it
        // would clear their placement in a pipeline this move is not about.
        if (placedError) return json(503, { success: false, error: 'Could not read the client\'s stage. Please try again.' });
        currentStagePipelineId = row?.pipeline_id ?? null;
      }

      const patch = planClientPipelineWrite(reading, stage, {
        current_stage_id: client.current_stage_id ?? null,
        current_pipeline_id: client.current_pipeline_id ?? null,
        current_stage_pipeline_id: currentStagePipelineId,
      });

      const { error } = await supabase
        .from('clients')
        .update({
          ...pickAllowed(patch, CLIENT_PIPELINE_WRITE_COLUMNS),
          pipeline_updated_at: new Date().toISOString(),
        })
        .eq('id', clientId);

      if (error) {
        return json(503, { success: false, error: 'Could not save the client. Please try again.' });
      }

      // This line's own CRM: the board places a card by its opportunity rows,
      // and nothing here syncs them in (`nativeOpportunity.pure.ts`).
      const placed = await placeNativeOpportunity(supabase, { intent: reading.stage, stage, client });
      if (!placed.ok) return json(503, { success: false, error: placed.message });

      return json(200, { success: true, stage: stage ? { id: stage.id, name: stage.name, pipelineId: stage.pipeline_id } : null });
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

      // Each cleared report's photographs, floor plans and kept document go
      // with it, and never at the cost of the clear (`reportStorage.pure.ts`).
      const storage = await removeDeletedReportStorage(supabase, deleted, BULK_DELETE_BUDGET_MS);
      if (storage.reports > 0) console.log('[manage-automation-settings] report storage removed', storage);

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
