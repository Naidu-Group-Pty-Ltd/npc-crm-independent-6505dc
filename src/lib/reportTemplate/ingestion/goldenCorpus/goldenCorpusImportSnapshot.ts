/**
 * goldenCorpusImportSnapshot — Phase 9A.
 *
 * Builds a Phase 8B `GoldenCorpusImportQualitySnapshot` from import metadata (a raw
 * `template_imports` row, a `get_status` record, or a normalized frontend list row),
 * and loads one for a given importId via the existing secure `get_status` operation.
 * Never throws on missing optional fields; unknown values become null.
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';
import type { GoldenCorpusImportQualitySnapshot } from './goldenCorpusRunTypes';
import type { GoldenCorpusSnapshotLoadResult } from './goldenCorpusOrchestratorTypes';

/** Coerce a value to a finite number, or null. Accepts numeric strings like "0.91". */
export function coerceNullableNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Coerce a value to a boolean, or null. Accepts the strings "true"/"false" (case-insensitive). */
export function coerceNullableBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const t = value.trim().toLowerCase();
    if (t === 'true') return true;
    if (t === 'false') return false;
  }
  return null;
}

function coerceNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function getPath(source: unknown, path: string[]): unknown {
  let cur: any = source;
  for (const key of path) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = cur[key];
  }
  return cur;
}

/** Read a nested string value at `path`, or null. */
export function readNestedString(source: unknown, path: string[]): string | null {
  return coerceNullableString(getPath(source, path));
}

/** Read a nested numeric value at `path` (accepts numeric strings), or null. */
export function readNestedNumber(source: unknown, path: string[]): number | null {
  return coerceNullableNumber(getPath(source, path));
}

/** Read a nested boolean value at `path` (accepts "true"/"false"), or null. */
export function readNestedBoolean(source: unknown, path: string[]): boolean | null {
  return coerceNullableBoolean(getPath(source, path));
}

/** First candidate that coerces to a non-null value under `coerce`. */
function pick<T>(coerce: (v: unknown) => T | null, cands: unknown[]): T | null {
  for (const c of cands) {
    const r = coerce(c);
    if (r !== null && r !== undefined) return r;
  }
  return null;
}

const pickStr = (...c: unknown[]) => pick(coerceNullableString, c);
const pickNum = (...c: unknown[]) => pick(coerceNullableNumber, c);
const pickBool = (...c: unknown[]) => pick(coerceNullableBoolean, c);

function pagesLength(schemaLike: unknown): number | undefined {
  const pages = (schemaLike as any)?.pages;
  return Array.isArray(pages) ? pages.length : undefined;
}

