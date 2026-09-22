# What a report may state about approved dwelling supply

Read this before touching
`_shared/reports/market/openData/absBuildingApprovals.pure.ts`,
`_shared/reports/market/openData/absDataStructure.pure.ts`,
`_shared/reports/market/approvalsFactBlocks.pure.ts`,
`_shared/reports/market/approvalsRegisterRead.ts`, the `approvals` stage in
`market-sales-ingest`, or `scripts/market/abs-approvals-liveness.ts`.

## 1 · The finding

Supply is asked for by name in three prompts and was answered by no register.
The statewide report's section 9 carries

> `**Supply Pipeline Risk:** [New housing supply vs demand balance]`

— a bracketed slot with nothing behind it — its section 10 asks for hotspots
with a `Growth Forecast` column, and the Compass's strategic tier declares a
whole section, *Market Position, Competitive Landscape & Supply Pipeline*. The
only development evidence this platform held was **one state's**
development-application register.

That is exactly the shape `PLANNING_CONTROLS_IN_THE_REPORT.md` records: a
template slot, handed to a model with nothing to fill it from, **filled by the
model**. There was no reason to expect supply to have gone better than zoning
did.

ABS Building Approvals is the one free, keyless, national, sub-state, monthly
measure of approved dwelling supply, under CC BY 4.0. It is the floor beneath
every jurisdiction, exactly as `RES_DWELL_ST` is the floor beneath every price
series.

## 2 · Nothing about it is guessed

Three things are read from the publisher rather than typed, and each is a
defect this programme has already paid for once:

| What | Read from | Why not a constant |
| --- | --- | --- |
| The dataflow | the ABS's own catalogue | the version is part of an SDMX identifier and the ABS reissues it; a stale constant 404s in a way that reads exactly like an outage |
| The edition | the catalogue's own names | the Bureau publishes one flow per edition, not one per subject |
| The query key | the flow's own data structure | an SDMX key is POSITIONAL, and one typed against the wrong positions returns a plausible, wrong slice under an HTTP 200 |

The last one is the mistyped Airtable column with a success code in front of
it, which is why it is the one that most needed reading rather than assuming.

## 3 · What the Bureau actually sends

Measured from a CI runner, 21 Sep 2026. The development egress cannot reach
`data.api.abs.gov.au` — the gateway answers **403 to CONNECT**, and prints
*"Host not in allowlist"*, which is how the check tells a gateway's refusal
from the Bureau's — so every number here is `abs-register-liveness`'s.

```
SA2, 12 months   200    490.8 MB   60.0 s   DID NOT FINISH
SA2, 36 months   200   5045.4 MB   60.1 s   DID NOT FINISH
LGA, 12 months   200     61.8 MB    1.6 s   complete
LGA, 36 months   200     61.8 MB   10.0 s   complete
```

Four things follow, and three of them were surprises.

**`/all` at the finest grain cannot be carried.** An edge function has a
~150 s wall clock; the SA2 download was past five gigabytes and still running
after sixty seconds.

**The window is not the lever.** The two LGA windows are byte-identical, and
the reason is not that the ABS disregards `startPeriod` — it is that
`BA_LGA2026` holds **one month** (2026-07). Shrinking a period cannot shrink a
cube that is wide rather than long.

**The history is in the PRIOR edition.** `BA_LGA2025` answered 470.8 MB from
2025-01 and 528.0 MB from 2023-01, neither finishing. So `currentEdition`
picks the newest *boundary* vintage, which is exactly the edition with the
least *series* behind it — the rule biting from the far side of the one it was
written for. `BA_SA2,2.0.0` ("from July 2021 onwards") has no edition problem
at all, which is one more reason the finest grain is the one worth making
work.

**The download is the whole cube.** Every building type — hotels, shops,
factories, offices, health, education — every measure, and all three series
estimates, of which this register keeps Original estimates of three
residential types on two measures. We were paying to transfer what we then
discard, which is what makes narrowing the source the lever the window is not.

## 4 · Four rules the register holds

**An approval is not a completion.** The ABS counts approvals; a dwelling
approved is not commenced and a dwelling commenced is not finished.
`APPROVALS_ARE_NOT_COMPLETIONS` carries that into any prose quoting a figure,
and it is `infrastructureEvidence`'s rule — an approval is never read as
funding, funding never as a start on site.

