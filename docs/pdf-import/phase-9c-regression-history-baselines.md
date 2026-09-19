# PDF Import Phase 9C — Regression History + Baseline Comparison

## Objective

Phase 9C introduces durable historical tracking for golden corpus regression runs.

Phase 8D stores the latest golden regression summary on the import record.

Phase 9C adds a dedicated historical ledger:

`public.pdf_import_golden_runs`

## Why This Exists

The latest summary alone cannot answer:

- What happened in previous runs?
- Did the latest run improve or regress?
- Which corpus items are consistently failing?
- Which score changed since the previous baseline?
- Are warnings increasing over time?
- Can release gates compare current results against a baseline?

A dedicated history table gives the system a regression timeline.

## What Phase 9C Does

- Creates `public.pdf_import_golden_runs`.
- Adds secure backend operations for saving/listing/loading history.
- Adds TypeScript history types.
- Adds a summary builder for history rows.
- Adds a persistence helper.
- Adds a baseline comparison helper.
- Updates the orchestrator to optionally save history and compare a baseline.
- Updates the operator console to show history save status and baseline comparison.
- Adds SQL validation.
- Adds tests.

## What Phase 9C Does Not Do

- Does not automate PDF uploads.
- Does not automate export parity (Phase 9D).
- Does not create CI/release gates (Phase 9E).
- Does not add monitoring alerts (Phase 9F).
- Does not replace `template_imports.meta.golden_regression_summary`.
- Does not store raw PDFs or images.
- Does not create a full history dashboard.

## Table Purpose

`public.pdf_import_golden_runs` stores one row per golden regression run.

It records:

- corpus identity
- import/template identity
- quality gate result
- operator decision
- key scores
- warning/failure counts
- compact summary JSON
- triage JSON
- timestamps
- actor metadata

It stores **metadata only** — never source PDFs, screenshots, raster images, or
generated PDFs.

## Relationship to `template_imports.meta`

`template_imports.meta.golden_regression_summary`:
- latest summary attached to the import
- quick diagnostics display
- overwritten when the same import is persisted again

`public.pdf_import_golden_runs`:
- append-only-ish history ledger
- one row per golden run
- used for trend/baseline comparison

## Baseline Comparison

A baseline is the most recent previous historical run for the same `corpusId`.

A new run is compared against the previous run for the same `corpusId`. (Future
phases can expand to release baseline pinning, previous-passing-run, or best-run
baselines.)

## Regression Detection

Compared signals:

- `qualityGateStatus`
- `visualQaScore`
- `repairFinalScore`
- `exportVsSourceScore`
- `editorVsSourceScore`
- `exportVsEditorScore`
- warning count
- failure count

Regression examples:

- `pass -> warning`, `pass -> fail`, `warning -> fail`
- score drops by more than the allowed tolerance
- failures increase
- warnings increase significantly

## Comparison Outcomes

- `improved`
- `stable`
- `degraded`
- `no_baseline`
- `unknown`

Status/decision direction uses ordinal ranks (higher is better):

- Quality gate: `blocked` < `fail` < `not_evaluated` < `warning` < `pass`.
- Operator decision: `rejected` < `needs_rerun` < `not_reviewed` < `accepted_with_warnings` < `accepted`.

Outcome resolution: `degraded` if any gate/decision/metric degraded, failures
increased, or warnings increased by more than two; `improved` if nothing degraded
and at least one signal improved; `stable` if comparable but unchanged;
`no_baseline` when there is no previous run; `unknown` when there is insufficient
comparable data.

## Score Tolerances

Default per-metric score-drop tolerance: `0.02` for visual QA, repair final, and
export parity. A drop greater than tolerance counts as degraded; movement within
tolerance is stable.

## Orchestrator Integration

Two request flags:

- `saveHistory` — appends a row to `pdf_import_golden_runs` (independent of
  `persist`). A save failure fails the run (`history_persistence_failed`); saving
  with no summary fails with `history_summary_missing`.
- `compareBaseline` — loads the latest baseline for the corpus and attaches
  `baselineComparison`. Defaults to `saveHistory` when omitted.

New orchestration steps (in order): `load_baseline`, `compare_baseline` (before
`persist_summary`), then `save_history` (last). New result fields:
`baselineComparison`, `historyPersistenceResult`, `historyRecord`, `historySaved`.

Non-blocking signals: no baseline → warning `no_baseline_found`
(→ `completed_with_warnings`); baseline load failure → warning
`baseline_load_failed` (comparison left null); degraded outcome → warning
`baseline_regression_detected`.

## Console

The operator console adds:

- **Compare with latest baseline** toggle (read-only; works in evaluate-only).
- **Save history when persisting** toggle (writes only on Evaluate + Persist).
- A confirmation dialog that names both `template_imports.meta` and
  `pdf_import_golden_runs`.
- A **History** tab (baseline comparison + run-history table) and baseline/history
  badges on the result panel.

`TemplateImportQuality` is intentionally left meta-driven; it does not load
history rows (a full history dashboard is deferred to a later phase).

## Security Rules

- Reads and writes go through the secure `template-import-pdf` edge function.
- Reads follow ownership of the linked import (owner or admin) via an inner join
  to `template_imports`; no broad unauthenticated reads.
- Inserts are ownership-checked and run under the service role.
- No private PDF contents are exposed; metadata only.

## Deployment

Phase 9C requires **both**:

1. The migration `supabase/migrations/20260705000000_create_pdf_import_golden_runs.sql`.
2. A redeploy of the `template-import-pdf` edge function (four new operations).

## Acceptance Criteria

- migration exists and creates the table
- RLS/policies + indexes exist per project pattern
- backend save/list/get/baselines operations exist
- TypeScript history types exist
- history summary builder exists
- persistence helper exists
- baseline comparison helper exists
- orchestrator can save history and compare a baseline when requested
- console surfaces history save status and baseline comparison
- tests pass; SQL runs; build passes

## Recommended Next Phase

**Phase 9D — Automated export parity**, then **9E — release gates** and
**9F — monitoring/alerts**, all of which consume this ledger.
