/**
 * Partner consent portal — PUBLIC token surface (Phase 3)
 *
 * A referred client opens /partner-consent/{token} and signs the consent
 * statement themselves. There is no account and no session: the opaque
 * 32-byte token is the only credential, and only its SHA-256 digest is stored.
 *
 * Exposure controls:
 *   • token must match a pending/viewed, unexpired request;
 *   • the response never carries internal notes, eligibility, commercial terms
 *     or any other referral field beyond what the client is being asked about;
 *   • a signed / declined / revoked request is terminal — replaying the token
 *     cannot flip the decision back.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createCorsHeaders } from '../_shared/auth.ts';
import { hashConsentToken, isConsentRequestLive } from '../_shared/partnerConsent.ts';
import { readBoundedJson } from '../_shared/validate.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const REQUESTS = 'partner_consent_requests';
const REFERRALS = 'partner_referrals';
const EVENTS = 'partner_referral_events';

function json(body: unknown, corsHeaders: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function clientIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  return fwd ? fwd.split(',')[0].trim() : null;
}

/** Everything the signing page is allowed to see. */
function publicView(request: Record<string, any>, referral: Record<string, any> | null) {
  return {
    id: request.id,
    status: request.status,
    statement_version: request.statement_version,
    statement_text: request.statement_text,
    disclosure_text: request.disclosure_text,
    recipient_name: request.recipient_name,
    expires_at: request.expires_at,
    signed_at: request.signed_at,
    signature_name: request.signature_name,
    reference: referral?.reference ?? null,
    direction: referral?.direction ?? null,
    client_first_name: referral?.client_first_name ?? null,
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  // CORS-CONTRACT: the canonical allowlist comes from `createCorsHeaders`.
  // The local literal this replaced dropped every custom header — including
  // `x-correlation-id` — so any caller attaching one failed the preflight.
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = await readBoundedJson(req).catch(() => ({}));
    const action = String(body?.action ?? '');
    const token = String(body?.token ?? '').trim();

    if (!token || token.length < 32 || !/^[a-f0-9]+$/i.test(token)) {
      return json({ error: 'invalid_token' }, corsHeaders, 400);
    }

    const tokenHash = await hashConsentToken(token);
    const { data: request } = await supabase.from(REQUESTS).select('*').eq('token_hash', tokenHash).maybeSingle();
    if (!request) return json({ error: 'invalid_token' }, corsHeaders, 404);

    const { data: referral } = await supabase
      .from(REFERRALS)
      .select('id, reference, direction, client_first_name, client_surname')
      .eq('id', request.referral_id)
      .maybeSingle();

    // Lazily retire an expired link so the client sees the true state.
    if (['pending', 'viewed'].includes(request.status) && new Date(request.expires_at).getTime() <= Date.now()) {
      await supabase.from(REQUESTS).update({ status: 'expired' }).eq('id', request.id);
      request.status = 'expired';
    }

    if (action === 'view') {
      if (request.status === 'pending') {
        await supabase.from(REQUESTS)
          .update({ status: 'viewed', first_viewed_at: request.first_viewed_at ?? new Date().toISOString() })
          .eq('id', request.id);
        request.status = 'viewed';
        request.first_viewed_at = request.first_viewed_at ?? new Date().toISOString();
        await supabase.from(EVENTS).insert({
          referral_id: request.referral_id,
          event_type: 'consent_viewed',
          actor_surface: 'consent_link',
          summary: 'Client opened the consent request',
          payload: { consent_request_id: request.id },
        });
      }
      return json({ request: publicView(request, referral) }, corsHeaders);
    }

    if (action === 'sign' || action === 'decline') {
      if (!isConsentRequestLive(request)) {
        return json({
          error: 'request_not_live',
          message: request.status === 'signed'
            ? 'This consent has already been provided.'
            : 'This consent link is no longer active. Please contact us for a new link.',
          request: publicView(request, referral),
        }, corsHeaders, 409);
      }

      const now = new Date().toISOString();
      const ip = clientIp(req);
      const ua = req.headers.get('user-agent')?.slice(0, 400) ?? null;

      if (action === 'decline') {
        const { data: updated } = await supabase.from(REQUESTS)
          .update({ status: 'declined', declined_at: now, signature_ip: ip, signature_user_agent: ua })
          .eq('id', request.id).select().single();
        await supabase.from(EVENTS).insert({
          referral_id: request.referral_id,
          event_type: 'consent_declined',
          actor_surface: 'consent_link',
          summary: 'Client declined the referral consent',
          payload: { consent_request_id: request.id },
        });
        return json({ request: publicView(updated ?? request, referral) }, corsHeaders);
      }

      const typed = String(body?.signature_name ?? '').trim();
      if (typed.length < 2) return json({ error: 'signature_required', message: 'Type your full name to sign.' }, corsHeaders, 400);

      const { data: updated } = await supabase.from(REQUESTS)
        .update({
          status: 'signed',
          signed_at: now,
          signature_name: typed,
          signature_typed: typed,
          signature_ip: ip,
          signature_user_agent: ua,
        })
        .eq('id', request.id).select().single();

      await supabase.from(REFERRALS).update({
        consent_obtained: true,
        consent_obtained_at: now,
        consent_method: 'digital_link',
        consent_request_id: request.id,
      }).eq('id', request.referral_id);

      await supabase.from(EVENTS).insert({
        referral_id: request.referral_id,
        event_type: 'consent_signed',
        actor_surface: 'consent_link',
        actor_label: typed,
        summary: `Client signed the consent statement (${request.statement_version})`,
        payload: { consent_request_id: request.id, statement_version: request.statement_version },
      });

      return json({ request: publicView(updated ?? request, referral) }, corsHeaders);
    }

    return json({ error: 'unknown_action' }, corsHeaders, 400);
  } catch (err) {
    console.error('[partner-consent-portal] error:', err);
    return json({ error: 'internal_error' }, corsHeaders, 500);
  }
});
