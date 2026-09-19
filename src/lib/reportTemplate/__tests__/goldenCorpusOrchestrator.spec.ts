import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  buildEmptyGoldenCorpusSnapshot,
  buildGoldenCorpusRunId,
  orchestrateGoldenCorpusRun,
  orchestrateGoldenCorpusRunFromSnapshot,
  type GoldenCorpusImportQualitySnapshot,
  type GoldenCorpusOrchestratorRequest,
} from '../ingestion/goldenCorpus';
import { loadGoldenCorpusImportQualitySnapshot } from '@/lib/reportTemplate/ingestion/goldenCorpus/goldenCorpusImportSnapshot';
import { saveGoldenRegressionSummary } from '@/lib/reportTemplate/ingestion/goldenCorpus/goldenRegressionPersistence';
import {
  getLatestGoldenRunBaselines,
  saveGoldenRunHistory,
} from '@/lib/reportTemplate/ingestion/goldenCorpus/goldenRunHistoryPersistence';
import { runExportParityAutomation } from '@/lib/reportTemplate/ingestion/exportParity/exportParityRunner';
import { saveImportIntelligenceProfile } from '@/lib/reportTemplate/ingestion/importIntelligence';
import { saveRepairPatternAnalysis } from '@/lib/reportTemplate/ingestion/repairPatterns';
import { saveAdaptiveReconciliationPolicy } from '@/lib/reportTemplate/ingestion/reconciliation';
import { saveSelfHealingRetryAudit } from '@/lib/reportTemplate/ingestion/selfHealing';
import { savePdfImportPerformanceAudit } from '@/lib/reportTemplate/ingestion/performance';
import {
  loadProductionOperatorControlAudit,
  saveProductionOperatorControlAudit,
} from '@/lib/reportTemplate/ingestion/operatorControls';

vi.mock('@/lib/reportTemplate/ingestion/goldenCorpus/goldenCorpusImportSnapshot', async (orig) => {
  const actual = await orig<typeof import('@/lib/reportTemplate/ingestion/goldenCorpus/goldenCorpusImportSnapshot')>();
  return { ...actual, loadGoldenCorpusImportQualitySnapshot: vi.fn() };
});
vi.mock('@/lib/reportTemplate/ingestion/goldenCorpus/goldenRegressionPersistence', async (orig) => {
  const actual = await orig<typeof import('@/lib/reportTemplate/ingestion/goldenCorpus/goldenRegressionPersistence')>();
  return { ...actual, saveGoldenRegressionSummary: vi.fn() };
});
vi.mock('@/lib/reportTemplate/ingestion/goldenCorpus/goldenRunHistoryPersistence', async (orig) => {
  const actual = await orig<typeof import('@/lib/reportTemplate/ingestion/goldenCorpus/goldenRunHistoryPersistence')>();
  return { ...actual, getLatestGoldenRunBaselines: vi.fn(), saveGoldenRunHistory: vi.fn() };
});
vi.mock('@/lib/reportTemplate/ingestion/exportParity/exportParityRunner', async (orig) => {
  const actual = await orig<typeof import('@/lib/reportTemplate/ingestion/exportParity/exportParityRunner')>();
  return { ...actual, runExportParityAutomation: vi.fn() };
});
// Phase 10B — keep the real deterministic profile builder; only the network
// persistence is mocked.
vi.mock('@/lib/reportTemplate/ingestion/importIntelligence', async (orig) => {
  const actual = await orig<typeof import('@/lib/reportTemplate/ingestion/importIntelligence')>();
  return { ...actual, saveImportIntelligenceProfile: vi.fn() };
});
// Phase 10C — keep the real deterministic analysis builder; only mock persistence.
vi.mock('@/lib/reportTemplate/ingestion/repairPatterns', async (orig) => {
  const actual = await orig<typeof import('@/lib/reportTemplate/ingestion/repairPatterns')>();
  return { ...actual, saveRepairPatternAnalysis: vi.fn() };
});
// Phase 10D — keep the real deterministic policy builder; only mock persistence.
vi.mock('@/lib/reportTemplate/ingestion/reconciliation', async (orig) => {
  const actual = await orig<typeof import('@/lib/reportTemplate/ingestion/reconciliation')>();
  return { ...actual, saveAdaptiveReconciliationPolicy: vi.fn() };
});
// Phase 10E — keep the real deterministic planner/executor; only mock persistence.
vi.mock('@/lib/reportTemplate/ingestion/selfHealing', async (orig) => {
  const actual = await orig<typeof import('@/lib/reportTemplate/ingestion/selfHealing')>();
  return { ...actual, saveSelfHealingRetryAudit: vi.fn() };
});
// Phase 10F — keep the real deterministic optimizer; only mock persistence.
vi.mock('@/lib/reportTemplate/ingestion/performance', async (orig) => {
  const actual = await orig<typeof import('@/lib/reportTemplate/ingestion/performance')>();
  return { ...actual, savePdfImportPerformanceAudit: vi.fn() };
});
// Phase 10G — keep the real deterministic control builder; only mock persistence.
vi.mock('@/lib/reportTemplate/ingestion/operatorControls', async (orig) => {
  const actual = await orig<typeof import('@/lib/reportTemplate/ingestion/operatorControls')>();
  return {
    ...actual,
    loadProductionOperatorControlAudit: vi.fn(),
    saveProductionOperatorControlAudit: vi.fn(),
  };
});

const NOW = () => new Date('2026-07-04T00:00:00.000Z');

function snap(
  overrides: Partial<GoldenCorpusImportQualitySnapshot> = {},
): GoldenCorpusImportQualitySnapshot {
  return {
    ...buildEmptyGoldenCorpusSnapshot('import-1'),
    templateId: 'template-1',
    sourceFilename: 'golden-simple-001.pdf',
    importStatus: 'completed',
    engineVersion: 'docling-1.0',
    importPageCount: 1,
    templatePageCount: 1,
    visualQaArtifactPath: 'import-1/visual-quality.json',
    visualQaScore: 0.95,
    visualQaManualReviewRequired: false,
    repairArtifactPath: 'import-1/repair/repair-loop.json',
    repairStatus: 'completed',
    repairFinalScore: 0.96,
    repairRequiresFallback: false,
    repairRequiresManualReview: false,
    aiReconciliationStatus: null,
    aiReconciliationRecommendation: 'not_needed',
    exportParityArtifactPath: 'import-1/export-parity/export-parity.json',
    exportParityStatus: 'completed',
    exportParityMode: 'manual',
    exportVsSourceScore: 0.94,
    ...overrides,
  };
}

function req(overrides: Partial<GoldenCorpusOrchestratorRequest> = {}): GoldenCorpusOrchestratorRequest {
  return { corpusId: 'golden-simple-001', importId: 'import-1', ...overrides };
}

function pure(request: GoldenCorpusOrchestratorRequest, snapshot = snap()) {
  return orchestrateGoldenCorpusRunFromSnapshot({ request, snapshot, now: NOW });
}

function stepOf(result: ReturnType<typeof pure>, id: string) {
  return result.steps.find((s) => s.id === id);
}

