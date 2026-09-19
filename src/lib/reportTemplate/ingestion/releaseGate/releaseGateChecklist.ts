/**
 * releaseGateChecklist — Phase 11D canonical release gate checks.
 *
 * The 63 canonical checks the PDF import release gate evaluates. This module is
 * pure data: each entry starts at `unknown` status with empty evidence; the CLI
 * / evaluator fills in the real status at run time. No I/O, no remediation
 * execution — remediation is descriptive text only.
 */
import {
  PDF_IMPORT_RELEASE_GATE_DOMAINS,
  type PdfImportReleaseGateCheck,
  type PdfImportReleaseGateDomain,
  type PdfImportReleaseGateSeverity,
} from './releaseGateTypes';

function c(
  id: string,
  domain: PdfImportReleaseGateDomain,
  severity: PdfImportReleaseGateSeverity,
  title: string,
  message: string,
  remediation: string,
): PdfImportReleaseGateCheck {
  return { id, domain, severity, status: 'unknown', title, message, evidence: [], remediation };
}

export const PDF_IMPORT_RELEASE_GATE_CHECKLIST: PdfImportReleaseGateCheck[] = [
  // ── SOURCE INTEGRITY ──
  c('required_phase10_modules_exist', 'source_integrity', 'critical',
    'Phase 10 modules exist', 'Phase 10 production-intelligence modules must be present.',
    'Restore the missing Phase 10 ingestion modules under src/lib/reportTemplate/ingestion.'),
  c('required_phase11_modules_exist', 'source_integrity', 'critical',
    'Phase 11 modules exist', 'Phase 11 permission/monitoring/rollout modules must be present.',
    'Restore the missing Phase 11 modules (operatorPermissions, monitoring, rolloutReadiness, releaseGate).'),
  c('required_admin_pages_exist', 'source_integrity', 'high',
    'Admin pages exist', 'Required PDF import admin pages must be present.',
    'Restore the missing admin pages under src/pages/admin.'),
  c('required_supabase_functions_exist', 'source_integrity', 'high',
    'Supabase functions exist', 'Required PDF import Edge Functions must be present.',
    'Restore the missing Edge Function directories under supabase/functions.'),
  c('required_migrations_exist', 'source_integrity', 'high',
    'Migrations exist', 'Required PDF import migrations must be present.',
    'Restore the missing migration files under supabase/migrations.'),

  // ── DOCUMENTATION ──
  c('phase10_lock_docs_exist', 'documentation', 'medium',
    'Phase 10 lock docs exist', 'Phase 10 production-intelligence lock docs must be present.',
    'Restore docs/pdf-import/phase-10h-production-intelligence-lock.md and related Phase 10 docs.'),
  c('phase11a_rollout_docs_exist', 'documentation', 'medium',
    'Phase 11A rollout docs exist', 'Phase 11A rollout readiness docs must be present.',
    'Restore docs/pdf-import/phase-11a-production-rollout-readiness-review.md.'),
  c('phase11b_permission_docs_exist', 'documentation', 'medium',
    'Phase 11B permission docs exist', 'Phase 11B permission docs must be present.',
    'Restore docs/pdf-import/phase-11b-role-based-operator-permissions.md.'),
  c('phase11c_monitoring_docs_exist', 'documentation', 'medium',
    'Phase 11C monitoring docs exist', 'Phase 11C monitoring docs must be present.',
    'Restore docs/pdf-import/phase-11c-monitoring-alerting-activation.md.'),
  c('phase11d_release_gate_docs_exist', 'documentation', 'medium',
    'Phase 11D release gate docs exist', 'Phase 11D release gate docs must be present.',
    'Restore docs/pdf-import/phase-11d-release-gate-ci-integration.md and related Phase 11D docs.'),

  // ── SCHEMAS ──
  c('phase10_json_schemas_exist', 'schemas', 'medium',
    'Phase 10 JSON schemas exist', 'Phase 10 JSON schemas must be present.',
    'Restore the Phase 10 schemas under docs/pdf-import/*.schema.json.'),
  c('monitoring_event_schema_exists', 'schemas', 'medium',
    'Monitoring event schema exists', 'The monitoring event JSON schema must be present.',
    'Restore docs/pdf-import/pdf-import-monitoring-event.schema.json.'),
  c('permission_policy_schema_exists', 'schemas', 'medium',
    'Permission policy schema exists', 'The permission policy JSON schema must be present.',
    'Restore docs/pdf-import/pdf-import-permission-policy.schema.json.'),
  c('release_gate_report_schema_exists', 'schemas', 'medium',
    'Release gate report schema exists', 'The release gate report JSON schema must be present.',
    'Restore docs/pdf-import/pdf-import-release-gate-report.schema.json.'),

  // ── SQL ──
  c('phase10_final_sql_exists', 'sql', 'medium',
    'Phase 10 final SQL exists', 'Phase 10 final validation SQL must be present.',
    'Restore scripts/regression/pdf-import-phase-10-final-check.sql.'),
  c('phase11a_sql_exists', 'sql', 'medium',
    'Phase 11A SQL exists', 'Phase 11A readiness SQL must be present.',
    'Restore scripts/regression/pdf-import-phase-11a-rollout-readiness-check.sql.'),
  c('phase11b_sql_exists', 'sql', 'medium',
    'Phase 11B SQL exists', 'Phase 11B permissions SQL must be present.',
    'Restore scripts/regression/pdf-import-phase-11b-permissions-check.sql.'),
  c('phase11c_sql_exists', 'sql', 'medium',
    'Phase 11C SQL exists', 'Phase 11C monitoring SQL must be present.',
    'Restore scripts/regression/pdf-import-phase-11c-monitoring-check.sql.'),
  c('phase11d_sql_exists', 'sql', 'medium',
    'Phase 11D SQL exists', 'Phase 11D release gate SQL must be present.',
    'Restore scripts/regression/pdf-import-phase-11d-release-gate-check.sql.'),

  // ── TESTS ──
  c('release_gate_tests_pass', 'tests', 'critical',
    'Release gate tests pass', 'Phase 11D release gate tests must pass.',
    'Run the Phase 11D release gate specs and fix failures.'),
  c('phase11c_tests_pass', 'tests', 'high',
    'Phase 11C tests pass', 'Phase 11C monitoring tests must pass.',
    'Run the Phase 11C monitoring specs and fix failures.'),
  c('phase11b_tests_pass', 'tests', 'high',
    'Phase 11B tests pass', 'Phase 11B permission tests must pass.',
    'Run the Phase 11B permission specs and fix failures.'),
  c('phase11a_tests_pass', 'tests', 'high',
    'Phase 11A tests pass', 'Phase 11A rollout readiness tests must pass.',
    'Run the Phase 11A rollout readiness specs and fix failures.'),
  c('phase10_tests_pass', 'tests', 'high',
    'Phase 10 tests pass', 'Phase 10 intelligence tests must pass.',
    'Run the Phase 10 specs and fix failures.'),
  c('phase9_foundation_tests_pass', 'tests', 'high',
    'Phase 9 foundation tests pass', 'Phase 9 golden/export-parity foundation tests must pass.',
    'Run the Phase 9 foundation specs and fix failures.'),

  // ── BUILD ──
  c('npm_build_passes', 'build', 'critical',
    'npm build passes', 'The production build (which type-checks the app) must pass.',
    'Run npm run build and fix compilation/type errors.'),

  // ── PRIVATE ARTIFACTS ──
  c('no_private_pdfs_staged', 'private_artifacts', 'critical',
    'No private PDFs staged', 'No .pdf files may be staged for commit.',
    'Unstage the PDF files and add them to .gitignore.'),
  c('no_generated_images_staged', 'private_artifacts', 'critical',
    'No generated images staged', 'No raster images (png/jpg/webp) may be staged.',
    'Unstage the image files; they are private render artifacts.'),
  c('no_logs_or_env_staged', 'private_artifacts', 'critical',
    'No logs or .env staged', 'No .log or .env files may be staged.',
    'Unstage the log/env files and add them to .gitignore.'),
  c('no_signed_url_dumps_staged', 'private_artifacts', 'critical',
    'No signed URL dumps staged', 'No signed-URL / Cloud Run / Supabase log dumps may be staged.',
    'Unstage the signed-url or log dump files.'),

  // ── SECURITY / SAFETY ──
  c('no_automatic_ai_execution_pattern', 'security_safety', 'critical',
    'No automatic AI execution', 'No source path may auto-invoke AI reconciliation.',
    'Keep AI reconciliation manual-only; remove any automatic invocation.'),
  c('no_automatic_template_mutation_pattern', 'security_safety', 'critical',
    'No automatic template mutation', 'No self-healing / operator control path may auto-mutate templates.',
    'Keep template mutation manual-only; remove automatic applyTemplateImportPlan/applyRepairedTemplate calls.'),
  c('no_manual_only_action_auto_completion_pattern', 'security_safety', 'critical',
    'No manual-only auto-completion', 'Manual-only actions must not be auto-completed.',
    'Ensure manual-only controls remain manual; remove auto-completion.'),
  c('no_quality_gate_bypass_pattern', 'security_safety', 'critical',
    'No quality gate bypass', 'No source path may bypass quality gates.',
    'Remove quality-gate bypass logic; gates must be evaluated honestly.'),
  c('no_service_role_secret_frontend_pattern', 'security_safety', 'critical',
    'No service-role secret in frontend', 'Service-role secrets must not appear in frontend source.',
    'Remove SUPABASE_SERVICE_ROLE_KEY / service_role usage from src frontend code.'),

  // ── PERMISSIONS ──
  c('permission_matrix_exists', 'permissions', 'critical',
    'Permission matrix exists', 'The deny-by-default permission matrix must be present.',
    'Restore src/lib/reportTemplate/ingestion/operatorPermissions/operatorPermissionMatrix.ts.'),
  c('unknown_role_denied', 'permissions', 'high',
    'Unknown role denied', 'Unknown/no_access roles must hold zero capabilities.',
    'Ensure the matrix denies unknown roles by default.'),
  c('system_service_not_frontend', 'permissions', 'high',
    'system_service not frontend-resolvable', 'The system_service role must not be resolvable from the frontend.',
    'Keep system_service backend-only in the role resolver.'),
  c('operator_controls_permission_gated', 'permissions', 'high',
    'Operator controls permission-gated', 'Operator controls must be gated by permission.',
    'Ensure operator control rules/executor apply the permission overlay.'),

  // ── MONITORING ──
  c('monitoring_table_migration_exists', 'monitoring', 'high',
    'Monitoring migration exists', 'The monitoring events table migration must be present.',
    'Restore the pdf_import_monitoring_events migration under supabase/migrations.'),
  c('monitoring_edge_function_exists', 'monitoring', 'high',
    'Monitoring Edge Function exists', 'The pdf-import-monitoring Edge Function must be present.',
    'Restore supabase/functions/pdf-import-monitoring/index.ts.'),
  c('monitoring_rules_exist', 'monitoring', 'high',
    'Monitoring rules exist', 'The monitoring rule catalog must be present.',
    'Restore src/lib/reportTemplate/ingestion/monitoring/monitoringEventRules.ts.'),
  c('monitoring_permissions_exist', 'monitoring', 'medium',
    'Monitoring permissions exist', 'Monitoring capabilities must exist in the permission matrix.',
    'Ensure pdf_import.view_monitoring and pdf_import.manage_monitoring_alerts exist.'),

  // ── GOLDEN REGRESSION ──
  c('golden_corpus_registry_exists', 'golden_regression', 'high',
    'Golden corpus registry exists', 'The golden corpus registry must be present.',
    'Restore src/lib/reportTemplate/ingestion/goldenCorpus/goldenCorpusRegistry.ts.'),
  c('golden_orchestrator_exists', 'golden_regression', 'high',
    'Golden orchestrator exists', 'The golden corpus orchestrator must be present.',
    'Restore src/lib/reportTemplate/ingestion/goldenCorpus/goldenCorpusOrchestrator.ts.'),
  c('golden_history_support_exists', 'golden_regression', 'high',
    'Golden history support exists', 'Golden run history persistence must be present.',
    'Restore src/lib/reportTemplate/ingestion/goldenCorpus/goldenRunHistoryPersistence.ts.'),
  c('baseline_comparison_exists', 'golden_regression', 'high',
    'Baseline comparison exists', 'Golden baseline comparison must be present.',
    'Restore src/lib/reportTemplate/ingestion/goldenCorpus/goldenRunBaselineComparison.ts.'),

  // ── EXPORT PARITY ──
  c('export_parity_runner_exists', 'export_parity', 'high',
    'Export parity runner exists', 'The export parity runner must be present.',
    'Restore src/lib/reportTemplate/ingestion/exportParity/exportParityRunner.ts.'),
  c('manual_export_parity_supported', 'export_parity', 'medium',
    'Manual export parity supported', 'Manual export parity must be supported.',
    'Restore src/lib/reportTemplate/ingestion/exportParity/manualExportParity.ts.'),

  // ── PHASE 10 INTELLIGENCE ──
  c('import_intelligence_exists', 'phase10_intelligence', 'medium',
    'Import intelligence exists', 'Import intelligence profile builder must be present.',
    'Restore src/lib/reportTemplate/ingestion/importIntelligence/importIntelligenceProfileBuilder.ts.'),
  c('repair_patterns_exist', 'phase10_intelligence', 'medium',
    'Repair patterns exist', 'The repair pattern library must be present.',
    'Restore src/lib/reportTemplate/ingestion/repairPatterns/repairPatternLibrary.ts.'),
  c('adaptive_reconciliation_exists', 'phase10_intelligence', 'medium',
    'Adaptive reconciliation exists', 'The adaptive reconciliation policy must be present.',
    'Restore src/lib/reportTemplate/ingestion/reconciliation/adaptiveReconciliationPolicy.ts.'),
  c('self_healing_exists', 'phase10_intelligence', 'medium',
    'Self healing exists', 'The self-healing planner must be present.',
    'Restore src/lib/reportTemplate/ingestion/selfHealing/selfHealingPlanner.ts.'),
  c('performance_cost_exists', 'phase10_intelligence', 'medium',
    'Performance/cost exists', 'The performance/cost optimizer must be present.',
    'Restore src/lib/reportTemplate/ingestion/performance/pdfImportPerformanceOptimizer.ts.'),
  c('operator_controls_exist', 'phase10_intelligence', 'high',
    'Operator controls exist', 'Operator control rules must be present.',
    'Restore src/lib/reportTemplate/ingestion/operatorControls/operatorControlRules.ts.'),
  c('phase10_lock_exists', 'phase10_intelligence', 'high',
    'Phase 10 lock exists', 'The Phase 10 production-intelligence lock must be present.',
    'Restore src/lib/reportTemplate/ingestion/phase10Lock/phase10ProductionLockEvaluator.ts.'),

  // ── ROLLOUT READINESS ──
  c('rollout_readiness_review_exists', 'rollout_readiness', 'medium',
    'Rollout readiness review exists', 'The Phase 11A rollout readiness evaluator + review must be present.',
    'Restore src/lib/reportTemplate/ingestion/rolloutReadiness and the Phase 11A review doc.'),

  // ── CI CONFIGURATION ──
  c('release_gate_script_exists', 'ci_configuration', 'high',
    'Release gate script exists', 'The release gate CLI script must be present.',
    'Restore scripts/regression/pdf-import-release-gate.mjs.'),
  c('release_gate_config_exists', 'ci_configuration', 'high',
    'Release gate config exists', 'The release gate config JSON must be present.',
    'Restore scripts/regression/pdf-import-release-gate.config.json.'),
  c('github_actions_workflow_exists_or_documented', 'ci_configuration', 'medium',
    'GitHub Actions workflow exists or documented', 'A release gate workflow must exist or be documented.',
    'Add .github/workflows/pdf-import-release-gate.yml or document the CI setup.'),
  c('release_gate_report_generated', 'ci_configuration', 'medium',
    'Release gate report generated', 'The gate must be able to generate a report.',
    'Ensure the CLI writes JSON + markdown reports to the reports directory.'),

  // ── LIVE ENVIRONMENT (OPTIONAL) ──
  c('optional_supabase_sql_check_configured', 'live_environment', 'info',
    'Optional Supabase SQL check configured', 'Optional live Supabase SQL check (opt-in).',
    'Enable live checks and configure Supabase credentials to run this check.'),
  c('optional_monitoring_function_check_configured', 'live_environment', 'info',
    'Optional monitoring function check configured', 'Optional live monitoring function check (opt-in).',
    'Enable live checks and configure Supabase credentials to run this check.'),
  c('optional_cloud_run_sidecar_check_configured', 'live_environment', 'info',
    'Optional Cloud Run sidecar check configured', 'Optional live Cloud Run sidecar health check (opt-in).',
    'Enable live checks and configure PDF_PARSE_SERVICE_URL to run this check.'),
];