**A region download is a HIERARCHY, so the grain is the ROW's.** *"Building
Approvals by SA2 **and above**"* means what it says. The first ceiling was
written for a council area and refused the Bureau's own download over
`Australia 2026-07 reads $22,314,955,000` — an ordinary national figure. Every
fact in that refusal was correct and the conclusion was wrong. The grain now
comes from the publisher's own area code and the ceilings are per grain, an
order of magnitude above the real figures, because they detect a changed
`UNIT_MULT` or a moved column rather than ranking areas. The consequence
reached further than the refusal: stamping every row with the *requested*
grain files the national total as a council area, and the read path would have
served Australia's monthly approvals as one suburb's supply.

**A total summed from part of a register is a FLOOR and says so.**
`DA_REGISTER_RECONCILIATION.md` paid for that rule once. A twelve-month window
states how many of its months carried a figure, an incomplete window's total
is labelled a floor, and a year-on-year change is computed **only between two
complete windows** — comparing a floor with a floor produces a percentage that
describes the gaps rather than the market, and it arrives looking exactly like
a measurement.

**An absence may not be rated.** Not Low, not Limited, not Constrained — and
not Strong either, because a rating drawn from the coverage of a search is a
statement about the search (`PLANNING_CONTROLS_IN_THE_REPORT.md` §9).

## 5 · The four absences are four different sentences

`approvalsRegisterRead.ts` answers with a reading or with a named absence, and
which one it is decides what the document says:

| Absence | What it is a statement about |
| --- | --- |
| `not_loaded` | this deployment — the register has never been loaded at that grain |
| `none_for_area` | the area — the register holds rows at that grain and none for it |
| `unavailable` | ours — the read itself failed |
| `no_area_resolved` | the subject — no trusted geography to ask with |

The call site used to derive this from `planningFacts.council ? 'not_loaded' :
'no_area_resolved'` — a stand-in for a question nothing had asked, which would
have told a reader the register was unloaded on a deployment where it was
loaded and simply held nothing.

Two further rules on that read. **Only a TRUSTED geography may select a
reading** — the fields are named for the authority behind them
(`trustedSuburb`, `cadastreLga`), because a field called `suburb` invites a
typed one and choosing the wrong council describes somebody else's market
under this property's address. And **the finest grain that answers wins and
the grain travels**: SA2, then council, then state, with `national`
deliberately not on the ladder, because Australia's monthly approvals printed
beside one address is the benchmark-read-as-the-suburb defect
`MARKET_FIGURES_IN_THE_REPORT.md` records.

## 6 · Narrowing the query

`composeApprovalsKey` builds the SDMX key from the flow's own data structure.
Four rules:

* **the codes are chosen by NAME, with the rules the parse reads by** —
  `BUILDING_TYPE_PATTERNS`, `UNITS_MEASURE`, `VALUE_MEASURE`,
  `ORIGINAL_SERIES` and `MONTHLY_FREQ` are imported rather than restated, so
  asking for what we keep and keeping what we asked for are one declaration;
* **the area dimension is never narrowed**, enforced rather than intended — a
  register narrowed by area is a register about somewhere else, and it would
  answer 200;
* **a rule that matches no code narrows nothing** — the position is left open,
  the whole dimension comes back and the parse filters it as it always has: a
  download bigger than it needed to be, never one missing rows, with the
  unnarrowed dimensions recorded because a silent widening is a byte count
  nobody reads;
* **a structure that cannot be read costs nothing** — the fallback is `/all`,
  which is what shipped.

The key covers the dimensions **other than time**. A slot for `TIME_PERIOD`
shifts nothing visibly and makes every position after it mean a different
dimension.

### The defect writing it found

`UNITS_MEASURE` was `/number of dwelling units|dwelling units|^number\b/i`,
and the cube publishes `Number of buildings` on the same measure dimension. A
block of forty flats is one building and forty dwellings. Because the row key
is `(area, period, building type)`, a building count did not merely leak in —
it **overwrote** the dwelling count for that month whenever it was read
second. Nothing caught it because the fixture published two measures and the
cube publishes three: it was invisible until the *query* had to enumerate what
the publisher actually offers.

## 7 · The check is the instrument

`abs-register-liveness` runs on every CI build, before anything is merged,
deployed or scheduled. It writes nothing anywhere — no database, no
credential. Its exit code is the whole design:

