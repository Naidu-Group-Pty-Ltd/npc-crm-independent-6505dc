import { describe, expect, it } from 'vitest';
import {
  buildEmptyGoldenCorpusSnapshot,
  evaluateGoldenCorpusRun,
  evaluateGoldenCorpusRunBatch,
  type GoldenCorpusImportQualitySnapshot,
  type GoldenCorpusRunBatch,
  type GoldenCorpusRunReference,
} from '../ingestion/goldenCorpus';

const NOW = () => new Date('2026-07-04T00:00:00.000Z');

function ref(overrides: Partial<GoldenCorpusRunReference> = {}): GoldenCorpusRunReference {
  return {
    runId: 'run-1',
    corpusId: 'golden-simple-001',
    sourceFilename: null,
    importId: 'imp-1',
    templateId: 'tpl-1',
    ...overrides,
  };
}

/** A snapshot that PASSES golden-simple-001 (all thresholds 0.90). */
function goodSimpleSnapshot(
  overrides: Partial<GoldenCorpusImportQualitySnapshot> = {},
): GoldenCorpusImportQualitySnapshot {
  return {
    ...buildEmptyGoldenCorpusSnapshot('imp-1'),
    templateId: 'tpl-1',
    importStatus: 'completed',
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
    exportParityArtifactPath: 'imp-1/export-parity/export-parity.json',
    exportParityStatus: 'completed',
    exportParityMode: 'manual',
    exportVsSourceScore: 0.94,
    ...overrides,
  };
}

describe('buildEmptyGoldenCorpusSnapshot', () => {
  it('returns a snapshot with the supplied importId and all other fields null', () => {
    const snap = buildEmptyGoldenCorpusSnapshot('imp-xyz');
    expect(snap.importId).toBe('imp-xyz');
    const { importId, ...rest } = snap;
    void importId;
    for (const value of Object.values(rest)) expect(value).toBeNull();
  });

  it('defaults importId to null when not supplied', () => {
    expect(buildEmptyGoldenCorpusSnapshot().importId).toBeNull();
  });
});

