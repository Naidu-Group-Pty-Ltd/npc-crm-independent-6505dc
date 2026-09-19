// Pinned to the version `_shared/ghl-rate-limiter.ts` declares. A floating
// `@2` resolves to a different SupabaseClient instantiation and the limiter's
// first parameter stops matching.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { ghlFetchShared } from './ghl-rate-limiter.ts';

/**
 * The one paged reader for GoHighLevel's two conversation endpoints.
 *
 * ## What was unbounded before this
 *
 * Measured in this repository on 13 Sep 2026, all three live callers —
 * `conversation-sync-cron:126`, `sync-ghl-conversations:182` and
 * `one-time-bulk-conversation-sync:162` — send `/conversations/search` a body
 * of `{ locationId, contactId }` and nothing else. No `limit`, no cursor, and
 * `convData.conversations` taken as final. **Nothing in the product has ever
 * paged that endpoint.** A contact with more conversations than GHL returns
 * in one page loses the rest, permanently and silently, on every path.
 *
 * Messages were bounded three different ways at once: the cron asked for
 * `?limit=20` and read one page with no `lastMessageId` at all, while
 * `sync-ghl-conversations` capped at `maxPages = mode === 'incremental' ? 2 :
 * 10`. That cap is visible in the data — the prime's deepest conversation
 * holds exactly 500 messages, which is 10 pages of 50, and 87 conversations
 * sit past the cron's 20.
 *
 * `ghl-migrate-conversations-worker:245-252` is the only correct copy of the
 * search pagination in the repo and the rules below are lifted from it. It
 * keeps its copy deliberately: it walks the LOCATION rather than a contact
 * and checkpoints into `migration_jobs`, so it is account-to-account
 * migration rather than this import. Unifying the two needs its own measured
 * probe and is a named follow-up, not a silent side effect of this change.
 *
 * ## The rule that shapes the result type
 *
 * **A walk that failed must never be reported as one that finished.**
 * `ghlFetchShared` RETURNS a non-2xx response after its retries rather than
 * throwing (`ghl-rate-limiter.ts:163-166`), so the natural `break` on a bad
 * response would leave no cursor, cut no budget, and compute `exhausted`
 * true. That is the same collapse `graphMailPaging.ts` records for Graph,
 * except Graph's transport throws and hides it. So `GhlWindow` carries FOUR
 * separate facts, and `exhausted` is derived from all of them at the single
 * return.
 */

export const GHL_CONVERSATION_PAGE_LIMIT = 100;
export const GHL_MESSAGE_PAGE_LIMIT = 50;
/**
 * A ceiling on ONE conversation's walk, so a pathological thread cannot eat a
 * whole tick. Hitting it is reported (`hitPageCap`) and is NOT exhaustion, so
 * the next tick resumes deeper rather than concluding it has everything.
 * 40 pages × 50 = 2,000 messages; the deepest real thread measured is 500.
 */
export const MAX_PAGES_PER_CONVERSATION = 40;

export interface GhlWindow<T> {
  readonly items: T[];
  readonly pages: number;
  readonly requests: number;
  /** GHL offered no further cursor AND nothing cut the walk short. */
  readonly exhausted: boolean;
  /** The caller's deadline stopped the walk. */
  readonly stoppedOnBudget: boolean;
  /** MAX_PAGES_PER_CONVERSATION stopped the walk. */
  readonly hitPageCap: boolean;
  /** The vendor refused. `ghlFetchShared` returns non-2xx; it does not throw. */
  readonly failed: boolean;
  readonly failureStatus: number | null;
}

type Row = Record<string, unknown>;

interface BaseOpts {
  readonly base: string;
  readonly stop?: () => boolean;
  readonly logTag?: string;
  readonly maxPages?: number;
}

