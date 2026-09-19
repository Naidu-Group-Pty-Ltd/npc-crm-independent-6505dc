# S5 — the Executive Briefing and the Snapshot, drawn for the first time

The last two of the five client reports come out of
`condense-investment-report`. Unlike the fork's pair they need **one model
call each** — the condensed prose — and everything that happens to that
answer afterwards does not: the recorded-facts block, the composed financial
chapters, the score breakdown, the SWOT, the verdict, the registry trim, the
declared-order assembly and five hygiene passes.

All of that lived inside the function's `index.ts`, so, exactly as with the
fork, it could not run outside a deployed Deno runtime and neither document
had ever been drawn and read. `condenseCompose.pure.ts` is that code, moved
verbatim with three changes and no fourth: the handler's `parentReport.*`
reads became inputs, `postProcessReportMarkdown` is imported statically
rather than dynamically, and `runQAValidation` stays in the handler, because
validating a document is reporting and not composing it.

`npx tsx scripts/reports/s5CondenseReports.mts` produces both tiers for both
subjects and draws each through the supported template path —
`compileTemplateHtmlForPdf`, then WeasyPrint on the six options the
production route sends.

---

## 1 · The one stand-in, and why it is a fair one

A model call cannot be made from this sandbox, and buying one would spend a
forwarded vendor credential on a verification run. The prose is therefore
stood in for by `scripts/reports/_condenseStandIn.mts`, which is **named on
every run** rather than left indistinguishable from a real answer.

It **copies the parent's own blocks whole**. Every sentence, table row and
figure it returns was written by the model that wrote the parent report,
about this property, and is already in the record. It composes nothing,
rewrites nothing and rounds nothing.

That is narrower than a real condensation — a model would rewrite, not
excerpt — and it is deliberately narrower in the one direction that matters:
**it cannot invent a figure**. The single failure that would make a rendered
document lie is off the table, so a number in the output that is not in the
parent is the COMPOSITION's, which is the thing under test.

The tier guides' hard rules bind it as they bind the model. It writes no
financial table and no score or SWOT section, because the composition
attaches those from the record. It writes only the tier's declared headings,
and **omits** one it has nothing to copy for rather than filling it with
"N/A" — which is the guides' own instruction, and what makes the registry
trim and `dropEmptySections` do real work on this run.

**Sections are found by shape, not by spelling.** The two subjects do not
agree on their own headings: Kellyville calls its risk table
`## Risk Dashboard` and Maryborough calls the same thing
`## Consolidated Risk Register`. Pinning one spelling produced a document for
one property and a hole for the other, and the hole read as a composition
defect.

**A section's prose is not always in its body.** `##` splits on every
heading, so a section whose first line is a `###` has a body of only what
sits above it. On Kellyville that is three paragraphs of Executive Verdict;
on Maryborough it is a lone `{{glance: …}}` directive, because every word of
its verdict is under `### Overall Investment Verdict`. The first run produced
a Briefing with no Executive Summary for one property and a full one for the
other, from one mapping. The children are the fallback, always.

---

## 2 · What came out

| | stand-in | composed | sections | characters | pages | PDF/UA-1 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Kellyville · Executive Briefing | 21,327 | 26,220 | 17 | 26,220 | 20 | pass |
| Kellyville · Snapshot | 2,432 | 3,664 | 8 | 3,664 | 11 | pass |
| Maryborough · Executive Briefing | 18,869 | 23,580 | 17 | 23,580 | 18 | pass |
| Maryborough · Snapshot | 4,065 | 5,313 | 8 | 5,313 | 12 | pass |

Seven sections composed from the record on each Briefing
(`purchaseHolding`, `rentalYield`, `loan`, `sensitivity`, `tenYear`,
`scorecard`, `swot`) and three on each Snapshot (`verdict`, `scorecard`,
`financialSnapshot`). Hygiene removed nothing on any of the four — no
editorial labels, no placeholder rows, no empty sections, no empty stat
cards, no duplicate figures, no unrecorded score claims — which is what a
whole-block excerpt of a Compass-40 parent should give it.

