# S1 — six representative pages, and what rendering them found

**Status.** Delivered for review. Nothing in this stage changes a production
code path: the six pages are composed by `scripts/reports/s1Pages.mts` from a
stored assessment, through the production projection and the production block
registry, and drawn by the pinned engine on the production print contract.
CGR, the Cash Flow connection and every financial input remain untouched and
the preservation gate is green.

---

## 1. What was rendered, and from what

| | |
| --- | --- |
| Source report | `9bd41c05-7f9b-41e8-819a-a029f4121369` |
| Row snapshot | sha256 `91f5a5f74ecdde285d72f25825379fb18721cfe9b4d167e35da8055fa1ab48d0`, `updated_at` 2026-09-17T09:10:30Z |
| Template | **Chancery**, slug `investment-compass-pb-01-chancery` |
| Template schema | sha256 `53f5fe7549a07387d174ead3b146079d6f02b054b0e932946058f92616fa4c2a` |
| Template tokens | sha256 `5c1e4b9b9fad73daa05e508affabf35ee53b5d84987d278e43b30a673f5cc26d` |
| Rendering commit | `af346d0335b0f3d4c06b9722f92c36a24171cb29` (branch `claude/adoring-hopper-g02tdt`) |
| Engine | WeasyPrint **69.0** — the version pinned in `weasyprint-service/requirements.txt` |
| Engine options | `pdf_variant: pdf/ua-1`, `pdf_tags: true`, `optimize_images: true`, `output_intent: srgb`, `custom_metadata: true`, `presentational_hints: false` |
| Output | `reports/pdf/s1-review.pdf` — 6 pages, A4 (595 × 842 pt), tagged, 253,395 bytes, md5 `cee4ad64ee6ede31fba18f0eefea1ab3` |

The binding context is built by `applyInvestmentProjection` and
`applyOrganisationProjection` — the same two functions the Templates workflow
calls — with the organisation's real `contact_details` and
`professional_disclaimer` settings passed as the fourth argument, and the
approved monogram (`public/images/npc-logo-monogram.png`) as the print mark.
No other brand asset is used: REPORT_RULES §5 disqualifies the rest.

**The engine OPTIONS are part of the contract, not just the version.**
`render-template-pdf` defaults to `pdf/ua-1` and tagged; a bare
`weasyprint in.html out.pdf` asks for neither and produces a different file.
`scripts/reports/renderWeasy.py` mirrors `weasyprint-service/app.py`'s call,
including its `_supported_options` filter, so the review document is produced
the way the product would produce it.

---

## 2. The pages are laid out from measurement, not from assumed heights

Every block in this system is absolutely positioned. A block that draws one
line taller than its author assumed does not overflow the page — it prints
**over** the block beneath it. `investmentCompass/blocks.ts` already carries
that lesson from the other side: `spacing.rowHeight` is a number no part of the
renderer reads, and trusting it put 45 blocks of the catalogue 33–52 pt past
their reserved space.

So `s1Pages.mts` runs two passes.

1. **Measure.** Every flowed block is rendered *alone*, on its own page, on its
   own ground, through the pinned engine. `scripts/reports/measureInk.py`
   rasterises that probe document at 144 dpi and reports, per page, the lowest
   row that differs from the page's own background. That is the block's drawn
   height, including rules and fills, measured by the engine that will draw it.
2. **Stack, and check the foot.** The page is flowed from those heights and the
   script asserts that the last block clears the running foot. An overrun is a
   non-zero exit, not something to be noticed in a screenshot.

The first run of this harness found that **five of the six pages overran** on
heights that looked plausible — by 9.5, 23, 40.5, 62 and 144.5 pt. All six now
clear:

```
 1 Cover                              ends  748.5pt of 812  ok
 2 Contents                           ends  711.5pt of 774  ok
 3 The assessment                     ends  753.5pt of 774  ok
 4 Amenity & access                   ends  764.0pt of 774  ok
 5 Infrastructure & ten-year outlook  ends  759.0pt of 774  ok
 6 Risk & interpretation              ends  768.5pt of 774  ok
```

---

## 3. What each page demonstrates

**1 · Cover.** One governed conclusion — *"The evidence available does not
support an overall recommendation on this property"* — with coverage disclosed
**beside** it and never merged into it: performance `F · 40`, dimensions
measured `3 of 5`, evidence coverage `57%`. No financial band: the weekly
position, loan and repayment belong to the Financial Analysis, which is the
tier separation `TIER_FRAMEWORK.md` § Decision E already governs.

