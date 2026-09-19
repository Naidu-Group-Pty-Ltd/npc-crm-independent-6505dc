import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createUnauthorizedResponse, createCorsHeaders, createForbiddenResponse } from "../_shared/auth.ts";
import { requireModulePermission, type ModulePerm } from "../_shared/authz.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { normalizePhone, digitsOnly } from "../_shared/phone.ts";
import { internalError } from '../_shared/errorResponse.ts';

type TableName = 'call_tags' | 'call_alert_rules' | 'call_alert_history' | 'blacklisted_numbers';
type Operation = 'list' | 'create' | 'update' | 'delete';

const BLACKLIST_CATEGORIES = ['spam', 'scam', 'telemarketer', 'abusive', 'other'];
const BLACKLIST_KILL_MODES = ['silent', 'announce'];

/**
 * Whitelist and validate client-supplied blacklist fields. Server-owned
 * columns (normalized_number, hit_count, last_hit_at, created_by, ...) are
 * derived here, never accepted from the client.
 */
function sanitizeBlacklistData(
  data: Record<string, any>,
  isCreate: boolean,
  userId: string | null,
  username: string | null,
): { data?: Record<string, unknown>; error?: string } {
  const out: Record<string, unknown> = {};

  if (data.phone_number !== undefined) {
    const phone = String(data.phone_number ?? '').trim();
    if (digitsOnly(phone).length < 6) {
      return { error: 'Phone number must contain at least 6 digits' };
    }
    out.phone_number = phone;
    out.normalized_number = normalizePhone(phone);
  } else if (isCreate) {
    return { error: 'phone_number is required' };
  }

  if (data.category !== undefined) {
    if (!BLACKLIST_CATEGORIES.includes(data.category)) {
      return { error: `Invalid category. Allowed: ${BLACKLIST_CATEGORIES.join(', ')}` };
    }
    out.category = data.category;
  }

  if (data.kill_mode !== undefined) {
    if (!BLACKLIST_KILL_MODES.includes(data.kill_mode)) {
      return { error: `Invalid kill_mode. Allowed: ${BLACKLIST_KILL_MODES.join(', ')}` };
    }
    out.kill_mode = data.kill_mode;
  }

  if (data.announce_message !== undefined) {
    const message = data.announce_message === null ? '' : String(data.announce_message).trim();
    if (message.length > 300) {
      return { error: 'Announce message must be 300 characters or fewer' };
    }
    out.announce_message = message.length > 0 ? message : null;
  }

  if (data.notes !== undefined) {
    const notes = data.notes === null ? '' : String(data.notes).trim();
    out.notes = notes.length > 0 ? notes : null;
  }

  if (data.is_active !== undefined) {
    out.is_active = !!data.is_active;
  }

  if (isCreate) {
    out.created_by = userId;
    out.created_by_username = username;
  }

  return { data: out };
}

interface RequestBody {
  operation: Operation;
  table: TableName;
  recordId?: string;
  data?: Record<string, any>;
  filters?: {
    orderBy?: string;
    orderAsc?: boolean;
    limit?: number;
    isRead?: boolean;
  };
  session_token?: string;
}

const ALLOWED_TABLES: TableName[] = ['call_tags', 'call_alert_rules', 'call_alert_history', 'blacklisted_numbers'];