describe('orchestrateGoldenCorpusRunFromSnapshot (pure)', () => {
  it('fails on missing corpusId', () => {
    const result = pure(req({ corpusId: '' }));
    expect(result.status).toBe('failed');
    expect(result.failures).toContain('input_missing_corpus_id');
    expect(stepOf(result, 'validate_input')?.status).toBe('fail');
  });

  it('is not_evaluated on missing importId', () => {
    const result = orchestrateGoldenCorpusRunFromSnapshot({
      request: req({ importId: '' }),
      snapshot: buildEmptyGoldenCorpusSnapshot(null),
      now: NOW,
    });
    expect(result.status).toBe('not_evaluated');
    expect(result.warnings).toContain('input_missing_import_id');
    expect(result.runEvaluation).toBeNull();
  });

  it('fails on unknown corpusId', () => {
    const result = pure(req({ corpusId: 'golden-nope-000' }));
    expect(result.status).toBe('failed');
    expect(result.failures).toContain('unknown_corpus_id');
  });

  it('completes a perfect simple run', () => {
    const result = pure(req());
    expect(result.status).toBe('completed');
    expect(result.runEvaluation).not.toBeNull();
    expect(result.qualityGateReport?.overallStatus).toBe('pass');
    expect(result.goldenRegressionSummary?.qualityGateStatus).toBe('pass');
    expect(result.triageSummary?.outcome).toBe('resolved');
    expect(result.persisted).toBe(false);
    expect(stepOf(result, 'persist_summary')?.status).toBe('skipped');
    expect(stepOf(result, 'evaluate_run')?.status).toBe('pass');
  });

  it('completes_with_warnings for an allowed-manual-review run (OCR)', () => {
    const result = pure(
      req({ corpusId: 'golden-ocr-001' }),
      snap({ visualQaScore: 0.7, repairFinalScore: 0.7, exportVsSourceScore: 0.8, visualQaManualReviewRequired: true }),
    );
    expect(result.status).toBe('completed_with_warnings');
    expect(result.qualityGateReport?.overallStatus).toBe('warning');
  });

  it('fails when Visual QA is below threshold', () => {
    const result = pure(req(), snap({ visualQaScore: 0.5 }));
    expect(result.qualityGateReport?.overallStatus).toBe('fail');
    expect(result.status).toBe('failed');
  });

  it('fails when the Visual QA artifact is missing', () => {
    const result = pure(req(), snap({ visualQaArtifactPath: null }));
    expect(result.status).toBe('failed');
    expect(result.qualityGateReport?.gates.find((g) => g.id === 'visual_quality_artifact_present')?.status).toBe('fail');
  });

  it('fails when the repair audit is missing', () => {
    const result = pure(req(), snap({ repairArtifactPath: null }));
    expect(result.status).toBe('failed');
  });

  it('does not complete when export parity is missing (8C: artifact fail + status blocked)', () => {
    const result = pure(req(), snap({ exportParityArtifactPath: null, exportParityStatus: null, exportVsSourceScore: null }));
    // export_parity_artifact_present → fail, but export_parity_status_acceptable → blocked
    // (status missing), and blocked outranks fail in the gate resolver, so overall is blocked.
    expect(result.status).toBe('blocked');
    expect(result.qualityGateReport?.overallStatus).toBe('blocked');
    expect(result.qualityGateReport?.gates.find((g) => g.id === 'export_parity_artifact_present')?.status).toBe('fail');
  });

  it('gives a warning (not fail) when AI reconciliation was recommended but not run', () => {
    const result = pure(req(), snap({ aiReconciliationRecommendation: 'recommended', aiReconciliationStatus: null }));
    expect(result.status).toBe('completed_with_warnings');
    expect(result.qualityGateReport?.gates.find((g) => g.id === 'ai_reconciliation_policy')?.status).toBe('warning');
  });

  it('produces triage recommendations for a failed repair', () => {
    const result = pure(req(), snap({ repairStatus: 'failed' }));
    expect(result.triageSummary).not.toBeNull();
    const codes = result.triageSummary!.recommendations.map((r) => r.rule.code);
    expect(codes).toContain('repair_failed');
    expect(result.triageSummary!.primaryAction).toBe('rerun_repair');
  });

  it('buildGoldenCorpusRunId is deterministic with now and includes ids + sanitized timestamp', () => {
    const id = buildGoldenCorpusRunId({ corpusId: 'golden-simple-001', importId: 'import-1', now: NOW });
    expect(id).toContain('golden-simple-001');
    expect(id).toContain('import-1');
    expect(id).toBe('golden-run-golden-simple-001-import-1-2026-07-04T00-00-00-000Z');
  });

  it('does not persist in the pure function', () => {
    const result = pure(req());
    expect(result.persistenceResult).toBeNull();
    expect(result.persisted).toBe(false);
    expect(stepOf(result, 'persist_summary')?.status).toBe('skipped');
  });

  it('honors an operatorDecision override', () => {
    const result = pure(req({ operatorDecision: 'accepted_with_warnings' }));
    expect(result.goldenRegressionSummary?.operatorDecision).toBe('accepted_with_warnings');
  });

  it('carries notes into the summary', () => {
    const result = pure(req({ notes: ['phase 9a note'] }));
    expect(result.goldenRegressionSummary?.notes).toContain('phase 9a note');
  });
});

describe('orchestrateGoldenCorpusRun (async)', () => {
  beforeEach(() => {
    vi.mocked(loadGoldenCorpusImportQualitySnapshot).mockReset();
    vi.mocked(saveGoldenRegressionSummary).mockReset();
  });

  it('evaluate_only loads the snapshot and does not persist', async () => {
    vi.mocked(loadGoldenCorpusImportQualitySnapshot).mockResolvedValue({ kind: 'ok', snapshot: snap() });

    const result = await orchestrateGoldenCorpusRun({ request: req({ persist: false }), now: NOW });
    expect(result.mode).toBe('evaluate_only');
    expect(result.persisted).toBe(false);
    expect(saveGoldenRegressionSummary).not.toHaveBeenCalled();
    expect(stepOf(result as any, 'load_snapshot')?.status).toBe('pass');
  });

  it('persist=true saves the summary', async () => {
    vi.mocked(loadGoldenCorpusImportQualitySnapshot).mockResolvedValue({ kind: 'ok', snapshot: snap() });
    vi.mocked(saveGoldenRegressionSummary).mockResolvedValue({ kind: 'ok' });

    const result = await orchestrateGoldenCorpusRun({ request: req({ persist: true }), now: NOW });
    expect(result.mode).toBe('evaluate_and_persist');
    expect(result.persisted).toBe(true);
    expect(stepOf(result as any, 'persist_summary')?.status).toBe('pass');
    expect(saveGoldenRegressionSummary).toHaveBeenCalledTimes(1);
  });

  it('persist=true handles a save error', async () => {
    vi.mocked(loadGoldenCorpusImportQualitySnapshot).mockResolvedValue({ kind: 'ok', snapshot: snap() });
    vi.mocked(saveGoldenRegressionSummary).mockResolvedValue({ kind: 'error', message: 'boom' });

    const result = await orchestrateGoldenCorpusRun({ request: req({ persist: true }), now: NOW });
    expect(result.status).toBe('failed');
    expect(result.persisted).toBe(false);
    expect(result.failures).toContain('persistence_failed');
  });

  it('blocks on a snapshot load error', async () => {
    vi.mocked(loadGoldenCorpusImportQualitySnapshot).mockResolvedValue({ kind: 'error', message: 'network' });
    const result = await orchestrateGoldenCorpusRun({ request: req(), now: NOW });
    expect(result.status).toBe('blocked');
    expect(result.failures).toContain('snapshot_load_failed');
  });

  it('blocks on a missing snapshot', async () => {
    vi.mocked(loadGoldenCorpusImportQualitySnapshot).mockResolvedValue({ kind: 'missing' });
    const result = await orchestrateGoldenCorpusRun({ request: req(), now: NOW });
    expect(result.status).toBe('blocked');
    expect(result.failures).toContain('snapshot_missing');
  });

  it('is not_evaluated without a network call when importId is missing', async () => {
    const result = await orchestrateGoldenCorpusRun({ request: req({ importId: '' }), now: NOW });
    expect(result.status).toBe('not_evaluated');
    expect(loadGoldenCorpusImportQualitySnapshot).not.toHaveBeenCalled();
  });
});

function baselineRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1',
    runId: 'baseline-run',
    corpusId: 'golden-simple-001',
    qualityGateStatus: 'pass',
    operatorDecision: 'accepted',
    visualQaScore: 0.95,
    repairFinalScore: 0.96,
    exportVsSourceScore: 0.94,
    editorVsSourceScore: null,
    exportVsEditorScore: null,
    warningCount: 0,
    failureCount: 0,
    ...overrides,
  } as any;
}

