# PDF Import Phase 9A — Golden Corpus Run Orchestrator

## Objective

Phase 9A creates the orchestration layer that executes the complete post-import golden
regression chain from a corpus ID and import ID.

The orchestrator starts after a PDF has already been imported. It does not upload PDFs. It does
not automate browser import. It turns an existing import into a structured golden regression
result.

## Why This Exists

Phase 8 created the individual pieces: registry, runner, quality gates, regression summary
persistence, diagnostics display, and failure triage.

Before Phase 9B can add an operator console, the logic must be centralized in one orchestrator.
Without it, the future UI would have to manually stitch together many modules. The orchestrator
becomes the single operational entry point for golden regression evaluation.

## Orchestration Flow

```
corpusId + importId
→ load import quality snapshot          (get_status → GoldenCorpusImportQualitySnapshot)
→ build GoldenCorpusRunReference
→ evaluateGoldenCorpusRun               (Phase 8B)
→ evaluatePdfImportQualityGates         (Phase 8C)
→ buildGoldenRegressionSummary          (Phase 8D)
→ extractFailureSignalsFromGoldenRegression + evaluatePdfImportFailureTriage  (Phase 8F)
→ optionally saveGoldenRegressionSummary (Phase 8D persistence)
→ return GoldenCorpusOrchestrationResult
```

## Modes

### evaluate_only

Runs the chain but does not persist the golden regression summary. Use for previewing results,
testing, future UI preview mode, and debugging.

### evaluate_and_persist

Runs the chain and saves the summary to `template_imports.meta.golden_regression_summary`. Use
for a finalized golden corpus run, an operator-accepted run, or a future dashboard console
action. Persisting a `fail`/`blocked` summary is allowed — the point is to record real
regression failures, not only passes.

## Inputs (`GoldenCorpusOrchestratorRequest`)

- `corpusId`, `importId`
- `templateId?`, `sourceFilename?`
- `runId?`, `runBatchId?`
- `operatorDecision?`, `notes?`
- `persist?`
- `now?` (via options, for deterministic tests)

## Outputs (`GoldenCorpusOrchestratorResult`)

- `status`, `mode`
- `steps[]`
- `runEvaluation`, `qualityGateReport`, `goldenRegressionSummary`, `triageSummary`
- `persistenceResult`, `persisted`
- `warnings`, `failures`
- identity: `corpusId`, `importId`, `templateId`, `runId`, `runBatchId`, `generatedAt`

## Statuses

`completed` · `completed_with_warnings` · `failed` · `blocked` · `not_evaluated`.

Resolution: a persistence error → `failed`; quality gate `blocked` → `blocked`; quality gate
`fail` → `failed`; triage `escalate` → `failed`; triage `blocked` → `blocked`; quality gate
`warning` or any warnings → `completed_with_warnings`; otherwise `completed`.

## Step IDs

`validate_input` · `load_snapshot` · `evaluate_run` · `evaluate_quality_gates` ·
`build_summary` · `evaluate_triage` · `persist_summary`. (The pure function omits
`load_snapshot`; the async wrapper inserts it after `validate_input`.)

## What Phase 9A Does

- Creates orchestrator types.
- Creates the import snapshot builder/loader.
- Creates the orchestrator (pure + async).
- Wires Phase 8B/8C/8D/8F modules together.
- Adds tests and read-only SQL validation.

## What Phase 9A Does Not Do

- Does not upload PDFs or automate browser import.
- Does not create a dashboard page (Phase 9B) or a run-history table (Phase 9C).
- Does not create migrations, automate export parity, change the sidecar, or change thresholds.

## Snapshot Loading

The snapshot is loaded via the existing secure `template-import-pdf` `get_status` operation,
which returns the full `template_imports` row including `meta`. `templatePageCount` is sourced
from `meta.visual_quality_summary.pageCount` (the rendered/template page count). **No new
backend operation was required, and no Supabase deployment is needed.**

`buildGoldenCorpusImportQualitySnapshotFromRecord` also accepts a normalized frontend list row
and a template-like record (deriving `templatePageCount` from `schema.pages.length`), coercing
numeric/boolean strings and returning `null` for anything missing.

## Failure Handling

- Missing `corpusId` → `failed`, failure `input_missing_corpus_id`.
- Missing `importId` → `not_evaluated`, warning `input_missing_import_id` (no network call).
- Unknown `corpusId` → `failed`, failure `unknown_corpus_id`.
- Snapshot load error → `blocked`, failure `snapshot_load_failed`.
- Snapshot missing → `blocked`, failure `snapshot_missing`.
- Run/quality-gate/summary build throw → `failed` (`run_evaluation_failed` /
  `quality_gate_evaluation_failed` / `summary_build_failed`).
- `persist=true` with no summary → `failed`, failure `persistence_summary_missing`.
- `persist=true` save error → `failed`, failure `persistence_failed`.
- `persist=false` → persistence step skipped.

## Acceptance Criteria

- docs, orchestrator types, snapshot builder, and orchestrator exist
- orchestrator + snapshot tests pass; Phase 8 foundation tests still pass
- SQL exists; build passes
- no private files committed; no Supabase deployment (backend reused)

## Recommended Next Phase

**Phase 9B — Operator Console:** a Template-Builder/admin surface that calls
`orchestrateGoldenCorpusRun` in evaluate-only and evaluate-and-persist modes, rendering the
result steps, gate report, and triage recommendations.
