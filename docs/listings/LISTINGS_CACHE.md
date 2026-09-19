# Server-side listings cache

Why the browser cache was not enough, what replaced it, and the one operation in
here that can destroy data for every user at once.

## The cost being removed

Overview and Listings both need the whole property table. Reading it from
Airtable costs `ceil(N/100)` **sequential** round trips through `airtable-proxy`
— the proxy hard-caps `pageSize` at 100, and the offset for page *N+1* only
exists once page *N* has come back, so there is no parallelism to find. At the
current 1,441 records that is about fifteen trips, and each one additionally runs
an O(n²) dedup pass and writes an `api_usage_log` row.

Every user paid that. On every device. Every visit.

[`DATA_CACHE.md`](./DATA_CACHE.md) describes the browser-side IndexedDB cache
that was added first. Measured in a real browser it works — 13 ms write, 2 ms
read — but it was not delivering, for four reasons found by investigation:

| Found | Effect |
| --- | --- |
| Overview passed no `tableName` (key `__default__`); Listings passed `'Property Intake Master'` | One table cached under two keys. The two pages never shared an entry and in-flight coalescing **never fired between them** — the exact thing the service's own doc comment claimed to have fixed. |
| `clearCache()` with no argument cleared the whole object store | The Listings Refresh button and the data-validation panel both called it, so refreshing Listings reset Overview to cold too. |
| `splitRawFields` stripped `rawFields` but not `fields` | `airtable.ts` spreads the proxy's record, so Airtable's `fields` object survived alongside its own alias. The documented 67% reduction was never realised. |
| — | A browser cache cannot help a **first visit, a new device, or a cleared profile**, which is most of the load worth fixing. |

The first three are fixed in place. The fourth is structural, and is why the
cache moved server-side: one sync populates it for everyone, cron keeps it warm
before anyone opens the app, and Airtable rate-limit pressure collapses from
"per user, per page" to "once per sync interval".

## Shape

```
Airtable  ──(cron, every 15 min: op:'sync')──▶  listings_cache  ──(op:'read')──▶  browser
                                                                                    │
                                                                              IndexedDB
                                                                          (instant repaint)
```

| Layer | Serves | Cost |
| --- | --- | --- |
| IndexedDB | A returning visitor, same profile | ~2 ms, no network |
| `listings_cache` | **Everyone**, including a first visit | 1 request |
| Airtable walk | Fallback when the cache cannot answer | ~15 sequential requests |

The Airtable walk is kept, deliberately. `listingsCacheApi.read()` returns `null`
rather than throwing whenever the cache cannot answer — not deployed, never
synced, denied, erroring — and `propertyDataService` falls back to walking. A
cache is an optimisation; a blank dashboard is worse than a slow one.

## It mirrors Airtable, it does not archive it

Airtable's **"Delete Records After 30 Days"** automation prunes the intake table
30 days after a record's `Created Time`. The sync propagates that here: a record
removed upstream is removed from the cache. The dashboard therefore settles into
a rolling window of current stock.

