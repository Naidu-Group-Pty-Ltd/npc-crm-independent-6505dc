# Stage B — the five formats, produced and read

19 September 2026. Branch `claude/reporting-engine-audit-4850hs`, PR #2700.
Stage A's record is [`STAGE_A_RECORD.md`](./STAGE_A_RECORD.md).

Stage B asked for **all five complete revised formats, every page inspected.**
This is what was produced, how, and what reading the pages found.

---

## 1. What was produced, and what it is

Every document below came out of the **real delivery journey** — the report
page, the editor, the template picker, the Publishing & Export panel, the
finalisation and the send — driven in a real Chromium against the running
application, with the final PDF drawn by **WeasyPrint 69.0**, the version
`weasyprint-service/requirements.txt` pins. No credential, no network, no side
effect outside the process.

| tier | document | subject | record |
|---|---|---|---|
| `compass` | Investment Compass | 48 Redfern Street, Cowra | `09f8569e` |
| `financial` | Financial Analysis | 48 Redfern Street, Cowra | `8b0c7c8d` (a fork of `09f8569e`) |
| `strategic` | Due Diligence Report | 48 Redfern Street, Cowra | `bd1b75a7` (a fork of `09f8569e`) |
| `briefing` | Executive Briefing | 1/27D Mitchell Street | `89b451f6` |
| `snapshot` | Snapshot Report | 1/27D Mitchell Street | `8c6edc56` |

**Three of the five are the same property.** The Cowra record has 42 `financial`
and 42 `strategic` children in the retained set and **no** `briefing` or
`snapshot` child, so those two tiers are read on the record that has them. Both
are named rather than left to be assumed.

**These are stored records rendered through the real composition and render
path. They are not fresh generations** — Stage A's §1 says why, and it has not
changed: acquisition runs in deployed edge functions and this branch is
unmerged.

---

## 2. What the journey and the measurement say

| tier | journey | pages | fonts embedded | measurement |
|---|---|---:|---|---|
| Compass | **33/33** | 31 | 11/11 | **PASS**, no issues |
| Financial Analysis | **33/33** | 21 | 12/12 | **PASS**, no issues |
| Due Diligence | **33/33** | 24 | 12/12 | **PASS**, no issues |
| Executive Briefing | **33/33** | 11 | 6/6 | **PASS**, no issues |
| Snapshot | **33/33** | 11 | 5/5 | **PASS**, no issues |

No illegible text, no off-page run, no overlapping run, no mojibake, no blank
page, no hole, no client-facing sentinel, correct page numbering on every
numbered page.

**That is not evidence of completion, and is not offered as any.** §1 of the
standard says so in terms: passing clipping and overlap checks is not
sufficient. What follows is from reading the pages.

---

## 3. What reading the pages found

### 3.1 A figure in a summary strip, on 83 of 89 stored reports — FIXED

Page 4 of the Cowra Compass drew, at display size:

```
INDICATIVE LOCAL GROWTH
3.52%
Annual house price growth, Cowra (latest published)
```

`3.52` appears **exactly once in the whole record** — inside the model's own
prose, as the `::: stat` fence that draws it — and `data_sources.marketData` is
`null`. The words *"(latest published)"* assert a provenance nothing holds.

The directive contract could not see it. `assessChartEvidence` walks lines
beginning `{{`, and a stat card is one of the five `:::` fences
`renderMarkdown` draws. §2 asks for the contract to hold over *"charts, tables,
prose, captions, summary strips and recommendations"*, and a stat card is a
summary strip.

Measured across the 89 retained reports: **85 stat fences, 3 distinct**, and
the growth one is in **83** of them, because it rides the parent's content into
every fork.

| fence | value | record | verdict |
|---|---:|---|---|
| Indicative local growth · *Annual house price growth, Cowra (latest published)* | 3.52 | `marketData: null` | **refused** — `market_not_held` |
| Mining share of workforce · *ABS Census 2021, POA* | 41.2 | demographics + employment answered | kept |
| 10-year population change · *SA2 Moranbah · 2015–2025* | 9.7 | demographics answered | kept |

The rule is the record, not the words: the same module keeps Moranbah's two
figures because that record's producers answered, and refuses Cowra's because
its market producer did not. **Judging a fence is not scrubbing prose** — a
fence is a structure with a kind, a label, a unit, a subtitle and one value,
which is exactly the property that makes a directive judgeable. Removal takes
the whole block, never half a fence, and the prose either side is untouched:
re-rendered, page 4 keeps *"free-standing houses on generous blocks"* and
*"Property fit"* and no longer carries the figure. 31 pages, VISUAL PASS.

