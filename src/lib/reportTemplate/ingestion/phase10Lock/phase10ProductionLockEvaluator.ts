/**
 * phase10ProductionLockEvaluator — Phase 10H.
 *
 * Deterministic scoring and lock-decision resolution for the Phase 10 production
 * intelligence lock. Read-only: it never mutates its input. Critical safety
 * requirements that are unknown or failing force `not_locked`.
 */
import {
  PHASE_10_PRODUCTION_LOCK_VERSION,
  type EvaluatePhase10ProductionLockOptions,
  type Phase10ProductionLockDecision,
  type Phase10ProductionLockReport,
  type Phase10ProductionLockRequirement,
  type Phase10ProductionLockSeverity,
  type Phase10ProductionLockSummary,
} from './phase10ProductionLockTypes';

const SEVERITY_WEIGHTS: Record<Phase10ProductionLockSeverity, number> = {
  critical: 20,
  high: 10,
  medium: 5,
  low: 2,
  info: 1,
};

/**
 * Requirements whose safety is so fundamental that an `unknown` (unverified) or
 * `fail` status must force `not_locked` — automatic AI, template mutation,
 * quality-gate bypass, private-artifact, and build/test guarantees.
 */
const SAFETY_CRITICAL_REQUIREMENT_IDS = new Set<string>([
  // automatic AI safety
  'PHASE10-ADAPTIVE-002', 'PHASE10-SELFHEAL-002', 'PHASE10-OPERATOR-002',
  // template mutation safety
  'PHASE10-ADAPTIVE-003', 'PHASE10-SELFHEAL-003', 'PHASE10-OPERATOR-003', 'PHASE10-REPAIRPATTERN-002',
  // quality gate bypass safety
  'PHASE10-PERF-003', 'PHASE10-OPERATOR-004',
  // manual-only safety
  'PHASE10-SELFHEAL-004',
  // private artifact safety
  'PHASE10-PRIVACY-001', 'PHASE10-PRIVACY-002', 'PHASE10-PRIVACY-003',
  // build/test pass
  'PHASE10-TEST-001', 'PHASE10-TEST-002', 'PHASE10-TEST-003',
]);

export function isPhase10SafetyCriticalRequirement(id: string): boolean {
  return SAFETY_CRITICAL_REQUIREMENT_IDS.has(id);
}

export function getPhase10ProductionLockSeverityWeight(
  severity: Phase10ProductionLockSeverity,
): number {
  return SEVERITY_WEIGHTS[severity] ?? 0;
}

export function calculatePhase10ProductionLockScore(
  requirements: Phase10ProductionLockRequirement[],
): number {
  let score = 100;
  for (const r of requirements) {
    const weight = getPhase10ProductionLockSeverityWeight(r.severity);
    switch (r.status) {
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

export function resolvePhase10ProductionLockDecision(
  requirements: Phase10ProductionLockRequirement[],
  score?: number,
): Phase10ProductionLockDecision {
  const resolvedScore = score ?? calculatePhase10ProductionLockScore(requirements);

  const criticalFailures = requirements.filter((r) => r.severity === 'critical' && r.status === 'fail').length;
  const highFailures = requirements.filter((r) => r.severity === 'high' && r.status === 'fail').length;
  const safetyBlocked = requirements.some(
    (r) => isPhase10SafetyCriticalRequirement(r.id) && (r.status === 'fail' || r.status === 'unknown'),
  );

  // not_locked conditions.
  if (criticalFailures > 0 || safetyBlocked || highFailures >= 2 || resolvedScore < 75) {
    return 'not_locked';
  }

  const anyFail = requirements.some((r) => r.status === 'fail');
  const anyWarning = requirements.some((r) => r.status === 'warning');
  const anyUnknown = requirements.some((r) => r.status === 'unknown');

  // locked: nothing outstanding and high score.
  if (!anyFail && !anyWarning && !anyUnknown && resolvedScore >= 95) {
    return 'locked';
  }

  // Otherwise (no critical blockers, score >= 75) → locked_with_warnings.
  return 'locked_with_warnings';
}

export function summarizePhase10ProductionLockRequirements(
  requirements: Phase10ProductionLockRequirement[],
  now: () => Date = () => new Date(),
): Phase10ProductionLockSummary {
  const count = (s: Phase10ProductionLockRequirement['status']) =>
    requirements.filter((r) => r.status === s).length;

  const score = calculatePhase10ProductionLockScore(requirements);
  const decision = resolvePhase10ProductionLockDecision(requirements, score);

  return {
    version: PHASE_10_PRODUCTION_LOCK_VERSION,
    total: requirements.length,
    pass: count('pass'),
    warning: count('warning'),
    fail: count('fail'),
    unknown: count('unknown'),
    notApplicable: count('not_applicable'),
    criticalFailures: requirements.filter((r) => r.severity === 'critical' && r.status === 'fail').length,
    highFailures: requirements.filter((r) => r.severity === 'high' && r.status === 'fail').length,
    score,
    decision,
    generatedAt: now().toISOString(),
  };
}

export function evaluatePhase10ProductionLock(
  options: EvaluatePhase10ProductionLockOptions,
): Phase10ProductionLockReport {
  // Copy so the input is never mutated.
  const requirements = options.requirements.map((r) => ({ ...r, evidence: [...r.evidence] }));
  const summary = summarizePhase10ProductionLockRequirements(requirements, options.now);

  const criticalBlockers = requirements.filter(
    (r) => (r.severity === 'critical' && r.status === 'fail')
      || (isPhase10SafetyCriticalRequirement(r.id) && (r.status === 'fail' || r.status === 'unknown')),
  );
  const warnings = requirements.filter((r) => r.status === 'warning' || r.status === 'unknown');

  return {
    version: PHASE_10_PRODUCTION_LOCK_VERSION,
    requirements,
    summary,
    criticalBlockers,
    warnings,
  };
}
