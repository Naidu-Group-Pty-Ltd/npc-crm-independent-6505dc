/**
 * source-scene-graph-v2 — PDF Extraction V3 · Package E1 (canonical shared pure module).
 *
 * The immutable, provider-neutral source representation of a PDF page. This is
 * the CANONICAL TypeScript definition, consumed by:
 *   - Supabase Edge Functions (Deno, `import … from '../_shared/sourceSceneGraphV2.pure.ts'`);
 *   - the frontend + Vitest (via the thin re-export at
 *     `src/lib/reportTemplate/pdfImport/sourceSceneGraphV2.pure.ts`).
 *
 * It agrees, field-for-field and ID-for-ID, with the sidecar producer
 * `pdf-parse-service/source_scene_graph.py`. The region-ID hash is a portable
 * FNV-1a-32 so both runtimes derive byte-identical IDs from the same canonical
 * key. Pure + deterministic: no signed URLs, DOM, network, ImageData or secrets.
 *
 * Source truth only — nothing here reads the candidate template or a page-output
 * decision. E0 containment may *consume* this evidence (see the adapter in
 * `criticalVisualContainmentAdapters.ts`).
 */

export const SOURCE_SCENE_GRAPH_VERSION = 'source-scene-graph-v2';
export const SOURCE_REGION_VERSION = 'source-region-v2';
export const PAGE_ARTIFACT_CONTRACT_VERSION = 'pdf-page-artifact-contract-v3';
export const SOURCE_TABLE_TOPOLOGY_VERSION = 'source-table-topology-v2';
export const SOURCE_CHART_METADATA_VERSION = 'source-chart-metadata-v2';
export const SOURCE_FOREGROUND_SUMMARY_VERSION = 'source-foreground-summary-v1';
export const PROVIDER_REGION_EVIDENCE_VERSION = 'provider-region-evidence-v1';

export const CROP_REQUIRED_TYPES: ReadonlySet<SourceRegionType> = new Set([
  'table', 'chart', 'picture', 'logo', 'vector-cluster',
]);

const REGION_TYPE_ABBREV: Record<SourceRegionType, string> = {
  text: 'text', table: 'tabl', chart: 'chrt', picture: 'pict',
  logo: 'logo', 'vector-cluster': 'vect', background: 'bkgd', 'unknown-visual': 'unkv',
};

// ── Contract types ──────────────────────────────────────────────────────────

export type SourceRegionType =
  | 'text' | 'table' | 'chart' | 'picture' | 'logo'
  | 'vector-cluster' | 'background' | 'unknown-visual';

export interface SourceBBox { x: number; y: number; width: number; height: number }

export interface SourceNumericTokenV1 {
  raw: string;
  normalized: string | null;
  kind: 'integer' | 'decimal' | 'currency' | 'percentage' | 'date' | 'range' | 'measurement' | 'unknown';
  currency?: string | null;
  unit?: string | null;
  rangeStart?: string | null;
  rangeEnd?: string | null;
}

export interface SourcePunctuationTokenV1 {
  raw: string;
  kind: 'en-dash' | 'em-dash' | 'hyphen' | 'minus' | 'arrow' | 'multiplication'
    | 'bullet' | 'non-breaking-space' | 'other';
}

export interface SourceTableCellV2 {
  id: string;
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  columnHeader: boolean;
  rowHeader: boolean;
  text: string;
  numericTokens: SourceNumericTokenV1[];
  bbox: SourceBBox | null;
  confidence: number | null;
  providerRefs: string[];
}

export interface SourceTableTopologyV2 {
  version: typeof SOURCE_TABLE_TOPOLOGY_VERSION;
  numRows: number;
  numCols: number;
  headerRowCount: number;
  headerColumnCount: number;
  cells: SourceTableCellV2[];
  caption: string | null;
  sourceProvider: string;
  topologyProblems: string[];
  complete: boolean;
}

export type ChartDetectionMethod =
  | 'classification' | 'caption+numeric' | 'heuristic-signals' | 'none';

/** Deterministic chart-detection evidence (E3). Mirrors the Python producer's
 * `build_chart_detection_signals`; counts/booleans only — no text bodies. */
