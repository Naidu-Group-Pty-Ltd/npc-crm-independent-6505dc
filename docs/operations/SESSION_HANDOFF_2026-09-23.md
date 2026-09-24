# Session handoff — 23 Sep 2026

Written for whoever picks this up next. Like the 22 Sep handoff before it, it
records **state**, not recollection. Every production figure was read back
from `function_logs` / `function_edge_logs` (log inspection, which the owner
permits). Every claim about the fix was either executed (on a real PostgreSQL,
or as a spec) or is marked **BLOCKED** or **PENDING** in those words.

Branch: **`claude/adoring-hopper-g02tdt`**, pushed. It was restarted from
`origin/main` at **`a552bcd`** (PR #2735) because its previous PR (#2692) had
already merged. It carries:

- all six unmerged commits of the 22 Sep session (`ced35d9`, `2ce539d`,
  `7f5e7d3`, `55831d0`, `6a42172`, `8c9ff3a`), merged in with their
  original SHAs, so `claude/vibrant-maxwell-h5na7d` is fully contained here
  and nothing needs to ship from it separately;
- this session's completion of the approvals-stall fix, and this document.

**Update, 07:30 UTC.** That first pull request (#2736) **merged, deployed and
had its migration applied** on the owner's confirmation, and the fix is proved
by effect (§0). The branch now carries the owner's items 4–6 in a second pull
request (#2737), which merges, and whose migrations are dispatched, only on the
owner's confirmation (§1, §13).

**Update, 11:25 UTC.** On the owner's confirmation, #2737 is shipped:
- merged as `16364001c`;
- the functions deployed;
- all three migrations applied;
- the five first projection loads proved by their log lines, each equal to its
  CI dry run to the row;
- the frontend publish started once Lovable reported `16364001c`.

What is proved, and what is still owed, is in §12 step 3 and §13.

**Update, 12:05 UTC: the programme is closed.** #2745 merged as `bded8c0fd`.
It was docs only, so nothing deployed. `REPORT_PRESENTATION_PROGRAMME.md` §7
is now the programme's closing record. Every workstream is done, withdrawn on
measurement, or closed by a recorded decision. §7 lists what remains:
evidence that arrives on its own schedule, the owner's decisions, and
follow-ups found on the way. Seven passages in that plan had been made untrue
by the last two days, and each now says it is superseded.

---

## 0 · If you read one thing

**The national supply register is unstuck, and walking down one window an
hour.** #2736 merged and deployed, `20261217000000` was applied, and the
hourly ticks read back from production say so:

| tick (UTC) | window asked | answer |
| --- | --- | --- |
| 04:20, 05:20 | the stalled window | 422, the refusal §2 describes |
| 06:20 | 2025-07 → 2025-09 | POST 200 in 7,576 ms, no refusal |
| 07:20 | 2025-04 → 2025-06 | POST 200 in 11,169 ms, no refusal |
| 08:20 | 2025-01 → 2025-03 | POST 200 in 11,016 ms |
| 09:20 | 2024-10 → 2024-12 | POST 200 in 11,274 ms |
| 10:20 | 2024-07 → 2024-09 | POST 200 in 10,127 ms |
| 11:20, item 4's code | 2024-04 → 2024-06 | POST 200 in 8,820 ms, no refusal |

These ticks prove **#2736's fix**. Item 4 is the walk's lower edge derived
from windows the ledger vouches for, rather than from `min(period)` (§6's
remedy). It shipped on the second pull request, #2737, deployed at 10:49 UTC.
It changes the walk only where a window was left half-written.

**The 11:20 tick is item 4's first run in production**, and its request line
shows which code ran, because only the new code logs these two fields:
`page=0 2024-04→2024-06 frontier=2026-07 proven=2024-07 held=2024-07`.
`proven` is the edge the ledger vouches for, and `held` is the table's
`min(period)`. They agree, so completed writes vouch for every month from
2026-07 down to 2024-07, and no window in that run was left half-written. The
window asked is the one directly below that edge. It is the same window the
old rule would have asked, which is what `SUPPLY_EVIDENCE.md` §15 predicts
when nothing has failed. The counts the logs cannot show (`windows_vouching`
and `windows_stale` on the sync row) are PENDING in §13.
§13 has #2737's state.

---

## 1 · Standing constraints — read these before doing anything

From the owner, carried verbatim from the 22 Sep handoff and **still in
force**. They are not negotiable and they are not mine to relax.

- **No direct SQL.** `mcp__Supabase__execute_sql` is *not* approved. The two
  reviewed migration workflows — `apply-migration.yml` and
  `migration-drift.yml` — are the authorised route to the database, and a
  queued Lovable "Query Database" request was explicitly **not** approved.
  Reading production **logs** through the Supabase MCP (`query_logs`, project
  `dduzbchuswwbefdunfct`) is log inspection and *is* permitted.
- **Do not bypass access controls**, or substitute server responses, replay
  renders, or publication confirmations for application acceptance.
- **Record unperformed checks as BLOCKED or PENDING, never PASS.**
- **Do not substitute manually patched data, fixtures or stored-report replays**
  for a real measurement.
- **Do not request credentials, JWTs, service-role keys or internal secrets.**
- **Do not break existing functionality.**
- **Do not touch the builder portals, AML/CTF compliance, or agreements.**
- **Do not introduce new infrastructure or destructive migrations** without
  separate approval, and do not repeat completed template migrations.
- **Open pull requests when they are necessary, and confirm with the owner
  before merging and before publishing** (a deploy, or a migration dispatch).
  This is the owner's revision of 23 Sep 2026, in their words: *"open Pull
  Requests when they are necessary, the only one thing i ask is confirm before
  merging and publishing"*. It replaces "do not open a pull request unless the
  owner asks for one".
- Authorised spend for the acceptance exercise is **A$25** including paid
  retries; track it and pause before exceeding it. **Spent so far: A$0.00.**

Also in force, from the owner's earlier instructions in this programme: work on
an isolated branch; do not deploy, change live data, run destructive
migrations or distribute reports without explicit approval; where access or
tooling prevents verification, state exactly what remains unverified and the
required next action; never print, commit or ask for a credential, and never
build a diagnostic path to read one; preserve the working Perplexity and
Lovable configuration.

The owner's standing brief: *take full ownership of the programme, think
outside the box, and always keep in mind the end user receiving the report —
the quality and presentation, and how content is placed within the report so a
client can read it easily.*

---

## 2 · The stall, as production records it

Read from `function_logs` and `function_edge_logs`, 22 Sep 08:00 → 23 Sep 04:45 UTC:

| | |
| --- | --- |
| refusals | **17**, one distinct message, every one HTTP 422 |
| first / last | 22 Sep **12:20:15** UTC / 23 Sep **04:20:05** UTC |
| request, every time | `page=0 2025-07→2025-09 frontier=2026-07` |
| message, every time | `the ABS building-approvals count for Ulverstone 2025-08 reads -5 dwelling units, outside 0–100000 for a sa2 area (unit or column drift) — refused` |
| last three windows that wrote | 09:20 `2026-04→06`, 10:20 `2026-01→03`, 11:20 `2025-10→12` — HTTP 200 in **9.6 s, 10.8 s, 11.4 s** |
| any other `market-sales-ingest` stage failing | **none** in the same 24 h |

So `oldest` is frozen at **2025-10** and the register holds 2025-10 … 2026-07
(ten months). That message is the parser as deployed from `658211f`. The
22 Sep fix (`8c9ff3a`) has never run in production.

**What a client is being shown meanwhile.** The latest window is 2025-08 …
2026-07, of which ten months are held, so the Supply block reads *"The
publisher has released **10 of the 12 months** in that window for this area,
so each total above is a FLOOR — the true figure can only be higher."* Both
halves are false. The ABS released all twelve months, and two of them are
simply not held yet. And "can only be higher" stops being true once a month
can be negative, which Ulverstone's already is. The section also states no
year-on-year change, because no area has 24 months. That part is correct and
by design.

---

## 3 · Why the 22 Sep fix would not have unstuck it

`8c9ff3a` did two correct things. It tests the ceiling on `Math.abs`, and it
drops and names an isolated implausible cell instead of throwing. Its handoff
called that the fix. **Three defects stood behind it, and the first one alone
would have kept the stall.**

### 3.1 The table refuses the same figure

`20261213000000_market_building_approvals.sql` declares
`check (dwelling_units is null or dwelling_units >= 0)` and the same for
`value_aud`. A parser that admits the -5 hands the database a row it refuses,
so the refusal moves one layer down instead of going away.

### 3.2 Worse than a stall: a permanent hole

The loader writes a window in four "shapes" and in batches of 500, and throws
on the first batch that fails. The batches before that one have already
committed. The walk derives its next window from `min(period)` over the table
(`planApprovalsWork` rule 3: `end = oldest - 1`). So a window that commits
partly moves `oldest` down, and **nothing ever asks for the rest of it again**.
Every report would read that hole as data.

**Executed** on PostgreSQL 16.13, with the table built from the repo's own DDL
and the loader's batch shape emulated (one `INSERT … ON CONFLICT` statement per
batch, which is what PostgREST sends). The window was 600 areas × 3 months,
with the negative in the fourth batch:

| write order | table state | window rows written | `oldest` after |
| --- | --- | --- | --- |
| parse order (what `8c9ff3a` alone would have run) | sign checks in place | **1,500 of 1,800** | **2025-07**, so the walk moves on and the 300 missing rows are never asked for again |
| negatives first (this branch) | sign checks in place | **0** | 2025-10, so the next tick asks again |
| negatives first | after the migration | **1,800 of 1,800** | 2025-07 |

A production window is about 14,800 rows, so about thirty batches. Unless the
-5 happened to fall in the very first batch, merging `8c9ff3a` before the
migration would have turned a visible stall into a silent, permanent gap in
the register.

### 3.3 The drift allowance was loosened too far

`8c9ff3a` refused a download only when more than **1%** of cells crossed a
ceiling. Drift is a share and an artefact is a count, and for dwelling counts
1% is too loose. Under a 1,000× drift the SA2 ceiling (100,000) is crossed only
by cells whose true figure is above 100 units in a month. That is a small
minority of SA2 months, so a drifted download could pass under 1% with every
other cell written a thousand times too large. **Replaced by an absolute count
of 3.** A spec pins a 1,000× drift that crosses on under 1% of cells and must
refuse. Raising the cap to 320 makes that spec fail, which confirms the spec
is testing the cap.

It also dropped cells **"and named" them to nobody**: `implausibleCells` was on
the parse and nothing recorded it.

---

## 4 · The fix on this branch

| file | what it does |
| --- | --- |
| `supabase/migrations/20261217000000_approvals_admit_net_amendments.sql` | **new.** Replaces the two sign checks with symmetric **magnitude** checks at the parser's loosest (national) ceilings: `abs(dwelling_units) <= 2000000`, `abs(value_aud) <= 250000000000`. Finds the sign checks by **definition**, never by a guessed name. Runs as **one DO block**, because `apply-migration.yml` runs psql without a transaction. Then it **proves** the result: it inserts a row carrying `-1` on both measures in a nested block, always rolls it back, and **raises**, undoing the whole statement, if the table refuses it. Idempotent: a re-apply proves the effect again and changes nothing. Carries an `@effect` probe. Sets both column comments to say "net of amendments". |
| `_shared/reports/market/openData/absBuildingApprovals.pure.ts` | Keeps `8c9ff3a`'s `Math.abs` ceiling and its drop-and-name. `maxImplausibleShare: 0.01` becomes **`maxIsolatedImplausibleCells: 3`**. Adds `carriesNetNegative` and **`approvalsWriteOrder`** (negative-bearing rows first; stable within each group). |
| `market-sales-ingest/index.ts` | `upsertApprovals` writes `order.first`, then `order.then`. The sync ledger's `detail` gains `implausible_cells_dropped`, `implausible_cells` (first 20), `negative_rows` and `negative_examples` (first 5). |
| `_shared/reports/market/approvalsFactBlocks.pure.ts` | An incomplete window is described as **the sum of the N months it covers**: not a twelve-month total, and not a minimum either, because the monthly figures are net of amendments. A negative dollar figure prints **`-$3,000,000`**, never `$-3,000,000` (hyphen-minus, because `printableGlyphs.pure.ts` records that U+2212 cannot be drawn in two of the print faces). |
| `supabase/migrations/20261215020000_approvals_grain_read_back.sql` | A `negative=` bucket beside `null= zero= positive=`, so the four counts keep adding up to the total. It reads only and is safe to re-apply (`record_version: false`). |
| `docs/reports/REPORT_PRESENTATION_PROGRAMME.md` | Corrects "Nothing here is waiting on a deploy", which stopped being true 87 minutes after it was written. |
| specs | `absBuildingApprovals.spec.ts` (drift count, negatives, write order, loader wiring), `approvalsFactBlocks.spec.ts` (partial wording, signed money), `approvalsAdmitNetMigration.spec.ts` (new, 11 tests). |

### Why the two acts can land in either order

- **Code first.** The new parser admits the -5. The loader writes the
  negative-bearing rows first, and the table's sign check refuses that first
  statement **before any other row of the window commits**. The register stays
  exactly where it is, and the log names the constraint:
  `approvals refused/failed: market_building_approvals upsert failed (<shape>): new row for relation "market_building_approvals" violates check constraint "market_building_approvals_dwelling_units_check"`.
  The next tick after the migration writes the whole window.
- **Migration first.** The deployed parser still refuses the -5 at parse time
  and writes nothing. The stall continues unchanged until the code ships.

Either way the register is never left holding part of a window.

---

## 5 · Shipping it, and proving it by effect

**Status, 23 Sep.** Steps 1–4 are done for #2736; §0 has the ticks. Step 5,
the read-back, has **not** been run, so it is PENDING. Step 4's reasoning
describes the planner as #2736 shipped it. Since #2737 the walk steps below the
edge the sync ledger proves rather than below `min(period)` (§6).

1. **Owner:** confirm the merge of this branch's pull request (the PR is
   open; merging waits for the owner, under §1).
2. **After the merge**, confirm the `Deploy Supabase functions` run on that
   commit shipped **`market-sales-ingest`**. Shared code changed, so it deploys
   every function, `generate-investment-report` included (that one carries the
   new Supply wording).
3. **Dispatch** `apply-migration.yml` with
   `file: supabase/migrations/20261217000000_approvals_admit_net_amendments.sql`
   and `record_version: true`. The run log must show
   `WARNING: APPROVALS_ADMIT_NET dropped=[… …] added=[…] — a published negative is admitted (probed and rolled back)`.
   An `ERROR: APPROVALS_ADMIT_NET: the table still refuses …` means the swap
   was refused and **nothing changed**. The message names the constraint that
   survived.
4. **Read the next tick's effect, not its request.** In `function_logs`, the
   tick after both have landed logs `page=0 2025-07→2025-09` and **no**
   `refused/failed` line. **The tick after that is the proof:** it must ask
   `2025-04→2025-06`, because the planner derives its window from the
   register's own `min(period)`, and that can only move if the window
   committed. (The 22 Sep handoff was written from a request line alone. A
   request line proves only what was asked for.)
5. **Read back the register** by dispatching
   `supabase/migrations/20261215020000_approvals_grain_read_back.sql` with
   `record_version: false`, then reading `postgres_logs` for
   `APPROVALS_READBACK`. Expect `negative=` greater than zero once 2025-08 is
   in. Over its first seven months the register grew by **exactly 4,934 rows
   a month** (4,934 → 19,736 → 34,538 over one, four and seven months). A
   window that fell short of that is the signature of §6's defect. (That
   check stays useful after §6's fix: a shortfall should now be repaired by
   the next tick instead of persisting.)

