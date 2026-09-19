# PDF Import Release Gate Failure SOP

## Purpose

Respond to a failing PDF import release gate before deployment.

## Audience

developer_admin, pdf_admin.

## Required Role / Capability

`developer_admin` (runs CI/build); `pdf_admin` to accept documented warnings.

## When To Use

When the release gate reports `fail` or `pass_with_warnings` before a deploy.

## Preconditions

You can run the release gate locally or in CI.

## Procedure

1. Run `npm run pdf-import:release-gate`.
2. Read the report at `reports/pdf-import-release-gate/release-gate-report.md`.
3. Handle by failure type: test failure, build failure, private-artifact failure, unsafe-pattern failure, missing-module failure, live-check warning.
4. Fix critical blockers and re-run the gate.

## Expected Result

The gate reaches `pass` or a documented `pass_with_warnings` before deploy.

## Stop Conditions

Any critical failure (build, tests, private artifacts, unsafe pattern, missing permission/monitoring/golden modules) — do not deploy.

## Escalation Path

developer_admin owns fixes; pdf_admin approves warning releases with a note.

## Evidence To Capture

The release gate report JSON/MD, decision, and score.

## What Not To Do

Do not deploy on a critical failure, do not weaken the gate to force a pass, do not commit the generated report.

## Related Pages / Routes

None (CLI + CI).

## Related Alerts

`release_gate_blocked`, `release_readiness_regressed`.