The prose half moved with it: `claimSupportRules` rule 2 forbade a proportion
of sales and said nothing about a growth rate, a median, a yield or a vacancy
rate. It names them now, and names the stat card.

### 3.2 A rating spelled out of ten, and a distance nobody measured — FIXED

Two more, found the same way and measured the same way.

**Page 15 drew `7.5 / 8.0 / 6.5`** — *Relative positioning within regional
residential markets*, rating a property, a town and a region, on a record that
issued no grade. §2 names that chart by its numbers. It survived because
`declaresRatingScale` read `max=100` and nothing else, so a scorecard spelled
`unit=/10` was a "measurement". Every declared unit in the 89 retained reports
is one of `%` (94), `km` (87), `/10` (43), `m²` (2) and one each of `min`,
`relative`, `incidents`, `score`, `$` — and **all 43 of the `/10` directives
are that one chart**. A measured series does not announce that it is out of ten
either, so the tell is widened by exactly that form. The `max` is deliberately
NOT read: a proximity chart legitimately declares `max=3`, and condemning it
for the shape of its axis would take a real measurement off the page.

One thing the widening forced: **the scale decides, not the digits.**
`ratingValues` rounds, so `7.5` reads as `8` — and a child carrying a recorded
score of 8 would have "supported" it by a coincidence of digits. The engine
records 0–100; nothing it records is *7.5 out of 10*, so an off-100 scale is
unsupportable outright.

**Pages 10 and 12 drew distances nobody measured.** *Proximity of 48 Redfern
Street to key Cowra amenities* — 1.6 km, ~0.7 km, ~2.0 km — and *Indicative
reach*, set as a five-row **table** of the same figures.
`location_intelligence` on that row is NULL, and the prose says where they came
from: *"Approximately 1.6 km from Cowra's CBD **as indicated by recent sale
listings**"*. §2 is explicit that a search snippet is not a verified source and
that an unsupported dataset must not become a table of unsupported numbers.

`readEvidenceInventory` has computed `location` since it was written and
**nothing had ever read it**. Measured: 88 directives declare a distance or
travel-time unit, **86** on a record whose location producer did not answer.
The two that stand are Muswellbrook's *"road distance to key centres"* and
*"Everyday errands – typical travel times"*, on a record where it answered.

An earlier test asserted the opposite — *"a measurement in kilometres is never
withheld, the record is not what is wrong with it"*. Reading the delivered
document is what changed the evidence, and the test now pins the current rule
with that reasoning recorded in it.

**The whole contract, executed across 91 stored reports:** 411
`unrecorded_rating`, 178 `population_not_held`, 86 `distance_not_measured`, 85
`market_not_held`, 1 `series_withheld` — 43 distinct refusals. Every visual §2
names by its numbers is in that list. Re-rendered, the Compass is 31 pages,
33/33 journey checks, VISUAL PASS, and carries none of `3.52`, `7.5`,
`Core CBD & shops` or `Indicative reach`.

### 3.3 The editorial changes have not reached a document — EXPECTED, AND VISIBLE

Page 4 still runs `Part 03 · Report` in the running head and still carries the
heading *"The report"*. Both were fixed in Stage A. They have not reached the
page because **the seeded catalogue has not been regenerated** — §5.5 of the
Stage A record — and this render is the proof of that caveat rather than a
counter-example to it.

### 3.4 Three findings recorded and deliberately not fixed here

**A tier's companion note is published, drawn by one renderer, and bound by no
master.** `TIER_CONTENT.financial.companionNote` reads *"The location case, the
planning controls mapped over the land and the risk register are set out in the
Investment Compass for this property."* `reportBindingProjection` publishes it
as `report.companionNote` and `render-investment-report-pdf` draws it — but the
delivered PDF comes through the **template** route, and **no master binds it**:
zero occurrences across `scripts/template-library/` and zero in the seeded
catalogue. So the tier that is told to point elsewhere never does.

It matters because of what pages 4 and 5 of the Financial Analysis carry: the
Compass's *Location verdict* and *Property fit* prose, verbatim, listing-portal
citations included. `sectionsForTier('financial')` declares eighteen sections
and none of them is a location section, so the routing is faithful to the
parent — the Compass's **Executive Verdict** section contains those
sub-headings, and the fork maps that section onto *Client Investment Decision
Summary*. Re-cutting the fork's summary routing is a content decision with its
own corpus measurement to make, so it is named here rather than changed at the
end of a session.

**The binding half of this was closed — see §3.11.** The routing half, which is
what the paragraph above is about, is still open.

