# Forward demand — what a population is projected to do

W3.3 of the report presentation programme. Read this before touching
`_shared/reports/market/openData/absPopulationProjections.pure.ts`,
`forwardDemand.pure.ts`, `regionalPromptBlocks.pure.ts`, or
`scripts/market/abs-projection-liveness.ts`.

---

## 1 · What W3.3 asked, and the premise inside the asking

> **W3.3 · National forward demand: ABS population projections by SA2.**
> Replaces "no forward projection" everywhere rather than in one state.

Two claims are embedded there, and only one of them is a requirement. The
requirement is the second sentence. The first is a **premise** — that the ABS
publishes population projections at SA2 — and it had never been checked.

Three premises in this programme have already been wrong by exactly that
route:

| premise | what measurement found |
| --- | --- |
| *"no integrated layer publishes overlays at a point"* | wrong for four jurisdictions, all HTTP 200, no key |
| *"Queensland publishes no median sale price"* | it publishes one, under a different product |
| *"the Infrastructure Australia Priority List"* is fetchable from the Commonwealth catalogue | the publisher is there; the register is not (W3.2) |

So this one was asked first, and the answer changed the design.

---

## 2 · What the Bureau actually publishes

Measured from the GitHub Actions egress, 22 Sep 2026. The development egress
answers **403 to CONNECT** for `data.api.abs.gov.au`.

Four projection flows. Every one of them carries a single `REGION` dimension
of **23 codes**:

| grain | codes |
| --- | ---: |
| capital city / rest of state | **14** |
| state or territory | **8** |
| Australia | 1 |
| **SA2** | **0** |

`finest published grain: capital city or rest of state` — including on the
flow titled **"Population Projections by Region, 2017-2066"**, where *Region*
means something very much coarser than a suburb.

**The premise does not hold.** There is no ABS projection at SA2, so W3.3's
national floor can only ever be a fact about a region the property sits in,
and forward demand AT the property's own area is a per-jurisdiction register —
W3.4's work, not a national one.

### 2.1 · The assumption set is a CROSS-PRODUCT, not a series

No flow carries a series dimension at all. Each carries four independent
assumption dimensions:

    4. FERTILITY    3 codes
    5. MORTALITY    2 codes
    6. NOM          4 codes   (net overseas migration)
    7. NIM          3 codes   (net interstate migration)

**72 combinations.** The first draft of the reader looked for a `SERIES`
dimension with a `medium` code to match by name, so it reported `UNMATCHED` —
which reads as a gap in the Bureau's metadata when it was a gap in the model
of it.

The measured choice names show how badly a default would fail:

    FERTILITY   High fertility · Medium fertility · Low fertility
    MORTALITY   High life expectancy · Medium life expectancy
    NOM         High NOM · Medium NOM · Low NOM · Zero NOM
    NIM         Large interstate flows · Medium · Small interstate flows

**`Zero NOM`** is a sensitivity case — net overseas migration of nothing at
all — which nobody would call a forecast. And `choices[0]` from each, the
obvious default, yields *High fertility, High life expectancy, High NOM, Large
interstate flows*: **the maximum-growth corner of a 72-cell space**, printed
as "the projection".

Two rules follow. **A reading names every assumption it rests on**, because a
figure under one combination is a different figure under another, and printing
either as "the projection" asserts a scenario nobody chose — which a single
`series` field would have invited. And **there is no central combination to
default to**: the Bureau documents which combinations it treats as its main
projections and a codelist does not, so `assumptions` is reported rather than
resolved, with `choices[0]` and `centralSeries` both forbidden by a source
scan.

`assumptions` is DERIVED — every dimension that is neither the geography, nor
time, nor a slice of the population (`SEX_ABS`, `AGE`, `FREQUENCY`) — so a
publisher adding a fifth cannot have it silently fall out of a reading's
provenance.

### 2.2 · The 14 unplaced codes — and how they were settled

The first read reported **14 codes the shape rules could not place**:
`11, 12, 21, 22, 31, 32, 41, 42 …`. Two-digit ASGS codes, which *looked* like
a capital-city and rest-of-state split — a grain **finer than state**, refused
and therefore understating the measured answer.

*Looked like* is not a measurement. So `RegionCensus.unplaced` was changed to
carry each code's published **name**, the probe was made to print it, and the
next run answered:

    61  Hobart          62  Rest of Tas
    71  Darwin          72  Rest of NT

Seven states split two ways plus an unsplit ACT is exactly 14, which is what
the census counted. So `11` is Greater Sydney and `12` is Rest of NSW, the
rule is `^[1-8][12]$`, and the finest grain the Bureau publishes is
**capital city or rest of state** — one level finer than the first reading
said.

**Printing the ids is what made the gap visible; printing the names is what
closed it.** The conclusion is unchanged, because neither a capital city nor
everything outside one is this property's area — but an understated grain is
an understated register, and it was the measurement that decided it rather
than an inference that happened to be right.

One consequence for the prose: `PROJECTION_GRAIN_LABEL.gccsa` had read *"a
whole metropolitan area"*, which is wrong for half the codes at that level.
`Rest of Tas` is not a metropolitan area. It reads *"a whole capital city, or
all of a state outside its capital"* now, and a spec pins both halves.

