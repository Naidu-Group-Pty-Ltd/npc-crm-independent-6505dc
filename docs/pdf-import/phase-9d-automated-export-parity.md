# PDF Import Phase 9D — Automated Export Parity Runner

## Objective

Phase 9D creates an automated export parity runner that compares source/editor/export
evidence and persists an export parity summary.

## Why This Exists

Export parity is currently the largest remaining manual gap in the golden
regression framework. Phase 8C treats export parity as a quality gate. Phase 9D
reduces manual effort by automating as much of the export parity evaluation as the
current rendering stack safely supports.

## What Phase 9D Does

- Adds export parity runner types.
- Adds score calculation helpers.
- Adds evidence extraction helpers.
- Adds an automation-safe runner.
- Reuses existing Visual QA evidence where available.
- Reuses existing export parity persistence (Phase 7F).
- Adds operator console integration.
- Adds orchestrator integration.
- Adds SQL validation.
- Adds tests.

## What Phase 9D Does Not Do

- Does not upload PDFs.
- Does not automate PDF import.
- Does not create a database table.
- Does not create migrations.
- Does not replace manual export parity.
- Does not add a new sidecar service.
- Does not force exported PDF rasterization if not already available.
- Does not store raw PDFs or raster images in git.
- Does not change quality thresholds.

## Automation Levels

### Level 1 — Summary/manual compatibility

The runner can build and persist export parity summaries from provided/manual
metrics or an existing summary. Always supported.

### Level 2 — Source vs editor automated comparison

The runner reuses existing Visual QA evidence (`page-NNN-source.png` /
`page-NNN-generated.png` rasters + per-page similarity scores) to derive the
editor-vs-source comparison. **Implemented** — Visual QA already produces this
evidence.

### Level 3 — Full source/editor/export comparison

The runner can compare source, editor, and exported-PDF rasters when export raster
evidence is available.

**Status in this repo: unavailable.** There is currently no exported-PDF
rasterization utility (`visualQuality/diff/rasterize.ts` only rasterizes the source
vs the editor render for Visual QA; nothing rasterizes the *exported* PDF). Level 3
is therefore reported, not forced: when export raster evidence is absent the runner
returns `partial`/`manual_required` with the blocker/warning
`export_rasterization_unavailable`, and manual export parity remains fully
supported. The runner *does* support Level 3 automatically the moment export raster
evidence is supplied (e.g. a future export rasterizer or operator-provided export
scores).

## Runner Modes

- `source_editor_only`
- `source_export_only`
- `editor_export_only`
- `full`
- `auto` — chooses the highest automation level the available evidence supports.

## Runner Statuses

- `completed`
- `partial`
- `manual_required`
- `failed`
- `not_ready`

## Evidence Types

- `source_raster`
- `editor_raster`
- `export_raster`
- `visual_quality_summary`
- `existing_export_parity_summary`
- `manual_metrics`

## Persistence Target

The runner persists through the existing Phase 7F export parity persistence helper:

- `template_imports.meta.export_parity_summary`
- `template_imports.meta.export_parity_artifact_path`

Storage artifact: `template-import-artifacts/{importId}/export-parity/export-parity.json`

The persisted `ExportParitySummary` keeps its strict Phase 7F shape. Runner-only
metadata (automation level, runner version, overall score, blockers, warnings)
stays on the `ExportParityRunnerResult` returned to the caller; blockers are also
mirrored into the summary's `problems[]` so they survive persistence. The persisted
`mode` reflects automation: `automated` (Level 3 completed), `hybrid` (Level 2 or
manual-scored), or `manual`.

## Failure / Blocker Codes

- `import_id_missing`
- `template_id_missing`
- `source_evidence_missing`
- `editor_evidence_missing`
- `export_evidence_missing`
- `visual_quality_missing`
- `export_rasterization_unavailable`
- `comparison_unavailable`
- `persistence_failed`
- `backend_contract_error`

## Orchestrator Integration

Two request flags on the golden corpus orchestrator:

- `runExportParity` — runs the export parity automation *before* evaluating the
  golden run. When the runner persists a summary, the orchestrator **reloads the
  import snapshot** so the quality gates see the refreshed export parity metadata.
- `persistExportParity` — passes `persist: true` to the runner.

A new `run_export_parity` step is inserted after `load_snapshot`. The runner result
is attached as `result.exportParityRunnerResult`. Non-blocking outcomes surface as
warnings (`export_parity_automation_incomplete` /
`export_parity_automation_manual_required`); a persistence failure with
`persistExportParity` on adds the failure `export_parity_persistence_failed`.

## Console Integration

The operator console adds **Run export parity automation before evaluation** and
**Persist export parity result** toggles, an **Export Parity** result tab
(`AutomatedExportParityPanel`), and confirmation-dialog copy explaining that export
parity runs before golden evaluation and may update `export_parity_summary`.

## Acceptance Criteria

- runner types / score helpers / evidence helpers / runner exist
- tests pass; build passes
- console + orchestrator integration exist
- SQL exists
- no database table / migration / backend deployment
- no private artifacts committed

## Known Limitations

- Level 3 (exported-PDF rasterization) is not available in the current stack; the
  runner degrades to `partial`/`manual_required` with `export_rasterization_unavailable`.
- Runner-only metadata (`automationLevel`, `runnerVersion`, `overallScore`,
  structured `warnings`/`blockers`) is **not** persisted into the strict
  `ExportParitySummary`; it lives on the runner result. SQL columns that read those
  keys will therefore be null (the persisted `mode`, `status`, and pair scores are
  populated normally). Blockers are additionally mirrored into `problems[]`.

## Recommended Next Phase

**Phase 9E — CI/release gates** that consume the golden run history + export parity
summaries to gate releases, followed by **9F — monitoring/alerts**.