**What to expect, and when.** 33 months are owed below 2025-10 (floor
`2023-01`), which is **11 windows, one per hourly tick**:

| after the Nth successful window | what changes for a client |
| --- | --- |
| 1st (`2025-07→09`) | the latest twelve-month window is complete, so the partial wording disappears |
| 5th (`2024-07→09`) | 24 months are held, so a **year-on-year change** can be stated |
| 11th (`2023-01→03`) | complete to the floor |
| the tick after | the planner answers `settled` and asks the ABS nothing. **This verdict has never been observed**, and it is the last unverified half of the walk's guarantee |

(On 1 Oct the planner spends one tick re-reading the frontier, because
currency outranks depth. That tick is expected and does not mean the walk has
stalled.)

---

## 6 · A transient failure mid-window left a hole — fixed by remedy 1, shipped on #2737

**Status, later on 23 Sep.** The owner approved closing this ("items 4, 5 &
6"), and remedy 1 shipped on #2737 (merged as `16364001c`, deployed 10:49
UTC). Until then production stepped below `min(period)`. The first tick on the
new code is the 11:20 UTC one (§13). The walk now steps below the oldest month
the sync ledger PROVES was written whole (`vouchedOldest`), so a half-written
window is asked for again. It needs no schema change and no new object. The
rule for older rows turned out not to need `page_window`: every approvals
success row since the stage was born (6ba3a5e, 21 Sep) carries `area_kind`,
`first_period`, `latest_period` and a period count, and a count equal to the
span is a window with no gap. The one thing the remedy did not anticipate is that **the ledger
outlives the rows it describes**. `20261215030000` emptied the table on
22 Sep, and the two success rows written before it still vouch for
2026-05 → 2026-07. So a success row older than every stamp the table holds is
set aside. The design, the simulation that checks it and its limits are in
`docs/reports/SUPPLY_EVIDENCE.md` §15. The analysis below is kept as written.

