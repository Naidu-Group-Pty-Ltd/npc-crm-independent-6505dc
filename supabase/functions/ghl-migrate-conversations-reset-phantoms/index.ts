/**
 * One-shot reset for the conversation-replay phantom successes.
 *
 * The previous worker version POSTed to /conversations/messages (the
 * live-send endpoint) instead of the historical-import endpoints
 * (/conversations/messages/inbound|outbound). GHL accepted those calls
 * and returned messageIds, so we marked them "replayed" — but the
 * messages never appeared in the inbox.
 *
 * This function wipes `new_ghl_message_id` and `replayed_at` from any
 * row that was "replayed" during the broken window so the worker will
 * re-process them on the next dispatch with the corrected payloads.
 *
 * Also clears `new_ghl_conversation_id` on shells where ALL child
 * messages are being reset, so the worker can recreate the shell too if
 * it was the empty one we created in error.
 *
 * Trigger (internal-only; authenticate with x-internal-edge-secret /
 * INTERNAL_EDGE_SECRET — see _shared/internalCall.ts):
 *   POST with body { since?: ISO, dry_run?: boolean }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';

import { verifyInternal } from '../_shared/auth_v2.ts';
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok');
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const rawBody = await req.text();
  let body: any = {};
  try { body = rawBody ? JSON.parse(rawBody) : {}; } catch { body = {}; }
  if (!(await verifyInternal(createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!), req, rawBody, { strict: true, allowedCallers: ['migration-dispatcher'] })).ok) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  }
  const since = body.since || '2026-04-28T03:00:00+00:00';
  const dryRun = body.dry_run === true;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Count first
  const { count: msgCount } = await supabase
    .from('ghl_conversation_messages')
    .select('id', { count: 'exact', head: true })
    .not('new_ghl_message_id', 'is', null)
    .gte('replayed_at', since);

  const { count: convCount } = await supabase
    .from('ghl_conversations')
    .select('id', { count: 'exact', head: true })
    .not('new_ghl_conversation_id', 'is', null)
    .gte('replayed_at', since);

  if (dryRun) {
    return new Response(JSON.stringify({
      dry_run: true, since,
      would_reset_messages: msgCount || 0,
      would_reset_conversations: convCount || 0,
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  // Reset messages: clear new_ghl_message_id, replayed_at, and the bogus
  // skip reasons left by the broken endpoint, so they re-enter the loop.
  const { error: msgErr, count: msgUpdated } = await supabase
    .from('ghl_conversation_messages')
    .update({
      new_ghl_message_id: null,
      replayed_at: null,
      replay_skipped_reason: null,
    }, { count: 'exact' })
    .not('new_ghl_message_id', 'is', null)
    .gte('replayed_at', since);

  if (msgErr) {
    return new Response(JSON.stringify({ error: msgErr.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Reset conversation shells created during the broken window.
  // (The empty shells in GHL will be reused via the existing "Reusing
  // existing target conversation" branch — we just need to forget our
  // mapping so the worker walks the path again and recreates the
  // mapping cleanly.)
  const { error: convErr, count: convUpdated } = await supabase
    .from('ghl_conversations')
    .update({
      new_ghl_conversation_id: null,
      replayed_at: null,
    }, { count: 'exact' })
    .not('new_ghl_conversation_id', 'is', null)
    .gte('replayed_at', since);

  if (convErr) {
    return new Response(JSON.stringify({ error: convErr.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Also remove the conversation_message rosetta entries we wrote so
  // the next run can recreate them with the real GHL message IDs.
  const { error: mapErr, count: mapDeleted } = await supabase
    .from('ghl_id_mapping')
    .delete({ count: 'exact' })
    .eq('resource_type', 'conversation_message')
    .gte('created_at', since);

  return new Response(JSON.stringify({
    success: true,
    since,
    messages_reset: msgUpdated ?? 0,
    conversations_reset: convUpdated ?? 0,
    rosetta_deleted: mapDeleted ?? 0,
    mapping_delete_error: mapErr?.message || null,
  }), { headers: { 'Content-Type': 'application/json' } });
});
