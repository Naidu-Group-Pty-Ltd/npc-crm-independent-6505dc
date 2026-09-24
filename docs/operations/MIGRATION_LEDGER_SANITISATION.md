# Migration ledger sanitisation — prime and clones (23 Sep 2026)

This records the state measured on 23 Sep 2026, what was changed, and the
order in which it has to land. Steps 1 to 3 are done — see *What actually
ran*. Steps 4 and 5 are not, and step 5 is blocked on step 4 by the file's own
header. Every item marked PENDING below is unperformed.

## What was measured

- **Prime ledger:** 1,036 rows. 906 carry a body and 130 do not. Every row
  "Apply a migration" ever wrote is among the 130: it recorded
  `(version, name)` only. `applied-body-digests.txt` verifies 690 of 690
  against that read.
- **Shared versions:** 25 versions are shared by 61 files
  (`MIGRATION_VERSION_COLLISIONS.json`). A version records one row, so the
  second file of a pair reads as applied whether or not it ran.
- **Ledger edits:** `20260921100000` deleted ledger rows. On the clones, the
  same DELETE met four different ledgers, so the Quick Send columns ended up
  present on two clones and absent on two.
  - The next day the prime re-applied `20260719000000` (run 35712338709).
  - Mission Control therefore sends that file to the clones regardless.
- **Seeds and the barrier:** Mission Control reads no body over 256 KiB. Every
  template seed was therefore an opaque barrier on every clone that lacked it.
  - Measured on the four clones' ledgers, the queue sent 1, 3, 3 and 1
    versions.
  - With the seed skeletons read, it sends 5, 7 and 7 on the three mirrors and
    25 on the CRM.
- **The vault, and the urban centres:** every deployment — the prime and all
  four clones — holds `supabase_url`, one row each and non-empty, beside
  `cron_service_role_headers()` and `net.http_post`. So neither
  `20261210010000` nor `20261210040000` raises anywhere, the CRM clone
  included. Only the secret's NAME and whether it is non-empty were read; no
  value was.
  - On the prime those five migrations have **already run, and nothing
    records them**: the register holds 102 centres, the monthly job is
    scheduled at `10 18 1 * *`, both functions exist, and the ledger carries
    no `20261210*` row at all.
  - `urban_centre_refresh` exists on no clone, so the clones are waiting on
    delivery rather than on the vault.
- **The apply workflow:**
  - It applied whatever a checkout held.
  - Twelve runs came from one feature branch.
  - Its file input defaulted to the v5 seed.
  - Its applied-body re-check was psql-only, so on the prime, which applies
    over the Management API, it never ran.

## What changed

**Prime, on `claude/exciting-thompson-16rvet`:**

- `MIGRATION_WITHDRAWN.json` declares three files whose effect is deliberately
  absent, and drift reports them as WITHDRAWN:
  - `20260724000000_prevent_duplicate_portfolio_publications`
  - `20260728120000_aml_verification_checks`
  - `20260901000700_partner_portal_agreement_cascade`

  `check-migration-ledger-writes.mjs` refuses a migration that writes the
  ledger.
- `20261219000000`–`030000` restate four changes some clones lack or disagree
  about.
- `20261219040000` restates the Quick Send columns and indexes on every
  database. **This reverses part of the owner-directed withdrawal in
  `20260921100000` and needs the owner's decision before it is applied.**
- `20261219050000` re-fires the approvals and projections first loads, only
  where they never landed.
- `supabase/migration-seed-skeletons.json` publishes each oversize seed's
  statements without its rows, pinned to the file's blob.
- "Apply a migration" now:
  - refuses a dispatch from anywhere but the default branch;
  - runs a preflight on both routes (`scripts/ops/applyPreflight.pure.mjs`)
    that refuses withdrawn files, shared versions, edited-after-apply files,
    and, unless `reapply: true`, anything already recorded or already run
    under another version;
  - stores the body of every file of 256 KiB or less and reads it back;
  - re-checks the manifest after the apply, on either route, on the prime only.

  One ledger reader (`scripts/lib/ledgerQuery.mjs`) serves the workflow and
  the drift report.

**Mission Control, on the same branch:**

- A withdrawn file is excluded from the corpus and is no longer a hole.
- A migration that writes a ledger is held, never run.
- A shared version is delivered whole or held.
- A file that names a held version waits for it.
- The seed skeletons are read for dependency facts and names only.
- An edge deploy with a failed bundle no longer stamps the backend revision.

## Order (every step needs the owner's confirmation)

1. ~~Merge the prime pull request.~~ Merged: `b361751e9`. Dispatches now come
   from `main`, because the workflow refuses any other ref.
2. ~~On the prime, dispatch `20261210000000`–`040000` (urban centres) with
   `record_version: true`.~~ Done, run **101**. This **recorded what already
   ran** rather than applying it: every object those five files create was
   already present, and only the ledger rows were missing.
3. ~~On the prime, dispatch `20261219000000`–`020000`, then `20261219030000`
   once its `@effect` probe has been read.~~ Done, runs **102** and **103**.
   The probe was read first and answered `NOT APPLIED`, so applying
   `20261219030000` changed the prime's row security. What it changed is
   measured below.
   - Dispatch `20261219040000` only once the Quick Send decision is made.
     **Not dispatched.**
