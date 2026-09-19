# The builder ranking

*Written 17 September 2026. Every number in it was measured against the live
Builders Network and the prime on that day; where something was not measured
this says so rather than estimating it.*

## What was there before

`builder-stock-marketplace`'s `list_stock` ended in:

```ts
.order('created_at', { ascending: false })
```

That is the whole of the ordering that every Aurixa workspace — the prime and
all three clones — used to choose which builder's stock an adviser saw first.

It is tempting to call that "no ranking". It is not. In a multi-vendor
marketplace an order is a policy whether or not anybody chose it, and this one
says: **the builder who uploaded most recently wins.** It rewards churn,
it cannot be explained to a builder who asks where they rank, it cannot be
defended to one who asks why a competitor is above them, and it gives a builder
who keeps their listings immaculate exactly nothing.

## What the market actually looked like

| Measured 17 Sep 2026 | |
| --- | --- |
| Builder organisations on the network | 2 (both `active`) |
| Builders with any live stock | **1** |
| Live stock items | 43 (of 1,019 rows; the rest archived) |
| Stock images stored | 3,080 |
| Selection announcements (an adviser activating a builder) | **1** |
| Command Centre selections | 2 |
| Construction cases / practical completions / defects / warranty claims / transactions | **0 each** |

This shapes the entire design, and it is the reason the algorithm looks the way
it does rather than like a textbook marketplace ranking.

**Almost nothing you would want to rank a builder on has happened yet.** Did
they finish on time? No project has finished. How many defects? No defect has
been raised. Do they answer when a client is sent to them? One activation
exists, and it is not a sample.

A ranking that scored those absences as zero would not be measuring builders.
It would be measuring which tables happen to be populated — and it would rank a
builder with **no** delivery history *below* one with a **bad** delivery
history, which is precisely backwards.

## The five rules

### 1. Absent is never zero

This platform has paid for this rule twice already: once when a failed Places
lookup stored `count: 0` and depressed a published walk score, once when an
unresolved rent printed `0.00%` yield beside projections built on a real rent.

A signal with no data is `not_measured`, and a `not_measured` signal leaves
**both sides** of the average — not in the numerator, not in the denominator.
It cannot drag a score down and it cannot be mistaken for a measurement of
nothing. Every `not_measured` reading also names *why* (`no_live_stock`,
`no_activations`, `cohort_too_small`, `not_declared`, `not_recorded`,
`stale`, …), because "we have not measured this" is only useful to a builder
if they can tell which kind of absence it is.

### 2. A thinly-evidenced score is pulled toward the middle

Excluding absent signals creates its own trap: a builder measured on one signal,
at 100, would out-rank a builder measured on nine at 85.

So the weighted mean of what *was* measured is blended with a neutral prior
carrying `BUILDER_PRIOR_WEIGHT` (35, against signal weights summing to 100):

```
score = (Σ value×weight  +  50 × 35) / (Σ weight  +  35)
```

A builder measured on nothing lands on exactly 50 — unknown, not bad. A builder
evidenced on 6 points of weight, scored perfectly, reaches 57.3; one evidenced
on 60 points at 85 reaches 72.1. **Evidence outranks perfection**, which is the
only shape that is honest while the network is this young.

`confidence` (the share of weight actually measured) travels beside every score
and is drawn beside it everywhere it is shown, because a 70 evidenced on a tenth
of the signals and a 70 evidenced on all of them are different claims.

### 3. Merit and money are two numbers and never one

A commercial placement adds **no points** to `merit_score`. It selects a
placement *band* that sits above the organic order, is capped at
`MAX_PROMOTED_SLOTS`, and is labelled on the card.

Blending them would destroy both. A builder could no longer be told their merit
score without being told something untrue, and a paid position would wear the
appearance of merit — which, for an adviser who then recommends that property to
a client, is a claim that has to be disclosed rather than hidden.

The rule is held in the schema, not in a convention:
`builder_stock_item_ranks_disclosure` is a CHECK constraint that refuses any
`promoted` or `pinned` row with `disclose = false`, and the clone's mirror
carries the same constraint again on arrival.

### 4. An override is an act, not a value