function done<T>(
  items: T[],
  pages: number,
  requests: number,
  flags: { stoppedOnBudget: boolean; hitPageCap: boolean; failed: boolean; failureStatus: number | null; noCursor: boolean },
): GhlWindow<T> {
  return {
    items,
    pages,
    requests,
    // Computed ONCE, from every fact. "No further cursor" alone is not
    // exhaustion — a refusal and a budget stop also leave no cursor.
    exhausted: !flags.failed && !flags.stoppedOnBudget && !flags.hitPageCap && flags.noCursor,
    stoppedOnBudget: flags.stoppedOnBudget,
    hitPageCap: flags.hitPageCap,
    failed: flags.failed,
    failureStatus: flags.failureStatus,
  };
}

/**
 * `startAfter` must reach GHL as numeric milliseconds.
 *
 * Returns null when the value cannot be read as a timestamp, and the caller
 * then OMITS the parameter rather than sending it unparsed — but it also
 * stops, because a search whose boundary was dropped returns page one for
 * ever. Same rule as `graphMailPaging`'s refusal to drop a boundary it was
 * asked for.
 */
function toStartAfterMs(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v);
  if (/^\d+$/.test(s)) return s;
  const ms = new Date(s).getTime();
  return Number.isFinite(ms) ? String(ms) : null;
}

/**
 * Every conversation GHL holds for one contact.
 *
 * Pagination is `startAfter` (numeric ms) + `startAfterId` (the tie-breaker),
 * both read from `data.meta` first and from the page tail second. It MUST
 * NEVER read `data.nextPage`: that field exists only on the messages
 * sub-endpoint, and reading it here is what made a previous worker exit after
 * one page — `ghl-migrate-conversations-worker:248` carries the warning.
 */
export async function searchConversationsForContact(
  supabase: SupabaseClient,
  tokenKey: string,
  headers: Record<string, string>,
  opts: BaseOpts & { locationId: string; contactId: string },
): Promise<GhlWindow<Row>> {
  const items: Row[] = [];
  const cap = Math.max(1, opts.maxPages ?? MAX_PAGES_PER_CONVERSATION);
  let pages = 0;
  let requests = 0;
  let startAfterId: string | null = null;
  let startAfter: string | null = null;

  while (true) {
    if (pages >= cap) return done(items, pages, requests, { stoppedOnBudget: false, hitPageCap: true, failed: false, failureStatus: null, noCursor: false });
    // Asked before each page but the first, so a pass whose budget was
    // already spent still makes one request rather than reporting nothing.
    if (pages > 0 && opts.stop?.()) {
      return done(items, pages, requests, { stoppedOnBudget: true, hitPageCap: false, failed: false, failureStatus: null, noCursor: false });
    }

    const params = new URLSearchParams({
      locationId: opts.locationId,
      contactId: opts.contactId,
      limit: String(GHL_CONVERSATION_PAGE_LIMIT),
    });
    if (startAfterId) params.set('startAfterId', startAfterId);
    if (startAfter) params.set('startAfter', startAfter);

    const res = await ghlFetchShared(
      supabase,
      tokenKey,
      `${opts.base}/conversations/search?${params}`,
      { method: 'GET', headers },
      { logTag: opts.logTag ?? 'ghl-conversation-paging' },
    );
    requests++;

    if (!res.ok) {
      // Drain the body so the connection is not left half-read.
      try { await res.text(); } catch { /* body already consumed */ }
      return done(items, pages, requests, { stoppedOnBudget: false, hitPageCap: false, failed: true, failureStatus: res.status, noCursor: false });
    }

    const data = await res.json();
    const page: Row[] = Array.isArray(data?.conversations) ? data.conversations : [];
    pages++;
    items.push(...page);

    if (page.length === 0) {
      return done(items, pages, requests, { stoppedOnBudget: false, hitPageCap: false, failed: false, failureStatus: null, noCursor: true });
    }

    const tail = page[page.length - 1] as Row;
    const meta = (data?.meta ?? {}) as Row;

    /*
      The vendor's own cursor decides; a synthesised one is the fallback, and
      it is only followed off a FULL page.

      Most of these walks are one contact's conversations, and the measured
      shape on the prime is one conversation per contact — 0 of 753 hold more
      than one. Synthesising a cursor from the page tail unconditionally means
      every one of those costs a second request that comes back empty, which
      doubles the largest band's spend to learn nothing.

      A short page with NO cursor from the vendor is the strongest evidence of
      the end there is. This is deliberately NOT the `page.length < limit`
      rule the message walk forbids: an explicit cursor always wins, whatever
      the page length, so a vendor that really does paginate is followed
      exactly as before.
    */
    const explicitId = (meta.startAfterId ?? null) as string | null;
    const explicitAfter = meta.startAfter ?? null;
    const pageWasFull = page.length >= GHL_CONVERSATION_PAGE_LIMIT;

    if (!explicitId && explicitAfter === null && !pageWasFull) {
      return done(items, pages, requests, { stoppedOnBudget: false, hitPageCap: false, failed: false, failureStatus: null, noCursor: true });
    }

    const nextId = (explicitId ?? tail.id ?? null) as string | null;
    const nextAfterRaw = explicitAfter ?? tail.lastMessageDate ?? tail.dateUpdated ?? tail.dateAdded ?? null;
    const nextAfter = toStartAfterMs(nextAfterRaw);

    // A boundary we were given but cannot render is a STOP, never a dropped
    // parameter: sending the next request without it returns page one again.
    if (nextAfterRaw !== null && nextAfterRaw !== undefined && nextAfter === null && !nextId) {
      return done(items, pages, requests, { stoppedOnBudget: false, hitPageCap: false, failed: false, failureStatus: null, noCursor: false });
    }

    if (!nextId && !nextAfter) {
      return done(items, pages, requests, { stoppedOnBudget: false, hitPageCap: false, failed: false, failureStatus: null, noCursor: true });
    }
    startAfterId = nextId;
    startAfter = nextAfter;
  }
}

