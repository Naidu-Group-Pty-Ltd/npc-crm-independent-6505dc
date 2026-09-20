/**
 * Outbound messaging, served without a CRM vendor.
 *
 * ── What this replaces ──────────────────────────────────────────────────────
 *
 * `send-ghl-message` is the product's only outbound path — two callers,
 * `Conversations.tsx` and `ClientConversationsTab.tsx`. On a deployment with
 * no GoHighLevel account it reached the credential check and answered
 *
 *     500 { error: "GHL API key not configured" }
 *
 * writing NOTHING. Three things wrong with that here: a 500 reports a server
 * fault for a settled configuration, the operator gets no record they ever
 * tried, and the sentence names a vendor this product is not using.
 *
 * Worse are the sentences the vendor path CAN produce — "This contact does not
 * have a valid mobile number", "This contact has opted out of SMS
 * communications". On a deployment with no sender those are libel about
 * somebody's customer: the number is fine, and the reason nothing was
 * delivered is that there is nothing here to send with. The location service
 * already paid for this rule — `geocoder_unavailable` exists so a missing
 * provider is never reported as a bad address.
 *
 * ── The contract is the vendor's ────────────────────────────────────────────
 *
 * Same request body, same response keys, same `ghl_conversation_messages`
 * rows, for the reason `crm-calendar` gives: the callers are routed by
 * `crmFunction('sendMessage')` and do not otherwise change, so a later prime
 * cascade touching either file merges instead of conflicting.
 *
 * ── What it will NOT do ─────────────────────────────────────────────────────
 *
 * It refuses when `CRM_PROVIDER` is not `native`. Every clone receives the
 * prime's whole function set, so a GHL deployment can reach this URL on
 * nothing worse than a stale bundle — and answering it would put a message on
 * a Twilio account that deployment's operators never configured, against a
 * conversation the vendor also owns.
 *
 * And it never records a refusal as a delivery. `planMayRecordDelivery` is one
 * exported expression, asked rather than trusted, because a row claiming
 * delivery when nothing left the building is undiscoverable from the
 * operator's side and leaves a client waiting for a reply nobody sent.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import { refuseWrongProvider } from '../_shared/crm/crmProvider.ts';
import { rateLimit } from '../_shared/wp08Guards.ts';
import { logApiUsage } from '../_shared/logApiUsage.ts';
import { planNativeSend, planMayRecordDelivery } from '../_shared/crm/nativeOutbound.pure.ts';

/** The vendor path's ceiling, kept so the two providers accept the same input. */
const MAX_MESSAGE_LENGTH = 1600;

type SupportedChannel = 'sms' | 'whatsapp';

