import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
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
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // SECURITY: Verify authentication and admin role (migration should be admin-only)
    const body = await req.json().catch(() => ({}));
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[migrate-comparison-scores] Auth failed:', authError);
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
      console.warn(`User ${userId} attempted to migrate comparison scores without admin role.`);
      return createForbiddenResponse('Forbidden: Admin access required', corsHeaders);
    }
    console.log(`[migrate-comparison-scores] Admin user ${userId} starting comparison score migration`);

    // Fetch all comparisons
    const { data: comparisons, error: fetchError } = await supabase
      .from('property_comparisons')
      .select('id, rankings');

    if (fetchError) {
      console.error('Error fetching comparisons:', fetchError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch comparisons' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!comparisons || comparisons.length === 0) {
      return new Response(
        JSON.stringify({ 
          message: 'No comparisons found',
          migrated: 0
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${comparisons.length} comparisons to check`);

    let migratedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    // Process each comparison
    for (const comparison of comparisons) {
      try {
        if (!comparison.rankings || !Array.isArray(comparison.rankings)) {
          skippedCount++;
          continue;
        }

        let needsUpdate = false;
        const updatedRankings = comparison.rankings.map((ranking: any) => {
          // Check if finalScore is on 0-10 scale (less than 15 is suspicious)
          if (typeof ranking.finalScore === 'number' && ranking.finalScore < 15) {
            console.log(`Migrating score for comparison ${comparison.id}, property ${ranking.propertyNumber}: ${ranking.finalScore} → ${ranking.finalScore * 10}`);
            needsUpdate = true;
            return {
              ...ranking,
              finalScore: ranking.finalScore * 10 // Convert 0-10 to 0-100
            };
          }
          return ranking;
        });

        if (needsUpdate) {
          const { error: updateError } = await supabase
            .from('property_comparisons')
            .update({ rankings: updatedRankings })
            .eq('id', comparison.id);

          if (updateError) {
            console.error(`Error updating comparison ${comparison.id}:`, updateError);
            errors.push(`${comparison.id}: ${updateError.message}`);
          } else {
            migratedCount++;
            console.log(`✅ Migrated comparison ${comparison.id}`);
          }
        } else {
          skippedCount++;
        }
      } catch (err) {
        console.error(`Error processing comparison ${comparison.id}:`, err);
        errors.push(`${comparison.id}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    console.log(`Migration complete: ${migratedCount} migrated, ${skippedCount} skipped`);

    return new Response(
      JSON.stringify({
        success: true,
        totalProcessed: comparisons.length,
        migrated: migratedCount,
        skipped: skippedCount,
        errors: errors.length > 0 ? errors : undefined
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Migration error:', error);
    return new Response(
      JSON.stringify({
        ...internalError(error, 'migrate-comparison-scores'),
        success: false,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
