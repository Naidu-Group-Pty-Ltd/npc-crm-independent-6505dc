/**
 * exportParityEvidence — Phase 9D evidence extraction.
 *
 * Pulls reusable render evidence for the export parity runner out of existing
 * import artifacts, Visual QA metadata, and any existing export parity summary.
 * All extractors are defensive (never throw on missing/oddly-shaped fields); the
 * async loader reuses the existing secure `loadVisualQuality` / `loadExportParity`
 * helpers rather than duplicating the backend contract.
 */
import { loadVisualQuality } from '../visualQuality/persist';
import { loadExportParitySummary } from './exportParityPersistence';
import { clampExportParityScore } from './exportParityScore';
import type { ExportParitySummary } from './exportParityTypes';
import type {
  ExportParityEvidenceRef,
  ExportParityRunnerLoadResult,
} from './exportParityRunnerTypes';

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function buildExportParityEvidenceRef(options: {
  kind: ExportParityEvidenceRef['kind'];
  pageNumber?: number | null;
  path?: string | null;
  url?: string | null;
  width?: number | null;
  height?: number | null;
  score?: number | null;
  available?: boolean;
  reason?: string | null;
}): ExportParityEvidenceRef {
  const path = options.path ?? null;
  const url = options.url ?? null;
  const available = options.available ?? Boolean(path || url);
  return {
    kind: options.kind,
    pageNumber: options.pageNumber ?? null,
    path,
    url,
    width: options.width ?? null,
    height: options.height ?? null,
    score: options.score ?? null,
    available,
    reason: options.reason ?? null,
  };
}

/** First present key from a set of candidate field names on an object. */
function pickPath(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = toStringOrNull(obj[k]);
    if (v) return v;
  }
  return null;
}

/**
 * Extract raster evidence from a `get_artifacts`-style payload. Tolerant of many
 * field-name shapes (snake_case / camelCase, top-level or per-page).
 */
export function extractExportParityEvidenceFromArtifacts(
  artifacts: unknown,
): ExportParityEvidenceRef[] {
  const root = toObject(artifacts);
  const out: ExportParityEvidenceRef[] = [];

  const pushIf = (kind: ExportParityEvidenceRef['kind'], path: string | null, pageNumber: number | null) => {
    if (path) out.push(buildExportParityEvidenceRef({ kind, path, pageNumber, available: true }));
  };

  // Document-level raster paths.
  pushIf('source_raster', pickPath(root, ['source_raster_path', 'sourceRasterPath', 'sourceRasterFolder']), null);
  pushIf('editor_raster', pickPath(root, ['generated_raster_path', 'generatedRasterPath', 'editor_raster_path', 'editorRasterPath', 'editorRasterFolder']), null);
  pushIf('export_raster', pickPath(root, ['export_raster_path', 'exportRasterPath', 'exportedRasterFolder']), null);

  // Per-page artifacts under a variety of container keys.
  const pageContainers = [root.pages, root.pageArtifacts, root.reviewArtifacts, (toObject(root.artifacts)).pages];
  for (const container of pageContainers) {
    if (!Array.isArray(container)) continue;
    for (const rawPage of container) {
      const p = toObject(rawPage);
      const pageNumber = toNumberOrNull(p.pageNumber ?? p.page_number ?? p.page);
      pushIf('source_raster', pickPath(p, ['source_raster_path', 'sourceRasterPath', 'source', 'sourcePath']), pageNumber);
      pushIf('editor_raster', pickPath(p, ['generated_raster_path', 'generatedRasterPath', 'editor_raster_path', 'editorRasterPath', 'generated', 'editorPath']), pageNumber);
      pushIf('export_raster', pickPath(p, ['export_raster_path', 'exportRasterPath', 'export', 'exportPath']), pageNumber);
    }
  }

  return out;
}

/**
 * Extract evidence from a Visual QA payload (the `PersistedVisualQuality`
 * `{ report, signedUrls }` shape or a bare report). Produces per-page
 * source-vs-editor scores plus source/editor raster availability.
 */
