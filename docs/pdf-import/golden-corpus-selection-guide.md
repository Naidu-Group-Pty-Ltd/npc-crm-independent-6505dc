# Golden Corpus Selection Guide

Operator guidance for choosing safe PDFs for each golden corpus category. Only registry
**metadata** is committed to git — the PDFs themselves are never committed.

## Rules

- Use non-client or sanitized PDFs where possible.
- Do not commit the PDFs to the repo.
- Store private PDFs outside git (e.g. `audit-output/` which is git-ignored, or a location
  outside the working tree).
- Record only metadata in the registry.
- Use stable PDFs that will not change between runs (so scores are comparable over time).

## Selection Criteria

- **`golden-simple-001` (simple_one_page):** a clean, single-page PDF with plain text and
  minimal styling — an invoice-style or one-column letter. This is the baseline sanity check.
- **`golden-design-001` (design_heavy_one_page):** a branded, visually dense single page —
  a cover page or marketing one-pager with background blocks, multiple fonts, and images.
- **`golden-report-001` (multi_page_report):** a multi-page document (≥2 pages) with
  consistent structure — a report or brochure that exercises per-page staging and navigation.
- **`golden-table-001` (table_heavy):** a page dominated by one or more tables with visible
  grid/borders, numeric columns, and tight row spacing.
- **`golden-image-001` (image_heavy):** a page dominated by photos/graphics that exercises
  placement, scale, crop/fit, and aspect ratio.
- **`golden-ocr-001` (scanned_ocr):** a scanned/photographed document with no embedded text
  layer, used to verify safe OCR/fallback behavior and source-raster preservation.

## What Not To Use

- confidential client financial details
- personally identifiable information
- lender documents with private data
- documents that cannot be safely used for repeated testing
- PDFs with licensing restrictions

## Naming Recommendation

Use local filenames like:

- `golden-simple-001.pdf`
- `golden-design-001.pdf`
- `golden-report-001.pdf`
- `golden-table-001.pdf`
- `golden-image-001.pdf`
- `golden-ocr-001.pdf`

But **do not commit these PDFs**. The filename is recorded per run as metadata
(`sourceFilename`), not stored in the repository.
