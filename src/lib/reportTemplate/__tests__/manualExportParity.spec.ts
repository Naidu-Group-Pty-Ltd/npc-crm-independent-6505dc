import { describe, expect, it } from 'vitest';
import {
  buildManualExportParitySummary,
  EXPORT_PARITY_SUMMARY_VERSION,
  type ManualExportParityInput,
} from '../ingestion/exportParity';

const FIXED_NOW = () => new Date('2026-07-04T00:00:00.000Z');

function baseInput(overrides: Partial<ManualExportParityInput> = {}): ManualExportParityInput {
  return {
    importId: 'import_123',
    templateId: 'template_123',
    sourcePageCount: 2,
    editorPageCount: 2,
    exportedPageCount: 2,
    now: FIXED_NOW,
    ...overrides,
  };
}

describe('buildManualExportParitySummary', () => {
  it('throws when importId is blank', () => {
    expect(() => buildManualExportParitySummary(baseInput({ importId: '   ' }))).toThrow('importId is required.');
  });

  it('always reports manual mode and the pinned version, with empty pages', () => {
    const summary = buildManualExportParitySummary(baseInput());
    expect(summary.mode).toBe('manual');
    expect(summary.version).toBe(EXPORT_PARITY_SUMMARY_VERSION);
    expect(summary.pages).toEqual([]);
    expect(summary.importId).toBe('import_123');
    expect(summary.generatedAt).toBe('2026-07-04T00:00:00.000Z');
  });

  it('is manual_required when no valid score is supplied', () => {
    const summary = buildManualExportParitySummary(baseInput());
    expect(summary.status).toBe('manual_required');
    expect(summary.manualReviewRequired).toBe(true);
    expect(summary.editorVsSourceScore).toBeNull();
  });

  it('is completed when at least one valid score is supplied and no problems', () => {
    const summary = buildManualExportParitySummary(baseInput({ exportVsSourceScore: 0.91 }));
    expect(summary.status).toBe('completed');
    expect(summary.exportVsSourceScore).toBe(0.91);
    expect(summary.manualReviewRequired).toBe(false);
  });

  it('normalizes out-of-range and non-finite scores to null (no clamping)', () => {
    const summary = buildManualExportParitySummary(
      baseInput({ editorVsSourceScore: 1.4, exportVsSourceScore: -0.2, exportVsEditorScore: Number.NaN }),
    );
    expect(summary.editorVsSourceScore).toBeNull();
    expect(summary.exportVsSourceScore).toBeNull();
    expect(summary.exportVsEditorScore).toBeNull();
    expect(summary.status).toBe('manual_required');
  });

  it('flags failed on a hard-failure marker regardless of scores', () => {
    const summary = buildManualExportParitySummary(
      baseInput({ exportVsSourceScore: 0.95, problems: ['export_failed: weasyprint timed out'] }),
    );
    expect(summary.status).toBe('failed');
    expect(summary.manualReviewRequired).toBe(true);
    expect(summary.problems).toContain('export_failed: weasyprint timed out');
  });

  it('adds page_count_mismatch when all three counts are finite and unequal', () => {
    const summary = buildManualExportParitySummary(
      baseInput({ exportVsSourceScore: 0.9, sourcePageCount: 2, editorPageCount: 2, exportedPageCount: 3 }),
    );
    expect(summary.problems).toContain('page_count_mismatch');
    expect(summary.manualReviewRequired).toBe(true);
  });

  it('does not flag a mismatch when a page count is unknown (null)', () => {
    const summary = buildManualExportParitySummary(
      baseInput({ exportVsSourceScore: 0.9, sourcePageCount: 2, editorPageCount: 2, exportedPageCount: null }),
    );
    expect(summary.problems).not.toContain('page_count_mismatch');
    expect(summary.status).toBe('completed');
  });

  it('deduplicates and trims problems and preserves order', () => {
    const summary = buildManualExportParitySummary(
      baseInput({ exportVsSourceScore: 0.9, problems: ['  low_text_match  ', 'low_text_match', '', 'blur'] }),
    );
    expect(summary.problems).toEqual(['low_text_match', 'blur']);
  });

  it('honors an explicit manualReviewRequired override even when completed', () => {
    const summary = buildManualExportParitySummary(baseInput({ exportVsSourceScore: 0.99, manualReviewRequired: true }));
    expect(summary.status).toBe('completed');
    expect(summary.manualReviewRequired).toBe(true);
  });
});
