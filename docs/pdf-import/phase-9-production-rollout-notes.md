# PDF Import Phase 9 Production Rollout Notes

## Rollout goal

Move the Phase 8 golden corpus regression framework and the Phase 9 operational
tooling (orchestrator, operator console, history + baselines, export parity
automation, release gates, monitoring readiness) into controlled production use,
without regressing the existing PDF import → Visual QA → Repair pipeline.

Phase 9 does not change the import pipeline itself. It adds the operational layer
around it. Rollout therefore means enabling operators to run and trust the golden
regression + release + monitoring workflow against production data.

## Controlled rollout order

Roll out in stages. Do not skip ahead: each stage gates the next.

### Stage 1 — Merge and verify code

- Merge the Phase 9 branch(es) into `main`.
- Confirm CI is green (or green-with-known-unrelated-failures already documented).
- Confirm the build passes and the monitoring + release gate tests pass.
- Confirm no private artifacts were committed.

### Stage 2 — Database readiness

- Confirm `public.pdf_import_golden_runs` exists with its indexes and policies.
- Run `pdf-import-phase-9-final-check.sql` (read-only) and record section 5
  (object readiness) and section 10 (decision).
- Do not proceed if any core database object is missing.

### Stage 3 — Backend readiness

- Confirm the `template-import-pdf` edge function supports the Phase 9 operations
  (`save_golden_run_history`, `list_golden_run_history`, `get_golden_run_history`,
  `get_latest_golden_run_baselines`, `save_export_parity`, `get_export_parity`).
- Confirm no `backend_unknown_operation` alerts in the Phase 9F monitoring SQL.

### Stage 4 — Operator console smoke

- Run the Phase 9 final smoke test (`phase-9-final-smoke-test.md`).
- Confirm the Golden Regression console loads, evaluates, persists, and shows
  baseline comparison.
- Confirm the Template Import Quality dashboard still loads and deep-links.

### Stage 5 — First live golden runs

- Run golden regression for the canonical corpus items, one at a time.
- Persist each run to history.
- Review the baseline comparison; first runs will be `no_baseline` (acceptable).
- Grow corpus coverage until all canonical items have at least one history run.

### Stage 6 — Establish monitoring cadence

- Adopt the daily and pre-release monitoring procedures from
  `phase-9f-monitoring-runbook.md`.
- Record blockers and owners.
- Re-run the final check SQL before each release and record the decision.

## Acceptable early-rollout warnings

The following are expected during early rollout and do NOT block production:

- No full six-corpus live coverage yet (history is still being populated).
- Baseline comparison is `no_baseline` for first runs of each corpus item.
- Export parity Level 3 unavailable while Level 1/2 evidence works.
- OCR corpus requires manual review.
- Design-heavy corpus shows expected warning-level drift.
- Monitoring returns `warnings_present` with no error/critical/release-blocking
  alerts.
- Phase 9E release gate returns `release_ready_with_warnings`.
- Legacy stuck/failed imports predating Phase 9 appear in attention rows — triage
  per the runbook; they do not block the Phase 9 rollout itself.

## Rollback / pause conditions

Pause the rollout and treat as `production_blocked` if any of these occur:

- The build or required tests start failing on `main`.
- The final check SQL returns `production_blocked_database` or
  `production_blocked_missing_database_objects`.
- Monitoring returns `critical_alerts_present` or `release_blocked`.
- The operator console crashes, or history/baseline persistence fails.
- The export parity runner crashes.
- A `backend_unknown_operation` alert appears (frontend/back-end drift).
- Private artifacts are found staged or committed.

Rollback for Phase 9 is low-risk because it is additive: disabling the operator
console route and pausing golden runs removes the Phase 9 surface without touching
the import pipeline. The `pdf_import_golden_runs` table and history rows can remain
in place; they are read-only inputs to monitoring.

## Operational owners

- **developer_fullstack** — release gate blockers, orchestrator/console defects.
- **developer_backend** — edge function operations, stuck imports, engine version,
  rasters, repair audit.
- **developer_sidecar** — Docling / sidecar diagnostics failures.
- **developer_frontend** — Visual QA output, export parity rendering, console UI.
- **qa** — golden quality gates, baseline degradation, manual review rate, corpus
  coverage.
- **operator** — running golden regression, documenting warnings, export parity
  reruns.
- **security** — private artifact risk.

## Phase 10 recommendations

Once Phase 9 is `production_ready` or `production_ready_with_warnings` and live
golden coverage is established:

- Deliver monitoring alerts (dashboard panel first, then Slack/email) reusing the
  existing `PdfImportAlertPayload` — see `phase-9f-future-alert-integrations.md`.
- Add a Supabase scheduled check (`pg_cron` + edge function) to run the monitoring
  queries automatically.
- Enforce release gates in CI once golden coverage is stable.
- Automate scheduled golden corpus execution.
- Harden the import pipeline based on the drift and manual-review trends surfaced
  by monitoring.
