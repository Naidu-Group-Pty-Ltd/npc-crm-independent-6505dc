# PDF Import Evaluate Only SOP

## Purpose

Run the Evaluate Only workflow safely — analysis with no writes, no AI, no template mutation.

## Audience

pdf_operator, pdf_qa_operator, pdf_admin.

## Required Role / Capability

`pdf_operator` or above; `pdf_import.evaluate_only`.

## When To Use

To assess an import or golden corpus item without persisting anything.

## Preconditions

You have a valid import ID or corpus ID and the Evaluate Only action is enabled for your role.

## Procedure

1. Open `/admin/pdf-golden-regression`.
2. Select the corpus item or enter the import ID.
3. Enable the intelligence options you want to preview.
4. **Keep persistence disabled.**
5. Run **Evaluate Only**.
6. Review the results (quality gate, visual QA, export parity, operator controls preview).

## Expected Result

Results are displayed. No metadata is written, no template is mutated, and no AI is called.

## Stop Conditions

Missing import ID; a blocked policy; a critical alert open; your role is unknown/denied; a build or result error.

## Escalation Path

pdf_admin for decisions; developer_admin for result/build errors.

## Evidence To Capture

Import/corpus ID, quality gate outcome, visual QA score, export parity status. No client screenshots.

## What Not To Do

Do not enable persistence, do not run AI reconciliation, do not accept/reject (that is Evaluate + Persist / admin only).

## Related Pages / Routes

`/admin/pdf-golden-regression`.
