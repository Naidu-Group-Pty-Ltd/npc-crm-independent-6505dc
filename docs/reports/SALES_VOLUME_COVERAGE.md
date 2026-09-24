# Sales counts, and the four jurisdictions Demand cannot score in

**W3.5 — closed 23 September 2026.** Read-only discovery. Nothing here
writes to a register, and the answer is that nothing needs to: none of the
four jurisdictions publishes a sub-state count of residential sales (§4).

This records what was asked, why it is asked that way, and what the
publishers answered. It exists because loading a series is a register
**write** — a migration plus an ingest stage — and that boundary is not
crossed without asking; asking the publishers is not.

---

## 1. The gap, stated precisely

`scoreTransactionVolume` is the only **primary** demand measure this
deployment is entitled to. The other three — rental tightness, sale urgency,
absorption — come from vendor feeds nobody here holds, which is what a
Domain 403 leaves behind. It needs `VOLUME_BASELINE_PERIODS + 1` = **four**
periods carrying a count before it will believe a baseline.

Where the register stands, read from the loaders on 22 September 2026:

| | area | how a count arrives |
| --- | --- | --- |
| NSW | postcode, LGA, state | a count with **every** period |
| QLD | LGA | a count with **every** period |
| SA | suburb | **two** counted quarters per release, accumulating |
| VIC | suburb | **one** per workbook, four recovered from the archive by `vicVolumeBackfill` |
| WA | state only | **none** — `absResDwell`, `salesCount: null` |
| TAS | state only | none |
| NT | state only | none |
| ACT | state only | none |

So all four of ACT, NT, TAS and WA have a **growth** reading and none has a
**demand** one, and the missing thing is specific: not a median, not a price,
not an area — a **count**, over four periods, somewhere finer than the state.

`VOLUME_COUNT_SOURCE` records that table in code, and a spec asserts it
against the loaders themselves rather than trusting it — because
`market-sales-ingest` has already lost a jurisdiction's counts once, by
writing `sales_count: null` into `ON CONFLICT DO UPDATE SET` on every daily
run.

---

## 2. The trap: the easy success

Every one of these four jurisdictions publishes something called "property
sales", and all four already hold a price series at state grain. So the easy
and wrong outcome is to find a sales dataset, report the gap closed, and
change nothing — a second price series satisfies none of what
`scoreTransactionVolume` needs, and it would look, from a dashboard, exactly
like a fix.

`judgeVolumeDataset` therefore asks whether **the publisher says a count is
in it**, judged on the title, the notes and the resource names together — a
title alone is a headline (`Property Sales` tells you nothing), and the notes
are where a publisher lists its columns.

`COUNT_PATTERN` is deliberately narrow. It does not match `median`, `price`,
`value`, `free` or `open data`, for the same reason `OPEN_LICENCE_PATTERN`
refuses them: a service that is free to call is not one whose data may be
republished, and a dataset that mentions sales is not one that counts them.

And the two near misses get their **own readings**, not a find:

- `medians_only` — sales data exists and states prices, not counts.
- `state_grain_only` — a count exists and describes the whole jurisdiction,
  which the ABS series already does.

`SUPPLY_EVIDENCE.md`'s rule — four absences are four different sentences —
with the two ways this could have been mistaken for a success named rather
than collapsed.

---

## 3. An absence is corroborated or it is not claimed

Each jurisdiction is asked of its **own** catalogue and of `data.gov.au`,
which harvests the states and which this repository has already measured
answering from CI (`national-pipeline-liveness`). Two endpoints that fail
differently — W3.2's rule, which that probe paid for twice.

Free text is used to find a **candidate** and never to prove an absence.
That is the half of W3.2's lesson that still holds: a relevance query is not
a filter, so an absence read off one ranked page establishes nothing. There
is no organisation slug to filter on here either, because the publisher of a
sales series is a valuer-general or a revenue office whose slug nobody here
can verify, and typing one would fail exactly like an absent one.

### 3.1 A harvest hit is not a statement about a jurisdiction

