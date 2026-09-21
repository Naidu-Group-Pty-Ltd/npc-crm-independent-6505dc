# Stage A — what was built, what was measured, and what is not yet true

19 September 2026. Branch `claude/reporting-engine-audit-4850hs`, PR #2700.

Stage A asked for one complete, freshly researched Cowra Compass produced by
the candidate's real acquisition and composition paths, with substantive
zoning/planning and infrastructure chapters, reconciled claims and improved
headings; plus a concise evidence record and the completed five-format
ownership matrix — and to **clearly distinguish any retained-data replay from
fresh generation.** This is that distinction, stated first.

---

## 1. What is fresh, what is composed, and what is not yet possible

| | State | Why |
|---|---|---|
| **The research** | **Fresh.** Retrieved 19 Sep 2026 by execution from the production egress. | 38 NSW planning layers asked explicitly by id; the cadastre; the address point; the instrument's land use table; three dated Health Infrastructure pages. Every URL is in the evidence record and every answer is reproducible. |
| **The two chapters** | **Composed by the production modules, from that evidence.** | `scripts/verify/cowra-chapter-demo.mjs` runs `buildPlanningFacts` → `renderPlanningControls` → `planningFactBlocks` and `projectsNear` → `renderPublishedProjects` → `publishedProjectRules`. The output is `COWRA_REBUILT_CHAPTERS.md`. It is what the chapter will contain. |
| **A fresh end-to-end generation** | **Not yet possible, and saying otherwise would be false.** | The acquisition runs in deployed edge functions. These changes are on an unmerged branch, so a generation today would run the OLD deployed code — which is precisely the code that never asked the planning register for this property. Stage C's merge and deploy gates are what make a generation fresh. |

**No report row was written, regenerated or modified.** The stored Cowra
record is untouched; nothing here overwrites an issued report or a customer
edit. A$0.00 of the A$25 test budget has been spent.

---

## 2. The finding that changes the document

The report describes 48 Redfern Street as sitting "within Cowra's core
residential belt". The register says the land is zoned **E3 Productivity
Support** — an employment zone — uniformly across the whole of Lot 19, at the
centroid and at all four corners.

Read from the zone code alone that is a house in the wrong zone, and a
reasonable person concludes the dwelling survives on existing-use rights. The
instrument's own land use table says otherwise, and says something sharper:

- **Dwelling houses** is named at item 3 — *permitted with development
  consent*. The house is a permissible use, not a legacy one.
- **Residential accommodation** — the group term covering secondary dwellings,
  dual occupancies, multi dwelling housing, attached dwellings, seniors
  housing and the rest — is named at item 4, *prohibited*. So **no additional
  dwelling may be put on that 991 m² block at any size.**

Neither reading is available from the zone code. The first would have been
stated wrongly; the second is exactly the inference the standard forbids
drawing from block size — *"a large block alone does not establish subdivision
or secondary-dwelling potential"* — settled here in the other direction by the
instrument itself.

The zone's own objectives name the street: *"To ensure commercial development
in the Redfern Street area … does not detract from the core commercial
functions of the Cowra central business district."*

---

## 3. Why the old report had none of it

`data_sources` on the stored row has **no planning key at all** — not a null, no
key. The generator's planning fetch is guarded on
`enhancedData.locationIntelligence?.coordinates`; the location enrichment
produced nothing; the call was skipped silently, with no error and no log line.
The document then printed planning content anyway, from the prompt template.

That guard is one instance of a general defect. `data_sources` is composed as
`enhancedData.X ? stamp : null` under a comment reading *"A null is a fact ('we
asked and got nothing'), never an error"* — and the code cannot support it. Six
producers were null on the Cowra row beside `errorsEncountered: 0`.

---

## 4. What shipped

