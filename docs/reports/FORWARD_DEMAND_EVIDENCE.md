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

## 7 · What is NOT claimed

- **No ABS projection is loaded, and no table was created.** The measurement
  is why: there is no SA2 series to load, and a state-grain register would
  serve a benchmark rather than an area reading. Whether that benchmark is
  worth a table is a decision for after W3.4, not a consequence of this work.
- **Nothing reaches the scorer**, by design (§3.1).
- **Nothing is inferred about the grain.** §2.2 was resolved by a second
  measurement rather than by the inference that happened to be right.
- **The per-jurisdiction registers are not read.** All eight are
  `ingested: false`, truthfully, and the sentence a reader gets says so.
