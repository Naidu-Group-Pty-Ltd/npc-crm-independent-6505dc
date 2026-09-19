# Cascade Custom Weighted Scoring — Phase 0 Audit

**Status:** complete — implementation is intentionally out of scope for this phase.

## Scope and method

This audit covers property-investment scoring, grades, rankings, recommendations,
analysis settings/templates, generation/regeneration, report persistence, client
surfaces, PDF generation, and automatic/bulk generation. It deliberately excludes
unrelated operational-quality scores (for example PDF-import quality), call-quality
scores, marketing confidence scores, and AML risk scoring. Those are distinct
domains and must not acquire investment-weight controls.

Repository evidence was collected with targeted `rg` searches for score/grade/
weight/ranking terms, report families, direct `investment_score` consumers, and
generation paths, followed by source inspection of the engine, services, UI,
migrations, template structures, and scheduled workers.

## Executive findings

1. **There is no platform-wide scoring contract.** Two server-side investment
   scorers and the portfolio wizard each own independent calculation and weighting
   rules. Their input shapes, total-score field names, missing-data handling, and
   grade semantics differ.
2. **The requested 30/25/20/15/10 default is not the current executable default.**
   The shared engine and the scoring-service use growth/location/yield/demand/risk
   weighting of **40/25/15/15/5**. A report-generation markdown table renders
   **30/25/20/15/10**, creating a display-versus-calculation divergence that must
   be resolved by a versioned migration plan rather than silently overwritten.
3. **Comparison custom weights are prompt-only.** `compare-investment-reports`
   accepts `customWeights` and gives them to the AI prompt, but it does not validate
   or persist them, recompute structured scores, or snapshot a comparison result.
4. **Portfolio scores are a separate three-factor formula** (health 40%, cash flow
   40%, growth potential 20%), computed in browser state. Portfolio templates store
   qualitative AI configuration only; they do not model score weights, schemas,
   scopes, or snapshots.
5. **Historical score preservation is partial.** `investment_score` is copied to
   `report_versions`, which protects prior content when regeneration changes report
   content. However neither `investment_reports` nor `report_versions` holds the
   schema/version/source/template/weight snapshot necessary to reproduce a score.
6. **Tenant-safe scoring templates do not exist.** The comparison template table is
   globally readable and has only creator ownership; it lacks organisation, client,
   report family, schema version, compatibility, archive, and permissions fields.

## Inventory and classification

| Classification | Modules | Current model / finding | Required Phase 1+ treatment |
| --- | --- | --- | --- |
| A. Five-factor investment model | `investment-scoring-service`, composite branch of `_shared/investmentScoreEngine`, individual investment generation/regeneration, investment-report PDF, generated-report cards, client investment-report PDF, comparison analysis | Yield, growth, location, demand, risk. Executable defaults are 40/25/15/15/5; a generated markdown table claims 30/25/20/15/10. The service supplies an `N/A` insufficient-data grade; the shared engine returns `null` with fewer than three available dimensions. | Introduce one versioned `investment` schema, keep both legacy profiles addressable for historical reports, and select the approved canonical profile only for new schema-versioned runs. |
| B. Different compatible model | `scoreFinancial` in `_shared/investmentScoreEngine`, financial report fork flow | Yield 30%, cash flow 25%, serviceability 20%, risk 15%, growth 10%. Existing grade bands are shared with composite but inputs are distinct. | Create a `financial` schema; do not rename inputs to the investment five-factor vocabulary. |
| B. Different compatible model | `scorePropertyFundamentals` / due-diligence fork flow | Location 30%, demand 25%, tenant fit 20%, planning risk 15%, liveability 10%; several factors are currently derived proxies. | Create a `due_diligence` schema only if this flow exposes a grade to users; preserve proxy disclosure and missing-data behavior. |
| B. Different compatible model | Portfolio review wizard, `ClientScoreCard`, portfolio analysis/PDF | Health 40%, cash flow 40%, growth potential 20%; property-level scoring is also calculated separately. AI portfolio analysis emits health and diversification scores. | Create a dedicated `portfolio` schema after documenting property aggregation and preventing double weighting; keep property snapshots immutable. |
| C. Displays or consumes a grade without exposing inputs | `GeneratedReports`, `InvestmentReportView`, `CashFlowAnalysis`, client property report/PDF, `compare-cash-flow-reports`, `condense-investment-report`, dashboard/report-engine consumers | Read `investment_score` fields. Cash Flow Analysis re-derives a grade from `overall_score` with thresholds that disagree with the shared engine; cash-flow comparison uses `letterGrade`, while producers use `grade`. | Make all consumers render the stored snapshot grade. Only add settings to flows that recalculate a grade. |
| C. Comparison ranking | `compare-investment-reports`, `ClientPortfolioActions` | AI produces ranking/recommendations from stored scores or a fallback hard-coded 40/25/15/15/5 map; custom weights are prompt instructions only. | Resolve a report-family schema, validate/apply it server-side, calculate ranking from the same result used in the UI/PDF, and persist a comparison snapshot. |
| D. Qualitative only; do not add numerical weighting | Strategic/briefing/snapshot report templates and compass section registries, market intelligence/weekly briefs, cash-flow calculations without a stored grade | These produce narrative, market commentary, or quantitative projections rather than an explicit weighted grade engine. Some tiers inherit property report data. | Inherit a source report snapshot when presenting a score; do not fabricate a new score or add sliders unless the report actually recalculates it. |
| Out of scope / separate domain | AML risk, PDF import visual/quality/fidelity scores, marketing confidence, call quality | These are operational/compliance models, not investment suitability scoring. | Preserve separate ownership and controls. |