**The Due Diligence report has no planning, zoning or title section, and no
due diligence checklist.** Its contents lists ten content sections;
`sectionsForTier('strategic')` declares twenty-one. Missing, among others:
*Planning, Zoning and Title Due Diligence*, *Infrastructure and Growth
Context*, *Climate, Environmental, Insurance, Crime and Safety Risk*, *Due
Diligence Checklist*, *Monitoring & Review Plan* and *Final Recommendation* —
on the tier whose stated purpose is *"what must be verified before contract"*.

This is the Stage A root cause reaching its furthest point. The fork can only
route what the parent wrote, and the parent Compass was generated on 11 Sep
with no planning section at all, because the planning register was never asked.
`tierAssembly` does track what it could not place (`unplaced`), so the
machinery is not blind; the content simply was not there to place. The register
answering (Stage A) is what fills it, and this is the clearest single reason
the acceptance journey has to be a fresh generation rather than a replay.

**A timeline asserts horizons for infrastructure nobody retrieved.** Pages 10
and 14 draw *Cowra infrastructure pipeline* and *Amenity & access pipeline* over
`EXISTING / 0-2Y / 3-5Y / 5Y+`. Measured: **95 timeline directives across the
corpus and 0 on a record with a planning producer.** A rule gated on that
producer would therefore refuse 100% of them, with no positive case anywhere to
test it against — which is the "fires on two-thirds of a corpus" hazard the
evidence module warns about, and would read as a ban on a primitive rather than
a judgement. The real control is upstream and already built: once the planning
fetch answers (Stage A), `publishedProjectRules` gives the model dated stages
from a publisher's own pages, and `planningFactBlocks` governs what may be said.
So: measured, and deliberately not made a rule.

**An absence is still rated in the stored risk register.** Page 21 reads
*"Environmental hazards beyond flood/bushfire · Low–Moderate · No specific data
has been provided on industrial uses, contamination or major noise sources"*.
That is the §9 defect the planning doc records by name. The rule is live —
`RISK_EXPOSURE_LEVELS` carries `Not assessed` and the section registry spells
out that a register asked and returning nothing has measured the SEARCH, not the
area — so this document predates it and the regeneration is what fixes it.

### 3.5 What still stands in the stored documents

Every §2 claim traced in Stage A §5.2 is visible on these pages, exactly as
that record says: *"detached, renovated 3-bedroom residential home"*,
*"Bedrooms: 3"*, *"Bathrooms: 1"*, *"Well-presented renovated home"*. All are
closed at the producer and none is rewritten here, because a corrected revision
is a generation.

Two more, recorded rather than fixed, because both need the regeneration:

- **A listing portal is cited for a planning fact.** Page 4 states *"no
  bushfire, flood or heritage overlays on public mapping"*, sourced to
  `[Property.com.au, 119, 120, 137 and 139 Redfern Street profiles]` — four
  OTHER addresses. `planningFactBlocks` rule 4 already forbids writing that no
  overlay applies, and the acquisition ledger and the rebuilt chapter are what
  replace it.
- **The methodology page contradicts page 8.** Page 27 states that *"where
  population, SEIFA or detailed demographic figures are not measured … the
  report avoids quoting numbers"*, while page 8 quotes 12,721 residents and an
  SA2 of 9,150–9,273. One document, both claims.
- **A provenance nobody can check.** Page 27's source notes say local amenity
  references are *"based on Cowra Shire Council facility maps, NSW Department of
  Education school listings and Google Maps location searches"*.
  `location_intelligence` is NULL: no such search was made by this report. The
  crime and cash-rate notes on the same page are correct and checkable (BOCSAR
  by postcode and month, RBA tables), which is what makes the amenity note
  read as equally sourced. The acquisition ledger is what replaces it.
- **The parking count is asserted and then doubted.** Page 3 prints
  *"Configuration · 1 car"*; page 6 says *"1 off-street space recorded in some
  data sources, on-site parking layout should be confirmed at inspection as
  online listings differ slightly"*, and the glance strip carries
  *"⚠ Off-street parking to be confirmed on inspection"*. `property_specs`
  holds `parking: 1`. One record, three confidences.

### 3.6 An interest-only label over a principal-and-interest loan — FIXED

The Financial Analysis prints the loan on one table. On `8b0c7c8d` it read:

| Item | Value |
|---|---|
| Loan type | Interest only |
| Interest-only period | 2 years, then principal and interest |
| Monthly repayment (first year) | $2,806 |
| Annual repayments (first year) | $33,677 |

and the **"Loan structure" row did not print at all.**

$2,806 is not an interest-only repayment on $444,000 at 6.5%. Executed:
`buildLoanLedger` for the record's own stated product and term gives
`firstMonthlyPayment` **2,405.00** and a year-one debt service of **28,860**.
The gap is **$401 a month, $4,817 a year**, on the page a client reads the
loan from.