This was a decision, not an accident, and it was taken knowing that **1,220 of
the 1,441 records currently held are already older than 30 days**. It also runs
against repo precedent — a 30-day purge for market updates shipped and was
reversed five days later
(`20260812010000_market_updates_archive_indefinite_retention.sql`: *"a reversible
lifecycle state, not a deletion queue"*). The difference is that this table is a
cache of a system of record, not the record itself.

**Consequence worth stating plainly:** after this change Supabase is not a second
copy. A record pruned from Airtable is gone from both.

## The reconciliation guard

Deletion is the dangerous part. It is the one operation here that can destroy
data for every user at once, on a schedule, with nobody watching, so the decision
to run it is made from evidence by `planReconciliation`
(`supabase/functions/_shared/listingsCache.pure.ts`) and is refused by default.

A sync may delete only when **all** of these hold:

1. The walk reached the end of Airtable's pagination without erroring. Records a
   truncated walk never reached are indistinguishable from deleted ones.
2. The walk returned something. Zero records is far more likely to be a failed
   read than an emptied table, and deferring an empty table costs nothing.
3. The loss is not implausible — see below.

### Two allowances, not one

The first version of this guard used a single proportional test at 50%, and it
was wrong in the most damaging possible way: **it would have refused the exact
event it exists to propagate.** Airtable's automation runs `findRecords` with
`limit: 1000`, so one night can legitimately remove a thousand records; against
1,441 held that is 69% of the table. A purely proportional guard would have
blocked it, and the cache would have quietly stopped mirroring deletions
altogether while reporting success.

So there are two independent allowances, and a sync is refused only when it
exceeds **both**:

| Constant | Value | Why |
| --- | --- | --- |
| `MAX_DELETION_ABSOLUTE` | 1,200 | The automation's own `limit: 1000` plus headroom. **If that limit changes upstream, this has to change with it.** |
| `MAX_DELETION_SHARE` | 0.75 | Covers a proportionate change on a table of any size. |
| `SMALL_TABLE_FLOOR` | 20 | Below this, "half the table" is one or two records and proportion says nothing. |

A refused run still upserts everything it saw. It records `status='partial'`,
`reconciled=false`, and the reason in `last_error`, and — critically — it does
**not** move `record_count`. Only a clean, fully reconciled run updates the
baseline the next run compares against; a partial run that wrote there would
teach the guard a count it never actually verified.

## Two things the proxy does that the sync deliberately does not

Both were found by reading `airtable-proxy`, and both would have been silent
bugs.

**`getValidDate()` falls back to `new Date()`.** A record with no date at all
comes back looking brand new on every read. Copying that into
`listings_cache.created_time` would make an undated record permanently fresh
here while Airtable's own 30-day window — which reads the real `Created Time` —
pruned it. `extractCreatedTime` returns `null` instead: the cache and the source
have to be looking at the same clock. The proxy's fallback survives only as a
*display* value, in `projectAirtableRecord`.

**The proxy silently drops sorting.** When a table rejects the sort field it
retries without it and tells the caller nothing (`index.ts:205-221`). The sync
does the same retry — it reads the whole table either way, so order does not
affect its correctness — but `orderLooksSorted` checks the result and writes the
fact to `last_error`, because the client's incremental path *does* depend on
newest-first.

## Files

| File | Role |
| --- | --- |
| `supabase/migrations/20260818000000_listings_cache.sql` | `listings_cache`, `listings_cache_sync`, service-role-only RLS, the 15-minute cron |
| `supabase/functions/listings-cache/index.ts` | `op:'read'` (module-gated) and `op:'sync'` (service role) |
| `supabase/functions/_shared/listingsCache.pure.ts` | Field extraction, fingerprinting, **the reconciliation guard** |
| `supabase/functions/_shared/airtableListing.pure.ts` | The Airtable → listing projection, extracted from the proxy so both readers share one copy |
| `src/lib/listingsCacheApi.ts` | Client; fails soft to `null` |
| `src/lib/airtableListingTransform.ts` | Browser re-export of the projection |
| `src/services/propertyDataService.ts` | Prefers the cache, falls back to the walk |

## Sequencing the Airtable change

The automation (`wflOUO4qcLHFpMUA8`) currently deletes from **Properties**
(`tblH9cW4EhVs6D5H1`), which is not the table the app reads. Repointing it at
**Property Intake Master** (`tblWIg5cs85O30pcY`, `Created Time` =
`fldoZWwTidEhcrmeg`) is the **last** step, after the backfill is verified,
because it permanently deletes 1,220 records.

Three things have to move together — the `findRecords` node's `tableId`, its
filter field, **and the `customScript` node's own table binding**
(`getBaseMetadata("tblH9cW4EhVs6D5H1", "id")`). Missing the third would leave the
script deleting from the old table entirely.

## Verifying

1. `npx vitest run src/lib/listingsCacheModel.test.ts` — the guard has the
   heaviest coverage of anything here, for the reason above.
2. Run `op:'sync'` once by hand and compare `listings_cache` against Airtable's
   record count. **They must match before anything else proceeds.**
3. Load Overview and Listings; the network panel should show **one**
   `listings-cache` call each, not ~15 `airtable-proxy` calls, and navigating
   between them should show none.
4. Prune rehearsal: delete a handful of Airtable records, sync, confirm they
   leave the cache and the guard did not trip. Then confirm the guard positively
   — a truncated walk must record `status='partial'` and delete nothing.
5. Only then repoint the automation.