---

## 3 · Three rules that stop a forecast becoming a fact

### 3.1 · A projection is not an `EvidencePoint`, and that is a type decision

`EvidencePoint.value`'s own documentation is *"The measurement. A zero here is
a measured zero."* Every consumer of that type feeds the scorer, and
`EvidenceProvider` is a closed union of measurement providers. Handing a
modelled forecast that type is precisely how a forecast comes to be scored as
a measurement, so the module is asserted — by source scan, not by promise —
unable to produce one.

It follows that **nothing here scores.** `demandScoring.pure.ts`'s rule is
that a dimension is scored only where something measured it directly, and
`populationDriver` — a measurement of the *past* — is already capped as a
driver that may not carry the dimension. A projection is weaker evidence than
that driver, not stronger. Re-anchoring a calibrated scale to raise a figure
is the one thing this programme must not do.

**W3.3's deliverable is a sentence with provenance, not a number on the
grade.**

### 3.2 · An estimate is refused, and named rather than omitted

This platform already holds the backward reading: `abs_sa2_population`,
61,335 rows of ABS estimated resident population, which
`populationGrowthEvidence` turns into a compound annual growth rate labelled
*"Population growth"*.

Printing that, or anything derived from it, under a forward heading is the
worst thing this module could do — and an omission from an allow-list would
do it silently. `ESTIMATE_NAME_PATTERN` therefore exists **to refuse**; an
estimate wins a title matching both rules; and the survey reports estimate
flows by name, so *"the ABS publishes no projection"* and *"the ABS publishes
estimates we mistook for projections"* stay different findings.

### 3.3 · A region is not an area

`describesTheArea` admits SA2 and SA3 only.
`MARKET_FIGURES_IN_THE_REPORT.md`'s benchmark rule applied to a forecast: *a
state figure beside a suburb one reads as the suburb's*, so anything coarser
is drawn apart under a heading saying which geography it describes.

---

## 4 · "Everywhere" is what makes the obvious implementation wrong

The acceptance says *everywhere rather than in one state*. Loading Victoria in
Future replaces the sentence for Victorian properties and leaves it standing
for the other seven — which is the failure the criterion names in advance.

`FORWARD_DEMAND_PUBLISHERS` therefore names the publishing body and product
for all eight jurisdictions, `ingested: false` on every one truthfully, and
`forwardDemandCoverageNote` composes one sentence from it. A reader in any
jurisdiction gets a named publisher and a route to the figure on day one,
before any per-jurisdiction ingest exists. `PROGRAMME_PUBLISHERS` is the
precedent and §4's rule there is the reason: *"No equivalent structured
dataset found" must not become "NSW has no relevant programme."*

Two things it deliberately does **not** state:

- **No grain.** An earlier draft carried the finest grain each jurisdiction
  publishes at. It was removed rather than softened, because nothing in this
  repository can reach those publishers to check it and a grain there would
  be a claim about somebody else's product that no gate could verify. A spec
  asserts the table names none.
- **No figure, no year, no rate** — `planningControlGuide`'s rule, asserted
  over every branch.

### 4.1 · Five readings, five sentences

| reading | what it is about | what a reader gets |
| --- | --- | --- |
| `projected` | a figure for this area | the figure, with its grain |
| `coarser_than_area` | a figure about a larger region | the figure, **drawn apart** |
| `grain_not_published` | the publisher offers none this small | no figure, and why |
| `not_loaded` | this deployment | no figure, and the publisher's route |
| `unavailable` | this retrieval | no figure, worth a retry |

The two that would otherwise collapse are kept apart deliberately:
`coarser_than_area` is a **caveat on a figure that IS printed**, and
`grain_not_published` is **the absence of any figure**. Collapsing them either
drops a real reading or implies one that was never held. A failure outranks
everything, because a projection printed from a retrieval that did not
complete is a figure with no provenance.

Nothing rates anything in either direction. A projection that "shows strong
growth" is a conclusion, not a retrieval, and a spec rejects the vocabulary.

---

## 5 · The part worth the most, and it needed no register

`regionalPromptBlocks` already forbade the model to state *"a population
projection"*. That prohibition is right and it stays. What it had no companion
for is the **permitted form** — while the section validator **requires** the
words `population`, `income` and `employment` in that section.

So the model was obliged to write about demand, told one thing it may not say,
and offered nothing to say instead. This repository has recorded twice what
that produces:

- `compassDocumentContract`: *a prohibition with no demonstration of the
  permitted form is one a model routes around.*
- The planning block **tells** the model never to write a bracketed pointer to
  its tables, and nine of ten delivered documents carried one.

The absence now gets a sentence, composed once, naming a publisher a reader
can go to. The block also says in as many words that the measured table above
it is **backward-looking**, because a five-year CAGR labelled "Population
growth" beside a demand discussion is read forward by a reader who was never
told otherwise.

Two bounds. The model is instructed not to present the named publisher as a
source this report consulted — naming where a figure can be found and
claiming to have read it are different statements, and only the first is true.
And the default availability is `not_loaded`, the truth on every deployment
today; any other default would announce a reading nobody has.

