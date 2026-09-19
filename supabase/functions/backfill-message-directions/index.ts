import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { internalError } from '../_shared/errorResponse.ts';
import { createCorsHeaders } from '../_shared/auth.ts';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function mapMessageDirection(msg: any): string {
  const dir = msg.direction;
  if (dir === 'inbound' || dir === 1 || dir === '1') return 'inbound';
  if (dir === 'outbound' || dir === 2 || dir === '2') return 'outbound';
  if (msg.incoming === true) return 'inbound';
  if (msg.incoming === false) return 'outbound';
  if (msg.userId) return 'outbound';
  return 'outbound';
}

function mapChannelType(ghlType: string | number | undefined): string {
  if (!ghlType) return 'sms';
  const typeStr = String(ghlType).toLowerCase();
  const mapping: Record<string, string> = {
    'sms': 'sms', '1': 'sms', 'phone': 'sms',
    'email': 'email', '2': 'email',
    'whatsapp': 'whatsapp', '3': 'whatsapp',
    'fb': 'facebook', 'facebook': 'facebook', '4': 'facebook',
    'ig': 'instagram', 'instagram': 'instagram', '5': 'instagram',
    'live_chat': 'live_chat', 'livechat': 'live_chat', '6': 'live_chat',
  };
  return mapping[typeStr] || typeStr;
}

Deno.serve(async (req) => {
  // CORS is built PER REQUEST from the shared allowlist, never hardcoded.
  //
  // This answered `Access-Control-Allow-Origin: *` while running
  // `verify_jwt = false`. Now that the gateway demands a JWT the call is
  // credentialed, and the Fetch spec makes a browser REJECT a credentialed
  // response carrying a wildcard — opaquely, as "Failed to fetch" — so the
  // wildcard would have turned an authentication fix into a broken endpoint.
  //
  // `createCorsHeaders` is called rather than spread-and-overridden: it already
  // supplies Allow-Headers and Expose-Headers from the canonical lists in
  // `_shared/auth.ts`, and restating them here would pin this function to a
  // snapshot of those lists taken today. The lists it returns are supersets of
  // the three headers this file used to name, so nothing is narrowed.
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('GOHIGHLEVEL_API_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'GHL API key not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const body = await req.json().catch(() => ({}));
    const convOffset = body.offset || 0;
    const convLimit = body.limit || 5;
    const startTime = Date.now();

    const ghlHeaders = {
      'Authorization': `Bearer ${apiKey}`,
      'Version': '2021-07-28',
      'Accept': 'application/json',
    };

    // Get a small batch of conversations
    const { data: conversations, error: convError } = await supabase
      .from('ghl_conversations')
      .select('id, ghl_conversation_id, channel_type')
      .order('created_at', { ascending: true })
      .range(convOffset, convOffset + convLimit - 1);

    if (convError) throw new Error(`Fetch error: ${convError.message}`);
    if (!conversations?.length) {
      return new Response(JSON.stringify({ success: true, message: 'No more conversations', offset: convOffset }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[backfill] Batch offset=${convOffset}, count=${conversations.length}`);

    let totalUpdated = 0;
    let errors: string[] = [];

    for (const conv of conversations) {
      if (Date.now() - startTime > 45000) break;
      
      try {
        await delay(350);
        
        // Fetch first page of messages from GHL
        const res = await fetch(
          `${GHL_API_BASE}/conversations/${conv.ghl_conversation_id}/messages?limit=50`,
          { method: 'GET', headers: ghlHeaders }
        );

        if (!res.ok) {
          errors.push(`${conv.ghl_conversation_id}: ${res.status}`);
          continue;
        }

        const data = await res.json();
        let messages: any[] = [];
        if (data.messages?.messages && Array.isArray(data.messages.messages)) {
          messages = data.messages.messages;
        } else if (Array.isArray(data.messages)) {
          messages = data.messages;
        }

        for (const msg of messages) {
          const direction = mapMessageDirection(msg);
          const channel = mapChannelType(msg.messageType || msg.source || conv.channel_type);

          await supabase
            .from('ghl_conversation_messages')
            .update({ direction, channel_type: channel })
            .eq('ghl_message_id', msg.id);

          totalUpdated++;
        }
      } catch (err: any) {
        errors.push(`${conv.id}: ${err.message}`);
      }
    }

    const nextOffset = conversations.length === convLimit ? convOffset + convLimit : null;
    console.log(`[backfill] Done: ${totalUpdated} updated, next=${nextOffset}`);

    return new Response(JSON.stringify({
      success: true,
      offset: convOffset,
      processed: conversations.length,
      messages_updated: totalUpdated,
      next_offset: nextOffset,
      errors: errors.length > 0 ? errors : undefined,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    return new Response(JSON.stringify(internalError(error, 'backfill-message-directions')), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