function blacklistPermissionFor(operation: Operation): ModulePerm {
  if (operation === 'delete') return 'can_delete';
  if (operation === 'create' || operation === 'update') return 'can_edit';
  return 'can_view';
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') || '';
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

    const body: RequestBody = await req.json();

    // SECURITY: Verify authentication
    const { error: authError, userId, username, authMethod } = await verifyAuth(supabase, req.headers, body);

    if (authError) {
      console.log('[manage-call-settings] Auth error:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }

    console.log(`[manage-call-settings] Authenticated user: ${username || userId} (${userId})`);

    const { operation, table, recordId, data, filters } = body;

    // Validate table
    if (!ALLOWED_TABLES.includes(table)) {
      return new Response(
        JSON.stringify({ success: false, error: `Invalid table: ${table}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate operation
    if (!['list', 'create', 'update', 'delete'].includes(operation)) {
      return new Response(
        JSON.stringify({ success: false, error: `Invalid operation: ${operation}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Blacklist entries directly control automated inbound call termination.
    // This function uses a service-role client, so enforce the Call Logs module
    // permission here rather than relying on browser-only controls.
    if (table === 'blacklisted_numbers') {
      const permission = await requireModulePermission(
        supabase,
        { userId, authMethod },
        'call_logs',
        blacklistPermissionFor(operation),
      );
      if (!permission.ok) {
        console.warn('[manage-call-settings] Blacklist permission denied:', {
          userId,
          operation,
          reason: permission.reason_code,
        });
        return createForbiddenResponse(permission.error || 'Call Logs permission required', corsHeaders);
      }
    }

    let result: any;

    switch (operation) {
      case 'list': {
        let query = supabase.from(table).select('*');
        
        // Apply ordering
        if (filters?.orderBy) {
          query = query.order(filters.orderBy, { ascending: filters.orderAsc ?? true });
        } else {
          // Default ordering based on table
          if (table === 'call_tags') {
            query = query.order('name', { ascending: true });
          } else if (table === 'call_alert_rules') {
            query = query.order('created_at', { ascending: false });
          } else if (table === 'call_alert_history') {
            query = query.order('triggered_at', { ascending: false });
          } else if (table === 'blacklisted_numbers') {
            query = query.order('created_at', { ascending: false });
          }
        }
        
        // Apply limit for history
        if (filters?.limit) {
          query = query.limit(filters.limit);
        } else if (table === 'call_alert_history') {
          query = query.limit(50); // Default limit for history
        }

        const { data: rows, error } = await query;
        
        if (error) {
          console.error(`[manage-call-settings] Error listing ${table}:`, error);
          return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        result = { items: rows, count: rows?.length || 0 };
        break;
      }

      case 'create': {
        if (!data) {
          return new Response(
            JSON.stringify({ success: false, error: 'Data is required for create operation' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        let insertData: Record<string, any> = data;
        if (table === 'blacklisted_numbers') {
          const sanitized = sanitizeBlacklistData(data, true, userId, username);
          if (sanitized.error) {
            return new Response(
              JSON.stringify({ success: false, error: sanitized.error }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          insertData = sanitized.data!;
        }

        const { data: created, error } = await supabase
          .from(table)
          .insert(insertData)
          .select()
          .single();

        if (error) {
          console.error(`[manage-call-settings] Error creating ${table}:`, error);
          const friendly = table === 'blacklisted_numbers' && error.code === '23505'
            ? 'This number is already blacklisted.'
            : error.message;
          return new Response(
            JSON.stringify({ success: false, error: friendly, code: error.code }),
            { status: error.code === '23505' ? 409 : 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        result = { item: created };
        break;
      }

      case 'update': {
        if (!recordId) {
          return new Response(
            JSON.stringify({ success: false, error: 'recordId is required for update operation' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (!data) {
          return new Response(
            JSON.stringify({ success: false, error: 'Data is required for update operation' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Special case: bulk update for marking alerts as read
        if (table === 'call_alert_history' && recordId === 'bulk' && data.is_read !== undefined) {
          const { error } = await supabase
            .from(table)
            .update({ is_read: data.is_read })
            .eq('is_read', false);

          if (error) {
            console.error(`[manage-call-settings] Error bulk updating ${table}:`, error);
            return new Response(
              JSON.stringify({ success: false, error: error.message }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

          result = { updated: true, bulk: true };
        } else {
          let updateData: Record<string, any> = data;
          if (table === 'blacklisted_numbers') {
            const sanitized = sanitizeBlacklistData(data, false, userId, username);
            if (sanitized.error) {
              return new Response(
                JSON.stringify({ success: false, error: sanitized.error }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              );
            }
            updateData = sanitized.data!;
          }

          const { data: updated, error } = await supabase
            .from(table)
            .update(updateData)
            .eq('id', recordId)
            .select()
            .single();

          if (error) {
            console.error(`[manage-call-settings] Error updating ${table}:`, error);
            const friendly = table === 'blacklisted_numbers' && error.code === '23505'
              ? 'This number is already blacklisted.'
              : error.message;
            return new Response(
              JSON.stringify({ success: false, error: friendly }),
              { status: error.code === '23505' ? 409 : 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

          result = { item: updated };
        }
        break;
      }

      case 'delete': {
        if (!recordId) {
          return new Response(
            JSON.stringify({ success: false, error: 'recordId is required for delete operation' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { error } = await supabase
          .from(table)
          .delete()
          .eq('id', recordId);

        if (error) {
          console.error(`[manage-call-settings] Error deleting from ${table}:`, error);
          return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        result = { deleted: true };
        break;
      }

      default:
        return new Response(
          JSON.stringify({ success: false, error: `Unknown operation: ${operation}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    console.log(`[manage-call-settings] ${operation} on ${table} completed successfully`);
    
    return new Response(
      JSON.stringify({ success: true, operation, table, ...result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[manage-call-settings] Unexpected error:', error);
    return new Response(
      JSON.stringify({ ...internalError(error, 'manage-call-settings'), success: false }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  }
});
