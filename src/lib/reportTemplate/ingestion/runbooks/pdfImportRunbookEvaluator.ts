/**
 * pdfImportRunbookEvaluator — Phase 11F runbook readiness evaluation.
 *
 * Pure. Given the registry and (optionally) file contents keyed by path,
 * determines whether each runbook is ready / missing / incomplete / needs
 * review, and rolls up a readiness score. No I/O.
 */
import {
  PDF_IMPORT_RUNBOOK_REGISTRY_VERSION,
  type PdfImportRunbookCriticality,
  type PdfImportRunbookDefinition,
  type PdfImportRunbookReadinessReport,
  type PdfImportRunbookReadinessResult,
} from './pdfImportRunbookTypes';

const MISSING_WEIGHT: Record<PdfImportRunbookCriticality, number> = {
  critical: 20,
  high: 10,
  medium: 5,
  low: 2,
  info: 0,
};

const PLACEHOLDER_RE = /\b(TODO|TBD|FIXME|XXX)\b/i;

export function evaluatePdfImportRunbook(input: {
  runbook: PdfImportRunbookDefinition;
  content?: string | null;
}): PdfImportRunbookReadinessResult {
  const { runbook } = input;
  const content = input.content;
  const base = {
    id: runbook.id,
    title: runbook.title,
    path: runbook.path,
    domain: runbook.domain,
    criticality: runbook.criticality,
  };

  if (content == null || String(content).trim() === '') {
    return { ...base, status: 'missing', missingSections: [...runbook.requiredSections], warnings: ['content_missing'] };
  }

  const lower = String(content).toLowerCase();
  const missingSections = runbook.requiredSections.filter((s) => !lower.includes(s.toLowerCase()));
  const warnings: string[] = [];

  if (PLACEHOLDER_RE.test(content)) warnings.push('contains_placeholder');

  let status: PdfImportRunbookReadinessResult['status'];
  if (missingSections.length > 0) {
    status = 'incomplete';
  } else if (warnings.includes('contains_placeholder')) {
    status = 'needs_review';
  } else {
    status = 'ready';
  }

  return { ...base, status, missingSections, warnings };
}

export function calculatePdfImportRunbookReadinessScore(
  results: PdfImportRunbookReadinessResult[],
): number {
  let score = 100;
  for (const r of Array.isArray(results) ? results : []) {
    const weight = MISSING_WEIGHT[r.criticality] ?? 0;
    if (r.status === 'missing') score -= weight;
    else if (r.status === 'incomplete') score -= weight / 2;
    else if (r.status === 'needs_review') score -= 2;
    // ready / unknown subtract 0.
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function evaluatePdfImportRunbookReadiness(input: {
  runbooks: PdfImportRunbookDefinition[];
  fileContentsByPath?: Record<string, string>;
  now?: () => Date;
}): PdfImportRunbookReadinessReport {
  const now = input?.now ?? (() => new Date());
  const runbooks = Array.isArray(input?.runbooks) ? input.runbooks : [];
  const contents = input?.fileContentsByPath ?? {};

  const results = runbooks.map((runbook) =>
    evaluatePdfImportRunbook({
      runbook,
      content: Object.prototype.hasOwnProperty.call(contents, runbook.path) ? contents[runbook.path] : undefined,
    }),
  );

  const score = calculatePdfImportRunbookReadinessScore(results);

  return {
    version: PDF_IMPORT_RUNBOOK_REGISTRY_VERSION,
    results,
    total: results.length,
    ready: results.filter((r) => r.status === 'ready').length,
    missing: results.filter((r) => r.status === 'missing').length,
    incomplete: results.filter((r) => r.status === 'incomplete').length,
    needsReview: results.filter((r) => r.status === 'needs_review').length,
    criticalMissing: results.filter((r) => r.status === 'missing' && r.criticality === 'critical').length,
    highMissing: results.filter((r) => r.status === 'missing' && r.criticality === 'high').length,
    score,
    generatedAt: now().toISOString(),
  };
}
