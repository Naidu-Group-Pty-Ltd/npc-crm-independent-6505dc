# PDF Import Quality Gate Thresholds Reference

Human-readable reference for the golden corpus registry defaults used by the Phase 8C quality
gates. **The canonical source of truth is the Golden Corpus Registry**
(`src/lib/reportTemplate/ingestion/goldenCorpus/goldenCorpusRegistry.ts` /
`docs/pdf-import/golden-corpus-registry.template.json`). This file is a convenience reference
only — if it ever disagrees with the registry, the registry wins.

| Corpus ID | Category | visualQaMinimum | repairFinalMinimum | exportParityMinimum | manualReviewAllowed | fallbackAllowed |
|---|---|---|---|---|---|---|
| golden-simple-001 | simple_one_page | 0.90 | 0.90 | 0.90 | no | no |
| golden-design-001 | design_heavy_one_page | 0.80 | 0.82 | 0.80 | yes | yes |
| golden-report-001 | multi_page_report | 0.82 | 0.84 | 0.82 | yes | no |
| golden-table-001 | table_heavy | 0.78 | 0.80 | 0.78 | yes | no |
| golden-image-001 | image_heavy | 0.80 | 0.82 | 0.80 | yes | yes |
| golden-ocr-001 | scanned_ocr | 0.65 | 0.65 | 0.75 | yes | yes |

## How the gates use these values

- **visualQaMinimum** — `visual_quality_score_threshold` gate: score `>=` minimum → pass; below → **fail** (Phase 8C tightening; Phase 8B treated this as a warning).
- **repairFinalMinimum** — `repair_final_score_threshold` gate: enforced only when repair was not skipped; below → **fail**.
- **exportParityMinimum** — `export_parity_score_threshold` gate: uses the first available of exportVsSource / editorVsSource / exportVsEditor; below → **fail**.
- **manualReviewAllowed** — `manual_review_policy` gate: required manual review → warning when allowed, **fail** when not.
- **fallbackAllowed** — `fallback_policy` gate: required fallback → warning when allowed, **fail** when not.

The same thresholds are mirrored in the `registry` CTE of
`scripts/regression/pdf-import-phase-8c-quality-gates-check.sql` so operators can run gate
checks directly in the Supabase SQL Editor. Keep the SQL `registry` CTE in sync with the
TypeScript registry if thresholds ever change.
