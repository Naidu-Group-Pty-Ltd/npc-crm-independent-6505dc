// Pinned to the version `_shared/ghl-rate-limiter.ts` declares. A floating
// `@2` resolves to a different SupabaseClient type and the limiter's first
// parameter stops matching.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { getEffectiveGhlCredentials } from '../_shared/ghl-account.ts';
import { insertTargetedNotification } from '../_shared/notify.ts';
import { internalError } from '../_shared/errorResponse.ts';
import { enforceRawBodyLimit, verifySignedInternal } from '../_shared/requestSecurity.ts';
import { tokenKeyFor } from '../_shared/ghl-rate-limiter.ts';
import { mapWithConcurrency } from '../_shared/boundedConcurrency.pure.ts';
import {
  fetchMessagesOlderThan,
  fetchMessagesUntilHeld,
  searchConversationsForContact,
  type GhlWindow,
} from '../_shared/ghlConversationPaging.ts';
import { mapChannelType } from '../_shared/ghlConversationMap.pure.ts';
import { MAX_TICK_MINUTES, bootstrapWindow } from '../_shared/ghlBootstrapWindow.pure.ts';
import { MAX_SCAN_PAGES, SCAN_PAGE, pageAll } from '../_shared/postgrestPaging.pure.ts';
import {
  loadHeldMessageIds,
  upsertConversation,
  writeMessages,
} from '../_shared/ghlConversationStore.ts';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';

/*
 * THE THIRD CONVERSATION SYNC, AND THE ONE THAT ACTUALLY RUNS.
 *
 * `sync-ghl-conversations` and `ghl-conversations-cron` are started by a
 * browser and by nothing else. This one runs every ten minutes with nobody
 * watching, so whatever it does not reach is not reached at all.
 *
 * ## What it did not reach
 *
 * Measured 13 Sep 2026. On the clone, 211 of 438 contacts with a GHL id —
 * 48.2% — had never had a single conversation row written, and coverage was
 * NOT correlated with recency (40% / 60% / 30% / 63% across four recency
 * bands), so waiting could never have closed it. Three independent bounds
 * produced that, and each was enough on its own:
 *
 *   BREADTH.  This function selected the 50 newest conversations and the 30
 *             most recently updated clients, with no offset and no rotation.
 *             ~80 contacts a tick, the SAME ~80 every tick, for ever.
 *   DEPTH.    It asked for `?limit=20` and read one page, with no
 *             `lastMessageId`. 87 of the prime's conversations hold more than
 *             20 messages.
 *   FAN-OUT.  It sent `/conversations/search` a body of `{ locationId,
 *             contactId }` and took `convData.conversations` as final. The
 *             endpoint pages, and nothing in the product had ever paged it.
 *
 * ## Three bands, one job each
 *
 * A. FRESH HEAD — the newest conversations. Runs FIRST because the inbound
 *    notification hangs off it and an operator waiting on a reply is the one
 *    reader with a clock. Small, and it is the only band that must never be
 *    starved. It also walks history, for a reason that is not obvious: every
 *    conversation it touches is stamped `last_synced_at = now` by its own
 *    upsert, which puts it permanently at the BACK of band C's ordering. The
 *    fifty most active threads would otherwise never reach the band that
 *    completes a truncated one — and they are the threads most likely to BE
 *    truncated, because they are the deepest.
 * B. BOOTSTRAP — clients that hold a contact id and NO conversation row. This
 *    is the coverage gap. It is swept by a rotating window rather than a
 *    cursor, because the schema cannot tell "nobody has asked GHL about this
 *    contact" from "GHL holds nothing for this contact" and recording the
 *    difference would need a column. `ghlBootstrapWindow.pure.ts` carries the
 *    proof that no cron cadence can strand a slice of that list.
 * C. STALE TAIL — every conversation, oldest `last_synced_at` first. This is
 *    the completeness rotation: it is the band that walks BELOW what we
 *    already hold, and it is where a thread truncated at 20 (this function)
 *    or at 100 (`sync-ghl-conversations` in incremental mode) is finally
 *    finished.
 *
 * Each band is its own `mapWithConcurrency` pass, because `stop` is a single
 * global predicate and three bands need three deadlines. The deadlines are
 * ABSOLUTE against one `startedAt`, so a band that finishes early hands the
 * rest of the clock to the next one rather than idling.
 *
 * ## Nothing here stores a cursor
 *
 * Every boundary is re-derived from rows that already exist — which
 * conversations are stale, which messages we hold, which contacts have none —
 * so a tick that dies mid-flight loses nothing and no migration is needed.
 * The one exception is band B's offset, and it is derived from the clock
 * rather than stored, for the same reason.
 */
