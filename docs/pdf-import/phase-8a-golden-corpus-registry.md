# PDF Import Phase 8A — Golden Corpus Registry

## Objective

Phase 8A defines the canonical Golden Corpus Registry for PDF import regression testing.

The registry describes the fixed set of PDF categories used to test the import pipeline
repeatedly across future code changes.

## Why This Exists

Phase 7 proved the PDF import quality stack works end to end.

Phase 8 needs repeatable regression confidence.

The Golden Corpus Registry provides the stable test set that later phases will use for:

- golden run execution
- quality threshold gates
- regression result persistence
- diagnostics display
- production rollout confidence

## What Phase 8A Does

- Defines golden corpus categories.
- Defines expected outcomes per corpus item.
- Defines acceptable warnings.
- Defines unacceptable failures.
- Defines score expectations.
- Defines required metadata.
- Provides schema and template files.
- Provides SQL to inspect existing imports against corpus metadata.

## What Phase 8A Does Not Do

- Does not upload PDFs.
- Does not commit PDFs.
- Does not automate browser uploads.
- Does not run golden corpus tests.
- Does not implement pass/fail gates.
- Does not persist golden run summaries.
- Does not modify the sidecar.

## Canonical Corpus Items

### golden-simple-001

- **Category:** `simple_one_page`
- **Purpose:** Validate the most basic import path end to end.
- **Validates:** import completion, template creation, page-count consistency, source
  raster availability, Visual QA can run, repair can run or safely skip, Apply Repair
  opens the editor, export parity can be recorded.
- **Expected outcomes:** 1 page; no manual review expected; no fallback expected; high
  Visual QA score; export parity completed or manually recorded; template page count
  matches import.
- **Acceptable warnings:** `repair_skipped_no_eligible_pages`, `ai_reconciliation_optional`,
  `export_parity_manual_required`.
- **Unacceptable failures:** `import_failed`, `finalization_failed`, `template_not_created`,
  `template_page_count_mismatch`, `source_rasters_missing`, `visual_quality_artifact_missing`,
  `repair_audit_missing`, `repair_audit_storage_object_missing`, `apply_repair_failed`,
  `export_parity_persistence_failed`, `generated_template_empty`, `backend_unknown_operation`,
  `sidecar_unavailable`.
- **Recommended minimum scores:** visualQaMinimum 0.90, repairFinalMinimum 0.90,
  exportParityMinimum 0.90.

### golden-design-001

- **Category:** `design_heavy_one_page`
- **Purpose:** Validate a visually dense, branded/design-heavy single page.
- **Validates:** source raster alignment, editable overlay alignment, fonts, images,
  background blocks, layer ordering, spacing, AI reconciliation recommendation behavior,
  export parity against source/editor.
- **Expected outcomes:** 1 page; manual review may be acceptable; fallback acceptable only
  if documented; Visual QA may score below the simple PDF but must stay above minimum;
  repair/reconciliation may be recommended.
- **Acceptable warnings:** `manual_review_required`, `ai_reconciliation_optional`,
  `export_parity_manual_required`, `fallback_used_with_source_raster_preserved`,
  `design_complexity_warning`.
- **Unacceptable failures:** import/finalization/template creation failures,
  `template_page_count_mismatch`, `source_rasters_missing`, `visual_quality_artifact_missing`,
  `apply_repair_failed`, `export_parity_persistence_failed`, `generated_template_empty`,
  `missing_major_image`, `backend_unknown_operation`, `sidecar_unavailable`.
- **Recommended minimum scores:** visualQaMinimum 0.80, repairFinalMinimum 0.82,
  exportParityMinimum 0.80.

### golden-report-001

- **Category:** `multi_page_report`
- **Purpose:** Validate multi-page import consistency and per-page fidelity.
- **Validates:** multi-page artifact staging, page-count alignment, per-page rasters,
  per-page Visual QA, repair audit across multiple pages, editor navigation/scrolling,
  export parity across more than one page.
