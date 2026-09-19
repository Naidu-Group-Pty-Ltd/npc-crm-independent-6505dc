// One-shot bootstrap: populate Vault with the service-role key + INTERNAL_EDGE_SECRET
// so pg_cron jobs can authenticate to fail-closed edge functions.
//
// Security posture:
// - Deployed with verify_jwt=false but requires both a valid superadmin JWT and
//   the internal handshake header.
// - Refuses to run once the Vault already contains supabase_service_role_key
//   (idempotent, single-use). Subsequent calls no-op with 409.
// - Never returns the secret values themselves.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createCorsHeaders } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
  const INTERNAL_EDGE_SECRET = Deno.env.get('INTERNAL_EDGE_SECRET');

  if (!SERVICE_ROLE || !ANON || !INTERNAL_EDGE_SECRET) {
    return new Response(JSON.stringify({ error: 'server_env_missing' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Handshake: caller must echo the configured internal secret.
  const handshake = req.headers.get('x-bootstrap-handshake');
  if (handshake !== INTERNAL_EDGE_SECRET) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const token = authHeader.slice('Bearer '.length);
  const userClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: claims, error: claimsError } = await userClient.auth.getClaims(token);
  if (claimsError || !claims?.claims?.sub) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: isSuperadmin, error: roleError } = await admin.rpc('has_role', {
    _user_id: claims.claims.sub,
    _role: 'superadmin',
  });
  if (roleError || !isSuperadmin) {
    return new Response(JSON.stringify({ error: 'forbidden' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Idempotency: refuse if already bootstrapped.
  const { data: probe, error: probeError } = await admin
    .from('cron_vault_bootstrap_marker')
    .select('bootstrapped_at')
    .limit(1)
    .maybeSingle();

  if (probeError) {
    return new Response(JSON.stringify({ error: probeError.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (probe?.bootstrapped_at) {
    return new Response(JSON.stringify({ error: 'already_bootstrapped', at: probe.bootstrapped_at }), {
      status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { error } = await admin.rpc('bootstrap_cron_vault', {
    p_service_role_key: SERVICE_ROLE,
    p_internal_edge_secret: INTERNAL_EDGE_SECRET,
  });
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { error: markerError } = await admin
    .from('cron_vault_bootstrap_marker')
    .insert({ bootstrapped_at: new Date().toISOString() });
  if (markerError) {
    return new Response(JSON.stringify({ error: markerError.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true, stored: ['supabase_service_role_key', 'internal_edge_secret', 'supabase_url'] }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
