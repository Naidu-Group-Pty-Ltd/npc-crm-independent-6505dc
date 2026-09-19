/**
 * productionRolloutLockChecklist — Phase 11H.
 *
 * The canonical Final Production Rollout Lock checklist. Each check defaults to
 * `unknown` and carries the remediation needed to turn it green, plus the set of
 * rollout modes it is required for. The checklist is data only; the evaluator
 * resolves the final decision and rollout mode from statuses.
 */
import type {
  PdfImportProductionRolloutLockCheck,
  PdfImportProductionRolloutLockDomain,
  PdfImportProductionRolloutLockSeverity,
  PdfImportProductionRolloutMode,
} from './productionRolloutLockTypes';

/**
 * Default rollout-mode requirement by severity. Critical checks are required for
 * any real rollout mode; high checks for team/broad rollout; the rest for broad
 * production. A per-check override may narrow or widen this.
 */
function defaultRequiredFor(
  severity: PdfImportProductionRolloutLockSeverity,
): PdfImportProductionRolloutMode[] {
  switch (severity) {
    case 'critical':
      return ['admin_limited', 'controlled_team_rollout', 'broad_production'];
    case 'high':
      return ['controlled_team_rollout', 'broad_production'];
    default:
      return ['broad_production'];
  }
}

function C(
  id: string,
  domain: PdfImportProductionRolloutLockDomain,
  severity: PdfImportProductionRolloutLockSeverity,
  title: string,
  message: string,
  remediation: string,
  requiredFor?: PdfImportProductionRolloutMode[],
): PdfImportProductionRolloutLockCheck {
  return {
    id,
    domain,
    severity,
    status: 'unknown',
    title,
    message,
    evidence: [],
    remediation,
    requiredFor: requiredFor ?? defaultRequiredFor(severity),
  };
}

