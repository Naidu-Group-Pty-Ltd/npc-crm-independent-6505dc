/**
 * productionRolloutLockEvaluator — Phase 11H.
 *
 * Deterministic scoring, final-decision, and rollout-mode resolution for the
 * Final Production Rollout Lock. Read-only: it never mutates its input. Any
 * critical failure — and in particular safety/privacy/client-report/retention/
 * permission failures — forces production_rollout_not_locked.
 */
import {
  PDF_IMPORT_PRODUCTION_ROLLOUT_LOCK_VERSION,
  type EvaluatePdfImportProductionRolloutLockOptions,
  type PdfImportProductionRolloutLockCheck,
  type PdfImportProductionRolloutLockDecision,
  type PdfImportProductionRolloutLockDomain,
  type PdfImportProductionRolloutLockReport,
  type PdfImportProductionRolloutLockSeverity,
  type PdfImportProductionRolloutLockSummary,
  type PdfImportProductionRolloutMode,
} from './productionRolloutLockTypes';

const SEVERITY_WEIGHTS: Record<PdfImportProductionRolloutLockSeverity, number> = {
  critical: 25,
  high: 12,
  medium: 6,
  low: 2,
  info: 1,
};

/**
 * Domains whose critical failure is so fundamental to safe rollout that it must
 * force production_rollout_not_locked (and rollout mode `blocked`).
 */
const SAFETY_CRITICAL_DOMAINS = new Set<PdfImportProductionRolloutLockDomain>([
  'security_privacy',
  'client_reporting',
  'retention',
  'permissions',
  'private_artifacts',
]);

export function getPdfImportProductionRolloutLockSeverityWeight(
  severity: PdfImportProductionRolloutLockSeverity,
): number {
  return SEVERITY_WEIGHTS[severity] ?? 0;
}