- **Expected outcomes:** page count must match source; final template page count must match
  import page count; page context gaps unacceptable unless documented; manual review may be
  acceptable for individual pages.
- **Acceptable warnings:** `manual_review_required`, `repair_skipped_no_eligible_pages`,
  `ai_reconciliation_optional`, `export_parity_manual_required`.
- **Unacceptable failures:** import/finalization/template creation failures,
  `template_page_count_mismatch`, `source_rasters_missing`, `visual_quality_artifact_missing`,
  repair audit missing/storage-object missing, `apply_repair_failed`,
  `export_parity_persistence_failed`, `generated_template_empty`, `backend_unknown_operation`,
  `sidecar_unavailable`.
- **Recommended minimum scores:** visualQaMinimum 0.82, repairFinalMinimum 0.84,
  exportParityMinimum 0.82.

### golden-table-001

- **Category:** `table_heavy`
- **Purpose:** Validate structured table layout fidelity.
- **Validates:** table placement, row/column layout, text fit, grid/border fidelity, line
  height, numeric/text alignment, repair behavior around structured layout.
- **Expected outcomes:** table area should remain visually aligned; manual review may be
  acceptable; missing table content unacceptable; severe table drift unacceptable.
- **Acceptable warnings:** `manual_review_required`, `design_complexity_warning`,
  `export_parity_manual_required`, `fallback_used_with_source_raster_preserved`.
- **Unacceptable failures:** import/finalization/template creation failures,
  `template_page_count_mismatch`, `source_rasters_missing`, `visual_quality_artifact_missing`,
  `apply_repair_failed`, `export_parity_persistence_failed`, `generated_template_empty`,
  `missing_major_table_content`, `backend_unknown_operation`, `sidecar_unavailable`.
- **Recommended minimum scores:** visualQaMinimum 0.78, repairFinalMinimum 0.80,
  exportParityMinimum 0.78.

### golden-image-001

- **Category:** `image_heavy`
- **Purpose:** Validate image placement, scale, and crop/fit behavior.
- **Validates:** image placement, image scale, crop behavior, aspect ratio, source raster
  fallback, background/overlay relationship.
- **Expected outcomes:** no missing major images; crop/fit drift should be documented;
  manual review may be acceptable; export parity is important.
- **Acceptable warnings:** `manual_review_required`, `design_complexity_warning`,
  `export_parity_manual_required`, `fallback_used_with_source_raster_preserved`.
- **Unacceptable failures:** import/finalization/template creation failures,
  `template_page_count_mismatch`, `source_rasters_missing`, `visual_quality_artifact_missing`,
  `apply_repair_failed`, `export_parity_persistence_failed`, `generated_template_empty`,
  `missing_major_image`, `backend_unknown_operation`, `sidecar_unavailable`.
- **Recommended minimum scores:** visualQaMinimum 0.80, repairFinalMinimum 0.82,
  exportParityMinimum 0.80.

### golden-ocr-001

- **Category:** `scanned_ocr`
- **Purpose:** Validate safe behavior for scanned/low-confidence OCR documents.
- **Validates:** OCR mode / OCR fallback, manual-review safety, source raster preservation,
  non-over-repair behavior, clear diagnostics for low-confidence extraction.
- **Expected outcomes:** manual review expected or acceptable; lower Visual QA score
  acceptable; fallback acceptable; missing source raster unacceptable; the pipeline must
  fail safely rather than hallucinate clean editable structure.
- **Acceptable warnings:** `manual_review_required`, `ocr_low_confidence`,
  `fallback_used_with_source_raster_preserved`, `export_parity_manual_required`.
- **Unacceptable failures:** `import_failed`, `finalization_failed`, `template_not_created`,
  `source_rasters_missing`, `visual_quality_artifact_missing`, `generated_template_empty`,
  `backend_unknown_operation`, `sidecar_unavailable`.
- **Recommended minimum scores:** visualQaMinimum 0.65, repairFinalMinimum 0.65,
  exportParityMinimum 0.75.