* **the ABS being unreachable exits 0.** A compliance product cannot have its
  build decided by somebody else's uptime — `PEP_SCREENING_ENGINE.md`'s rule.
  The refusing party's own words are printed, because this cannot tell the
  Bureau's 403 from an intermediary's, and a runner behind an allowlist would
  otherwise make the whole gate a placebo that exits 0 having reached nothing.
* **the ABS answering and this reader refusing exits 1.** That is the reader
  being wrong about the publisher, which no synthetic fixture can catch.
* **a download nobody can carry exits 1.** The first version printed *"THE ABS
  DID NOT ANSWER"* and exited 0 over an HTTP 200 that arrived in 6.4 seconds
  and then sent four minutes of body. A size problem on our side reported as
  an outage on theirs is a green build standing over a thing that does not
  work.

It has found a real defect on every run it has made: discovery refusing the
Bureau's own catalogue, a ceiling refusing a correct national figure, an
edition holding one month, and a measure rule admitting building counts.

## 7a · A download's feasibility is a property of the DOWNLOAD

The check's first criterion for "can an invocation carry this" was *finished
inside the edge budget*. On 21 Sep 2026 a runner produced

```
SA2, 12 months   200   3765.2 MB   13.2 s   291404 KB/s   complete
```

— three and three-quarter gigabytes, complete, in thirteen seconds, because
that runner had a 291 MB/s pipe — and the criterion called it workable. It
was measuring GitHub's bandwidth.

That is this programme's own recurring failure wearing a new costume: a green
measurement standing for a thing that does not work. The bound is now a
**size** (`EDGE_BYTE_CEILING`, 24 MB of CSV), the elapsed check stays only as
a floor under a transfer that is small but pathologically slow, and a window
that completes over the ceiling reports *"complete, but N MB — PAST THE
CEILING"* rather than "complete".

The same measurement settles the SA2 question by completion rather than by
inference: `/all` at SA2 grain for twelve months **is** 3,765 MB. Not "at
least"; that is the size.

Two honest limits on the ceiling itself, both stated in the code. It is
**derived, not measured** — `await res.text()` holds the body as UTF-16 and
`parseSdmxCsv` builds an object per row before anything is filtered, so peak
is several times the wire size against a 256 MB isolate. And **memory is not
something CI can weigh**: this instrument measures transfer from a runner, so
a green run proves the download fits the constraint the check can see, and
not that the parse fits the one it cannot.

## 8 · What narrowing bought, and what is left

Measured across four CI runs on 21 Sep 2026, against the Bureau's own bytes:

| Query | SA2 | LGA |
| --- | --- | --- |
| `/all` | 8,307 MB | 61.8 MB |
| MEASURE + BUILDING_TYPE + FREQ | 1,798 MB | 8.0 MB |
| + SECTOR + WORK_TYPE + REGION_TYPE | **111.6 MB** | — |

Seventy-four times smaller at the finest grain, and the ceiling an invocation
can hold is 24 MB. So SA2 still has to be loaded in several requests.

**It pages by PERIOD, not by state**, and the first version of this section
said the opposite. The reasoning was that the SA2 code's leading digit is its
state — which is true, and is how `stateOfAreaCode` labels a row, and is
useless for ASKING: an SDMX key selects exact codes, so requesting one
state's SA2s means enumerating three hundred of them in a URL. A period is
two parameters whatever the geography, so `narrowedApprovalsUrl` takes an
`endPeriod` and 4c measures how small a window has to be before it fits.

That correction is the same rule the rest of this document is about, paid
again by its own author: naming a lever is not the same as having measured
it. `market-sales-ingest` has been staged one heavy read per invocation since
the DCJ workbooks exhausted an edge worker's compute allowance
(`OPEN_DATA_GROWTH_EVIDENCE.md` §10), so several requests is a known shape in
this loader either way — but which axis they page on was a guess until
measured.

Measured:

| SA2 window | Bytes | |
| --- | --- | --- |
| 33 months | 111.6 MB | past the ceiling |
| 12 months | 26.0 MB | past the ceiling |
| **6 months** | **10.4 MB** | **workable — 8 requests for the full span** |

### And a narrowing that was a bet, not an optimisation

`REGION_TYPE` was narrowed to `AUS+STE+SA2+LGA` for exactly one commit, on
the sound-looking argument that the flow offers forty-three ASGS levels and
this register stores four. It turned the LGA flow's working 8.0 MB download
into **9,818 bytes carrying eight states, one national row and not a single
council**, refused by the area floor. `AUS` and `STE` answered; `LGA` did
not, because **a code that names a level in a codelist is not necessarily the
code the DATA is tagged with.**

