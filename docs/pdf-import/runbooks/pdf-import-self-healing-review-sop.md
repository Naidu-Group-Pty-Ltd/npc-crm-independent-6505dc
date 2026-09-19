# PDF Import Self-Healing Review SOP

## Purpose

Review self-healing retry plans; execute only safe automatic actions with admin approval.

## Audience

pdf_admin, developer_admin.

## Required Role / Capability

`pdf_admin`; execute-safe needs `pdf_import.run_self_healing_execute_safe`.

## When To Use

When a self-healing retry audit/plan exists.

## Preconditions

A self-healing plan has been produced (dry-run first).

## Procedure

1. Review the plan in dry-run first.
2. Inspect each action’s safety level: `safe_automatic`, `operator_confirmed`, `manual_only`, `blocked`.
3. Execute **execute_safe** only for approved admin roles and only for safe/confirmed actions.
4. `manual_only` and `blocked` actions are NOT executed.
5. Mark manual review required where needed.

## Expected Result

Only safe actions run (if approved). Manual-only/blocked actions remain untouched.

## Stop Conditions

A `manual_only`/`blocked` action appears completed; a blocked control appears available (`operator_control_blocked_bypass`).

## Escalation Path

developer_admin for control/safety anomalies.

## Evidence To Capture

Import ID, action IDs, safety levels, and what was executed.

## What Not To Do

Do not execute manual-only or blocked actions, do not bypass safety levels, do not call AI.

## Related Pages / Routes

`/admin/pdf-golden-regression`.

## Related Alerts

`operator_control_blocked_bypass`.
