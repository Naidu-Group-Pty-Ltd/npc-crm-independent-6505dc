# PDF Import Rollback + Escalation SOP

## Purpose

Coordinate a safe rollback and escalation for PDF import components.

## Audience

developer_admin.

## Required Role / Capability

`developer_admin`; deployments need `pdf_import.developer.deploy_functions`.

## When To Use

When a release causes a production regression that cannot be fixed forward quickly.

## Preconditions

An incident is open and a rollback decision has been approved.

## Procedure

1. **Frontend rollback** — revert to the last known-good build/deploy (developer-only, manual).
2. **Supabase function rollback** — redeploy the previous function version (developer-only, manual).
3. **Migration rollback** — consider carefully; forward-fix is usually safer. Do not drop tables casually.
4. **Cloud Run sidecar rollback** — route to the previous revision (developer-only, manual).
5. **Data rollback** — limited; prefer additive corrections over destructive changes.
6. Capture evidence and confirm recovery via monitoring.

## Expected Result

The system returns to a known-good state with a documented rollback trail.

## Stop Conditions

A rollback would delete data or cause further exposure — stop and escalate to the business/security owner.

## Escalation Path

Business owner + security owner for data/exposure decisions.

## Evidence To Capture

What was rolled back, versions/revisions, timestamps, and verification results.

## What Not To Do

Do not run destructive commands without explicit developer-only approval, do not drop tables/rows to "reset", do not roll back without capturing evidence.

## Related Pages / Routes

`/admin/pdf-import-diagnostics`.

## Related Alerts

`backend_contract_drift`, `release_readiness_regressed`.