It is dropped. Every other rule here is a CORRECTNESS narrowing — without it
rows collide and the register stores an arbitrary slice as a total — while
that one was purely a SIZE narrowing, and size is solved by `endPeriod`. It
failed the module's own standard: *a narrowing is an optimisation and must
never be a dependency.* One that can silently exclude the data you came for
is not an optimisation.

Left open, every level comes back and the parse files each row by its own
area code, so one download fills every grain the register stores.

### The four defects narrowing exposed

Every one was a pattern written against an imagined vocabulary meeting the
vocabulary the publisher actually has, and every one was invisible while the
reader only had to ACCEPT what arrived:

| Pattern | Written for | What the cube publishes |
| --- | --- | --- |
| `^number\b` | dwelling units | also `Number of buildings` — one building, forty dwellings |
| the requested grain | councils | councils AND states AND Australia, in one body |
| no SECTOR / WORK_TYPE rule | one figure per key | three sectors × nine work types = 27 |
| `^total$` | total residential | `Total` = all buildings, including factories and offices |

The third produced a wrong figure on live data and it is the one to remember:
the Bureau's LGA download gave **$14,857,000 and then $45,670,000 for Greater
Bendigo 2026-07 total residential**. Three times wrong, and indistinguishable
from a correct figure by looking at it.

`assertNoCollision` catches that class by its EFFECT — a second, different
figure for a key that already holds one — rather than by enumerating the
dimensions a publisher might add, because enumerating is precisely the bet
that lost over `Number of buildings`. An identical repeat is not a collision;
only a disagreement refuses.

### A key belongs to the flow whose structure composed it

The check itself then committed the same class one level up: it composed one
key from the chosen flow and measured BOTH grains with it, producing an LGA
download of 9,818 bytes carrying eight states, one national row and not a
single council. The SA2 flow's `REGION_TYPE` codelist is not the LGA flow's,
and a code that means one thing in one document means nothing in another. The
loader was never wrong — it reads and queries the same flow — so this was the
instrument measuring itself, for the third time (after the runner-bandwidth
criterion and the hard-coded namespace prefix).

### How the loader pages

One page per invocation, **newest first**, in `absApprovalsPaging.pure.ts`.

The frontier is READ from the register, never assumed. The ABS publishes
with a lag — a six-month window asked on 21 Sep 2026 returned four months, to
2026-07 — so page 0 asks forward from today and **whatever comes back defines
the frontier**, with no floor, because the lag belongs to the publisher.
Every later page steps back a whole window from that frontier, lies wholly in
the past, and must therefore be FULL: short means truncated, and refuses.

That is the same move as reading the dataflow from the catalogue and the key
from the structure — the loader learns the lag from the Bureau instead of
carrying a constant nobody here can verify and the Bureau can change without
telling us.

A run reports `page`, `page_window`, `page_judged_against`, `frontier_before`
and `pages_remaining`, so an operator reads what is left rather than working
it out. The floor is `2023-01`: two years is what a year-on-year reading
needs and what `approvalsFactBlocks` reports on, plus a margin for revision.

### Still not measured

**Memory.** `EDGE_BYTE_CEILING` is derived from a 256 MB isolate and the
shape of the parse, not weighed, and CI measures transfer from a runner. A
green run proves the download fits the constraint the check can see.

**And nothing writes to `market_building_approvals` on any deployment.**
Until something does, every report reads **Not searched.** and is forbidden
from stating a figure, which is `CLONE_PROVISIONING_GAPS.md`'s rule applied
before the gap exists.

## 11 · The register is loaded — and the page bound was measured on the wrong axis

Applied and loaded 22 Sep 2026, and every step of it was verified by effect
rather than by the success of the thing that performed it.

**The shipping order bit first.** `20261213000000` (the table) and
`20261213010000` (the 17:45 UTC refresh) applied cleanly, both `@effect`
probes satisfied — and the first ingest answered **HTTP 400 in five
milliseconds**, because the deployed `market-sales-ingest` was `main`'s and
`main`'s copy contained **zero** occurrences of `approvals`. Measured three
ways: the edge log, `main`'s source, and the live bundle (version 167, zero
`approvals`). The schema had landed and the loader had not. **A register's
migration and the function that fills it have a shipping ORDER and it is not
interchangeable** — `CONTAINER_RELEASE.md` holds the same rule for the
WeasyPrint image and the render routes. Left to the schedule this would have
failed at 03:45 nightly while pg_cron reported green, which is
`SCREENING_EXECUTION.md`'s rule: **a green cron run is not a delivered
request.**