describe('evaluateGoldenCorpusRun', () => {
  it('is not_evaluated when the importId is missing', () => {
    const result = evaluateGoldenCorpusRun({
      run: ref({ importId: null }),
      snapshot: buildEmptyGoldenCorpusSnapshot(null),
      now: NOW,
    });
    expect(result.decision).toBe('not_evaluated');
    expect(result.status).toBe('not_started');
    expect(result.warnings).toContain('import_id_missing');
  });

  it('throws for an unknown corpus ID', () => {
    expect(() =>
      evaluateGoldenCorpusRun({
        run: ref({ corpusId: 'golden-nope-999' }),
        snapshot: goodSimpleSnapshot(),
        now: NOW,
      }),
    ).toThrow(/Unknown golden corpus ID/);
  });

  it('passes a completed simple run with all required metadata', () => {
    const result = evaluateGoldenCorpusRun({ run: ref(), snapshot: goodSimpleSnapshot(), now: NOW });
    expect(result.decision).toBe('pass');
    expect(result.status).toBe('validated');
    expect(result.failures).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('fails when the import itself failed', () => {
    const result = evaluateGoldenCorpusRun({
      run: ref(),
      snapshot: goodSimpleSnapshot({ importStatus: 'failed' }),
      now: NOW,
    });
    expect(result.decision).toBe('fail');
    expect(result.status).toBe('failed');
    expect(result.failures).toContain('import_failed');
  });

  it('fails when the template is missing', () => {
    const result = evaluateGoldenCorpusRun({
      run: ref(),
      snapshot: goodSimpleSnapshot({ templateId: null }),
      now: NOW,
    });
    expect(result.decision).toBe('fail');
    expect(result.failures).toContain('template_missing');
  });

  it('fails on a template page-count mismatch', () => {
    const result = evaluateGoldenCorpusRun({
      run: ref(),
      snapshot: goodSimpleSnapshot({ importPageCount: 1, templatePageCount: 2 }),
      now: NOW,
    });
    expect(result.decision).toBe('fail');
    expect(result.failures).toContain('template_page_count_mismatch');
  });

  it('fails when Visual QA is missing', () => {
    const result = evaluateGoldenCorpusRun({
      run: ref(),
      snapshot: goodSimpleSnapshot({ visualQaArtifactPath: null }),
      now: NOW,
    });
    expect(result.decision).toBe('fail');
    expect(result.failures).toContain('visual_quality_missing');
  });

  it('warns (not fails) when Visual QA is below the registry minimum', () => {
    const result = evaluateGoldenCorpusRun({
      run: ref(),
      snapshot: goodSimpleSnapshot({ visualQaScore: 0.5 }),
      now: NOW,
    });
    expect(result.decision).toBe('warning');
    expect(result.failures).toEqual([]);
    expect(result.warnings).toContain('visual_quality_below_registry_minimum');
  });

  it('fails when the repair audit is missing', () => {
    const result = evaluateGoldenCorpusRun({
      run: ref(),
      snapshot: goodSimpleSnapshot({ repairArtifactPath: null }),
      now: NOW,
    });
    expect(result.decision).toBe('fail');
    expect(result.failures).toContain('repair_audit_missing');
  });

  it('warns (not fails) when repair was skipped but the audit exists', () => {
    const result = evaluateGoldenCorpusRun({
      run: ref(),
      snapshot: goodSimpleSnapshot({ repairStatus: 'skipped', repairFinalScore: null }),
      now: NOW,
    });
    expect(result.decision).toBe('warning');
    expect(result.failures).toEqual([]);
    expect(result.warnings).toContain('repair_skipped_no_eligible_pages');
  });

  it('fails when repair failed', () => {
    const result = evaluateGoldenCorpusRun({
      run: ref(),
      snapshot: goodSimpleSnapshot({ repairStatus: 'failed' }),
      now: NOW,
    });
    expect(result.decision).toBe('fail');
    expect(result.failures).toContain('repair_failed');
  });

  it('warns for manual review when the corpus allows it (OCR)', () => {
    const result = evaluateGoldenCorpusRun({
      run: ref({ corpusId: 'golden-ocr-001' }),
      snapshot: goodSimpleSnapshot({
        visualQaScore: 0.7,
        repairFinalScore: 0.7,
        exportVsSourceScore: 0.8,
        visualQaManualReviewRequired: true,
      }),
      now: NOW,
    });
    expect(result.decision).toBe('warning');
    expect(result.warnings).toContain('manual_review_required');
    expect(result.failures).toEqual([]);
  });

  it('fails for manual review when the corpus disallows it (simple)', () => {
    const result = evaluateGoldenCorpusRun({
      run: ref(),
      snapshot: goodSimpleSnapshot({ visualQaManualReviewRequired: true }),
      now: NOW,
    });
    expect(result.decision).toBe('fail');
    expect(result.failures).toContain('manual_review_not_allowed');
  });

  it('warns for fallback when the corpus allows it (design-heavy)', () => {
    const result = evaluateGoldenCorpusRun({
      run: ref({ corpusId: 'golden-design-001' }),
      snapshot: goodSimpleSnapshot({
        visualQaScore: 0.85,
        repairFinalScore: 0.85,
        exportVsSourceScore: 0.85,
        repairRequiresFallback: true,
      }),
      now: NOW,
    });
    expect(result.decision).toBe('warning');
    expect(result.warnings).toContain('fallback_used');
    expect(result.failures).toEqual([]);
  });

  it('warns when export parity was not recorded', () => {
    const result = evaluateGoldenCorpusRun({
      run: ref(),
      snapshot: goodSimpleSnapshot({ exportParityArtifactPath: null, exportParityStatus: null, exportVsSourceScore: null }),
      now: NOW,
    });
    expect(result.decision).toBe('warning');
    expect(result.failures).toEqual([]);
    expect(result.warnings).toContain('export_parity_not_recorded');
  });

  it('fails when export parity failed', () => {
    const result = evaluateGoldenCorpusRun({
      run: ref(),
      snapshot: goodSimpleSnapshot({ exportParityStatus: 'failed' }),
      now: NOW,
    });
    expect(result.decision).toBe('fail');
    expect(result.failures).toContain('export_parity_failed');
  });

  it('warns when AI reconciliation was recommended but not run', () => {
    const result = evaluateGoldenCorpusRun({
      run: ref(),
      snapshot: goodSimpleSnapshot({ aiReconciliationRecommendation: 'recommended', aiReconciliationStatus: null }),
      now: NOW,
    });
    expect(result.decision).toBe('warning');
    expect(result.warnings).toContain('ai_reconciliation_recommended_not_run');
  });
});

describe('evaluateGoldenCorpusRunBatch', () => {
  it('summarizes pass/warning/fail/notEvaluated counts correctly', () => {
    const batch: GoldenCorpusRunBatch = {
      version: 'pdf-import-golden-run-v1',
      runBatchId: 'batch-1',
      description: 'test batch',
      createdAt: '2026-07-04T00:00:00.000Z',
      operator: 'tester',
      mode: 'manual_operator',
      runs: [
        ref({ runId: 'r-pass', corpusId: 'golden-simple-001', importId: 'imp-pass' }),
        ref({ runId: 'r-warn', corpusId: 'golden-simple-001', importId: 'imp-warn' }),
        ref({ runId: 'r-fail', corpusId: 'golden-simple-001', importId: 'imp-fail' }),
        ref({ runId: 'r-none', corpusId: 'golden-simple-001', importId: null }),
      ],
    };

    const snapshotsByImportId: Record<string, GoldenCorpusImportQualitySnapshot> = {
      'imp-pass': goodSimpleSnapshot({ importId: 'imp-pass' }),
      'imp-warn': goodSimpleSnapshot({ importId: 'imp-warn', visualQaScore: 0.5 }),
      'imp-fail': goodSimpleSnapshot({ importId: 'imp-fail', templateId: null }),
      // imp-none intentionally absent → empty snapshot
    };

    const result = evaluateGoldenCorpusRunBatch({ batch, snapshotsByImportId, now: NOW });
    expect(result.summary).toEqual({ total: 4, pass: 1, warning: 1, fail: 1, notEvaluated: 1 });
    expect(result.runBatchId).toBe('batch-1');
    expect(result.evaluations).toHaveLength(4);
  });
});
