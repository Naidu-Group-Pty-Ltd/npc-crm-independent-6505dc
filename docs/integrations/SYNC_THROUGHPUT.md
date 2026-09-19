# Why the GoHighLevel, calendar and email imports were slow

Measured on the clone (`npc-client-dashboard`, Supabase `plisdzywzleljorrphxv`)
on 13 Sep 2026, against the prime reading the **same** GoHighLevel account and
the **same** Microsoft 365 mailbox.

## What the clone actually held

| table | prime | clone | clone has |
| --- | ---: | ---: | ---: |
| `clients` | 776 | 435 | 56% |
| `ghl_client_opportunities` | 655 | 308 | 47% |
| `ghl_conversations` | 804 | 194 | 24% |
| `ghl_conversation_messages` | 11,602 | 663 | **6%** |
| `email_copilot_emails` | 5,677 | 101 | **1.8%** |

And what its edge functions cost, from `function_edge_logs`:

| function | calls | avg | max |
| --- | ---: | ---: | ---: |
| `sync-ghl-conversations` | 5 | **78,562 ms** | **98,403 ms** |
| `outlook-email-sync` | 4 | 14,752 ms | 20,762 ms |
| `ghl-calendar` | 12 | 6,428 ms | 10,284 ms |

`sync-ghl-conversations` declares `request_timeout = 120`. It was averaging
78 seconds.

## The finding: the fast path already existed and these functions never used it

There are two generations of GoHighLevel code in this repository.

**The workers** — nine `ghl-migrate-*-worker` functions — call
`_shared/ghl-rate-limiter.ts`. That is a token bucket held in Postgres
(`ghl_rate_reserve` / `ghl_rate_note_429`, both `SECURITY DEFINER`, both
present on every clone), so every isolate and every function sharing a GHL
token cooperates on one limit. It reads `Retry-After` on a 429 and broadcasts
the cooldown to everybody else.

**The surfaces a person actually looks at** — Clients, Client Tracker, CRM
Conversations, Calendar — were on the older generation: hand-rolled
`delay(500)` sleeps, strictly sequential, no 429 handling. They simply never
adopted the limiter that was written for them.

## Four causes, each measured

### 1. `sync-ghl-conversations` spent most of its wall clock asleep

`delay(500)` per contact, `delay(300)` per conversation, `delay(300)` per
message page — awaited one after another. At 500ms per contact a 95s budget
reaches **at most 190** of the prime's 776 clients, and that is the floor,
before a single conversation or message is fetched.

A fixed sleep is the wrong instrument twice over. It is far slower than the
vendor allows when the vendor is idle, and it is **not a limit at all** when
two invocations overlap: two isolates each sleeping 500ms still issue 4 req/s
between them.

Pacing now comes from `ghlFetchShared`. Because it counts rather than sleeps,
requests are free to overlap, and `mapWithConcurrency` runs six contacts at a
time.

### 2. `import-clients-from-ghl` did 2–4 sequential round trips per contact

Per contact, in order: `SELECT` by `ghl_contact_id`; on a miss, `SELECT` by
`primary_email`; then `INSERT` or `UPDATE`; then sometimes an `INSERT` into
`lead_source_attributions`. At 100 contacts a page that is 200–400 serialized
queries, each paying full edge-to-Postgres latency, and **none of them
depending on the one before it**.

It is now four statements per page — one `IN` read by GHL id, one `IN` read by
email, one bulk insert, one bulk attribution insert — plus the non-destructive
`UPDATE`s eight at a time. Those cannot be batched because each patch is
computed against that row's own current values.

Two things the batch had to keep. **Per-contact error reporting**: a bulk
insert fails whole, so a failure falls back to per-row inserts, which is slow
exactly once and keeps every good row while naming the bad one. And
**deduplication within the page**: the old code re-queried for every contact,
so two GHL contacts sharing an email in one page could not both look new. A
batched read is taken once, before any write, so the page carries that rule
itself (`seenEmails`) or the import manufactures the duplicate it exists to
collapse.

### 3. Email Co-Pilot could not hold history, and no amount of syncing would fix it

`outlook-email-sync` issued `?$top=${limit}` once per folder and returned
`data.value`. **`@odata.nextLink` was never read.** `email-sync-cron` had a
second copy of the same one-page read with a hardcoded `$top=30`. The page asks
for `limit: 50`.

So the product could hold the most recent page per folder and, structurally,
nothing else — 101 rows against 5,677 on the same mailbox. Re-syncing could
never close it, because the second page was never requested.

Paging now lives once, in `_shared/graphMailPaging.ts`, and both callers use
it. Two rules it enforces:

- **A `nextLink` is opaque and complete.** It already carries `$top`,
  `$select`, `$orderby` and `$filter`. Appending to it or rebuilding it from
  parts is how a paginator silently re-reads page one for ever. It is followed
  verbatim or not at all.
