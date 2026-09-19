// Industrial property CRUD edge function
// Handles industrial_properties, industrial_tenancies, industrial_capex
// Strict service_role mediation per project pattern.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyAuth, createUnauthorizedResponse, createCorsHeaders } from '../_shared/auth.ts';
import { requireWorkspaceCapability, entitlementDeniedResponse } from '../_shared/entitlements.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { pickAllowed } from '../_shared/wp09Guards.ts';
import { INDUSTRIAL_WRITABLE } from '../_shared/assetWritableColumns.ts';
type TableName = 'industrial_properties' | 'industrial_tenancies' | 'industrial_capex' | 'industrial_financing';

const ALLOWED_TABLES: TableName[] = [
  'industrial_properties',
  'industrial_tenancies',
  'industrial_capex',
  'industrial_financing',
];

type Operation = 'list' | 'get' | 'create' | 'update' | 'delete';

interface RequestBody {
  operation: Operation;
  table: TableName;
  recordId?: string;
  propertyId?: string;
  clientId?: string;
  data?: Record<string, any>;
  session_token?: string;
}

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const auth = await verifyAuth(supabase, req.headers, { session_token: body.session_token });
  if (auth.error || !auth.userId) {
    return createUnauthorizedResponse(auth.error || 'Authentication required', corsHeaders);
  }
  const userId = auth.userId;

  // Commercial & Industrial is a Scale-or-add-on capability — enforced
  // server-side, not just hidden in the UI.
  const entitlement = await requireWorkspaceCapability(supabase, auth, 'commercial-industrial');
  if (!entitlement.ok) return entitlementDeniedResponse(entitlement, corsHeaders);

  if (!body.operation || !body.table) {
    return new Response(JSON.stringify({ error: 'operation and table are required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!ALLOWED_TABLES.includes(body.table)) {
    return new Response(JSON.stringify({ error: `Table not allowed: ${body.table}` }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Helper: confirm property belongs to user
  async function assertPropertyOwned(propertyId: string) {
    const { data, error } = await supabase
      .from('industrial_properties')
      .select('id')
      .eq('id', propertyId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Property not found or access denied');
  }

  try {
    let result;

    switch (body.operation) {
      case 'list': {
        if (body.table === 'industrial_properties') {
          let q = supabase.from('industrial_properties').select('*').eq('user_id', userId);
          if (body.clientId) q = q.eq('client_id', body.clientId);
          const { data, error } = await q.order('created_at', { ascending: false }).limit(500);
          if (error) throw error;
          result = data;
        } else {
          if (!body.propertyId) throw new Error('propertyId required');
          await assertPropertyOwned(body.propertyId);
          const { data, error } = await supabase
            .from(body.table)
            .select('*')
            .eq('property_id', body.propertyId)
            .order('created_at', { ascending: false })
            .limit(500);
          if (error) throw error;
          result = data;
        }
        break;
      }

      case 'get': {
        if (!body.recordId) throw new Error('recordId required');
        if (body.table === 'industrial_properties') {
          const { data, error } = await supabase
            .from('industrial_properties')
            .select('*')
            .eq('id', body.recordId)
            .eq('user_id', userId)
            .maybeSingle();
          if (error) throw error;
          result = data;
        } else {
          const { data, error } = await supabase
            .from(body.table)
            .select('*, industrial_properties!inner(user_id)')
            .eq('id', body.recordId)
            .eq('industrial_properties.user_id', userId)
            .maybeSingle();
          if (error) throw error;
          result = data;
        }
        break;
      }

      case 'create': {
        if (!body.data) throw new Error('data required');
        // WP-24: an allowlist, not a denylist. The three `delete`s this replaces
        // were right about the columns somebody thought of and silent about
        // every column added since — and these tables gain columns regularly.
        const payload: Record<string, unknown> = pickAllowed(body.data, INDUSTRIAL_WRITABLE[body.table] ?? new Set());
        // The two ownership columns are absent from the allowlist on purpose, so
        // they are set HERE — from the verified session, or from a value that has
        // been ownership-checked first — and can never simply arrive in the body.
        if (body.table === 'industrial_properties') {
          payload.user_id = userId;
        } else {
          const requestedPropertyId = (body.data as Record<string, unknown> | undefined)?.property_id;
          if (typeof requestedPropertyId !== 'string' || !requestedPropertyId) {
            throw new Error('property_id required');
          }
          await assertPropertyOwned(requestedPropertyId);
          payload.property_id = requestedPropertyId;
        }
        const { data, error } = await supabase
          .from(body.table)
          .insert(payload)
          .select()
          .single();
        if (error) throw error;
        result = data;
        break;
      }

      case 'update': {
        if (!body.recordId || !body.data) throw new Error('recordId and data required');
        // WP-24: same allowlist. `id`, `user_id` and `property_id` are absent from
        // it by construction, so they cannot be set from the body at all.
        const payload: Record<string, unknown> = pickAllowed(body.data, INDUSTRIAL_WRITABLE[body.table] ?? new Set());
        if (body.table === 'industrial_properties') {
          const { data, error } = await supabase
            .from('industrial_properties')
            .update(payload)
            .eq('id', body.recordId)
            .eq('user_id', userId)
            .select()
            .single();
          if (error) throw error;
          result = data;
        } else {
          // Validate ownership through join
          const { data: rec, error: recErr } = await supabase
            .from(body.table)
            .select('property_id, industrial_properties!inner(user_id)')
            .eq('id', body.recordId)
            .eq('industrial_properties.user_id', userId)
            .maybeSingle();
          if (recErr) throw recErr;
          if (!rec) throw new Error('Record not found or access denied');
          const { data, error } = await supabase
            .from(body.table)
            .update(payload)
            .eq('id', body.recordId)
            .select()
            .single();
          if (error) throw error;
          result = data;
        }
        break;
      }

      case 'delete': {
        if (!body.recordId) throw new Error('recordId required');
        if (body.table === 'industrial_properties') {
          const { error } = await supabase
            .from('industrial_properties')
            .delete()
            .eq('id', body.recordId)
            .eq('user_id', userId);
          if (error) throw error;
        } else {
          const { data: rec, error: recErr } = await supabase
            .from(body.table)
            .select('id, industrial_properties!inner(user_id)')
            .eq('id', body.recordId)
            .eq('industrial_properties.user_id', userId)
            .maybeSingle();
          if (recErr) throw recErr;
          if (!rec) throw new Error('Record not found or access denied');
          const { error } = await supabase.from(body.table).delete().eq('id', body.recordId);
          if (error) throw error;
        }
        result = { success: true };
        break;
      }

      default:
        throw new Error(`Unknown operation: ${body.operation}`);
    }

    return new Response(JSON.stringify({ success: true, data: result }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[manage-industrial-data] error:', msg);
    return new Response(JSON.stringify({ error: msg, success: false }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
