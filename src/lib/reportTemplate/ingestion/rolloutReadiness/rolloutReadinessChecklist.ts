/**
 * rolloutReadinessChecklist — Phase 11A.
 *
 * The canonical production rollout readiness checklist. Each check defaults to
 * `unknown` and carries the rollout modes it is required for, a target phase for
 * follow-up work, and remediation. Data only; the evaluator resolves the rollout
 * decision and recommended mode from statuses.
 */
import type {
  PdfImportRolloutMode,
  PdfImportRolloutReadinessCheck,
  PdfImportRolloutReadinessDomain,
  PdfImportRolloutReadinessSeverity,
} from './rolloutReadinessTypes';

const AL: PdfImportRolloutMode = 'admin_limited';
const CTR: PdfImportRolloutMode = 'controlled_team_rollout';
const BP: PdfImportRolloutMode = 'broad_production';

function C(
  id: string,
  domain: PdfImportRolloutReadinessDomain,
  title: string,
  severity: PdfImportRolloutReadinessSeverity,
  requiredFor: PdfImportRolloutMode[],
  targetPhase: string,
  description: string,
  remediation: string,
): PdfImportRolloutReadinessCheck {
  return { id, domain, title, description, severity, status: 'unknown', evidence: [], requiredFor, remediation, targetPhase };
}