**The stored figure is the thirty-year principal-and-interest schedule, to
the cent.** Measured on all three independent parents in the retained set —
the only three there are, since the other 89 rows are forks of them:

| record | loan | stored monthly | stated product's schedule | P&I schedule | agreement with P&I |
|---|---|---|---|---|---|
| `09f8569e` Cowra | $444,000 @ 6.5% | 2,806.38 | 2,405.00 | 2,806.38 | $0.0000 |
| `c21ed1fa` | $440,000 @ 6.5% | 2,781.10 | 2,383.33 | 2,781.10 | $0.0007 |
| `c6ed90e6` | $391,200 @ 6.5% | 2,472.65 | 2,119.00 | 2,472.65 | $0.0001 |

That is **QA-04 exactly** — the interest-only label as a display override no
arithmetic ever read — and it was **fixed at the writer and never at the
reader.** `financial-calculator-service` has published `monthlyPayment =
ledger.firstMonthlyPayment`, `annualPayment` and `structure` since the ledger
was wired into it on **15 Sep 2026** (`e6dd0a959`), so the live writer is
correct and every one of these rows predates it. `financialChapters` prints
`structure` in the row directly under "Loan type" *precisely so this reads as
one reconciled fact* — its own comment says so. And **`structure` is absent on
92 of 92 stored reports holding a loan block**, so on every one of them that
row does not print and the reader is left with the contradiction the row
exists to reconcile.

Not a historical artefact: 88 of those 92 are forks made on **18 and 19
September**, and the fork carries its parent's finance block forward
unrepaired.

**The fix is a sentence derived on READ, from the figures and never from the
label.** `describeStoredLoanStructure` runs the record's own terms through the
one ledger and asks which schedule the stored repayment belongs to:

- it matches the product the record names → the row simply predates the field,
  and `describeLoanStructure` prints as it always would;
- it matches principal and interest from month one → **both are stated and
  neither is corrected**, because the loan offer settles which is right and
  this module has never seen it;
- it matches neither → **nothing is derived**. That is `healFinanceIdentity`'s
  rule and the same reasoning: a repair that cannot say which figure is sound
  is just a third opinion.

The tolerance is **$1**, and it is measured rather than chosen: the three
records agree with their schedule by $0.0000–$0.0007 while the two candidate
schedules are $353–$401 apart, so no rounding and no near-miss can decide it.

It lands in `reconcileStoredFinancials`, the one read-path healer the fork,
the binding projection, the cash-flow projection and the fact contract all
already call — so it reaches every reader with **no migration and no stored
byte overwritten**, which the test asserts by comparing the input object
before and after. Executed on `8b0c7c8d`, the row now prints:

> **Loan structure** — Principal and interest over 30 years — the schedule
> these repayments were calculated on. The record separately states interest
> only for 2 years, which the repayment figures do not reflect.

with `$2,806`, `$33,677`, `Interest only` and `2 years` all exactly as stored.
**Nothing here changes a number**, which is what §5's preservation requires:
the projections, the sensitivity and the CGR are untouched, and what changes
is that the document no longer asserts two incompatible things in silence.

`StoredFinancialsReconciliation.loanStructureDerived` and the fact contract's
`integrity.readTimeHealing` carry the basis, so an audit reading can tell a
row that predated the field from one whose figures contradict its label. 9
specs.

### 3.7 The Financial Analysis promises not to restate locality risk, then restates it — FIXED

Page 13 of the Financial Analysis carries a sentence this repository composes:

> The financial exposures the recorded calculation states … **Property and
> locality risks (crime, environmental, planning, condition) are assessed in
> the Property & Location Due Diligence Report and are not restated here.**

Page 14 opens the Consolidated Risk Register with

> *Offence mix (theft, assault, property damage) · Moderate–High · Within the
> 1,144 recorded incidents, theft (330) … Confidence chip: Verified*

and page 15 lists seven planning, flood, bushfire and title actions under **Due
Diligence Actions**. The promise and its breach are one page apart, and the
sentence names crime first.

The machinery to prevent it already existed and was doing exactly what it says.
`splitRiskRegister` classifies each entry from its name and gives the Financial
variant the financial rows — that is QA-31's fix, and it worked: **8 of the
register's 10 entries were dropped from the Financial report.** The two that
survived did so through the module's own deliberate default, *an entry nobody
can classify goes to both variants rather than to neither* — and both are
classifiable.

Measured over every risk register in the stored Compass corpus, parents only
(**3 documents, 3 registers, all recognised, 24 distinct entry names**):

| classification | before | after |
|---|---|---|
| financial | 0 | 0 |
| property | 19 | 21 |
| **both (fall-through)** | **5** | **3** |

