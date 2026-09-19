/**
 * pdf-page-artifact-contract-v3 — PDF Extraction V3 · Package E1 (canonical shared pure module).
 *
 * Validates the parent per-page artifact manifest as V3. V3 is ADDITIVE over the
 * existing V2 (`per-page-docling-v1` / `pdf-page-artifact-contract-v2`) manifest:
 * the same file gains a scene-graph version, per-page regions/spans/foreground
 * paths, a region-crop path map, and region/crop counts. A manifest becomes the
 * *preferred* authoritative source only when it is a complete, self-consistent
 * V3; a partial or broken V3 never becomes preferred, and a valid V2 stays
 * usable (E0 page-level fallback still applies).
 *
 * Reads the real snake_case manifest the sidecar / chunk-callback emit and
 * projects a typed, camelCase view. Pure + deterministic — no fetch, no mutate.
 */

import {
  PAGE_ARTIFACT_CONTRACT_VERSION,
  SOURCE_SCENE_GRAPH_VERSION,
  isSafeArtifactPath,
} from './sourceSceneGraphV2.pure.ts';

export const PAGE_ARTIFACT_CONTRACT_V2_VERSION = 'pdf-page-artifact-contract-v2';
export const PER_PAGE_DOCLING_ARTIFACT_VERSION = 'per-page-docling-v1';

export interface PageArtifactV3Entry {
  pageNumber: number;
  pageId: string | null;
  sourcePath: string | null;
  sourceSha256: string | null;
  doclingPath: string | null;
  blocksPath: string | null;
  ocrPath: string | null;
  tablesPath: string | null;
  picturesPath: string | null;
  vectorsPath: string | null;
  summaryPath: string | null;
  sourceSpansPath: string | null;
  regionsPath: string | null;
  foregroundPath: string | null;
  regionCropPaths: Record<string, string>;
  regionCount: number;
  criticalRegionCount: number;
  sceneGraphVersion: string | null;
  sourceChunk: { chunkId: string | null; chunkIndex: number | null; localPageNumber: number | null } | null;
  complete: boolean;
  problems: string[];
}

export interface PageArtifactContractV3 {
  artifactContractVersion: string;
  sceneGraphVersion: string | null;
  expectedPageCount: number;
  observedPageCount: number;
  pages: PageArtifactV3Entry[];
  totalRegionCount: number;
  totalCriticalRegionCount: number;
  totalCropCount: number;
  problems: string[];
  complete: boolean;
}

export type PageArtifactV3State = 'valid_v3' | 'legacy_v2' | 'unknown_version' | 'invalid_v3';

export interface PageArtifactV3ValidationResult {
  ok: boolean;
  state: PageArtifactV3State;
  manifest: PageArtifactContractV3 | null;
  problems: string[];
}

function str(v: unknown): string | null { return typeof v === 'string' && v ? v : null; }
function num(v: unknown, fallback = 0): number { return typeof v === 'number' && Number.isFinite(v) ? v : fallback; }

function readChunk(raw: Record<string, unknown>): PageArtifactV3Entry['sourceChunk'] {
  const idx = raw.source_chunk_index ?? raw.sourceChunkIndex;
  const local = raw.source_chunk_page_no ?? raw.localPageNumber;
  const id = raw.source_chunk_id ?? raw.chunkId;
  if (idx == null && local == null && id == null) return null;
  return {
    chunkId: str(id),
    chunkIndex: typeof idx === 'number' ? idx : null,
    localPageNumber: typeof local === 'number' ? local : null,
  };
}

function readCropPaths(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'string' && v) out[k] = v;
    }
  }
  return out;
}

function projectPage(raw: Record<string, unknown>): PageArtifactV3Entry {
  return {
    pageNumber: num(raw.page_no ?? raw.pageNumber),
    pageId: str(raw.page_id ?? raw.pageId),
    sourcePath: str(raw.source_path ?? raw.raster_path ?? raw.sourcePath),
    sourceSha256: str(raw.source_sha256 ?? raw.sourceSha256),
    doclingPath: str(raw.docling_path ?? raw.doclingPath),
    blocksPath: str(raw.blocks_path ?? raw.blocksPath),
    ocrPath: str(raw.ocr_path ?? raw.ocrPath),
    tablesPath: str(raw.tables_path ?? raw.tablesPath),
    picturesPath: str(raw.pictures_path ?? raw.picturesPath),
    vectorsPath: str(raw.vectors_path ?? raw.vectorsPath),
    summaryPath: str(raw.summary_path ?? raw.summaryPath),
    sourceSpansPath: str(raw.source_spans_path ?? raw.sourceSpansPath),
    regionsPath: str(raw.regions_path ?? raw.regionsPath),
    foregroundPath: str(raw.foreground_path ?? raw.foregroundPath),
    regionCropPaths: readCropPaths(raw.region_crop_paths ?? raw.regionCropPaths),
    regionCount: num(raw.region_count ?? raw.regionCount),
    criticalRegionCount: num(raw.critical_region_count ?? raw.criticalRegionCount),
    sceneGraphVersion: str(raw.scene_graph_version ?? raw.sceneGraphVersion),
    sourceChunk: readChunk(raw),
    complete: Boolean(raw.complete),
    problems: Array.isArray(raw.problems) ? (raw.problems as unknown[]).map(String) : [],
  };
}

