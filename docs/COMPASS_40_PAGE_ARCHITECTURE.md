# Compass Report Architecture

The Investment Location & Property Fit report's structure. Backend APIs,
calculations and financial engines are untouched by it.

**v3.0 (the commentary strip) is the current version.** See
[`docs/reports/INVESTMENT_STRUCTURE.md`](./reports/INVESTMENT_STRUCTURE.md) for
what changed and the production measurements behind it. In short: 17 sections
became 11 plus back matter, the four-block commentary style was removed
outright, and the post-processor that enforces all of this was wired into the
generator for the first time.

## Two reports, one data set

| Report | Purpose | Pages | Section registry |
|---|---|---|---|
| **Compass Report** (`tier=compass`) | Client-facing macro / suburb / planning / risk / non-financial property fit | 23 (band 20–26) | `COMPASS_40_SECTIONS` |
| **Financial Analysis Report** (`tier=financial`) | Yield, loan, cashflow, sensitivity, 10-yr, tax, serviceability | ~20 | `FINANCIAL_ANALYSIS_SECTIONS` |

Both render from the same upstream API / calculation outputs. Selection happens
at the **rendering layer** via the section registry.

## Source of truth

- Edge runtime: `supabase/functions/_shared/compassSectionRegistry.ts`
- Frontend mirror: `src/lib/reports/compassSectionRegistry.ts`

**These two files must stay in sync.** Edge functions cannot import from
`src/`, so they are duplicated by design. Any structural change must be made in
both places — and `src/lib/reports/__tests__/compassRegistryParity.spec.ts` now
fails the build if it is not. That check exists because the instruction alone
did not work: the two copies drifted to 672 lines against 174, which
`docs/reports/DESIGN_SYSTEM.md` records as the cautionary case.

## Classification metadata (per section)

| Field | Purpose |
|---|---|
| `includeInCompass` / `includeInFinancialReport` / `includeInAppendix` / `isInternalOnly` | Routing flags |
| `sectionPriority` | `Protected \| High \| Medium \| Low \| Excluded` — controls page-pressure trimming |
| `maxWordCount` | Per-section narrative cap (excludes tables / visuals) |
| `pageBudget` | Target page allocation in the report layout |
| `visualComponents` | Required visual blocks (scorecard, riskRegister, infraTimeline, …) |

`allowDecisionBox` was removed in v3.0 along with the boxes themselves. The
forbidden strings are `EDITORIAL_LABELS` in the same file; nothing in the
registry grants permission for one.

## Compass section order (11 sections + back matter, 23pt)

```
 1  Cover Page                                  1pt
 2  Executive Verdict                           2pt   [PROTECTED]
 3  Property & Locality Snapshot                2pt
 4  Why This Location Matters                   3pt   [PROTECTED]
 5  Demand Drivers                              3pt
 6  Amenity & Access                            3pt
 7  Market Positioning                          2pt
 8  Property Fit Within the Suburb              2pt   [PROTECTED]
 9  Risk Dashboard                              2pt   [PROTECTED]
10  Due Diligence Checklist                     1pt   [PROTECTED]
11  Final Recommendation                        1pt   [PROTECTED]
--  Appendix, Source Notes & Disclaimer         1pt   (back matter)
                                       Total: 23pt
```

**Demand Drivers** absorbs the v2.0 Population & Housing Demand, Tenant & Buyer
Profile and Employment & Economic Linkages. **Amenity & Access** absorbs
Education & Family Amenity, Retail/Healthcare & Lifestyle Amenity and
Transport & Connectivity. **Client Reading Guide** is gone: it was a prose
contents page listing the sections that followed, and the typeset document has
a real contents page.

The table that stood here listed 21 sections and had not matched the registry
since v2.0 shipped 17.

## Page-pressure trim order

When the rendered page count exceeds the 20–26 band, sections are trimmed in
this strict order. **Protected sections are never reduced.**

1. Strip repeated transition paragraphs
2. Cap school / amenity / transport lists to top 5
3. Merge duplicate demographic / employment commentary
4. Move long lists to appendix
5. Reduce Demand Drivers to 1 page
6. Reduce Amenity & Access to 1 page

"Collapse duplicate What This Means boxes" was step 2 and is gone: there is no
permitted first box to collapse to, and `stripEditorialBlocks` removes all of
them before page pressure is measured. Steps 5 and 6 previously named
`compass.economicContext` and `compass.suburbCharacter`, neither of which has
existed since v2.0 — so both were no-ops for their whole life.

## Word caps (`COMPASS_WORD_CAPS`)

| Block | Cap |
|---|---|
| Executive Verdict (total) | 300–450 |
| Section opening takeaway | 35–50 |
| Standard paragraph | 45–80 |
| Risk item explanation | 25–45 |
| Planning item explanation | 40–70 |
| Final recommendation | 150–250 |

The `whatThisMeansBox` cap is gone with the boxes. Per-section ceilings live on
each registry entry as `maxWordCount` and now total ~5,010 words against v2.0's
9,170 — and are enforced, which they were not.

## Approved hand-off copy

A single non-calculation sentence appears at the end of the Compass executive
summary pointing to the Financial Analysis Report
(`COMPASS_FINANCIAL_HANDOFF_COPY`).

## Roadmap