export interface ChartDetectionSignals {
  version?: string;
  classificationChart: boolean;
  captionChartTerm: boolean;
  pageNumericLabels: boolean;
  axisTickCount: number;
  legendEntryCount: number;
  gridlinePathCount: number;
  numericLabelCount: number;
  axisPresent: boolean;
  legendPresent: boolean;
  gridlinesPresent: boolean;
  score: number;
  method: ChartDetectionMethod;
  promote: boolean;
}

export interface SourceChartMetadataV2 {
  version: typeof SOURCE_CHART_METADATA_VERSION;
  chartType: 'bar' | 'line' | 'area' | 'pie' | 'scatter' | 'combo' | 'unknown';
  caption: string | null;
  structuredDataPath: string | null;
  seriesCount: number | null;
  categoryCount: number | null;
  axisLabelRegionIds: string[];
  legendRegionIds: string[];
  extractionState: 'crop_only' | 'structured_partial' | 'structured_complete' | 'unavailable';
  // ── E3 additive fields (chart-preservation-v1). Semantic metadata lives BESIDE
  // the rendered crop and never replaces it. All optional for backward compat. ──
  detectionScore?: number | null;
  detectionMethod?: ChartDetectionMethod;
  detectionSignals?: ChartDetectionSignals | null;
  axisLabels?: string[];
  legendText?: string[];
  seriesLabels?: string[];
  numericValues?: string[];
  renderMode?: 'crop-preferred' | 'chart-crop' | 'containment-fallback';
  problems: string[];
}

export interface ProviderRegionEvidenceV1 {
  version?: typeof PROVIDER_REGION_EVIDENCE_VERSION;
  provider: 'docling' | 'pymupdf' | 'source-raster' | 'legacy' | 'unknown';
  providerVersion: string | null;
  evidenceType: 'text' | 'table' | 'picture' | 'chart' | 'vector' | 'image' | 'crop' | 'classification';
  providerRef: string | null;
  confidence: number | null;
  claims: string[];
  artifactPath: string | null;
}

export interface SourceRegionCrop {
  path: string | null;
  sha256: string | null;
  mime: 'image/png' | null;
  widthPx: number | null;
  heightPx: number | null;
  sourceDpi: number | null;
  paddingPt: number | null;
}

export interface SourceRegionText {
  raw: string | null;
  normalizedNfc: string | null;
  exactTokens: string[];
  numericTokens: SourceNumericTokenV1[];
  punctuationTokens: SourcePunctuationTokenV1[];
  spanIds: string[];
  label?: string | null;
}

export interface SourceRegionRelationships {
  parentRegionId: string | null;
  childRegionIds: string[];
  captionRegionIds: string[];
  labelRegionIds: string[];
}

export interface SourceRegionVisual {
  foregroundOccupancy: number | null;
  edgeDensity: number | null;
  dominantColors: string[];
}

export interface SourceRegionV2 {
  version: typeof SOURCE_REGION_VERSION;
  id: string;
  pageId: string;
  pageNumber: number;
  type: SourceRegionType;
  bbox: SourceBBox;
  polygon?: Array<{ x: number; y: number }> | null;
  readingOrder: number | null;
  zOrderHint: number | null;
  confidence: number | null;
  sourceCrop: SourceRegionCrop;
  text: SourceRegionText | null;
  table: SourceTableTopologyV2 | null;
  chart: SourceChartMetadataV2 | null;
  visual: SourceRegionVisual | null;
  relationships: SourceRegionRelationships;
  providerEvidence: ProviderRegionEvidenceV1[];
  problems: string[];
  complete: boolean;
}

export interface SourceForegroundSummaryV1 {
  version: typeof SOURCE_FOREGROUND_SUMMARY_VERSION;
  threshold: number;
  foregroundRatio: number;
  nonWhiteBounds: SourceBBox | null;
  tileRows: number;
  tileCols: number;
  tileOccupancy: number[];
  edgeDensity: number | null;
}

export interface SourceRasterRefV2 {
  path: string | null;
  sha256: string | null;
  widthPx: number | null;
  heightPx: number | null;
  dpi: number | null;
  mime: 'image/png' | null;
}

export interface SourcePageSceneChunk {
  chunkId: string | null;
  chunkIndex: number | null;
  localPageNumber: number | null;
  parentPageNumber: number;
}

