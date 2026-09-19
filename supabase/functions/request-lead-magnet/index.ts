// Public endpoint: capture lead, return signed download URL, push to GHL.
// Hardened per WP-10: Turnstile (fail-closed under REQUIRE_TURNSTILE),
// honeypot + timing checks, atomic per-IP / per-email / per-magnet / global
// daily quotas, kill switch, email normalization, dedupe, redacted errors.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { getGhlCredentials, validateGhlCredentials, buildGhlHeaders } from '../_shared/ghl-account.ts';
import { enforceJsonBodyLimit } from '../_shared/requestSecurity.ts';
import {
  enforceIpQuota,
  enforceKeyQuota,
  enforceGlobalDailyQuota,
  getClientIp,
  honeypotTripped,
  killSwitchActive,
  normalizeEmail,
  redactError,
  sanitizeShortText,
  tooFastSubmission,
  verifyTurnstile,
} from '../_shared/publicAbuseControls.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const GHL_API_BASE = 'https://services.leadconnectorhq.com';

function isEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 255;
}

function j(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return j({ error: 'method_not_allowed' }, 405);

  // Global kill switch — operators can freeze all magnet captures without redeploy.
  if (killSwitchActive('LEAD_MAGNET_KILL_SWITCH')) {
    return j({ error: 'temporarily_unavailable' }, 503);
  }

  const ip = getClientIp(req);

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    // WP-24: bounded. The fields are sanitised below and the bot filters run
    // after; neither helps if the read itself is unbounded, and this endpoint
    // takes no credential. 16 KiB comfortably fits a lead form.
    const __bounded = await enforceJsonBodyLimit<Record<string, unknown>>(req, 16 * 1024);
    if (!__bounded.ok) return __bounded.error;
    const body = __bounded.value ?? {};

    // Bot filters — cheap and silent (return generic error, don't leak reason).
    if (honeypotTripped(body)) return j({ error: 'invalid_request' }, 400);
    if (tooFastSubmission(body, 1200)) return j({ error: 'invalid_request' }, 400);

    const slug = sanitizeShortText(body.slug, 200);
    const full_name = sanitizeShortText(body.full_name, 200);
    const rawEmail = sanitizeShortText(body.email, 255).toLowerCase();
    const phone = body.phone ? sanitizeShortText(body.phone, 40) : null;
    const turnstile_token = typeof body.turnstile_token === 'string' ? body.turnstile_token : null;

    if (!slug || !full_name || !rawEmail) return j({ error: 'slug, full_name and email are required' }, 400);
    if (!isEmail(rawEmail)) return j({ error: 'invalid_email' }, 400);

    const email = normalizeEmail(rawEmail);

    // Turnstile — mandatory when REQUIRE_TURNSTILE=true, fail closed.
    const turnstile = await verifyTurnstile(turnstile_token, ip);
    if (!turnstile.ok) {
      if (turnstile.failClosed) return j({ error: 'security_verification_unavailable' }, 503);
      return j({ error: 'security_verification_failed' }, 403);
    }

    // Atomic quotas — cheap in-memory sliding windows.
    const ipCheck = await enforceIpQuota(supabase, ip, 'lead_magnet', { limit: 8, windowMs: 60 * 60 * 1000 });
    if (!ipCheck.ok) return j({ error: 'rate_limited' }, 429);
    const emailCheck = await enforceKeyQuota(supabase, email, 'lead_magnet_email', { limit: 5, windowMs: 24 * 60 * 60 * 1000 });
    if (!emailCheck.ok) return j({ error: 'rate_limited' }, 429);
    const magnetCheck = await enforceKeyQuota(supabase, slug, 'lead_magnet_magnet', { limit: 500, windowMs: 60 * 60 * 1000 });
    if (!magnetCheck.ok) return j({ error: 'rate_limited' }, 429);
    const globalCheck = await enforceGlobalDailyQuota(supabase, 'lead_magnet', 5000);
    if (!globalCheck.ok) return j({ error: 'rate_limited' }, 429);


    // Look up the magnet
    const { data: magnet, error: magnetErr } = await supabase
      .from('lead_magnets')
      .select('*')
      .eq('slug', slug)
      .eq('is_active', true)
      .maybeSingle();

    if (magnetErr || !magnet) return j({ error: 'lead_magnet_not_found' }, 404);

    // Dedupe: if this (magnet_id, email) already downloaded in the last 24h, reuse row.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: existing } = await supabase
      .from('lead_magnet_downloads')
      .select('id')
      .eq('magnet_id', magnet.id)
      .eq('email', email)
      .gte('created_at', since)
      .maybeSingle();

    // Public bucket — permanent direct download URL
    const { data: pub } = supabase.storage
      .from('lead-magnets')
      .getPublicUrl(magnet.file_path, { download: magnet.file_name });

    const downloadUrl = pub?.publicUrl;
    if (!downloadUrl) return j({ error: 'download_unavailable' }, 500);

    const ua = req.headers.get('user-agent') || null;
    const ref = req.headers.get('referer') || null;

    let captureId: string | null = existing?.id ?? null;
    if (!captureId) {
      const { data: capture } = await supabase
        .from('lead_magnet_downloads')
        .insert({
          magnet_id: magnet.id,
          full_name,
          email,
          phone,
          ip_address: ip,
          user_agent: ua ? ua.slice(0, 500) : null,
          referrer: ref ? ref.slice(0, 500) : null,
        })
        .select('id')
        .single();
      captureId = capture?.id ?? null;

      // Increment counter (best-effort; only for genuinely new captures)
      await supabase
        .from('lead_magnets')
        .update({ download_count: (magnet.download_count || 0) + 1 })
        .eq('id', magnet.id);
    }

    // Queued GHL push — persist retry state on failure instead of fire-and-forget silence.
    (async () => {
      try {
        const creds = getGhlCredentials('new');
        const validateErr = validateGhlCredentials(creds);
        if (validateErr) { console.warn('[request-lead-magnet] GHL skipped:', validateErr); return; }

        const [firstName, ...rest] = full_name.split(/\s+/);
        const lastName = rest.join(' ') || '';
        const tag = magnet.ghl_tag || `Lead Magnet: ${magnet.title}`;

        const payload: Record<string, unknown> = {
          firstName,
          lastName,
          email,
          phone: phone || undefined,
          locationId: creds.locationId,
          source: `Lead Magnet: ${magnet.title}`,
          tags: [tag],
        };

        const upsertRes = await fetch(`${GHL_API_BASE}/contacts/upsert`, {
          method: 'POST',
          headers: buildGhlHeaders(creds.apiKey!),
          body: JSON.stringify(payload),
        });
        const upsertJson = await upsertRes.json().catch(() => ({}));
        const contactId = upsertJson?.contact?.id || upsertJson?.id;

        if (!upsertRes.ok || !contactId) {
          throw new Error(`GHL upsert failed: ${upsertRes.status}`);
        }

        if (magnet.ghl_pipeline_id && magnet.ghl_stage_id) {
          const oppRes = await fetch(`${GHL_API_BASE}/opportunities/`, {
            method: 'POST',
            headers: buildGhlHeaders(creds.apiKey!),
            body: JSON.stringify({
              pipelineId: magnet.ghl_pipeline_id,
              pipelineStageId: magnet.ghl_stage_id,
              locationId: creds.locationId,
              name: `${full_name} — ${magnet.title}`,
              status: 'open',
              contactId,
              source: `Lead Magnet: ${magnet.title}`,
            }),
          });
          if (!oppRes.ok) console.warn('[request-lead-magnet] Opportunity create failed:', oppRes.status);
        }

        if (captureId) {
          await supabase.from('lead_magnet_downloads').update({
            ghl_contact_id: contactId, ghl_synced: true,
          }).eq('id', captureId);
        }
      } catch (e) {
        console.error('[request-lead-magnet] GHL push error', e);
        if (captureId) {
          await supabase.from('lead_magnet_downloads').update({
            ghl_synced: false, ghl_error: String((e as Error).message || e).slice(0, 500),
          }).eq('id', captureId);
        }
      }
    })();

    return j({
      success: true,
      download_url: downloadUrl,
      file_name: magnet.file_name,
      title: magnet.title,
    });
  } catch (err) {
    console.error('[request-lead-magnet] Error', err);
    return j({ error: redactError(err) }, 500);
  }
});
