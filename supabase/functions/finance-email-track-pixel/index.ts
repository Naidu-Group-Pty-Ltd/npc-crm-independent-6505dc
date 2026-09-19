/**
 * Finance Portal — Email open tracking pixel (WP-10 hardened).
 *
 * Public GET endpoint returns a 1x1 transparent GIF.
 *   * Unknown tokens NEVER create stub rows (fixes stub-row exhaustion vector).
 *   * Token must resolve to an existing authoritative outbound message.
 *   * Per-IP + per-token rate limits.
 *   * Response is always the pixel — no observable success/failure signal.
 *   * IP/UA columns are still stored but capped in length.
 */
import { createClient } from "npm:@supabase/supabase-js@2.55.0";
import { enforceIpQuota, enforceKeyQuota, getClientIp } from "../_shared/publicAbuseControls.ts";

const PIXEL_BASE64 = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const PIXEL_BYTES = Uint8Array.from(atob(PIXEL_BASE64), c => c.charCodeAt(0));

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

const respondPixel = () => new Response(PIXEL_BYTES, {
  status: 200,
  headers: {
    ...corsHeaders,
    'Content-Type': 'image/gif',
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Pragma': 'no-cache',
  },
});

const VALID_TOKEN = /^[A-Za-z0-9_\-]{16,128}$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const token = url.searchParams.get('t');

  // Always return pixel regardless of downstream outcome.
  if (!token || !VALID_TOKEN.test(token)) return respondPixel();

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const ip = getClientIp(req);
  // Silent rate limits (still return pixel to caller).
  if (!(await enforceIpQuota(supabase, ip, 'email_pixel', { limit: 120, windowMs: 60_000 })).ok) return respondPixel();
  if (!(await enforceKeyQuota(supabase, token, 'email_pixel_token', { limit: 30, windowMs: 60 * 60_000 })).ok) return respondPixel();

  try {

    // Authoritative outbound row — REQUIRED. No stub rows are ever created.
    const { data: outbound } = await supabase
      .from('finance_outbound_messages')
      .select('id, client_id, purchase_file_id, finance_contact_id, recipient, subject')
      .eq('tracking_token', token)
      .maybeSingle();

    if (!outbound) {
      // Unknown token: do not persist anything. Prevents storage-exhaustion by
      // forged token sprays.
      return respondPixel();
    }

    const uaRaw = req.headers.get('user-agent') || null;
    const ua = uaRaw ? uaRaw.slice(0, 500) : null;
    const now = new Date().toISOString();

    const { data: existing } = await supabase
      .from('finance_email_opens')
      .select('id, open_count, opened_at')
      .eq('tracking_token', token)
      .maybeSingle();

    if (existing) {
      await supabase.from('finance_email_opens').update({
        opened_at: existing.opened_at ?? now,
        open_count: (existing.open_count ?? 0) + 1,
        last_ip: ip,
        last_user_agent: ua,
      }).eq('id', existing.id);
    } else {
      await supabase.from('finance_email_opens').insert({
        tracking_token: token,
        ghl_message_id: outbound.id,
        client_id: outbound.client_id ?? null,
        purchase_file_id: outbound.purchase_file_id ?? null,
        finance_contact_id: outbound.finance_contact_id ?? null,
        recipient_email: outbound.recipient ?? null,
        subject: outbound.subject ?? null,
        opened_at: now,
        open_count: 1,
        last_ip: ip,
        last_user_agent: ua,
      });
    }

    await supabase.from('finance_outbound_messages')
      .update({ read_at: now, status: 'read' })
      .eq('tracking_token', token)
      .is('read_at', null);
  } catch (err) {
    console.error('[finance-email-track-pixel] error', err);
  }

  return respondPixel();
});