## Recommended Minimum Scores

| Category | visualQaMinimum | repairFinalMinimum | exportParityMinimum |
|---|---|---|---|
| `simple_one_page` | 0.90 | 0.90 | 0.90 |
| `design_heavy_one_page` | 0.80 | 0.82 | 0.80 |
| `multi_page_report` | 0.82 | 0.84 | 0.82 |
| `table_heavy` | 0.78 | 0.80 | 0.78 |
| `image_heavy` | 0.80 | 0.82 | 0.80 |
| `scanned_ocr` | 0.65 | 0.65 | 0.75 |

These thresholds are **registry defaults**. Phase 8C will formalize them into quality gates.

## Acceptable Warning Types

- `manual_review_required`
- `repair_skipped_no_eligible_pages`
- `ai_reconciliation_optional`
- `export_parity_manual_required`
- `ocr_low_confidence`
- `fallback_used_with_source_raster_preserved`
- `design_complexity_warning`

## Unacceptable Failure Types

- `import_failed`
- `finalization_failed`
- `template_not_created`
- `template_page_count_mismatch`
- `source_rasters_missing`
- `visual_quality_artifact_missing`
- `repair_audit_missing`
- `repair_audit_storage_object_missing`
- `apply_repair_failed`
- `export_parity_persistence_failed`
- `generated_template_empty`
- `missing_major_image`
- `missing_major_table_content`
- `backend_unknown_operation`
- `sidecar_unavailable`

## Required Metadata Per Corpus Run

- `runId`
- `corpusId`
- `category`
- `sourceFilename`
- `importId`
- `templateId`
- `engineVersion`
- `importPageCount`
- `templatePageCount`
- `visualQaScore`
- `visualQaManualReviewRequired`
- `repairStatus`
- `repairFinalScore`
- `repairScoreDelta`
- `aiReconciliationStatus`
- `aiReconciliationRecommendation`
- `exportParityStatus`
- `exportParityMode`
- `exportVsSourceScore`
- `editorVsSourceScore`
- `exportVsEditorScore`
- `warnings`
- `failures`
- `operatorDecision`
- `createdAt`

The registry validator enforces a mandatory subset of these on every corpus item:
`corpusId`, `importId`, `templateId`, `visualQaScore`, `repairStatus`, `exportParityStatus`.

## Privacy Rules

- Do not commit source PDFs.
- Do not commit client PDFs.
- Do not commit screenshots unless sanitized.
- Do not commit generated PDFs.
- Use `audit-output/` for local-only test artifacts.
- Commit only registry templates, schema, docs, source code, tests, and SQL.

## How Phase 8A Feeds Later Phases

- **Phase 8B** will use the registry to run golden corpus checks.
- **Phase 8C** will convert expectations into quality gates.
- **Phase 8D** will persist golden run results.
- **Phase 8E** will show golden status in diagnostics.
- **Phase 8G** will lock Phase 8.

## Files

- `docs/pdf-import/golden-corpus-registry.schema.json` — JSON Schema (draft-07).
- `docs/pdf-import/golden-corpus-registry.template.json` — committed registry template
  (mirrors the TypeScript default registry).
- `docs/pdf-import/golden-corpus-selection-guide.md` — operator guidance for choosing safe PDFs.
- `src/lib/reportTemplate/ingestion/goldenCorpus/` — TypeScript types, default registry, and
  validation helpers (`DEFAULT_GOLDEN_CORPUS_REGISTRY`, `getGoldenCorpusItem`,
  `listGoldenCorpusItems`, `validateGoldenCorpusItem`, `validateGoldenCorpusRegistry`).
- `scripts/regression/pdf-import-phase-8a-golden-corpus-registry-check.sql` — read-only
  corpus-readiness inspection.

## Phase 8A Acceptance Criteria

- registry doc exists
- schema exists
- template exists
- TypeScript registry types exist
- default registry exists
- registry tests pass
- SQL check exists
- `npm run build` passes
