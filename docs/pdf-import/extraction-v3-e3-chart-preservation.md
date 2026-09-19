# PDF Extraction V3 · E3 — Chart & Picture Preservation

> **Status:** code complete. **Scope:** code-only, fully backward compatible, no
> deploy. No Google Cloud / Cloud Run / Docker build / production infra / release
> script / Supabase migration changes. Builds on E0 (containment), E1 (Source
> Scene Graph V2) and E2/J1 (Docling vNext runtime), all merged.

## 1. Objective

Reconstruction quality is now limited by **visual regions**: charts, graphs,
diagrams, vector illustrations, pictures and logos are still frequently rebuilt
as *fragmented semantic blocks* instead of preserved source visuals. E3 does
**not** improve OCR. It preserves **visual fidelity while keeping semantic
extraction**, by treating a chart as **source truth**:

- **Detect** chart regions deterministically.
- **Capture** each chart's exact source pixels as a dedicated crop.
- **Render** that crop as a single locked visual object.
- **Attach** semantic metadata (caption, axis/legend/series labels, numeric
  values, chart class, confidence) **beside** the crop — never in place of it.

This yields perfect visual fidelity *and* preserves semantic search, CDIR,
future structured chart extraction and AI understanding.

**Non-negotiables (unchanged from the program safety model):**

- Charts are never rebuilt from OCR/text and never redrawn.
- No AI, no remote APIs — detection is pure deterministic heuristics.
- If a chart crop is unavailable, fall back to **existing E0 containment**; never
  a semantic redraw.
- Deterministic region IDs; no signed URLs, secrets or source text in persisted
  artifacts.

## 2. What E3 adds (map to the contract)

| Contract | Version | Where |
|---|---|---|
| Chart preservation render plan + metrics | `chart-preservation-v1` | `pdf-parse-service/source_scene_graph.py`, `supabase/functions/_shared/chartPreservation.pure.ts` |
| Chart detection signals | `chart-detection-signals-v1` | `source_scene_graph.py` (`build_chart_detection_signals`) |
| Source chart metadata (extended additively) | `source-chart-metadata-v2` | `source_scene_graph.py`, `sourceSceneGraphV2.pure.ts` |

The Python producer is authoritative; the TypeScript module is the canonical
consumer, and the two agree field-for-field (same FNV-1a region IDs, same render
decision, same metrics). The frontend/Edge functions consume the TS module via
the thin re-export `src/lib/reportTemplate/pdfImport/chartPreservation.pure.ts`.

## 3. Design

### 3.1 Chart region detection (deterministic)

`chart` is already a first-class region type (E1). E3 makes detection combine —
with **fixed thresholds, no randomness** — Docling picture classification,
caption/title chart terms, **vector (gridline) density**, **axis-tick
detection**, **legend detection** and **numeric-label density**:

`build_chart_detection_signals(...)` returns a bounded signal dict + a
fixed-weight `score ∈ [0,1]` + a `promote` boolean:

- `classificationChart` — Docling class matches the chart lexicon (`+0.6`).
- `captionChartTerm` + page numeric labels (`+0.4`).
- `axisPresent` — ≥2 axis-tick-like numeric labels along the left/bottom edge (`+0.25`).
- `legendPresent` — ≥2 short non-numeric labels inside the region (`+0.2`).
- `gridlinesPresent` — ≥`CHART_GRIDLINE_MIN_PATHS` vector paths overlapping (`+0.2`).
- `numericDense` — ≥2 numeric tokens inside the region (`+0.15`).

A picture is promoted to `chart` when it is Docling-classified, **or** caption +
numeric, **or** (`score ≥ 0.5` *and* corroborated signals: an axis **and**
(legend **or** gridlines) **and** in-region numeric density). The heuristic
(unclassified) path requires real in-region evidence, so a plain picture or a
single weak title term is **never** promoted — E1's existing behaviour is
preserved (all 66 E1 tests still pass unchanged).

### 3.2 Chart region contract

