# The rebuilt base — what landed in the new account, and what did not

> **The cutover was never completed, and this base is a snapshot.** Every one of
> the 148 `Property Intake Master` records here carries the same creation
> timestamp — `2026-08-18T13:20:37` — and nothing has been written since.
> Meanwhile the source base `apptyShYE0yzL4IGB` is still live: the prime's
> `listings_cache` has taken 171 records created *after* that copy, on 3
> separate days in the last week alone (measured 2026-09-08). The dashboard,
> Mission Control's listings broker and the Make scenario all still read the
> source. **Do not re-point anything at this base** without first moving the
> live data — doing so replaces a growing marketplace with a frozen one, and
> `listings_cache` is an archive that cannot rebuild a listing. The full
> reasoning, and the reason a valid Airtable token can be refused across this
> boundary, is in
> [`AIRTABLE_KEY_OWNERSHIP.md`](../../AIRTABLE_KEY_OWNERSHIP.md).


The bundle beside this file describes the **source** base (`apptyShYE0yzL4IGB`).
This file describes the **target**: base **`appFNPL7iYiuQyHAO`**, still named
`NPC Emails`, in workspace `wsp6aFpcSUCiVC3Dp` of the company Airtable account.
It was rebuilt over MCP on 2026-08-18 by replaying
[`schema/create-plan.json`](./schema/create-plan.json) and the pass-1 batches.

Read this before assuming the two bases are the same shape. Nine of the ten
tables carry their records; the tenth is a manual import; and eleven fields could
not be created with the type the source used.

## Table ids

Field ids are minted by the target base and do **not** match the source. Anything
that addresses a field by id — a Make module, an automation, a script — has to be
re-pointed. Names survived the move unchanged.

| Table | New table id | Records | Source |
| --- | --- | ---: | ---: |
| Opt-In Calls | `tblrWdu0MU3i4No0h` | 32 | 32 |
| Lead Data Test | `tblotE5pdMly454l3` | 7 | 7 |
| Emails | `tblc4u4AhVed04lVN` | **0** | 5,325 |
| Quiz Sub Calls | `tblZlUsxh22DXjOH4` | 0 | 0 |
| Properties | `tbl7JAawCPdd8QPZP` | 0 | 0 |
| Strategic Review Bookings | `tblnvoQdMqh8mnvmO` | 2 | 2 |
| Aurixa Waitlist | `tblaSuqLKa00rqdtu` | 10 | 10 |
| Business Readiness Responses | `tbl3VGRV7xBvSSGlq` | 1 | 1 |
| BRQ Detailed Responses | `tblLn0n6v6ubGrTbA` | 12 | 12 |
| Property Intake Master | `tblumTIRYBn92B2ST` | 148 | 148 |

**212 of 5,537 records.** The gap is `Emails` in its entirety: 5,325 records that
cannot be passed as inline tool arguments. They are a CSV import a person runs —
see [`migration/csv/README.md`](./migration/csv/README.md). Every other table
matches its source count exactly.

**All five link cells in the link plan are satisfied, by three writes.** Airtable
link fields are bidirectional, so the two `Aurixa Waitlist → BRQ Detailed
Responses` entries are the reverse side of edges written from the BRQ table and
did not need writing separately. Verified in the target: 3 of the 12 BRQ rows
carry an `Applicant` link, which is the whole of the source's link graph. No link
in this base involves `Emails`, so the missing `Emails` records cost no edges.

## The eleven fields the API cannot create

`create_field` accepts 25 field types. Four that this base uses are not among
them: `aiText`, `createdTime`, `lastModifiedTime` and `autoNumber`. Eleven fields
use one of those four, so **none of the eleven was created with its source type.**

**Four have an exact formula equivalent, and were created that way.** Airtable's
formula language has `CREATED_TIME()` and `LAST_MODIFIED_TIME()`, which return
the same instant the native field type would. Each carries a description on the
field saying what it stands in for.

| Table | Field | New field id | Formula |
| --- | --- | --- | --- |
| Properties | `Created` | `fld4RX5aE99pzc5R8` | `CREATED_TIME()` |
| Lead Data Test | `Created at` | `fldw8y4JUFG6Y6sgr` | `CREATED_TIME()` |
| Property Intake Master | `Created Time` | `fldp5d8j03aOu74sV` | `CREATED_TIME()` |
| Property Intake Master | `Last Modified Time` | `fldPeld9mzwbEABDX` | `LAST_MODIFIED_TIME()` |

**These read 2026-08-18 for every migrated record, and that is not a defect of the
substitution.** A created-time value is a property of the row, minted when the row
is inserted — the native field type would say exactly the same thing. The original
timestamps are in [`records/`](./records) as `sourceCreatedTime` and cannot be
written into any computed field, native or formula. If a date matters to a
downstream query, copy it into a writable `dateTime` column before relying on it.

