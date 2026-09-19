# PDF Import Phase 8C — Quality Threshold Gates

## Objective

Phase 8C converts a Golden Corpus run evaluation into a formal quality gate report.

Phase 8A defines what to test.
Phase 8B defines how to evaluate a run.
Phase 8C defines whether the run passes quality thresholds.

## Why This Exists

A PDF import can technically complete while still being unsuitable for regression confidence.

Examples:

- Template created but page count mismatches source.
- Visual QA artifact exists but score is below threshold.
- Repair audit exists but repair failed.
- Export parity exists but exported PDF score is too low.
- Manual review is required for a corpus item that should be clean.
- Source rasters or storage artifacts are missing.

Quality gates formalize what is acceptable and what is not.

## What Phase 8C Does

- Defines gate statuses.
- Defines gate severities.
- Evaluates import/template/artifact/Visual QA/Repair/AI/export parity gates.
- Converts Phase 8B runner output into a quality gate report.
- Adds SQL validation for operator-supplied golden corpus runs.
- Adds tests for pass/warning/fail/blocked outcomes.

## What Phase 8C Does Not Do

- Does not persist quality gate results.
- Does not create `golden_regression_summary`.
- Does not add dashboard display.
- Does not create a database table.
- Does not run browser automation.
- Does not upload PDFs.
- Does not modify the sidecar.

## Gate Statuses

### pass
The gate condition is satisfied.

### warning
The run is usable, but has a non-blocking issue that should be reviewed.

### fail
The run violates a required quality expectation.

### blocked
The gate cannot run because prerequisite data is missing.

### not_evaluated
The gate was intentionally not evaluated (e.g. the corpus item does not require it, or there is no import ID).

## Gate Severities

### info
Informational only (used for `pass` and `not_evaluated`).

### warning
Non-blocking but should be reviewed.

### error
Blocking for quality confidence (used for `fail`).

### blocking
Hard prerequisite failure that prevents reliable evaluation (used for `blocked`).

## Gate Categories

- `import`
- `template`
- `artifact`
- `visual_quality`
- `repair`
- `ai_reconciliation`
- `export_parity`
- `diagnostics`
- `metadata`

## Core Gate Rules

1. Import must complete.
2. Template must exist.
3. Template page count must match import page count when the registry expects it.
4. Visual QA artifact must exist when the registry expects Visual QA.
5. Visual QA score must meet the registry threshold.
6. Repair audit must exist when the registry expects repair to run or skip safely.
7. Repair status must not be failed.
8. Repair final score must meet the registry threshold unless repair skipped safely.
9. Manual review is a warning only when allowed by the registry.
10. Manual review is a failure when not allowed by the registry.
11. Fallback is a warning only when allowed by the registry.
12. Fallback is a failure when not allowed by the registry.
13. AI reconciliation recommendation should be accounted for (never a hard fail in 8C).
14. Export parity should be recorded.
15. Export parity score must meet the registry threshold when available.
16. Missing required metadata blocks or fails the relevant gate.

## Gate Outcome Rules

Overall report status precedence:

- `blocked` if any blocking gate exists.
- `fail` if any fail gate exists (and none blocked).
- `warning` if no fail/blocking gates exist but one or more warnings exist.
- `pass` if all required gates pass.
- `not_evaluated` if the run has no import ID or every gate is not_evaluated.

## Phase 8B → 8C tightening

The gate evaluator consumes a Phase 8B `GoldenCorpusRunEvaluation` (which already carries the
registry `corpus` item and the Phase 7 metadata `snapshot`). It does not re-derive that data.
The key difference is severity:

| Condition | Phase 8B | Phase 8C |
|---|---|---|
| Visual QA below registry minimum | warning | **fail** |
| Repair final below minimum (repair not skipped) | warning | **fail** |
| Export parity artifact missing | warning | **fail** |
| Export parity score below minimum | warning | **fail** |

Manual-review/fallback remain warnings when the registry allows them and failures when it does
not. AI reconciliation issues remain warnings (non-blocking) in Phase 8C.

## Threshold Source

Thresholds come from the Golden Corpus Registry:

- `visualQaMinimum`
- `repairFinalMinimum`
- `exportParityMinimum`

Phase 8C does not hardcode thresholds outside the registry, except mirrored in the SQL
validation file (`registry` CTE) for operators who run checks directly in Supabase.

## Acceptable Warnings

- `manual_review_required_allowed`
- `fallback_used_allowed`
- `repair_skipped_no_eligible_pages`
- `ai_reconciliation_recommended_not_run`
- `ai_reconciliation_optional_not_run`
- `export_parity_manual_required`
- `export_parity_not_recorded_initial_run`
- `visual_quality_score_missing_but_artifact_present`
- `repair_final_score_missing_but_repair_skipped`
- `diagnostics_job_missing`

## Failures

- `import_failed`
- `import_not_completed`
- `template_missing`
- `template_page_count_mismatch`
- `visual_quality_missing`
- `visual_quality_below_threshold`
- `repair_audit_missing`
- `repair_failed`
- `repair_below_threshold`
- `manual_review_not_allowed`
- `fallback_not_allowed`
- `export_parity_failed`
- `export_parity_below_threshold`
- `required_metadata_missing`
- `backend_unknown_operation`

## Evaluator & Types

`src/lib/reportTemplate/ingestion/qualityGates/`:

- `pdfImportQualityGateTypes.ts` — statuses, severities, categories, `PdfImportQualityGate`,
  `PdfImportQualityGateReport`, plus `isFailingQualityGate`, `summarizeQualityGates`, and
  `resolveOverallQualityGateStatus`.
- `pdfImportQualityGateEvaluator.ts` — `evaluatePdfImportQualityGates({ evaluation, now? })`
  emits 16 gates (import, template ×2, visual_quality ×2, repair ×3, manual/fallback policy,
  ai_reconciliation, export_parity ×3, diagnostics, metadata) and an overall status. When the
  import ID is missing it short-circuits to a single not_evaluated gate.

This module lives under `qualityGates/` (not `goldenCorpus/`) because gates may later apply to
non-golden imports. It is consumed via its direct path and is not exported from the top-level
`ingestion/index.ts` barrel (matching the Phase 7/8 module convention).

## Phase 8C Acceptance Criteria

- quality gate types exist
- quality gate evaluator exists
- evaluator tests pass
- SQL check exists
- docs exist
- `npm run build` passes
- no persistence or data mutation added

## How Phase 8C Feeds Later Phases

- **Phase 8D** will persist the gate report (`golden_regression_summary`) into
  `template_imports.meta`.
- **Phase 8E** will surface gate status in diagnostics.
- **Phase 8G** will lock Phase 8.
