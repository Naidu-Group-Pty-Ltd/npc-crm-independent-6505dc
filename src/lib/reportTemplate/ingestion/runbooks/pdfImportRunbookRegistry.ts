/**
 * pdfImportRunbookRegistry — Phase 11F canonical runbook registry.
 *
 * Pure metadata describing the production runbooks/SOPs. No I/O, no runtime
 * behaviour. The registry lets tests + the readiness evaluator confirm the
 * required operating procedures exist and cover the required domains.
 */
import {
  PDF_IMPORT_RUNBOOK_REGISTRY_VERSION,
  type PdfImportRunbookAudience,
  type PdfImportRunbookCriticality,
  type PdfImportRunbookDefinition,
  type PdfImportRunbookDomain,
  type PdfImportRunbookRegistry,
} from './pdfImportRunbookTypes';

const RUNBOOK_DIR = 'docs/pdf-import/runbooks/';

/** The standard SOP section headings every operational runbook must contain. */
export const PDF_IMPORT_RUNBOOK_REQUIRED_SECTIONS = [
  'Purpose',
  'Audience',
  'Required Role / Capability',
  'When To Use',
  'Preconditions',
  'Procedure',
  'Expected Result',
  'Stop Conditions',
  'Escalation Path',
  'Evidence To Capture',
  'What Not To Do',
  'Related Pages / Routes',
];

/** IDs of every runbook that must exist for Phase 11F completeness. */
export const PDF_IMPORT_REQUIRED_RUNBOOK_IDS = [
  'operator_quick_start',
  'daily_operations_checklist',
  'weekly_qa_checklist',
  'evaluate_only_sop',
  'evaluate_persist_sop',
  'visual_qa_review_sop',
  'repair_pattern_review_sop',
  'adaptive_reconciliation_sop',
  'self_healing_review_sop',
  'export_parity_review_sop',
  'golden_regression_review_sop',
  'monitoring_alert_response_sop',
  'permission_denied_sop',
  'retention_candidate_review_sop',
  'release_gate_failure_sop',
  'incident_response_sop',
  'rollback_escalation_sop',
  'client_communication_boundaries',
];

function rb(
  id: string,
  title: string,
  file: string,
  domain: PdfImportRunbookDomain,
  criticality: PdfImportRunbookCriticality,
  audience: PdfImportRunbookAudience[],
  requiredRoles: string[],
  relatedRoutes: string[],
  relatedAlerts: string[],
  relatedCapabilities: string[],
): PdfImportRunbookDefinition {
  return {
    id,
    title,
    path: `${RUNBOOK_DIR}${file}`,
    domain,
    audience,
    criticality,
    requiredRoles,
    relatedRoutes,
    relatedAlerts,
    relatedCapabilities,
    requiredSections: [...PDF_IMPORT_RUNBOOK_REQUIRED_SECTIONS],
  };
}

