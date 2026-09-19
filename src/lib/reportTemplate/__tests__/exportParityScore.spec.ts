import { describe, expect, it } from 'vitest';
import {
  averageExportParityScores,
  buildExportParityPageComparison,
  clampExportParityScore,
  resolveExportParityPairStatus,
  summarizeExportParityPairScores,
} from '../ingestion/exportParity';

describe('clampExportParityScore', () => {
  it('accepts a number in range', () => {
    expect(clampExportParityScore(0.9)).toBe(0.9);
  });
  it('parses a numeric string', () => {
    expect(clampExportParityScore('0.75')).toBe(0.75);
  });
  it('clamps below 0 to 0', () => {
    expect(clampExportParityScore(-0.5)).toBe(0);
  });
  it('clamps above 1 to 1', () => {
    expect(clampExportParityScore(1.4)).toBe(1);
  });
  it('returns null for an invalid string', () => {
    expect(clampExportParityScore('nope')).toBeNull();
    expect(clampExportParityScore(null)).toBeNull();
    expect(clampExportParityScore(undefined)).toBeNull();
  });
});

describe('averageExportParityScores', () => {
  it('ignores nulls', () => {
    expect(averageExportParityScores([0.8, null, 1.0, undefined])).toBeCloseTo(0.9, 5);
  });
  it('returns null when no valid scores', () => {
    expect(averageExportParityScores([null, undefined, 'x' as any])).toBeNull();
  });
});

describe('resolveExportParityPairStatus', () => {
  it('returns pass at or above the pass threshold', () => {
    expect(resolveExportParityPairStatus({ score: 0.95 })).toBe('pass');
  });
  it('returns warning between warning and pass thresholds', () => {
    expect(resolveExportParityPairStatus({ score: 0.85 })).toBe('warning');
  });
  it('returns fail below the warning threshold', () => {
    expect(resolveExportParityPairStatus({ score: 0.5 })).toBe('fail');
  });
  it('returns manual_required when score missing and missingIsManual', () => {
    expect(resolveExportParityPairStatus({ score: null, missingIsManual: true })).toBe('manual_required');
    expect(resolveExportParityPairStatus({ score: null })).toBe('missing');
  });
});

describe('buildExportParityPageComparison', () => {
  it('builds a comparison with resolved status and a default message', () => {
    const c = buildExportParityPageComparison({ pageNumber: 2, pair: 'source_vs_editor', score: 0.95 });
    expect(c.pageNumber).toBe(2);
    expect(c.pair).toBe('source_vs_editor');
    expect(c.status).toBe('pass');
    expect(c.message).toMatch(/source vs editor/);
    expect(c.evidence.left).toBeNull();
    expect(c.evidence.right).toBeNull();
  });
});

describe('summarizeExportParityPairScores', () => {
  const comps = [
    buildExportParityPageComparison({ pageNumber: 1, pair: 'source_vs_editor', score: 0.9 }),
    buildExportParityPageComparison({ pageNumber: 2, pair: 'source_vs_editor', score: 0.8 }),
    buildExportParityPageComparison({ pageNumber: 1, pair: 'source_vs_export', score: 0.7 }),
    buildExportParityPageComparison({ pageNumber: 1, pair: 'editor_vs_export', score: 0.6 }),
  ];

  it('averages source_vs_editor into editorVsSourceScore', () => {
    expect(summarizeExportParityPairScores(comps).editorVsSourceScore).toBeCloseTo(0.85, 5);
  });
  it('averages source_vs_export into exportVsSourceScore', () => {
    expect(summarizeExportParityPairScores(comps).exportVsSourceScore).toBeCloseTo(0.7, 5);
  });
  it('averages editor_vs_export into exportVsEditorScore', () => {
    expect(summarizeExportParityPairScores(comps).exportVsEditorScore).toBeCloseTo(0.6, 5);
  });
  it('computes overall from the available pair averages', () => {
    // (0.85 + 0.7 + 0.6) / 3
    expect(summarizeExportParityPairScores(comps).overallScore).toBeCloseTo(0.716666, 4);
  });
  it('returns null pair scores when a pair is absent', () => {
    const onlyEditor = [buildExportParityPageComparison({ pageNumber: 1, pair: 'source_vs_editor', score: 0.9 })];
    const s = summarizeExportParityPairScores(onlyEditor);
    expect(s.exportVsSourceScore).toBeNull();
    expect(s.exportVsEditorScore).toBeNull();
    expect(s.editorVsSourceScore).toBe(0.9);
    expect(s.overallScore).toBe(0.9);
  });
});
