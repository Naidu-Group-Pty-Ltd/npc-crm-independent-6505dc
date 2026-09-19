# PDF Extraction V3 · E7 — Hard-Fail Visual Quality Gate V2

> **Status:** code complete. **Scope:** code-only, fully backward compatible, no
> deploy. No Google Cloud / Cloud Run / Docker / image push / infra / release
> script change; no Supabase migration or Edge Function deploy; no external
> OCR/AI/VLM/provider; no automatic AI repair. Builds on E0 (containment), E1
> (Source Scene Graph V2), E2/J1 (Docling vNext), E3 (charts), E4 (tables), E5
> (typography) and E6 (region composition) — all merged.

## 1. Problem statement

The V1 quality pipeline cannot gate final source-fidelity acceptance:
`import-quality-gate-v1` never throws and returns `ran:false` on a capture
failure, which can finalize an unrepaired template; the visual diff gathers
rendered TEXT from the CDIR model and rendered BOUNDS from CDIR layer bounds —
not the actual painted browser surface (a string existing in template JSON / CDIR
/ PDF text is not proof it is visibly rendered); image comparison downsizes to a
256px global surface scored by global mean-absolute-error + colour histogram, so
large white areas dilute a missing chart/table/row; missing rasters get a neutral
`0.5`; there is no critical-defect veto, so a high weighted score can conceal a
missing chart, a clipped row, an off-page value, a fused numeric range, a
wrong-cell value, a duplicated crop or a blank region; documents over 40 pages
are skipped; the editor preview can differ from print/export. E3/E4/E5/E6 provide
source + preservation evidence, but nothing evaluated the ACTUAL composed output.

## 2. Non-goals

E7 does not re-arbitrate E3/E4/E5/E6 (they stay authoritative), invent chart
data, rewrite content or recompute financial values, guess table-cell
associations, add typography substitutions, change any E3/E4/E5 threshold,
reimplement E6 ownership, implement the E8 repair catalogue, use AI/OCR/PDF-text
as visual proof, accept an unscored critical page, treat missing metrics as
neutral success, average a critical defect away, or require infra changes.

## 3. Runtime-composition prerequisite (resolved, not blocked)

E6 shipped the pure composition contract + integration facade but had not wired
the region render plan into any renderer. E7 adds the *small, shared renderer
wiring correction* the plan allows: `rendering/regionRenderPlanApply.ts` +
`htmlRenderer` now consume the resolved E6 plan projection carried on
`page.meta.pdfImportRegionOutput.renderPlan` — suppressing the plan's suppressed
overlays, painting its final source crops (final-output only; editor references
excluded), and stamping the deterministic `data-pdf-render-plan-hash` +
composition data-attributes. A real-Chromium e2e
(`tests-e2e/pdfImportRegionCompositionV2.e2e.ts`) proves a controlled page
renders through the plan (crop painted at bbox, suppressed native absent, no
editor references, hash stamped) and that a page with no plan renders identically
(backward compatible). This does NOT reimplement E6 — it applies the plan E6
produced.

## 4. Contract versions

| Contract | Version |
|---|---|
| Rendered output evidence | `rendered-output-evidence-v1` |
| Export output evidence | `export-output-evidence-v1` |
| Critical quality defects | `critical-quality-defects-v1` |
| Visual quality report V2 | `visual-quality-report-v2` |
| Import quality gate V2 | `import-quality-gate-v2` |
| Visual metrics V2 | `visual-metrics-v2` |

V1 reports stay readable as legacy; they are never treated as V2-complete. Pure
modules live under `src/lib/reportTemplate/ingestion/visualQuality/v2/`.

## 5. Evidence separation (six layers, never substituted)

**Source truth** (source raster, Scene Graph V2, E3/E4/E5 source evidence) ·
**candidate model** (template / CDIR / overlays) · **final composition plan**
(page policy + E6 render plan + ownership + suppression) · **actual browser
output** (visible DOM, client geometry, loaded assets, generated raster) ·
**actual exported output** (PDF bytes → re-raster + export asset/font evidence) ·
**acceptance decision**. Prohibited substitutions are enforced by construction:
CDIR text cannot satisfy visible-text evidence, template bounds cannot satisfy
client-rect evidence, the E6 plan cannot satisfy actual-render evidence (the gate
checks the renderer stamped a matching hash), PDF text extraction cannot prove
export visibility (companion signal only), and a score never proves the absence
of a hard defect.

## 6. Actual DOM capture + visible-text model

