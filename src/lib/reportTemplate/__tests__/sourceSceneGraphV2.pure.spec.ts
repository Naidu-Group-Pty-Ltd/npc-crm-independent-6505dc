/**
 * source-scene-graph-v2 (E1) — canonical TS contract + cross-runtime agreement.
 *
 * The region-ID / FNV values below are PINNED from the Python producer
 * (`pdf-parse-service/source_scene_graph.py`, mirrored in
 * `test_source_scene_graph.py::test_fnv_known_value`). If either side changes
 * the algorithm, this test fails — the two runtimes must never silently drift.
 */
import { describe, it, expect } from 'vitest';
import {
  SOURCE_SCENE_GRAPH_VERSION,
  SOURCE_REGION_VERSION,
  PAGE_ARTIFACT_CONTRACT_VERSION,
  fnv1a32,
  regionId,
  normalizeBBox,
  isSafeArtifactPath,
  validateSourceSceneGraphV2,
  validateSourcePageSceneV2,
  type SourceRegionV2,
  type SourcePageSceneV2,
  type SourceSceneGraphV2,
} from '../pdfImport/sourceSceneGraphV2.pure';

function region(over: Partial<SourceRegionV2> & { id: string; type: SourceRegionV2['type'] }): SourceRegionV2 {
  return {
    version: SOURCE_REGION_VERSION,
    id: over.id,
    pageId: over.pageId ?? 'p1',
    pageNumber: over.pageNumber ?? 1,
    type: over.type,
    bbox: over.bbox ?? { x: 10, y: 20, width: 100, height: 80 },
    polygon: null,
    readingOrder: null,
    zOrderHint: null,
    confidence: over.confidence ?? null,
    sourceCrop: over.sourceCrop ?? { path: null, sha256: null, mime: null, widthPx: null, heightPx: null, sourceDpi: null, paddingPt: null },
    text: over.text ?? null,
    table: over.table ?? null,
    chart: over.chart ?? null,
    visual: null,
    relationships: { parentRegionId: null, childRegionIds: [], captionRegionIds: [], labelRegionIds: [] },
    providerEvidence: [],
    problems: over.problems ?? [],
    complete: over.complete ?? true,
  };
}

function pageScene(regions: SourceRegionV2[], over: Partial<SourcePageSceneV2> = {}): SourcePageSceneV2 {
  return {
    version: SOURCE_SCENE_GRAPH_VERSION,
    pageId: over.pageId ?? 'p1',
    pageNumber: over.pageNumber ?? 1,
    geometry: { widthPt: 595, heightPt: 842, rotation: 0 },
    sourceRaster: { path: 'j/pages/page-001.png', sha256: 'a'.repeat(64), widthPx: 2480, heightPx: 3508, dpi: 300, mime: 'image/png' },
    foreground: null,
    sourceSpansPath: 'j/pages/page-001/source-spans.json',
    regionsPath: 'j/pages/page-001/regions.json',
    regionCount: regions.length,
    criticalRegionCount: regions.filter((r) => r.type !== 'text').length,
    regionIds: regions.map((r) => r.id),
    regions,
    problems: [],
    complete: true,
    ...over,
  };
}

function sceneGraph(pages: SourcePageSceneV2[]): SourceSceneGraphV2 {
  return {
    version: SOURCE_SCENE_GRAPH_VERSION,
    source: { sourceSha256: 'a'.repeat(64), mime: 'application/pdf', pageCount: pages.length },
    coordinateSpace: { units: 'pdf-point', origin: 'top-left', xIncreases: 'right', yIncreases: 'down' },
    extraction: { engine: 'docling', engineVersion: '2.14.0', lanePolicyVersion: 'extractor-lane-policy-v2', artifactContractVersion: PAGE_ARTIFACT_CONTRACT_VERSION, generatedAt: '2026-07-20T00:00:00Z' },
    pages,
    problems: [],
    complete: true,
  };
}

describe('source-scene-graph-v2 — versions', () => {
  it('pins the three contract versions', () => {
    expect(SOURCE_SCENE_GRAPH_VERSION).toBe('source-scene-graph-v2');
    expect(SOURCE_REGION_VERSION).toBe('source-region-v2');
    expect(PAGE_ARTIFACT_CONTRACT_VERSION).toBe('pdf-page-artifact-contract-v3');
  });
});

describe('cross-runtime ID agreement with the Python producer', () => {
  it('FNV-1a matches Python for ASCII + Unicode', () => {
    expect(fnv1a32('hello')).toBe('4f9f2cab');
    expect(fnv1a32('Café – 3.5% × ↔')).toBe('a3579d3d');
  });
  it('region IDs match Python region_id() byte-for-byte', () => {
    expect(regionId(1, 'table', { x: 10, y: 20, width: 100, height: 80 }, 1)).toBe('src-p0001-tabl-0001-b4bee55d');
    expect(regionId(7, 'chart', { x: 12.34, y: 56.78, width: 400.0, height: 300.5 }, 2)).toBe('src-p0007-chrt-0002-662a406a');
  });
  it('is stable across repeated calls (no time/order input)', () => {
    const a = regionId(3, 'picture', { x: 1, y: 2, width: 3, height: 4 }, 1);
    const b = regionId(3, 'picture', { x: 1, y: 2, width: 3, height: 4 }, 1);
    expect(a).toBe(b);
  });
});

