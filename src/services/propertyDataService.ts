import { airtableService, PropertyListing } from '@/lib/airtable';
import { dedupeListings } from '../../supabase/functions/_shared/listingDuplicates.pure';
import { listingsCacheApi } from '@/lib/listingsCacheApi';
import { INTAKE_SORT_FIELD } from '@/lib/airtableIntakeFields';
import {
  clearListingCache,
  isCacheUsable,
  mergeIncremental,
  mergeRawFields,
  pageIsFullyKnown,
  planRefresh,
  readListingCache,
  readListingRawFields,
  writeListingCache,
  type CachedListingSet,
  type RefreshMode,
} from '@/lib/listingCache';

export interface PropertyDataOptions {
  maxRecords?: number;
  includeDebugInfo?: boolean;
  bypassCache?: boolean;
  tableName?: string;
}


export interface PropertyDataResult {
  listings: PropertyListing[];
  debugInfo: {
    totalFetched: number;
    duplicatesRemoved: number;
    fetchTime: number;
    sources: Record<string, number>;
    dataQuality: {
      withPrice: number;
      withLocation: number;
      withBedrooms: number;
      withPropertyType: number;
    };
    fromCache: boolean;
  };
}

/** Notified when a background revalidation replaces the set the caller was given. */
export type RevalidateListener = (result: PropertyDataResult) => void;

interface MemoryEntry {
  listings: PropertyListing[];
  savedAt: number;
  fullReadAt: number;
}

/**
 * Key used before the server's default table name is known.
 *
 * Overview asks for "the listings" and passes no table name; Listings passes
 * `'Property Intake Master'` explicitly. The proxy resolves the first to the
 * second, so it is one table — but the client cached it twice under two keys,
 * which meant the two pages never shared a cache entry and never coalesced a
 * request, and every navigation between them paid for a fresh walk.
 */
const FALLBACK_TABLE_KEY = '__default__';

/**
 * Where the resolved name is remembered between visits.
 *
 * Only the very first load of a fresh profile can be ambiguous; after that the
 * name is known before the first request goes out, so both pages agree on the
 * key from the start. A stale value is harmless — the worst case is one wasted
 * cache entry, which the schema version or the 24 h age limit clears.
 */
const DEFAULT_TABLE_STORAGE_KEY = 'npc:listings:default-table';

function readStoredDefaultTable(): string | null {
  try {
    return globalThis.localStorage?.getItem(DEFAULT_TABLE_STORAGE_KEY) || null;
  } catch {
    return null; // Private mode, disabled storage — the fallback key still works.
  }
}

/**
 * Unified property data service: one fetch path, one cache, shared by Overview,
 * Listings and the report generators.
 *
 * A cold read is `ceil(N/100)` **sequential** trips through `airtable-proxy` —
 * the offset for page N+1 only exists once page N has come back, so there is no
 * parallelism to find. The wins therefore have to come from not doing the walk:
 *
 *  0. **Not walking at all.** The `listings-cache` edge function keeps a
 *     Postgres mirror of the table, refreshed by cron, so the normal path is one
 *     request rather than fifteen — and unlike everything below it, that holds
 *     on a first visit, a new device and a cleared profile too. The Airtable
 *     walk survives as the fallback for when the cache cannot answer.
 *  1. **Coalescing.** Overview and Listings mount within milliseconds of each
 *     other and both asked for everything, so the whole walk ran twice, in
 *     parallel, against the same rate limit. Concurrent callers now share one
 *     promise per table.
 *  2. **Persistence.** The cache used to be a field on this singleton, so it
 *     died with the page. A reload, a new tab, or a restored session each paid
 *     full price. It now lives in IndexedDB and is handed back on the first call
 *     while the network work happens behind the render.
 *  3. **Incremental revalidation.** Airtable is read newest-first, so a warm
 *     session only needs to walk until it recognises a page — one request rather
 *     than twenty. `planRefresh` decides when that is safe and when a full
 *     reconcile is due (see `listingCache.ts` for why both exist).
 */