`RenderedOutputEvidenceV1` captures, per page, the visible overlays/regions/crops,
per-text-run raw Unicode + code points, actual line boxes, client/scroll
dimensions, computed style, clipping, off-page, occlusion and contrast. The pure
evaluators (`domEvidence.ts`) decide visibility (`display:none` /
`visibility:hidden` / `opacity:0` / zero-area / fully-occluded / hidden-semantic
are NOT visible), clipping (scroll-vs-client + line-box ∩ clip region), off-page
(material portion outside the page box, subpixel tolerated), overlap/occlusion
(bounded uniform-grid spatial index — no O(n²) on large pages) and WCAG contrast
(alpha-composited over the effective background). Hidden-semantic text counts only
toward accessibility, never toward visible-text recall. The browser adapter that
reads real client rectangles is thin and jsdom-guarded; every verdict is proven
deterministically in Vitest via synthetic geometry, and in Chromium via the e2e.

## 7. Visual metrics V2 (imageMetricsV2.ts)

Authoritative metrics run on a canonical full-page surface (default 1280px long
edge, 1024–1536 range) that preserves aspect ratio and **pads missing content
white** — never cropping both pages to their smaller common size (which could
hide missing edge content); dimension mismatch is recorded. Metrics: page pixel
similarity; tiled 4×4 similarity weighted by SOURCE foreground so empty white
tiles cannot dominate (records worst + locally-blank tiles); foreground mask
IoU / source recall / output precision (modal-background estimate + luminance
distance); Sobel edge recall/precision with a 1px displacement tolerance
(anti-aliasing safe); content occupancy; local-blank detection (source content,
blank output). Colour histogram similarity is a low/zero-weight companion. Region
comparison (`regionMetrics.ts`) compares each critical source region crop to its
actual representation; a region with no obtainable output raster is
`source_region_unscored` (never a false pass).

## 8. Structural validation (structuralValidation.ts)

Consumes E3/E4/E5/E6 projections + rendered evidence and confirms the renderer
FOLLOWED them, emitting canonical defects — never re-arbitrating. **E3:**
`chart_region_missing` / `chart_crop_blank` / `chart_region_duplicated` /
`chart_child_duplicate`, plus picture/logo variants. **E4:** E4 hard defects
carried verbatim; `table_row_missing` / `table_column_missing` /
`table_generic_header_visible` / `table_native_crop_duplicate` from visible row/
column observations. **E5:** critical token/punctuation recall on the ACTUAL
visible text (`critical_numeric_token_missing`, `range_separator_missing`,
`multiplication_sign_changed`, `minus_sign_changed`, `percentage_symbol_missing`,
`currency_symbol_missing`), clipping/off-page/contrast/line-count on the run's
node, and source-crop native-duplicate suppression. **E6:** render-plan hash
match, suppressed overlays absent, hidden-semantic not painted, editor references
absent, final crop assets loaded + non-blank, `duplicate_source_pixels`,
`page_raster_missing`.

## 9. Export evidence + browser/export parity (exportEvidence.ts)

`ExportOutputEvidenceV1` re-rasterizes the exported PDF and compares source ↔
browser final ↔ export. PDF text is a companion signal only. Parity requires the
same policy (strategy, visible regions/crops, suppressed overlays, plan hash,
page count, geometry) plus bounded visual agreement (never subpixel-identical).
Failures: `export_preflight_failed`, `export_page_count_mismatch`,
`export_dimension_mismatch`, `export_critical_region_missing`,
`editor_reference_visible_in_final`, `export_text_clipped`, `renderer_parity_failed`.

## 10. Critical defects + the hard-defect veto (criticalDefects.ts)

ONE `CriticalQualityDefectV1` shape and ONE `HARD_VETO_CODES` set (~90 codes
spanning source/coverage, composition, chart/picture, table, typography/content,
layout/visual, export and security/audit). Reasons are bounded + privacy-safe
(no source paragraphs or financial values). `hasUnresolvedHardDefect` and
`assertDecisionPermitted` are consulted BEFORE any score: an automatic
native/mixed acceptance is impossible while any hard-veto defect is unresolved,
even at score 0.99; page-raster acceptance additionally requires no
`page_raster_missing` / `final_output_blank_page` / `page_dimension_mismatch`. An
authorized E6 force-native override leaves the defects in the report and keeps the
automatic status failed (operator-accepted-with-defects) — a client flag never
erases a defect.

## 11. Scoring V2 + coverage (scoreV2.ts)

Score is secondary. `null` = not measured (never 0.5); `0` = measured failure;
`1` = perfect. The page score is a weighted average over MEASURED metrics with
weights renormalized across what was measured — but a missing REQUIRED metric
keeps coverage `partial` (never renormalized away), and the gate fails closed on
partial coverage. Category weights: visual region fidelity 0.25, visible text &
token fidelity 0.20, structural integrity 0.20, foreground/occupancy 0.15,
edge/tiled 0.10, composition/asset 0.05, browser/export parity 0.05. Colour
histogram and extractor confidence carry ~zero weight. Document score is never a
plain average: `0.70·mean + 0.20·p10 + 0.10·minCriticalRegion`, with min/p10/
critical-page-pass recorded so one bad page cannot be diluted.