`approvalsWriteOrder` closes the hole for the **negative** class only. It does
**not** make a window atomic. If a batch fails part-way through the
non-negative rows for any other reason (a PostgREST 5xx, a dropped connection,
a statement timeout), the batches before it stay committed, `oldest` moves, and
the rest of the window is never asked for again. That is the §3.2 mechanism
with a different trigger.

**How likely it is:** low, and the one measurement available says so. A
window's whole run takes 9.6–11.4 s, far inside an edge function's limits, so
this is not a timeout risk. The only route is a database or network error
during one of the roughly thirty batches. **What it costs when it happens:** a
silent, permanent gap that every report reads as data.

It is left unfixed on purpose. The stall fix should ship small, and each remedy
changes the planner, which the 22 Sep session spent a day building and
proving. The remedies, best first:

1. **Derive the walk's lower edge from the ledger, not the table.** A window
   counts as held only once its `market_sales_sync` row records success.
   A write that throws leaves `oldest` where it was, and the next tick asks
   again (the upsert is idempotent). No schema change. The cost is a second
   read per tick, and a rule for rows written before the ledger recorded
   windows (`page_window` arrived on 21 Sep, a day before the walk).
2. **Write newest month first, and overlap the next window by one month.** At
   most the oldest month can be partial, and it is always asked again. The
   cost is one repeated month per window, and the floor month needs care
   (a partial floor month would read as settled).