class PropertyDataService {
  private memory = new Map<string, MemoryEntry>();
  /** One in-flight network walk per table, shared by every concurrent caller. */
  private inFlight = new Map<string, Promise<PropertyListing[]>>();
  /** Set once per table so hydration from disk is attempted exactly once. */
  private hydrated = new Map<string, Promise<MemoryEntry | null>>();
  private listeners = new Map<string, Set<RevalidateListener>>();
  /** The server's resolved default table name, once anything has told us. */
  private defaultTableKey: string | null = readStoredDefaultTable();

  /** The cache key for a request, collapsing "no table name" onto the real one. */
  private keyFor(tableName?: string): string {
    return tableName || this.defaultTableKey || FALLBACK_TABLE_KEY;
  }

  /**
   * Records what the server resolved "no table name" to, and moves anything
   * already filed under the placeholder across so the pages converge within the
   * same visit rather than at the next reload.
   */
  private learnDefaultTable(resolved: string): void {
    if (!resolved || this.defaultTableKey === resolved) return;
    this.defaultTableKey = resolved;
    try {
      globalThis.localStorage?.setItem(DEFAULT_TABLE_STORAGE_KEY, resolved);
    } catch {
      // Storage unavailable; the in-memory value still unifies this session.
    }
    for (const map of [this.memory, this.hydrated, this.listeners] as Array<Map<string, unknown>>) {
      const held = map.get(FALLBACK_TABLE_KEY);
      if (held === undefined) continue;
      map.delete(FALLBACK_TABLE_KEY);
      if (!map.has(resolved)) map.set(resolved, held);
    }
  }

  /**
   * Subscribe to background revalidations for a table.
   *
   * Stale-while-revalidate means the first caller is answered from disk before
   * the network has been touched; this is how it finds out the fresh set landed.
   */
  subscribe(tableName: string | undefined, listener: RevalidateListener): () => void {
    const key = this.keyFor(tableName);
    const set = this.listeners.get(key) ?? new Set();
    set.add(listener);
    this.listeners.set(key, set);
    return () => set.delete(listener);
  }

  private emit(tableKey: string, listings: PropertyListing[]): void {
    // A refresh that started before the default table name was resolved emits
    // under the placeholder key, but its listeners have since been moved.
    const set =
      this.listeners.get(tableKey) ??
      (tableKey === FALLBACK_TABLE_KEY && this.defaultTableKey
        ? this.listeners.get(this.defaultTableKey)
        : undefined);
    if (!set?.size) return;
    const result = this.buildResult(listings, Date.now(), true, false);
    for (const listener of set) {
      try {
        listener(result);
      } catch (error) {
        console.warn('[propertyDataService] revalidate listener threw', error);
      }
    }
  }

  /** Whatever is already in memory for this table, with no I/O of any kind. */
  peek(tableName?: string): PropertyListing[] | null {
    return this.memory.get(this.keyFor(tableName))?.listings ?? null;
  }

  private async hydrate(tableKey: string): Promise<MemoryEntry | null> {
    const existing = this.hydrated.get(tableKey);
    if (existing) return existing;

    const promise = (async () => {
      const entry: CachedListingSet | null = await readListingCache(tableKey);
      if (!isCacheUsable(entry, Date.now())) return null;
      const loaded: MemoryEntry = {
        listings: entry!.listings,
        savedAt: entry!.savedAt,
        fullReadAt: entry!.fullReadAt,
      };
      // Only adopt the disk copy if nothing fresher arrived while we were reading.
      if (!this.memory.has(tableKey)) this.memory.set(tableKey, loaded);

      // The raw Airtable mirror is stored apart from the listings because it is
      // two thirds of the bytes and feeds one on-demand panel. Fold it back in
      // once the page already has something to draw.
      void readListingRawFields(tableKey).then((rawById) => {
        if (!rawById) return;
        const current = this.memory.get(tableKey);
        if (!current) return;
        const merged = mergeRawFields(current.listings, rawById);
        if (merged !== current.listings) this.memory.set(tableKey, { ...current, listings: merged });
      });

      return loaded;
    })();

    this.hydrated.set(tableKey, promise);
    return promise;
  }