## Calculation and grade sources

### Shared score engine

- `supabase/functions/_shared/investmentScoreEngine.ts` is described as the
  single source for composite, financial, due-diligence, fork, and backfill flows.
  It has immutable-in-practice module constants but exports no schema, validation,
  configuration, template, or snapshot API.
- Its `assemble` function proportionally rebalances weights for available
  dimensions and suppresses a result when fewer than three are available. This is
  the current confidence rule to retain behind the future schema contract.
- Grade bands are A+ (>=85), A (>=75), B+ (>=65), B (>=58), C+ (>=50), C
  (>=42), D (>=32), F (otherwise). They are duplicated/inconsistent with the cash
  flow UI's B/C/D cutoffs.

### Investment scoring service

- `supabase/functions/investment-scoring-service/index.ts` separately calculates
  the same five dimensions using decimal weights 0.15/0.40/0.25/0.15/0.05.
- It has its own coverage model, returns `grade: 'N/A'` for insufficient data, and
  authenticates callers. Its JSON request has no scoring schema/version, applied
  weights, template identity, resolver source, tenant/client context, or audit
  event fields.
- `generate-investment-report` and `regenerate-report-qualitative` call this
  service. Both inject score and hard-coded fallback weights into report prompts.

### Current discrepancies requiring an explicit compatibility decision

| Surface | Current weights / field shape | Consequence |
| --- | --- | --- |
| Shared composite engine | growth 40, location 25, yield 15, demand 15, risk 5 | Used by fork/backfill paths. |
| Investment scoring service | growth 40, location 25, yield 15, demand 15, risk 5 | Used by direct report generation/regeneration. |
| Generation markdown table | growth 30, location 25, yield 20, demand 15, risk 10 | Report wording can misstate the applied calculation. |
| Comparison fallback | yield 15, growth 40, location 25, demand 15, risk 5 | AI may rank on a different map from the requested UI model. |
| Cash Flow Analysis grade helper | `overall_score`, with B >=55, C >=45, D >=35 | Regrades instead of rendering stored `grade`; field shape differs from producer `totalScore`. |
| Cash-flow comparison | `totalScore` plus `letterGrade` | Letter grade is usually absent from the producer payload. |

## Generation, regeneration, and output paths

| Path | Score behavior today | Gap to close |
| --- | --- | --- |
| Manual/listing investment report | `InvestmentReportModal` invokes `generate-investment-report`; edge function calls scoring service and stores JSON in `investment_reports.investment_score`. | Add applied configuration only, server validation, resolver metadata, and immutable snapshot. |
| Regeneration | `regenerate-report-qualitative` calls scoring service and updates score. `report_versions` archives prior `investment_score` when content changes. | Offer original/current selection; snapshot both prior and new configuration; do not read draft browser state. |
| Fork/condense | `fork-investment-report` uses the shared variant engine; condense copies parent `investment_score`. | Fork must resolve a compatible schema; condensed/snapshot variants should inherit, not recompute, unless explicitly requested. |
| Backfill | `backfill-investment-scores` invokes shared engine and hard-codes weights. | Mark legacy/backfill schema source; never overwrite historical scoring configuration without a migration policy. |
| Investment PDF | `render-investment-report-pdf` receives/render score content; client report PDF gets `investment_score` from the selected report. | Render stored snapshot score/grade and concise methodology disclosure, never current defaults. |
| Generated cards/view | `GeneratedReports` uses stored `grade`/`totalScore`; `InvestmentReportView` selects the JSON score. | Display snapshot/default/custom status with legacy-safe fallback. |
| Cash Flow Analysis/PDF | Reads existing `investment_score` and locally derives a grade; cash-flow comparison feeds it into AI. The commercial 10-year PDF is quantitative and contains no investment grade. | Replace regrading with snapshot rendering where applicable; do not alter cash-flow formula/PDF paths that have no grade. |
| Portfolio analysis/PDF | Browser computes scorecard, edge function generates qualitative analysis, PDF renders health/diversification values. | Add portfolio-only scoring configuration and snapshot to the actual portfolio report persistence/output flow. |
| Automatic/background/bulk | `auto-report-sync`, `auto-report-webhook`, `generate-bulk-reports`, and `_shared/bulkReportWorker` queue/drive report creation. | Resolve default hierarchy in trusted server code and persist its result; no interactive Apply operation. |

