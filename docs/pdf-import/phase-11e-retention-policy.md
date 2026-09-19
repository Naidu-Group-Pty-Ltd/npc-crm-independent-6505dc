# PDF Import Retention Policy

## Policy Summary

The PDF import retention policy governs how long artifacts, summaries,
diagnostics, monitoring events, and audit records should be retained. **Phase
11E is dry-run only** — it recommends candidates but never deletes, archives, or
compacts anything.

## Artifact Categories

`source_pdf`, `docling_artifact`, `page_manifest`, `diagnostics`,
`visual_quality`, `visual_repair`, `export_parity`, `golden_regression`,
`golden_history`, `monitoring_events`, `phase10_metadata`, `operator_audit`,
`storage_orphan`, `metadata_reference`, `unknown`.

## Retention Windows

| Domain | Default Retention | Cleanup Decision | Approval Required | Notes |
|---|---:|---|---|---|
| source_pdf | active lifetime | blocked | developer_admin (manual) | Never auto-delete |
| docling_artifact | 180 days | archive_candidate | pdf_admin | Retain if golden/regression linked |
| page_manifest | 180 days | archive_candidate | pdf_admin | Keep if audit/regression |
| diagnostics | 90 days / 180 failed | archive_candidate / retain | pdf_admin | Failed imports retained longer |
| visual_quality | 180 days | archive_candidate | pdf_admin | Keep if manual review |
| visual_repair | 180 days | review / archive | pdf_admin | Keep if repair applied/rejected |
| export_parity | 180 days | archive_candidate | pdf_admin | Keep if golden/release evidence |
| golden_history | indefinite summary | retain | developer_admin | Never auto-prune |
| monitoring_events | 180 days resolved | archive_candidate | pdf_admin | Active alerts retained |
| phase10_metadata | meta > 500KB | compact_metadata_later | pdf_admin | Never auto-compact |
| operator_audit | indefinite | retain | — | Never auto-delete |
| storage_orphan | 90 days | delete_candidate | developer_admin | Dry-run only in 11E |
| metadata_reference | missing object | repair_reference | pdf_admin | Investigate; do not delete |

## Do Not Auto-Delete

- source PDFs
- artifacts tied to accepted/rejected operator decisions
- artifacts tied to unresolved alerts
- artifacts tied to golden baselines
- artifacts tied to failed / manual-review imports
- artifacts referenced by active templates
- operator audit records
- any signed-URL logs (if present) — clean manually after review only

## Dry-Run Candidate Rules

1. **source_pdf_retained** — every import with a source is retained (blocked).
2. **diagnostics_old_success** — successful-import diagnostics older than 90d → archive candidate.
3. **diagnostics_failed_import_retained** — failed-import diagnostics retained.
4. **visual_quality_old_accepted** — accepted Visual QA older than 180d with no open alert/manual review → archive candidate.
5. **visual_quality_manual_review_retained** — manual-review Visual QA retained.
6. **visual_repair_old** — repair artifact older than 180d → review.
7. **visual_repair_applied_retained** — applied/rejected repair retained (audit).
8. **export_parity_old** — export parity older than 180d and not golden/release → archive candidate.
9. **export_parity_golden_retained** — golden/release export parity retained.
10. **golden_history_retained** — golden run history retained.
11. **monitoring_event_old_resolved** — resolved/suppressed/false-positive events older than 180d → archive candidate.
12. **phase10_metadata_large** — meta > 500KB → compact-metadata candidate (later phase).
13. **operator_audit_retained** — operator audit retained.
14. **storage_object_orphaned** — orphaned object older than 90d → delete candidate (developer approval; dry-run).
15. **metadata_reference_missing_object** — meta path references a missing object → repair reference.
16. **docling_artifact_old / page_manifest_old** — staged artifacts older than 180d → archive candidate.
17. **unknown_artifact_review** — unclassified artifact/object → review.

## Future Cleanup Execution

Physical cleanup should only be introduced after:

- explicit operator approval
- developer approval for destructive actions
- a backup/rollback strategy
- an audit trail
- monitoring-alert integration
- Phase 11H rollout approval