**`Key Market Stats` is omitted from both Snapshots**, and correctly. The
tier asks for OBSERVED market statistics each with the source and date the
report cites, and neither parent carries such a table: both state census
medians (income, age, SEIFA) in prose and neither states a median sale
price, days on market, walk score or a sourced vacancy rate as a sourced
statistic. The guide's own rule is to omit the section rather than write a
placeholder. A model would have had the same material.

---

## 3 · Two defects the drawn pages found

Neither was visible in code, in a test, or in the markdown. Both were found
by rasterising every page and measuring how much of the text box carried
ink.

### A template page has no long edge to turn to

`renderMarkdown` sends a table wider than the portrait measure to
`renderPage('landscape-table', …)` and charges it `LANDSCAPE_BREAK_LINES`
— 38 — for the two page boundaries that page opens. That is right in the
FLOWING route, where the boundaries are real. In the template route a master
page is a fixed box, nothing defines `page-landscape-table`, and the
`<section>` is inert: the table draws portrait, inline, in the space it
always had.

So the charge bought a page break that never happened — and the flag's
default (`landscapeWideTables !== false`, i.e. ON unless denied) handed it to
a path that had never named it. Measured on the Briefing's ten-year
projection, 7 columns by 6 rows: charged **48.8 lines against a 41-line
continuation budget**, so it fitted in **no** bucket. It took a page of its
own at 23% full and stranded its own heading and standfirst on the page
before — `## 10-Year Cashflow, Equity & Growth Projection`, the words "The
recorded ten-year modelling, shown at years 1, 3, 5, 7 and 10", and **93%
white paper**. A promise of a table, with the table on the next sheet.

`markdownBlockContent.ts` passes `landscapeWideTables: false` on both its
`renderMarkdown` calls. The flowing route is untouched.

### The first cell of a row is not a second column head

`renderDataTable` marks it `<th scope="row">`, which is what makes a table
navigable in a tagged PDF, and it carries no class. `styleTags` selected on
the TAG alone, so the row's LABEL took the column head's rule: heading gold,
head weight, and none of the `vertical-align:top` every `td` beside it has.
On a risk register that is the risk's name set in gold, bold, floating in the
middle of a fifteen-line row whose other four cells begin at the top.

The shared print stylesheet already states the rule for this exact element —
"it must not look like the column head" (`reportDesign/css.pure.ts`) — and
the template path was the second implementation without it. `TagStyle` gains
an `attr` qualifier and the more specific rule sorts first, the same way
`figure.chart-compact` already beat `figure`.

### What the two fixes moved

| | before | after |
| --- | ---: | ---: |
| Kellyville · Briefing | 22 pages, worst body page **7%** | 20 pages, worst **46%** |
| Kellyville · Financial | 24 pages, worst body page **8%** | 21 pages, worst **41%** |
| Maryborough · Briefing | 19 pages, worst body page **23%** | 18 pages, worst **31%** |
| Maryborough · Financial | 22 pages, worst body page **23%** | 20 pages, worst **44%** |

Every page under 40% full is gone from all eight documents. What remains
under 72% is the archetype pages (cover, contents, the two dashboards, the
opening), the closing page, and last-narrative-page tails — a section that
ends two-thirds down its final sheet, which is typography rather than a
defect. `markdownBlockTable.spec.ts` pins both rules; checked against the
unfixed code, seven of its eight assertions fail.

---

## 3a · The suite, all ten

`s5CompassReports.mts`, `s5ForkReports.mts` and `s5CondenseReports.mts` all
draw through **one** step, `_s5Render.mts`. That matters for this stage in
particular: ten documents are being compared with each other — page counts,
body fill, PDF/UA-1, whether a defect in one is present in the others — and
that comparison is only sound if every document reached the paper the same
way. The Compass was drawn separately in S1; it is on the shared step now.

| | Kellyville | Maryborough |
| --- | ---: | ---: |
| Investment Compass | 36 pages | 22 pages |
| Financial Analysis | 21 | 20 |
| Due Diligence (Strategic) | 29 | 19 |
| Executive Briefing | 20 | 18 |
| Snapshot | 11 | 12 |

All ten validate as **PDF/UA-1** against veraPDF 1.30.2. All ten are clean of
raw `{{directives}}`, "N/A", "TBD", "not assessed", bare Markdown table
delimiters and stage labels. No body page in any of the ten falls below 40%
fill. What remains under 72% is the archetype pages (cover, contents, the two
dashboards, the opening), the closing page, tall risk-register rows that
cannot split, and last-narrative-page tails.

