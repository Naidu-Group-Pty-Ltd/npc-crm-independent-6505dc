/**
 * goldenCorpusRegistry — the default Phase 8A Golden Corpus Registry plus
 * discovery/validation helpers. This mirrors
 * `docs/pdf-import/golden-corpus-registry.template.json` (the two must stay in
 * sync). No PDFs are referenced, uploaded, or committed here.
 */
import {
  GOLDEN_CORPUS_CATEGORIES,
  GOLDEN_CORPUS_MANDATORY_METADATA_KEYS,
  GOLDEN_CORPUS_PAGE_COUNT_MODES,
  GOLDEN_CORPUS_REGISTRY_VERSION,
  GOLDEN_CORPUS_REQUIRED_IDS,
  type GoldenCorpusItem,
  type GoldenCorpusRegistry,
  type GoldenCorpusValidationIssue,
  type GoldenCorpusValidationResult,
} from './goldenCorpusTypes';

/** The full metadata capture list every golden run should record (Phase 8D). */
const FULL_REQUIRED_METADATA: string[] = [
  'runId',
  'corpusId',
  'category',
  'sourceFilename',
  'importId',
  'templateId',
  'engineVersion',
  'importPageCount',
  'templatePageCount',
  'visualQaScore',
  'visualQaManualReviewRequired',
  'repairStatus',
  'repairFinalScore',
  'repairScoreDelta',
  'aiReconciliationStatus',
  'aiReconciliationRecommendation',
  'exportParityStatus',
  'exportParityMode',
  'exportVsSourceScore',
  'editorVsSourceScore',
  'exportVsEditorScore',
  'warnings',
  'failures',
  'operatorDecision',
  'createdAt',
];