export const PDF_IMPORT_PRODUCTION_ROLLOUT_LOCK_CHECKLIST: PdfImportProductionRolloutLockCheck[] = [
  // ---- Phase 10 lock ----
  C('PROD-LOCK-P10-001', 'phase10_lock', 'critical', 'Phase 10 lock documentation exists',
    'The Phase 10 production intelligence lock documentation is present.',
    'Ensure docs/pdf-import/phase-10h-production-intelligence-lock.md exists.'),
  C('PROD-LOCK-P10-002', 'phase10_lock', 'critical', 'Phase 10 final SQL exists',
    'The Phase 10 final validation SQL is present.',
    'Ensure scripts/regression/pdf-import-phase-10-final-check.sql exists.'),
  C('PROD-LOCK-P10-003', 'phase10_lock', 'high', 'Phase 10 lock evaluator exists',
    'The Phase 10 production lock checklist/evaluator modules are present.',
    'Ensure src/lib/reportTemplate/ingestion/phase10Lock exists and is tested.'),
  C('PROD-LOCK-P10-004', 'phase10_lock', 'critical', 'Phase 10 decision is locked or locked_with_warnings',
    'The Phase 10 production lock decision is locked or locked_with_warnings.',
    'Resolve Phase 10 critical blockers until the Phase 10 lock is at least locked_with_warnings.'),

  // ---- Rollout readiness ----
  C('PROD-LOCK-11A-001', 'rollout_readiness', 'high', 'Phase 11A rollout readiness review exists',
    'The Phase 11A production rollout readiness review is present.',
    'Ensure docs/pdf-import/phase-11a-production-rollout-readiness-review.md exists.'),
  C('PROD-LOCK-11A-002', 'rollout_readiness', 'critical', 'Initial rollout scope exists',
    'The Phase 11A initial rollout scope template is present.',
    'Ensure docs/pdf-import/phase-11a-initial-rollout-scope.template.md exists.'),
  C('PROD-LOCK-11A-003', 'rollout_readiness', 'critical', 'Rollout decision documented',
    'The recommended rollout readiness decision is documented.',
    'Record the rollout readiness decision in the Phase 11A review/report.'),
  C('PROD-LOCK-11A-004', 'rollout_readiness', 'critical', 'Rollout mode documented',
    'The recommended initial rollout mode is documented.',
    'Record the recommended rollout mode in the Phase 11A rollout scope.'),

  // ---- Permissions ----
  C('PROD-LOCK-PERM-001', 'permissions', 'critical', 'Permission matrix exists',
    'The role-based operator permission matrix is present.',
    'Ensure docs/pdf-import/phase-11b-permission-matrix.md and the operatorPermissions modules exist.'),
  C('PROD-LOCK-PERM-002', 'permissions', 'critical', 'Unknown/no_access users denied writes',
    'Unknown and no_access users cannot perform sensitive writes.',
    'Confirm the permission matrix denies sensitive capabilities to unknown/no_access roles.'),
  C('PROD-LOCK-PERM-003', 'permissions', 'critical', 'System service role not available in frontend',
    'The service-role key is never referenced from the frontend bundle.',
    'Confirm no SUPABASE_SERVICE_ROLE_KEY/service_role usage in client source.'),
  C('PROD-LOCK-PERM-004', 'permissions', 'critical', 'Admin write actions permission-gated',
    'Admin write actions are permission-gated end to end.',
    'Confirm operator controls and console persist actions check capabilities.'),
  C('PROD-LOCK-PERM-005', 'permissions', 'critical', 'Manual actions remain manual-only',
    'Manual-only actions are never executed automatically.',
    'Confirm manual-only controls resolve to manual_required, never auto-completed.'),
  C('PROD-LOCK-PERM-006', 'permissions', 'high', 'Client report permissions exist',
    'Client report capabilities exist in the permission matrix.',
    'Confirm view/generate/approve/export client-report capabilities are present.'),
  C('PROD-LOCK-PERM-007', 'permissions', 'high', 'Monitoring permissions exist',
    'Monitoring capabilities exist in the permission matrix.',
    'Confirm view_monitoring and manage_monitoring_alerts capabilities are present.'),
  C('PROD-LOCK-PERM-008', 'permissions', 'high', 'Retention permissions exist',
    'Retention capabilities exist in the permission matrix.',
    'Confirm view_retention/run_retention_scan/manage_retention_candidates capabilities are present.'),

  // ---- Monitoring + alerting ----
  C('PROD-LOCK-MON-001', 'monitoring_alerting', 'high', 'Monitoring docs exist',
    'The Phase 11C monitoring + alerting documentation is present.',
    'Ensure docs/pdf-import/phase-11c-monitoring-alerting-activation.md exists.'),
  C('PROD-LOCK-MON-002', 'monitoring_alerting', 'critical', 'Monitoring events table exists',
    'The public.pdf_import_monitoring_events table exists.',
    'Confirm public.pdf_import_monitoring_events exists in the database.'),
  C('PROD-LOCK-MON-003', 'monitoring_alerting', 'critical', 'Monitoring Edge Function exists',
    'The pdf-import-monitoring Edge Function is deployed.',
    'Confirm the pdf-import-monitoring function exists and is ACTIVE.'),
  C('PROD-LOCK-MON-004', 'monitoring_alerting', 'high', 'Monitoring admin page exists',
    'The /admin/pdf-import-monitoring page is present.',
    'Ensure src/pages/admin/PdfImportMonitoring.tsx and its route exist.'),
  C('PROD-LOCK-MON-005', 'monitoring_alerting', 'critical', 'Critical alert rules exist',
    'Critical monitoring alert rules exist in the rule catalog.',
    'Confirm the monitoring rule catalog includes critical safety rules.'),
  C('PROD-LOCK-MON-006', 'monitoring_alerting', 'high', 'Alert lifecycle supports acknowledge/resolve',
    'Alerts support acknowledge/resolve/suppress/false-positive lifecycle.',
    'Confirm the monitoring page and function support the alert lifecycle.'),
  C('PROD-LOCK-MON-007', 'monitoring_alerting', 'critical', 'No active critical alerts before rollout',
    'No open/acknowledged critical monitoring alerts remain before rollout.',
    'Resolve or suppress active critical alerts before locking the rollout.'),

  // ---- Release gate ----
  C('PROD-LOCK-REL-001', 'release_gate', 'high', 'Release gate docs exist',
    'The Phase 11D release gate / CI documentation is present.',
    'Ensure docs/pdf-import/phase-11d-release-gate-ci-integration.md exists.'),
  C('PROD-LOCK-REL-002', 'release_gate', 'critical', 'Release gate CLI exists',
    'The release gate CLI is present.',
    'Ensure scripts/regression/pdf-import-release-gate.mjs exists.'),
  C('PROD-LOCK-REL-003', 'release_gate', 'high', 'Release gate config exists',
    'The release gate configuration is present.',
    'Ensure scripts/regression/pdf-import-release-gate.config.json exists.'),
  C('PROD-LOCK-REL-004', 'release_gate', 'critical', 'Release gate tests pass',
    'The release gate unit tests pass.',
    'Run the releaseGate test suites and ensure they pass.'),
  C('PROD-LOCK-REL-005', 'release_gate', 'critical', 'Release gate does not require production secrets by default',
    'The default (static) release gate needs no production secrets.',
    'Confirm the static release gate runs without production secrets.'),
  C('PROD-LOCK-REL-006', 'release_gate', 'critical', 'Release gate passes or pass_with_warnings',
    'The static release gate returns pass or pass_with_warnings.',
    'Run the release gate and resolve any FAIL findings.'),

  // ---- Retention ----
  C('PROD-LOCK-RET-001', 'retention', 'high', 'Retention docs exist',
    'The Phase 11E retention + cleanup policy documentation is present.',
    'Ensure docs/pdf-import/phase-11e-artifact-retention-cleanup-policy.md exists.'),
  C('PROD-LOCK-RET-002', 'retention', 'critical', 'Retention events table exists',
    'The public.pdf_import_retention_events table exists.',
    'Confirm public.pdf_import_retention_events exists in the database.'),
  C('PROD-LOCK-RET-003', 'retention', 'critical', 'Retention Edge Function exists',
    'The pdf-import-retention Edge Function is deployed.',
    'Confirm the pdf-import-retention function exists and is ACTIVE.'),
  C('PROD-LOCK-RET-004', 'retention', 'high', 'Retention admin page exists',
    'The /admin/pdf-import-retention page is present.',
    'Ensure src/pages/admin/PdfImportRetention.tsx and its route exist.'),
  C('PROD-LOCK-RET-005', 'retention', 'critical', 'Retention scan is dry-run only',
    'The retention scan is dry-run only and deletes nothing.',
    'Confirm the retention scan never deletes files or rows.'),
  C('PROD-LOCK-RET-006', 'retention', 'critical', 'Retention function has no physical delete operation',
    'The retention function performs no physical delete/remove operation.',
    'Confirm the retention function contains no storage.remove/delete-from operation.'),

  // ---- Runbooks ----
  C('PROD-LOCK-RUNBOOK-001', 'runbooks', 'high', 'Runbook README exists',
    'The Phase 11F runbook README/index is present.',
    'Ensure docs/pdf-import/runbooks/README.md exists.'),
  C('PROD-LOCK-RUNBOOK-002', 'runbooks', 'high', 'Operator quick start exists',
    'The operator quick start runbook is present.',
    'Ensure the operator quick start runbook exists under docs/pdf-import/runbooks/.'),
  C('PROD-LOCK-RUNBOOK-003', 'runbooks', 'high', 'Daily operations checklist exists',
    'The daily operations checklist runbook is present.',
    'Ensure the daily operations checklist exists under docs/pdf-import/runbooks/.'),
  C('PROD-LOCK-RUNBOOK-004', 'runbooks', 'critical', 'Monitoring alert response SOP exists',
    'The monitoring alert response SOP is present.',
    'Ensure the monitoring alert response SOP exists under docs/pdf-import/runbooks/.'),
  C('PROD-LOCK-RUNBOOK-005', 'runbooks', 'critical', 'Incident response SOP exists',
    'The incident response SOP is present.',
    'Ensure the incident response SOP exists under docs/pdf-import/runbooks/.'),
  C('PROD-LOCK-RUNBOOK-006', 'runbooks', 'critical', 'Rollback escalation SOP exists',
    'The rollback / escalation SOP is present.',
    'Ensure the rollback escalation SOP exists under docs/pdf-import/runbooks/.'),
  C('PROD-LOCK-RUNBOOK-007', 'runbooks', 'critical', 'Client communication boundaries exist',
    'The client communication boundaries SOP is present.',
    'Ensure the client communication runbook exists under docs/pdf-import/runbooks/.'),
  C('PROD-LOCK-RUNBOOK-008', 'runbooks', 'high', 'Runbook registry/evaluator exists',
    'The runbook registry/evaluator modules are present.',
    'Ensure src/lib/reportTemplate/ingestion/runbooks exists and is tested.'),

  // ---- Client reporting ----
  C('PROD-LOCK-CLIENT-001', 'client_reporting', 'high', 'Client-safe reporting docs exist',
    'The Phase 11G client-safe reporting documentation is present.',
    'Ensure docs/pdf-import/phase-11g-client-safe-reporting-audit-export.md exists.'),
  C('PROD-LOCK-CLIENT-002', 'client_reporting', 'critical', 'Client report policy exists',
    'The client-safe report policy is present.',
    'Ensure docs/pdf-import/phase-11g-client-safe-report-policy.md exists.'),
  C('PROD-LOCK-CLIENT-003', 'client_reporting', 'critical', 'Client reports table exists',
    'The public.pdf_import_client_reports table exists.',
    'Confirm public.pdf_import_client_reports exists in the database.'),
  C('PROD-LOCK-CLIENT-004', 'client_reporting', 'critical', 'Client report Edge Function exists',
    'The pdf-import-client-report Edge Function is deployed.',
    'Confirm the pdf-import-client-report function exists and is ACTIVE.'),
  C('PROD-LOCK-CLIENT-005', 'client_reporting', 'critical', 'Client report sanitizer exists',
    'The redaction-first client report sanitizer is present.',
    'Ensure the clientReports sanitizer module exists and is tested.'),
  C('PROD-LOCK-CLIENT-006', 'client_reporting', 'critical', 'Reports require approval before export',
    'Client reports require approval before export.',
    'Confirm only approved reports may be marked exported.'),
  C('PROD-LOCK-CLIENT-007', 'client_reporting', 'critical', 'Unsafe content is redacted/blocked',
    'Unsafe content is redacted, and surviving unsafe content forces blocked.',
    'Confirm the sanitizer re-scans and blocks reports with surviving unsafe content.'),

  // ---- Security / privacy ----
  C('PROD-LOCK-SEC-001', 'security_privacy', 'critical', 'No public template import artifact bucket',
    'The template-import-artifacts storage bucket is private.',
    'Confirm the template-import-artifacts bucket is not public.'),
  C('PROD-LOCK-SEC-002', 'security_privacy', 'critical', 'No service role secret exposed in frontend',
    'No service-role secret is exposed in the frontend.',
    'Confirm no service-role key is bundled or referenced in client source.'),
  C('PROD-LOCK-SEC-003', 'security_privacy', 'critical', 'No signed URLs stored in client reports',
    'No signed URLs are stored in client report payloads.',
    'Confirm the sanitizer strips signed URLs from report payloads.'),
  C('PROD-LOCK-SEC-004', 'security_privacy', 'critical', 'No raw PDF/OCR text in client reports',
    'No raw PDF/OCR text is stored in client report payloads.',
    'Confirm reports contain only sanitized summaries, never raw extracted text.'),
  C('PROD-LOCK-SEC-005', 'security_privacy', 'critical', 'No private artifacts staged',
    'No private artifacts are staged for commit.',
    'Unstage any private PDFs/images/logs/.env files before committing.'),

  // ---- Database / storage ----
  C('PROD-LOCK-DB-001', 'database_storage', 'critical', 'pdf_import_golden_runs table exists',
    'The public.pdf_import_golden_runs table exists.',
    'Confirm public.pdf_import_golden_runs exists in the database.'),
  C('PROD-LOCK-DB-002', 'database_storage', 'critical', 'pdf_import_monitoring_events table exists',
    'The public.pdf_import_monitoring_events table exists.',
    'Confirm public.pdf_import_monitoring_events exists in the database.'),
  C('PROD-LOCK-DB-003', 'database_storage', 'critical', 'pdf_import_retention_events table exists',
    'The public.pdf_import_retention_events table exists.',
    'Confirm public.pdf_import_retention_events exists in the database.'),
  C('PROD-LOCK-DB-004', 'database_storage', 'critical', 'pdf_import_client_reports table exists',
    'The public.pdf_import_client_reports table exists.',
    'Confirm public.pdf_import_client_reports exists in the database.'),
  C('PROD-LOCK-DB-005', 'database_storage', 'critical', 'Required RLS/access model documented',
    'RLS/access model for the core tables is documented and enabled.',
    'Confirm RLS is enabled on the core tables and documented.'),

  // ---- UI routes ----
  C('PROD-LOCK-UI-001', 'ui_routes', 'critical', 'Golden Regression console route exists',
    'The /admin/pdf-golden-regression route exists.',
    'Ensure the Golden Regression console route is registered in src/App.tsx.'),
  C('PROD-LOCK-UI-002', 'ui_routes', 'high', 'Monitoring route exists',
    'The /admin/pdf-import-monitoring route exists.',
    'Ensure the monitoring route is registered in src/App.tsx.'),
  C('PROD-LOCK-UI-003', 'ui_routes', 'high', 'Retention route exists',
    'The /admin/pdf-import-retention route exists.',
    'Ensure the retention route is registered in src/App.tsx.'),
  C('PROD-LOCK-UI-004', 'ui_routes', 'high', 'Client reports route exists',
    'The /admin/pdf-import-client-reports route exists.',
    'Ensure the client reports route is registered in src/App.tsx.'),
  C('PROD-LOCK-UI-005', 'ui_routes', 'high', 'Diagnostics route still exists',
    'The /admin/pdf-import-diagnostics route still exists.',
    'Ensure the diagnostics route is still registered in src/App.tsx.'),

  // ---- Tests / build ----
  C('PROD-LOCK-TEST-001', 'tests_build', 'critical', 'Phase 11H tests pass',
    'The Phase 11H unit tests pass.',
    'Run the productionRolloutLock test suites and ensure they pass.'),
  C('PROD-LOCK-TEST-002', 'tests_build', 'critical', 'Phase 11A-G tests pass',
    'The Phase 11A–11G unit tests pass.',
    'Run the Phase 11A–11G test suites and ensure they pass.'),
  C('PROD-LOCK-TEST-003', 'tests_build', 'critical', 'Phase 10 tests pass',
    'The Phase 10 unit tests pass.',
    'Run the Phase 10 test suites and ensure they pass.'),
  C('PROD-LOCK-TEST-004', 'tests_build', 'critical', 'Phase 9 foundation tests pass',
    'The Phase 9 foundation unit tests pass.',
    'Run the Phase 9 foundation test suites and ensure they pass.'),
  C('PROD-LOCK-TEST-005', 'tests_build', 'critical', 'npm run build passes',
    'The production build passes.',
    'Run npm run build and ensure it succeeds.'),

  // ---- Production preview ----
  C('PROD-LOCK-PREVIEW-001', 'production_preview', 'critical', 'Production preview smoke test passes',
    'The production preview smoke test passes or is documented if not run.',
    'Run the Phase 11 final production preview smoke test and record the result.'),

  // ---- Private artifacts ----
  C('PROD-LOCK-ARTIFACT-001', 'private_artifacts', 'critical', 'No PDFs staged',
    'No private/source/generated PDFs are staged for commit.',
    'Unstage any .pdf files before committing.'),
  C('PROD-LOCK-ARTIFACT-002', 'private_artifacts', 'critical', 'No screenshots/images staged',
    'No screenshots, rasters, or generated images are staged for commit.',
    'Unstage any image/raster artifacts before committing.'),
  C('PROD-LOCK-ARTIFACT-003', 'private_artifacts', 'critical', 'No logs/env/signed URL dumps staged',
    'No logs, .env files, or signed URL dumps are staged for commit.',
    'Unstage any log/.env/signed URL dumps before committing.'),

  // ---- Deployment ----
  C('PROD-LOCK-DEPLOY-001', 'deployment', 'critical', 'Required migrations applied',
    'All required migrations are applied to the target project.',
    'Confirm the Phase 10/11 migrations are applied; Phase 11H adds none.'),
  C('PROD-LOCK-DEPLOY-002', 'deployment', 'critical', 'Required Edge Functions deployed',
    'All required Edge Functions are deployed and ACTIVE.',
    'Confirm monitoring/retention/client-report functions are ACTIVE; Phase 11H adds none.'),
  C('PROD-LOCK-DEPLOY-003', 'deployment', 'critical', 'Supabase config restored after deployment',
    'supabase/config.toml is unchanged (no residual deploy edits).',
    'Confirm git diff on supabase/config.toml is empty.'),
  C('PROD-LOCK-DEPLOY-004', 'deployment', 'high', 'Cloud Run sidecar status known',
    'The Cloud Run PDF parse sidecar status is known and documented.',
    'Confirm the Cloud Run sidecar status is recorded in the rollout report.'),

  // ---- Rollout scope ----
  C('PROD-LOCK-SCOPE-001', 'rollout_scope', 'critical', 'Approved rollout mode selected',
    'An approved rollout mode is selected and recorded.',
    'Record the approved rollout mode in the final rollout lock report.'),
  C('PROD-LOCK-SCOPE-002', 'rollout_scope', 'critical', 'Broad production blocked unless all conditions pass',
    'Broad production is blocked until all conditions pass.',
    'Keep rollout mode below broad_production until every condition is resolved.',
    ['broad_production']),
  C('PROD-LOCK-SCOPE-003', 'rollout_scope', 'critical', 'Allowed users/actions/categories documented',
    'The allowed users, actions, and categories for the rollout are documented.',
    'Document the allowed users/actions/categories in the rollout scope.'),
];