  /**
   * Reads the whole set from the server-side cache.
   *
   * This is the fast path and it is one request: the `listings-cache` edge
   * function keeps a Postgres mirror of the Airtable table, refreshed by cron,
   * so a page load costs a single Postgres read instead of `ceil(N/100)`
   * sequential Airtable trips. Unlike the browser cache it also helps a first
   * visit, a new device and a cleared profile, which is most of the load worth
   * fixing.
   *
   * Returns null when the cache cannot answer — not deployed, never synced,
   * erroring — and the caller falls back to walking Airtable. The cache is an
   * optimisation; a blank dashboard is worse than a slow one.
   */
  private async readServerCache(tableName: string | undefined): Promise<PropertyListing[] | null> {
    const result = await listingsCacheApi.read(tableName);
    if (!result) return null;
    // The response says which table the server resolved the request to, which is
    // the only authoritative answer to what `__default__` means.
    if (!tableName && result.tableKey) this.learnDefaultTable(result.tableKey);
    return this.processAndDeduplicateListings(result.listings);
  }

  /**
   * Walks Airtable pages newest-first.
   *
   * `stopWhenKnown` turns the walk into an incremental one: it ends at the first
   * page holding nothing new, which for an append-heavy table is page one.
   */
  private async walk(
    tableName: string | undefined,
    opts: { maxRecords?: number; stopWhenKnown?: ReadonlySet<string> } = {},
  ): Promise<PropertyListing[]> {
    const { maxRecords, stopWhenKnown } = opts;
    const collected: PropertyListing[] = [];
    let offset: string | undefined;
    let pageCount = 0;
    const maxPages = maxRecords ? Math.ceil(maxRecords / 100) : Infinity;

    do {
      const response = await airtableService.getRecords({
        pageSize: 100,
        offset,
        // `Created` does not exist on this table; `Created Time` does. The wrong
        // name never failed loudly — the proxy answers a 422 by silently
        // retrying without any sort — but this walk's `stopWhenKnown` shortcut
        // is only correct on a newest-first read, so it had quietly stopped
        // being safe.
        sortField: INTAKE_SORT_FIELD,
        sortDirection: 'desc',
        tableName,
      });

      const page = this.processAndDeduplicateListings(response.records);
      collected.push(...page);
      offset = response.offset;
      pageCount += 1;

      if (stopWhenKnown && pageIsFullyKnown(page, stopWhenKnown)) break;
      if (maxRecords && collected.length >= maxRecords) return collected.slice(0, maxRecords);
      if (pageCount >= maxPages) break;
    } while (offset);

    return collected;
  }

  /** Runs a refresh, sharing one in-flight promise across concurrent callers. */
  private refresh(
    tableKey: string,
    tableName: string | undefined,
    mode: Exclude<RefreshMode, 'none'>,
    opts: { skipServerCache?: boolean } = {},
  ): Promise<PropertyListing[]> {
    const running = this.inFlight.get(tableKey);
    if (running) return running;

    const promise = (async () => {
      const cached = this.memory.get(tableKey);
      const now = Date.now();

      // One request for the whole set, so there is no incremental variant to
      // choose here — a server-cache read is always a complete read.
      //
      // Skipped when the user pressed Refresh. The server cache is at most one
      // sync interval behind Airtable, which is right for a page load and wrong
      // for someone who just clicked a button to get current data — they would
      // be handed the same stale set they were already looking at.
      const served = opts.skipServerCache ? null : await this.readServerCache(tableName);
      if (served) {
        const key = this.keyFor(tableName);
        this.memory.set(key, { listings: served, savedAt: now, fullReadAt: now });
        void writeListingCache(key, served, { savedAt: now, fullReadAt: now });
        return served;
      }

      if (mode === 'incremental' && cached?.listings.length) {
        const knownIds = new Set(cached.listings.map((l) => l.id));
        const fetched = await this.walk(tableName, { stopWhenKnown: knownIds });
        const merged = mergeIncremental(cached.listings, fetched);
        const entry: MemoryEntry = { listings: merged, savedAt: now, fullReadAt: cached.fullReadAt };
        this.memory.set(tableKey, entry);
        void writeListingCache(tableKey, merged, { savedAt: now, fullReadAt: cached.fullReadAt });
        return merged;
      }

      const listings = await this.walk(tableName);
      this.memory.set(tableKey, { listings, savedAt: now, fullReadAt: now });
      void writeListingCache(tableKey, listings, { savedAt: now, fullReadAt: now });
      return listings;
    })().finally(() => {
      this.inFlight.delete(tableKey);
    });

    this.inFlight.set(tableKey, promise);
    return promise;
  }