**The probe's own first run got this wrong, and the log is what caught it.**

It read **`countable` for the Northern Territory over "datasets examined
0"**, and the sentence it composed named *"Guide to Property Values, from
**Department of Energy, Environment and Climate Action**"* — a **Victorian**
department. Western Australia read `countable` the same way over 201 datasets
of which **0 carried a count**, and named the same Victorian dataset.

`mergeVolumeReads` had folded the harvest catalogue's datasets into the
jurisdiction's own, and the assessment then ranked whatever it found. A
harvest indexes every publisher in the country, so a hit inside it is a
statement about the harvest — which this module's own header said in those
words while the code did the opposite.

The output contradicted itself on one screen, because the counts came from
the jurisdiction's own read and the verdict from the merged one. *A load is
judged by its effect* — the fourth time in this programme, and the first
where the instrument caught its own author.

**The rule: a candidate must be attributable to the jurisdiction it is
offered for.** Discarding the harvest would be wrong the other way —
`data.gov.au` genuinely harvests the states, and for the ACT and Tasmania it
is the only route that answers. What makes a harvest hit usable is that the
dataset names its publisher, so attribution is *checkable*.

Three bounds on it:

- judged on the **organisation** alone, never on the title — a dataset
  called *"Property sales, Northern Territory"* published by a Victorian
  department is a Victorian dataset;
- **never on a bare abbreviation** — `ACT` is inside "Climate **Act**ion",
  which is the very organisation name that produced this, and `WA` is inside
  dozens of ordinary words;
- an **own** catalogue needs no attribution, which is what makes it the
  authority.

### 3.2 "0 declared" was answering nothing

`data.nt.gov.au` answered `200 · 0 declared` to all five sales phrasings.
That conflates two cases the queries cannot tell apart:

- a real, populated catalogue that holds nothing matching — an **answer**,
  and a measurement worth having; or
- an endpoint that is not this jurisdiction's index — not an answer at all.

The first fix refused to choose and called both `catalogue_unavailable`. That
is the conservative side, and it answers nothing: it made the probe silent
about the one jurisdiction it had in fact measured.

The distinction is **one question away**, and it is the same rule again —
corroborate from a second endpoint that fails differently. Here that endpoint
is the **same catalogue asked its own size** (`package_search?rows=0`, the
cheapest question CKAN takes). A catalogue that says it holds 3,000 datasets
and matches none of five sales phrasings has answered; one that says it holds
none, or cannot say, has not.

`catalogueAnswered` counts **both** `answered` and `answered_empty_handed`,
because an absence from a populated index is an answer.

### 3.3 …but corroboration gates an absence, not a find

The first version required corroboration before it would rank anything, and
**Tasmania then read `catalogue_unavailable` while the Commonwealth catalogue
held one dataset attributed to Tasmania** — a dataset that had answered, from
an index that had answered, discarded because a *second* index had not.

The two directions are not symmetric, and conflating them is a different
error each way:

- **An absence needs two endpoints that agree.** One catalogue's silence is a
  statement about that catalogue.
- **A find needs one endpoint that answered.** A dataset that exists, is
  attributed to this jurisdiction and says it carries a count is a find
  whatever a second index says. Requiring a second witness to a thing you are
  holding is not conservatism — it is discarding evidence.

So the ranking runs first, and the corroboration requirement applies only
where it produced nothing.

### 3.4 The ACT portal is not CKAN, and its 404 is what bought the reader

The ACT answered a CKAN 3 path with
`404 {"code":"not_found","error":true,"message":"No service found for this
URL."}` — a JSON API that exists and does not speak CKAN.

That body is the evidence, and it is precisely why the wrong root was **kept
and printed** rather than replaced with another guess: a 404 with a body
tells you what the host *is*, and a replacement guess throws that away.
`www.data.act.gov.au` runs **Socrata**.

`parseSocrataCatalogue` projects onto the **same** `VolumeDataset` shape, so
`judgeVolumeDataset`, `rankVolumeCandidates`, `attributableTo` and
`assessVolumeCoverage` are written once and cannot disagree between
dialects — two readers and one judgement, never two judgements.

