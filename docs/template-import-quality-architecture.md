# Template Builder Ingestion Fidelity Architecture Plan

## 1. Problem Statement

The current template builder has multiple ingestion paths, but the resulting templates are not consistently faithful enough to the source material. The product goal is stricter than “make it look close”: every supported source format must produce an editable template whose visual output mirrors the input document as closely as possible without degenerating into a flattened screenshot. Static raster backdrops may be used as temporary trace/reference layers, but they must not be the primary deliverable when the source contains recoverable text, vector shapes, tables, images, components, or layout structure.

The architecture below is designed to build on the existing implementation without breaking current PDF, image, URL, Figma, raw HTML/JSX, and zip-project flows. It introduces a measurable fidelity contract, a normalized intermediate representation, source-specific extractors, iterative validation, and editor-safe reconciliation.

## 2. Current System Baseline

### 2.1 Existing capabilities to preserve

- PDF import and re-sync already support semantic, pixel, and hybrid modes through `extractPdfToTemplate` and the `template-import-pdf` edge function.
- Image references already support faithful reconstruction through OCR-grounded `screenshot_to_block` mode.
- Link imports already normalize and fetch remote sources, including Google/Dropbox/OneDrive/Figma-style entry points.
- Raw-code ingestion already accepts URL, HTML, JSX, and zip archives, renders them through `render-source`, grounds the DOM boxes, and reuses the screenshot reconstruction path.
- Template edits are applied as native `ReportTemplate` schema changes, which means existing editor, history, autosave, and preview functionality remains the source of truth.

### 2.2 Current failure modes

1. **No unified quality target.** Each source path has different quality heuristics and success messages, but no single fidelity score, minimum acceptance threshold, or re-run loop.
2. **PDFs lose structure.** Text, images, and vectors are partially extracted, but complex grouping, tables, clipping, masks, transparency, font substitution, and multi-column reading order can drift.
3. **Image imports over-rely on OCR and AI inference.** OCR provides text grounding, but non-text primitives, tables, chart-like shapes, icons, and dense layouts need deterministic geometry extraction before asking an AI model to classify blocks.
4. **Raw code is under-productized.** A pasted single component is useful, but production designs often arrive as project folders with routes, assets, CSS frameworks, and build steps. Zip ingestion exists, but needs a first-class project workflow, manifest, route/page selection, build diagnostics, and multi-page output.
5. **Static raster safety net can become a crutch.** Hybrid backdrops are useful during import review, but the final editable result must maximize native blocks and make any remaining raster dependency explicit and remediable.
6. **No golden regression corpus.** We cannot tell whether new extraction work improves or degrades fidelity across PDFs, screenshots, Figma frames, URLs, and project zips.

## 3. Architecture Goals

1. **Editable-first fidelity.** Prefer native editable text, vectors, tables, images, charts, and layout containers; use raster only for trace, unextractable visual effects, or quarantined fallback regions.
2. **Format-neutral pipeline.** All sources should converge into the same intermediate representation before becoming a `ReportTemplate`.
3. **Deterministic extraction before AI.** Use parsers, DOM measurements, OCR, vector tracing, and computed styles to ground every element. AI should classify, group, repair, and map bindings; it should not hallucinate layout.
4. **Measurable quality gate.** Every import should produce a fidelity report with visual similarity, text accuracy, layout drift, native-editability coverage, and fallback-raster coverage.
5. **Non-breaking rollout.** Keep current modes and APIs operational while adding a new high-fidelity pipeline behind flags and progressive UI entry points.
6. **Multi-page and multi-route support.** A zip project or multi-page PDF should produce multiple editable pages, not require manual copy/paste of each page.
7. **Human-in-the-loop repair.** Designers should see the original reference, editable reconstruction, diffs, warnings, and one-click fixes before committing changes.

## 4. Proposed Target Architecture

