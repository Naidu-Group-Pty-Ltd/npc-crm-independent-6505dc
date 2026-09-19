// Pinned to the version `_shared/ghl-rate-limiter.ts` declares, for the same
// reason every other module in this pipeline is.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { MAX_SCAN_PAGES, SCAN_PAGE, pageAll } from './postgrestPaging.pure.ts';
import { toConversationRow, toMessageRow } from './ghlConversationMap.pure.ts';

/**
 * The three database acts of a GoHighLevel conversation import, written once.
 *
 * `ghlConversationMap.pure.ts` decides what a row CONTAINS; this decides how it
 * reaches the table, which is a separate question with its own traps. Both the
 * scheduled sync and the browser-started one go through here, so a message
 * cannot be written one way by the cron and another way by a refresh.
 *
 * Three things this exists to get right in one place:
 *
 * **A batch is deduplicated before the upsert.** GHL repeats the anchor message
 * across a page boundary, and Postgres answers a second conflicting row inside
 * one statement with 21000, "ON CONFLICT DO UPDATE command cannot affect row a
 * second time" — which loses the WHOLE batch, not the duplicate.
 *
 * **A truncated held set is refused, not used.** The conversation pager stops
 * walking when a page is already held in full, so the set it is handed has to
 * be complete: a window of it makes the walk run to the bottom of the thread on
 * every tick for ever, or stop above messages it never fetched. `pageAll`
 * reports the ceiling and this refuses on it.
 *
 * **A read that failed is not a set that is empty**, so `failed` is carried
 * rather than collapsed — handing an empty held set to the pager is exactly the
 * state that re-downloads everything.
 */

type Row = Record<string, unknown>;

/** Upsert chunk: one round trip per page of messages, well inside any statement limit. */
const WRITE_CHUNK = 500;

export interface HeldMessages {
  /** Every `ghl_message_id` this conversation holds. Complete, or `failed` is set. */
  readonly ids: ReadonlySet<string>;
  /**
   * The OLDEST held message id that GHL could page from, or null.
   *
   * This is the seed for the walk into history. A `failed-…` id is minted
   * locally by the send path for a message the vendor rejected, so GHL has
   * never heard of it and it is never an anchor; nor is a message with no
   * date, which GHL cannot order against.
   */
  readonly oldestAnchor: string | null;
  readonly count: number;
  readonly failed: string | null;
}

export async function loadHeldMessageIds(
  supabase: SupabaseClient,
  localConversationId: string,
): Promise<HeldMessages> {
  const got = await pageAll<{ ghl_message_id: string | null; ghl_date_added: string | null }>((from, to) =>
    supabase
      .from('ghl_conversation_messages')
      .select('ghl_message_id, ghl_date_added')
      .eq('conversation_id', localConversationId)
      // Oldest first, so the head of the set is the anchor. ASC is NULLS LAST
      // in Postgres and `nullsFirst: false` states it rather than inheriting
      // it, because an undated row in that slot is an anchor GHL will refuse.
      .order('ghl_date_added', { ascending: true, nullsFirst: false })
      .range(from, to));

  if (got.failed) return { ids: new Set(), oldestAnchor: null, count: 0, failed: got.failed };
  if (got.truncated) {
    return {
      ids: new Set(),
      oldestAnchor: null,
      count: got.rows.length,
      failed: `held set exceeded ${MAX_SCAN_PAGES * SCAN_PAGE} rows`,
    };
  }

  const ids = new Set<string>();
  let oldestAnchor: string | null = null;
  for (const r of got.rows) {
    const id = r.ghl_message_id;
    if (typeof id !== 'string' || id.length === 0) continue;
    ids.add(id);
    if (oldestAnchor === null && r.ghl_date_added && !id.startsWith('failed-')) oldestAnchor = id;
  }
  return { ids, oldestAnchor, count: ids.size, failed: null };
}

/**
 * Write a conversation and hand back its local id.
 *
 * Returns null on failure and NEVER throws, because one bad conversation must
 * not discard the contact's other conversations — the same guarantee
 * `mapWithConcurrency` gives one level up.
 */