- **"No more pages" and "out of budget" are different answers.** Graph offering
  no `nextLink` means the folder is exhausted and a backfill is genuinely
  finished; stopping on a deadline means come back. Collapsing them makes a
  half-read mailbox report itself complete, which looks exactly like a working
  import.

**History arrives without a cursor table.** The backfill asks for messages
older than the oldest row already stored, so the boundary is re-derived from
the database on every invocation: it cannot go stale, a run that dies halfway
loses nothing, and a repeat is a no-op against the duplicate constraint.

**It converges without anybody pressing anything.** `email-sync-cron` already
runs every five minutes; it now takes one bounded backfill step per tick after
its incremental pass, until `history_complete` is true, and then costs nothing.
A personal mailbox has no cron behind it, so Email Co-Pilot carries an "Import
Full History" action for that case alone.

The columns are `received_at` and `mailbox_source`. This table has **no**
`email_date` and **no** `mailbox` address column; naming either answers 42703,
which PostgREST hands back as `data: null` — read as "nothing stored yet", which
would restart the whole history walk on every tick for ever while reporting
progress the entire time. `scripts/security/check-edge-column-names.mjs` catches
that class, and was confirmed to catch this exact mistake.

### 4. Calendar fan-outs were sequential over independent requests

`ghl-calendar` fetched events one calendar at a time (GHL requires a request
per calendar); `outlook-calendar` read one colleague's calendar at a time.
Nothing in request N's answer affects request N+1, so the page cost the **sum**
of every calendar's or colleague's latency — and got slower every time somebody
joined the team. Both fan-outs are now bounded-concurrent.

## The shared primitive

`_shared/boundedConcurrency.pure.ts`. Three guarantees, each pinned by a test
and each checked by mutation:

- **Results come back in input order**, whatever order they finish in.
- **One item's failure is that item's failure.** Every result is settled. The
  loops this replaces all wrapped their body in try/catch and pushed onto an
  `errors` array; `Promise.all` would have discarded every sibling's work,
  including rows already written. "8 of 10 synced, 2 named" is the behaviour
  these functions had, and losing it would be a regression dressed as a
  speed-up.
- **Work already started always finishes.** `stop` is asked before a task
  *starts* and never cancels one in flight, because these tasks write to the
  database — cancelling mid-flight leaves a conversation row with no messages
  and nothing saying it is short. A wall-clock budget drains rather than
  truncates, which is why a caller's deadline must leave room for the slowest
  in-flight item.

`startedCount` is what a resumable caller adds to its cursor. It is a count and
not an index: with out-of-order completion no single index means "everything
before here is done", but "the first N were all started" stays true, because
tasks are started in order.

## What did not change

No vendor limit was raised and no safety was removed. The GHL limiter is the
*same* bucket the nine migration workers already share, so this adds callers to
an existing budget rather than inventing a new one — and it is strictly safer
than what it replaces, because a fixed sleep never knew about a 429 and this
does. Every error path, every non-destructive-update rule, every duplicate
guard and every resume cursor is preserved; the tests and this document exist
to say which ones and why.

## Three things the first pass got wrong, found by watching it run

Everything above was measured before the change. These three were measured
**after** it, from the prime's own function logs and the deploy ledger — and
each of them reported as ordinary operation from every surface except the one
that was actually looked at.

### 5. There is a THIRD conversation sync, and it is the one on the cron

The first pass un-slept `sync-ghl-conversations` and `ghl-conversations-cron`.
It missed `conversation-sync-cron`, which is what pg_cron actually fires every
ten minutes.

Measured on the prime, 13 Sep 2026, five consecutive runs of the same 56
contacts:

| start | finish | elapsed |
|---|---|---|
| 06:00:08 | 06:02:24 | 136s |
| 06:10:00 | 06:12:14 | 134s |
| 06:20:00 | 06:21:49 | 109s |
| 06:30:01 | 06:32:06 | 125s |
| 06:40:01 | 06:42:15 | 134s |

`await delay(500)` per contact is 28 seconds of the first number before a
single request is made, and `await delay(300)` per conversation adds more on
top. It now works six contacts at a time through `mapWithConcurrency`, paces
every call through `ghlFetchShared`, and stops **starting** contacts at a
wall-clock budget while what is in flight finishes and is kept.

Stopping is safe here for a specific reason: the contact set is re-derived
from the database on every tick, so a contact this run did not reach is
picked up by the next one. There is no cursor to leave stale.

A sweep of the other twelve edge functions that still call `delay()` found
**none of them on a cron** — they are one-off backfills, legacy migration
tools, and the report generators, which pace against model APIs for reasons
of their own.

