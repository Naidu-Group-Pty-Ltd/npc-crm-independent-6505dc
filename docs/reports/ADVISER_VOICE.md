# A report speaks as the adviser

The owner read the regenerated Compass for 60 Lawley Street, Spalding WA
(report `60f205f9`, 25 Sep 2026) as a client would, and asked for every report
to read like "a property professional presenting the information". This is the
record of what that took, what it found on the way, and what is still open.

## What the document sounded like

Measured on the text the dashboard showed:

| word or sentence | times |
| --- | ---: |
| "register" | 110 |
| "retrieved" / "retrieval" | 38 |
| "coordinate" | 17 |
| "this platform" | 11 |
| "Recorded attribute" (a column heading) | 6 |
| "Not searched." | 6 |
| "No infrastructure project or development instrument was retrieved …" | 5 |
| "… no operator stop file was available for this assessment" | 5 |
| "No population projection … has been loaded for this assessment" | 3 |

Every one of those sentences was **true**. None of them was about the property.
They describe how the report was made, and a client does not buy a house from a
description of a database. The honesty rules behind them stay exactly as they
were — an absence is never rated, a checked-and-empty map is not an unchecked
one, a limitation is stated. What changed is who is speaking, and how often.

The same document also printed **STRONG BUY** on its cover and **"Proceed with
caution"** in its Executive Verdict, explaining the difference as "matters the
model does not measure". Two verdicts, and an explanation in the platform's
vocabulary. That is rule 5 below.

## Two causes, each fixed at its source

**The words came from us.** The blocks the page prints verbatim (the planning
controls table, the infrastructure outlook, the SWOT, the monitoring plan), the
sentences the writer is told to write, the section instructions in the
registry, and even the document contract's worked example ("No council overlay
mapping was retrieved for this lot" was the model's example of an *honest*
sentence) all spoke the machine room's vocabulary. A writer copies what it is
handed.

**The repetition was an instruction.** `infrastructureRules` opened "RULES FOR
THE WHOLE REPORT … they apply in every section" and its first rule was "Say in
one sentence that no infrastructure project … was retrieved". The pinned
context is the same for every section call, so every section that touched the
subject said it — five times. A rule that must be obeyed everywhere and a
sentence that must be written once are different kinds of instruction.

## The rules

1. **The machine room never reaches the page.** `PLATFORM_VOCABULARY`
   (`_shared/reports/adviserVoice.pure.ts`) names the terms — "this platform",
   "this deployment", "loaded", "retrieved", "coordinate", "address point",
   "stop file", "evidence pack", "the model", "recorded attribute", "not
   searched", "the registers this report reads" — each with what an adviser
   writes instead. The patterns are narrow on purpose: `coordinate` does not
   match Queensland's statutory "coordinated project", `loaded` needs its
   auxiliary and not a preposition of motion (a relocatable home is "loaded
   onto a truck"), and "the model" does not match a display home's model. A
   warning that fires on ordinary English teaches an operator to ignore it.
2. **A limitation is explained once, in the section that owns its subject.**
   `DISCLOSURE_HOMES` gives each one a home — planning → Zoning, Planning and
   Development Considerations; infrastructure → Infrastructure and Growth
   Context; supply → Competitive Landscape and Supply Pipeline; forward demand
   → Demand Drivers; transport → Transport & Connectivity; amenity → Amenity &
   Access; hazards, climate and crime → Environment, Climate & Safety; market
   figures → Market Positioning. Every composed "say this" rule is confined
   with `inHomeSection()`, and every other section is told by `elsewhereOnly()`
   that it may point to it in a few words. Prohibitions still bind every
   section — they cost no words.
3. **The two absences keep their distinction, in the adviser's words.**
   "Checked — nothing recorded." (`REGISTER_CHECKED_EMPTY`) and "Not covered by
   this report." (`REGISTER_NOT_COVERED`) replace "Searched, nothing found."
   and "Not searched.". They are ONE pair of constants, because the planning
   table, the infrastructure outlook and the supply block all print them, and
   two spellings of one distinction on two pages reads as two meanings.
4. **A service note is translated on the way to the page, never rewritten at
   the source.** `planning-data-service` writes notes for the people who
   maintain it ("the only such register this report reads is Queensland's").
   `readerNote` (`_shared/planning/serviceNote.pure.ts`) turns each known note
   into what is not covered and what confirms it, returns `null` for a note
   that carries a failure's own detail (so the caller's sentence stands), and
   passes an unrecognised note through unchanged. Translating on the way out
   reaches answers cached before the change too. The planning prompt block
   (`planningStatBlocks`) now reads through the same function, so the writer
   is never handed a diagnostic either.