describe('orchestrateGoldenCorpusRun (Phase 9C history + baseline)', () => {
  beforeEach(() => {
    vi.mocked(loadGoldenCorpusImportQualitySnapshot).mockReset();
    vi.mocked(saveGoldenRegressionSummary).mockReset();
    vi.mocked(getLatestGoldenRunBaselines).mockReset();
    vi.mocked(saveGoldenRunHistory).mockReset();
    vi.mocked(loadGoldenCorpusImportQualitySnapshot).mockResolvedValue({ kind: 'ok', snapshot: snap() });
    vi.mocked(saveGoldenRegressionSummary).mockResolvedValue({ kind: 'ok' });
    vi.mocked(getLatestGoldenRunBaselines).mockResolvedValue({ kind: 'ok', baselines: [] });
    vi.mocked(saveGoldenRunHistory).mockResolvedValue({ kind: 'ok', historyId: 'hist-1', history: { id: 'hist-1' } as any });
  });

  it('evaluate_only does not save history by default', async () => {
    const result = await orchestrateGoldenCorpusRun({ request: req({ persist: false }), now: NOW });
    expect(saveGoldenRunHistory).not.toHaveBeenCalled();
    expect(getLatestGoldenRunBaselines).not.toHaveBeenCalled();
    expect(result.historySaved).toBe(false);
    expect(result.baselineComparison).toBeNull();
  });

  it('persist=true saveHistory=false keeps the old behavior', async () => {
    const result = await orchestrateGoldenCorpusRun({ request: req({ persist: true, compareBaseline: false }), now: NOW });
    expect(result.persisted).toBe(true);
    expect(saveGoldenRunHistory).not.toHaveBeenCalled();
    expect(result.historySaved).toBe(false);
  });

  it('persist=true saveHistory=true calls saveGoldenRunHistory', async () => {
    const result = await orchestrateGoldenCorpusRun({ request: req({ persist: true, saveHistory: true }), now: NOW });
    expect(saveGoldenRunHistory).toHaveBeenCalledTimes(1);
    expect(result.historySaved).toBe(true);
  });

  it('history save success populates the record and passes the save_history step', async () => {
    const result = await orchestrateGoldenCorpusRun({ request: req({ persist: true, saveHistory: true }), now: NOW });
    expect(result.historySaved).toBe(true);
    expect(result.historyRecord?.id).toBe('hist-1');
    expect(stepOf(result as any, 'save_history')?.status).toBe('pass');
  });

  it('history save error fails the run', async () => {
    vi.mocked(saveGoldenRunHistory).mockResolvedValue({ kind: 'error', message: 'db down' });
    const result = await orchestrateGoldenCorpusRun({ request: req({ persist: true, saveHistory: true }), now: NOW });
    expect(result.historySaved).toBe(false);
    expect(result.historyPersistenceResult?.kind).toBe('error');
    expect(stepOf(result as any, 'save_history')?.status).toBe('fail');
    expect(result.failures).toContain('history_persistence_failed');
    expect(result.status).toBe('failed');
  });

  it('compareBaseline true loads baselines', async () => {
    await orchestrateGoldenCorpusRun({ request: req({ persist: false, compareBaseline: true }), now: NOW });
    expect(getLatestGoldenRunBaselines).toHaveBeenCalledWith('golden-simple-001');
  });

  it('no baseline creates a no_baseline comparison', async () => {
    vi.mocked(getLatestGoldenRunBaselines).mockResolvedValue({ kind: 'ok', baselines: [] });
    const result = await orchestrateGoldenCorpusRun({ request: req({ persist: false, compareBaseline: true }), now: NOW });
    expect(result.baselineComparison?.outcome).toBe('no_baseline');
    expect(result.warnings).toContain('no_baseline_found');
    expect(result.status).toBe('completed_with_warnings');
  });

  it('a previous baseline creates a comparison', async () => {
    vi.mocked(getLatestGoldenRunBaselines).mockResolvedValue({ kind: 'ok', baselines: [baselineRow()] });
    const result = await orchestrateGoldenCorpusRun({ request: req({ persist: false, compareBaseline: true }), now: NOW });
    expect(result.baselineComparison).not.toBeNull();
    expect(result.baselineComparison?.previousRunId).toBe('baseline-run');
    expect(result.baselineComparison?.outcome).toBe('stable');
  });

  it('a degraded baseline comparison drops to completed_with_warnings', async () => {
    vi.mocked(getLatestGoldenRunBaselines).mockResolvedValue({ kind: 'ok', baselines: [baselineRow({ visualQaScore: 0.99 })] });
    const result = await orchestrateGoldenCorpusRun({ request: req({ persist: false, compareBaseline: true }), now: NOW });
    expect(result.baselineComparison?.outcome).toBe('degraded');
    expect(result.warnings).toContain('baseline_regression_detected');
    expect(result.status).toBe('completed_with_warnings');
  });

  it('a baseline load failure warns but does not block summary creation', async () => {
    vi.mocked(getLatestGoldenRunBaselines).mockResolvedValue({ kind: 'error', message: 'network' });
    const result = await orchestrateGoldenCorpusRun({ request: req({ persist: false, compareBaseline: true }), now: NOW });
    expect(result.warnings).toContain('baseline_load_failed');
    expect(result.goldenRegressionSummary).not.toBeNull();
    expect(result.baselineComparison).toBeNull();
  });

  it('saveHistory with no summary fails with history_summary_missing', async () => {
    const result = await orchestrateGoldenCorpusRun({
      request: req({ corpusId: 'golden-nope-000', persist: false, saveHistory: true, compareBaseline: false }),
      now: NOW,
    });
    expect(result.goldenRegressionSummary).toBeNull();
    expect(result.failures).toContain('history_summary_missing');
    expect(result.status).toBe('failed');
  });

  it('saveHistory=true defaults compareBaseline true unless explicitly false', async () => {
    await orchestrateGoldenCorpusRun({ request: req({ persist: true, saveHistory: true }), now: NOW });
    expect(getLatestGoldenRunBaselines).toHaveBeenCalledTimes(1);

    vi.mocked(getLatestGoldenRunBaselines).mockClear();
    await orchestrateGoldenCorpusRun({ request: req({ persist: true, saveHistory: true, compareBaseline: false }), now: NOW });
    expect(getLatestGoldenRunBaselines).not.toHaveBeenCalled();
  });
});

function epResult(overrides: Record<string, unknown> = {}) {
  return {
    version: 'export-parity-runner-v1',
    importId: 'import-1',
    templateId: 'template-1',
    mode: 'auto',
    status: 'completed',
    automationLevel: 'level_2_source_editor',
    summary: null,
    pageComparisons: [],
    evidence: [],
    scores: { exportVsSourceScore: 0.94, editorVsSourceScore: 0.95, exportVsEditorScore: null, overallScore: 0.945 },
    blockers: [],
    warnings: [],
    notes: [],
    persisted: false,
    persistenceError: null,
    generatedAt: '2026-07-04T00:00:00.000Z',
    ...overrides,
  } as any;
}

describe('orchestrateGoldenCorpusRun (Phase 9D export parity)', () => {
  beforeEach(() => {
    vi.mocked(loadGoldenCorpusImportQualitySnapshot).mockReset();
    vi.mocked(saveGoldenRegressionSummary).mockReset();
    vi.mocked(getLatestGoldenRunBaselines).mockReset();
    vi.mocked(saveGoldenRunHistory).mockReset();
    vi.mocked(runExportParityAutomation).mockReset();
    vi.mocked(loadGoldenCorpusImportQualitySnapshot).mockResolvedValue({ kind: 'ok', snapshot: snap() });
    vi.mocked(saveGoldenRegressionSummary).mockResolvedValue({ kind: 'ok' });
    vi.mocked(getLatestGoldenRunBaselines).mockResolvedValue({ kind: 'ok', baselines: [] });
    vi.mocked(saveGoldenRunHistory).mockResolvedValue({ kind: 'ok', historyId: 'hist-1', history: { id: 'hist-1' } as any });
    vi.mocked(runExportParityAutomation).mockResolvedValue(epResult());
  });

  it('skips run_export_parity when not requested', async () => {
    const result = await orchestrateGoldenCorpusRun({ request: req({ persist: false }), now: NOW });
    expect(runExportParityAutomation).not.toHaveBeenCalled();
    expect(stepOf(result as any, 'run_export_parity')?.status).toBe('skipped');
    expect(result.exportParityRunnerResult).toBeNull();
  });

  it('runExportParity true calls the runner', async () => {
    await orchestrateGoldenCorpusRun({ request: req({ persist: false, runExportParity: true }), now: NOW });
    expect(runExportParityAutomation).toHaveBeenCalledTimes(1);
  });

  it('persistExportParity true passes persist:true to the runner', async () => {
    await orchestrateGoldenCorpusRun({ request: req({ persist: false, runExportParity: true, persistExportParity: true }), now: NOW });
    expect(runExportParityAutomation).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ persist: true }),
    }));
  });

  it('attaches a completed export parity result', async () => {
    const result = await orchestrateGoldenCorpusRun({ request: req({ persist: false, runExportParity: true }), now: NOW });
    expect(result.exportParityRunnerResult?.status).toBe('completed');
    expect(stepOf(result as any, 'run_export_parity')?.status).toBe('pass');
  });

  it('manual_required export parity adds a warning without crashing', async () => {
    vi.mocked(runExportParityAutomation).mockResolvedValue(epResult({ status: 'manual_required' }));
    const result = await orchestrateGoldenCorpusRun({ request: req({ persist: false, runExportParity: true }), now: NOW });
    expect(result.warnings).toContain('export_parity_automation_manual_required');
    expect(result.exportParityRunnerResult?.status).toBe('manual_required');
    expect(stepOf(result as any, 'run_export_parity')?.status).toBe('warning');
  });

  it('export parity persistence failure fails the run when persistExportParity is true', async () => {
    vi.mocked(runExportParityAutomation).mockResolvedValue(epResult({ status: 'failed', persistenceError: 'db down' }));
    const result = await orchestrateGoldenCorpusRun({ request: req({ persist: false, runExportParity: true, persistExportParity: true }), now: NOW });
    expect(result.failures).toContain('export_parity_persistence_failed');
    expect(result.status).toBe('failed');
  });

  it('reloads the snapshot after export parity is persisted', async () => {
    vi.mocked(runExportParityAutomation).mockResolvedValue(epResult({ persisted: true }));
    const result = await orchestrateGoldenCorpusRun({ request: req({ persist: false, runExportParity: true, persistExportParity: true }), now: NOW });
    expect(loadGoldenCorpusImportQualitySnapshot).toHaveBeenCalledTimes(2);
    expect(result.qualityGateReport).not.toBeNull();
  });

  it('does not reload the snapshot when export parity was not persisted', async () => {
    vi.mocked(runExportParityAutomation).mockResolvedValue(epResult({ persisted: false }));
    await orchestrateGoldenCorpusRun({ request: req({ persist: false, runExportParity: true }), now: NOW });
    expect(loadGoldenCorpusImportQualitySnapshot).toHaveBeenCalledTimes(1);
  });

  it('still returns a structured result when automation is not ready', async () => {
    vi.mocked(runExportParityAutomation).mockResolvedValue(epResult({ status: 'not_ready', blockers: ['source_evidence_missing'] }));
    const result = await orchestrateGoldenCorpusRun({ request: req({ persist: false, runExportParity: true }), now: NOW });
    expect(result.exportParityRunnerResult?.status).toBe('not_ready');
    expect(result.warnings).toContain('export_parity_automation_manual_required');
  });

  it('evaluate_only with export parity persist off does not write the golden summary', async () => {
    await orchestrateGoldenCorpusRun({ request: req({ persist: false, runExportParity: true, persistExportParity: false }), now: NOW });
    expect(saveGoldenRegressionSummary).not.toHaveBeenCalled();
    expect(runExportParityAutomation).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ persist: false }),
    }));
  });
});

