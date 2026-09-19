# Airtable retention — Property Intake Master

**Base** `NPC Emails` (`apptyShYE0yzL4IGB`)
**Automation** `Delete Property Intake Records After 30 Days` (`wfljwe75Zqv5u8uCx`)
**Cloned from** `Delete Records After 30 Days` (`wflOUO4qcLHFpMUA8`), which does the same
job for the `Properties` table.

Property Intake Master is a working table, not an archive: an intake row is a snapshot of
what an agent's email said on the day it arrived, and a listing that has not been re-sent
in a month is stale. The existing purge on `Properties` already encodes that decision, so
this one is a clone of it rather than a new policy.

## Configuration

| | Value |
|---|---|
| Trigger | Scheduled — daily, 00:00 `Asia/Kuala_Lumpur` |
| Step 1 | Find records in `Property Intake Master`, where `Created Time` is before *30 days ago* (`Asia/Kuala_Lumpur`), limit 1000 |
| Step 2 | Repeating group over those records → **Run a script**, deleting one record per iteration |

Identical in every parameter to the `Properties` purge except the table and the date
column. The window is measured on **`Created Time`**, a `createdTime` column, so it counts
from when the record entered the table and cannot be moved by a later edit — the same field
family the original keys off (`Created`, also `createdTime`).

> **Status note (2026-08-18).** The manual step below has since been completed.
> An export of the base's automations shows `Delete Property Intake Records After
> 30 Days` is **deployed** with its Run script node (`wacPNnMrRaCKL5iEJ`)
> populated, so it is live rather than a draft. The instructions are kept as the
> record of how it was set up, and as the procedure to repeat when the base is
> rebuilt in the new account — where the script must be pasted by hand again,
> because the API cannot author a script node. See
> [`airtable/npc-emails/automations/`](./airtable/npc-emails/automations/README.md).

## The one manual step

The automation is saved with its trigger and its find step, and **the Run script step is
empty**. Airtable's API refuses to author script nodes — `create_automation` and
`update_automation` both reject `customScript` with `readOnlyNodeType`, by design — so the
body has to be pasted in the UI once.

1. Open <https://airtable.com/apptyShYE0yzL4IGB/wfljwe75Zqv5u8uCx>
2. Inside **For each expired record**, add a **Run script** action
3. Add two input variables:
   | Name | Value |
   |---|---|
   | `recordId` | the loop's current record → **Airtable record ID** |
   | `tableId` | `Property Intake Master` (table id `tblWIg5cs85O30pcY`) |
4. Paste the script — byte-identical to the one the `Properties` purge runs:

```js
let { recordId, tableId } = input.config();

await base.getTable(tableId).deleteRecordAsync(recordId);