5. **The document makes one recommendation.** `printedVerdict` reads what the
   cover prints; `issuedRecommendation` hands it to the Executive Verdict and
   the Final Recommendation; `recommendationContract` makes both open with it
   ("Strong Buy — subject to the due diligence set out in this report") and
   forbids every other label. Where the page prints no verdict, the adviser's
   three labels remain and both sections must use the same one.
6. **Prose is never scrubbed.** `compassQAValidator` reports what still reaches
   a finished document as the `platform-vocabulary` warning. Deleting a phrase
   leaves a sentence that no longer says what it said.
7. **The four derived documents speak the same way — each by the route it is
   made.** The Financial Analysis and the Due Diligence Report are the fork's:
   no model, the parent's prose copied plus chapters composed in code, so the
   composed chapters (the strategy sections, the checklist status, the
   Financial chapter introductions, the tier standfirst) were rewritten and are
   now read by the same literal scan. The Executive Briefing and the Snapshot
   are the condenser's: one model call that rewrites the parent, and
   `documentRules` returns nothing for their tiers, so the condenser's system
   message now carries `condensedVoiceRules()` and
   `condensedRecommendationContract()` — **appended after** the template,
   because the template can be replaced from the database and an override must
   not take them with it. The condensed rules name no Compass section (a
   Briefing has none of them) and share their worked example with the Compass
   rules rather than restating it.

## What the rewrite found

Four defects, each invisible until the wording moved:

- **The register dedupe keyed on header rows that had been renamed.**
  `REGISTER_TABLE_HEADERS` matches a table's header row whole, and the control
  summary's columns became `Finding | Status | Source`, so a model's
  reproduction of the table would have printed twice with nothing reporting
  it. Both spellings are listed now (stored reports keep the old one), and
  `aRegisterIsPrintedOnce.spec.ts` reads every header the two composers draw
  out of their source — proven to fail when a spelling is removed.
- **The rated-absence chart guard did not know the new absence words.**
  `ABSENCE_WORDS` gains "not checked", "not confirmed" and "not covered", or a
  confession written in the adviser's voice would have passed the guard.
- **The supply instruction contradicted its own block.** The registry told the
  writer a partial approvals total "is a FLOOR and says so" while
  `approvalsFactBlocks` says it is not a minimum, because the ABS publishes
  approvals net of amendments. The instruction now says PARTIAL.
- **The citation rule pointed at a heading the page no longer carries.** It
  sent the reader to "*Planning controls and development registers* at the end
  of this report" — the section the registers left on 25 Sep 2026, when they
  moved inside the chapters they are evidence for. It now names the headings
  the page prints, from the same constants the generator writes them with.

Two more, found carrying the voice into the derived documents:

- **The one permitted absence could be removed.** `PERMITTED_ABSENCE_RE` —
  the corrector's exemption for "checked and not mapped", excluded by name —
  still read "at this coordinate" after the planning table's lead became
  "Checked and not mapped at the property". Its own test could not see it: the
  sentence it kept named neither a portal nor a neighbouring lot, so it was kept
  with or without the exemption. The pattern reads both spellings now, a spec
  holds it to `CHECKED_NOT_MAPPED_LEAD`, and a test that CAN fail puts the
  permitted absence beside an adjoining lot (both fail on the old pattern).
- **The land-use block printed the service's notes verbatim.** Wherever no
  land use table was read, "What may be built on this land" opened with the
  table's `note` — "No zone was retrieved for this coordinate, so the
  instrument's land use table could not be asked for" on the Lawley document,
  and on a failed request the request's own diagnostic ("HTTP 503",
  "unparseable JSON body"). The spec said it covered the land-use block, and
  none of its fixtures carried a `landUse`. The notes now pass through
  `readerNote` like every other planning note (on the way to the page, which
  reaches cached answers), a failed request is stated as a check not made, and
  the fixtures carry every note the service can write.

And three instructions that were producing the vocabulary directly: the
planning section's purpose asked for the sentence "the cadastral area of the
lot was not retrieved"; the section contract asked for "a short two-column
table of the recorded attributes" (the likely source of the six "Recorded
attribute" headings); and the attributes rule offered "not recorded for this
assessment" as the permitted form.

## The closing pages agree with the chapters

The same document contradicted itself three times in its last pages, and none
of it was a voice problem:

- **Crime.** Environment, Climate & Safety said "this report states no crime
  count, rate, period or safety rating for Spalding" — correct, because no
  Western Australian recorded-crime register is read — and the Risk Dashboard
  rated crime **High**, "Verified", from a council area profile found by
  search.