export function listPdfImportReleaseGateChecks(): PdfImportReleaseGateCheck[] {
  return PDF_IMPORT_RELEASE_GATE_CHECKLIST.map((check) => ({
    ...check,
    evidence: [...check.evidence],
  }));
}

const CHECKS_BY_ID: Record<string, PdfImportReleaseGateCheck> = Object.fromEntries(
  PDF_IMPORT_RELEASE_GATE_CHECKLIST.map((check) => [check.id, check]),
);

export function getPdfImportReleaseGateCheckById(id: string): PdfImportReleaseGateCheck | null {
  const found = CHECKS_BY_ID[id];
  return found ? { ...found, evidence: [...found.evidence] } : null;
}

/** Integrity: >=63 checks, unique ids, all domains represented, safety present, remediation present. */
export function assertPdfImportReleaseGateChecklistIntegrity(): {
  ok: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const list = PDF_IMPORT_RELEASE_GATE_CHECKLIST;

  if (list.length < 63) errors.push(`checklist_too_small:${list.length}`);

  const seen = new Set<string>();
  for (const check of list) {
    if (seen.has(check.id)) errors.push(`duplicate_check_id:${check.id}`);
    seen.add(check.id);
    if (!check.remediation || !check.remediation.trim()) errors.push(`missing_remediation:${check.id}`);
    if (!check.title || !check.title.trim()) errors.push(`missing_title:${check.id}`);
  }

  const domainsPresent = new Set(list.map((c2) => c2.domain));
  for (const d of PDF_IMPORT_RELEASE_GATE_DOMAINS) {
    if (!domainsPresent.has(d)) errors.push(`domain_not_represented:${d}`);
  }

  const criticalSafety = [
    'no_automatic_ai_execution_pattern',
    'no_automatic_template_mutation_pattern',
    'no_manual_only_action_auto_completion_pattern',
    'no_quality_gate_bypass_pattern',
    'no_service_role_secret_frontend_pattern',
  ];
  for (const id of criticalSafety) {
    if (!seen.has(id)) errors.push(`missing_critical_safety_check:${id}`);
  }

  // Optional live checks should be info-severity (non-blocking by default).
  for (const check of list) {
    if (check.domain === 'live_environment' && check.severity !== 'info' && check.severity !== 'low') {
      warnings.push(`live_check_not_low_severity:${check.id}`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
