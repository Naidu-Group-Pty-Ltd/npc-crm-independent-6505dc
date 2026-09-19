import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyAuth, createUnauthorizedResponse, createCorsHeaders, createForbiddenResponse } from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
type CacheTable = 
  | 'suburb_directory'
  | 'median_rent_cache'
  | 'abs_census_cache'
  | 'crime_statistics_cache'
  | 'economic_data_cache'
  | 'transport_data_cache'
  | 'risk_assessment_cache'
  | 'climate_data_cache';

interface RequestBody {
  // Operation type
  operation: 'insert' | 'bulkInsert' | 'query';
  
  // Target table
  table: CacheTable;
  
  // For insert operations
  data?: Record<string, any> | Record<string, any>[];
  
  // For query operations
  queryOptions?: {
    select?: string;
    filters?: Record<string, any>;
    limit?: number;
  };
  
  session_token?: string;
}

Deno.serve(async (req) => {
  // IMPORTANT: Declare corsHeaders BEFORE try block so it's available in catch
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
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body: RequestBody = await req.json();
    
    // SECURITY: Verify authentication and admin role
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[manage-data-import] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    
    // Check if user has admin role (data import should be admin-only)
    const { data: roleData, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .in('role', ['superadmin', 'admin'])
      .single();

    if (roleError || !roleData) {
      console.warn(`User ${userId} attempted to manage data import without admin role.`);
      return createForbiddenResponse('Forbidden: Admin access required', corsHeaders);
    }
    console.log(`[manage-data-import] Admin user ${userId}, operation: ${body.operation}, table: ${body.table}`);

    const { operation, table, data, queryOptions = {} } = body;

    // Validate table
    const validTables: CacheTable[] = [
      'suburb_directory',
      'median_rent_cache',
      'abs_census_cache',
      'crime_statistics_cache',
      'economic_data_cache',
      'transport_data_cache',
      'risk_assessment_cache',
      'climate_data_cache'
    ];
    
    if (!validTables.includes(table)) {
      return new Response(
        JSON.stringify({ error: `Invalid table: ${table}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle query operation
    if (operation === 'query') {
      const { select = '*', filters, limit } = queryOptions;
      
      let query = supabase.from(table).select(select);
      
      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          if (value !== undefined && value !== null) {
            query = query.eq(key, value);
          }
        }
      }
      
      if (limit) {
        query = query.limit(limit);
      }
      
      const { data: records, error, count } = await query;
      
      if (error) {
        console.error(`[manage-data-import] Query error:`, error);
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ success: true, records, count: records?.length || 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle insert operation
    if (operation === 'insert' && data) {
      const { data: result, error } = await supabase
        .from(table)
        .insert(data)
        .select();
      
      if (error) {
        console.error(`[manage-data-import] Insert error:`, error);
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ 
          success: true, 
          summary: {
            total: Array.isArray(data) ? data.length : 1,
            imported: result?.length || 0,
            table
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle bulk insert with batching
    if (operation === 'bulkInsert' && data && Array.isArray(data)) {
      const batchSize = 100;
      let imported = 0;
      
      for (let i = 0; i < data.length; i += batchSize) {
        const batch = data.slice(i, i + batchSize);
        const { error } = await supabase.from(table).insert(batch);
        if (error) {
          console.error(`[manage-data-import] Bulk insert error at batch ${i}:`, error);
          return new Response(
            JSON.stringify({ 
              error: error.message,
              summary: { imported, failed: data.length - imported }
            }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        imported += batch.length;
      }
      
      return new Response(
        JSON.stringify({ 
          success: true, 
          summary: {
            total: data.length,
            imported,
            table
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Invalid operation or missing required parameters' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[manage-data-import] Error:', error);
    return new Response(
      JSON.stringify({ ...internalError(error, 'manage-data-import'), error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
