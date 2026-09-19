# Owner corrections to the suite rebuild — the ledger

Corrections issued 17 September 2026 after accepting S1's visual direction.
Each is tracked to the stage that closes it. Nothing here restarts the audit or
the redesign; the staged plan is unchanged.

**Status key** — `done` (closed in this repository, with a test),
`open` (accepted, scheduled), `evidence` (closed by a measurement rather than a
code change).

---

## C1 · The two design decisions, confirmed

| | |
| --- | --- |
| **C1.1** Weekly holding position, loan amounts, repayments and financial modelling stay off the Compass cover, and keep their presentation in Financial and the other approved outputs. | **done** — the S1 cover carries none; `TIER_FRAMEWORK.md` § Decision E already governs the split, and the Financial tier is untouched. Re-pinned when the Financial fixture lands in S5. |
| **C1.2** Replace internal engineering remedies with concise, accurate client-facing explanations and actions. Authorised editorial interpretation of the evidence; not permission to invent facts. | **done on the review pages** — page 3 now says what closes each gap in the reader's language and names whose work it is. The shared generator path still prints neither; that is **open · S3** with C6.1. |
| **C1.3** Distinguish work for the report provider from due diligence for the client or a professional. Remove "nothing for the reader to do". | **done** — page 3 now separates them explicitly: the location readings re-acquire on the next production and the property-risk questions are ours to answer, while the certificates and searches on the risk page remain the reader's, before contract. |

## C2 · Assessment presentation

| | |
| --- | --- |
| **C2.1** Distinguish performance on measured criteria, evidence coverage, any evidence-limited grade, and whether the evidence supports an overall conclusion. The cover reads `F · 40` as "assessment performance" while page 3 says the composite would be `C`. | **done** — the cover's band is now `Measured-criteria score 40 · C`, `Evidence coverage 57%`, `Grade issued, after the cap F`, with the fourth reading as the conclusion above it; page 3 carries the same four under their own headings. Every value is read from the record (`v2.score`, `v2.scoreGrade`, `v2.evidenceCoverage`, `v2.grade`). |
| **C2.2** Do not change scoring formulas, thresholds or financial assumptions to solve a presentation problem. | **honoured** — S2's repair restores an input the engine already asked for; no weight, threshold or formula is touched, and `scoringV2Production.pure.ts` is unmodified. |
| **C2.3** Move the nominal-points explanation out of the evidence-coverage display or label it separately. Explain effective weights and rounding. | **done** — coverage is one bar; the nominal-point ceiling has its own section, *Why the grade is lower than the score*, reading its figure out of `v2.gradeCapReasons` and `gradeEligibility.ceiling`. A line under the table explains that the weights shown are re-weighted across what was measured, and names the rounding. |
| **C2.4** All values and conclusions bound to the actual assessment; do not hard-code one property's coverage or preliminary conclusion into reusable templates. | **open · S3** — `s1Pages.mts` is a review composition, not a template, and every figure on it is read from the row; but the conclusion sentence and the `57%` prose are authored strings and must become bindings before any master carries them. |

## C3 · Transport semantics

| | |
| --- | --- |
| **C3.1** Establish whether the stop list is sampled, what each count measures, the radius, pagination and duplicate handling — do not assume eight and 117 contradict each other. | **evidence · done** — traced and written up in [`S2_LOCATION_EVIDENCE_TRACE.md`](./S2_LOCATION_EVIDENCE_TRACE.md) § 3. They do **not** contradict: 117 is every grouped place within **1,600 m**, eight is the nearest-eight sample the record names. S1's note asserting a contradiction was wrong and is corrected. |
| **C3.2** An empty category in one source beside recorded stops in another may indicate differing coverage. | **evidence · done** — differing **definition**, established: the amenity register's `transit` category is four OSM tags (`railway=station|halt|tram_stop`, `public_transport=station`) within 2,000 m and matches no bus stop, so `0` is a true statement about rail and tram stations and says nothing about buses. |
| **C3.3** Label distance measurements accurately; remove walking and car-trip claims the route evidence does not support. | **done** — every distance is now labelled straight-line on pages 3, 4 and 6; "without a car trip" and "walk to the stop" are gone, and the amenity callout says in as many words that a short straight line is not a short walk. |

## C4 · Infrastructure wording and the research commitment