const DOMAINS = new Set<PdfImportProductionRolloutLockDomain>([
  'phase10_lock', 'rollout_readiness', 'permissions', 'monitoring_alerting', 'release_gate',
  'retention', 'runbooks', 'client_reporting', 'security_privacy', 'database_storage',
  'ui_routes', 'tests_build', 'production_preview', 'private_artifacts', 'deployment', 'rollout_scope',
]);
const SEVERITIES = new Set<PdfImportProductionRolloutLockSeverity>(['critical', 'high', 'medium', 'low', 'info']);
const MODES = new Set<PdfImportProductionRolloutMode>([
  'internal_dev_only', 'admin_limited', 'controlled_team_rollout', 'broad_production', 'blocked',
]);

/** Critical safety checks that must exist for the checklist to be valid. */
const REQUIRED_SAFETY_CHECK_IDS = [
  'PROD-LOCK-PERM-005', // manual-only actions remain manual-only
  'PROD-LOCK-CLIENT-006', // reports require approval before export
  'PROD-LOCK-CLIENT-007', // unsafe content redacted/blocked
  'PROD-LOCK-SEC-005', // no private artifacts staged
  'PROD-LOCK-RET-005', // retention dry-run only
  'PROD-LOCK-RET-006', // no physical delete operation
];

