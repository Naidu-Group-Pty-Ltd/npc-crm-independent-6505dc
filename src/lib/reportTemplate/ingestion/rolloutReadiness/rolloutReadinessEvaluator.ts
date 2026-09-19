/**
 * rolloutReadinessEvaluator — Phase 11A.
 *
 * Deterministic scoring, rollout-decision resolution, recommended-mode
 * resolution, and Phase 11B–11H follow-up recommendation for the production
 * rollout readiness review. Read-only: it never mutates its input. Critical
 * safety checks that are unknown or failing force `rollout_not_ready`.
 */
import {
  PDF_IMPORT_ROLLOUT_READINESS_VERSION,
  type EvaluatePdfImportRolloutReadinessOptions,
  type PdfImportRolloutDecision,
  type PdfImportRolloutMode,
  type PdfImportRolloutReadinessCheck,
  type PdfImportRolloutReadinessDomain,
  type PdfImportRolloutReadinessReport,
  type PdfImportRolloutReadinessSeverity,
  type PdfImportRolloutReadinessSummary,
} from './rolloutReadinessTypes';

const SEVERITY_WEIGHTS: Record<PdfImportRolloutReadinessSeverity, number> = {
  critical: 20,
  high: 10,
  medium: 5,
  low: 2,
  info: 1,
};

/**
 * Checks whose safety is fundamental to any rollout: an `unknown` (unverified)
 * or `fail` on any of them forces `rollout_not_ready` — private-artifact,
 * automatic-AI, template-mutation/manual-only, quality-gate/operator-safety,
 * admin-route, storage-privacy, and append_meta guarantees.
 */
const SAFETY_CRITICAL_CHECK_IDS = new Set<string>([
  // private artifact safety
  'ROLL-PRIV-001', 'ROLL-PRIV-002', 'ROLL-PRIV-003', 'ROLL-PRIV-004',
  // automatic AI safety
  'ROLL-PERF-003',
  // template mutation / manual-only / operator quality-gate safety
  'ROLL-OP-004', 'ROLL-OP-005', 'ROLL-OP-006',
  // admin route protection + write access
  'ROLL-SEC-001', 'ROLL-SEC-005',
  // storage privacy + service-role leak
  'ROLL-SEC-003', 'ROLL-SEC-006',
  // append_meta safety
  'ROLL-SEC-002',
]);

export function isPdfImportRolloutSafetyCriticalCheck(id: string): boolean {
  return SAFETY_CRITICAL_CHECK_IDS.has(id);
}

export function getPdfImportRolloutReadinessSeverityWeight(
  severity: PdfImportRolloutReadinessSeverity,
): number {
  return SEVERITY_WEIGHTS[severity] ?? 0;
}

