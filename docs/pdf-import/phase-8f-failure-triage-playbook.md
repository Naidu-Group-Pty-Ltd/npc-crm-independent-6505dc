# PDF Import Phase 8F — Failure Triage + Recovery Playbook

## Objective

Phase 8F defines how operators and developers should respond when PDF import regression checks
produce warnings, failures, blocked states, or missing artifacts.

## Why This Exists

Phase 8A–8E made the PDF import quality system measurable and visible.

The next step is operational clarity. When a golden regression run fails, the team needs to know:

- what failed
- likely cause
- whether it is blocking
- who should handle it
- what recovery action to take
- whether to rerun, repair, reconcile, manually review, or patch code

## What Phase 8F Does

- Defines triage categories.
- Defines failure codes.
- Defines recovery actions.
- Defines ownership routing.
- Adds a TypeScript triage helper (`failureTriage/`).
- Adds a read-only SQL triage report.
- Adds tests.
- (UI integration deferred — see "Dashboard integration".)

## What Phase 8F Does Not Do

- Does not fix every failure automatically.
- Does not mutate production data.
- Does not create new persistence.
- Does not add browser automation.
- Does not change quality thresholds.
- Does not modify the sidecar.
- Does not create a database table.

## Triage Categories

- **import** — import record creation/completion (`import_missing`, `import_failed`,
  `import_not_completed`, `finalization_failed`).
- **sidecar** — Cloud Run/Docling parse (`sidecar_unavailable`, `sidecar_timeout`,
  `docling_parse_failed`, `diagnostics_job_failed`, `engine_version_missing`).
- **artifact** — storage artifacts (`source_rasters_missing`,
  `visual_quality_artifact_missing`, `repair_audit_missing`,
  `export_parity_artifact_missing`, `storage_object_missing`).
- **template** — template creation/update (`template_missing`,
  `template_page_count_mismatch`, `template_empty`, `apply_repair_failed`,
  `version_snapshot_missing`).
- **visual_quality** — Visual QA (`visual_quality_missing`,
  `visual_quality_below_threshold`, `visual_quality_manual_review_required`,
  `generated_raster_missing`, `diff_raster_missing`).
- **repair** — deterministic repair (`repair_audit_missing`, `repair_failed`,
  `repair_below_threshold`, `fallback_not_allowed`, `manual_review_not_allowed`,
  `repair_skipped`).
- **ai_reconciliation** — AI reconciliation (`ai_reconciliation_recommended_not_run`,
  `ai_reconciliation_failed`, `ai_reconciliation_manual_review_not_run`).
- **export_parity** — source/editor/export comparison (`export_parity_missing`,
  `export_parity_failed`, `export_parity_below_threshold`, `export_parity_manual_required`).
- **golden_regression** — persisted golden regression summaries (`golden_regression_missing`,
  `quality_gate_failed`, `quality_gate_blocked`, `operator_rejected`, `operator_needs_rerun`).
- **auth_security** — auth/permissions (`unauthorized`, `forbidden`,
  `template_locked_for_review`, `version_conflict`).
- **backend_contract** — frontend/backend contract mismatches (`backend_unknown_operation`,
  `edge_function_missing_operation`, `response_shape_invalid`).

## Recovery Action Types

`no_action`, `accept_warning`, `manual_review`, `rerun_import`, `rerun_visual_qa`,
`rerun_repair`, `run_ai_reconciliation`, `rerun_export_parity`, `reapply_template`,
`inspect_template_editor`, `inspect_storage_artifacts`, `inspect_pdf_import_jobs`,
`inspect_supabase_function_logs`, `inspect_cloud_run_logs`, `patch_frontend`,
`patch_supabase_function`, `patch_sidecar`, `patch_renderer`, `rerun_golden_regression`,
`escalate_to_developer`.

## Ownership Routing

Owners: `operator`, `qa`, `manual_review`, `developer_frontend`, `developer_backend`,
`developer_sidecar`, `developer_fullstack`, `unknown`.

- manual review required → `manual_review`
- missing storage object → `developer_backend`
- template page count mismatch → `developer_frontend` (mapping) / `developer_backend` (finalization)
- sidecar timeout / unavailable → `developer_sidecar`
- backend unknown operation → `developer_backend`
- visual drift / export drift → `developer_frontend`

## Severity Levels

- **info** — no action required.
- **warning** — non-blocking; operator/developer should review.
- **error** — blocking failure; must be fixed or rerun.
- **critical** — systemic failure or backend/sidecar contract issue.

## Triage Outcome States

`resolved`, `monitor`, `action_required`, `blocked`, `escalate`.

Summary precedence: `escalate > blocked > action_required > monitor > resolved`.
Summary severity is the highest severity across recommendations; the primary owner/action come
from the highest-severity recommendation.

## Core Playbooks

