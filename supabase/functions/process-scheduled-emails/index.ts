// Cron worker: drains email_copilot_scheduled_sends pending rows that are due.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { internalError } from '../_shared/errorResponse.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = (Deno.env.get('SUPABASE_ANON_KEY') || '').trim();
const INTERNAL_EDGE_SECRET = (Deno.env.get('INTERNAL_EDGE_SECRET') || '').trim();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const nowIso = new Date().toISOString();
    const { data: due, error } = await supabase
      .from('email_copilot_scheduled_sends')
      .select('*')
      .eq('status', 'pending')
      .lte('scheduled_for', nowIso)
      .order('scheduled_for', { ascending: true })
      .limit(20);
    if (error) throw error;

    const results: any[] = [];
    for (const row of due || []) {
      // mark as sending to avoid duplicates if cron overlaps
      const { error: lockErr } = await supabase
        .from('email_copilot_scheduled_sends')
        .update({ status: 'sending' })
        .eq('id', row.id)
        .eq('status', 'pending');
      if (lockErr) {
        results.push({ id: row.id, skipped: lockErr.message });
        continue;
      }

      try {
        const sendRes = await fetch(`${SUPABASE_URL}/functions/v1/send-email-reply`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // AUTH-002: internal secret, not the service-role key.
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'apikey': INTERNAL_EDGE_SECRET ? SUPABASE_ANON_KEY : SUPABASE_SERVICE_ROLE_KEY,
            ...(INTERNAL_EDGE_SECRET ? { 'x-internal-edge-secret': INTERNAL_EDGE_SECRET } : {}),
          },
          body: JSON.stringify({
            to: row.recipient,
            subject: row.subject,
            body: row.body,
            cc: row.cc_recipients?.length ? row.cc_recipients : undefined,
            bcc: row.bcc_recipients?.length ? row.bcc_recipients : undefined,
            originalEmailId: row.original_email_id || undefined,
            attachments: Array.isArray(row.attachments) && row.attachments.length ? row.attachments : undefined,
            mailboxSource: row.mailbox_source || 'admin',
            senderMailboxId: row.mailbox_source === 'personal' ? row.user_id : undefined,
            effectiveUserId: row.user_id,
          }),
        });
        if (!sendRes.ok) {
          const txt = await sendRes.text();
          throw new Error(`send-email-reply ${sendRes.status}: ${txt.slice(0, 300)}`);
        }
        await supabase
          .from('email_copilot_scheduled_sends')
          .update({ status: 'sent', sent_at: new Date().toISOString(), error: null })
          .eq('id', row.id);
        results.push({ id: row.id, sent: true });
      } catch (e: any) {
        await supabase
          .from('email_copilot_scheduled_sends')
          .update({ status: 'failed', error: e?.message?.slice(0, 1000) || 'Unknown error' })
          .eq('id', row.id);
        results.push({ id: row.id, sent: false, error: e?.message });
      }
    }

    return new Response(JSON.stringify({ success: true, processed: results.length, results }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('[process-scheduled-emails] Error:', e);
    return new Response(JSON.stringify(internalError(e, 'process-scheduled-emails')), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