## 12. Decision cascade (decisionV2.ts)

ONE engine, veto-first: **native** — no hard defect + score ≥ 0.90 →
`accept-native`; ≥ 0.80 → `accept-native-with-review`; else localized failure with
exact crops → `apply-mixed-region-fallback`, otherwise escalate. **mixed** —
re-measured mixed output, same thresholds → `accept-mixed` /
`accept-mixed-with-review`; else escalate. **page-raster** — valid ready non-blank
raster → `accept-page-raster`; else **block**. Incomplete coverage / unscored
always escalates to raster or blocks. `finalizeDocument` blocks the whole document
on any unscored critical page, incomplete batch coverage, any blocked page, or
required-but-unavailable export parity.

## 13. Fail-closed execution + large-document batching

A quality-evaluation failure marks pages unscored / manual-review / page-fallback
(where a valid raster exists) / blocked — a Visual QA exception can never leave a
V3 critical page automatically native. The gate processes pages in bounded
sequential batches (default 10; every page attempted, merged by pageId without
duplication, unscored pages recorded explicitly); coverage is `complete` only when
every expected page + critical region was scored — partial coverage cannot
automatically pass, and there is no page-count skip.

## 14. Renderer wiring + schema

`page.meta.pdfImportRegionOutput.renderPlan` (additive, optional) carries the
compact E6 plan projection consumed at paint time. `htmlRenderer` suppresses the
plan's suppressed overlays, paints final crops (`regionCropSrc` hydrates them at
runtime — never persisted; absent, a locked placeholder lets capture detect a
missing asset), and stamps `data-pdf-page-id` + `data-pdf-render-plan-hash` +
`data-pdf-output-strategy` in both editor and final output. Absent a projection
the output is byte-identical to before E7.

## 15. Persistence, signed delivery, limits

Persisted V2 shapes carry bounded summaries + durable artifact references only —
never `ImageData`, image bytes, source text, financial values or signed URLs
(the validators reject `signed_url_persisted` and `raw_image_buffer_persisted`).
Suggested private artifact layout: `{importId}/quality-v2/{summary,defects,
rendered-evidence,export-evidence}.json` + `pages/page-NNN/{source,browser-final,
export-final,diff,foreground-*,edges-*}.png` + `regions/{regionId}/…`. Lazy signed
delivery (page/region/kind selectors, ownership-checked, path-validated, bounded,
short TTL, never logged/persisted) is prepared as an Edge Function change — NOT
deployed. Explicit limits bound canonical dimension, tiles, regions, DOM
elements, text nodes, line rects, overlap pairs, occlusion samples, batch size and
persisted bytes; a critical limit records a hard defect and routes to fallback.

## 16. Security

No signed/Blob/object URL persisted; no raw source paragraph or financial value
in logs or defect reasons; no private raster/PDF/crop/font committed; artifact
paths validated (no traversal / external URL); no external provider; no automatic
AI; operator override identity taken only from the trusted server context;
temporary export PDFs/rasters removed after tests; capture cannot execute
untrusted imported script (existing CSP/sanitization unchanged).

## 17. Tests

