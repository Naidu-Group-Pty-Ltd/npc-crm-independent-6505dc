# The Report Fact Contract — v1.0.0 (Investment Property Report)

`supabase/functions/_shared/reports/contract/reportFactContract.pure.ts`
(bridge: `src/lib/reports/contract/reportFactContract.pure.ts`)

One typed, versioned, deterministic answer to *what does this report actually
know, how does it know it, and how much of it is absent?* — introduced **beside**
the working Reporting Engine, with **no production consumer switched**.

Read [`RF71_CAPABILITY_INVENTORY.md`](./RF71_CAPABILITY_INVENTORY.md) first: it
is the characterisation of what exists today, traced to real callers, and the
preservation argument this document rests on.

---

## 1. Why it exists

"What is this report's purchase price?" has as many answers as it has readers.
The viewer, the PDF projection, the template adapter, the comparison producer and
the Q&A surface each carry their own `??` chain over `manual_overrides`,
`financial_calculations` and `property_specs`. None of them is wrong; they simply
have never been the same expression, and `DERIVED_FIGURES.md` already measured
what that costs — 6 gross-yield definitions, 4 net, 8 LVR.

`historicalFactAuthority.pure.ts` settled the precedence for eight of those
fields, with a measured basis (140/140, 150/150, 153/153 exact agreement across
443 paired rows) — and **has no production consumer**. This contract adapts it
rather than becoming a third implementation of the same ordering.

## 2. What it is NOT

- **Not a replacement.** RF-7.1 is a strangler: `existing system + contract`,
  never `existing system → deleted → contract`.
- **Not a recomputation.** It reads what the canonical owners publish. It does
  not re-run the stamp-duty engine, does not regenerate a projection, does not
  re-derive a loan from a deposit and does not re-score anything.
- **Not a repair.** No write, no backfill, no migration, no healing beyond the
  read-time behaviour `reconcileStoredFinancials` already performs for every
  existing reader.
- **Not a second opinion.** Where it disagrees with the current path, that is a
  defect in the contract — and the parity ledger in §6 is how that is proved,
  not asserted.

## 3. Ownership — the contract owns nothing

| Fact family | Canonical owner (unchanged by RF-7.1) |
| --- | --- |
| The eight observed/derived record facts | `facts/historicalFactAuthority.pure.ts` |
| Yield, LVR, equity, cash-on-cash, identity breaches | `metrics/propertyMetrics.pure.ts` |
| The finance block and its read-time reconciliation | `investment/financialEngine.pure.ts` |
| Property specs, the type vocabulary, phantom keys | `investment/propertyRecord.pure.ts` |
| Stamp duty and acquisition costs | `stampDuty/engine.pure.ts` (**read**, never re-run) |
| Locality identity | `public.report_geography` |
| Scoring authority and grade issuance | the `policy` stamp the scoring run wrote |

The dependency arrow points one way, and a test asserts it: the contract imports
owners; **no owner imports the contract**.

## 4. The shape

```ts
Fact<T> = {
  status: 'present' | 'absent'
  value: T | null                       // null exactly when absent
  absence: { reason, neverCaptured } | null
  owner: string                         // the canonical module. Never this file.
  sourcePath: string | null             // the exact path read, for audit
  provenance: 'observed' | 'derived' | 'unavailable'
  temporality: 'snapshot' | 'derived' | 'record'
  basis: string | null                  // 'Gross yield (on purchase price)'
  supersededValue / supersededSource    // a disagreeing lower source, kept
}
```

Sections: `record`, `geography`, `property`, `finance`, `derived`, `scoring`,
`projection`, `integrity`.

### The four rules it is built on

**Absent is absent.** Never `0`, never `''`, never `false`, never a default
house, never a placeholder coordinate. Every absence carries a sentence, and
`neverCaptured` separates "the platform never held this" from "this is held but
not published" — two different remedies.

**A trusted metric is not a scored assessment.** Gross yield is arithmetic on two
figures an operator stated. A dimension score is a judgement an engine made. They
are in different sections and a test asserts `scoring` contains no yield or LVR.

**Geography identity is not Location scoring.** `report_geography` only — a
point-in-polygon answer against ABS ASGS 2021. The contract never names
`location_intelligence`, `walkScore`, `commuteTimeCBD`, `schoolsNearby` or
`property_address`, asserted by source-level tests.

**Finance is not property quality.** Leverage and holding cash flow describe the
buyer, live in `finance`, and reach no assessment.

### Purity (rule 10)

No clock, no randomness, no `fetch`, no Supabase client, no `insert`/`update`/
`upsert`/`delete`, no `await` at all. `observedAt` is a parameter. All asserted
by reading the module's own source, so the property cannot decay.

## 5. Capability parity — before and after RF-7.1