### 6. The backfill boundary was sent to Graph exactly as Postgres wrote it

`received_at` comes back from PostgREST as `2025-11-24T01:11:04`, with no zone
designator, and OData refuses it:

```
Invalid filter clause: The DateTimeOffset text '2025-11-24T01:11:04' should be
in format 'yyyy-mm-ddThh:mm:ss('.'s+)?(zzzzzz)?'
```

Every backfill tick on the prime between 05:44 and 06:50 answered 400 on that.

`graphDateTimeOffset` renders it where the filter is built, so no caller can
get it wrong. Two things about it are deliberate. **The zone is appended, not
inferred** — ECMAScript parses a date-*only* form as UTC and a date-*time*
form with no offset as **local** time, so letting the runtime decide would
make the boundary depend on where the function happens to run. And **a
boundary that was asked for and cannot be rendered is refused, never
dropped**: dropping it returns the *newest* page instead of the oldest, so
every row is one already held, no history is ever reached, and the walk
reports pages fetched the whole time. That is the silent version of the same
bug, and the worse one.

### 7. A failed history walk took the live mail sync down with it

This is the one that cost something. The boundary **read** was guarded from
the first version — *"never fail the tick over the backfill, the incremental
sync is the job this function is scheduled for"* — but the **fetch** was not.
Graph's 400 propagated out of the handler and the thirty messages the
incremental pass had already retrieved were discarded with it:

```
[Email Sync Cron] Starting background email sync...
[Email Sync Cron] Fetched 30 recent inbox emails
[email-sync-cron] internal_error correlation_id=… Graph returned 400: …
```

`email_copilot_emails` took **nothing for sixty-five minutes** — 0 rows
inserted, measured. A history walk nobody asked for had taken the mail
delivery down.

The opportunistic half is contained now: it can fail, and what fails is the
backfill. `history_complete` stays null on a failed walk, which the response
already distinguishes from "there is nothing older" — **a walk that failed
must never be reported as one that finished.**

The rule the three of them share: *an optimisation may not be the reason the
thing it optimises stops working.*

## Getting the change onto a clone is its own problem

Worth knowing if a clone looks like it did not receive this. The clone's own
`deploy-supabase-functions.yml` **deploys nothing** — it resolves the project,
writes a job summary listing every candidate function, and hands off to
Mission Control, which holds the only credential that can deploy. A green
15-second run there is the hand-off working, not a deployment.

Mission Control's `edge_function_deploy` lane walks the bundles alphabetically
in budgeted passes and re-reads the prime's HEAD on **every** pass, while
marking "already delivered" against the run's *start time*. A run that spans a
prime merge therefore deploys its early letters from one tree and its late
ones from another, and reports the whole thing as deployed. Measured on
`npc-client-dashboard`: `email-sync-cron` (05:16), `ghl-conversations-cron`
(05:30), `ghl-calendar` (05:32) and `import-clients-from-ghl` (05:34) landed
from the tree before the 05:38 merge; `outlook-email-sync` (05:48) landed from
the tree after it. Fixed in Mission Control by `planDeployGeneration`, which
restarts the generation when the observed revision moves.

---

# Part two — the coverage gap, and what the speed-up could not reach

The first pass made every one of these functions faster. Measured on the clone
a day later, `ghl_conversations` had gone from 227 rows to 235.

Speed was never the binding constraint. **211 of the clone's 438 contacts with
a GoHighLevel id — 48.2% — had never had a single conversation row written**,
and coverage was not correlated with recency: across four recency bands it ran
40%, 60%, 30%, 63%. A sync that is ten times faster and still looks at the same
eighty contacts reaches the same eighty contacts.

## 8. Three independent bounds, each sufficient on its own

**BREADTH.** `conversation-sync-cron` selected the 50 newest conversations and
the 30 most recently updated clients, with no offset and no rotation. That is
~80 contacts a tick, the *same* ~80 every tick, for ever. Nothing in the
product ever asked GoHighLevel about the other 358.

**DEPTH.** The same function asked for `?limit=20` and read one page, with no
`lastMessageId`. 87 of the prime's 834 conversations hold more than 20
messages. `sync-ghl-conversations` capped at
`maxPages = mode === 'incremental' ? 2 : 10`, and that cap is visible in the
data: the prime's deepest conversation holds **exactly 500** messages, which is
ten pages of fifty.

**FAN-OUT.** All three live callers sent `/conversations/search` a body of
`{ locationId, contactId }` and took `data.conversations` as final. The endpoint
pages. **Nothing in the product had ever paged it**, so a contact with more
conversations than one page silently lost the rest on every path.

