// PDF Import Phase 10A — Production Readiness Hardening evaluator.
//
// Pure, deterministic scoring of a hardening checklist. No I/O. Inputs are never
// mutated.

import {
  PDF_IMPORT_HARDENING_AUDIT_VERSION,
  type PdfImportHardeningAuditReport,
  type PdfImportHardeningAuditSummary,
  type PdfImportHardeningCheck,
  type PdfImportHardeningEvaluationOptions,
  type PdfImportHardeningReadiness,
  type PdfImportHardeningSeverity,
} from './pdfImportHardeningAuditTypes';

const SEVERITY_WEIGHTS: Record<PdfImportHardeningSeverity, number> = {
  critical: 15,
  high: 8,
  medium: 4,
  low: 2,
  info: 1,
};

/** Severity → deduction weight used by the scoring model. */
export function getPdfImportHardeningSeverityWeight(
  severity: PdfImportHardeningSeverity,
): number {
  return SEVERITY_WEIGHTS[severity] ?? 0;
}

function clampScore(value: number): number {
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

/**
 * Score starts at 100. Each failing check subtracts its full severity weight,
 * each warning subtracts half, each unknown subtracts a quarter. pass and
 * not_applicable subtract nothing. Result is clamped to [0, 100] and rounded.
 */
export function calculatePdfImportHardeningScore(
  checks: PdfImportHardeningCheck[],
): number {
  let score = 100;
  for (const check of checks) {
    const weight = getPdfImportHardeningSeverityWeight(check.severity);
    switch (check.status) {
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
  return Math.round(clampScore(score));
}

/**
 * not_ready when any critical failure, 2+ high failures, or score < 70.
 * ready when there are no fails/warnings/unknowns and score >= 90.
 * ready_with_warnings otherwise.
 */
export function resolvePdfImportHardeningReadiness(
  checks: PdfImportHardeningCheck[],
): PdfImportHardeningReadiness {
  let criticalFailures = 0;
  let highFailures = 0;
  let failCount = 0;
  let warningCount = 0;
  let unknownCount = 0;

  for (const check of checks) {
    if (check.status === 'fail') {
      failCount += 1;
      if (check.severity === 'critical') criticalFailures += 1;
      if (check.severity === 'high') highFailures += 1;
    } else if (check.status === 'warning') {
      warningCount += 1;
    } else if (check.status === 'unknown') {
      unknownCount += 1;
    }
  }

  const score = calculatePdfImportHardeningScore(checks);

  if (criticalFailures > 0 || highFailures >= 2 || score < 70) {
    return 'not_ready';
  }

  if (
    failCount === 0 &&
    warningCount === 0 &&
    unknownCount === 0 &&
    score >= 90
  ) {
    return 'ready';
  }

  return 'ready_with_warnings';
}

/** Aggregate counts, criticals/highs, score, readiness and a timestamp. */
export function summarizePdfImportHardeningChecks(
  checks: PdfImportHardeningCheck[],
  now: () => Date = () => new Date(),
): PdfImportHardeningAuditSummary {
  let pass = 0;
  let warning = 0;
  let fail = 0;
  let unknown = 0;
  let notApplicable = 0;
  let criticalFailures = 0;
  let highFailures = 0;

  for (const check of checks) {
    switch (check.status) {
      case 'pass':
        pass += 1;
        break;
      case 'warning':
        warning += 1;
        break;
      case 'fail':
        fail += 1;
        if (check.severity === 'critical') criticalFailures += 1;
        if (check.severity === 'high') highFailures += 1;
        break;
      case 'unknown':
        unknown += 1;
        break;
      case 'not_applicable':
        notApplicable += 1;
        break;
      default:
        break;
    }
  }

  return {
    version: PDF_IMPORT_HARDENING_AUDIT_VERSION,
    total: checks.length,
    pass,
    warning,
    fail,
    unknown,
    notApplicable,
    criticalFailures,
    highFailures,
    readiness: resolvePdfImportHardeningReadiness(checks),
    score: calculatePdfImportHardeningScore(checks),
    generatedAt: now().toISOString(),
  };
}

/** Evaluate a hardening checklist into a full report without mutating input. */
export function evaluatePdfImportHardeningAudit(
  options: PdfImportHardeningEvaluationOptions,
): PdfImportHardeningAuditReport {
  const checks = options.checks.map((check) => ({
    ...check,
    evidence: [...check.evidence],
  }));

  return {
    version: PDF_IMPORT_HARDENING_AUDIT_VERSION,
    checks,
    summary: summarizePdfImportHardeningChecks(checks, options.now),
  };
}
