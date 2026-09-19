# WP-25 — item 15 to zero

`check-mass-assignment.mjs` shipped as a **ratchet**: 15 request-derived writes
with no field allowlist, frozen per-file, failing only on new ones. That was the
right call at the time — each remaining site needs a per-table decision about
which columns are legitimately writable, and that is product knowledge rather
than one change.

This work package makes those fifteen decisions. The baseline now reads `0`.

    15 sites / 8 files  →  0 sites / 0 files

The gate stays a ratchet rather than being rewritten as zero-tolerance. With a
baseline of `0` it behaves identically, and the mechanism is worth keeping: a
future refactor may legitimately need to land debt before paying it, and a gate
that cannot express "not yet" gets disabled instead of obeyed.

## What the fifteen turned out to be

Not one thing. Three, and only the first is the defect the gate was written for.

| | Sites | |
|---|---|---|
| **Real mass assignment** | 9 | A request sub-object spread into a write with nothing between it and the table |
| **Already allowlisted, invisibly** | 5 | A real allowlist behind a name (`sanitize`) that said nothing about what it allowed |
| **Gate false positive** | 1 | A hand-built literal fed by a *database* read, matched because the pattern for `body.data` had no root |

### The nine

**`aml-monitoring` — `upsert_sof` / `upsert_sow` / `upsert_review` (4 sites).**
`body.item` and `body.review` went to `aml.source_of_funds`,
`aml.source_of_wealth` and `aml.existing_customer_reviews` whole.

The sharp one is `verified_by`. The handler stamped it from the session — but
only on the insert path (`if (item.verified && !item.id)`). Marking an existing
item verified goes through the *update* path, where the caller's `verified_by`
was written unchanged. In an EDD file, "who checked this source of funds" is a
question with a regulator behind it, and it was answerable by the subject of the
check. The allowlist drops the field and the stamp now runs on both paths.

The review table carries two more groups that belong to other operations: the
closure record (`outcome`, `outcome_at`, `outcome_by`, written by
`complete_review`) and the extension ledger (`original_due_at`,
`extension_count`, `extension_reason`, maintained by `extend_review`). A caller
who could set `extension_count` could reset a periodic review's slip history to
zero.

**`aml-transactions` — `add_cp_attempt` (1 site).** `actor_id` was safe only
because the spread came before the stamp. Ordering is not a control anybody can
see from the schema.

**`manage-client-data` (2 sites) and `manage-portal-client-data` (2 sites).**
These are generic CRUD multiplexers: the caller names a `table` and hands over a
`data` object. `ALLOWED_TABLES` checked which table. Nothing checked which
columns — so one body reached 29 tables and the writable surface was the union
of everything any of them holds.

`_shared/clientDataWritableColumns.ts` declares a column set per table, read from
`information_schema` on the live catalogue, minus four groups: identity and
audit; actor attribution; provenance and sync bookkeeping; server-computed or
security-bearing state. The groups matter more than the names — a column added
later is not writable until somebody decides which group it falls into.

The portal is the worse of the two and got its own, narrower sets. It had a
**denylist** (`PROTECTED_CLIENT_FIELDS`, 32 names) on `clients` and, for the
other ten tables, no field filtering at all. `clients` has 69 columns, so the 37
nobody listed were writable **by the client whose record it is** — including
`finance_contact_id` and `assigned_team_user_id`. Reassigning yourself to a
different finance agent is not a data-quality mistake. Also newly closed:
`client_properties.sourced_by` and `deal_closed_at` (commission-bearing
attribution), `client_income_sources.custom_shading_rate` (the discount the
borrowing-capacity engine applies to non-salary income — a client who sets their
own shading sets their own borrowing capacity), and
`client_portal_messages.sender_type` (a client who can set it can post as staff).

That is the difference between the two list styles, in one table: a denylist
leaves everything nobody thought of writable, and the set of things nobody
thought of grows every migration.

### The five that were already fine

`manage-loan-writer-undertakings`, `manage-partner-agreements` and
`manage-partner-referrals` each defined `sanitize(input)`, which copies only the
keys in a local `WRITABLE`/`WRITABLE_FIELDS` array. Genuine allowlists.

They were reported because `sanitize` says that something has been cleaned
without saying against what, and the gate — reasonably — does not take that on
trust. Renamed to `pickWritable`, which is both what the function does and what
the gate recognises. The rename is the fix: at the call site,
`pickWritable(body)` tells a reader there is an allowlist and `sanitize(body)`
does not.

### The one the gate got wrong

`quantitative-report-pipeline:825` builds a four-column literal from
`inserted.data` — rows this process had just written and read back. The
`REQUEST_DERIVED` pattern carried a bare `\.data\b`, meant for `body.data` and
for the `{ ok, data }` that `_shared/validate.ts` and zod's `safeParse` return.
It now requires a root.

This direction of error is the expensive one. A gate that names correct code
gets read as noise, and then the site it is right about gets read as noise too.
It is the same lesson the gate's own header already records twice, from the four
precision bugs found while writing it.

## Side effects worth knowing

**`manage-client-data` narrows only three operations.** `create`, `update` and
`upsert` spread `data` into a write. `publish_portfolio_report` does not — it
builds its insert field-by-field and reads `data.notify_email` and
`data.client_visible_notes` as control flags. `notify_email` is not a column of
any table, and `client_visible_notes` belongs to `client_portal_reports` while
the operation runs against `portfolio_analysis_reports`. Narrowing it against the
named table stripped both and silently turned the client's email notification
off. Caught by a type error, which is the only reason it did not ship.

Narrowing an object that is not a column set is not a safer version of the same
thing. It is a different thing that happens to compile.

**A table with no declared set is refused, not passed through.** Every entry in
both `ALLOWED_TABLES` has one, so this only fires if somebody adds a table
without adding its columns. The safe answer to "I do not know what may be written
here" is nothing.

**Five pre-existing type errors went away.** `manage-client-data` dropped 11 → 6;
the edge-typecheck baseline is re-banked at 376.

## Verification

- `check-mass-assignment.mjs` — 0 sites, baseline 0.
- `check-security-gate-negatives.mjs` — 29 controls removed, 29 gates failed as
  required. The mass-assignment control is one of them, so the gate is still
  proven to fail when the allowlist is taken away.
- `check-edge-functions.mjs` — 418 entry points, 376 errors against a baseline of
  376.
- Nothing here touches the database. The column lists were **read** from
  `information_schema`; no migration is involved and none is needed.

## What this does not cover

`pickAllowed` bounds which columns a body may write. It does not bound the
*values* — `client_properties.value` may still be any number the client sends.
That is item 7's territory, and for these two functions it is still per-function
work. The distinction is worth keeping straight: item 15 is about columns
nobody meant to expose, item 7 is about values nobody checked.
