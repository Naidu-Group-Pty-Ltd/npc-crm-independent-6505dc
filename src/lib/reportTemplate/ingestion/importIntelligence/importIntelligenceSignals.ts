/**
 * importIntelligenceSignals — Phase 10B.
 *
 * Deterministic signal extraction for the Import Intelligence Profile. Reads
 * already-available import metadata (snapshot, raw record meta, template schema,
 * artifacts, summaries) and derives structured signals + evidence. It never reads
 * or stores raw PDF text: text estimates are counts/densities only.
 */
import type {
  ImportIntelligenceSignals,
  ImportIntelligenceEvidence,
} from './importIntelligenceTypes';

/** Clamp any value to a finite number in [0, 1], or null. Accepts numeric strings. */
export function clampImportIntelligenceScore(value: unknown): number | null {
  const n = coerceImportIntelligenceNumber(value);
  if (n === null) return null;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Coerce to boolean, or null. Accepts the strings "true"/"false" (case-insensitive). */
export function coerceImportIntelligenceBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const t = value.trim().toLowerCase();
    if (t === 'true') return true;
    if (t === 'false') return false;
  }
  return null;
}

/** Coerce to a finite number, or null. Accepts numeric strings like "0.91". */
export function coerceImportIntelligenceNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Read a nested value at `path`, or undefined. Never throws. */
export function readImportIntelligencePath(source: unknown, path: string[]): unknown {
  let cur: any = source;
  for (const key of path) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = cur[key];
  }
  return cur;
}

function coerceString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** First candidate that coerces to a non-null value under `coerce`. */
function pick<T>(coerce: (v: unknown) => T | null, cands: unknown[]): T | null {
  for (const c of cands) {
    const r = coerce(c);
    if (r !== null && r !== undefined) return r;
  }
  return null;
}

const KEYWORDS_TABLE = ['table', 'cell', 'row', 'column', 'grid'];
const KEYWORDS_IMAGE = ['image', 'picture', 'logo', 'background'];
const KEYWORDS_TEXT = ['text', 'paragraph', 'heading', 'label', 'title'];

/** Collect the block-like descriptors of every page in a template schema. */
function collectSchemaBlocks(templateSchema: unknown): Array<Record<string, unknown>> {
  const pages = readImportIntelligencePath(templateSchema, ['pages']);
  if (!Array.isArray(pages)) return [];
  const blocks: Array<Record<string, unknown>> = [];
  for (const page of pages) {
    const pageBlocks = (page as any)?.blocks ?? (page as any)?.elements ?? (page as any)?.children;
    if (Array.isArray(pageBlocks)) {
      for (const b of pageBlocks) {
        if (b && typeof b === 'object') blocks.push(b as Record<string, unknown>);
      }
    }
  }
  return blocks;
}

/** Lowercased type/name/kind descriptor of a block, for keyword matching. */
function blockDescriptor(block: Record<string, unknown>): string {
  const parts = [block.type, block.kind, block.name, block.role, block.blockType]
    .filter((p) => typeof p === 'string')
    .map((p) => (p as string).toLowerCase());
  return parts.join(' ');
}

function countBlocksMatching(
  blocks: Array<Record<string, unknown>>,
  keywords: string[],
): number {
  let count = 0;
  for (const b of blocks) {
    const desc = blockDescriptor(b);
    if (keywords.some((k) => desc.includes(k))) count += 1;
  }
  return count;
}

/** Sum a numeric field found across page-context/artifact entries, or null. */
function sumArtifactCounts(artifacts: unknown, keys: string[]): number | null {
  const candidates: unknown[] = [];
  const pushFrom = (container: unknown) => {
    if (Array.isArray(container)) {
      for (const entry of container) {
        for (const key of keys) {
          const v = readImportIntelligencePath(entry, [key]);
          if (v !== undefined) candidates.push(v);
        }
      }
    }
  };
  pushFrom(artifacts);
  pushFrom(readImportIntelligencePath(artifacts, ['pages']));
  pushFrom(readImportIntelligencePath(artifacts, ['pageContexts']));
  pushFrom(readImportIntelligencePath(artifacts, ['page_contexts']));
  if (candidates.length === 0) return null;
  let total = 0;
  let seen = false;
  for (const c of candidates) {
    const n = coerceImportIntelligenceNumber(c);
    if (n !== null) {
      total += n;
      seen = true;
    }
  }
  return seen ? total : null;
}

