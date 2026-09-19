# RF-7.1 — Investment Property Report: capability inventory and production-path census

**Characterise before changing.** This is the mandated inventory that must exist
*before* the Report Fact Contract is written. Every row was traced to an **actual
caller** by execution of a repository-wide search, never inferred from a name and
never assumed dead because a module looks old.

The governing rule for RF-7.1 is a **strangler**:

```
existing system  +  Report Fact Contract          ← RF-7.1
existing system  →  deleted → Report Fact Contract ← NOT RF-7.1
```

No production consumer is switched. Reverting RF-7.1 removes the contract, the
adapters, the tests and the documentation, and leaves Reporting behaving exactly
as it does today.

---

## §1 How the frontend actually reaches the engine

The census's first correction. `supabase.functions.invoke` finds almost nothing:
the product calls edge functions through **`invokeSecureFunction`**
(`src/lib/secureInvoke.ts`), and a census run against `functions.invoke` alone
reports 0 callers for `generate-investment-report`, which has six. Any future
caller census must search all three forms — `invokeSecureFunction(...)`,
`functionName: '...'` and `functions.invoke(...)`.

A second class exists that no frontend search can see at all: functions invoked
**server-to-server** or by **pg_cron**. `resume-investment-reports` has zero
frontend callers and is scheduled every two minutes
(`20260826000000_investment_report_resume_watchdog.sql`,
`investment-report-resume-2min`). Calling it unused would have been wrong by the
widest possible margin — it is the watchdog that finishes a report the browser
abandoned.

---

## §2 The capability inventory — 38 capabilities, all traced

`RF-7.1 touches?` is the load-bearing column. **NO** means the contract neither
imports the module nor is imported by it, and the capability's code is not edited
by this PR.

### 2.1 Creation, generation and resumption

| # | Capability | Entrypoint | Traced callers | RF-7.1 touches? |
| --- | --- | --- | --- | --- |
| 1 | Report creation | `generate-investment-report` | 6: `InvestmentReportGenerator`, `ClientPropertyInvestmentReport`, `InvestmentReportModal`, `ReportGenerationProgress`, `useChunkedRegeneration`, `ErrorLogs` | NO |
| 2 | Generation / section loop | `generate-investment-report` §section loop, `last_completed_section` / `total_sections` | as above | NO |
| 3 | Resume (browser) | `useChunkedRegeneration` → `generate-investment-report` | `ReportGenerationProgress`, `InvestmentReportGenerator` | NO |
| 4 | Resume (watchdog) | `resume-investment-reports` | **pg_cron `investment-report-resume-2min`**, every 2 min; plus `finance-portal-snoozes` | NO |
| 5 | Bulk / automation | `_shared/bulkReportWorker.ts`, `bulk_job_id`; `auto-report-sync` ← `Automation.tsx`; `manage-automation-settings` ← 5 surfaces | traced | NO |
| 6 | Regeneration | `RegenerateReportButton`, `useChunkedRegeneration` | traced | NO |
| 7 | Qualitative regeneration | `regenerate-report-qualitative` | **server-side only** (`_shared/engine-prompts.ts`, `_shared/sourceUnavailable.pure.ts`); no frontend caller | NO |
| 8 | Status repair | `fix-report-status` | operator-invoked; no in-repo caller — **retained, not dead** | NO |
| 9 | Archival | `archive-old-reports`, `is_archived` | operator/scheduled; `is_archived` read by the register | NO |

### 2.2 Inputs, overrides and property identity