3. **Make the write atomic** with a database function that takes the whole
   window in one transaction. This is the cleanest, but it is a new database
   object, which the owner's rule on new infrastructure puts behind approval.

**Until one of those lands:** §5 step 5's row arithmetic is the detector.

---

## 7 · Verification performed

**Against a real engine.** PostgreSQL **16.13**, local and throwaway, created
for this and deleted afterwards. The table came from the repo's
`20261213000000`, and the migration was applied with
`psql -v ON_ERROR_STOP=1 -f`, as `apply-migration.yml` does:

| case | result |
| --- | --- |
| the sign checks as Postgres prints them | `CHECK (((dwelling_units IS NULL) OR (dwelling_units >= 0)))`, `CHECK (((value_aud IS NULL) OR (value_aud >= (0)::numeric)))`. The finder's patterns match both, measured rather than assumed |
| first apply | both dropped, both bounds added, the probe admitted a negative and was rolled back, exit 0, **0 probe rows left** |
| re-apply | "already applied … probed and rolled back; nothing changed", exit 0 |
| a row shaped like Ulverstone's (`-5` units; and, separately, `-5` units with a negative value) after | admitted |
| `-2,000,001` units after | refused by `…_dwelling_units_magnitude` |
| a table already holding 19,736 rows | swap succeeded, rows unchanged |
| a sign check spelled `not (dwelling_units < 0)` | **refused**, naming `market_building_approvals_dwelling_units_check`, exit 3, **both original checks still in place, comments unchanged** |

