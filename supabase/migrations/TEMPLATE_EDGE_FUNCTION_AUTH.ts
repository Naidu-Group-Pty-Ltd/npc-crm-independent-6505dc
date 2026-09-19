/**
 * Template for Adding JWT Authentication to Edge Functions
 * 
 * Instructions:
 * 1. Copy this template to your edge function
 * 2. Replace [FUNCTION_NAME] with actual function name
 * 3. Customize authentication requirements
 * 4. Add role checks if needed (admin, superadmin)
 * 5. Test thoroughly before deploying
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ============================================
// CONFIGURATION
// ============================================
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

// Authentication requirements
const REQUIRES_AUTH = true; // Set to false for public endpoints
const REQUIRES_ADMIN = false; // Set to true if admin role required
const REQUIRES_SUPERADMIN = false; // Set to true if superadmin required

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Extract JWT token from request
 */
function extractToken(req: Request): string | null {
  const authHeader = req.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return null;
}

/**
 * Verify JWT and get user
 */
async function verifyAuth(token: string | null): Promise<{ user: any; error: string | null }> {
  if (!token) {
    return { user: null, error: 'No token provided' };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  
  if (error || !user) {
    return { user: null, error: error?.message || 'Invalid token' };
  }

  return { user, error: null };
}

/**
 * Check if user has admin role
 */
async function isAdmin(userId: string): Promise<boolean> {
  const supabase = createClient(
    SUPABASE_URL,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data, error } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .in('role', ['admin', 'superadmin'])
    .single();

  return !error && !!data;
}

/**
 * Check if user has superadmin role
 */
async function isSuperAdmin(userId: string): Promise<boolean> {
  const supabase = createClient(
    SUPABASE_URL,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data, error } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('role', 'superadmin')
    .single();

  return !error && !!data;
}

/**
 * Create CORS headers
 */
function createCorsHeaders(origin: string | null): Record<string, string> {
  const allowedOrigins = [
    'https://npc-property-dashbord.lovable.app',
    'http://localhost:8080',
  ];

  const allowedOrigin = origin && allowedOrigins.includes(origin)
    ? origin
    : allowedOrigins[0];

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Credentials': 'true',
    'Content-Type': 'application/json',
  };
}

/**
 * Create error response
 */
function createErrorResponse(
  message: string,
  status: number,
  corsHeaders: Record<string, string>
): Response {
  return new Response(
    JSON.stringify({ error: message, success: false }),
    { status, headers: corsHeaders }
  );
}

// ============================================
// MAIN FUNCTION
// ============================================

serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ============================================
    // AUTHENTICATION CHECK
    // ============================================
    if (REQUIRES_AUTH) {
      const token = extractToken(req);
      const { user, error: authError } = await verifyAuth(token);

      if (authError || !user) {
        return createErrorResponse(
          authError || 'Authentication required',
          401,
          corsHeaders
        );
      }

      // ============================================
      // ROLE-BASED ACCESS CONTROL
      // ============================================
      if (REQUIRES_SUPERADMIN) {
        const isSuper = await isSuperAdmin(user.id);
        if (!isSuper) {
          return createErrorResponse(
            'Superadmin access required',
            403,
            corsHeaders
          );
        }
      } else if (REQUIRES_ADMIN) {
        const isAdminUser = await isAdmin(user.id);
        if (!isAdminUser) {
          return createErrorResponse(
            'Admin access required',
            403,
            corsHeaders
          );
        }
      }

      // User is authenticated and authorized
      // Continue with function logic...
      console.log(`[FUNCTION_NAME] Authenticated user: ${user.id}`);
    }

    // ============================================
    // FUNCTION LOGIC
    // ============================================
    // Add your function logic here
    // Access user via: user (if authenticated)
    // Access request body via: await req.json()

    const body = await req.json();
    
    // Example: Get Supabase client with service role for database operations
    const supabase = createClient(
      SUPABASE_URL,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Your business logic here...
    // const { data, error } = await supabase.from('table').select('*');

    // ============================================
    // SUCCESS RESPONSE
    // ============================================
    return new Response(
      JSON.stringify({
        success: true,
        data: {}, // Your response data
      }),
      { headers: corsHeaders }
    );

  } catch (error: any) {
    console.error('[FUNCTION_NAME] Error:', error);
    return createErrorResponse(
      error.message || 'Internal server error',
      500,
      corsHeaders
    );
  }
});

// ============================================
// NOTES:
// ============================================
// 1. Set verify_jwt: true when deploying
// 2. Test with valid JWT token
// 3. Test with invalid/expired token
// 4. Test role-based access
// 5. Test CORS from allowed origins
// 6. Test error handling
// 7. Add logging for security events