export const PDF_IMPORT_RUNBOOK_REGISTRY: PdfImportRunbookDefinition[] = [
  rb('operator_quick_start', 'PDF Import Operator Quick Start', 'pdf-import-operator-quick-start.md',
    'orientation', 'critical', ['pdf_operator', 'pdf_qa_operator', 'pdf_admin'],
    ['pdf_operator'], ['/admin/pdf-golden-regression', '/admin/pdf-import-monitoring'], [],
    ['pdf_import.view_console', 'pdf_import.evaluate_only']),
  rb('daily_operations_checklist', 'PDF Import Daily Operations Checklist', 'pdf-import-daily-operations-checklist.md',
    'daily_operations', 'high', ['pdf_operator', 'pdf_qa_operator', 'pdf_admin'],
    ['pdf_operator'], ['/admin/pdf-import-monitoring', '/admin/pdf-import-diagnostics'],
    ['import_failure_detected', 'sidecar_unavailable', 'artifact_bucket_public_exposure'],
    ['pdf_import.view_monitoring']),
  rb('weekly_qa_checklist', 'PDF Import Weekly QA Checklist', 'pdf-import-weekly-qa-checklist.md',
    'weekly_operations', 'high', ['pdf_qa_operator', 'pdf_admin'],
    ['pdf_qa_operator'], ['/admin/pdf-golden-regression', '/admin/pdf-import-retention'],
    ['golden_baseline_degraded', 'performance_budget_exceeded'], ['pdf_import.view_quality']),
  rb('evaluate_only_sop', 'PDF Import Evaluate Only SOP', 'pdf-import-evaluate-only-sop.md',
    'import_workflow', 'critical', ['pdf_operator', 'pdf_qa_operator', 'pdf_admin'],
    ['pdf_operator'], ['/admin/pdf-golden-regression'], [], ['pdf_import.evaluate_only']),
  rb('evaluate_persist_sop', 'PDF Import Evaluate + Persist SOP', 'pdf-import-evaluate-persist-sop.md',
    'import_workflow', 'critical', ['pdf_admin', 'developer_admin'],
    ['pdf_admin'], ['/admin/pdf-golden-regression'], [],
    ['pdf_import.persist_golden_summary', 'pdf_import.persist_golden_history', 'pdf_import.append_meta']),
  rb('visual_qa_review_sop', 'PDF Import Visual QA Review SOP', 'pdf-import-visual-qa-review-sop.md',
    'visual_quality', 'high', ['pdf_qa_operator', 'pdf_admin'],
    ['pdf_qa_operator'], ['/admin/template-import-quality', '/admin/pdf-golden-regression'],
    ['visual_qa_missing', 'visual_qa_low_similarity'], ['pdf_import.view_quality']),
  rb('repair_pattern_review_sop', 'PDF Import Repair Pattern Review SOP', 'pdf-import-repair-pattern-review-sop.md',
    'repair', 'high', ['pdf_qa_operator', 'pdf_admin', 'developer_admin'],
    ['pdf_qa_operator'], ['/admin/template-import-quality'],
    ['repair_audit_missing', 'repair_failure_rate_high'], ['pdf_import.manual.rerun_repair']),
  rb('adaptive_reconciliation_sop', 'PDF Import Adaptive Reconciliation SOP', 'pdf-import-adaptive-reconciliation-sop.md',
    'adaptive_reconciliation', 'high', ['pdf_qa_operator', 'pdf_admin', 'developer_admin'],
    ['pdf_admin'], ['/admin/template-import-quality'],
    ['reconciliation_manual_backlog', 'reconciliation_plan_unresolved'],
    ['pdf_import.manual.run_ai_reconciliation']),
  rb('self_healing_review_sop', 'PDF Import Self-Healing Review SOP', 'pdf-import-self-healing-review-sop.md',
    'self_healing', 'high', ['pdf_admin', 'developer_admin'],
    ['pdf_admin'], ['/admin/pdf-golden-regression'],
    ['operator_control_blocked_bypass'], ['pdf_import.run_self_healing_execute_safe']),
  rb('export_parity_review_sop', 'PDF Import Export Parity Review SOP', 'pdf-import-export-parity-review-sop.md',
    'export_parity', 'high', ['pdf_qa_operator', 'pdf_admin'],
    ['pdf_qa_operator'], ['/admin/pdf-golden-regression', '/admin/template-import-quality'],
    ['export_parity_missing', 'export_parity_failed', 'export_parity_manual_required'],
    ['pdf_import.run_export_parity_automation']),
  rb('golden_regression_review_sop', 'PDF Import Golden Regression Review SOP', 'pdf-import-golden-regression-review-sop.md',
    'golden_regression', 'high', ['pdf_qa_operator', 'pdf_admin'],
    ['pdf_qa_operator'], ['/admin/pdf-golden-regression'],
    ['golden_quality_gate_failed', 'golden_quality_gate_blocked', 'golden_baseline_degraded'],
    ['pdf_import.run_golden_regression_preview']),
  rb('monitoring_alert_response_sop', 'PDF Import Monitoring Alert Response SOP', 'pdf-import-monitoring-alert-response-sop.md',
    'monitoring_alerts', 'critical', ['pdf_admin', 'developer_admin'],
    ['pdf_admin'], ['/admin/pdf-import-monitoring'],
    ['import_failure_detected', 'sidecar_unavailable', 'artifact_bucket_public_exposure', 'golden_quality_gate_failed', 'operator_control_blocked_bypass'],
    ['pdf_import.view_monitoring', 'pdf_import.manage_monitoring_alerts']),
  rb('permission_denied_sop', 'PDF Import Permission Denied SOP', 'pdf-import-permission-denied-sop.md',
    'permissions', 'critical', ['pdf_viewer', 'pdf_operator', 'pdf_qa_operator', 'pdf_admin', 'developer_admin'],
    ['pdf_operator'], ['/admin/pdf-golden-regression'],
    ['unauthorized_write_attempt', 'permission_escalation_detected'], []),
  rb('retention_candidate_review_sop', 'PDF Import Retention Candidate Review SOP', 'pdf-import-retention-candidate-review-sop.md',
    'retention', 'high', ['pdf_admin', 'developer_admin'],
    ['pdf_admin'], ['/admin/pdf-import-retention'], [],
    ['pdf_import.view_retention', 'pdf_import.run_retention_scan', 'pdf_import.manage_retention_candidates']),
  rb('release_gate_failure_sop', 'PDF Import Release Gate Failure SOP', 'pdf-import-release-gate-failure-sop.md',
    'release_gate', 'high', ['developer_admin', 'pdf_admin'],
    ['developer_admin'], [], ['release_gate_blocked', 'release_readiness_regressed'], []),
  rb('incident_response_sop', 'PDF Import Incident Response SOP', 'pdf-import-incident-response-sop.md',
    'incident_response', 'critical', ['pdf_admin', 'developer_admin'],
    ['pdf_admin'], ['/admin/pdf-import-monitoring', '/admin/pdf-import-diagnostics'],
    ['sidecar_unavailable', 'private_artifact_exposure_risk', 'raw_content_persistence_risk'],
    ['pdf_import.view_monitoring']),
  rb('rollback_escalation_sop', 'PDF Import Rollback + Escalation SOP', 'pdf-import-rollback-escalation-sop.md',
    'rollback', 'critical', ['developer_admin'],
    ['developer_admin'], ['/admin/pdf-import-diagnostics'], ['backend_contract_drift'],
    ['pdf_import.developer.deploy_functions']),
  rb('client_communication_boundaries', 'PDF Import Client Communication Boundaries', 'pdf-import-client-communication-boundaries.md',
    'client_communication', 'critical', ['pdf_admin', 'business_stakeholder'],
    ['pdf_admin'], [], [], []),
];

