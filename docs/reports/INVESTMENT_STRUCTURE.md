# Investment report structure — the commentary strip (v3.0)

The Investment Location & Property Fit report ("Compass") is the highest-volume
document the product makes: **1,187 rows in `investment_reports`, 5–18 a week**.
This records why its structure changed in August 2026, and the production
measurements the change was made against.

Read this before touching `_shared/compassSectionRegistry.ts`,
`_shared/compassPostProcessor.ts`, `_shared/compassQAValidator.ts` or the prompt
in `generate-investment-report`.

---

## 1. What the document was

Measured against the live table, not against a fixture. Recent Compass reports:

| | per report |
|---|---:|
| Sections declared | 17 |
| Headings emitted | **96** (24.6 `##`, 68.1 `###`, 2.9 `####`) |
| Figures (`{{…}}` directives) | 53 |
| Table rows | 137 |
| **Editorial labels** | **90** |
| Characters inside those blocks | **24,713 — 16.9% of the document** |
| Total | 125,297 chars ≈ **86 rendered pages** |

The registry declared a **38–42 page band** and per-section word caps summing to
**9,170 words**. The report ran at roughly **21,000 words and 86 pages — 2.3× its
own budget** — and a sixth of it was the document explaining itself.

The five labels, counted across 56 reports:

| label | occurrences |
|---|---:|
| What This Means | 1,075 |
| NPC view | 322 |
| What to watch | 307 |
| Why this matters | 224 |
| Key takeaway | 204 |

---

## 2. Three reasons, and the third is the useful one

### The prompt contradicted itself

Two instructions said *after everything*:

- the **system message**, on every call: *"After any table or data point, add a
  'What This Means' paragraph explaining the practical implications"*
- the **per-section task**, on every section: *"After every visual/table/
  significant data point, include only a brief 'What This Means' explanation"*

Two said *one per section* — `compassStyleRules` and the Compass-40 overlay's
*"ONE 'What This Means' box per section maximum — not after every few
paragraphs"*.

The local trigger beats the global cap. The prompt also demanded *"3–4
visualisations per chapter"* and production delivered 53 figures a report; 53
figures × "after every visual" ≈ the 36 *What This Means* blocks observed. The
arithmetic is exact.

The other three labels came from one place: a **"MANDATORY WRITING STYLE — every
narrative section uses this 4-block format"** (Key takeaway → Why this matters →
What to watch → NPC view), mirrored as a comment in the registry.

### The enforcement existed and never ran on this report

`compassPostProcessor` and `compassQAValidator` already implemented per-section
word caps, a decision-box cap, the page-pressure ladder and a page-band check.

**Neither had a caller in the generation path.** Both were imported only by
`condense-investment-report`, which produces the derived snapshot and briefing
variants — 44 rows. `generate-investment-report`, which produced all 1,124
Compass reports, called neither.

The only gate that did run was `validateSectionContent`, and every rule in it
pushed one way: a penalty for being **too short**, a penalty for **fewer than
three headings**, and **no upper bound of any kind**. `maxWordCount` never became
a limit — it only sized the model call, at `maxWordCount × 4` capped at 5,000 and
then multiplied by **1.6** again for Compass, handing a 650-word section about
4,160 tokens ≈ 3,100 words. **4.8× its own cap.**

### Where it did run, it was looking for the wrong string

```ts
const DECISION_BOX_RE = /^(#{2,4})\s*(what this means|what this means for you|takeaway)\s*$/i;
```

Heading form only. Counted across 56 production reports:

| form | occurrences |
|---|---:|
| `**What This Means**` (bold lead-in) | **4,161** |
| `### NPC view` (heading) | 424 |
| `What to watch` (bare line) | 458 |
| **total** | **5,043** |
| **matched** | **11 — 0.2%** |

82.5% of labels are the bold form the regex could not see, and three of the five
labels were not in its alternation at all. Production also writes the separator
**inside** the emphasis — `**Key takeaway:**`, not `**Key takeaway**:` — which is
its own trap for anything matching this class.

---

## 3. What the document is now

Eleven client-facing sections plus back matter, ~23 pages, ~5,010 words.

