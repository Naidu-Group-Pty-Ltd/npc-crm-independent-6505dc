# Backfilling the rebuilt base — and why the cutover needs it first

Read this before running `npm run listings:backfill-intake`, before activating
any of the six re-pointed `NPC Email` / Aurixa scenarios in the new Make
account, or before changing which Airtable base the product reads.

## Where this stands

| | |
| --- | --- |
| Live base | `apptyShYE0yzL4IGB` — growing, and what the product serves today |
| Rebuild | `appFNPL7iYiuQyHAO` — a copy taken 2026-08-18, in a **different** Airtable account |
| `Property Intake Master` in the rebuild | **172 records** as of 2026-09-15 — the 171 live `listings_cache` rows, copied and verified, plus one pilot |
| `Aurixa Waitlist` in the rebuild | **10 records**, all stamped `2026-08-18T13:22:03` — untouched since the copy |
| Live rows in `listings_cache` | **171** (plus 51 archived) |

The 148 migrated `Property Intake Master` shells were **deleted on 2026-09-15**.
They were empty by construction — the migration wrote at most one populated
field on any record and only 51 of 148 had even that, so a live read returned
nothing but formula output (`"|||"`, `"Unknown Property Intake Record"`) and the
migration timestamp. Removing them cost nothing and retired the 2026-09-17 purge
clock that `SCRIPT_NODES.md` used to lead with.