That last row is why the migration proves its result instead of re-reading it.
The first draft re-counted the constraints with the same pattern that had found
them. Against that spelling the draft **exited 0, reported success, and the
table still refused the -5**. This was measured, then replaced with the probe.
Production's table was created by `20261213000000`, so its checks should be
the standard spelling in the first row; the probe is there so that nothing
depends on that "should".

**Not executed:** the migration against production or any copy of it.
Production's PostgreSQL major version was not read. The local engine is 16,
and DO blocks, subtransactions and `pg_get_constraintdef` behave the same way
for these expressions in 15 and 17.

**Specs and gates on the branch:**

- `src/lib/reports` plus the migration index and dependency-order specs:
  **355 files passed (4 skipped), 7,647 tests passed (23 skipped), exit 0**.
  After the last edits, the six approvals and migration spec files alone:
  **155 of 155**.
- A mutation of the migration's probe handler (`when others`) is caught by the
  spec.
- `tsc -p tsconfig.app.json`: 20 errors, **line-for-line identical to
  `origin/main` at `a552bcd`**. None is new and none is in a touched file.
- `eslint` on every touched source file: clean.
- `check-migration-security`, `check-migration-dependency-order`,
  `check-migration-version-collisions`, `migrations:index:check` and
  `check-edge-column-names`: all pass.