| Phase | Status |
|---|---|
| 1 — Classification metadata layer | **Done** |
| 2 — Compass-40 section registry + UI tier | **Done** |
| 3 — Financial Analysis Report generator branch | **Done** |
| 4 — Visual component library (scorecard, riskRegister, infraTimeline, matrices) | **Done** — 8 blocks live: `scorecard`, `strengths-watch`, `risk-register`, `infra-timeline`, `amenity-matrix`, `planning-table`, `dd-checklist`, `decision-box`. Registered in `BLOCK_RENDERERS` + `BLOCK_DEFS` + Template Builder palette |
| 5 — Word-cap enforcement (prompt + post-trim) | **Done** |
| 6 — Page-pressure trimming engine | **Done** |
| 7 — QA automation (page band, financial exclusion, duplicates, artefacts) | **Done** |

## Phase 4 block reference

| Block type | Compass section | Visual |
|---|---|---|
| `scorecard` | §5 Macro Scorecard | 8-row table with Strong / Moderate / Watch chips |
| `strengths-watch` | §6 Strengths & Watch Points | Two-column green/amber lists |
| `infra-timeline` | §8 Infrastructure Pipeline (PROTECTED) | Horizontal timeline: Existing → Long-term, with confidence chips |
| `amenity-matrix` | §15 Amenity Matrix | Amenity / Current / Future / Relevance grid |
| `risk-register` | §17 Risk Register (PROTECTED) | Risk / Rating / Confidence / Why / DD Action |
| `planning-table` | §19 Planning (PROTECTED) | Item / Status pill / Relevance / Action |
| `dd-checklist` | §10 Due Diligence (PROTECTED) | Checkbox list with owner + timing |
| `decision-box` | **No longer used by the Compass generator** | Accent-bar panel. The block renderer stays — Template Builder offers it and other formats may use it — but no Compass section requests one. |

All blocks share `src/lib/reportTemplate/blocks/_shared.ts` for rating chips,
confidence chips, and colour parsing. Each is bindable (`{{path | filter}}`)
and theme-token aware (`token:primary`).


## Phase 5 + 6 — Post-processor (`compassPostProcessor.ts`)

Shared module at `supabase/functions/_shared/compassPostProcessor.ts`
(mirrored at `src/lib/reports/compassPostProcessor.ts`). Wired into
`condense-investment-report` for both `compass-40` and `financial-analysis` tiers.

**Phase 5 — Word-cap enforcement**
- Editorial-block removal: every `EDITORIAL_LABELS` string is stripped with the paragraph beneath it, in all three forms the model writes (heading, bold lead-in, bare line). Figures, tables and lists are never consumed.
- Executive Summary: hard-capped to 600 words.
- Per-section narrative cap: each section trimmed to `maxWordCount`. Tables, bullets and headings are preserved.

**Phase 6 — Page-pressure trimming engine**
Estimator: `320 words/page + 18 words/table-row + 30 words/heading`. If pages > band max (Compass 42, Financial 22), runs `PAGE_PRESSURE_TRIM_ORDER` in sequence until under budget:
1. Strip transition paragraphs
2. Collapse duplicate decision boxes
3. Cap school / amenity / transport lists to top 5
4. Merge duplicate demographic / employment subsections
5. Move long lists to appendix (second-pass cap)
6. Reduce Economic Context to one page
7. Reduce Suburb Character / Lifestyle to one page

Sections in `PROTECTED_SECTION_IDS` (`futureInfrastructure`, `riskRegister`,
`zoningPlanning`, `dueDiligence`, `propertyAssessment`) are NEVER trimmed.

Returns a `PostProcessReport` (initial/final word count, estimated pages,
trims applied, sections trimmed, warnings) which is logged and returned in
the function response for QA / observability.


## Phase 7 — QA validator (`compassQAValidator.ts`)

Shared module at `supabase/functions/_shared/compassQAValidator.ts` (mirrored at
`src/lib/reports/compassQAValidator.ts`). Returns a `QAReport` with severity-tagged
findings; wired into the `condense-investment-report` response as `qaReport`.

**Rules enforced**
1. **page-band** — Compass 20–26, Financial 18–22 (error if over, warning if under)
2. **financial-exclusion** — Compass markdown must not match `gross yield`, `LVR`, `LMI`, `P&I`, `weekly rent`, `10-year cashflow`, `sensitivity analysis`, `after-tax cashflow`, `depreciation schedule`
3. **suburb-exclusion** — Financial Analysis must not match `SEIFA`, `school catchment`, `crime`, `flood`, `bushfire`, `demograph`, `infrastructure pipeline`, `zoning overlay`
4. **duplicate-h2** — no repeated H2 headings
5. **duplicate-decision-box** / **forbidden-decision-box** — per-section governance
6. **missing-protected-section** — Compass must include all `PROTECTED_SECTION_IDS`
7. **word-cap** — per-section narrative ≤ 110% of `maxWordCount`

**Test coverage** (`compassPostProcessor_test.ts`, 9 tests, all passing):
- Exec summary cap • Forbidden decision-box removal • Duplicate decision-box collapse
- Bullet cap under page pressure • Protected sections immune to trims
- QA: financial-content detection, duplicate H2, missing protected section
- Page estimator sanity bounds