const CONTACT_CONCURRENCY = 6;

/** Band A: how many of the newest conversations to refresh every tick. */
const FRESH_HEAD_CONVERSATIONS = 50;
/** Band B: how many never-seen contacts one tick asks GHL about. */
const BOOTSTRAP_WINDOW = 150;
/**
 * Band C: how many rows to consider. Deliberately larger than a tick can
 * finish — the wall clock is the real limit and `last_synced_at` is stamped on
 * every attempt, so the next tick resumes exactly where this one stopped.
 */
const STALE_TAIL_CONVERSATIONS = 600;

/*
 * Absolute deadlines from one `startedAt`, against the ~150s an Edge Function
 * gets. The limiter grants 6 requests a second across every caller of this
 * token, so these are roughly 210 / 210 / 240 requests.
 */
const FRESH_HEAD_DEADLINE_MS = 35_000;
const BOOTSTRAP_DEADLINE_MS = 70_000;
const BUDGET_MS = 110_000;

/** Upsert chunk. Comfortably inside any statement limit, big enough to be one round trip per page. */
const WRITE_CHUNK = 500;

const NOTIFY_WINDOW_MS = 30 * 60 * 1000;

type Row = Record<string, unknown>;

interface ContactEntry {
  readonly ghlContactId: string;
  readonly clientId: string | null;
}

interface BandCounters {
  contacts: number;
  started: number;
  conversations: number;
  messages: number;
  requests: number;
  searchFailures: number;
  messageFailures: number;
  budgetStops: number;
  pageCaps: number;
  heldReadFailures: number;
}

const newCounters = (): BandCounters => ({
  contacts: 0, started: 0, conversations: 0, messages: 0, requests: 0,
  searchFailures: 0, messageFailures: 0, budgetStops: 0, pageCaps: 0,
  heldReadFailures: 0,
});

