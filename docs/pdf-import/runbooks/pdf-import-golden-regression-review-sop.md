# PDF Import Golden Regression Review SOP

## Purpose

Run and interpret golden regression and record the operator decision.

## Audience

pdf_qa_operator, pdf_admin.

## Required Role / Capability

`pdf_qa_operator` or above; preview needs `pdf_import.run_golden_regression_preview`; persistence is admin-only.

## When To Use

Weekly, and before broad rollout or release.

## Preconditions

Golden corpus registry is present; corpus items are available.

## Procedure

1. Open `/admin/pdf-golden-regression`.
2. Review corpus categories and run Evaluate Only per item.
3. Read the quality gate outcome (pass / warning / fail / blocked / not_evaluated).
4. Record the operator decision: `accepted`, `accepted_with_warnings`, `rejected`, `needs_rerun`, `manual_review_required`, `blocked`.
5. Handle baseline degradation; save golden run history (admin) for release evidence.

## Expected Result

A golden regression decision and (admin) persisted history/summary for release evidence.

## Stop Conditions

Quality gate `fail`/`blocked`; baseline degraded without cause; corpus coverage incomplete.

## Escalation Path

developer_admin for regressions; pdf_admin for decisions.

## Evidence To Capture

Corpus IDs, gate statuses, decisions, baseline comparison outcomes.

## What Not To Do

Do not change golden thresholds, do not accept a failed gate silently.

## Related Pages / Routes

`/admin/pdf-golden-regression`.

## Related Alerts

`golden_quality_gate_failed`, `golden_quality_gate_blocked`, `golden_baseline_degraded`.