**2 · Contents.** Two levels, fifteen parts and eight sub-entries, against a
delivered contents that listed eight page archetypes and put 29 pages of
analysis behind one line reading "The report".

**3 · The assessment.** Performance and coverage reported separately and never
combined. Five dimensions, always five: the two that could not be measured draw
their own rows carrying the record's own reason, rather than being dropped so a
heading reading "five" sits over three. Evidence coverage is drawn as what it
is — 57% of the method, 28 of 100 points delivered — and the page states that
the cap on the grade is working as designed.

**4 · Amenity & access.** Each facility is the nearest the register returned at
the verified coordinate, with its measured distance, and each row carries what
it means *and its limit*. Two registers answer this page and the page says so.

**5 · Infrastructure & ten-year outlook.** A determination is a decision, not a
delivery date, and the page opens by saying so. Nothing is placed on a horizon,
because no row carries a publisher-stated one. The three Norwest rows that share
a description, a suburb and a cost to the dollar are **flagged and not merged**,
and counted as three applications rather than three projects. Totals are
labelled by basis: five selected applications, council-wide cost, council-wide
dwellings — three different populations, never summed together.

**6 · Risk & interpretation.** Exposure and evidence confidence are separate
columns, because a "Low" resting on a desktop layer is not the same finding as a
"Low" confirmed by certificate. Four of five rows carry an outstanding check and
one is *unresolved rather than favourable*; the page says that in as many words.

---

## 4. Provisional elements, and the stage that closes each

Every provisional element is marked **on the page** in a `PROVISIONAL · Sn`
chip, naming the stage. Nothing is provisional silently.

| Page | What is provisional | Stage |
| --- | --- | --- |
| 2 | The section list and page numbers should be bound from the rendered spine; the master currently indexes page archetypes. | S3 |
| 3 | The projection publishes the three scored rows only. Both absences and their reasons are read from the stored record. | S2 |
| 4 | Named facilities and distances are read from the stored enrichment; the projection publishes no `amenity` namespace. | S3 · S4 |
| 5 | The six-category filing, the evidence fields and the identity check are the agreed design; only the NSW DA register is integrated today. | S4 |
| 6 | Rows are read from the stored planning and enrichment records; the projection publishes no `risk` namespace with separate exposure and evidence fields. Rating and confidence chips are drawn from a fixed palette in the block. | S3 · S4 |

The published binding namespaces today are `assessment, brand, financials,
narrative, opportunities, property, recommendation, report, scores, summary`.
`coverage`, `planning`, `infrastructure`, `amenity`, `location` and `risk` are
not among them, which is why pages 4–6 read the stored record directly and say
so rather than pretending to a binding that does not exist.

---

## 5. Defects this render found, that nothing else had

Each was found by drawing the pages, not by reading the code.

**D1 — `columnWidths` is a fraction, and four call sites read like points.**
`data-table` emits `width:${w * 100}%`. Passing `[150, 55, 60, 216]` yields
`15000%`, which the engine normalises into proportions that are nothing like
the author's intent, so cells wrap where they should not. Neither the type nor
any check catches it. *(S3 — a schema constraint or a runtime assertion.)*

**D2 — `data-table` has no `rowHeight` and no `align`.** Both were being
passed and both are inert; alignment comes from `numericColumns` and row height
from `cellPadding` plus the font size. Anything that sizes a table from
`rowHeight` is sizing from a number nothing reads. *(S3.)*

**D3 — `amenity-matrix` reads no tokens at all.** Every colour in it is a
literal (`#1A1A1A`, `#BF9B50`, `#F4F0E6`, `#DCDCDC`, `#3C3C3C`), so it can never
wear a template's colourway, and `title: ''` draws an empty black band. It has
**zero call sites in all 500 catalogue masters** — the same "a component is not
shipped until something renders it" class the builder portal hit, this time in
the block registry. Page 4 uses a `data-table` instead. *(S3 — tokenise or
retire.)*

**D4 — `risk-register` draws its title band unconditionally**, so `title: ''`
is an empty obsidian bar rather than no band. *(S3.)*

