# The national pipeline, and the jurisdiction an absence belongs to

W3.2 and W3.6 of the report presentation programme. Read this before touching
`_shared/planning/nationalPipeline.pure.ts`,
`scripts/market/national-pipeline-liveness.ts`, `OVERLAY_COVERAGE`,
`NO_STATE_LAYER_NOTE` or the empty branch of `renderConstraintRegister`.

---

## 1 · What W3.2 asked, and why the answer is a measurement

> **W3.2 · National named projects: Infrastructure Australia Priority List.**
> Nationally significant projects carrying the publisher's own status word — an
> approval never read as funding, funding never as a start on site.
> *Accept:* page 22's sentence is replaced by named, dated, sourced entries, or
> by a coverage statement that names the register asked.

Two branches, and the statement shipped first — deliberately, because the
guarantee is worth having before the evidence exists.
`infrastructureEvidence.pure.ts` has carried

> `'the Infrastructure Australia Priority List and other national pipeline
> registers'`

in `INFRASTRUCTURE_COVERAGE_LIMITS` since it was written, with its own comment
recording that the entry *"stands on its own and is never removed"* by a state
programme reading, because a state forward-works programme is not a national
pipeline.

What had never been done is **the part that decides which branch is honest**:
asking the publisher. This document records the asking.

---

## 2 · Why the catalogue, and not the list's own page

Infrastructure Australia publishes the Priority List as a web publication. A
page is not a register:
`PLANNING_CONTROLS_IN_THE_REPORT.md`'s rule is that *a web search is not a
retrieval* — a listing site, a news page, a budget page or an agency media
release is not an entry in the table — and
`publishedProjectRegister.pure.ts` exists so that a project read off a page
travels labelled *recorded from an official publication* rather than
*retrieved from a register*.

So the question is put to **data.gov.au**: the Commonwealth's own open data
catalogue, CKAN, keyless, open licence, and the same shape
`investmentProgramme.pure.ts` already reads Queensland's QTRIP through.

**Nothing in `nationalPipeline.pure.ts` is an identifier anybody typed.** No
organisation slug, no package id, no resource id — a resource id is something
that module OUTPUTS. `absBuildingApprovals.pure.ts` pays for that rule
already: *an identifier nobody here could verify is the mistyped Airtable
column again, and an absent flow fails exactly like an empty one.*

---

## 3 · What the catalogue said

Measured from the GitHub Actions egress, 22 Sep 2026. The development egress
cannot ask: the gateway answers **403 to CONNECT** for `data.gov.au`,
`www.infrastructureaustralia.gov.au`, `www.abs.gov.au` and
`data.api.abs.gov.au` alike — a policy denial in the network allowlist rather
than anything any publisher did.

| question | answer |
| --- | --- |
| Does the catalogue list Infrastructure Australia as a publishing organisation? | **Yes** — `infrastructure-australia` |
| Packages it holds (declared / read) | **50 / 50** — the walk is complete |
| Packages that are the Priority List | **0** |
| `"infrastructure priority list"` — ranked hits | 3 of 3 declared, **0 survive both tests** |
| `Infrastructure Australia priority` — ranked hits | 50 of **1,769** declared, **0 survive both tests** |
| Machine-readable resources this repository would try | **none** |

**Reading: `not_in_catalogue`.** The publisher is on the catalogue, its
entries were enumerated in full, and none of them is this register. So the
coverage statement is the honest branch — and it is now a statement with a
measurement behind it rather than a literal in a list.

### 3.1 · What the publisher DOES hold, so the absence can be checked

All fifty are spatial layers from the **Australian Infrastructure Audit 2019**
and the **Outer Urban Public Transport** study, in SHP / SLD / WMS / WFS /
GEOJSON — road congestion and public-transport crowding at 2016 and 2031 AM
and PM peaks, travel time to the nearest hospital, primary school, secondary
school and five childcare centres by car and by public transport, the
percentage of a city's jobs reachable in thirty minutes, and the inner/middle/
outer sector boundaries.

They are real, current-licensed, machine-readable national layers — and they
are **not** the Priority List. W3.2 asks for *nationally significant projects
carrying the publisher's own status word*; an accessibility raster carries no
project, no status and no date. Recorded here as a finding and deliberately
not built on: using them because they are the thing that answered would be
substituting an available measurement for the one the section needs, which is
what a coverage statement exists to prevent. Whether the accessibility layers
are worth a reading of their own is a question for W3.4, not an answer to this
one.

The probe stands as the instrument that flips the branch the day the Priority
List is published there: it runs on every build, writes nothing anywhere, and
its exit code is the whole design (§7).

### 3.2 · The correction this table already needed

The first version of this section reported **`publisher_absent`** — that the
catalogue listed no Infrastructure Australia at all. That was wrong, and it
was wrong for the reason §6.2 records: the enumeration behind it had been
truncated at CKAN's default page size of 25.

