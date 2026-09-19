# PDF Import Retention Candidate Review SOP

## Purpose

Review dry-run retention/cleanup candidates and set their review state.

## Audience

pdf_admin, developer_admin.

## Required Role / Capability

`pdf_admin`; needs `pdf_import.view_retention` / `run_retention_scan` / `manage_retention_candidates`.

## When To Use

Weekly, or when assigned retention review.

## Preconditions

A retention scan has produced candidates. **Phase 11E is dry-run only — nothing is deleted.**

## Procedure

1. Open `/admin/pdf-import-retention`.
2. Filter by decision: `retain`, `review`, `archive_candidate`, `delete_candidate`, `blocked`, `unknown`.
3. For each candidate confirm the review checklist (not active template, no open alert, not golden/regression/manual-review evidence, no legal hold).
4. Set: review / approve for future cleanup / reject / block / supersede.
5. Approving a `delete_candidate` (`requires_developer_approval`) needs a developer_admin.

## Expected Result

Candidate review state is updated. No files or rows are deleted (dry-run).

## Stop Conditions

A source PDF, operator audit, golden baseline, or active-template artifact appears as a delete candidate.

## Escalation Path

developer_admin for delete-candidate approvals and storage anomalies.

## Evidence To Capture

Retention event ID, decision, safety level, scope, and reviewer note.

## What Not To Do

Never delete anything, never approve delete of source PDFs/operator audits/golden baselines, never expose signed URLs.

## Related Pages / Routes

`/admin/pdf-import-retention`.

## What Must Never Be Deleted

Source PDFs, operator audit records, golden baselines, artifacts tied to failed/manual-review imports, artifacts referenced by active templates.
