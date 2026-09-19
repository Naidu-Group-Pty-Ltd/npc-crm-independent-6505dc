# Make.com data stores

A point-in-time export of every data store in the Make organisation
(`eu2.make.com`, org `1620547`, team `528268`), taken **2026-08-18**.

Three stores, 82 records in total. `manifest.json` is the machine-readable index
— field list, record count, size ceiling, and which scenarios read or write each
store.

A Make **data store** is a small key-value table that survives between scenario
runs. It is the only state the voice stack keeps outside GoHighLevel, which is
why it is worth having a record of: the scenarios themselves are in
[`../blueprints/make/`](../blueprints/make/), but a blueprint says nothing about
what is *in* the store it reads.

## Layout

Each store gets a directory named `<slug>.<dataStoreId>`, holding two files:

| File | What it is |
| --- | --- |
| `structure.json` | The Make **data structure** — the field spec. This is what you recreate an empty store from. |
| `records.json` | The rows, verbatim, as `[{key, data}]`. A point-in-time dump. |

They are separate on purpose. The structure is stable and is the thing you'd
restore from; the records churn. Keeping them in one file makes a schema diff
unreadable the moment the data moves.

| Directory | Records | Fields | Written by |
| --- | ---: | ---: | --- |
| [`ghl-contact-ids.162851/`](./ghl-contact-ids.162851/) | 74 | 15 | `Vapi - GHL Contact Resolver v4`, `NPC Vapi - get_call_context v1`, `Discovery Call Handoff` |
| [`vapi-calls-human-transfer.163613/`](./vapi-calls-human-transfer.163613/) | 8 | 15 | `NPC Twilio - Store Active Call Context`, `NPC Vapi - Transfer Caller to Human via Twilio Redirect` |
| [`property-posting-tracker.27908/`](./property-posting-tracker.27908/) | 0 | 1 | `Real Estate Facebook Post Automation` |

## The stores

### `GHL Contact IDs` (162851)

The contact-resolution cache for the inbound voice agent. When a call arrives,
the resolver looks the caller's number up in GoHighLevel and writes what it
found here, so a later module in the same call — or the handoff scenario — can
read the contact without a second API round trip.

Its data structure is named `GHL Contact Details` (580749) and carries the
resolution outcome as well as the contact: `contactFound`, `contactCreated`,
`contactState`, `confirmedIntent`, `callerReason`, `handoffReady`.

### `Vapi Calls Human Transfer` (163613)

The bridge state for "put me through to a human". `NPC Twilio - Store Active
Call Context` writes the live Twilio call SIDs when a call starts; the transfer
scenario reads them back so it can redirect the parent call to a mobile. Rows
carry an `expiresAt` one hour out, because the context is only meaningful while
the call is up.

Its structure (583111) is still named `My data structure` — the Make default.
Worth renaming; the name is what the picker shows when you attach a store.

### `Property Posting Tracker` (27908)

A single-field cursor (`last_posted_property_index`) for the Real Estate
Facebook post rotation. Empty, and the scenario that used it is one of the
legacy ones excluded from the blueprint export. Kept here because it is one of
the three stores that exist, and an empty store is a fact about the account
rather than a gap in the export.

## What the data shows

Exporting the rows surfaced three defects that are invisible from the blueprints
alone. None is fixed here — this directory is a record, not a change — but they
are what the data says.

**Five of the eight `Vapi Calls Human Transfer` rows are malformed.** Four have
the entire JSON payload written into the *key* with `data` left empty, and the
embedded JSON is itself broken — quotes escaped as `\",` so several values run
into each other. A fifth has an opaque key (`12aaed515c3a`) and no data. Only
three rows — the ones keyed by a bare phone number — are usable. The four
JSON-keyed rows are dated 2026-05-20, and the well-formed ones from 2026-05-23
onwards, so the write expression looks to have been corrected in place after
that date; the bad rows were simply never cleaned up.

**Nine `GHL Contact IDs` rows stored an uninterpolated template.** They hold the
literal string `{{ customer.number }}` in both `callerPhone` and `phone` instead
of a number — all nine belong to one contact, `k66oHhB5wW0FjZ1TkFCs`. A separate
pair of rows holds `{{ $.contactId }}` in `contactState`. The variable never
resolved and Make stored the placeholder text as the value, so these rows cannot
be matched on phone by anything reading the store.

