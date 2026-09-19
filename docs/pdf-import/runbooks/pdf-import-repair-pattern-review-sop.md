# PDF Import Repair Pattern Review SOP

## Purpose

Interpret deterministic repair patterns and decide manual repair / escalate / block.

## Audience

pdf_qa_operator, pdf_admin, developer_admin.

## Required Role / Capability

`pdf_qa_operator` or above; manual repair needs `pdf_import.manual.rerun_repair`.

## When To Use

When an import shows repair patterns or a missing repair audit.

## Preconditions

A repair pattern analysis or repair audit exists for the import.

## Procedure

1. Open the import quality view.
2. Read the repair pattern severity.
3. Handle by pattern: `page_margin_drift`, `table_grid_drift`, `image_crop_mismatch`, `ocr_text_fragments`, `missing_major_visual_element`, `manual_review_only`.
4. Apply repair **only manually** where permitted; otherwise mark for review.

## Expected Result

A repair decision (manual apply / review / escalate). No automatic repair application.

## Stop Conditions

`missing_major_visual_element` or `manual_review_only` pattern; repair marked blocked; repeated repair failures (`repair_failure_rate_high`).

## Escalation Path

developer_admin for renderer/repair defects; pdf_admin for decisions.

## Evidence To Capture

Import ID, pattern codes, severity, and the decision.

## What Not To Do

Do not auto-apply repairs, do not apply a blocked repair, do not mutate the template outside the sanctioned flow.

## Related Pages / Routes

`/admin/template-import-quality`.

## Related Alerts

`repair_audit_missing`, `repair_failure_rate_high`.
