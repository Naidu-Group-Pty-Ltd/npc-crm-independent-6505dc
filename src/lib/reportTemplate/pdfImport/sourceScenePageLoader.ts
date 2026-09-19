/**
 * Lazy Source Scene Graph V2 loader (E1 · Phase 13).
 *
 * Fetches ONE page's source evidence at a time — never the whole document — so an
 * 80-page import stays cheap in the browser. The durable-path → JSON resolution is
 * injected (`deps.loadArtifactJson`), so this module is pure/testable and never
 * embeds a signing implementation or stores a signed URL in long-lived state.
 *
 * Contract states are explicit: a legacy V2 job returns `legacy` (not an error),
 * an invalid V3 manifest returns `invalid` (never becomes preferred), and a
 * missing page is distinguished from an invalid one.
 */
import {
  validateSourceSceneGraphV2,
  validateSourcePageSceneV2,
  type SourcePageSceneV2,
  type SourceRegionV2,
  type SourceSceneGraphV2,
} from './sourceSceneGraphV2.pure';
import {
  validatePageArtifactContractV3,
  preferPageArtifactContract,
  type PageArtifactContractV3,
  type PageArtifactV3Entry,
} from './pageArtifactContractV3.pure';

export interface LoadSourcePageSceneOptions {
  importId: string;
  pageNumber: number;
  includeSpans?: boolean;
  includeForeground?: boolean;
  regionIds?: string[];
}

export interface SourceSceneLoaderDeps {
  /** Resolve a durable object path to its JSON (caller signs + downloads). */
  loadArtifactJson: (path: string) => Promise<unknown>;
}

export type SourcePageSceneLoadState =
  | 'loaded'
  | 'legacy'
  | 'invalid'
  | 'page_missing'
  | 'unavailable';

export interface LoadedSourcePageScene {
  state: SourcePageSceneLoadState;
  page: SourcePageSceneV2 | null;
  regions: SourceRegionV2[];
  spans: unknown[] | null;
  foreground: unknown | null;
  problems: string[];
}

/** Load the manifest and validate/prefer it. Returns the typed V3 manifest, or a
 * legacy/invalid state that the caller treats as "use legacy V2 / E0 fallback". */
export function resolveV3Manifest(
  rawManifest: unknown,
  jobId?: string,
): { preferred: boolean; state: string; manifest: PageArtifactContractV3 | null; problems: string[] } {
  const result = validatePageArtifactContractV3(rawManifest, jobId ? { jobId } : {});
  return {
    preferred: preferPageArtifactContract(result) === 'v3',
    state: result.state,
    manifest: result.manifest,
    problems: result.problems,
  };
}

function findEntry(manifest: PageArtifactContractV3, pageNumber: number): PageArtifactV3Entry | null {
  return manifest.pages.find((p) => p.pageNumber === pageNumber) ?? null;
}

/**
 * Lazily load one page's source scene + regions (and optionally spans/foreground).
 * `rawManifest` is the already-fetched V3 pages-manifest (bounded, one fetch); only
 * the requested page's regions/spans/foreground files are then fetched.
 */