After the merge, the deploy was checked the same way rather than on its own
tick — which matters, because that workflow's header records it reporting
green while shipping nothing, twice: version **167 → 168**, `approvals`
occurrences **0 → 41**, bundle 222 KB → 311 KB.

**Then the real failure, and it is the interesting one.** The next run got
past the 400 and died at **546**, the edge worker's resource limit:

```
approvals: ABS,BA_SA2,2.0.0 key=1+2.9.TOT.110+150+100...M page=0 2026-04→2026-09
POST | 546
```

Two of the three steps that had never run against the real publisher
therefore WORK: the dataflow was **discovered** (`ABS,BA_SA2,2.0.0`, the
finest grain published, which is what the scorer prices) and the **positional
key composed** from the flow's own data structure. Those were the two most
likely to fail silently as a plausible wrong slice under a 200.

The cause was `APPROVALS_PAGE_MONTHS = 6`, set from a CI measurement of the
Bureau's **bytes** (6 months = 12.2 MB against "a 24 MB budget"). The worker's
limit is on the resources needed to **process** them, and the stage holds all
of it live at once — the whole body as one string, then every row as an
object, then the upsert payload. Re-measured in the worker using the explicit
operator window the stage already accepts:

| window | rows | answer |
| --- | ---: | --- |
| 1 month | 5,814 | 200 |
| 3 months | 17,442 | 200 |
| 6 months | ~34,884 | **546** |

5,814 rows a month, dead flat (17,442 is exactly 5,814 × 3), so the cliff lies
between 17,442 and ~34,884 rows. The constant is **3**, the largest PROVEN
window; 4 and 5 are deliberately not taken, because an unmeasured edge fails
as a nightly 546 that pg_cron calls green. A walk of the 33 months the Bureau
holds is eleven nightly pages.

Three rules come out of it. **A bound must be measured on the quantity that
binds** — bytes over the wire answered a different question from resources to
process, and the smaller number was the one measured. **Two points bracket a
cliff; one point picks a number and calls it a measurement**, which is why the
bound was probed at 1 and 3 rather than divided by something plausible. And
**a spec states the rule, not the number**: three assertions had the
six-month arithmetic written out as literals, so they are derived from
`APPROVALS_PAGE_MONTHS` now — a spec restating the page size in two places is
how the two come to disagree.

**What is loaded and what is still unchecked.** `market_building_approvals`
holds 17,442 rows for 2026-05 → 2026-07 at SA2 grain and
`market_sales_sync` recorded both deliveries. The distribution across
`area_kind` is **not** yet confirmed: the ABS download is a hierarchy, each
row must carry its OWN grain, and filing a national total as a council area
is the one failure a row count cannot see. That needs a `group by area_kind`,
which the direct-SQL restriction does not admit, so it is recorded here as
outstanding rather than assumed good.

## 12 · The grain was read back, and two levels of the hierarchy were mislabelled

§11 closed with the `area_kind` distribution recorded as unverified, because a
`group by` is arbitrary database access and this deployment's standing
restriction does not admit it. It is verified now, through the route that is
admitted: the read travels as a migration through the reviewed workflow and
the answer comes back as a `raise warning` in `postgres_logs`, which is logged
at Supabase's default level where `notice` is not. That file writes nothing.

```
APPROVALS_READBACK total=17442
  by_kind=[lga=2064, national=6, sa2=15324, state=48]
  distinct_areas=[lga:344, national:1, sa2:2554, state:8]
  periods=[all four kinds 2026-05..2026-07]
  dwelling_units=[null=0 zero=4893 positive=12549]
  samples=[lga code=10102 len=5 area=Queanbeyan | national code=AUS area=Australia
           sa2 code=101 len=3 area=Capital Region | state code=1 area=New South Wales]
```

**The half that works.** The hierarchy IS stamped per row rather than per
request — four grains present, `AUS` correctly under `national`, eight states
under `state`. The catastrophic version this section was written to prevent, a
national total filed as a council area, did not happen. The row arithmetic is
exactly consistent too: 2,554 × 3 months × 2 measures = 15,324, and the same
for every kind, so nothing is double-counted or half-written.

