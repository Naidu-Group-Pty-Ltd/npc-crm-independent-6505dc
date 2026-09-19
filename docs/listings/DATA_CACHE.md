# Listing data cache

How Overview and Listings get their data, and why a repeat visit no longer waits.

## The cost being removed

Both pages read the whole listing table through `propertyDataService`, which
pages `airtable-proxy` 100 records at a time. The offset for page *N+1* only
exists once page *N* has returned, so a cold read is `ceil(N/100)` **sequential**
round trips. There is no parallelism to find — the only way to make it faster is
to not do it.

Three things meant it was done far more often than necessary:

| Problem | Effect |
| --- | --- |
| The cache was a field on a module singleton | It died with the page. Every reload, new tab and restored session paid full price. |
| No in-flight coalescing | Overview and Listings mount milliseconds apart and both ask for everything, so the whole walk ran **twice, in parallel**, against one rate limit. |
| `new QueryClient()` with stock defaults | `staleTime: 0` plus refetch-on-mount and refetch-on-focus: every navigation between the two pages, and every alt-tab, discarded the set and re-fetched it. |

## Measured

2,000 listings, 100 per page, 250 ms per round trip:

| Scenario | Before | After |
| --- | --- | --- |
| Cold load, nothing cached | 20 requests (~5.0 s) | 20 requests (~5.0 s) |
| Second consumer, same session | 20 requests | **0** |
| Overview + Listings mounting together | 40 requests | **0** after the first |
| **Page reload** | 20 requests (~5.0 s) | **0 — served from IndexedDB** |
| Warm session, revalidation due | 20 requests | **1** (~0.25 s), behind the render |

The cold load is unchanged and always will be: with nothing on disk there is
nothing to do but walk the table.

## Design

### Storage — IndexedDB, not localStorage

Measured, not assumed: a 2,000-listing set serialises to **14.2 MB**, which
exceeds localStorage's ~5 MB quota outright. localStorage is also synchronous —
a 55 ms `JSON.stringify` on the main thread on every write. IndexedDB has room,
uses structured clone, and does not block.

### `rawFields` is stored apart

`rawFields` is a verbatim copy of the Airtable record kept beside the fields
already projected onto the typed listing. It is **67% of the cached bytes**
(14.2 MB → 4.7 MB without it) and has exactly one consumer: the intake panel in
the details modal, which shows one record at a time, on demand.

So it is written to a separate key and merged back after the listings are on
screen. The hot path restores a third of the bytes; the panel still works.

### Refresh ladder

`planRefresh` in `src/lib/listingCache.ts`:

| Condition | Mode |
| --- | --- |
| No cache, corrupt timestamps, or older than 24 h | `full` |
| Last complete read older than 30 min | `full` |
| Written less than 60 s ago | `none` — no network at all |
| Otherwise | `incremental` |

**Incremental** walks pages newest-first and stops at the first page holding
nothing new. Airtable sorts on `Created`, so for an append-heavy table that is
page one — one request instead of twenty.

**It cannot see an edit to an older record**, because editing does not move it in
a `Created` sort. That is exactly why the 30-minute full reconcile exists, and
why the explicit Refresh button forces `full`. If listings in this base are
edited frequently rather than appended, shorten `FULL_RECONCILE_MS`.

### Stale-while-revalidate

`fetchAllListings` returns as soon as it has something usable to draw. When that
came from cache and a refresh is warranted, the refresh runs behind the render
and `subscribe()` callers are told when it lands — Overview via `setAllListings`,
Listings via `queryClient.setQueryData`.

A failed background refresh is logged and dropped. It must never empty what the
page is already showing.

### Failing soft

The cache is an optimisation. A private-mode window, a denied quota, a blocked
upgrade from another tab, or a database that will not open all degrade to "fetch
it again" — never to an error the user sees. `openDb` also has a 2-second
timeout so a tab holding an upgrade cannot stall the page behind it.

## Invalidating

- `propertyDataService.clearCache(tableName?)` clears memory **and** IndexedDB.
- `CACHE_SCHEMA_VERSION` in `listingCache.ts` — bump it when the cached shape
  changes. Older entries are discarded rather than migrated; it is a cache, and
  re-fetching is always correct.