/** Estimate table count from schema keywords and artifact page-context counts. */
export function estimateTableCount(input: {
  record?: unknown;
  snapshot?: unknown;
  templateSchema?: unknown;
  artifacts?: unknown;
}): number | null {
  const artifactCount = sumArtifactCounts(input.artifacts, [
    'table_count',
    'tableCount',
    'tables',
    'num_tables',
  ]);
  const blocks = collectSchemaBlocks(input.templateSchema);
  const schemaCount = blocks.length > 0 ? countBlocksMatching(blocks, KEYWORDS_TABLE) : null;
  if (artifactCount === null && schemaCount === null) return null;
  return Math.max(artifactCount ?? 0, schemaCount ?? 0);
}

/** Estimate image/picture count from schema keywords and artifact page-context counts. */
export function estimateImageCount(input: {
  record?: unknown;
  snapshot?: unknown;
  templateSchema?: unknown;
  artifacts?: unknown;
}): number | null {
  const artifactCount = sumArtifactCounts(input.artifacts, [
    'picture_count',
    'pictureCount',
    'image_count',
    'imageCount',
    'pictures',
    'images',
  ]);
  const blocks = collectSchemaBlocks(input.templateSchema);
  const schemaCount = blocks.length > 0 ? countBlocksMatching(blocks, KEYWORDS_IMAGE) : null;
  if (artifactCount === null && schemaCount === null) return null;
  return Math.max(artifactCount ?? 0, schemaCount ?? 0);
}

const TEXT_BLOCKS_PER_PAGE_CAP = 40;

/**
 * Estimate a 0..1 text density from the count of text-like schema blocks per
 * page. Counts only — never reads or stores raw text.
 */
export function estimateTextDensity(input: {
  record?: unknown;
  templateSchema?: unknown;
  artifacts?: unknown;
}): number | null {
  const blocks = collectSchemaBlocks(input.templateSchema);
  if (blocks.length === 0) return null;
  const textBlocks = countBlocksMatching(blocks, KEYWORDS_TEXT);
  const pages = readImportIntelligencePath(input.templateSchema, ['pages']);
  const pageCount = Array.isArray(pages) && pages.length > 0 ? pages.length : 1;
  const perPage = textBlocks / pageCount;
  return clampImportIntelligenceScore(perPage / TEXT_BLOCKS_PER_PAGE_CAP);
}

/**
 * Estimate a 0..1 OCR likelihood. Higher when the engine/artifacts indicate OCR,
 * or when editable structure is weak (low text density) while quality/repair
 * signals demand manual attention. Returns null when there is no evidence.
 */
export function estimateOcrLikelihood(input: {
  record?: unknown;
  snapshot?: unknown;
  artifacts?: unknown;
  signals?: Partial<ImportIntelligenceSignals>;
}): number | null {
  const s = input.signals ?? {};
  let score = 0;
  let evidence = false;

  const engine = (coerceString(s.engineVersion) ?? '').toLowerCase();
  const artifactText = (() => {
    try {
      return JSON.stringify(input.artifacts ?? '').toLowerCase();
    } catch {
      return '';
    }
  })();
  if (engine.includes('ocr') || artifactText.includes('ocr') || artifactText.includes('scanned')) {
    score += 0.6;
    evidence = true;
  }

  const textDensity = s.textDensityEstimate ?? null;
  if (textDensity !== null && textDensity < 0.15) {
    score += 0.3;
    evidence = true;
  }

  if (s.visualQaManualReviewRequired === true) {
    score += 0.15;
    evidence = true;
  }
  if (s.repairRequiresFallback === true || s.repairRequiresManualReview === true) {
    score += 0.15;
    evidence = true;
  }

  // A low editable text density combined with a present-but-low visual QA score
  // is a classic scanned/OCR signature.
  if (textDensity !== null && textDensity < 0.2 && s.visualQaScore !== null && s.visualQaScore !== undefined && s.visualQaScore < 0.8) {
    score += 0.2;
    evidence = true;
  }

  if (!evidence) return null;
  return clampImportIntelligenceScore(score);
}