  /**
   * Fetch all property listings.
   *
   * Returns as soon as there is something usable to draw. When that came from
   * cache and a refresh is warranted, the refresh runs behind the render and
   * `subscribe` callers are told when it lands.
   */
  async fetchAllListings(options: PropertyDataOptions = {}): Promise<PropertyDataResult> {
    const startTime = Date.now();
    const { maxRecords, includeDebugInfo = false, bypassCache = false, tableName } = options;
    const tableKey = this.keyFor(tableName);

    // A bounded read is a different question from "the whole table" and must not
    // be answered from, or written to, the full-table cache.
    if (maxRecords) {
      const listings = await this.walk(tableName, { maxRecords });
      return this.buildResult(listings, startTime, includeDebugInfo, false);
    }

    if (bypassCache) {
      // An explicit refresh goes all the way to Airtable. Every cache layer is
      // bypassed, including the server one — otherwise the button would hand
      // back data up to a sync interval old, which is what the user pressed it
      // to get away from.
      const listings = await this.refresh(tableKey, tableName, 'full', { skipServerCache: true });
      return this.buildResult(listings, startTime, includeDebugInfo, false);
    }

    let entry = this.memory.get(tableKey) ?? null;
    if (!entry) entry = await this.hydrate(tableKey);
    // Hydration may have merged rawFields in behind us; take the current copy.
    entry = this.memory.get(tableKey) ?? entry;

    const mode = planRefresh({
      savedAt: entry?.savedAt ?? null,
      fullReadAt: entry?.fullReadAt ?? null,
      now: Date.now(),
    });

    if (entry && mode === 'none') {
      return this.buildResult(entry.listings, startTime, includeDebugInfo, true);
    }

    if (entry && mode !== 'none') {
      // Stale-while-revalidate: answer from cache now, catch up behind the render.
      void this.refresh(tableKey, tableName, mode)
        .then((listings) => this.emit(tableKey, listings))
        .catch((error) => console.warn('[propertyDataService] background refresh failed', error));
      return this.buildResult(entry.listings, startTime, includeDebugInfo, true);
    }

    if (entry) return this.buildResult(entry.listings, startTime, includeDebugInfo, true);

    const listings = await this.refresh(tableKey, tableName, 'full');
    return this.buildResult(listings, startTime, includeDebugInfo, false);
  }

  /**
   * Clear one table's cache so the next read goes to the network.
   *
   * Scoped deliberately. This used to wipe the entire IndexedDB store when
   * called without a table name, which is what the Listings refresh button and
   * the data-validation panel both do — so hitting Refresh on Listings also
   * reset Overview to cold, and the next visit there paid for a full walk it
   * had not asked for.
   */
  clearCache(tableName?: string): void {
    const key = this.keyFor(tableName);
    this.memory.delete(key);
    this.hydrated.delete(key);
    void clearListingCache(key);
  }

  /** Drop every table. Only for teardown — see `clearCache` for the usual case. */
  clearAllCaches(): void {
    this.memory.clear();
    this.hydrated.clear();
    void clearListingCache();
  }

  /**
   * Minimal processing - server already handles deduplication
   */
  private processAndDeduplicateListings(rawListings: PropertyListing[]): PropertyListing[] {
    const standardized = rawListings.map(listing => this.standardizeListing(listing));
    return standardized;
  }

