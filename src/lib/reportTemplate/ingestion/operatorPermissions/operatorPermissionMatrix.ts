/**
 * operatorPermissionMatrix — Phase 11B.
 *
 * The canonical deny-by-default role→capability matrix. Roles escalate
 * cumulatively (viewer ⊂ operator ⊂ qa ⊂ admin ⊂ developer_admin);
 * system_service holds only backend system capabilities and no user/admin
 * capabilities. no_access holds nothing.
 */
import {
  PDF_IMPORT_PERMISSION_POLICY_VERSION,
  type PdfImportCapability,
  type PdfImportOperatorRole,
  type PdfImportPermissionPolicy,
} from './operatorPermissionTypes';

export const PDF_IMPORT_ROLES: PdfImportOperatorRole[] = [
  'no_access',
  'pdf_viewer',
  'pdf_operator',
  'pdf_qa_operator',
  'pdf_admin',
  'developer_admin',
  'system_service',
];

const VIEWER_CAPS: PdfImportCapability[] = [
  'pdf_import.view_console',
  'pdf_import.view_quality',
  'pdf_import.view_golden_history',
];

const OPERATOR_CAPS: PdfImportCapability[] = [
  'pdf_import.evaluate_only',
  'pdf_import.run_golden_regression_preview',
  'pdf_import.build_import_intelligence',
  'pdf_import.build_repair_patterns',
  'pdf_import.build_adaptive_policy',
  'pdf_import.build_self_healing_plan',
  'pdf_import.build_performance_audit',
  'pdf_import.build_operator_controls',
];

const QA_CAPS: PdfImportCapability[] = [
  'pdf_import.operator.mark_needs_rerun',
  'pdf_import.operator.mark_manual_review_required',
  'pdf_import.operator.add_note',
  'pdf_import.run_export_parity_automation',
  'pdf_import.manual.rerun_visual_qa',
  'pdf_import.manual.rerun_repair',
];

const ADMIN_CAPS: PdfImportCapability[] = [
  'pdf_import.persist_import_intelligence',
  'pdf_import.persist_repair_patterns',
  'pdf_import.persist_adaptive_policy',
  'pdf_import.persist_self_healing_audit',
  'pdf_import.persist_performance_audit',
  'pdf_import.persist_operator_control_audit',
  'pdf_import.persist_export_parity',
  'pdf_import.persist_golden_summary',
  'pdf_import.persist_golden_history',
  'pdf_import.append_meta',
  'pdf_import.operator.mark_not_reviewed',
  'pdf_import.operator.mark_accepted',
  'pdf_import.operator.mark_accepted_with_warnings',
  'pdf_import.operator.mark_rejected',
  'pdf_import.operator.mark_blocked',
  'pdf_import.run_self_healing_execute_safe',
  'pdf_import.manual.run_ai_reconciliation',
  'pdf_import.manual.apply_repair',
  'pdf_import.manual.apply_reconciliation',
  'pdf_import.manual.rerun_import',
  'pdf_import.view_diagnostics',
  'pdf_import.view_monitoring',
  'pdf_import.manage_monitoring_alerts',
  'pdf_import.view_retention',
  'pdf_import.run_retention_scan',
  'pdf_import.manage_retention_candidates',
  'pdf_import.view_client_reports',
  'pdf_import.generate_client_report_preview',
  'pdf_import.save_client_report_draft',
  'pdf_import.approve_client_report',
  'pdf_import.export_client_report',
];

const DEVELOPER_CAPS: PdfImportCapability[] = [
  'pdf_import.view_engine_admin',
  'pdf_import.view_storage_artifacts_reference',
  'pdf_import.developer.inspect_storage',
  'pdf_import.developer.inspect_jobs',
  'pdf_import.developer.inspect_logs',
  'pdf_import.developer.deploy_functions',
  'pdf_import.developer.view_hardening',
];

const SYSTEM_CAPS: PdfImportCapability[] = [
  'pdf_import.system.finalize_import',
  'pdf_import.system.worker_update_job',
  'pdf_import.system.sidecar_callback',
];

