import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createUnauthorizedResponse, createCorsHeaders } from "../_shared/auth.ts";

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
type Operation = 'get' | 'upsert';

interface PrefsPatch {
  default_scope?: 'address' | 'suburb' | 'zipcode' | 'state';
  default_tier?: 'compass' | 'strategic' | 'briefing' | 'snapshot';
  last_used_scope?: 'address' | 'suburb' | 'zipcode' | 'state';
  last_used_tier?: 'compass' | 'strategic' | 'briefing' | 'snapshot';
}

interface RequestBody {
  operation: Operation;
  data?: PrefsPatch;
  session_token?: string;
}

const ALLOWED_SCOPES = ['address', 'suburb', 'zipcode', 'state'];
const ALLOWED_TIERS = ['compass', 'strategic', 'briefing', 'snapshot'];

function sanitize(patch: PrefsPatch | undefined): PrefsPatch {
  if (!patch) return {};
  const out: PrefsPatch = {};
  if (patch.default_scope && ALLOWED_SCOPES.includes(patch.default_scope)) out.default_scope = patch.default_scope;
  if (patch.default_tier && ALLOWED_TIERS.includes(patch.default_tier)) out.default_tier = patch.default_tier;
  if (patch.last_used_scope && ALLOWED_SCOPES.includes(patch.last_used_scope)) out.last_used_scope = patch.last_used_scope;
  if (patch.last_used_tier && ALLOWED_TIERS.includes(patch.last_used_tier)) out.last_used_tier = patch.last_used_tier;
  return out;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') || '';
  const corsHeaders = createCorsHeaders(origin);
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body: RequestBody = await req.json();
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError || !userId) return createUnauthorizedResponse(authError || 'Missing user', corsHeaders);

    const { operation } = body;
    if (operation === 'get') {
      const { data, error } = await supabase
        .from('report_generation_preferences')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      return new Response(
        JSON.stringify({ success: true, preferences: data ?? null }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (operation === 'upsert') {
      const patch = sanitize(body.data);
      if (Object.keys(patch).length === 0) {
        return new Response(
          JSON.stringify({ success: false, error: 'No valid fields to update' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const row: Record<string, unknown> = { user_id: userId, ...patch };
      if (patch.last_used_scope || patch.last_used_tier) row.last_used_at = new Date().toISOString();

      const { data, error } = await supabase
        .from('report_generation_preferences')
        .upsert(row, { onConflict: 'user_id' })
        .select()
        .single();
      if (error) throw error;
      return new Response(
        JSON.stringify({ success: true, preferences: data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: `Invalid operation: ${operation}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error('[manage-report-preferences] Error:', e);
    return new Response(
      JSON.stringify({ ...internalError(e, 'manage-report-preferences'), success: false }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
