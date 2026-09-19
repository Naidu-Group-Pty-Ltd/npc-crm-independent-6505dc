/**
 * Client for the server-side listings cache.
 *
 * Reading the property table from Airtable costs `ceil(N/100)` **sequential**
 * round trips through `airtable-proxy`, because the offset for page N+1 only
 * exists once page N has come back. That cost was paid per user, per device, per
 * visit. The `listings-cache` edge function turns it into a single Postgres read
 * shared by everyone, kept warm by cron.
 *
 * This module is deliberately thin and deliberately fallible: every failure
 * returns `null` rather than throwing, so the caller can fall back to the
 * Airtable walk. The cache is an optimisation, and a dashboard that goes blank
 * because a cache was cold is worse than a slow one.
 */
import type { PropertyListing } from '@/lib/airtable';

/**
 * Display name → the key the deployed cache stores rows under.
 *
 * The server's allowlist is env-driven and its sync cron sends no table name at
 * all, so everything is keyed by the Airtable table ID. The UI speaks the human
 * name. Sending the name gets `table_not_permitted`, the client silently falls
 * back to the ~15-page proxy walk, and the whole cache — 1,441 rows, kept warm
 * on a 10-minute cron — goes unread by the one page it was built for. That is
 * how production ran for two days without anyone seeing an error.
 */
const TABLE_KEY_ALIASES: Record<string, string> = {
  'Property Intake Master': 'tblWIg5cs85O30pcY',
};

function toTableKey(tableName?: string): string | undefined {
  if (!tableName) return undefined;
  return TABLE_KEY_ALIASES[tableName] ?? tableName;
}
import { projectAirtableRecord } from '@/lib/airtableListingTransform';
import { invokeSecureFunction } from '@/lib/secureInvoke';

export interface CachedListingsSyncState {
  last_sync_at: string | null;
  last_full_sync_at: string | null;
  status: string | null;
  reconciled: boolean | null;
  /**
   * What Airtable holds, which after the first purge is fewer than this store
   * serves — the difference is the archive. See `AIRTABLE_RETENTION.md`.
   */
  record_count: number | null;
  archived_count?: number | null;
  /**
   * Whether Airtable's 30-day purge still looks like it is running. Asserted
   * from its effect, because the automation cannot be read from this codebase.
   */
  retention_effective?: boolean | null;
  oldest_live_created_time?: string | null;
  retention_note?: string | null;
}

export interface CachedListingsResult {
  listings: PropertyListing[];
  /** The table name the server resolved the request to. */
  tableKey: string;
  sync: CachedListingsSyncState | null;
}

interface CacheReadResponse {
  success?: boolean;
  error?: string;
  tableKey?: string;
  records?: Array<{ id?: unknown; createdTime?: unknown; fields?: Record<string, unknown> | null }>;
  sync?: CachedListingsSyncState | null;
}

/**
 * True once the cache has been populated at least once.
 *
 * An empty result is ambiguous on its own — a table with no listings looks
 * exactly like a cache that has never synced — so the caller needs the sync
 * state to tell them apart. Only the second is worth falling back for.
 */
function hasBeenPopulated(sync: CachedListingsSyncState | null | undefined): boolean {
  return Boolean(sync?.last_full_sync_at);
}

export const listingsCacheApi = {
  /**
   * Reads the whole cached set for a table.
   *
   * Returns `null` when the cache cannot answer — not configured, not deployed,
   * never synced, denied, or erroring — which the caller reads as "walk Airtable
   * instead". It does **not** return null for a genuinely empty table that has
   * synced; that is a real answer.
   */
  async read(tableName?: string): Promise<CachedListingsResult | null> {
    const tableKey = toTableKey(tableName);
    let data: CacheReadResponse | null = null;
    try {
      const response = await invokeSecureFunction<CacheReadResponse>('listings-cache', {
        op: 'read',
        ...(tableKey ? { tableName: tableKey } : {}),
      });
      if (response.error) {
        console.warn('[listingsCache] read failed, falling back to Airtable', response.error.message);
        return null;
      }
      data = response.data ?? null;
    } catch (error) {
      console.warn('[listingsCache] read threw, falling back to Airtable', error);
      return null;
    }

    if (data?.error === 'table_not_permitted' && tableKey) {
      // The alias missed — the server allowlists something else. Its own
      // default table is by definition allowlisted and is the table the sync
      // cron fills, so asking with no name at all is always answerable. One
      // retry, not a loop.
      try {
        const retry = await invokeSecureFunction<CacheReadResponse>('listings-cache', { op: 'read' });
        data = retry.error ? null : (retry.data ?? null);
      } catch {
        data = null;
      }
    }

    if (!data || data.success === false || data.error) {
      console.warn('[listingsCache] read rejected, falling back to Airtable', data?.error);
      return null;
    }

    const records = Array.isArray(data.records) ? data.records : [];
    const sync = data.sync ?? null;
    if (records.length === 0 && !hasBeenPopulated(sync)) return null;

    const listings = records
      .filter((record): record is { id: string; createdTime?: unknown; fields?: Record<string, unknown> } =>
        typeof record?.id === 'string' && record.id.length > 0,
      )
      .map((record) => {
        const projected = projectAirtableRecord({
          id: record.id,
          createdTime: typeof record.createdTime === 'string' ? record.createdTime : null,
          fields: record.fields ?? {},
        });
        // Mirrors what `airtable.ts` does with the proxy's response: the extended
        // detail panels read the untouched Airtable record, not the projection.
        return { ...projected, rawFields: record.fields ?? undefined } as unknown as PropertyListing;
      });

    return { listings, tableKey: data.tableKey || tableName || '', sync };
  },
};
