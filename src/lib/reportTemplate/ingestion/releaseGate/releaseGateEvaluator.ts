/**
 * releaseGateEvaluator — Phase 11D scoring + decision logic.
 *
 * Pure evaluation: given a set of resolved checks, computes the score, summary,
 * and gate decision. No I/O. Never mutates anything, never calls AI.
 */
import {
  PDF_IMPORT_RELEASE_GATE_VERSION,
  type EvaluatePdfImportReleaseGateOptions,
  type PdfImportReleaseGateCheck,
  type PdfImportReleaseGateDecision,
  type PdfImportReleaseGateReport,
  type PdfImportReleaseGateSeverity,
  type PdfImportReleaseGateSummary,
} from './releaseGateTypes';

const FAIL_WEIGHT: Record<PdfImportReleaseGateSeverity, number> = {
  critical: 25,
  high: 12,
  medium: 6,
  low: 2,
  info: 0,
};

export function getPdfImportReleaseGateSeverityWeight(
  severity: PdfImportReleaseGateSeverity,
): number {
  return FAIL_WEIGHT[severity] ?? 0;
}

export function summarizePdfImportReleaseGateChecks(
  checks: PdfImportReleaseGateCheck[],
): PdfImportReleaseGateSummary {
  const list = Array.isArray(checks) ? checks : [];
  return {
    total: list.length,
    pass: list.filter((c) => c.status === 'pass').length,
    warning: list.filter((c) => c.status === 'warning').length,
    fail: list.filter((c) => c.status === 'fail').length,
    skipped: list.filter((c) => c.status === 'skipped').length,
    unknown: list.filter((c) => c.status === 'unknown').length,
    criticalFailures: list.filter((c) => c.status === 'fail' && c.severity === 'critical').length,
    highFailures: list.filter((c) => c.status === 'fail' && c.severity === 'high').length,
  };
}

/**
 * Score starts at 100. Failures subtract the full severity weight; warnings
 * subtract half; unknowns subtract a quarter; skipped subtract nothing. Clamped
 * to [0, 100].
 */
export function calculatePdfImportReleaseGateScore(
  checks: PdfImportReleaseGateCheck[],
): number {
  const list = Array.isArray(checks) ? checks : [];
  let score = 100;
  for (const check of list) {
    const weight = getPdfImportReleaseGateSeverityWeight(check.severity);
    if (check.status === 'fail') score -= weight;
    else if (check.status === 'warning') score -= weight / 2;
    else if (check.status === 'unknown') score -= weight / 4;
    // pass / skipped subtract 0.
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function resolvePdfImportReleaseGateDecision(input: {
  checks: PdfImportReleaseGateCheck[];
  score: number;
}): PdfImportReleaseGateDecision {
  const list = Array.isArray(input.checks) ? input.checks : [];
  const score = input.score;

  if (list.length === 0) return 'skipped';
  if (list.every((c) => c.status === 'skipped')) return 'skipped';

  const criticalFails = list.filter((c) => c.status === 'fail' && c.severity === 'critical').length;
  const highFails = list.filter((c) => c.status === 'fail' && c.severity === 'high').length;
  const anyFail = list.some((c) => c.status === 'fail');
  const anySoft = list.some((c) => c.status === 'warning' || c.status === 'unknown' || c.status === 'skipped');

  // fail: any critical fail, 2+ high fails, or score below 75.
  if (criticalFails > 0 || highFails >= 2 || score < 75) return 'fail';

  // A single high/medium/low fail still blocks unless the score stays high; but
  // per policy a lone non-critical fail that keeps score >= 75 downgrades to
  // pass_with_warnings so the reviewer can accept it explicitly.
  if (anyFail) return 'pass_with_warnings';

  // pass: no fail/warning/unknown AND score >= 95.
  if (!anySoft && score >= 95) return 'pass';

  // pass_with_warnings: no fails, score >= 75, some soft signals present.
  return 'pass_with_warnings';
}

export function evaluatePdfImportReleaseGate(
  options: EvaluatePdfImportReleaseGateOptions,
): PdfImportReleaseGateReport {
  const now = options?.now ?? (() => new Date());
  const mode = options?.mode ?? 'static';
  const checks = Array.isArray(options?.checks) ? options.checks : [];

  const summary = summarizePdfImportReleaseGateChecks(checks);
  const score = calculatePdfImportReleaseGateScore(checks);
  const decision = resolvePdfImportReleaseGateDecision({ checks, score });

  return {
    version: PDF_IMPORT_RELEASE_GATE_VERSION,
    mode,
    decision,
    score,
    checks,
    summary,
    generatedAt: now().toISOString(),
    branch: options?.branch ?? null,
    commit: options?.commit ?? null,
  };
}