**Seven have no API equivalent at all and must be added in the UI.** Five are
`aiText`, whose values Airtable generates itself from a referenced field, and two
are `autoNumber` primaries.

| Table | Field | Type | Reads from |
| --- | --- | --- | --- |
| Emails | `Attachment Summary` | aiText | `Attachments` |
| Lead Data Test | `Attachment Summary` | aiText | `Attachments` |
| Aurixa Waitlist | `Bypass URL Summary (Bypass URL)` | aiText | `Bypass URL` |
| Aurixa Waitlist | `Bypass URL Title (Bypass URL)` | aiText | `Bypass URL` |
| Aurixa Waitlist | `Bypass URL Headline (Bypass URL)` | aiText | `Bypass URL` |
| Business Readiness Responses | `Record ID` | autoNumber | — |
| BRQ Detailed Responses | `Id` | autoNumber | — |

Nothing reads any of the seven. The two autoNumbers were the source primaries and
were replaced (below). For the aiText fields, `Attachment Summary` does appear in
the exported Make blueprints — but only inside the output schemas Make generates
from the table itself, never in a mapper: there is no `{{…Attachment Summary…}}`
expression anywhere in the 63 exported scenarios. The three `Bypass URL` fields
appear in no scenario or automation at all.

Worth knowing before recreating them: the one cached sample record in the export
that carries an `Attachment Summary` value shows
`{"state": "error", "value": null}` — the field was failing in the source base
too. Adding these seven is cosmetic parity, not a prerequisite for cutover.

## Deliberate divergences

Each of these is a place the target does not match the source. All five were
chosen rather than stumbled into, and none of them silently repairs a defect the
source had — the two inert formulas are omitted and named rather than rewritten.

**Three primary fields changed.** A primary field must be one of a short list of
writable types, and on three tables the source primary was a formula or an
autoNumber — none of which qualifies, and all of which were empty. The new
primaries are `Property Intake Master` → `Address`,
`Business Readiness Responses` → `Role`, and `BRQ Detailed Responses` →
`Application ID` (the key the Stage 2 automations actually join on).

**`Address Match Key` and `Project Match Key` were not ported.** Both are
literally the string `"Unable to generate formula"` in the source — a constant,
equal for all 148 records, which is why dedup keyed on them matched everything.
Recreating a constant would carry the defect without carrying any behaviour.
`Property Unique Key` was ported and works; rebuild the other two from it.

**Rollup aggregations were inferred.** The export captured `options: null` for
every rollup, so the aggregation function was not recoverable from it. Only
`Stage 3 Active Bookings` is load-bearing and it was recreated as `SUM`; the date
rollups use `MIN` and the text rollups `ARRAYJOIN`. Check them against the source
in the UI before trusting a Stage 2/3 gate.

**One duplicate select option was merged.** `Properties.Property Type` had two
options both named `Land`. The table holds 0 records, so nothing was lost.

**Five unnamed select options were dropped** from `BRQ Detailed Responses`. All
12 records are empty on all five of the fields concerned, so this cost 0 cells.

## Automations

Five of the six API-creatable automations were recreated over MCP on 2026-08-18,
with every `tbl…`/`fld…` reference translated through
[`automations/migration/id-references.json`](./automations/migration/id-references.json)
onto the target base's ids. All five report `configurationStatus: valid` and all
five are **undeployed** — `create_automation` saves the draft only, and these send
mail to five real addresses, so turning them on is a deliberate act in the UI.

| Automation | New id | Trigger |
| --- | --- | --- |
| Link Stage 2 response to applicant | `wflyGxwKaLbVsv14E` | recordMatchesConditions |
| Link Stage 2 detailed response to applicant | `wfl37KYYbuQv15cRP` | recordMatchesConditions |
| Link Stage 3 booking to applicant | `wfls49xnPmVibeeLs` | recordMatchesConditions |
| Send Confirmation Email on New Business Readiness Response | `wflh77ndoCHYMbs6Q` | recordCreated |
| Notify Aurixa Team on New Business Readiness Submission | `wflbWecuoA3q6sQLj` | recordCreated |

**How they were checked.** Each was read back with `get_automation` and diffed
against its id-translated source. Airtable mints its own node keys on create, so
the comparison rewrites every `wac…`/`wde…`/`wtr…` key to a positional token
before diffing — which also proves the internal `$ref` wiring survived, because a
mis-wired reference would not land on the same position. **5 of 5 match**, filter
trees, `fn` expressions, conditional branches and email bodies included.

