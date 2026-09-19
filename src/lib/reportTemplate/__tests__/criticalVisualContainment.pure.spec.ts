/**
 * critical-visual-containment-v1 classifier + hard-veto (PDF Extraction V3 · E0).
 *
 * Locks the fail-closed-for-native-fidelity contract: charts/tables/critical
 * regions that cannot be verified never keep native output, a critical defect is
 * a HARD VETO no weighted score can override, and a rasterless critical page is
 * blocked (never a false fallback claim). Pure → vitest, no browser.
 */
import { describe, it, expect } from 'vitest';
import {
  assessPageContainment,
  classifyPageCriticalContent,
  resolveContainmentPolicy,
  areHeadersGeneric,
  hasStrongChartTerm,
  DEFAULT_CRITICAL_CONTAINMENT_POLICY,
  CRITICAL_VISUAL_CONTAINMENT_VERSION,
  type ContainmentPageInput,
  type ContainmentSourceRegion,
  type ContainmentCandidateOverlay,
} from '../pdfImport/criticalVisualContainment.pure';

function pageInput(over: Partial<ContainmentPageInput> = {}): ContainmentPageInput {
  return {
    pageId: 'docling-page-1',
    pageNumber: 1,
    candidateOverlays: [],
    sourceRegions: [],
    pageTitleChartTerms: [],
    hasNumericLabels: false,
    score: 0.9,
    qualityCoverage: 'full',
    visualQaRanForPage: true,
    visualQaFailed: false,
    pageUnscored: false,
    sourceRasterAvailable: true,
    sourceRasterReadable: true,
    ...over,
  };
}

const chartRegion = (over: Partial<ContainmentSourceRegion> = {}): ContainmentSourceRegion => ({
  id: 'src-chart-1', kind: 'chart', pageNumber: 1, hasCrop: true, chartLike: true, ...over,
});
const tableRegion = (over: Partial<ContainmentSourceRegion> = {}): ContainmentSourceRegion => ({
  id: 'src-table-1', kind: 'table', pageNumber: 1, hasCrop: false, tableRowCount: 5, tableColCount: 3, tableHasHeaderCells: true, tableCellCount: 15, ...over,
});
const imageOverlay = (hasImageSrc: boolean, id = 'ov-img-1'): ContainmentCandidateOverlay => ({ id, kind: 'image', hasImageSrc });
const tableOverlay = (over: Partial<ContainmentCandidateOverlay> = {}): ContainmentCandidateOverlay => ({
  id: 'ov-table-1', kind: 'table', tableColumnLabels: ['Region', 'Median', 'Growth'], tableRowCount: 5, tableColCount: 3, tableMinHeight: 122, bbox: { x: 0, y: 0, width: 300, height: 200 }, ...over,
});

describe('helpers', () => {
  it('areHeadersGeneric detects Column N headers', () => {
    expect(areHeadersGeneric(['Column 1', 'Column 2', 'Column 3'])).toBe(true);
    expect(areHeadersGeneric(['Region', 'Median price', 'Growth'])).toBe(false);
    expect(areHeadersGeneric(['Region', 'Column 2', 'Column 3'])).toBe(true); // majority generic
    expect(areHeadersGeneric([])).toBe(false);
  });
  it('hasStrongChartTerm detects analytical terms', () => {
    expect(hasStrongChartTerm(['Price history 2015–2024'])).toBe(true);
    expect(hasStrongChartTerm(['Rental yield comparison'])).toBe(true);
    expect(hasStrongChartTerm(['Executive summary'])).toBe(false);
  });
});