export const PDF_IMPORT_ROLLOUT_READINESS_CHECKLIST: PdfImportRolloutReadinessCheck[] = [
  // ---- Phase 10 lock ----
  C('ROLL-P10-001', 'phase10_lock', 'Phase 10 lock documentation exists', 'high', [AL, CTR, BP], '11A',
    'Phase 10H lock documentation is present.', 'Ensure the Phase 10H lock docs exist.'),
  C('ROLL-P10-002', 'phase10_lock', 'Phase 10 final SQL exists and runs', 'critical', [AL, CTR, BP], '11A',
    'The Phase 10 final SQL exists and runs read-only.', 'Ensure pdf-import-phase-10-final-check.sql exists and runs.'),
  C('ROLL-P10-003', 'phase10_lock', 'Phase 10 lock decision is locked or locked_with_warnings', 'critical', [AL, CTR, BP], '11A',
    'The recorded Phase 10 lock decision is locked or locked_with_warnings.', 'Record the Phase 10 lock decision in the lock report.'),
  C('ROLL-P10-004', 'phase10_lock', 'Phase 10 accepted warnings are documented', 'high', [AL, CTR, BP], '11A',
    'Phase 10 accepted warnings are documented.', 'Document accepted warnings in the completion checklist.'),

  // ---- Security / access ----
  C('ROLL-SEC-001', 'security_access', 'template-import-pdf write operations enforce access', 'critical', [AL, CTR, BP], '11A/11B',
    'Write operations on the import function enforce access control.', 'Confirm write operations require authenticated/authorized access.'),
  C('ROLL-SEC-002', 'security_access', 'append_meta is safe for production metadata writes', 'critical', [AL, CTR, BP], '11A',
    'append_meta writes only structured metadata safely.', 'Confirm append_meta cannot overwrite unrelated fields unsafely.'),
  C('ROLL-SEC-003', 'security_access', 'storage bucket for import artifacts is not public', 'critical', [AL, CTR, BP], '11A',
    'The template-import-artifacts bucket is private.', 'Confirm the artifact bucket is not public.'),
  C('ROLL-SEC-004', 'security_access', 'signed URLs are time-limited', 'high', [CTR, BP], '11A',
    'Signed URLs for artifacts are time-limited.', 'Confirm signed URLs use a bounded expiry.'),
  C('ROLL-SEC-005', 'security_access', 'admin routes are protected', 'critical', [AL, CTR, BP], '11A/11B',
    'Admin routes require authentication/authorization.', 'Confirm admin pages are behind a protected route.'),
  C('ROLL-SEC-006', 'security_access', 'no service-role secrets exposed to frontend', 'critical', [AL, CTR, BP], '11A',
    'No service-role secrets are exposed to the frontend.', 'Confirm the frontend uses only anon/publishable keys.'),
  C('ROLL-SEC-007', 'security_access', 'RLS/access model is documented', 'critical', [AL, CTR, BP], '11A',
    'The RLS/access model for core tables is documented.', 'Document RLS and confirm it is enabled.'),

  // ---- Deployment ----
  C('ROLL-DEPLOY-001', 'deployment', 'Supabase Edge Functions are deployed and reachable', 'critical', [AL, CTR, BP], '11A',
    'The import Edge Functions are deployed and reachable.', 'Confirm template-import-pdf and related functions are deployed.'),
  C('ROLL-DEPLOY-002', 'deployment', 'Cloud Run sidecar is deployed and reachable', 'critical', [AL, CTR, BP], '11A',
    'The Cloud Run PDF parse sidecar is deployed and reachable.', 'Confirm the Cloud Run service responds.'),
  C('ROLL-DEPLOY-003', 'deployment', 'Cloud Run sidecar engine version is observable', 'high', [CTR, BP], '11A',
    'The sidecar engine version is observable in job records.', 'Confirm engine_version is recorded on jobs.'),
  C('ROLL-DEPLOY-004', 'deployment', 'finalize worker is deployed and operational', 'critical', [AL, CTR, BP], '11A',
    'The finalize worker is deployed and operational.', 'Confirm the finalize worker processes jobs.'),
  C('ROLL-DEPLOY-005', 'deployment', 'environment variables are documented', 'high', [CTR, BP], '11A',
    'Required environment variables are documented.', 'Document the required env vars for each function.'),
  C('ROLL-DEPLOY-006', 'deployment', 'rollback process for Edge Functions is documented', 'critical', [CTR, BP], '11F',
    'A rollback process for Edge Functions is documented.', 'Document the Edge Function rollback procedure.'),
  C('ROLL-DEPLOY-007', 'deployment', 'rollback process for frontend deploy is documented', 'critical', [CTR, BP], '11F',
    'A rollback process for the frontend deploy is documented.', 'Document the frontend rollback procedure.'),

  // ---- Operator workflow ----
  C('ROLL-OP-001', 'operator_workflow', 'Golden Regression console loads', 'critical', [AL, CTR, BP], '11A',
    'The Golden Regression console loads without crashing.', 'Load /admin/pdf-golden-regression and confirm.'),
  C('ROLL-OP-002', 'operator_workflow', 'Evaluate Only is read-only', 'critical', [AL, CTR, BP], '11A',
    'Evaluate Only performs no writes.', 'Confirm Evaluate Only does not persist.'),
  C('ROLL-OP-003', 'operator_workflow', 'Evaluate + Persist requires confirmation', 'critical', [AL, CTR, BP], '11A',
    'Evaluate + Persist requires an explicit confirmation.', 'Confirm the persist flow shows a confirmation dialog.'),
  C('ROLL-OP-004', 'operator_workflow', 'operator controls are explicit and audited', 'critical', [AL, CTR, BP], '11A',
    'Operator controls are explicit and audited.', 'Confirm controls persist a production_operator_control_audit.'),
  C('ROLL-OP-005', 'operator_workflow', 'manual-only actions remain manual-only', 'critical', [AL, CTR, BP], '11A',
    'Manual-only actions are never auto-executed.', 'Confirm manual-only controls stay manual-only.'),
  C('ROLL-OP-006', 'operator_workflow', 'blocked actions cannot be executed automatically', 'critical', [AL, CTR, BP], '11A',
    'Blocked actions cannot be executed automatically.', 'Confirm blocked controls/actions never complete automatically.'),
  C('ROLL-OP-007', 'operator_workflow', 'operator notes/decisions persist safely', 'high', [AL, CTR, BP], '11A',
    'Operator notes and decisions persist safely via append_meta.', 'Confirm notes/decisions persist to metadata only.'),

  // ---- Permissions ----
  C('ROLL-PERM-001', 'permissions', 'role model for PDF import operators is defined', 'critical', [CTR, BP], '11B',
    'A role model for PDF import operators is defined.', 'Define operator roles in Phase 11B.'),
  C('ROLL-PERM-002', 'permissions', 'role model for admin-only diagnostics is defined', 'high', [CTR, BP], '11B',
    'A role model for admin-only diagnostics is defined.', 'Define admin-only diagnostics access in Phase 11B.'),
  C('ROLL-PERM-003', 'permissions', 'permission matrix for metadata writes is defined', 'critical', [CTR, BP], '11B',
    'A permission matrix for metadata writes is defined.', 'Define who may persist metadata in Phase 11B.'),
  C('ROLL-PERM-004', 'permissions', 'permission matrix for AI/manual actions is defined', 'critical', [CTR, BP], '11B',
    'A permission matrix for AI/manual actions is defined.', 'Define who may trigger AI/manual actions in Phase 11B.'),
  C('ROLL-PERM-005', 'permissions', 'non-admin client/user access is blocked or documented', 'critical', [AL, CTR, BP], '11B',
    'Non-admin client/user access is blocked or documented.', 'Confirm client/user access is blocked or documented.'),

  // ---- Monitoring / alerting ----
  C('ROLL-MON-001', 'monitoring_alerting', 'failed import monitoring is defined', 'high', [CTR, BP], '11C',
    'Monitoring for failed imports is defined.', 'Define failed-import monitoring in Phase 11C.'),
  C('ROLL-MON-002', 'monitoring_alerting', 'stuck finalization monitoring is defined', 'high', [CTR, BP], '11C',
    'Monitoring for stuck finalization is defined.', 'Define stuck-finalization monitoring in Phase 11C.'),
  C('ROLL-MON-003', 'monitoring_alerting', 'Cloud Run sidecar error monitoring is defined', 'high', [CTR, BP], '11C',
    'Monitoring for Cloud Run sidecar errors is defined.', 'Define sidecar error monitoring in Phase 11C.'),
  C('ROLL-MON-004', 'monitoring_alerting', 'export parity failure monitoring is defined', 'medium', [CTR, BP], '11C',
    'Monitoring for export parity failures is defined.', 'Define export parity monitoring in Phase 11C.'),
  C('ROLL-MON-005', 'monitoring_alerting', 'golden regression degradation monitoring is defined', 'high', [CTR, BP], '11C',
    'Monitoring for golden regression degradation is defined.', 'Define regression degradation monitoring in Phase 11C.'),
  C('ROLL-MON-006', 'monitoring_alerting', 'storage artifact missing monitoring is defined', 'high', [CTR, BP], '11C',
    'Monitoring for missing storage artifacts is defined.', 'Define storage-artifact monitoring in Phase 11C.'),
  C('ROLL-MON-007', 'monitoring_alerting', 'alert destinations/owners are defined', 'high', [CTR, BP], '11C',
    'Alert destinations and owners are defined.', 'Define alert routing/owners in Phase 11C.'),

  // ---- Release governance ----
  C('ROLL-REL-001', 'release_governance', 'manual golden regression release check exists', 'high', [AL, CTR, BP], '11D',
    'A manual golden regression release check exists.', 'Document a manual regression release check.'),
  C('ROLL-REL-002', 'release_governance', 'CI/release gate plan is documented', 'high', [CTR, BP], '11D',
    'A CI/release gate plan is documented.', 'Document the CI/release gate plan in Phase 11D.'),
  C('ROLL-REL-003', 'release_governance', 'release blocker criteria are documented', 'critical', [CTR, BP], '11D',
    'Release blocker criteria are documented.', 'Document release blocker criteria in Phase 11D.'),
  C('ROLL-REL-004', 'release_governance', 'golden corpus minimum coverage is documented', 'high', [CTR, BP], '11D',
    'Golden corpus minimum coverage is documented.', 'Document minimum golden corpus coverage.'),
  C('ROLL-REL-005', 'release_governance', 'production deploy checklist references PDF import checks', 'high', [CTR, BP], '11D',
    'The production deploy checklist references PDF import checks.', 'Add PDF import checks to the deploy checklist.'),

  // ---- Data privacy ----
  C('ROLL-PRIV-001', 'data_privacy', 'private PDFs are not committed', 'critical', [AL, CTR, BP], '11A',
    'No private/source/generated PDFs are committed.', 'Confirm no PDFs are committed.'),
  C('ROLL-PRIV-002', 'data_privacy', 'generated rasters/screenshots are not committed', 'critical', [AL, CTR, BP], '11A',
    'No generated rasters/screenshots are committed.', 'Confirm no image artifacts are committed.'),
  C('ROLL-PRIV-003', 'data_privacy', 'logs avoid raw PDF text and PII', 'critical', [AL, CTR, BP], '11A',
    'Logs avoid raw PDF/OCR text and PII.', 'Confirm logs never contain raw text/PII.'),
  C('ROLL-PRIV-004', 'data_privacy', 'signed URLs are not stored in docs/logs', 'critical', [AL, CTR, BP], '11A',
    'Signed URLs are not stored in docs/logs.', 'Confirm no signed URLs are committed.'),
  C('ROLL-PRIV-005', 'data_privacy', 'client-safe reporting boundaries are documented', 'high', [BP], '11G',
    'Client-safe reporting boundaries are documented.', 'Document client-safe reporting in Phase 11G.'),

  // ---- Support / runbooks ----
  C('ROLL-RUNBOOK-001', 'support_runbooks', 'import failure runbook exists or is planned', 'high', [CTR, BP], '11F',
    'An import failure runbook exists or is planned.', 'Author the import failure runbook in Phase 11F.'),
  C('ROLL-RUNBOOK-002', 'support_runbooks', 'export parity manual review runbook exists or is planned', 'high', [CTR, BP], '11F',
    'An export parity manual review runbook exists or is planned.', 'Author the export parity runbook in Phase 11F.'),
  C('ROLL-RUNBOOK-003', 'support_runbooks', 'adaptive reconciliation blocked runbook exists or is planned', 'high', [CTR, BP], '11F',
    'An adaptive reconciliation blocked runbook exists or is planned.', 'Author the adaptive reconciliation runbook in Phase 11F.'),
  C('ROLL-RUNBOOK-004', 'support_runbooks', 'self-healing/manual-only action runbook exists or is planned', 'high', [CTR, BP], '11F',
    'A self-healing/manual-only action runbook exists or is planned.', 'Author the self-healing runbook in Phase 11F.'),
  C('ROLL-RUNBOOK-005', 'support_runbooks', 'escalation path to developer is defined', 'critical', [AL, CTR, BP], '11F',
    'An escalation path to a developer is defined.', 'Define the developer escalation path.'),
  C('ROLL-RUNBOOK-006', 'support_runbooks', 'incident rollback runbook exists or is planned', 'critical', [CTR, BP], '11F',
    'An incident rollback runbook exists or is planned.', 'Author the incident rollback runbook in Phase 11F.'),

  // ---- Performance / cost ----
  C('ROLL-PERF-001', 'performance_cost', 'performance/cost audit exists', 'high', [AL, CTR, BP], '11A',
    'The Phase 10F performance/cost audit exists.', 'Confirm the performance/cost audit layer exists.'),
  C('ROLL-PERF-002', 'performance_cost', 'expensive steps require confirmation or manual review', 'high', [AL, CTR, BP], '11A',
    'Expensive steps require confirmation or manual review.', 'Confirm expensive steps are gated.'),
  C('ROLL-PERF-003', 'performance_cost', 'AI usage remains operator-controlled', 'critical', [AL, CTR, BP], '11A',
    'AI usage remains operator-controlled and is never automatic.', 'Confirm AI is manual-only/blocked.'),
  C('ROLL-PERF-004', 'performance_cost', 'metadata bloat risk is monitored or documented', 'medium', [CTR, BP], '11E',
    'Metadata bloat risk is monitored or documented.', 'Document/monitor metadata size growth.'),
  C('ROLL-PERF-005', 'performance_cost', 'long-running job review process exists', 'medium', [CTR, BP], '11C',
    'A long-running job review process exists.', 'Define a long-running job review process.'),

  // ---- Artifact retention ----
  C('ROLL-RETENTION-001', 'artifact_retention', 'artifact retention policy is documented or planned', 'high', [CTR, BP], '11E',
    'An artifact retention policy is documented or planned.', 'Document the retention policy in Phase 11E.'),
  C('ROLL-RETENTION-002', 'artifact_retention', 'cleanup/pruning policy is documented or planned', 'high', [CTR, BP], '11E',
    'A cleanup/pruning policy is documented or planned.', 'Document the cleanup policy in Phase 11E.'),
  C('ROLL-RETENTION-003', 'artifact_retention', 'golden history retention policy is documented or planned', 'medium', [CTR, BP], '11E',
    'A golden history retention policy is documented or planned.', 'Document golden history retention in Phase 11E.'),
  C('ROLL-RETENTION-004', 'artifact_retention', 'storage growth review process exists', 'medium', [CTR, BP], '11E',
    'A storage growth review process exists.', 'Define a storage growth review process.'),

  // ---- Client impact ----
  C('ROLL-CLIENT-001', 'client_impact', 'client-facing impact is documented', 'high', [BP], '11G',
    'Client-facing impact is documented.', 'Document client-facing impact in Phase 11G.'),
  C('ROLL-CLIENT-002', 'client_impact', 'accepted-with-warnings explanation standard exists or is planned', 'medium', [BP], '11G',
    'An accepted-with-warnings explanation standard exists or is planned.', 'Define the explanation standard in Phase 11G.'),
  C('ROLL-CLIENT-003', 'client_impact', 'manual review wording is documented or planned', 'medium', [BP], '11G',
    'Manual review wording is documented or planned.', 'Document manual review wording in Phase 11G.'),
  C('ROLL-CLIENT-004', 'client_impact', 'client-safe audit export is planned', 'medium', [BP], '11G',
    'A client-safe audit export is planned.', 'Plan the client-safe audit export in Phase 11G.'),

  // ---- Rollout scope ----
  C('ROLL-SCOPE-001', 'rollout_scope', 'initial rollout mode is selected', 'critical', [AL, CTR, BP], '11A',
    'An initial rollout mode is selected.', 'Select the initial rollout mode in the scope template.'),
  C('ROLL-SCOPE-002', 'rollout_scope', 'allowed operator roles are documented', 'critical', [AL, CTR, BP], '11A',
    'Allowed operator roles are documented.', 'Document allowed operator roles in the scope template.'),
  C('ROLL-SCOPE-003', 'rollout_scope', 'allowed PDF categories are documented', 'high', [AL, CTR, BP], '11A',
    'Allowed PDF categories are documented.', 'Document allowed PDF categories in the scope template.'),
  C('ROLL-SCOPE-004', 'rollout_scope', 'blocked/high-risk categories are documented', 'high', [AL, CTR, BP], '11A',
    'Blocked/high-risk PDF categories are documented.', 'Document blocked/high-risk categories in the scope template.'),
  C('ROLL-SCOPE-005', 'rollout_scope', 'allowed production actions are documented', 'critical', [AL, CTR, BP], '11A',
    'Allowed production actions are documented.', 'Document allowed production actions in the scope template.'),
  C('ROLL-SCOPE-006', 'rollout_scope', 'broad production rollout is blocked until Phase 11B–11H complete or explicitly approved', 'critical', [BP], '11H',
    'Broad production rollout is gated on Phase 11B–11H completion or explicit approval.', 'Keep broad production blocked until Phase 11B–11H complete or explicitly approved.'),
];

