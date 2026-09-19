# The upload lifecycle — who moves an upload, and who finishes it

Read this before changing `_shared/builderStock/uploadCompletion.ts`, the
settler's tick exits, `settle_builder_stock_marketplace_eligibility_tick`, or
either of the two doors that reprocess a source.

## The states, and who writes them

| status | written by | means |
| --- | --- | --- |
| `uploaded` | the upload request | bytes are stored, nothing read |
| `parsing` | `process_upload` / `reprocess_upload` / the URL import | a request is reading it **right now** |
| `imported` | `runImport` | rows parsed, mid-request only |
| `enriching` / `partially_complete` | the end of the import | properties written; imagery outstanding |
| `complete` / `partially_complete` | **`uploadCompletion.ts`** | the import is finished |
| `failed` | `failUpload` | the read did not produce properties |

Everything except the last row is written inside the request that does the
work. The **completion** is different, and that difference is what this
document exists for.

## Rule 1 — the server records an import as finished

Every stage of imagery lives in `builder-stock-image-settler` now, so an
import finishes with nobody watching. The completion write used to live only
in `enrich_images` — the loop the Builder Portal runs *while somebody has the
page open* — so an unwatched import stayed `enriching` for ever.

Measured, 2 September 2026: `tq.csv` imported at 14:04 (14 detected, 14
updated, 0 failed); ninety minutes later all eleven live properties were
`settled` with ten drawing the builder's own brochure render, and the upload
still read `enriching`.

`uploadCompletion.ts` is the one implementation. **Both callers ask it** — the
portal's loop, so a person who is watching does not wait for a tick, and the
settler's tick, so an unwatched import is recorded anyway. Two implementations
of "is this import finished" is how one of them comes to be wrong.

Three things it will not do:

- **Completion is decided on the PROPERTIES alone.** Whether the settlement
  queue has caught up is a different question; gating on it leaves a source
  too large for one budget reading `enriching` for ever.
- **A read that failed is not an import that finished.** A failed count and an
  incomplete paged read both refuse to settle. The inline copy this replaced
  read `stagePage.rows` without consulting `stagePage.failed`, which would
  have stamped `complete` with an empty summary on a database fault — a record
  stating, permanently, that no images were processed.
- **The import's own verdict decides the final status.** An upload that could
  not save every row settles `partially_complete`, never `complete`.

`image_stage_summary` counts images carrying **this upload's** id. A re-import
whose properties keep imagery from an earlier upload therefore settles with an
empty summary; that is the field's existing meaning and no screen renders it.

## Rule 2 — every housekeeping pass runs on every normal tick exit

The settler tick has **two** normal exits: the fallback phase returns when the
settlement queue is empty, and the settlement path returns after its work. A
pass wired to one of them does not run at all on a deployment that always
leaves by the other.

That has happened twice. The web-image store was first wired inside
per-candidate enforcement — dead once the marketplace settled — and then after
the settlement work alone, which is dead here because fallbacks withheld by the
supplied-evidence gate keep that queue non-empty for ever.

So the exits call **one** function, `runTickHousekeeping`, and the passes are
listed in its body. A pass added there reaches both exits by construction
rather than by remembering. Pinned by `builderStockWebImageStore.test.ts`.

## Rule 3 — the engine's liveness must count every kind of work

`settle_builder_stock_marketplace_eligibility_tick` unschedules its cron job
when no work remains, and `ensure_builder_stock_settlement_scheduled()` arms it
again when work arrives. That is correct: this engine must not run for ever.

It counts **five** kinds now — settlement versions, enrichment, item work,
pending publications, and **uploads still owed their own completion record**.
The fifth was added because without it the four reached zero, the job
unscheduled itself, and an upload sat at `enriching` with nothing alive to move
it: the completion code was deployed and correct, and there was nothing left
running to execute it.

**Adding work to the settler means adding it to this count.** The SQL mirrors
`uploadCompletion.ts`'s rule rather than inventing a second one.

Verified in production, 3 September 2026: armed 04:47 → ticked 04:49:00 →
`tq.csv` `complete` at 04:49:05 → all counts zero at 04:50:00 → engine stood
itself down.

## Rule 4 — a crashed import can be retried

An import killed mid-parse (the worker's resource limit; an ordinary event
here) leaves `parsing` set for ever, and **both** doors then refuse it:
`process_upload` says "This file has already been processed" and
`reprocess_upload` says "This source is being read right now". Neither is true,
and the builder's only recourse was deleting the source — which archives every
property under it.

`parseIsAbandoned` decides. An edge invocation is capped at roughly 150s and
stamps `processing_started_at` in the same write that sets `parsing`, so a row
older than six times that ceiling is not in flight; a `parsing` row with no
readable stamp cannot be one either. It answers false for **every other
status**, so only a stale parse is affected, and only the recovery door
changed: a live read is refused exactly as before, and nothing auto-mutates a
row — the retry re-stamps the start itself.
