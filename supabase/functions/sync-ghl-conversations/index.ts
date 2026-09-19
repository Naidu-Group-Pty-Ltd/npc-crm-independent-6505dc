// Pinned to match `_shared/ghl-rate-limiter.ts` and the nine
// `ghl-migrate-*-worker` functions that already share its token bucket. A
// floating `@2` resolved to a DIFFERENT `SupabaseClient` type instantiation,
// which the limiter's signature then rejected — and a floating major is its
// own hazard besides: the deployed client can change without a commit.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { getEffectiveGhlCredentials } from '../_shared/ghl-account.ts';
import { internalError } from '../_shared/errorResponse.ts';
import { tokenKeyFor } from '../_shared/ghl-rate-limiter.ts';
import { mapWithConcurrency } from '../_shared/boundedConcurrency.pure.ts';
import { MAX_SCAN_PAGES, SCAN_PAGE, pageAll } from '../_shared/postgrestPaging.pure.ts';
import {
  fetchMessagesOlderThan,
  fetchMessagesUntilHeld,
  searchConversationsForContact,
  type GhlWindow,
} from '../_shared/ghlConversationPaging.ts';
import {
  loadHeldMessageIds,
  upsertConversation,
  writeMessages,
} from '../_shared/ghlConversationStore.ts';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';

/**
 * THE BULK IMPORT A PERSON STARTS, AND THE THREE CEILINGS IT USED TO HIT.
 *
 * This is the function behind "import my GoHighLevel history" on a freshly
 * provisioned clone. It is resumable by design — the caller re-invokes it with
 * the `cursor` it hands back — and it was bounded in three places at once,
 * every one of them silent.
 *
 * **The contact list was silently truncated.** `.select('id, ghl_contact_id')`
 * with no range takes PostgREST's `max_rows`, which is 1,000 on these
 * projects, and reports a 200 with a short array. Past a thousand clients the
 * rest are invisible to the import for ever and `total_contacts` is not the
 * total. It is paged now.
 *
 * **The list had no ORDER BY.** The response then paged that array by index.
 * Postgres makes no promise about the order of an unordered select — a row
 * updated between two invocations can move — so a resumable cursor over it can
 * skip a contact and visit another twice. `.order('id')` is a total order over
 * a primary key, which is what a cursor needs to mean anything.
 *
 * **Messages stopped at `maxPages = mode === 'incremental' ? 2 : 10`.** Ten
 * pages of fifty is five hundred, and the prime's deepest conversation holds
 * exactly five hundred messages — the cap is visible in the data. Depth is now
 * decided by what we already hold rather than by a page count: the walk stops
 * at the first page it holds in full, so an unchanged thread costs one request
 * and a thread with one new message costs one request.
 *
 * **And `/conversations/search` was never paged at all**, here or anywhere
 * else in the product. A contact with more conversations than one page lost
 * the rest, silently, on every path.
 *
 * The mode still means something, and it means the right thing now:
 * `incremental` walks DOWN from the newest message until it reaches what we
 * hold, and anything else also walks BELOW the oldest message we hold, which
 * is the half that finishes a thread an earlier truncation cut short.
 */
const CONTACT_CONCURRENCY = 6;

/**
 * A wall-clock budget, because this walk cannot be made to fit.
 *
 * `config.toml` declares `request_timeout = 120`; 95s leaves room to write the
 * response while the slowest contact still in flight finishes. The run stops
 * while it can still answer, reports how far it got, and is called again from
 * where it left off.
 */
const BUDGET_MS = 95_000;

type Row = Record<string, unknown>;