**The half that does not.** An ASGS SA2 code is nine digits. `101 / Capital
Region` is an **SA4** and was filed `sa2`; `10102 / Queanbeyan` is an **SA3**
and was filed `lga`. The SA2 hierarchy has five levels — SA2 (9 digits), SA3
(5), SA4 (3), state (1), `AUS` — and `area_kind` has four values, so two
levels had nowhere correct to go:

```ts
if (/^\d{5}$/.test(trimmed)) return 'lga';   // catches every SA3
if (/^\d{9}$/.test(trimmed)) return 'sa2';
return requested;                            // catches every SA4
```

**`return requested` called itself the conservative side and is its
opposite.** The requested grain is the FINEST grain in the download, so an
unreadable code defaulted to the strongest claim available — a
250,000-person SA4 served as one suburb's approved supply. Three rules come
out of it.

**A fallback to the request is a fallback to the strongest claim.** In a
hierarchy download the requested grain is the finest, so "when in doubt, use
what was asked for" resolves every ambiguity in the least conservative
direction available. An unreadable code is `unknown` now and is refused.

**A collision is settled by the download, not by the code.** An ABS LGA code
is five digits and so is an SA3 — genuinely ambiguous from the code alone. The
hierarchies do not overlap, though: an LGA download is LGA → state → `AUS` and
carries no SA3, an SA2 download carries no LGA. So `requested` disambiguates
exactly that one case, which is the only legitimate use it has here.

**A plausibility ceiling written for unit drift cannot police grain.**
`ABS_BA_PLAUSIBILITY` says so in its own comment — the bounds detect unit
drift "rather than ranking areas" — so an SA4's figure sits far inside an
SA2's 20-billion-dollar ceiling and the guard passed it without complaint.
It was never the wrong guard; it was the wrong question to ask of it.

A grain with no column is **counted and declined** rather than bent into one
that fits (`refusedByGrain`), and a body that is all hierarchy now says so:
*"refused for want of a column: 1 sa3, 1 sa4"*. Before this it would have read
*"no row this loader recognises (0 skipped)"*, which sends an operator hunting
a parse fault over a body that read perfectly.

**The cleanup deletes by SOURCE, not by rule.** `20261215030000` removes every
row the SA2 flow wrote — not the rows a restated grain predicate would
select — because a DELETE whose WHERE clause re-implements
`grainOfAreaCode` is the two-ends-drift defect this programme records against
`riskRegisterInstruction` and `strategySectionRules`. The register is a pure
projection of a public download, so clearing and reloading costs nothing but a
reload, and the empty interval is the designed degradation: `Not searched`,
with every report forbidden from stating a figure. **It must not be applied
before the corrected parser is deployed** — against the old one the nightly
reload rewrites exactly what it deleted, and the register ends where it
started while looking repaired.

## 13 · The walk advances — confirmed by effect, in production

§11 and §12 each ended with a register that was *loaded* and *correctly
grained*, and both readings were about a single three-month window. The
question §12 left open is the one that matters for a reader: **does the
register get deeper, on its own, for ever?**

`ABS_BA_PLAUSIBILITY.minPeriods` is 24 for a year-on-year reading and the
publisher holds three months ahead of its own two-month arrears, so a register
that only ever asks forward from today can never reach twenty-four — and that
is exactly what the code did. `pagesToCover` was computed, logged and read by
nothing. The walk had no walker.

`planApprovalsWork` is the walker, and it decides from the register's own two
edges: nothing held → the frontier window; a frontier not read this calendar
month → the frontier window again (currency as a **cadence**, not a
comparison, because a comparison against a publisher two months in arrears is
always true and would never let the backfill run — the defect the first
version of this rebuilt); depth still owed → the window immediately below
`oldest`; otherwise **`settled`**, which writes a sync row and asks the ABS
nothing.

### The measurement

The refresh moved from `45 17 * * *` to `20 * * * *` at 08:58 UTC on
22 Sep 2026, and nothing else changed.

