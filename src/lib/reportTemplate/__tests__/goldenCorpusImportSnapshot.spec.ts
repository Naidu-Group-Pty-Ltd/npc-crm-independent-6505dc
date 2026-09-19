import { describe, expect, it } from 'vitest';
import {
  buildGoldenCorpusImportQualitySnapshotFromRecord,
  coerceNullableBoolean,
  coerceNullableNumber,
  readNestedBoolean,
  readNestedNumber,
  readNestedString,
} from '../ingestion/goldenCorpus';

describe('coerceNullableNumber', () => {
  it('handles numbers, numeric strings, null/undefined, and invalid strings', () => {
    expect(coerceNullableNumber(0.91)).toBe(0.91);
    expect(coerceNullableNumber('0.91')).toBe(0.91);
    expect(coerceNullableNumber('0')).toBe(0);
    expect(coerceNullableNumber(null)).toBeNull();
    expect(coerceNullableNumber(undefined)).toBeNull();
    expect(coerceNullableNumber('abc')).toBeNull();
    expect(coerceNullableNumber(Number.NaN)).toBeNull();
  });
});

describe('coerceNullableBoolean', () => {
  it('handles booleans, "true"/"false" strings, null, and invalid strings', () => {
    expect(coerceNullableBoolean(true)).toBe(true);
    expect(coerceNullableBoolean(false)).toBe(false);
    expect(coerceNullableBoolean('true')).toBe(true);
    expect(coerceNullableBoolean('False')).toBe(false);
    expect(coerceNullableBoolean(null)).toBeNull();
    expect(coerceNullableBoolean('yes')).toBeNull();
  });
});

describe('buildGoldenCorpusImportQualitySnapshotFromRecord', () => {
  it('maps a raw template_imports row', () => {
    const snap = buildGoldenCorpusImportQualitySnapshotFromRecord({
      id: 'import-1',
      status: 'completed',
      source_filename: 'golden-simple-001.pdf',
      page_count: 1,
      created_template_id: 'template-1',
      meta: {
        import_manifests_summary: { engine_version: 'phase4j-capability-activation' },
        visual_quality_artifact_path: 'import-1/visual-quality/visual-quality.json',
        visual_quality_summary: { overallScore: 0.95, manualReviewRequired: false, pageCount: 1 },
        visual_repair_artifact_path: 'import-1/repair/repair-loop.json',
        visual_repair_summary: { repairStatus: 'completed', finalScore: 0.96, requiresFallback: false, requiresManualReview: false },
        ai_reconciliation_summary: { status: 'completed', recommendation: 'recommended' },
        export_parity_artifact_path: 'import-1/export-parity/export-parity.json',
        export_parity_summary: { status: 'completed', mode: 'manual', exportVsSourceScore: 0.94, editorVsSourceScore: 0.93, exportVsEditorScore: 0.95 },
      },
    });

    expect(snap.importId).toBe('import-1');
    expect(snap.templateId).toBe('template-1');
    expect(snap.sourceFilename).toBe('golden-simple-001.pdf');
    expect(snap.importStatus).toBe('completed');
    expect(snap.engineVersion).toBe('phase4j-capability-activation');
    expect(snap.importPageCount).toBe(1);
    expect(snap.templatePageCount).toBe(1); // from visual_quality_summary.pageCount
    expect(snap.visualQaArtifactPath).toBe('import-1/visual-quality/visual-quality.json');
    expect(snap.visualQaScore).toBe(0.95);
    expect(snap.visualQaManualReviewRequired).toBe(false);
    expect(snap.repairStatus).toBe('completed');
    expect(snap.repairFinalScore).toBe(0.96);
    expect(snap.aiReconciliationStatus).toBe('completed');
    expect(snap.aiReconciliationRecommendation).toBe('recommended');
    expect(snap.exportParityStatus).toBe('completed');
    expect(snap.exportParityMode).toBe('manual');
    expect(snap.exportVsSourceScore).toBe(0.94);
    expect(snap.editorVsSourceScore).toBe(0.93);
    expect(snap.exportVsEditorScore).toBe(0.95);
  });

  it('maps a normalized frontend row', () => {
    const snap = buildGoldenCorpusImportQualitySnapshotFromRecord({
      import_id: 'import-9',
      import_status: 'completed',
      template_id: 'template-9',
      source_filename: 'row.pdf',
      visual_quality: { overallScore: 0.8, manualReviewRequired: true },
      repair: { status: 'skipped', finalScore: 0.81 },
      export_parity: { status: 'manual_required', mode: 'manual', exportVsSourceScore: 0.79 },
    });

    expect(snap.importId).toBe('import-9');
    expect(snap.importStatus).toBe('completed');
    expect(snap.templateId).toBe('template-9');
    expect(snap.visualQaScore).toBe(0.8);
    expect(snap.visualQaManualReviewRequired).toBe(true);
    expect(snap.repairStatus).toBe('skipped');
    expect(snap.repairFinalScore).toBe(0.81);
    expect(snap.exportParityStatus).toBe('manual_required');
    expect(snap.exportVsSourceScore).toBe(0.79);
  });

  it('computes templatePageCount from a schema pages array when present', () => {
    const snap = buildGoldenCorpusImportQualitySnapshotFromRecord({
      id: 'import-2',
      schema: { pages: [{}, {}, {}] },
    });
    expect(snap.templatePageCount).toBe(3);
  });

  it('returns nulls for missing optional metadata', () => {
    const snap = buildGoldenCorpusImportQualitySnapshotFromRecord({ id: 'import-3', status: 'processing' });
    expect(snap.importId).toBe('import-3');
    expect(snap.importStatus).toBe('processing');
    expect(snap.visualQaArtifactPath).toBeNull();
    expect(snap.repairStatus).toBeNull();
    expect(snap.exportParityStatus).toBeNull();
    expect(snap.visualQaScore).toBeNull();
    expect(snap.templateId).toBeNull();
  });
});

describe('nested readers', () => {
  const source = { a: { b: { s: 'hello', n: '0.5', flag: 'true' } } };

  it('readNestedString reads a nested string', () => {
    expect(readNestedString(source, ['a', 'b', 's'])).toBe('hello');
    expect(readNestedString(source, ['a', 'x', 's'])).toBeNull();
  });

  it('readNestedNumber reads a nested numeric string', () => {
    expect(readNestedNumber(source, ['a', 'b', 'n'])).toBe(0.5);
    expect(readNestedNumber(source, ['a', 'b', 's'])).toBeNull();
  });

  it('readNestedBoolean reads a nested boolean string', () => {
    expect(readNestedBoolean(source, ['a', 'b', 'flag'])).toBe(true);
    expect(readNestedBoolean(source, ['a', 'b', 'missing'])).toBeNull();
  });
});
