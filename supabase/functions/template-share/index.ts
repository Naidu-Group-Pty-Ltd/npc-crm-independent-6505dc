/**
 * template-share — public preview endpoint for `report_templates` via share token.
 *
 * WP-10 hardening:
 *   * Per-IP + per-token rate limits on resolve.
 *   * Minimal public projection (no owner_id / share_link internals leaked).
 *   * Token format is validated (fixed-length allowlist).
 *   * Redacted error messages.
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { enforceIpQuota, enforceKeyQuota, getClientIp, redactError } from '../_shared/publicAbuseControls.ts';
import { withRequestOrigin } from '../_shared/corsOrigin.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const VALID_TOKEN = /^[A-Za-z0-9_\-]{12,128}$/;

function j(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const __corsWrappedHandler = async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'GET') return j({ error: 'method not allowed' }, 405);

  const url = new URL(req.url);
  const token = (url.searchParams.get('token') || '').trim();
  if (!token || !VALID_TOKEN.test(token)) return j({ error: 'token required' }, 400);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const ip = getClientIp(req);
  if (!(await enforceIpQuota(supabase, ip, 'template_share', { limit: 60, windowMs: 60_000 })).ok) return j({ error: 'rate_limited' }, 429);
  if (!(await enforceKeyQuota(supabase, token, 'template_share_token', { limit: 300, windowMs: 60 * 60_000 })).ok) return j({ error: 'rate_limited' }, 429);


  try {
    const { data: link, error: linkErr } = await supabase
      .from('template_share_links')
      .select('id, template_id, mode, theme_id, expires_at, revoked_at, label, view_count')
      .eq('token', token)
      .maybeSingle();

    if (linkErr || !link) return j({ error: 'link not found' }, 404);
    if (link.revoked_at) return j({ error: 'link revoked' }, 410);
    if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) return j({ error: 'link expired' }, 410);

    const { data: tpl, error: tplErr } = await supabase
      .from('report_templates')
      .select('id, name, description, schema, custom_css')
      .eq('id', link.template_id)
      .maybeSingle();

    if (tplErr || !tpl) return j({ error: 'template missing' }, 404);

    // Fire-and-forget view counter + analytics event
    supabase
      .from('template_share_links')
      .update({ view_count: (link.view_count ?? 0) + 1, last_viewed_at: new Date().toISOString() })
      .eq('id', link.id)
      .then(() => {}, () => {});

    supabase
      .from('template_events')
      .insert({
        template_id: link.template_id,
        event_type: 'share_view',
        share_token: token,
        metadata: {
          mode: link.mode,
          label: link.label,
          user_agent: (req.headers.get('user-agent') || '').slice(0, 200),
          ip: ip ?? null,
        },
      })
      .then(() => {}, () => {});

    return j({
      template: tpl,
      link: {
        mode: link.mode,
        theme_id: link.theme_id,
        label: link.label,
        expires_at: link.expires_at,
      },
    });
  } catch (e) {
    console.error('[template-share]', e instanceof Error ? e.message : String(e));
    return j({ error: redactError(e) }, 500);
  }
};

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. This function is browser-reachable and its callers
// send `credentials: 'include'`, and the Fetch spec makes the browser reject a
// credentialed response carrying `Access-Control-Allow-Origin: *` — opaquely,
// as "Failed to fetch". See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));