The five were `Offence mix (theft, assault, property damage)`, `Drug-related
offences`, `Due Diligence Actions`, `Supply and market concentration` and `Data
gaps and monitoring needs`. The last two are genuinely unclassifiable — one
trips both vocabularies, the other is about the record rather than the money or
the place — and still go to both. The first three are two distinct causes:

**The register does not write "crime" when it breaks crime down.**
`PROPERTY_RISK` carried `crime` and `safety` and none of the words an offence
row actually uses. It now carries `offence`, `offense`, `theft`, `assault`,
`burglar`, `break-in`, `robber`, `vandal`, `stolen` and `violent` — unambiguous
offence nouns only, none of which collides with `FINANCIAL_RISK`. Re-measured,
the two crime rows moved and **nothing else changed**.

**A list of things to do is not an unclassifiable risk.** `Due Diligence
Actions` is a checklist, so "nobody can classify it" is the wrong reading of
it — the module already has the test (`riskDashboardContract`'s QA-32
detector: three or more bullets, most imperative, nothing rated). That test is
now one function both callers share, and an entry that falls through to `both`
whose own body reads as a checklist is admitted by the Due Diligence variant
alone. A checklist about the money still carries financial vocabulary in its
name and is classified before the rule is reached, so only the genuinely
unclassifiable one moves.

Executed on the real parent through `composeForkDocuments` with the production
registry defaults:

| | before | after |
|---|---|---|
| Financial Analysis carries "Consolidated Risk Register" | yes | **no** |
| Financial Analysis carries the offence-mix row | yes | **no** |
| Due Diligence carries both | yes | **yes** |

The Financial variant is left with nothing to print from that register — every
one of its ten entries is a property or locality row, as the register's own
preamble says — and `assembleForVariant` already drops a section a variant has
emptied. The composed `Financial Risk Dashboard` chapter stands alone, and page
13's sentence is now true. 4 specs.

This does not change a stored document: a fork is a generation, so the fix
reaches the next one.

### 3.8 The 40/35/25 evidence-mix donut — FIXED

§2 names it by number, and page 17 of the delivered Financial Analysis still
draws it:

> **Evidence mix** — Official statistics 40% · Major property portals 35% ·
> Local intelligence 25%

on a record holding `data_sources.marketData: null`,
`location_intelligence: NULL` and `demographics_data: NULL`.

It survived the evidence contract, and the reason is instructive. Executed on
the real Cowra record, `enforceChartEvidence` took the two occupier-mix donuts
(`population_not_held`) and **kept this one**, because "Official statistics",
"Major property portals" and "Local intelligence" are neither a population
subject nor a market one. A test written earlier in this branch pinned that
deliberately — a population rule that fired on it would fire on every cost
breakdown too — and that reasoning was and is correct. What was missing is
that a *different* rule should take it.

**Nothing in this system counts what share of a report's statements came from
which class of source.** The acquisition ledger records which producers
answered; it says nothing about the composition of the finished prose, and
turning producer outcomes into a percentage of "evidence" would be a second
invention on top of the first. So a chart about the report's own sourcing has
no denominator on any record, ever — which makes it unlike every other verdict
here, none of which can be settled without asking the inventory.

It earns its own verdict because of what a reader does with it: it is the one
chart used to decide how much to trust every other number in the document, and
it was the least supported thing in it.

Measured across the stored corpus — **11 distinct documents, 216 directives,
102 of them titled, 64 distinct titles** — the rule is judged on the **title
alone**, the conservative reading, and matches five:

| kind | title | ×
|---|---|---|
| donut | Evidence mix | 3 |
| donut | Primary data foundations | 1 |
| heatmap | Evidence quality at the property level | 1 |

Every one is a self-assessment; nothing else in those 64 titles matches. A
label that happens to say "confidence" inside a chart about something else —
`{{wheel: … labels=Crime,Environmental,…,Data confidence | title=Composite
risk}}` — is not caught, and a test pins that.

The claim type is not part of the rule, because the reason does not depend on
it: a share of the report's sourcing, a rating of its reliability and a grid of
ticks against "High / Moderate / Limited" are the same assertion in three
primitives. Across the corpus the contract now removes 79 of 216 directives:

| verdict | × |
|---|---|
| `unrecorded_rating` | 51 |
| `population_not_held` | 18 |
| **`self_assessment_not_measured`** | **8** |
| `distance_not_measured` | 6 |
| `market_not_held` | 5 |
| `series_withheld` | 1 |

The eight include three copies of `Data resolution mix`
(`bars: Address-specific data 60, Suburb/postcode data 30, General market
context 10 | max=100`), which the rating guard already removed for declaring a
0–100 scale — two rules, two independent reasons, and the self-assessment one
still holds if the `max=100` is ever dropped. 5 specs, and the earlier test is
renegotiated to pin **both** rules rather than deleted.