- **Pure Vitest (40):** version + validation (out-of-range/non-finite rejected,
  null allowed, accepted-with-hard-defect rejected, signed-URL rejected); the
  veto (score 0.99 cannot accept with a hard defect; page-raster guard); DOM
  evaluators (visibility, H/V clipping, line-box clip, off-page + subpixel,
  contrast dark-on-dark/transparent, crop+native duplicate, ownership ignore,
  hidden-semantic); image metrics (identical ≈1, missing chart low foreground/
  edges, empty white tiles can't dominate, local blank); region + structural
  (unscored region, missing chart, fused range, plan-hash mismatch, suppressed
  overlay visible, editor-ref visible); scoring/coverage (null never 0.5, one bad
  page not hidden, cascade native→mixed→raster, unscored escalates/blocks); export
  parity (hash mismatch, missing crop, PDF text ≠ proof); the gate (clean accept +
  batching without duplication, missing chart never native, incomplete batch fails
  closed); renderer wiring helper.
- **Pre-upgrade 57/100 regression (4):** legacy global score is deceptively
  non-catastrophic; V2 tiled + local-blank + region comparison catch the missing
  chart; the unsafe page can NEVER receive accept-native / accept-native-with-review.
- **Real-Chromium e2e (2):** final renderer consumes the E6 plan (crop painted,
  native suppressed, hash stamped, no editor refs); no-plan backward compat.
- All E0/E3/E4/E5/E6 suites remain green; goldenRender + every renderer/schema
  consumer pass.

## 18. Acceptance thresholds

**Native:** no hard defect, complete critical coverage, page score ≥ 0.90, every
critical region scored. **Native-review:** ≥ 0.80 + manual review. **Mixed:**
exact failed-region crops applied + re-rendered, no hard defect, ≥ 0.90 (0.80–0.89
with review), every final crop ready. **Page-raster:** valid ready non-blank
raster, correct dimensions, no native/region layers in final output, export
reproduces it. **Block:** raster unavailable/invalid, required crop unavailable
with no fallback, critical page unscored, unresolved hard defect, export preflight
cannot pass. Document targets: accepted output ≥ 0.92 (complex report ≥ 0.95), no
critical defect, visible-text recall ≥ 99% overall + 100% critical, wrong-cell
numeric = 0, critical clipping/off-page/severe-overlap = 0. Source-region and page
fallback are valid and explicit; thresholds are never weakened to maximize
editability.

## 19. Private-report acceptance checklist

Do not commit the private report or hard-code private page numbers/strings; run it
only in an authorized local/staging acceptance pass. Per section confirm: cover
wordmark exact once, no clipping/off-page footer, browser=export; executive
summary chart visible with no detached/duplicated labels + no local blank; property
snapshot independent structures unmerged, every value in the correct region, no
clipped row; infrastructure meaningful headers (no generic), all rows, no
dark-on-dark; market/comparable/rental charts + tables complete and separate, no
duplicate native/crop; financial projections chart visible with Entry/Year 1/2/3/5/
7/10 distinct + correctly associated + no missing late row; typography ranges/
currency/en-em/×/%/superscripts exact with no joined words; legal complete with 0
clipped/off-page/unreadable lines and export complete. Document-level: page count
exact; critical page + region coverage 100%; hard-defect/missing-chart/missing-
picture/wrong-cell/clipped-row/off-page/severe-overlap/local-blank/duplicate/
unresolved-overlap/export-preflight/unscored-critical counts all 0; recalls 100%;
final asset availability + browser/export parity 100%.

## 20. Deployment scope (NOT performed)

Later controlled work wires the concrete DOM-capture adapter + export re-raster
into the runtime capture/export paths, deploys the lazy quality-v2 signing Edge
Function, and (E12) makes the thresholds formal release gates. No migration (the
V2 summary is additive template JSON; artifacts reuse the private job prefix). No
cache-fingerprint change here (E10 handoff). No Edge Function or sidecar deploy.

## 21. Rollback

Additive + gated: absent `renderPlan`/quality-v2 metadata leaves templates valid
and rendering byte-identical; the pure gate is dormant until the runtime capture/
export adapters feed it. Reverting the schema field or the modules leaves E0–E6
untouched.

## 22. E8 / E9 / E10 / E11 / E12 handoff

- **E8 (deterministic repair):** consumes E7 page/region defects, actual DOM
  geometry + line boxes, clipping/overlap/off-page, region + candidate scores,
  source/output bboxes, region policy and current strategy — chooses safe
  deterministic repairs, re-renders, reruns E7, stops after ≤ 2 passes, falls
  back when defects remain. E7 does NOT implement any repair operation.
- **E9:** provider results are candidate evidence and must pass E7.
- **E10:** the cache fingerprint must include `visual-quality-report-v2`,
  `import-quality-gate-v2`, `rendered-output-evidence-v1`,
  `export-output-evidence-v1`, `critical-quality-defects-v1`, the E6 policy
  versions and the metric/threshold/weight version.
- **E11:** consume E7 summaries + lazy detailed artifacts; do not rebuild quality
  decisions in the UI.
- **E12:** make E7 thresholds formal release gates running browser-preview +
  exported-PDF QA over a private corpus referenced by registry/hash only.

## 23. Known limitations (not hidden)

- The concrete browser DOM-capture adapter (reading real client rectangles into
  `RenderedOutputEvidenceV1`) and the export re-raster adapter are runtime-gated:
  E7 ships the pure evaluators + gate (fully proven in Vitest with synthetic
  geometry and in Chromium via the composition e2e), and the paint-time E6-plan
  wiring; feeding live captured evidence into the gate at import time is the
  runtime adapter, delivered like E4's alternate conversions and E5's export-parity
  adapter.
- The pre-existing V1 `runVisualDiff` (256px, CDIR text/bounds, neutral 0.5) is
  left in place as the legacy path; E7 is the additive V2 evaluation, not a
  deletion of V1 — the two are versioned side by side.
- 8 pre-existing tsc errors on `main` (`stepUp.ts`, 5× `chartPreservation.pure.ts`,
  2× `src/components/reports/`) are unrelated to E7 and untouched — E7 adds zero
  new tsc errors.