const BY_ID: Record<string, PdfImportRunbookDefinition> = Object.fromEntries(
  PDF_IMPORT_RUNBOOK_REGISTRY.map((r) => [r.id, r]),
);

function cloneRunbook(r: PdfImportRunbookDefinition): PdfImportRunbookDefinition {
  return {
    ...r,
    audience: [...r.audience],
    requiredRoles: [...r.requiredRoles],
    relatedRoutes: [...r.relatedRoutes],
    relatedAlerts: [...r.relatedAlerts],
    relatedCapabilities: [...r.relatedCapabilities],
    requiredSections: [...r.requiredSections],
  };
}

export function listPdfImportRunbooks(): PdfImportRunbookDefinition[] {
  return PDF_IMPORT_RUNBOOK_REGISTRY.map(cloneRunbook);
}

export function getPdfImportRunbookById(id: string): PdfImportRunbookDefinition | null {
  const found = BY_ID[id];
  return found ? cloneRunbook(found) : null;
}

export function buildPdfImportRunbookRegistry(now: () => Date = () => new Date()): PdfImportRunbookRegistry {
  return {
    version: PDF_IMPORT_RUNBOOK_REGISTRY_VERSION,
    runbooks: listPdfImportRunbooks(),
    generatedAt: now().toISOString(),
  };
}

const PRIVATE_INDICATORS = [/\.pdf$/i, /\.png$/i, /signed[-_]url/i, /token=/i, /@/];

export function assertPdfImportRunbookRegistryIntegrity(): {
  ok: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const r of PDF_IMPORT_RUNBOOK_REGISTRY) {
    if (seen.has(r.id)) errors.push(`duplicate_runbook_id:${r.id}`);
    seen.add(r.id);
    if (!r.path.startsWith(RUNBOOK_DIR)) errors.push(`path_not_in_runbooks_dir:${r.id}`);
    for (const route of r.relatedRoutes) {
      if (route && !route.startsWith('/admin')) errors.push(`invalid_route:${r.id}:${route}`);
    }
    for (const indicator of PRIVATE_INDICATORS) {
      if (indicator.test(r.path) || indicator.test(r.title)) errors.push(`private_indicator_in_path_or_title:${r.id}`);
    }
    // Every critical runbook must require the safety-relevant sections.
    if (r.criticality === 'critical') {
      for (const section of ['Stop Conditions', 'Escalation Path', 'Evidence To Capture', 'What Not To Do']) {
        if (!r.requiredSections.includes(section)) errors.push(`critical_missing_required_section:${r.id}:${section}`);
      }
    }
  }

  // Every required runbook is present.
  for (const id of PDF_IMPORT_REQUIRED_RUNBOOK_IDS) {
    if (!seen.has(id)) errors.push(`missing_required_runbook:${id}`);
  }

  return { ok: errors.length === 0, errors, warnings };
}