Three things are specific to Socrata and worth knowing:

- its catalog API is **domain-scoped**, so it cannot return another
  jurisdiction's dataset and §3.1's defect cannot recur through this route
  *by construction* — `attributableTo` is still applied, because a guarantee
  worth having is worth asserting;
- **`columns_name` is the publisher's own list of the dataset's columns**,
  which is exactly what `COUNT_PATTERN` needs and what a CKAN `notes` field
  only sometimes carries, so it is folded into `notes`;
- a Socrata dataset is **queryable by construction** — that is the API it
  serves — so the resource is JSON and `datastoreActive`, which is a fact
  about Socrata rather than an assumption about a row.

The probe reaches for it only where the CKAN root did not answer, and prints
both, because hiding the 404 would leave the next reader wondering why a
second dialect exists.

---

## 4. What the publishers answered, 22 and 23 September 2026

Measured from CI. WA, the NT and the ACT on 22 September; Tasmania on 23
September, by the run that re-measured the other three and found every one of
their readings unchanged. **All four are now a real limit of what is
published** — and two of them got there only when the instrument did, which is
why a gap in this repository and a limit of the source are kept apart until
the moment one is shown to be the other.

| | its index says it holds | matched a sales query | carrying a count | reading |
| --- | ---: | ---: | ---: | --- |
| **WA** | **2,911** | 203 | **0** | `medians_only` |
| **NT** | **1,075** | **0** of five phrasings | 0 | `no_count_published` |
| **ACT** | **378** (via Socrata) | **0** of five phrasings | 0 | `no_count_published` |
| **TAS** | **982** — its whole list in the Commonwealth catalogue (§4.4) | **5** name a sale | **0** | `no_count_published` |

**Western Australia's catalogue answers, holds 2,911 datasets, matches 434
for "property sales" and 2,883 for "land sales" — and not one of the 203
matched and attributed carries a number of sales.** The Northern Territory's
index holds 1,075 and matched none of the five phrasings; the ACT's holds 378
and matched none. All three corroborated: the jurisdiction's own catalogue
and the Commonwealth catalogue both answered and both agree.

**So three of the four are settled, and the answer is that no sub-state count
of residential sales is published.** That is the measurement W3.5 was for.

On 22 September one remained **ours**: **Tasmania** — `data.tas.gov.au` does
not resolve from this egress, and its one harvest-attributed dataset carried
no count, so nothing was established either way. §4.4 is how that closed.

The ACT reached this answer only because of §3.4. For one revision it read
`catalogue_unavailable`, correctly, because its CKAN root 404'd; the Socrata
reader that 404's own body bought moved it to a real reading over an index of
378. **That is the return on keeping a failure and printing it** rather than
swapping in another guess.

### 4.1 An absence carries the size of the question that found it

The first corrected run printed, for the Northern Territory, *"0 datasets
examined across the territory's own catalogue and the Commonwealth
catalogue"* — which describes a five-query search of a populated index as
looking at nothing, because the count carried into the sentence was what
survived attribution rather than what was searched.

`searchScale` states both: *"434 datasets matched a sales query out of a
published index of 2,911"*. Where the index did not state its own size the
clause omits it cleanly rather than printing a zero. An absence is only
believable beside the size of the question that found it — the rule the
sanctions register and the PEP index both answer to.

### 4.2 A reading stored against a replaced instrument is not a reading

The ACT is the worked example. It read `catalogue_unavailable` for one
revision, which was correct for the probe as it stood, and moved to
`no_count_published` the moment the Socrata reader existed. Tasmania was
re-measured by the same run and did not move, because its host still does not
resolve.

That is the *asserted by configuration rather than by effect* trap the
retention purge and the verification self-test both answer to — and it is the
kind of staleness nobody notices, because the constant still reads plausibly.