### 3.9 Three pages of distances nobody measured — FIXED at the producer

Pages 14 to 16 of the Due Diligence Report are the most detailed pages in the
whole set, and the record behind them holds `location_intelligence: NULL` and
`data_sources.locationIntelligence: null`.

> Mulyan Public School is approximately **0.5 km** from 48 Redfern Street …
> **as confirmed by Domain's school catchment summary for this address**.
> Cowra High School sits around **1.1 km** … Holman Place School is listed at
> about **0.9 km** … Cowra District Hospital … at roughly **2–3 km based on
> town layout** … reached in around **5–10 minutes** by car … Cowra's main
> retail strip … around **1.6 km** … **according to local agency
> descriptions** … Coles, Woolworths and Aldi … generally about **1.5–2.0 km**
> … Wyangala Waters … around **40+ km** away … **Cowra Bus Service's town
> timetable lists a stop at Redfern & Bourke Streets**.

Not one of those was retrieved. The Domain sentence is worse than the rest: it
attributes a figure to a provider that answered nothing for this report, which
is exactly what §2 means by *"a non-null provider object does not establish
that its data supports a particular number"* — except here the object is null
too.

**`inv.location` gated a chart rule and no sentence rule at all.** Earlier in
this branch it was wired into `distance_not_measured`, which refuses a chart
declaring a distance unit where no location producer answered — measured then
at **88 declared, 86 refused**. The prose counterpart was missing, and prose
is where almost all of it is: three pages against one directive.

So `claimSupportRules` gains a rule in the same two-branch shape as its
population and market rules, and it is inserted as **rule 6** — after the
source-note rule it is closest to — so rules 1 to 5 keep the numbers this
repository's own documentation cites. A test asserts the list stays numbered
once and in order on every inventory.

**The prohibition is on the measurement and the attribution, never on the
place.** A regional town has a hospital and the report may still say so, may
still describe what a centre of this kind offers, and may still name a
facility as somewhere that exists. What it may not do is put a distance, a
travel time or a catchment on it — in kilometres, in metres, in minutes, as a
range (`2–3 km`, `5–10 minutes`) or softened (`a short drive`, `within walking
distance`, `just minutes from`) — or hang a provider's, a timetable's or a
council map's name on a figure none of them supplied. That is the line
`placesAvailability` already draws at the producer, where a failed lookup is
`null` and never a measured zero, carried into the sentence.

It also names the specific move this document made: *"roughly 2–3 km **based
on town layout**"* is an estimate disclosing its own method, and estimating a
distance from a town's shape or from a map the model has seen is inventing it.

4 specs. This changes no stored document — the rules govern generation.

### 3.10 The Briefing and the Snapshot — every finding is dated, and closed

Both condensed documents are the oldest in the set (`created_at`
**2026-09-04**) and both are children of one parent, `0478c410`, which is not
in the retained fixtures. Read page by page, everything they carry is a class
this programme has already closed, and the dates prove it rather than assert
it:

| what the page says | class | closed |
|---|---|---|
| p4 *"Note: Specific market activity metrics … were not provided numerically in the original report"* | the condenser narrating its own input to a client | the condense prompt names **this row by id** in the comment beside the fix |
| p7 *"Total Score: 60/100"* beside p3's *"Graded B at 62 out of 100"* | a score the engine never recorded — it holds `[62, 75, 65, 58]` | `scoreClaims.pure.ts` **born 2026-09-15**, eleven days after this row |
| *"Mining & Energy 30-32% (approx. 3,500 workers)"*, *"Agriculture 10% (indicative)"* ×4 | a workforce share with no denominator, hedged rather than withheld | rules 1, 2 and 4 |
| *"5-10 min drive"*, *"Short drive"*, *"7-8 min drive"*, *"within a 5–10 minute drive"* | distances | rule 6 — and see below |
| *"Flood · Moderate"*, *"Bushfire · Moderate to High — Regional NSW locations **can** sit within designated bushfire-prone land"* | a rating inferred from the general character of an area | §9's *an absence may not be rated* |
| *"12,272 people"*, *"median age 35"*, *"owner-occupation 59–60%"*, *"couple & family households 64%"*, *"around 17,000 residents"* | population, on a record whose `demographics_data` is **NULL** and whose `data_sources.demographics` did not answer | rule 1 |

**`suppressUnrecordedScores` is already wired into the condenser** and takes
`parentContent`, so a claim the parent made is left as the parent's. Executed
without that argument it removes exactly one line from this Briefing — *"Total
Score: 60/100 (Overall Risk Score)"* — and nothing else, on either document. It
did not run when this row was condensed because it did not exist.