/**
 * Estimate a 0..1 design complexity. Higher with many images, weak visual QA,
 * repair fallback/manual review, weak export parity. Returns null with no evidence.
 */
export function estimateDesignComplexity(input: {
  templateSchema?: unknown;
  artifacts?: unknown;
  signals?: Partial<ImportIntelligenceSignals>;
}): number | null {
  const s = input.signals ?? {};
  let score = 0;
  let evidence = false;

  const imageCount = s.imageCountEstimate ?? null;
  if (imageCount !== null) {
    evidence = true;
    if (imageCount > 5) score += 0.4;
    else if (imageCount >= 3) score += 0.28;
    else if (imageCount >= 1) score += 0.12;
  }

  if (s.visualQaScore !== null && s.visualQaScore !== undefined && s.visualQaScore < 0.85) {
    score += 0.25;
    evidence = true;
  }
  if (s.repairRequiresFallback === true || s.repairRequiresManualReview === true) {
    score += 0.2;
    evidence = true;
  }
  const exportScore = s.exportVsSourceScore ?? null;
  if (exportScore !== null && exportScore < 0.85) {
    score += 0.15;
    evidence = true;
  }

  const blocks = collectSchemaBlocks(input.templateSchema);
  if (blocks.length > 0) {
    evidence = true;
    if (blocks.length > 40) score += 0.2;
    else if (blocks.length > 20) score += 0.1;
  }

  if (!evidence) return null;
  return clampImportIntelligenceScore(score);
}

/**
 * Estimate a 0..1 layout risk. Higher with many tables, many pages, weak visual
 * QA, repair failure/fallback/manual, weak export parity, degraded baseline.
 */
export function estimateLayoutRisk(input: {
  signals: Partial<ImportIntelligenceSignals>;
}): number | null {
  const s = input.signals;
  let score = 0;
  let evidence = false;

  const tableCount = s.tableCountEstimate ?? null;
  if (tableCount !== null) {
    evidence = true;
    if (tableCount > 5) score += 0.35;
    else if (tableCount >= 3) score += 0.22;
    else if (tableCount >= 1) score += 0.1;
  }

  const pageCount = s.pageCount ?? null;
  if (pageCount !== null) {
    evidence = true;
    if (pageCount >= 6) score += 0.2;
    else if (pageCount >= 3) score += 0.1;
  }

  if (s.visualQaScore !== null && s.visualQaScore !== undefined && s.visualQaScore < 0.85) {
    score += 0.15;
    evidence = true;
  }
  const repairStatus = (coerceString(s.repairStatus) ?? '').toLowerCase();
  if (repairStatus === 'failed' || s.repairRequiresFallback === true || s.repairRequiresManualReview === true) {
    score += 0.2;
    evidence = true;
  }
  const exportScore = s.exportVsSourceScore ?? null;
  if (exportScore !== null && exportScore < 0.85) {
    score += 0.1;
    evidence = true;
  }
  if ((coerceString(s.baselineOutcome) ?? '').toLowerCase() === 'degraded') {
    score += 0.15;
    evidence = true;
  }

  if (!evidence) return null;
  return clampImportIntelligenceScore(score);
}

function pushEvidence(
  list: ImportIntelligenceEvidence[],
  code: string,
  label: string,
  value: string | number | boolean | null,
  weight: number,
  message: string,
): void {
  list.push({ code, label, value, weight, message });
}

