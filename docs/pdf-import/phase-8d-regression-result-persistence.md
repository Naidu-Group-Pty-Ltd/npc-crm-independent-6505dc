# PDF Import Phase 8D — Golden Regression Result Persistence

## Objective

Phase 8D persists the result of a golden corpus regression run into the import metadata record.

Phase 8A defines the corpus.
Phase 8B evaluates a run.
Phase 8C applies quality gates.
Phase 8D stores the outcome.

## Why This Exists

Until Phase 8D, golden corpus run results exist only in local operator notes, SQL output, or
TypeScript evaluation output.

That is not enough for regression tracking.

Phase 8D stores a compact golden regression summary on the `template_imports` row so later
phases can query, display, compare, and lock regression results.

## Persistence Target

Use:

```
template_imports.meta.golden_regression_summary
```

Do not create a dedicated database table in Phase 8D.

Reason: a metadata summary is sufficient for current golden regression tracking and avoids
schema churn. A future phase can introduce a dedicated table if the number of golden runs grows.

It is written via the existing secure `template-import-pdf` `append_meta` operation
(ownership-checked meta merge) and read back via `get_status` (which returns the row incl.
`meta`). No new edge operation and no Supabase deployment are required.

## Summary Storage Shape

`template_imports.meta.golden_regression_summary` fields:

- `version`
- `runId`
- `runBatchId`
- `corpusId`
- `category`
- `importId`
- `templateId`
- `sourceFilename`
- `engineVersion`
- `importStatus`
- `runStatus`
- `runDecision`
- `importPageCount`
- `templatePageCount`
- `visualQaScore`
- `visualQaManualReviewRequired`
- `repairStatus`
- `repairFinalScore`
- `repairRequiresFallback`
- `repairRequiresManualReview`
- `aiReconciliationStatus`
- `aiReconciliationRecommendation`
- `exportParityStatus`
- `exportParityMode`
- `exportVsSourceScore`
- `editorVsSourceScore`
- `exportVsEditorScore`
- `qualityGateStatus`
- `gateSummary`
- `warnings`
- `failures`
- `operatorDecision`
- `notes`
- `generatedAt`
- `persistedAt`

## Result Statuses

`qualityGateStatus` aligns with the Phase 8C quality gate status:

- `pass`
- `warning`
- `fail`
- `blocked`
- `not_evaluated`

## Operator Decisions

`operatorDecision` is separate from the gate status:

- `accepted`
- `accepted_with_warnings`
- `rejected`
- `needs_rerun`
- `not_reviewed`

Example: a run can have `qualityGateStatus: warning` but `operatorDecision: accepted_with_warnings`.

The builder derives a default decision from the gate status (`pass → accepted`,
`warning → accepted_with_warnings`, `fail → rejected`, `blocked → needs_rerun`,
`not_evaluated → not_reviewed`), which the operator can override.

## What Phase 8D Does

- Defines golden regression summary types.
- Builds summaries from Phase 8B run evaluations and Phase 8C quality gate reports.
- Persists summaries to `template_imports.meta.golden_regression_summary`.
- Adds tests.
- Adds SQL validation.

## What Phase 8D Does Not Do

- Does not create a database table.
- Does not automate browser uploads.
- Does not upload PDFs.
- Does not implement dashboard display.
- Does not enforce production deployment gates.
- Does not change the sidecar.
- Does not mutate `report_templates`.

## Persistence Flow

1. Operator runs a golden corpus browser flow.
2. Operator records importId/templateId.
3. Phase 8B evaluates the run (`evaluateGoldenCorpusRun`).
4. Phase 8C evaluates quality gates (`evaluatePdfImportQualityGates`).
5. Phase 8D builds a golden regression summary (`buildGoldenRegressionSummary`).
6. Summary is saved into `template_imports.meta.golden_regression_summary` via
   `saveGoldenRegressionSummary` (→ `append_meta`). `persistedAt` is stamped at save time.
7. SQL validates that the summary exists
   (`scripts/regression/pdf-import-phase-8d-regression-persistence-check.sql`).

## Modules

`src/lib/reportTemplate/ingestion/goldenCorpus/`:

- `goldenRegressionTypes.ts` — `GoldenRegressionSummary`, operator-decision type, save/load
  result unions, version tag `pdf-import-golden-regression-summary-v1`.
- `goldenRegressionSummary.ts` — `buildGoldenRegressionSummary`,
  `withGoldenRegressionPersistedAt`, `summarizeGoldenRegressionForMeta`.
- `goldenRegressionPersistence.ts` — `saveGoldenRegressionSummary` (append_meta),
  `loadGoldenRegressionSummary` (get_status), `GOLDEN_REGRESSION_META_KEY`.

Consumed via the local `goldenCorpus` barrel; not surfaced through the top-level ingestion
barrel (matching the Phase 7/8 convention).

## Acceptance Criteria

- `goldenRegressionTypes.ts` exists.
- `goldenRegressionSummary.ts` exists.
- `goldenRegressionPersistence.ts` exists.
- tests pass.
- SQL exists.
- build passes.
- no private files committed.
- no Supabase deployment unless `append_meta` changed (it was not — it already exists and is secure).
