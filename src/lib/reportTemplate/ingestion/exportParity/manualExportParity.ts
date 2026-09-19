/**
 * manualExportParity — build a safe `ExportParitySummary` from a manual/operator
 * parity capture. No rendering or comparison is performed here; the operator (or
 * a future automated runner) supplies whatever scores/counts they observed.
 */
import {
  EXPORT_PARITY_SUMMARY_VERSION,
  type ExportParityArtifactPaths,
  type ExportParityStatus,
  type ExportParitySummary,
} from './exportParityTypes';

export interface ManualExportParityInput {
  importId: string;
  templateId: string | null;
  sourcePageCount: number | null;
  editorPageCount: number | null;
  exportedPageCount: number | null;
  editorVsSourceScore?: number | null;
  exportVsSourceScore?: number | null;
  exportVsEditorScore?: number | null;
  manualReviewRequired?: boolean;
  problems?: string[];
  artifactPaths?: Partial<ExportParityArtifactPaths>;
  now?: () => Date;
}

/** Hard-failure problem prefixes — any of these forces status `failed`. */
const HARD_FAILURE_MARKERS = ['export_failed', 'rasterization_failed', 'comparison_failed', 'missing_required_artifact'];

/** A score is valid only if it is a finite number in [0, 1]. Anything else → null (never clamped). */
function normalizeScore(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function buildManualExportParitySummary(input: ManualExportParityInput): ExportParitySummary {
  const importId = typeof input.importId === 'string' ? input.importId.trim() : '';
  if (!importId) throw new Error('importId is required.');

  const now = (input.now ?? (() => new Date()))();

  const editorVsSourceScore = normalizeScore(input.editorVsSourceScore);
  const exportVsSourceScore = normalizeScore(input.exportVsSourceScore);
  const exportVsEditorScore = normalizeScore(input.exportVsEditorScore);
  const validScores = [editorVsSourceScore, exportVsSourceScore, exportVsEditorScore].filter(
    (s): s is number => s !== null,
  );

  // Normalize problems: strings only, trimmed, non-empty, deduplicated (order-preserving).
  const problems: string[] = [];
  for (const raw of Array.isArray(input.problems) ? input.problems : []) {
    const p = String(raw ?? '').trim();
    if (p && !problems.includes(p)) problems.push(p);
  }

  // Page-count mismatch: only when all three counts are finite and not all equal.
  const pageCountMismatch =
    isFiniteNumber(input.sourcePageCount) &&
    isFiniteNumber(input.editorPageCount) &&
    isFiniteNumber(input.exportedPageCount) &&
    !(input.sourcePageCount === input.editorPageCount && input.editorPageCount === input.exportedPageCount);
  if (pageCountMismatch && !problems.includes('page_count_mismatch')) problems.push('page_count_mismatch');

  const hardFailure = problems.some((p) => HARD_FAILURE_MARKERS.some((marker) => p.startsWith(marker)));

  let status: ExportParityStatus;
  if (hardFailure) status = 'failed';
  else if (validScores.length === 0) status = 'manual_required';
  else status = 'completed';

  const manualReviewRequired = Boolean(
    input.manualReviewRequired === true ||
    validScores.length === 0 ||
    problems.length > 0 ||
    pageCountMismatch,
  );

  const artifactPaths: ExportParityArtifactPaths = { ...(input.artifactPaths ?? {}) };

  return {
    version: EXPORT_PARITY_SUMMARY_VERSION,
    importId,
    templateId: input.templateId ?? null,
    mode: 'manual',
    status,
    sourcePageCount: input.sourcePageCount ?? null,
    editorPageCount: input.editorPageCount ?? null,
    exportedPageCount: input.exportedPageCount ?? null,
    editorVsSourceScore,
    exportVsSourceScore,
    exportVsEditorScore,
    manualReviewRequired,
    pages: [],
    problems,
    artifactPaths,
    generatedAt: now.toISOString(),
  };
}
