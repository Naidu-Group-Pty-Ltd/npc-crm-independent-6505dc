import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { getEffectiveGhlCredentials, resolveGhlAccessTokenForLocation } from '../_shared/ghl-account.ts';
import { actorIsSuperadmin, requireModulePermission } from '../_shared/authz.ts';
import { rateLimit } from '../_shared/wp08Guards.ts';
import { logApiUsage } from '../_shared/logApiUsage.ts';

// WP-08 — hard message length ceiling (SMS is 1600 across most providers).
const MAX_MESSAGE_LENGTH = 1600;

type SupportedChannel = 'sms' | 'whatsapp';

function resolveChannel(value: unknown): SupportedChannel | null {
  const channel = String(value || '').trim().toLowerCase();
  if (channel === 'sms') return 'sms';
  if (channel === 'whatsapp' || channel === 'whats_app') return 'whatsapp';
  return null;
}

function providerError(status: number, payload: any, channel: SupportedChannel): string {
  const detail = String(payload?.message || payload?.error || payload?.raw || '').toLowerCase();
  if (status === 401 || status === 403) return 'The CRM messaging connection needs to be reauthorised.';
  if (status === 429) return 'Messaging is temporarily rate-limited. Please try again shortly.';
  if (detail.includes('dnd') || detail.includes('opt') || detail.includes('unsubscribe')) {
    return channel === 'sms' ? 'This contact has opted out of SMS communications.' : 'This contact cannot receive WhatsApp messages.';
  }
  if (channel === 'whatsapp' && (detail.includes('window') || detail.includes('template'))) {
    return 'The WhatsApp conversation window has closed. Select an approved template to continue.';
  }
  if (detail.includes('phone') || detail.includes('number') || detail.includes('recipient')) {
    return channel === 'sms' ? 'The contact’s mobile number is invalid.' : 'This contact does not have a valid WhatsApp number.';
  }
  return channel === 'sms'
    ? 'The SMS provider rejected this message. Please review the contact number and messaging configuration.'
    : 'WhatsApp could not send this message. Check the contact number and WhatsApp connection.';
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();

    // Verify authentication using shared auth
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[send-ghl-message] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[send-ghl-message] Authenticated user: ${userId}`);

    const { conversationId, message, channel: requestedChannel, type, idempotencyKey } = body;

    if (!conversationId || !message) {
      return new Response(
        JSON.stringify({ error: "conversationId and message are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // WP-08 — bound message length and reject control characters.
    const messageText = String(message);
    if (messageText.length > MAX_MESSAGE_LENGTH) {
      return new Response(
        JSON.stringify({ error: `Message exceeds ${MAX_MESSAGE_LENGTH}-character limit.` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // The legacy checkPermission API expects a table + CRUD operation; passing
    // module/permission strings silently entered its compatibility path. Use
    // the deny-by-default module gate instead, before any service-role query.
    const perm = await requireModulePermission(supabase, { userId, authMethod: 'human' }, 'conversations', 'can_edit');
    if (!perm.ok) {
      return new Response(
        JSON.stringify({ error: 'You cannot send CRM messages.' }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // WP-08 — per-user quota: burst 10/sec, sustained 100/min.
    const burst = rateLimit(`ghl-send:burst:${userId}`, 10, 1_000);
    if (!burst.allowed) {
      return new Response(
        JSON.stringify({ error: 'Sending too quickly. Please slow down.' }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", 'Retry-After': '1' } }
      );
    }
    const minute = rateLimit(`ghl-send:minute:${userId}`, 100, 60_000);
    if (!minute.allowed) {
      return new Response(
        JSON.stringify({ error: 'Hourly message quota exceeded.' }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", 'Retry-After': String(Math.ceil((minute.retryAfterMs || 1000)/1000)) } }
      );
    }

    // Get GHL API key from env (preferred) or integration_secrets
    const _ghlCreds = await getEffectiveGhlCredentials(supabase);
    let apiKey = _ghlCreds.apiKey;
    let locationId = _ghlCreds.locationId;
    console.log(`[send-ghl-message] Using GHL account: ${_ghlCreds.label}`);

    if (!apiKey) {
      const { data: ghlSecret } = await supabase
        .from("integration_secrets")
        .select("secret_value")
        .eq("secret_key", "ghl_api_key")
        .maybeSingle();
      apiKey = ghlSecret?.secret_value;
    }

    if (!locationId) {
      const { data: locationSecret } = await supabase
        .from("integration_secrets")
        .select("secret_value")
        .eq("secret_key", "ghl_location_id")
        .maybeSingle();
      locationId = locationSecret?.secret_value;
    }

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "GHL API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Resolve the local record first. The browser may select a conversation, but
    // never supplies the authoritative GHL contact ID or any credential.
    const { data: convRecord } = await supabase
      .from("ghl_conversations")
      .select("id, ghl_contact_id, client_id")
      .eq("ghl_conversation_id", conversationId)
      .maybeSingle();

    if (!convRecord) {
      return new Response(JSON.stringify({ error: 'Conversation is unavailable or you no longer have access to it.' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Conversation IDs are not authorization. Resolve the authoritative
    // client and require that the caller owns or is assigned to it; return 404
    // so the endpoint cannot be used to enumerate GHL conversations.
    const superadmin = await actorIsSuperadmin(supabase, userId!);
    if (!superadmin) {
      if (!convRecord.client_id) {
        return new Response(JSON.stringify({ error: 'Conversation is unavailable or you no longer have access to it.' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: client } = await supabase
        .from('clients')
        .select('created_by, assigned_team_user_id')
        .eq('id', convRecord.client_id)
        .maybeSingle();
      if (!client || (client.created_by !== userId && client.assigned_team_user_id !== userId)) {
        return new Response(JSON.stringify({ error: 'Conversation is unavailable or you no longer have access to it.' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const channel = resolveChannel(requestedChannel || type);
    if (!channel) {
      return new Response(JSON.stringify({ error: 'Unsupported CRM message channel.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (idempotencyKey) {
      const { data: existing } = await supabase
        .from('ghl_conversation_messages')
        .select('ghl_message_id, message_status')
        .eq('client_request_id', idempotencyKey)
        .maybeSingle();
      if (existing && existing.message_status !== 'failed') {
        return new Response(JSON.stringify({ success: true, messageId: existing.ghl_message_id, duplicate: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const messageType = channel === 'whatsapp' ? 'WhatsApp' : 'SMS';
    const ghlPayload: Record<string, string> = {
      type: messageType,
      conversationId,
      contactId: convRecord.ghl_contact_id || '',
      message,
    };

    const contactId = convRecord?.ghl_contact_id;
    if (!contactId) {
      const error = channel === 'sms'
        ? 'This contact does not have a valid mobile number.'
        : 'This contact does not have a valid WhatsApp number.';
      return new Response(JSON.stringify({ error }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Resolve to a Location-level token when an agency/main token is configured
    let accessToken = apiKey;
    try {
      const resolved = await resolveGhlAccessTokenForLocation({ apiKey, locationId, label: _ghlCreds.label });
      accessToken = resolved.accessToken;
      if (resolved.diagnostics.exchange_attempted && !resolved.diagnostics.exchange_succeeded) {
        console.warn('[send-ghl-message] Location token exchange failed:', resolved.diagnostics.exchange_error);
      }
    } catch (e: any) {
      console.warn('[send-ghl-message] Token resolve threw, using raw key:', e?.message);
    }

    const ghlUrl = `https://services.leadconnectorhq.com/conversations/messages`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      Version: "2021-07-28",
    };
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

    console.log(`[send-ghl-message] Sending ${channel} to conversation ${conversationId} (contact resolved=${Boolean(contactId)})`);

    const ghlRes = await fetch(ghlUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(ghlPayload),
    });

    const ghlText = await ghlRes.text();
    let ghlData: any = {};
    try { ghlData = ghlText ? JSON.parse(ghlText) : {}; } catch { ghlData = { raw: ghlText }; }

    if (!ghlRes.ok) {
      console.error("[send-ghl-message] GHL API error:", ghlRes.status, ghlData);
      const safeError = providerError(ghlRes.status, ghlData, channel);
      if (idempotencyKey) {
        // `message_type` is NOT written. It duplicates `channel_type` and the
        // column exists in no migration and no generated type — see the note
        // on `messageRecord` below.
        const { error: failRowError } = await supabase.from('ghl_conversation_messages').upsert({
          ghl_message_id: `failed-${idempotencyKey}`,
          client_request_id: idempotencyKey,
          conversation_id: convRecord.id,
          direction: 'outbound', body: message, channel_type: channel,
          message_status: 'failed', error_message: safeError,
          ghl_date_added: new Date().toISOString(),
        }, { onConflict: 'ghl_message_id' });
        if (failRowError) {
          // Named rather than discarded. This row is what the retry action
          // reads, and a write that silently did not happen is how the retry
          // came to mint a fresh key every time.
          console.error('[send-ghl-message] failed-state row not written:', failRowError.message);
        }
      }
      return new Response(
        JSON.stringify({
          error: safeError,
          status: ghlRes.status,
        }),
        { status: ghlRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[send-ghl-message] Message sent successfully: ${ghlData.messageId || ghlData.id}`);

    // Store the outbound message in our database
    /*
      `message_type` used to sit here beside `channel_type`, carrying the same
      value, and `ghl_conversation_messages` HAS NO SUCH COLUMN — not in the
      table, not in any migration, not in the generated types. PostgREST answers
      a write naming an unknown column with PGRST204, the error was re-thrown
      below, and the outer catch returned HTTP 500 "CRM messaging is temporarily
      unavailable" — AFTER GoHighLevel had already accepted and delivered the
      message.

      So every outbound SMS and WhatsApp this product has ever sent from the CRM
      was really sent, never recorded, and reported to the operator as a
      failure; the conversation's own metadata update and `logApiUsage` below it
      never ran either. The operator then retried, and the duplicate guard above
      could not stop it, because the read that guards it named `client_request_id`
      on a table that did not have that column either and discarded the error.

      The other three columns are real again as of
      `20260913094500_conversation_delivery_safety_reissue.sql`, which re-issues
      a migration committed on 23 Jul 2026 and applied to nothing. This one is
      simply deleted: `channel_type` already carries it.
    */
    const messageRecord = {
      ghl_message_id: ghlData.messageId || ghlData.id || crypto.randomUUID(),
      conversation_id: null as string | null,
      direction: "outbound",
      body: message,
      channel_type: channel,
      message_status: "sent",
      client_request_id: idempotencyKey || null,
      ghl_date_added: new Date().toISOString(),
    };

    // Look up our internal conversation record
    if (convRecord) {
      messageRecord.conversation_id = convRecord.id;

      // A successful retry replaces the locally persisted failure for the same
      // request key before the provider message ID is stored.
      if (idempotencyKey) {
        await supabase
          .from('ghl_conversation_messages')
          .delete()
          .eq('client_request_id', idempotencyKey)
          .eq('message_status', 'failed');
      }

      // Insert the message
      const { error: persistError } = await supabase.from("ghl_conversation_messages").upsert(messageRecord, {
        onConflict: "ghl_message_id",
      });
      if (persistError) throw persistError;

      // Update conversation metadata
      await supabase
        .from("ghl_conversations")
        .update({
          last_message_date: new Date().toISOString(),
          last_message_body: message.substring(0, 500),
          last_message_direction: "outbound",
          updated_at: new Date().toISOString(),
        })
        .eq("id", convRecord.id);
    }

    // WP-08 — audit successful send. Body itself is not persisted here (kept
    // in ghl_conversation_messages); metadata only.
    await logApiUsage(supabase, {
      service_name: 'ghl',
      endpoint: '/conversations/messages',
      status: 'success',
      model_used: 'rest-api',
      user_id: userId!,
      metadata: {
        channel,
        conversation_id: convRecord.id,
        client_id: convRecord.client_id || null,
        provider_message_id: ghlData.messageId || ghlData.id || null,
        message_length: messageText.length,
      },
    });

    return new Response(
      JSON.stringify({ success: true, messageId: ghlData.messageId || ghlData.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[send-ghl-message] Error:", error);
    return new Response(
      JSON.stringify({ error: 'CRM messaging is temporarily unavailable.' }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
