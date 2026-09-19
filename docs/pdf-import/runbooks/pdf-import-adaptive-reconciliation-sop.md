# PDF Import Adaptive Reconciliation SOP

## Purpose

Handle adaptive reconciliation policy decisions; keep AI reconciliation manual-only.

## Audience

pdf_qa_operator, pdf_admin, developer_admin.

## Required Role / Capability

`pdf_admin` for decisions; manual AI reconciliation needs `pdf_import.manual.run_ai_reconciliation`.

## When To Use

When an import has an adaptive reconciliation policy decision.

## Preconditions

An adaptive reconciliation policy exists for the import.

## Procedure

1. Read the policy decision: `not_needed`, `optional`, `recommended`, `manual_review`, or `blocked`.
2. For `blocked`: do not run AI. Escalate.
3. For `manual_review`: route to manual review.
4. If AI reconciliation is run **manually** and permitted: afterward rerun Visual QA, rerun export parity, and review operator controls.

## Expected Result

A reconciliation decision consistent with the policy. AI is never run automatically and never when blocked.

## Stop Conditions

Policy `blocked`; unresolved `manual_review`; missing evidence after a manual AI run.

## Escalation Path

developer_admin for policy anomalies; pdf_admin for decisions.

## Evidence To Capture

Import ID, policy decision, whether manual AI was run, and follow-up QA/parity results.

## What Not To Do

Never run AI when policy is blocked, never auto-run AI, never apply a reconciliation plan automatically.

## Related Pages / Routes

`/admin/template-import-quality`.

## Related Alerts

`reconciliation_manual_backlog`, `reconciliation_plan_unresolved`.
