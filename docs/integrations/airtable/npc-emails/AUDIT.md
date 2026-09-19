# NPC Emails — pre-migration data audit

Run **2026-08-18** against the export in this directory, which was itself checked
against the record counts Airtable reports for each table. A re-count at audit
time found **no drift**: 5,325 / 148 / 10 / 12 unchanged.

The base is structurally sound and will migrate. It is **not** pristine, and the
single most useful thing this sweep found is that **48% of the records carry
nothing worth moving**.

| | Count |
| --- | ---: |
| Blockers — the write fails or lands wrong | **8** |
| Warnings — the write succeeds but carries a defect forward | **7** |
| Informational | **10** |

Machine-readable detail, including the affected record ids, is in
[`migration/audit-findings.json`](./migration/audit-findings.json).

## The headline: Property Intake Master holds no data at all

The 211-column flagship table has 148 records and **exactly one of its 211
fields is ever populated** — `Extraction Batch ID`. Not one record carries an
address, a price, an agent, a photo or a status.

| Signature | Records |
| --- | ---: |
| Completely empty | 97 |
| `Extraction Batch ID` only, value `973814ef…` | 46 |
| `Extraction Batch ID` only, value `3934a2ac…` | 5 |
| **Genuinely unique records** | **0** |

The creation dates say what happened:

| Created | Records | Matches |
| --- | ---: | --- |
| 2026-07-23 | 33 | `NPC Email 1` last edited 2026-07-23 |
| 2026-07-24 | 64 | same scenario |
| 2026-08-04 | 51 | `NPC Email 1 New` last edited 2026-08-04 |

Both of those scenarios are **switched off** in Make (see
[`../../blueprints/make/manifest.json`](../../blueprints/make/manifest.json)); only
`NPC Email 2` is live. So these 148 rows are the debris of two test runs of
pipelines that no longer run — the July batches wrote nothing at all, the August
batch got as far as stamping a batch id and stopped.

This is not the 30-day purge. That automation **deletes** rows rather than
blanking them, and every one of the 148 records was created between 2026-07-23
and 2026-08-04 — all still inside the 30-day window, so the purge would not have
touched them yet either way.

> **Corrected 2026-08-18.** This paragraph first said the purge "is still a draft
> with its script step empty, so it has never run", following
> [`../../AIRTABLE_RETENTION.md`](../../AIRTABLE_RETENTION.md). The automation
> export showed otherwise: `Delete Property Intake Records After 30 Days` is
> **deployed** with its script in place. The finding above is unchanged — the
> records are empty because the pipelines wrote nothing — but the reason given
> was wrong. See [`automations/README.md`](./automations/README.md).

**Migrate this table as schema only.** Carrying 148 contentless rows into a fresh
base imports the debris and nothing else. It also means the wide-table half of the
migration is free: there is no data to verify.

## Emails: real, but half of it is error stubs

5,325 records, of which **2,819 carry actual email content** and 2,506 do not.

| Status | Records | |
| --- | ---: | --- |
| `Error 500` | 3,950 | 74% |
| *(no status)* | 1,342 | 25% |
| `No URL` | 31 | |
| `Invalid AI JSON` | 2 | |

2,472 records hold **nothing but** `Status: Error 500` — no sender, no subject,
no body. 2,509 records have no body at all. Only 7 of the 9 fields are ever
populated (`Assignee` is dead), and `Attachment Summary` is in an error state on
**5,204** records — 5,120 `emptyDependency` (no attachment to summarise) and 84
`unsupportedAttachmentType`.

The 211 attachments are real and worth carrying. The error stubs are a log of a
failing integration, not business records.

## Blockers — fix before or during cutover

**Five unnamed select options, 15 cells.** In `BRQ Detailed Responses`: Custom
System API Available, Preferred Migration Timing, Enterprise SSO Required,
Entity-level Boundaries Required, Procurement Process Expected. An option with an
empty name can be addressed neither by name nor by id, because choice ids are
reminted in the target base. The Stage-2 questionnaire wrote an empty string and
Airtable turned it into an option. Give the five options real names in the source
and re-export, or accept the 15 cells being dropped.

**Two constant formulas.** `Property Intake Master.Address Match Key` and
`.Project Match Key` are both literally `"Unable to generate formula"`. Every
record returns the same string, so any duplicate detection keyed on them has been
treating all records as identical. `Property Unique Key` in the same table is a
working `LOWER(REGEX_REPLACE(…))` key and is the model to rebuild them from. Do
not port them as they stand.

**One duplicate option name.** `Properties.Property Type` has two distinct
options both named `Land`. Writing by name is ambiguous. The table has 0 records
so nothing is at risk today; merge them in the target base.

## Warnings

**Empty records — 113 across five tables**, which would migrate as blank rows:
Property Intake Master 97, BRQ Detailed Responses 6, Lead Data Test 6, Emails 3,
Business Readiness Responses 1 (its only record).

**Duplicate records.** Emails has 3,247 records that are byte-identical to another
record across every writable field — almost entirely the `Error 500` stubs.
Property Intake Master has 51, all of them the batch-id rows. Read these together
with the emptiness above rather than as a separate problem: they are the same
debris counted a second way.

## Clean bills of health

These were checked and found clean, which is worth stating because each is a
common migration failure:

- **Referential integrity** — all 6 link edges resolve to records present in the
  export. No dangling references.
- **Cell size** — largest cell is 82,594 characters, inside Airtable's 100,000
  limit. Nothing will be rejected for length.
- **Value validity** — no malformed email, URL or phone values in their typed
  fields.
- **Unresolved templates** — no `{{ … }}` placeholder is stored as literal data
  anywhere in the base. (This is the defect that *did* reach the Make data
  stores; it did not reach Airtable.)
- **Encoding** — no control characters or broken sequences.
- **Field names** — no duplicates, no empty names, no stray whitespace.
- **Collaborators** — 4 fields exist, none populated, so no user ids to remap.

## What this means for the migration

| Table | Records | Substantive | Recommendation |
| --- | ---: | ---: | --- |
| Emails | 5,325 | 2,819 | Migrate the 2,819 with content; the 2,506 stubs are integration noise |
| Property Intake Master | 148 | **0** | **Schema only** |
| Opt-In Calls | 32 | 32 | Migrate all |
| Aurixa Waitlist | 10 | 10 | Migrate all |
| BRQ Detailed Responses | 12 | 6 | Migrate all; 6 are near-empty stubs |
| Lead Data Test | 7 | 1 | Test table — schema only, or drop |
| Strategic Review Bookings | 2 | 2 | Migrate all |
| Business Readiness Responses | 1 | 0 | Schema only |
| Properties | 0 | 0 | Schema only |
| Quiz Sub Calls | 0 | 0 | Schema only |
| **Total** | **5,537** | **2,870** | |

**The bundle in this directory still contains all 5,537 records.** Nothing was
removed — an audit that quietly drops rows is worse than one that reports them.
The filtering above is a decision for cutover, not something applied here. If you
want the trimmed set, say so and the pass-1 batches can be regenerated against
these rules; the record ids are all in `audit-findings.json`.

Migrating the substantive set instead of everything takes the job from 116
create batches to roughly 60, and removes the two tables whose data would have
been meaningless to verify.
