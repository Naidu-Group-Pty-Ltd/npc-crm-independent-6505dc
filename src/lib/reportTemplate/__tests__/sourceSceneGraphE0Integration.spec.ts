/**
 * E1 ↔ E0 integration + lazy loader (Phase 13–14).
 *
 * Proves V3 source evidence is PREFERRED when valid, that an invalid / missing /
 * region-less V3 falls back to the legacy Docling adapter (E0 never weakened),
 * and that the loader fetches one page at a time with explicit states.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  buildSourceCriticalEvidenceFromSceneGraph,
  chooseSourceCriticalEvidence,
} from '../pdfImport/criticalVisualContainmentAdapters';
import { loadSourcePageScene, resolveV3Manifest } from '../pdfImport/sourceScenePageLoader';
import {
  SOURCE_SCENE_GRAPH_VERSION,
  SOURCE_REGION_VERSION,
  PAGE_ARTIFACT_CONTRACT_VERSION,
  type SourceRegionV2,
  type SourcePageSceneV2,
  type SourceSceneGraphV2,
} from '../pdfImport/sourceSceneGraphV2.pure';
import type { DoclingDocument } from '../pdfImport/docling/doclingTypes';

const crop = (path: string) => ({ path, sha256: 'a'.repeat(64), mime: 'image/png' as const, widthPx: 400, heightPx: 300, sourceDpi: 300, paddingPt: 2 });

function region(over: Partial<SourceRegionV2> & { id: string; type: SourceRegionV2['type'] }): SourceRegionV2 {
  return {
    version: SOURCE_REGION_VERSION, id: over.id, pageId: over.pageId ?? 'p7', pageNumber: over.pageNumber ?? 7,
    type: over.type, bbox: over.bbox ?? { x: 10, y: 20, width: 200, height: 150 }, polygon: null, readingOrder: null,
    zOrderHint: null, confidence: null,
    sourceCrop: over.sourceCrop ?? { path: null, sha256: null, mime: null, widthPx: null, heightPx: null, sourceDpi: null, paddingPt: null },
    text: over.text ?? null, table: over.table ?? null, chart: over.chart ?? null, visual: null,
    relationships: { parentRegionId: null, childRegionIds: [], captionRegionIds: [], labelRegionIds: [] },
    providerEvidence: [], problems: [], complete: over.complete ?? true,
  };
}

function scene(regions: SourceRegionV2[]): SourceSceneGraphV2 {
  const page: SourcePageSceneV2 = {
    version: SOURCE_SCENE_GRAPH_VERSION, pageId: 'p7', pageNumber: 7,
    geometry: { widthPt: 595, heightPt: 842, rotation: 0 },
    sourceRaster: { path: 'j/pages/page-007.png', sha256: 'b'.repeat(64), widthPx: 2480, heightPx: 3508, dpi: 300, mime: 'image/png' },
    foreground: null, sourceSpansPath: null, regionsPath: 'j/pages/page-007/regions.json',
    regionCount: regions.length, criticalRegionCount: regions.filter((r) => r.type !== 'text').length,
    regionIds: regions.map((r) => r.id), regions, problems: [], complete: true,
  };
  return {
    version: SOURCE_SCENE_GRAPH_VERSION, source: { sourceSha256: 'a'.repeat(64), mime: 'application/pdf', pageCount: 1 },
    coordinateSpace: { units: 'pdf-point', origin: 'top-left', xIncreases: 'right', yIncreases: 'down' },
    extraction: { engine: 'docling', engineVersion: '2.14.0', lanePolicyVersion: 'extractor-lane-policy-v2', artifactContractVersion: PAGE_ARTIFACT_CONTRACT_VERSION, generatedAt: 'x' },
    pages: [page], problems: [], complete: true,
  };
}

describe('E0 evidence from V3 scene graph', () => {
  it('#103 valid chart region with crop becomes E0 chart evidence (hasCrop true)', () => {
    const g = scene([region({ id: 'src-p0007-chrt-0001-aaaa', type: 'chart', sourceCrop: crop('j/pages/page-007/regions/c.png'), chart: { version: 'source-chart-metadata-v2', chartType: 'bar', caption: 'Price History', structuredDataPath: null, seriesCount: null, categoryCount: null, axisLabelRegionIds: [], legendRegionIds: [], extractionState: 'crop_only', problems: [] } })]);
    const ev = buildSourceCriticalEvidenceFromSceneGraph(g);
    const chart = ev[7].regions.find((r) => r.kind === 'chart');
    expect(chart?.hasCrop).toBe(true);
    expect(chart?.chartLike).toBe(true);
  });

  it('#104 valid table region with crop becomes E0 table evidence', () => {
    const g = scene([region({
      id: 'src-p0007-tabl-0001-bbbb', type: 'table', sourceCrop: crop('j/pages/page-007/regions/t.png'),
      table: { version: 'source-table-topology-v2', numRows: 5, numCols: 3, headerRowCount: 1, headerColumnCount: 0, cells: [], caption: null, sourceProvider: 'docling', topologyProblems: [], complete: true },
    })]);
    const ev = buildSourceCriticalEvidenceFromSceneGraph(g);
    const table = ev[7].regions.find((r) => r.kind === 'table');
    expect(table?.hasCrop).toBe(true);
    expect(table?.tableRowCount).toBe(5);
    expect(table?.tableHasHeaderCells).toBe(true);
  });

  it('a chart region WITHOUT a crop reports hasCrop false (E0 will block/hybrid)', () => {
    const g = scene([region({ id: 'src-p0007-chrt-0002-cccc', type: 'chart' })]);
    expect(buildSourceCriticalEvidenceFromSceneGraph(g)[7].regions[0].hasCrop).toBe(false);
  });
});

const doclingDoc: DoclingDocument = {
  tables: [{ self_ref: '#/tables/0', prov: [{ page_no: 7, bbox: { l: 10, t: 20, r: 210, b: 170 } }], data: { num_rows: 2, num_cols: 2, table_cells: [{ text: 'H', column_header: true }] } }],
  pictures: [], texts: [], vectors: [],
} as unknown as DoclingDocument;

describe('chooseSourceCriticalEvidence (E0 never weakened)', () => {
  it('prefers a valid V3 scene with regions', () => {
    const g = scene([region({ id: 'src-p0007-chrt-0001-aaaa', type: 'chart', sourceCrop: crop('j/c.png') })]);
    const chosen = chooseSourceCriticalEvidence({ sourceSceneGraph: g, doclingDoc });
    expect(chosen.source).toBe('source-scene-graph-v2');
    expect(chosen.v3State).toBe('valid_v2');
  });

  it('#105 an invalid V3 falls back to legacy (cannot weaken E0)', () => {
    const broken = { version: SOURCE_SCENE_GRAPH_VERSION, pages: [{ version: SOURCE_SCENE_GRAPH_VERSION, pageId: 'p7', pageNumber: 7, regionIds: ['x'], regions: [region({ id: 'x', type: 'chart' })] }] };
    const chosen = chooseSourceCriticalEvidence({ sourceSceneGraph: broken, doclingDoc });
    expect(chosen.source).toBe('docling-legacy');
    expect(chosen.v3State).toBe('invalid_v2');
    // Legacy still surfaces the source table as evidence.
    expect(chosen.byPage[7]?.regions.some((r) => r.kind === 'table')).toBe(true);
  });

  it('#106 a missing V3 uses the legacy Docling adapter', () => {
    const chosen = chooseSourceCriticalEvidence({ sourceSceneGraph: null, doclingDoc });
    expect(chosen.source).toBe('docling-legacy');
    expect(chosen.v3State).toBe('legacy_missing');
  });

  it('a valid V3 scene with NO regions falls back to legacy', () => {
    const empty = scene([]);
    const chosen = chooseSourceCriticalEvidence({ sourceSceneGraph: empty, doclingDoc });
    expect(chosen.source).toBe('docling-legacy');
    expect(chosen.v3State).toBe('no_regions');
  });
});

// ── Lazy loader ──────────────────────────────────────────────────────────────

function v3ManifestFor(pageNos: number[]) {
  return {
    version: 'per-page-docling-v1', artifact_contract_version: PAGE_ARTIFACT_CONTRACT_VERSION,
    scene_graph_version: SOURCE_SCENE_GRAPH_VERSION, job_id: 'job', page_count: pageNos.length,
    pages: pageNos.map((n) => ({
      page_no: n, page_id: `docling-page-${n}`, source_path: `job/pages/page-${String(n).padStart(3, '0')}.png`,
      source_sha256: 'a'.repeat(64), regions_path: `job/pages/page-${String(n).padStart(3, '0')}/regions.json`,
      source_spans_path: `job/pages/page-${String(n).padStart(3, '0')}/source-spans.json`,
      foreground_path: `job/pages/page-${String(n).padStart(3, '0')}/foreground.json`,
      region_crop_paths: { [`src-p${String(n).padStart(4, '0')}-chrt-0001-abcd1234`]: `job/pages/page-${String(n).padStart(3, '0')}/regions/x.png` },
      region_count: 1, critical_region_count: 1, scene_graph_version: SOURCE_SCENE_GRAPH_VERSION, complete: true, problems: [],
    })),
  };
}

describe('lazy source-scene page loader', () => {
  it('loads only the requested page', async () => {
    const manifest = v3ManifestFor([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const load = vi.fn(async (path: string) => {
      if (path.includes('page-007/regions')) return { regions: [region({ id: 'src-p0007-chrt-0001-abcd1234', type: 'chart', sourceCrop: crop('job/pages/page-007/regions/x.png') })] };
      throw new Error('should not fetch other pages');
    });
    const res = await loadSourcePageScene(manifest, { importId: 'imp', pageNumber: 7 }, { loadArtifactJson: load });
    expect(res.state).toBe('loaded');
    expect(res.regions).toHaveLength(1);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('legacy V2 manifest → legacy state (no fetch)', async () => {
    const load = vi.fn(async () => ({}));
    const res = await loadSourcePageScene({ artifact_contract_version: 'pdf-page-artifact-contract-v2', pages: [{ page_no: 1 }] }, { importId: 'imp', pageNumber: 1 }, { loadArtifactJson: load });
    expect(res.state).toBe('legacy');
    expect(load).not.toHaveBeenCalled();
  });

  it('missing page → page_missing', async () => {
    const res = await loadSourcePageScene(v3ManifestFor([1, 2]), { importId: 'imp', pageNumber: 9 }, { loadArtifactJson: async () => ({}) });
    expect(res.state).toBe('page_missing');
  });

  it('regions fetch failure → unavailable (not a false success)', async () => {
    const res = await loadSourcePageScene(v3ManifestFor([7]), { importId: 'imp', pageNumber: 7 }, { loadArtifactJson: async () => { throw new Error('403'); } });
    expect(res.state).toBe('unavailable');
  });

  it('resolveV3Manifest reports preference', () => {
    expect(resolveV3Manifest(v3ManifestFor([1, 2]), 'job').preferred).toBe(true);
    expect(resolveV3Manifest({ artifact_contract_version: 'pdf-page-artifact-contract-v2' }).preferred).toBe(false);
  });
});