describe('coordinate normalisation', () => {
  it('TOPLEFT stays put', () => {
    const { bbox, problems } = normalizeBBox({ l: 10, t: 20, r: 110, b: 100, coord_origin: 'TOPLEFT' }, 595, 842);
    expect(bbox).toEqual({ x: 10, y: 20, width: 100, height: 80 });
    expect(problems).toEqual([]);
  });
  it('BOTTOMLEFT converts', () => {
    const { bbox } = normalizeBBox({ l: 10, t: 742, r: 110, b: 822, coord_origin: 'BOTTOMLEFT' }, 595, 842);
    expect(bbox?.y).toBe(20);
    expect(bbox?.height).toBe(80);
  });
  it('off-page rejected; overshoot clamped+flagged', () => {
    expect(normalizeBBox({ l: 700, t: 900, r: 800, b: 1000 }, 595, 842).bbox).toBeNull();
    const clamped = normalizeBBox({ l: -5, t: -5, r: 600, b: 850 }, 595, 842);
    expect(clamped.bbox?.x).toBe(0);
    expect(clamped.problems).toContain('bbox_exceeds_page_clamped');
  });
  it('zero-area rejected', () => {
    expect(normalizeBBox({ l: 10, t: 20, r: 10, b: 40 }, 595, 842).bbox).toBeNull();
  });
});

describe('path safety', () => {
  it('accepts durable job-relative paths, rejects traversal / URLs / data', () => {
    expect(isSafeArtifactPath('job/pages/page-001/regions/src-p0001-chrt-0001-abcd.png')).toBe(true);
    expect(isSafeArtifactPath('../../etc/passwd')).toBe(false);
    expect(isSafeArtifactPath('/abs/path.png')).toBe(false);
    expect(isSafeArtifactPath('https://x.supabase.co/o?token=abc')).toBe(false);
    expect(isSafeArtifactPath('data:image/png;base64,AAAA')).toBe(false);
  });
});

describe('scene-graph validation states', () => {
  it('valid V2 passes', () => {
    const r = validateSourceSceneGraphV2(sceneGraph([pageScene([
      region({ id: 'src-p0001-chrt-0001-aaaa', type: 'chart', sourceCrop: { path: 'j/pages/page-001/regions/c.png', sha256: 'b'.repeat(64), mime: 'image/png', widthPx: 400, heightPx: 300, sourceDpi: 300, paddingPt: 2 } }),
    ])]));
    expect(r.ok).toBe(true);
    expect(r.state).toBe('valid_v2');
  });
  it('missing scene → legacy_missing', () => {
    expect(validateSourceSceneGraphV2(null).state).toBe('legacy_missing');
    expect(validateSourceSceneGraphV2(undefined).state).toBe('legacy_missing');
  });
  it('unknown future version → unknown_version (not interpreted as V2)', () => {
    expect(validateSourceSceneGraphV2({ version: 'source-scene-graph-v9', pages: [] }).state).toBe('unknown_version');
  });
  it('invalid claimed V2 → invalid_v2', () => {
    const bad = sceneGraph([pageScene([
      region({ id: 'src-x', type: 'chart' }), // crop-required, no crop
    ])]);
    const r = validateSourceSceneGraphV2(bad);
    expect(r.state).toBe('invalid_v2');
    expect(r.problems).toContain('critical_region_missing_crop');
    expect(r.scene).toBeNull();
  });
  it('does not mutate its input', () => {
    const input = sceneGraph([pageScene([region({ id: 'src-1', type: 'text' })])]);
    const snapshot = JSON.stringify(input);
    validateSourceSceneGraphV2(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
  it('non-finite bbox rejected', () => {
    const bad = pageScene([region({ id: 'src-1', type: 'picture', bbox: { x: Number.NaN, y: 1, width: 5, height: 5 } as never })]);
    expect(validateSourcePageSceneV2(bad).problems.some((p) => p.includes('non_finite'))).toBe(true);
  });
  it('duplicate region IDs across pages rejected', () => {
    const r = validateSourceSceneGraphV2(sceneGraph([
      pageScene([region({ id: 'dup', type: 'text' })], { pageId: 'p1', pageNumber: 1 }),
      pageScene([region({ id: 'dup', type: 'text' })], { pageId: 'p2', pageNumber: 2 }),
    ]));
    expect(r.problems.some((p) => p.startsWith('duplicate_region_id'))).toBe(true);
  });
  it('external URL crop path rejected', () => {
    const bad = pageScene([region({ id: 'src-1', type: 'picture', sourceCrop: { path: 'https://evil/x.png', sha256: null, mime: null, widthPx: null, heightPx: null, sourceDpi: null, paddingPt: null } })]);
    expect(validateSourcePageSceneV2(bad).problems).toContain('region_crop_path_unsafe');
  });
  it('invalid SHA rejected', () => {
    const bad = pageScene([region({ id: 'src-1', type: 'picture', sourceCrop: { path: 'j/x.png', sha256: 'nope', mime: 'image/png', widthPx: 1, heightPx: 1, sourceDpi: 300, paddingPt: 2 } })]);
    expect(validateSourcePageSceneV2(bad).problems).toContain('region_crop_sha_invalid');
  });
  it('invalid table span rejected', () => {
    const bad = pageScene([region({
      id: 'src-1', type: 'table',
      sourceCrop: { path: 'j/t.png', sha256: 'c'.repeat(64), mime: 'image/png', widthPx: 1, heightPx: 1, sourceDpi: 300, paddingPt: 2 },
      table: {
        version: 'source-table-topology-v2', numRows: 1, numCols: 2, headerRowCount: 0, headerColumnCount: 0,
        cells: [{ id: 'r0c0', row: 0, col: 0, rowSpan: 1, colSpan: 5, columnHeader: false, rowHeader: false, text: 'x', numericTokens: [], bbox: null, confidence: null, providerRefs: [] }],
        caption: null, sourceProvider: 'docling', topologyProblems: [], complete: true,
      },
    })]);
    expect(validateSourcePageSceneV2(bad).problems).toContain('table_cell_col_out_of_bounds');
  });
});