export async function upsertConversation(
  supabase: SupabaseClient,
  conv: Row,
  ctx: { clientId: string | null; ghlContactId: string; syncedAtIso: string; logTag: string },
): Promise<string | null> {
  const { data, error } = await supabase
    .from('ghl_conversations')
    .upsert(
      toConversationRow(conv, {
        clientId: ctx.clientId,
        ghlContactId: ctx.ghlContactId,
        syncedAtIso: ctx.syncedAtIso,
      }),
      { onConflict: 'ghl_conversation_id' },
    )
    .select('id')
    .single();

  if (error || !data) {
    console.error(`[${ctx.logTag}] conversation upsert failed for ${String(conv.id)}: ${error?.message}`);
    return null;
  }
  return data.id as string;
}

/** How many message rows reached the table. Never throws. */
export async function writeMessages(
  supabase: SupabaseClient,
  items: readonly Row[],
  localConversationId: string,
  logTag: string,
): Promise<number> {
  const byId = new Map<string, Row>();
  for (const m of items) {
    const id = m.id;
    if (typeof id !== 'string' || id.length === 0) continue;
    byId.set(id, m);
  }
  if (byId.size === 0) return 0;

  const rows = [...byId.values()].map((m) => toMessageRow(m, localConversationId));
  let written = 0;
  for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
    const chunk = rows.slice(i, i + WRITE_CHUNK);
    const { error } = await supabase
      .from('ghl_conversation_messages')
      .upsert(chunk, { onConflict: 'ghl_message_id', ignoreDuplicates: false });
    // 23505 is a unique violation the upsert already resolves for the conflict
    // target; anything else is a real fault and is named rather than counted.
    //
    // It STOPS rather than skipping, and that is the whole point. Items arrive
    // newest-first, so breaking leaves the held set a contiguous prefix of the
    // newest messages — which is exactly the invariant the pager's stop
    // condition assumes. `continue` would write chunk 3 after chunk 2 failed
    // and PERFORATE the thread, and a hole below the first fully-held page is
    // unreachable by both walks at once: the top-down walk stops on page one
    // because that page is held, and the deep probe seeds from the OLDEST held
    // message, which sits below the hole. A failed write may truncate what we
    // hold; it must never puncture it.
    if (error && error.code !== '23505') {
      console.error(`[${logTag}] messages upsert failed, stopping this batch: ${error.message}`);
      break;
    }
    written += chunk.length;
  }

  await refreshAvailableChannels(supabase, rows, written, localConversationId, logTag);
  return written;
}

/** The three channels the inbox filter and the message history key on. */
const FILTERABLE_CHANNELS = new Set(['sms', 'email', 'whatsapp']);

/**
 * Keep `ghl_conversations.available_channels` true after a message write.
 *
 * It had a writer before this rewrite and lost one: `sync-ghl-conversations`
 * used to `.update({ available_channels })` after each conversation — against
 * a column that did not exist, so it silently did nothing, and removing the
 * dead line left the column with NO writer at all. The reissue migration
 * backfills it once, and `Conversations.tsx` filters the inbox on
 * `c.available_channels?.some(...)`, so without this every conversation
 * DISCOVERED after that backfill — which is exactly what the bootstrap band
 * exists to produce — would hold `{}` and be invisible to the channel filter
 * for ever.
 *
 * Two rules. It MERGES rather than replaces, because this batch is one page of
 * a thread and not the whole thread — recomputing from it would drop a channel
 * the conversation really has. And it never fails the message write: the rows
 * are already in the table, and losing a filter facet is not worth losing
 * them. It issues no UPDATE when the set would not change, which is the
 * ordinary case once a thread is established.
 */
async function refreshAvailableChannels(
  supabase: SupabaseClient,
  rows: readonly Row[],
  written: number,
  localConversationId: string,
  logTag: string,
): Promise<void> {
  if (written === 0) return;
  const seen = new Set<string>();
  for (const r of rows) {
    const c = r.channel_type;
    if (typeof c === 'string' && FILTERABLE_CHANNELS.has(c)) seen.add(c);
  }
  if (seen.size === 0) return;

  const { data, error } = await supabase
    .from('ghl_conversations')
    .select('available_channels')
    .eq('id', localConversationId)
    .maybeSingle();
  if (error || !data) return;

  const current: string[] = Array.isArray(data.available_channels) ? data.available_channels : [];
  const merged = [...new Set([...current, ...seen])].sort();
  if (merged.length === current.length && merged.every((c, i) => c === [...current].sort()[i])) return;

  const { error: writeError } = await supabase
    .from('ghl_conversations')
    .update({ available_channels: merged })
    .eq('id', localConversationId);
  if (writeError) console.warn(`[${logTag}] available_channels not updated: ${writeError.message}`);
}
