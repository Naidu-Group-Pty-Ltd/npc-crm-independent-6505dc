# PDF Import Export Parity Review SOP

## Purpose

Interpret export parity results and decide whether an import is release-ready.

## Audience

pdf_qa_operator, pdf_admin.

## Required Role / Capability

`pdf_qa_operator` or above; automation needs `pdf_import.run_export_parity_automation`.

## When To Use

When export parity is required for a golden/release-candidate import.

## Preconditions

Export parity has run (automated or manual).

## Procedure

1. Open the golden console or import quality view.
2. Read the export parity status: `completed`, `partial`, `manual_required`, `failed`, or `not_ready`.
3. For `manual_required`: perform the manual export parity review and capture evidence.
4. Confirm the export-vs-source and editor-vs-source scores.

## Expected Result

An export parity decision with evidence. No template mutation.

## Stop Conditions

`failed`; `manual_required` unresolved; `not_ready` when release evidence is needed.

## Escalation Path

developer_admin/frontend for renderer parity defects; pdf_admin for decisions.

## Evidence To Capture

Import ID, parity status, mode, and scores.

## What Not To Do

Do not mark release-ready on a failed parity, do not bypass quality gates.

## Related Pages / Routes

`/admin/pdf-golden-regression`, `/admin/template-import-quality`.

## Related Alerts

`export_parity_missing`, `export_parity_failed`, `export_parity_manual_required`.