`VOLUME_READING_IS_CURRENT` declares which entries the current instrument has
taken. All four are current today, and the flag is **kept anyway**, because
the point is to have somewhere for the next instrument change to be declared.
Its spec is a ratchet rather than a live measurement of anything, and saying
so is better than letting it look like one.

One more correction from the same run: `searched` for WA was recorded as
**434** — what `property sales` alone declared — while the probe's own
sentence said **203**, the number matched and attributed. A constant
recording a measurement records the number the instrument printed.

### 4.3 What a client's page says now

`MEASURED_VOLUME_COVERAGE` records the four readings as a constant, not a
live lookup — `amenity_register`'s and `nationalPipeline`'s reason: a
per-report round trip would spend a request to learn a fact that changes on
the scale of months, and the probe is the instrument that flips it.

`measuredVolumeNote` is the demand dimension's client-facing `reasonOverride`
for those four jurisdictions and **`null` for the other five**, so the
existing `NOT_ASSESSED_REASON.demand` stands everywhere it already did — a
reading that narrows a sentence must never widen the set of pages it appears
on.

So a Western Australian report now reads that no count is published, a
Tasmanian one reads the same — from its government's whole list, and saying
so — and a New South Wales one reads exactly what it read before. (Until 23
September a Tasmanian report read that this could not be established, which
was true.)

### 4.4 Tasmania: found from the harvest's own records, not a second typed host

`data.tas.gov.au` answers **ENOTFOUND**. The tempting fix is to type another
host, and it is the mistake this module keeps declining: a typed host that is
wrong fails exactly like a jurisdiction that publishes nothing, which is what
the ACT's first root proved. The harvest already knows where Tasmania
publishes, so the probe asks the harvest's **own records**, and nothing in
the route is an identifier anybody typed.

Measured from CI, 23 September 2026:

1. **The harvest's organisation facet names Tasmania's publishers** — 17 by
   their own full name, 14 of them its government once universities and
   institutes are set aside (`governmentPublishers`; a university of
   Tasmania is not the Tasmanian Government).
2. **Every dataset those 14 list was read in full: 982**, each publisher
   paged until what was read reached what the index declared
   (`enumerationComplete`). The largest is *Tasmania Government's The List
   Data* at 794. A list read in part is not a list — the
   `organization_list`-answered-with-25 fault from W3.2.
3. **Their resource URLs name 63 hosts**, counted; eight are Tasmania's own
   (`maps.thelist`, `listdata.thelist`, `www.thelist`, `services.thelist`,
   `parks`, `maps.stategrowth`, `data.stategrowth`, `www.mrt`).
4. **Each own host was asked, in every dialect this module reads, whether it
   is a catalogue** — CKAN at both roots, Socrata, a DCAT `data.json`, and an
   ArcGIS directory. **None answered as CKAN, Socrata or DCAT.** Two are
   ArcGIS directories — `services.thelist` (8 folders) and
   `data.stategrowth` (14 services, 19 folders) — which are catalogues of
   map LAYERS, not of datasets; their folders were walked for a layer named
   for sales and **none is**. `www.mrt` answered with a bot-protection
   challenge, which is recorded as a challenge and never as a refusal.

So Tasmania runs no open-data catalogue of its own, and the Commonwealth
catalogue **is** its index. The reading is therefore taken from everything
its government lists there — **`harvest_enumeration`** — rather than from a
relevance search, and its sentence says which: *"of the 982 datasets its own
publishers list in the Commonwealth catalogue, read in full, 5 name a sale,
and none carries a number of sales. TAS runs no open-data catalogue of its
own, so that list is where its published data is indexed."*

The five that name a sale are *Toilets and Waste Systems (PWS)*, *Private
Timber Reserves (PFT)*, *Tasmanian Irrigation — Pipeline*, *Derwent Estuary
Recreational Water Quality monitoring program — Boat Sales Wharf* and
*Service Tasmania shop locations* — which is what an honest word match looks
like on a list with no sales register in it. Corroboration is the relevance
search of the **same** index, the question that fails differently, and it
agreed.

#### The instrument over-counted, and the constant records the corrected number

