# PDF Import Phase 7D — Editor Fidelity Perfection Pass

## Objective

Phase 7D turns the fresh Phase 7C rendering baseline into a targeted fidelity-improvement plan.

The aim is to improve the Template Builder editor render until it visually matches the source PDF as closely as possible.

## Live-Only Testing Rule

Frontend validation must be performed only from the live deployed app running from main.

Do not use Cloud Shell preview, local dev, or test frontend environments because authentication is protected by Cloudflare Turnstile.

## Fidelity Categories

### 1. Page Geometry

Checks:

- Page width and height match source ratio.
- Canvas scale is correct.
- Content is not clipped.
- Page margins are consistent.
- Multi-page layout does not drift.

Common defects:

- Slight page scaling mismatch.
- Top/left offset drift.
- Imported page rendered with correct count but wrong internal bounds.

### 2. Background and Raster Fidelity

Checks:

- Background images align exactly.
- Source raster fallback is not blurred.
- Cropping is correct.
- Opacity and layering are correct.

Common defects:

- Background shifted by a few pixels.
- Raster fallback stretched.
- Low-resolution source background.

### 3. Text Fidelity

Checks:

- Text blocks use close font family.
- Font size matches source.
- Line height matches source.
- Letter spacing is reasonable.
- Text box width/height does not cause wrapping differences.

Common defects:

- Text wraps one line too early.
- Font weight mismatch.
- Baseline drift.
- Minor text offset from source.

### 4. Shape / Vector / Icon Fidelity

Checks:

- Rectangles, chips, badges, lines, dividers, icons, and vector-like elements align.
- Border radius matches source.
- Stroke width matches source.
- Fill colors match source.

Common defects:

- Icons converted to generic blocks.
- Shape stacking order wrong.
- Border radius too sharp/too rounded.

### 5. Table Fidelity

Checks:

- Table columns align.
- Row heights match.
- Borders are visible and correctly weighted.
- Text sits inside the correct cells.

Common defects:

- Column widths drift.
- Header row height mismatch.
- Thin borders missing.

### 6. Layering and Z-Index

Checks:

- Background is behind all overlays.
- Text is not hidden.
- Images do not cover text.
- Decorative shapes do not cover content.

Common defects:

- Fallback raster above editable overlays.
- Blocks rendered in wrong stacking order.

### 7. Export Parity Readiness

Checks:

- Editor preview appears correct.
- Generated/exported PDF should later be compared against both editor and source.

Note:

Phase 7D focuses on editor fidelity. Export parity is handled in Phase 7H.

## Required Evidence Per Defect

For every rendering defect, record:

- Import ID
- Template ID
- Page number
- Defect category
- Severity
- Source observation
- Editor observation
- Suspected cause
- Suggested fix
- Manual decision

## Severity Scale

- P0: Blocks usage or major page failure.
- P1: Clearly visible defect that harms professional quality.
- P2: Minor visible defect but acceptable short term.
- P3: Cosmetic/nice-to-have.

## Phase 7D Pass Conditions

Phase 7D passes when:

- At least one live baseline import is reviewed page-by-page.
- Defects are classified.
- The highest-impact rendering defects are identified.
- A patch plan is selected for 7D.2.
- SQL evidence confirms import/template/diagnostic integrity.