const DOMAINS = new Set<PdfImportRolloutReadinessDomain>([
  'phase10_lock', 'security_access', 'deployment', 'operator_workflow', 'permissions',
  'monitoring_alerting', 'release_governance', 'data_privacy', 'support_runbooks',
  'performance_cost', 'artifact_retention', 'client_impact', 'rollout_scope',
]);
const SEVERITIES = new Set<PdfImportRolloutReadinessSeverity>(['critical', 'high', 'medium', 'low', 'info']);
const MODES = new Set<PdfImportRolloutMode>(['internal_dev_only', 'admin_limited', 'controlled_team_rollout', 'broad_production', 'blocked']);

export function listPdfImportRolloutReadinessChecks(): PdfImportRolloutReadinessCheck[] {
  return PDF_IMPORT_ROLLOUT_READINESS_CHECKLIST.map((c) => ({
    ...c, evidence: [...c.evidence], requiredFor: [...c.requiredFor],
  }));
}

export function getPdfImportRolloutReadinessCheckById(
  id: string,
): PdfImportRolloutReadinessCheck | null {
  const found = PDF_IMPORT_ROLLOUT_READINESS_CHECKLIST.find((c) => c.id === id);
  return found ? { ...found, evidence: [...found.evidence], requiredFor: [...found.requiredFor] } : null;
}