```text
Source intake
  PDF | image | URL | Figma | HTML/CSS | JSX/TSX | zip project
      ↓
Source normalizer
  file validation, malware/size guard, page/route discovery, asset inventory
      ↓
Source-specific extractors
  PDF operator/text/image/vector extractor
  OCR + computer-vision extractor
  Headless DOM renderer + computed-style extractor
  Figma node extractor
      ↓
Canonical Design IR (CDIR)
  pages, frames, layers, text runs, vector paths, images, tables, constraints, styles, assets
      ↓
Block classifier + grouping
  deterministic rules first, AI only with grounded measurements
      ↓
Template mapper
  CDIR → ReportTemplate native blocks + bindings + design tokens
      ↓
Fidelity validator
  render reconstructed template, compare to source, score and detect drift
      ↓
Repair loop
  automatic local fixes, AI-assisted fixes, or designer review
      ↓
Commit to editor schema
  version snapshot, audit metadata, editable blocks, trace layers optional
```

## 5. Canonical Design IR (CDIR)

Introduce a new internal representation under `src/lib/reportTemplate/ingestion/cdir/`.

### 5.1 CDIR page model

Each ingested source becomes a `CdirDocument`:

```ts
interface CdirDocument {
  source: {
    kind: 'pdf' | 'image' | 'url' | 'figma' | 'html' | 'jsx' | 'zip';
    filename?: string;
    checksum: string;
    originalWidth?: number;
    originalHeight?: number;
  };
  pages: CdirPage[];
  assets: CdirAsset[];
  fonts: CdirFont[];
  warnings: CdirWarning[];
}

interface CdirPage {
  id: string;
  label: string;
  width: number;
  height: number;
  background?: CdirPaint;
  layers: CdirLayer[];
  traceRasterAssetId?: string;
}
```

### 5.2 CDIR layer primitives

Use granular, editable primitives:

- `textRun`: exact text, coordinates, font metrics, color, line-height, letter spacing, text transform, writing mode.
- `shape`: rectangles, rounded rectangles, ellipses, polygons, paths, borders, shadows, opacity, blend mode.
- `image`: cropped image regions, intrinsic dimensions, object-fit behavior, masks.
- `table`: grid geometry, rows, columns, merged cells, header/body detection, text children.
- `group`: semantic grouping with bounding box, z-index, constraints, and children.
- `componentHint`: card, header, footer, hero, KPI, chart, gallery, CTA, sidebar, page number, etc.

### 5.3 Why CDIR matters

CDIR lets all import paths share the same mapper, validator, repair loop, and tests. Instead of each source path directly producing a `ReportTemplate`, each extractor produces CDIR with provenance and confidence per element. The mapper can then decide whether an element should become native text, a vector block, an image block, a table block, or a grouped component.

## 6. Source-Specific Extraction Upgrades

### 6.1 PDF extraction

Build a high-fidelity PDF extractor that preserves current `extractPdfToTemplate` behavior but adds a CDIR path.

#### Required improvements

1. **Page raster for reference only.** Render each page at 2x or 3x scale for diffing and trace overlay, not as the final output.
2. **Text extraction with font fidelity.** Capture font family, embedded font names, font weight/style, fill color, baseline, rotation, glyph positions, ligatures, and line grouping.
3. **Vector extraction.** Convert PDF path operators into native vector shapes where possible: rectangles, rounded rectangles, lines, fills, strokes, and simple SVG paths.
4. **Image extraction.** Extract placed images with crop/mask metadata and avoid re-rasterizing the full page when individual images are recoverable.
5. **Table and layout detection.** Infer tables from aligned text runs and line geometry, then map to editable table blocks.
6. **Scanned PDF fallback.** Detect image-only pages and route them through OCR/CV extraction, not semantic PDF extraction.
7. **Hybrid review layer.** Keep the hybrid raster backdrop as an import review aid with a “remove trace when fidelity passes” option.

#### PDF quality acceptance

- Text accuracy: ≥ 99% character match for extractable text.
- Median text-box position drift: ≤ 2 pt.
- Native coverage: ≥ 90% of visible area represented by editable/native elements for digital PDFs.
- Raster fallback: flagged when more than 10% of visible area remains fallback-only.

### 6.2 Image and screenshot extraction

Images do not expose DOM/PDF structure, so the pipeline must combine CV, OCR, and grounded AI.

#### Required improvements