---

## 4 · Two findings NOT acted on, and why

### ~~`runQAValidation` is called with the wrong tier~~ — FIXED

`condense-investment-report/index.ts` validates a Briefing and a Snapshot as
**`'compass-40'`**. The validator knows two tiers, `compass-40` and
`financial-analysis`, and neither is a condensed one — so every condensation
in production logs and returns a QA report that **cannot** pass:

* `page-band` — "Estimated 14 pages, below target min 30" on a 12-page tier;
* eleven `financial-exclusion` errors, on the financial chapters the
  composition **deliberately attaches**;
* four to six `missing-protected-section` errors naming Compass sections a
  condensed tier never declares.

Sixteen errors on a correct Briefing, eleven on a correct Snapshot, on every
run. It blocks nothing — the report is logged and returned either way — which
is exactly what makes it the class this programme keeps finding: a check that
always fails is no check, so it can never report a true one.

The first reading of this said the remedy was a decision. It is not: the
rules divide more cleanly than the call implied. Most of them are about a
REPORT rather than about a tier — no unresolved placeholder, no score the
record does not hold, no editorial label, no duplicate heading, no promise of
a table with no table — and every one is exactly what you want asserted on a
condensed document. Only three are tier-bound, and two were already guarded
to `compass-40`.

So `QATier` admits `briefing` and `snapshot`, the handler passes the tier it
is PRODUCING, and the three tier-bound rules read what each tier declares.
Two rules carry it. **A tier with no declared page band gets no page-band
finding** — a Briefing's length is governed by the registry trim and the
post-processor's word caps, and inventing a band would be a threshold nobody
measured. **A tier with no section registry runs no per-section check**, which
is also the fix for a second, quieter fault in the same line: the old
`tier === 'compass-40' ? COMPASS : FINANCIAL` handed a Briefing the
**Financial Analysis** registry, so its word caps were being applied to a
document that never declared them.