Every chart region carries: region id, bbox, caption, `source-chart-metadata-v2`
(now with `detectionScore`, `detectionMethod`, `detectionSignals`, `axisLabels`,
`legendText`, `seriesLabels`, `numericValues`, `renderMode`), foreground summary,
crop path + sha256 + dpi, provider evidence, relationships, visual completeness,
`crop-required = true`. IDs remain deterministic; **no signed URLs**.

### 3.3 Chart crop generation (dedicated, ≥300 DPI)

`app.py` renders a **dedicated region crop** for each chart from the **original
PDF** (not the reconstruction), at a **≥300 DPI floor** (`CHART_CROP_MIN_DPI`) —
so a chart stays sharp even if the page crop DPI is lowered — lossless PNG, exact
source pixels, 2 pt padding, stored beside the other region crops
(`{prefix}/pages/page-NNN/regions/{regionId}.png`). Crops integrate into the
Source Scene Graph V2, the page scene, the per-page artifact manifest (V3) and
the region-crop map. Default DPI is already 300, so this is a no-op by default.

### 3.4 Chart rendering strategy + suppression

`build_chart_render_plan(regions)` (Python) / `buildChartRenderPlanForRegions`
(TS) resolve each chart to exactly one render mode:

- **`chart-crop`** — a durable, non-blank crop exists → render the crop as a
  single locked visual object; **suppress all child regions** (axis text, legend
  text, contained vectors, nested charts, contained pictures) to prevent double
  rendering / ghost labels / duplicate legends / misaligned charts.
- **`containment-fallback`** — no usable crop → defer to E0 containment (source
  raster / hybrid). **Never a semantic redraw.**

