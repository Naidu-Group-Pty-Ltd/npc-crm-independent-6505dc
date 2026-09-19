import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RECONCILIATION_THRESHOLDS,
  evaluateReconciliationPolicy,
  type ReconciliationPolicyInput,
} from '../ingestion/reconciliation/reconciliationPolicy';

describe('evaluateReconciliationPolicy', () => {
  it('1. high score → not_needed', () => {
    const d = evaluateReconciliationPolicy({ visualQaScore: 0.95, sourceRasterCount: 1 });
    expect(d.recommendation).toBe('not_needed');
    expect(d.shouldShowAction).toBe(false);
    expect(d.shouldAutoRun).toBe(false);
    expect(d.severity).toBe('none');
  });

  it('2. acceptable score → optional', () => {
    const d = evaluateReconciliationPolicy({ visualQaScore: 0.86, sourceRasterCount: 1 });
    expect(d.recommendation).toBe('optional');
    expect(d.shouldShowAction).toBe(true);
    expect(d.shouldAutoRun).toBe(false);
    expect(d.severity).toBe('low');
  });

  it('3. weak score → recommended', () => {
    const d = evaluateReconciliationPolicy({ visualQaScore: 0.65, sourceRasterCount: 1 });
    expect(d.recommendation).toBe('recommended');
    expect(d.shouldShowAction).toBe(true);
    expect(d.shouldAutoRun).toBe(false);
    expect(d.severity).toBe('medium');
  });

  it('4. manual review required → manual_review', () => {
    const d = evaluateReconciliationPolicy({ visualQaScore: 0.91, manualReviewRequired: true, sourceRasterCount: 1 });
    expect(d.recommendation).toBe('manual_review');
    expect(d.shouldShowAction).toBe(true);
    expect(d.severity).toBe('high');
  });

  it('5. fallback required → manual_review', () => {
    const d = evaluateReconciliationPolicy({ visualQaScore: 0.91, requiresFallback: true, sourceRasterCount: 1 });
    expect(d.recommendation).toBe('manual_review');
    expect(d.shouldShowAction).toBe(true);
    expect(d.severity).toBe('high');
  });

  it('6. repair final score overrides Visual QA score', () => {
    const d = evaluateReconciliationPolicy({ visualQaScore: 0.70, repairFinalScore: 0.93, sourceRasterCount: 1 });
    expect(d.recommendation).toBe('not_needed');
  });

  it('7. missing score but source rasters exist → optional', () => {
    const d = evaluateReconciliationPolicy({ visualQaScore: null, repairFinalScore: null, sourceRasterCount: 1 });
    expect(d.recommendation).toBe('optional');
    expect(d.shouldShowAction).toBe(true);
  });

  it('8. missing source rasters → manual_review, action hidden', () => {
    const d = evaluateReconciliationPolicy({ visualQaScore: 0.95, sourceRasterCount: 0 });
    expect(d.recommendation).toBe('manual_review');
    expect(d.shouldShowAction).toBe(false);
    expect(d.severity).toBe('high');
    // null/undefined raster count behaves the same
    expect(evaluateReconciliationPolicy({ visualQaScore: 0.95, sourceRasterCount: null }).recommendation).toBe('manual_review');
    expect(evaluateReconciliationPolicy({ visualQaScore: 0.95 }).recommendation).toBe('manual_review');
  });

  it('9. failed repair → recommended (overrides otherwise-acceptable score)', () => {
    const d = evaluateReconciliationPolicy({ visualQaScore: 0.82, repairStatus: 'failed', sourceRasterCount: 1 });
    expect(d.recommendation).toBe('recommended');
    expect(d.shouldShowAction).toBe(true);
  });

  it('10. shouldAutoRun is always false across every state', () => {
    const inputs: ReconciliationPolicyInput[] = [
      { visualQaScore: 0.95, sourceRasterCount: 1 },
      { visualQaScore: 0.86, sourceRasterCount: 1 },
      { visualQaScore: 0.65, sourceRasterCount: 1 },
      { visualQaScore: 0.91, manualReviewRequired: true, sourceRasterCount: 1 },
      { visualQaScore: 0.91, requiresFallback: true, sourceRasterCount: 1 },
      { visualQaScore: null, repairFinalScore: null, sourceRasterCount: 1 },
      { visualQaScore: 0.95, sourceRasterCount: 0 },
      { visualQaScore: 0.82, repairStatus: 'failed', sourceRasterCount: 1 },
    ];
    for (const input of inputs) expect(evaluateReconciliationPolicy(input).shouldAutoRun).toBe(false);
  });

  it('exposes the default thresholds', () => {
    const d = evaluateReconciliationPolicy({ visualQaScore: 0.5, sourceRasterCount: 1 });
    expect(d.thresholds).toEqual(DEFAULT_RECONCILIATION_THRESHOLDS);
    expect(DEFAULT_RECONCILIATION_THRESHOLDS.highQuality).toBe(0.92);
    expect(DEFAULT_RECONCILIATION_THRESHOLDS.minimumAcceptable).toBe(0.80);
  });
});