## Persistence, template, tenancy, and audit assessment

- `investment_reports.investment_score` and `report_versions.investment_score` are
  JSONB. They store score output but have no dedicated scoring configuration,
  engine/schema version, threshold version, source, template ID, applied-by actor,
  client/organisation resolver source, or generated timestamp.
- `report_versions` currently copies the old JSON output, providing a useful
  migration anchor but not a reproducible input snapshot.
- `comparison_analysis_templates` stores an opaque `settings` JSONB with a creator
  ID only. Its SELECT policy permits all authenticated users to read all templates;
  it is not acceptable for organisation/client template scopes.
- `portfolio_analysis_templates` is used by `PortfolioAnalysisConfig` for AI
  settings. It does not contain weights or score schema compatibility.
- `report_templates` is a presentation/template system, not currently a safe
  replacement for scoring templates. It can remain separate while a scoring
  template references report family/schema compatibility.
- No scoring-specific audit events or permissions were found. Existing secure
  function authentication is present but insufficient to establish per-scope
  scoring-template permissions.

## Recommended implementation boundary for the next phase

1. Add a shared TypeScript scoring domain package usable by browser and edge
   functions: immutable schema registry, canonical default resolver, cloning,
   integer-weight validation, compatibility checks, grade thresholds, score
   aggregation, confidence/missing-data policy, and snapshot builder.
2. Model at least `investment`, `financial`, and `portfolio` schemas. Preserve
   legacy engine profiles as explicit versions; do **not** relabel old reports as
   30/25/20/15/10.
3. Consolidate the duplicate property engine/service calculation before UI rollout.
   The client must send an applied configuration; the server must validate and use
   it. The report prompt, stored JSON, card/view, comparison ranking, and PDF must
   consume one calculated result.
4. Add tenant-scoped scoring-template and immutable report-scoring-snapshot
   persistence through security-definer RPCs or the existing secure-function
   boundary. Include explicit grants, indexes, archive status, owner/client/org
   scope, and audit events. Do not use direct PostgREST for privileged operations.
5. Only after that foundation, introduce one reusable Analysis Settings component
   to investment/comparison/portfolio flows. It must maintain separate draft and
   applied configurations; template saving uses applied values only.
6. Roll out regeneration/PDF/cards/automatic jobs after the snapshot contract is
   in place. Snapshot/briefing tiers should inherit a source configuration unless
   they truly recalculate the score.

## Required test matrix for subsequent phases

- Schema/default unit tests, including immutable 30/25/20/15/10 canonical
  investment defaults for the new approved schema, legacy compatibility profiles,
  100% validation, applied-versus-draft isolation, and grade/missing-data behavior.
- Component tests for reusable settings, accessible sliders/status, Use Default,
  Apply Weights, template compatibility, dialog focus layering, and disabled save
  when draft differs from applied.
- Edge/integration tests that prove server-side score changes with weights,
  snapshot persistence, stored-grade rendering, original/current regeneration,
  tenant isolation, PDF disclosure, same-family comparison ranking, portfolio
  non-mutation of property snapshots, and background default resolution.
- Regression tests for current report generation, existing historical scores,
  client PDF/download/archive, cash-flow calculation integrity, report grouping,
  and automatic/bulk queues.

## Phase gate

No implementation changes were made in Phase 0. The unresolved executable-versus-
display default conflict and the absence of a durable scoring snapshot are blocking
findings for any UI-only rollout. The next task must select and implement the
shared scoring domain/persistence foundation before changing report controls.
