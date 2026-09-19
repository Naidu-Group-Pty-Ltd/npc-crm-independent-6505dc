# PDF Import Phase 8B — Golden Corpus Runner

## Objective

Phase 8B defines the repeatable runner process for validating manually executed golden
corpus imports against the Phase 8A Golden Corpus Registry.

Phase 8A answered: **What should we test?**

Phase 8B answers: **How do we record and validate a golden corpus run?**

## Why This Exists

Phase 7 proved the PDF import quality stack works.

Phase 8A defined the canonical golden corpus.

Phase 8B creates the operational bridge between manual browser imports and future automated
regression gates. It lets an operator manually import the golden PDFs and then use the
resulting import IDs to validate whether each run produced the required Phase 7 metadata.

## What Phase 8B Does

- Defines a golden run structure.
- Defines required run metadata.
- Defines a manual/semi-automated run workflow.
- Adds TypeScript evaluation helpers.
- Adds SQL to validate import IDs against corpus IDs.
- Produces pass/warning/fail style run evaluation.
- Does not persist golden run results yet.

## What Phase 8B Does Not Do

- Does not upload PDFs automatically.
- Does not run browser automation.
- Does not create a database table.
- Does not persist `golden_regression_summary`.
- Does not enforce hard quality gates.
- Does not modify the sidecar.
- Does not replace manual review.

## Golden Run Workflow

1. Select a corpus item from the registry.
2. Locate the matching safe/local PDF outside git.
3. Import the PDF through Template Builder using Hybrid mode unless the registry says otherwise.
4. Wait for import completion.
5. Open Review Quality.
6. Run Visual QA.
7. Run Repair.
8. Run AI reconciliation if policy recommends `optional` / `recommended` / `manual_review`.
9. Rerun Visual QA if the draft changed.
10. Apply the repaired/reconciled template.
11. Confirm the editor opens.
12. Record or run export parity.
13. Copy the import ID and template ID.
14. Add them to a golden run template or SQL mapping.
15. Run the Phase 8B SQL.
16. Use the TypeScript evaluator/tests for structured validation.

## Runner Modes

### manual_operator

The operator manually completes the browser workflow and records the importId/templateId.

### semi_automated_validation

The operator provides import IDs, and SQL/helpers validate whether the required metadata exists.

### future_automated_browser

Reserved for a future phase. Not implemented in Phase 8B.

## Golden Run Statuses

- `not_started`
- `import_recorded`
- `validation_ready`
- `validated`
- `blocked`
- `failed`

## Golden Run Decisions

- `pass` — required artifacts and expected metadata exist.
- `warning` — the core run is usable, but manual review / fallback / export manual-required exists.
- `fail` — a required artifact, template, metadata, or page count is missing.
- `not_evaluated` — the run has not been evaluated yet (e.g. no import ID, or import not completed).

## Required Metadata

Each run should capture:

- `runId`
- `corpusId`
- `category`
- `sourceFilename`
- `importId`
- `templateId`
- `engineVersion`
- `importStatus`
- `importPageCount`
- `templatePageCount`
- `visualQaArtifactPath`
- `visualQaScore`
- `visualQaManualReviewRequired`
- `repairArtifactPath`
- `repairStatus`
- `repairFinalScore`
- `repairRequiresFallback`
- `repairRequiresManualReview`
- `aiReconciliationStatus`
- `aiReconciliationRecommendation`
- `exportParityArtifactPath`
- `exportParityStatus`
- `exportParityMode`
- `exportVsSourceScore`
- `editorVsSourceScore`
- `exportVsEditorScore`
- `warnings`
- `failures`
- `decision`
- `evaluatedAt`

## Acceptable Warnings

- `manual_review_required`
- `repair_skipped_no_eligible_pages`
- `ai_reconciliation_not_needed`
- `ai_reconciliation_optional_not_run`
- `export_parity_manual_required`
- `export_parity_not_recorded_for_initial_run`
- `fallback_used_with_source_raster_preserved`
- `ocr_low_confidence`
- `design_complexity_warning`

(The evaluator emits normalized codes such as `manual_review_required`, `fallback_used`,
`export_parity_not_recorded`, `repair_skipped_no_eligible_pages`,
`ai_reconciliation_recommended_not_run`, `ai_reconciliation_manual_review_not_run`, and the
`*_below_registry_minimum` warnings.)

## Failures

- `import_missing`
- `import_failed`
- `template_missing`
- `template_page_count_mismatch`
- `visual_quality_missing`
- `repair_audit_missing`
- `repair_failed`
- `repair_audit_storage_missing`
- `export_parity_failed`
- `source_rasters_missing`
- `backend_unknown_operation`
- `finalization_failed`

(The evaluator emits `template_missing`, `template_page_count_mismatch`,
`template_page_count_unavailable`, `visual_quality_missing`, `repair_audit_missing`,
`repair_failed`, `manual_review_not_allowed`, `repair_manual_review_not_allowed`,
`fallback_not_allowed`, `export_parity_failed`, and `import_failed`.)

## Evaluator

`src/lib/reportTemplate/ingestion/goldenCorpus/goldenCorpusRunEvaluator.ts`:

- `evaluateGoldenCorpusRun({ run, snapshot, registry?, now? })` — evaluates a single run
  reference against its registry item and a Phase 7 metadata snapshot. Throws on an unknown
  `corpusId`. Below-threshold scores are **warnings**, never hard failures (hard gates are
  Phase 8C).
- `evaluateGoldenCorpusRunBatch({ batch, snapshotsByImportId, registry?, now? })` — evaluates
  a whole batch, substituting an empty snapshot for any run whose import snapshot is missing,
  and returns per-decision summary counts.
- `buildEmptyGoldenCorpusSnapshot(importId?)` — an all-null snapshot carrying only the importId.

## Phase 8B Acceptance Criteria

- runner documentation exists
- run template exists
- run TypeScript types exist
- run evaluator exists
- evaluator tests pass
- SQL validation exists
- `npm run build` passes
- no private PDFs or audit-output files committed

## How Phase 8B Feeds Later Phases

- **Phase 8C** will convert the registry thresholds and the evaluator's warning/failure
  taxonomy into hard quality gates.
- **Phase 8D** will persist a `golden_regression_summary` (the evaluation output) into
  `template_imports.meta`.
- **Phase 8E** will surface golden run status in diagnostics.
- **Phase 8G** will lock Phase 8.
