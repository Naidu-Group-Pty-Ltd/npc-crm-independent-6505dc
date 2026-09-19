# PDF Import Permission Matrix

Generated from `src/lib/reportTemplate/ingestion/operatorPermissions/operatorPermissionMatrix.ts`
(the matrix module is the source of truth; this table mirrors it).

## Roles

| Role | Description | Rollout Use |
|---|---|---|
| no_access | No access or unresolved user | blocked |
| pdf_viewer | Read-only quality/status viewer | admin_limited / team rollout |
| pdf_operator | Evaluate-only operator | admin_limited / team rollout |
| pdf_qa_operator | QA operator with limited metadata decision rights | controlled team rollout |
| pdf_admin | Trusted production admin | admin_limited |
| developer_admin | Developer/admin with diagnostics authority | internal / admin |
| system_service | Trusted backend service context | backend only |

## Capability Groups

- **View** — console/quality/diagnostics/engine-admin/storage-reference/golden-history.
- **Evaluate** — evaluate_only + Phase 10 metadata builds.
- **Persist metadata** — persist_* + append_meta.
- **Operator decisions** — mark_* + add_note.
- **Controlled actions** — run_export_parity_automation, run_self_healing_execute_safe.
- **Manual workflow** — manual.* (AI/apply/rerun; always manual-only even when permitted).
- **Developer diagnostics** — developer.* + view_engine_admin.
- **System** — system.* (backend only; system_service only).

## Capability Matrix

| Capability | no_access | pdf_viewer | pdf_operator | pdf_qa_operator | pdf_admin | developer_admin | system_service |
|---|---|---|---|---|---|---|---|
| pdf_import.view_console | no | yes | yes | yes | yes | yes | no |
| pdf_import.view_quality | no | yes | yes | yes | yes | yes | no |
| pdf_import.view_golden_history | no | yes | yes | yes | yes | yes | no |
| pdf_import.evaluate_only | no | no | yes | yes | yes | yes | no |
| pdf_import.run_golden_regression_preview | no | no | yes | yes | yes | yes | no |
| pdf_import.build_import_intelligence | no | no | yes | yes | yes | yes | no |
| pdf_import.build_repair_patterns | no | no | yes | yes | yes | yes | no |
| pdf_import.build_adaptive_policy | no | no | yes | yes | yes | yes | no |
| pdf_import.build_self_healing_plan | no | no | yes | yes | yes | yes | no |
| pdf_import.build_performance_audit | no | no | yes | yes | yes | yes | no |
| pdf_import.build_operator_controls | no | no | yes | yes | yes | yes | no |
| pdf_import.operator.mark_needs_rerun | no | no | no | yes | yes | yes | no |
| pdf_import.operator.mark_manual_review_required | no | no | no | yes | yes | yes | no |
| pdf_import.operator.add_note | no | no | no | yes | yes | yes | no |
| pdf_import.run_export_parity_automation | no | no | no | yes | yes | yes | no |
| pdf_import.manual.rerun_visual_qa | no | no | no | yes | yes | yes | no |
| pdf_import.manual.rerun_repair | no | no | no | yes | yes | yes | no |
| pdf_import.persist_import_intelligence | no | no | no | no | yes | yes | no |
| pdf_import.persist_repair_patterns | no | no | no | no | yes | yes | no |
| pdf_import.persist_adaptive_policy | no | no | no | no | yes | yes | no |
| pdf_import.persist_self_healing_audit | no | no | no | no | yes | yes | no |
| pdf_import.persist_performance_audit | no | no | no | no | yes | yes | no |
| pdf_import.persist_operator_control_audit | no | no | no | no | yes | yes | no |
| pdf_import.persist_export_parity | no | no | no | no | yes | yes | no |
| pdf_import.persist_golden_summary | no | no | no | no | yes | yes | no |
| pdf_import.persist_golden_history | no | no | no | no | yes | yes | no |
| pdf_import.append_meta | no | no | no | no | yes | yes | no |
| pdf_import.operator.mark_not_reviewed | no | no | no | no | yes | yes | no |
| pdf_import.operator.mark_accepted | no | no | no | no | yes | yes | no |
| pdf_import.operator.mark_accepted_with_warnings | no | no | no | no | yes | yes | no |
| pdf_import.operator.mark_rejected | no | no | no | no | yes | yes | no |
| pdf_import.operator.mark_blocked | no | no | no | no | yes | yes | no |
| pdf_import.run_self_healing_execute_safe | no | no | no | no | yes | yes | no |
| pdf_import.manual.run_ai_reconciliation | no | no | no | no | yes | yes | no |
| pdf_import.manual.apply_repair | no | no | no | no | yes | yes | no |
| pdf_import.manual.apply_reconciliation | no | no | no | no | yes | yes | no |
| pdf_import.manual.rerun_import | no | no | no | no | yes | yes | no |
| pdf_import.view_diagnostics | no | no | no | no | yes | yes | no |
| pdf_import.view_engine_admin | no | no | no | no | no | yes | no |
| pdf_import.view_storage_artifacts_reference | no | no | no | no | no | yes | no |
| pdf_import.developer.inspect_storage | no | no | no | no | no | yes | no |
| pdf_import.developer.inspect_jobs | no | no | no | no | no | yes | no |
| pdf_import.developer.inspect_logs | no | no | no | no | no | yes | no |
| pdf_import.developer.deploy_functions | no | no | no | no | no | yes | no |
| pdf_import.developer.view_hardening | no | no | no | no | no | yes | no |
| pdf_import.system.finalize_import | no | no | no | no | no | no | yes |
| pdf_import.system.worker_update_job | no | no | no | no | no | no | yes |
| pdf_import.system.sidecar_callback | no | no | no | no | no | no | yes |


## Permission Principles

- Deny by default; unknown/unauthenticated roles get no capabilities.
- Backend writes require permission AND authentication AND import ownership (RLS + Edge Function).
- Manual workflow is still manual even when permitted — permission is not automation.
- `system_service` is never available in the frontend.
- Developer diagnostics are `developer_admin` only.
- Broad production requires Phase 11H approval.

## Initial Rollout Recommendation

Recommended: **admin_limited**.

- Allowed: developer_admin, pdf_admin.
- Optional: pdf_operator for Evaluate Only only.
- Blocked: client users, unknown users, broad non-admin access.
