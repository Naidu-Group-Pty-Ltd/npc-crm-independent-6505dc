# PDF Import Phase 11C — Monitoring Runbook (template)

A **template** for triaging PDF import monitoring alerts. It is
**NON-remediating**: every step is diagnostic or a manual, permission-gated
lifecycle action. Nothing here repairs, retries, reruns, or reconciles anything
automatically. Do not paste private client data, raw PDF/OCR text, screenshots,
or signed URLs into this runbook.

## How to use

1. Open `/admin/pdf-import-monitoring`.
2. Trigger `Run monitoring check` (requires `pdf_import.manage_monitoring_alerts`)
   or inspect existing alerts.
3. Find the alert's `ruleId`, jump to its anchor below, follow the diagnostics,
   then `acknowledge` / `resolve` / `suppress` / `mark false positive` as
   appropriate.

## General triage order

1. **critical** release-blocking (security/permissions/backend/golden) first.
2. **high** import/pipeline failures next.
3. **warning** hygiene items (missing metadata, coverage) last.

## Rule anchors

### import-failure-detected
Recent imports failed. Inspect `pdf_import_jobs` (status=`failed`) and the
`template-import-pdf` / Cloud Run logs. Resolve once the failure rate returns to
baseline.

### import-stuck-in-progress
Imports remained `queued` beyond 30m. Inspect the worker and sidecar dispatch.
Do not auto-rerun — escalate to the backend owner.

### import-error-rate-high
Failed:completed ratio exceeded threshold. Correlate with a recent deploy.

### import-duration-regression
p95 import duration regressed vs baseline. Check sidecar latency / payload sizes.

### sidecar-diagnostics-failed
Docling / sidecar diagnostics jobs failed. Inspect Cloud Run logs (never surface
raw logs to the frontend).

### sidecar-engine-version-missing
Completed imports lack engine-version metadata. Verify the sidecar response
contract.

### sidecar-unavailable
The parse sidecar is unavailable. Check Cloud Run service health.

### source-raster-missing
Source rasters absent for imports that should have them. Inspect the private
artifact bucket (never expose signed URLs here).

### artifact-bucket-public-exposure
A template-import artifact bucket is public. **Security-critical** — make the
bucket private immediately and confirm via the SQL check.

### visual-qa-missing / visual-qa-low-similarity
Visual QA absent or below the similarity floor. Route to QA for manual review.

### repair-audit-missing / repair-failure-rate-high
Repair audit missing or repair failures elevated. Diagnostic only — do not
auto-apply repairs.

### reconciliation-manual-backlog / reconciliation-plan-unresolved
Manual reconciliation backlog. Route to the manual-review queue. Do not
auto-apply reconciliation plans.

### export-parity-missing / export-parity-failed / export-parity-manual-required
Export parity gaps. Inspect the export vs source scores; route manual cases to
review.

### golden-quality-gate-failed / golden-quality-gate-blocked
**Critical.** Golden regression gate failed/blocked. Do not bypass the gate —
escalate to QA and hold release.

### golden-baseline-degraded / golden-corpus-coverage-incomplete
Baseline degraded or corpus coverage incomplete. Schedule a golden re-run
manually (not automatic).

### release-gate-blocked / release-readiness-regressed
Database-side release gate blocked or readiness regressed. Run the Phase 11A/11C
readiness SQL and hold release.

### backend-unknown-operation / backend-contract-drift
Frontend/backend contract mismatch. Patch the Edge Function contract; hold
release.

### private-artifact-exposure-risk / raw-content-persistence-risk
**Security-critical.** Investigate immediately; confirm no raw content or private
artifacts are persisted or exposed.

### permission-escalation-detected / unauthorized-write-attempt
**Security.** Review `user_roles` and the permission matrix; confirm the
deny-by-default policy holds.

### performance-budget-exceeded
A performance budget was breached. Diagnose the regression; not release-blocking.

### quality-gate-regression
A quality gate regressed vs its accepted baseline. Route to QA.

### operator-control-blocked-bypass
**Critical.** A safety-blocked operator control appears available/executed.
Confirm the Phase 10/11B safety semantics are intact.

### monitoring-check-stale
No monitoring check ran within the freshness window. Re-run the check and verify
the schedule.