Mission Control's pin, suppression and freeze never rewrite a computed score.
They sit beside it, each carrying an actor, a reason (10-character floor,
enforced at the column) and an expiry.

**`expires_at` defaults to 90 days rather than to NULL.** The failure this
defends against is not a badly chosen expiry — it is the pin nobody chose to
renew: a pilot, a dispute, a commercial trial, each reasonable when it was made
and each still silently shaping the marketplace two quarters later because
removing it was nobody's job. A standing override is available and has to be
asked for, explicitly, by passing a null.

There is no `set_merit_score` operation and there must never be one. An operator
who could type a merit score could tell a builder a number no evidence produced,
after which the signal breakdown, the confidence and the unmeasured list beside
it would all be decoration over a typed figure.

### 5. The page's shape is not part of any score

The diversity cap is applied to the ordered list, never folded into a score,
because a builder's position must not depend on who else happens to be on the
page with them — otherwise no rank can be reported, reproduced or audited.

This is also why the network scorer contains **no ordering function at all**:
the network decides what a builder and a property are *worth*, and each clone
lays out a page from those worths.

## Where each part runs

```
  NETWORK (aurixa-builders)                CLONE (prime + 3)
  ─────────────────────────                ─────────────────
  builderRanking.pure.ts       scoring
  builder-ranking-recompute    hourly run
  builder_ranking_snapshots    per builder
  builder_stock_item_ranks     per property
        │
        │  stock.item.upserted  ──────────▶  builder_network_apply_stock_ranks
        │  (payload.rank block)              (1-min sweep, monotonic by
        │                                     the rank's own computed_at)
        │                                            │
        │                                            ▼
        │                                   builder_network_stock_items
        │                                     .rank_* columns
        │                                            │
        │                                            ▼
        │                                   builder_network_stock_ranked  (view)
        │                                     + interleave bucket
        │                                            │
        │                                            ▼
        │                                   marketplaceOrder.pure.ts
        │                                     (pin splice, promoted cap)
  MISSION CONTROL ──── builders:operate ────▶ builder-network-admin
  (pin / suppress / freeze / placement)
```

**A clone computes nothing, and that is load-bearing.** A clone's mirror is a
*partial* view of the market — the stock of the builders this workspace is
connected to and no others. A clone that scored builders for itself would not
merely disagree with its siblings; it would be *wrong*, ranking builders against
a cohort with most of the market missing.

## The signals

Weights sum to 100 and are declared in `BUILDER_SIGNAL_WEIGHTS`. They are a
policy, stated in code rather than configured, because a marketplace whose
ordering can be changed without a code review is one nobody can account for
later.

| Signal | Weight | Data on 17 Sep 2026 |
| --- | --- | --- |
| Listing quality (share of stock with a drawable builder photograph) | 14 | ✅ |
| Catalogue completeness | 9 | ✅ |
| Availability kept current | 7 | ✅ |
| Stock list freshness | 10 | ✅ |
| Portfolio size | 4 | ✅ |
| Geographic spread | 3 | ✅ |
| Years operating | 7 | ⚠️ needs a declared or ABR-verified date |
| Verification and standing | 6 | ✅ |
| Responsiveness to activations | 10 | ⛔ 1 activation |
| Activations reaching a sale | 7 | ⛔ |
| Delivery record | 12 | ⛔ 0 completions |
| Price against comparable stock | 5 | ⛔ 1 builder — no cohort |
| Recorded standing | 6 | ⚠️ operator-recorded |

Four of those are dormant today. They are built, wired and read anyway, so each
lights up on its own the day the data exists rather than the day somebody
remembers to come back.

### Three signals that needed care

**Tenure cannot be read from `created_at`.** That column says when a builder
joined the network — 4 Aug and 7 Sep 2026 for the two that exist, and neither
began trading then. Reading it as "years operating" would be a fabrication and
would make every builder permanently new. So tenure is declared, and *how it is
known* travels with it: an ABR-verified registration date scores in full, a date
the builder typed is capped at `DECLARED_TENURE_CEILING` so a claim can never
out-rank a checked fact, and neither present is `not_measured`. The same rule
the join-request path already states: an ABN match is a claim, not a grant.