| # | Section | Pages | Words |
|---|---|---:|---:|
| 1 | Cover Page | 1 | 60 |
| 2 | Executive Verdict | 2 | 450 |
| 3 | Property & Locality Snapshot | 2 | 300 |
| 4 | Why This Location Matters | 3 | 700 |
| 5 | **Demand Drivers** | 3 | 750 |
| 6 | **Amenity & Access** | 3 | 600 |
| 7 | Market Positioning | 2 | 450 |
| 8 | Property Fit Within the Suburb | 2 | 450 |
| 9 | Risk Dashboard | 2 | 500 |
| 10 | Due Diligence Checklist | 1 | 250 |
| 11 | Final Recommendation | 1 | 250 |
| — | Appendix, Source Notes & Disclaimer | 1 | 250 |

**Demand Drivers** merges population/housing demand, tenant & buyer profile and
employment & economic linkages — one question, who wants to live here and why.
**Amenity & Access** merges education, retail/healthcare/lifestyle and transport
— one question, what is nearby and how long it takes to reach. Both merges are
consolidations the v2.0 `purpose` strings already demanded ("RENDER ONCE", "Do
NOT repeat … elsewhere") and that the prompt could not deliver while each was a
separate section.

**Client Reading Guide is removed.** It was a prose contents page — 5,068 chars
listing the sections that followed with a gloss each, ending in a *What This
Means* restating the reading order — and the typeset document has a real
contents page.

The writing style is now three steps: state the finding in the sentence that
introduces the data, show the data, move on.

---

## 4. The rules that bite

**A label is removed with the paragraph beneath it, and never a figure.**
`stripEditorialBlocks` stops at the first structural line — a heading, a `{{…}}`
directive, a table row, a list item or a rule. A strip that swallowed a figure
would remove the data *and* the commentary, which is strictly worse than leaving
both. Verified against real report text: 4 figures and 5 table rows in, 4 and 5
out, 6 labels in, 0 out.

**The inline form keeps its sentence.** `**Key takeaway:** Banora Point sits in a
coastal growth corridor…` is a finding with a label in front of it, not a
restatement. The label comes off; the sentence stays. Blanket removal would have
gutted the Final Recommendation, which was **39% editorial by character** — the
four labels *were* that section. Its prompt was rewritten to produce a verdict
label, unlabelled rationale and an actions list before the strip was enabled.

**A labelled heading is removed whole, whatever trails it.** Production writes
`### NPC view – overall recommendation`. Read as the inline form it would lose
the `###` and leave "overall recommendation" hanging above the opinion it was
titling.

**Whole-line beats inline.** `**What This Means:**` matches both patterns, and
the inline one can treat the trailing `**` as its content — leaving a bare `**`
on the page. Block form is tested first.

**A report banked under a different section list is regenerated, not resumed.**
`last_completed_section` is a raw index into the *current* registry, so a row
stopped at 8 of 17 resuming under the 12-section list would splice sections 8–11
of the new structure onto 0–7 of the old — a document with two Population
sections, no Demand Drivers, and nothing on the row to say so. `total_sections`
records which list the banked content was written against, and a mismatch starts
the report again. It costs one regeneration, for in-flight reports only.

**The row's `total_sections` beats the registry everywhere it is read.** ~1,120
stored rows carry 17. If the registry fallback won, every completed one would
read as over 100%.

**A section name is load-bearing downstream.** No current report numbers its
sections, so `TITLED_SECTION_CHARTS` attaches infographics **by title** and
`reportSplitRegistry` routes the derived FIN/PLDD variants by heading substring —
and `fork-investment-report` drops an unmatched heading from both variants
silently. Both were updated with the new names. `Demand Drivers` matched no split
route at all before that change.

**A merged section claims at most two charts.** Demand Drivers matches three
patterns' worth of titles, and charts are claimed once each across the document.
Without `MAX_CHARTS_PER_SECTION` a merged section would take three, on a page
that already carries the model's own two figures.

---

## 5. Verification

```
npx vitest run src/lib/reports src/lib/reportDesign src/lib/brandDesign src/components/reports
deno test --allow-net --allow-read supabase/functions/condense-investment-report/compassPostProcessor_test.ts
npm run lint && npm run audit:style && npm run build
node scripts/security/check-edge-functions.mjs
```

The specs that carry this change:

- `src/lib/reports/__tests__/compassEditorialStrip.spec.ts` — the strip against
  the three forms production writes, and against what it must not touch. Every
  fixture is copied from a stored row rather than invented, because the defect
  being replaced was a matcher written against an imagined shape.
- `src/lib/reports/__tests__/compassRegistryParity.spec.ts` — the two registry
  copies, field by field, plus the structural invariants (page budget inside the
  band, word budget under 6,000, no `allowDecisionBox`).
- `src/lib/reports/investment/__tests__/currentFormat.spec.ts` — charts still
  reach the merged sections.
- `src/components/reports/progress/__tests__/selectors.pure.spec.ts` — a row's
  own `total_sections` wins over the registry.

**Measuring a real report.** The label matcher can be run against production
directly, which is how the 0.2% figure above was taken:

```sql
with r as (
  select id, report_content c from investment_reports
  where report_variant='compass' and report_content is not null
    and created_at > now() - interval '120 days'
), l as (select r.id, t.l line from r, lateral unnest(string_to_array(r.c, E'\n')) t(l))
select count(*) filter (where line ~* '^\s*(#{1,6}\s*)?(\*\*|__)?\s*(what this means|npc view|what to watch|why this matters|key takeaway)\s*[:：–—-]?\s*(\*\*|__)?\s*[:：–—-]?\s*$') as labels,
       count(distinct id) as reports
from l;
```

Simulating the strip's exact line rules over 12 real reports removes **13.9% of
characters**, 97 label lines each.

**Fixtures must move with production.**
`src/lib/reports/investment/__tests__/fixtures.ts` `currentFormat()` builds the
document the generator writes *today*, and `INVESTMENT.md` §5 and §7 are both
about what happens when it and production disagree — a fixture 8.3× thinner per
section than the real thing, and every page-economy number in the programme
taken against it.

---

## 6. What this change did not do

- **The 1,187 stored reports are untouched.** No backfill, no re-render, no
  regeneration. A client holding a PDF keeps that document.
- **The render side is untouched.** `COVERAGE.md` records that the design system
  renders **0 of 1,162** investment reports — the markdown *is* the report on
  every live path, so this lands entirely in the generator.
- **The `{{…}}` chart vocabulary stays.** The figures are data; `INVESTMENT.md`
  §1 is the record of wiring them to real chart primitives. Only the count is
  capped, at two a section.
- **The financial exclusions are unchanged.** The Compass hard rules keeping
  price, yield and LVR out of this report are exactly as they were.
- **`condense-investment-report`'s `TIER_CONFIG` is unchanged.** The snapshot and
  briefing variants re-generate from their own legacy prompts against legacy
  heading names and are decoupled from this registry. They will drift further;
  that is separate work.

---

## v4.0 — the document has room for what it retrieves (17 Sep 2026)

> "In its current form, it is simply not good enough. … the Zoning, Planning
> and Infrastructure sections are simply not good enough at the moment. The
> information being incorporated does not provide the client with sufficiently
> solid, meaningful or valuable information … Please refer back to the previous
> legacy report that used to be generated, which was approximately 80 pages or
> more, and use that as a source of inspiration in terms of the level of
> detail, depth, professionalism, educational value and overall quality."
> — the owner, 17 Sep 2026

### The two things that were measured

**Zoning had no section.** `Zoning` and `Planning` were `sourceHeadings` of
`compass.riskDashboard` — a 500-word section whose own `purpose` reads *"The
table IS the section — no prose restating rows"*. So the planning controls this
platform retrieves had nowhere to be explained, and the reader got a row in a
risk table.

**The legacy benchmark, measured rather than remembered.** `df813535` (Lot
2410 Prescott Road, Mambourin) is 338,471 characters — the longest stored
report — and it is **the same 27-section document written three times** by a
resume defect. One pass is ~110,000 characters across 27 sections. The 17 Sep
2026 Compass is **38,648 characters across 11**, against a v3.0 word cap of
5,010.

Its per-section weight is where the difference is: Demographics & Demand
Drivers 11,308 characters, Environmental Risks & Climate 10,538, Recreational
Amenities 7,699, Schools & Education 7,510, Loan Structure 7,397, Transport
3,719, Crime & Safety 3,060. The Compass folded schools, healthcare, retail,
recreation *and* transport into one 600-word `Amenity & Access`, and climate
and crime into a risk table.

### The v4.0 list

| # | Section | Words | Was |
|---|---|---|---|
| 1 | Cover Page | 60 | — |
| 2 | Executive Verdict | 550 | 450 |
| 3 | Property & Locality Snapshot | 350 | 300 |
| 4 | Why This Location Matters | 900 | 700 |
| 5 | Demand Drivers | 950 | 750 |
| 6 | Amenity & Access | 700 | 600 (also held transport) |
| 7 | **Transport & Connectivity** | 450 | merged into 6 |
| 8 | **Planning, Zoning & What Is Mapped Over the Land** | 900 | *nowhere* |
| 9 | **Environment, Climate & Safety** | 650 | merged into 12 |
| 10 | Market Positioning | 600 | 450 |
| 11 | Property Fit Within the Suburb | 550 | 450 |
| 12 | Risk Dashboard | 550 | 500 (also held 8 and 9) |
| 13 | Due Diligence Checklist | 350 | 250 |
| 14 | Final Recommendation | 350 | 250 |
| 15 | Appendix, Source Notes & Disclaimer | 300 | 250 |

**8,150 words across a 34-page budget** — about 240 words a page, which is what
a page carrying a table or a figure holds. The ceiling is what the retrieved
evidence can carry honestly, not a target: a section still writes what it has
and stops.

### Why the merges were right and are now wrong

v3.0 merged those sections because they repeated each other, and that was the
correct call on the evidence of the time. What changed is that there is now a
register behind each one:

- **Planning** — `planningConstraints.pure.ts` returns the zone, the height,
  the floor space ratio, the minimum lot size, heritage, bushfire, flood,
  landslip, acid sulfate soils and the regional plan, each with its instrument,
  its clause and its currency date, and `planningControlGuide.pure.ts` explains
  what each one obliges.
- **Transport** — `transport_stops` holds 185,177 GTFS stops across four
  networks, with `parent_station` grouping.
- **Environment, Climate & Safety** — four states of recorded crime and the
  climate readings.

**A section with nothing behind it should be merged. A section with a register
behind it should not.**

### Two rules the split turns on

**A heading belongs to exactly ONE section.** Listed in two, the partition
resolves it to whichever comes first and the other silently loses it — and
`fork-investment-report` drops an unmatched heading from both forks without
saying so. `compassRegistryParity.spec.ts` now fails on any clash (two legacy
aliases are grandfathered) and separately asserts that every legacy heading is
still routable SOMEWHERE, which is the rule that actually protects the forks.

**Both registries move together.** `sectionRegistry.pure.ts` is a second
registry with its own per-tier placements, and its DECLARED GAP for planning
is closed by this change. Its reasoning is kept verbatim because it was right
when written — *"the record holds no planning data … the fix is upstream of the
reporting engine and cannot be made here"* — and the fix was made upstream. The
strategic tier keeps `producer: null`, because a Due Diligence planning section
also needs title and easements, which no register here reads, and half a
section declared as a whole one is the failure that registry exists to stop.

### The resume path needed no change

`total_sections` records which list the banked content was written under, and a
mismatch against the current registry forces a fresh regeneration rather than a
resume — the guard that already existed for exactly this. A report banked under
eleven sections will not resume under fifteen.

### The second structure contract, found after the first was removed

Removing the legacy 38-page template from `propertyPrompt` was not the whole
job. A **second** one was sitting behind it: the COMPASS-40 overlay, ~3.9 KB,
built as `compass40Banner + prompt + compass40Overlay` — so it was both the
first and the last thing the model read, and appended text is never trimmed.

It was written against the legacy document and never revised:

- Its KEEP/COMPRESS lists named sections the canonical registry does not have
  (*Population & Development Trends*, *Suburb Character & Lifestyle*,
  *Property-Level Information*, *Risk Summary*, *SEIFA / Socioeconomic
  Profile*, *Employment & Industry Composition*).
- It gave **page** caps against the registry's **word** ceilings —
  *"Transport — consolidate … into ONE 2–3 page section"* beside a 450-word
  budget, which is about 1.5 pages. Length contradictions are what produced
  the 2.3×-over-budget documents this file already records.
- It named **neither** of the two sections v4.0 added. A model could be asked
  for *Planning, Zoning & What Is Mapped Over the Land* — 900 words, the
  section the owner said was not good enough — and handed, last of all, a list
  of this document's sections that did not contain it.

It is deleted. **Removing a ceremony must never remove a control**, and every
control it held was already in `buildCanonicalTemplateContext`, which is
injected on the same runs: the forbidden editorial labels in all three forms
with no permitted number, the financial exclusions, the placeholder and
citation prohibitions, render-each-topic-once, no transition paragraphs, the
word ceiling with its sub-heading and visualisation caps, the bed/bath/car/
land-size and property-type consistency checks, and the Final Recommendation
format. One line existed only in the banner — *finish every sentence rather
than stopping mid-thought* — and moved into the guide with them.
`compassDocumentContract.spec.ts` asserts the second contract is gone and that
each of those controls is still stated.

**And the overlay had one rule backwards.** It removed *Purchase Price* and
*Weekly Rent* outright — "no card, no table cell, no inline mention" — and the
guide's own HARD EXCLUSIONS repeated it. That contradicted three things at
once: `TIER_CONTENT.compass.identityFigures` is **true** (§ Decision E of
`TIER_FRAMEWORK.md` — what a property costs is a fact about the asset the way
its land size is), the masters print both on the cover band and the executive
dashboard, and *Market Positioning* has 600 words to place this property in its
market and cannot do it without naming the price. What is excluded is the
**analysis** — no yield from it, no repayment on it, no projection of it — and
the **KPI-row form**, which is the Financial Analysis's. The sanitiser needed
no change: its patterns are anchored at a line start and at table cells, so it
already caught `| Purchase Price | $681,000 |` and never a sentence.

### And a byte cap was cutting the controls off the end of the guide

Found immediately after, by measuring the guide rather than assuming it
arrived. `TEMPLATE_CONTEXT_MAX_BYTES` is 12,000 and the canonical structure
guide is **12,397 bytes** — v4.0's two new sections took it over. It was passed
through `limitPromptContext(…, 'head')`, which keeps the head and drops the
tail, so on **every Compass run** the last **665 bytes** were cut:

```
## CONSISTENCY CHECKS
- Bed / bath / car / land size stated in the Property & Locality Snapshot MUST
  match every later reference (Property Fit, Risk Dashboard, Final Recommendation).
- Property type (house / townhouse / unit) MUST be identical everywhere it is mentioned.

## RECOMMENDATION FORMAT
The Final Recommendation opens with one of three labels on its own line …
```

and in their place the model was handed the truncation notice, which tells it
to *"request fresh web research for missing details"*. That is §6 of
[`PLANNING_CONTROLS_IN_THE_REPORT.md`](./PLANNING_CONTROLS_IN_THE_REPORT.md)
happening again somewhere else: **a control lost to a byte boundary, and a
licence to invent offered in its place.** Two of the four lost controls had
been carried over from the overlay minutes earlier on the ground that removing
a ceremony must not remove a control — and they were being removed by
arithmetic.

The cap is not wrong; it is aimed at the wrong string. It exists for the other
source of `templateContext`: `report_structure_templates.parsed_content`, a row
an operator uploaded, of no bounded size. The canonical guide is built here
from the section registry, so its size is a fact about this repository's own
code and trimming it is never the right answer.
`templateContextIsCanonical` is set exactly where the guide is built, the cap
applies only to the uploaded row, and a test asserts both — including that
nothing else can set the flag, because an uploaded row claiming it would
reopen the hole the cap is there to close.