Unlike the other two, this one is **not** visible in the data, and the
distinction is worth keeping: 0 of the prime's 753 contacts hold more than one
conversation. That is consistent with GoHighLevel genuinely holding one
conversation per contact here, and equally consistent with never having seen
past page one — the reading cannot separate them, because the only evidence
either way would come from the request nobody made. So this is a latent
correctness fix rather than a measured recovery, and it should not be described
as one. The depth cap, by contrast, IS visible: six threads sit at exactly 20
messages (the old cron's page) and one at exactly 500 (ten pages of fifty, the
bulk cap), out of 93 at or past 20.
`ghl-migrate-conversations-worker:245-252` is the one correct copy in the
repository, and it stays where it is — it walks the LOCATION rather than a
contact and checkpoints into `migration_jobs`.

Two functions keep their unpaged copy deliberately, and the reason is that
**neither has a caller**: no pg_cron job, no UI, no workflow invokes
`ghl-conversations-cron` or `one-time-bulk-conversation-sync`; the scheduled
job (`sync-ghl-conversations-cron`, every ten minutes) fires
`conversation-sync-cron`, and the browser fires `sync-ghl-conversations`. They
are named in `ghlConversationPaging.ts`'s header so a fifth copy does not
appear by accident, and so that anyone who schedules one knows what it would
do.

## 9. The shape of the fix: three bands, and no cursor anywhere

`conversation-sync-cron` is three sequential passes now, because `stop` is a
single global predicate and three bands need three deadlines. The deadlines are
absolute against one `startedAt`, so a band that finishes early hands the rest
of the clock to the next one.

| Band | What it is for | Deadline | Walks history? |
|---|---|---|---|
| **Fresh head** | the newest conversations; the inbound notification hangs off it | 35s | **yes** |
| **Bootstrap** | clients with a contact id and NO conversation row — the gap | 70s | no |
| **Stale tail** | every conversation, oldest `last_synced_at` first | 110s | **yes** |

Every boundary is **re-derived from rows that already exist** — which
conversations are stale, which messages we hold, which contacts have none — so
a tick that dies mid-flight loses nothing and no migration was needed. Three
rules carry it.

**The stale tail is stamped on every attempt, not on every success.**
`last_synced_at` is what orders that band, so a conversation whose search was
refused and which is therefore never stamped stays at the head of the queue for
ever and blocks everything behind it. The column says when we last *looked*.

**Which bands walk into history is decided by the stamping, not by taste.** A
top-down walk stops at the first page it already holds in full, which is correct
for "what is new" and blind to everything BELOW a thread an earlier cap cut
short — a conversation `sync-ghl-conversations` left at exactly 100 messages has
a fully-held page one, so the walk stops above 400 messages it never fetched.
The second walk, seeded at the oldest message we hold, is what reaches them.

The stale tail buys it once per rotation, which is what it is for. The FRESH
HEAD buys it every tick, and that is not generosity: its own upsert stamps
`last_synced_at = now` on every conversation it touches, so those threads sit
permanently at the back of the stale tail's ordering and would never reach the
band that completes a truncated one. **The fifty most active threads are also
the deepest, so they are the most likely to be truncated** — excluding them was
a real starvation bug in the first version of this design, found by reading it
back rather than by running it. Bootstrap is the one band that does not pay:
a conversation it has just discovered has an empty held set, so the top-down
walk already ran to exhaustion and there is no anchor to seed a second one
from.

**`nullsFirst` is stated wherever the ordering decides what gets looked at.**
Postgres orders DESC as NULLS FIRST and `last_message_date` is nullable, so
"the 50 newest conversations" was in fact up to 50 rows with no message date at
all — the exact opposite of what that band is for, and why a reply that had just
arrived could be missed by the notification path.

## 10. The window that sweeps the never-seen contacts

One question has no fact to re-derive from. A client with a `ghl_contact_id`
and no `ghl_conversations` row is either a client nobody has asked GoHighLevel
about or a client GoHighLevel holds nothing for, and the schema cannot tell
them apart. Recording the difference needs a column; sweeping the list on a
clock does not.

`ghlBootstrapWindow.pure.ts` is that sweep, and it exists to make one specific
trap impossible. The obvious form — `floor(now / period) % ceil(total / size)`
— strands clients the moment the constant `period` and the cron's actual
cadence disagree, which is one edit to a schedule away. The offsets then reach
only the residues of that stride: **a ten-minute constant against a
fifteen-minute cron, over six windows, visits {0, 1, 3, 4} and never 2 or 5**.
Against a half-hourly cron the same code visits {0, 3} alone. Two sixths, then
two thirds, of the client list permanently unreachable — silently, because a
window that is never visited raises no error.

The rule is that **the offset advances by at most one window width per tick**,
so consecutive windows abut or overlap and their union is the whole list. It is
held by DECLARING the fastest cadence the sweep is built for
(`MAX_TICK_MINUTES`) rather than inferring it.