**Price position refuses to compare a builder to themselves.** A cohort (state ×
property type × bedroom band) must contain at least
`MIN_COHORT_ORGANISATIONS` = 3 *distinct builders* and `MIN_COHORT_ITEMS` = 8
properties before it may say anything. Below that it is `cohort_too_small`,
never "average" — which would quietly assert that a price had been compared when
it had not. With one builder holding live stock, every cohort is below the floor
today and price position is unmeasured on every property. That is the correct
answer.

The score also **saturates at both ends**. A listing 45% under comparable stock
is describing a different product, a different inclusion list or a data error;
paying it more ranking than one 15% under would put exactly the wrong stock in
front of a client.

**Reputation is recorded, never computed.** Nothing in this platform observes a
builder's reputation, and inventing a number for it would be worse than
admitting there is none. So it is an operator's recorded assessment carrying a
source and a date — constrained so a score cannot exist without both — and it
ages out of the ranking after `REPUTATION_MAX_AGE_DAYS`, because a four-year-old
assessment says more about when somebody last looked than about the builder.

## The page

Bands, not a raw builder order. A raw builder ordering would mean *every*
property of the better builder outranks *every* property of the next, so a
mediocre listing would beat an excellent one on its owner's reputation alone.
Instead the builder's band is the builder's answer and the property's own score
decides the order inside it.

The interleave is a **window function in the view**, not a pass over rows
already fetched — a cap applied to a page after the fact cannot help when the
page is already one builder's, because there is nobody on it to interleave with:

```sql
(row_number() OVER (PARTITION BY organisation_id ORDER BY …) - 1) / 3
  AS interleave_bucket
```

Ordering by the bucket first takes the best three of every builder, then the
next three of every builder. **Nothing is ever dropped**: a builder with forty
properties still has all forty, further down. On the day this was written one
builder held 43 of 43 live properties, so the cap does nothing at all — and that
is exactly the condition under which it has to be written, because the first day
it matters is the day a second builder arrives and finds page one already taken.

The divisor is written twice (SQL and `MAX_CONSECUTIVE_PER_BUILDER`) because one
of them has to be SQL. `builderMarketplaceOrder.spec.ts` reads the migration and
fails when they drift.

**Pins are spliced after the page is cut**, in `marketplaceOrder.pure.ts`,
because a pin means an absolute marketplace position — "number one until the end
of November" — so a pin at 27 must land on whichever page holds index 26. The
page is re-cut to its size afterwards so the offsets of every later page stay
true.

## What is asserted rather than assumed

Following this repository's own rule — *asserted by effect, never by
configuration* — the migrations prove their constraints bite by writing a row
and catching the violation, rather than reading `pg_constraint`:

- a `promoted` rank with `disclose = false` is refused (both ends)
- a pin with a nine-character reason is refused
- a freeze with no reason and no author is refused
- only one live override of each kind per builder
- the ranked view drops suppressed rows **and nothing else**, proved by counting
- `builder_network_apply_stock_ranks` is *called*, not merely created

All of the above were executed against PostgreSQL 16 before this was written,
along with: a stale replayed event not winding a card back, a payload naming
another builder's stock being refused, an event carrying no rank being settled
rather than rescanned for ever, an unranked row sorting at the neutral band, and
a run of five properties from one builder being broken at three with all seven
rows still present.

## Two findings this work turned up

**The stock-sync producer existed only in production.** Six functions and three
triggers compose and enqueue `stock.item.upserted` / `stock.catalog.reconciled`
on the network database; `grep -r upserted supabase/` over `aurixa-builders`
returned nothing. `scripts/db/baseline-check.mjs` rebuilds the schema *from that
directory* and asserts it matches production's catalog fingerprint, so a rebuilt
environment — a branch, a restore, a second region — would have come up with the
mirror wiring absent and every clone's marketplace silently frozen at whatever
it last received. They are captured verbatim in
`20260917095000_capture_stock_sync_producer.sql`.