  /**
   * Standardize listing data for consistent processing
   */
  private standardizeListing(listing: PropertyListing): PropertyListing {
    // Cast to any to check alternate field names from raw API responses
    const raw = listing as any;

    // Resolve images from multiple possible field names (case-insensitive edge function responses)
    const resolvedImages = listing.images 
      || raw.Images || raw.Property_Images || raw.property_images 
      || raw.Attachments || raw.attachments || raw.Photos || raw.photos || [];

    // Legacy server projections stamp literal sentinels instead of nulls. The
    // current projection stopped, but the deployed proxy can lag this bundle by
    // days, and every consumer downstream — dedup, facets, the contact
    // resolver, the cards — is written for null-means-unknown. Scrub at the
    // door so one stale server cannot resurrect "Unknown Agent" in the UI.
    const scrub = (value: unknown): string | undefined => {
      if (typeof value !== 'string') return value as undefined;
      return /^unknown(\s+(address|suburb|agent|agency))?$/i.test(value.trim()) ? undefined : value;
    };

    // Resolve floorplans from multiple possible field names
    const resolvedFloorplans = listing.floorplans 
      || raw.Floorplans || raw.Floor_Plans || raw.floor_plans 
      || raw.FloorPlan || raw.floorplan || [];

    return {
      ...listing,
      address: scrub(listing.address),
      agentName: scrub((listing as any).agentName),
      agencyName: scrub((listing as any).agencyName),
      propertyType: this.standardizePropertyType(listing.propertyType),
      suburb: this.standardizeSuburb(scrub(listing.suburb) || scrub(listing.location)),
      price: this.standardizePrice(listing.price),
      beds: this.standardizeBedBath(listing.beds || listing.bedrooms),
      baths: this.standardizeBedBath(listing.baths || listing.bathrooms),
      receivedAt: listing.receivedAt || listing.createdAt || listing.createdTime,
      // Attachment OBJECTS pass through untouched; only non-arrays are dropped.
      // Flattening them to bare URLs (the old behaviour) destroyed the stable
      // attachment id, and Airtable rotates attachment URLs roughly two-hourly —
      // so the image pipeline saw a "new" set every rotation and re-harvested
      // bytes it already stored. `normaliseImageCandidates` handles both shapes
      // and keeps the id as the identity.
      images: Array.isArray(resolvedImages) ? resolvedImages.filter(Boolean) : [],
      floorplans: this.normalizeAttachments(resolvedFloorplans),
      dataQuality: this.calculateDataQualityScore(listing),
      isValidPrice: this.isValidPrice(listing.price),
      isValidLocation: this.isValidLocation(listing.address || listing.location),
      completenessScore: this.calculateCompletenessScore(listing)
    };
  }

  /**
   * Normalize Airtable attachment fields - handles both attachment objects and URL strings
   */
  private normalizeAttachments(attachments: any): string[] {
    if (!attachments) return [];
    if (!Array.isArray(attachments)) return [];
    if (attachments.length === 0) return [];
    
    return attachments.map((att: any) => {
      if (typeof att === 'string') return att;
      if (att && typeof att === 'object') {
        // Airtable attachment object: { id, url, filename, ... }
        return att.url || att.thumbnails?.large?.url || att.thumbnails?.small?.url || '';
      }
      return '';
    }).filter((url: string) => url.length > 0);
  }

  /**
   * Calculate data quality score for a listing
   */
  private calculateDataQualityScore(listing: PropertyListing): number {
    let score = 0;
    const weights = {
      price: 25, address: 20, bedrooms: 15, bathrooms: 10,
      propertyType: 10, suburb: 10, agent: 5, description: 5
    };

    if (this.isValidPrice(listing.price)) score += weights.price;
    if (this.isValidLocation(listing.address || listing.location)) score += weights.address;
    if ((listing.beds || listing.bedrooms) && (listing.beds || listing.bedrooms)! > 0) score += weights.bedrooms;
    if ((listing.baths || listing.bathrooms) && (listing.baths || listing.bathrooms)! > 0) score += weights.bathrooms;
    if (listing.propertyType) score += weights.propertyType;
    if (listing.suburb) score += weights.suburb;
    if (listing.agent || listing.agentName) score += weights.agent;
    if (listing.description && listing.description.length > 20) score += weights.description;

    return score;
  }