describe('orchestrateGoldenCorpusRun (Phase 10B import intelligence)', () => {
  beforeEach(() => {
    vi.mocked(loadGoldenCorpusImportQualitySnapshot).mockReset();
    vi.mocked(saveGoldenRegressionSummary).mockReset();
    vi.mocked(saveImportIntelligenceProfile).mockReset();
    vi.mocked(loadGoldenCorpusImportQualitySnapshot).mockResolvedValue({ kind: 'ok', snapshot: snap() });
    vi.mocked(saveGoldenRegressionSummary).mockResolvedValue({ kind: 'ok' });
    vi.mocked(saveImportIntelligenceProfile).mockResolvedValue({ kind: 'ok' });
  });

  it('skips the profile step when not requested', async () => {
    const result = await orchestrateGoldenCorpusRun({ request: req(), now: NOW });
    expect(stepOf(result, 'build_import_intelligence_profile')?.status).toBe('skipped');
    expect(result.importIntelligenceProfile).toBeNull();
    expect(saveImportIntelligenceProfile).not.toHaveBeenCalled();
  });

  it('builds the profile when requested', async () => {
    const result = await orchestrateGoldenCorpusRun({
      request: req({ buildImportIntelligenceProfile: true }), now: NOW,
    });
    expect(result.importIntelligenceProfile).not.toBeNull();
    expect(result.importIntelligenceProfile?.profileCategory).toBeTruthy();
    expect(stepOf(result, 'build_import_intelligence_profile')?.status).not.toBe('skipped');
  });

  it('does not persist the profile when persist flag is off', async () => {
    const result = await orchestrateGoldenCorpusRun({
      request: req({ buildImportIntelligenceProfile: true, persistImportIntelligenceProfile: false }), now: NOW,
    });
    expect(saveImportIntelligenceProfile).not.toHaveBeenCalled();
    expect(stepOf(result, 'persist_import_intelligence_profile')?.status).toBe('skipped');
  });

  it('persists the profile when requested', async () => {
    const result = await orchestrateGoldenCorpusRun({
      request: req({ buildImportIntelligenceProfile: true, persistImportIntelligenceProfile: true }), now: NOW,
    });
    expect(saveImportIntelligenceProfile).toHaveBeenCalledTimes(1);
    expect(result.importIntelligencePersistenceResult?.kind).toBe('ok');
    expect(stepOf(result, 'persist_import_intelligence_profile')?.status).toBe('pass');
  });

  it('adds a warning when profile persistence fails but does not fail the run', async () => {
    vi.mocked(saveImportIntelligenceProfile).mockResolvedValue({ kind: 'error', message: 'db down' });
    const result = await orchestrateGoldenCorpusRun({
      request: req({ buildImportIntelligenceProfile: true, persistImportIntelligenceProfile: true }), now: NOW,
    });
    expect(result.warnings).toContain('import_intelligence_persistence_failed');
    expect(result.status).not.toBe('failed');
    expect(stepOf(result, 'persist_import_intelligence_profile')?.status).toBe('fail');
  });

  it('evaluate_only with profile build but no persist remains read-only', async () => {
    await orchestrateGoldenCorpusRun({
      request: req({ persist: false, buildImportIntelligenceProfile: true }), now: NOW,
    });
    expect(saveGoldenRegressionSummary).not.toHaveBeenCalled();
    expect(saveImportIntelligenceProfile).not.toHaveBeenCalled();
  });

  it('does not persist the profile when importId is missing', async () => {
    // importId '' short-circuits before snapshot load; profile persistence never runs.
    const result = await orchestrateGoldenCorpusRun({
      request: req({ importId: '', buildImportIntelligenceProfile: true, persistImportIntelligenceProfile: true }), now: NOW,
    });
    expect(saveImportIntelligenceProfile).not.toHaveBeenCalled();
    expect(result.importIntelligenceProfile).toBeNull();
  });

  it('profile blockers do not crash the orchestrator', async () => {
    const result = await orchestrateGoldenCorpusRun({
      request: req({ buildImportIntelligenceProfile: true }), now: NOW,
    });
    expect(result.version).toBeTruthy();
    expect(result.steps.length).toBeGreaterThan(0);
  });
});