**A builder's stated figures have never crossed to a clone.** The payload
composer reads `manual_stats->'bedrooms'`, while the column's own CHECK
constraint requires those figures under `manual_stats->'values'`. The top-level
keys do not exist, every lookup is SQL NULL, `jsonb_strip_nulls` removes them
all, and the result is indistinguishable from a builder who stated nothing. It
is recorded in the capture migration's header and deliberately **not** fixed
there — a capture that silently repairs what it captures is no longer a capture,
and the fix belongs in its own change with its own test.

## What the gates caught, and why the local checks could not

Six defects in this work reached CI. Each is worth recording, because none of
them was visible to anything short of the real gate, and three of them would
have shipped something broken.

**A composed select string is a row type nothing can read.** supabase-js derives
a query's row type by parsing the select *at the type level*, which it can only
do while that string has a literal type. Two forms broke it — `'a, ' + 'b'` in
the network's recompute, and `${STOCK_ITEM_SELECT.trim()}` in the clone's
projection — and both widen the template to `string`, after which the row type
degrades to `GenericStringError` and collides with every concrete row
interface. It fails *silently* wherever the row is typed `Record<string, any>`,
because `GenericStringError[]` is assignable to that: the reads that were
hardest to get right were the only ones that reported it. Both selects are
single unbroken literals now, and `builderMarketplaceOrder.spec.ts` fails on any
substitution in `RANKED_ITEM_SELECT` — with a second test asserting the
duplication that buys back cannot drift from `STOCK_ITEM_SELECT`.

**A shadowed name is a `ReferenceError`, not a type complaint.** The clone's
`list_stock` bound its unpinned rows to `const body`, which shadows the request
payload for the whole block — so the five reads of `body.search`,
`body.organisation_id` and the rest, sitting five lines into that block,
resolved to a declaration two hundred lines below them. Every marketplace read
would have thrown before composing a query. This is the class `CLAUDE.md`
already names: an identifier that does not resolve is never type debt, and a
parse check cannot see it.

**A view without `security_invoker` is an RLS bypass.** `builder_network_stock_ranked`
resolved its base tables with the *owner's* rights, so the caller's policies on
`builder_network_stock_items` never applied to anyone who could reach the view —
silently, looking exactly like a view that works. The policies on the base table
are the access rule; a sort over it must not be a way around it.

**An export with no call site is not a feature.** `explainNetworkRanking` was
written, typechecked, and described in this work's own summary as an affordance
on every row, and nothing called it — the third time this programme has shipped
that shape, after `DimensionRail`, `TitleBlock` and `bd-chip`. An unused export
compiles, lints and builds. It is mounted under the confidence figure it
explains, because that percentage is exactly what it is short for.

**A migration version is a ledger key, and it was taken.** Both halves of this
work picked a version another migration already held —
`20260917090000` against `an_activation_opens_a_project` on the network, and
`20260917110000` against `refresh_active_masters_from_library_v10` on the
clones, the latter having sat on `main` for five days before this branch
existed. One version records one ledger row, so the loser can never be told
apart from applied: it is skipped in silence, for ever. The clones have a gate
for this (`check-migration-version-collisions.mjs`); **the network does not**,
which is why its CI went green carrying the same defect.

**And the clone's migration sorted before the table it altered.** It was
numbered `20260917110000` while `builder_network_stock_items` is created at
`20261123000000` — this repo's versions run ahead of the wall clock and are
sequence numbers, not dates. On any rebuild from the repo the migration would
have run against a table that did not exist yet. It only applied during
verification because the prerequisites were applied by hand first, which is
exactly the shape of a test that proves less than it appears to. It is
`20261202090000` now, after the last migration in the tree. That gap is closed now, in all six
repositories: `check-migration-dependency-order.mjs` walks every migration in
version order and fails when a statement runs before the object it needs.
See §"The gate that was missing" below.

The two that generalise: **a string the compiler must read cannot be composed**,
and **the gate is the evidence — but only where a gate exists.** Three of these
six passed a parse check, a lint and a local build. One passed a full green CI
run on the network, because the network had no collision gate. And the ordering
fault would have passed every gate every one of these repositories owned.

Both of those holes are closed: the collision gate is ported to the network
with an empty baseline, and the dependency-order gate below now runs in all
six — the four deployments, the network and Mission Control.