interface Target {
  readonly clientId: string | null;
  readonly ghlContactId: string;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseKey) {
      return new Response(JSON.stringify({ error: 'Missing configuration', success: false }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl.trim(), supabaseKey.trim());
    const _ghlCreds = await getEffectiveGhlCredentials(supabase);
    // Typed `string` at the declaration: the guard below narrows them, but a
    // narrowing is discarded inside a closure TypeScript cannot prove runs
    // after the check.
    const apiKey: string = _ghlCreds.apiKey ?? '';
    const locationId: string = _ghlCreds.locationId ?? '';
    console.log(`[sync-ghl-conversations] Using GHL account: ${_ghlCreds.label}`);

    if (!apiKey || !locationId) {
      return new Response(JSON.stringify({ error: 'GHL not configured', success: false }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));

    // Verify authentication
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[sync-ghl-conversations] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[sync-ghl-conversations] Authenticated user: ${userId}`);

    const ghlHeaders = {
      'Authorization': `Bearer ${apiKey}`,
      'Version': '2021-07-28',
      'Accept': 'application/json',
    };

    // Determine sync mode
    const { client_id, ghl_contact_id, clientId: camelClientId, ghlContactId: camelGhlContactId, mode = 'incremental', cursor = 0 } = body;
    const resolvedClientId = client_id || camelClientId;
    const resolvedGhlContactId = ghl_contact_id || camelGhlContactId;
    /**
     * Whether to walk below the oldest message we already hold.
     *
     * `incremental` answers "what is new". Every other mode answers "is this
     * thread complete", which is the one that finishes a conversation an
     * earlier cap cut short — and it is what the bulk import asks for.
     */
    const deepProbe = mode !== 'incremental';

    let targetContactIds: Target[] = [];
    let listTruncated = false;

    if (resolvedClientId) {
      const { data: client } = await supabase
        .from('clients')
        .select('id, ghl_contact_id')
        .eq('id', resolvedClientId)
        .maybeSingle();

      if (!client?.ghl_contact_id) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Client has no GHL contact ID',
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      targetContactIds = [{ clientId: client.id, ghlContactId: client.ghl_contact_id }];
    } else if (resolvedGhlContactId) {
      const { data: client } = await supabase
        .from('clients')
        .select('id')
        .eq('ghl_contact_id', resolvedGhlContactId)
        .maybeSingle();

      targetContactIds = [{
        clientId: client?.id ?? null,
        ghlContactId: resolvedGhlContactId,
      }];
    } else {
      // Bulk sync: every client with a GHL contact id, in a TOTAL order, read
      // past `max_rows`. Both halves are load-bearing — see the header.
      const listed = await pageAll<{ id: string; ghl_contact_id: string | null }>((from, to) =>
        supabase
          .from('clients')
          .select('id, ghl_contact_id')
          .not('ghl_contact_id', 'is', null)
          .order('id', { ascending: true })
          .range(from, to));

      if (listed.failed) throw new Error(listed.failed);
      listTruncated = listed.truncated;
      if (listTruncated) {
        console.warn(
          `[sync-ghl-conversations] client list hit the ${MAX_SCAN_PAGES * SCAN_PAGE}-row ceiling; ` +
            'the import is incomplete and says so in its answer',
        );
      }
      targetContactIds = listed.rows
        .filter((c) => typeof c.ghl_contact_id === 'string' && c.ghl_contact_id.length > 0)
        .map((c) => ({ clientId: c.id, ghlContactId: c.ghl_contact_id as string }));
    }

    console.log(`[sync-ghl-conversations] Syncing conversations for ${targetContactIds.length} contacts (mode=${mode})`);

    let totalConversations = 0;
    let totalMessages = 0;
    let ghlRequests = 0;
    let budgetStops = 0;
    let pageCaps = 0;
    const errors: Array<{ contactId: string; error: string }> = [];

    const startedAt = Date.now();
    const startIndex = Math.max(0, Number(cursor) || 0);
    const queue = targetContactIds.slice(startIndex);
    // `label` is already `'legacy' | 'new'`, so it is passed straight through
    // the way the migration workers do it. Collapsing an unrecognised label to
    // 'new' with a ternary would hand two DIFFERENT tokens the same bucket key,
    // which is the one way a shared limiter can under-count.
    const tokenKey = tokenKeyFor(_ghlCreds.label, apiKey);
    const stop = () => Date.now() - startedAt > BUDGET_MS;

    const account = (w: GhlWindow<Row>): void => {
      ghlRequests += w.requests;
      if (w.stoppedOnBudget) budgetStops++;
      if (w.hitPageCap) pageCaps++;
    };

    // The budget is a predicate rather than a `break`: it stops the pool taking
    // NEW contacts while everything already in flight finishes, so a contact is
    // never left with its conversations written and its messages missing.
    // `startedCount` is what the cursor advances by, and it is exact because
    // work is started in order even though it completes out of order.
    const outcome = await mapWithConcurrency(
      queue,
      CONTACT_CONCURRENCY,
      async ({ clientId, ghlContactId }) => {
        const syncedAtIso = new Date().toISOString();

        const search = await searchConversationsForContact(supabase, tokenKey, ghlHeaders, {
          base: GHL_API_BASE,
          locationId,
          contactId: ghlContactId,
          stop,
          logTag: 'sync-ghl-conversations',
        });
        account(search);

        // A walk that FAILED is never reported as one that finished.
        // `ghlFetchShared` returns a non-2xx response rather than throwing, so
        // this has to be read off the result rather than caught.
        if (search.failed) {
          console.error(`[sync-ghl-conversations] Search failed for ${ghlContactId}: ${search.failureStatus}`);
          errors.push({ contactId: ghlContactId, error: `Search failed: ${search.failureStatus}` });
          return;
        }

        console.log(
          `[sync-ghl-conversations] ${search.items.length} conversations for ${ghlContactId} ` +
            `over ${search.pages} page(s)`,
        );

        for (const conv of search.items) {
          if (typeof conv.id !== 'string' || conv.id.length === 0) continue;
          if (stop()) break;

          const localId = await upsertConversation(supabase, conv, {
            clientId,
            ghlContactId,
            syncedAtIso,
            logTag: 'sync-ghl-conversations',
          });
          if (!localId) {
            errors.push({ contactId: ghlContactId, error: `Conversation upsert failed for ${conv.id}` });
            continue;
          }
          totalConversations++;

          const held = await loadHeldMessageIds(supabase, localId);
          if (held.failed) {
            // Walking with an empty held set re-downloads the whole thread on
            // every call. A read that failed is not a set that is empty.
            errors.push({ contactId: ghlContactId, error: `Held message set unreadable: ${held.failed}` });
            continue;
          }

          const top = await fetchMessagesUntilHeld(supabase, tokenKey, ghlHeaders, {
            base: GHL_API_BASE,
            conversationId: conv.id,
            heldIds: held.ids,
            stop,
            logTag: 'sync-ghl-conversations',
          });
          account(top);
          if (top.failed) {
            errors.push({ contactId: ghlContactId, error: `Messages fetch: ${top.failureStatus}` });
          }
          // Hoisted: `x += await f()` reads `x` before the await, so six
          // concurrent contacts lose each other's increments.
          const wroteTop = await writeMessages(supabase, top.items, localId, 'sync-ghl-conversations');
          totalMessages += wroteTop;

          if (deepProbe && held.oldestAnchor && !stop()) {
            const deep = await fetchMessagesOlderThan(supabase, tokenKey, ghlHeaders, {
              base: GHL_API_BASE,
              conversationId: conv.id,
              anchorMessageId: held.oldestAnchor,
              heldIds: held.ids,
              stop,
              logTag: 'sync-ghl-conversations',
            });
            account(deep);
            if (deep.failed) {
              errors.push({ contactId: ghlContactId, error: `History fetch: ${deep.failureStatus}` });
            }
            const wroteDeep = await writeMessages(supabase, deep.items, localId, 'sync-ghl-conversations');
            totalMessages += wroteDeep;
          }
        }
      },
      { stop },
    );

    // A thrown contact is that contact's failure and nobody else's — the same
    // guarantee the per-contact try/catch gave, kept deliberately.
    for (const r of outcome.results) {
      if (r.error) {
        console.error(`[sync-ghl-conversations] Exception for contact ${r.item.ghlContactId}: ${r.error}`);
        errors.push({ contactId: r.item.ghlContactId, error: r.error });
      }
    }

    const processed = outcome.startedCount;
    const nextCursor = startIndex + processed;
    const done = nextCursor >= targetContactIds.length;
    console.log(
      `[sync-ghl-conversations] ${done ? 'Complete' : 'Paused at ' + nextCursor + '/' + targetContactIds.length}: ` +
        `${totalConversations} conversations, ${totalMessages} messages, ${ghlRequests} GHL requests`,
    );

    return new Response(JSON.stringify({
      success: true,
      conversations_synced: totalConversations,
      messages_synced: totalMessages,
      contacts_processed: processed,
      ghl_requests: ghlRequests,
      // A walk cut short by the budget or by the per-conversation page cap is
      // NOT an exhausted one, and the caller is told rather than left to infer
      // it from a count.
      budget_stops: budgetStops,
      page_caps: pageCaps,
      // How far this run got, so the caller can resume rather than restart.
      // `done: false` is a healthy answer, not a failure.
      done,
      cursor: done ? null : nextCursor,
      total_contacts: targetContactIds.length,
      // True when the client list itself was capped, so `total_contacts` is a
      // floor rather than a total.
      contacts_truncated: listTruncated,
      errors: errors.length > 0 ? errors : undefined,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[sync-ghl-conversations] Error:', error);
    return new Response(JSON.stringify({ ...internalError(error, 'sync-ghl-conversations'), success: false }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
