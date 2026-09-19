# Emails — CSV import

The other nine tables of `NPC Emails` were migrated through the API. **Emails was not**,
and this directory is why: its records cannot be passed as inline tool arguments, so the
last step is a CSV import a person performs in the Airtable UI.

Target: base **`appFNPL7iYiuQyHAO`**, table **Emails** (`tblc4u4AhVed04lVN`), currently **0 records**.

| File | Rows | Size | What it is |
| --- | ---: | ---: | --- |
| `emails.csv` | 5,325 | 6.5 MB | Every record, exactly as exported |
| `emails-substantive.csv` | 2,819 | 6.5 MB | Only records carrying content — what [`../../AUDIT.md`](../../AUDIT.md) recommends |

The two files are almost the same size because the 2,506 rows the second one drops are
nearly empty: 2,472 hold nothing but `Status: Error 500`, 31 hold `Status: No URL`, and 3
are completely blank. They are the log of a failing integration, not business records.
**Import one file or the other, not both.**

## Two things that are missing on purpose

**The 211 attachments are not in either file, and cannot be.** Airtable serves attachments
from signed `v5.airtableusercontent.com` URLs that expire, and every one of the 211 in this
export expired at **2026-08-18T12:00:00Z** — the same day it was taken. A CSV row pointing at
a dead URL imports as an empty cell, so including the column would have produced 211 silent
blanks rather than an error. Recovering them means re-exporting from the old base with
credentials that can still read it; the token used for this migration cannot see
`apptyShYE0yzL4IGB` at all.

**Two columns are absent because they are not writable.** `Assignee` is a collaborator field
that was never populated in 5,325 records, and `Attachment Summary` is an `aiText` field that
the create-field API cannot make — it has to be added in the UI, after which Airtable
generates its own values. Neither belongs in an import.

## Faithfulness

Both files were round-tripped through a CSV reader and compared cell by cell against the
source: **0 mismatches**. Every field is quoted, so the 2,754 bodies containing newlines
survive as single cells.

One caveat worth knowing rather than discovering: the bodies contain **2,203 carriage
returns**. Airtable's importer may normalise `CRLF` to `LF` inside a cell. That is a
whitespace difference in email bodies, not data loss, but it means a byte-for-byte diff
against the source will show it.

## Check the record limit first

Airtable caps records **per base**, and the cap depends on the plan. The base already holds
212 records from the nine migrated tables. Adding `emails.csv` takes it to **5,537**; adding
`emails-substantive.csv` takes it to **3,031**. On a Free plan (1,000 records per base) both
overflow and the import will truncate or fail part-way. Confirm the workspace plan before
starting, because a partial import is harder to reason about than one that never began.

## Steps

1. Open the **Emails** table in base `appFNPL7iYiuQyHAO`.
2. Toolbar → **Import data** → **CSV file**, and choose one of the two files.
3. Insert **into the existing table** — do not let it create a new one, or the field ids the
   Make scenarios were rewired onto will not be the ones that receive data.
4. Map the six columns onto the existing fields of the same name. `Status` is a
   `singleSelect` whose options already exist (`Todo`, `In progress`, `Done`, `Error 500`,
   `Address not found`, `No URL`, `Invalid AI JSON`) — every value in the file is one of
   them, so nothing new should be created. If the importer offers to add an option, stop and
   look at why.
5. After it finishes, check the row count matches the table above.