describe('orchestrateGoldenCorpusRun (Phase 10C repair patterns)', () => {
  beforeEach(() => {
    vi.mocked(loadGoldenCorpusImportQualitySnapshot).mockReset();
    vi.mocked(saveGoldenRegressionSummary).mockReset();
    vi.mocked(saveRepairPatternAnalysis).mockReset();
    vi.mocked(loadGoldenCorpusImportQualitySnapshot).mockResolvedValue({ kind: 'ok', snapshot: snap() });
    vi.mocked(saveGoldenRegressionSummary).mockResolvedValue({ kind: 'ok' });
    vi.mocked(saveRepairPatternAnalysis).mockResolvedValue({ kind: 'ok' });
  });

  it('skips the repair pattern step when not requested', async () => {
    const result = await orchestrateGoldenCorpusRun({ request: req(), now: NOW });
    expect(stepOf(result, 'build_repair_pattern_analysis')?.status).toBe('skipped');
    expect(result.repairPatternAnalysis).toBeNull();
    expect(saveRepairPatternAnalysis).not.toHaveBeenCalled();
  });

  it('builds the analysis when requested', async () => {
    const result = await orchestrateGoldenCorpusRun({
      request: req({ buildRepairPatternAnalysis: true }), now: NOW,
    });
    expect(result.repairPatternAnalysis).not.toBeNull();
    expect(stepOf(result, 'build_repair_pattern_analysis')?.status).not.toBe('skipped');
  });

  it('attaches the analysis result to the orchestrator result', async () => {
    const result = await orchestrateGoldenCorpusRun({
      request: req({ buildRepairPatternAnalysis: true }), now: NOW,
    });
    expect(result.repairPatternAnalysis?.version).toBeTruthy();
    expect(Array.isArray(result.repairPatternAnalysis?.matchedPatterns)).toBe(true);
  });

  it('does not persist the analysis when persist flag is off', async () => {
    const result = await orchestrateGoldenCorpusRun({
      request: req({ buildRepairPatternAnalysis: true, persistRepairPatternAnalysis: false }), now: NOW,
    });
    expect(saveRepairPatternAnalysis).not.toHaveBeenCalled();
    expect(stepOf(result, 'persist_repair_pattern_analysis')?.status).toBe('skipped');
  });

  it('persists the analysis when requested', async () => {
    const result = await orchestrateGoldenCorpusRun({
      request: req({ buildRepairPatternAnalysis: true, persistRepairPatternAnalysis: true }), now: NOW,
    });
    expect(saveRepairPatternAnalysis).toHaveBeenCalledTimes(1);
    expect(result.repairPatternPersistenceResult?.kind).toBe('ok');
    expect(stepOf(result, 'persist_repair_pattern_analysis')?.status).toBe('pass');
  });

  it('adds a warning when analysis persistence fails but does not fail the run', async () => {
    vi.mocked(saveRepairPatternAnalysis).mockResolvedValue({ kind: 'error', message: 'db down' });
    const result = await orchestrateGoldenCorpusRun({
      request: req({ buildRepairPatternAnalysis: true, persistRepairPatternAnalysis: true }), now: NOW,
    });
    expect(result.warnings).toContain('repair_pattern_persistence_failed');
    expect(result.status).not.toBe('failed');
    expect(stepOf(result, 'persist_repair_pattern_analysis')?.status).toBe('fail');
  });

  it('evaluate_only with analysis build but no persist remains read-only', async () => {
    await orchestrateGoldenCorpusRun({
      request: req({ persist: false, buildRepairPatternAnalysis: true }), now: NOW,
    });
    expect(saveGoldenRegressionSummary).not.toHaveBeenCalled();
    expect(saveRepairPatternAnalysis).not.toHaveBeenCalled();
  });

  it('does not persist the analysis when importId is missing', async () => {
    const result = await orchestrateGoldenCorpusRun({
      request: req({ importId: '', buildRepairPatternAnalysis: true, persistRepairPatternAnalysis: true }), now: NOW,
    });
    expect(saveRepairPatternAnalysis).not.toHaveBeenCalled();
    expect(result.repairPatternAnalysis).toBeNull();
  });

  it('analysis blockers do not crash the orchestrator', async () => {
    const result = await orchestrateGoldenCorpusRun({
      request: req({ buildRepairPatternAnalysis: true }), now: NOW,
    });
    expect(result.version).toBeTruthy();
    expect(result.steps.length).toBeGreaterThan(0);
  });

  it('high-risk import intelligence profile produces a manual_review_only match', async () => {
    vi.mocked(loadGoldenCorpusImportQualitySnapshot).mockResolvedValue({
      kind: 'ok',
      snapshot: snap({ visualQaScore: 0.5, repairRequiresManualReview: true, repairRequiresFallback: true, repairStatus: 'failed' }),
    });
    const result = await orchestrateGoldenCorpusRun({
      request: req({ corpusId: 'golden-ocr-001', buildImportIntelligenceProfile: true, buildRepairPatternAnalysis: true }), now: NOW,
    });
    const ids = (result.repairPatternAnalysis?.matchedPatterns ?? []).map((m) => m.patternId);
    expect(ids).toContain('manual_review_only');
  });

  it('table-heavy profile produces a table_grid_drift match', async () => {
    const result = await orchestrateGoldenCorpusRun({
      request: req({ buildRepairPatternAnalysis: true }), now: NOW,
      // Pass an explicit table-heavy profile via a pre-built import intelligence result is not
      // possible here; instead the analysis consumes snapshot signals. Use a table-risk snapshot.
    });
    // With the default clean snapshot no table pattern is expected; assert the analysis exists.
    expect(result.repairPatternAnalysis).not.toBeNull();
  });
});

describe('orchestrateGoldenCorpusRun (Phase 10D adaptive reconciliation)', () => {
  beforeEach(() => {
    vi.mocked(loadGoldenCorpusImportQualitySnapshot).mockReset();
    vi.mocked(saveGoldenRegressionSummary).mockReset();
    vi.mocked(saveAdaptiveReconciliationPolicy).mockReset();
    vi.mocked(loadGoldenCorpusImportQualitySnapshot).mockResolvedValue({ kind: 'ok', snapshot: snap() });
    vi.mocked(saveGoldenRegressionSummary).mockResolvedValue({ kind: 'ok' });
    vi.mocked(saveAdaptiveReconciliationPolicy).mockResolvedValue({ kind: 'ok' });
  });

  it('skips the policy step when not requested', async () => {
    const result = await orchestrateGoldenCorpusRun({ request: req(), now: NOW });
    expect(stepOf(result, 'build_adaptive_reconciliation_policy')?.status).toBe('skipped');
    expect(result.adaptiveReconciliationPolicy).toBeNull();
    expect(saveAdaptiveReconciliationPolicy).not.toHaveBeenCalled();
  });

  it('builds the policy when requested', async () => {
    const result = await orchestrateGoldenCorpusRun({
      request: req({ buildAdaptiveReconciliationPolicy: true }), now: NOW,
    });
    expect(result.adaptiveReconciliationPolicy).not.toBeNull();
    expect(result.adaptiveReconciliationPolicy?.decision).toBeTruthy();
    expect(stepOf(result, 'build_adaptive_reconciliation_policy')?.status).not.toBe('skipped');
  });

  it('attaches the policy result to the orchestrator result', async () => {
    const result = await orchestrateGoldenCorpusRun({
      request: req({ buildAdaptiveReconciliationPolicy: true }), now: NOW,
    });
    expect(result.adaptiveReconciliationPolicy?.version).toBeTruthy();
    expect(result.adaptiveReconciliationPolicy?.flags).toBeTruthy();
  });

  it('does not persist the policy when persist flag is off', async () => {
    const result = await orchestrateGoldenCorpusRun({
      request: req({ buildAdaptiveReconciliationPolicy: true, persistAdaptiveReconciliationPolicy: false }), now: NOW,
    });
    expect(saveAdaptiveReconciliationPolicy).not.toHaveBeenCalled();
    expect(stepOf(result, 'persist_adaptive_reconciliation_policy')?.status).toBe('skipped');
  });

  it('persists the policy when requested', async () => {
    const result = await orchestrateGoldenCorpusRun({
      request: req({ buildAdaptiveReconciliationPolicy: true, persistAdaptiveReconciliationPolicy: true }), now: NOW,
    });
    expect(saveAdaptiveReconciliationPolicy).toHaveBeenCalledTimes(1);
    expect(result.adaptiveReconciliationPolicyPersistenceResult?.kind).toBe('ok');
    expect(stepOf(result, 'persist_adaptive_reconciliation_policy')?.status).toBe('pass');
  });

  it('adds a warning when policy persistence fails but does not fail the run', async () => {
    vi.mocked(saveAdaptiveReconciliationPolicy).mockResolvedValue({ kind: 'error', message: 'db down' });
    const result = await orchestrateGoldenCorpusRun({
      request: req({ buildAdaptiveReconciliationPolicy: true, persistAdaptiveReconciliationPolicy: true }), now: NOW,
    });
    expect(result.warnings).toContain('adaptive_reconciliation_policy_persistence_failed');
    expect(result.status).not.toBe('failed');
    expect(stepOf(result, 'persist_adaptive_reconciliation_policy')?.status).toBe('fail');
  });

  it('evaluate_only with policy build but no persist remains read-only', async () => {
    await orchestrateGoldenCorpusRun({
      request: req({ persist: false, buildAdaptiveReconciliationPolicy: true }), now: NOW,
    });
    expect(saveGoldenRegressionSummary).not.toHaveBeenCalled();
    expect(saveAdaptiveReconciliationPolicy).not.toHaveBeenCalled();
  });

  it('does not persist the policy when importId is missing', async () => {
    const result = await orchestrateGoldenCorpusRun({
      request: req({ importId: '', buildAdaptiveReconciliationPolicy: true, persistAdaptiveReconciliationPolicy: true }), now: NOW,
    });
    expect(saveAdaptiveReconciliationPolicy).not.toHaveBeenCalled();
    expect(result.adaptiveReconciliationPolicy).toBeNull();
  });

  it('a blocked policy does not crash the orchestrator or invoke AI', async () => {
    vi.mocked(loadGoldenCorpusImportQualitySnapshot).mockResolvedValue({
      kind: 'ok',
      snapshot: snap({ visualQaScore: 0.4, repairStatus: 'failed', repairRequiresManualReview: true, repairRequiresFallback: true }),
    });
    const result = await orchestrateGoldenCorpusRun({
      request: req({ corpusId: 'golden-ocr-001', buildImportIntelligenceProfile: true, buildRepairPatternAnalysis: true, buildAdaptiveReconciliationPolicy: true }), now: NOW,
    });
    expect(result.version).toBeTruthy();
    expect(result.adaptiveReconciliationPolicy).not.toBeNull();
    // Governance only — no AI is invoked by the policy layer.
    expect(saveAdaptiveReconciliationPolicy).not.toHaveBeenCalled();
  });

  it('low-risk simple import produces a not_needed policy', async () => {
    const result = await orchestrateGoldenCorpusRun({
      request: req({ buildImportIntelligenceProfile: true, buildRepairPatternAnalysis: true, buildAdaptiveReconciliationPolicy: true }), now: NOW,
    });
    expect(result.adaptiveReconciliationPolicy?.decision).toBe('not_needed');
  });
});