**D5 — the rating and confidence chips ignore the colourway.**
`RATING_PALETTE` and `CONFIDENCE_PALETTE` in `_chips.html.ts` are fixed
literals, and `chip()` sets `border-radius` from the font size, so a family
declaring `radius: '0'` still gets pills. Visible on page 6.
*(**Colour: done in S3** — both palettes resolve `token:chip*Bg` / `token:chip*Fg`
with today's value as each fallback, so a palette now has somewhere to say so
and every existing document renders unchanged; see `S3_SHARED_PATH.md` § 7.
**Radius: open, and it is a different question.** A colourway is tokens and
nothing else — the catalogue's own rule — while `radius` is a FAMILY manifest
property delivered to a block as a prop, so closing it means the master passing
a radius to `risk-register` and `scorecard`, which is a re-seed of all 500
masters rather than a change in this tree.)*

**D6 — `decision-box` truncates at 60 words and prints an ellipsis.** The
`maxWords` prop exists for exactly this reason and the catalogue passes 90; a
caller that does not pass it ships a client-facing sentence stopping
mid-clause. Page 4 hit it. *(No repair needed — the prop is the fix, and the
`callout()` helper here passes it. Worth a lint rule in S3.)*

**D7 — every templated report fails its own declared PDF/UA-1 conformance.**
The route asks for `pdf/ua-1` by default; the `image` block emits no `alt`
attribute and has no prop for one; the engine warns *"has no required alt
description"*; the service only fails on warnings when `strict` is set, and it
is not. So the letterhead mark on every page of every templated report breaks
the accessibility variant the file claims. **Reproduced on this render** — the
warning is in the script's output.
*(**Done in S3.** It was worse than this note knew: `alt=""` and no attribute at
all produce a byte-identical PDF on WeasyPrint 69.0, so the two blocks that
carried `alt=""` were failures rather than mitigations. One `imgTag` emitter
now describes every image, and the claim is measured on the artefact by veraPDF
1.30.2 rather than asserted from the export settings — three documents at zero
failed rules. `S3_SHARED_PATH.md` § 5.)*

**D8 — two CSS declarations the compiler emits are unknown to the pinned
engine**: `print-color-adjust: exact` and `isolation: isolate` are both
dropped. Cosmetic, but they are declarations that do nothing. *(S3.)*

**D9 — the record contradicts itself about transport, three ways.** The
enrichment stores `transport.stopsWithin1km: 117` beside its own
`detailedStops` list of **eight** and a `radiusMetres` of **1,600**; separately,
the amenity register's own `Public Transport` category stores `count: 0`,
`nearest: null` at the same coordinate while the GTFS feed answers with a stop
at 106 m. That is the `placesAvailability` class — a category that returned
nothing is not a measurement of nothing — and a count that contradicts its own
list. Pages 4 and 6 print **only** what the record can support and disclose the
contradiction. *(S2 — the enrichment; the pages are already honest.)*

**D10 — a stored remedy is written as though the work were done.**
`investment_score.gradeGaps[risk].remedy` reads *"Answered property-risk
questions from the per-class schema (hazard, planning, condition, strata)."* —
a past participle where an imperative belongs. Both remedies are also operator
language ("re-acquires the enrichment with its acquisition stamp (RF-7.2B)").
Page 3 prints the record's **reason** and withholds both remedies, and says so
in the chip. *(S2.)*

---

## 6. Checks run against the exact delivered file

| Check | Result |
| --- | --- |
| Financial preservation gate (`financialPreservation.spec.ts`) | **18 / 18 pass** |
| `tsc --noEmit` | clean |
| `eslint` on the new script | clean (script directory is outside the eslint config) |
| `npm run audit:style` | under baseline, no new violations |
| Page-foot clearance, all six pages | pass (measured, above) |
| Placeholder scan of the rendered text — `undefined`, `null`, `NaN`, `{{`, `N/A`, "not available", `[XX`, "A further … characters", "are not shown", `TODO`, `Lorem` | **0 occurrences of each** |
| Per-page content (extracted characters) | 619 / 884 / 1,622 / 1,995 / 2,191 / 1,888 — no empty or stub page |
| Engine warnings | 3, all named in §5 (D7, D8) |

---

## 7. What this stage did **not** touch

CGR, the growth estimation method, pre-generation input controls and defaults,
the accepted growth value, financial formulas, compounding, scenario
calculation, precision, the Cash Flow connection and previously stored
assumptions and projections are all unchanged. No production code path, edge
function, migration or deployment was modified. The two new files are a
composition script and two rendering helpers, all under `scripts/reports/`.
