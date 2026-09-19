/**
 * A client's reply, arriving on a deployment with no CRM vendor.
 *
 * ── The half that was missing ───────────────────────────────────────────────
 *
 * `crm-send-message` gave a native deployment an outbound path. Inbound had
 * none: under `ghl` a reply reaches `ghl-webhook-receiver`, and under `native`
 * nothing was listening, so every native thread was a transcript of one side
 * talking. `CRM_INDEPENDENCE.md` said so — "Nothing fills `ghl_conversations`.
 * A client's reply arrives nowhere."
 *
 * ── This one is a webhook, and that changes what matters ────────────────────
 *
 * Every other `crm-*` function is called by a signed-in operator behind
 * `verify_jwt`. This one declares `verify_jwt = false` because Twilio holds no
 * Supabase JWT, which makes it publicly reachable and makes
 * `X-Twilio-Signature` the only thing between the open internet and a row in a
 * customer's conversation.
 *
 * So the ORDER is the guarantee, and `nativeInbound.pure.ts` decides it rather
 * than this file: verify, then place, then write. **A deployment with no
 * `TWILIO_AUTH_TOKEN` refuses everything** — the token IS the verification
 * key, so without it this endpoint cannot tell Twilio from anybody who found
 * the URL, and accepting on that basis is an open write endpoint into customer
 * records. `STEP_UP_ENFORCED` is fail-closed when unset for the same reason.
 *
 * ── Every refusal answers the same way ──────────────────────────────────────
 *
 * One status, one word, whatever went wrong. A webhook that tells one prober
 * "no auth token configured" and another "bad signature" has described its own
 * configuration and confirmed the endpoint is worth grinding at. The operator
 * gets the distinction in the function log, where the reader is trusted.
 *
 * ── What it deliberately does not do ────────────────────────────────────────
 *
 * It creates no client. A message from a number this deployment does not know
 * is still recorded, against a conversation carrying the number and a null
 * `client_id` — because inventing a client record from an SMS is how a CRM
 * fills up with people nobody added, and an operator can link it by hand.
 * Nothing here decides who somebody is.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { servingCrmProvider } from '../_shared/crm/crmProvider.ts';
import {
  INBOUND_REFUSAL_BODY,
  INBOUND_REFUSAL_STATUS,
  planInboundMessage,
  twilioSignatureBase,
} from '../_shared/crm/nativeInbound.pure.ts';

/**
 * Twilio signs with HMAC-SHA1 over the URL plus sorted parameters. SHA-1 is
 * the provider's choice rather than ours — it is what `X-Twilio-Signature` IS,
 * and a different digest simply would not verify.
 */
async function signatureMatches(
  authToken: string,
  url: string,
  params: Readonly<Record<string, string>>,
  supplied: string,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(authToken),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(twilioSignatureBase(url, params)),
  );
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  // Compared in constant time over a fixed run, so neither a wrong length nor
  // a wrong value is distinguishable by how long the answer took.
  if (expected.length !== supplied.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  }
  return diff === 0;
}

function refuse(reason: string): Response {
  console.error('[crm-inbound-message] refused:', reason);
  return new Response(INBOUND_REFUSAL_BODY, { status: INBOUND_REFUSAL_STATUS });
}

Deno.serve(async (req) => {
  // No CORS preflight branch: a browser never calls this, and answering one
  // would advertise the endpoint to anything that probes it.
  if (req.method !== 'POST') return refuse(`method ${req.method}`);

  // A GHL deployment must not take a reply into tables its operators never
  // open. Refused in the same words as everything else, for the same reason.
  if (servingCrmProvider() !== 'native') return refuse('provider is not native');

  const params: Record<string, string> = {};
  try {
    const form = await req.formData();
    for (const [k, v] of form.entries()) params[k] = typeof v === 'string' ? v : '';
  } catch {
    return refuse('body was not form-encoded');
  }

  const authToken = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
  const supplied = req.headers.get('X-Twilio-Signature');

  // The URL Twilio signed is the one this worker was reached on, which is what
  // the provider was configured with.
  const valid = authToken && supplied
    ? await signatureMatches(authToken, req.url, params, supplied)
    : false;

  const plan = planInboundMessage({
    env: { TWILIO_AUTH_TOKEN: authToken },
    signatureHeader: supplied,
    signatureValid: valid,
    params,
  });

  if (plan.act === 'refuse') return refuse(`${plan.kind}: ${plan.reason}`);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  try {
    // Idempotent on the PROVIDER's id: Twilio retries a webhook it did not get
    // a 2xx for, and a retry must not become a second copy of one reply.
    const { data: already } = await supabase
      .from('ghl_conversation_messages')
      .select('id')
      .eq('ghl_message_id', plan.providerMessageId)
      .maybeSingle();
    if (already) return new Response('', { status: 204 });

    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('primary_mobile', plan.from)
      .maybeSingle();

    const conversationKey = `native-sms-${plan.from}`;
    const { data: conv } = await supabase
      .from('ghl_conversations')
      .select('id, unread_count')
      .eq('ghl_conversation_id', conversationKey)
      .maybeSingle();

    const now = new Date().toISOString();
    let conversationId = conv?.id ?? null;

    if (!conversationId) {
      const { data: created, error: convError } = await supabase
        .from('ghl_conversations')
        .insert({
          ghl_conversation_id: conversationKey,
          client_id: client?.id ?? null,
          channel_type: 'sms',
          conversation_status: 'open',
          available_channels: ['sms'],
          last_message_body: plan.body,
          last_message_date: now,
          last_message_direction: 'inbound',
          unread_count: 1,
        })
        .select('id')
        .single();
      if (convError) throw convError;
      conversationId = created.id;
    } else {
      // Incremented from the value already read rather than by a composed
      // expression: PostgREST has no `col = col + 1`, and a hand-built filter
      // string is the defect `screeningConsumer` already paid for.
      await supabase
        .from('ghl_conversations')
        .update({
          last_message_body: plan.body,
          last_message_date: now,
          last_message_direction: 'inbound',
          unread_count: (conv?.unread_count ?? 0) + 1,
          conversation_status: 'open',
          ...(client?.id ? { client_id: client.id } : {}),
        })
        .eq('id', conversationId);
    }

    const { error: msgError } = await supabase.from('ghl_conversation_messages').insert({
      ghl_message_id: plan.providerMessageId,
      conversation_id: conversationId,
      direction: 'inbound',
      body: plan.body,
      channel_type: plan.channel,
      message_status: 'delivered',
      ghl_date_added: now,
    });
    if (msgError) throw msgError;

    // Empty TwiML: received, and no auto-reply. A word here would be delivered
    // to the customer as an SMS from this deployment.
    return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (error) {
    // 500 so Twilio RETRIES. The request was legitimate and the fault is ours,
    // which is the one case where losing the message would be our doing.
    console.error('[crm-inbound-message] write failed:', (error as Error)?.message);
    return new Response('', { status: 500 });
  }
});