describe('classifier + action (E0 safe defaults)', () => {
  it('#1 simple prose page → no critical content, allow_native', () => {
    const a = assessPageContainment(pageInput({ candidateOverlays: [{ id: 't', kind: 'text' }], score: 0.72 }));
    expect(a.version).toBe(CRITICAL_VISUAL_CONTAINMENT_VERSION);
    expect(a.containsCriticalContent).toBe(false);
    expect(a.action).toBe('allow_native');
    expect(a.nativeAllowed).toBe(true);
  });

  it('#2 source chart + valid crop + chart-native disabled but no candidate visual → hybrid fallback', () => {
    const a = assessPageContainment(pageInput({
      sourceRegions: [chartRegion({ hasCrop: true })],
      candidateOverlays: [{ id: 't', kind: 'text' }], // no image overlay carrying the crop
    }));
    expect(a.contentKinds).toContain('chart');
    expect(a.action).toBe('force_hybrid_fallback');
    expect(a.nativeAllowed).toBe(false);
  });

  it('#3 source chart with no candidate visual → source_chart_unprotected', () => {
    const a = assessPageContainment(pageInput({ sourceRegions: [chartRegion({ hasCrop: false })] }));
    expect(a.defects.map((d) => d.code)).toContain('source_chart_unprotected');
    expect(a.action).toBe('force_hybrid_fallback');
  });

  it('#4 chart candidate image overlay with empty src → image_overlay_missing_source', () => {
    const a = assessPageContainment(pageInput({
      sourceRegions: [chartRegion({ hasCrop: true })],
      candidateOverlays: [imageOverlay(false)],
    }));
    expect(a.defects.map((d) => d.code)).toContain('image_overlay_missing_source');
    expect(a.nativeAllowed).toBe(false);
  });

  it('#5 dense vector chart-like region without crop → critical defect', () => {
    const a = assessPageContainment(pageInput({
      hasNumericLabels: true,
      candidateOverlays: [{ id: 'v', kind: 'vector', vectorPathCount: 30 }],
    }));
    expect(a.defects.map((d) => d.code)).toContain('dense_vector_region_unverified');
    expect(a.action).toBe('force_pixel_fallback');
  });

  it('#6 decorative border/vector lines do NOT become a chart false positive', () => {
    const a = assessPageContainment(pageInput({
      hasNumericLabels: false, // no numeric corroboration
      candidateOverlays: [{ id: 'v', kind: 'vector', vectorPathCount: 4 }],
    }));
    expect(a.containsCriticalContent).toBe(false);
    expect(a.action).toBe('allow_native');
  });

  it('#7 source table w/ headers + candidate Column N → generic headers → pixel fallback', () => {
    const a = assessPageContainment(pageInput({
      sourceRegions: [tableRegion({ tableHasHeaderCells: true })],
      candidateOverlays: [tableOverlay({ tableColumnLabels: ['Column 1', 'Column 2', 'Column 3'] })],
    }));
    expect(a.defects.map((d) => d.code)).toContain('table_generic_headers');
    expect(a.action).toBe('force_pixel_fallback');
  });

  it('#8 source table has rows but candidate has zero rows → table_structure_unverified', () => {
    const a = assessPageContainment(pageInput({
      sourceRegions: [tableRegion({ tableCellCount: 12 })],
      candidateOverlays: [tableOverlay({ tableRowCount: 0 })],
    }));
    expect(a.defects.map((d) => d.code)).toContain('table_structure_unverified');
    expect(a.action).toBe('force_pixel_fallback');
  });

  it('#9 candidate table min height exceeds bbox → table_possible_clipping', () => {
    const a = assessPageContainment(pageInput({
      sourceRegions: [tableRegion()],
      candidateOverlays: [tableOverlay({ tableMinHeight: 400, bbox: { x: 0, y: 0, width: 300, height: 120 } })],
    }));
    expect(a.defects.map((d) => d.code)).toContain('table_possible_clipping');
  });

  it('#10 two independent source tables → one candidate → table_possible_adjacent_merge', () => {
    const a = assessPageContainment(pageInput({
      sourceRegions: [tableRegion({ id: 's1' }), tableRegion({ id: 's2' })],
      candidateOverlays: [tableOverlay()],
    }));
    expect(a.defects.map((d) => d.code)).toContain('table_possible_adjacent_merge');
    expect(a.action).toBe('force_pixel_fallback');
  });

  it('#11 clean table stays native when unverifiedTableNativeEnabled=true and checks pass', () => {
    const input = pageInput({
      sourceRegions: [tableRegion({ tableHasHeaderCells: true })],
      candidateOverlays: [tableOverlay({ tableColumnLabels: ['Region', 'Median', 'Growth'], tableRowCount: 5 })],
    });
    const enabled = assessPageContainment(input, { unverifiedTableNativeEnabled: true });
    expect(enabled.action).toBe('allow_native');
    // …and with the E0 default (false) the same clean table is contained.
    const disabled = assessPageContainment(input);
    expect(disabled.action).toBe('force_pixel_fallback');
  });
});

