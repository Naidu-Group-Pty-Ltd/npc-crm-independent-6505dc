import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse, createForbiddenResponse } from '../_shared/auth.ts';

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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // SECURITY: Verify authentication and admin role (data import should be admin-only)
    const body = await req.json().catch(() => ({}));
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[import-suburb-directory] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    
    // Check if user has admin role
    const { data: roleData, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .in('role', ['superadmin', 'admin'])
      .single();

    if (roleError || !roleData) {
      console.warn(`User ${userId} attempted to import suburb directory without admin role.`);
      return createForbiddenResponse('Forbidden: Admin access required', corsHeaders);
    }
    console.log(`[import-suburb-directory] Admin user ${userId} importing suburb directory`);

    console.log('🌏 Fetching Australian suburb directory from Matthew Proctor dataset...');
    
    // Fetch the CSV from the public source
    const csvUrl = 'https://www.matthewproctor.com/Content/postcodes/australian_postcodes.csv';
    const response = await fetch(csvUrl);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch CSV: ${response.status} ${response.statusText}`);
    }

    const csvText = await response.text();
    const lines = csvText.split('\n').filter(line => line.trim());
    
    // Parse headers (first line)
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
    console.log('📋 CSV Headers:', headers);

    // Find column indices
    const postcodeIdx = headers.findIndex(h => h === 'postcode');
    const localityIdx = headers.findIndex(h => h === 'locality');
    const stateIdx = headers.findIndex(h => h === 'state');

    if (postcodeIdx === -1 || localityIdx === -1 || stateIdx === -1) {
      throw new Error(`Required columns not found. Headers: ${headers.join(', ')}`);
    }

    // Parse records
    const records: { suburb: string; postcode: string; state: string }[] = [];
    const seenKeys = new Set<string>();

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      // Handle CSV with potential quotes
      const values = line.match(/("([^"]*)"|[^,]+)/g)?.map(v => v.replace(/^"|"$/g, '').trim()) || [];
      
      const postcode = values[postcodeIdx]?.padStart(4, '0');
      const suburb = values[localityIdx]?.toLowerCase();
      const state = values[stateIdx]?.toUpperCase();

      if (postcode && suburb && state && postcode.length === 4) {
        const key = `${suburb}-${postcode}-${state}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          records.push({ suburb, postcode, state });
        }
      }
    }

    console.log(`📍 Parsed ${records.length} unique suburb records`);

    // Clear existing data
    const { error: deleteError } = await supabase
      .from('suburb_directory')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all

    if (deleteError) {
      console.warn('⚠️ Delete warning:', deleteError.message);
    }

    // Insert in batches of 1000
    const batchSize = 1000;
    let inserted = 0;
    let errors = 0;

    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      
      const { error } = await supabase
        .from('suburb_directory')
        .insert(batch);

      if (error) {
        console.error(`❌ Batch ${Math.floor(i / batchSize) + 1} error:`, error.message);
        errors += batch.length;
      } else {
        inserted += batch.length;
        console.log(`✅ Inserted batch ${Math.floor(i / batchSize) + 1}: ${batch.length} records`);
      }
    }

    console.log(`🎉 Import complete: ${inserted} inserted, ${errors} errors`);

    return new Response(JSON.stringify({
      success: true,
      summary: {
        total_parsed: records.length,
        inserted,
        errors,
        source: csvUrl
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('❌ Import error:', error);
    return new Response(JSON.stringify({
      ...internalError(error, 'import-suburb-directory'),
      success: false,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