/** Both message-envelope shapes GHL returns, and the cursor each offers. */
function readMessagePage(data: unknown): { page: Row[]; cursor: string | null } {
  const d = (data ?? {}) as Record<string, unknown>;
  const nested = d.messages as Record<string, unknown> | Row[] | undefined;
  if (nested && !Array.isArray(nested) && Array.isArray((nested as Record<string, unknown>).messages)) {
    const page = (nested as Record<string, unknown>).messages as Row[];
    const cursor = ((nested as Record<string, unknown>).lastMessageId as string | undefined)
      ?? (page.length ? String((page[page.length - 1] as Row).id ?? '') || null : null);
    return { page, cursor: cursor || null };
  }
  if (Array.isArray(nested)) {
    // A flat array carries no envelope cursor, so the page tail's id is the
    // only one available. Setting neither is what stalled the previous
    // implementation on this shape.
    const page = nested as Row[];
    const cursor = page.length ? (String((page[page.length - 1] as Row).id ?? '') || null) : null;
    return { page, cursor };
  }
  return { page: [], cursor: null };
}

async function walkMessages(
  supabase: SupabaseClient,
  tokenKey: string,
  headers: Record<string, string>,
  opts: BaseOpts & {
    conversationId: string;
    seedCursor: string | null;
    /** Stop on the first page whose ids are ALL already held. */
    heldIds?: ReadonlySet<string>;
  },
): Promise<GhlWindow<Row>> {
  const items: Row[] = [];
  const cap = Math.max(1, opts.maxPages ?? MAX_PAGES_PER_CONVERSATION);
  let pages = 0;
  let requests = 0;
  let cursor: string | null = opts.seedCursor;

  while (true) {
    if (pages >= cap) return done(items, pages, requests, { stoppedOnBudget: false, hitPageCap: true, failed: false, failureStatus: null, noCursor: false });
    if (pages > 0 && opts.stop?.()) {
      return done(items, pages, requests, { stoppedOnBudget: true, hitPageCap: false, failed: false, failureStatus: null, noCursor: false });
    }

    const params = new URLSearchParams({ limit: String(GHL_MESSAGE_PAGE_LIMIT) });
    if (cursor) params.set('lastMessageId', cursor);

    const res = await ghlFetchShared(
      supabase,
      tokenKey,
      `${opts.base}/conversations/${opts.conversationId}/messages?${params}`,
      { method: 'GET', headers },
      { logTag: opts.logTag ?? 'ghl-conversation-paging' },
    );
    requests++;

    if (!res.ok) {
      try { await res.text(); } catch { /* body already consumed */ }
      return done(items, pages, requests, { stoppedOnBudget: false, hitPageCap: false, failed: true, failureStatus: res.status, noCursor: false });
    }

    const { page, cursor: nextCursor } = readMessagePage(await res.json());
    pages++;

    if (page.length === 0) {
      return done(items, pages, requests, { stoppedOnBudget: false, hitPageCap: false, failed: false, failureStatus: null, noCursor: true });
    }

    items.push(...page);

    // The stop condition. It is asked of the WHOLE page: a page with even one
    // unheld message is crossed, which is how a pre-existing mid-history gap
    // gets filled rather than fencing the walk off above it.
    //
    // There is deliberately NO `page.length < limit` early exit — a short
    // page is not proof of exhaustion, only the absence of a cursor is.
    if (opts.heldIds && opts.heldIds.size > 0 && page.every((m) => opts.heldIds!.has(String((m as Row).id ?? '')))) {
      return done(items, pages, requests, { stoppedOnBudget: false, hitPageCap: false, failed: false, failureStatus: null, noCursor: true });
    }

    if (!nextCursor || nextCursor === cursor) {
      return done(items, pages, requests, { stoppedOnBudget: false, hitPageCap: false, failed: false, failureStatus: null, noCursor: true });
    }
    cursor = nextCursor;
  }
}