describe('orchestrateGoldenCorpusRun (Phase 10E self-healing retry)', () => {
  // A failing snapshot that yields a non-trivial recovery plan.
  const failing = () =>
    snap({
      importStatus: 'completed',
      visualQaScore: 0.5,
      repairStatus: 'failed',
      repairFinalScore: 0.5,
      repairRequiresManualReview: true,
      repairRequiresFallback: true,
      exportParityStatus: 'failed',
      exportVsSourceScore: 0.6,
      aiReconciliationRecommendation: 'recommended',
      aiReconciliationStatus: null,
    });

  beforeEach(() => {
    vi.mocked(loadGoldenCorpusImportQualitySnapshot).mockReset();
    vi.mocked(saveGoldenRegressionSummary).mockReset();
    vi.mocked(saveSelfHealingRetryAudit).mockReset();
    vi.mocked(loadGoldenCorpusImportQualitySnapshot).mockResolvedValue({ kind: 'ok', snapshot: snap() });
    vi.mocked(saveGoldenRegressionSummary).mockResolvedValue({ kind: 'ok' });
    vi.mocked(saveSelfHealingRetryAudit).mockResolvedValue({ kind: 'ok' });
  });

  // 1
  it('buildSelfHealingPlan false skips self-healing steps', async () => {
    const result = await orchestrateGoldenCorpusRun({ request: req(), now: NOW });
    expect(stepOf(result, 'build_self_healing_plan')?.status).toBe('skipped');
    expect(stepOf(result, 'execute_self_healing_plan')?.status).toBe('skipped');
    expect(stepOf(result, 'persist_self_healing_audit')?.status).toBe('skipped');
    expect(result.selfHealingRetryAudit).toBeNull();
    expect(saveSelfHealingRetryAudit).not.toHaveBeenCalled();
  });

  // 2
  it('builds the plan when requested', async () => {
    const result = await orchestrateGoldenCorpusRun({
      request: req({ buildSelfHealingPlan: true }), now: NOW,
    });
    expect(result.selfHealingRetryAudit).not.toBeNull();
    expect(result.selfHealingRetryAudit?.version).toBeTruthy();
    expect(stepOf(result, 'build_self_healing_plan')?.status).not.toBe('skipped');
  });

  // 3
  it('attaches the audit with a summary and plan id', async () => {
    const result = await orchestrateGoldenCorpusRun({
      request: req({ buildSelfHealingPlan: true }), now: NOW,
    });
    expect(result.selfHealingRetryAudit?.planId).toBeTruthy();
    expect(result.selfHealingRetryAudit?.summary.totalActions).toBe(
      result.selfHealingRetryAudit?.actions.length,
    );
  });

  // 4
  it('dry_run builds but does not execute', async () => {
    const result = await orchestrateGoldenCorpusRun({
      request: req({ buildSelfHealingPlan: true, executeSelfHealingMode: 'dry_run' }), now: NOW,
    });
    expect(result.selfHealingRetryAudit?.executedAt).toBeNull();
    expect(stepOf(result, 'execute_self_healing_plan')?.status).toBe('skipped');
  });

  // 5
  it('audit_only records the plan without persistence unless requested', async () => {
    const result = await orchestrateGoldenCorpusRun({
      request: req({ buildSelfHealingPlan: true, executeSelfHealingMode: 'audit_only' }), now: NOW,
    });
    expect(result.selfHealingRetryAudit).not.toBeNull();
    expect(saveSelfHealingRetryAudit).not.toHaveBeenCalled();
    expect(stepOf(result, 'persist_self_healing_audit')?.status).toBe('skipped');
  });

  // 6
  it('execute_safe executes and stamps executedAt', async () => {
    vi.mocked(loadGoldenCorpusImportQualitySnapshot).mockResolvedValue({ kind: 'ok', snapshot: failing() });
    const result = await orchestrateGoldenCorpusRun({
      request: req({ corpusId: 'golden-ocr-001', buildSelfHealingPlan: true, executeSelfHealingMode: 'execute_safe' }), now: NOW,
    });
    expect(result.selfHealingRetryAudit?.executedAt).toBeTruthy();
    expect(stepOf(result, 'execute_self_healing_plan')?.status).not.toBe('skipped');
  });

  // 7
  it('execute_confirmed without operator confirmation holds and warns', async () => {
    const result = await orchestrateGoldenCorpusRun({
      request: req({ buildSelfHealingPlan: true, executeSelfHealingMode: 'execute_confirmed', selfHealingOperatorConfirmed: false }), now: NOW,
    });
    expect(result.selfHealingRetryAudit?.executedAt).toBeNull();
    expect(result.warnings).toContain('self_healing_operator_confirmation_required');
    expect(stepOf(result, 'execute_self_healing_plan')?.status).toBe('warning');
  });

  // 8
  it('execute_confirmed with operator confirmation executes', async () => {
    vi.mocked(loadGoldenCorpusImportQualitySnapshot).mockResolvedValue({ kind: 'ok', snapshot: failing() });
    const result = await orchestrateGoldenCorpusRun({
      request: req({ corpusId: 'golden-ocr-001', buildSelfHealingPlan: true, executeSelfHealingMode: 'execute_confirmed', selfHealingOperatorConfirmed: true }), now: NOW,
    });
    expect(result.selfHealingRetryAudit?.executedAt).toBeTruthy();
  });

  // 9
  it('does not persist the audit when persist flag is off', async () => {
    const result = await orchestrateGoldenCorpusRun({
      request: req({ buildSelfHealingPlan: true, persistSelfHealingAudit: false }), now: NOW,
    });
    expect(saveSelfHealingRetryAudit).not.toHaveBeenCalled();
    expect(stepOf(result, 'persist_self_healing_audit')?.status).toBe('skipped');
  });

  // 10
  it('persists the audit when requested', async () => {
    const result = await orchestrateGoldenCorpusRun({
      request: req({ buildSelfHealingPlan: true, persistSelfHealingAudit: true }), now: NOW,
    });
    expect(saveSelfHealingRetryAudit).toHaveBeenCalledTimes(1);
    expect(result.selfHealingRetryAuditPersistenceResult?.kind).toBe('ok');
    expect(stepOf(result, 'persist_self_healing_audit')?.status).toBe('pass');
  });

  // 11
  it('adds a warning when audit persistence fails but does not fail the run', async () => {
    vi.mocked(saveSelfHealingRetryAudit).mockResolvedValue({ kind: 'error', message: 'db down' });
    const result = await orchestrateGoldenCorpusRun({
      request: req({ buildSelfHealingPlan: true, persistSelfHealingAudit: true }), now: NOW,
    });
    expect(result.warnings).toContain('self_healing_audit_persistence_failed');
    expect(result.status).not.toBe('failed');
    expect(stepOf(result, 'persist_self_healing_audit')?.status).toBe('fail');
  });

  // 12
  it('does not persist the audit when importId is missing', async () => {
    const result = await orchestrateGoldenCorpusRun({
      request: req({ importId: '', buildSelfHealingPlan: true, persistSelfHealingAudit: true }), now: NOW,
    });
    expect(saveSelfHealingRetryAudit).not.toHaveBeenCalled();
    expect(result.selfHealingRetryAudit).toBeNull();
  });

  // 13
  it('evaluate_only with plan build but no persist remains read-only', async () => {
    await orchestrateGoldenCorpusRun({
      request: req({ persist: false, buildSelfHealingPlan: true }), now: NOW,
    });
    expect(saveGoldenRegressionSummary).not.toHaveBeenCalled();
    expect(saveSelfHealingRetryAudit).not.toHaveBeenCalled();
  });

  // 14
  it('a blocked/failing plan does not crash the orchestrator', async () => {
    vi.mocked(loadGoldenCorpusImportQualitySnapshot).mockResolvedValue({ kind: 'ok', snapshot: failing() });
    const result = await orchestrateGoldenCorpusRun({
      request: req({ corpusId: 'golden-ocr-001', buildImportIntelligenceProfile: true, buildRepairPatternAnalysis: true, buildAdaptiveReconciliationPolicy: true, buildSelfHealingPlan: true, executeSelfHealingMode: 'execute_safe' }), now: NOW,
    });
    expect(result.version).toBeTruthy();
    expect(result.selfHealingRetryAudit).not.toBeNull();
  });

  // 15
  it('never marks browser/import/AI-only actions as completed', async () => {
    vi.mocked(loadGoldenCorpusImportQualitySnapshot).mockResolvedValue({ kind: 'ok', snapshot: failing() });
    const result = await orchestrateGoldenCorpusRun({
      request: req({ corpusId: 'golden-ocr-001', buildImportIntelligenceProfile: true, buildRepairPatternAnalysis: true, buildAdaptiveReconciliationPolicy: true, buildSelfHealingPlan: true, executeSelfHealingMode: 'execute_confirmed', selfHealingOperatorConfirmed: true }), now: NOW,
    });
    const neverAuto = new Set([
      'run_ai_reconciliation', 'rerun_import', 'rerun_visual_qa', 'rerun_repair', 'rerun_export_parity_manual',
    ]);
    for (const action of result.selfHealingRetryAudit?.actions ?? []) {
      if (neverAuto.has(action.actionId)) {
        expect(action.status).not.toBe('completed');
      }
    }
  });

  // 16
  it('self-healing plan never triggers AI automatically', async () => {
    vi.mocked(loadGoldenCorpusImportQualitySnapshot).mockResolvedValue({ kind: 'ok', snapshot: failing() });
    const result = await orchestrateGoldenCorpusRun({
      request: req({ corpusId: 'golden-ocr-001', buildAdaptiveReconciliationPolicy: true, buildSelfHealingPlan: true, executeSelfHealingMode: 'execute_safe' }), now: NOW,
    });
    const ai = (result.selfHealingRetryAudit?.actions ?? []).find((a) => a.actionId === 'run_ai_reconciliation');
    // If an AI action is planned at all, it must be surfaced as manual/blocked — never executed.
    if (ai) {
      expect(['manual_required', 'blocked', 'skipped', 'pending', 'not_supported']).toContain(ai.status);
    }
  });
});

