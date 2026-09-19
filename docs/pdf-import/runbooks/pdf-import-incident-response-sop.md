# PDF Import Incident Response SOP

## Purpose

Contain and coordinate a PDF import production incident.

## Audience

pdf_admin, developer_admin.

## Required Role / Capability

`pdf_admin` for coordination; `developer_admin` for technical containment.

## When To Use

On a critical alert, exposure risk, sidecar outage, or repeated failures.

## Preconditions

A monitoring alert or operator report indicates a production incident.

## Procedure

1. Classify severity (critical / high).
2. Contain: if there is exposure risk (`artifact_bucket_public_exposure`, `private_artifact_exposure_risk`) make the bucket private and stop the affected flow.
3. If critical, pause broad PDF import usage / rollout.
4. Collect evidence (alert IDs, import IDs, timestamps).
5. Notify the owner; ensure a monitoring alert is open/acknowledged.
6. Link to the Rollback + Escalation SOP if a rollback is needed.
7. Write post-incident notes.

## Expected Result

The incident is contained, evidence is captured, and the right people are notified.

## Stop Conditions

Ongoing data exposure, sidecar down with no ETA, or repeated critical failures — escalate and consider rollback.

## Escalation Path

developer_admin → security/business owner for exposure or client-impacting incidents.

## Evidence To Capture

Timeline, alert IDs, affected import IDs, containment actions. No client PII/screenshots.

## What Not To Do

Do not delete evidence, do not communicate internal details to clients, do not bypass permissions to "fix" faster.

## Related Pages / Routes

`/admin/pdf-import-monitoring`, `/admin/pdf-import-diagnostics`.

## Related Alerts

`sidecar_unavailable`, `private_artifact_exposure_risk`, `raw_content_persistence_risk`.