1. **OCR word and line grounding.** Keep current OCR grounding, but add paragraph/heading grouping and confidence thresholds.
2. **Computer-vision geometry.** Detect rectangles, lines, separators, cards, background panels, logos, icons, and table grids using OpenCV-style algorithms or server-side image analysis.
3. **Palette extraction.** Generate a page palette and assign colors to text/shape candidates.
4. **Layout clustering.** Group detected primitives into sections/cards before AI classification.
5. **AI classification with hard constraints.** The model receives measured boxes and may only classify/group/repair; it cannot invent copy or move elements outside tolerances unless explicitly requested.
6. **Unsupported effects quarantine.** Complex shadows, masks, or gradients become localized raster sub-assets with explicit warnings and editable bounding boxes.

### 6.3 Raw code, URL, and zip-project extraction

Raw code should no longer feel like a copy/paste-only toy. Treat it as a project import workflow.

#### Zip/project workflow

1. **Upload project zip.** Accept `.zip` containing static HTML/CSS, React/Vite/Next-style apps, asset folders, and lockfiles.
2. **Server-side safe unpack.** Validate zip size, file count, file paths, MIME types, symlinks, and executable scripts. Reject zip bombs and path traversal.
3. **Project detector.** Identify static site, Vite, Next, React component library, Storybook, or plain HTML.
4. **Install/build sandbox.** Run deterministic package install/build in an isolated container with timeout, CPU/memory limits, no secrets, and network policy.
5. **Route/page discovery.** Generate a page manifest from routes, files, or Storybook stories. Let the user select one route, many routes, or all routes.
6. **Viewport presets.** Render desktop/tablet/mobile or A4/Letter report widths, depending on output target.
7. **DOM-plus-style extraction.** Capture computed styles, fonts, layout boxes, pseudo-elements, background images, SVGs, canvas screenshots, and assets.
8. **Multi-page mapping.** Convert each selected route or frame into an editable template page, preserving order and labels.
9. **Build diagnostics UI.** Surface build logs, missing assets, unsupported APIs, route failures, and fallback screenshots.

#### Code quality acceptance

- DOM text accuracy: 100% for rendered text nodes.
- Median DOM box drift after template render: ≤ 2 px scaled to page points.
- Image asset preservation: no unnecessary recompression where source assets are available.
- Multi-route import: no manual paste requirement for project-level designs.

### 6.4 Figma extraction

When Figma node data is available, prefer hierarchy extraction over screenshot interpretation.

1. Map Figma frames to CDIR pages.
2. Preserve auto-layout constraints, fills, strokes, effects, typography, and components where possible.
3. Convert Figma text nodes directly to native text blocks.
4. Use screenshot diff only for validation and unsupported effect fallback.

## 7. Fidelity Validator and Repair Loop

### 7.1 Metrics

Every import produces a `FidelityReport`:

```ts
interface FidelityReport {
  overallScore: number;
  visualSimilarity: number;
  textAccuracy: number;
  medianPositionDrift: number;
  p95PositionDrift: number;
  nativeCoverage: number;
  rasterFallbackCoverage: number;
  fontSubstitutions: string[];
  warnings: FidelityWarning[];
}
```

### 7.2 Visual diff implementation

1. Render the source reference to a canonical raster.
2. Render the reconstructed template through the same preview/export renderer.
3. Align dimensions and compare using SSIM/perceptual diff plus bounding-box drift.
4. Store per-page diff heatmaps for the review dialog.
5. Fail or warn based on source kind and selected fidelity mode.

### 7.3 Automated repair passes

Run bounded repair passes before finalizing:

1. **Text repair:** fix copy mismatches, line breaks, font weights, and color drift.
2. **Geometry repair:** snap boxes to measured positions, align repeated grids, correct z-index.
3. **Shape repair:** convert raster-detected panels to editable shapes.
4. **Asset repair:** replace raster crops with source images when available.
5. **Fallback minimization:** localize any remaining raster regions instead of using a full-page screenshot.

Stop after a configurable maximum number of passes to avoid infinite loops. If scores are still below threshold, import as draft with explicit warnings rather than silently claiming success.

## 8. Editor Integration

### 8.1 Import Review Mode

Add an import review step before applying changes:

