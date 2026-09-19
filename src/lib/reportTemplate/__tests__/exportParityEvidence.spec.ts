import { describe, expect, it } from 'vitest';
import {
  buildExportParityEvidenceRef,
  extractExportParityEvidenceFromArtifacts,
  extractExportParityEvidenceFromExistingSummary,
  extractExportParityEvidenceFromVisualQuality,
  groupExportParityEvidenceByPage,
  loadExportParityRunnerEvidence,
  EXPORT_PARITY_SUMMARY_VERSION,
  type ExportParitySummary,
} from '../ingestion/exportParity';

describe('buildExportParityEvidenceRef', () => {
  it('defaults a missing pageNumber to null', () => {
    const ref = buildExportParityEvidenceRef({ kind: 'source_raster', path: 'a.png' });
    expect(ref.pageNumber).toBeNull();
  });
  it('marks available true when a path or url is present', () => {
    expect(buildExportParityEvidenceRef({ kind: 'source_raster', path: 'a.png' }).available).toBe(true);
    expect(buildExportParityEvidenceRef({ kind: 'source_raster', url: 'http://x/a.png' }).available).toBe(true);
  });
  it('respects an explicit available false', () => {
    expect(buildExportParityEvidenceRef({ kind: 'source_raster', path: 'a.png', available: false }).available).toBe(false);
  });
});

describe('extractExportParityEvidenceFromArtifacts', () => {
  it('handles empty input', () => {
    expect(extractExportParityEvidenceFromArtifacts(null)).toEqual([]);
    expect(extractExportParityEvidenceFromArtifacts({})).toEqual([]);
  });
  it('extracts a source raster path from snake_case', () => {
    const refs = extractExportParityEvidenceFromArtifacts({ source_raster_path: 'imp/pages/source' });
    expect(refs.find((r) => r.kind === 'source_raster')?.path).toBe('imp/pages/source');
  });
  it('extracts an editor raster path from camelCase', () => {
    const refs = extractExportParityEvidenceFromArtifacts({ generatedRasterPath: 'imp/pages/generated' });
    expect(refs.find((r) => r.kind === 'editor_raster')?.path).toBe('imp/pages/generated');
  });
  it('extracts an export raster path when present', () => {
    const refs = extractExportParityEvidenceFromArtifacts({ export_raster_path: 'imp/export/raster' });
    expect(refs.find((r) => r.kind === 'export_raster')?.path).toBe('imp/export/raster');
  });
  it('extracts per-page raster paths', () => {
    const refs = extractExportParityEvidenceFromArtifacts({
      pages: [{ pageNumber: 3, source: 's3.png', generated: 'g3.png' }],
    });
    expect(refs.find((r) => r.kind === 'source_raster' && r.pageNumber === 3)?.path).toBe('s3.png');
    expect(refs.find((r) => r.kind === 'editor_raster' && r.pageNumber === 3)?.path).toBe('g3.png');
  });
});

describe('extractExportParityEvidenceFromVisualQuality', () => {
  it('extracts document + per-page scores and raster availability', () => {
    const refs = extractExportParityEvidenceFromVisualQuality({
      report: { overallScore: 0.92, pages: [{ pageNumber: 1, overallScore: 0.95 }] },
      signedUrls: { '1:source': 'http://x/s', '1:generated': 'http://x/g' },
    });
    const doc = refs.find((r) => r.kind === 'visual_quality_summary' && r.pageNumber === null);
    expect(doc?.score).toBe(0.92);
    const page = refs.find((r) => r.kind === 'visual_quality_summary' && r.pageNumber === 1);
    expect(page?.score).toBe(0.95);
    expect(refs.find((r) => r.kind === 'source_raster' && r.pageNumber === 1)?.available).toBe(true);
    expect(refs.find((r) => r.kind === 'editor_raster' && r.pageNumber === 1)?.available).toBe(true);
  });
  it('handles a bare report with pageSummaries', () => {
    const refs = extractExportParityEvidenceFromVisualQuality({
      overallScore: 0.8,
      pageSummaries: [{ pageNumber: 2, score: 0.7 }],
    });
    expect(refs.find((r) => r.kind === 'visual_quality_summary' && r.pageNumber === 2)?.score).toBe(0.7);
  });
});

function summary(overrides: Partial<ExportParitySummary> = {}): ExportParitySummary {
  return {
    version: EXPORT_PARITY_SUMMARY_VERSION,
    importId: 'imp-1',
    templateId: 'tpl-1',
    mode: 'manual',
    status: 'completed',
    sourcePageCount: 1,
    editorPageCount: 1,
    exportedPageCount: 1,
    editorVsSourceScore: 0.9,
    exportVsSourceScore: 0.85,
    exportVsEditorScore: 0.8,
    manualReviewRequired: false,
    pages: [],
    problems: [],
    artifactPaths: {},
    generatedAt: '2026-07-05T00:00:00.000Z',
    ...overrides,
  };
}

describe('extractExportParityEvidenceFromExistingSummary', () => {
  it('creates manual/evidence refs from summary scores', () => {
    const refs = extractExportParityEvidenceFromExistingSummary(summary());
    expect(refs.some((r) => r.kind === 'existing_export_parity_summary')).toBe(true);
    expect(refs.filter((r) => r.kind === 'manual_metrics').map((r) => r.score).sort()).toEqual([0.8, 0.85, 0.9]);
  });
  it('returns empty for a null summary', () => {
    expect(extractExportParityEvidenceFromExistingSummary(null)).toEqual([]);
  });
});

describe('groupExportParityEvidenceByPage', () => {
  it('groups refs by page number', () => {
    const refs = [
      buildExportParityEvidenceRef({ kind: 'source_raster', pageNumber: 1, path: 's1' }),
      buildExportParityEvidenceRef({ kind: 'editor_raster', pageNumber: 1, path: 'g1' }),
      buildExportParityEvidenceRef({ kind: 'source_raster', pageNumber: 2, path: 's2' }),
    ];
    const grouped = groupExportParityEvidenceByPage(refs);
    expect(grouped[1]).toHaveLength(2);
    expect(grouped[2]).toHaveLength(1);
  });
  it('ignores refs with a null page number', () => {
    const refs = [buildExportParityEvidenceRef({ kind: 'visual_quality_summary', pageNumber: null, score: 0.9 })];
    expect(Object.keys(groupExportParityEvidenceByPage(refs))).toHaveLength(0);
  });
});

describe('loadExportParityRunnerEvidence', () => {
  it('returns error when importId is missing', async () => {
    const res = await loadExportParityRunnerEvidence('');
    expect(res.kind).toBe('error');
  });
});