export function assertPdfImportRolloutReadinessChecklistIntegrity(): {
  ok: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  const seen = new Set<string>();
  for (const c of PDF_IMPORT_ROLLOUT_READINESS_CHECKLIST) {
    if (seen.has(c.id)) errors.push(`duplicate_check_id:${c.id}`);
    seen.add(c.id);
    if (!c.domain || !DOMAINS.has(c.domain)) errors.push(`invalid_domain:${c.id}`);
    if (!c.title) errors.push(`missing_title:${c.id}`);
    if (!c.description) errors.push(`missing_description:${c.id}`);
    if (!SEVERITIES.has(c.severity)) errors.push(`invalid_severity:${c.id}`);
    if (!Array.isArray(c.requiredFor)) errors.push(`invalid_required_for:${c.id}`);
    else for (const m of c.requiredFor) if (!MODES.has(m)) errors.push(`invalid_required_for_mode:${c.id}:${m}`);
    if (!c.remediation) errors.push(`missing_remediation:${c.id}`);
    if (!c.targetPhase) errors.push(`missing_target_phase:${c.id}`);
  }

  if (PDF_IMPORT_ROLLOUT_READINESS_CHECKLIST.length < 70) {
    errors.push(`insufficient_checks:${PDF_IMPORT_ROLLOUT_READINESS_CHECKLIST.length}`);
  }

  for (const d of DOMAINS) {
    if (!PDF_IMPORT_ROLLOUT_READINESS_CHECKLIST.some((c) => c.domain === d)) {
      errors.push(`domain_not_covered:${d}`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