**Neither condensed document carries a single `{{…}}` directive**, so the chart
half of the evidence contract has nothing to act on there — measured, not
assumed.

Two things the reading did add:

**The Muswellbrook record is the positive case for rule 6.** Its inventory is
`demographics=false, marketData=false, **location=true**`, with a full
`location_intelligence` object — commute, schools, amenities, transport,
walkScore, healthcare, coordinates. So the new location rule's *did answer*
branch is not hypothetical: on Cowra it forbids a distance outright, on
Muswellbrook it asks for the record's own measurement in the record's own
units. The two branches are exercised by two real records.

**Page 10 writes the evidence mix as a sentence.** *"Evidence mix underpinning
this report: Official statistics **40%**, Commercial property data **35%**,
Local intelligence **15%**, Advisory interpretation **10%**."* §3.8's verdict
judges directives, and this is prose — the same relationship rule 6 has to
`distance_not_measured`, one level down. Measured: **1 prose line across the 11
stored documents, against 5 directives.** It is added to **rule 5** rather than
given a rule of its own, because rule 5 is already the provenance rule and this
is a claim about provenance; the sentence names the shapes the corpus writes
(`evidence mix`, `data resolution mix`, `primary data foundation`, a
reliability rating) and says what to do instead — name the sources actually
used. 1 spec.

**And not everything in these documents is unsupported, which the record should
say.** The Due Diligence crime register (p18) is the counter-example: *"1,144
incidents over the most recent 12-month window, up from 1,111 in the previous
year (+3%), with a rate of 10,891 per 100,000 residents versus a NSW
postal-area average of 7,598"*, with the offence breakdown beneath it and a
`Verified` chip that is earned — BOCSAR answered, by postcode and month. Its
bushfire row is better still: *"block-level bushfire exposure for 48 Redfern
Street is not published in the available summary data … Confidence chip:
Planned verification"*, which is an absence named as an absence and not rated,
exactly as the standard asks. The contrast is the point — the same table holds
both, and the difference is whether a register answered.

### 3.11 The sentence that says where the rest of the analysis is — FIXED

§3.4 recorded this and did not fix it, because the reason given there was about
the harder half of the same page: re-cutting the fork's summary routing, so
that the Financial Analysis stops carrying the Compass's *Location verdict* and
*Property fit* prose. That is still a content decision with its own corpus
measurement to make, and it is still open.

The other half needed none of that, and it is one binding.

`TIER_CONTENT.companionNote` is the sentence each tier uses to send a reader to
its companion document:

| tier | what it says | chars |
|---|---|---:|
| `compass` | "Purchase costs, yield, loan structure, cash flow and the ten-year projection are set out in the Financial Analysis Report for this property." | 140 |
| `financial` | "The location case, the planning controls mapped over the land and the risk register are set out in the Investment Compass for this property." | 140 |
| `briefing` | "The full assessment is in the Investment Compass, and the financial position in the Financial Analysis Report." | 110 |
| `snapshot` | "The location case is in the Investment Compass, and the full modelling in the Financial Analysis Report." | 104 |
| `strategic` | "The financial position is set out in the Financial Analysis Report for this property." | 85 |
| `composite` | — | — |

`reportBindingProjection` publishes it as `report.companionNote`, and
`render-investment-report-pdf` draws it. The delivered document comes through
the **template** route, and **no master bound it** — zero occurrences across
`scripts/template-library/`, zero in the seeded catalogue. `SAMPLE_REPORT_DATA`
has carried a `report.companionNote` since the tier split, so the sample was
written as though the binding existed. It did not. **The tier that is told to
point elsewhere never did, on any page of any document a client opened.**

It matters more since seed v14, not less. v14 made the three financial pages
conditional on `report.drawsFinancialModelling`, and the contents block draws
the pages that actually rendered — so a Compass's contents page correctly stops
listing *Financial position* and *Ten-year projection*, and nothing then said
where they had gone. A reader looks for a section, does not find it, and is
told nothing.

**Where it goes, and why it is not the section heading's standfirst.** The
first attempt hung it on `sectionHeading`'s optional `standfirst`, which is the
treatment it wants and already measures its own depth per header kind. Building
the fifty masters counted the result: **32 of 50 carried it and 18 did not.**
`sectionHeading` says why, in the module itself — *"only the `standfirst` kind
draws one; `bare`, `decimal` and `eyebrow` drop it"*. That is right for a
section opener's subtitle, which is styling, and wrong for a cross-reference.
`hasContents` records the identical rule one level up, from the identical
cause: `toc_style: none` was a statement about a family's decorative index and
it silenced the contents page outright, so ten masters shipped client documents
with no way to navigate them. **A family's styling decides how a thing is
drawn, never whether the document carries it.**