What is in the table now is the marketplace: **all 171 live `listings_cache`
rows**, each carrying the stamp described below, plus the unstamped pilot written
at 07:24 (`79 Woodlands Road`, Gatton). **None of it came from Make** —
`NPC Email 1 New` is inactive in the new account and has no execution history
there. The copy was completed on 2026-09-15 and verified against the source; the
measurements are in [Was the copy faithful?](#was-the-copy-faithful) below.

## Why the backfill is the safe half of the cutover

The obvious reason is the one `MAKE_CUTOVER.md` already gives: activating the
re-pointed intake scenarios moves listing intake to a base nothing reads.

The sharper reason costs data. `listings_cache` is an **archive**
([`../integrations/AIRTABLE_RETENTION.md`](../integrations/AIRTABLE_RETENTION.md)),
and `planReconciliation` really deletes a cached row that vanished from the
source table **while still inside** the retention window. Re-pointing the sync at
a base that does not hold today's listings presents all 171 live rows as
vanished at once.

That is survivable — the destructive half carries its own 10% cap, so a batch
that large is archived rather than part-deleted, and archiving is reversible —
but the marketplace still empties, and it empties without anything reporting it.
Backfilling first turns the cutover from an incident into a decision.

**The backfill does not decide the cutover, and running it commits to nothing.**
It only makes the rebuild hold what the product already serves. It is reversible
in one command (`--undo`).

## What travels

The include set is **the columns the product actually reads** —
`INTAKE_FIELDS` in
[`airtableIntakeFields.pure.ts`](../../supabase/functions/_shared/airtableIntakeFields.pure.ts),
the one place intake column names live — plus a provenance set naming where each
row came from. The script parses that module at runtime rather than keeping a
second copy, because a second copy of these names is exactly the defect that
module's header was written to prevent.

Measured over the 171 live rows on 2026-09-15:

| | Bytes |
| --- | ---: |
| Every column the cache holds | 3,327,176 |
| …of which `Email Body Plain Text` alone | 2,540,658 (76%) |
| Product-read columns only | 302,703 |
| **Product-read plus provenance** | **384,571** |

Carrying everything would multiply the transfer roughly ninefold to move columns
no reader opens — the raw AI output, the parsed JSON, the email bodies, the
extraction telemetry. 164 distinct keys exist in the cache; 120 of them map to a
writable target column.

## What cannot travel, and why

Excluded by reading the **target's own schema** rather than by a hardcoded list,
so a schema change cannot silently reintroduce them:

- **Computed columns** — `formula`, `rollup`, `count`, `autoNumber`,
  `createdTime`, `lastModifiedTime`. The consequential one is `Created Time`,
  which in the rebuild is a `CREATED_TIME()` formula minted at migration. **A
  copied row is therefore stamped with the moment it was copied, not with when
  the listing arrived.** That is why the provenance set carries
  `Email Received At`, `Email Sent At` and `First Seen At`: the true origin dates
  survive in columns that can hold them, and `Email Received At` is the honest
  retention basis the schema's own description already recommends.
- **Attachments** — `Listing Images`, `Floorplan`, `Brochure`,
  `Additional Attachments`. An Airtable attachment URL expires within hours (the
  `Listing Image URLs` column description says so itself), so copying them writes
  links that are already dead. The durable URLs in `Listing Image URLs` and
  `Primary Image URL` do travel.
- **Collaborators** — `Assignee`, `Reviewed By`. A user id from one Airtable
  account names nobody in another.

`typecast: true` is set on every write. The rebuild's select options came from
the legacy schema and the live data has moved on, so an option that exists in
production but not yet in the rebuild is created rather than rejected — refusing
it would silently drop the column instead.

## Idempotency, and the undo

Every written record is stamped in `Internal Notes` — a column intake never
writes — as:

```
backfill:listings_cache:<listing_id>:<iso date>
```

The script reads those stamps back before writing and skips any source row
already present, so a run interrupted halfway resumes rather than duplicating.
The same stamp is the undo key: `--undo` deletes exactly the records carrying it
and leaves anything intake wrote alone.

`--verify` re-reads the target and reports any source row that is missing and any
copied cell that did not land.

## Credentials

The rebuild is in a different Airtable account, so the pipeline's own token
cannot reach it — **a personal access token reaches only its own account's
bases**, which is why a perfectly valid token is refused across this boundary and
why the first question on a 401 here is which account minted it.

The script therefore takes its own, under names that collide with none of the six
reserved pipeline names in `listingsPipelineSecrets.pure.ts`:

```sh
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
AIRTABLE_REBUILD_TOKEN=pat… AIRTABLE_REBUILD_BASE_ID=appFNPL7iYiuQyHAO \
  npm run listings:backfill-intake:dry-run
```

Then drop `:dry-run` to write, and `:verify` afterwards. The token needs
`data.records:write` and `schema.bases:read` on that base alone.

## Why this is a script and not something the migration already did

A script reads the source and writes the target with nothing in between, is
re-runnable, and can verify its own work. That is what makes a copy into a system
of record trustworthy, and it is what `scripts/listings/backfill-property-intake.mjs`
is for. **Run the script** for any future copy, top-up or repeat.

The 2026-09-15 copy did not run that way, and the reason is worth recording
because it will recur. The session that did the work had no egress to
`api.airtable.com` or to Supabase — the agent proxy answers `403 CONNECT` under
an organisation policy, and that denial is to be reported rather than worked
around — so the script could not be executed from where the decision was being
made. The one sanctioned write path was the Airtable connector, which meant
relaying all 171 rows by hand in 32 batches.

That is the weaker mechanism, for the obvious reason: the payload is ~660 KB of
machine-generated JSON, reproducing it by hand invites a transcription error
inside a URL or a truncated string, and such an error is invisible until somebody
opens the wrong listing. So the relay was paired with a verification that does
not trust it.

## Was the copy faithful?

Yes, and it was measured rather than assumed — the rule this repository already
applies to the retention purge and the verification self-test: **asserted by
effect, never by configuration.**

The check is in two halves, because the two halves carry different risks. The
*projection* (source row → Airtable payload) was produced by a program, so it is
checked locally against the extract. The *relay* (payload → Airtable) was done by
hand, so it is checked by reading the table back and diffing every cell.

| | |
| --- | --- |
| Records in `listings_cache` (`archived_at is null`) | 171 |
| Records carrying the backfill stamp | **171** — exact set equality, no duplicate, no omission |
| Cells compared, projection vs source extract | **12,678** — 0 altered, 0 dropped, 0 invented |
| Cells compared, Airtable vs written payload | **12,678** — 0 altered, 0 dropped, 0 unexpected |
| Pilot record, compared straight against its source row | **85** cells — 0 altered, 0 dropped |

The read-back was a single query filtered on the stamp, returning all 171 records
with every field, and the comparison normalises what Airtable normalises and
nothing else: a `singleSelect` returns as `{id, name, color}` and is compared on
`name`, a `multipleSelects` as an unordered set of names, numbers numerically,
and datetimes through `fromisoformat` so `…Z` and `…+00:00` agree. Five fields
appear in the read-back that were never written — they are the table's own
computed fields, including the `fldp5d8j03aOu74sV` date the 30-day purge reads.

Two things the count would otherwise hide. The stamped total is **171 = 170 + 1**:
170 arrived in the 32 relay batches and one is the record the script's validation
run wrote at 08:34, which is why a running tally kept during the relay is off by
one against the batch files and why **only the read-back is authoritative**. And
the 07:24 Gatton pilot carries no stamp, so it is outside all of this — it is not
a `listings_cache` row, `--undo` will not touch it, and the table holds 172
records in total.

The stamp is what makes the whole thing re-runnable: the script skips a source row
already present, so the next run adds only what intake has written since, and
`--undo` removes exactly these 171 and nothing else.