All four S5 condensed documents now report `passed: true` with an empty
findings list, and the checks that do apply pass genuinely rather than being
switched off. `qaTierVocabulary.spec.ts` pins both halves — and the half that
matters is the second, which shows each report-level rule still biting on a
Briefing, because admitting a tier would be worse than the fault if it had
quietly turned the validator off. It also asserts the two copies of the
validator (the edge module and the frontend panel's mirror) stay
byte-identical but for one import path.

### "Five dimensions, weighted" over a table of three

The assessment page's heading states a count the table under it contradicts
on **all eight** documents, and on the Compass too. The data side is correct
and owner-mandated: the 14 Sep rule is that no placeholder reaches a client
document, so an unscored dimension publishes nothing bindable and draws no
row (`reportBindingProjection.pure.ts` records the trade-off). What was not
done is the consequence — the heading was left stating five.

Both subjects score three of five (`location` and `risk` are unavailable on
each), so every document drawn in this stage carries it.

It is a literal in the master schema, so it reaches production only through a
re-seed: **54 rows** carry it — 50 `template_library_entries` and 4 active
`report_templates` (measured 17 Sep 2026). That is the third item riding on
the pending master re-seed decision, after `Weekly rent` → indicative and the
chip `radius`. Not acted on unilaterally.

---

## 5 · The frontend journey — what S5 verifies and what it cannot

S5's second half is the journey a person actually takes: choose a template,
generate, read, edit, save, reopen, preview, export, look at history, and be
refused what they may not see. Three of those steps WRITE, and this session
is not authorised to change live data. There is no local Supabase and no
seeded copy, so the only database any UI here could reach is production's.
Signing in to drive it is not something to do unasked either.

So the journey is verified where it can be verified honestly, and the gap is
named rather than papered over.

### Verified

**The export is one implementation and it names the pinned engine.** Every
export in the product reaches `deliverInvestmentPdf`, which is keyed on a
ROW ID — so a Compass row, a Financial row, a Due Diligence row, a Briefing
row and a Snapshot row all take the same path. It calls
`tryTemplateDocument('investment', reportId, { renderer: 'weasyprint', … })`:
the chosen template drawn by the pinned engine, never the browser's jsPDF.
`finalRendererOnEveryFormat.spec.ts` scans for that and forbids the omission
on all nine other formats too, because leaving it out is what silently
DOWNGRADED a chosen template to a font-less document on every one of them.

**The ten documents came through that same step.** `_s5Render.mts` is the
projection, the organisation stamp, `compileTemplateHtmlForPdf` and the
WeasyPrint call on the production options — the compile-and-draw half of what
the export does. So the pages read in §2–§3 are the pages the export
produces, not a parallel rendering.

**The steps that do not write are covered by tests that run:**

| step | covered by | tests |
| --- | --- | ---: |
| export / delivery, all formats | `finalRendererOnEveryFormat`, `investmentDeliveryContract`, `investmentDeliveryUnified`, `templateRouteEnforcement`, `templateRouteWiring`, `subReportEngines` | 85 |
| choose a template, and keep the choice | `reportTemplatePickerLibrary`, `reportTemplateSelection`, `investmentFinalRender` | 35 |

All 120 pass on this branch, as does the whole report suite (9,389).

### Not verified, and what it would take

**No click-through of the running application.** Nothing here has opened the
product in a browser, selected a template, edited a report, pressed Save,
reopened it, or downloaded from the UI. What is verified is that the code
those buttons run is one path that names the right renderer, and that the
path produces the documents in §2–§3.

**The three writing steps need authorisation before they can be exercised at
all** — editing, saving and generating a sub-report each write to
`investment_reports` in production, and generating also spends a forwarded
vendor credential on a model call. A journey run therefore needs the owner to
say so, and ideally a property whose reports may be written over.

**The Briefing and the Snapshot have still never been produced by a run that
made the real model call.** §1's stand-in is a fair substitute for testing the
composition and the rendering — it is the composition that was untested, and
it is now — but it is not the model, and the one thing it deliberately cannot
do is the one thing a model might get wrong. That gap closes only by
generating one of each for real.

---

## 6 · The relocated financial detail, verified at its destination

The standing requirement is that financial detail moved out of the Compass be
verified where it landed *before* the removal counts. Decision E withheld the
modelling from the Compass and the Financial Analysis Report is where it went;
until this stage both documents had never existed side by side for the same
property, so the check could not be made. `scripts/reports/s5Relocation.py`
makes it over all four documents.

Ten items, both subjects, **no problems**: absent from the Compass, present in
the Financial Analysis.

| | Compass | Financial |
| --- | --- | --- |
| purchase-cost breakdown (incl. stamp duty) | absent | present |
| gross yield · net yield | absent | present |
| loan structure · LVR · repayments | absent | present |
| sensitivity and scenario testing | absent | present |
| ten-year projection · equity bridge | absent | present |
| cash-on-cash return · year-1 net position | absent | present |

And the two Decision E keeps on **every** tier — *"withholding the modelling
is not withholding the price"* — are on the Compass: the purchase price and
the indicative weekly rent, side by side in its dashboard band.

### The measurement was wrong three times first, and that is the finding

Every one of the first three attempts produced a confident wrong answer, and
all three were the instrument rather than the documents:

1. **A page-fill measure clamped by the running foot.** `min(ink, floor)` is
   the floor whenever the foot draws below it, and a running foot draws on
   every page — so every page measured 100% full. The band has to be
   EXCLUDED, not clipped.
2. **Tracked small caps.** The design letter-spaces its KPI labels, so
   `pdftotext` renders "WEEKLY RENT" as `W E E K L Y  R E N T`. A
   word-boundary regex cannot see it, and the first reading of this check
   reported the indicative rent MISSING from both Compasses — a defect that
   did not exist, against a rule the codebase states explicitly.
3. **Hyphenation.** The documents write `Cash-on-cash return`; a search for
   "Cash on cash" that folds whitespace still keeps the hyphen, so the figure
   read as absent from the destination. It is in the sensitivity chapter's
   year-1 table on both.

Two of the three were false POSITIVES for a defect and one was a false
negative, which is the worse direction: it would have reported a Compass
carrying modelling it does not carry. The check folds case, whitespace and
punctuation away now, and reads each document's own MARKDOWN as well as its
printed text — the markdown is what the composition wrote, the PDF is what
reached paper, and a claim about relocation has to hold in both.
