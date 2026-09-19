# PDF Import Monitoring Alert Response SOP

## Purpose

Respond to PDF import monitoring alerts and manage their lifecycle safely.

## Audience

pdf_admin, developer_admin.

## Required Role / Capability

`pdf_admin`; managing alerts needs `pdf_import.view_monitoring` + `pdf_import.manage_monitoring_alerts`.

## When To Use

Whenever an alert is open/acknowledged, and during the daily checklist.

## Preconditions

You can open `/admin/pdf-import-monitoring`.

## Procedure

1. Open `/admin/pdf-import-monitoring`.
2. Triage by severity: **critical** first, then **high**, then **warning**, then **info**.
3. Investigate the alert (do not resolve blindly).
4. Move it through the lifecycle: `open` → `acknowledged` → `resolved`, or `suppressed` / `false_positive` with a note.
5. For top rules act per below.

## Expected Result

The alert is triaged and its lifecycle state reflects reality. No remediation is auto-run.

## Stop Conditions

`sidecar_unavailable`, `artifact_bucket_public_exposure`, `private_artifact_exposure_risk`, `operator_control_blocked_bypass`, or `permission_escalation_detected` — escalate immediately.

## Escalation Path

developer_admin for critical/technical alerts; security owner for exposure/permission alerts.

## Evidence To Capture

Alert ID, rule ID, severity, occurrence count, and the action taken.

## What Not To Do

Do not resolve uninvestigated alerts, do not suppress critical safety alerts, do not expose signed URLs/logs to clients.

## Related Pages / Routes

`/admin/pdf-import-monitoring`.

## Handling Top Alert Rules

- `import_failure_detected` → incident response / import triage.
- `sidecar_unavailable` → incident response (developer_admin).
- `artifact_bucket_public_exposure` → make bucket private immediately; incident response.
- `golden_quality_gate_failed` / `golden_quality_gate_blocked` → golden regression review; hold release.
- `operator_control_blocked_bypass` → self-healing / operator control review; security escalation.

## Related Alerts

All `pdf_import_monitoring_events` rule IDs.