### 5.1 · The state it names is the trusted geography's

The generator's own `state` is `detectedState || 'NSW'` — it **defaults to New
South Wales**. Reading it would name the NSW publisher on every property whose
state was never resolved: a false statement about the jurisdiction, made
silently, on exactly the properties whose evidence is thinnest.

`trustedStateForForwardDemand` withholds instead —
`crimePostcodeAuthority`'s rule applied to a jurisdiction — and it lives in
the pure module because there are two call sites and two copies of one rule is
how the two come to disagree.

Scope was checked rather than assumed, which this file has taught before: §7
of `INVESTMENT_REPORT_RESUME.md` records two `const`s read 2,222 lines above
their declaration, and the handler threw eighteen milliseconds after
acquisition on every report for a day. `subjectGeography` is declared at 2988,
deliberately outside the try (its own comment says so), and both call sites
are at 5005 and beyond with the import at 89.

### 5.2 · A recorded asymmetry, not an oversight

The **regeneration path names no publisher.** There the trusted geography is
resolved in `fetchEnhancedData` while the block is composed in
`buildEnhancedDataContext` — a different function — and the only `state`
reachable is the NSW-defaulting one. So it passes none and gets the
unknown-jurisdiction wording, which states the limit as this report's rather
than naming a publisher for the wrong jurisdiction.

A test asserts it names none of the eight publishers, so whoever threads the
trusted state through changes that test deliberately instead of discovering
the gap.

---

## 6 · The instrument, and the two defects it shipped with

`scripts/market/abs-projection-liveness.ts` runs on every build in the
`abs-register-liveness` job under `always()`. It writes nothing anywhere.

Exit semantics are the established ones: the ABS unreachable exits 0, our
reader failing to read its answer exits 1, and a measured *"published, and not
at SA2"* exits 0 while saying so — a build must not go red over another
party's publishing decisions.

**Its first run was a false negative, and both halves were ours.**

    structure http               406 · 471 bytes · 181 ms
    skipped                      HTTP 406
    flows read                   0
    MEASURED: THE PREMISE DOES NOT HOLD

- **The header was wrong.** It sent
  `application/vnd.sdmx.structure+xml;version=1.0` — XML instead of JSON, with
  no wildcard fallback — so the Bureau answered **406 Not Acceptable** to every
  structure request, and `getOrTheirs` laundered that into "the publisher did
  not answer". A 406 is the server saying it cannot serve what we *asked for*:
  a statement about our request. `isOurRequestFault` names 406 and 415 as ours
  and the probe now **fails** on them.

  The header was already right somewhere: `abs-approvals-liveness.ts` carried
  the working string as a literal **twice**. So it was typed twice and then a
  third time wrong. `ABS_SDMX_STRUCTURE_ACCEPT` and `ABS_SDMX_CSV_ACCEPT` are
  declared once beside `absDataStructureUrl`, all four literals are gone, and
  a spec forbids any probe retyping either.

- **The verdict was drawn over nothing.** `findings.length === 0` and the
  block still reached a conclusion about the premise. That is the urban-centre
  register's rule paid again — *an instrument that can fail the way its
  subject fails is not an instrument* — so a conclusion is now impossible to
  print where no structure was read, and it is OURS, because the catalogue
  answered and named the flows.

The run that failed still earned its keep: it is what surfaced
`ABS,POP_PROJ_REGION_2012_2061` — *"Population Projections by Region"* — which
the false negative would have buried.

---

## 7 · The per-jurisdiction register (W3.4, from 23 September 2026)

§1's measurement settled where forward demand at a property's own area has to
come from: each jurisdiction's OWN projection, because the Bureau's finest is
capital city or rest of state. The owner approved the infrastructure on
23 September 2026, and it is built in the order this programme has learned to
build a register in — the table and the reader first, the loaders only
against files a probe has described.

### 7.1 · The table, and the five rules it records

