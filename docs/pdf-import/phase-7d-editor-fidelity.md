# PDF Import Phase 7D — Template Editor Fidelity

## 1. Objective

Identify the actual Template Builder editor rendering pipeline and harden the core
utilities that affect visual fidelity — page geometry, source-raster alignment,
editable-overlay alignment, layer ordering, font fallback, text consistency, and
the Visual QA capture surface — **without rewriting the editor or changing schema
structure**. This phase adds shared, unit-tested primitives that the renderer,
the editor canvas, and the Visual QA capture can converge on.

## 2. Renderer files identified

Traced from route `/admin/template-builder/:id`:

- **Editor route component:** `src/pages/admin/TemplateBuilderEdit.tsx`
- **Page renderer (interactive canvas):** `src/components/templateBuilder/EditorialCanvas.tsx`
- **Page/block renderer (production HTML → WeasyPrint):** `src/lib/reportTemplate/htmlRenderer.ts` (`renderTemplateToHtml`)
- **Legacy block renderer (jsPDF):** `src/lib/reportTemplate/pdfRenderer.ts`
- **Text renderer:** text blocks/overlays styled in `htmlRenderer.ts`; interactive text via `FloatingTextToolbar.tsx` / `BlockStylePanels.tsx`
- **Image renderer:** image blocks/overlays in `htmlRenderer.ts` and `EditorialCanvas.tsx`
- **Background / source-raster renderer:** `page.background` + `page.sourceRasterRef` (schema) drawn by `htmlRenderer.ts` / `EditorialCanvas.tsx`
- **Layer-order source of truth:** `src/lib/reportTemplate/paintOrder.ts` (`overlayPaintOrder`, `blockPaintOrder`)
- **Screen↔page coordinate mapping:** `src/lib/reportTemplate/overlayDropFactory.ts` (`screenToPagePoint`)
- **Visual QA capture surface:** `src/lib/reportTemplate/ingestion/visualQuality/generatedRenderCapture.ts`

`paintOrder.ts` is explicitly the single stacking source for the editor canvas,
the HTML/WeasyPrint renderer, and the jsPDF renderer — so any fidelity change that
touches stacking must go through it (or the new `layerOrdering.ts` above it), never
re-implemented per surface.

## 3. Current fidelity risks

- **Page scaling mismatch** — editor canvas zoom vs. renderer page box; if the two
  derive page size differently, overlays drift.
- **Background raster not matching page bounds** — a full-page PDF-import raster must
  fill the exact page box (`background-size:100% 100%`); any letterboxing shifts every
  overlay relative to the source.
- **Text overlays drifting from the source raster** — sub-pixel rounding / font metric
  differences accumulate down the page.
- **Inconsistent layer ordering** — background/source-raster/image/shape/table/text must
  stack identically across editor, export, and capture.
- **Browser font fallback mismatch** — a substituted font changes advance widths, so text
  wraps/positions differently than the source and than export.
- **Image crop/fit drift** — object-fit / crop rounding between editor and renderer.
- **Editor chrome accidentally included in capture** — selection handles, guides, and
  other `editor_control` layers must be excluded from the Visual QA render.

## 4. Fixes implemented

Phase 7D adds three shared, dependency-free, unit-tested primitives, and wires the
one that is safe to wire (see §4a):

- **`src/lib/reportTemplate/rendering/pageGeometry.ts`** — one definition of the page box
  and rect math: `normalizePageSize` (rejects non-finite / non-positive sizes),
  `getPageAspectRatio`, `pageBounds`, `scaleRect`, and `fitRectToPage` (clamps content
  inside the page, never producing negative extents). Targets *page scaling mismatch*,
  *raster/page-bounds mismatch*, and *image crop/fit drift*.
  Tests: `__tests__/pageGeometry.spec.ts`.

- **`src/lib/reportTemplate/rendering/layerOrdering.ts`** — a render-layer taxonomy
  (`page_background:0 < source_raster:10 < image:20 < shape:30 < table:40 < text:50 <
  unknown:60 < editor_control:100`) with `inferBlockLayerKind`, `getLayerRank`, and a
  stable `sortBlocksForRender` that honours a numeric `zIndex`/`z_index`/`style.zIndex`
  *within* a layer but never lets a block cross layers. Targets *inconsistent layer
  ordering* and *editor chrome in capture* (`editor_control` is a distinct, top-most,
  capture-excluded kind). Complements `paintOrder.ts` (which ranks within a layer)
  rather than replacing it. Tests: `__tests__/layerOrdering.spec.ts`.

- **`src/lib/reportTemplate/rendering/fontNormalization.ts`** — `normalizePdfFontFamily`
  (strips subset prefixes like `ABCDEE+` and style suffixes, canonicalises common faces),
  `buildFontStack` (CSS-safe stacks), and `resolveTemplateFontFamily` (→ a curated family,
  unknown/empty → `Inter`). Targets *browser font fallback mismatch*.
  Tests: `__tests__/fontNormalization.spec.ts`.

### 4a. Renderer integration (7D.5) — wired only where safe

The production renderer (`htmlRenderer.ts` / `pdfRenderer.ts`) is covered by the CI
**golden-render isolation guard** — any byte change to its output fails CI. It also
already contains the equivalent of most of these utilities, so wiring them there would
be duplication *and* would break the guard. Integration was therefore limited to the
one safe, non-golden surface:

