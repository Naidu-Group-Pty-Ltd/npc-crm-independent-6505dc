import { describe, expect, it } from 'vitest';
import {
  buildEmptyGoldenCorpusSnapshot,
  getGoldenCorpusItem,
  type GoldenCorpusImportQualitySnapshot,
  type GoldenCorpusRunEvaluation,
} from '../ingestion/goldenCorpus';
import {
  evaluatePdfImportQualityGates,
  resolveOverallQualityGateStatus,
  summarizeQualityGates,
  type PdfImportQualityGate,
  type PdfImportQualityGateReport,
  type PdfImportQualityGateStatus,
} from '../ingestion/qualityGates';

const NOW = () => new Date('2026-07-04T00:00:00.000Z');

/** A snapshot that PASSES every gate for golden-simple-001 (thresholds 0.90). */
function goodSnapshot(
  overrides: Partial<GoldenCorpusImportQualitySnapshot> = {},
): GoldenCorpusImportQualitySnapshot {
  return {
    ...buildEmptyGoldenCorpusSnapshot('imp-1'),
    templateId: 'tpl-1',
    importStatus: 'completed',
    engineVersion: 'docling-1.0',
    importPageCount: 1,
    templatePageCount: 1,
    visualQaArtifactPath: 'imp-1/visual-quality.json',
    visualQaScore: 0.95,
    visualQaManualReviewRequired: false,
    repairArtifactPath: 'imp-1/repair/repair-loop.json',
    repairStatus: 'completed',
    repairFinalScore: 0.96,
    repairRequiresFallback: false,
    repairRequiresManualReview: false,
    aiReconciliationStatus: null,
    aiReconciliationRecommendation: 'not_needed',
    exportParityArtifactPath: 'imp-1/export-parity/export-parity.json',
    exportParityStatus: 'completed',
    exportParityMode: 'manual',
    exportVsSourceScore: 0.94,
    ...overrides,
  };
}

function makeEvaluation(
  corpusId: string,
  snapshotOverrides: Partial<GoldenCorpusImportQualitySnapshot> = {},
): GoldenCorpusRunEvaluation {
  const corpus = getGoldenCorpusItem(corpusId);
  if (!corpus) throw new Error(`test setup: unknown corpus ${corpusId}`);
  return {
    version: 'pdf-import-golden-run-v1',
    runId: 'run-1',
    corpusId,
    category: corpus.category,
    status: 'validated',
    decision: 'pass',
    warnings: [],
    failures: [],
    snapshot: goodSnapshot(snapshotOverrides),
    corpus,
    evaluatedAt: NOW().toISOString(),
  };
}

function gateById(report: PdfImportQualityGateReport, id: string): PdfImportQualityGate {
  const g = report.gates.find((x) => x.id === id);
  if (!g) throw new Error(`gate not found: ${id}`);
  return g;
}

function run(corpusId: string, overrides: Partial<GoldenCorpusImportQualitySnapshot> = {}) {
  return evaluatePdfImportQualityGates({ evaluation: makeEvaluation(corpusId, overrides), now: NOW });
}