So it is its own block, `companionNote()` in `investmentCompass/blocks.ts`,
drawn by every master in exactly the treatment the `standfirst` kind would have
given it — italic, muted ink, body size, 1.5 leading — with its height from
`standfirstDepth`'s own arithmetic rather than a second opinion about the same
sentence.

**Above the contents list, never below it.** `contents()`'s row count is a size
hint with eight rows of slack, because the real list is the document's page
count and not its section names; a document whose list outruns the hint draws
DOWN into the space beneath, which therefore has to stay empty. Measured across
the fifty masters, the room below the contents block runs from **122 pt**
(Luxury Editorial's third variant) to **301 pt**.

Measured after the change, by building all fifty and by rendering them:

```
overflow records:                              0 of 50
Contents pages binding report.companionNote:  50 of 50
note drawn above the list:                    50 of 50   (gap 32-53 pt)
sentence present when the tier publishes one: 50 of 50
sentence absent, and no `{{...}}` leak, without: 50 of 50
reserved lines for the 140-character note:     2 on every master
```

Four specs pin it: every master binds it, it sits above the list, it draws the
sentence and nothing at all without one, and `COMPANION_NOTE_CHARS` is the
exact longest note `TIER_CONTENT` publishes — so the day a tier's sentence is
rewritten longer than the masters reserve for it, the build fails rather than
printing over the contents list.

---

---

## 4. Every page, read

Stage B asked for all five complete revised formats with **every page
inspected**. That is done, and this is the tally:

| document | pages | where the reading is |
|---|---|---|
| Investment Compass | 31 | §3.1–3.3, and Stage A §2 and §5 |
| Financial Analysis | 21 | §3.4, §3.6, §3.7, §3.8 |
| Due Diligence Report | 23 | §3.4, §3.5, §3.9 |
| Executive Briefing | 11 | §3.10 |
| Snapshot Report | 11 | §3.10 |
| | **97** | |

**Six defects were closed at the producer during the reading**, each measured
across the corpus before a line was written: §3.1 a figure in a summary strip
(83 of 89 records), §3.2 a rating out of ten and a distance nobody measured,
§3.6 an interest-only label over principal-and-interest figures (92 of 92
records), §3.7 a crime row and a checklist in the financial report, §3.8 and
§3.10 a chart and a sentence about the report's own evidence, §3.9 three pages
of distances on a record that measured none, and §3.11 the sentence saying
where the rest of the analysis is, published for every tier and bound by none
of the fifty masters.

**What every one of them has in common** is that the machinery was already
there and the gap was one step away from it: a chart rule with no prose
counterpart, a classifier missing the words a register actually writes, a
disclosure field the writer publishes and no stored row carries, a population
rule that correctly declined a chart no other rule then took, a sentence the
projection publishes and no template binds. None of the six needed a new
system.

---

## 5. What Stage B has not closed

1. **No fresh generation**, for the reason Stage A gives. Every fix above
   reaches a document at its next generation, and none rewrites a stored one.
2. **The seed regeneration is Stage C's** — `STAGE_C_RECORD.md` §2 records it
   as v15, which carries §3.1, §3.2 and §3.11's master changes. Until that
   migration is applied, no master change is on a page.
3. **`briefing` and `snapshot` are read on a different property**, because the
   Cowra record has no child of either tier. Both are also the oldest documents
   in the set and predate every guard — §3.10 dates each finding rather than
   leaving it to be assumed.
4. The findings in §3.4 and §3.5 are recorded and not fixed, with the reasons
   given there.
5. **The loan-type contradiction is disclosed, not resolved.** §3.6 makes the
   record say what it holds; which product the borrower actually has is a
   question for the loan offer, and no repair may answer it from here.
6. **Two questions are named and deliberately not made into rules**, because
   the corpus holds no case to test either against:
   - A retrieved growth reading that disagrees with the accepted CGR. Page 8 of
     the Financial Analysis says *"annual capital growth readings around the
     low-to-mid single digits"* while `assumptions.capitalGrowth` is **0.1** and
     pages 13 and 16 name that figure correctly. Today `marketFactRules` rule 1
     forbids the sentence outright, because nothing was retrieved — so the
     document is closed. What is not closed is the case where a series IS
     retrieved and differs from the modelled rate, which no record in the corpus
     has.
   - Whether condensation can introduce a claim its parent did not make.
     `condense-investment-report` carries its own hand-written prohibitions and
     not `claimSupportRules`; the corpus has two condensed documents, from one
     parent, both predating the current prompt, so the hazard cannot be measured
     from here. A fresh condensation under the current prompt is what settles
     it, and that is Stage C's acceptance journey.
