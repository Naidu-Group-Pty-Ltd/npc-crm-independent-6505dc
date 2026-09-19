/**
 * operatorPermissionTypes — Phase 11B.
 *
 * Deny-by-default role/capability model for PDF import production operations.
 * Frontend permission checks improve UX; backend enforcement (authentication,
 * import ownership, RLS, admin guards in the template-import-pdf Edge Function)
 * remains the security boundary. This model adds no runtime behaviour, calls no
 * AI, and mutates nothing.
 */
export const PDF_IMPORT_PERMISSION_POLICY_VERSION = 'pdf-import-permission-policy-v1';

export type PdfImportOperatorRole =
  | 'no_access'
  | 'pdf_viewer'
  | 'pdf_operator'
  | 'pdf_qa_operator'
  | 'pdf_admin'
  | 'developer_admin'
  | 'system_service';

export type PdfImportPermissionDecision =
  | 'allowed'
  | 'denied'
  | 'requires_confirmation'
  | 'manual_only'
  | 'blocked';

export type PdfImportPermissionSource =
  | 'jwt_app_metadata'
  | 'jwt_user_metadata'
  | 'profile'
  | 'user_roles'
  | 'admin_guard'
  | 'system_service'
  | 'fallback'
  | 'unknown';

export type PdfImportCapability =
  | 'pdf_import.view_console'
  | 'pdf_import.view_quality'
  | 'pdf_import.view_diagnostics'
  | 'pdf_import.view_engine_admin'
  | 'pdf_import.view_storage_artifacts_reference'
  | 'pdf_import.view_golden_history'
  | 'pdf_import.view_monitoring'
  | 'pdf_import.view_retention'
  | 'pdf_import.view_client_reports'

  | 'pdf_import.evaluate_only'
  | 'pdf_import.run_golden_regression_preview'
  | 'pdf_import.build_import_intelligence'
  | 'pdf_import.build_repair_patterns'
  | 'pdf_import.build_adaptive_policy'
  | 'pdf_import.build_self_healing_plan'
  | 'pdf_import.build_performance_audit'
  | 'pdf_import.build_operator_controls'

  | 'pdf_import.persist_import_intelligence'
  | 'pdf_import.persist_repair_patterns'
  | 'pdf_import.persist_adaptive_policy'
  | 'pdf_import.persist_self_healing_audit'
  | 'pdf_import.persist_performance_audit'
  | 'pdf_import.persist_operator_control_audit'
  | 'pdf_import.persist_export_parity'
  | 'pdf_import.persist_golden_summary'
  | 'pdf_import.persist_golden_history'
  | 'pdf_import.append_meta'

  | 'pdf_import.operator.mark_not_reviewed'
  | 'pdf_import.operator.mark_accepted'
  | 'pdf_import.operator.mark_accepted_with_warnings'
  | 'pdf_import.operator.mark_rejected'
  | 'pdf_import.operator.mark_needs_rerun'
  | 'pdf_import.operator.mark_manual_review_required'
  | 'pdf_import.operator.mark_blocked'
  | 'pdf_import.operator.add_note'

  | 'pdf_import.run_export_parity_automation'
  | 'pdf_import.run_self_healing_execute_safe'
  | 'pdf_import.manage_monitoring_alerts'
  | 'pdf_import.run_retention_scan'
  | 'pdf_import.manage_retention_candidates'
  | 'pdf_import.generate_client_report_preview'
  | 'pdf_import.save_client_report_draft'
  | 'pdf_import.approve_client_report'
  | 'pdf_import.export_client_report'

  | 'pdf_import.manual.rerun_visual_qa'
  | 'pdf_import.manual.rerun_repair'
  | 'pdf_import.manual.run_ai_reconciliation'
  | 'pdf_import.manual.apply_repair'
  | 'pdf_import.manual.apply_reconciliation'
  | 'pdf_import.manual.rerun_import'

  | 'pdf_import.developer.inspect_storage'
  | 'pdf_import.developer.inspect_jobs'
  | 'pdf_import.developer.inspect_logs'
  | 'pdf_import.developer.deploy_functions'
  | 'pdf_import.developer.view_hardening'

  | 'pdf_import.system.finalize_import'
  | 'pdf_import.system.worker_update_job'
  | 'pdf_import.system.sidecar_callback';

export interface PdfImportResolvedRole {
  role: PdfImportOperatorRole;
  source: PdfImportPermissionSource;
  rawRoles: string[];
  isAuthenticated: boolean;
  userId: string | null;
  reason: string;
}

export interface PdfImportPermissionCheck {
  capability: PdfImportCapability;
  decision: PdfImportPermissionDecision;
  allowed: boolean;
  role: PdfImportOperatorRole;
  reason: string;
  requiresConfirmation: boolean;
  manualOnly: boolean;
}

export interface PdfImportPermissionContext {
  userId?: string | null;
  isAuthenticated?: boolean;
  jwtClaims?: Record<string, unknown> | null;
  profile?: Record<string, unknown> | null;
  existingAdminGuard?: boolean | null;
  serviceContext?: boolean | null;
}

export interface PdfImportPermissionPolicy {
  version: typeof PDF_IMPORT_PERMISSION_POLICY_VERSION;
  roles: PdfImportOperatorRole[];
  capabilities: PdfImportCapability[];
  matrix: Record<PdfImportOperatorRole, PdfImportCapability[]>;
  generatedAt: string;
}