| | |
| --- | --- |
| **C4.1** Replace "is not funded" / "is not under construction" with wording that says those statuses are **not established by the current evidence**. | **done** — page 5 now says funding, commencement and completion are *not established* by anything on the page, rather than asserting they are absent. |
| **C4.2** A determination must not imply a delivery date or funding position. | **done** — the page places nothing on a horizon and says why; retained. |
| **C4.3** Keep retrieved records, confirmed applications and distinct projects distinct until identifiers establish their relationships. | **done** — the three Norwest rows are flagged, not merged, and counted as applications. |
| **C4.4** The wider ten-year research deliverable remains outstanding, with the agreed source coverage and property relevance. | **open · S4** — unchanged from the staged plan. |

## C5 · Risk interpretation

| | |
| --- | --- |
| **C5.1** Do not rate exposure `Low` because a desktop layer returned no mapped feature; use an undetermined status. | **done** — environmental exposure reads `Not established`, and the row says it is an absence of mapping rather than an absence of hazard. Floor space ratio reads the same. |
| **C5.2** `Verified` must name **what** is verified, without implying the property-risk assessment is settled. | **done** — the evidence column now reads `Desktop layers only`, `Mapped control`, `Not published`, `Council-wide count`, `Stop register only`. The word "verified" appears nowhere on the page. |
| **C5.3** Correct the FSR explanation: floor space ratio is total floor area to site area, not building footprint. | **done** — "FSR caps total floor area across all storeys against site area — not the footprint." |
| **C5.4** Remove "ordinary pre-contract work"; correct "four of the five carry an outstanding check" — the table gives an action for all five. | **done** — "All five rows carry an action", and the reassurance is replaced by naming the two rows that are not established and saying the page is a starting list for due diligence rather than a clearance. |
| **C5.5** Retain the exposure / evidence-confidence separation. | **done** — retained. |

## C6 · Client-facing treatment

| | |
| --- | --- |
| **C6.1** Internal field names, namespaces, implementation details and engineering remedies belong in the review notes, not the report. | **open · S3** — `stopsWithin1km`, `RF-7.2B` and the provisional chips' vocabulary are all on the S1 pages by design for review, and none may survive into a client document. |
| **C6.2** Concise source, date and measurement-method references on the page; detailed provenance in the appendix. | **partly done** — page 6 carries a *Where each row came from* line naming publisher, window and method, and page 4's standfirst names both registers and the measurement method. The other pages and the appendix are **open · S3**. |
| **C6.3** Use the selected template's typography and colours consistently, including the risk components. | **partly done** — the risk page is drawn on the template's own ledger treatment, so it now wears the colourway, and the exposure / evidence separation is kept as two columns. The shared `risk-register` block's chips read `token:chip*Bg` / `token:chip*Fg` now, with today's literal as each fallback, so a colourway reaches them and no existing document changes — **colour done · S3**. They still ignore `radius: '0'`, which is a different question: a colourway is tokens and nothing else, and `radius` is a family manifest property a master would have to pass, so closing it is a re-seed of 500 masters — **open · not S3**. |
| **C6.4** Treat the prototype's parent-report page references as provisional; verify contents destinations, pagination and bookmarks through the actual template workflow. | **open · S3** — already chipped provisional on page 2. |

## C7 · Content completeness and integration

| | |
| --- | --- |
| **C7.1** Fitting on the page does not prove content survived; verify completeness alongside overlap and footer clearance. | **done for the review harness** — every authored string is now looked for in the rendered text, read in content order (`-raw`; layout mode interleaves a table's columns and reported 27 false losses). Verified by effect: forcing the word cap back to 20 names all four truncated callouts, restored it passes 156 of 156. The same check on the shared rendering path is **open · S3** with C7.2. |
| **C7.2** Implement the approved treatment in the existing shared rendering path so it reaches user-generated reports. | **open · S3** — `s1Pages.mts` is a review composition and reaches no user. |
| **C7.3** Address the reported accessibility defects and validate the affected outputs; keep conformance claims to what is verified. | **open · S3** — S1 defect D7: the `image` block emits no `alt`, the route declares `pdf/ua-1`, and the service fails on engine warnings only under `strict`. |

## C8 · Programme

| | |
| --- | --- |
| **C8.1** Proceed with S2; track these against S2, S3 and S4. | **done** — this ledger. |
| **C8.2** CGR, pre-generation inputs, accepted assumptions and the Cash Flow connection unchanged; preservation gate maintained. | **honoured** — gate green at 18 of 18 after every change in S2. |
| **C8.3** Continue delivery across Compass, Financial, Strategic, Briefing and Snapshot; S1's design acceptance does not close implementation, suite verification or production release. | **open · S3 – S6** — unchanged. |
