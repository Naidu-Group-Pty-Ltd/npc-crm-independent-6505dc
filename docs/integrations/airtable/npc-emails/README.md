# NPC Emails — Airtable migration bundle

A complete export of the **NPC Emails** base (`apptyShYE0yzL4IGB`), taken
**2026-08-18**, shaped so the base can be rebuilt in a different Airtable
account over MCP once the new account is connected.

**10 tables · 436 fields · 5,537 records · 6 link edges.** Every record count in
`manifest.json` was checked against the count Airtable itself reports for the
table, and they match exactly.

This is a migration artefact, not a backup of convenience. The source base is
still the system of record until the cutover is signed off.

## The rebuild already happened — read that first

[`REBUILT_BASE.md`](./REBUILT_BASE.md) describes the **target** base
(`appFNPL7iYiuQyHAO`), which was built from this bundle on 2026-08-18: its table
ids, the 212 of 5,537 records that landed, the 11 fields the API could not create
with their source type, and the five places the target deliberately does not
match the source. Everything below this line describes the **source**.

## Automations are a separate bundle

The base's 10 automations are exported to
[`automations/`](./automations/README.md) with their script bodies extracted as
pasteable `.js` files. 6 of the 10 can be recreated through the API; the other 4
carry `customScript` nodes, which the API refuses to author, so those steps are
manual. Rebuild the base first — an automation cannot reference tables that do
not exist yet.

## Read the audit first

[`AUDIT.md`](./AUDIT.md) is a data-quality sweep of the same base, run after this
export and re-checked against live counts. Its headline changes what is worth
migrating: **48% of the 5,537 records carry nothing worth moving**, and
`Property Intake Master` — the 211-column flagship — has **zero** populated
fields beyond a batch id, because the two scenarios that fill it are switched
off in Make and these 148 rows are their test debris.

The bundle below still contains every record. Nothing was filtered out; the
audit reports, it does not prune.

## Why this is not just a data dump

Three properties of Airtable decide the shape of everything here. None is a
preference; each one breaks a naive export.

**A computed field cannot be written.** Formula, rollup, count, autoNumber,
createdTime, lastModifiedTime and aiText are outputs. 43 of the 436 fields are
computed, and 5,520 cells in this export are computed values. They are recreated
as *schema* and never replayed as *data* — a single computed cell in a request
makes Airtable reject the whole request, which would fail a 50-record batch for
one bad cell.

**A record id is minted by the target base.** The ids in this export
(`rec…`) will not exist in the new account. Linked-record cells therefore cannot
be written in the same call that creates the records they point at. Records are
created link-free first, and links are patched afterwards through an old-id →
new-id map.

**A field id is minted by the target base too.** Every payload here is keyed by
field **name**, because names survive the move and ids do not. The same applies
inside formulas: `create-plan.json` rewrites each `{fldXXXXXXXXXXXXXX}`
reference to `{Field Name}` so the formula can be re-authored, and keeps the
original alongside it.

## Layout

| Path | What it is |
| --- | --- |
| `manifest.json` | Index — per-table record counts, field counts, batch counts, hazard ids |
| `schema/base-schema.source.json` | The full schema verbatim, all 436 fields with their config |
| `schema/create-plan.json` | Table + field creation, split into three ordered phases |
| `records/<table>.source.json` | Records exactly as Airtable returned them — the fidelity copy |
| `migration/pass1-create/<table>.batch-NNN.json` | 116 create payloads, ≤50 records each |
| `migration/pass2-relink/link-plan.json` | The 5 link cells, by source record id |
| `migration/id-map.template.json` | 5,537 old ids awaiting their new counterparts |
| `migration/hazards.json` | The six things that need a decision, machine-readable |

`records/` and `pass1-create/` deliberately hold the same data twice: the first
is what the source actually contained, the second is what may legally be written.
Keeping both is what makes verification after cutover possible.

## This export contains client personal data

`records/` and `migration/pass1-create/` hold the base's real contents, including
5,325 email records carrying sender names, addresses, message bodies and
property enquiries, plus the waitlist applicants' names, emails and phone numbers
across the four Aurixa tables. Roughly 272 distinct email addresses appear
in the Emails table alone.

That is unavoidable — the records *are* the thing being migrated, and a bundle
with the data stripped could not rebuild the base. But it means this directory is
a copy of client data living outside Airtable's own retention, in a git history
that does not forget. Two consequences worth deciding on before cutover:

- The Property Intake Master retention rule (the 30-day purge described in
  [`../../AIRTABLE_RETENTION.md`](../../AIRTABLE_RETENTION.md)) does not reach
  into this export. Records purged from the base after 2026-08-18 remain here.
- Once the new base is verified, this bundle has served its purpose. Removing it
  is the clean end state; leaving it is a standing copy.