- **BLOCKED:** `scripts/security/check-edge-functions.mjs`, because Deno is not
  installed in this sandbox. CI runs it. `market-sales-ingest` was parsed with
  esbuild as a partial substitute; that is **not** a type check.
- **PENDING:** every production effect in §5.

---

## 8 · The other carried commits, reviewed

- **`7f5e7d3`, `{{bars:}}` long labels.** Re-measured by execution against the
  previous renderer. 13 of 15 label shapes are byte-identical. The two that
  differ are 35-character labels at 60 mm and 90 mm, and they are exactly
  where the old renderer started drawing off the canvas (x = -338.3 and
  -111.5). The 62-character approvals label now sets as two lines, and the
  viewBox grows from 84 to 110 in height.
- **`2ce539d`, `compassFitsItsPageAllowance.spec.ts`.** Passes in the full run.
- **`ced35d9`, `55831d0`, `6a42172`.** Documents. The 22 Sep handoff now opens
  with a pointer here, because its §3 still calls `8c9ff3a` "the fix".

---

## 9 · Still open from 22 Sep, unchanged

- **The land-use register: five rows where the code says thirteen**
  (`A_PREMIUM_DOCUMENT.md` §9). A pending measurement with a trigger: the next
  delivered Compass for a property whose land-use table prohibits
  *Residential accommodation* as a group.
- ~~**W3.5, Tasmania.** `data.tas.gov.au` does not resolve from this egress.~~
  **Closed 23 Sep** (item 5): read from the harvest's own records — 982
  datasets across its 14 government publishers, in full, none carrying a
  count. `SALES_VOLUME_COVERAGE.md` §4.4.
- **Owner decisions the plan deliberately does not take:** whether the 21
  `market_sources` rows are seeded; whether the nine pre-19-Sep reports are
  regenerated (**the owner has said no**); and Risk. It needs a construction
  year, held on 0 of 1,230 stored reports, so **four of five scored dimensions
  is the honest ceiling**.

---

## 10 · Where the environment lies to you

- **`npm run lint` over the whole repo is red before you touch it:** 46 errors
  and 3,202 warnings in 32 files, all pre-existing. Lint the files you
  changed.
- **`tsc -p tsconfig.app.json` is red on `main` too** (20 errors). Compare
  against a clean worktree, not against zero.
- The 22 Sep list still holds: `xlsx` does not resolve here (11 test files fail
  to collect across the whole suite, none under `src/lib/reports`); two specs
  time out at 5 s under full-suite load; two specs fail on unmodified `main`;
  Deno is absent.
- **A real PostgreSQL 16 is installed** (`/usr/lib/postgresql/16/bin`). It is
  usable for executing a migration against the repo's own DDL, which beats
  reading the migration as text. Two traps: the scratchpad path is too long
  for its Unix socket, and the harness resets the scratchpad's parent
  directories to `0700`, so the `postgres` user cannot reach it. Listen on
  `127.0.0.1` with `unix_socket_directories=''`, keep the data directory under
  `/var/lib/postgresql`, and delete it afterwards. **It is not production**;
  label anything measured on it as such.
- **A cancelled CI run is not a stopped one if a step says `if: always()`.**
  GitHub does not interrupt an `always()` step on cancellation, so until
  `4941f167f` a push that superseded a run left `abs-register-liveness`
  probing for about fifteen minutes while the next run sat `pending` in the
  `ci-<ref>` concurrency group. The probes now run under
  `if: ${{ !cancelled() }}`. A run started from an OLDER commit still carries
  the old conditions, so the first push after that commit still waits one
  last time. Use `!cancelled()` for "run even if an earlier step failed", and
  keep `always()` for steps that take seconds. Measured on #2745: a push at
  11:13:41 cancelled run 35852556486 by 11:14:02, and the next run started at
  once.