That distinction was itself a defect, caught by its own test. The first version
derived the step from the measured gap between ticks, and **a step inferred
from a measurement amplifies a wrong measurement across absolute time**:
measured at 2 minutes while the job really fires every 15, the offset jumps 7.5
windows a tick and strands a third of the list. Both wrong forms are executed
in `ghlBootstrapWindow.test.ts` beside the real one rather than described,
because the whole point is that the defect is invisible to reading. The
observed gap is still passed in and is used for exactly one thing —
`cadenceExceeded`, which says the job is firing further apart than the sweep
was built for. A reading is for looking at; it does not steer the sweep.

## 11. The four facts a walk comes back with

`ghlFetchShared` **returns** a non-2xx response after its retries rather than
throwing. So the natural shape — `if (!res.ok) break` — leaves the loop with no
cursor, having spent no budget and hit no cap, and every "did we finish?" test
then answers yes. A refused walk and a completed one become the same answer,
which is how an import comes to report success over a thread it never read.

`GhlWindow` therefore carries `failed`, `stoppedOnBudget`, `hitPageCap` and a
page count separately, and **`exhausted` is derived from all of them at a single
return**. A spec asserts exactly one place in the module may compute it.

Two more rules in the same pager. **A short page is not proof of exhaustion** —
only the absence of a cursor ends a walk; the copy this replaces ended on
`messages.length < 50`. And **`data.nextPage` is never read on the conversation
search**: that field exists only on the messages sub-endpoint, and reading it
there is what made a previous worker exit after one page.

The conversation search carries one exception to the first rule, and it is an
exception about COST rather than about evidence. A cursor the vendor supplies
is always followed, whatever the page length. A cursor SYNTHESISED from the
page tail is followed only off a full page — because with one conversation per
contact, synthesising unconditionally makes every contact in every band pay a
second request that comes back empty, which doubles the largest band's spend to
learn nothing. A short page the vendor did not paginate is the strongest
evidence of the end there is; a short page with a vendor cursor is still
followed.

## 12. Reading a set PostgREST will not give you whole

`max_rows` is 1,000 on these projects and a truncated answer is a 200 with a
short array — indistinguishable from a table that really holds that many. Two
reads treated such an answer as a COMPLETE set, and each fails in its own
direction.

`sync-ghl-conversations` read every client with a contact id as one select and
then paged *that array* with a cursor, so at 1,001 clients the 1,001st is
invisible to the bulk import for ever and `total_contacts` is not the total. It
also had **no `ORDER BY`**, and Postgres promises nothing about the order of an
unordered select — so a resumable cursor over it could skip one contact and
visit another twice. It pages now, ordered by primary key.

The held-message set is worse, because a truncated one is worse than none at
all: the pager stops walking when a whole page is already held, so a window of
the set either stops the walk above messages it never fetched or makes it run
to the bottom of the thread on every tick for ever. **The no-op proof inverts
into a spin.** `loadHeldMessageIds` refuses a truncated read outright rather
than using it, and `pageAll` carries `failed` separately from `rows` because a
read that FAILED is not a set that is EMPTY.

## 13. One mapper, one store

These four mappers existed in four copies. Two call sites writing the same
message through two copies of `mapMessageDirection` is how one message comes to
be `inbound` on the scheduled path and `outbound` on the browser's refresh,
with `onConflict: 'ghl_message_id'` making whichever ran last the winner.

Unifying them fixed a live bug in the copy that lost. `sync-ghl-conversations`
wrote `conv.lastMessageDirection || conv.lastMessageType === 1 ? 'inbound' :
'outbound'`, and `||` binds looser than `===`, so the condition is
`(direction || (type === 1))` — the string `'outbound'` is truthy and selected
`'inbound'`. **Every thread that path touched recorded its last message as
incoming.**

`ghlConversationStore.ts` is the database half, and it carries one rule the
mapper cannot: **a batch is deduplicated before the upsert.** GoHighLevel
repeats the anchor message across a page boundary, and Postgres answers a second
conflicting row inside one statement with 21000 — which loses the whole batch,
not the duplicate.

## 14. A column the table does not have, on the WRITE side

`aml.cases` taught this repository the read half of this class: PostgREST
answers 42703, the discarded error leaves `data` null, and a missing column
reads exactly like a missing row. The write half was still open, and it is
worse: an unknown key in a payload is **PGRST204 and fails the whole
statement**, so the row simply never exists.

Nine sites were live, every one verified against `information_schema.columns`
on the prime rather than against the generated types.