| # | Change | Verified by |
|---|---|---|
| 1 | **The evidence contract removes rather than tabulates.** An unsupported share or series leaves the client document and is returned on `findings` as the audit record. A supported dataset a chart cannot render still falls back to a table. | Measured on the real Cowra record: gauge 3→0, wheel 1→0, margin 1→0, pictograph 1→0, donut 3→1, bars 7→4; glance/tiles/timeline untouched; prose byte-identical. 23 specs. |
| 2 | **The acquisition ledger.** Five outcomes per producer — answered, never requested, requested and failed, retrieved and not bound, unavailable in coverage — recorded at every acquisition site and persisted on `data_sources._acquisition`. A producer nobody accounted for is named in `unaccounted`. | 16 specs, including source-level assertions that the planning guard records its skip and that the ledger is built after the late fetches. |
| 3 | **The instrument's land use table.** Retrieved for NSW, read for what it says about living on this land, rendered with the reading and the neighbouring uses. The specific-over-general rule is applied in exactly one direction. | 15 specs against the real Cowra answer, duplicates included. |
| 4 | **The published project register.** Major public projects recorded from their publisher's own dated pages, labelled as recorded rather than retrieved. One project, one investment figure; stages carry no amount, by construction. | 22 specs. |
| 5 | **The running head names the chapter.** Derived from the same packing that decides the page breaks, estimated by the projection and overwritten by the renderer's pre-pass. "The report" heading deleted. | 13 specs. |
| 6 | **`Agriculture-dominat…` fixed.** `fitLines` broke on whitespace only, so a hyphenated compound was one token that never wrapped. It breaks after a hyphen or slash between letters now — never between digits. | 6 specs. |
| 7 | **The five-format ownership matrix**, generated from the registry with a spec that fails on drift. | 5 specs. |
| 8 | The register's own denominator error corrected (§7a). | — |
| 9 | **The constraints table's columns are sized to what they carry.** 4 of 50 Commercial Capacity masters printed their table over the explanation beneath it, because the four value columns took a fixed 330 pt and left the test name 87–117 pt against a vocabulary running to 31 characters. | Measured in Chromium at A4 across all fifty masters: before, Grand Folio +29.1 pt, Night Desk +12.4, Elevation +11.9, Sovereign Folio +5.2; after, **0 of 50 overlap and 0 of 400 rows wrap**. The spec pins the rule and fails on the old widths. |
| 10 | **A listing's claims arrive attributed.** The prompt asked a model for the listing's "features, upgrades, and selling points" and "any specific renovations", three lines under a rule declaring condition record-governed — and the record holds no condition field, so "renovated" reached the page three times as the report's own assertion. | The instruction and `claimSupportRules` rule 4 now state one rule; both pinned, including that the bare instructions are gone. |
| 11 | **The PDF outline names the report's own sections.** It named the furniture only: measured on a Chancery Compass carrying a real narrative, the contents listed nine rows including "Zoning, Planning and Development Considerations" while the outline held seven, every one a page archetype. `narrativeIndex.ts` says the two surfaces "cannot describe the document differently" — the narrative page's own entry stands down, and nothing was replacing it, so the outline LOST the row rather than gaining the section. | Re-measured: the outline carries the same nine entries as the contents. The tier is `listedSectionLevel`, the rule and the index the contents already reads, so a masthead `h1` cannot be promoted — checked on that shape too, where both surfaces name the same thing. 2 specs. |

Gates at each commit: `npx tsc --noEmit` clean; `check-edge-functions.mjs`
334/334 baseline, no new errors; `check-edge-column-names.mjs` clean; the
reports suite green.

### The render QA, in full

`npm run templates:compass:qa` **ran to completion**, which this programme had
not previously achieved. Measured 19 Sep 2026: 500 templates, 500 declared
combinations, **510 browser renders**, 100 PDFs, 715 screenshots. It reported
**2 blocks printing over another**, both the same page of the same format —
`Grand Folio` (20 pt) and `Elevation` (3 pt), p3 "The tests", the constraints
table over the explanation beneath it. That page is composed by
`commercialCapacity.ts`, a file this branch had not modified (`git log
b7ec43d99..HEAD --name-only -- scripts/template-library/` names only
`templates.ts`), so they were pre-existing rather than a regression of this
work — and the ink measure understated them. Rendering all fifty Commercial
Capacity masters and comparing each table's drawn box against what `flow()`
reserved found **4 of 50** overlapping: Grand Folio +29.1 pt, Night Desk
+12.4, Elevation +11.9, Sovereign Folio +5.2. The other two overlapped by box
alone, which is the same defect one paragraph away from being visible.