function resolveChannel(value: unknown): SupportedChannel | null {
  const channel = String(value || '').trim().toLowerCase();
  if (channel === 'sms') return 'sms';
  if (channel === 'whatsapp' || channel === 'whats_app') return 'whatsapp';
  return null;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  // Asked before anything is read: a GHL deployment reaching this URL is a
  // stale bundle, and the honest answer is that this is not its provider.
  const wrongProvider = refuseWrongProvider('native', corsHeaders);
  if (wrongProvider) return wrongProvider;

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json();
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) return createUnauthorizedResponse(authError, corsHeaders);

    const { conversationId, message, channel: requestedChannel, type, idempotencyKey } = body;
    if (!conversationId || !message) {
      return new Response(
        JSON.stringify({ error: 'conversationId and message are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const messageText = String(message);
    if (messageText.length > MAX_MESSAGE_LENGTH) {
      return new Response(
        JSON.stringify({ error: `Message exceeds ${MAX_MESSAGE_LENGTH}-character limit.` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    /*
     * WP-08 — the per-user send quota, and the sentence that describes it.
     *
     * The window is a MINUTE. This refusal read "Hourly message quota
     * exceeded", inherited verbatim from `send-ghl-message`, which still
     * carries it beside its own comment saying "sustained 100/min". A person
     * told to wait an hour waits an hour, so the wording was not a cosmetic
     * defect: it was the only thing the caller was given to act on.
     *
     * The sentence is composed from the SAME two values the gate is handed,
     * so it can never again describe a window this code does not implement —
     * the rule a literal at each end always breaks. The precise wait stays in
     * `Retry-After`; the body states the rule, the header states the delay.
     */
    const SEND_LIMIT = 60;
    const SEND_WINDOW_MS = 60_000;
    const minute = rateLimit(`crm-send-message:${userId}`, SEND_LIMIT, SEND_WINDOW_MS);
    if (!minute.allowed) {
      return new Response(JSON.stringify({
        error: `Message limit reached — ${SEND_LIMIT} messages per ${SEND_WINDOW_MS / 1000} seconds. Please try again shortly.`,
      }), {
        status: 429,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Retry-After': String(Math.ceil((minute.retryAfterMs || 1000) / 1000)),
        },
      });
    }

    const channel = resolveChannel(requestedChannel || type);
    if (!channel) {
      return new Response(JSON.stringify({ error: 'Unsupported CRM message channel.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: conv } = await supabase
      .from('ghl_conversations')
      .select('id, client_id')
      .eq('ghl_conversation_id', conversationId)
      .maybeSingle();
    if (!conv) {
      return new Response(JSON.stringify({ error: 'Conversation not found.' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    /*
      The vendor path is protected from a repeat by GoHighLevel's own
      `Idempotency-Key` header, which this one has no equivalent of. Without
      this guard a double-click puts two SMS on the wire, bills for both, and
      shows the client the same message twice.

      `message_status !== 'failed'` is the vendor path's condition verbatim: a
      send that FAILED should be retryable by the same key, which is the whole
      point of recording the refusal rather than returning nothing.
    */
    if (idempotencyKey) {
      const { data: already } = await supabase
        .from('ghl_conversation_messages')
        .select('ghl_message_id, message_status')
        .eq('client_request_id', idempotencyKey)
        .maybeSingle();
      if (already && already.message_status !== 'failed') {
        return new Response(
          JSON.stringify({ success: true, messageId: already.ghl_message_id, duplicate: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
    }

    // The destination is the client's own record. There is no contact store to
    // consult: `ghl_contacts` does not exist in this schema, and
    // `ghl_conversations` carries a vendor contact id that addresses nothing
    // here.
    let destination: string | null = null;
    if (conv.client_id) {
      const { data: client } = await supabase
        .from('clients').select('primary_mobile').eq('id', conv.client_id).maybeSingle();
      destination = client?.primary_mobile ?? null;
    }

    const plan = planNativeSend({
      channel,
      to: destination,
      env: {
        TWILIO_ACCOUNT_SID: Deno.env.get('TWILIO_ACCOUNT_SID'),
        TWILIO_AUTH_TOKEN: Deno.env.get('TWILIO_AUTH_TOKEN'),
        TWILIO_FROM_NUMBER: Deno.env.get('TWILIO_FROM_NUMBER'),
      },
    });

    if (plan.act === 'refuse') {
      if (idempotencyKey && !planMayRecordDelivery(plan)) {
        const { error: rowError } = await supabase.from('ghl_conversation_messages').upsert({
          ghl_message_id: `failed-${idempotencyKey}`,
          client_request_id: idempotencyKey,
          conversation_id: conv.id,
          direction: 'outbound', body: messageText, channel_type: channel,
          message_status: 'failed', error_message: plan.message,
          ghl_date_added: new Date().toISOString(),
        }, { onConflict: 'ghl_message_id' });
        if (rowError) console.error('[crm-send-message] refusal row not written:', rowError.message);
      }
      // 400 rather than 500: nothing failed. `not_configured` is a settled
      // state of this deployment and a 5xx would put it in an error budget it
      // does not belong in.
      return new Response(
        JSON.stringify({ error: plan.message, remedy: plan.remedy, reason: plan.kind }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const sid = Deno.env.get('TWILIO_ACCOUNT_SID')!;
    const twilioRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${sid}:${Deno.env.get('TWILIO_AUTH_TOKEN')}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: plan.to,
          From: Deno.env.get('TWILIO_FROM_NUMBER')!,
          Body: messageText,
        }),
      },
    );
    const twilioBody = await twilioRes.json().catch(() => ({}));

    if (!twilioRes.ok) {
      // The carrier refused a real send, so HERE the message may be about the
      // contact — it came from the provider rather than from us.
      const detail = typeof twilioBody?.message === 'string'
        ? twilioBody.message
        : 'The SMS provider rejected this message.';
      if (idempotencyKey) {
        await supabase.from('ghl_conversation_messages').upsert({
          ghl_message_id: `failed-${idempotencyKey}`,
          client_request_id: idempotencyKey,
          conversation_id: conv.id,
          direction: 'outbound', body: messageText, channel_type: channel,
          message_status: 'failed', error_message: detail,
          ghl_date_added: new Date().toISOString(),
        }, { onConflict: 'ghl_message_id' });
      }
      return new Response(JSON.stringify({ error: detail }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const providerId = typeof twilioBody?.sid === 'string' ? twilioBody.sid : null;
    await supabase.from('ghl_conversation_messages').upsert({
      ghl_message_id: providerId ?? `twilio-${idempotencyKey ?? crypto.randomUUID()}`,
      client_request_id: idempotencyKey ?? null,
      conversation_id: conv.id,
      direction: 'outbound', body: messageText, channel_type: channel,
      message_status: 'sent',
      ghl_date_added: new Date().toISOString(),
    }, { onConflict: 'ghl_message_id' });

    // Metered like every other vendor call. `twilio` is deliberately absent
    // from `apiUsageBilling.pure.ts`, so this records and bills nobody — which
    // is correct rather than an omission: a native deployment supplies its own
    // Twilio account, and a key the workspace supplies itself is charged at
    // nothing. Guessing a credential here would bill the wrong tenant, which
    // that module exists to refuse.
    await logApiUsage(supabase, {
      service_name: 'twilio',
      endpoint: '/Messages.json',
      status: 'success',
      model_used: 'rest-api',
      user_id: userId!,
      metadata: {
        channel,
        conversation_id: conv.id,
        client_id: conv.client_id || null,
        provider_message_id: providerId,
        message_length: messageText.length,
      },
    });

    return new Response(JSON.stringify({ success: true, messageId: providerId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[crm-send-message]', e instanceof Error ? e.message : e);
    return new Response(JSON.stringify({ error: 'Could not send the message.' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