| Capability | Before RF-7.1 | After RF-7.1 | Preserved? |
| --- | --- | --- | --- |
| Report creation | `generate-investment-report`, 6 callers | identical | **Yes** |
| Generation / section loop | browser loop + `last_completed_section` | identical | **Yes** |
| Resume (watchdog) | pg_cron `investment-report-resume-2min` | identical | **Yes** |
| Manual overrides | 45 modules; `overrides.pure.ts` | identical | **Yes** |
| Property parsing / import | `scrape-property-listing`, `parse-property-pdf` | identical | **Yes** |
| Report versions | `report_versions` via the broker | identical | **Yes** |
| Report reopen | `/generated-reports/:reportId`, `/investment-report/:id` | identical | **Yes** |
| Historical snapshots | rendered as stored | identical — **nothing rewritten** | **Yes** |
| Regeneration | `useChunkedRegeneration` | identical | **Yes** |
| Qualitative regeneration | `regenerate-report-qualitative` | identical | **Yes** |
| Forked / derived reports | `fork-investment-report`; lineage columns | identical | **Yes** |
| Strategic variants | 5 variants in `reportVariants.ts` | identical | **Yes** |
| Briefing / Snapshot derivation | `condense-investment-report` | identical | **Yes** |
| Financial Modelling | `financialEngine.pure.ts` | identical | **Yes** |
| 10-Year Cash Flow | `generateProjections`, cash-flow routes | identical | **Yes** |
| Scoring state | `investment_score` + the policy stamp | identical | **Yes** |
| Finance Suitability | shadow-only, unwired | identical | **Yes** |
| Property / hero images | `prepare-report-hero-images`, `hero-image-studio` | identical | **Yes** |
| Charts | `vizDirectives` → `vizFigures` | identical | **Yes** |
| Market / demographic content | 26 modules | identical | **Yes** |
| Templates / user selections | `manage-templates`, 33 callers | identical | **Yes** |
| White-label branding / brand snapshots | `reportDesign/snapshot.pure.ts` | identical | **Yes** |
| HTML preview | `weasyPreview`, the viewer | identical | **Yes** |
| Server renderer (legacy) | `render-investment-report-pdf` | identical | **Yes** |
| Design-system renderer | `render-template-pdf` | identical | **Yes** |
| Browser PDF / export | `PixelPerfectPDFGenerator`, `clientPdfDownload` | identical | **Yes** |
| Delivery fallback chain | template → legacy, throws only if both fail | identical | **Yes** |
| Generated Reports view / Viewer / client view | 3 surfaces | identical | **Yes** |
| Report sharing / Finance sharing | portal publish, `share-report-with-finance` | identical | **Yes** |
| Report Q&A | `report-qa`, 9 callers | identical | **Yes** |
| Comparison inputs | `compare-investment-reports` | identical | **Yes** |
| Automation / bulk | `auto-report-sync`, `bulkReportWorker` | identical | **Yes** |

**Production consumers switched: 0.** Asserted executably — a test walks `src`
and `supabase/functions` and fails on any non-test file naming
`buildReportFactContract`.

## 6. Value parity — the golden-master ledger

Run against **32 real production rows** drawn from `investment_reports`
(`is_archived = false`) across **20 strata**: manual overrides, sentinel
coordinates, no coordinates, finance-without-rent, house-and-land, land, attached
dwellings, placeholder types, high LVR, no-finance-with-a-V1-score, metro,
regional, forked, derived, multi-version, and one of each of the five variants.

For every material fact the ledger walks the **current path** — the canonical
owner called exactly as production calls it — and the **contract path**.

```
contract version  1.0.0
rows              32
comparisons       896
matched           896
mismatches        0
non-null current  504 of 896  (56.2%)
```

| Fact | rows | present | matched |
| --- | ---: | ---: | ---: |
| `finance.purchasePrice` | 32 | 25 | **32** |
| `finance.weeklyRent` | 32 | 19 | **32** |
| `finance.lvr` | 32 | 21 | **32** |
| `finance.deposit` | 32 | 17 | **32** |
| `finance.loanAmount` | 32 | 16 | **32** |
| `finance.weeklyCashFlow` | 32 | 16 | **32** |
| `finance.annualOutgoings` | 32 | 16 | **32** |
| `finance.stampDuty` | 32 | 17 | **32** |
| `finance.totalUpfront` | 32 | 17 | **32** |
| `derived.grossYield` | 32 | 19 | **32** |
| `derived.netYield` | 32 | 14 | **32** |
| `derived.originationLvr` | 32 | 16 | **32** |
| `property.propertyType` | 32 | 21 | **32** |
| `property.bedrooms` | 32 | 6 | **32** |
| `property.bathrooms` | 32 | 6 | **32** |
| `property.carSpaces` | 32 | 9 | **32** |
| `property.landSize` | 32 | 8 | **32** |
| `property.buildingSize` | 32 | 9 | **32** |
| `property.yearBuilt` | 32 | 0 | **32** |
| `geography.suburb` | 32 | 21 | **32** |
| `geography.postcode` | 32 | 21 | **32** |
| `geography.state` | 32 | 21 | **32** |
| `geography.latitude` | 32 | 26 | **32** |
| `geography.longitude` | 32 | 26 | **32** |
| `record.variant` / `record.tier` / `record.currentVersion` | 32 | 32 | **32** |
| `scoring.gradeIssued` | 32 | 32 | **32** |