/** Fold a walk's four facts into the band's tally. */
function tally(counters: BandCounters, w: GhlWindow<Row>, kind: 'search' | 'messages'): void {
  counters.requests += w.requests;
  if (w.failed) {
    if (kind === 'search') counters.searchFailures++; else counters.messageFailures++;
  }
  if (w.stoppedOnBudget) counters.budgetStops++;
  if (w.hitPageCap) counters.pageCaps++;
}

Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
    'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startedAt = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseKey) {
      console.error('[conversation-sync-cron] Missing supabase configuration');
      return new Response(JSON.stringify({ error: 'Missing configuration' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    /*
     * WHO IS ALLOWED TO START THIS.
     *
     * The header used to read "called by pg_cron — no auth needed", and
     * `config.toml` declares `verify_jwt = false`, so the two together made
     * this a worker anybody on the internet could start. It spends the
     * deployment's GoHighLevel rate budget — three bands, hundreds of requests
     * a tick — and writes to `ghl_conversations` and
     * `ghl_conversation_messages`, so "no auth needed" was a statement about
     * who DOES call it rather than about who CAN.
     *
     * It is the only caller, so the check costs nothing: pg_cron already
     * invokes it through `cron_invoke_signed_function`, which signs an HMAC
     * over the request and names itself in `X-Internal-Caller`.
     *
     * Found by `check-cron-caller-names.mjs` once that gate learned to read
     * `cron.alter_job`, which is how this job's body is written.
     */
    const bounded = await enforceRawBodyLimit(req, 8192);
    if (!bounded.ok) return bounded.error;
    const internal = await verifySignedInternal(supabase, req, bounded.raw, ['pg_cron']);
    if (!internal.ok) {
      console.warn(`[conversation-sync-cron] refused: ${internal.errorCode ?? 'unauthenticated'}`);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const _ghlCreds = await getEffectiveGhlCredentials(supabase);
    // Typed `string` at the declaration rather than narrowed by the guard
    // below: `syncContact` is a hoisted function declaration, and TypeScript
    // discards a narrowing inside one because it cannot prove the call happens
    // after the check.
    const apiKey: string = _ghlCreds.apiKey ?? '';
    const locationId: string = _ghlCreds.locationId ?? '';
    console.log(`[conversation-sync-cron] Using GHL account: ${_ghlCreds.label}`);

    if (!apiKey || !locationId) {
      console.error('[conversation-sync-cron] Missing GHL configuration');
      return new Response(JSON.stringify({ error: 'Missing GHL configuration' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const ghlHeaders = {
      'Authorization': `Bearer ${apiKey}`,
      'Version': '2021-07-28',
      'Accept': 'application/json',
    };

    // Keyed on the ACCOUNT LABEL, not on a hardcoded name: two GHL accounts
    // are two buckets, and sharing one key between them would pace a token
    // against another token's traffic.
    const tokenKey = tokenKeyFor(_ghlCreds.label, apiKey);

    // ─── Band assembly ──────────────────────────────────────────────────────

    const bands = {
      fresh: newCounters(),
      bootstrap: newCounters(),
      stale: newCounters(),
    };

    // A. The newest conversations.
    //
    // `nullsFirst: false` is load-bearing and was missing. Postgres orders
    // DESC as NULLS FIRST, and `last_message_date` is nullable — so "the 50
    // newest" was in fact up to 50 rows that have no message date at all,
    // which is the opposite of what this band is for and why the notification
    // path could miss a reply that had just arrived.
    const { data: freshRows, error: freshError } = await supabase
      .from('ghl_conversations')
      .select('ghl_contact_id, client_id')
      .not('ghl_contact_id', 'is', null)
      .order('last_message_date', { ascending: false, nullsFirst: false })
      .limit(FRESH_HEAD_CONVERSATIONS);
    if (freshError) console.error('[conversation-sync-cron] fresh head read failed:', freshError.message);

    // C. Every conversation, least recently attempted first.
    //
    // ASC is NULLS LAST in Postgres, and a row that has never been stamped is
    // the one most in need of attention, so `nullsFirst` is stated rather than
    // inherited.
    const { data: staleRows, error: staleError } = await supabase
      .from('ghl_conversations')
      .select('ghl_contact_id, client_id')
      .not('ghl_contact_id', 'is', null)
      .order('last_synced_at', { ascending: true, nullsFirst: true })
      .limit(STALE_TAIL_CONVERSATIONS);
    if (staleError) console.error('[conversation-sync-cron] stale tail read failed:', staleError.message);

    // B. Clients with a contact id and no conversation row.
    const covered = await pageAll<{ ghl_contact_id: string | null }>((from, to) =>
      supabase.from('ghl_conversations')
        .select('ghl_contact_id')
        .not('ghl_contact_id', 'is', null)
        .order('ghl_contact_id', { ascending: true })
        .range(from, to));
    const withContact = await pageAll<{ id: string; ghl_contact_id: string | null }>((from, to) =>
      supabase.from('clients')
        .select('id, ghl_contact_id')
        .not('ghl_contact_id', 'is', null)
        // A TOTAL order, so the window's offset means the same thing on every
        // tick. `updated_at` would re-shuffle the list under the rotation.
        .order('id', { ascending: true })
        .range(from, to));

    let bootstrapSlice: ContactEntry[] = [];
    let windowReading: Record<string, number> | null = null;
    if (covered.failed || withContact.failed) {
      // Neither list may be guessed at. An unread `covered` list makes every
      // client look uncovered; an unread client list hides the gap entirely.
      console.error(
        `[conversation-sync-cron] bootstrap band skipped — covered:${covered.failed ?? 'ok'} clients:${withContact.failed ?? 'ok'}`,
      );
    } else {
      if (covered.truncated || withContact.truncated) {
        console.warn(
          `[conversation-sync-cron] bootstrap scan hit the ${MAX_SCAN_PAGES * SCAN_PAGE}-row ceiling ` +
            `(covered=${covered.truncated} clients=${withContact.truncated}); the sweep is incomplete this tick`,
        );
      }
      const coveredSet = new Set(
        covered.rows.map((r) => r.ghl_contact_id).filter((v): v is string => typeof v === 'string' && v.length > 0),
      );
      const uncovered: ContactEntry[] = withContact.rows
        .filter((c) => typeof c.ghl_contact_id === 'string' && c.ghl_contact_id.length > 0)
        .filter((c) => !coveredSet.has(c.ghl_contact_id as string))
        .map((c) => ({ ghlContactId: c.ghl_contact_id as string, clientId: c.id }));

      // How long ago the last tick ran. This is a READING and never a lever:
      // `bootstrapWindow` derives its step from a DECLARED ceiling, because a
      // step inferred from a measurement amplifies a wrong measurement across
      // absolute time and strands a slice of the list. All this decides is
      // whether the job is firing further apart than the sweep was built for,
      // which is worth saying out loud.
      const { data: lastStamp } = await supabase
        .from('ghl_conversations')
        .select('last_synced_at')
        .not('last_synced_at', 'is', null)
        .order('last_synced_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      const lastMs = lastStamp?.last_synced_at ? Date.parse(String(lastStamp.last_synced_at)) : NaN;
      const observedTickMinutes = Number.isFinite(lastMs) ? (Date.now() - lastMs) / 60_000 : undefined;

      const win = bootstrapWindow({
        total: uncovered.length,
        size: BOOTSTRAP_WINDOW,
        nowMs: Date.now(),
        observedTickMinutes,
      });
      windowReading = {
        offset: win.offset, size: win.size, total: win.total,
        advancePerMinute: win.advancePerMinute,
        maxAdvancePerTick: win.maxAdvancePerTick,
        advancePerObservedTick: Math.round(win.advancePerObservedTick),
        latticeSpacing: win.latticeSpacing,
        cadenceExceeded: win.cadenceExceeded ? 1 : 0,
      };
      for (let i = 0; i < Math.min(win.size, win.total); i++) {
        bootstrapSlice.push(uncovered[(win.offset + i) % win.total]);
      }
      console.log(
        `[conversation-sync-cron] bootstrap: ${uncovered.length} contacts with no conversation row; ` +
          `window ${win.offset}..${win.offset + Math.min(win.size, win.total) - 1} ` +
          `(advance ${win.advancePerMinute}/min, ceiling ${win.maxAdvancePerTick}/tick, ` +
          `lattice ${win.latticeSpacing})`,
      );
      if (win.cadenceExceeded) {
        console.warn(
          `[conversation-sync-cron] this job last ran ${Math.round(win.advancePerObservedTick / win.advancePerMinute)} ` +
            `minutes ago, past the ${MAX_TICK_MINUTES}-minute cadence the bootstrap sweep is built for. ` +
            'Coverage still converges; raise BOOTSTRAP_WINDOW or MAX_TICK_MINUTES if the schedule changed for good.',
        );
      }
    }

    const toEntries = (rows: Row[] | null): ContactEntry[] =>
      (rows ?? [])
        .filter((r) => typeof r.ghl_contact_id === 'string' && (r.ghl_contact_id as string).length > 0)
        .map((r) => ({ ghlContactId: r.ghl_contact_id as string, clientId: (r.client_id as string | null) ?? null }));

    /*
      One contact is one search, so a contact an earlier band REACHED is never
      paid for twice — and the earlier band is always the more urgent one,
      because the bands are assembled in priority order.

      REACHED, not listed. A band is cut short by its deadline, and claiming at
      assembly time removed contacts from the stale tail that the earlier band
      then never started: band A lists its 50 but may start 17 of them, and the
      other 33 were struck off band C's list for work nobody did. Band A does
      not stamp `last_synced_at`, and an unstarted contact is never upserted
      either, so nothing about those rows changed and the SAME tail was
      excluded again on the next tick. They are the most recently active
      threads in the account — the ones this function exists to keep current.

      That is the second instance of one mistake: a row is only handled when it
      has actually been handled, and a list is not a promise. `claimUpTo` is
      therefore called by `runBand` with `startedCount`, which
      `mapWithConcurrency` documents as exact because tasks are started in
      order even though they complete out of order.
    */
    const claimed = new Set<string>();
    /** Drop contacts an earlier band already STARTED, and de-duplicate within this band. */
    const withoutClaimed = (entries: ContactEntry[]): ContactEntry[] => {
      const out: ContactEntry[] = [];
      const seen = new Set<string>();
      for (const e of entries) {
        if (claimed.has(e.ghlContactId) || seen.has(e.ghlContactId)) continue;
        seen.add(e.ghlContactId);
        out.push(e);
      }
      return out;
    };
    const claimUpTo = (entries: ContactEntry[], count: number): void => {
      for (let i = 0; i < count && i < entries.length; i++) claimed.add(entries[i].ghlContactId);
    };

    const freshBand = withoutClaimed(toEntries(freshRows as Row[] | null));
    const bootstrapBand = withoutClaimed(bootstrapSlice);

    bands.fresh.contacts = freshBand.length;
    bands.bootstrap.contacts = bootstrapBand.length;

    // ─── The work ───────────────────────────────────────────────────────────

    async function notifyNewInbound(
      messages: Row[],
      heldIds: ReadonlySet<string>,
      channelType: string,
      clientId: string | null,
      localConversationId: string,
    ): Promise<void> {
      const cutoff = Date.now() - NOTIFY_WINDOW_MS;
      const candidates = messages.filter((m) => {
        const id = typeof m.id === 'string' ? m.id : '';
        // Only a message that is NEW TO US can be news. The old pass
        // re-considered every message on the page each tick and leaned
        // entirely on a `notifications` lookup to stay quiet.
        if (id && heldIds.has(id)) return false;
        const dir = m.direction;
        const inbound = dir === 'inbound' || dir === 1 || dir === '1' || m.incoming === true;
        if (!inbound) return false;
        const at = Date.parse(String(m.dateAdded ?? m.createdAt ?? ''));
        return Number.isFinite(at) && at > cutoff;
      });
      if (candidates.length === 0) return;

      const cutoffIso = new Date(cutoff).toISOString();
      const { data: existing } = await supabase
        .from('notifications')
        .select('id')
        .eq('type', 'conversation_reply')
        .eq('entity_id', clientId || localConversationId)
        .gte('created_at', cutoffIso)
        .limit(1);
      if (existing && existing.length > 0) return;

      const newest = candidates[0];
      let clientName = (newest.contactName as string | undefined) || 'Unknown Contact';
      if (clientId) {
        const { data: clientRow } = await supabase
          .from('clients')
          .select('primary_first_name, primary_surname')
          .eq('id', clientId)
          .maybeSingle();
        if (clientRow) {
          clientName = [clientRow.primary_first_name, clientRow.primary_surname].filter(Boolean).join(' ') || clientName;
        }
      }

      const preview = String(newest.body ?? newest.message ?? '(Attachment)').substring(0, 100);
      await insertTargetedNotification(supabase, {
        moduleKey: 'conversations',
        notification: {
          type: 'conversation_reply',
          title: `New ${channelType.toUpperCase()} from ${clientName}`,
          message: preview,
          entity_id: clientId || localConversationId,
        },
      });
      console.log(`[conversation-sync-cron] 📬 Notification for inbound from ${clientName}`);
    }

    async function syncContact(
      entry: ContactEntry,
      counters: BandCounters,
      opts: { deadlineMs: number; deepProbe: boolean; stampAttempt: boolean; tag: string },
    ): Promise<void> {
      const stop = () => Date.now() - startedAt > opts.deadlineMs;
      const syncedAtIso = new Date().toISOString();

      try {
        const search = await searchConversationsForContact(supabase, tokenKey, ghlHeaders, {
          base: GHL_API_BASE,
          locationId,
          contactId: entry.ghlContactId,
          stop,
          logTag: `conversation-sync-cron:${opts.tag}`,
        });
        tally(counters, search, 'search');

        if (search.failed) {
          console.warn(
            `[conversation-sync-cron] ${opts.tag}: search failed for ${entry.ghlContactId} (${search.failureStatus})`,
          );
          return;
        }

        for (const conv of search.items) {
          if (typeof conv.id !== 'string' || conv.id.length === 0) continue;
          if (stop()) break;

          const localId = await upsertConversation(supabase, conv, {
            clientId: entry.clientId,
            ghlContactId: entry.ghlContactId,
            syncedAtIso,
            logTag: `conversation-sync-cron:${opts.tag}`,
          });
          if (!localId) continue;
          counters.conversations++;

          const held = await loadHeldMessageIds(supabase, localId);
          if (held.failed) {
            // Walking with an empty held set would re-download the whole thread
            // every tick — the no-op proof inverted into a spin. Skip instead.
            counters.heldReadFailures++;
            console.warn(`[conversation-sync-cron] ${opts.tag}: held set unreadable for ${conv.id}: ${held.failed}`);
            continue;
          }

          const top = await fetchMessagesUntilHeld(supabase, tokenKey, ghlHeaders, {
            base: GHL_API_BASE,
            conversationId: conv.id,
            heldIds: held.ids,
            stop,
            logTag: `conversation-sync-cron:${opts.tag}`,
          });
          tally(counters, top, 'messages');
          // Hoisted: `x += await f()` reads `x` BEFORE the await, so six
          // concurrent contacts each read the same value and the last write
          // wins. The tally is what the run reports on; it must not undercount.
          const wroteTop = await writeMessages(supabase, top.items, localId, 'conversation-sync-cron');
          counters.messages += wroteTop;

          await notifyNewInbound(
            top.items,
            held.ids,
            mapChannelType(conv.type),
            entry.clientId,
            localId,
          );

          // The other half of the thread. A top-down walk stops at the first
          // page it already holds in full, which is correct for "what is new"
          // and blind to everything BELOW a thread that was previously cut
          // short — `sync-ghl-conversations` in incremental mode holds exactly
          // the newest 100, so its page one is fully held and the walk stops
          // above 400 messages it never fetched.
          //
          // The BOOTSTRAP band is the one that does not pay for it, and the
          // reason is that it cannot need it: a conversation it has just
          // discovered has an empty held set, so the walk above already ran to
          // exhaustion and there is no anchor to seed from.
          //
          // In the steady state this costs one request that comes back empty.
          if (opts.deepProbe && held.oldestAnchor && !stop()) {
            const deep = await fetchMessagesOlderThan(supabase, tokenKey, ghlHeaders, {
              base: GHL_API_BASE,
              conversationId: conv.id,
              anchorMessageId: held.oldestAnchor,
              // Passed so that an anchor GHL declines to honour — which it
              // answers by returning page one — stops after a single request
              // instead of re-walking the thread from the top.
              heldIds: held.ids,
              stop,
              logTag: `conversation-sync-cron:${opts.tag}`,
            });
            tally(counters, deep, 'messages');
            const wroteDeep = await writeMessages(supabase, deep.items, localId, 'conversation-sync-cron');
            counters.messages += wroteDeep;
          }
        }
      } finally {
        if (opts.stampAttempt) {
          // Stamped on EVERY attempt, whatever the outcome, because this column
          // is what orders the stale-tail band. A conversation whose search
          // refused would otherwise stay at the head of that queue for ever and
          // block everything behind it — a priority inversion that gets worse
          // the more often it is run. The column says when we last LOOKED.
          await supabase
            .from('ghl_conversations')
            .update({ last_synced_at: syncedAtIso })
            .eq('ghl_contact_id', entry.ghlContactId);
        }
      }
    }

    const runBand = async (
      entries: ContactEntry[],
      counters: BandCounters,
      opts: { deadlineMs: number; deepProbe: boolean; stampAttempt: boolean; tag: string },
    ): Promise<void> => {
      if (entries.length === 0) return;
      const outcome = await mapWithConcurrency(
        entries,
        CONTACT_CONCURRENCY,
        (entry) => syncContact(entry, counters, opts),
        // Asked before a contact STARTS; whatever is already in flight
        // finishes and is kept, so a contact is never left with its
        // conversation row written and its messages missing.
        { stop: () => Date.now() - startedAt > opts.deadlineMs },
      );
      counters.started = outcome.startedCount;
      // Claimed on START. A contact this band listed but never reached must
      // stay available to the bands after it.
      claimUpTo(entries, outcome.startedCount);
      if (outcome.startedCount < entries.length) {
        console.log(
          `[conversation-sync-cron] ${opts.tag}: budget reached — ${outcome.startedCount} of ${entries.length} contacts`,
        );
      }
      for (const r of outcome.results) {
        if (r.error) console.error(`[conversation-sync-cron] ${opts.tag}: ${r.item.ghlContactId}: ${r.error}`);
      }
    };

    await runBand(freshBand, bands.fresh, {
      deadlineMs: FRESH_HEAD_DEADLINE_MS, deepProbe: true, stampAttempt: false, tag: 'fresh',
    });
    await runBand(bootstrapBand, bands.bootstrap, {
      deadlineMs: BOOTSTRAP_DEADLINE_MS, deepProbe: false, stampAttempt: false, tag: 'bootstrap',
    });

    // Assembled AFTER the two bands above have run, so it excludes exactly the
    // contacts they reached and keeps the ones they listed but ran out of
    // clock for. The query itself ran at the top with the others; only the
    // claim filter waits.
    const staleBand = withoutClaimed(toEntries(staleRows as Row[] | null));
    bands.stale.contacts = staleBand.length;
    console.log(
      `[conversation-sync-cron] bands — fresh:${freshBand.length} (started ${bands.fresh.started}) ` +
        `bootstrap:${bootstrapBand.length} (started ${bands.bootstrap.started}) stale:${staleBand.length}`,
    );

    await runBand(staleBand, bands.stale, {
      deadlineMs: BUDGET_MS, deepProbe: true, stampAttempt: true, tag: 'stale',
    });

    const totalConversations = bands.fresh.conversations + bands.bootstrap.conversations + bands.stale.conversations;
    const totalMessages = bands.fresh.messages + bands.bootstrap.messages + bands.stale.messages;
    const totalRequests = bands.fresh.requests + bands.bootstrap.requests + bands.stale.requests;

    console.log(
      `[conversation-sync-cron] ✅ ${totalConversations} convos, ${totalMessages} messages, ` +
        `${totalRequests} GHL requests in ${Date.now() - startedAt}ms`,
    );

    return new Response(JSON.stringify({
      success: true,
      // Kept under their original names: these two are what every existing
      // caller and test reads.
      conversations_synced: totalConversations,
      messages_synced: totalMessages,
      ghl_requests: totalRequests,
      duration_ms: Date.now() - startedAt,
      bands,
      bootstrap_window: windowReading,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[conversation-sync-cron] Error:', error);
    return new Response(JSON.stringify(internalError(error, 'conversation-sync-cron')), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
