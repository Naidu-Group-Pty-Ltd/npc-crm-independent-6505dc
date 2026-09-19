# PDF Import Phase 11C — Monitoring + Alerting Activation

## Objective

Phase 11C adds a **durable, rule-based, idempotent, severity-aware,
status-aware, permission-aware, NON-remediating** monitoring and alerting layer
for the PDF import pipeline. It **detects, classifies, persists, displays,
acknowledges, and resolves** PDF import alerts — but it never repairs, retries,
reruns, reconciles, mutates templates, bypasses quality gates, or calls AI.

## Why This Exists

Phase 9F introduced an in-memory monitoring summary (`pdfImportMonitoring*`) that
computes a transient status from a metric snapshot. It has no memory: an alert
that fired yesterday leaves no trace today, and there is no way to acknowledge or
resolve anything. Phase 11C makes alerts **durable** so operators can triage them
over time.

## What Phase 11C Adds

- **One new table** — `public.pdf_import_monitoring_events` (the alert ledger).
- **One new Edge Function** — `pdf-import-monitoring` (detect + persist +
  lifecycle, admin/superadmin gated, service-role mediated).
- **Monitoring-event modules** under
  `src/lib/reportTemplate/ingestion/monitoring/monitoringEvent*` —
  types, rules (34 canonical rules across 16 domains), signals, evaluator
  (dedupe + rollup + lifecycle transitions), persistence, and display.
- **Two new permission capabilities** — `pdf_import.view_monitoring` and
  `pdf_import.manage_monitoring_alerts` (granted to `pdf_admin` and
  `developer_admin` only).
- **Admin dashboard** — `/admin/pdf-import-monitoring` page + panel + alert list
  + alert detail components.
- Docs, JSON schema, runbook template, and a read-only validation SQL script.

## What Phase 11C Does NOT Do

- No automatic remediation, repair, retry, rerun, or reconciliation.
- No AI calls, no template mutation, no quality-gate bypass.
- No weakening of role-based permissions or RLS.
- No exposure of service-role secrets or raw Cloud Run logs to the frontend.
- No storage of raw PDF text, raw OCR text, screenshots/rasters, signed URLs, or
  private client PDF content in alert events.
- No external alert integrations (email / Slack / webhooks) — none exist safely,
  so none are added. No private webhook URLs or email addresses are hardcoded.
- No changes to the Cloud Run sidecar / Docling, golden corpus thresholds,
  quality-gate semantics, or Phase 10 safety semantics.

## Severities and Statuses

- **Severities** (ranked): `info` < `warning` < `high` < `critical`.
- **Statuses**: `open` → `acknowledged` → `resolved`; plus `suppressed` and
  `false_positive`. Only `open` and `acknowledged` are "active" and count toward
  health. `suppressed` and `false_positive` are never auto-resolved.

## Domains (16)

`import_pipeline`, `sidecar_diagnostics`, `artifact_integrity`, `visual_quality`,
`repair`, `reconciliation`, `export_parity`, `golden_regression`,
`release_gates`, `backend_contract`, `security_privacy`, `permissions`,
`performance`, `quality_gates`, `operator_controls`, `monitoring_self`.

See `phase-11c-alert-policy.md` for the full 34-rule catalog.

## Detection, Dedupe, and Lifecycle

1. **Detect** — `run_check` collects a safe, aggregate metric snapshot from live
   tables (`pdf_import_jobs`, `pdf_import_golden_runs`, `storage.buckets`) and
   derives fired signals. It stores only counts, ratios, and thresholds.
2. **Dedupe** — each rule maps to a deterministic `event_key`
   (`${ruleId}:global`). A partial unique index guarantees at most one *live*
   (`open`/`acknowledged`/`suppressed`) row per key. A recurring signal
   increments `occurrence_count` and refreshes `last_seen_at`, severity, and
   summary instead of inserting a duplicate.
3. **Auto-resolve** — when a `run_check` no longer fires a rule that had an
   active event, that event is auto-resolved (`resolved`, note `auto-resolved`).
   Suppressed and false-positive events are never auto-resolved.
4. **Manual lifecycle** — a permitted operator can `acknowledge`, `resolve`,
   `suppress`, or `mark_false_positive` an event. Invalid transitions are
   rejected (e.g. acknowledging a non-open event returns 409).

## Permissions

- Viewing the dashboard requires `pdf_import.view_monitoring`.
- Running a check and all lifecycle actions require
  `pdf_import.manage_monitoring_alerts`.
- Both capabilities are granted only to `pdf_admin` and `developer_admin`
  (deny-by-default; viewer/operator/qa/system_service hold neither).
- The Edge Function re-checks `admin`/`superadmin` in `user_roles` server-side —
  the frontend capability check is UX only; the backend is the security boundary.

## Backend Enforcement + RLS

`pdf_import_monitoring_events` has RLS enabled. Writes are **service-role only**;
direct `SELECT` is restricted to `admin`/`superadmin` via `has_role`. The browser
never queries the table directly — all access flows through the secure Edge
Function, which authenticates the caller and re-checks the role before any read
or write.

## Files

- Migration: `supabase/migrations/20260709120000_create_pdf_import_monitoring_events.sql`
- Edge Function: `supabase/functions/pdf-import-monitoring/index.ts`
- Library: `src/lib/reportTemplate/ingestion/monitoring/monitoringEvent*.ts`
- UI: `src/pages/admin/PdfImportMonitoring.tsx`,
  `src/components/admin/pdfImport/PdfImportMonitoringPanel.tsx`,
  `PdfImportAlertEventList.tsx`, `PdfImportAlertEventDetail.tsx`
- Docs: this file, `phase-11c-alert-policy.md`,
  `pdf-import-monitoring-event.schema.json`,
  `phase-11c-monitoring-runbook.template.md`
- SQL: `scripts/regression/pdf-import-phase-11c-monitoring-check.sql`

## Acceptance Criteria

- Table + RLS + policies exist and validate read-only (`monitoring_healthy_ready`).
- The Edge Function is deployed and admin/superadmin gated.
- 34 rules across 16 domains; deny-by-default monitoring capabilities.
- Alerts persist, dedupe, auto-resolve, and support the full lifecycle.
- No raw content / signed URLs / private data are ever stored.
- `tsc` clean; monitoring + permission tests pass; no new suite regressions.