**The CRM has never recorded an outbound message it sent.**
`ghl_conversation_messages` has no `message_type` column — not in the table, not
in any migration, not in the generated types — and `send-ghl-message` carried it
in `messageRecord` beside `channel_type`, with the same value. PostgREST
answered PGRST204, `if (persistError) throw persistError` re-threw it, and the
outer catch returned HTTP 500 *"CRM messaging is temporarily unavailable"* —
**after GoHighLevel had already accepted and delivered the message.** So every
outbound SMS and WhatsApp the CRM ever sent was really sent, never recorded, and
reported to the operator as a failure; the conversation's own metadata update
and `logApiUsage` beneath it never ran either. The operator then retried, and
the duplicate guard could not stop them, because it reads `client_request_id` —
also absent — and discards the error. `send-email-reply` carried the same
phantom key, and its upsert error was not read at all, so every emailed reply
was absent from the thread it was sent in.

Three of those columns are real again. `20260723150000_conversation_message_delivery_safety.sql`
adds `client_request_id`, `error_message` and `available_channels`, it was
committed on 23 July 2026, and **it has never been applied to any database in
the fleet**.

The cause is not a bug, it is the design, and it is worth stating plainly
because it will do this again. **Nothing applies a migration on merge.**
`apply-migration.yml` is `workflow_dispatch` only, and deliberately so — its
own header records why `supabase db push` is unsafe here: measured 13 Aug 2026,
the ledger called 133 migrations pending while all but one family of the tables
and functions they declare already existed, so `db push` would replay ~130
files including data mutations that are not idempotent. "Deciding *which* file
is a human judgement made before dispatch." So a migration is committed, CI
goes green, the PR merges, the cascade carries the FILE to every clone — and
the columns exist nowhere until somebody dispatches it by hand. Nobody
dispatched this one, for fifty-two days, while three features quietly did
nothing.

It is re-issued as `20260913094500`, idempotent throughout, and applied to the
prime and all three clones — **asserted by effect**, by reading
`information_schema.columns` back rather than by trusting the call: 684 of the
prime's 834 conversations and 78 of the clone's 320 now carry a real
`available_channels`, which the inbox's channel filter has been reading as
`undefined` on every row since the day it was written.

Four more sites, each found by the widened gate and each verified live:

- `outlook-email-webhook` wrote `internal_request_nonces.caller` (it is
  `caller_function`), so the insert answered PGRST204 rather than the 23505 the
  branch looks for and **every notification was claimed** — the replay
  idempotency has never been in force.
- `report-engine-inspector` wrote `report_engine_proposals.proposed_by` (the
  table separates `proposed_by_agent` from `proposed_by_user`) and throws on
  error, so that operation answered 500 on every call it ever received.
- `ai-dashboard-agent` wrote `agent_action_log.metadata` fire-and-forget, so the
  playbook audit trail has always been empty.
- `finance-portal-batch6` wrote `client_portal_messages.subject`/`body`/
  `metadata` (the table carries one `message` column), so the automated document
  reminder reached **no client at all** while `notifiedClient` counted every one
  as sent.

### Why the gate could not see any of it

`check-edge-column-names.mjs` matched a write body with `[^{}]*`, so a payload
carrying a template literal — `` `failed-${key}` `` — or any nested object failed
to match and was never judged. And it skipped a payload bound to a `const`
altogether, under the rule that "a payload assembled in a variable is not a set
of names anything can read". A `const` whose initialiser is an object literal
*is* readable, and that is the shape that cost the most. Both are read now; a
spread, a computed key and an identifier with no literal initialiser are still
skipped rather than guessed at.

Widening it found four **false** positives too, and they are the reason the
lookup is bounded: a file-wide search for `const updates = {` attributed
`ai-dashboard-agent`'s scheduled-task shape at line 4865 to four `game_plan*`
handlers two thousand lines below, which do `const { plan_id, ...updates } =
args`. Scope is approximated by proximity plus a no-intervening-binding rule.
Being wrong in that direction is worse than being silent: it teaches a reader
that the gate cannot be trusted.

### The class this still cannot catch

The columns a gate judges against are the generated types UNION the migrations,
which over-approximates on purpose so a column added since `types.ts` was last
regenerated is not reported as missing. **A column named by a migration is not a
column the database has** — that union is exactly why `available_channels`
passed for two months.

There is deliberately no gate for that, and the reason is measured. Reporting
every column the migrations declare and the generated types do not finds 95
across 47 tables, and almost all of them are columns production really has and
`types.ts` is simply stale about. The two cases are indistinguishable without
asking a database, so a source-tree gate would be noise. It is a deploy-time
question: compare the repository's migrations against
`supabase_migrations.schema_migrations` on the project itself.

---

## §15 — An entry is not a message, and 36% of the table is not correspondence

This is the defect the deep backfill *created*, and it is the one worth reading
first, because everything about it reported as success: rows written, no error,
a fuller thread than yesterday.

### What was measured