  /**
   * Absent stays absent.
   *
   * These used to substitute the string 'Unknown', which is not a property type
   * and not a suburb — it became a selectable value in the filter facets, a
   * group in every report's "by suburb" breakdown, and a value that passed every
   * `if (listing.suburb)` check downstream.
   */
  private standardizePropertyType(type?: string | null): string | null {
    if (!type) return null;
    const normalized = type.toLowerCase().trim();
    if (normalized.includes('house') || normalized.includes('home')) return 'House';
    if (normalized.includes('apartment') || normalized.includes('unit')) return 'Apartment';
    if (normalized.includes('townhouse') || normalized.includes('town house')) return 'Townhouse';
    if (normalized.includes('villa')) return 'Villa';
    if (normalized.includes('duplex')) return 'Duplex';
    if (normalized.includes('land') || normalized.includes('lot')) return 'Land';
    return type;
  }

  private standardizeSuburb(suburb?: string | null): string | null {
    if (!suburb) return null;
    return suburb.trim().replace(/\s+/g, ' ')
      .split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
  }

  private standardizePrice(price?: number | null): number | null {
    if (!price || price <= 0 || price > 50000000) return null;
    return Math.round(price);
  }

  private standardizeBedBath(count?: number | null): number | null {
    if (!count || count < 0 || count > 20) return null;
    return Math.round(count);
  }

  private isValidPrice(price?: number | null): boolean {
    return !!(price && price > 0 && price <= 50000000);
  }

  private isValidLocation(location?: string): boolean {
    return !!(location && location.trim().length > 3);
  }

  private calculateCompletenessScore(listing: PropertyListing): number {
    const fields = ['price', 'address', 'beds', 'baths', 'propertyType', 'suburb', 'agent', 'description', 'images', 'source'];
    let filledFields = 0;
    fields.forEach(field => {
      const value = (listing as any)[field];
      if (value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0)) {
        filledFields++;
      }
    });
    return (filledFields / fields.length) * 100;
  }

  /**
   * The single funnel every listings read returns through — cached, fresh,
   * bounded or refreshed — which is why one property becoming one card belongs
   * here rather than in a page.
   *
   * The intake scenario writes the same mailbox message more than once, so the
   * marketplace was showing 148 listings for 107 distinct addresses: 38
   * redundant cards, 26% of the page, four of them visible twice in a single
   * screenshot. `airtable-proxy` already tags what it thinks are duplicates and
   * deliberately removes nothing, leaving the decision to the client; no client
   * ever made it. `_shared/listingDuplicates.pure.ts` makes it, over the whole
   * set rather than one page of it, with a key that cannot merge the eleven
   * different City Beach properties whose street numbers never got extracted.
   *
   * Every caller benefits, and every caller should: counting one property four
   * times inflated the Overview totals and the quantitative reports too.
   */
  private buildResult(listings: PropertyListing[], startTime: number, includeDebugInfo: boolean, fromCache: boolean): PropertyDataResult {
    const fetched = listings.length;
    const deduped = dedupeListings(listings);
    listings = deduped.listings;

    const debugInfo = includeDebugInfo ? {
      // What the source returned, so that `totalFetched - duplicatesRemoved`
      // is the number of cards on the page.
      totalFetched: fetched,
      duplicatesRemoved: deduped.duplicatesRemoved,
      fetchTime: Date.now() - startTime,
      sources: this.calculateSourceDistribution(listings),
      dataQuality: {
        withPrice: listings.filter(l => this.isValidPrice(l.price)).length,
        withLocation: listings.filter(l => this.isValidLocation(l.address || l.location)).length,
        withBedrooms: listings.filter(l => (l.beds || l.bedrooms) && (l.beds || l.bedrooms)! > 0).length,
        withPropertyType: listings.filter(l => Boolean(l.propertyType)).length,
      },
      fromCache,
    } : {
      totalFetched: 0, duplicatesRemoved: 0, fetchTime: 0, sources: {},
      dataQuality: { withPrice: 0, withLocation: 0, withBedrooms: 0, withPropertyType: 0 },
      fromCache,
    };

    return { listings, debugInfo };
  }

  private calculateSourceDistribution(listings: PropertyListing[]): Record<string, number> {
    return listings.reduce((acc, listing) => {
      const source = listing.source || 'Unknown';
      acc[source] = (acc[source] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }
}

export const propertyDataService = new PropertyDataService();