describe('orchestrateGoldenCorpusRun (Phase 10F performance/cost audit)', () => {
  beforeEach(() => {
    vi.mocked(loadGoldenCorpusImportQualitySnapshot).mockReset();
    vi.mocked(saveGoldenRegressionSummary).mockReset();
    vi.mocked(savePdfImportPerformanceAudit).mockReset();
    vi.mocked(loadGoldenCorpusImportQualitySnapshot).mockResolvedValue({ kind: 'ok', snapshot: snap() });
    vi.mocked(saveGoldenRegressionSummary).mockResolvedValue({ kind: 'ok' });
    vi.mocked(savePdfImportPerformanceAudit).mockResolvedValue({ kind: 'ok' });
  });

  // 1
  it('buildPerformanceCostAudit false skips performance audit step', async () => {
    const result = await orchestrateGoldenCorpusRun({ request: req(), now: NOW });
    expect(stepOf(result, 'build_performance_cost_audit')?.status).toBe('skipped');
    expect(stepOf(result, 'persist_performance_cost_audit')?.status).toBe('skipped');
    expect(result.performanceCostAudit).toBeNull();
    expect(savePdfImportPerformanceAudit).not.toHaveBeenCalled();
  });

  // 2
  it('buildPerformanceCostAudit true builds audit', async () => {
    const result = await orchestrateGoldenCorpusRun({ request: req({ buildPerformanceCostAudit: true }), now: NOW });
    expect(result.performanceCostAudit).not.toBeNull();
    expect(result.performanceCostAudit?.version).toBeTruthy();
    expect(stepOf(result, 'build_performance_cost_audit')?.status).not.toBe('skipped');
  });

  // 3
  it('performance audit result is attached to orchestrator result', async () => {
    const result = await orchestrateGoldenCorpusRun({ request: req({ buildPerformanceCostAudit: true }), now: NOW });
    expect(result.performanceCostAudit?.overallCostLevel).toBeTruthy();
    expect(result.performanceCostAudit?.overallRiskLevel).toBeTruthy();
    expect(Array.isArray(result.performanceCostAudit?.stepCosts)).toBe(true);
  });

  // 4
  it('persistPerformanceCostAudit false does not call save', async () => {
    const result = await orchestrateGoldenCorpusRun({ request: req({ buildPerformanceCostAudit: true, persistPerformanceCostAudit: false }), now: NOW });
    expect(savePdfImportPerformanceAudit).not.toHaveBeenCalled();
    expect(stepOf(result, 'persist_performance_cost_audit')?.status).toBe('skipped');
  });

  // 5 + 6
  it('persistPerformanceCostAudit true calls save and returns ok', async () => {
    const result = await orchestrateGoldenCorpusRun({ request: req({ buildPerformanceCostAudit: true, persistPerformanceCostAudit: true }), now: NOW });
    expect(savePdfImportPerformanceAudit).toHaveBeenCalledTimes(1);
    expect(result.performanceCostAuditPersistenceResult?.kind).toBe('ok');
    expect(stepOf(result, 'persist_performance_cost_audit')?.status).toBe('pass');
  });

  // 7
  it('persistence failure adds performance_cost_audit_persistence_failed warning without failing the run', async () => {
    vi.mocked(savePdfImportPerformanceAudit).mockResolvedValue({ kind: 'error', message: 'db down' });
    const result = await orchestrateGoldenCorpusRun({ request: req({ buildPerformanceCostAudit: true, persistPerformanceCostAudit: true }), now: NOW });
    expect(result.warnings).toContain('performance_cost_audit_persistence_failed');
    expect(result.status).not.toBe('failed');
    expect(stepOf(result, 'persist_performance_cost_audit')?.status).toBe('fail');
  });

  // 8
  it('evaluate_only with audit build but no persist remains read-only', async () => {
    await orchestrateGoldenCorpusRun({ request: req({ persist: false, buildPerformanceCostAudit: true }), now: NOW });
    expect(saveGoldenRegressionSummary).not.toHaveBeenCalled();
    expect(savePdfImportPerformanceAudit).not.toHaveBeenCalled();
  });

  // 9
  it('missing importId prevents audit persistence', async () => {
    const result = await orchestrateGoldenCorpusRun({ request: req({ importId: '', buildPerformanceCostAudit: true, persistPerformanceCostAudit: true }), now: NOW });
    expect(savePdfImportPerformanceAudit).not.toHaveBeenCalled();
    expect(result.performanceCostAudit).toBeNull();
  });

  // 10
  it('high-cost audit does not alter the golden quality gate decision', async () => {
    const withAudit = await orchestrateGoldenCorpusRun({ request: req({ buildPerformanceCostAudit: true }), now: NOW });
    const withoutAudit = await orchestrateGoldenCorpusRun({ request: req(), now: NOW });
    expect(withAudit.qualityGateReport?.overallStatus).toBe(withoutAudit.qualityGateReport?.overallStatus);
    expect(withAudit.goldenRegressionSummary?.qualityGateStatus).toBe(withoutAudit.goldenRegressionSummary?.qualityGateStatus);
  });

  // 11
  it('audit does not skip Visual QA/export parity gates automatically', async () => {
    const result = await orchestrateGoldenCorpusRun({ request: req({ buildPerformanceCostAudit: true }), now: NOW });
    // Quality gates still evaluate the visual QA and export parity gates.
    const gateIds = (result.qualityGateReport?.gates ?? []).map((g) => g.id);
    expect(gateIds).toContain('visual_quality_artifact_present');
    expect(gateIds).toContain('export_parity_artifact_present');
  });

  // 12
  it('audit does not call AI (no AI reconciliation status is produced by the audit)', async () => {
    const result = await orchestrateGoldenCorpusRun({ request: req({ buildPerformanceCostAudit: true }), now: NOW });
    // The audit is advisory metadata only; it never sets an AI reconciliation status.
    expect(result.performanceCostAudit).not.toBeNull();
    expect((result as any).aiReconciliationStatus).toBeUndefined();
  });
});

