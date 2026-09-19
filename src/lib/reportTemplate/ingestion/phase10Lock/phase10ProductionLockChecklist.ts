/**
 * phase10ProductionLockChecklist — Phase 10H.
 *
 * The canonical Phase 10 production intelligence lock checklist. Each requirement
 * defaults to `unknown` and carries the remediation needed to turn it green. The
 * checklist is data only; the evaluator resolves the lock decision from statuses.
 */
import type {
  Phase10ProductionLockDomain,
  Phase10ProductionLockRequirement,
  Phase10ProductionLockSeverity,
} from './phase10ProductionLockTypes';

function R(
  id: string,
  domain: Phase10ProductionLockDomain,
  title: string,
  severity: Phase10ProductionLockSeverity,
  description: string,
  remediation: string,
): Phase10ProductionLockRequirement {
  return { id, domain, title, description, severity, status: 'unknown', evidence: [], remediation };
}

export const PHASE_10_PRODUCTION_LOCK_REQUIREMENTS: Phase10ProductionLockRequirement[] = [
  // ---- Documentation ----
  R('PHASE10-DOC-001', 'documentation', 'Phase 10A documentation exists', 'high',
    'Production hardening audit documentation is present.',
    'Ensure docs/pdf-import/phase-10a-production-hardening-audit.md exists.'),
  R('PHASE10-DOC-002', 'documentation', 'Phase 10B documentation exists', 'high',
    'Import intelligence profile documentation is present.',
    'Ensure docs/pdf-import/phase-10b-import-intelligence-profile.md exists.'),
  R('PHASE10-DOC-003', 'documentation', 'Phase 10C documentation exists', 'high',
    'Repair pattern library documentation is present.',
    'Ensure docs/pdf-import/phase-10c-repair-pattern-library.md exists.'),
  R('PHASE10-DOC-004', 'documentation', 'Phase 10D documentation exists', 'high',
    'Adaptive reconciliation documentation is present.',
    'Ensure docs/pdf-import/phase-10d-adaptive-reconciliation.md exists.'),
  R('PHASE10-DOC-005', 'documentation', 'Phase 10E documentation exists', 'high',
    'Self-healing retry orchestration documentation is present.',
    'Ensure docs/pdf-import/phase-10e-self-healing-retry-orchestration.md exists.'),
  R('PHASE10-DOC-006', 'documentation', 'Phase 10F documentation exists', 'high',
    'Performance/cost optimization documentation is present.',
    'Ensure docs/pdf-import/phase-10f-performance-cost-optimization.md exists.'),
  R('PHASE10-DOC-007', 'documentation', 'Phase 10G documentation exists', 'high',
    'Production operator controls documentation is present.',
    'Ensure docs/pdf-import/phase-10g-production-operator-controls.md exists.'),
  R('PHASE10-DOC-008', 'documentation', 'Phase 10 final smoke test exists', 'high',
    'The final Phase 10 smoke test document is present.',
    'Ensure docs/pdf-import/phase-10-final-smoke-test.md exists.'),

  // ---- Schemas ----
  R('PHASE10-SCHEMA-001', 'schemas', 'Import intelligence schema exists', 'medium',
    'The import intelligence profile JSON schema is present.',
    'Ensure docs/pdf-import/import-intelligence-profile.schema.json exists.'),
  R('PHASE10-SCHEMA-002', 'schemas', 'Repair pattern schema exists', 'medium',
    'The repair pattern analysis JSON schema is present.',
    'Ensure docs/pdf-import/repair-pattern-analysis.schema.json exists.'),
  R('PHASE10-SCHEMA-003', 'schemas', 'Adaptive reconciliation schema exists', 'medium',
    'The adaptive reconciliation policy JSON schema is present.',
    'Ensure docs/pdf-import/adaptive-reconciliation-policy.schema.json exists.'),
  R('PHASE10-SCHEMA-004', 'schemas', 'Self-healing schema exists', 'medium',
    'The self-healing retry audit JSON schema is present.',
    'Ensure docs/pdf-import/self-healing-retry-audit.schema.json exists.'),
  R('PHASE10-SCHEMA-005', 'schemas', 'Performance/cost schema exists', 'medium',
    'The performance/cost audit JSON schema is present.',
    'Ensure docs/pdf-import/performance-cost-audit.schema.json exists.'),
  R('PHASE10-SCHEMA-006', 'schemas', 'Operator control schema exists', 'medium',
    'The production operator control audit JSON schema is present.',
    'Ensure docs/pdf-import/production-operator-control-audit.schema.json exists.'),

  // ---- SQL ----
  R('PHASE10-SQL-001', 'sql', 'Phase 10A SQL exists', 'medium',
    'The hardening check SQL is present.',
    'Ensure scripts/regression/pdf-import-phase-10a-hardening-check.sql exists.'),
  R('PHASE10-SQL-002', 'sql', 'Phase 10B SQL exists', 'medium',
    'The import profile check SQL is present.',
    'Ensure scripts/regression/pdf-import-phase-10b-import-profile-check.sql exists.'),
  R('PHASE10-SQL-003', 'sql', 'Phase 10C SQL exists', 'medium',
    'The repair pattern check SQL is present.',
    'Ensure scripts/regression/pdf-import-phase-10c-repair-pattern-check.sql exists.'),
  R('PHASE10-SQL-004', 'sql', 'Phase 10D SQL exists', 'medium',
    'The adaptive reconciliation check SQL is present.',
    'Ensure scripts/regression/pdf-import-phase-10d-adaptive-reconciliation-check.sql exists.'),
  R('PHASE10-SQL-005', 'sql', 'Phase 10E SQL exists', 'medium',
    'The self-healing check SQL is present.',
    'Ensure scripts/regression/pdf-import-phase-10e-self-healing-check.sql exists.'),
  R('PHASE10-SQL-006', 'sql', 'Phase 10F SQL exists', 'medium',
    'The performance check SQL is present.',
    'Ensure scripts/regression/pdf-import-phase-10f-performance-check.sql exists.'),
  R('PHASE10-SQL-007', 'sql', 'Phase 10G SQL exists', 'medium',
    'The operator controls check SQL is present.',
    'Ensure scripts/regression/pdf-import-phase-10g-operator-controls-check.sql exists.'),
  R('PHASE10-SQL-008', 'sql', 'Final Phase 10 SQL exists and runs', 'critical',
    'The final Phase 10 lock SQL is present and runs read-only without error.',
    'Ensure scripts/regression/pdf-import-phase-10-final-check.sql exists and runs in the SQL editor.'),

  // ---- Hardening ----
  R('PHASE10-HARDEN-001', 'hardening', 'Production hardening audit framework exists', 'high',
    'The Phase 10A hardening evaluator/checklist modules are present.',
    'Ensure the hardening ingestion modules exist and are tested.'),
  R('PHASE10-HARDEN-002', 'hardening', 'No critical hardening blockers remain', 'critical',
    'No critical hardening blockers are outstanding.',
    'Resolve any critical items in the hardening risk register.'),

  // ---- Import intelligence ----
  R('PHASE10-INTEL-001', 'import_intelligence', 'Import intelligence modules exist', 'high',
    'The Phase 10B import intelligence modules are present.',
    'Ensure src/lib/reportTemplate/ingestion/importIntelligence exists and is tested.'),
  R('PHASE10-INTEL-002', 'import_intelligence', 'Import intelligence persists only safe metadata', 'critical',
    'The profile persists structured metadata only, never raw PDF/OCR text.',
    'Confirm persistence writes only structured profile fields via append_meta.'),

  // ---- Repair patterns ----
  R('PHASE10-REPAIRPATTERN-001', 'repair_patterns', 'Repair pattern library includes canonical patterns', 'high',
    'The Phase 10C repair pattern library includes all canonical patterns.',
    'Ensure the repair pattern library and matcher exist and are tested.'),
  R('PHASE10-REPAIRPATTERN-002', 'repair_patterns', 'Repair pattern analysis is advisory and non-mutating', 'critical',
    'Repair pattern analysis never applies repairs or mutates templates.',
    'Confirm the analysis layer is advisory only.'),

  // ---- Adaptive reconciliation ----
  R('PHASE10-ADAPTIVE-001', 'adaptive_reconciliation', 'Adaptive reconciliation policy exists', 'high',
    'The Phase 10D adaptive reconciliation policy modules are present.',
    'Ensure the adaptive reconciliation modules exist and are tested.'),
  R('PHASE10-ADAPTIVE-002', 'adaptive_reconciliation', 'Adaptive policy does not call AI automatically', 'critical',
    'The adaptive policy is governance only and never calls AI automatically.',
    'Confirm no automatic AI invocation in the adaptive policy layer.'),
  R('PHASE10-ADAPTIVE-003', 'adaptive_reconciliation', 'Adaptive policy does not mutate templates', 'critical',
    'The adaptive policy never mutates report_templates.',
    'Confirm the adaptive policy layer performs no template writes.'),

  // ---- Self-healing ----
  R('PHASE10-SELFHEAL-001', 'self_healing', 'Self-healing planner/executor exists', 'high',
    'The Phase 10E self-healing planner and executor modules are present.',
    'Ensure the selfHealing modules exist and are tested.'),
  R('PHASE10-SELFHEAL-002', 'self_healing', 'Self-healing does not call AI automatically', 'critical',
    'The self-healing executor never calls AI automatically.',
    'Confirm run_ai_reconciliation is never auto-executed by self-healing.'),
  R('PHASE10-SELFHEAL-003', 'self_healing', 'Self-healing does not mutate templates automatically', 'critical',
    'The self-healing executor never mutates templates automatically.',
    'Confirm the executor performs no template writes.'),
  R('PHASE10-SELFHEAL-004', 'self_healing', 'Manual-only actions remain manual-only', 'critical',
    'Manual-only/blocked self-healing actions are never executed automatically.',
    'Confirm never-automatic actions resolve to manual_required, never completed.'),

  // ---- Performance/cost ----
  R('PHASE10-PERF-001', 'performance_cost', 'Performance/cost audit exists', 'high',
    'The Phase 10F performance/cost audit modules are present.',
    'Ensure the performance modules exist and are tested.'),
  R('PHASE10-PERF-002', 'performance_cost', 'Performance audit is advisory only', 'critical',
    'The performance audit is advisory and changes no pipeline behaviour.',
    'Confirm the audit never suppresses or executes steps.'),
  R('PHASE10-PERF-003', 'performance_cost', 'Performance audit does not skip quality gates', 'critical',
    'The performance audit never skips required quality gates.',
    'Confirm the audit does not alter quality gate evaluation.'),

  // ---- Operator controls ----
  R('PHASE10-OPERATOR-001', 'operator_controls', 'Production operator control catalog exists', 'high',
    'The Phase 10G operator control catalog and modules are present.',
    'Ensure the operatorControls modules exist and are tested.'),
  R('PHASE10-OPERATOR-002', 'operator_controls', 'Operator controls do not call AI automatically', 'critical',
    'AI reconciliation controls are manual-only or blocked; never auto-executed.',
    'Confirm run_ai_reconciliation_manual is manual-only/blocked.'),
  R('PHASE10-OPERATOR-003', 'operator_controls', 'Operator controls do not mutate templates automatically', 'critical',
    'Template-mutating controls are manual-only; never auto-executed.',
    'Confirm apply_repair/apply_reconciliation/rerun_import are manual-only.'),
  R('PHASE10-OPERATOR-004', 'operator_controls', 'Operator controls do not bypass quality gates', 'critical',
    'Operator controls never bypass required quality gates.',
    'Confirm mark_accepted is blocked on fail/blocked gates.'),

  // ---- Golden regression ----
  R('PHASE10-GOLDEN-001', 'golden_regression', 'Golden corpus orchestrator still passes tests', 'critical',
    'The Phase 9A golden corpus orchestrator remains intact and tested.',
    'Run the golden corpus orchestrator test suite.'),
  R('PHASE10-GOLDEN-002', 'golden_regression', 'Golden run history remains available', 'high',
    'Golden run history persistence remains available.',
    'Confirm goldenRunHistory modules still function.'),
  R('PHASE10-GOLDEN-003', 'golden_regression', 'Baseline comparison remains available', 'high',
    'Baseline comparison remains available.',
    'Confirm goldenRunBaselineComparison still functions.'),

  // ---- Export parity ----
  R('PHASE10-EXPORT-001', 'export_parity', 'Export parity runner remains available', 'high',
    'The Phase 9D export parity runner remains available.',
    'Confirm exportParityRunner still functions.'),
  R('PHASE10-EXPORT-002', 'export_parity', 'Manual export parity remains supported', 'high',
    'Manual export parity remains supported.',
    'Confirm manual export parity path still functions.'),

  // ---- Database/storage ----
  R('PHASE10-DB-001', 'database_storage', 'pdf_import_golden_runs table exists', 'critical',
    'The golden run history table exists.',
    'Confirm public.pdf_import_golden_runs exists.'),
  R('PHASE10-DB-002', 'database_storage', 'template-import-artifacts storage bucket is not unsafe/public', 'critical',
    'The artifact storage bucket is private (not public).',
    'Confirm the template-import-artifacts bucket is not public.'),
  R('PHASE10-DB-003', 'database_storage', 'RLS/access model is documented', 'critical',
    'RLS/access model for the core tables is documented and enabled.',
    'Confirm RLS is enabled and policies are documented.'),

  // ---- UI ----
  R('PHASE10-UI-001', 'ui', 'Golden Regression console loads', 'critical',
    'The Golden Regression console loads without crashing.',
    'Load /admin/pdf-golden-regression and confirm it renders.'),
  R('PHASE10-UI-002', 'ui', 'Phase 10 panels render without crashing', 'high',
    'All Phase 10 result panels render without crashing.',
    'Confirm all Phase 10 panels render for a run result.'),

  // ---- Tests/build ----
  R('PHASE10-TEST-001', 'tests_build', 'Phase 10 tests pass', 'critical',
    'All Phase 10 unit tests pass.',
    'Run the Phase 10 test suites and ensure they pass.'),
  R('PHASE10-TEST-002', 'tests_build', 'Phase 9 foundation tests pass', 'critical',
    'The Phase 9 foundation tests pass.',
    'Run the Phase 9 foundation test suites and ensure they pass.'),
  R('PHASE10-TEST-003', 'tests_build', 'npm run build passes', 'critical',
    'The production build passes.',
    'Run npm run build and ensure it succeeds.'),

  // ---- Privacy/artifacts ----
  R('PHASE10-PRIVACY-001', 'privacy_artifacts', 'No private PDFs are staged', 'critical',
    'No private/source/generated PDFs are staged for commit.',
    'Unstage any .pdf files before committing.'),
  R('PHASE10-PRIVACY-002', 'privacy_artifacts', 'No screenshots/rasters/generated PDFs are staged', 'critical',
    'No screenshots, raster images, or generated PDFs are staged.',
    'Unstage any image/raster artifacts before committing.'),
  R('PHASE10-PRIVACY-003', 'privacy_artifacts', 'No env/log/private signed URL dumps are staged', 'critical',
    'No .env, logs, or private signed URL dumps are staged.',
    'Unstage any .env/log/secret artifacts before committing.'),

  // ---- Deployment ----
  R('PHASE10-DEPLOY-001', 'deployment', 'Supabase deployment not required unless functions changed', 'medium',
    'No Supabase deployment is required unless a function changed.',
    'Confirm no supabase/functions changes; if changed, deploy only that function.'),
  R('PHASE10-DEPLOY-002', 'deployment', 'supabase/config.toml restored after deploy, if deploy was needed', 'critical',
    'supabase/config.toml is unchanged (or restored after any temporary deploy).',
    'Confirm git diff on supabase/config.toml is empty.'),
];

