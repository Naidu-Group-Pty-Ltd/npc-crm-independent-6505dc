# Template Builder → Canva‑Style Editor — Rehaul Plan

> Status: **Phases 0–8 complete — V2 is the default editor** · Owner: Template Builder · Last updated: 2026‑06‑10
>
> Implementation status (2026‑06‑10): **Phase 0 done** — golden‑render guard
> (`__tests__/goldenRender.spec.ts`) + CI (`.github/workflows/ci.yml`), in‑editor Import
> dropdown (`TemplateBuilderEdit.tsx`), `ReferenceImportDialog` with pre‑apply validation, dead
> tldraw canvas removed. **Phase 1 done** — drag‑from‑palette → drop‑at‑cursor on `EditorialCanvas`
> (`onPaletteDrop` + `overlayDropFactory.ts`, behind the `templateEditorV2` flag with an in‑editor
> toggle), click‑to‑place, auto‑select on drop. **Deviation:** drag‑and‑drop ships on **native HTML5
> DnD**, not `@dnd‑kit` (the planned dep was unnecessary — do not add it). **Phases 2–7 audited as
> wired** (asset/element library, layers/align/group/page‑nav, text/image polish, visual data
> binding, onboarding/templates/command‑palette). **Phase 8 done** — `templateEditorV2` now defaults
> **ON**; V1 is a one‑flip kill‑switch (`?editorV2=0`, localStorage `'0'`, or
> `VITE_TEMPLATE_EDITOR_V2=0`). The R0–R6 PDF/image/URL reconstruction is live
> (`PDF_RECONSTRUCTION_ARCHITECTURE.md`), and the unified ingestion mechanism + Claude reconstruction
> core (`INGESTION_RECONSTRUCTION_EDITOR_PLAN.md`) are implemented — ingestion routing lives in
> `src/lib/reportTemplate/ingestion/`; raw‑codebase tiers C1/C2 are live (C3/C4 in progress).
>
> Locked decisions (see §6): **renderer‑safe free‑canvas** (free overlays + flowing data
> components), built as **Editor V2 behind a feature flag**, drag‑and‑drop via **native HTML5 DnD**
> (supersedes the original @dnd‑kit choice), isolation enforced by **golden‑render snapshot tests**.
> **The legacy jsPDF renderer and the WeasyPrint production path are not touched.**

## 1. Goal

Turn the Template Builder editor into an intuitive, drag‑and‑drop, Canva‑style authoring
experience, and restore + harden the "import a reference and have AI reconstruct it"
capability — **without changing a single byte of renderer output**. The editor only
*authors* the `ReportTemplate` JSON; the renderers *consume* it. That JSON is the contract,
and it is the only seam we work across.

## 2. Diagnosis (why it feels broken today)

| Symptom | Root cause | Severity |
|---|---|---|
| Can't import reference templates | Import entry point exists only on the list page (`TemplateBuilder.tsx:68`); **no Import button in the editor toolbar** (`TemplateBuilderEdit.tsx`). | Real regression |
| "Claude can't reconstruct it" | Capability still exists (Design Agent `screenshot_to_block`, AI Author/Gemini) but is buried and has **silent‑failure paths** (vision retries once → "no changes"; OCR `console.warn` only; AI gateway is a single point of failure). | Fragile/hidden |
| "Editor feels non‑functional" | Not code‑broken (Phase 5 memoization is correct). Interaction model is the problem: **click‑only "append to end"**, **no drag‑from‑palette‑onto‑canvas**, blocks are flow‑positioned, `TemplateCanvas.tsx` (tldraw) is dead code. | UX, not a crash |

The hard part already exists: `EditorialCanvas.tsx` is a working absolute‑positioning surface
(drag/resize/rotate/multi‑select/snap/inline‑edit). This is a **UX + entry‑point + asset‑library +
import‑flow** rehaul, not a new rendering engine.

## 3. Isolation contract (the non‑negotiable)