The prime, 13 Sep 2026, after `conversation-sync-cron` had been walking history
for roughly ninety minutes:

| `channel_type` | rows | newest row | what the body says |
|---|---:|---|---|
| `type_activity_opportunity` | 3,821 | today 11:41 | `Opportunity updated` / `Opportunity created` |
| `type_activity_appointment` | 673 | today 11:41 | the appointment's title |
| `type_call` | 194 | today 11:40 | **null on all 194** |
| `type_activity_contact` | 65 | today 11:40 | `DnD enabled by customer` |

**4,753 rows — 36% of a 13,255-row table — reaching 1,150 of 1,272
conversations.** 465 threads hold *nothing else*.

`GET /conversations/{id}/messages` does not return messages. It returns a
thread's **entries**, and GHL interleaves its own activity records among them
under the same `messageType` field that carries the channel. One value is being
asked both *how was this sent* and *was anything sent at all*, and it cannot
answer the second.

None of this was visible while the walk was `?limit=20` and one page. Paging the
history properly is what surfaced it — §8's own work.

### They rendered, and the near miss is the instructive part

Both copies of the UI's `normalizeChannel` **already** mapped `type_activity_*`
to `'activity'`. Knowing was never the problem. Nothing *consumed* it:
`getOutboundBubbleClass()` switches on that value and carries arms for `sms`,
`whatsapp` and `email`, so `'activity'` fell to `default` — which is the SMS
treatment. "Opportunity updated" drew as a blue outbound bubble a reader cannot
tell from a text message the business actually sent its customer, on 90% of
threads. "DnD enabled by customer" drew **inbound**, as though the customer had
written it. And both copies map `type_call` to `'sms'`, discarding the one fact
that mattered: the render guards only the TEXT (`msg.body && …`) and never the
bubble, so all 194 call rows drew an empty bubble with a timestamp in it.

**A value can be normalised perfectly and still be acted on by nothing.** That
is why the fix is a classifier the thread has to ASK, and why
`crmConversations.spec.ts` asserts the *wiring* — that each surface groups and
counts the filtered list — rather than asserting the module exists.

### The rules