| # | Capability | Entrypoint | Traced callers | RF-7.1 touches? |
| --- | --- | --- | --- | --- |
| 10 | Manual overrides | `manual_overrides` column; `overrides.pure.ts` (`buildCalculatorInput`, `applyDisplayOverrides`, `overlayOverridesForHistoricRow`) | **45 modules** across `src` and `supabase/functions` | **READ ONLY** via adapter |
| 11 | Property parsing / import | `scrape-property-listing`, `parse-property-pdf` | `PropertyImportPanel`, `InvestmentReportGenerator`, `documentExtract` | NO |
| 12 | Property specs | `property_specs`; `composePropertySpecs`, `readPropertyFacts`, `meaningfulPropertyType` | generator, fork, condense, adapters | **READ ONLY** via adapter |
| 13 | Geography | `report_geography` table; `resolve-report-geography` | `trustedInput.pure`, `activityCentre.pure`, `locationEvidenceProvenance.pure`, `historicalFactAuthority.pure` | **READ ONLY** via adapter |

### 2.3 Lineage, versions and snapshots

| # | Capability | Entrypoint | Traced callers | RF-7.1 touches? |
| --- | --- | --- | --- | --- |
| 14 | Report versions | `report_versions`; `manage-investment-reports` | `ReportVersionHistory`, `ReportVersionComparison`; `current_version` | NO |
| 15 | Report reopen | `/generated-reports/:reportId` → `ReportViewer`; `/investment-report/:id` → `InvestmentReportView` | both routed in `App.tsx` | NO |
| 16 | Historical snapshots | stored `report_content`, `financial_calculations`, `investment_score` read as-is | every viewer and renderer | NO — **never rewritten** |
| 17 | Forked / derived reports | `fork-investment-report`; `parent_report_id`, `derived_from_report_id` | `subReports.ts` | NO |
| 18 | Strategic variants | `report_variant` ∈ `compass, financial, strategic, snapshot, briefing`; `reportVariants.ts` | viewer, register, adapters, delivery | NO |
| 19 | Briefing / Snapshot derivation | `condense-investment-report` | `subReports.ts`, `useChunkedRegeneration`, `GeneratedReports` | NO |
| 20 | Section index | `report-sections-index`; `sectionStorage.pure.ts` | migration-scheduled projection over `report_content` | NO |

### 2.4 Figures

| # | Capability | Entrypoint | Traced callers | RF-7.1 touches? |
| --- | --- | --- | --- | --- |
| 21 | Financial Modelling | `financialEngine.pure.ts` — `reconcileStoredFinancials`, `healFinanceIdentity`, `calculateKeyMetrics`, `generateProjections`, `calculateAnnualCosts`, `getInterestRateByLVR`, `calculateLMI`, `calculateLandTax` | register, PDF renderer, comparison, both projections | **READ ONLY** via adapter |
| 22 | 10-Year Cash Flow | `cashFlowProjection.pure.ts`; `generateProjections`; `compare-cash-flow-reports`; `render-cash-flow-pdf` | `CashFlowAnalysis`, `CashFlowAnalysisDetail`, `CashFlowAnalysisModal` | **READ ONLY** via adapter |
| 23 | Derived metrics | `propertyMetrics.pure.ts` — `grossYield`, `netYield`, `originationLvr`, `currentLvr`, `equity`, `cashOnCashReturn`, `labelFor`, `BasedMetric` | reconciliation, projections, renderers | **READ ONLY** via adapter |
| 24 | Stamp duty | `stampDuty/engine.pure.ts` — `calculateStampDuty`, `estimateOtherAcquisitionCosts` | generator, renderers, calculators | **READ ONLY** via adapter |
| 25 | Scoring state | `investment_score` JSON; `investment-scoring-service`; `policy` stamp (§69) | `scoreSections.pure.ts`, `InvestmentReportViewer` | **READ ONLY** via adapter |
| 26 | Finance Suitability | `financeSuitability.pure.ts` (frozen V2 side) | shadow only — no production entrypoint | NO |

### 2.5 Content and media