The editor and renderers meet at exactly one place: the `ReportTemplate` JSON (`templateSchema.ts`).

**🟢 Safe to change (editor‑only — renderers never import these):**
`src/components/templateBuilder/*`, `src/pages/admin/TemplateBuilderEdit.tsx`, `editorActions.ts`,
`previewCache.ts`, `sampleDataPresets.ts`, `snippetLibrary.ts`, `themePresets.ts`,
`starterTemplates.ts`, `templateDraftStore.ts`, `lintTemplate.ts`, `bindingValidation.ts`,
`pdfImport/*`, `aiAuthorClient.ts`, `analyticsClient.ts`, the import/AI dialogs, and any **new**
editor modules.

**🔴 Must not touch (feeds jsPDF + WeasyPrint production):**
`htmlRenderer.ts`, `weasyPreview.ts`, `pdfRenderer.ts`, `bindingResolver.ts`, `cssTokens.ts`,
`blocks/*.html.ts` + `blocks/*.ts`, `routeReportThroughTemplate.ts`, `resolveTemplate.ts` (+ edge
mirror), `buildBindingContext.ts` (+ edge mirror), `supabase/functions/render-template-pdf/*`,
the legacy `src/components/reports/*PDFGenerator.tsx`.

**⚠️ Extend‑only (the contract):** `templateSchema.ts` — we may **add new optional fields** that
the renderers ignore (e.g. `groupId`, `locked`, `name` on overlays; editor‑only UI hints). We
**never** rename/remove/repurpose existing fields, and **no new field may change render output**.

**Enforcement (built in Phase 0):** a **golden‑render snapshot suite** renders a set of canonical
templates through `renderTemplateToHtml` (and the jsPDF path) and snapshots the output. Every
rehaul PR must keep these **byte‑identical**. A change that alters renderer output fails CI. This
is how the "untouched" guarantee is *proven*, not asserted. PRs that modify any 🔴 file are
rejected by policy/review.

## 4. The renderer‑safe free‑canvas model

This is the resolution of "full free‑canvas" vs "don't touch the renderers":

- **Free‑placed elements = overlays** (text, image, shape, icon, line, frame). Overlays already
  carry absolute `x/y/w/h/rotation/opacity` in page coordinates and **both renderers already draw
  them absolutely**. → Full Canva‑style free placement, **zero renderer change**.
- **Data‑driven content = blocks** (tables, charts, KPI grids, repeaters). Blocks flow top‑to‑bottom
  in the page body (or snap into a content zone). They are inserted by drag but land in flow order.
- Net effect: ~90% of placement (everything decorative/textual/visual) is fully free‑canvas; data
  components compose as sections. No drift between editor and production.

> A future, separately‑approved initiative could add an *opt‑in absolute‑layout path* for data
> blocks — but that requires an additive change to `htmlRenderer.ts` and careful WeasyPrint
> pagination testing, and is explicitly **out of scope** for this rehaul.

## 5. Feature list (brainstorm)

**A. Reference import & AI reconstruction (restore + upgrade)**
- Prominent **"New / Import"** entry *inside* the editor (keep the list‑page one too).
- Unified **"Start from a reference"** modal: upload **PDF**, **image/screenshot**, **paste image**,
  or **drag a file onto the canvas**.
- Mode chooser: **Pixel‑exact** (raster bg + editable overlays), **Editable rebuild** (AI vision →
  native blocks+overlays), **Hybrid**.
- **Transparent progress + error surfacing** (replaces silent failures): per‑stage status
  (upload → extract/vision → assemble), retry, "what the AI saw" preview, partial‑accept.
- **"Reconstruct with Claude"** as a first‑class action on a selected reference image/region.
- Re‑sync flow kept, with schema validation before apply.