export function extractExportParityEvidenceFromVisualQuality(
  visualQuality: unknown,
): ExportParityEvidenceRef[] {
  const root = toObject(visualQuality);
  const report = toObject(root.report && typeof root.report === 'object' ? root.report : root);
  const signedUrls = toObject(root.signedUrls);
  const out: ExportParityEvidenceRef[] = [];

  const docScore = clampExportParityScore(report.overallScore);
  if (docScore !== null) {
    out.push(buildExportParityEvidenceRef({ kind: 'visual_quality_summary', pageNumber: null, score: docScore, available: true }));
  }

  const pages = Array.isArray(report.pages)
    ? report.pages
    : Array.isArray(root.pages) ? root.pages
    : Array.isArray(root.pageSummaries) ? root.pageSummaries
    : Array.isArray(root.comparisons) ? root.comparisons
    : [];

  for (const rawPage of pages) {
    const p = toObject(rawPage);
    const pageNumber = toNumberOrNull(p.pageNumber ?? p.page_number ?? p.page);
    if (pageNumber === null) continue;
    const score = clampExportParityScore(p.overallScore ?? p.score ?? p.similarity ?? p.ssim);
    out.push(buildExportParityEvidenceRef({ kind: 'visual_quality_summary', pageNumber, score, available: true }));

    const sourceUrl = toStringOrNull(signedUrls[`${pageNumber}:source`]);
    const generatedUrl = toStringOrNull(signedUrls[`${pageNumber}:generated`]);
    const sourcePath = pickPath(p, ['sourceRasterPath', 'source_raster_path', 'source']);
    const editorPath = pickPath(p, ['generatedRasterPath', 'generated_raster_path', 'generated']);
    out.push(buildExportParityEvidenceRef({
      kind: 'source_raster', pageNumber, path: sourcePath, url: sourceUrl,
      available: Boolean(sourcePath || sourceUrl),
    }));
    out.push(buildExportParityEvidenceRef({
      kind: 'editor_raster', pageNumber, path: editorPath, url: generatedUrl,
      available: Boolean(editorPath || generatedUrl),
    }));
  }

  return out;
}

/** Extract score evidence from an existing export parity summary. */
export function extractExportParityEvidenceFromExistingSummary(
  summary: ExportParitySummary | null | undefined,
): ExportParityEvidenceRef[] {
  if (!summary || typeof summary !== 'object') return [];
  const out: ExportParityEvidenceRef[] = [];

  out.push(buildExportParityEvidenceRef({
    kind: 'existing_export_parity_summary',
    pageNumber: null,
    available: true,
    reason: summary.status ?? null,
  }));

  const docScores: Array<[ExportParityEvidenceRef['kind'], number | null]> = [
    ['manual_metrics', clampExportParityScore(summary.editorVsSourceScore)],
    ['manual_metrics', clampExportParityScore(summary.exportVsSourceScore)],
    ['manual_metrics', clampExportParityScore(summary.exportVsEditorScore)],
  ];
  for (const [kind, score] of docScores) {
    if (score !== null) out.push(buildExportParityEvidenceRef({ kind, pageNumber: null, score, available: true }));
  }

  for (const rawPage of Array.isArray(summary.pages) ? summary.pages : []) {
    const p = toObject(rawPage);
    const pageNumber = toNumberOrNull(p.pageNumber);
    if (pageNumber === null) continue;
    const score = clampExportParityScore(p.exportVsSourceScore ?? p.editorVsSourceScore);
    if (score !== null) {
      out.push(buildExportParityEvidenceRef({ kind: 'manual_metrics', pageNumber, score, available: true }));
    }
  }

  return out;
}

/** Group evidence refs by page number (null page numbers are dropped). */
export function groupExportParityEvidenceByPage(
  evidence: ExportParityEvidenceRef[],
): Record<number, ExportParityEvidenceRef[]> {
  const out: Record<number, ExportParityEvidenceRef[]> = {};
  for (const ref of Array.isArray(evidence) ? evidence : []) {
    if (typeof ref?.pageNumber !== 'number' || !Number.isFinite(ref.pageNumber)) continue;
    (out[ref.pageNumber] ??= []).push(ref);
  }
  return out;
}

/**
 * Load runner evidence for an import: reuse Visual QA (source/editor rasters +
 * per-page scores) and any existing export parity summary. Export raster evidence
 * is not required for `ok` — source/editor evidence alone is enough.
 */
export async function loadExportParityRunnerEvidence(
  importId: string,
): Promise<ExportParityRunnerLoadResult> {
  if (!importId) {
    return { kind: 'error', message: 'importId is required', evidence: [] };
  }

  const [vq, ep] = await Promise.all([
    loadVisualQuality(importId).catch((e) => ({ kind: 'error' as const, message: (e as Error).message })),
    loadExportParitySummary(importId).catch((e) => ({ kind: 'error' as const, message: (e as Error).message })),
  ]);

  const evidence: ExportParityEvidenceRef[] = [];
  let existingSummary: ExportParitySummary | null = null;

  if (vq.kind === 'ok') {
    evidence.push(...extractExportParityEvidenceFromVisualQuality((vq as { payload: unknown }).payload));
  }
  if (ep.kind === 'ok') {
    existingSummary = (ep as { payload: ExportParitySummary }).payload;
    evidence.push(...extractExportParityEvidenceFromExistingSummary(existingSummary));
  }

  const vqError = vq.kind === 'error';
  const epError = ep.kind === 'error';

  if (evidence.length === 0) {
    if (vqError && epError) {
      const message = `${(vq as { message?: string }).message ?? 'visual quality load failed'}; ${(ep as { message?: string }).message ?? 'export parity load failed'}`;
      return { kind: 'error', message, evidence, raw: { vq, ep } };
    }
    return { kind: 'missing', message: 'no reusable export parity evidence found', evidence, raw: { vq, ep } };
  }

  return { kind: 'ok', evidence, existingSummary, raw: { vq, ep } };
}
