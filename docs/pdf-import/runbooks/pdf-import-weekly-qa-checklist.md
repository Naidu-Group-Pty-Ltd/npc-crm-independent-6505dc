# PDF Import Weekly QA Checklist

## Purpose

Provide the weekly QA/health review for PDF import production.

## Audience

pdf_qa_operator, pdf_admin.

## Required Role / Capability

`pdf_qa_operator` or above; `pdf_import.view_quality`.

## When To Use

Once per week, and before any broad rollout change.

## Preconditions

Daily checklists have been running; you can open the golden regression and retention pages.

## Procedure

1. Run a golden regression review (see Golden Regression Review SOP).
2. Review golden history / baseline trends.
3. Review monitoring event trends (recurring alerts).
4. Review metadata bloat (compact-metadata candidates).
5. Review retention candidates.
6. Review permission/role changes.
7. Review release gate warnings.
8. Update the risk register.
9. Update training gaps.
10. Escalate recurring issues.

## Expected Result

A weekly QA summary, an updated risk register, and any escalations logged.

## Stop Conditions

A repeated critical alert across the week, a degraded golden baseline that is not understood, or a persistent release gate failure.

## Escalation Path

pdf_admin; developer_admin for systemic technical regressions.

## Evidence To Capture

Trend counts, baseline comparison outcomes, retention candidate counts, and release gate scores.

## What Not To Do

Do not change golden thresholds, do not delete retention candidates, do not bypass quality gates.

## Related Pages / Routes

`/admin/pdf-golden-regression`, `/admin/pdf-import-retention`.