`population_projections` (migration `20261218000000`) holds a jurisdiction's
projection row by row: edition, series, measure, area, year, value, plus the
publisher, the source URL, the licence and the day the register took it. The
key is the publisher's own `(state, release, series, measure, area_kind,
area_code, year)`, so a re-run of an edition replaces it and a new edition sits
beside the old rather than silently overwriting it.

1. **A projection is not a measurement.** Nothing reading this table builds an
   `EvidencePoint`, and a source scan asserts it (§3.1, unchanged).
2. **The series is the publisher's own word and is never defaulted.** It is
   part of the key, so no load keeps one quietly, and the report prints every
   series with *"None is preferred here"* beside them — `choices[0]` is what
   printed the maximum-growth corner of the Bureau's 72 as "the projection".
3. **The base year is marked as the base** (`year_kind`) and printed
   *"2021 (estimated base)"*, because a projection table opens on the measured
   population it starts from and printing that under a forward heading as if
   projected is the worst failure this register could commit.
4. **The grain is the publisher's** (`area_kind`), and only an SA2, an SA3 or
   the publisher's suburb describes the property's own area; anything coarser
   is printed under the sentence saying it describes a region the property
   sits in (§3.3, unchanged).
5. **Provenance travels with the figure** — publisher, edition, licence and
   the register's own date — and a figure with none is not printed.

The table is created **empty**, with RLS on and no policy: the rows a
migration INSERTs do not travel to a clone (`CLONE_PROVISIONING_GAPS.md`), so
the ingest fills it on every deployment.

### 7.2 · How a report reads it

`readProjectionRegister` asks by **trusted geography only**, finest first: the
SA2 the verified coordinate falls in (`report_geography.sa2_code`, now carried
through the generator's `subjectGeography` and its stored-row fallback), the
resolved suburb, then the council the cadastre returned — never a typed suburb
and never the NSW-defaulting state. It never throws, and keeps four absences
apart, because each is a different remedy:

| absence | what it is about | sentence |
| --- | --- | --- |
| `not_loaded` | this deployment | nothing is held for the jurisdiction |
| `none_for_area` | how the areas line up | the jurisdiction is held and names no area matching this one |
| `no_area_resolved` | the subject | nothing trusted could select a reading |
| `unavailable` | us | the read failed |

The generator stores the whole answer on `enhancedData.forwardDemandProjection`
beside the approvals read, in the same shape and for the same reason: it is our
own table, so it costs no ledger entry, no budget and no reuse gate, and a
resume sees whatever the last ingest wrote.

### 7.3 · One composer, in the section and on the pin

A reading prints the publisher's own table — every series, the base labelled,
the source line with edition, licence and the register's date — with the rules
that bound it: use the figures exactly as printed, name the series, state no
other projected population, growth rate or horizon, and never call the base a
projection. An absence prints its own sentence. **`forwardDemandBlocks` is the
one composer**, read by the demographics section and by the pinned context,
and the pin is where it has to be: a held projection is the authority for every
projected figure the report may state, and the section that discusses demand
sits in the middle `limitPromptContext` trims — §6 of
`PLANNING_CONTROLS_IN_THE_REPORT.md`, applied to a forecast. Where a table is
held, the flat "no population projection" prohibition gives way to "no
projected figure other than those in the forward-demand table".

### 7.4 · Three readings the register made necessary

A register that can hold a jurisdiction can also hold it and not name this
property's area, be asked about a property whose area was never resolved, or
not be asked at all. Those are three more sentences, not three variations:

- **`area_not_named`** — held, and no area matches. Its route sentence names
  the publisher and the link but NOT "which this report does not read",
  because it did read it.
- **`no_area_resolved`** — a statement about the report's inputs.
- **`not_read`** — the caller never read the register. It is the **default**
  now, and that is the change that matters: the regeneration path composes this
  block without a register read (the recorded asymmetry of §5.2), and the
  moment one jurisdiction loads, `not_loaded`'s *"No population projection has
  been loaded by this deployment"* would be false there. A caller that did not
  read says it did not read, which is always true.

`not_loaded` itself now names the jurisdiction rather than the whole
deployment, for the same reason.

---

## 8 · What is NOT claimed

- **No ABS projection is loaded, and no table was created.** The measurement
  is why: there is no SA2 series to load, and a state-grain register would
  serve a benchmark rather than an area reading. Whether that benchmark is
  worth a table is a decision for after W3.4, not a consequence of this work.
- **Nothing reaches the scorer**, by design (§3.1).
- **Nothing is inferred about the grain.** §2.2 was resolved by a second
  measurement rather than by the inference that happened to be right.
- **No jurisdiction's register is loaded by this document.** The table, the
  reader and the report's wiring exist (§7); which jurisdictions load, and
  against which files, is recorded in §9. `ingested` is **derived** from the
  loader — `projectionIngested(state)` is true only where a file is declared
  AND its licence has been read from its publisher — and a report says what
  the register ANSWERED rather than what the flag says. No production load has
  run yet: a jurisdiction the flag calls ingested reads `not_loaded` until its
  first `market_sales_sync` row says otherwise.

---

## 9 · The loaders, jurisdiction by jurisdiction (23 September 2026)

Every parser is written against the layout `state-projection-liveness`
printed for the real file from CI (run 35827597400; Queensland's in run
35833636513), and every one is then **run dry in CI over the real file** on
every build (run 35831008944 onward; Queensland's from run 35836681636):
the probe fetches each declared file the way the loader does — the publisher,
then the archive's newest capture that loads — and runs the loader's own
`readXlsxSheets` → `parseProjectionFile` → `guardProjectionRows` over it,
printing what it WOULD write. What CI proves about a file is what production
would write, because it is the same code.

| | edition | grain | series | base → horizon | dry run | licence |
| --- | --- | --- | --- | --- | --- | --- |
| **NSW** | 2024 NSW Population Projections | SA2 · LGA | Main series | 2021 → 2041 | 622 SA2s / 13,482 rows · 129 LGAs / 2,709 rows · 0 declined | **CC BY 4.0, read** |
| **VIC** | Victoria in Future 2023 (`VIF2023`) | LGA | VIF2023 | 2021 → 2036 | 80 LGAs / 320 rows · 1 declined (the state) | **CC BY 4.0, read** |
| **QLD** | Queensland Government population projections, 2025 edition | SA2 · LGA | Medium (SA2) · Medium, Low, High (LGA) | 2021 → 2046 | 546 SA2s / 3,276 rows · 78 LGAs / 1,404 rows · 3 declined (the state total on each series sheet, which the councils add to) | **CC BY 4.0, read** |
| **TAS** | Treasury 2024 projections | LGA | Medium · High · Low | 2023 → 2053 | 29 LGAs / 899 rows per series · 1 declined (the state) | **terms read, not accepted** — the owner's decision (§9.2) |
| **SA** | catalogue: 2016-based (2019); current: January 2024 release, in the archive | SA2 · LGA | medium · high (current) | 2021 → 2041 (current) | catalogue copy **declined — superseded**; current edition **declined — licence** (§9.4) | CC BY (catalogue copy); current: *"All rights reserved"* (the edition's report) |
| **WA** | WA Tomorrow Report 12 | SA2 | bands | — | **declined — licence** (§9.4) | Custom (Active Acceptance) |
| **ACT** | catalogue: by District (2015–2041); current: 2025–2065 | district = SA3 · SA2 | — | 2025 → 2065 (current) | catalogue copy **declined — superseded**; current edition **declined — licence** (§9.4) | CC BY 4.0 (catalogue copy); current: *"no part may be reproduced … without written permission"* (the workbook) |
| **NT** | NTPOP 2024 | SA3 (the publisher's own footnote) | — | 2021 → 2051 (Summary) | **declined — licence** (§9.4) | none expressly provided for the 2024 release |

### 9.1 · What each base is read from

A projection opens on the population it starts from, which is an estimate, and
printing it under a forward heading is the worst failure this register can
commit (§7.1 rule 3). So the base is **the publisher's statement, never an
inference**:

- **NSW** says it on the sheet: *"Historic (2001-2021) and projected
  (2022-2041)"*. The last historic year is the base; the history before it is
  not loaded, because it is estimates and not the projection.
- **Victoria in Future** says it in its Explanatory Notes: the projections
  start from the ERP *"as at 30 June 2022"*. The table prints 2021, 2026, 2031
  and 2036, so 2021 is the newest printed estimate and the rest is projected.
- **Queensland** says it on each workbook's Main page: *"2021 data are final
  estimated resident population (ERP)."* The header prints that year as
  `2021 (b)` — the footnote the sentence hangs on — which a reader taking only
  bare years would have skipped, so the parser reads a year with its footnote
  marker and requires the header to print the year the sentence names.
- **Tasmania** does not print the sentence and states it structurally: the
  components table's first interval is `2023-2028`, and its start-of-interval
  population is the base. The parser then checks the Totals sheet against it
  area by area (±1) — two tables of the publisher's own that must agree, or a
  column was misread.

NSW's SA2 and LGA files carry the one series their own name calls **main**
(high and low exist for the state only); Tasmania's three series are three
files and all three are declared, so none is chosen for the reader; and
Queensland publishes its SA2s in the medium series alone and its councils in
all three, a sheet each — so the SA2 rows say they are the medium series, and
each council sheet must name the same series in its sheet name AND its own
title, or the file is refused.

### 9.2 · Readable is not republishable

- **A file whose licence has not been read from its publisher is refused
  before a byte is fetched** (`file.licence === null`), so no copy of it exists
  anywhere this platform wrote. The monthly job writes that refusal to
  `market_sales_sync` every month until the licence is read — a job that is
  scheduled and refuses says so where an operator looks.
- **NSW** — read from the site that serves both workbooks
  (`planning.nsw.gov.au/copyright-and-disclaimer`): *"Unless otherwise stated,
  all department material available on this website is licensed under the
  Creative Commons Attribution 4.0 International (CC BY 4.0)"*, with
  attribution asked in the form *"© State of New South Wales and Department of
  Planning, Housing and Infrastructure [year of publication]"*. Neither
  workbook states otherwise, and each carries exactly that notice.
- **Victoria** — the Victorian catalogue's own record of the dataset
  (`4912723f-…`, *"VIF2023 LGA Population Household Dwelling Projections to
  2036"*) states CC BY 4.0.
- **Queensland** — the Statistician's copyright page states a RESTRICTIVE
  default (*"no part may be reproduced or re-used for any commercial purpose
  without written permission"*) and, before it, that *"where specific licence
  terms are applied through or via this website to material including a
  particular product those licence terms shall prevail"*. This product's terms
  are stated twice: the Queensland catalogue publishes *"Queensland Government
  population projections: Regions"* (dataset `ebb088ed-…`, publisher Treasury)
  under CC BY 4.0 with its resource pointing at the page that links both
  workbooks, and the council workbook's own Main page links
  `https://creativecommons.org/licenses/by/4.0` beside *"© The State of
  Queensland (Queensland Treasury) 2026"*. The SA2 workbook is the same product
  and edition and states no terms of its own; the product page states none
  either (only the site's footer notice). A licence stated for the product
  outranks one stated for the site, and a restriction stated in the file would
  outrank both.
- **Tasmania — the terms are read, and they are a decision, not a finding.**
  The ReadMe says *"© Government of Tasmania"* and nothing about reuse, and a
  notice is silence about terms, so the probe followed the ReadMe's own link to
  the Treasury's page and read both documents it links (run 35836681636):
  - the **quick guide**: *"You are free to reproduce the projections in
    published work, or use them as an input into your own analysis, provided
    you identify and credit them as Tasmanian Treasury 2024 projections."*
  - the **final report**: *"Excerpts of this publication may be reproduced,
    with appropriate acknowledgement, as permitted under the Copyright Act
    1968."*
  - the **Tasmanian Government's site notice** — whose only readable copy is a
    2011 archive capture, the live page refusing CI — licenses reproduction
    *"for non-commercial purposes only"* unless *"it is indicated on a website
    that specific information may be used for commercial purposes"*.

  The guide's grant is real and specific to the product; it names published
  work and a credit, and it does not name commercial use. Whether a report
  prepared for a paying client is "published work" under it is a reading of
  terms, so it is put to the owner rather than decided here. Until it is
  decided the loader refuses Tasmania before any fetch — the same refusal as
  while the terms were unread, with a different reason recorded
  (`licenceEvidence`). If the grant is accepted, the credit it asks for
  (*"Tasmanian Treasury 2024 projections"*) is the credit the page must print.

Two rules hold the licence at load time, not only at declaration:

- **What a file says about its own terms is held against the licence read
  for it** (`termsAgreeWith`), in an order that is the rule. A restriction
  refuses, whatever else the file says (NonCommercial, NoDerivatives,
  ShareAlike, *all rights reserved*, *may not be reproduced*). A statement
  that NAMES the declared licence affirms it — the file is the best evidence
  of its own terms there is, and the rest of a standard licence statement
  (*"to view a copy of this licence"*, *"for permission beyond the scope of
  this licence"*) rides with it. Terms that name no declared licence refuse,
  so somebody reads them. A file that states nothing is governed by its
  publisher's "unless otherwise stated". So a later edition published under
  different terms at the same URL is refused rather than loaded under the
  terms read for this one — and a file that affirms its own licence, as
  government workbooks commonly do, is not refused for agreeing. **A cell is
  judged by what it says, not by how it starts**: the first version left out
  every cell that opened with `©`, on the reasoning that a notice is not a
  statement of terms — which let *"© State of X. All rights reserved."* and a
  notice naming CC BY-NC through unjudged, in exactly the cell publishers write
  them in. A bare notice (*"© Government of Tasmania"*) names no terms and
  still matches nothing.
- **The notice the file supplies travels with every row.** CC BY 4.0
  §3(a)(1)(A)(ii) asks a reuser to retain a copyright notice the licensor
  supplies; `suppliedNotice` reads it from the workbook (never typed) and every
  row's `licence` reads, for NSW, *"Creative Commons Attribution 4.0
  International — © State of New South Wales and Department of Planning,
  Housing and Infrastructure 2024"*, which is what the page's source line
  prints. **A notice is read whole**: Queensland's council workbook sets
  *"© The State of Queensland"* in one cell and *"(Queensland Treasury) 2026"*
  in the next, and half a notice names the owner while dropping the agency and
  the year the publisher asked to be credited. A parenthetical — optionally
  followed by a year — beside or below the notice is joined to it; a footnote
  such as *"(a) Boundaries are based on …"* is not.

### 9.3 · Queensland

The Statistician publishes both grains a report can use, as issue 5281 of the
2025 edition (the links are the publisher's own, read from its regions page):
an SA2 table in the medium series and a council table in the low, medium and
high series, both 2021–2046. The first run found the links, the second
described both files, and the parsers were written against that description
and then run dry over the real files (run 35836681636):

| file | read | areas | rows | declined |
| --- | --- | --- | --- | --- |
| `qld_sa2` — SA2, medium series | publisher, 180,842 bytes | 546 | 3,276 (2021 base + 5 projected years) | 0 |
| `qld_lga` — councils, three series | publisher, 1,026,322 bytes | 78 | 1,404 (78 × 6 years × 3 series) | 3 — the *Queensland* row on each sheet |

What each parser holds the file to, beyond the shared gate:

- **The SA2 codes must be the edition the reader resolves.** Rows are keyed by
  the publisher's nine-digit SA2 code — the reader's first rung — and the same
  nine digits under another ASGS edition can describe a different area, so the
  Main page must state its boundaries are the 2021 edition. It does:
  *"Boundaries are based on Edition 3 (2021) of the Australian Statistical
  Geography Standard (ASGS)."* A code that is not nine digits beginning with
  3 is declined by name, never loaded.
- **Only the first run of years is read.** The SA2 sheet declares 125 columns
  (`A1:DU560`) around the twelve it prints; CI read every filled cell and the
  widest row reaches column L. A second block of years out to the right — a
  change, a growth rate — would otherwise be read as persons, so the header
  run ends at the first cell that is not a later year, and the measure under
  its first year must read *persons*.
- **The councils must add to the state.** Each council sheet ends with the
  state's own row (*Queensland*, 5,215,814 in 2021), and the 78 councils must
  add to it within half a person each — a total read as an area, or an area
  missed, refuses the file. They do. The SA2 sheet prints no state total, so
  that check does not run there; its floor (500 of 546) and the code rule do.
- **An estimate is one figure in every series.** The 2021 base is an
  estimate, so a council whose base differs between two series sheets means a
  sheet was misread, and the file is refused rather than loaded with one
  series misaligned. Brisbane starts from 1,262,968 in all three.
- **78, not 77.** The table names 78 areas, not the 77 councils the state is
  usually described as having; the parser loads what the publisher printed,
  and the check against the publisher's own total is what says the 78 are the
  whole state and nothing more.

### 9.4 · What is declined, and why each is a different reason

- **South Australia — the catalogue's copy is superseded, and the current
  edition, read through the archive, is declined for its licence.** The
  catalogue's *Population Projections for SA* is CC BY, but it is the
  2016-based edition released in 2019. The Department's current edition is on
  `plan.sa.gov.au`, which refuses CI; on 23 Sep the archive listed it (run
  35839178118) and the next run read its workbooks through the captures' own
  addresses (run 35841453910): *Population Projections for South Australian
  Local Government Areas, 2021-41, January 2024 release* and its SA2
  counterpart, from the Department of Trade and Investment, in the **medium and
  high** series (no low series at that grain). Each is two sheets — notes, and
  one table of `Series | LGA code | LGA name | 2021 … 2041` or `Series |
  Region | SA2 Code | SA2 Name | 2021 … 2041` (165 SA2 rows). The notes state
  the base in words — *"including the baseline 2021 Census population"* — and
  the boundaries — *"the Australian Statistical Geography Standard, 2021
  Edition"* — and that *"these projections replace the population projections
  … published … in 2019"*, which is the publisher's own statement that the
  catalogue copy is superseded. Nine near-empty SA2s are merged into
  neighbours, and the notes list both sides of every merge (NSW's collapsed
  SA2s, in another publisher's words). **And it is declined for its
  licence**, read on 23 Sep (run 35844188766): the workbooks say *"©
  Department of Trade and Investment, Government of South Australia, 2024"*
  and nothing about reuse; the edition's own report — *Local Area SA2 and LGA
  Population Projections for South Australia, 2021 to 2041* — says *"©
  Government of South Australia. Published March 2024. **All rights
  reserved.**"*; the planning portal's terms page (archived 2022, before this
  edition existed) says *"This work is licensed under a Creative Commons
  Attribution 3.0 Australia Licence"*; and the publisher's own site
  (`dti.sa.gov.au`) permits reproduction with acknowledgement but *"must not
  be altered without the permission of the copyright owner"* — no Creative
  Commons grant. A restriction stated for the edition outranks a licence
  stated for the site — the rule the loader already applies inside a file —
  so the current edition is not loaded. What would change it is the
  publisher's own licence for the workbooks, which its notes invite queries
  about (`DTI.PlanningInformation@sa.gov.au`); the parsers would take an hour,
  because the layout is already described.
- **Western Australia — a licence.** WA Tomorrow Report 12 publishes SA2
  forecasts, and the catalogue states its licence as *Custom (Active
  Acceptance)*: reuse requires accepting terms this platform has not accepted
  and cannot accept by fetching. It is the finding `WA_LICENCE_NOTE` records
  for the zone layer, from the same publisher.
- **The ACT — the catalogue's copy is superseded, and the current edition is
  declined for its licence.** Its only projection by area in the catalogue is
  *ACT Population Projections by District (2015 - 2041)*, which its own
  description says *"are
  based upon actual values obtained in 2015, and estimates obtained for
  2016"* — a base two censuses old. Its CC BY 4.0 licence is not in question;
  its currency is. The Treasury's own page (archived 13 Dec 2025; the live page
  refuses CI) names what supersedes it: *ACT Population Projections
  2025-2065*, at Territory, **district** (*"as approximated by the Australian
  Bureau of Statistics (ABS) Statistical Area Level 3"*) and suburb level, as
  one workbook — read through the archive on 23 Sep (capture `20260101045907`,
  run 35844188766): fourteen sheets, the districts in *Table 2* by their ABS
  SA3 names (ten, with an *ACT Total*), the suburbs in *Table 6* by SA2 name
  (with district subtotals and *Total - ACT*), 2025 to 2065 every year. **And
  it is declined for its licence, stated in the file itself**: *"© Australian
  Capital Territory, Canberra, August 2025. This work is copyright. Apart from
  any use permitted under the Copyright Act 1968, no part may be reproduced by
  any process without written permission from the Chief Minister, Treasury
  and Economic Development Directorate, ACT Government."* The Treasury's own
  copyright pages say the same in other words (*"in unaltered form only, for
  your personal use or for non-commercial use within your organisation"*),
  and `act.gov.au`'s CC BY 4.0 governs *"unless stated otherwise"* — which
  this workbook does. The route to it is the written permission the notice
  names.
- **The Northern Territory — declined for its licence.** The 2024 edition's
  workbooks are on `treasury.nt.gov.au`, which answers CI with a Cloudflare
  challenge (HTTP 403, *"Just a moment..."* — a challenge, not a refusal,
  `JURISDICTION_PLANNING_COVERAGE.md`'s rule), and the archive holds the main
  workbook (capture `20251121111355`, 257,800 bytes), read on 23 Sep by the
  capture's own address when the index would not answer (run 35839178118).
  The layout is settled — the publisher's own footnote says *"Regions correspond
  to the Statistical Areas 3 (SA3) geographical classification of the
  Australian Bureau of Statistics"*, each region sheet ends on a *"<region>
  population"* block after the Aboriginal and non-Aboriginal ones, and the
  Summary opens on 2021 estimated resident population and runs to 2051 — and
  the licence is not. The workbook states no terms. The catalogue's *NT
  Population Projections* record says *Creative Commons Attribution*, but its
  resources are the 2019 release and a 2017 update: it was last touched in
  2021 and does not reach the 2024 file, and the 2019 release it does cover is
  superseded. And the NT Government's copyright statement (nt.gov.au, archived
  14 May 2026; run 35841453910) is explicit: *"No part of this website may be
  reproduced or reused for any purpose whatsoever, apart from: fair dealing …
  or where expressly provided under a Creative Commons licence."* Nothing
  expressly provides one for the 2024 release, so it is declined — WA's
  reason, from a different sentence. What would change it: the Treasury
  stating a licence for the 2024 release (a person can read its projections
  page in a browser, which Cloudflare does not challenge), or the catalogue
  record adding it.

**Every jurisdiction now has a measured answer** (23 Sep 2026): three load
under CC BY 4.0 read from their publishers (NSW, Victoria, Queensland); one
waits on the owner's reading of a product-specific grant (Tasmania); and four
are declined for their licences — WA's *Custom (Active Acceptance)*, SA's
*"All rights reserved"*, the ACT's *"no part may be reproduced … without
written permission"* and the NT's default that forbids reuse where no Creative
Commons licence is expressly provided. None of the four is a statement about
the data, and each names the permission that would change it.

Each of these keeps its jurisdiction's `not_loaded` sentence and its route to
the publisher, because the reader is still owed where the figure is.

### 9.5 · The reader's rungs, and the council a report asks by

`readProjectionRegister` asks, finest first: the SA2 **by code**, the SA2 **by
name** (NSW keys its SA2 table by the ABS name, not the code, and the
generator now carries `sa2_name`), the resolved suburb, then the **council**.
The council is `planningCouncilName(planningData)`: the cadastre's LGA where
the parcel layer answered (Queensland), otherwise the council the zone layer
names (NSW's `LGA_NAME`, Victoria's `lga`, Tasmania's scheme name) — without
it, the Victorian and Tasmanian registers, which are published by council
only, could never be reached. South Australia's Code layer names no council,
so an SA property has no council rung until its parcel does; the ACT's
"council" is a Division and is refused, because a Territory district is not a
council. A projected
year before the report's own is not printed as forward demand; the base still
is, labelled as the base.

### 9.6 · The shipping order, and what proves it

The function first, then the table (`20261218000000`), then the monthly jobs
(`20261218010000`, the 3rd of each month from 18:05 UTC, one file per job five
minutes apart — the loader's one-heavy-workbook rule), then the first loads
(`20261218020000`, the five files with a licence read: NSW's two, Victoria's
and Queensland's two). The approvals register's first run answered HTTP 400 in
five milliseconds because its table and job landed before the function knew
the stage (`20261214000000`), so this order is not a preference. A green cron tick is not a delivered request: each file's
load is proved by its own `market_sales_sync` row — `file`, `rows_written`,
`via`, `licence`, `base`, `horizon`, `declined` — and a report's reading by its
source line.

**Shipped on 23 September 2026, and each load proved by its own log line.**
#2737 merged as `16364001c` at 10:31 UTC. The function deploy finished at
10:49, and all three migrations applied in one ordered `apply-migration.yml`
run at 10:52. The five first loads then logged, every one equal to its CI dry
run to the row:

| file | rows · areas | fetched from |
| --- | --- | --- |
| `nsw_sa2` | 13,482 · 622 | the publisher, HTTP 200 |
| `nsw_lga` | 2,709 · 129 | the publisher, HTTP 200 |
| `vic_lga` | 320 · 80 (1 declined, the state) | **the archive** — the publisher answered production 403, as it answers CI |
| `qld_sa2` | 3,276 · 546 | the publisher, HTTP 200 |
| `qld_lga` | 1,404 · 78 (3 declined, the state total per series) | the publisher, HTTP 200 |

Queensland answered from its own host, which settles the open question of
whether production's egress reaches QGSO. **Two things are still owed, and
neither is proved yet:**

- **A report's reading.** The first NSW, Victorian or Queensland report
  generated after 10:53 UTC is the proof, through its `[forward-demand]` log
  line.
- **The monthly jobs.** They applied without error, and the `DO` block raises
  on any failure, but a cron job is proved by its tick, not by its migration.
  The first tick is 3 October, from 18:05 UTC. Until the owner decides, each
  Tasmanian job writes its refusal monthly.
