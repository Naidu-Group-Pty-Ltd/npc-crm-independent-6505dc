# The geometry gate measured seven pages of a thirty-page document

**Measured** 20 September 2026, on the branch that follows PR #2720.
**Modules** `scripts/template-library/investmentCompass/qa.ts`,
`src/lib/templateLibrary/narrativeGeometryFixture.ts`.

`npm run templates:compass:qa` is the only check in this repository that lays a
seeded master out in a real browser and measures the boxes. Its own header says
why it exists: `flow()`'s overflow guard is arithmetic over the heights the
authoring helpers *declare*, and a declared height is a guess about how tall a
paragraph of bound text will set. It is the gate that found the 463 overlapping
blocks in the Portfolio masters, and it is the gate
[`WHAT_THE_PAGE_ACTUALLY_DRAWS.md`](./WHAT_THE_PAGE_ACTUALLY_DRAWS.md) §5 and §6
corrected twice when a fixture turned out to be shorter than the product.

It was measuring the front matter.

---

## 1. Seven of fifty pages

Measured by execution, rendering the Investment Compass masters through
`renderTemplateToHtml` with `SAMPLE_REPORT_DATA` exactly as the gate does:

| master | schema pages | rendered |
| --- | ---: | ---: |
| Chancery | 50 | **7** |
| Chancery Compact | 50 | **7** |
| Sovereign Folio | 52 | **8** |

The seven are `Cover · Contents · Executive dashboard · The assessment · Risk
and recommendation · Sources and methodology · Important information`.

The other forty-three are dropped by their own conditionals, and grouping the
dropped pages by the conditional that dropped them names the cause exactly:

```
  2 ×  report && report.drawsFinancialModelling
  1 ×  narrative && narrative.source
  1 ×  narrative && narrative.pages > 1
  1 ×  narrative && narrative.pages > 2
  …                                        (one per body page, to > 29)
```

`SAMPLE_REPORT_DATA` carries **no narrative at all** — `narrative.source` is
absent, so `narrative.pages` is `undefined` and every comparison against it is
false. So the body of the document — the pages that carry the prose, the
registers, the ~107 chart directives a Compass draws, the markdown packing and
the running head — has never been laid out by this gate, on any run.

Neither has either financial-modelling page: the fixture's tier is the Compass,
which by `tierContent.pure.ts` draws none.

**This is §5's lesson one level up.** There, a 35-character sample verdict
against a production 59–99 let 510 renders pass while a client's heading printed
through the KPI band. Here the sample has no body, so the gate was measuring the
front matter of a 34-page document and reporting on the document.

## 2. And a second, independent cause underneath it

Giving the fixture a body is not sufficient, and finding out why is worth
recording. With a body at the registry's declared size and nothing else changed,
the same masters rendered **8, 8 and 9** pages — one more.

`planNarrative` is the pre-pass that computes the true page count from the
template's own geometry and writes it over the projection's template-blind
estimate, before any page conditional is read. Its first statement resolves a
profile from `data.report.type`:

```ts
const reportType = String((data.report as { type?: unknown } | undefined)?.type ?? '');
const profile = resolveNarrativeProfile(reportType);
if (!(profile?.geometryAware || geometryAwareFormat(reportType))) return null;
```

`SAMPLE_REPORT_DATA.report` has no `type`. The production adapter publishes one
(`getReportType(row)` → `investment_compass`), the fixture does not, so the
pre-pass returned `null` and the true page count was never written.

With both corrected — a body at the declared size, and `report.type` as the
adapter sets it:

| master | before | after |
| --- | ---: | ---: |
| Chancery | 7 | **25** |
| Chancery Compact | 7 | **21** |
| Sovereign Folio | 8 | **32** |

Two absences in one fixture, each of which on its own reduced the measurement to
the front matter, and neither visible from the gate's own output — it reported
"500 templates, 500 browser renders" either way.

## 3. Four of the five documents had never been drawn

The Investment masters serve five document kinds through one page sequence:
the Compass, and the Snapshot, Executive Briefing, Financial Analysis and Due
Diligence reports derived from it (`tierPageSequence.pure.ts`). Which pages a
derived tier keeps is decided at render time by `pagesForDocument`, from the
tier the data names.

`SAMPLE_REPORT_DATA.report.tier` is `'compass'`, hard-coded, so the tier rule
was a no-op on every one of those renders and **no page of the four derived
documents has ever been laid out and measured.** That is the larger half of the
owner's standing request — the Financial, Strategic, Snapshot and Briefing
reports — and the gate that would speak to it was blind to all four.

Two facts about the tier, both established by execution rather than read:

* **The rule reads a top-level `data.tier`**, not `data.report.tier`. Setting
  the tier only where the projection publishes it changes nothing; the
  production adapter sets both, and the fixture now sets both for the same
  reason.
* **An alias does not resolve.** `derivedTierOf('due_diligence')` is `null`, so
  a document whose tier is spelled with one of `reportVariants.ts`'s five
  aliases (`due_diligence`, `pldd`, `property_level_due_diligence`, `strategy`,
  …) keeps every Compass-depth page. This is **latent, not live**:
  `fork-investment-report` persists `'financial' | 'strategic'` and
  `condense-investment-report` writes a canonical tier, so nothing in the
  product currently produces the spelling that would trip it. It is recorded
  here rather than fixed, because the fix belongs with a reading of what
  `report_tier` actually holds, and this branch may not read application data.

## 4. What changed

**The fixture stays the binding fixture.** `SAMPLE_REPORT_DATA` is what the
catalogue specs assert rendered output against, and its job is to resolve every
bound path; lengthening it would renegotiate specs that are pinning something
else. The geometric measure needs a document-sized body, and composes one.

`narrativeGeometryFixture.ts` builds that body from `COMPASS_40_SECTIONS` —
each section's heading, its own declared `maxWordCount`, and the constructs its
own `visualComponents` declare (a table for `attributeTable`, `{{bars:}}` for
`kpiTiles`, `{{gauge:}}` for `scorecard`, `{{timeline:}}` for
`infrastructureTimeline`). Every word in it is the registry's own `purpose`
prose cycled to the budget.

Three properties of that choice are the point of it:

* **It is derived, so it cannot go stale.** Change a section's budget and the
  fixture changes with it; the gate cannot go on measuring last quarter's
  document.
* **It is impossible to mistake for a report.** It is this platform's own
  specification prose, set at report length. It states no fact about any
  property and nothing may render it for a reader.
* **It is deterministic**, so a geometry finding is reproducible.

The gate now measures **one document per kind a master has to draw** — one for
every other format, five for the Investment masters.

And the page list is now read from the DOM. The harness used to filter the
schema by `evalConditional` alone and throw when its count disagreed with the
renderer's; the renderer applies two further filters (`pagesForDocument`, and
its own empty-page pass), so the two lists agreed only while the fixture named
no derived tier — the guard would have fired the moment anyone measured one.
Every rendered page carries the id of the schema page that drew it, so the list
is taken from the thing being measured rather than predicted beside it.

## 5. What this does not do

It does not render a real report. Reading the **file** a real generation
produced is what
[`A_PREMIUM_DOCUMENT.md`](./A_PREMIUM_DOCUMENT.md) did for the Compass, and it
remains the only way to settle the residuals in that document's §8 — the
`sofuture` eaten space, the one-series chart on page 22, the five-row-against-
thirteen land-use register. Those need stored bytes this branch has not read.

What this closes is the measure that was available all along and was being taken
of the wrong thing.