export async function loadSourcePageScene(
  rawManifest: unknown,
  opts: LoadSourcePageSceneOptions,
  deps: SourceSceneLoaderDeps,
): Promise<LoadedSourcePageScene> {
  const resolved = resolveV3Manifest(rawManifest, opts.importId ? undefined : undefined);
  if (resolved.state === 'legacy_v2') {
    return { state: 'legacy', page: null, regions: [], spans: null, foreground: null, problems: resolved.problems };
  }
  if (!resolved.manifest || resolved.state === 'invalid_v3' || resolved.state === 'unknown_version') {
    return { state: 'invalid', page: null, regions: [], spans: null, foreground: null, problems: resolved.problems };
  }

  const entry = findEntry(resolved.manifest, opts.pageNumber);
  if (!entry) {
    return { state: 'page_missing', page: null, regions: [], spans: null, foreground: null, problems: [`page_${opts.pageNumber}_absent`] };
  }
  if (!entry.regionsPath) {
    return { state: 'invalid', page: null, regions: [], spans: null, foreground: null, problems: [`page_${opts.pageNumber}_regions_path_missing`] };
  }

  const problems: string[] = [];
  let regions: SourceRegionV2[] = [];
  try {
    const raw = await deps.loadArtifactJson(entry.regionsPath);
    const list = Array.isArray((raw as { regions?: unknown }).regions)
      ? (raw as { regions: SourceRegionV2[] }).regions
      : Array.isArray(raw) ? (raw as SourceRegionV2[]) : [];
    regions = opts.regionIds && opts.regionIds.length
      ? list.filter((r) => opts.regionIds!.includes(r.id))
      : list;
  } catch (err) {
    return {
      state: 'unavailable', page: null, regions: [], spans: null, foreground: null,
      problems: [`regions_fetch_failed:${err instanceof Error ? err.message : 'unknown'}`],
    };
  }

  let spans: unknown[] | null = null;
  if (opts.includeSpans && entry.sourceSpansPath) {
    try {
      const raw = await deps.loadArtifactJson(entry.sourceSpansPath);
      spans = Array.isArray((raw as { spans?: unknown }).spans) ? (raw as { spans: unknown[] }).spans : null;
    } catch { problems.push('spans_fetch_failed'); }
  }

  let foreground: unknown | null = null;
  if (opts.includeForeground && entry.foregroundPath) {
    try { foreground = await deps.loadArtifactJson(entry.foregroundPath); }
    catch { problems.push('foreground_fetch_failed'); }
  }

  // Assemble a one-page scene and validate it before use.
  const page: SourcePageSceneV2 = {
    version: 'source-scene-graph-v2',
    pageId: entry.pageId ?? `docling-page-${entry.pageNumber}`,
    pageNumber: entry.pageNumber,
    sourceChunk: entry.sourceChunk
      ? { ...entry.sourceChunk, parentPageNumber: entry.pageNumber }
      : null,
    geometry: { widthPt: 0, heightPt: 0, rotation: 0 },
    sourceRaster: { path: entry.sourcePath, sha256: entry.sourceSha256, widthPx: null, heightPx: null, dpi: null, mime: entry.sourcePath ? 'image/png' : null },
    foreground: null,
    sourceSpansPath: entry.sourceSpansPath,
    regionsPath: entry.regionsPath,
    regionCount: regions.length,
    criticalRegionCount: regions.filter((r) => r.type !== 'text' && r.type !== 'background').length,
    regionIds: regions.map((r) => r.id),
    regions,
    problems,
    complete: false,
  };
  const validation = validateSourcePageSceneV2({ ...page, regions });
  if (!validation.ok) {
    return { state: 'invalid', page: null, regions: [], spans: null, foreground: null, problems: [...problems, ...validation.problems] };
  }

  return { state: 'loaded', page, regions, spans, foreground, problems };
}

/**
 * Assemble a minimal document-level scene from already-loaded page scenes (for E0
 * evidence selection). Does not fetch — the caller supplies the pages it has.
 */
export function assembleLoadedSceneGraph(pages: SourcePageSceneV2[]): SourceSceneGraphV2 | null {
  if (!pages.length) return null;
  const scene: SourceSceneGraphV2 = {
    version: 'source-scene-graph-v2',
    source: { sourceSha256: null, mime: 'application/pdf', pageCount: pages.length },
    coordinateSpace: { units: 'pdf-point', origin: 'top-left', xIncreases: 'right', yIncreases: 'down' },
    extraction: { engine: 'docling', engineVersion: '', lanePolicyVersion: null, artifactContractVersion: 'pdf-page-artifact-contract-v3', generatedAt: '' },
    pages: [...pages].sort((a, b) => a.pageNumber - b.pageNumber),
    problems: [],
    complete: false,
  };
  const validation = validateSourceSceneGraphV2(scene);
  return validation.state === 'valid_v2' || validation.state === 'invalid_v2' ? scene : null;
}