/** Build a snapshot from a heterogeneous import record. Missing/unknown → null. */
export function buildGoldenCorpusImportQualitySnapshotFromRecord(
  record: unknown,
): GoldenCorpusImportQualitySnapshot {
  const r = (record && typeof record === 'object' ? record : {}) as any;
  const m = (r.meta && typeof r.meta === 'object' ? r.meta : {}) as any;

  return {
    importId: pickStr(r.id, r.import_id, r.importId),
    templateId: pickStr(r.template_id, r.templateId, r.created_template_id, r.createdTemplateId),
    sourceFilename: pickStr(r.source_filename, r.sourceFilename),
    importStatus: pickStr(r.status, r.import_status, r.importStatus),
    engineVersion: pickStr(
      m.import_manifests_summary?.engine_version,
      m.import_manifests_summary?.engineVersion,
      r.engine_version,
      r.engineVersion,
    ),
    importPageCount: pickNum(r.page_count, r.pageCount, r.import_page_count, r.importPageCount),
    templatePageCount: pickNum(
      r.template_page_count,
      r.templatePageCount,
      r.template?.page_count,
      pagesLength(r.template_schema),
      pagesLength(r.schema),
      m.visual_quality_summary?.pageCount,
    ),

    visualQaArtifactPath: pickStr(m.visual_quality_artifact_path, r.visual_quality_artifact_path, r.visualQaArtifactPath),
    visualQaScore: pickNum(
      m.visual_quality_summary?.overallScore,
      m.visual_quality_summary?.overall_score,
      r.visual_quality_score,
      r.visualQaScore,
      r.visual_quality?.overallScore,
      r.visual_quality?.overall_score,
    ),
    visualQaManualReviewRequired: pickBool(
      m.visual_quality_summary?.manualReviewRequired,
      m.visual_quality_summary?.manual_review_required,
      r.visual_quality_manual_review_required,
      r.visualQaManualReviewRequired,
      r.visual_quality?.manualReviewRequired,
    ),

    repairArtifactPath: pickStr(m.visual_repair_artifact_path, r.visual_repair_artifact_path, r.repairArtifactPath),
    repairStatus: pickStr(
      m.visual_repair_summary?.repairStatus,
      m.visual_repair_summary?.repair_status,
      r.repair_status,
      r.repairStatus,
      r.repair?.status,
    ),
    repairFinalScore: pickNum(
      m.visual_repair_summary?.finalScore,
      m.visual_repair_summary?.final_score,
      r.repair_final_score,
      r.repairFinalScore,
      r.repair?.finalScore,
    ),
    repairRequiresFallback: pickBool(
      m.visual_repair_summary?.requiresFallback,
      m.visual_repair_summary?.requires_fallback,
      r.repair_requires_fallback,
      r.repairRequiresFallback,
    ),
    repairRequiresManualReview: pickBool(
      m.visual_repair_summary?.requiresManualReview,
      m.visual_repair_summary?.requires_manual_review,
      r.repair_requires_manual_review,
      r.repairRequiresManualReview,
    ),

    aiReconciliationStatus: pickStr(
      m.ai_reconciliation_summary?.status,
      r.ai_reconciliation_status,
      r.aiReconciliationStatus,
      r.ai_reconciliation?.status,
    ),
    aiReconciliationRecommendation: pickStr(
      m.ai_reconciliation_summary?.recommendation,
      r.ai_reconciliation_recommendation,
      r.aiReconciliationRecommendation,
      r.ai_reconciliation?.recommendation,
    ),

    exportParityArtifactPath: pickStr(m.export_parity_artifact_path, r.export_parity_artifact_path, r.exportParityArtifactPath),
    exportParityStatus: pickStr(
      m.export_parity_summary?.status,
      r.export_parity_status,
      r.exportParityStatus,
      r.export_parity?.status,
    ),
    exportParityMode: pickStr(
      m.export_parity_summary?.mode,
      r.export_parity_mode,
      r.exportParityMode,
      r.export_parity?.mode,
    ),
    exportVsSourceScore: pickNum(
      m.export_parity_summary?.exportVsSourceScore,
      m.export_parity_summary?.export_vs_source_score,
      r.export_vs_source_score,
      r.exportVsSourceScore,
      r.export_parity?.exportVsSourceScore,
    ),
    editorVsSourceScore: pickNum(
      m.export_parity_summary?.editorVsSourceScore,
      m.export_parity_summary?.editor_vs_source_score,
      r.editor_vs_source_score,
      r.editorVsSourceScore,
      r.export_parity?.editorVsSourceScore,
    ),
    exportVsEditorScore: pickNum(
      m.export_parity_summary?.exportVsEditorScore,
      m.export_parity_summary?.export_vs_editor_score,
      r.export_vs_editor_score,
      r.exportVsEditorScore,
      r.export_parity?.exportVsEditorScore,
    ),
  };
}

/**
 * Load an import quality snapshot via the secure `template-import-pdf` `get_status`
 * operation (which returns the full `template_imports` row incl. `meta`).
 */
export async function loadGoldenCorpusImportQualitySnapshot(
  importId: string,
): Promise<GoldenCorpusSnapshotLoadResult> {
  if (!importId) return { kind: 'error', message: 'importId is required' };

  try {
    const { data, error } = await invokeSecureFunction<any>(
      'template-import-pdf',
      { body: { operation: 'get_status', import_id: importId } } as any,
    );

    if (error) {
      const message = String(error?.message ?? error);
      if (/not found|not_found|missing/i.test(message)) return { kind: 'missing', message };
      return { kind: 'error', message };
    }
    if (data?.error) {
      const message = String(data.error);
      if (/not found|not_found|missing/i.test(message)) return { kind: 'missing', message };
      return { kind: 'error', message };
    }

    const record = data?.record ?? data?.import ?? data?.row ?? data?.result ?? data;
    if (!record || typeof record !== 'object') {
      return { kind: 'missing', message: 'Import record not found' };
    }

    return { kind: 'ok', snapshot: buildGoldenCorpusImportQualitySnapshotFromRecord(record), raw: data };
  } catch (err) {
    return { kind: 'error', message: (err as Error).message };
  }
}
