# PDF Import Monitoring Runbook

## Purpose

This runbook explains how to interpret PDF import monitoring alerts and what to do
next.

## Monitoring Sources

- Supabase `template_imports`
- Supabase `pdf_import_jobs`
- Supabase `pdf_import_golden_runs`
- Storage objects (`template-import-artifacts`)
- Template Import Quality dashboard
- PDF Golden Regression console
- Cloud Run logs
- Supabase Edge Function logs

## Alert Response Levels

- **Info** — review when convenient.
- **Warning** — review during daily operations or before release.
- **Error** — investigate before shipping or continuing golden regression runs.
- **Critical** — immediate developer attention.

## Alert Playbooks

### failed_imports_recent {#failed-imports-recent}

Meaning: a recent import failed.
Check: `template_imports.error`, `pdf_import_jobs` status, Supabase Edge Function
logs, Cloud Run logs.
Actions: `inspect_pdf_import_jobs`, `inspect_supabase_function_logs`,
`inspect_cloud_run_logs`, `rerun_import` after the cause is understood.
Owner: `developer_fullstack`.

### stuck_imports_recent {#stuck-imports-recent}

Meaning: an import is stuck in a non-terminal state.
Check: `template_imports.status`, `updated_at`, finalization worker logs,
`pdf_import_jobs`.
Actions: `inspect_supabase_function_logs`, `inspect_pdf_import_jobs`, retry
finalize if supported, `rerun_import` if abandoned.
Owner: `developer_backend`.

### diagnostics_jobs_failed {#diagnostics-jobs-failed}

Meaning: Docling / sidecar diagnostics failed.
Check: `pdf_import_jobs.error_code`, `pdf_import_jobs.error_text`, Cloud Run logs.
Actions: `inspect_cloud_run_logs`, `patch_sidecar` if systemic, `rerun_import`.
Owner: `developer_sidecar`.

### engine_version_missing {#engine-version-missing}

Meaning: completed imports lack engine version metadata.
Actions: `inspect_pdf_import_jobs`, `inspect_supabase_function_logs`.
Owner: `developer_backend`.

### source_rasters_missing {#source-rasters-missing}

Meaning: expected source rasters are missing.
Actions: `inspect_storage_artifacts`, `rerun_import`.
Owner: `developer_backend`.

### visual_quality_missing {#visual-quality-missing}

Meaning: a completed import does not have Visual QA output.
Actions: `rerun_visual_qa`, `inspect_storage_artifacts`, inspect the Template
Builder console.
Owner: `developer_frontend`.

### repair_audit_missing {#repair-audit-missing}

Meaning: Visual QA exists but a repair audit does not.
Actions: `rerun_repair`, inspect `save_visual_repair_audit`, inspect storage
object.
Owner: `developer_backend`.

### export_parity_missing {#export-parity-missing}

Meaning: a golden-ready import lacks export parity.
Actions: `rerun_export_parity`, `document_warning`.
Owner: `operator`.

### export_parity_failed {#export-parity-failed}

Meaning: export parity failed or produced invalid output.
Actions: `rerun_export_parity`, inspect renderer, inspect exported PDF,
`patch_renderer` if repeated.
Owner: `developer_frontend`.

### export_parity_manual_required {#export-parity-manual-required}

Meaning: export parity needs manual review to complete.
Actions: `review_dashboard`, `rerun_export_parity`, `document_warning`.
Owner: `manual_review`.

### manual_review_rate_high {#manual-review-rate-high}

Meaning: the manual review rate over recent completed imports is high.
Actions: `review_dashboard`, `run_failure_triage`, `document_warning`.
Owner: `qa`.

### golden_quality_gate_failed {#golden-quality-gate-failed}

Meaning: golden regression failed required quality gates.
Actions: open the PDF Golden Regression console, review failures, run failure
triage, fix the failing pipeline stage, rerun golden regression.
Owner: `qa` / `developer_fullstack`.

### golden_quality_gate_blocked {#golden-quality-gate-blocked}

Meaning: golden regression quality gates are blocked.
Actions: `rerun_golden_regression`, `inspect_storage_artifacts`, `block_release`.
Owner: `operator`.

### golden_summary_missing {#golden-summary-missing}

Meaning: no golden regression summaries are present.
Actions: `rerun_golden_regression`, `document_warning`.
Owner: `operator`.

### golden_history_missing {#golden-history-missing}

Meaning: no golden run history rows are present.
Actions: `rerun_golden_regression`, `document_warning`.
Owner: `operator`.

### baseline_degraded {#baseline-degraded}

Meaning: the latest golden run is worse than the previous baseline.
Actions: compare metrics, inspect baseline comparison messages, review recent
code changes, rerun if flaky, block release if confirmed.
Owner: `qa`.

### corpus_coverage_incomplete {#corpus-coverage-incomplete}

Meaning: one or more canonical corpus items have no history run.
Actions: `rerun_golden_regression`, `document_warning`.
Owner: `qa`.

### release_blocked_database {#release-blocked-database}

Meaning: the database-side release gate indicates a release-blocking state.
Actions: run the Phase 9E release SQL, inspect blocking rows, fix or explicitly
defer with written approval.
Owner: `developer_fullstack`.

### backend_unknown_operation {#backend-unknown-operation}

Meaning: the frontend attempted an operation the backend does not support.
Actions: patch the Supabase Edge Function, deploy the function, rerun the relevant
console flow.
Owner: `developer_backend`.

### private_artifact_risk {#private-artifact-risk}

Meaning: private artifacts appear staged or at risk of exposure.
Actions: `block_release`, `document_warning`, unstage/remove the artifacts.
Owner: `security`.

## Daily Monitoring Procedure

1. Run the Phase 9F SQL (`pdf-import-phase-9f-monitoring-check.sql`).
2. Review critical alerts.
3. Review error alerts.
4. Review golden regression coverage.
5. Review baseline degradation.
6. Review the manual review rate.
7. Record blockers.
8. Assign an owner.

## Pre-Release Monitoring Procedure

1. Run the local Phase 9E release check script.
2. Run the Phase 9E release gate SQL.
3. Run the Phase 9F monitoring SQL.
4. Confirm no critical alerts.
5. Confirm no release blockers.
6. Confirm warnings are documented.

## Escalation Rules

- **Critical** — escalate immediately.
- **Error** — fix before release.
- **Warning** — document and review.
- **Info** — track only.