export function calculatePdfImportProductionRolloutLockScore(
  checks: PdfImportProductionRolloutLockCheck[],
): number {
  let score = 100;
  for (const c of checks) {
    const weight = getPdfImportProductionRolloutLockSeverityWeight(c.severity);
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
      case 'pass':
      case 'not_applicable':
      default:
        break;
    }
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

function countCriticalFailures(checks: PdfImportProductionRolloutLockCheck[]): number {
  return checks.filter((c) => c.severity === 'critical' && c.status === 'fail').length;
}

function countHighFailures(checks: PdfImportProductionRolloutLockCheck[]): number {
  return checks.filter((c) => c.severity === 'high' && c.status === 'fail').length;
}

function hasSafetyCriticalFailure(checks: PdfImportProductionRolloutLockCheck[]): boolean {
  return checks.some(
    (c) => c.severity === 'critical' && c.status === 'fail' && SAFETY_CRITICAL_DOMAINS.has(c.domain),
  );
}

function domainHasNoFail(
  checks: PdfImportProductionRolloutLockCheck[],
  domain: PdfImportProductionRolloutLockDomain,
): boolean {
  return !checks.some((c) => c.domain === domain && c.status === 'fail');
}

export function resolvePdfImportProductionRolloutLockDecision(input: {
  checks: PdfImportProductionRolloutLockCheck[];
  score: number;
}): PdfImportProductionRolloutLockDecision {
  const { checks, score } = input;

  const criticalFailures = countCriticalFailures(checks);
  const highFailures = countHighFailures(checks);

  // not_locked: any critical failure (esp. safety/privacy/client-report/retention/
  // permission), 2+ high failures, or a low score.
  if (criticalFailures > 0 || hasSafetyCriticalFailure(checks) || highFailures >= 2 || score < 75) {
    return 'production_rollout_not_locked';
  }

  const anyFail = checks.some((c) => c.status === 'fail');
  const anyWarning = checks.some((c) => c.status === 'warning');
  const anyUnknown = checks.some((c) => c.status === 'unknown');

  // locked: nothing outstanding and a high score.
  if (!anyFail && !anyWarning && !anyUnknown && score >= 95) {
    return 'production_rollout_locked';
  }

  // Otherwise (no critical blockers, score >= 75) → locked_with_conditions.
  return 'production_rollout_locked_with_conditions';
}

export function resolvePdfImportProductionRolloutMode(input: {
  checks: PdfImportProductionRolloutLockCheck[];
  decision: PdfImportProductionRolloutLockDecision;
  score: number;
}): PdfImportProductionRolloutMode {
  const { checks, decision, score } = input;

  // A not_locked decision is never safe for any rollout mode.
  if (decision === 'production_rollout_not_locked') {
    return 'blocked';
  }

  const noCriticalFail = countCriticalFailures(checks) === 0 && !hasSafetyCriticalFailure(checks);
  const noFailWarnUnknown = !checks.some(
    (c) => c.status === 'fail' || c.status === 'warning' || c.status === 'unknown',
  );

  // broad_production: everything green with a high score.
  if (noFailWarnUnknown && score >= 95) {
    return 'broad_production';
  }

  // controlled_team_rollout: no critical failures, strong score, and the
  // runbooks/permissions/monitoring/client-reporting domains have no failures.
  if (
    score >= 85
    && noCriticalFail
    && domainHasNoFail(checks, 'runbooks')
    && domainHasNoFail(checks, 'permissions')
    && domainHasNoFail(checks, 'monitoring_alerting')
    && domainHasNoFail(checks, 'client_reporting')
  ) {
    return 'controlled_team_rollout';
  }

  // admin_limited: no critical failures, adequate score, and the
  // permissions/monitoring/release-gate domains have no failures.
  if (
    score >= 75
    && noCriticalFail
    && domainHasNoFail(checks, 'permissions')
    && domainHasNoFail(checks, 'monitoring_alerting')
    && domainHasNoFail(checks, 'release_gate')
  ) {
    return 'admin_limited';
  }

  // internal_dev_only: no critical security/privacy failure but too many
  // warnings/unknowns for a confident admin rollout.
  if (score >= 65 && domainHasNoFail(checks, 'security_privacy') && domainHasNoFail(checks, 'private_artifacts')) {
    return 'internal_dev_only';
  }

  return 'blocked';
}

export function summarizePdfImportProductionRolloutLockChecks(
  checks: PdfImportProductionRolloutLockCheck[],
): PdfImportProductionRolloutLockSummary {
  const count = (s: PdfImportProductionRolloutLockCheck['status']) =>
    checks.filter((c) => c.status === s).length;

  return {
    total: checks.length,
    pass: count('pass'),
    warning: count('warning'),
    fail: count('fail'),
    unknown: count('unknown'),
    notApplicable: count('not_applicable'),
    criticalFailures: countCriticalFailures(checks),
    highFailures: countHighFailures(checks),
  };
}

export function evaluatePdfImportProductionRolloutLock(
  options: EvaluatePdfImportProductionRolloutLockOptions,
): PdfImportProductionRolloutLockReport {
  const now = options.now ?? (() => new Date());

  // Copy so the input is never mutated.
  const checks = options.checks.map((c) => ({
    ...c,
    evidence: [...c.evidence],
    requiredFor: [...c.requiredFor],
  }));

  const score = calculatePdfImportProductionRolloutLockScore(checks);
  const decision = resolvePdfImportProductionRolloutLockDecision({ checks, score });
  const rolloutMode = resolvePdfImportProductionRolloutMode({ checks, decision, score });
  const summary = summarizePdfImportProductionRolloutLockChecks(checks);

  const blockers = checks.filter(
    (c) => c.status === 'fail'
      && (c.severity === 'critical' || SAFETY_CRITICAL_DOMAINS.has(c.domain)),
  );
  const conditions = checks.filter((c) => c.status === 'warning' || c.status === 'unknown');

  return {
    version: PDF_IMPORT_PRODUCTION_ROLLOUT_LOCK_VERSION,
    decision,
    rolloutMode,
    score,
    checks,
    summary,
    blockers,
    conditions,
    generatedAt: now().toISOString(),
  };
}