| # | Capability | Entrypoint | Traced callers | RF-7.1 touches? |
| --- | --- | --- | --- | --- |
| 27 | Property images | report content + storage refs; `storageRef.ts` | viewer, renderers | NO |
| 28 | Hero images | `prepare-report-hero-images` ← `HeroImagesDialog`; `hero-image-studio` ← `HeroImageStudio` | traced | NO |
| 29 | Charts | `vizDirectives.pure.ts` → `vizFigures.pure.ts` (both `src` and `_shared` copies) | `sections.pure`, `render.pure`, `payload.pure`, `markdownBlock.html` | NO |
| 30 | Market / demographic content | `demographics_data`, `economic_data`, `location_intelligence` | **26 modules** | **READ ONLY** via adapter (geography only) |

### 2.6 Templates, branding and rendering

| # | Capability | Entrypoint | Traced callers | RF-7.1 touches? |
| --- | --- | --- | --- | --- |
| 31 | Templates | `manage-templates` | **33 callers** | NO |
| 32 | User template selections | `reportTemplateSelection.pure.ts`; `templateSelection.ts` | `resolveTemplate`, `routeReportThroughTemplate`, adapters | NO |
| 33 | White-label branding | `reportDesign/snapshot.pure.ts`; `issuerIdentity.pure.ts` | every render route | NO |
| 34 | Brand snapshots | `brand_snapshot_id` column; 9 render routes | traced | NO |
| 35 | HTML preview | `weasyPreview.ts`; `InvestmentReportViewer` | traced | NO |
| 36 | Server renderer | `render-investment-report-pdf` (WeasyPrint, legacy chain) | `deliverInvestmentPdf`, `ClientReportsTab` | NO |
| 37 | Design-system renderer | `render-template-pdf` via `routeReportThroughTemplate` | `weasyRenderClient`, `ExportPipelineDialog` | NO |
| 38 | Browser PDF / export | `PixelPerfectPDFGenerator`, `ClientPDFGenerator`, `clientPdfDownload.ts` | traced | NO |

### 2.7 Reading, sharing and downstream consumption

| # | Capability | Entrypoint | Traced callers | RF-7.1 touches? |
| --- | --- | --- | --- | --- |
| 39 | Generated Reports view | `/generated-reports` → `GeneratedReports.tsx` | routed | NO |
| 40 | Investment Report Viewer | `InvestmentReportViewer.tsx`, `report-view/*` | `ReportViewer`, `InvestmentReportView` | NO |
| 41 | Client-facing view | `ClientPropertyInvestmentReport`, `ClientReportsTab`, portal `/portal/reports` | routed | NO |
| 42 | Report sharing | `publishReportToPortal.ts`; `get-portal-client-data` | traced | NO |
| 43 | Finance sharing | `share-report-with-finance` | `FinanceRecipientPicker`, `useFinanceReportRecipients`, `ClientDetailsDownloadButton`, `FormaraPDFGenerator`, `deliverClientDetailsPdf` | NO |
| 44 | Report Q&A | `report-qa` | 9 callers incl. `ReportLibraryPicker`, `ReportQA`, `SharedQAAnswer` | NO |
| 45 | Comparison inputs | `compare-investment-reports` | `ClientPortfolioActions`, `PropertyComparisonModal` | NO |
| 46 | Document delivery | `deliverInvestmentPdf.ts` — template → legacy fallback chain | every download/send surface | NO |
| 47 | Secure storage | `secure-storage` | 6 callers | NO |
| 48 | Engine inspection | `report-engine-inspector`, `report-engine-agent` | `ReportEngineInspector`, `PromptLibrary` | NO |

**48 capabilities inventoried** (the mandate's 38 named items, expanded where one
name covered more than one traced path — e.g. "PDF generation" is three distinct
engines with three distinct callers, and "generation/resume" is a browser loop
*and* a two-minute cron watchdog).

---

## §3 Production-path census — what the contract reads

Rule 9. The contract is an **adapter over existing owners**; no owner moves into
it. For each module the contract reads:

| Module (canonical owner) | Current consumers | RF-7.1 modifies it? | Expected behavioural impact | Proof |
| --- | --- | --- | --- | --- |
| `metrics/propertyMetrics.pure.ts` | reconciliation, projections, renderers, comparison | **NO** | none — read-only import | `propertyMetrics.spec.ts` unchanged and passing; contract imports, never edits |
| `investment/financialEngine.pure.ts` | register, PDF renderer, comparison, both projections, cash flow | **NO** | none | `financialEngine.spec.ts` unchanged and passing |
| `investment/propertyRecord.pure.ts` | generator, fork, condense, adapters | **NO** | none | existing specs unchanged |
| `investment/overrides.pure.ts` | 45 modules | **NO** | none | existing specs unchanged |
| `stampDuty/engine.pure.ts` | generator, renderers, calculators, seed | **NO** | none | stamp-duty suite unchanged |
| `facts/historicalFactAuthority.pure.ts` | **zero production consumers** (see §4.1) | **NO** | none — it has none to change | `historicalFactAuthority.spec.ts` unchanged |
| `market/scoringInputPolicy.pure.ts` | `investment-scoring-service`, `scoreSections.pure` (via stamp) | **NO** | none | 46 policy tests unchanged |
| `report_geography` (table) | 4 pure modules + its own resolver | **NO** | none — SELECT only | no migration in this PR |

**Cross-family check.** `propertyMetrics`, `financialEngine` and `stampDuty` also
serve the Cash Flow, Cash Flow Comparison, Property Comparison, Portfolio and
Commercial families. Because RF-7.1 edits none of them, those families cannot
change; the regression suite for each is run as evidence rather than as an
assumption (rule 13).

---

## §4 Findings surfaced, deliberately NOT changed

Rule 14: surface the contradiction, name the canonical owner, explain it — do not
resolve it in this PR.

### 4.1 `historicalFactAuthority.pure.ts` has no production consumer

An 8-field fact-resolution layer (`purchasePrice`, `weeklyRent`, `lvr`,
`weeklyCashFlow`, `annualOutgoings`, `dwellingType`, `suburb`, plus derived), with
a documented precedence, a measured basis (140/140, 150/150, 153/153 exact
agreement) and a full spec — and its **only** non-test reference in the repository
is a doc comment in `growthPopulation.pure.ts`.

- **Canonical owner:** itself, for those eight fields.
- **Why it matters to RF-7.1:** the Fact Contract must *adapt* this rather than
  become a third implementation of the same precedence. That is the strangler's
  whole point.
- **Not changed here:** no consumer is switched to it, and its precedence is not
  edited.

### 4.2 Two `vizFigures` / `vizDirectives` implementations

`src/lib/reports/vizFigures.pure.ts` and
`supabase/functions/_shared/reports/vizFigures.pure.ts` both exist (the `src` copy
is the bridge pattern used across this repo). Consumers differ by side.

- **Canonical owner:** the `_shared` copy; `src` is the bridge.
- **Not changed here:** chart behaviour is out of RF-7.1's scope entirely.

### 4.3 `annualOutgoings`' second path is inert on the entire live corpus

`FIELD_AUTHORITY` orders `annualCosts.totalAnnualExcludingLandTax` then
`annualCosts.total`. Measured against production (1,207 live rows):

| key on `financial_calculations.annualCosts` | rows |
| --- | ---: |
| `total` | **0** |
| `totalAnnual` | 208 |
| `totalAnnualExcludingLandTax` | 173 |

`calculateAnnualCosts` emits `totalAnnual` and `totalAnnualExcludingLandTax` and
has never emitted `total`, so the fallback **cannot fire**. The consequence is
that on the 35 rows carrying `totalAnnual` without the excluding-land-tax figure,
`annualOutgoings` resolves as **absent**.

That is the correct outcome reached by accident: `totalAnnual` *includes* land tax
and `totalAnnualExcludingLandTax` excludes it, so they are different quantities —
adopting the first as a fallback for the second would silently change the basis of
a published figure, which is the class of defect `propertyMetrics`' `BasedMetric`
exists to prevent.