function uniq(caps: PdfImportCapability[]): PdfImportCapability[] {
  return Array.from(new Set(caps));
}

const viewer = uniq(VIEWER_CAPS);
const operator = uniq([...viewer, ...OPERATOR_CAPS]);
const qa = uniq([...operator, ...QA_CAPS]);
const admin = uniq([...qa, ...ADMIN_CAPS]);
const developer = uniq([...admin, ...DEVELOPER_CAPS]);

export const PDF_IMPORT_ROLE_CAPABILITY_MATRIX: Record<PdfImportOperatorRole, PdfImportCapability[]> = {
  no_access: [],
  pdf_viewer: viewer,
  pdf_operator: operator,
  pdf_qa_operator: qa,
  pdf_admin: admin,
  developer_admin: developer,
  system_service: uniq(SYSTEM_CAPS),
};

export const PDF_IMPORT_CAPABILITIES: PdfImportCapability[] = uniq([
  ...VIEWER_CAPS,
  ...OPERATOR_CAPS,
  ...QA_CAPS,
  ...ADMIN_CAPS,
  ...DEVELOPER_CAPS,
  ...SYSTEM_CAPS,
]);

const SYSTEM_CAP_SET = new Set<PdfImportCapability>(SYSTEM_CAPS);

export function getPdfImportCapabilitiesForRole(role: PdfImportOperatorRole): PdfImportCapability[] {
  return (PDF_IMPORT_ROLE_CAPABILITY_MATRIX[role] ?? []).slice();
}

export function roleHasPdfImportCapability(
  role: PdfImportOperatorRole,
  capability: PdfImportCapability,
): boolean {
  return (PDF_IMPORT_ROLE_CAPABILITY_MATRIX[role] ?? []).includes(capability);
}

export function buildPdfImportPermissionPolicy(
  now: () => Date = () => new Date(),
): PdfImportPermissionPolicy {
  return {
    version: PDF_IMPORT_PERMISSION_POLICY_VERSION,
    roles: PDF_IMPORT_ROLES.slice(),
    capabilities: PDF_IMPORT_CAPABILITIES.slice(),
    matrix: Object.fromEntries(
      PDF_IMPORT_ROLES.map((r) => [r, getPdfImportCapabilitiesForRole(r)]),
    ) as Record<PdfImportOperatorRole, PdfImportCapability[]>,
    generatedAt: now().toISOString(),
  };
}