const DOMAINS = new Set<Phase10ProductionLockDomain>([
  'documentation', 'schemas', 'sql', 'hardening', 'import_intelligence', 'repair_patterns',
  'adaptive_reconciliation', 'self_healing', 'performance_cost', 'operator_controls',
  'golden_regression', 'export_parity', 'database_storage', 'ui', 'tests_build', 'privacy_artifacts', 'deployment',
]);
const SEVERITIES = new Set<Phase10ProductionLockSeverity>(['critical', 'high', 'medium', 'low', 'info']);

export function listPhase10ProductionLockRequirements(): Phase10ProductionLockRequirement[] {
  // Deep-copy so callers can set statuses without mutating the canonical list.
  return PHASE_10_PRODUCTION_LOCK_REQUIREMENTS.map((r) => ({ ...r, evidence: [...r.evidence] }));
}

export function getPhase10ProductionLockRequirementById(
  id: string,
): Phase10ProductionLockRequirement | null {
  const found = PHASE_10_PRODUCTION_LOCK_REQUIREMENTS.find((r) => r.id === id);
  return found ? { ...found, evidence: [...found.evidence] } : null;
}

export function assertPhase10ProductionLockChecklistIntegrity(): {
  ok: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  const seen = new Set<string>();
  for (const r of PHASE_10_PRODUCTION_LOCK_REQUIREMENTS) {
    if (seen.has(r.id)) errors.push(`duplicate_requirement_id:${r.id}`);
    seen.add(r.id);
    if (!r.domain || !DOMAINS.has(r.domain)) errors.push(`invalid_domain:${r.id}`);
    if (!r.title) errors.push(`missing_title:${r.id}`);
    if (!r.description) errors.push(`missing_description:${r.id}`);
    if (!SEVERITIES.has(r.severity)) errors.push(`invalid_severity:${r.id}`);
    if (!r.remediation) errors.push(`missing_remediation:${r.id}`);
    if (!Array.isArray(r.evidence)) errors.push(`invalid_evidence:${r.id}`);
  }

  if (PHASE_10_PRODUCTION_LOCK_REQUIREMENTS.length < 60) {
    errors.push(`insufficient_requirements:${PHASE_10_PRODUCTION_LOCK_REQUIREMENTS.length}`);
  }

  // Must cover critical safety requirements.
  const requiredSafety = [
    'PHASE10-ADAPTIVE-002', 'PHASE10-SELFHEAL-002', 'PHASE10-OPERATOR-002',
    'PHASE10-ADAPTIVE-003', 'PHASE10-SELFHEAL-003', 'PHASE10-OPERATOR-003',
    'PHASE10-OPERATOR-004', 'PHASE10-PERF-003',
    'PHASE10-PRIVACY-001', 'PHASE10-PRIVACY-002', 'PHASE10-PRIVACY-003',
    'PHASE10-TEST-001', 'PHASE10-TEST-002', 'PHASE10-TEST-003',
  ];
  for (const id of requiredSafety) {
    if (!seen.has(id)) errors.push(`missing_required_safety_requirement:${id}`);
  }

  // Must cover every domain at least once.
  for (const d of DOMAINS) {
    if (!PHASE_10_PRODUCTION_LOCK_REQUIREMENTS.some((r) => r.domain === d)) {
      warnings.push(`domain_not_covered:${d}`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
