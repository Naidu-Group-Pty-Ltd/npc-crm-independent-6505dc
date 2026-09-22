# Per-jurisdiction planning refinement, and the licences nobody had read

**W3.4.** Status: shipped. Measured 22 September 2026 from CI.

This records two things: the declared provider orders
(`PLANNING_PROVIDERS` / `DEVELOPMENT_PROVIDERS`), and what happened when
four premises about four jurisdictions were asked of the publishers instead
of asserted.

---

## 1. The orders are floor plus refinements, not a fallback chain

`supabase/functions/_shared/planning/planningProviders.pure.ts`.

W3.4's criterion asks for these *"mirroring `AMENITY_PROVIDERS` and
`GEOCODER_PROVIDERS`"*, and mirroring the **shape** is right: one
environment variable, a comma order, unknown names dropped rather than
erred, an empty value falling back to the default so the variable cannot
spell "no providers".

Mirroring the **semantics** would be wrong, and the criterion says so in
the same breath — refinements are added *"above the floor, never as the
only answer."*

`GEOCODER_PROVIDERS` and `AMENITY_PROVIDERS` are **first-that-answers**
chains. One address has one coordinate; one category has one nearest
hospital; a second provider is consulted only because the first could not
answer, and its answer *replaces* what the first would have given.

Planning is not like that. A state overlay layer and a council amendment
register are not two attempts at one answer — they are different facts
about the same lot, and **a draft amendment does not supersede the control
in force**. So:

| | planning | development |
| --- | --- | --- |
| floor (never configurable away) | `state_layer` | `da_register` |
| refinement | `instrument_currency` | `major_projects` |
| refinement | `amendment_register` | |

Three behaviours, each a rule paid for elsewhere:

- **unknown names are dropped**, not erred — `osmAllowanceFor`'s rule, a
  typo must not switch a working surface off;
- **an empty result falls back to the default**, so the variable cannot
  spell "no providers";
- **the floor is PREPENDED wherever configuration omits it**. An operator
  writing `PLANNING_PROVIDERS=amendment_register` gets `state_layer` back,
  at the front, because a deployment that answered the planning question
  yesterday must not answer it with a draft register alone today — that
  prints a draft control as the control in force, which is the one thing
  `planningFacts`' `adopted` / `draft` distinction exists to prevent.

### What is deliberately not a provider

**The operator override.** `planningFacts`' rule 2 gives an audited
operator figure precedence over a layer, labelled `operator_stated`. That
is an order over *answers*, decided where the cells are composed, and it
must not become configurable — an environment variable able to drop it
would silently overrule a person who had recorded a correction.

