# 49 — Re-importing a linked stock list, and the delete that was never a delete

Read this before touching `_shared/builderStock/linkedSource.ts`,
`sourceReread.pure.ts`, the `reprocess_upload` or `import_url` operations in
`builder-portal-stock`, or `scripts/ops/stock-source-restore.ts` — all on
`aurixa-builders`.

On 19 September 2026 a builder's own Stock List read
`Properties listed 0 · Stock lists uploaded 0` while this Command Centre
published 46 of that builder's properties. **Both screens were correct.**

## What was measured, 19 September 2026

Read-only first, through `portal-scope-state` — a new SELECT-only phase of the
rollout workflow, written because an empty page and a full marketplace can be
two correct answers about two different organisations and neither screen can
tell you which.

It was not a scoping fault. The session **was** acting as the right
organisation:

| | |
| --- | --- |
| Mithruban Bupathy's live session | acting as Mairandi Developers |
| `builder_resolve_permission(…, 'inventory', 'view')` | **true** |
| items active / staged / archived | **0 / 0 / 47** |
| uploads listed / deleted | **0 / 6** |
| items whose organisation differs from their upload's | **0** |

The page was telling the truth about a catalogue somebody had archived.
`builder_portal_activity_log` named who, and when — every row that builder's
own session wrote:

| UTC | act | metadata |
| --- | --- | --- |
| 18 Sep 09:41:29 | `builder_stock_source_deleted` | `{"archived": 47}` |
| 18 Sep 09:41:46 | `builder_stock_url_source_added` | `docs.google.com` |
| 19 Sep 08:39:36 | `builder_stock_source_deleted` | `{"archived": 47}` |
| 19 Sep 08:40:01 | `builder_stock_url_source_added` | `docs.google.com` |
| 19 Sep 09:23:44 | `builder_stock_source_deleted` | `{"archived": 47}` |

Seventeen seconds, then twenty-five.

## The fault

**Delete-then-re-add-the-same-address is nobody removing stock. It is a
builder re-importing, through the only door that worked.**

A linked source is snapshotted when it is imported, and "Read again"
(`reprocess_upload`) re-ran the parsers over that snapshot:

> *A RE-READ RUNS ON THE STORED BYTES.*

For an uploaded **file** that is right — the bytes are the builder's own and
have not changed, and re-reading them is how a parser correction reaches rows
that already exist. For a **link** it is the opposite of what the builder is
asking for: they linked the sheet *because* they keep editing it. Re-reading
the day-old copy reported `47 updated` having imported none of their edits,
and nothing anywhere re-fetched the address.

So the only route that imported a changed sheet was Delete + Add again — and
deleting archives every property the source supplies.

`reprocess_upload`'s own header had already condemned exactly this:

> *"A unique index on `(organisation_id, file_sha256)` refuses the same bytes
> twice … so the only route was to DELETE the source and upload it again,
> which discards the audit trail and every selection made against those
> properties."*

It was written to close that, and it closed it **for files**. A link is the
case where the source genuinely changes, and it was the half left open.

**First broken step: `reprocess_upload`, for every `source_type = 'url'`
source, since it was written.** The third delete — 19 Sep 09:23:44 — was not
followed by an add, and left 47 live properties archived. The clone applied
the archival at 09:25:43 and the marketplace drew nothing.

### Why nothing reported it

Every component was correct and said so. The import reported `47 updated`,
which is true — it wrote 47 rows. The delete reported
`47 properties were removed from the marketplace`, which is true and is what
the confirmation had warned. The mirror faithfully carried the archival. The
only false statement in the whole sequence was the word **"again"** on a
button that could not reach the source.

## The fix

`reprocess_upload` on a `source_type = 'url'` source **fetches the address
again**, re-snapshots it and imports the new bytes. Matching keeps every row's
id, so nothing is archived, no selection is lost, and the marketplace is never
empty for a moment.

Reaching a linked source is not one call — normalisation, a fetch with five
distinct refusals, MIME detection against the declared type, classification,
the Notion public-content recovery with its access-gate and missing-view
findings, and the naming of the snapshot. That moved to `linkedSource.ts`
**verbatim**, and `import_url` calls it too, because two copies is how a
re-fetch comes to read a Notion page differently from the import that
accepted it.

## Rules

1. **A fetch that failed is never laundered into a re-read of the stale copy.**
   A sheet that has been unshared, moved or made private says so and leaves
   the live rows standing. It is prepared **before** anything is marked, so a
   healthy list is never parked in "being read" by a fetch that returned
   nothing to read.
2. **A re-fetch is never more permissive than the first import**, because the
   rows it writes replace ones that are live. Same module, same refusals.
3. **Link discovery is read from *this* fetch**, never from the row's stored
   notice — a sheet whose export permissions have since been fixed must stop
   being stamped "we could not see the links" for ever.
4. **A control that does two different things has to say which.**
   `rereadNaming` is one rule the label, the accessible name and the
   confirmation all read, so a button cannot promise a fetch the toast then
   calls a re-read. An unreadable `source_type` names the **file** act, which
   is the one that cannot reach the network or replace live rows from
   somewhere else.
5. **A read that failed is not a builder who has added nothing.** The same
   page drew `Stock lists uploaded 0` and "No stock lists have been added yet"
   off `uploads.length` — `[]` in flight, `[]` on error — so a lost signal
   made a headline statement about a builder with six of them. The list
   beside it already had its error branch; the headline did not, which is the
   worse of the two because it is the part that is read.

## The repair, and why it is shaped this way

`stock-source-restore` is the exact inverse of **one** logged
`builder_stock_source_deleted` and nothing more. It imports nothing, fetches
nothing and creates no upload row.

Four guards, and each of them is the reason a blunter repair would have been
wrong:

* **The photograph rule is not relaxed to restore a row.** A property returns
  to `active` only where `builder_stock_photo_is_source_ready` says it holds a
  ready builder-source photograph — the one statement of that rule, called
  rather than restated — and everything else returns to `staged`, which is
  where publication would have left it. On the repair that was **46 active,
  1 staged**: Lot 1037, whose brochure and stage plan both name a sibling
  property, held its place in Action Required exactly as it should.
* **Asserted against what the delete recorded.** The activity log said
  `archived: 47`; the restore counted 47. A different number means something
  else has touched the catalogue since, and it refuses with both figures.
* **A newer live generation is never joined** — two generations of one
  catalogue on one marketplace is what the atomic cutover exists to prevent.
* **The upload is un-stamped first**, so there is no moment where properties
  are listed under no stock list at all. That is the contradiction this whole
  incident was reported as, and a repair must not reproduce it even briefly.

Dry run unless `apply` is true, idempotent, asserted by re-reading, and
reversible by the delete the builder already has.

## What this shares with [48](./48-network-stock-sync-path.md)

Both are one screen making a statement about a BUILDER out of a fact about
something else, with every component correct throughout and nothing logged as
an error. Forty-eight's producer had nothing to carry; this one's button had
nothing to fetch. The rule they share:

> **Before concluding a surface is broken, ask what its own predicate
> selects.** Forty-eight: check whether the pipeline has anything to carry.
> Forty-nine: check what the act the reader is being offered can actually
> reach.
