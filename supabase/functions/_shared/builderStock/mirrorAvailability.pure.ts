/**
 * An empty Builder Stock tab: which absence is it?
 *
 * ## The defect this exists for
 *
 * A clone showed no properties under "No builder stock has been uploaded yet ·
 * Properties appear here when a builder uploads a stock list in their portal."
 * — the 19 Sep 2026 clone audit's report. Every word of that sentence is wrong
 * on a clone, and each in a different way.
 *
 * `builder_network_stock_*` is a MIRROR. Nothing is uploaded into it here: the
 * Builders Network composes `stock.item.upserted` events into the connection
 * outbox and `builder_network_apply_inbound_events` converges them on a
 * one-minute sweep. A clone with no `builder_network_connections` row — which
 * is every clone until its link is established — has no source of events at
 * all, so the mirror is empty for a reason that has nothing to do with what any
 * builder has or has not supplied.
 *
 * So the page was making a statement about BUILDERS out of a fact about the
 * LINK, and pointing the reader at a portal they cannot reach to fix something
 * that is not broken there. It is the rule this platform has paid for
 * repeatedly — `amenity_register`'s "zero rows for a state never loaded is
 * `unavailable`, never 'no schools here'", `useAmlAccess`'s "we could not
 * check is not you do not have it", `placesAvailability`'s "a lookup that
 * FAILED is not a measurement of zero".
 *
 * ## The rules
 *
 * **A link that has never delivered is its own reading**, distinct from a link
 * that delivers nothing. `no_connection` and `never_synced` say something is
 * owed by an operator; `empty` says the network genuinely holds no stock.
 *
 * **Filters outrank everything.** A filtered result with nothing in it is about
 * the filters, whatever the link is doing, because clearing them is the act in
 * front of the reader.
 *
 * **An unknown link state never claims the network is empty.** The reading
 * fails to `unknown`, which says the page cannot tell — never to the one
 * sentence that blames the builders.
 *
 * Pure + deterministic + JSON-safe: no DOM, network, secrets or clocks.
 */

/** What the server could tell us about the link this mirror is fed by. */
export type MirrorConnectionState = 'active' | 'none' | 'revoked' | 'unknown';

export interface MirrorSource {
  connection: MirrorConnectionState;
  /** The newest `last_seen_at` across mirrored items, or null if there are none. */
  lastSyncedAt?: string | null;
}

export type StockEmptyReason =
  | 'filtered'
  | 'no_connection'
  | 'revoked_connection'
  | 'never_synced'
  | 'empty'
  | 'unknown';

export interface StockEmptyReading {
  reason: StockEmptyReason;
  title: string;
  detail: string;
  /** True where somebody has to do something; false where it is just empty. */
  actionable: boolean;
}

export function readStockEmptyState(args: {
  filtersApplied: boolean;
  source?: MirrorSource | null;
}): StockEmptyReading {
  if (args.filtersApplied) {
    return {
      reason: 'filtered',
      title: 'No builder stock matches those filters',
      detail: 'Clear the filters to see everything builders have supplied.',
      actionable: false,
    };
  }

  const connection = args.source?.connection;

  if (connection === 'none') {
    return {
      reason: 'no_connection',
      title: 'This workspace is not linked to the Builders Network yet',
      detail:
        'Builder Stock mirrors properties the network sends over that link, so there is nothing '
        + 'to show until it is established. An administrator can set it up; no builder needs to '
        + 'do anything.',
      actionable: true,
    };
  }

  if (connection === 'revoked') {
    return {
      reason: 'revoked_connection',
      title: 'The Builders Network link has been revoked',
      detail:
        'No new stock will arrive while the link is revoked. An administrator can restore it.',
      actionable: true,
    };
  }

  if (connection === 'active' && !args.source?.lastSyncedAt) {
    return {
      reason: 'never_synced',
      title: 'The Builders Network link has not delivered any stock yet',
      detail:
        'The link is active and stock arrives on a sweep that runs every minute. If nothing '
        + 'appears, an administrator can check the network connection.',
      actionable: true,
    };
  }

  if (connection === 'active') {
    return {
      reason: 'empty',
      title: 'No builder stock is listed right now',
      detail:
        'The Builders Network link is working and currently carries no available properties. '
        + 'New stock appears here within a minute of a builder listing it.',
      actionable: false,
    };
  }

  // Never the "builders have nothing" sentence on a state we could not read.
  return {
    reason: 'unknown',
    title: 'Builder stock is not available to show',
    detail:
      'This workspace could not confirm the state of its Builders Network link, so it cannot '
      + 'tell whether there is stock to show. Try again shortly.',
    actionable: false,
  };
}

/**
 * Is this the ranking machinery being absent, rather than a real failure?
 *
 * `builder_network_stock_ranked` and the `rank_*` columns arrive with
 * migration 20261202090000. Measured 19 Sep 2026, none of the three clones has
 * it — the whole fleet's migration ledger stops at 20261123000000 — and nor
 * does the PRIME, so the ranked read fails and the marketplace 500s over a
 * mirror that may be full.
 *
 * ## FOUR codes, because PostgREST answers before Postgres does
 *
 * This first shipped accepting **42P01** (undefined_table) and **42703**
 * (undefined_column) — the Postgres codes — and those are not what a caller
 * receives. PostgREST resolves a relation against its own SCHEMA CACHE and
 * refuses before the statement is ever planned, so the wire answer is
 * **PGRST205** for an unknown table and **PGRST204** for an unknown column.
 * Probed against production on 19 Sep 2026:
 *
 * ```
 * GET /rest/v1/builder_network_stock_ranked?select=id&limit=1
 * HTTP 404
 * {"code":"PGRST205","message":"Could not find the table
 *  'public.builder_network_stock_ranked' in the schema cache"}
 * ```
 *
 * `PGRST205` is neither of the two codes this accepted, so the fallback never
 * engaged, and the Builder Stock tab answered "Builder stock could not be
 * loaded." over 46 correctly mirrored properties. The Postgres codes are KEPT
 * rather than replaced: a direct SQL path, a different PostgREST major, or a
 * view that exists while a column behind it does not can still raise them, and
 * a fallback that survives one deployment's error vocabulary and not another's
 * is the thing being fixed.
 *
 * Narrow on purpose. This decides whether to serve a DIFFERENT query, so it
 * must not swallow a real fault: a permission error, a timeout, a broken
 * connection and a malformed filter are all failures that should still be
 * reported as failures. Only codes that mean "this deployment does not have
 * the ranking yet" qualify, and the message must ALSO name the ranking — a
 * missing-relation error about some other table is somebody else's bug, not
 * this fallback's business, and `42501` naming the ranking is a permission
 * fault that must still be reported.
 */
const MISSING_RELATION_CODES = new Set([
  // Postgres, for any path that reaches the planner.
  '42P01', // undefined_table
  '42703', // undefined_column
  // PostgREST's schema cache, which is what a supabase-js caller actually gets.
  'PGRST205', // "Could not find the table … in the schema cache"
  'PGRST204', // "Could not find the … column of … in the schema cache"
]);

export function isMissingRankingRelation(error: unknown): boolean {
  const e = (error ?? {}) as { code?: unknown; message?: unknown };
  const code = typeof e.code === 'string' ? e.code : '';
  if (!MISSING_RELATION_CODES.has(code)) return false;
  const message = typeof e.message === 'string' ? e.message.toLowerCase() : '';
  return message.includes('builder_network_stock_ranked')
    || message.includes('rank_placement')
    || message.includes('rank_item_score')
    || message.includes('ranked_placement_order')
    || message.includes('interleave_bucket');
}
