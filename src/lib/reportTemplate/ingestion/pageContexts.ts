/**
 * Phase 4F.3 — PDF PageContext consumer helpers.
 *
 * The backend now exposes parent-global per-page Docling artifacts from
 * template-import-pdf.get_artifacts. This module normalizes that payload into
 * a stable frontend contract without changing rendering yet.
 */

export type PdfPageContextSource = 'per_page_docling' | 'legacy_docling';

export interface PdfPageContextArtifacts {
  docling_path: string | null;
  blocks_path: string | null;
  tables_path: string | null;
  pictures_path: string | null;
  summary_path: string | null;
  raster_path: string | null;
  // C2.2: OCR + vectors are optional (legacy jobs predate them).
  ocr_path?: string | null;
  vectors_path?: string | null;
}

export interface PdfPageContextFlags {
  has_docling: boolean;
  has_blocks: boolean;
  has_tables: boolean;
  has_pictures: boolean;
  has_summary: boolean;
  has_raster: boolean;
  has_ocr?: boolean;
  has_vectors?: boolean;
  has_parent_global_artifacts: boolean;
}

export interface PdfPageContext {
  version: 'pdf-page-context-v1' | string;
  page_no: number;
  page_index: number;
  width: number | null;
  height: number | null;
  artifacts: PdfPageContextArtifacts;
  source?: {
    manifest_path?: string | null;
    source_chunk_index?: number | null;
    source_chunk_page_no?: number | null;
    source_chunk_artifact_paths?: Record<string, unknown> | null;
  };
  flags: PdfPageContextFlags;
  global_artifact_prefix?: string | null;
  global_artifact_copy_version?: string | null;
}

export interface PdfPageContextSummary {
  version?: string;
  ok: boolean;
  expected_page_count: number | null;
  observed_page_count: number;
  first_page_no?: number | null;
  last_page_no?: number | null;
  parent_global_context_count?: number | null;
  missing_page_numbers?: number[];
  duplicate_page_numbers?: number[];
  problems?: string[];
}

export interface PageContextEntrypoint {
  available: boolean;
  source?: string | null;
  manifest_path?: string | null;
  page_count?: number | null;
  validation_ok?: boolean | null;
  parent_global_paths_ok?: boolean | null;
  page_contexts_ok?: boolean | null;
  page_context_count?: number | null;
}

export interface PdfPageContextValidation {
  version: 'pdf-page-context-validation-v1';
  ok: boolean;
  expected_page_count: number | null;
  observed_page_count: number;
  first_page_no: number | null;
  last_page_no: number | null;
  missing_page_numbers: number[];
  duplicate_page_numbers: number[];
  problems: string[];
}

export interface PreferredPdfPageContextSource {
  source: PdfPageContextSource;
  pageContexts: PdfPageContext[];
  pageContextSummary: PdfPageContextSummary | null;
  pageContextEntrypoint: PageContextEntrypoint | null;
  pageContextValidation: PdfPageContextValidation;
  reason: string;
}

export interface PdfPageContextConsumerGuardrail {
  version: 'pdf-page-context-consumer-guardrail-v1';
  selected_source: PdfPageContextSource;
  page_context_source_used: boolean;
  legacy_fallback_used: boolean;
  fallback_allowed: boolean;
  should_block_import: boolean;
  reason: string;
  manifest_path: string | null;
  expected_page_count: number | null;
  observed_page_count: number;
  validation_ok: boolean;
  validation_problem_count: number;
  validation_problems: string[];
  entrypoint_available: boolean;
  parent_global_context_count: number | null;
  generated_at: string;
}


function toNumberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeArtifactPath(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export function normalizePdfPageContexts(raw: unknown): PdfPageContext[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item): PdfPageContext | null => {
      if (!item || typeof item !== 'object') return null;
      const page = item as Record<string, any>;
      const pageNo = Number(page.page_no ?? 0);
      if (!Number.isFinite(pageNo) || pageNo <= 0) return null;

      const artifactsRaw = page.artifacts && typeof page.artifacts === 'object'
        ? page.artifacts as Record<string, unknown>
        : {};

      const artifacts: PdfPageContextArtifacts = {
        docling_path: normalizeArtifactPath(artifactsRaw.docling_path),
        blocks_path: normalizeArtifactPath(artifactsRaw.blocks_path),
        tables_path: normalizeArtifactPath(artifactsRaw.tables_path),
        pictures_path: normalizeArtifactPath(artifactsRaw.pictures_path),
        summary_path: normalizeArtifactPath(artifactsRaw.summary_path),
        raster_path: normalizeArtifactPath(artifactsRaw.raster_path),
        ocr_path: normalizeArtifactPath(artifactsRaw.ocr_path),
        vectors_path: normalizeArtifactPath(artifactsRaw.vectors_path),
      };

      const flagsRaw = page.flags && typeof page.flags === 'object'
        ? page.flags as Record<string, unknown>
        : {};

      const flags: PdfPageContextFlags = {
        has_docling: Boolean(flagsRaw.has_docling ?? artifacts.docling_path),
        has_blocks: Boolean(flagsRaw.has_blocks ?? artifacts.blocks_path),
        has_tables: Boolean(flagsRaw.has_tables ?? artifacts.tables_path),
        has_pictures: Boolean(flagsRaw.has_pictures ?? artifacts.pictures_path),
        has_summary: Boolean(flagsRaw.has_summary ?? artifacts.summary_path),
        has_raster: Boolean(flagsRaw.has_raster ?? artifacts.raster_path),
        has_ocr: Boolean(flagsRaw.has_ocr ?? artifacts.ocr_path),
        has_vectors: Boolean(flagsRaw.has_vectors ?? artifacts.vectors_path),
        has_parent_global_artifacts: Boolean(flagsRaw.has_parent_global_artifacts),
      };

      return {
        version: typeof page.version === 'string' ? page.version : 'pdf-page-context-v1',
        page_no: pageNo,
        page_index: Number.isFinite(Number(page.page_index)) ? Number(page.page_index) : pageNo - 1,
        width: toNumberOrNull(page.width),
        height: toNumberOrNull(page.height),
        artifacts,
        source: page.source && typeof page.source === 'object' ? page.source : undefined,
        flags,
        global_artifact_prefix: normalizeArtifactPath(page.global_artifact_prefix),
        global_artifact_copy_version: normalizeArtifactPath(page.global_artifact_copy_version),
      };
    })
    .filter((ctx): ctx is PdfPageContext => Boolean(ctx))
    .sort((a, b) => a.page_no - b.page_no);
}

export function normalizePdfPageContextSummary(raw: unknown, pageContexts: PdfPageContext[]): PdfPageContextSummary | null {
  if (raw && typeof raw === 'object') {
    const summary = raw as Record<string, any>;
    return {
      version: typeof summary.version === 'string' ? summary.version : 'pdf-page-context-summary-v1',
      ok: Boolean(summary.ok),
      expected_page_count: toNumberOrNull(summary.expected_page_count),
      observed_page_count: Number.isFinite(Number(summary.observed_page_count))
        ? Number(summary.observed_page_count)
        : pageContexts.length,
      first_page_no: toNumberOrNull(summary.first_page_no),
      last_page_no: toNumberOrNull(summary.last_page_no),
      parent_global_context_count: toNumberOrNull(summary.parent_global_context_count),
      missing_page_numbers: Array.isArray(summary.missing_page_numbers) ? summary.missing_page_numbers.map(Number).filter(Number.isFinite) : [],
      duplicate_page_numbers: Array.isArray(summary.duplicate_page_numbers) ? summary.duplicate_page_numbers.map(Number).filter(Number.isFinite) : [],
      problems: Array.isArray(summary.problems) ? summary.problems.map(String) : [],
    };
  }

  return {
    version: 'pdf-page-context-summary-v1',
    ok: pageContexts.length > 0 && pageContexts.every((ctx) =>
      ctx.artifacts.docling_path
      && ctx.artifacts.blocks_path
      && ctx.artifacts.summary_path
      && ctx.flags.has_parent_global_artifacts
    ),
    expected_page_count: pageContexts.length,
    observed_page_count: pageContexts.length,
    first_page_no: pageContexts[0]?.page_no ?? null,
    last_page_no: pageContexts[pageContexts.length - 1]?.page_no ?? null,
    parent_global_context_count: pageContexts.filter((ctx) => ctx.flags.has_parent_global_artifacts).length,
    missing_page_numbers: [],
    duplicate_page_numbers: [],
    problems: [],
  };
}