**A channel says how something was sent; it cannot say whether anything was.**
`classifyGhlEntry` answers `message` / `activity` / `call` and only `message` may
be drawn as correspondence. It lives in `ghlConversationMap.pure.ts` beside the
mappers that write these rows, and `src/lib/ghl/conversationEntry.ts` is a
re-export — `normalizeChannel` is already written twice here and the copies have
measurably drifted (the tab's knows neither `mail` nor `whats_app`), so a third
private copy of "is this a message" was the thing to prevent.

**The activity family is matched by PREFIX, never enumerated.** GHL publishes
`TYPE_ACTIVITY_INVOICE` and `TYPE_ACTIVITY_PAYMENT` too. An enumeration is a
list of what we happened to meet, and it would let an invoice arrive as an
untyped bubble the day one is raised.

**Nothing deletes.** An activity row is a real GHL record. This decides what the
thread *draws*, not what the table *keeps* — the read-path rule the image
library and the finance heal already answer to, and it has to be the read path
because a re-sync writes these rows again and a write-path fix would leave every
existing one rendering.

**An unknown channel is still a message.** Pass-through is `mapChannelType`'s
rule and it holds here: refusing to draw something nobody has seen before is the
greater harm. Only the two families GHL documents as non-messages are withheld.

**The empty state reads the filtered list and names what it withholds.** 465
threads hold activity entries and nothing else; keyed on `messages.length` the
empty state never fires on them and the reader gets a blank scroller — the
"blank area reads as a broken page" rule. It now says how many entries are
recorded and that they are kept.

### What was deliberately not done

**A call is excluded, and that is a decision rather than a conclusion.** A call
IS a real communication event and the row carries a real `message_status`
(`completed` / `no-answer`) — the honest way to show it is a call timeline with
direction, status and duration, which is a surface to design rather than a bug
to fix. Excluding it restores what a reader saw before the deep walk and loses
nothing that was ever legible: an empty bubble is not a record of a phone call.
The rows are in the table whenever that surface is wanted.

The conversation **list** preview needed no change and was checked rather than
assumed: `last_message_body` comes from GHL's own field on the conversation, not
from these rows, and zero of 1,272 previews carry activity text.

---

## §16 — Three more readers, and the gate that was one entry short

§15's classifier was correct and wired to two of the five things that read
`ghl_conversation_messages`. An adversarial review of that commit — six
dimensions, every finding put to a refuter that defaults to "not real" — raised
20 findings, confirmed 14 and refuted 6. What follows is the confirmed set
minus the one that was already fixed in the hotfix.

### The gate existed, ran, and let it through

`scripts/security/check-src-missing-names.mjs` is built for exactly the class
that broke production: *"undefined identifiers in the app bundle — fatal, never
baselined… ReferenceError the moment that line renders."* It runs in CI
(`ci.yml:286`) against `tsconfig.app.json`. It ran on the broken commit and
printed **"No undefined identifiers in src/."**

Its `FATAL` map held two entries, `TS2304` and `TS2552`, and line 121 does
`if (!FATAL.has(code)) continue;`. The fault was `TS2448` — *block-scoped
variable used before its declaration* — which is the same outcome reached by
ORDER rather than by absence. The name is declared, just not yet, and the read
throws exactly as hard.

**The class this gate defends is a name that cannot be read where it is used,
and TypeScript spells that three ways.** `TS2448` is now fatal. `TS2454` (used
before *assigned*) is deliberately still absent: that is definite-assignment
analysis, it is routinely conservative, and it does not promise a throw. This
list grows only for a code that guarantees a ReferenceError.

That gate's own header already warned about the trap that produced this —
`tsconfig.json` declares `"files": []` and delegates to project references, so
`tsc --noEmit -p tsconfig.json`, the obvious spelling, compiles nothing and
exits 0. The header was written after the first occurrence. The second
occurrence ran the obvious spelling anyway and reported it as green.

Proved by reintroducing the defect: the gate exits 1 and names it.

### Two more readers drew activity entries as correspondence

**`finance-portal-client-comms`** — a finance *partner's* client inbox.
`CHANNEL_META` has keys `sms|whatsapp|email|portal`, so
`type_activity_opportunity` fell to `?? CHANNEL_META.portal` and rendered with
a blue **Portal** badge, right-aligned by `direction: 'outbound'`: a partner
read "Opportunity updated" as something the business sent their client.

The exclusion here is **both server-side and in code, and the two are not
redundant**. `isCorrespondence` is the rule. The SQL predicate exists because
`.limit()` is applied by the database BEFORE anything is classified — on a
client whose recent history is mostly opportunity updates, an unfiltered
200-row window fills with activity and the real SMS and email fall out of it
entirely. Excluding server-side is what makes the window mean *200 messages*
rather than *200 rows*. The SQL names what production holds; the code decides,
so a future `type_activity_invoice` is withheld by the prefix rule even though
the predicate does not name it — costing breadth, never correctness.

**`build-conversations-export-worker`** — the sheet titled *Message History*,
which is the artefact that leaves the building. It carried one row per entry
and counted every one into `total_messages`, so the page that had just said
"no messages in this conversation" exported 26 numbered message rows for it and
the toast read "26 messages from 1 conversations". Fixing the count at source
repairs all three call sites in `Conversations.tsx` (783, 806, 1188) without
touching them.

It also held a **fourth** copy of the channel table, drifted furthest — no
`mail`, no `whats_app`, no numeric forms, no activity arm — so the Channel
column printed the raw `type_activity_opportunity`. Deleted; it imports
`mapChannelType` now. **Nothing is deleted from the database**: a conversation
whose entries are all activity still emits its row, and the placeholder SAYS
how many were left out rather than dropping them silently.

### The notice named categories the thread did not hold

"opportunity, appointment and call records" was printed on every thread
whatever it held — the hard-coded enumeration `ghlConversationMap.pure.ts`'s own
header forbids. A thread holding only `type_activity_contact` ("DnD enabled by
customer") was told about three categories it has none of while the one it does
hold went unnamed, so an operator looking for that record was pointed at call
records that do not exist. It was also scoped wrong: *"recorded against this
contact"* while counting one conversation.

`summariseWithheldEntries` reads the label **off the value** — the suffix after
`type_activity_` is the word, so `type_activity_purchase_order` reads as
"purchase order" the day one arrives — and a value that yields no usable word
contributes nothing, because a count with no list is honest and a list with an
invented entry is not.

### Three assertions that did not bite

Each was proved by mutation, and each now fails against the defect it names:

| assertion | why it passed on broken code |
|---|---|
| "nothing deletes" | required `delete` BEFORE the table name — the broker's spelling, not supabase-js's `.from(t).delete()`, which twelve-plus files under `src/` use |
| "never withholds a channel the map can produce" | fed our own OUTPUT vocabulary back in, reducing to a duplicate of the test above it |
| "declared once and re-exported" | satisfied by the shim's own header comment; gutting the export block left every test passing |

The replacement for the second is the seam that matters: a GHL activity entry
must become a row the thread withholds, asserted through `toMessageRow`. It
catches both mutations measured to survive the old suite — mapping an activity
kind onto a friendly word, and swapping the `messageType ?? source` precedence.

**A source-scanning assertion binds to the shape of the code, so it must bind
to the NAME and not the formatting.** Two of §15's assertions broke when the
import list grew and a variable was renamed — they were measuring layout.