**B. Drag‑and‑drop canvas (Canva core)**
- Drag from palette → **drop on canvas at cursor** (create element at drop point).
- Move/resize/rotate/alt‑drag‑duplicate (exist) — polish.
- Click‑to‑place inserts at **viewport center** (not "end of page").
- Marquee/rubber‑band select; snap to grid, guides, margins, centers, equal spacing.
- Zoom to fit / to selection; pan; fit‑width.

**C. Left rail: element & asset library**
- Tabs: **Elements** (shapes/lines/icons/frames), **Text** (heading/sub/body + styles),
  **Uploads** (user images), **Brand** (logo, colors, fonts), **Components** (data blocks: table,
  chart, KPI, repeater — drag to place), **Templates** (starter pages/sections).
- Search, categories, recently used, favorites, mini previews, required‑data hints.

**D. Precision, layers & structure**
- **Layers/Outline panel**: z‑order, rename, lock, hide, group/ungroup (extend‑only `groupId`).
- **Align & distribute** toolbar; **match size**; nudge; copy/paste style (exists).
- **Multi‑page navigator** with thumbnails; drag‑reorder; duplicate/delete pages.

**E. Text & typography**
- Inline rich edit (exists) + floating text toolbar (font/size/weight/color/align/line‑height/
  letter‑spacing/lists).
- **Text style presets** bound to brand type scale; apply/create style.

**F. Images, shapes, icons**
- Uploads with crop/fit/replace‑in‑place; shape/divider/frame presets; bundled SVG icon set.

**G. Brand & theming (visual)**
- Brand kit in the rail: drop logo, click brand color → applies as `token:` binding; one‑click theme.

**H. Visual data binding**
- **"Bind to data"** picker over the sample‑data tree → inserts `{{path}}` (reuses existing
  resolver/validation — no resolver change). Repeater UX for lists. Live data switcher +
  "load real report" (exists).

**I. Onboarding & intuitiveness**
- Empty‑state with **Blank / From template / From reference**. First‑run coachmarks. Clear mode
  labels (**Design / Preview / PDF**). Command palette (exists) surfaced.

**J. Reuse what exists** — versions, drafts/recovery, approval/governance, presence/comments,
export, analytics, lint/QA, renderer‑capability badges — re‑homed into the cleaner shell.

## 6. Locked decisions

1. **Renderer‑safe free‑canvas**: free elements = overlays; data = flowing blocks. Zero renderer change.
2. **Editor V2 behind a `templateEditorV2` feature flag**, reusing the existing `EditorialCanvas` engine. V1 stays default and functional until Phase 8; rollback is one flag. (Most "isolated".)
3. ~~**@dnd‑kit** for drag‑and‑drop~~ → **Superseded:** ships on **native HTML5 DnD** (`overlayDropFactory.ts` + `onPaletteDrop`). The `@dnd-kit` dep was unnecessary and is **not** installed.
4. **Golden‑render snapshot tests are Phase 0** and gate every subsequent PR (CI: `.github/workflows/ci.yml`).
5. **🔴 renderer-file edits are policy-blocked** via `.github/CODEOWNERS`; any PR touching the locked surface requires explicit approval.

## 7. Phased implementation plan

Every phase: ships independently, lives behind `templateEditorV2`, touches only 🟢 modules, and
keeps golden‑render tests green.

### Phase 0 — Triage, restore & guardrails
- Restore an **Import / "New from reference"** button in the editor toolbar (re‑wire existing
  `ImportPdfDialog` + Design Agent; no new pipeline yet).
- Make AI reconstruction **honest**: surface vision/OCR failures, add retry, kill silent
  "no changes", show partial results.
- Add **golden‑render snapshot suite** + a **CI workflow** (typecheck + vitest + build) so the whole
  rehaul has verification and the "untouched renderer" guarantee is enforced.
- Delete dead `TemplateCanvas.tsx` (tldraw).
- *Acceptance:* import + reconstruct from inside the editor again; failures visible; renderers
  proven unchanged by golden tests; CI runs on every PR.