export function validatePdfPageContexts(input: {
  pageContextEntrypoint?: PageContextEntrypoint | null;
  pageContexts: PdfPageContext[];
  pageContextSummary?: PdfPageContextSummary | null;
}): PdfPageContextValidation {
  const pageContexts = input.pageContexts;
  const summary = input.pageContextSummary ?? null;
  const entrypoint = input.pageContextEntrypoint ?? null;

  const expectedPageCount = toNumberOrNull(summary?.expected_page_count)
    ?? toNumberOrNull(entrypoint?.page_count)
    ?? (pageContexts.length || null);

  const pageNumbers = pageContexts
    .map((ctx) => Number(ctx.page_no))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);

  const counts = new Map<number, number>();
  for (const n of pageNumbers) counts.set(n, (counts.get(n) ?? 0) + 1);

  const unique = [...counts.keys()].sort((a, b) => a - b);
  const duplicatePageNumbers = unique.filter((n) => (counts.get(n) ?? 0) > 1);

  const missingPageNumbers: number[] = [];
  if (expectedPageCount && expectedPageCount > 0) {
    for (let i = 1; i <= expectedPageCount; i += 1) {
      if (!counts.has(i)) missingPageNumbers.push(i);
    }
  }

  const problems: string[] = [];

  if (entrypoint?.available !== true) {
    problems.push('page_context_entrypoint_unavailable');
  }

  if (summary && summary.ok !== true) {
    problems.push('page_context_summary_not_ok');
  }

  if (!pageContexts.length) {
    problems.push('page_contexts_empty');
  }

  if (expectedPageCount && pageContexts.length !== expectedPageCount) {
    problems.push(`page_context_count_mismatch: expected ${expectedPageCount}, got ${pageContexts.length}`);
  }

  if (missingPageNumbers.length) {
    problems.push(`missing_page_contexts:${missingPageNumbers.join(',')}`);
  }

  if (duplicatePageNumbers.length) {
    problems.push(`duplicate_page_contexts:${duplicatePageNumbers.join(',')}`);
  }

  for (const ctx of pageContexts) {
    const pageNo = Number(ctx.page_no);
    if (!ctx.artifacts.docling_path) problems.push(`page_${pageNo}_docling_path_missing`);
    if (!ctx.artifacts.blocks_path) problems.push(`page_${pageNo}_blocks_path_missing`);
    if (!ctx.artifacts.summary_path) problems.push(`page_${pageNo}_summary_path_missing`);
    if (!ctx.artifacts.raster_path) problems.push(`page_${pageNo}_raster_path_missing`);
    if (!ctx.flags.has_parent_global_artifacts) problems.push(`page_${pageNo}_parent_global_artifacts_missing`);
    if (ctx.width !== null && (!Number.isFinite(ctx.width) || ctx.width <= 0)) problems.push(`page_${pageNo}_invalid_width`);
    if (ctx.height !== null && (!Number.isFinite(ctx.height) || ctx.height <= 0)) problems.push(`page_${pageNo}_invalid_height`);
  }

  return {
    version: 'pdf-page-context-validation-v1',
    ok: problems.length === 0,
    expected_page_count: expectedPageCount,
    observed_page_count: pageContexts.length,
    first_page_no: unique[0] ?? null,
    last_page_no: unique.length ? unique[unique.length - 1] : null,
    missing_page_numbers: missingPageNumbers,
    duplicate_page_numbers: duplicatePageNumbers,
    problems,
  };
}