The run's own sentence said **"6 name a sale"** beside its own line
`datasets naming a sale  5 of 982`. Two faults, one number:

- the attributed list was the jurisdiction's datasets **concatenated** with
  the harvest search's, and its length was the count — on this route the two
  ask the **same** index, so one dataset can arrive by both, under one id,
  and be counted twice;
- the sentence describes the **enumerated list**, and the search's one
  attributed find was folded into it. On this route the search is the
  corroborating question, not part of the list.

`attributedRead` fixes both: every attributed dataset reaches the ranking
once — **a find still needs only one endpoint** — and the number is the one
its sentence describes. The constant records **5**, the enumeration's own
printed line, and §4.2's rule (*record the number the instrument printed*)
now has an instrument whose sentence and whose line agree.

---

## 5. The exit contract

`abs-register-liveness`' rule, the fourth time. Three outcomes, one red:

- a catalogue that does not answer, or 404s → **0**. A build must not be
  decided by another party's uptime, and a typed API root that resolves to
  nothing is a gap in this repository that this probe's own output is the
  remedy for.
- a catalogue that answers and holds no count series → **0**. That *is* the
  measurement, and it is what decides whether to ask for the migration.
- a catalogue that answers and this repository cannot read what it sent →
  **1**. The one failure a fixture can never catch.

The probe distinguishes a CKAN that refused a query (a JSON envelope this
parser reads — ours, and red) from a portal that is not CKAN at all (HTML or
another schema — a typed host being wrong, printed and green).

---

## 6. Where the code is

| | |
| --- | --- |
| the reader and the policy | `supabase/functions/_shared/reports/market/openData/salesVolumePublishers.pure.ts` |
| the demand remedy's clause | `volumeRemedyClause`, read by `describeGaps` in `scoringV2Production.pure.ts` |
| the client-facing sentence | `measuredVolumeNote`, the demand gap's `reasonOverride` |
| the second catalogue dialect | `parseSocrataCatalogue` / `SOCRATA_PORTALS` — the ACT portal is Socrata |
| where a jurisdiction publishes | `harvestOrgFacetUrl`, `governmentPublishers`, `enumerationComplete`, `publicationHostsOf`, `catalogueProbesFor` — Tasmania (§4.4) |
| what an assessment is handed | `attributedRead` — each dataset once, and the number its sentence describes |
| the CI probe | `scripts/market/sales-volume-liveness.ts` |
| the spec | `src/lib/reports/__tests__/salesVolumePublishers.spec.ts` |

## 7. What is NOT claimed

- **Nothing is loaded.** No table, no row, no migration, no credential, and a
  source scan asserts it rather than promising it. All four jurisdictions
  still have no transaction-volume reading.
- **No `EvidencePoint` is constructed and no register row is emitted**, so
  nothing here can reach the scorer.
- **The measurement is not a licence check.** What a dataset's terms permit
  is carried back from the catalogue and not judged here.
- **The number of PERIODS a candidate carries is not established.** The
  catalogue states a format and a size; how many quarters are inside the file
  is a question for the loader, and four are needed. No candidate survived to
  need it.
- **Tasmania's reading is about the Commonwealth catalogue, because that is
  its index.** It rests on every dataset its 14 government publishers list
  there and on the finding that none of its eight own hosts is a searchable
  catalogue. A count published only on a Tasmanian site outside both — a
  valuer-general's page, a report behind a form — would be invisible here,
  which is the same bound as the bullet below and is stated for it by name
  because its route differs.
- **Whether a count exists somewhere other than these catalogues** is not
  established. A valuer-general's own website, a paid feed or a report series
  behind a form would each be invisible here, and the reading says only that
  none was found published in the two catalogues asked.
- **No migration is requested, and none is owed.** W3.5's original shape —
  load counts for four jurisdictions — is answered for **all four** by
  *there is nothing to load*: no sub-state count of residential sales is
  published by any of them in the catalogues that index them. That is a
  better outcome than asking for a table to put nothing in, and W3.5 is
  closed on it.