/** Extract deterministic import-intelligence signals + evidence from all inputs. */
export function extractImportIntelligenceSignals(input: {
  importId?: string | null;
  templateId?: string | null;
  sourceFilename?: string | null;
  record?: unknown;
  snapshot?: unknown;
  templateSchema?: unknown;
  artifacts?: unknown;
  visualQuality?: unknown;
  repairSummary?: unknown;
  exportParitySummary?: unknown;
  goldenRegressionSummary?: unknown;
  goldenHistory?: unknown[];
}): {
  signals: ImportIntelligenceSignals;
  evidence: ImportIntelligenceEvidence[];
  warnings: string[];
  blockers: string[];
} {
  const snap = input.snapshot;
  const record = input.record;
  const meta = readImportIntelligencePath(record, ['meta']);
  const vq = input.visualQuality;
  const repair = input.repairSummary;
  const exportParity = input.exportParitySummary;
  const golden = input.goldenRegressionSummary;

  const evidence: ImportIntelligenceEvidence[] = [];
  const warnings: string[] = [];
  const blockers: string[] = [];

  const importId = coerceString(input.importId)
    ?? coerceString(readImportIntelligencePath(snap, ['importId']))
    ?? coerceString(readImportIntelligencePath(record, ['id']))
    ?? coerceString(readImportIntelligencePath(record, ['import_id']));

  if (!importId) blockers.push('import_id_missing');
  if (!snap && !record) blockers.push('profile_input_missing');

  // Page count
  const pageCount = pick(coerceImportIntelligenceNumber, [
    readImportIntelligencePath(snap, ['importPageCount']),
    readImportIntelligencePath(record, ['page_count']),
    readImportIntelligencePath(record, ['pageCount']),
    readImportIntelligencePath(meta, ['page_count']),
    (() => {
      const pages = readImportIntelligencePath(input.templateSchema, ['pages']);
      return Array.isArray(pages) ? pages.length : undefined;
    })(),
  ]);
  const isMultiPage = pageCount !== null ? pageCount > 1 : null;
  if (pageCount !== null && pageCount >= 3) {
    pushEvidence(evidence, 'multi_page_detected', 'Multi-page document', pageCount, 0.3,
      `Import has ${pageCount} pages.`);
  }

  // Visual QA
  const visualQaScore = pick(coerceImportIntelligenceNumber, [
    readImportIntelligencePath(snap, ['visualQaScore']),
    readImportIntelligencePath(vq, ['overallScore']),
    readImportIntelligencePath(meta, ['visual_quality_summary', 'overallScore']),
  ]);
  const visualQaManualReviewRequired = pick(coerceImportIntelligenceBoolean, [
    readImportIntelligencePath(snap, ['visualQaManualReviewRequired']),
    readImportIntelligencePath(vq, ['manualReviewRequired']),
    readImportIntelligencePath(meta, ['visual_quality_summary', 'manualReviewRequired']),
  ]);
  const hasVisualQuality = visualQaScore !== null
    || visualQaManualReviewRequired !== null
    || coerceString(readImportIntelligencePath(snap, ['visualQaArtifactPath'])) !== null;
  if (!hasVisualQuality) warnings.push('missing_visual_quality');
  if (visualQaScore !== null) {
    pushEvidence(evidence, 'visual_qa_score', 'Visual QA score', visualQaScore, 0.4,
      `Visual QA overall score is ${visualQaScore}.`);
  }
  if (visualQaManualReviewRequired === true) {
    pushEvidence(evidence, 'visual_qa_manual_review', 'Visual QA manual review', true, 0.8,
      'Visual QA requires manual review.');
  }

  // Repair
  const repairStatus = pick(coerceString, [
    readImportIntelligencePath(snap, ['repairStatus']),
    readImportIntelligencePath(repair, ['repairStatus']),
    readImportIntelligencePath(meta, ['visual_repair_summary', 'repairStatus']),
  ]);
  const repairFinalScore = pick(coerceImportIntelligenceNumber, [
    readImportIntelligencePath(snap, ['repairFinalScore']),
    readImportIntelligencePath(repair, ['finalScore']),
    readImportIntelligencePath(meta, ['visual_repair_summary', 'finalScore']),
  ]);
  const repairRequiresFallback = pick(coerceImportIntelligenceBoolean, [
    readImportIntelligencePath(snap, ['repairRequiresFallback']),
    readImportIntelligencePath(repair, ['requiresFallback']),
    readImportIntelligencePath(meta, ['visual_repair_summary', 'requiresFallback']),
  ]);
  const repairRequiresManualReview = pick(coerceImportIntelligenceBoolean, [
    readImportIntelligencePath(snap, ['repairRequiresManualReview']),
    readImportIntelligencePath(repair, ['requiresManualReview']),
    readImportIntelligencePath(meta, ['visual_repair_summary', 'requiresManualReview']),
  ]);
  const hasRepairAudit = repairStatus !== null || repairFinalScore !== null
    || coerceString(readImportIntelligencePath(snap, ['repairArtifactPath'])) !== null;
  if (!hasRepairAudit) warnings.push('missing_repair_audit');
  if (repairRequiresFallback === true) {
    pushEvidence(evidence, 'repair_fallback', 'Repair fallback required', true, 0.6,
      'Repair requires a fallback path.');
  }

  // Export parity
  const exportParityStatus = pick(coerceString, [
    readImportIntelligencePath(snap, ['exportParityStatus']),
    readImportIntelligencePath(exportParity, ['status']),
    readImportIntelligencePath(meta, ['export_parity_summary', 'status']),
  ]);
  const exportVsSourceScore = pick(coerceImportIntelligenceNumber, [
    readImportIntelligencePath(snap, ['exportVsSourceScore']),
    readImportIntelligencePath(exportParity, ['exportVsSourceScore']),
    readImportIntelligencePath(meta, ['export_parity_summary', 'exportVsSourceScore']),
  ]);
  const editorVsSourceScore = pick(coerceImportIntelligenceNumber, [
    readImportIntelligencePath(snap, ['editorVsSourceScore']),
    readImportIntelligencePath(exportParity, ['editorVsSourceScore']),
    readImportIntelligencePath(meta, ['export_parity_summary', 'editorVsSourceScore']),
  ]);
  const exportVsEditorScore = pick(coerceImportIntelligenceNumber, [
    readImportIntelligencePath(snap, ['exportVsEditorScore']),
    readImportIntelligencePath(exportParity, ['exportVsEditorScore']),
    readImportIntelligencePath(meta, ['export_parity_summary', 'exportVsEditorScore']),
  ]);
  const hasExportParity = exportParityStatus !== null || exportVsSourceScore !== null;
  if (!hasExportParity) warnings.push('missing_export_parity');
  if (exportParityStatus !== null) {
    pushEvidence(evidence, 'export_parity_status', 'Export parity status', exportParityStatus, 0.3,
      `Export parity status is ${exportParityStatus}.`);
  }

  // AI reconciliation
  const aiReconciliationStatus = pick(coerceString, [
    readImportIntelligencePath(snap, ['aiReconciliationStatus']),
    readImportIntelligencePath(meta, ['ai_reconciliation_summary', 'status']),
  ]);
  const aiReconciliationRecommendation = pick(coerceString, [
    readImportIntelligencePath(snap, ['aiReconciliationRecommendation']),
    readImportIntelligencePath(meta, ['ai_reconciliation_summary', 'recommendation']),
  ]);

  // Engine version
  const engineVersion = pick(coerceString, [
    readImportIntelligencePath(snap, ['engineVersion']),
    readImportIntelligencePath(meta, ['import_manifests_summary', 'engine_version']),
  ]);

  // Estimates (schema/artifact based)
  const tableCountEstimate = estimateTableCount({
    record, snapshot: snap, templateSchema: input.templateSchema, artifacts: input.artifacts,
  });
  const imageCountEstimate = estimateImageCount({
    record, snapshot: snap, templateSchema: input.templateSchema, artifacts: input.artifacts,
  });
  const textDensityEstimate = estimateTextDensity({
    record, templateSchema: input.templateSchema, artifacts: input.artifacts,
  });
  if (input.templateSchema === undefined || input.templateSchema === null) {
    warnings.push('insufficient_schema_evidence');
  }
  if (input.artifacts === undefined || input.artifacts === null) {
    warnings.push('insufficient_artifact_evidence');
  }
  if (tableCountEstimate !== null && tableCountEstimate >= 3) {
    pushEvidence(evidence, 'table_density', 'Table density', tableCountEstimate, 0.4,
      `Estimated ${tableCountEstimate} table-like elements.`);
  }
  if (imageCountEstimate !== null && imageCountEstimate >= 3) {
    pushEvidence(evidence, 'image_density', 'Image density', imageCountEstimate, 0.4,
      `Estimated ${imageCountEstimate} image-like elements.`);
  }

  // Partial signals for the derived risk estimators.
  const partial: Partial<ImportIntelligenceSignals> = {
    pageCount, visualQaScore, visualQaManualReviewRequired,
    repairStatus, repairRequiresFallback, repairRequiresManualReview,
    exportVsSourceScore, engineVersion, tableCountEstimate, imageCountEstimate,
    textDensityEstimate,
  };

  const ocrLikelihood = estimateOcrLikelihood({
    record, snapshot: snap, artifacts: input.artifacts, signals: partial,
  });
  const designComplexityEstimate = estimateDesignComplexity({
    templateSchema: input.templateSchema, artifacts: input.artifacts, signals: partial,
  });

  // Golden regression / history
  const goldenQualityGateStatus = pick(coerceString, [
    readImportIntelligencePath(golden, ['qualityGateStatus']),
    readImportIntelligencePath(meta, ['golden_regression_summary', 'qualityGateStatus']),
  ]);
  const goldenFailures = readImportIntelligencePath(golden, ['failures'])
    ?? readImportIntelligencePath(meta, ['golden_regression_summary', 'failures']);
  const goldenWarnings = readImportIntelligencePath(golden, ['warnings'])
    ?? readImportIntelligencePath(meta, ['golden_regression_summary', 'warnings']);
  const goldenFailureCount = Array.isArray(goldenFailures) ? goldenFailures.length : null;
  const goldenWarningCount = Array.isArray(goldenWarnings) ? goldenWarnings.length : null;

  const latestHistory = Array.isArray(input.goldenHistory) ? input.goldenHistory[0] : undefined;
  const baselineOutcome = pick(coerceString, [
    readImportIntelligencePath(latestHistory, ['baselineComparison', 'outcome']),
    readImportIntelligencePath(latestHistory, ['baseline_outcome']),
  ]);
  if ((baselineOutcome ?? '').toLowerCase() === 'degraded') {
    pushEvidence(evidence, 'baseline_degraded', 'Baseline degraded', baselineOutcome, 0.5,
      'Latest golden run is worse than its baseline.');
  }

  const signalsWithoutLayout: ImportIntelligenceSignals = {
    pageCount,
    isMultiPage,
    hasVisualQuality,
    visualQaScore,
    visualQaManualReviewRequired,
    hasRepairAudit,
    repairStatus,
    repairFinalScore,
    repairRequiresFallback,
    repairRequiresManualReview,
    hasExportParity,
    exportParityStatus,
    exportVsSourceScore,
    editorVsSourceScore,
    exportVsEditorScore,
    aiReconciliationStatus,
    aiReconciliationRecommendation,
    engineVersion,
    tableCountEstimate,
    imageCountEstimate,
    textDensityEstimate,
    ocrLikelihood,
    designComplexityEstimate,
    layoutRiskEstimate: null,
    goldenQualityGateStatus,
    goldenFailureCount,
    goldenWarningCount,
    baselineOutcome,
  };

  const layoutRiskEstimate = estimateLayoutRisk({ signals: signalsWithoutLayout });
  const signals: ImportIntelligenceSignals = { ...signalsWithoutLayout, layoutRiskEstimate };

  return { signals, evidence, warnings: uniqueStrings(warnings), blockers: uniqueStrings(blockers) };
}

function uniqueStrings(values: string[]): string[] {
  const out: string[] = [];
  for (const v of values) if (v && !out.includes(v)) out.push(v);
  return out;
}