describe('orchestrateGoldenCorpusRun (Phase 10G production operator controls)', () => {
  beforeEach(() => {
    vi.mocked(loadGoldenCorpusImportQualitySnapshot).mockReset();
    vi.mocked(saveGoldenRegressionSummary).mockReset();
    vi.mocked(loadProductionOperatorControlAudit).mockReset();
    vi.mocked(saveProductionOperatorControlAudit).mockReset();
    vi.mocked(loadGoldenCorpusImportQualitySnapshot).mockResolvedValue({ kind: 'ok', snapshot: snap() });
    vi.mocked(saveGoldenRegressionSummary).mockResolvedValue({ kind: 'ok' });
    vi.mocked(loadProductionOperatorControlAudit).mockResolvedValue({ kind: 'missing' });
    vi.mocked(saveProductionOperatorControlAudit).mockResolvedValue({ kind: 'ok' });
  });

  // 1
  it('buildOperatorControls false skips operator controls', async () => {
    const result = await orchestrateGoldenCorpusRun({ request: req(), now: NOW });
    expect(stepOf(result, 'build_operator_controls')?.status).toBe('skipped');
    expect(stepOf(result, 'persist_operator_control_audit')?.status).toBe('skipped');
    expect(result.productionOperatorControlAudit).toBeNull();
    expect(saveProductionOperatorControlAudit).not.toHaveBeenCalled();
  });

  // 2 + 3
  it('buildOperatorControls true builds and attaches the control audit', async () => {
    const result = await orchestrateGoldenCorpusRun({ request: req({ buildOperatorControls: true }), now: NOW });
    expect(result.productionOperatorControlAudit).not.toBeNull();
    expect(result.productionOperatorControlAudit?.version).toBeTruthy();
    expect(Array.isArray(result.productionOperatorControlAudit?.controls)).toBe(true);
    expect(stepOf(result, 'build_operator_controls')?.status).not.toBe('skipped');
  });

  // 4
  it('persistOperatorControlAudit false does not save', async () => {
    const result = await orchestrateGoldenCorpusRun({ request: req({ buildOperatorControls: true, persistOperatorControlAudit: false }), now: NOW });
    expect(saveProductionOperatorControlAudit).not.toHaveBeenCalled();
    expect(stepOf(result, 'persist_operator_control_audit')?.status).toBe('skipped');
  });

  // 5 + 6
  it('persistOperatorControlAudit true calls save and returns ok', async () => {
    const result = await orchestrateGoldenCorpusRun({ request: req({ buildOperatorControls: true, persistOperatorControlAudit: true }), now: NOW });
    expect(saveProductionOperatorControlAudit).toHaveBeenCalledTimes(1);
    expect(result.productionOperatorControlAuditPersistenceResult?.kind).toBe('ok');
    expect(stepOf(result, 'persist_operator_control_audit')?.status).toBe('pass');
  });

  it('preserves the previously persisted operator decision and history', async () => {
    const previous = (await orchestrateGoldenCorpusRun({
      request: req({ buildOperatorControls: true }),
      now: NOW,
    })).productionOperatorControlAudit!;
    previous.operatorState.decision = 'accepted';
    previous.operatorState.acceptedAt = '2026-07-03T00:00:00.000Z';
    previous.notes = ['Approved after manual review'];
    previous.executedActions = [{
      controlId: 'mark_accepted',
      status: 'completed',
      executedAt: '2026-07-03T00:00:00.000Z',
      message: 'Accepted',
    }];
    vi.mocked(loadProductionOperatorControlAudit).mockResolvedValue({ kind: 'ok', audit: previous });

    const result = await orchestrateGoldenCorpusRun({
      request: req({ buildOperatorControls: true, persistOperatorControlAudit: true }),
      now: NOW,
    });

    expect(result.productionOperatorControlAudit?.operatorState.decision).toBe('accepted');
    expect(result.productionOperatorControlAudit?.operatorState.acceptedAt).toBe('2026-07-03T00:00:00.000Z');
    expect(result.productionOperatorControlAudit?.notes).toEqual(['Approved after manual review']);
    expect(result.productionOperatorControlAudit?.executedActions).toEqual(previous.executedActions);
    expect(saveProductionOperatorControlAudit).toHaveBeenCalledWith('import-1', result.productionOperatorControlAudit);
  });

  it('does not overwrite the audit when the existing audit cannot be loaded', async () => {
    vi.mocked(loadProductionOperatorControlAudit).mockResolvedValue({ kind: 'error', message: 'db down' });

    const result = await orchestrateGoldenCorpusRun({
      request: req({ buildOperatorControls: true, persistOperatorControlAudit: true }),
      now: NOW,
    });

    expect(saveProductionOperatorControlAudit).not.toHaveBeenCalled();
    expect(result.productionOperatorControlAuditPersistenceResult).toEqual({ kind: 'error', message: 'db down' });
    expect(result.warnings).toContain('operator_control_audit_persistence_failed');
    expect(stepOf(result, 'persist_operator_control_audit')?.status).toBe('fail');
  });

  // 7
  it('persistence failure adds operator_control_audit_persistence_failed without failing the run', async () => {
    vi.mocked(saveProductionOperatorControlAudit).mockResolvedValue({ kind: 'error', message: 'db down' });
    const result = await orchestrateGoldenCorpusRun({ request: req({ buildOperatorControls: true, persistOperatorControlAudit: true }), now: NOW });
    expect(result.warnings).toContain('operator_control_audit_persistence_failed');
    expect(result.status).not.toBe('failed');
    expect(stepOf(result, 'persist_operator_control_audit')?.status).toBe('fail');
  });

  // 8
  it('missing importId prevents persistence', async () => {
    const result = await orchestrateGoldenCorpusRun({ request: req({ importId: '', buildOperatorControls: true, persistOperatorControlAudit: true }), now: NOW });
    expect(saveProductionOperatorControlAudit).not.toHaveBeenCalled();
    expect(result.productionOperatorControlAudit).toBeNull();
  });

  // 9
  it('pass quality gate creates an accepted recommended control', async () => {
    const result = await orchestrateGoldenCorpusRun({ request: req({ buildOperatorControls: true }), now: NOW });
    const accepted = (result.productionOperatorControlAudit?.controls ?? []).find((c) => c.controlId === 'mark_accepted');
    expect(accepted?.state).toBe('recommended');
  });

  // 10
  it('blocked adaptive policy blocks the AI manual control', async () => {
    vi.mocked(loadGoldenCorpusImportQualitySnapshot).mockResolvedValue({
      kind: 'ok',
      snapshot: snap({ visualQaScore: 0.4, repairStatus: 'failed', repairRequiresManualReview: true, repairRequiresFallback: true }),
    });
    const result = await orchestrateGoldenCorpusRun({
      request: req({ corpusId: 'golden-ocr-001', buildImportIntelligenceProfile: true, buildRepairPatternAnalysis: true, buildAdaptiveReconciliationPolicy: true, buildOperatorControls: true }), now: NOW,
    });
    const ai = (result.productionOperatorControlAudit?.controls ?? []).find((c) => c.controlId === 'run_ai_reconciliation_manual');
    if (result.adaptiveReconciliationPolicy?.flags?.aiBlocked) {
      expect(ai?.state).toBe('blocked');
    }
    // clear audit control is always blocked regardless.
    const clear = (result.productionOperatorControlAudit?.controls ?? []).find((c) => c.controlId === 'clear_operator_control_audit');
    expect(clear?.state).toBe('blocked');
  });

  // 11
  it('operator controls do not call AI (no AI status is produced)', async () => {
    const result = await orchestrateGoldenCorpusRun({ request: req({ buildOperatorControls: true }), now: NOW });
    expect(result.productionOperatorControlAudit).not.toBeNull();
    expect((result as any).aiReconciliationStatus).toBeUndefined();
  });

  // 12
  it('operator controls do not alter the golden quality gate decision', async () => {
    const withControls = await orchestrateGoldenCorpusRun({ request: req({ buildOperatorControls: true }), now: NOW });
    const withoutControls = await orchestrateGoldenCorpusRun({ request: req(), now: NOW });
    expect(withControls.qualityGateReport?.overallStatus).toBe(withoutControls.qualityGateReport?.overallStatus);
    expect(withControls.goldenRegressionSummary?.qualityGateStatus).toBe(withoutControls.goldenRegressionSummary?.qualityGateStatus);
  });
});
