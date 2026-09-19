# PDF Import Phase 5 Completion Checklist

## Phase 5 Objective

Phase 5 introduces the render evidence layer for PDF template imports.

Phase 4 made page-level Docling extraction available. Phase 5 connects that extraction layer to visual QA artifacts:

```text
Phase 4 PageContext[]
  -> source render artifact manifest
  -> signed source raster URLs
  -> generated template raster capture
  -> source/generated pairing
  -> visual diff scoring
  -> visual-quality persistence
  -> import review UI display
```

---

## Completed Subphases

### 5A — Source Render Artifact Manifest

Status: Complete.

Outputs:

- `page-context-render-artifact-manifest-v1`
- Converts `pdfPageContexts[]` into source render artifact refs.
- Adds `source-raster` artifacts to `ImportReviewDraft`.
- Preserves:
  - source raster path
  - Docling page artifact paths
  - block/table/picture/summary paths
  - page dimensions
  - parent-global artifact status

### 5B — Source Raster Fetch/Signing Path

Status: Complete.

Outputs:

- `template-import-pdf.get_artifacts` signs private `pdf-import-diagnostics` paths.
- Returns:
  - `pdfDiagnosticsSignedByPath`
  - `pdfPageArtifactSignedUrls`
  - `pdfDiagnosticsSignedUrlTtlSeconds`
- `source-raster` review artifacts can now carry signed URLs.

### 5C — Generated Render Artifact Capture

Status: Complete.

Outputs:

- `generated-render-artifact-manifest-v1`
- Captures generated template pages from:
  - existing preview root/document
  - temporary hidden iframe rendered from `ReportTemplate`
- Produces:
  - `GeneratedRenderPageRaster[]`
  - generated render manifest
  - `reconstructed-raster` review artifacts

### 5D — Source/Generated Pairing + Visual Diff Persistence

Status: Complete.

Outputs:

- `render-diff-persistence-v1`
- Pairs source and generated rasters by page number.
- Computes pixel/color similarity.
- Builds diff rasters.
- Persists through existing `saveVisualQuality()`:
  - `visual-quality.json`
  - `page-###-source.png`
  - `page-###-generated.png`
  - `page-###-diff.png`

### 5E — Visual QA Summary Attached to Import Review

Status: Complete.

Outputs:

- `import-review-visual-qa-v1`
- Builds review-facing Visual QA summary:
  - overall score
  - page count
  - manual review status
  - warning count
  - action counts
  - persistence status
- Adds generated/diff artifacts to the review draft.

### 5F — Import Review Visual QA Pipeline

Status: Complete.

Outputs:

- `import-review-visual-qa-pipeline-v1`
- One callable pipeline:
  - capture generated render
  - pair with source render
  - persist visual quality
  - return updated draft and summary

### 5G — UI Trigger / Review Lifecycle Integration

Status: Complete.

Outputs:

- Import review dialog exposes **Run visual QA**.
- Import PDF dialog loads persisted review artifacts before opening review.
- Visual QA pipeline can run from the review flow.

### 5H — Persisted Visual QA Retrieval / Display

Status: Complete.

Outputs:

- Import review flow loads existing persisted Visual QA on reopen.
- Displays:
  - visual score
  - uploaded artifact counts
  - signed source/generated/diff URL availability
  - visual-quality summary path

---

## Required Regression Commands

```bash
npm run test -- \
  src/lib/reportTemplate/__tests__/importReviewVisualQualityPipeline.spec.ts \
  src/lib/reportTemplate/__tests__/importReviewVisualQuality.spec.ts \
  src/lib/reportTemplate/__tests__/renderDiffPersistence.spec.ts \
  src/lib/reportTemplate/__tests__/generatedRenderCapture.spec.ts \
  src/lib/reportTemplate/__tests__/pageContextRenderArtifacts.spec.ts \
  src/lib/reportTemplate/__tests__/pageContexts.spec.ts \
  src/lib/reportTemplate/__tests__/importArtifacts.spec.ts

npm run build
```

Optional:

```bash
npm run lint
```

Run SQL:

```text
scripts/regression/pdf-import-phase-5-check.sql
```

---

## Manual UI Smoke Test

1. Import a PDF using Hybrid mode.
2. Click **Review quality**.
3. Confirm source raster refs are shown.
4. Click **Run visual QA**.
5. Confirm Visual QA summary appears.
6. Confirm generated/diff artifact counts appear.
7. Close and reopen review.
8. Confirm persisted Visual QA loads without rerunning.
9. Open the first source/generated/diff link.
10. Confirm `template_imports.meta.visual_quality_summary` is populated.

---

## Phase 5 Pass Conditions

### Artifact Layer

- Source raster refs are derived from Phase 4 `pdfPageContexts[]`.
- Source raster refs include signed URLs.
- Generated template rasters can be captured.
- Source/generated/diff artifacts are representable as review artifacts.

### Persistence Layer

- `visual-quality.json` is uploaded to `template-import-artifacts`.
- Generated and diff PNGs are uploaded.
- Import metadata includes:
  - `visual_quality_artifact_path`
  - `visual_quality_summary`

### Review UI

- Review dialog can run Visual QA.
- Review dialog can display persisted Visual QA.
- Reopening review retrieves signed artifact URLs.

---

## No Sidecar Rebuild Required

Phase 5 is a frontend and Supabase consumer/persistence layer.

The Cloud Run sidecar remains unchanged after Phase 4J unless future parsing/render extraction issues are discovered.