console.log(`Deleted record: ${recordId}`);
```

5. Test, then turn the automation on. It is saved as a **draft and is off** until you do.

## Before you turn it on

This deletes records permanently and there is no undo. Two things worth checking on the
first run:

- **It will delete a lot on day one.** Everything already older than 30 days goes in the
  first pass. Run the find step alone first and read the count.
- **`findRecords` caps at 1000 per run.** If the backlog is larger the automation will take
  several nights to drain, one thousand records at a time. That is the same behaviour as
  the `Properties` purge and needs no change — it just means day one is not the whole job.

The dashboard already assumes this window: `listingFreshness` in `src/lib/listingDisplay.ts`
treats "new" as a matter of days rather than weeks specifically because Airtable prunes at
30, and `listings_cache` shares the same retention horizon.

---

## The purge worked. Mirroring it was the bug.

**Sanity check, 2026-08-26.** The automation is running and doing exactly what it
was asked to do:

| | |
|---|---|
| `deploymentStatus` (exported 2026-08-18) | `deployed`, `configurationStatus: valid` |
| Trigger | `cron`, daily, 00:00 `Asia/Kuala_Lumpur` (16:00 UTC) |
| Script node `wacPNnMrRaCKL5iEJ` | populated — the manual step above is done |
| Records in `Property Intake Master` | **51**, oldest `Created Time` 2026-08-04 |
| Age of the oldest live record | **21 days** — inside the 30-day window |
| Records created 2026-07-23 / 07-24 | gone, at 30 and 31 days old |

Nothing survives past the window, and the boundary is being honoured to the day.
There is no defect in the purge.

What *was* wrong is what the product did about it. `listings_cache` **mirrored**
the prune: its reconciliation step deleted every row a completed walk no longer
saw, so the entire marketplace inventory sat on a thirty-day fuse with no copy
anywhere.

```
2026-08-19   148 listings, spanning 2026-07-23 → 2026-08-04
2026-08-26    51 listings, ALL from one evening's intake (2026-08-04)
2026-09-04     0 listings — the next purge takes the rest
```

Those July records cannot be rebuilt. `listing_enrichment.values` holds only
image URLs and `listing_geocodes` is keyed by an address hash with no street
address, so 467 listings' photographs survive in `listing_images` with no record
to attach them to.

**The cache is now an archive.** `planRetention` in
`_shared/listingsCache.pure.ts` decides what a vanished row means:

- **Aged out** — `created_time` at or before `now − (30 + 1) days` → kept, and
  stamped `listings_cache.archived_at`. Still served, still chronological.
- **Still inside the window** → really deleted, because somebody deleted it on
  purpose and a deliberate deletion must still reach the dashboard.
- **No usable `created_time`** → archived. Keeping a listing that should have
  gone is recoverable; deleting the only copy of one is not.

The grace day exists because the two cases are indistinguishable at the
boundary: the automation fires at midnight Kuala Lumpur and the walk that
notices may be a further fifteen minutes behind, so the boundary leans toward
keeping.

A record the walk sees again is un-archived (`reviveArchived`), which matters
only when somebody restores one from Airtable's trash — but an archived row that
is live again has to say so, or reconciliation would never look at it again.

### The deletion guard has a hole, and this is where it is closed

`planReconciliation` decides whether a run may act on absences at all. Its two
allowances are **ANDed** — a run is refused only when the loss exceeds
`MAX_DELETION_ABSOLUTE` (1,200) *and* `MAX_DELETION_SHARE` (75%). That is
calibrated for the nightly purge on a 1,441-row table, and on 148 records it
means a walk that returned **26** would have been acted on in full: 122 missing
never approaches 1,200, so the share test is never reached.

Airtable's offset pagination makes exactly that possible — deleting rows
underneath a paginated walk shifts the window and the walk finishes cleanly
having missed records — and the purge runs at 16:00 UTC, squarely on a `*/15`
sync.

So the destructive half now has its own, much tighter limit. Past
`MAX_REMOVAL_SHARE` (10% of what the walk saw, floor `MIN_REMOVAL_FLOOR` = 5),
the in-window batch is **archived instead of deleted** and the run says so in
`listings_cache_sync.last_error`. It is all-or-nothing deliberately: deleting
the first five and archiving the rest would still lose five listings on every
racing sync. Archiving freely is safe because archiving is reversible; deleting
is not.

### Is it still running? Asked on every sync

The automation lives in Airtable and cannot be read from this codebase, so
`assessRetention` asserts its **effect** instead: if it runs daily, nothing the
walk sees is ever older than 30 + 1 days. Every sync — every fifteen minutes,
so at least 96 times a day — records the answer on `listings_cache_sync`:

| Column | Meaning |
|---|---|
| `oldest_live_created_time` | `Created Time` of the oldest record the walk saw |
| `retention_effective` | false once that is past the window |
| `retention_note` | the sentence explaining either verdict |
| `archived_count` | rows this run archived rather than deleted |

When `retention_effective` goes false the reason is appended to `last_error` and
`error_count`, and the read response carries all four fields out to the client,
so "the 30-day purge has stopped" is observable for the first time. It is worth
observing: this automation has already shipped once as a draft with an empty Run
script node, and nothing in the product would have noticed.

`record_count` still means *what Airtable holds*; the read's `total` is what this
store serves. After the first purge under the archive they differ by design, and
that difference is the archive.

## A note on base ids and the Airtable token

The live base is `apptyShYE0yzL4IGB`, and the automation export in
[`airtable/npc-emails/automations/`](./airtable/npc-emails/automations/README.md)
confirms it: its `Property Intake Master` is `tblWIg5cs85O30pcY`, which is the
`table_key` `listings_cache` actually syncs.

The Airtable token currently wired into the MCP connector **cannot see that
base** — `list_automations(apptyShYE0yzL4IGB)` returns
`INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND`. It sees two bases, one of which is also
called `NPC Emails` (`appFNPL7iYiuQyHAO`): the 2026-08-18 migration target, whose
`Property Intake Master` is `tblumTIRYBn92B2ST` and whose ten automations are all
`undeployed` and structure-only, the script nodes still unpasted.

Two consequences worth knowing before anyone debugs this again:

1. **The live purge cannot be inspected through that token.** That is why
   `assessRetention` asserts the purge's effect from the data rather than reading
   its configuration — the effect is measurable from here and the configuration
   is not.
2. **The migrated base is not a fallback.** Its `Created Time` is a
   `CREATED_TIME()` formula minted at migration, so all 148 rows there date from
   2026-08-18 rather than 2026-07-23 → 2026-08-04. Turning its purge on before
   ~2026-09-17 deletes nothing, and on that date it deletes all 148 at once.
