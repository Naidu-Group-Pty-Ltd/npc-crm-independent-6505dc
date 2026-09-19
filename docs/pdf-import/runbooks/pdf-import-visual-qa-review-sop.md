# PDF Import Visual QA Review SOP

## Purpose

Interpret Visual QA results and decide accept / rerun / reject / escalate.

## Audience

pdf_qa_operator, pdf_admin.

## Required Role / Capability

`pdf_qa_operator` or above; `pdf_import.view_quality`.

## When To Use

When reviewing an import’s visual quality before a decision.

## Preconditions

Visual QA has run and produced a score + evidence references.

## Procedure

1. Open `/admin/template-import-quality` (or the golden console).
2. Read the visual similarity score.
3. Inspect the source / generated / diff evidence in-app (never export client images).
4. Determine whether manual review is required.
5. Decide: accept, rerun Visual QA, reject, or escalate.

## Expected Result

A visual QA decision with captured evidence references. No template mutation.

## Stop Conditions

Score below the similarity floor with no clear cause; missing evidence; manual review required.

## Escalation Path

pdf_admin for decisions; developer_admin/frontend for rendering defects.

## Evidence To Capture

Score, manual-review flag, evidence reference IDs (not raw images).

## What Not To Do

Do not export or attach client rasters, do not accept a low score without a documented reason.

## Related Pages / Routes

`/admin/template-import-quality`, `/admin/pdf-golden-regression`.

## Related Alerts

`visual_qa_missing`, `visual_qa_low_similarity`.