---

## 11 · Corrections — do not re-make them

1. **The 22 Sep handoff presented `8c9ff3a` as the fix.** It was one layer of
   three (§3).
2. **The programme doc said "Nothing here is waiting on a deploy."** It became
   false 87 minutes later; corrected in place.
3. **My first draft of the migration verified its own swap with the pattern
   that did the finding.** That is a check which passes exactly when it
   should fail. It was measured on a real engine and replaced with an insert
   probe (§7).
4. **Before the 22 Sep constraints reached this session, earlier S5 work here
   issued read-only queries through `execute_sql`.** Both named objects that do
   not exist, so they returned nothing. It has not been used since, and none of
   this fix used it.

The rule behind all four is the one this programme keeps paying for: **read
the effect, never the intent.** A request line, a green run, a matched pattern
and a merged commit each describe what was meant to happen.

---

## 12 · Next steps, in order

1. ~~Owner: confirm the merge of #2736 and the migration dispatch.~~ **Done
   23 Sep**: merged, deployed, `20261217000000` applied, proved by effect (§0).
2. **Leave the approvals walk alone.** It steps one window an hour; read the
   ledger back once it reaches the register's floor, then read a delivered
   Supply section after the fifth window, when it first states a
   year-on-year change.
3. ~~**#2737 (items 4–6)** — the merge, the migrations, the first loads.~~
   **Done 23 Sep, on the owner's confirmation:**
   - merged as `16364001c` (10:31 UTC);
   - deployed (run 35849263700, 10:49);
   - `20261218000000`, `20261218010000` and `20261218020000` applied in one
     ordered `apply-migration.yml` run (35851171153, 10:52);
   - the five first loads each proved by their own log line, equal to the CI
     dry run to the row (§13).

   The frontend publish started once Lovable reported `16364001c` (deployment
   `4d90e9d6-5510-4cd2-9128-34b9efce394c`).
4. **Owner: Tasmania's terms** (`FORWARD_DEMAND_EVIDENCE.md` §9.2). The
   Treasury's quick guide grants reproduction *"in published work … provided
   you identify and credit them as Tasmanian Treasury 2024 projections"*; the
   Tasmanian Government's site notice (2011 archive copy — the live page
   refuses CI) licenses *"non-commercial purposes only"* unless a site says
   otherwise. Is a report prepared for a paying client "published work" under
   the guide's grant? Yes → declare the licence (the parsers already pass the
   dry run: 29 councils, 899 rows per series) and print the credit the guide
   asks for; no → Tasmania stays refused, as now.

---

## 13 · Items 4–6, on #2737