export interface SourcePageSceneV2 {
  version: typeof SOURCE_SCENE_GRAPH_VERSION;
  pageId: string;
  pageNumber: number;
  sourceChunk?: SourcePageSceneChunk | null;
  geometry: { widthPt: number; heightPt: number; rotation: 0 | 90 | 180 | 270 };
  sourceRaster: SourceRasterRefV2;
  foreground: SourceForegroundSummaryV1 | null;
  sourceSpansPath: string | null;
  regionsPath: string;
  regionCount: number;
  criticalRegionCount: number;
  regionIds: string[];
  /** Regions may live in a sibling file; a scene can carry only `regionIds`. */
  regions?: SourceRegionV2[];
  problems: string[];
  complete: boolean;
}

export interface SourceSceneGraphV2 {
  version: typeof SOURCE_SCENE_GRAPH_VERSION;
  source: { sourceSha256: string | null; mime: 'application/pdf'; pageCount: number };
  coordinateSpace: { units: 'pdf-point'; origin: 'top-left'; xIncreases: 'right'; yIncreases: 'down' };
  extraction: {
    engine: string;
    engineVersion: string;
    lanePolicyVersion: string | null;
    artifactContractVersion: string;
    generatedAt: string;
  };
  pages: SourcePageSceneV2[];
  problems: string[];
  complete: boolean;
}