export const DEFAULT_GOLDEN_CORPUS_REGISTRY: GoldenCorpusRegistry = {
  version: GOLDEN_CORPUS_REGISTRY_VERSION,
  registryName: 'PDF Import Golden Corpus Registry',
  description:
    'Canonical PDF import regression corpus metadata. Do not commit private/client PDFs.',
  updatedAt: '',
  corpus: [
    {
      corpusId: 'golden-simple-001',
      category: 'simple_one_page',
      title: 'Simple one-page PDF',
      purpose: 'Validate the most basic import path end to end.',
      pageCountExpectation: { mode: 'exact', exact: 1, minimum: null, maximum: null },
      expectedOutcomes: {
        importShouldSucceed: true,
        templateShouldBeCreated: true,
        visualQaShouldRun: true,
        repairShouldRunOrSkipSafely: true,
        applyRepairShouldOpenEditor: true,
        exportParityShouldBeRecordable: true,
        templatePageCountShouldMatch: true,
        manualReviewAllowed: false,
        fallbackAllowed: false,
      },
      scoreThresholds: { visualQaMinimum: 0.9, repairFinalMinimum: 0.9, exportParityMinimum: 0.9 },
      acceptableWarnings: [
        'repair_skipped_no_eligible_pages',
        'ai_reconciliation_optional',
        'export_parity_manual_required',
      ],
      unacceptableFailures: [
        'import_failed',
        'finalization_failed',
        'template_not_created',
        'template_page_count_mismatch',
        'source_rasters_missing',
        'visual_quality_artifact_missing',
        'repair_audit_missing',
        'repair_audit_storage_object_missing',
        'apply_repair_failed',
        'export_parity_persistence_failed',
        'generated_template_empty',
        'backend_unknown_operation',
        'sidecar_unavailable',
      ],
      requiredMetadata: [...FULL_REQUIRED_METADATA],
      notes: [
        'Baseline sanity check; a regression here indicates a core pipeline break.',
        'No manual review or fallback is expected for a clean one-page PDF.',
      ],
    },
    {
      corpusId: 'golden-design-001',
      category: 'design_heavy_one_page',
      title: 'Design-heavy one-page PDF',
      purpose: 'Validate a visually dense, branded/design-heavy single page.',
      pageCountExpectation: { mode: 'exact', exact: 1, minimum: null, maximum: null },
      expectedOutcomes: {
        importShouldSucceed: true,
        templateShouldBeCreated: true,
        visualQaShouldRun: true,
        repairShouldRunOrSkipSafely: true,
        applyRepairShouldOpenEditor: true,
        exportParityShouldBeRecordable: true,
        templatePageCountShouldMatch: true,
        manualReviewAllowed: true,
        fallbackAllowed: true,
      },
      scoreThresholds: { visualQaMinimum: 0.8, repairFinalMinimum: 0.82, exportParityMinimum: 0.8 },
      acceptableWarnings: [
        'manual_review_required',
        'ai_reconciliation_optional',
        'export_parity_manual_required',
        'fallback_used_with_source_raster_preserved',
        'design_complexity_warning',
      ],
      unacceptableFailures: [
        'import_failed',
        'finalization_failed',
        'template_not_created',
        'template_page_count_mismatch',
        'source_rasters_missing',
        'visual_quality_artifact_missing',
        'apply_repair_failed',
        'export_parity_persistence_failed',
        'generated_template_empty',
        'missing_major_image',
        'backend_unknown_operation',
        'sidecar_unavailable',
      ],
      requiredMetadata: [...FULL_REQUIRED_METADATA],
      notes: [
        'Visual QA may score lower than a simple PDF but must stay above the minimum.',
        'Fallback is acceptable only when the source raster is preserved and documented.',
      ],
    },
    {
      corpusId: 'golden-report-001',
      category: 'multi_page_report',
      title: 'Multi-page report PDF',
      purpose: 'Validate multi-page import consistency and per-page fidelity.',
      pageCountExpectation: { mode: 'minimum', exact: null, minimum: 2, maximum: null },
      expectedOutcomes: {
        importShouldSucceed: true,
        templateShouldBeCreated: true,
        visualQaShouldRun: true,
        repairShouldRunOrSkipSafely: true,
        applyRepairShouldOpenEditor: true,
        exportParityShouldBeRecordable: true,
        templatePageCountShouldMatch: true,
        manualReviewAllowed: true,
        fallbackAllowed: false,
      },
      scoreThresholds: { visualQaMinimum: 0.82, repairFinalMinimum: 0.84, exportParityMinimum: 0.82 },
      acceptableWarnings: [
        'manual_review_required',
        'repair_skipped_no_eligible_pages',
        'ai_reconciliation_optional',
        'export_parity_manual_required',
      ],
      unacceptableFailures: [
        'import_failed',
        'finalization_failed',
        'template_not_created',
        'template_page_count_mismatch',
        'source_rasters_missing',
        'visual_quality_artifact_missing',
        'repair_audit_missing',
        'repair_audit_storage_object_missing',
        'apply_repair_failed',
        'export_parity_persistence_failed',
        'generated_template_empty',
        'backend_unknown_operation',
        'sidecar_unavailable',
      ],
      requiredMetadata: [...FULL_REQUIRED_METADATA],
      notes: [
        'Final template page count must match the import page count.',
        'Per-page context gaps are unacceptable unless explicitly documented.',
        'Manual review may be acceptable for individual pages.',
      ],
    },
    {
      corpusId: 'golden-table-001',
      category: 'table_heavy',
      title: 'Table-heavy PDF',
      purpose: 'Validate structured table layout fidelity.',
      pageCountExpectation: { mode: 'minimum', exact: null, minimum: 1, maximum: null },
      expectedOutcomes: {
        importShouldSucceed: true,
        templateShouldBeCreated: true,
        visualQaShouldRun: true,
        repairShouldRunOrSkipSafely: true,
        applyRepairShouldOpenEditor: true,
        exportParityShouldBeRecordable: true,
        templatePageCountShouldMatch: true,
        manualReviewAllowed: true,
        fallbackAllowed: true,
      },
      scoreThresholds: { visualQaMinimum: 0.78, repairFinalMinimum: 0.8, exportParityMinimum: 0.78 },
      acceptableWarnings: [
        'manual_review_required',
        'design_complexity_warning',
        'export_parity_manual_required',
        'fallback_used_with_source_raster_preserved',
      ],
      unacceptableFailures: [
        'import_failed',
        'finalization_failed',
        'template_not_created',
        'template_page_count_mismatch',
        'source_rasters_missing',
        'visual_quality_artifact_missing',
        'apply_repair_failed',
        'export_parity_persistence_failed',
        'generated_template_empty',
        'missing_major_table_content',
        'backend_unknown_operation',
        'sidecar_unavailable',
      ],
      requiredMetadata: [...FULL_REQUIRED_METADATA],
      notes: [
        'Table area should remain visually aligned (rows/columns/borders).',
        'Missing table content or severe table drift is unacceptable.',
      ],
    },
    {
      corpusId: 'golden-image-001',
      category: 'image_heavy',
      title: 'Image-heavy PDF',
      purpose: 'Validate image placement, scale, and crop/fit behavior.',
      pageCountExpectation: { mode: 'minimum', exact: null, minimum: 1, maximum: null },
      expectedOutcomes: {
        importShouldSucceed: true,
        templateShouldBeCreated: true,
        visualQaShouldRun: true,
        repairShouldRunOrSkipSafely: true,
        applyRepairShouldOpenEditor: true,
        exportParityShouldBeRecordable: true,
        templatePageCountShouldMatch: true,
        manualReviewAllowed: true,
        fallbackAllowed: true,
      },
      scoreThresholds: { visualQaMinimum: 0.8, repairFinalMinimum: 0.82, exportParityMinimum: 0.8 },
      acceptableWarnings: [
        'manual_review_required',
        'design_complexity_warning',
        'export_parity_manual_required',
        'fallback_used_with_source_raster_preserved',
      ],
      unacceptableFailures: [
        'import_failed',
        'finalization_failed',
        'template_not_created',
        'template_page_count_mismatch',
        'source_rasters_missing',
        'visual_quality_artifact_missing',
        'apply_repair_failed',
        'export_parity_persistence_failed',
        'generated_template_empty',
        'missing_major_image',
        'backend_unknown_operation',
        'sidecar_unavailable',
      ],
      requiredMetadata: [...FULL_REQUIRED_METADATA],
      notes: [
        'No missing major images; crop/fit drift should be documented.',
        'Export parity against source/editor is important for image placement.',
      ],
    },
    {
      corpusId: 'golden-ocr-001',
      category: 'scanned_ocr',
      title: 'Scanned / OCR PDF',
      purpose: 'Validate safe behavior for scanned/low-confidence OCR documents.',
      pageCountExpectation: { mode: 'unknown', exact: null, minimum: null, maximum: null },
      expectedOutcomes: {
        importShouldSucceed: true,
        templateShouldBeCreated: true,
        visualQaShouldRun: true,
        repairShouldRunOrSkipSafely: true,
        applyRepairShouldOpenEditor: true,
        exportParityShouldBeRecordable: true,
        templatePageCountShouldMatch: false,
        manualReviewAllowed: true,
        fallbackAllowed: true,
      },
      scoreThresholds: { visualQaMinimum: 0.65, repairFinalMinimum: 0.65, exportParityMinimum: 0.75 },
      acceptableWarnings: [
        'manual_review_required',
        'ocr_low_confidence',
        'fallback_used_with_source_raster_preserved',
        'export_parity_manual_required',
      ],
      unacceptableFailures: [
        'import_failed',
        'finalization_failed',
        'template_not_created',
        'source_rasters_missing',
        'visual_quality_artifact_missing',
        'generated_template_empty',
        'backend_unknown_operation',
        'sidecar_unavailable',
      ],
      requiredMetadata: [...FULL_REQUIRED_METADATA],
      notes: [
        'Manual review is expected or acceptable; a lower Visual QA score is acceptable.',
        'The pipeline must fail safely (preserve the source raster) rather than hallucinate clean editable structure.',
      ],
    },
  ],
};