The cause is measured, not inferred. The four value columns took a fixed
330 pt, which on the families with the deepest margins left the test-name
column 87–117 pt — narrower than the vocabulary it holds. `CONSTRAINT_LABELS`
is a closed set of ten strings and three of them run 24 to 31 characters, so
those rows wrapped to two lines while `table()` declared one. Measured in
Chromium at A4 across all fifty masters, for the longest string each column
can carry and for the column heads (mono, tracked — the wider requirement in
`This deal`): Test 147.8, Permits 66.6, Policy 42.0, This deal 53.8, Status
73.9. The value columns are now 75/48/60/82 = 265 pt, which leaves every
family at least 152 pt for the name. Re-measured: **0 of 50 overlap, 0 of 400
rows wrap.** `investmentCompassCatalogue.spec.ts` and
`investmentCompassSource.spec.ts` pass (1,327 assertions).

The whole gate was then re-run on the changed masters and is **green**:

```
Investment Compass — render QA
  500 templates, 500 declared combinations
  510 browser renders (one per master + one dark per family)
  100 PDFs, 715 screenshots → audit-output/investment-compass/

✓ no block overflows its page, and none prints over another, in any of the 510 renders
EXIT=0
```


---

## 5. What Stage A did not close

Stated plainly rather than left to be discovered.

1. **No fresh end-to-end generation** — see §1. It needs the deploy.
2. **The remaining §2 claims are closed at the PRODUCER and still stand in the
   STORED document.** Each was traced to the code that produced it rather than
   assumed:

   | claim in the document | what the record holds | where it is closed |
   |---|---|---|
   | "seven in ten sales are traditional family houses" | no sales register was read; `marketData: null` | `claimSupportRules` rule 2 — names "7 in 10", "the majority", "most" and says there is no denominator |
   | population and occupier-mix statements around the removed chart | `demographics_data: NULL`, population withheld at the client-safe gate | rule 1 — forbids "roughly", "around half", "predominantly", and a suburb's composition as this property's tenant mix |
   | "Bedrooms: 3", "Bathrooms: 1", "the classic three-bedroom, one-bathroom layout" — beside two sections saying the counts are not recorded | `property_specs.bedrooms: null`, `bathrooms: null` | `RECORD_GOVERNS_PHYSICAL_ATTRIBUTES`, landed 17 Sep 2026; this report was generated 11 Sep 2026 |
   | "Well-presented renovated home", "a detached, renovated 3-bedroom residential home", "given the renovated interiors" | the record holds **no condition field at all** | the listing instructions and rule 4, this branch — a listing is an advertisement and its claims arrive attributed |

   None of that changes the stored document, and nothing here rewrites it. A
   corrected revision is a generation, which §1 says needs the deploy.
3. **Cowra Shire Council's capital works programme, its DA register and its
   Development Control Plan** were not retrieved. The infrastructure register
   states that limitation on the page.
4. **`legislation.nsw.gov.au` refuses this egress** — a Cloudflare managed
   challenge on the HTML view, the PDF and the XML export alike, and again from
   headless Chromium. Any future feature needing instrument text must go through
   the Planning Portal's structured services.
5. **Seed regeneration.** The master changes — the running head, the narrative
   box and the constraints-table columns above — are in
   `scripts/template-library/`; `npm run templates:library:seed` has not been
   re-run, so the seeded catalogue still carries the old furniture. Each seed
   migration is a ~41 MB generated artefact and one is written per release, so
   it belongs to the Stage C release step rather than here; until it runs, none
   of the master changes reaches a deployment.

---

## 6. Where the evidence is

| Document | What it holds |
|---|---|
| `COWRA_EVIDENCE_RECORD.md` | Every fact, its source, retrieval date, publisher's currency date, geographic scope and material limitation. Including what was asked and is not there. |
| `COWRA_REBUILT_CHAPTERS.md` | The two chapters as the production modules compose them. |
| `SECTION_OWNERSHIP_MATRIX.md` | 40 topics × 5 formats: producer, full-detail owner, permitted summaries. |
| `COWRA_VISUAL_REGISTER.md` | The 21-row visual register, with §7a correcting its own denominator error. |