// ── Deterministic hashing (FNV-1a 32-bit) — matches source_scene_graph.py ────

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** 8-char lowercase hex FNV-1a over the UTF-8 bytes of `text`. */
export function fnv1a32(text: string): string {
  let h = FNV_OFFSET >>> 0;
  const bytes = utf8Bytes(text);
  for (let i = 0; i < bytes.length; i += 1) {
    h ^= bytes[i];
    // 32-bit FNV multiply without BigInt: split into 16-bit halves.
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function utf8Bytes(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    let code = text.charCodeAt(i);
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
      i += 1;
      out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return out;
}

function fmt2(value: number): string {
  // Round-half-away is JS default via toFixed; bboxes are already 2-dp so this
  // matches Python's `f"{v:.2f}"`. Normalise -0 → 0.
  let v = Math.round((value + Number.EPSILON) * 100) / 100;
  if (Object.is(v, -0) || v === 0) v = 0;
  return v.toFixed(2);
}

function canonicalBBoxKey(bbox: SourceBBox): string {
  return [bbox.x, bbox.y, bbox.width, bbox.height].map((n) => fmt2(Number(n) || 0)).join('|');
}

/** Deterministic, chunk-independent region ID (matches the Python producer). */
export function regionId(globalPage: number, type: SourceRegionType, bbox: SourceBBox, ordinal: number): string {
  const abbrev = REGION_TYPE_ABBREV[type] ?? 'unkv';
  const key = [String(Math.trunc(globalPage)), type, canonicalBBoxKey(bbox), String(Math.trunc(ordinal))].join('|');
  return `src-p${String(Math.trunc(globalPage)).padStart(4, '0')}-${abbrev}-${String(Math.trunc(ordinal)).padStart(4, '0')}-${fnv1a32(key)}`;
}

// ── Path safety ──────────────────────────────────────────────────────────────

const EXTERNAL_URL_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

/** Reject traversal, absolute paths, external URLs and data URLs in durable-path fields. */
export function isSafeArtifactPath(path: unknown): path is string {
  if (typeof path !== 'string' || !path) return false;
  if (path.startsWith('/') || path.startsWith('\\')) return false;
  if (path.split('/').includes('..')) return false;
  if (EXTERNAL_URL_RE.test(path)) return false;
  if (path.startsWith('data:')) return false;
  return true;
}

// ── Coordinate normalisation (validation-side) ───────────────────────────────

export function normalizeBBox(
  raw: unknown,
  pageWidth: number,
  pageHeight: number,
): { bbox: SourceBBox | null; problems: string[] } {
  const problems: string[] = [];
  let l: number, t: number, r: number, b: number;
  let origin = 'TOPLEFT';
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    l = Number(o.l); t = Number(o.t); r = Number(o.r); b = Number(o.b);
    origin = String(o.coord_origin ?? 'TOPLEFT').toUpperCase();
  } else if (Array.isArray(raw) && raw.length >= 4) {
    [l, t, r, b] = raw.map(Number) as [number, number, number, number];
  } else {
    return { bbox: null, problems: ['bbox_missing'] };
  }
  if (![l, t, r, b].every((v) => Number.isFinite(v))) return { bbox: null, problems: ['bbox_non_finite'] };

  let y0: number, y1: number;
  if (origin === 'BOTTOMLEFT' && pageHeight) {
    y0 = pageHeight - Math.max(t, b);
    y1 = pageHeight - Math.min(t, b);
  } else {
    y0 = Math.min(t, b); y1 = Math.max(t, b);
  }
  let x0 = Math.min(l, r);
  let x1 = Math.max(l, r);
  const pw = Number.isFinite(pageWidth) && pageWidth ? pageWidth : null;
  const ph = Number.isFinite(pageHeight) && pageHeight ? pageHeight : null;
  if (pw !== null && ph !== null) {
    if (x1 <= 0 || y1 <= 0 || x0 >= pw || y0 >= ph) return { bbox: null, problems: ['bbox_off_page'] };
    const overshoot = x0 < -0.5 || y0 < -0.5 || x1 > pw + 0.5 || y1 > ph + 0.5;
    x0 = Math.min(Math.max(x0, 0), pw); x1 = Math.min(Math.max(x1, 0), pw);
    y0 = Math.min(Math.max(y0, 0), ph); y1 = Math.min(Math.max(y1, 0), ph);
    if (overshoot) problems.push('bbox_exceeds_page_clamped');
  }
  const width = x1 - x0;
  const height = y1 - y0;
  if (width <= 0 || height <= 0) return { bbox: null, problems: [...problems, 'bbox_zero_area'] };
  return {
    bbox: { x: round2(x0), y: round2(y0), width: round2(width), height: round2(height) },
    problems,
  };
}

function round2(v: number): number { return Math.round(v * 100) / 100; }

// ── Scene-graph validation (Phase 11) ────────────────────────────────────────

export type SourceSceneGraphState = 'valid_v2' | 'legacy_missing' | 'unknown_version' | 'invalid_v2';

export interface SourceSceneGraphValidationResult {
  ok: boolean;
  state: SourceSceneGraphState;
  scene: SourceSceneGraphV2 | null;
  problems: string[];
}

/**
 * Validate a source scene graph without mutating it or fetching anything.
 * `null`/absent → legacy_missing (an old V2 job, not an error). A future version
 * → unknown_version (never interpreted as V2). A claimed-but-broken V2 →
 * invalid_v2 (never becomes preferred).
 */
export function validateSourceSceneGraphV2(input: unknown): SourceSceneGraphValidationResult {
  if (input === null || input === undefined) {
    return { ok: false, state: 'legacy_missing', scene: null, problems: ['scene_absent'] };
  }
  if (typeof input !== 'object') {
    return { ok: false, state: 'invalid_v2', scene: null, problems: ['scene_not_object'] };
  }
  const scene = input as Record<string, unknown>;
  const version = scene.version;
  if (version !== SOURCE_SCENE_GRAPH_VERSION) {
    return { ok: false, state: 'unknown_version', scene: null, problems: [`unknown_version:${String(version)}`] };
  }
  const problems: string[] = [];
  const pages = scene.pages;
  if (!Array.isArray(pages)) {
    return { ok: false, state: 'invalid_v2', scene: null, problems: ['pages_not_list'] };
  }
  const seenRegionIds = new Set<string>();
  const seenPageIds = new Set<string>();
  for (const page of pages) validatePageSceneInner(page, seenRegionIds, seenPageIds, problems);
  const ok = problems.length === 0;
  return { ok, state: ok ? 'valid_v2' : 'invalid_v2', scene: ok ? (scene as unknown as SourceSceneGraphV2) : null, problems };
}

export function validateSourcePageSceneV2(input: unknown): SourceSceneGraphValidationResult {
  const problems: string[] = [];
  validatePageSceneInner(input, new Set(), new Set(), problems);
  const ok = problems.length === 0;
  return { ok, state: ok ? 'valid_v2' : 'invalid_v2', scene: null, problems };
}

function validatePageSceneInner(
  page: unknown,
  seenRegionIds: Set<string>,
  seenPageIds: Set<string>,
  problems: string[],
): void {
  if (!page || typeof page !== 'object') { problems.push('page_scene_not_object'); return; }
  const p = page as Record<string, unknown>;
  if (p.version !== SOURCE_SCENE_GRAPH_VERSION) problems.push('page_scene_bad_version');
  const pageId = p.pageId;
  if (typeof pageId === 'string') {
    if (seenPageIds.has(pageId)) problems.push('duplicate_page_id');
    seenPageIds.add(pageId);
  }
  const pageNo = p.pageNumber;
  for (const rid of (Array.isArray(p.regionIds) ? p.regionIds : [])) {
    const id = String(rid);
    if (seenRegionIds.has(id)) problems.push(`duplicate_region_id:${id}`);
    seenRegionIds.add(id);
  }
  for (const region of (Array.isArray(p.regions) ? p.regions : [])) {
    validateRegion(region, pageNo, problems);
  }
}

const SHA256_RE = /^[0-9a-f]{64}$/;

function validateRegion(region: unknown, pageNo: unknown, problems: string[]): void {
  if (!region || typeof region !== 'object') { problems.push('region_not_object'); return; }
  const r = region as Record<string, unknown>;
  if (r.version !== SOURCE_REGION_VERSION) problems.push('region_bad_version');
  const type = r.type as SourceRegionType;
  const bbox = r.bbox as Record<string, unknown> | undefined;
  if (!bbox || typeof bbox !== 'object') {
    problems.push('region_bbox_missing');
  } else {
    for (const k of ['x', 'y', 'width', 'height'] as const) {
      const v = bbox[k];
      if (typeof v !== 'number' || !Number.isFinite(v)) problems.push(`region_bbox_${k}_non_finite`);
      else if ((k === 'width' || k === 'height') && v <= 0) problems.push(`region_bbox_${k}_non_positive`);
      else if ((k === 'x' || k === 'y') && v < 0) problems.push(`region_bbox_${k}_negative`);
    }
  }
  if (pageNo !== undefined && r.pageNumber !== pageNo) problems.push('region_page_mismatch');
  const crop = (r.sourceCrop ?? {}) as Record<string, unknown>;
  const path = crop.path;
  if (path !== null && path !== undefined && !isSafeArtifactPath(path)) problems.push('region_crop_path_unsafe');
  const sha = crop.sha256;
  if (sha !== null && sha !== undefined && !SHA256_RE.test(String(sha))) problems.push('region_crop_sha_invalid');
  if (CROP_REQUIRED_TYPES.has(type) && !path) problems.push('critical_region_missing_crop');
  const conf = r.confidence;
  if (conf !== null && conf !== undefined && (typeof conf !== 'number' || !Number.isFinite(conf))) {
    problems.push('region_confidence_non_finite');
  }
  if (r.table && typeof r.table === 'object') validateTable(r.table as Record<string, unknown>, problems);
}

function validateTable(table: Record<string, unknown>, problems: string[]): void {
  const numRows = table.numRows;
  const numCols = table.numCols;
  for (const cell of (Array.isArray(table.cells) ? table.cells : [])) {
    if (!cell || typeof cell !== 'object') continue;
    const c = cell as Record<string, unknown>;
    const row = c.row as number, col = c.col as number;
    const rspan = (c.rowSpan as number) ?? 1, cspan = (c.colSpan as number) ?? 1;
    if (typeof row === 'number' && typeof numRows === 'number' && numRows > 0) {
      if (row < 0 || row + rspan > numRows) problems.push('table_cell_row_out_of_bounds');
    }
    if (typeof col === 'number' && typeof numCols === 'number' && numCols > 0) {
      if (col < 0 || col + cspan > numCols) problems.push('table_cell_col_out_of_bounds');
    }
  }
}

/** Critical (crop-required) regions on a valid scene, in canonical order. */
export function criticalRegionsOf(page: SourcePageSceneV2): SourceRegionV2[] {
  return (page.regions ?? []).filter((r) => CROP_REQUIRED_TYPES.has(r.type));
}