**The store accumulates one row per call, not one per contact.** Only 2 of 74
rows are keyed by phone number; the other 72 are keyed by `vapiCallId`. Since a
Vapi call id is unique per call, an upsert on that key can never find an existing
row, so a "cache" of 3 distinct people has grown to 74 rows and will keep
growing. The two phone-keyed rows are what the intended behaviour looks like.

## This export contains real caller data

`records.json` in the two voice stores holds live personal information: three
identifiable people, their mobile numbers, and their GoHighLevel contact ids,
plus Twilio call SIDs. Two of the three are external callers rather than NPC
staff.

It is exported in full because a data store's rows *are* the thing being backed
up — a structure with the data stripped is just the structure, which is already
in `structure.json`. But it is worth knowing this is here before the repository's
audience widens, and worth deciding how long it should be kept: the underlying
GHL contacts have their own retention, and this is a copy of them sitting
outside it.

## Restoring a store

There is no bulk import in the Make UI. To rebuild one:

1. Recreate the **data structure** from `structure.json` (Data Stores → Data
   structures → the field names, types and `required` flags map one-to-one).
2. Create the data store against that structure, matching the size ceiling in
   `manifest.json`.
3. Load `records.json` with a throwaway scenario — an iterator over the array
   into a **Data store → Add/replace a record** module, mapping `key` to the key
   and each `data.*` field to its column.

Step 3 is worth doing selectively rather than wholesale for the two voice
stores. Replaying the malformed rows described above just reinstates the defect,
and the call-scoped rows in `GHL Contact IDs` are spent — they refer to calls
that ended months ago.

## The target account, as of 2026-09-15

This directory stays a record of the **legacy** account (eu2, org `1620547`,
team `528268`) as it stood on 2026-08-18. Nothing above is rewritten. What
follows is where those three stores ended up in the new account (us2, org
`8699071`, team `2731020`), because the mapping is otherwise only inferable.

| Legacy | Rebuilt | Records | Ceiling |
| --- | --- | ---: | --- |
| `GHL Contact IDs` (162851) | **133627** | 2 | 1 MB |
| `Vapi Calls Human Transfer` (163613) | **150577** | 0 | 50 MB |
| `Property Posting Tracker` (27908) | **150578** | 0 | 1 MB |

The two new stores were created on 2026-09-15. They had been blocked since the
migration by the Free plan's `dslimit: 1` and its 1 MB org-wide `dsslimit`,
which together produced `Not enough space in storage.`; the organisation is now
on **Core** (`dslimit: 1000`, `dsslimit: 157,286,400`) and both limits are gone.
Their data structures already existed and are byte-faithful to the legacy spec,
so only the stores themselves were missing.
[`../make/MAKE_CUTOVER.md`](../make/MAKE_CUTOVER.md) carries the detail and the
two scenarios that were unblocked with them.

**`GHL Contact IDs` kept the 1 MB ceiling** it was created with under the old
plan, rather than the legacy store's 100 MB. It holds 665 bytes, so this is
noted rather than changed — but it is a difference from the legacy record above.

### What was loaded, and the row that changed the answer

The record counts are the whole of the selective load this README recommends,
and they are now settled rather than pending.

`GHL Contact IDs`' two rows are the two the section above identifies as correct:
of 74 legacy rows, exactly two are keyed by a phone number
(`+61480845459`, `+61433005110`). The other 72 are keyed by `vapiCallId` and are
spent. Nothing further should be loaded.

`Vapi Calls Human Transfer` is **empty on purpose**, which goes further than the
advice above. Five of its eight legacy rows are malformed. The remaining three
were also withheld, because the consuming scenario decides on
`twilioParentCallSid` existing and reads neither `expiresAt` nor `status` — so a
row from May carrying `status: "active"` is indistinguishable from a live one,
and replaying the three would make a transfer request from those numbers redirect
against a call that ended months ago. Empty is the state that behaves correctly.

### There is an API route now

The three-step rebuild above ("no bulk import in the Make UI") describes the UI.
Both stores here were instead created through the API —
`data-stores_create` against the existing structure, with the ceiling passed as
`maxSizeMB` — and records can be written one at a time with
`data-store-records_create`. For a store of this size that is quicker than a
throwaway scenario, and it leaves the field spec untouched.
