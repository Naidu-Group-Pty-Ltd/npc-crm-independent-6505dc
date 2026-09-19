// Manage Borrowing Capacity scenarios — secure-mediation pattern
// Operations: list | create | delete (per client)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createUnauthorizedResponse, createForbiddenResponse, createCorsHeaders } from "../_shared/auth.ts";
import { requireWorkspaceCapability, entitlementDeniedResponse } from "../_shared/entitlements.ts";
import { requireModulePermission, type ModulePerm } from "../_shared/authz.ts";
import { canAccessClient } from "../_shared/clientAccess.ts";

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
type Operation = 'list' | 'create' | 'delete';

interface RequestBody {
  operation: Operation;
  clientId?: string;
  recordId?: string;
  data?: {
    name: string;
    is_base?: boolean;
    payload: Record<string, unknown>;
  };
  session_token?: string;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') || '';
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

    const { error: authError, userId, username, authMethod } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[manage-bc-scenarios] Auth error:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[manage-bc-scenarios] Auth OK: ${username || userId}`);

    // Borrowing Capacity is a Scale-or-add-on capability — enforced server-side.
    const entitlement = await requireWorkspaceCapability(supabase, { userId, authMethod }, 'borrowing-capacity');
    if (!entitlement.ok) return entitlementDeniedResponse(entitlement, corsHeaders);

    const { operation, clientId, recordId, data } = body;

    if (!operation || !['list', 'create', 'delete'].includes(operation)) {
      return new Response(
        JSON.stringify({ success: false, error: `Invalid operation: ${operation}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (operation === 'delete' && !recordId) {
      return new Response(
        JSON.stringify({ success: false, error: 'recordId is required for delete' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    if (operation === 'list' && !clientId) {
      return new Response(
        JSON.stringify({ success: false, error: 'clientId is required for list' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    if (operation === 'create' && (!clientId || !data || !data.name || !data.payload)) {
      return new Response(
        JSON.stringify({ success: false, error: 'clientId, data.name and data.payload are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const requiredPermission: ModulePerm = operation === 'list'
      ? 'can_view'
      : operation === 'create' ? 'can_edit' : 'can_delete';
    const actor = { userId, authMethod };
    const permission = await requireModulePermission(
      supabase,
      actor,
      'client_management',
      requiredPermission,
    );
    if (!permission.ok) {
      return createForbiddenResponse(permission.error, corsHeaders);
    }

    let authorizedClientId = clientId;
    if (operation === 'delete' && recordId) {
      const { data: scenario } = await supabase
        .from('bc_scenarios')
        .select('client_id')
        .eq('id', recordId)
        .maybeSingle();
      authorizedClientId = scenario?.client_id;
    }
    if (!authorizedClientId || !await canAccessClient(supabase, actor, authorizedClientId)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Scenario not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (operation === 'list') {
      const { data: rows, error } = await supabase
        .from('bc_scenarios')
        .select('id, client_id, name, is_base, payload, created_by, created_at, updated_at')
        .eq('client_id', clientId)
        .order('is_base', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) {
        console.error('[manage-bc-scenarios] list error:', error);
        return new Response(
          JSON.stringify({ success: false, error: error.message }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({ success: true, items: rows || [], count: rows?.length || 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (operation === 'create') {
      // Enforce only one is_base per client (replace existing base on conflict)
      if (data.is_base) {
        await supabase.from('bc_scenarios').delete().eq('client_id', clientId).eq('is_base', true);
      }

      const insertRow = {
        client_id: clientId,
        name: data.name.slice(0, 200),
        is_base: !!data.is_base,
        payload: data.payload,
        created_by: userId || null,
      };

      const { data: created, error } = await supabase
        .from('bc_scenarios')
        .insert(insertRow)
        .select()
        .single();

      if (error) {
        console.error('[manage-bc-scenarios] create error:', error);
        return new Response(
          JSON.stringify({ success: false, error: error.message }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({ success: true, item: created }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // delete
    const { error: delError } = await supabase
      .from('bc_scenarios')
      .delete()
      .eq('id', recordId);

    if (delError) {
      console.error('[manage-bc-scenarios] delete error:', delError);
      return new Response(
        JSON.stringify({ success: false, error: delError.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    return new Response(
      JSON.stringify({ success: true, deleted: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('[manage-bc-scenarios] Unexpected error:', err);
    return new Response(
      JSON.stringify({ ...internalError(err, 'manage-bc-scenarios'), success: false }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  }
});
