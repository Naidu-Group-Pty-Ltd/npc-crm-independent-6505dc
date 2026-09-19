# PDF Import Phase 7B — Golden Corpus

## Objective

Phase 7B creates a repeatable golden PDF corpus for validating the real browser import flow:

PDF Import → Visual QA → Repair → Apply Repair → Template Editor

The golden corpus is used to compare future changes against known-good baseline outcomes.

## Corpus Categories

### 1. Simple One-Page PDF

Purpose:

- Validate basic import stability.
- Validate source raster loading.
- Validate generated render capture.
- Validate Visual QA and repair audit persistence.

Expected result:

- Import succeeds.
- Page count matches 1.
- Visual QA runs.
- Repair completes or safely skips.
- Apply repair opens editor.
- Template version increments.

### 2. Design-Heavy One-Page PDF

Purpose:

- Validate layout fidelity for branded pages, background shapes, positioned text, icons, and complex spacing.

Expected result:

- Import succeeds.
- Visual QA identifies meaningful layout/pixel drift if present.
- Repair either improves score or safely records no-op/skipped repair.
- Manual review flag is acceptable if the page is highly visual.

### 3. Multi-Page Report PDF

Purpose:

- Validate multi-page artifact handling.
- Validate source/generated/diff artifact consistency across pages.
- Validate repair audit persistence for larger imports.

Expected result:

- Imported page count matches PDF page count.
- Visual QA page count matches imported page count.
- Repair audit persists.
- Apply repair opens editor.
- Template page count matches imported page count.

### 4. Scanned/OCR PDF

Purpose:

- Validate fallback, OCR, and manual-review behavior.
- Confirm the system does not over-repair unsafe pages.

Expected result:

- Import succeeds or fails gracefully.
- If generated template quality is low, manual review or fallback is acceptable.
- Repair should be skipped, blocked, or routed safely if source/generated evidence is insufficient.

## Golden Corpus Rules

Do not commit private, client, or licensed PDFs into the repository.

Use one of these options:

1. Store test PDFs locally under:

   audit-output/phase7/golden-corpus/

2. Use sanitized PDFs generated specifically for regression testing.

3. Store private PDFs in Supabase/manual test storage and record only metadata in this repo.

## Required Metadata Per Golden PDF

Each PDF should have:

- Corpus ID
- File name
- Category
- Page count
- Import ID
- Template ID
- Visual QA score
- Repair status
- Final repair score
- Score delta
- Total patches applied
- Patches accepted
- Patches rejected
- Requires fallback
- Requires manual review
- Repair audit path
- Apply repair result
- Human visual decision:
  - pass
  - pass_with_warnings
  - fail

## Pass/Fail Standard

A golden PDF passes when:

- Import completes.
- Visual QA can run.
- Repair audit is persisted.
- Apply repair opens the editor.
- Template page count matches the source PDF page count.
- Template version increments after apply.
- Any fallback/manual-review flags are explainable and safe.

A golden PDF fails when:

- Import crashes.
- Visual QA cannot run despite valid source artifacts.
- Repair crashes the UI.
- Apply repair does not update/open the template.
- Repair metadata is missing after the UI reports success.
- Template page count does not match the source PDF page count.

## Phase 7B Output

Phase 7B is complete when:

- Golden corpus manifest template exists.
- Golden corpus SQL validation exists.
- At least one real PDF has been tested and recorded.
- The process is ready to repeat for additional PDFs.