- Split view: source reference, editable reconstruction, and diff heatmap.
- Layer list: native text, vectors, images, tables, fallback rasters.
- Quality score and warnings.
- Buttons: “Accept”, “Accept with trace layer”, “Auto-fix”, “Edit manually”, “Retry with higher fidelity”.

### 8.2 Trace layers

Trace layers are allowed only as non-exporting or explicitly marked fallback layers:

- Default: trace hidden from final export once fidelity passes.
- If fallback is required, it is localized to specific areas, not the entire page.
- Inspector shows “fallback raster” badge and suggested conversion action.

### 8.3 Versioning and auditability

When an import updates an existing template:

- Snapshot the pre-import schema.
- Store source checksum, import mode, source kind, selected pages/routes, fidelity score, and warnings in import metadata.
- Add an audit-log event linking the import record, generated version, and review decision.

## 9. Edge Function and Backend Plan

### 9.1 New services

1. `template-ingest-orchestrator`
   - Owns import jobs, queueing, source metadata, and status transitions.
   - Calls extractors and persists CDIR artifacts.

2. `render-source-v2`
   - Supersedes the current raw-code renderer without breaking the existing `render-source` contract.
   - Adds project manifest discovery, route selection, build logs, and multi-page output.

3. `fidelity-validator`
   - Renders reconstructed template and compares against reference rasters.
   - Writes `FidelityReport` records and diff assets.

4. `asset-normalizer`
   - Deduplicates images, fonts, SVGs, and trace rasters.
   - Produces stable storage paths by checksum.

### 9.2 Database additions

Add tables or columns for:

- `template_import_jobs`: job status, source kind, source checksum, user, template target, selected pages/routes.
- `template_import_artifacts`: CDIR JSON, source rasters, rendered output rasters, diff heatmaps, extracted assets.
- `template_import_fidelity_reports`: per-page and aggregate quality metrics.
- `template_import_review_decisions`: accept/retry/auto-fix/manual edit decisions.

Keep the existing `template_imports` table and `template-import-pdf` function operational during migration.

## 10. Rollout Plan

### Phase 0 — Instrument and freeze baseline

- Create a golden corpus: 10 PDFs, 10 screenshots, 5 Figma frames, 5 URLs, 5 project zips.
- Capture current output metrics manually and via screenshot diff.
- Add import metadata logging for source kind, page count, mode, warnings, and user-visible result.

### Phase 1 — CDIR and adapter layer

- Implement CDIR types and validators.
- Build adapters from current PDF, image OCR, DOM grounding, and Figma data into CDIR.
- Build CDIR → `ReportTemplate` mapper.
- Keep old direct path as fallback behind a feature flag.

### Phase 2 — Fidelity validator

- Render source and reconstructed output to canonical rasters.
- Compute SSIM/perceptual diff, text accuracy, box drift, and native coverage.
- Add fidelity report UI and import warnings.
- Enforce warning thresholds without blocking existing imports yet.

### Phase 3 — PDF high-fidelity extraction

- Improve text/font extraction.
- Add vector and table reconstruction.
- Add scanned-page detection and OCR/CV fallback.
- Add per-page repair loop.

### Phase 4 — Image high-fidelity reconstruction

- Add CV geometry extraction.
- Add table/card/icon detection.
- Constrain AI reconstruction to measured geometry.
- Reduce full-page raster fallback to localized unsupported regions.

### Phase 5 — Raw code/project zip v2

- Build project detector and sandboxed build runner.
- Add route/story discovery and page selection UI.
- Capture computed styles, pseudo-elements, SVG/canvas fallbacks, assets, and font data.
- Convert selected routes into multi-page editable templates.

### Phase 6 — Review, repair, and strict gates

- Add import review mode.
- Enable auto-fix passes.
- Block “success” messaging when output misses minimum quality thresholds.
- Promote high-fidelity pipeline as default; keep legacy modes under advanced options.

## 11. Testing Strategy

### 11.1 Unit tests

- CDIR schema validation.
- PDF operator-to-CDIR extraction.
- OCR/CV grouping.
- DOM box tree to CDIR conversion.
- CDIR to `ReportTemplate` mapping.
- Fidelity metric calculations.

### 11.2 Integration tests

