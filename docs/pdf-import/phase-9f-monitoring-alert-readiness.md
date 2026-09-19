# PDF Import Phase 9F — Monitoring + Alert Readiness

## Objective

Phase 9F defines the monitoring and alert-readiness model for the PDF import
golden regression system. It does not send external alerts yet. It prepares the
rules, SQL, payloads, and operational playbooks needed for future alert delivery.

## Why This Exists

The PDF import system now has golden corpus regression, quality gates, export
parity automation, history tracking, release gates, and triage rules. Production
confidence now requires monitoring: the team needs to know when failures happen,
what they mean, who owns them, and what to do next.

## What Phase 9F Does

- Defines monitoring domains, signals, severities, and owner routing.
- Defines the alert payload shape.
- Adds pure TypeScript monitoring rules + evaluator.
- Adds a read-only SQL monitoring check.
- Adds tests.
- Adds a monitoring runbook.

## What Phase 9F Does Not Do

- Does not send Slack alerts, emails, or create GCP alert policies.
- Does not create Supabase scheduled jobs.
- Does not create new tables or migrations.
- Does not mutate data.
- Does not change the sidecar or deploy infrastructure.

## Monitoring Domains

- `import_pipeline`
- `sidecar_diagnostics`
- `artifact_integrity`
- `visual_quality`
- `repair`
- `export_parity`
- `golden_regression`
- `release_gates`
- `backend_contract`
- `security_privacy`

## Alert Severities

- **info** — informational; no immediate action.
- **warning** — needs review but not immediately production-breaking.
- **error** — action required; may block release or operator workflow.
- **critical** — immediate attention; likely systemic failure or release blocker.

## Alert Statuses

- `open`
- `acknowledged`
- `resolved`
- `muted`

Phase 9F only generates `open` alerts. Acknowledgement/resolution persistence is
future work.

## Alert Delivery Readiness

Future delivery channels: dashboard, SQL report, Slack, email, GCP log-based
alert, Supabase scheduled check, Make.com webhook. Phase 9F prepares the
`PdfImportAlertPayload` but **does not send it**.

## Core Monitoring Signals

- `failed_imports_recent` — recent `template_imports.status = failed`.
- `stuck_imports_recent` — imports stuck in a non-terminal state too long.
- `diagnostics_jobs_failed` — `pdf_import_jobs.status = failed`.
- `engine_version_missing` — completed imports lacking engine version.
- `source_rasters_missing` — expected source rasters absent (rule defined; not
  auto-derived from the current metric snapshot).
- `visual_quality_missing` — completed imports lacking a Visual QA artifact.
- `repair_audit_missing` — Visual QA exists but repair audit is missing.
- `export_parity_missing` — golden-ready imports lacking export parity.
- `export_parity_failed` — export parity status = failed.
- `export_parity_manual_required` — export parity status = manual_required.
- `manual_review_rate_high` — manual review ratio exceeds threshold.
- `golden_quality_gate_failed` — golden regression status = fail.
- `golden_quality_gate_blocked` — golden regression status = blocked.
- `golden_summary_missing` — no golden regression summaries present.
- `golden_history_missing` — no golden run history rows present.
- `baseline_degraded` — latest baseline comparison outcome = degraded.
- `corpus_coverage_incomplete` — a canonical corpus ID has no history run.
- `release_blocked_database` — Phase 9E SQL would return release blocked.
- `backend_unknown_operation` — known metadata/error patterns show operation mismatch.
- `private_artifact_risk` — private artifacts staged/at risk (surfaced from the
  local release check, not from the database).

## Recommended Default Thresholds

- failed imports in 24h ≥ 1 → error; ≥ 3 → critical
- stuck import older than 30 minutes → error
- failed diagnostics jobs in 24h ≥ 1 → error
- missing Visual QA ≥ 1 (completed) → warning
- missing repair audit ≥ 1 (after Visual QA) → warning
- export parity failed ≥ 1 → error
- golden fail/block ≥ 1 → critical
- baseline degraded (latest) ≥ 1 → warning
- manual review rate > 50% over recent completed imports → warning
- corpus coverage < 6 → warning
- release blocked → critical
- backend unknown operation ≥ 1 → critical
- private artifact risk ≥ 1 → critical

## Owner Routing

`operator`, `qa`, `manual_review`, `developer_frontend`, `developer_backend`,
`developer_sidecar`, `developer_fullstack`, `security`, `unknown`.

## Relationship to Failure Triage

Monitoring **detects** conditions; failure triage (Phase 8F) **recommends recovery
actions**. The monitoring rules attach triage-aligned action codes so future alert
delivery can include the correct playbook action.

## Relationship to Release Gates

Release gates (Phase 9E) answer "can we release?"; monitoring answers "is the
system healthy?". Some monitoring alerts are release blockers — e.g.
`golden_quality_gate_failed`, `export_parity_failed`, `backend_unknown_operation`,
`release_blocked_database`. An alert with `releaseBlocking = true` at `error`/
`critical` severity drives the summary status to `release_blocked`.

## Evaluator Output

`evaluatePdfImportMonitoring({ metrics, thresholds?, now? })` →
`PdfImportMonitoringSummary` with one of:

- `healthy`
- `warnings_present`
- `errors_present`
- `critical_alerts_present`
- `release_blocked`

`buildPdfImportAlertPayload(summary)` produces a channel-agnostic payload (top 10
alerts + counts) for future delivery — it is never sent by Phase 9F.

## Acceptance Criteria

- monitoring docs + runbook exist
- monitoring SQL exists (read-only)
- monitoring types, rules, and evaluator exist
- monitoring tests pass; build passes
- no external alert integration is required
