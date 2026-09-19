import { describe, expect, it } from 'vitest';
import {
  buildCdirFidelityReport,
  buildImportReviewDraft,
  recommendImportDecision,
  textAccuracy,
  unionArea,
  type CdirDocument,
} from '../ingestion';

const doc = (layers: CdirDocument['pages'][number]['layers']): CdirDocument => ({
  version: 1,
  source: { kind: 'image', checksum: 'sha256:test', filename: 'source.png' },
  pages: [{ id: 'p1', label: 'Page 1', width: 100, height: 100, layers }],
  assets: [],
  fonts: [],
  warnings: [],
});

describe('ingestion fidelity metrics', () => {
  it('computes overlap-safe union area', () => {
    expect(unionArea([
      { x: 0, y: 0, width: 50, height: 50 },
      { x: 25, y: 0, width: 50, height: 50 },
    ])).toBe(3750);
  });

  it('scores text accuracy using normalized edit distance', () => {
    expect(textAccuracy('Hello   world', 'Hello world')).toBe(1);
    expect(textAccuracy('Hello word', 'Hello world')).toBeGreaterThan(0.9);
    expect(textAccuracy('', 'Hello world')).toBe(0);
  });

  it('bounds edit-distance work for oversized extracted text', () => {
    const sharedPrefix = 'a'.repeat(1_024);
    const sharedMiddle = 'm'.repeat(100_000);
    const actual = `${sharedPrefix}${sharedMiddle}${'x'.repeat(1_024)}`;
    const expected = `${sharedPrefix}${sharedMiddle}${'y'.repeat(1_024)}`;

    // Oversized inputs are represented by fixed-size head/tail samples.
    expect(textAccuracy(actual, expected)).toBe(textAccuracy(
      `${sharedPrefix}${'x'.repeat(1_024)}`,
      `${sharedPrefix}${'y'.repeat(1_024)}`,
    ));
    expect(textAccuracy(actual, expected)).toBe(0.5);
  });

  it('reports native coverage, fallback raster coverage, text accuracy, and drift warnings', () => {
    const report = buildCdirFidelityReport(doc([
      { id: 'text_1', kind: 'text', text: 'Exact heading', bounds: { x: 0, y: 0, width: 50, height: 10 }, fontSize: 10 },
      { id: 'fallback_1', kind: 'image', src: 'data:image/png;base64,a', fallbackRaster: true, bounds: { x: 0, y: 50, width: 100, height: 50 } },
    ]), {
      expectedText: [{ pageId: 'p1', text: 'Exact heading' }],
      expectedBounds: [{ pageId: 'p1', layerId: 'text_1', bounds: { x: 0, y: 0, width: 50, height: 10 } }],
    });

    expect(report.nativeCoverage).toBe(0.05);
    expect(report.rasterFallbackCoverage).toBe(0.5);
    expect(report.textAccuracy).toBe(1);
    expect(report.medianPositionDrift).toBe(0);
    expect(report.fallbackRasterLayerCount).toBe(1);
    expect(report.warnings.map((warning) => warning.code)).toEqual(['native_coverage_low', 'raster_fallback_high']);
  });

  it('counts only the genuinely-uncovered area as raster fallback (full-page trace behind overlays)', () => {
    // Mirrors the real raster-backed import: a full-page fallback raster trace sits
    // behind native overlays. The metric must reflect the area the raster *actually*
    // backs (the part not reconstructed), not the whole page.
    const report = buildCdirFidelityReport(doc([
      { id: 'bg_fallback', kind: 'image', src: 'data:image/png;base64,a', fallbackRaster: true, bounds: { x: 0, y: 0, width: 100, height: 100 } },
      { id: 'text_1', kind: 'text', text: 'Reconstructed', bounds: { x: 0, y: 0, width: 100, height: 60 }, fontSize: 10 },
    ]));

    // 60% of the page is natively reconstructed on top of the full-page raster.
    expect(report.nativeCoverage).toBe(0.6);
    // The raster only genuinely backs the remaining 40% — NOT 1.0 (the old artifact).
    expect(report.rasterFallbackCoverage).toBe(0.4);
    // The full-page trace layer is still present (kept for visual QA / underlay).
    expect(report.fallbackRasterLayerCount).toBe(1);
  });

  it('penalizes copy drift and position drift', () => {
    const report = buildCdirFidelityReport(doc([
      { id: 'text_1', kind: 'text', text: 'Wrong copy', bounds: { x: 20, y: 0, width: 50, height: 10 }, fontSize: 10 },
    ]), {
      expectedText: [{ pageId: 'p1', text: 'Expected copy' }],
      expectedBounds: [{ pageId: 'p1', layerId: 'text_1', bounds: { x: 0, y: 0, width: 50, height: 10 } }],
    });

    expect(report.textAccuracy).toBeLessThan(0.7);
    expect(report.medianPositionDrift).toBe(20);
    expect(report.warnings.map((warning) => warning.code)).toContain('text_accuracy_low');
    expect(report.warnings.map((warning) => warning.code)).toContain('position_drift_high');
  });
});

describe('import review draft', () => {
  it('builds a review draft with a mapped template and recommended decision', () => {
    const cdir = doc([
      { id: 'text_1', kind: 'text', text: 'Ready', bounds: { x: 0, y: 0, width: 100, height: 100 }, fontSize: 12 },
    ]);
    const draft = buildImportReviewDraft({
      id: 'review_1',
      cdir,
      fidelityOptions: { expectedText: [{ pageId: 'p1', text: 'Ready' }] },
      now: () => new Date('2026-01-02T03:04:05.000Z'),
    });

    expect(draft.id).toBe('review_1');
    expect(draft.createdAt).toBe('2026-01-02T03:04:05.000Z');
    expect(draft.template.pages[0].blocks[0].overlays[0]).toMatchObject({ type: 'text', content: 'Ready' });
    expect(draft.recommendedDecision).toBe('accept');
  });

  it('recommends trace/manual/retry decisions from quality bands', () => {
    expect(recommendImportDecision({
      overallScore: 0.85,
      rasterFallbackCoverage: 0.2,
      nativeCoverage: 0.8,
      textAccuracy: null,
      medianPositionDrift: null,
      p95PositionDrift: null,
      editableLayerCount: 1,
      fallbackRasterLayerCount: 1,
      pages: [],
      warnings: [],
    })).toBe('accept_with_trace');
    expect(recommendImportDecision({
      overallScore: 0.5,
      rasterFallbackCoverage: 0.5,
      nativeCoverage: 0.5,
      textAccuracy: null,
      medianPositionDrift: null,
      p95PositionDrift: null,
      editableLayerCount: 1,
      fallbackRasterLayerCount: 1,
      pages: [],
      warnings: [],
    })).toBe('manual_edit');
    expect(recommendImportDecision({
      overallScore: 0.99,
      rasterFallbackCoverage: 0,
      nativeCoverage: 1,
      textAccuracy: 1,
      medianPositionDrift: 0,
      p95PositionDrift: 0,
      editableLayerCount: 1,
      fallbackRasterLayerCount: 0,
      pages: [],
      warnings: [{ code: 'fatal', severity: 'error', message: 'Bad parse' }],
    })).toBe('retry');
  });
});
