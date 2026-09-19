# E0 — Critical Visual Containment (`critical-visual-containment-v1`)

**PDF Extraction V3 · Package E0 — production containment bridge.**

## Purpose

E0 does **not** improve native chart/table extraction. It prevents a **broken**
native chart/table (or an unscored/unverifiable critical page) from being
finalized as "healthy native output". The 13-page investment-report test scored
~57/100 with missing charts, merged/mis-associated tables, generic `Column N`
headers, and corrupted numeric ranges — yet the quality gate accepted those
pages. E0 makes the current system **fail safely** while E1–E12 rebuild the
engine.

Guiding rule: **source fidelity outranks editability.** A raster/source-backed
final page is acceptable; a visually broken editable page is not.

## Contract version

`critical-visual-containment-v1` — stamped on every assessment and on the
persisted summary.

## Where it lives

| Concern | Module |
|---|---|
| Classifier + hard-veto decision (pure) | `src/lib/reportTemplate/pdfImport/criticalVisualContainment.pure.ts` |
| Source/candidate adapters + durable-raster helper (pure) | `src/lib/reportTemplate/pdfImport/criticalVisualContainmentAdapters.ts` |
| Template orchestrator (pure) | `src/lib/reportTemplate/pdfImport/applyCriticalContainment.ts` |
| Gate integration (runs on every path) | `src/lib/reportTemplate/pdfImport/importQualityGate.ts` |
| Evidence + raster refs wiring | `src/lib/reportTemplate/pdfImport/extractPdfViaDocling.ts` |
| Diagnostics surfacing | `.../ingestion/diagnostics/pdfImportDiagnosticsV2.ts`, `PdfImportDiagnosticsDetailDialog.tsx` |

## Critical-content classifier

Runs from the best currently-available evidence — the immutable source Docling
document and the candidate `ReportTemplate` — assembled into a small normalized
`ContainmentPageInput` by pure adapters (no ImageData, DOM, signed URLs, or whole
Docling documents).

* **Chart / picture** — a source picture is chart-like when its classifier class
  matches chart/graph/plot/bar/line/pie/…, or a caption/page-title carries a
  strong analytical term (`price history`, `growth`, `vacancy history`,
  `projection`, `scenarios`, `comparable sales`, `yield`, `CAGR`, `timeline`, …)
  corroborated by numeric labels. One weak keyword alone never classifies a page.
* **Picture safety** — a chart/picture is *unprotected* when it has no usable
  source crop, no candidate visual layer, or the candidate produced an empty
  image overlay (`src=''`). An empty image overlay never counts as preserved.
* **Table safety** — hard defects: generic `Column N` headers while the source
  has header text; zero columns; zero rows while the source has cells; computed
  minimum height exceeding the bbox (clipping); multiple independent source
  tables collapsed into one candidate (adjacent-merge). Under the safe default a
  native *reconstructed* table (which can carry undetectable wrong-cell
  associations) is treated as unverified.
* **Dense vector** — conservative: only a bounded cluster of ≥14 paths with
  nearby numeric/category labels and **no** covering chart/picture crop. Plain
  borders and page rules are never flagged.

## Hard-defect rules (hard veto)

Critical defects are **not** weighted warnings — they are vetoes. A high weighted
score can never keep a page native when a critical defect is present.

| Situation (source raster available) | Action |
|---|---|
| A — simple page, no critical defect | `allow_native` (defer to the score decision) |
| B — chart/picture region unprotected | `force_hybrid_fallback` (raster final; native layers editable for recovery) |
| C — unsafe table / value-association risk | `force_pixel_fallback` (raster final; native layers locked) |
| D — critical page unscored / visual-QA failed | `force_pixel_fallback` |
| E — critical page with partial/image-only coverage | `force_pixel_fallback` |
| F — critical page **without** a usable source raster | `block_manual_review` (`nativeAllowed=false`, `manualReviewRequired=true`, **no** fallback claim) |

Defect codes: `source_chart_unprotected`, `source_picture_unprotected`,
`image_overlay_missing_source`, `table_generic_headers`,
`table_structure_unverified`, `table_minimum_geometry_failed`,
`table_possible_clipping`, `table_possible_adjacent_merge`,
`dense_vector_region_unverified`, `critical_page_unscored`,
`critical_page_partial_coverage`, `critical_page_image_only_coverage`,
`critical_page_visual_qa_failed`, `critical_page_source_raster_missing`,
`critical_page_source_raster_unreadable`, `critical_page_output_policy_unapplied`.

## Action precedence

For an initial automatic import: **operator decision** (existing, made after
review) → **E0 critical containment** → **existing score-based page decision**
(C6) → **requested mode**. E0 output takes precedence for critical pages; the C6
decision is preserved for non-critical pages.

## Policy flags + safe defaults

