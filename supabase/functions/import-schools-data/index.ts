/**
 * DEPLOYMENT: this function must keep `verify_jwt = false`.
 *
 * It is called from the browser, and a CORS preflight is an unauthenticated
 * OPTIONS by specification. With the gateway check on, the gateway refuses the
 * preflight before this file runs — 503 with its own wildcard headers — and the
 * `createCorsHeaders(origin)` below never executes. Every call then fails as an
 * opaque "Network/CORS error calling <fn>", which is what this function did
 * from the day it shipped until 15 August 2026.
 *
 * Nothing is lost by turning it off: the gateway JWT was never the credential
 * here. This app authenticates on the HttpOnly `__Host-session_token` cookie,
 * which `verifyAuth` reads below, after `enforceCsrf`.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse, createForbiddenResponse } from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { withRequestOrigin } from "../_shared/corsOrigin.ts";
import { internalError } from '../_shared/errorResponse.ts';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

interface SchoolImportRequest {
  schools: Array<{
    name: string;
    suburb: string;
    postcode: string;
    state: string;
    school_type?: 'Government' | 'Catholic' | 'Independent' | 'Other';
    school_level?: 'Primary' | 'Secondary' | 'Combined' | 'Special' | 'Other';
    icsea_score?: number;
    student_count?: number;
    latitude?: number;
    longitude?: number;
    address?: string;
    website_url?: string;
  }>;
  overwrite?: boolean;
}

const __corsWrappedHandler = (async (req: Request): Promise<Response> => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  
  console.log('📥 School data import service invoked');
  
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
    
    // SECURITY: Verify authentication and admin role (data import should be admin-only)
    const body = await req.json();
    const { schools, overwrite = false }: SchoolImportRequest = body;
    
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[import-schools-data] Auth failed:', authError);
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
      console.warn(`User ${userId} attempted to import schools data without admin role.`);
      return createForbiddenResponse('Forbidden: Admin access required', corsHeaders);
    }
    console.log(`[import-schools-data] Admin user ${userId} importing schools data`);
    
    if (!schools || !Array.isArray(schools) || schools.length === 0) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Schools array is required and must not be empty' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`📊 Importing ${schools.length} schools...`);

    // The client is the one created above, before authentication. A second
    // `const supabase` here was a redeclaration in the same block scope — a
    // parse-time SyntaxError, so this module never loaded and every invocation
    // answered BOOT_ERROR. It was invisible for as long as it was, because the
    // gateway's JWT check refused the request before the runtime tried to load
    // the file: the caller saw a CORS failure on the preflight and never got
    // far enough to see the boot failure underneath it.

    // Validate school data
    const validSchools = schools.filter(school => 
      school.name && 
      school.suburb && 
      school.postcode && 
      school.state
    );

    if (validSchools.length === 0) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'No valid schools found. Each school must have name, suburb, postcode, and state.' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`✅ ${validSchools.length} schools validated`);

    let imported = 0;
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];

    // Import schools one by one (could be batched for large datasets)
    for (const school of validSchools) {
      try {
        const schoolData = {
          name: school.name,
          suburb: school.suburb,
          postcode: school.postcode,
          state: school.state.toUpperCase(),
          school_type: school.school_type || 'Government',
          school_level: school.school_level || 'Combined',
          icsea_score: school.icsea_score || null,
          student_count: school.student_count || null,
          latitude: school.latitude || null,
          longitude: school.longitude || null,
          address: school.address || null,
          website_url: school.website_url || null,
          last_updated: new Date().toISOString().split('T')[0]
        };

        if (overwrite) {
          // Upsert: Update if exists, insert if not
          const { error } = await supabase
            .from('schools_directory')
            .upsert(schoolData, {
              onConflict: 'name,postcode,state'
            });

          if (error) {
            errors.push(`${school.name}: ${error.message}`);
            skipped++;
          } else {
            updated++;
          }
        } else {
          // Insert only, skip if exists
          const { error } = await supabase
            .from('schools_directory')
            .insert(schoolData);

          if (error) {
            if (error.message.includes('duplicate key')) {
              skipped++;
            } else {
              errors.push(`${school.name}: ${error.message}`);
              skipped++;
            }
          } else {
            imported++;
          }
        }
      } catch (error: any) {
        errors.push(`${school.name}: ${error.message}`);
        skipped++;
      }
    }

    console.log(`✅ Import complete: ${imported} imported, ${updated} updated, ${skipped} skipped`);

    return new Response(JSON.stringify({ 
      success: true,
      summary: {
        total: validSchools.length,
        imported,
        updated,
        skipped,
        errors: errors.length
      },
      errors: errors.slice(0, 10), // Return first 10 errors
      message: `Successfully processed ${validSchools.length} schools`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('❌ Error in school data import:', error);
    return new Response(JSON.stringify({
      ...internalError(error, 'import-schools-data'),
      success: false,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