function isFiniteInUnitRange(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** List all corpus items from the given registry (defaults to the built-in registry). */
export function listGoldenCorpusItems(registry?: GoldenCorpusRegistry): GoldenCorpusItem[] {
  const source = registry ?? DEFAULT_GOLDEN_CORPUS_REGISTRY;
  return Array.isArray(source.corpus) ? [...source.corpus] : [];
}

/** Look up a corpus item by id (defaults to the built-in registry). Returns null if absent. */
export function getGoldenCorpusItem(
  corpusId: string,
  registry?: GoldenCorpusRegistry,
): GoldenCorpusItem | null {
  if (!corpusId) return null;
  const source = registry ?? DEFAULT_GOLDEN_CORPUS_REGISTRY;
  return (source.corpus ?? []).find((item) => item.corpusId === corpusId) ?? null;
}

/** Validate a single corpus item in isolation. */
export function validateGoldenCorpusItem(item: GoldenCorpusItem): GoldenCorpusValidationResult {
  const issues: GoldenCorpusValidationIssue[] = [];
  const corpusId = item?.corpusId;
  const err = (code: string, message: string) =>
    issues.push({ corpusId, severity: 'error', code, message });

  if (!item || typeof item !== 'object') {
    return { ok: false, issues: [{ severity: 'error', code: 'item_not_object', message: 'Corpus item is not an object.' }] };
  }

  if (!item.corpusId || typeof item.corpusId !== 'string') err('missing_corpus_id', 'corpusId is required.');
  if (!item.category || !GOLDEN_CORPUS_CATEGORIES.includes(item.category)) {
    err('invalid_category', `category must be one of: ${GOLDEN_CORPUS_CATEGORIES.join(', ')}.`);
  }
  if (!item.title || typeof item.title !== 'string') err('missing_title', 'title is required.');
  if (!item.purpose || typeof item.purpose !== 'string') err('missing_purpose', 'purpose is required.');

  const pce = item.pageCountExpectation;
  if (!pce || typeof pce !== 'object') {
    err('missing_page_count_expectation', 'pageCountExpectation is required.');
  } else if (!GOLDEN_CORPUS_PAGE_COUNT_MODES.includes(pce.mode)) {
    err('invalid_page_count_mode', `pageCountExpectation.mode must be one of: ${GOLDEN_CORPUS_PAGE_COUNT_MODES.join(', ')}.`);
  }

  if (!item.expectedOutcomes || typeof item.expectedOutcomes !== 'object') {
    err('missing_expected_outcomes', 'expectedOutcomes is required.');
  }

  const st = item.scoreThresholds;
  if (!st || typeof st !== 'object') {
    err('missing_score_thresholds', 'scoreThresholds is required.');
  } else {
    for (const key of ['visualQaMinimum', 'repairFinalMinimum', 'exportParityMinimum'] as const) {
      if (!isFiniteInUnitRange(st[key])) {
        err('invalid_threshold', `scoreThresholds.${key} must be a finite number between 0 and 1.`);
      }
    }
  }

  if (!Array.isArray(item.acceptableWarnings)) err('invalid_acceptable_warnings', 'acceptableWarnings must be an array.');
  if (!Array.isArray(item.unacceptableFailures)) err('invalid_unacceptable_failures', 'unacceptableFailures must be an array.');
  if (!Array.isArray(item.requiredMetadata)) err('invalid_required_metadata', 'requiredMetadata must be an array.');
  if (!Array.isArray(item.notes)) err('invalid_notes', 'notes must be an array.');

  return { ok: issues.every((i) => i.severity !== 'error'), issues };
}

/** Validate a full registry: version, corpus completeness/uniqueness, per-item, and mandatory metadata. */
export function validateGoldenCorpusRegistry(
  registry: GoldenCorpusRegistry,
): GoldenCorpusValidationResult {
  const issues: GoldenCorpusValidationIssue[] = [];
  const err = (code: string, message: string, corpusId?: string) =>
    issues.push({ corpusId, severity: 'error', code, message });

  if (!registry || typeof registry !== 'object') {
    return { ok: false, issues: [{ severity: 'error', code: 'registry_not_object', message: 'Registry is not an object.' }] };
  }

  if (registry.version !== GOLDEN_CORPUS_REGISTRY_VERSION) {
    err('invalid_version', `version must equal ${GOLDEN_CORPUS_REGISTRY_VERSION}.`);
  }

  const corpus = registry.corpus;
  if (!Array.isArray(corpus) || corpus.length === 0) {
    err('empty_corpus', 'corpus must be a non-empty array.');
    return { ok: false, issues };
  }

  // Unique corpus IDs.
  const seen = new Set<string>();
  for (const item of corpus) {
    const id = item?.corpusId;
    if (id && seen.has(id)) err('duplicate_corpus_id', `Duplicate corpusId: ${id}.`, id);
    if (id) seen.add(id);
  }

  // All required corpus IDs present.
  for (const requiredId of GOLDEN_CORPUS_REQUIRED_IDS) {
    if (!seen.has(requiredId)) err('missing_required_corpus_id', `Required corpusId is missing: ${requiredId}.`, requiredId);
  }

  // Per-item validation + mandatory metadata subset.
  for (const item of corpus) {
    const itemResult = validateGoldenCorpusItem(item);
    issues.push(...itemResult.issues);

    if (Array.isArray(item?.requiredMetadata)) {
      for (const key of GOLDEN_CORPUS_MANDATORY_METADATA_KEYS) {
        if (!item.requiredMetadata.includes(key)) {
          err('missing_required_metadata_key', `requiredMetadata must include "${key}".`, item.corpusId);
        }
      }
    }
  }

  return { ok: issues.every((i) => i.severity !== 'error'), issues };
}