/**
 * Walk a conversation from its newest message down, stopping at the first
 * page we already hold in full.
 *
 * `heldIds` MUST be the complete set for the conversation. Handed a window of
 * it — say the newest 50 while the page size is 50 — one new message makes
 * page 1 not-all-held, page 2 is ids 50..99 which the window does not
 * contain, and the walk runs to the bottom of the thread on every tick for
 * ever: the no-op proof inverts into a spin. `loadHeldMessageIds` in the
 * caller pages past PostgREST's `max_rows = 1000` for exactly this reason.
 */
export function fetchMessagesUntilHeld(
  supabase: SupabaseClient,
  tokenKey: string,
  headers: Record<string, string>,
  opts: BaseOpts & { conversationId: string; heldIds: ReadonlySet<string> },
): Promise<GhlWindow<Row>> {
  return walkMessages(supabase, tokenKey, headers, { ...opts, seedCursor: null });
}

/**
 * Walk a conversation OLDER than a message already held — the half that
 * reaches history a top-down walk stops above once the newest page is known.
 */
export function fetchMessagesOlderThan(
  supabase: SupabaseClient,
  tokenKey: string,
  headers: Record<string, string>,
  opts: BaseOpts & {
    conversationId: string;
    anchorMessageId: string;
    /**
     * Optional, and the reason it exists is defensive rather than
     * incremental: if GHL declines the anchor — an id it no longer holds, or
     * one minted locally for a message it rejected — it answers with page ONE,
     * which is the newest messages and which we already hold in full. Passing
     * the held set turns that into a single wasted request instead of a walk
     * back down the whole thread on every tick.
     */
    heldIds?: ReadonlySet<string>;
  },
): Promise<GhlWindow<Row>> {
  return walkMessages(supabase, tokenKey, headers, { ...opts, seedCursor: opts.anchorMessageId });
}
