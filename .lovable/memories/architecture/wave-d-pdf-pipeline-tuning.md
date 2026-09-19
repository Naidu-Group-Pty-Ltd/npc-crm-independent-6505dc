---
name: Wave D PDF Pipeline Tuning
description: Docling default flip + extraction-quality summary persisted on every pdf_import_jobs row. Legacy pdf.js engine marked deprecated in UI.
type: feature
---

# Wave D — PDF Retirement & Docling Tuning

- `feature_flags.pdf_import.engine` now has `default=docling` AND `superadmin=docling`. Legacy pdf.js is reachable only via the per-user override (`localStorage.lovable.pdf_import.engine=legacy` or `?pdfEngine=legacy`) or the allowlist. The Template Builder engine selector labels it "Legacy (pdf.js) · deprecated".
- `pdf-parse-service` returns a top-level `summary` block from `/parse` (engine version `docling-2.14.0+phaseD+waveD`):
  - `text_chars`, `ocr_chars`, `ocr_pages[]`
  - `avg_text_confidence` (0–1, null when Docling didn't expose confidences)
  - `table_count`, `table_cell_count`
  - `picture_count`
  - `text_block_count`
- `pdf-parse-dispatch` persists that block at `pdf_import_jobs.result_payload.summary` so the diagnostics dashboard and future SSIM rollups can read it without re-fetching the diagnostics bundle.
- No DB migration was required. Numeric `ssim_score` column already exists for future fidelity scoring work.
- Memory `mem://architecture/pdf-import-pipeline` still applies: do NOT delete the legacy pdf.js extractor — keep it in code for the 30-day rollback window after this default flip.