No credentials are present. Two strings match a `sk-` API-key pattern and both
were checked: one is a SendGrid click-tracking URL inside an email body, the
other a path segment in an Airtable attachment thumbnail URL.

## Replay order

**1 — Create the tables.** `schema/create-plan.json`, phase A: all 10 tables with
their writable, non-link fields. Then phase B adds the linked-record fields, once
both sides of each link exist — the four linked tables form a cycle
(Aurixa Waitlist ↔ its three children), so no single ordering of table creation
can satisfy them and links must be a second step. Then phase C adds the computed
fields, which reference other fields by name and so need those fields present.

**2 — Create the records.** Feed `migration/pass1-create/*.json` in filename
order to `create_records_for_table`, one file per request. Files are already cut
to the 50-record cap. As each response comes back, record the pairing of
`sourceRecordId` (in the request, in order) to the returned new id, into
`migration/id-map.template.json`. **Airtable returns created records in request
order** — that is what makes the pairing safe — but confirm it on the first batch
rather than assuming it for all 116.

**3 — Patch the links.** For each entry in `link-plan.json`, look up the record's
new id and each of `linkedSourceRecordIds` in the id map, and write the new ids
to the named field with `update_records_for_table`. Only 5 cells and 6 edges,
so this is quick — but it is the step that is silently skippable and leaves the
Aurixa funnel disconnected, so verify it explicitly.

**4 — Verify.** Compare per-table counts against `manifest.json`. Then re-read a
sample from the new base and diff against `records/<table>.source.json`,
ignoring computed fields and record ids. Counts agreeing is necessary but not
sufficient — a batch can succeed with fields silently dropped if a name does not
match.

## The six things that need a decision

Full detail, including the exact affected cells, is in `migration/hazards.json`.

**Five select options have an empty name, and 15 cells use them.** In
`BRQ Detailed Responses` — Custom System API Available, Preferred Migration
Timing, Enterprise SSO Required, Entity-level Boundaries Required, Procurement
Process Expected. An option with no name cannot be addressed by name, and its
choice id is reminted in the target base, so neither identifier survives. These
cells are **omitted from pass 1** and every one is listed in `hazards.json`.
Omitting is the faithful reading — they are an unanswered question that the
Stage-2 questionnaire wrote as an empty string, and Airtable turned that into an
option. Give the options real names in the source and re-export if they turn out
to mean something.

**211 attachment files, on URLs that expire.** All in `Emails.Attachments`.
Airtable hands out short-lived signed links, so the URLs captured here are an
**inventory, not a transfer mechanism** — by the time the cutover runs they will
have expired. Re-read `Emails` from the source base at migration time and pass
the fresh URLs straight into the create call, so Airtable fetches each file while
its link is still valid. This is the one step that cannot be driven from this
bundle alone.

**Two duplicate-detection formulas are inert.** `Property Intake Master` has
`Address Match Key` and `Project Match Key`, and both are literally
`"Unable to generate formula"` — a constant, identical for all 148 records. Any
dedup logic keyed on them has been comparing every record as equal. Do not port
them as they stand; `Property Unique Key` in the same table is a working
`LOWER(REGEX_REPLACE(…))` key and is the model to rebuild them from.

**Two primary fields are autoNumber.** `Business Readiness Responses.Record ID`
and `BRQ Detailed Responses.Id`. Airtable assigns these on insert, so the numbers
will differ after migration. Nothing keys on them — the link plan uses record ids
— so the renumbering is safe to accept, but it will be visible.

**`Properties.Property Type` has two options both named "Land".** Writing by name
is ambiguous. The table holds 0 records so nothing is written through it; merge
the duplicate in the target base.

**Four collaborator fields, none populated.** Collaborator values are account
user ids and would not resolve in the new account. There is no data to carry, so
recreate the fields and move on.

## What this base actually contains

Worth knowing before deciding how much of it to carry across.

`Emails` is 5,325 of the 5,537 records — 96% of the base — and most are sparse:
a large share hold only a `Status` of "Error 500" and an empty AI-summary
dependency. It is the raw intake log behind the Make `NPC Email 1` scenarios.

`Property Intake Master` (148 records, 211 fields) is the wide table the Listings
page projects from. `Properties` and `Quiz Sub Calls` are **empty** — 0 records
each — and are carried as schema only.

Four tables serve the Aurixa funnel rather than NPC: `Aurixa Waitlist` (10),
`Business Readiness Responses` (1), `BRQ Detailed Responses` (12) and
`Strategic Review Bookings` (2). They are the Airtable side of the four Make
scenarios exported to the `aurixa-systems` repository, and they are the only
tables carrying links. If Aurixa is moving to a different account from NPC, this
is the seam — and the link plan is entirely inside that group, so the two halves
separate cleanly.