/**
 * Validate a parent per-page artifact manifest as V3.
 *
 * @param input the parsed manifest object (`pages-manifest.json`).
 * @param opts.jobId when provided, every durable path must live under `${jobId}/`.
 */
export function validatePageArtifactContractV3(
  input: unknown,
  opts: { jobId?: string } = {},
): PageArtifactV3ValidationResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, state: 'invalid_v3', manifest: null, problems: ['manifest_not_object'] };
  }
  const m = input as Record<string, unknown>;
  const contractVersion = str(m.artifact_contract_version ?? m.artifactContractVersion);

  if (contractVersion !== PAGE_ARTIFACT_CONTRACT_VERSION) {
    // Not a claimed V3. Distinguish a legacy V2 manifest from an unknown one.
    const legacy = contractVersion === PAGE_ARTIFACT_CONTRACT_V2_VERSION
      || str(m.version) === PER_PAGE_DOCLING_ARTIFACT_VERSION
      || str(m.version) === PAGE_ARTIFACT_CONTRACT_V2_VERSION;
    return {
      ok: false,
      state: legacy ? 'legacy_v2' : 'unknown_version',
      manifest: null,
      problems: [legacy ? 'legacy_v2_manifest' : `unknown_contract_version:${String(contractVersion)}`],
    };
  }

  const problems: string[] = [];
  const sceneGraphVersion = str(m.scene_graph_version ?? m.sceneGraphVersion);
  if (sceneGraphVersion !== SOURCE_SCENE_GRAPH_VERSION) problems.push('scene_graph_version_missing');

  const rawPages = Array.isArray(m.pages) ? m.pages : null;
  if (!rawPages) {
    return { ok: false, state: 'invalid_v3', manifest: null, problems: ['pages_not_list'] };
  }
  const pages = rawPages
    .filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === 'object')
    .map(projectPage);

  const expectedPageCount = num(m.page_count ?? m.expectedPageCount, pages.length);
  const observedPageCount = pages.length;

  // Continuous, unique page coverage.
  const pageNumbers = pages.map((p) => p.pageNumber).sort((a, b) => a - b);
  if (new Set(pageNumbers).size !== pageNumbers.length) problems.push('duplicate_page_numbers');
  if (pageNumbers.length) {
    const expected = Array.from({ length: pageNumbers.length }, (_, i) => pageNumbers[0] + i);
    if (JSON.stringify(pageNumbers) !== JSON.stringify(expected)) problems.push('page_numbers_not_continuous');
  }
  if (observedPageCount !== expectedPageCount) problems.push('page_count_mismatch');

  // Region-ID uniqueness + crop path safety + per-page completeness.
  const seenRegionIds = new Set<string>();
  let totalRegionCount = 0;
  let totalCriticalRegionCount = 0;
  let totalCropCount = 0;
  const prefix = opts.jobId ? `${opts.jobId}/` : null;
  const checkPath = (path: string | null, code: string): void => {
    if (!path) return;
    if (!isSafeArtifactPath(path)) problems.push(`${code}_unsafe`);
    else if (prefix && !path.startsWith(prefix)) problems.push(`${code}_outside_job_prefix`);
  };

  for (const page of pages) {
    totalRegionCount += page.regionCount;
    totalCriticalRegionCount += page.criticalRegionCount;
    if (!page.regionsPath) problems.push(`page_${page.pageNumber}_regions_path_missing`);
    checkPath(page.regionsPath, `page_${page.pageNumber}_regions_path`);
    checkPath(page.sourceSpansPath, `page_${page.pageNumber}_source_spans_path`);
    checkPath(page.foregroundPath, `page_${page.pageNumber}_foreground_path`);
    checkPath(page.sourcePath, `page_${page.pageNumber}_source_path`);
    for (const [rid, cropPath] of Object.entries(page.regionCropPaths)) {
      totalCropCount += 1;
      if (seenRegionIds.has(rid)) problems.push(`duplicate_region_id:${rid}`);
      seenRegionIds.add(rid);
      checkPath(cropPath, `region_${rid}_crop_path`);
    }
    // Every critical region must have a crop path in the map.
    if (page.criticalRegionCount > Object.keys(page.regionCropPaths).length) {
      problems.push(`page_${page.pageNumber}_critical_region_crop_count_mismatch`);
    }
  }

  const complete = problems.length === 0 && pages.every((p) => p.complete)
    && observedPageCount === expectedPageCount;

  const manifest: PageArtifactContractV3 = {
    artifactContractVersion: PAGE_ARTIFACT_CONTRACT_VERSION,
    sceneGraphVersion,
    expectedPageCount,
    observedPageCount,
    pages,
    totalRegionCount,
    totalCriticalRegionCount,
    totalCropCount,
    problems,
    complete,
  };

  // A partial/inconsistent V3 is retained for diagnostics but is NOT preferred.
  const ok = problems.length === 0;
  return { ok, state: ok ? 'valid_v3' : 'invalid_v3', manifest, problems };
}

/**
 * Choose the preferred authoritative manifest. A valid, complete V3 is preferred;
 * otherwise fall back to legacy V2 behaviour (never a partial/invalid V3).
 */
export function preferPageArtifactContract(
  v3Result: PageArtifactV3ValidationResult,
): 'v3' | 'v2_legacy' {
  return v3Result.state === 'valid_v3' && v3Result.manifest?.complete ? 'v3' : 'v2_legacy';
}