**Any endpoint, host or layer id.** This file decides which KINDS of
register are consulted and in what order, so adding a jurisdiction's
amendment register is a declaration beside the reader rather than an edit
to the composer (`httpRequest.pure.ts`'s rule for the workflow catalog).

### The order is a configuration; what may be stated turns on what answered

`planning-data-service` publishes both, separately:

```
providers.planning.order                 (configuration)
providers.planning.floorAnswered         (what happened)
providers.planning.refinementsAnswered   (what happened)
providers.planning.consulted             (per provider)
```

`refinementsThatAnswered` returns **nothing** where the floor did not
answer. A refinement answering while the floor did not is a state that has
to be *said* rather than smoothed over: the reading then describes whatever
the refinement happens to cover and nothing about the controls in force,
and calling it a refinement would dress the only reading available as an
addition to a reading that does not exist.

`state_layer` counts as answered where a register **answered**, never
where a reading was *found*. A register that answered and holds nothing
here is `none_at_point` — *searched, nothing found* — and §9's
two-absences rule is that this is a different sentence from never having
asked.

---

## 2. The amendment was being read and thrown away

This is the half that reaches the client's page, and it needed no new
register at all.

`parseNswInstrument` reads the Local Environmental Plan's **amendment
number** and **commencement date** off layer 8 of the *same* Identify the
height and the minimum lot size come from. Its answer went to:

```ts
if (lep) console.log('[planning-data-service] NSW instrument', lep.name, lep.amendment ?? '');
```

`parseNswZoning` publishes `EPI_NAME` and carries **no amendment at all**,
so nothing downstream had any other way to learn it. The constraint
register's Instrument column therefore read

> The Hills Local Environmental Plan 2019

over a record that knew it was Amendment 12, commenced 3 March 2026 —
which is the first question a town planner asks of a height limit or a
minimum lot size.

It is the `instrument_currency` provider now, published on the answer and
rendered by `instrumentCurrencyLine` under the register. Three bounds:

1. **It is a fact about the DOCUMENT, never about the property**, which is
   what lets it be stated with no caveat about what may be built. A spec
   asserts it carries no measurement, no percentage and no word of
   permission.
2. **An absent amendment is omitted, never worded** —
   `stripPlaceholderRows`' rule. There is nothing a reader can do with
   *"the amendment in force was not published"*, and the sentence still
   carries the instrument.
3. **It is drawn only beside a register that returned something**, because
   *"the controls above"* refers to nothing otherwise.

`instrument_currency` and `amendment_register` are deliberately **two
providers**. *"Amendment 12 of the LEP is in force"* and *"a draft
amendment is on exhibition"* are opposite statements about what binds this
lot, and one name for both is how the second comes to be printed as the
first.

---

## 3. Four premises, asked of the publishers

`scripts/market/jurisdiction-layer-liveness.ts`, run from CI on every
build. It writes nothing anywhere — no database, no Supabase, no
credential — and makes no feature query: only metadata endpoints, which
are the cheapest question each service answers.

### What the first run measured

| | address | answer |
| --- | --- | --- |
| SA | `dpti.geohub.sa.gov.au/server/rest/services` | **200**, 131 services across 30 folders, two named `PlanSA` and `ePlanning` |
| WA | `services.slip.wa.gov.au/public/rest/services` | **200**, 0 services across 5 folders, one named `SLIP_Public_Services` |
| NT | `www.ntlis.nt.gov.au/arcgis/rest/services` | **403** carrying `<title>Just a moment...</title>` |
| ACT | `services1.arcgis.com/E5n4f1VY84i0xSjy/arcgis/rest/services` | **200**, **391 services** |

And the readings, after the four corrections below were made and the probe
re-run on the same day:

| | first run | after the corrections |
| --- | --- | --- |
| SA | `catalogue_readable` | `catalogue_readable` |
| WA | `catalogue_readable` — *"lists 0 services"* | `catalogue_readable`, from the folder walk |
| NT | `refused_us` | **`challenged`** |
| ACT | `licence_unverified` | **`catalogue_readable`** (391) |

Three of the four readings changed. That is the point of running the probe
twice on one day rather than shipping the first answer: two of the three
changes are the difference between a sentence about a publisher and a
sentence about us.

### 3.1 `SA_NT_NOTE` was false for South Australia

It read:

> No verified endpoint yet: every candidate host refused this platform's
> scripted egress during integration.

That is a measurement about the **development** egress — the one that
answers 403 to CONNECT for `data.gov.au` and every ABS host, three
registers that answer production perfectly well. §8 of
`PLANNING_CONTROLS_IN_THE_REPORT.md` is the precedent and it is not a
small one: four jurisdictions assumed unreachable answered HTTP 200, all
open licence, no key, and *"overlay mapping … is not retrieved by this
platform"* had been printed on every property in the country from a
premise nobody had tested.

South Australia's state spatial service answers, with a folder literally
named `PlanSA`.

It is **two notes** now, `SA_NOTE` and `NT_NOTE`. One sentence covering
two jurisdictions is a claim nobody can check against either, which is
exactly how it went unmeasured. The old constant is **deleted rather than
aliased** onto `SA_NOTE`: an alias would have served South Australia's
sentence to the Northern Territory, which is the fault the split ends, and
a dormant export is one import away from putting it back
(`ResponsibilityNotice.tsx`'s rule). `planningNotesAreMeasured.spec.ts`
refuses the name.

Both still read `not_integrated`, which is the honest status —
**reachable is not read**, and no parser here has been verified against
either publisher's response.

### 3.2 A bot-protection challenge is not a refusal

NTLIS answered 403 with Cloudflare's interstitial. Read as `refused`, the
note said:

> NT's planning service declined this platform's requests.

which sends an operator to write to the Northern Territory Government
about a decision nobody there made. The remedy is **ours** — a
browser-shaped client, or an agreed path.

`challenged` is its own failure kind, recognised by the **page** and never
the digit, because the same challenge is served under 403, 429 and 503
depending on the edge's mood — and the same 403 is how a service genuinely
declines. Getting it wrong in either direction is a mistake: reading a
real refusal as a challenge understates a finding about the publisher, and
reading a challenge as a refusal invents one.

`bad_request` is the other half of the same lesson. WA's WFS root answered
**400** with `<title>ArcGIS Server Error</title>`: the service exists and
our parameters were wrong. Filed as `unreachable` it read as somebody
else's outage.

The five failures and who they belong to:

| | | whose |
| --- | --- | --- |
| `no_such_service` | 404 / 410 | ours — the address |
| `bad_request` | 400 / 405 / 415 / 501 | ours — the request |
| `challenged` | any digit, a challenge page | ours — automated access |
| `refused` | 401 / 403 from the service | **theirs**, and a real finding |
| `unreachable` | timeout, DNS, 5xx | nobody's |

### 3.3 A catalogue outranks an unstated licence

The ACT's verified organisation lists **391 services** while its one
Territory Plan service answers a `copyrightText` of `"TP"` — three
characters, which reads as `unverified`. Ranked the other way, the note
read *"nothing from it is republished here"* about the jurisdiction whose
zone this product publishes on **every ACT report**.

The principle, not the data: **a licence read from ONE service does not
describe a catalogue of 391.** A stated *restriction* stays above it,
because a publisher's blanket non-commercial terms are a prohibition worth
surfacing whatever else answered.

### 3.4 A directory listing folders and no services has not answered

WA's root lists five folders and zero services, and the note read *"lists
0 services"* — a sentence about our walk wearing the shape of a finding
about Landgate.

The probe walks every folder now, using the publisher's **own** folder
names, so no folder path is typed in this repository. `FOLDER_WALK_CEILING`
is 48, which clears South Australia's measured thirty; past it the walk is
**partial** and says so, because *an absence is only an absence if the
question could have found it* — the rule this programme has now paid for
four times, and a ceiling that truncated SA's folders would reproduce the
`organization_list?limit=1000`-answered-with-25 fault one publisher along.

### What is typed, and what is discovered

A **host** is typed; a layer id never is. An ArcGIS service directory
enumerates the jurisdiction's own list of services, so what gets read is
the publisher's catalogue. The ACT entry is not a guess at all — it is the
ArcGIS organisation `buildActZoningQuery` already reads a *gazetted*
Territory Plan zone from in production, and a spec pins the two spellings
together because a literal at each end is how two ends drift.

`spatial.nt.gov.au` stays in the list although its DNS does not resolve: a
candidate's failure is **printed** rather than hidden, and the NT's other
address is behind a challenge — so removing it would leave one candidate,
and one 404 may never stand for a jurisdiction publishing nothing.

### The exit contract

`abs-register-liveness`' rule, the third time. Three outcomes, one red:

- a host that does not answer, refuses us, or 404s → **0**. A build must
  not be decided by another party's uptime, and a 404 against a typed host
  is a gap this probe's own output is the remedy for — failing would make
  every future host addition a red build until it happened to be right.
- a service that answers and states restricted terms → **0**. That is the
  measurement, and it *confirms* `WA_LICENCE_NOTE` if WA says it.
- a service that answers and this repository cannot read what it sent →
  **1**. The one failure a fixture can never catch.

---

## 4. The licences this product already republishes under

The mirror of stage 1, and the half that matters more.

Stage 1 asks whether four jurisdictions publish anything. Stage 2 asks
whether the **five whose layers this product already republishes** into a
client's commercial PDF say the same thing about their terms that this
repository says about them.

| jurisdiction | this repo claims | claimed in |
| --- | --- | --- |
| NSW | CC BY 4.0 | `planningConstraints.pure.ts` — `NSW_LICENCE` |
| VIC | CC BY 4.0 | `planningConstraints.pure.ts` — `VIC_OVERLAY_LICENCE` |
| QLD | CC BY 4.0 | `planningConstraints.pure.ts` — `QLD_LICENCE` |
| TAS | CC BY 3.0 AU | `planningConstraints.pure.ts` — `TAS_OVERLAY_LICENCE` |
| ACT | CC BY 4.0 | `planningSources.pure.ts` — `ACT_ZONING_LICENCE` |

**None of them had ever been read from the publisher.** A wrong
restriction costs a report a row. A wrong permission puts somebody else's
data in a document that has already been emailed.

### What the publishers said, 22 September 2026

**All five are `silent`. None is contradicted.** Every service answered
HTTP 200 and not one of them names a licence:

| | bytes | what the service says about its own terms |
| --- | ---: | --- |
| NSW | 6,495 | *nothing* — no `copyrightText`, no `licenseInfo`, no description |
| VIC | 734,521 | the WFS capability list; `Fees` and `AccessConstraints` carry no statement |
| QLD | 39,686 | *"© State of Queensland (State Development, Infrastructure and Planning) 2026 · This is an **open data** map service hosting spatial data representing State Planning area boundaries…"* |
| TAS | 6,549 | *"the LIST, State of Tasmania · Planning scheme mapping developed under the Land Use Planning and Approval Act…"* |
| ACT | 3,103 | **`TP`** |

Two of those are worth reading carefully, because they are the cases where
loosening the pattern would be tempting and wrong.

Queensland says *"this is an open data map service"*. That is the State of
Queensland describing its **service**, not granting terms over its data —
and `OPEN_LICENCE_PATTERN` deliberately does not match it, for the same
reason it does not match "free" or "publicly available": a service that is
free to call is not a service whose data may be republished in a
commercial document. Tasmania names the **statute the mapping was made
under**, which says who made it and under what power, and nothing at all
about who may copy it.

So the honest reading is not that anything is wrong. It is that **five
silences together are a different statement from five separate ones**:
every one of these claims rests on something this repository does not
record. The remedy is a line beside each constant naming where its licence
is granted — the publisher's terms of use or its open-data catalogue entry
— and **not** a change to the value. The probe says so in as many words
when every verdict comes back silent, rather than leaving a reader to
count rows.

This is deliberately **not** a build failure. A publisher is under no
obligation to put its licence in a metadata field, and a job that went red
every morning over somebody else's `copyrightText` is a job people learn
to ignore.

Three rules.

**The verdict is three-valued and `silent` is load-bearing.** A
three-character `copyrightText` is *silence about terms*, not a denial of
them — a licence is granted by a publisher's terms of use, its open-data
catalogue entry or its AGOL item, not by a metadata field. Downgrading a
real CC BY 4.0 grant on the strength of it is the same error as upgrading
an unstated licence to permission: the conservative direction is not
"always assume less", it is **never conclude from a field that does not
answer the question**.

**Nothing rewrites a constant.** Only `contradicted` — the publisher
naming terms that are not open — is a defect, and its remedy is a person
reading the terms of use and deciding whether the layer may be drawn.

**`corroborated` is weaker than it sounds**: it means the publisher names
*an* open licence, not *this* one. Version strings drift (`CC BY 3.0 AU`
to `CC BY 4.0`) and the field often carries an attribution statement
rather than a licence name, so asserting the exact string would report
every jurisdiction as contradicting a claim that is substantively right.
What matters for a commercial report is whether republication is
permitted at all.

---

## 5. What is NOT claimed

- **No layer from SA, WA, NT or ACT's overlay registers is read.** All
  four remain `not_integrated` / `licence_restricted`, and
  `OVERLAY_COVERAGE` still records all four as `not_read`. Reachable is
  not read.
- **`WA_LICENCE_NOTE` is unchanged and still unverified.** WA's root
  answered folders-only, so the Planning service's own terms were not
  reached. The note errs conservative — nothing is fetched either way —
  and softening a restriction on no evidence is the one direction that
  could breach a licence. Open.
- **The ACT `copyrightText: "TP"` is recorded, not acted on.** See §4.
- **No licence claim's provenance is recorded anywhere.** All five came back
  `silent`, which is not a contradiction and not a defect — but where each
  CC BY grant actually comes from is written down in no file in this
  repository. Open, and cheap: one line beside each constant. See §4.
- **What WA's folder walk found is printed by the probe and not yet read
  into this document**, because the next increment needs a service NAME and
  the walk is what supplies it. WA went from `catalogue_folders_only` to
  `catalogue_readable` on the second run, so services were found; which of
  them is the Planning service is the first question of the next
  increment.
- **`amendment_register` is integrated for no jurisdiction.** It is
  declared so the reading says it was not answered rather than omitting
  it — `gradeGaps`' rule.
- **`major_projects` answers only where the investment programme already
  did** (Queensland's QTRIP). Nothing new was wired for it.
- **No parser has been verified against an SA, WA or NT response**, which
  is why no zoning or overlay reading is composed for them. That is the
  next increment, and it needs the folder walk's output to name a service.

---

## 6. Where the code is

| | |
| --- | --- |
| the declared orders | `supabase/functions/_shared/planning/planningProviders.pure.ts` |
| the licence and failure readings | `supabase/functions/_shared/planning/jurisdictionLayerProbe.pure.ts` |
| the per-jurisdiction notes | `supabase/functions/_shared/planning/planningSources.pure.ts` (`SA_NOTE`, `NT_NOTE`, `WA_LICENCE_NOTE`) |
| the instrument-currency sentence | `supabase/functions/_shared/planning/planningFacts.pure.ts` (`instrumentCurrencyLine`) |
| the consultation record | `supabase/functions/planning-data-service/index.ts` (`providers`) |
| the CI probe | `scripts/market/jurisdiction-layer-liveness.ts` |
| the specs | `src/lib/reports/__tests__/jurisdictionLayers.spec.ts`, `planningNotesAreMeasured.spec.ts` |