- **Transport.** Transport & Connectivity said the Google Places count of
  zero stations "should not be treated as evidence that public transport is
  absent", and the Risk Dashboard rated transport reliance **Moderate** from
  it.
- **Threats.** The verdict page listed "Rapid recent price growth may
  indicate market cooling ahead" as a consideration; the SWOT said of Threats
  "None identified".

The register instruction already said `Not assessed` is the level wherever
the evidence is something this report did not confirm. A general rule lost to
a specific cue in front of the model. So the block that owns each subject now
hands the register its row, in the register's own two vocabularies
(`unratedRiskRow` in `riskRegister.pure.ts`): crime with no recorded figures
reads `Not assessed` / `Not checked`; a station count alone reads
`Not assessed` / `Unverified`; outside every loaded network, `Not assessed` /
`Not checked` — each with the sentence that a searched page is context, never a
rating and never "Verified". Where a real reading IS held, nothing is handed
over and the rating stays the writer's. And the SWOT's Threats now read the
market risks recorded with a V2 grade through `recordedMarketRisks` — the one
reader the verdict page's watch points use — in the scorer's own words, V2
only, because a V1 record's list carries statements about a purchase.
`riskRowsAgreeWithTheirSections.spec.ts` pins all three, and removing either
fix fails it.

## Stored reports

- **No stored prose is rewritten.** The voice is in what the generator is
  handed and what it composes, so a stored report keeps its words until it is
  regenerated.
- **The appended register headings changed** ("Planning controls retrieved for
  this property" → "Planning controls for this property"; the infrastructure
  one likewise), named once in `registerTables.pure.ts`.
  `STORED_REGISTER_HEADINGS` keeps the old spelling readable, so a pointer in
  an existing report still resolves and its tables are still deduplicated.

## Where it lives

| File | What it holds |
| --- | --- |
| `_shared/reports/adviserVoice.pure.ts` | The vocabulary, the homes, the two readings, `adviserVoiceRules()` |
| `_shared/compassSectionContract.ts` | `documentRules` carries the voice into every Compass section call's untrimmed system message; `recommendationContract` |
| `_shared/reports/printedVerdict.pure.ts` | The one reader of the verdict the page prints |
| `_shared/planning/serviceNote.pure.ts` | `readerNote`, `uncheckedSentence` |
| `_shared/reports/investment/registerTables.pure.ts` | The register headings and header rows, both spellings |
| `_shared/compassQAValidator.ts` | Rule 17, `platform-vocabulary` (warning) |
| `condense-investment-report/index.ts` | The Briefing and Snapshot system message: template, then `condensedVoiceRules()`, then `condensedRecommendationContract()` |

## What pins it

`adviserVoice.spec.ts` drives the planning table, the infrastructure outlook and
the major-projects block in all eight jurisdictions and asserts none carries the
vocabulary; holds `DISCLOSURE_HOMES` to both registry mirrors; asserts every
composed "say that" rule names its home; and **reads the string literals of 35
composer modules** and fails on any platform term, with status enum values
named explicitly — because a fixture reaches only the branches it was written
for, and the SWOT, the monitoring plan and the market block each carried the
vocabulary on a branch no fixture took. `oneRecommendation.spec.ts` pins rule 5.

## Still open

- **A fork copies its parent's prose.** The Financial Analysis and the Due
  Diligence Report make no model call, so their narrative is the parent
  Compass's, word for word. A Compass written before 25 Sep 2026 carries the
  old vocabulary and its forks carry it too: regenerate the Compass, then
  derive the other four. (The Briefing and the Snapshot are rewritten, so the
  voice rules reach them whatever the parent says.)
- **Two labels are the owner's.** "Accepted CGR assumption used by the
  financial model" and "Historical market growth observed in the approved
  register" were set by the owner in the S5 work and are unchanged; the
  sentence around them was reworded. Whether "the approved register" should
  read differently in a client's document is the owner's call.
- **A checked-and-clear map in the Risk Dashboard.** Bushfire on the Lawley
  document reads `Not assessed` beside "Checked register, no mapped control".
  That is correct under §9 of `PLANNING_CONTROLS_IN_THE_REPORT.md` (an absence
  is never rated, and a map that shows nothing is not a clearance), but a
  client can read `Not assessed` as "not looked at". A level of its own
  ("Not mapped") would change what the register may say rather than how it
  says it, touches the rated-absence guards and the QA register check, and is
  the owner's call.
- **"register" is not banned.** A heritage register and a risk register are
  ordinary professional vocabulary; the composed blocks now use it far less,
  and the warning does not count it.