- **Item 4 — shipped on #2737, deployed 10:49 UTC, and its first run is
  read.** The walk's lower edge comes from windows the ledger vouches for
  (§6's remedy 1). The 11:20 UTC tick logged `proven=2024-07 held=2024-07`,
  asked for `2024-04→2024-06` and answered POST 200 in 8,820 ms (§0). The
  edge the ledger proves is the table's own floor, so every month from 2026-07
  down to 2024-07 is vouched for, and the walk moved on without re-reading
  anything. The same run's sync row also carries `windows_vouching` and
  `windows_stale`. Expect `windows_stale: 2`, the two rows from before
  `20261215030000`; that part is PENDING below.
- **Item 5 — done.** Tasmania publishes no sub-state count of residential
  sales, read from its whole list (982 datasets, 5 naming a sale, none
  countable); WA's "204" was one dataset counted twice.
- **Item 6a — the projection register has loaders, and every jurisdiction
  has a measured answer.** Eight files are declared, each parsed by code
  written against the layout CI printed for the real file, through a
  one-sheet xlsx reader, and each file's LOADER RUNS DRY IN CI over the real
  file on every build (from run 35831008944; Queensland's from 35836681636):
  - **NSW loads** — 622 SA2s / 13,482 rows and 129 LGAs / 2,709 rows, under
    CC BY 4.0 read from `planning.nsw.gov.au/copyright-and-disclaimer`.
  - **Victoria loads** — 80 LGAs / 320 rows, read through the archive (the
    publisher answers CI with a Cloudflare challenge), under CC BY 4.0 read
    from the Victorian catalogue's record of the dataset.
  - **Queensland loads** — the 2025 edition's SA2 table (546 SA2s, 3,276
    rows, medium series) and council table (78 councils, 1,404 rows, three
    series — adding to the publisher's own state total), under CC BY 4.0 read
    from the Queensland catalogue and from the council workbook's own link to
    the deed.
  - **Tasmania is the owner's decision** (§12 step 4). Its three series pass
    the dry run (29 LGAs / 899 rows per series) and its terms are read; the
    loader refuses it before any fetch until the decision is made.
  - **Four are declined for their licences**, each naming the permission that
    would change it: WA (*Custom (Active Acceptance)*); South Australia, whose
    January 2024 release — read through the archive, the catalogue's copy
    being the superseded 2016-based edition — is published with a report
    saying *"All rights reserved"*; the ACT, whose 2025–2065 workbook — the
    catalogue's copy being the superseded 2015-based edition — says *"no part
    may be reproduced by any process without written permission"*; and the
    NT, whose 2024 workbook (ABS SA3 regions, 2021 base) states no terms while
    the catalogue's CC Attribution record reaches only the superseded 2019
    release and the NT Government's copyright statement forbids reuse without
    an expressly provided Creative Commons licence.

  A file whose licence has not been accepted is refused before any fetch, a
  file that states terms of its own is refused at parse, and the notice a
  file supplies is carried on every row. See `FORWARD_DEMAND_EVIDENCE.md` §9.
- **Item 6b — South Australia's zone is read** from the Planning and Design
  Code's own layer (`JURISDICTION_PLANNING_COVERAGE.md` §3.6); WA's is readable
  and licence-restricted; the NT's is challenged.
- **Shipped 23 Sep** (§12 step 3). The five first loads logged, each equal to
  its dry run:
  - `nsw_sa2`: 13,482 rows, 622 SA2s;
  - `nsw_lga`: 2,709 rows, 129 councils;
  - `vic_lga`: 320 rows, 80 councils, through the archive (the publisher
    answered production 403);
  - `qld_sa2`: 3,276 rows, 546 SA2s;
  - `qld_lga`: 1,404 rows, 78 councils, three series.

  NSW and Queensland were fetched from their publishers with HTTP 200, so
  production's egress reaches QGSO.
- **Still PENDING, and named:**
  - The first report after 10:53 UTC to read the projection register (its
    `[forward-demand]` log line names the series, area and release).
  - The monthly jobs' first tick, 3 Oct from 18:05 UTC. A job is proved by its
    tick, not by its migration.
  - Item 4's `windows_vouching` / `windows_stale` counts. The edge itself is
    read: 11:20 logged `proven=2024-07`, which is `oldest_vouched`. The
    counts are in the 11:20 row of `market_sales_sync` and in the response
    body, and this session reads logs, not tables.
  - The walk's first `settled` verdict. If every remaining window writes, the
    ticks ask `2024-01→03` at 12:20 and step down one window an hour to
    `2023-01→03` at 16:20, which reaches the floor. The 17:20 tick should
    then answer `settled` and ask the ABS nothing. That has never been
    observed (§5's table).
  - Whether production's egress reaches `dpti.geohub.sa.gov.au` (the first
    South Australian report after deploy).
  - The published bundle. This sandbox's egress refuses both
    `command-centre.npcservices.com.au` and `*.lovable.app` (CONNECT 403), so
    the publish is confirmed as started, not as served. `/version.json` should
    name `16364001c`.
  - The owner's Tasmanian decision (§12 step 4).
- **Found and deliberately left for a follow-up** (outside items 4–6): two
  more reader-facing sentences print an ISO date prefix instead of going
  through `auDate` — the archive-capture clause in an open-data sales point's
  source note (`openDataSalesEvidence.pure.ts`, *"as the Internet Archive
  captured it on 2025-04-03"*) and the same clause in the Estimate CGR caveat
  (`capitalGrowthEstimate.pure.ts`). The second is CGR, which this programme
  protects, so neither was touched here; the projection register's own date
  was fixed on this branch because the register is new in this PR.

---

*Every production figure here was read from production logs at the time of
writing. Every other claim was executed, or is marked BLOCKED or PENDING.
Nothing in it is an estimate presented as a reading.*