export function listPdfImportProductionRolloutLockChecks(): PdfImportProductionRolloutLockCheck[] {
  // Deep-copy so callers can set statuses without mutating the canonical list.
  return PDF_IMPORT_PRODUCTION_ROLLOUT_LOCK_CHECKLIST.map((c) => ({
    ...c,
    evidence: [...c.evidence],
    requiredFor: [...c.requiredFor],
  }));
}

export function getPdfImportProductionRolloutLockCheckById(
  id: string,
): PdfImportProductionRolloutLockCheck | null {
  const found = PDF_IMPORT_PRODUCTION_ROLLOUT_LOCK_CHECKLIST.find((c) => c.id === id);
  return found
    ? { ...found, evidence: [...found.evidence], requiredFor: [...found.requiredFor] }
    : null;
}

export function assertPdfImportProductionRolloutLockChecklistIntegrity(): {
  ok: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  const seen = new Set<string>();
  for (const c of PDF_IMPORT_PRODUCTION_ROLLOUT_LOCK_CHECKLIST) {
    if (seen.has(c.id)) errors.push(`duplicate_check_id:${c.id}`);
    seen.add(c.id);
    if (!c.domain || !DOMAINS.has(c.domain)) errors.push(`invalid_domain:${c.id}`);
    if (!SEVERITIES.has(c.severity)) errors.push(`invalid_severity:${c.id}`);
    if (!c.title) errors.push(`missing_title:${c.id}`);
    if (!c.message) errors.push(`missing_message:${c.id}`);
    if (!c.remediation) errors.push(`missing_remediation:${c.id}`);
    if (!Array.isArray(c.evidence)) errors.push(`invalid_evidence:${c.id}`);
    if (!Array.isArray(c.requiredFor) || c.requiredFor.length === 0) {
      errors.push(`missing_required_for:${c.id}`);
    } else if (c.requiredFor.some((m) => !MODES.has(m))) {
      errors.push(`invalid_required_for:${c.id}`);
    }
    // Every critical check must carry remediation.
    if (c.severity === 'critical' && !c.remediation) {
      errors.push(`critical_missing_remediation:${c.id}`);
    }
  }

  if (PDF_IMPORT_PRODUCTION_ROLLOUT_LOCK_CHECKLIST.length < 80) {
    errors.push(`insufficient_checks:${PDF_IMPORT_PRODUCTION_ROLLOUT_LOCK_CHECKLIST.length}`);
  }

  for (const id of REQUIRED_SAFETY_CHECK_IDS) {
    if (!seen.has(id)) errors.push(`missing_required_safety_check:${id}`);
  }

  // Must cover every domain at least once.
  for (const d of DOMAINS) {
    if (!PDF_IMPORT_PRODUCTION_ROLLOUT_LOCK_CHECKLIST.some((c) => c.domain === d)) {
      errors.push(`domain_not_covered:${d}`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