## The gate that was missing

The ordering fault above was found by reading a directory listing. Nothing in
any of these repositories could have found it, because every migration gate
here reads one file at a time and that fault is in the ORDER of two.
`check-migration-dependency-order.mjs` is the gate that closes it, in all six
repositories: `scripts/security/` on the four deployments, `scripts/db/` on the
network and `scripts/` on Mission Control, each following where that repository
already keeps this kind of script.

**What it judges.** Every migration in version order, against a timeline of
CREATE and DROP events built from the whole corpus. A statement that needs an
object not live at that point is a finding, carrying the file, the line, the
form of the reference and the migration that creates it later.

**Liveness, not first creation.** An object dropped and recreated is absent in
between, so events carry offsets and are compared within a file as well as
between files — which is what makes the idempotent `drop … if exists` followed
by `create`, most of this corpus, resolve correctly.

Two rules keep it usable, and both are about refusing to judge:

**A PL/pgSQL body is not a reference.** It is stored as text and resolved when
it RUNS, not when the function is created, so a body naming a table a later
migration creates is correct and ordinary. Bodies of any dollar-quote tag are
stripped before anything is read, along with comments and string literals.
Without that, every real finding drowns.

**An object no migration creates is unjudgeable, never absent.** These
migrations are not the only thing that has ever created an object in these
databases — six functions and three triggers ran in production with no file at
all until `20260917095000` captured them — so silence about an object means
the gate cannot say, and it says nothing.

**Every semantic rule was measured, not recalled.** The first version assumed
`drop policy if exists p on t` required `t`. It does not: the guard covers the
relation, not just the policy, and that single assumption produced 88 findings
on this corpus, every one of them wrong. `alter table if exists` behaves the
same way. Thirteen forms were probed against PostgreSQL 16 and the eleven that
genuinely require are the ones counted — `create policy`, `create trigger`,
`create index … on`, `alter table`, `references`, `insert`/`update`/`delete`,
`grant … on`, `comment on`, `alter sequence`, `alter type`, and a view body,
which IS resolved as the view is created.

**It is a ratchet.** Thirty-three findings are frozen on the clones and none on
the network: six 2025-01 RLS and rollback files whose own headers record that
they could never have run, plus two genuine 2026 ordering faults
(`aml_screening_repair` against `aml.party_screening_subjects`, and an index on
`workflow_trigger_events`). A frozen finding that stops firing fails too, so
the baseline cannot only grow.

It was checked in all three directions before being trusted: silent on the
corpus, failing with file and line when the real defect is reintroduced, and
failing when a frozen entry goes stale. The spec was checked the same way —
breaking the body stripping, or the `if exists` rule, each fails it.

## Operating it

- **Recompute** runs hourly (`builder-ranking-recompute-hourly`, minute 7).
  Nothing it reads moves faster than that, and a tighter schedule would spend an
  outbox delivery per property per run to say so.
- **A rank only travels when it would change the page** — the band, the
  placement, the disclosure, or the item score by ≥ 2 points. At 43 properties
  an unconditional announcement would be 1,032 events a day to say almost
  nothing.
- **A run lands whole or not at all.** Reads go through `readAllRows` (which
  reports `failed` rather than a truncated page), and the write is a single
  `builder_ranking_apply` call, so a failure never leaves half the fleet on one
  run's bands and half on the previous run's.
- **Freezing holds the published order still.** It does not fall back to a
  default ordering: a marketplace that reshuffles the moment something goes
  wrong is a second incident on top of the first.

## Before it does anything

The ranking is inert until three things are true, and each is deliberate rather
than pending:

1. The migrations are applied (network, then the prime and its three clones).
2. `builder-ranking-recompute` is deployed and its cron job exists.
3. A builder has something to be ranked on. With one builder holding live stock,
   the first run will produce one snapshot at low confidence, every cohort-based
   signal unmeasured, and an order indistinguishable from today's — which is the
   honest answer, not a failure.

To give tenure and standing something to read, set `established_on` (or
`abn_registered_on` + `abn_verified_at`) and `reputation_score` on
`builder_organisations`. Until then both read `not_measured`, which costs a
builder nothing.