**Exceptions: none.** Every comparison agreed on its first run.

`property.yearBuilt` is present on zero rows — that is a fact about the corpus
(no writer has ever captured it), not a contract defect, and the contract reports
it as absent with a reason rather than as a zero.

### Why the corpus is not in the repository

These are real clients' finances. The fixture lives in the operator's scratchpad
and the harness skips without it — the arrangement `corpusReplayV2.spec.ts`
already uses. What ships is the aggregate above, with no client's figures in it.

```
RF71_PARITY_CORPUS=<rows.json> RF71_PARITY_OUT=<ledger.json> \
  npx vitest run reportFactContractParity
```

## 7. Deliberate differences from a naïve reading

Three places where the contract declines to produce a figure that a looser
implementation would happily emit. None changes production, because nothing in
production reads the contract.

| Fact | A naïve reading would | The contract does | Why |
| --- | --- | --- | --- |
| `derived.originationLvr` | reconstruct the loan as `price − deposit` | requires a **recorded** loan | That identity is measured to break on 21 stored reports, so a reconstruction is most confident exactly where the record is least reliable |
| `finance.stampDuty` | re-run `calculateStampDuty` | reads the stored figure only | Duty depends on a purchase intent and concession status the report does not record; a recomputed figure would be a *new* number, not this report's |
| `derived.currentLvr` | reuse the settlement LVR | absent | Origination LVR and current LVR are **different quantities** that coincide only at settlement — `DERIVED_FIGURES.md` |

## 8. Fallbacks preserved (rule 7)

Retirement is a later, controlled stage. Nothing here is removed.

| Fallback | Primary | Fallback | Why it exists | Safe? | Retire later? |
| --- | --- | --- | --- | --- | --- |
| PDF engine | chosen template → `render-template-pdf` | `render-investment-report-pdf` | a refused, missing or stale template must still produce the reviewed document | Yes | Only once the design system's coverage is no longer 0.14% |
| Resume | browser chunked loop | pg_cron watchdog | 17 sections × ~25s against a ~150s edge ceiling | Yes | **No** — this is the design |
| Property facts | `manual_overrides` (observed) | `financial_calculations` (derived) | the override IS the calculator's input record | Yes — zero disagreement on 443 paired rows | **No** |
| Annual outgoings | `…totalAnnualExcludingLandTax` | `…annualCosts.total` | older shapes | **Inert** — see §9.2 | Replace with a basis label, not a second path |
| Scoring authority | the `policy` stamp | absent stamp ⇒ `legacy_snapshot` | historical rows must render as issued | Yes | **No** |
| Issuer identity | workspace brand snapshot | Aurixa Systems | an unbranded report must still be somebody's | Yes | **No** |
| Property type | `property_specs.property_type` | **none** — `null` | a defaulted house puts the wrong schema on the asset | Yes | **No** |

## 9. Contradictions surfaced, deliberately NOT changed (rule 14)

### 9.1 `historicalFactAuthority` has no production consumer

A complete, tested, measured precedence layer that nothing calls. The contract
adapts it; **no consumer is switched to it in RF-7.1**, and its precedence is not
edited. Adoption is a later stage.

### 9.2 The `annualOutgoings` fallback is inert on the whole live corpus

Measured against 1,207 live rows: `annualCosts.total` exists on **0**,
`totalAnnual` on 208, `totalAnnualExcludingLandTax` on 173. `calculateAnnualCosts`
has never emitted `total`, so the fallback can never fire — and on the 35 rows
with `totalAnnual` but no excluding-land-tax figure, `annualOutgoings` resolves as
absent.

That is the correct outcome, reached by accident: the two are different
quantities (one includes land tax), so adopting the first as a fallback for the
second would silently change a published figure's basis. **Not fixed here** —
rule 11 forbids bundling a defect fix into RF-7.1, and the right remedy is a
labelled `BasedMetric`-style answer rather than a second path.

### 9.3 `types.ts` is stale against the migrations

The standing repo rule already covers it (schema = generated types **union**
migrations; `check-edge-column-names.mjs` enforces it). No regeneration here.

### 9.4 Two `vizFigures` / `vizDirectives` implementations

The `_shared` copy is canonical and the `src` copy is the repo's standard bridge.
Charts are outside RF-7.1's scope entirely.

## 10. Rollback

Reverting the RF-7.1 commit removes:

- `supabase/functions/_shared/reports/contract/` (the contract)
- `src/lib/reports/contract/` (the bridge)
- three spec files
- two documents

and nothing else. A test proves the claim rather than asserting it: the only
non-test files naming `reportFactContract` are the contract and its one-line
bridge, and no owner module names it at all.

## 11. What adoption will require (NOT in RF-7.1)

Deliberately listed so nobody mistakes any of it for work already done:

1. A consumer reads the contract instead of its own `??` chain — one surface at a
   time, each with a before/after render diff.
2. `historicalFactAuthority` gains its first production consumer.
3. The `annualOutgoings` basis label (§9.2).
4. The remaining report families get their own contracts or share this one.

None of these may begin until RF-7.1 is reviewed.