### Phase 1 — Drag‑and‑drop foundation + V2 shell (flagged)
- Add @dnd‑kit; palette→canvas drop‑to‑place (overlay at drop coords) + reorder.
- New `TemplateEditorV2` shell composing existing `EditorialCanvas` + new rail/toolbar; V1 default.
- Click‑to‑place at viewport center; drop at cursor.
- *Acceptance:* drag Text/Rectangle onto the page; lands where dropped; undo/redo intact; V1 unaffected.

### Phase 2 — Element & asset library + palette redesign
- Tabbed left rail (Elements/Text/Uploads/Brand/Components/Templates) with search/categories/
  recents/favorites/mini‑previews; every item maps to a pure `editorActions` insert.
- *Acceptance:* all block/overlay types insertable via drag; searchable; data components show
  required‑data hints.

### Phase 3 — Unified reference import & AI reconstruction
- Full "Start from a reference" modal (PDF/image/paste/drag), mode chooser, staged progress,
  "what Claude saw", retry/partial‑accept; re‑sync with pre‑apply schema validation.
- *Acceptance:* import a PDF and a screenshot; get an editable reconstruction; errors actionable;
  production schema valid (golden tests green).

### Phase 4 — Precision: layers, align/distribute, grouping, page navigator
- Layers/outline panel (z‑order, lock, hide, rename, group via extend‑only `groupId`); align/
  distribute toolbar; multi‑page thumbnail navigator with drag reorder.
- *Acceptance:* arrange overlapping elements, align a row, group/lock, reorder pages — renderer‑safe.

### Phase 5 — Text, image & shape polish
- Floating text toolbar + text style presets (brand type scale); upload manager, crop/fit/replace;
  shape/icon presets.
- *Acceptance:* full text styling + image handling without opening the inspector for common tasks.

### Phase 6 — Visual data binding
- "Bind to data" picker over the sample‑data tree; repeater UX; live data switcher.
- *Acceptance:* bind a heading to `{{property.address}}` by clicking; preview with real report;
  **no binding‑resolver changes**.

### Phase 7 — Onboarding, templates gallery, mode rename, a11y
- Empty states, coachmarks, clearer mode labels, keyboard map, templates gallery.
- *Acceptance:* a new user builds a simple branded page from a template without docs.

### Phase 8 — Hardening & rollout
- Perf (large/multi‑page), a11y, unit/integration/e2e, docs; then **flip the flag** to make V2
  default; keep V1 behind a kill‑switch for one release.
- *Acceptance:* V2 default; golden‑render tests still byte‑identical; rollback is one flag.

## 8. Risk register

| Risk | Mitigation |
|---|---|
| A change leaks into renderer output | Golden‑render snapshot tests + 🔴 do‑not‑touch list; PRs touching 🔴 files rejected |
| Schema drift breaks production parse | Extend‑only policy; `parseTemplate`/`salvageTemplate` tolerance; schema round‑trip test |
| Rehaul destabilizes current users | Everything behind `templateEditorV2`; V1 default until Phase 8 |
| AI reconstruction unreliable | Phase 0 makes failures visible + retryable; partial‑accept; (later) gateway fallback |
| Scope sprawl | Phases 0–3 restore + core value first; 4–7 additive polish; each phase shippable |

## 9. Execution order

**Milestone 1 (restore + foundation):** Phase 0 → 1 → 2.
**Milestone 2 (the headline feature):** Phase 3.
**Milestone 3 (pro tools):** Phase 4 → 5 → 6.
**Milestone 4 (polish + flip):** Phase 7 → 8.

## 10. Verification note

This repo currently has **no build/test CI workflow** (only GitGuardian secret scanning), and the
sandbox cannot `npm install` (package‑proxy 403). Phase 0 adds the CI workflow precisely so this
rehaul gets real `typecheck + vitest + build` verification on every PR — without it, the isolation
guarantee can't be machine‑enforced.