| | 08:59 | 09:24 (tick 1) | 10:24 (tick 2) |
| --- | --- | --- | --- |
| rows | 4,934 | **19,736** | **34,538** |
| periods | `2026-07..2026-07` | **`2026-04..2026-07`** | **`2026-01..2026-07`** |
| distinct SA2s | 2,458 | 2,458 | 2,458 |
| `dwelling_units` | null=0 · zero=1,606 · positive=3,328 | null=0 · zero=6,377 · positive=13,359 | null=0 · zero=11,588 · positive=22,950 |
| grain samples | `sa2` len 9 · `state` len 1 · `AUS` | unchanged, no `lga` bucket | unchanged, no `lga` bucket |

`oldest` moves back **exactly `APPROVALS_PAGE_MONTHS` per tick**, twice, with
row growth linear (+14,802 each time) and the grain distribution unmoved.

And the planner said what it was doing **before** it did it, in
`function_logs` at 09:20:03:

```
[market-sales-ingest] approvals: ABS,BA_SA2,2.0.0 key=1+2.9.TOT.110+150+100...M
                      page=0 2026-04→2026-06 frontier=2026-07
```

`2026-04→2026-06` is the window immediately below `oldest`, against a frontier
of `2026-07`. `oldest` moved by exactly `APPROVALS_PAGE_MONTHS`. **This is the
first time this register has ever deepened.**

### The second tick proved the half the first could not

At 10:20:03 the planner chose `2026-01→2026-03`, still against
`frontier=2026-07`:

```
[market-sales-ingest] approvals: ABS,BA_SA2,2.0.0 key=1+2.9.TOT.110+150+100...M
                      page=0 2026-01→2026-03 frontier=2026-07
```

Two things are asserted by that line and neither is assertable from one tick.
**The walk is not a one-off**: a second consecutive run took the window below
the new `oldest` rather than repeating the first. And **it did not re-read the
frontier**, which is the rule that nearly went in backwards.

The first version of `planApprovalsWork` tested currency as
`asOf > frontier` — always true against a publisher two months in arrears, so
every run would have spent itself re-reading the same three months at the top
and the backfill would never have executed. That is the defect this module
exists to remove, rebuilt inside the fix for it. Currency is a **cadence**
instead: `frontierLoadedAt` is the newest row's own `loaded_at` truncated to
its calendar month, so the frontier is read once a month and every other tick
is depth. Two ticks in one hour, one frontier read between them, is that rule
working.

Twelve more ticks reach the `2023-01` floor, at which point `planApprovalsWork`
answers **`settled`**, writes a `market_sales_sync` row and asks the ABS
nothing — which is the other end of the guarantee and the next thing worth
reading back.

Two things that reading is deliberately NOT:

- It is not a green cron run. pg_cron reports on the SQL that queued the HTTP
  call, and `market_sales_refresh` uses `net.http_post`, which is
  asynchronous — so the honest signals are the function's own log line and the
  register's period range, and both were read.
- It is not a configuration check. Nothing here asserts a schedule, a page
  size or a planner branch. The claim is that `min(period)` moved, and the
  claim is made by reading `min(period)`.

### What the section reads today, and why it is honest

Four of a twelve-month window are loaded, so `windowOf` reports
`monthsCounted: 4`, sets `floor: true`, and `summariseApprovals` returns
`changePct: null` — a year-on-year change is computed **only** between two
complete windows. Rendered:

> | all residential dwellings | 46 | $23,550,000 | Aug 2025 – Jul 2026 |
>
> The publisher has released **4 of the 12 months** in that window for this
> area, so each total above is a FLOOR — the true figure can only be higher.
>
> No year-on-year change is stated: that comparison is made only between two
> complete twelve-month windows, and one of these two is short.

Three more ticks reach Aug 2025 and `floor` goes false; the comparison becomes
available at twenty-four months. Nothing about the page changes when it does,
because the qualification is derived from what is held rather than declared.

### The render is what found the next defect

That block was rendered against the register's real depth rather than a
fixture, and its money column printed **`$NaN`** — see §"absent is never
zero" in the commit *"A supply figure that is not a figure never reaches the
page"*. `windowOf`'s guard was `m.value !== null`, `undefined !== null` is
true, `0 + undefined` is NaN, and `NaN === null` is false, so it survived
every downstream absence check and reached the formatter.
`approvalsRegisterRead`'s own mapping had the same shape. Both now admit only
what `Number.isFinite` admits.

**The lesson is §7's, again: read what the page draws, not what the module
returns.** A register that is loaded, correctly grained and deepening on
schedule was one narrower `select` away from printing `$NaN` to a client, and
no test in the suite could have seen it — because every fixture spelled the
column correctly.
