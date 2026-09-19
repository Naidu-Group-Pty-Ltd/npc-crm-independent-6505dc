# PDF Template Builder

A visual editor for all PDF reports. The same `ReportTemplate` JSON drives the live editor (canvas + inspector) and the production renderer. Production PDFs are rendered through the **HTML → WeasyPrint** pipeline; the legacy `jsPDF` / `pdf-lib` renderer remains as a secondary/fallback path that does not support every block. Preview and export stay in sync **for the selected production engine** — blocks that are only `partial` or `unsupported` on that engine are flagged by the linter (`renderer-partial` / `renderer-unsupported`) and block activation. See [Print-safety lint](#print-safety-lint-phase-5) and [Governance and activation safety](#governance-and-activation-safety) below.

## Quick start

1. Visit `/admin/template-builder` with `templates` module access. Creating, editing, importing, and deleting templates require the matching `templates` edit/delete permissions; superadmins retain full access.
2. Create a template, pick a report type and tier.
3. Drop blocks from the Insert panel onto the active page.
4. Bind any field to live data with `{{property.address}}` or to a brand token with `token:primary`.
5. Use ⌘Z / ⌘⇧Z to undo/redo, ⌘C / ⌘V / ⌘D to copy/paste/duplicate the selected block.

## V2 editor — Canva-style drag-and-drop (default ON)

A drag-and-drop editing experience layered on the existing canvas. Since rehaul
Phase 8, V2 is the **default** editor; the `templateEditorV2` flag remains as a
one-flip kill-switch back to the classic (V1) experience.

**Disable it (rollback):** `?editorV2=0` per visit, the Advanced menu toggle
(localStorage `template-editor-v2='0'`) per browser, or `VITE_TEMPLATE_EDITOR_V2=0`
at build time. `?editorV2=1` / `=1` values force it on regardless of other settings.

What V2 adds (all renderer-safe — it only authors the same `ReportTemplate` JSON):

- **Drag-to-place** — drag any item from the Insert palette onto the canvas. Free elements
  (text/image/shape/icon) land at the cursor (`positionOverlayAtPoint`); data blocks
  (tables/charts/KPIs) flow into the page. A dashed outline marks the drop target.
- **Floating text toolbar** — select a text element for inline size / bold / italic / align /
  colour without opening the inspector.
- **"Start from a reference"** (Import menu) — drag/click/paste a **PDF, image, or document**:
  PDFs re-sync with a fidelity-mode chooser + staged progress; images are reconstructed by AI
  (`template-design-agent` `screenshot_to_block`) into editable blocks; **Word/plain-text/RTF
  documents** (`.docx`/`.txt`/`.rtf`) are converted to semantic HTML (`ingestion/docConvert.ts` —
  headings, formatted runs, lists, tables, embedded images) and replicated onto the canvas through
  the C1 code pipeline (render → measure DOM → CDIR editable pages). The result is
  **validated** (`validateReconstructedSchema`) before it is applied, and the success card offers
  a one-click jump to the **Cascade** tab to map which imported sections ingest the
  report-structure chunks.
- **Required-data hints** on data components, and a one-time **coachmark** on first use.

**Isolation guarantee:** V2 never touches the jsPDF or WeasyPrint renderers. A golden-render
snapshot test (`goldenRender.spec.ts`) runs in CI and fails if renderer output changes, so V1
and V2 produce byte-identical output for the same template. CI (`.github/workflows/ci.yml`)
runs the Template Builder test suite + `npm run build` on every PR.

**Rollout (Phase 8 — done):** the default was flipped ON in
`resolveEditorV2Flag` (`editorV2Flag.ts`); the kill-switch above remains available.
Full design + phase history:
[`TEMPLATE_BUILDER_REHAUL_PLAN.md`](./TEMPLATE_BUILDER_REHAUL_PLAN.md).

## Bindings

Every text/image/colour field accepts:

| Form | Example | Notes |
|------|---------|-------|
| Literal | `Hello world` | Rendered as-is |
| Data binding | `{{property.address}}` | Resolved against report data at render time |
| Filter | `{{financials.weeklyRent \| currency}}` | Filters: `currency`, `number`, `percent`, `date`, `upper`, `lower`, `default` |
| Brand token | `token:primary` | Looked up in `template.tokens` (with brand fallback) |
| Conditional (block-level) | `tier === 'compass'` | Sandboxed expression; block hidden when false |

Open the **bindings popover** in the header to see every unresolved binding and click to jump straight to the offending block.


## Report cascade anchors

The Template Builder can map the configured report-generation structure to exact visual targets in the final PDF. Use the **Cascade** tab to load the active `report_structure_templates` AI-structure guide for the template's report type/tier, then assign section or field anchors to the currently selected block or overlay. If the design already contains `{{sections.*}}` bindings, the tab suggests matching anchors and can auto-map them in bulk before manual cleanup; designers can also opt into anchoring repeated uses of the same generated field when every repeated occurrence should be traceable.

Anchors are stored in the template schema on blocks/overlays as optional `anchors[]` metadata. They do not replace normal `{{binding.path}}` values; they explain which report-structure section/field owns a visual region and let the builder warn about required sections with no landing point, bindings outside the selected structure, duplicate anchors, and generated data that is not used in the design. Mapping a **field** anchor onto a selected text/image/table overlay also rewrites the overlay's value to the matching `{{sections.<id>.<field>}}` binding, so the section content flows into that region at render time.

**Render-time section ingestion.** Generated reports store their body as one combined markdown string (`investment_reports.report_content`). At render time the binding context chunks that markdown into `sections.<sectionId>.{title, body, highlights}` (`src/lib/reportTemplate/reportSections.ts`, edge mirror `supabase/functions/_shared/reportSections.ts`): the report is split at its section headings, each chunk is keyed with the same slugification the Cascade contract uses, and report headings are alias-matched against the active `report_structure_templates` guide's headings (numbering and "&"/"and" differences are tolerated) so chunk ids line up with the contract ids shown in the Cascade tab. Bodies are delivered as renderer-safe plain text (markdown emphasis, citations, tables, and legacy `{{bars:…}}`/`{{timeline:…}}` directives are cleaned), `highlights` carries the section's first bullet points, and structured (object) `report_content` passes through unchanged. In the editor, placeholder `sections.*` sample content is derived from the cascade contract (`withSampleSectionData`) so mapped bindings preview with copy before a real report is loaded — user-typed sample `sections` keys always win.

In final PDF preview, enable **Cascade tags** to render visible proof labels and append a debug-only Cascade anchor index page. Normal client PDFs remain clean, while the WeasyPrint HTML render can still emit non-visual `data-cascade-*` metadata for traceability. Activation readiness includes cascade coverage and QA approval, so approved templates cannot be activated while required report-structure sections have no mapped, QA-approved PDF anchor. The activation popover also summarizes Cascade coverage, missing required sections, and outstanding auto-map suggestions before activation. Selected blocks/overlays expose a **Cascade anchors** editor for reviewing, removing, manually adjusting mappings created from the Cascade tab, and recording QA owner/status/notes for signoff. The Cascade tab can also bulk-update QA status for filtered anchors, assign reviewer ownership/notes, copy a JSON manifest, or download JSON/CSV diagnostics that list every configured structure section, field, mapped page/block/overlay target, and activation issue for QA handoff. Version snapshots record a concise Cascade readiness note and the Versions tab recomputes Cascade coverage/QA chips plus a side-by-side comparison for saved schemas so reviewers can compare mapping health across revisions.

## Block library

Cover · Hero · KPI grid · Data table · Chart · Image · Text · Footer · Disclaimer · Divider · Callout · Two-column · Gallery · Page number · Spacer · QR code · Badge list · Contents (TOC) · Signature · Slot · Free overlays.

Each block exposes its own inspector schema (`BLOCK_DEFS`) — extend the registry by adding a renderer + def in `src/lib/reportTemplate/blocks/`. The block registry also declares renderer capabilities for HTML, WeasyPrint, and jsPDF so the builder can warn when a block is production-safe only in the HTML/WeasyPrint pipeline or fully unsupported.

## Reusable slots (Phase 4)

Define a Header / Footer / etc. once in the **Slots** tab, then drop a `slot` block on any page with the matching `slotKey`. Editing the slot updates every page that references it.

## Brand tokens

The **Tokens** tab manages the `tokens.colors`, `tokens.fonts`, and `tokens.spacing` records. Click **Sync from brand** to pull the active `BrandProvider` primary/accent into the `primary` and `accent` token slots. Tokens can be exported / imported as JSON to share themes between templates.

## Print-safety lint (Phase 5)

The **Print safe / N lint** badge in the header surfaces issues that would break the printed PDF:

- `bleed` — overlay extends outside page bounds
- `overlap-edge` — overlay sits within 12pt of the page edge
- `missing-font` — font not bundled with jsPDF (Helvetica / Times / Courier); will fall back
- `tiny-text` — font size below 7pt
- `low-contrast` — text vs page background contrast under WCAG AA (4.5:1)
- `missing-slot` — `slot` block references a key that isn't defined
- `renderer-partial` — block is production-safe but has a renderer caveat, such as a jsPDF placeholder
- `renderer-unsupported` — block has no production HTML/WeasyPrint renderer and blocks activation

Click any issue to jump to the exact block / overlay. Activation readiness separates production renderer blockers from general print-safety errors so reviewers can distinguish export-fidelity caveats from hard activation failures. The **Compatibility** tab provides the same renderer findings grouped by page plus a block capability matrix for every block type currently used in the template. Activation and export actions run renderer pre-flight checks: unsupported production renderers block the action, while partial/legacy renderer caveats require confirmation before continuing. Heavy binding/lint/compatibility analysis is deferred during editing so large templates remain responsive, while activation/export pre-flight runs against the current template state. The secure template API repeats the production-renderer validation during activation so unsupported block types cannot be activated outside the editor UI.

## Versions

Every save can optionally **snapshot** the current schema into `report_template_versions`. From the Versions tab you can:

- **Load** a version into the editor (no save)
- **Restore** a version (snapshots the current schema first, then writes the restored one)
- **Clone as new** (creates a new template from the version's schema)

## Local drafts & recovery

While you edit, the builder **autosaves a local draft to IndexedDB** (per template, debounced ~2s after the last change). This never touches the server — you still **Save** the server copy manually — so autosave can't cause version conflicts.

- If you reload, crash, or navigate away and come back, and the local draft differs from the saved server version, a **recovery dialog** offers to **Restore draft**, **Discard draft**, **Compare JSON**, or **Save as branch**.
- If the server moved on since the draft was taken (someone else saved), the dialog warns that the draft is based on an older version.
- The local draft is cleared automatically after a successful **Save**, or when you explicitly discard it / choose **Review latest** in a save conflict.
- The toolbar status shows `autosaved HH:MM` while there are unsaved changes; hover the status chip for last-saved, last-autosaved, and "unsaved since" times.

Drafts are browser-local (IndexedDB) — they are not shared across devices or users, and degrade to a no-op where IndexedDB is unavailable.

## Report type adapters (Phase 7)

Template Builder production routing is adapter-driven. The generic router never reaches directly into a report table; it asks the adapter registry in `src/lib/reportTemplate/adapters/` to resolve routing metadata and build the binding context for a real report.

| Report type | Status | Notes |
|-------------|--------|-------|
| Investment Report | Production enabled | Uses `investment_reports`, builds the existing `report/property/financials/scores/...` binding shape, and preserves the legacy fallback when no active WeasyPrint template matches. |
| Portfolio Analysis | Preview only | Listed in the builder and can be designed with sample data, but activation is blocked until an adapter is implemented. |
| Cash Flow | Preview only | Legacy generator remains the production path until an adapter is added. |
| Borrowing Capacity | Preview only | Legacy generator remains the production path until an adapter is added. |
| Q&A Export | Preview only | Legacy generator remains the production path until an adapter is added. |
| Suburb / Postcode / Statewide / Comparison / Formara | Preview only | Available for template design and sample-data validation; production routing is intentionally disabled. |

The editor settings panel shows the selected report type's adapter status as **Production enabled**, **Preview only**, or **Not configured**. Activation readiness also blocks preview-only types so production cannot accidentally route through an incomplete adapter.

### Adding an adapter

1. Create an adapter file under `src/lib/reportTemplate/adapters/` that implements `ReportTemplateAdapter`.
2. Implement `resolveRoutingContext({ reportId })` to return the report type, variant, tier, source table, and fallback descriptor used by the production router.
3. Implement `buildBindingContext({ reportId, brand })` to return the exact binding data shape templates should consume.
4. Register the adapter in `REPORT_TEMPLATE_ADAPTERS` in `src/lib/reportTemplate/adapters/index.ts`.
5. Mark `supportsProduction: true` only after the report type has a real routing context, binding context, fallback story, and sample/report loading path.
6. Add adapter tests that verify route context, binding context shape, sample presets, and fallback behavior.

## Governance and activation safety

Templates locked for review cannot be edited, snapshotted, or deleted until unlocked. Activating a template or marking it as the default requires superadmin access, an approved template status, a report type, and a production-enabled adapter for that report type. Active templates must be deactivated before deletion.

## Performance

The editor is tuned to stay responsive on large, multi-page templates:

- **Deferred analysis with per-page payloads** — active-page binding/lint checks run synchronously, while full-document analysis is debounced (180ms) into a Web Worker with an idle-callback fallback (`useTemplateAnalysis`), so typing and dragging are never blocked by validation. Requests use the `templateAnalysisProtocol` wire format (rehaul Phase 3): only pages whose content changed are shipped to the worker — unchanged pages travel as tiny stubs and the worker reassembles the document from its cache, so a one-page edit clones one page across the thread boundary instead of the whole template. Issue panels show an "Updating…" state while analysis catches up; activation/export pre-flight always runs against the live state.
- **Content-keyed previews, O(changed) keys** — both the live HTML preview and the editorial canvas render their iframe `srcDoc` through a render that is memoized on a *content* signature (`makePreviewKey` / `makeCanvasRenderKey` in `previewCache.ts`), not object identity. Since rehaul Phase 3, serialization behind these keys is identity-memoized (`stableJson`, WeakMap): the store's immutable updates structurally share unchanged pages, so an edit re-serializes only the changed page/field instead of `JSON.stringify`-ing the whole document on every keystroke.
- **Per-page section cache for the document preview** — in "All pages" scope, `renderTemplateToHtml` accepts a caller-owned `pageCache`: page sections whose content and cross-page context (index, page count, ids/names, TOC, data, tokens) are unchanged are stitched from cache, so editing one page re-renders only that page's section. Pinned byte-identical to uncached renders by `htmlRendererPageCache.spec.ts`.
- **Overlay drags don't reload the canvas** — the canvas hides overlays and draws its own handles, so its render key deliberately excludes overlay geometry. Moving/resizing/adding/removing an overlay updates only the React handle layer; the page-background iframe is not rebuilt on every pointer tick.
- **PDF tab renders on demand** — the WeasyPrint round-trip is expensive, so the "Final PDF" tab renders once on open and then only when explicitly refreshed (`useWeasyPdfPreview`). Edits flip a cheap content-key `stale` flag that surfaces an "Out of date" badge + "Render latest" button; the live HTML preview is the realtime surface.
- **Memoized panels + slice subscriptions** — `PagesPanel`, `EditorialCanvas`, `PropertiesInspector`, `OutlinePanel`, and `LiveHtmlPreview` subscribe to store slices (`templateEditorStore`) instead of receiving the document through props, and every mutator is a permanently identity-stable store action. Unrelated editor state (dialogs, presence, save status) never re-renders the heavy surfaces, and `PagesPanel` only re-renders when `template.pages` itself changes.
- **Lazy dialogs** — the ~20 heavy dialogs (Export pipeline, AI author, Design agent, Reference import, version history, …) are `React.lazy` behind `MountOnFirstOpen`: they're code-split out of the editor chunk and mount only on first open (then stay mounted so their internal state survives close/re-open).

### Editor state (rehaul Phase 2)

The document state machine lives in **`src/stores/templateEditorStore.ts`** (zustand):

- **State**: `template`, `activePageId`, `selectedBlockId`, `selectedOverlayId`, `multiOverlayIds`. Undo/redo stacks and the governance flag are non-reactive closure state (history bookkeeping never triggers renders).
- **Actions**: `setTemplate` (records patch-based history, capped at 80 entries, rejected with a toast while governance-locked), `loadTemplate` (silent hydration — clears history), `undo`/`redo`, every page/block/overlay mutator, and all selection handlers. Actions read fresh state via `get()`, so they are **permanently identity-stable** — no `useCallback` dependency churn, no stale-closure bugs.
- **Slice hooks**: `useEditorTemplate`, `useEditorPages`, `useActivePage`, `useSelectedOverlay` return reference-stable selections; `templateEditorActions()` hands out the stable action bundle without subscribing.
- **Single instance**: one editor session at a time; `resetTemplateEditor()` runs on editor mount (via `useTemplateHistory`).
- Contracts are pinned by `src/stores/__tests__/templateEditorStore.spec.ts`.

`TemplateBuilderEdit` composes façade hooks from `src/hooks/templateBuilder/`:

- **`useTemplateHistory`** — store façade: template + undo/redo + governance guard (starts a fresh session on mount).
- **`useTemplateMutators`** — store façade: the subset of mutators the page itself still calls; panels pull theirs straight from the store.
- **`useEditorKeyboardShortcuts`** — single window keydown listener dispatching via the latest-ref pattern (no stale closures, no re-binding).
- **`useWeasyPdfPreview`** — render-on-demand production-parity PDF preview through the shared `weasyRenderClient` (same client the Export menu uses): renders once on tab open, then flags `stale` on edits and re-renders only on explicit refresh.

## Output quality hardening (rehaul Phase 4)

- **Per-format export capability warnings** — `exportCapability.ts` analyzes what each lossy export will actually drop: DOCX carries text overlays only, PPTX carries text/image/shape overlays, and both omit structured block bodies; legacy jsPDF renders HTML-first blocks as placeholders and unregistered blocks not at all. `ExportPipelineDialog` shows the per-format findings above the download buttons and itemizes them in a format-specific confirm before DOCX/PPTX downloads (errors block, warnings prompt). Pinned by `exportCapability.spec.ts`.
- **Resolver ranking lives in SQL** — `resolve_report_template(p_report_type, p_variant, p_agency_id, p_user_id)` (migration `20260611120000`) ranks active `report_templates` rows by scope precedence (user > agency > global-variant > global-any), `priority DESC`, `updated_at DESC` and returns the single winner + source label. Both the client resolver (`src/lib/reportTemplate/resolveTemplate.ts`) and the edge resolver (`supabase/functions/_shared/resolveReportTemplate.ts`) call the RPC first; an empty RPC result is an authoritative no-match. The previous JS ranking survives only as a fallback for pre-migration deployments (and unlike the SQL path, it ranks at most the 200 most recently updated rows).
- **Client/edge resolver parity is mechanical** — the old "KEEP IN SYNC" comments are replaced by `resolveTemplateParity.spec.ts`, which runs both `rankReportTemplates` implementations over a fixed scenario matrix plus 250 seeded randomized row sets, and exercises the full resolve flows (RPC-first, authoritative no-match, fallback parity).
- **Schema versions are validated, not clobbered** — server-side writes no longer stamp `schema.version = 1` blindly. `supabase/functions/_shared/templateSchemaVersion.ts` validates the declared version and applies explicit stepwise migrations up to the supported version; missing/null versions are treated as legacy v1, while future or malformed versions are rejected (`manage-templates` returns a 422 with code `unsupported_schema_version`). Pinned by `templateSchemaVersion.spec.ts`.

## Architecture

```
report_templates (DB)
  ├─ tokens   { colors, fonts, spacing }
  ├─ slots    { header, footer, ... } (Phase 4)
  └─ pages[]
       ├─ size, background
       └─ blocks[]
            ├─ type, props
            ├─ overlays[]
            └─ conditional?
```

- **`templateSchema.ts`** — Zod schema + types
- **`bindingResolver.ts`** — `{{path | filter}}`, `token:xxx`, conditional evaluator
- **`bindingValidation.ts`** — pre-export binding linter
- **`lintTemplate.ts`** — print-safety linter
- **`pdfRenderer.ts`** — pure `(template, data, brand) → Blob`
- **`adapters/`** — report-type registry and production binding/routing adapters
- **`blocks/*.ts`** — one file per block type (renderer + def)

## Adding a new block type

1. Create `src/lib/reportTemplate/blocks/myBlock.ts` exporting `drawMyBlock(block, ctx)`.
2. Register the renderer in `BLOCK_RENDERERS` in `blocks/index.ts`.
3. Add a `BLOCK_DEFS` entry: `defaultProps()` + `fields[]` (drives the inspector UI).
4. Add to the `PALETTE` in `PagesPanel.tsx` so users can insert it.

## Migration of legacy generators

Existing PDF generators (`PixelPerfectPDFGenerator`, cash-flow, Q&A, borrowing, disclaimer page) remain the production path. The plan is to wrap each as a seeded default template behind a per-report-type feature flag in a follow-up phase. The `disclaimer` block already ports the legacy `drawJsPDFDisclaimerPage` 1:1 as the reference implementation.