`complexNativeEnabled`, `chartNativeEnabled`, `unverifiedTableNativeEnabled` — all
default **false**, fixed in code. They may be overridden from optional Vite build
env (`VITE_PDF_IMPORT_*_NATIVE_ENABLED`), but a **missing** flag resolves to the
safe state, so the browser can never bypass containment via an absent variable or
a request property. No Cloud Run / Supabase secret is required; E0 needs no
infrastructure change. An operator may still opt a page back to native in the
existing review UI — only **after** the import is flagged for manual review.

## Source-raster guarantee (no blank pages)

A raster-only policy on an empty background would render a blank page. Before
claiming a raster-backed fallback, `ensureDurableSourceRasterForPage`:

1. keeps an existing durable `meta.sourceRasterRef` (storage path) as-is;
2. otherwise attaches a durable `PdfImportRasterRef` (storage path) from the
   raster manifest — resolved to a signed URL only at render time by
   `preloadImages`;
3. accepts a self-contained `data:` URL as a last resort;
4. **rejects** an ephemeral `https://` signed URL (never persisted into the
   template);
5. reports `available=false` when nothing usable exists → the page is
   **blocked** for manual review rather than made a blank raster-only page.

Semantic-mode pages (which have `background.imageUrl=''`) are specifically
covered — the durable ref is attached so the fallback still renders.

## Page-policy semantics (reuses `pdf-page-output-policy-v1`)

* `hybridFallbackPolicy` — `outputStrategy=raster-only`, `sourceRasterRole=final-output`, `nativeLayerPolicy=editable`.
* `pixelFallbackPolicy` — `outputStrategy=raster-only`, `sourceRasterRole=final-output`, `nativeLayerPolicy=locked`.

In final output a raster-only page renders **only** the source raster; native
overlays do not render (no ghosted duplicate). The editor may opt in
(`showReconstructedLayers`) to expose the reconstructed layers for recovery
without changing final output.

## Fail-closed-for-native behavior

The gate stays fail-**open** for import *processing* (it never throws), but E0 is
fail-**closed** for native fidelity: containment runs on **every** path —
`no_source_rasters`, `no_cdir_pages`, `no_browser_render_context`,
`visual_qa_no_batches_completed`, `gate_error`, and for every **unscored** page.
An internal QA exception can never leave a known complex page native.

## Cache behavior

The dispatcher cache reuses **parse artifacts** only. The frontend always
re-maps Docling → template and re-runs the gate + containment at finalization, so
a pre-E0 broken native result cannot be returned as a completed E0 import without
re-running containment. The parse-cache fingerprint does not cover final output
policy, so **no fingerprint change is required** for E0.

## Audit fields

Persisted at `template_imports.meta.visual_quality_gate.criticalContainment`:
`version`, `ran`, `policy`, `criticalPageCount`, `criticalDefectCount`,
`pagesAllowedNative`, `pagesForcedHybrid`, `pagesForcedPixel`,
`pagesBlockedNoRaster`, `nativeSuppressed`, and a bounded `perPage[]`
(`pageId`, `pageNumber`, `contentKinds`, `defects[{code,severity,contentKind,message}]`,
`sourceRasterAvailable`, `qualityCoverage`, `score`, `action`, `reason`,
`manualReviewRequired`). No signed URLs, source text, image bytes, or secrets.

## Operator live test (private 13-page report)

Do **not** commit the client PDF. Run it through the normal application and
confirm, at minimum:

* Page 2/7/8/10 — no blank chart region; charts show as the source page.
* Page 5 — the merged incorrect financial table is not shown as native.
* Page 6 — no generic/unreadable native table.
* Page 9 — no clipped comparable-sales table / missing rental chart as native.
* Page 11 — no corrupted generic native table.
* Any page whose critical content cannot be verified → safe source fallback, or
  blocked for review.
* Final preview **and** exported PDF never render the source raster and native
  overlays simultaneously.
* The import visibly indicates manual review where a fallback was applied.

The page numbers are acceptance evidence only — they are **not** hardcoded into
production logic.

## Rollback

Set `VITE_PDF_IMPORT_COMPLEX_NATIVE_ENABLED=true`,
`VITE_PDF_IMPORT_CHART_NATIVE_ENABLED=true`,
`VITE_PDF_IMPORT_UNVERIFIED_TABLE_NATIVE_ENABLED=true` in the frontend build to
relax containment toward the pre-E0 behaviour (charts/tables with valid crops and
no detectable hard defect defer to the score), or revert the E0 commit. No
migration, Edge Function, or Cloud Run change is involved.

## Known limitations

* E0 does **not** reconstruct or repair charts/tables — it protects the output.
* Table containment under the safe default is deliberately aggressive: any native
  table reconstruction is treated as unverified (source crop shown). E4 restores
  verified editable tables.
* Classification uses currently-available Docling evidence; richer region
  evidence (source crops per region) arrives in E1/E3.
* Legacy jobs with only a base64 `rasters.json` (no manifest) fall back to a
  self-contained `data:` URL background; modern jobs use durable storage refs.
