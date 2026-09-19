# PDF Import Phase 10C — Repair Pattern Library

## Objective

Phase 10C creates a deterministic Repair Pattern Library for the PDF import
system. The library classifies repeated repair issues into known patterns and
produces structured recommendations for deterministic repair, AI reconciliation,
export parity, and operator review.

## Why This Exists

The PDF import pipeline now has Visual QA, deterministic repair, export parity,
golden regression, import intelligence, and diagnostics. But repair issues are
still mostly handled as isolated events. A recurring margin drift, table grid
drift, font scale mismatch, or OCR fragmentation should be classified
consistently. The Repair Pattern Library gives the system a shared vocabulary for
repair behaviour.

## What Phase 10C Does

- Defines canonical repair patterns.
- Extracts repair-related signals from import/profile/QA/repair/export metadata.
- Matches known patterns deterministically.
- Builds a repair pattern analysis.
- Persists analysis into `template_imports.meta.repair_pattern_analysis`.
- Displays analysis in the operator console.
- Adds tests and SQL validation.
- Prepares for Phase 10D adaptive reconciliation and Phase 10E self-healing.

## What Phase 10C Does Not Do

- Does not apply new repairs automatically.
- Does not mutate templates or change repair-runner behaviour.
- Does not call AI.
- Does not create a table or migration, and does not modify the sidecar.
- Does not store raw PDF text or raster data.
- Does not replace Visual QA, repair audit, export parity, or import intelligence.

## Canonical Patterns

| Pattern | Category | Default severity | Recommended action | Manual fallback | AI usefulness | Export parity | Operator review |
|---|---|---|---|---|---|---|---|
| page_margin_drift | geometry | medium | normalize_page_margins | manual_review | low | rerun_required | recommended |
| background_block_shift | geometry | medium | adjust_background_blocks | manual_review | medium | rerun_required | required |
| font_scale_mismatch | typography | medium | normalize_font_scale | manual_review | medium | required | recommended |
| table_grid_drift | table | high | preserve_table_as_raster_or_rebuild_grid | manual_review | high | required | required |
| image_crop_mismatch | image | medium | adjust_image_fit | manual_review | low | required | required |
| layer_order_conflict | layering | high | repair_layer_order | manual_review | medium | required | required |
| ocr_text_fragments | ocr | high | preserve_source_raster | manual_review | manual_review_only | manual_required | required |
| header_footer_alignment | multipage | medium | align_repeated_header_footer | manual_review | low | required | recommended |
| multi_page_spacing_drift | multipage | medium | normalize_vertical_spacing | manual_review | medium | required | recommended |
| missing_major_visual_element | missing_content | critical | restore_missing_visual_element | manual_review | high | manual_required | block_until_review |
| export_renderer_mismatch | export | high | inspect_export_renderer | manual_review | low | rerun_required | required |
| manual_review_only | manual_review | critical | block_automation | manual_review | manual_review_only | manual_required | block_until_review |

Each pattern's common signals, symptoms, and risk notes are captured in
`repairPatternLibrary.ts`.

## Analysis Output

Persisted to `template_imports.meta.repair_pattern_analysis`:

- version
- importId / templateId / sourceFilename
- profileCategory / importRiskLevel
- matchedPatterns (patternId, category, severity, confidence, score, matched,
  evidence, recommendedAction, manualFallback, aiReconciliationUsefulness,
  exportParityRequirement, operatorReviewRequirement, message)
- primaryPatternId
- overallSeverity / overallConfidence
- deterministicRepairStrategy
- aiReconciliationUsefulness
- exportParityRequirement
- operatorReviewRequirement
- evidence / warnings / blockers
- generatedAt

## Matching & Resolution

Each pattern is scored 0..1 from the signals; `matched = score >= 0.55`.
Confidence reflects the score and evidence count. The primary pattern is the
highest-score match (severity as tie-breaker). Overall strategy resolution:

- **Deterministic repair strategy** — `blocked` for manual_review_only /
  missing_major_visual_element; `manual_only` for ocr_text_fragments;
  `constrained` for high table/image/layer patterns; `safe_with_review` for
  medium/high; `safe` for low/info; `unknown` when nothing matches.
- **AI reconciliation usefulness** — `manual_review_only` for OCR/manual-review;
  `high` for table_grid_drift / missing_major_visual_element; `medium` for other
  high/medium patterns; `low` otherwise.
- **Export parity requirement** — `manual_required` for OCR/manual/missing;
  `rerun_required` for geometry/export/image/table/layer categories; `required`
  for medium/high; `recommended` otherwise.
- **Operator review** — `block_until_review` for critical patterns; `required`
  for high; `recommended` for medium; `not_required` otherwise.

## Future Phase Usage

- **Phase 10D** — Adaptive reconciliation uses matched patterns to decide whether
  AI reconciliation is useful or unsafe.
- **Phase 10E** — Self-healing uses matched patterns to decide whether to retry
  repair, rerun Visual QA, rerun export parity, or block automation.
- **Phase 10F** — Performance/cost optimisation uses the analysis to skip
  unnecessary expensive steps.
- **Phase 10G** — Operator controls use the analysis to surface recommended
  actions.

## Safety Rules

- Pattern analysis is advisory; it never applies repairs or alters templates.
- It never calls AI.
- It degrades to `unknown` / low confidence when evidence is insufficient.
- It never stores private extracted content, raw PDF text, or raster data.

## Acceptance Criteria

- pattern library, signal extraction, matcher, analysis builder, persistence, and
  display helpers exist
- orchestrator can optionally build/persist analysis
- operator console displays analysis
- tests pass, SQL exists, build passes
- no private artifacts committed