- **Wired:** `EditorialCanvas.tsx` now derives its display page size via
  `normalizePageSize(page.size, { width: 595, height: 842 })`, replacing the ad-hoc
  `page.size.width || 595` / `page.size.height || 842`. Byte-identical for valid sizes;
  additionally rejects negative/partial-invalid sizes. Editor-display only — the export
  path is untouched.

- **Not wired — equivalent logic already exists (documented, not duplicated):**
  - *Layer/paint ordering:* `htmlRenderer.ts` and `EditorialCanvas.tsx` already stack via
    the shared `paintOrder.ts` (`sortBlocksForPaint` / `sortOverlaysForPaint`, with an
    explicit "never re-implement" note). `layerOrdering.ts` is the higher-level classifier
    for future/editor use; it is intentionally **not** substituted into the golden renderer.
  - *Page size in the export renderer:* reads schema-guaranteed `page.size` (defaulted to
    595×842) directly. `normalizePageSize` there would be a no-op for valid input and a
    golden-output risk otherwise.
  - *Source-raster / background bounds:* the renderer fills the page box with CSS
    `background-size: 100% 100%` (`imageFit: 'fill'`) — already equivalent to `pageBounds`.
  - *Fonts:* the golden renderer passes `fontFamily` through verbatim, and PDF font
    normalisation **already happens at the Docling ingestion boundary** — see §4c.

### 4b. Visual QA capture surface (7D.6) — verified correctly scoped

`generatedRenderCapture.ts` captures **page content only** and needs no patch:
- it targets `.tpl-page` nodes specifically (`querySelectorAll('.tpl-page')`) and runs
  `html2canvas` on each individual page element;
- when given a template it renders into a **hidden, isolated iframe** containing only
  `renderTemplateToHtml(template)` output — no editor DOM at all;
- so modal chrome, the editor toolbar, buttons, selection/resize handles, debug panels,
  and scrollbars (all siblings/ancestors of `.tpl-page`, never inside it) are excluded;
- capture background defaults to white to match PDF page rendering.

### 4c. Font normalisation at ingestion (7D "next step") — already handled

The recommended follow-up was "apply font normalisation at the ingestion boundary."
Investigation showed the Docling import path — the only path where raw PDF font names
enter — **already normalises fonts, more thoroughly than the generic
`fontNormalization.ts` helper:**

- `pdfImport/fontResolver.ts` (`resolveSourceFontFamily`, `resolveFontFamily`,
  `lookupEmbeddedFamily`, `fontLookupKey`) strips subset prefixes (`^[A-Z]{6}\+`),
  matches ~15 common faces (Helvetica→`Helvetica, Arial, sans-serif`, Times, Courier,
  Georgia, Calibri, Roboto, Inter, …), resolves against the Google-Fonts **catalog**,
  and prefers real embedded `@font-face` programs — with weight/style trimming.
- `pdfImport/fontFaceBuilder.ts` strips subset tags for embedded faces.

**Evidence:** distinct `fontFamily` values across recent import-created templates are
already resolved stacks — `"Helvetica, Arial, sans-serif"` (516×), `"Inter, Arial,
sans-serif"`, `"Menlo, Consolas, monospace"` — with **no subset-prefixed (`ABCDEE+…`)
names** anywhere. So raw PDF font names do **not** leak to the renderer.

Wiring the generic `resolveTemplateFontFamily` into this path would be a **regression**
(it would collapse embedded/catalog stacks like `"MyEmbedded", Arial` to `Inter`), so it
is intentionally **not** wired there. `fontNormalization.ts` remains a lightweight helper
for surfaces without the catalog.

**The one real gap fixed:** the CDIR→template mappers fell back to a bare literal
`'Helvetica'` when a text element carried no font info at all. A bare `Helvetica` is not
an installed face on the Linux/WeasyPrint export server and falls back inconsistently.
Those fallbacks now use a shared `DEFAULT_IMPORT_FONT_STACK`
(`'Helvetica, Arial, sans-serif'`, matching what `fontResolver` emits) in
`cdir/mapper.ts`, `cdir/adapters.ts`, and `docling/mapDoclingToPagePlan.ts` — so untyped
imported text renders consistently with resolved text. Import-time only; the golden export
fixtures are unaffected (verified by the golden-render guard).

## 5. Manual validation flow

```
Import PDF
→ Open editor
→ Compare source PDF against editor preview
→ Run Visual QA
→ Run Repair
→ Apply Repair
→ Compare again
```

## 6. Known remaining defects

- **Font normalisation at ingestion is handled** (see §4c): PDF fonts are already resolved
  by `pdfImport/fontResolver.ts`, and the bare-`Helvetica` fallback gap is fixed via
  `DEFAULT_IMPORT_FONT_STACK`. No advance-width reconciliation is attempted (a larger,
  separate effort), so a substituted face can still shift wrapping vs. the source raster.
- **`layerOrdering.ts` / `pageGeometry` rect helpers are not consumed by the golden
  renderer** — by design, because `paintOrder.ts` and the schema-valid page sizes are the
  equivalent existing logic and the renderer is golden-guarded. They are available for the
  editor and for the ingestion pipeline; `normalizePageSize` is wired into the editor canvas.
- **Editor-control exclusion** is defined as a layer kind (`editor_control`, rank 100) and is
  already achieved in practice by the capture targeting `.tpl-page` only; the taxonomy makes
  it explicit for any future capture path that renders from raw blocks.