describe('evaluatePdfImportQualityGates', () => {
  it('passes a perfect simple run with no fail/blocked gates', () => {
    const report = run('golden-simple-001');
    expect(report.overallStatus).toBe('pass');
    expect(report.gates.filter((g) => g.status === 'fail' || g.status === 'blocked')).toHaveLength(0);
    expect(report.version).toBe('pdf-import-quality-gates-v1');
  });

  it('is not_evaluated when the importId is missing', () => {
    const evaluation = makeEvaluation('golden-simple-001');
    evaluation.snapshot = buildEmptyGoldenCorpusSnapshot(null);
    const report = evaluatePdfImportQualityGates({ evaluation, now: NOW });
    expect(gateById(report, 'import_completed').status).toBe('not_evaluated');
    expect(report.overallStatus).toBe('not_evaluated');
  });

  it('fails when the import failed', () => {
    const report = run('golden-simple-001', { importStatus: 'failed' });
    expect(gateById(report, 'import_completed').status).toBe('fail');
    expect(report.overallStatus).toBe('fail');
  });

  it('blocks when the import is not completed', () => {
    const report = run('golden-simple-001', { importStatus: 'processing' });
    expect(gateById(report, 'import_completed').status).toBe('blocked');
    expect(report.overallStatus).toBe('blocked');
  });

  it('fails when the template is missing', () => {
    const report = run('golden-simple-001', { templateId: null });
    expect(gateById(report, 'template_created').status).toBe('fail');
    expect(report.overallStatus).toBe('fail');
  });

  it('fails on a page-count mismatch', () => {
    const report = run('golden-simple-001', { importPageCount: 1, templatePageCount: 2 });
    expect(gateById(report, 'template_page_count_match').status).toBe('fail');
  });

  it('fails when the Visual QA artifact is missing', () => {
    const report = run('golden-simple-001', { visualQaArtifactPath: null });
    expect(gateById(report, 'visual_quality_artifact_present').status).toBe('fail');
  });

  it('fails when Visual QA is below the registry threshold', () => {
    const report = run('golden-simple-001', { visualQaScore: 0.5 });
    expect(gateById(report, 'visual_quality_score_threshold').status).toBe('fail');
  });

  it('warns when Visual QA score is missing but the artifact is present', () => {
    const report = run('golden-simple-001', { visualQaScore: null });
    expect(gateById(report, 'visual_quality_score_threshold').status).toBe('warning');
  });

  it('fails when the repair audit is missing', () => {
    const report = run('golden-simple-001', { repairArtifactPath: null });
    expect(gateById(report, 'repair_audit_present').status).toBe('fail');
  });

  it('warns (not fails) when repair was skipped', () => {
    const report = run('golden-simple-001', { repairStatus: 'skipped', repairFinalScore: null });
    expect(gateById(report, 'repair_status_acceptable').status).toBe('warning');
    expect(gateById(report, 'repair_final_score_threshold').status).toBe('warning');
    expect(report.overallStatus).toBe('warning');
  });

  it('fails when repair failed', () => {
    const report = run('golden-simple-001', { repairStatus: 'failed' });
    expect(gateById(report, 'repair_status_acceptable').status).toBe('fail');
  });

  it('fails when the repair final score is below threshold', () => {
    const report = run('golden-simple-001', { repairStatus: 'completed', repairFinalScore: 0.5 });
    expect(gateById(report, 'repair_final_score_threshold').status).toBe('fail');
  });

  it('warns for manual review when the corpus allows it (OCR)', () => {
    const report = run('golden-ocr-001', { visualQaManualReviewRequired: true });
    expect(gateById(report, 'manual_review_policy').status).toBe('warning');
  });

  it('fails for manual review when the corpus disallows it (simple)', () => {
    const report = run('golden-simple-001', { visualQaManualReviewRequired: true });
    expect(gateById(report, 'manual_review_policy').status).toBe('fail');
  });

  it('warns for fallback when the corpus allows it (design)', () => {
    const report = run('golden-design-001', { repairRequiresFallback: true });
    expect(gateById(report, 'fallback_policy').status).toBe('warning');
  });

  it('fails for fallback when the corpus disallows it (simple)', () => {
    const report = run('golden-simple-001', { repairRequiresFallback: true });
    expect(gateById(report, 'fallback_policy').status).toBe('fail');
  });

  it('warns (not fails) when AI reconciliation was recommended but not run', () => {
    const report = run('golden-simple-001', { aiReconciliationRecommendation: 'recommended', aiReconciliationStatus: null });
    expect(gateById(report, 'ai_reconciliation_policy').status).toBe('warning');
    expect(report.gates.filter((g) => g.status === 'fail')).toHaveLength(0);
  });

  it('passes when AI reconciliation completed', () => {
    const report = run('golden-simple-001', { aiReconciliationStatus: 'completed', aiReconciliationRecommendation: 'recommended' });
    expect(gateById(report, 'ai_reconciliation_policy').status).toBe('pass');
  });

  it('fails when export parity is missing', () => {
    const report = run('golden-simple-001', { exportParityArtifactPath: null, exportParityStatus: null, exportVsSourceScore: null });
    expect(gateById(report, 'export_parity_artifact_present').status).toBe('fail');
  });

  it('warns when export parity is manual_required', () => {
    const report = run('golden-simple-001', { exportParityStatus: 'manual_required' });
    expect(gateById(report, 'export_parity_status_acceptable').status).toBe('warning');
  });

  it('fails when export parity failed', () => {
    const report = run('golden-simple-001', { exportParityStatus: 'failed' });
    expect(gateById(report, 'export_parity_status_acceptable').status).toBe('fail');
  });

  it('fails when export parity score is below threshold', () => {
    const report = run('golden-simple-001', { exportVsSourceScore: 0.5 });
    expect(gateById(report, 'export_parity_score_threshold').status).toBe('fail');
  });

  it('warns when the engine version is missing', () => {
    const report = run('golden-simple-001', { engineVersion: null });
    expect(gateById(report, 'engine_version_present').status).toBe('warning');
  });

  it('produces a summary whose counts add up to the number of gates', () => {
    const report = run('golden-simple-001', { visualQaScore: 0.5 });
    const s = report.summary;
    expect(s.total).toBe(report.gates.length);
    expect(s.pass + s.warning + s.fail + s.blocked + s.notEvaluated).toBe(s.total);
    expect(s.fail).toBeGreaterThanOrEqual(1);
  });
});

describe('quality gate helpers', () => {
  const mk = (status: PdfImportQualityGateStatus): PdfImportQualityGate => ({
    id: `g-${status}`,
    category: 'import',
    label: status,
    status,
    severity: 'info',
    message: '',
    blocking: status === 'blocked',
  });

  it('summarizeQualityGates counts every status', () => {
    const gates = [mk('pass'), mk('pass'), mk('warning'), mk('fail'), mk('blocked'), mk('not_evaluated')];
    expect(summarizeQualityGates(gates)).toEqual({
      total: 6, pass: 2, warning: 1, fail: 1, blocked: 1, notEvaluated: 1,
    });
  });

  it('resolveOverallQualityGateStatus enforces blocked > fail > warning > pass', () => {
    expect(resolveOverallQualityGateStatus([mk('pass'), mk('warning'), mk('fail'), mk('blocked')])).toBe('blocked');
    expect(resolveOverallQualityGateStatus([mk('pass'), mk('warning'), mk('fail')])).toBe('fail');
    expect(resolveOverallQualityGateStatus([mk('pass'), mk('warning')])).toBe('warning');
    expect(resolveOverallQualityGateStatus([mk('pass'), mk('pass')])).toBe('pass');
    expect(resolveOverallQualityGateStatus([mk('not_evaluated'), mk('not_evaluated')])).toBe('not_evaluated');
    expect(resolveOverallQualityGateStatus([])).toBe('not_evaluated');
  });
});