export function calculatePdfImportRolloutReadinessScore(
  checks: PdfImportRolloutReadinessCheck[],
): number {
  let score = 100;
  for (const c of checks) {
    const weight = getPdfImportRolloutReadinessSeverityWeight(c.severity);
    switch (c.status) {
      case 'fail':
        score -= weight;
        break;
      case 'warning':
        score -= weight * 0.5;
        break;
      case 'unknown':
        score -= weight * 0.25;
        break;
      default:
        break;
    }
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function resolvePdfImportRolloutDecision(input: {
  checks: PdfImportRolloutReadinessCheck[];
  score?: number;
}): PdfImportRolloutDecision {
  const { checks } = input;
  const score = input.score ?? calculatePdfImportRolloutReadinessScore(checks);

  const criticalFailures = checks.filter((c) => c.severity === 'critical' && c.status === 'fail').length;
  const highFailures = checks.filter((c) => c.severity === 'high' && c.status === 'fail').length;
  const safetyBlocked = checks.some(
    (c) => isPdfImportRolloutSafetyCriticalCheck(c.id) && (c.status === 'fail' || c.status === 'unknown'),
  );

  if (criticalFailures > 0 || safetyBlocked || highFailures >= 2 || score < 70) {
    return 'rollout_not_ready';
  }

  const anyFail = checks.some((c) => c.status === 'fail');
  const anyWarning = checks.some((c) => c.status === 'warning');
  const anyUnknown = checks.some((c) => c.status === 'unknown');

  if (!anyFail && !anyWarning && !anyUnknown && score >= 95) {
    return 'rollout_ready';
  }

  return 'rollout_ready_with_conditions';
}

function domainReady(checks: PdfImportRolloutReadinessCheck[], domain: PdfImportRolloutReadinessDomain): boolean {
  const inDomain = checks.filter((c) => c.domain === domain);
  if (inDomain.length === 0) return true;
  return inDomain.every((c) => c.status === 'pass' || c.status === 'not_applicable');
}

export function resolveRecommendedPdfImportRolloutMode(input: {
  checks: PdfImportRolloutReadinessCheck[];
  decision: PdfImportRolloutDecision;
  score?: number;
}): PdfImportRolloutMode {
  const { checks, decision } = input;
  if (decision === 'rollout_not_ready') return 'blocked';

  const score = input.score ?? calculatePdfImportRolloutReadinessScore(checks);

  const permissionsReady = domainReady(checks, 'permissions');
  const monitoringReady = domainReady(checks, 'monitoring_alerting');
  const runbooksReady = domainReady(checks, 'support_runbooks');
  const releaseReady = domainReady(checks, 'release_governance');
  const retentionReady = domainReady(checks, 'artifact_retention');
  const clientReady = domainReady(checks, 'client_impact');
  const coreReady = ['phase10_lock', 'security_access', 'operator_workflow']
    .every((d) => domainReady(checks, d as PdfImportRolloutReadinessDomain));

  const allCriticalHighPass = checks
    .filter((c) => c.severity === 'critical' || c.severity === 'high')
    .every((c) => c.status === 'pass' || c.status === 'not_applicable');

  if (score >= 95 && allCriticalHighPass
    && permissionsReady && monitoringReady && releaseReady && runbooksReady && retentionReady && clientReady) {
    return 'broad_production';
  }

  if (score >= 85 && coreReady && permissionsReady && monitoringReady && runbooksReady && releaseReady) {
    return 'controlled_team_rollout';
  }

  if (score >= 70 && coreReady) {
    return 'admin_limited';
  }

  return 'internal_dev_only';
}

export function getRecommendedPhase11FollowUps(
  checks: PdfImportRolloutReadinessCheck[],
): string[] {
  const gap = (domain: PdfImportRolloutReadinessDomain) =>
    checks.some((c) => c.domain === domain && (c.status === 'fail' || c.status === 'unknown'));

  const out: string[] = [];
  if (gap('permissions')) out.push('11B');
  if (gap('monitoring_alerting')) out.push('11C');
  if (gap('release_governance')) out.push('11D');
  if (gap('artifact_retention')) out.push('11E');
  if (gap('support_runbooks')) out.push('11F');
  if (gap('client_impact')) out.push('11G');
  if (out.length === 0) out.push('11H');
  return out;
}

export function summarizePdfImportRolloutReadinessChecks(
  checks: PdfImportRolloutReadinessCheck[],
  now: () => Date = () => new Date(),
): PdfImportRolloutReadinessSummary {
  const count = (s: PdfImportRolloutReadinessCheck['status']) => checks.filter((c) => c.status === s).length;

  const score = calculatePdfImportRolloutReadinessScore(checks);
  const decision = resolvePdfImportRolloutDecision({ checks, score });
  const recommendedMode = resolveRecommendedPdfImportRolloutMode({ checks, decision, score });

  return {
    version: PDF_IMPORT_ROLLOUT_READINESS_VERSION,
    total: checks.length,
    pass: count('pass'),
    warning: count('warning'),
    fail: count('fail'),
    unknown: count('unknown'),
    notApplicable: count('not_applicable'),
    criticalFailures: checks.filter((c) => c.severity === 'critical' && c.status === 'fail').length,
    highFailures: checks.filter((c) => c.severity === 'high' && c.status === 'fail').length,
    score,
    decision,
    recommendedMode,
    generatedAt: now().toISOString(),
  };
}

export function evaluatePdfImportRolloutReadiness(
  options: EvaluatePdfImportRolloutReadinessOptions,
): PdfImportRolloutReadinessReport {
  const checks = options.checks.map((c) => ({ ...c, evidence: [...c.evidence], requiredFor: [...c.requiredFor] }));
  const summary = summarizePdfImportRolloutReadinessChecks(checks, options.now);

  const criticalBlockers = checks.filter(
    (c) => (c.severity === 'critical' && c.status === 'fail')
      || (isPdfImportRolloutSafetyCriticalCheck(c.id) && (c.status === 'fail' || c.status === 'unknown')),
  );
  const criticalIds = new Set(criticalBlockers.map((c) => c.id));
  const conditions = checks.filter(
    (c) => !criticalIds.has(c.id)
      && (c.status === 'warning' || c.status === 'unknown' || (c.status === 'fail' && c.severity === 'high')),
  );

  return {
    version: PDF_IMPORT_ROLLOUT_READINESS_VERSION,
    checks,
    summary,
    criticalBlockers,
    conditions,
    recommendedNextPhases: getRecommendedPhase11FollowUps(checks),
  };
}