**`Automation 1` was not created**, and that is the one place this deviates from
"recreate the 6". It is an empty stub: undeployed, `genericWebhookReceived`, zero
nodes, `webhookSchemaIsSet: false` — the bundle's own
[`automations/README.md`](./automations/README.md) says not to migrate it.
Creating it would mint a fresh live-looking webhook URL in the company account
that nothing consumes. Say so if you want it anyway for strict parity.

### The four script-bearing ones, structure only

The remaining four carry `customScript` nodes, which the API refuses with
`readOnlyNodeType`. Three of the four had their **structure** rebuilt on
2026-08-18 — everything except the script — so the manual step is pasting a
script into an automation that already exists rather than building one from
nothing. All three are undeployed, and each carries a description saying which
file from [`automations/scripts/`](./automations/scripts) belongs in it.

| Automation | New id | What is there | What is missing |
| --- | --- | --- | --- |
| Aurixa Lead Capture | `wflEQ1wsJH1x7GQhL` | trigger + the notification email | 2 scripts |
| Delete Records After 30 Days | `wflz5O9df5UjBzd3X` | cron + findRecords + empty loop | 1 script |
| Delete Property Intake Records After 30 Days | `wflOrWaQohUvhvcFb` | cron + findRecords + empty loop | 1 script |
| Auto-generate report | `wflIvnXu2Jcs7eQ95` | trigger + conditional + a placeholder | 1 script, and it must be edited first |

**A script slot cannot be marked with a placeholder node.** `noOp` is in
`create_automation`'s type enum but is rejected as `readOnlyNodeType` just like
`customScript`, so there is no marker node to leave behind. An **empty
`repeatingGroup` body is accepted**, which is what the two purges use — the loop
exists and iterates, and does nothing until a script is added. That is also why
they are safe to leave in place: a purge with an empty body deletes nothing.

**`Auto-generate report` needed one invented node to exist at all.** Its only two
source nodes are the `customScript` (refused as `readOnlyNodeType`) and a
`conditionalGroup` whose single branch has **zero nodes** (refused as
`emptyBranchNotNested` — an empty branch is legal only inside a loop). With both
refused the payload has no nodes, and an automation must have at least one. So
`wflIvnXu2Jcs7eQ95` carries the trigger and the real condition, plus **one inert
placeholder `findRecords` inside the branch** that is not in the source. It reads
a single `Properties` row and discards it, and its own description says to delete
it. That is the only fabricated node anywhere in this migration.

Finishing it is a UI job with two prerequisites that are not obvious, both
written up in
[`AUTO_GENERATE_REPORT.md`](./automations/migration/rebuilt/AUTO_GENERATE_REPORT.md):
the nine input variables the script expects, and the fact that **the exported
script no longer works**. It is also the one automation whose defects could not
simply be carried across, because carrying them would have shipped something
that silently reports success while doing nothing.

**Verification.** Same method as the five above, with `customScript` nodes
stripped from the source before comparing: **3 of 3 match**, including both cron
schedules (`daily`, `Asia/Kuala_Lumpur`, midnight) and the 30-day `daysAgo`
filters. One cosmetic loss — the Property Intake loop's `name` is the empty
string in the source and `create_automation` drops it.

### The two purges now measure a clock the migration reset

Both filter on the fields substituted earlier in this document:
`Delete Records After 30 Days` reads `Properties.Created` and
`Delete Property Intake Records After 30 Days` reads
`Property Intake Master.Created Time` — both now `CREATED_TIME()` formulas.

For Property Intake that changes what the purge will do. Its 148 rows were
created between **2026-07-23 and 2026-08-04** in the source; in this base they
all read **2026-08-18**. So the 30-day window restarted at migration: turning the
purge on now deletes nothing, and around **2026-09-17** the entire set ages out
on the same day rather than trickling out over a fortnight. A native `createdTime`
field would behave identically — this is a consequence of re-creating records,
not of the formula substitution — but it is the difference between a purge that
removes a few rows a day and one that empties the table at once. Decide that
before deploying it.

`Delete Records After 30 Days` is unaffected in practice: `Properties` holds 0
records.

## Still to do

- Import `Emails` from CSV (5,325 or 2,819 records — see that README).
- Add the seven UI-only fields if parity matters.
- Turn on the five recreated automations once reviewed (all are off).
- Paste the four scripts into the three structure-only automations
  ([`automations/scripts/`](./automations/scripts)), and decide the Property
  Intake purge question above before deploying that one.
- Finish `Auto-generate report` in the UI —
  [`AUTO_GENERATE_REPORT.md`](./automations/migration/rebuilt/AUTO_GENERATE_REPORT.md).
  Its URL is fine; its credential is not.
- Re-point the Make scenarios at the new base and field ids.