- PDF → CDIR → template → render → fidelity report.
- Image → OCR/CV → template.
- URL → DOM extraction → template.
- Zip project → build → route selection → multi-page template.
- Figma node tree → CDIR → template.

### 11.3 Golden visual regression tests

- Store approved reference rasters and generated output rasters.
- Fail CI when visual similarity, text accuracy, or native coverage regresses beyond tolerances.
- Include deliberately hard samples: scanned PDFs, complex brochures, nested web layouts, transparent images, custom fonts, and dense tables.

### 11.4 Manual QA checklist

- User can upload a multi-page PDF and receive editable pages.
- User can upload an image and text is editable with exact copy.
- User can upload a zip project and select routes/pages.
- User sees build/import warnings before accepting.
- User can edit imported text, shapes, and images in the existing template builder.
- Full-page raster fallback is visible as a warning and not hidden as success.

## 12. Security and Reliability Requirements

1. **Zip safety:** reject path traversal, symlinks, oversized archives, excessive file counts, nested archive bombs, executable payloads, and unsupported binary blobs.
2. **Build sandbox:** run imports in isolated containers with CPU, memory, disk, and network limits.
3. **URL safety:** retain SSRF protection and content-type validation for remote fetches.
4. **Asset scanning:** validate MIME types and normalize images/fonts before storage.
5. **Timeouts:** enforce per-page, per-route, and per-job limits with resumable status.
6. **Idempotency:** use source checksum and job id to avoid duplicate asset uploads and repeated builds.
7. **Observability:** log extractor timings, fallback causes, fidelity scores, and repair attempts.

## 13. Product UX Changes

### 13.1 Replace “upload and hope” with guided import

The import dialog should ask:

1. Source type: PDF, image, link, Figma, code/project.
2. Target behavior: exact reconstruction, redesign inspiration, or re-sync existing template.
3. Page/route selection for multi-page documents and zips.
4. Fidelity target: fast draft, balanced, or strict exactness.

### 13.2 Zip/project UX

- Drag a full project zip.
- Show detected framework and build command.
- Show discovered pages/routes/stories.
- Let the user select output pages.
- Show build logs and route screenshots.
- Then run reconstruction and review diffs.

### 13.3 Quality language

Replace vague “Done” states with explicit results:

- “Imported 7 pages. Overall fidelity 94%. 96% native editable coverage. 3 localized raster fallbacks.”
- “Needs review: text accuracy 91% on page 4; table grid detection failed.”
- “Project built successfully. 5 routes available; 3 selected for template pages.”

## 14. Migration and Compatibility

- Keep current `ImportPdfDialog`, `ReferenceImportDialog`, `extractPdfToTemplate`, and `template-import-pdf` paths intact.
- Add the new orchestrator behind `templateImportV2` feature flag.
- Initially write CDIR artifacts alongside current schema output without changing the editor.
- Once stable, switch source paths one by one to CDIR-backed mapping.
- Preserve old fidelity modes as advanced options for users who rely on current behavior.

## 15. Definition of Done

The initiative is complete when:

1. Multi-page PDFs, image references, URLs, Figma frames, raw HTML/JSX, and zip projects all enter a shared CDIR-backed pipeline.
2. Output templates are editable by default, with source-like layout and typography.
3. Full-page static-image output is never presented as a successful editable import unless the user explicitly chooses raster-only mode.
4. Every import has a fidelity report, warnings, and visual diff artifacts.
5. Zip projects support route/page discovery and multi-page template creation.
6. Golden regression tests protect output quality across all source types.
7. Existing import functionality remains available during rollout and users can recover previous template versions.

## 16. Recommended Immediate Engineering Sequence

1. Add CDIR type definitions, validators, and a mapper skeleton.
2. Add fidelity report types and metrics using the existing rendered-template preview path.
3. Wrap current PDF/image/code outputs into CDIR without changing visible behavior.
4. Add import review UI powered by the fidelity report.
5. Upgrade `render-source` zip handling into a route-manifest workflow.
6. Add PDF text/vector/table extraction improvements.
7. Add image CV geometry extraction.
8. Enable strict quality gates and repair passes after the golden corpus shows reliable improvement.

This sequence lets the team improve quality with hard measurements while preserving the editor contract and avoiding a risky rewrite.