export function assertPdfImportPermissionMatrixIntegrity(): {
  ok: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Every role present.
  for (const r of PDF_IMPORT_ROLES) {
    if (!(r in PDF_IMPORT_ROLE_CAPABILITY_MATRIX)) errors.push(`missing_role_in_matrix:${r}`);
  }

  // Every matrix capability is a known capability; no duplicates within a role.
  const known = new Set<PdfImportCapability>(PDF_IMPORT_CAPABILITIES);
  for (const r of PDF_IMPORT_ROLES) {
    const caps = PDF_IMPORT_ROLE_CAPABILITY_MATRIX[r] ?? [];
    if (new Set(caps).size !== caps.length) errors.push(`duplicate_capability_in_role:${r}`);
    for (const c of caps) if (!known.has(c)) errors.push(`unknown_capability:${r}:${c}`);
  }

  // no_access has zero capabilities.
  if ((PDF_IMPORT_ROLE_CAPABILITY_MATRIX.no_access ?? []).length !== 0) errors.push('no_access_has_capabilities');

  // System capabilities only assigned to system_service.
  for (const r of PDF_IMPORT_ROLES) {
    if (r === 'system_service') continue;
    for (const c of PDF_IMPORT_ROLE_CAPABILITY_MATRIX[r] ?? []) {
      if (SYSTEM_CAP_SET.has(c)) errors.push(`system_capability_leaked_to_role:${r}:${c}`);
    }
  }
  // system_service holds only system capabilities.
  for (const c of PDF_IMPORT_ROLE_CAPABILITY_MATRIX.system_service ?? []) {
    if (!SYSTEM_CAP_SET.has(c)) errors.push(`system_service_has_non_system_capability:${c}`);
  }

  // Specific expectations.
  if (!roleHasPdfImportCapability('developer_admin', 'pdf_import.view_diagnostics')) errors.push('developer_admin_missing_view_diagnostics');
  if (!roleHasPdfImportCapability('developer_admin', 'pdf_import.view_engine_admin')) errors.push('developer_admin_missing_view_engine_admin');
  if (!roleHasPdfImportCapability('pdf_admin', 'pdf_import.persist_operator_control_audit')) errors.push('pdf_admin_missing_persist_operator_control_audit');
  if (roleHasPdfImportCapability('pdf_operator', 'pdf_import.append_meta')) errors.push('pdf_operator_has_append_meta');
  if (roleHasPdfImportCapability('pdf_viewer', 'pdf_import.evaluate_only')) errors.push('pdf_viewer_has_evaluate_only');

  // Phase 11C — monitoring capabilities are admin/developer only.
  if (!roleHasPdfImportCapability('pdf_admin', 'pdf_import.view_monitoring')) errors.push('pdf_admin_missing_view_monitoring');
  if (!roleHasPdfImportCapability('pdf_admin', 'pdf_import.manage_monitoring_alerts')) errors.push('pdf_admin_missing_manage_monitoring_alerts');
  if (!roleHasPdfImportCapability('developer_admin', 'pdf_import.manage_monitoring_alerts')) errors.push('developer_admin_missing_manage_monitoring_alerts');
  if (roleHasPdfImportCapability('pdf_qa_operator', 'pdf_import.view_monitoring')) errors.push('pdf_qa_operator_has_view_monitoring');
  if (roleHasPdfImportCapability('pdf_operator', 'pdf_import.manage_monitoring_alerts')) errors.push('pdf_operator_has_manage_monitoring_alerts');

  // Phase 11E — retention capabilities are admin/developer only.
  if (!roleHasPdfImportCapability('pdf_admin', 'pdf_import.view_retention')) errors.push('pdf_admin_missing_view_retention');
  if (!roleHasPdfImportCapability('pdf_admin', 'pdf_import.run_retention_scan')) errors.push('pdf_admin_missing_run_retention_scan');
  if (!roleHasPdfImportCapability('pdf_admin', 'pdf_import.manage_retention_candidates')) errors.push('pdf_admin_missing_manage_retention_candidates');
  if (!roleHasPdfImportCapability('developer_admin', 'pdf_import.manage_retention_candidates')) errors.push('developer_admin_missing_manage_retention_candidates');
  if (roleHasPdfImportCapability('pdf_qa_operator', 'pdf_import.view_retention')) errors.push('pdf_qa_operator_has_view_retention');
  if (roleHasPdfImportCapability('pdf_operator', 'pdf_import.run_retention_scan')) errors.push('pdf_operator_has_run_retention_scan');

  // Phase 11G — client report capabilities are admin/developer only.
  if (!roleHasPdfImportCapability('pdf_admin', 'pdf_import.view_client_reports')) errors.push('pdf_admin_missing_view_client_reports');
  if (!roleHasPdfImportCapability('pdf_admin', 'pdf_import.approve_client_report')) errors.push('pdf_admin_missing_approve_client_report');
  if (!roleHasPdfImportCapability('pdf_admin', 'pdf_import.export_client_report')) errors.push('pdf_admin_missing_export_client_report');
  if (!roleHasPdfImportCapability('developer_admin', 'pdf_import.export_client_report')) errors.push('developer_admin_missing_export_client_report');
  if (roleHasPdfImportCapability('pdf_qa_operator', 'pdf_import.approve_client_report')) errors.push('pdf_qa_operator_has_approve_client_report');
  if (roleHasPdfImportCapability('pdf_operator', 'pdf_import.view_client_reports')) errors.push('pdf_operator_has_view_client_reports');

  return { ok: errors.length === 0, errors, warnings };
}
