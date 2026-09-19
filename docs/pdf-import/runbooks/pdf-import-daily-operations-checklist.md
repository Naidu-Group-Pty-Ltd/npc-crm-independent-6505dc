# PDF Import Daily Operations Checklist

## Purpose

Provide the daily operating checklist that keeps PDF import production healthy.

## Audience

pdf_operator, pdf_qa_operator, pdf_admin.

## Required Role / Capability

`pdf_operator` or above; viewing monitoring needs `pdf_import.view_monitoring`.

## When To Use

Once at the start of each operating day, and after any deployment.

## Preconditions

You are authenticated and can open the monitoring and diagnostics pages.

## Procedure

1. Open `/admin/pdf-import-monitoring` and review open **critical/high** alerts.
2. Review failed / stale imports on `/admin/pdf-import-diagnostics`.
3. Review imports flagged **manual review required**.
4. Review **blocked** operator states.
5. Review export parity **failed / manual_required**.
6. Review golden regression degradation.
7. Review retention candidates (only if assigned).
8. Confirm release gate status if a deployment is planned.
9. Capture daily notes in the shift handoff template.

## Expected Result

A clear picture of production health and a handoff note. No writes are required to complete the checklist.

## Stop Conditions

Stop and escalate immediately on: a critical safety alert, a **public artifact bucket** alert (`artifact_bucket_public_exposure`), a **manual-only completed** signal, **sidecar unavailable** (`sidecar_unavailable`), or repeated import failures (`import_failure_detected`).

## Escalation Path

pdf_admin for operational decisions; developer_admin for sidecar/storage/technical failures.

## Evidence To Capture

Alert IDs, import IDs, counts, and timestamps. No client content screenshots.

## What Not To Do

Do not resolve alerts you have not investigated, do not persist decisions without evidence, do not bypass quality gates.

## Related Pages / Routes

`/admin/pdf-import-monitoring`, `/admin/pdf-import-diagnostics`.

## Related Alerts

`import_failure_detected`, `sidecar_unavailable`, `artifact_bucket_public_exposure`, `operator_control_blocked_bypass`.