So the corroborated enumeration did not merely harden the method. **It changed
the answer.** `publisher_absent` and `not_in_catalogue` send a person to
different places — the publisher's own site versus another name in the same
catalogue — so the truncation had not just weakened a claim, it had produced
the wrong remedy. That is the strongest available argument for §5's insistence
that the readings stay distinct, and for §6's rule that an absence is only an
absence if the question could have found it.

---

## 4 · The four rules a candidate answers to

1. **A document is not a register.** A PDF, a Word file or a web page is
   refused *for this purpose* — not ignored. The formats that WERE offered are
   carried back, because "published, but not as a feed" is a different
   sentence from "not published", and the two send a reader to different
   conclusions.
2. **The edition is the one that ANSWERS**, never the one that is newest.
   QTRIP's 2026-27 package is declared `datastore_active` and holds zero rows;
   ranking by date alone would have chosen it and read an empty programme as a
   jurisdiction with no works. Candidates are RANKED and the caller walks them.
3. **A queryable resource outranks a download.** A bounded question costs
   kilobytes where a download costs megabytes against an edge ceiling.
   Preference is a declared order, not a guess.
4. **A refusal names the size and the first bytes.** Every parser in this
   programme that failed silently failed because it was handed something it
   did not recognise and said "empty".

---

## 5 · Five readings, five sentences

`assessPipelineAvailability` answers in five, and `pipelineCoverageNote`
writes a distinct sentence from each. This is `SUPPLY_EVIDENCE.md`'s rule (*the
four absences are four different sentences*) one register along.

| reading | what it is a statement about | where it sends a person |
| --- | --- | --- |
| `readable` | this retrieval | nowhere; the register was read |
| `published_as_documents` | the **publisher's distribution** | the document, through `publishedProjectRegister` |
| `not_in_catalogue` | the **catalogue** | another name in the same catalogue |
| `publisher_absent` | **where the register is published** | the publisher's own site |
| `catalogue_unavailable` | **this retrieval** | a retry |

`publisher_absent` is read BEFORE the packages, because a stale package set
must never report a register this catalogue does not distribute.

A spec asserts the five are distinct, that each names the register asked,
that **no absence is rated** — not Low, Minimal, Limited, Negligible,
Favourable, nor a strength — and that none can be read as *"the area has no
planned infrastructure"*. That last assertion changed one sentence: the
`published_as_documents` note said *"No project from it is named here"*, whose
subject is ambiguous between the document and the area, and it now reads
*"Nothing from it is cited here"*.

---

## 6 · An absence is only an absence if the question could have found it

This is the section worth the most, because the same fault was committed
**three times in one sitting**, each time one endpoint further along.

### 6.1 · A relevance query is not a filter

The first probe asked two free-text queries and read "no match" as "not
published". Against the real catalogue it returned **53 packages and 0
survivors** — NESP marine park projects, Geoscience Australia shoreline
modelling, and the *Rail Infrastructure Corporation Annual Report 2003-04* —
and reported `not_in_catalogue`.

That reading was worthless. CKAN's `q=` is relevance-ranked full text: a
quoted phrase is a hint rather than a filter, `Infrastructure Australia
priority` matches anything carrying the word *infrastructure*, and a ranked
list of fifty noisy hits establishes that the QUERY was loose, never that the
register is absent.

It is the `layers=all` defect exactly — *"an empty answer to a question nobody
asked, which reads as a property with no bushfire and no flood"* — one
publisher along.

### 6.2 · A page is not a list

The rewrite made the enumeration the authority and reported **`publisher_absent`
over 25 organisations enumerated, 1 page read** — while its own supplementary
search, in the same run, declared **1,769 packages** and named four publishers.

Twenty-five is CKAN's default page size.
`organization_list?all_fields=true&limit=1000` was answered with 25, the
`limit` silently ignored, and the walk read a short page as the end of the
list. **The same defect, inside the commit that fixed it.**

`ckanOrganisationListUrl` and `parseOrganisationList` are **DELETED** rather
than left unused: a reader for the endpoint that lied is one import away from
lying again. What replaces them is the inverse guard —
`parseOrganisationSlugs` refuses organisation OBJECTS, because receiving them
means `all_fields` was applied when it was not asked for.

### 6.3 · So the enumeration is corroborated

Two endpoints that fail differently, and an absence needs both to answer AND
to agree:

- **`organization_list`** with no `all_fields` answers plain slugs and is not
  paged — the authority for which organisations exist.
- **`package_search?rows=0&facet.field=["organization"]&facet.limit=-1`**
  answers the organisation FACET: the set actually publishing packages,
  computed by the search index rather than by the list endpoint.