export function getPreferredPdfPageContextSource(input: {
  pageContextEntrypoint?: PageContextEntrypoint | null;
  pageContexts?: unknown;
  pageContextSummary?: unknown;
}): PreferredPdfPageContextSource {
  const pageContexts = normalizePdfPageContexts(input.pageContexts);
  const pageContextSummary = normalizePdfPageContextSummary(input.pageContextSummary, pageContexts);
  const entrypoint = input.pageContextEntrypoint ?? null;
  const pageContextValidation = validatePdfPageContexts({
    pageContextEntrypoint: entrypoint,
    pageContexts,
    pageContextSummary,
  });

  // Phase 4F.4 guardrail:
  // Prefer PageContext[] only when the manifest, summary, required artifacts,
  // parent-global paths, raster refs, and page coverage all validate.
  if (pageContextValidation.ok) {
    return {
      source: 'per_page_docling',
      pageContexts,
      pageContextSummary,
      pageContextEntrypoint: entrypoint,
      pageContextValidation,
      reason: 'parent per-page Docling manifest validated',
    };
  }

  return {
    source: 'legacy_docling',
    pageContexts: [],
    pageContextSummary,
    pageContextEntrypoint: entrypoint,
    pageContextValidation,
    reason: entrypoint?.available
      ? `page context validation failed: ${pageContextValidation.problems.slice(0, 5).join('; ')}`
      : 'page context entrypoint unavailable',
  };
}

/**
 * Phase 4F.5 compatibility gate.
 *
 * Legacy Phase 2/3 imports do not expose a PageContext entrypoint and must be
 * allowed to continue through the existing monolithic/legacy Docling path.
 *
 * Phase 4 imports that explicitly expose a PageContext entrypoint are treated
 * as authoritative. If that entrypoint is present but invalid, block the import
 * instead of silently falling back to stale or partial artifacts.
 */

export function buildPdfPageContextConsumerGuardrail(
  selection: PreferredPdfPageContextSource,
): PdfPageContextConsumerGuardrail {
  const validation = selection.pageContextValidation;
  const entrypoint = selection.pageContextEntrypoint;
  const pageContextSourceUsed = selection.source === 'per_page_docling';
  const shouldBlock = shouldBlockPdfPageContextImport(selection);
  const legacyFallbackUsed = selection.source === 'legacy_docling';
  const fallbackAllowed = legacyFallbackUsed && !shouldBlock;

  return {
    version: 'pdf-page-context-consumer-guardrail-v1',
    selected_source: selection.source,
    page_context_source_used: pageContextSourceUsed,
    legacy_fallback_used: legacyFallbackUsed,
    fallback_allowed: fallbackAllowed,
    should_block_import: shouldBlock,
    reason: selection.reason,
    manifest_path: entrypoint?.manifest_path ?? null,
    expected_page_count: validation.expected_page_count,
    observed_page_count: validation.observed_page_count,
    validation_ok: validation.ok,
    validation_problem_count: validation.problems.length,
    validation_problems: validation.problems,
    entrypoint_available: Boolean(entrypoint?.available),
    parent_global_context_count: selection.pageContextSummary?.parent_global_context_count ?? null,
    generated_at: new Date().toISOString(),
  };
}

export function shouldBlockPdfPageContextImport(selection: PreferredPdfPageContextSource): boolean {
  return Boolean(
    selection.pageContextEntrypoint?.available
    && !selection.pageContextValidation.ok
  );
}