4. Merge and deploy Mission Control. Its reader expects the skeleton manifest
   on the prime's `main`. **Merged** (`1332c085`); Lovable holds that commit,
   `status: ready`, `agentFinished: true`. **Not deployed.** Mission Control
   serves `mission-control.aurixasystems.com.au`, a custom domain rather than
   a `*.lovable.app` slug, so its publish is not an act to fire blind.
5. Let Mission Control redeploy `market-sales-ingest` on the clones. Then
   dispatch `20261219050000` on the prime. **Blocked on step 4 by that file's
   own header**: applied before the redeploy, every call answers HTTP 400 and
   the file is recorded as done with nothing loaded, which is
   `20261214000000`'s first finding over again. It is a guaranteed no-op on
   the prime, which holds 212,162 approvals rows and all five projection
   slices; its whole purpose is the clones.

## What actually ran

Three dispatches on 23 Sep 2026, all from `main`, all successful. The prime
applies over the **Management API**, so the preflight, the body store and the
manifest re-check each ran live for the first time on that route.

- **Run 101** — the five `20261210*` urban-centre files. Preflight passed for
  5 files; each applied and was **recorded with its body**. Nothing it
  touched moved: 102 centres, 0 pseudo-areas, the monthly job still
  `10 18 1 * *`, both functions present.
- **Run 102** — `20261219000000`–`020000`. All three recorded with bodies. All
  three were already in effect on the prime, so nothing there changed; they
  exist so Mission Control can carry them to the clones.
- **Run 103** — `20261219030000`. Recorded with its body, and it closed a live
  exposure (below).
- The manifest re-check passed on every run — 695 recorded digests all present
  in the ledger — and reported that the newly applied files **matched and were
  not yet in `applied-body-digests.txt`**. They are now: the ledger's 913
  distinct bodies were read and passed to the generator as `--digests`, which
  is the route that module exists for (*"the ledger is also reachable from
  places that are not this script"*). **699 entries, 9 added, 0 dropped, 0
  drifted**, and all nine matched **byte-identical** — the rung a body this
  repository's own workflow stored should land on, and the one that proves
  what was recorded is what the file holds. `check:applied-body-digests`
  answers 699 of 699.

### What `20261219030000` changed, which the step above did not state

Measured on the prime before applying. `email_copilot_sent_replies` held **46**
rows, and the third branch of all three scope policies was a blanket
`mailbox_source IS DISTINCT FROM 'personal'` — so **43 of the 46 were
readable, changeable and DELETABLE by every authenticated user**, including
replies to another client's email. That is the exposure the file exists to
close, and it is closed: all three policies now join through
`original_email_id`, and the blanket branch is gone from the top level.

The cost was not recorded anywhere and is recorded here. Of the 46 rows, 4
join an email, 11 keep visibility through `created_by`/`owner_user_id`, and
**31 now match no authenticated reader at all** — rows written with no
creator, no owner and no link to an original email. Nothing was deleted and
the service role still reads them, but they have left the Copilot's
authenticated surface. Closing a cross-client delete is worth more than 31
orphan rows staying visible, which is why it was applied; whether to repair
them (backfill `original_email_id`, or set `owner_user_id`) is a decision
nobody has made.

### Where the fleet stands

Measured after the three runs.

| deployment | of the 9 recorded | sent-reply exposure | ledger top |
| --- | --- | --- | --- |
| prime | 9 | closed | — |
| `preflight-property-group` | 9 | closed | — |
| `npc-client-dashboard` | 0 | **open** | `20261218020000` |
| `npc-test-76b3b3` | 0 | **open** | `20261218020000` |
| `npc-crm-independent` | 0 | already closed | `20261204010000` |

Mission Control delivered all nine to Preflight while these measurements were
being taken, and they are effective there rather than merely recorded — the
sent-reply and copilot policies, the `market_fact_snapshot` column, the MFA
function and `urban_centre_refresh` are all present. `urban_centre_register`
exists there and holds **0 rows**, which is correct: the rows a migration
INSERTs do not travel, and `urban-centre-register-ingest` fills it on its own
monthly schedule.

The other three have taken none of the nine. Two mirrors sit at
`20261218020000` — above these versions while not recording them, which is the
hole shape this programme exists to close — and the CRM clone is still stalled
at `20261204010000`. Those deliveries are Mission Control's, and they wait on
step 4.

## Decisions the owner has not made

- Quick Send: does `20261219040000` reverse the 21 Sep withdrawal?
- A GitHub Environment restricted to `main` holding the database credentials.
  This is the only binding version of the ref gate.
- Backfilling bodies into the 130 body-less prime rows. It is a ledger write,
  and it is not done.
- Porting `native_crm_tables` to the CRM clone.
- The 31 sent replies that `20261219030000` took off the authenticated
  surface: repair them (backfill `original_email_id`, or set
  `owner_user_id`) or leave them to the service role.

## PENDING (unperformed; not a pass)

- The Mission Control deploy (step 4), and every clone delivery that waits on
  it (step 5, and the three clones above).
- `20261219040000`, which waits on the Quick Send decision.

The preflight's ledger reads, the body store and the API-route manifest
re-check are no longer proven by tests alone: runs 101, 102 and 103 exercised
all three against the live prime.

Lint was run on 23 Sep over the 23 changed script and spec files: 0 errors and
0 warnings. It used the repository's `eslint.config.js`, with its plugins
installed outside the checkout at the declared ranges, because the sandbox's
`node_modules` lacked them. A planted `debugger` failed under the same
invocation, so the configuration was applied. CI runs lint against the
lockfile.