`corroborateOrganisations` refuses when the facet names an organisation the
list does not — a bucket outside the list means the list is incomplete, and an
incomplete list cannot establish that anything is absent from it. A matched
slug is then resolved through `organization_show`, and a slug that matches but
cannot be resolved is a **refusal**, because reporting it as an absence would
be the same fault a fourth time.

### 6.4 · And the package walk is judged by its effect

`catalogueWalkIsComplete` compares what was read against the count the
catalogue declared, and a short walk resolves to `catalogue_unavailable`
naming the arithmetic. A package missing because the walk stopped is
indistinguishable from one that does not exist. That is the urban-centre
register's rule (*a load is judged by its effect*) and `SUPPLY_EVIDENCE.md`'s
floor.

### 6.5 · A rule that only ever half worked

`NATIONAL_PIPELINE_ORG_PATTERN` was `/infrastructure\s+australia/i`. That
matches the TITLE `Infrastructure Australia` and can **never** match the slug
`infrastructure-australia`. Moving the enumeration onto slugs is what exposed
it; it is `[-_\s]+` now, one rule for both spellings, asserted.

---

## 7 · The instrument, and its exit code

`scripts/market/national-pipeline-liveness.ts` runs on every build, in the
`abs-register-liveness` job, sharing that job's install under `always()` so a
reader bug against one register cannot hide the other's measurement.

It carries `abs-approvals-liveness.ts`'s exit semantics, for the same reason:

- **The catalogue being unreachable exits 0.** A compliance product cannot
  have its build decided by somebody else's uptime — the rule
  `PEP_SCREENING_ENGINE.md` already pays for. The refusing party's own words
  are printed, because this script cannot tell the catalogue's refusal from an
  INTERMEDIARY'S: this egress answers 403 to CONNECT and a throttled CKAN
  answers 403 too, and the two send an operator to opposite remedies.
- **Our discovery failing to read what it received exits 1.** That is the one
  failure no synthetic fixture can catch, and it is what the job is for. A
  refusal is never allowed to fall through to `catalogue_unavailable`: every
  network failure above has already exited 0, so filing our own parse failure
  as somebody else's outage is a placebo.
- **A correctly-read catalogue holding no feed exits 0 while saying so.** A
  build that went red because a publisher publishes a PDF would be a build
  asserting an opinion about somebody else's distribution choices.

It prints everything the publisher DOES hold when nothing matches, because
"enumerated in full and none of them is this register" is a claim, and a claim
a log cannot be checked against is a claim nobody can audit. Its page bounds
fail as OURS, since hitting a bound is a walk the script did not finish.

It writes nothing anywhere: no database, no Supabase, no credential.

---

## 7a · The acceptance criterion is about the PAGE

W3.2 accepts *"page 22's sentence is replaced by named, dated, sourced
entries, **or** by a coverage statement that names the register asked."* The
assertion that existed was that `coverageLimitsFor` CONTAINS the named limit —
a fact about an array, and an array a renderer drops is a guarantee nobody
reads. That is `verdict.pricingUrl`'s defect (an exported value with zero call
sites, whose own comment called it *"always a real URL when gated"*) and
`stripEditorialBlocks`' whole lesson: an instruction is a request; this is the
guarantee.

So the statement is asserted where a client meets it, through
`renderInfrastructureOutlook`, in **both** branches — a state programme read
and not read — because reading one state's forward works says nothing about a
national list.

Asserting on the page immediately found a drift. The register was spelled
**twice**: `INFRASTRUCTURE_COVERAGE_LIMITS` carried its own literal
*"the Infrastructure Australia Priority List and other national pipeline
registers"* while `nationalPipeline.pure.ts` named the register
*"Infrastructure Priority List"*. Two spellings of one register is how
`AML_COMMAND_REFRESH_EVENT` came to be named once, so the sentence form is now
`NATIONAL_PIPELINE_COVERAGE_PHRASE`, exported from the one module that names
the register, and a source-scanning test refuses the literal anywhere else.

It is a separate constant rather than `${PUBLISHER} ${REGISTER}`, which
composes to *"Infrastructure Australia Infrastructure Priority List"*: the
publisher's own usage drops the second word, and a sentence has to read as
English.

And one guard was renegotiated, for the second time in this work. A bare-word
scan for a rating reads the paragraph's own sentence — *"it is not a basis for
rating infrastructure risk as low"* — as the thing it prohibits. The guard is
written as ASSERTED forms (a level in a table cell, in a bold run, or after
"is"), because a sentence forbidding a rating is the guarantee working, and
rewording it to satisfy a regex would delete the guarantee to keep the guard.

---

## 8 · W3.6 — the jurisdiction an absence belongs to

> **W3.6 · Coverage travels, with a jurisdiction dimension.**
> A Western Australian property must read *"no state planning register is
> loaded for Western Australia"*, never *"no overlays"*.
> *Accept:* a test asserting that for each of the eight jurisdictions the
> planning and development readings carry an explicit coverage statement, and
> that no absence is rated.