For renderers, `resolveChartSuppression(plan, overlays)` maps the plan onto a
template's candidate overlays: any native overlay whose centre sits inside a
rendered chart crop (and isn't page-sized) is hidden. The template bridge
`resolvePageChartPreservation(page, regions)` returns the suppressed overlay IDs.

Charts do not rebuild bars, points, line segments, axes, labels or legends.

### 3.5 Semantic metadata (beside the crop)

Charts still expose caption, axis labels, series labels, legend text, numeric
values, relationships, chart class and detection confidence — populated
deterministically from the chart's child regions by
`assign_chart_relationships`. These live **beside** the rendered crop and never
replace it.

### 3.6 Relationships

Charts may own text / legend / axis / vector / picture / nested-chart children.
Each child is bound to its **smallest containing chart** (nesting-correct);
`parentRegionId`/`childRegionIds`/`captionRegionIds`/`labelRegionIds` and the
chart's `axisLabelRegionIds`/`legendRegionIds` are populated. All relationships
are kept; only the outermost parent renders.

### 3.7 Page assembly

`assemble_page_scene` now carries an additive `chartPreservation` plan +
`chartRegionCount`. Text, tables, pictures and backgrounds are unaffected — a
non-chart region is never suppressed and never re-typed.

### 3.8 Visual quality reporting

`build_chart_render_plan` emits per-page metrics; `buildChartPreservationReport`
(TS) aggregates them into a document-level summary for the visual-quality report
and diagnostics:

- `chartRegionCount`
- `chartCropAvailability` (charts with a crop / total)
- `chartCompleteness` (renderable charts / total)
- `chartSuppressionSuccess` (rendered charts with fully-resolved suppression / rendered)
- `chartRenderModeCounts` (`chart-crop` vs `containment-fallback`)
- `suppressedRegionCount`

`attachChartPreservationSummary(report, chart)` folds the summary into any report
additively without importing or mutating the E0 containment summary types.

### 3.9 Fallback

If a chart crop is unavailable or blank, the plan is `containment-fallback` and
**E0 critical-visual-containment** remains the safety net (source
raster/hybrid/pixel + manual review). E3 never attempts a semantic redraw.

## 4. Files

**Producer (Python):** `pdf-parse-service/source_scene_graph.py` (detection
signals, relationships, render plan, metrics, `assemble_page_scene` additive
field), `pdf-parse-service/app.py` (≥300 DPI chart crops, plan + counts in scene
/ manifest). **Tests:** `pdf-parse-service/test_e3_chart_preservation.py` (33).

**Consumer (TS):** `supabase/functions/_shared/chartPreservation.pure.ts`
(canonical), `.../_shared/sourceSceneGraphV2.pure.ts` (additive chart metadata +
`ChartDetectionSignals`), `src/lib/reportTemplate/pdfImport/chartPreservation.pure.ts`
(re-export), `.../pdfImport/chartPreservationIntegration.ts` (template bridge).
**Tests:** `src/lib/reportTemplate/__tests__/chartPreservation.pure.spec.ts`.

## 5. Tests

- **Python (33):** detection (classification / caption+numeric / heuristic-signals
  / non-promotion / determinism), IDs, crop geometry + ≥300 DPI, blank-crop
  fallback, relationships (axis/legend/caption/numeric), semantic labels, render
  plan (chart-crop / fallback / nested / multiple), page assembly, metrics,
  orphan suppression, duplicate IDs, invalid bbox, empty chart.
- **TypeScript:** render plan, suppression sets, nested + multiple charts,
  metrics, suppression resolver (candidate overlays), doc-level report, additive
  attach, template bridge, cross-runtime parity.
- All 66 existing E1 tests + E0/E2/J1 suites remain green (zero regressions).

## 6. Backward compatibility

- Production Docling path unchanged; legacy runtime unchanged.
- Existing imports and API contracts unchanged — every E3 field is **additive**.
- Default page crop DPI is already 300, so the chart-crop floor is a no-op by
  default.
- Chart detection only *adds* promotions when corroborated by real in-region
  evidence; existing pictures/logos/tables classify exactly as before.
- E0 containment is untouched and remains the fallback.

## 7. Risk assessment

| Risk | Likelihood | Mitigation |
|---|---|---|
| Over-promotion of pictures to charts | Low | Heuristic promotion requires axis **and** (legend or gridlines) **and** numeric density; classification/caption paths unchanged. 66 E1 tests + non-promotion tests guard it. |
| Chart crop DPI increase inflates artifact size | Low | Default is already 300 DPI; floor only raises DPI when the operator lowered it. Crops are bounded (`MAX_CROPS_PER_PAGE`). |
| Suppression hides a legitimate native overlay | Low | Only `chart-crop` charts suppress, only overlays whose centre is inside the crop and not page-sized; fallback charts suppress nothing. |
| Producer/consumer drift | Low | Single canonical TS module + Python producer share the FNV region ID; parity test asserts identical IDs + render decisions. |
| Nested/duplicate regions produce wrong suppression | Low | Deterministic smallest-container binding + BFS descendants; orphan detection + duplicate-ID scene problem covered by tests. |

## 8. Acceptance checklist

- [x] `chart` distinguished from text / table / picture / logo / vector-cluster / background / unknown-visual.
- [x] Detection combines classification + caption + vector density + axis + legend + gridline + numeric density, deterministically, no AI/remote.
- [x] Chart region contract complete (id, bbox, caption, metadata, foreground, crop path/sha256/dpi, provider evidence, critical flag, relationships, completeness, crop-required).
- [x] Dedicated chart crops at ≥300 DPI, lossless PNG, exact pixels, 2 pt padding, beside region crops; integrated into scene graph + page artifact V3 + region manifest.
- [x] Renderer consumes the crop instead of semantic reconstruction; charts are single locked visual objects.
- [x] Semantic metadata (caption, axis/series/legend labels, numeric values, class, confidence) exposed beside — never replacing — the crop.
- [x] Suppression of vector/axis/legend/label/nested children when a crop renders.
- [x] Relationships kept; only the parent renders.
- [x] Page assembly integrates charts without affecting text/tables/pictures/backgrounds.
- [x] Visual-quality metrics: completeness, crop availability, suppression success, region count, render mode — in the report, page artifact and diagnostics summary.
- [x] Fallback to E0 containment when a crop is unavailable; never a semantic redraw.
- [x] Deterministic tests: detection, IDs, crop generation, suppression, relationships, page assembly, metrics, mixed/multiple/nested/empty/invalid-bbox/duplicate-id. No flaky tests.
- [x] Fully backward compatible; production Docling path, legacy runtime, existing imports and tests unchanged.
- [x] No deploy, no Cloud Run revision, no Google Cloud resource change, no Docker build, no migration, no release-script change.
