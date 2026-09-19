/**
 * PDF Extraction V3 · E11 — bounded artifact selection (no arbitrary paths).
 *
 * The client selects artifacts by (importId, pageNumber, regionId, kind) ONLY.
 * It never supplies an object path or URL — the server resolves the trusted,
 * manifest-derived path and signs it. The hydrated URL is runtime-only and never
 * enters any persisted model (see the artifact hook + validators).
 */
import {
  PDF_ARTIFACT_VIEWER_MODEL_VERSION,
  type ArtifactAssetState,
  type ArtifactKind,
  type PdfArtifactViewerModelV1,
  type PdfPageArtifactAvailabilityV1,
} from './contracts';

export const ARTIFACT_KINDS: readonly ArtifactKind[] = [
  'source', 'browser-final', 'export-final', 'diff',
  'foreground-source', 'foreground-output', 'edge-source', 'edge-output',
  'region-source', 'region-output',
];

/** A bounded artifact request — the ONLY thing the client sends to sign an artifact. */
export interface ArtifactSelectionRequest {
  importId: string;
  pageNumber: number;
  kind: ArtifactKind;
  regionId: string | null;
}

/** Kinds that are NOT shown in "final output" mode (debug/reference layers). */
const NON_FINAL_KINDS: ReadonlySet<ArtifactKind> = new Set([
  'foreground-source', 'foreground-output', 'edge-source', 'edge-output',
]);

const AVAILABILITY_KEY: Record<ArtifactKind, keyof PdfPageArtifactAvailabilityV1> = {
  source: 'source', 'browser-final': 'browserFinal', 'export-final': 'exportFinal', diff: 'diff',
  'foreground-source': 'foregroundSource', 'foreground-output': 'foregroundOutput',
  'edge-source': 'edgeSource', 'edge-output': 'edgeOutput',
  'region-source': 'regionSource', 'region-output': 'regionOutput',
};

/** Compute which kinds are available for a page, optionally excluding debug layers. */
export function availableArtifactKinds(
  availability: PdfPageArtifactAvailabilityV1,
  opts: { finalOutputMode?: boolean } = {},
): ArtifactKind[] {
  return ARTIFACT_KINDS.filter((kind) => {
    if (opts.finalOutputMode && NON_FINAL_KINDS.has(kind)) return false;
    return availability[AVAILABILITY_KEY[kind]] === true;
  });
}

/** Build a viewer model. The hydrated URL is intentionally NOT part of the model. */
export function buildArtifactViewerModel(input: {
  pageNumber: number;
  availableKinds: ArtifactKind[];
  selectedKind: ArtifactKind;
  assetState: ArtifactAssetState;
  widthPx?: number | null;
  heightPx?: number | null;
  hashVerified?: boolean | null;
  expiresAt?: string | null;
  problems?: string[];
}): PdfArtifactViewerModelV1 {
  return {
    version: PDF_ARTIFACT_VIEWER_MODEL_VERSION,
    pageNumber: input.pageNumber,
    availableKinds: [...input.availableKinds],
    selectedKind: input.selectedKind,
    assetState: input.assetState,
    dimensions: {
      widthPx: typeof input.widthPx === 'number' && Number.isFinite(input.widthPx) ? input.widthPx : null,
      heightPx: typeof input.heightPx === 'number' && Number.isFinite(input.heightPx) ? input.heightPx : null,
    },
    hashVerified: typeof input.hashVerified === 'boolean' ? input.hashVerified : null,
    expiresAt: typeof input.expiresAt === 'string' && input.expiresAt.length > 0 ? input.expiresAt : null,
    problems: input.problems ? [...input.problems] : [],
  };
}

const SIGNED_URL_RE = /^(https?|blob|data):/i;

/**
 * Validate an artifact selection request is safe to send. Rejects any attempt to
 * smuggle a path/URL. Returns problem codes; empty means safe.
 */
export function validateArtifactSelection(req: ArtifactSelectionRequest): string[] {
  const problems: string[] = [];
  if (!req.importId || typeof req.importId !== 'string') problems.push('missing_import_id');
  if (typeof req.pageNumber !== 'number' || !Number.isFinite(req.pageNumber) || req.pageNumber < 1) problems.push('invalid_page_number');
  if (!ARTIFACT_KINDS.includes(req.kind)) problems.push('invalid_artifact_kind');
  // A region id must be a bare id, never a path or URL.
  if (req.regionId != null) {
    if (typeof req.regionId !== 'string' || SIGNED_URL_RE.test(req.regionId) || req.regionId.includes('/') || req.regionId.includes('..')) {
      problems.push('invalid_region_id');
    }
  }
  return problems;
}

/** Which page numbers to prefetch around the active page (bounded window). */
export function artifactPrefetchWindow(activePage: number, pageCount: number, radius = 1): number[] {
  const out: number[] = [];
  for (let p = Math.max(1, activePage - radius); p <= Math.min(pageCount, activePage + radius); p += 1) {
    out.push(p);
  }
  return out;
}