The five absences already existed. The per-jurisdiction sentences already
existed. What did not exist was **anything that could tell you a jurisdiction
had been forgotten** — and one had.

`NO_STATE_LAYER_NOTE` is a `Partial<Record<PlanningJurisdiction, string>>`,
correctly: a jurisdiction whose overlays this platform reads in full needs no
such note. A `Partial` record is also exactly the shape that lets one go
missing, and the **Australian Capital Territory** did. Its ZONE is read —
`buildActZoningQuery` is one of the four zoning probes — so it never looked
unserved; its overlay registers have no branch at all, so `constraintOutcomes`
stayed empty and the page fell through to the generic sentence, naming neither
the territory nor where a reader should go instead.

### 8.1 · The coverage is declared, and the invariant is asserted

`OVERLAY_COVERAGE` states, for all eight jurisdictions, what this platform
reads of their overlay registers:

| coverage | jurisdictions |
| --- | --- |
| `state_layers_read` | NSW, VIC, TAS |
| `partial_state_layers_read` | QLD |
| `not_read` | WA, SA, NT, **ACT** |

The invariant: **anything not `state_layers_read` owes a note**, and anything
that IS read in full must not carry one — a note saying "not integrated"
beside a register that answered is a false limitation, and a false limitation
teaches a reader to discount the true ones (`coverageLimitsFor`'s own rule). A
new jurisdiction, or a register withdrawn, now fails a test rather than
quietly printing the generic line.

`partial` is its own value because Queensland is genuinely partial — the state
registers answer for state instruments and the council scheme is unread — and
collapsing it into either neighbour would make one of two true sentences
unsayable.

### 8.2 · And it decides something

A declaration nothing reads is the unmounted-component trap this repository
already pays for twice (`DimensionRail`, `bd-chip`). `overlayCoverage` rides
`PlanningFacts` and `renderConstraintRegister` uses it to draw a distinction
the page previously could not:

- a jurisdiction **never integrated** gets its own note, which names the
  register and the remedy, and is permanent;
- a jurisdiction whose registers **are** read and answered nothing gets a
  sentence saying they are *unchecked rather than clear* — this report's
  retrieval, worth a retry;
- no jurisdiction at all keeps the generic line.

Reading the note map alone could not draw that line: a missing entry meant
"read in full" and "forgotten" indistinguishably.

### 8.3 · What the tests assert, and the bound one of them found

`jurisdictionCoverage.spec.ts` runs the REAL composer over all eight
jurisdictions rather than asserting the map's contents, because the defect was
never in the map — it was in what a page says when the map has no entry. For
each jurisdiction, with nothing asked, the page must say something happened to
the RETRIEVAL, must not claim no control applies, must not carry a rating, and
must name what settles the question.

One bound was found by execution rather than chosen. The rating guard, applied
to the whole page, fails Queensland: its remedy sentence says *"a **limited**
certificate states the zone and the overlays"*, which is that certificate's
own statutory name. So the guard is scoped to the **absence statement**, where
the rule actually bites, and a second, shape-based guard (a level in a table
cell, in a bold run, or applied to a risk noun) covers the whole page. The
rule forbids rating an absence; it does not forbid a jurisdiction's legal
vocabulary, and rewording a statute to satisfy a regex would make the remedy
wrong to satisfy a guard.

The two jurisdiction lists are also asserted to be the same eight —
`PROGRAMME_PUBLISHERS` and `OVERLAY_COVERAGE` — because two lists of
jurisdictions is how one comes to be missing from the other, which is the ACT
defect in its general form.

---

## 9 · What is NOT claimed

- **Nothing in the product reads the national pipeline today**, and the
  measurement is why: Infrastructure Australia publishes fifty machine-readable
  layers through the Commonwealth catalogue and the Priority List is not among
  them. `INFRASTRUCTURE_COVERAGE_LIMITS` continues to name it, which is the
  accepted branch.
- **The Priority List is not claimed to be unpublished.** It is published, as
  a web publication; what is measured is that it is not distributed as a feed
  *there*. A project read off that publication may still travel, through
  `publishedProjectRegister.pure.ts`, labelled *recorded from an official
  publication* — which is a different act with a different label, not this
  register.
- **The accessibility layers are not used**, per §3.1.
- **No per-report call is made to the catalogue.** A live lookup per report
  would spend a network round trip to learn a fact that changes on the scale
  of months — the `amenity_register` lesson (*amenities are a REGISTER, not a
  request*). The reading is a declared, CI-measured fact.
- **The ACT's overlay registers are still not integrated.** What changed is
  that an ACT reader is told so, in the territory's own terms, with the Crown
  lease named. Integrating them is W3.4's work.
