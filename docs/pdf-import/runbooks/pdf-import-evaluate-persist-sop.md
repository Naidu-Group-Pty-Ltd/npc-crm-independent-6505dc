# PDF Import Evaluate + Persist SOP

## Purpose

Persist import metadata and operator decisions safely (admin-only, confirmation required).

## Audience

pdf_admin, developer_admin.

## Required Role / Capability

`pdf_admin` or `developer_admin`. Persistence needs the relevant `pdf_import.persist_*` / `pdf_import.append_meta` capabilities.

## When To Use

After Evaluate Only, when the evidence supports persisting a summary/decision.

## Preconditions

Evaluate Only has been reviewed; quality gate is pass or documented; no unresolved manual review.

## Procedure

1. Re-run or review the Evaluate Only result.
2. Select only the metadata you intend to persist (golden summary, golden history, export parity, operator decision).
3. Confirm the persistence dialog.
4. Record the decision (accepted / accepted_with_warnings / rejected / needs_rerun).

## Expected Result

The selected metadata/decision is persisted. Manual-only and AI actions are NOT triggered.

## Stop Conditions

Quality gate fail/blocked without a documented note; adaptive reconciliation blocked; export parity missing when required; manual review required unresolved; any permission warning.

## Escalation Path

developer_admin for persistence errors; business owner for client-impacting rejections.

## Evidence To Capture

Import ID, persisted keys, quality gate status, operator decision, and reviewer name.

## What Not To Do

Do not persist over a failed gate without a note, do not persist AI reconciliation as automatic, do not mutate templates directly.

## Related Pages / Routes

`/admin/pdf-golden-regression`.