### Import failed
{: #import-failed }

**Symptoms:** `template_imports.status = failed`; `template_imports.error` not null;
`pdf_import_jobs.status = failed`.
**Likely causes:** sidecar unavailable, parse failure, finalization worker failed, storage
upload failure, schema validation failure.
**First actions:** check the latest `pdf_import_jobs` row → `template_imports.error` →
`import_manifests_summary` → Supabase function logs → Cloud Run logs (if the parser failed);
rerun the import only after identifying whether the source PDF or infrastructure caused it.
**Recovery:** `rerun_import`, `inspect_pdf_import_jobs`, `inspect_cloud_run_logs`,
`patch_sidecar` (if systemic).

### Visual QA missing
{: #visual-quality-artifact-missing }

**Symptoms:** `visual_quality_artifact_path` null; `visual_quality_summary` missing; Review
Quality fails.
**Likely causes:** source rasters missing, `get_artifacts` failed, generated render capture
failed, frontend capture target issue.
**Recovery:** `rerun_visual_qa`, `inspect_storage_artifacts`, inspect the Template Builder
console, patch renderer/capture if repeated.

### Repair audit missing
{: #repair-audit-missing }

**Symptoms:** `visual_repair_artifact_path` null; `repair-loop.json` missing.
**Likely causes:** repair not run, `save_visual_repair_audit` failed, backend operation
mismatch, storage upload failed.
**Recovery:** `rerun_repair`, inspect Supabase function logs, check `save_visual_repair_audit`,
`patch_supabase_function` if operation mismatch.

### Template page count mismatch
{: #template-page-count-mismatch }

**Symptoms:** template page count differs from import page count.
**Likely causes:** finalization schema issue, template schema normalization issue, page
omission during mapping, async finalization bug.
**Recovery:** inspect template schema, inspect import artifacts, `rerun_import`, patch
finalization/mapping if repeated.

### Manual review required
{: #visual-quality-manual-review-required }

**Symptoms:** `visual_quality_manual_review_required` true; `repair_requires_manual_review` true.
**Likely causes:** low-confidence extraction, OCR/scanned PDF, design-heavy layout, missing
rasters, fallback required.
**Recovery:** `manual_review`; `run_ai_reconciliation` if policy recommends; accept the warning
only if the registry allows manual review.

### Export parity failed
{: #export-parity-failed }

**Symptoms:** `export_parity_summary.status = failed`; export parity score below threshold;
exported PDF drifts from source/editor.
**Likely causes:** export renderer differs from editor renderer, font mismatch, CSS print
margin issue, image/object-fit drift, generated PDF path issue.
**Recovery:** inspect exported PDF, inspect template editor, `patch_renderer`,
`rerun_export_parity`.

### Golden regression failed
{: #quality-gate-failed }

**Symptoms:** `golden_regression_summary.qualityGateStatus = fail` or `blocked`; `failures`
array not empty.
**Recovery:** review the failures array, map failure codes to triage actions (via the triage
evaluator), rerun the specific pipeline step for a data issue, or patch code if systemic.

## Operator Decision Guide

- **accepted** — quality gate passed and no meaningful warnings remain.
- **accepted_with_warnings** — warnings are expected/allowed and documented.
- **needs_rerun** — import/QA/repair/export should be rerun.
- **rejected** — a real defect must be fixed.
- **not_reviewed** — no human review has happened yet.

## TypeScript Helper

`src/lib/reportTemplate/ingestion/failureTriage/`:

- `pdfImportFailureTriageTypes.ts` — categories, severities, owners, recovery actions,
  outcomes, rule/recommendation/summary types.
- `pdfImportFailureTriageRules.ts` — 40 rules + a default `unknown` rule;
  `getPdfImportFailureTriageRule`, `getRecoveryActionLabel`.
- `pdfImportFailureTriageEvaluator.ts` — `evaluatePdfImportFailureTriage`,
  `extractFailureSignalsFromGoldenRegression`, `normalizeFailureCode`, and the
  severity/outcome/owner/action resolvers.

`normalizeFailureCode` maps Phase 8C gate ids and Phase 8B/8D run-level code variants (and
`fail_`/`warning_`/`blocked_`/`not_locked_` prefixes, and `gate_id:message` strings) to canonical
rule codes so triage is robust to the various producers.

## Dashboard integration

Deferred. The Phase 8E dashboard already surfaces the golden gate status, warning/failure
counts, and an action label per row; adding a separate triage column would widen an already
13-column table. Wiring `evaluatePdfImportFailureTriage` into a compact per-row tooltip (or a
future detail drawer) is a low-risk follow-up for a later phase.

## SQL Validation

`scripts/regression/pdf-import-phase-8f-failure-triage-check.sql` (read-only) maps current
`template_imports.meta` failures/warnings to triage rows, and summarizes by severity/category,
by owner, and by import.

## Phase 8F Acceptance Criteria

- playbook doc exists
- triage types exist
- triage rules exist
- triage evaluator exists
- tests pass
- SQL exists
- build passes
- no new persistence is introduced