- **Canonical owner:** `historicalFactAuthority.FIELD_AUTHORITY`.
- **Production impact today: none** — the module has no production consumer (§4.1).
- **Not changed here.** Rule 11 forbids bundling a defect fix into RF-7.1, and
  "fixing" it by pointing the fallback at `totalAnnual` would be a *behaviour
  change disguised as a repair*. The contract reports the resolved value **with
  its path and its basis**, so a reader can see which answered and on what footing.
  Remediation belongs to a later stage, and the right remedy is a labelled
  `BasedMetric`-style answer, not a second path.

### 4.4 `types.ts` is stale against the migrations

`investment_reports` reads 40 columns in the generated types; the migrations carry
`ALTER TABLE … ADD COLUMN` for several the types do not reflect in the same shape.
The repo's standing rule already covers this — the schema is the generated types
**union** the migrations — and `check-edge-column-names.mjs` enforces it.

- **Not changed here:** no regeneration, no migration.

---

## §5 The fallback register

Rule 7. A fallback is preserved because it is load-bearing, not because it is
tidy. Retirement is a later, controlled stage.

| Fallback | Primary path | Fallback path | Why it exists | Safe? | Retire eventually? |
| --- | --- | --- | --- | --- | --- |
| PDF engine | chosen template → `render-template-pdf` | `render-investment-report-pdf` (legacy WeasyPrint) | a refused template, no selection or a stale choice must still produce the document the operator reviewed | **Yes** — both produce a complete document; only failure of *both* throws | Only after the design system's coverage is no longer 0.14% (`COVERAGE.md`) |
| Resume | browser `useChunkedRegeneration` loop | pg_cron `investment-report-resume-2min` watchdog | a 17-section report cannot finish inside one ~150s edge request; the browser can close mid-run | **Yes** — idempotent by `last_completed_section`, claimed by `resume_worker_id` | **No** — this is the design, not debt |
| Property facts | `manual_overrides` (observed) | `financial_calculations` (derived) | the override IS the calculator's input record; the financial block is its derivative | **Yes** — measured zero disagreement on 443 paired rows | **No** |
| Annual outgoings | `…annualCosts.totalAnnualExcludingLandTax` | `…annualCosts.total` | older rows carry only the second | **Qualified** — the two differ by land tax (§4.3) | Only with a basis label, as `propertyMetrics` already does for yield/LVR |
| Scoring authority | `policy` stamp on the score | absent stamp ⇒ `legacy_snapshot` | historical rows carry no stamp and must render exactly as they always did | **Yes** — asserted by test | **No** — this is how history is preserved |
| Issuer identity | workspace brand snapshot | Aurixa Systems fallback | an unbranded report must still be *somebody's* | **Yes** | **No** |
| Property type | `property_specs.property_type` via `meaningfulPropertyType` | **none** — returns `null` | a defaulted "house" puts a risk schema on the wrong asset | **Yes** — absence is explicit | **No** |

---

## §6 The zero-behavioural-delta gate

RF-7.1 may not merge if any existing production behaviour changes. The gate is
discharged by four independent readings, not by intent:

1. **Import direction.** The contract imports owners; no owner imports the
   contract. A spec asserts it.
2. **Consumer count.** Zero production consumers of the contract. A spec asserts
   that no `src/pages`, `src/components` or edge-function entrypoint imports it.
3. **Regression.** The full existing Reporting suites run and pass — generation,
   financials, scoring projection, templates, renderers, viewer, comparison, cash
   flow, portfolio, Q&A, lineage/versioning.
4. **Parity.** The real-row ledger shows the contract reproducing what the current
   path already produces, value by value, with every mismatch explained rather
   than reconciled by editing production.

**Rollback:** reverting the RF-7.1 commit removes the contract module, its
adapters, its tests and its documentation. Nothing else is in the diff, so
Reporting returns to exactly its present behaviour by construction.