describe('hard veto — score can never override a critical defect', () => {
  it('#12 score 0.99 + missing chart → nativeAllowed=false', () => {
    const a = assessPageContainment(pageInput({ score: 0.99, sourceRegions: [chartRegion({ hasCrop: false })] }));
    expect(a.score).toBe(0.99);
    expect(a.nativeAllowed).toBe(false);
    expect(a.action).toBe('force_hybrid_fallback');
  });

  it('#13 score 0.95 + generic table → nativeAllowed=false', () => {
    const a = assessPageContainment(pageInput({
      score: 0.95,
      sourceRegions: [tableRegion()],
      candidateOverlays: [tableOverlay({ tableColumnLabels: ['Column 1', 'Column 2'] })],
    }));
    expect(a.nativeAllowed).toBe(false);
    expect(a.action).toBe('force_pixel_fallback');
  });

  it('#14 critical page unscored + raster → pixel fallback', () => {
    const a = assessPageContainment(pageInput({
      score: null, pageUnscored: true, visualQaRanForPage: false, qualityCoverage: 'unknown',
      sourceRegions: [chartRegion({ hasCrop: true })], candidateOverlays: [imageOverlay(true)],
    }));
    expect(a.defects.map((d) => d.code)).toContain('critical_page_unscored');
    expect(a.action).toBe('force_pixel_fallback');
  });

  it('#15 critical page + visual QA failed (no batches) + raster → pixel fallback', () => {
    const a = assessPageContainment(pageInput({
      score: null, visualQaFailed: true, visualQaRanForPage: false, qualityCoverage: 'unknown',
      sourceRegions: [chartRegion({ hasCrop: true })], candidateOverlays: [imageOverlay(true)], pageUnscored: false,
    }));
    // unscored + failed both push pixel; assert not native
    expect(a.action).toBe('force_pixel_fallback');
    expect(a.nativeAllowed).toBe(false);
  });

  it('#16 critical page with partial coverage → native not auto-accepted', () => {
    const a = assessPageContainment(pageInput({
      qualityCoverage: 'partial', sourceRegions: [chartRegion({ hasCrop: true })], candidateOverlays: [imageOverlay(true)],
    }));
    expect(a.defects.map((d) => d.code)).toContain('critical_page_partial_coverage');
    expect(a.nativeAllowed).toBe(false);
    expect(a.action).toBe('force_pixel_fallback');
  });

  it('#17 critical page with image-only coverage → native not auto-accepted', () => {
    const a = assessPageContainment(pageInput({
      qualityCoverage: 'image-only', sourceRegions: [chartRegion({ hasCrop: true })], candidateOverlays: [imageOverlay(true)],
    }));
    expect(a.defects.map((d) => d.code)).toContain('critical_page_image_only_coverage');
    expect(a.nativeAllowed).toBe(false);
  });

  it('#18 critical page WITHOUT raster → block_manual_review, no false fallback claim', () => {
    const a = assessPageContainment(pageInput({
      sourceRasterAvailable: false, sourceRegions: [chartRegion({ hasCrop: false })],
    }));
    expect(a.action).toBe('block_manual_review');
    expect(a.nativeAllowed).toBe(false);
    expect(a.manualReviewRequired).toBe(true);
    expect(a.defects.map((d) => d.code)).toContain('critical_page_source_raster_missing');
    // Never claims a fallback was applied.
    expect(a.action).not.toBe('force_hybrid_fallback');
    expect(a.action).not.toBe('force_pixel_fallback');
  });
});

describe('policy defaults + JSON safety', () => {
  it('safe defaults are all false and resolve independently', () => {
    expect(DEFAULT_CRITICAL_CONTAINMENT_POLICY).toEqual({ complexNativeEnabled: false, chartNativeEnabled: false, unverifiedTableNativeEnabled: false });
    expect(resolveContainmentPolicy(undefined)).toEqual(DEFAULT_CRITICAL_CONTAINMENT_POLICY);
    expect(resolveContainmentPolicy({ chartNativeEnabled: true })).toEqual({ complexNativeEnabled: false, chartNativeEnabled: true, unverifiedTableNativeEnabled: false });
  });

  it('#34 assessment is JSON-safe (no secrets, images, or signed URLs)', () => {
    const a = assessPageContainment(pageInput({ sourceRegions: [chartRegion({ hasCrop: false })] }));
    const blob = JSON.stringify(a).toLowerCase();
    for (const secret of ['http://', 'https://', 'data:image', 'bearer', 'token=', 'service_role', '?sig']) {
      expect(blob).not.toContain(secret);
    }
    expect(() => JSON.stringify(a)).not.toThrow();
  });

  it('#44 classifier never invokes AI or mutates input', () => {
    const input = pageInput({ sourceRegions: [chartRegion({ hasCrop: false })] });
    const snapshot = JSON.parse(JSON.stringify(input));
    classifyPageCriticalContent(input, resolveContainmentPolicy());
    expect(input).toEqual(snapshot);
  });
});
