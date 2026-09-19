# Ingestion Mechanism · Claude Reconstruction Core · Template‑Builder Editor — Implementation Plan

> Status: **Plan, pre‑execution** · Last updated: 2026‑06‑10 · Scope: a unified multi‑input
> ingestion mechanism (PDF · image · URL · raw codebases · Figma), reconstruction of the design
> into the editable `ReportTemplate` (exportable to any format) using **Claude's latest model
> (`claude-opus-4-8`)**, and execution of the approved Canva‑style editor rehaul.
>
> Locked decisions (see §8): (1) raw‑codebase ingestion accepts **all four input shapes**
> (HTML/CSS, live URL, React/JSX, full repo/zip) for maximum compatibility; (2) reconstruction is
> **Claude‑primary with Gemini/GPT fallback**; (3) sequencing is **Phase 0 → Claude core →
> Ingestion → Editor**. This plan is renderer‑safe: it never changes a byte of `htmlRenderer.ts`,
> `pdfRenderer.ts`, or the WeasyPrint path, enforced by golden‑render tests.

## 1. Current state (grounded)

| Area | State | Key files |
|---|---|---|
| Editor engine | Working Canva‑style absolute‑positioning surface (drag/resize/rotate/multi‑select/snap/inline‑edit). SSOT = `ReportTemplate` JSON (pages → blocks → overlays: `text`/`image`/`shape`/`table`/`vector`). Pure `editorActions`, patch undo/redo, IndexedDB autosave. | `EditorialCanvas.tsx`, `templateSchema.ts`, `editorActions*.ts`, `templateHistory.ts` |
| Editor V2 "Canva" rehaul | **Approved but unbuilt** — only the `templateEditorV2` flag exists; `@dnd-kit` not installed; dead tldraw `TemplateCanvas.tsx` present. | `editorV2Flag.ts`, `docs/TEMPLATE_BUILDER_REHAUL_PLAN.md` |
| Reconstruction pipeline | **Built (R0–R6)** for PDF + image + URL: deterministic extraction (text geometry/colour, vectors→SVG, embedded `data:` fonts, images) → AI grounded‑classify → per‑region SSIM fidelity loop. | `pdfImport/extractPdfToTemplate.ts`, `textLayout.ts`, `textColor.ts`, `vectorExtract.ts`, `fontFaceBuilder.ts`, `imageExtract.ts`, `imageGrounding.ts`, `fidelityMetrics.ts`, `docs/PDF_RECONSTRUCTION_ARCHITECTURE.md` |
| Ingestion | **Per‑type / ad‑hoc** — no unified mechanism. `referenceImport.ts` detects pdf/image; `importUrl.ts` + `import-from-url` edge fn (SSRF‑guarded) handle links. **No raw‑codebase ingestion.** | `referenceImport.ts`, `ReferenceImportDialog.tsx`, `import-from-url/` |
| AI model layer | All AI routed by `agent_key` via `agent_model_assignments` table → `llmRouter.ts` (gateway/native/openrouter + fallback). Reconstruction runs on Gemini/GPT; Claude used only conditionally and defaults to `claude-opus-4-5`. | `_shared/llmRouter.ts`, `_shared/anthropicAdapter.ts`, `template-design-agent/index.ts` |
| Output formats | Editable `ReportTemplate` → existing exporters for **PDF (WeasyPrint), DOCX (`docx`), PPTX (`pptxgenjs`), HTML**. | `htmlRenderer.ts`, export pipeline |

**Two critical gaps for "Claude's latest model":**
1. The router's **native Anthropic path is text‑only** — it `JSON.stringify`s message content, so **no vision/PDF** reaches Claude.
2. Both Anthropic call‑sites use **`claude-opus-4-5`** + `temperature` (which 400s on Opus 4.7/4.8) and use none of: native PDF `document` blocks, adaptive thinking, `effort`, structured outputs, prompt caching.

**Target model — `claude-opus-4-8`:** 1M context, native high‑res vision (2576px), **native PDF document input**, adaptive thinking, `effort` (low→max), structured outputs (`output_config.format`), prompt caching, 128K streamed output. No `temperature`/`top_p`/`budget_tokens` (those 400).

## 2. Target architecture

Three workstreams over one stable contract — the `ReportTemplate` JSON. The renderers are the locked output side and are not touched (golden‑render‑gated).

```
INGESTION (WS1)                RECONSTRUCTION CORE (WS2)            EDITOR (WS3)
 Source registry (subfns)       Deterministic extract → LAYOUT →     Editor V2 (Canva shell)
  • pdf • image • url            AI grounded-classify (Claude 4.8      • "Start from a reference"
  • code • figma • paste           vision/PDF, structured ops) →         modal = WS1 front door
       ↓ normalize              MAP→schema → VERIFY (SSIM loop)        • drag/drop, layers, bind
  ExtractionResult ──────────────────────▶ ReportTemplate JSON ──────────▶ export PDF/DOCX/PPTX/HTML
```

## 3. Workstream 1 — Unified ingestion mechanism (façade + subfunctions)

New editor‑only module `src/lib/reportTemplate/ingestion/` (🟢 safe zone). One entry point, pluggable per‑input subfunctions, all normalizing to a shared `ExtractionResult` that feeds the existing reconstruction pipeline.

### 3.1 Registry / façade

```ts
interface ExtractionResult {
  kind: 'pdf' | 'image' | 'code' | 'url' | 'figma';
  pages: Array<{ raster?: Blob; elements: GroundedElement[]; width: number; height: number }>;
  tokens?: Partial<Tokens>;
  assets: UploadedAsset[];
  source: { filename?: string; provider?: string; bytes?: number };
}
interface IngestionSource {
  id: string;
  accepts(input: IngestionInput): boolean;          // mime / extension / url / payload sniff
  extract(input, ctx): Promise<ExtractionResult>;
}
const SOURCES = [pdfSource, imageSource, codeSource, urlSource, figmaSource]; // first match wins
export function resolveSource(input): IngestionSource;
export async function ingest(input): Promise<ExtractionResult>;
```

Subfunctions **wrap existing work**, not rewrite it:
- `pdfSource` → wraps `extractPdfToTemplate`.
- `imageSource` → wraps `imageGrounding` (OCR‑measured elements + raster).
- `urlSource` → wraps `importUrl` + `import-from-url`, dispatches to pdf/image/code by content‑type.
- `figmaSource` → wraps Figma export; later upgraded to frame/layer hierarchy.
- `codeSource` → **new** (below).

### 3.2 New: raw‑codebase subfunction — `render-source` service + tiered inputs

A "raw codebase" is **rendered, then reconstructed** — the same pattern as the WeasyPrint microservice, reused for the headless render the docs already flag as the missing piece for Figma/Canva/Gamma/live pages. New Deno + headless‑Chromium/Playwright edge service **`render-source`** returns **(a) a screenshot raster** and **(b) a serialized DOM box tree** (computed positions, text runs, colours, fonts, image URLs). The DOM box tree maps directly to `GroundedElement[]`, so R5 grounded‑classify + R6 fidelity loop work unchanged.

All four input shapes are supported, shipped as escalating tiers:

| Tier | Input | Handling | Sandbox cost |
|---|---|---|---|
| **C1** | HTML/CSS/Tailwind bundle | Render markup+CSS headless → box tree + raster. | Low |
| **C2** | Live URL (incl. Figma/Canva/Gamma "code‑built", any web page) | SSRF‑guarded fetch → headless render → box tree + raster. Closes the existing `needs_export` gap. | Low |
| **C3** | React/JSX component source | Transpile/bundle (esbuild) in a sandbox → mount → render → box tree + raster. | Medium |
| **C4** | Full repo / zip upload | Detect framework + entry, install deps + build in an isolated build container, serve, render. | High (job‑queued) |

Security: `render-source` reuses the `import-from-url` SSRF/size/timeout guards; the renderer/build runs sandboxed (no host network, CPU/mem/time caps); untrusted JS from uploaded repos never executes outside the sandbox.

### 3.3 Storage / DB
Reuse bucket `template-import-assets` and the `template_imports` job table; record source kind + code‑specific meta (entry file, framework, build status) in `meta` jsonb. No schema breakage.

## 4. Workstream 2 — Claude reconstruction core (`claude-opus-4-8`, Claude‑primary + fallback)

New `_shared/claudeReconstruct.ts` (raw `fetch`, matching the existing Deno idiom), used by `template-design-agent` for `screenshot_to_block` / reconstruct / `art_director`:

- **Model:** `claude-opus-4-8` (env‑overridable; default updated from `claude-opus-4-5`).
- **Multimodal input:** base64 `image` blocks **and** native PDF `document` blocks (`source.type:'base64'`, `media_type:'application/pdf'`) — PDFs/scans can go to Claude directly when deterministic extraction is insufficient.
- **Structured output:** `output_config.format` (json_schema) for the `apply_changes` op list — guarantees parseable, schema‑valid operations.
- **Reasoning:** `thinking:{type:'adaptive'}` + `output_config:{effort:'high'}` (`xhigh` for full‑page reconstructs). **Remove `temperature`** (400s on 4.8).
- **Prompt caching:** `cache_control:{type:'ephemeral'}` on the large static reconstruction system prompt (big saver across the fidelity‑repair loop's repeated calls).
- **Streaming** for large op lists (avoid HTTP timeouts; 128K ceiling).

Wiring + policy:
- Add `agent_model_assignments` row `template_reconstruct_agent → { route:'native', model_id:'claude-opus-4-8', fallback_chain:[gemini/gpt] }`. **Claude‑primary; existing fallback chain retained** for resilience (Anthropic down/rate‑limited). Admins can swap models from the table.
- **Fix the router's native Anthropic path:** preserve multimodal content (don't stringify image/document parts); for `claude-4.x`, drop `temperature` and add adaptive thinking + `effort`.
- **Keep R5 grounded‑classifier discipline:** Claude classifies/labels/orders measured elements and assigns blocks; it must not invent positions, colours, fonts, or copy. The structured‑output schema enforces "reference element ids only."

"Reconstruct in whichever format": the target is always the canonical `ReportTemplate`; output‑format flexibility is satisfied by the existing PDF/DOCX/PPTX/HTML exporters. (Optional future: code/Figma exporter.)

## 5. Workstream 3 — Template‑builder editor (execute the approved V2 rehaul)

Follow `TEMPLATE_BUILDER_REHAUL_PLAN.md`, renderer‑safe (overlays = free placement, data = flowing blocks), behind `templateEditorV2`, golden‑render‑gated, with the ingestion modal as the front door.

- **Phase 0:** golden‑render snapshot suite + CI (typecheck + vitest + build); restore in‑editor Import entry; make AI failures visible; delete dead tldraw canvas. *(Also unblocks WS1/WS2.)*
- **Phase 1–2:** add `@dnd-kit`; V2 shell composing `EditorialCanvas`; palette→canvas drop‑to‑place; tabbed asset/element/component library.
- **Phase 3:** unified **"Start from a reference"** modal = the WS1 façade UI (PDF / image / paste / drag / URL / **code/zip**), mode chooser (pixel‑exact / editable rebuild / hybrid), staged progress + "what Claude saw" + partial‑accept (R6 SSIM heatmap).
- **Phase 4–8:** layers/align/grouping/page navigator → text/image polish → visual data binding → onboarding → flag flip.

## 6. Cross‑cutting

- **Isolation:** all new code in 🟢 editor‑only / ingestion / edge‑function zones. 🔴 renderer files stay byte‑identical (Phase‑0 golden‑render suite on every PR).
- **Schema:** additive‑only; reconstruction primitives (`vector`, rich‑text `runs`, embedded `data:` fonts, numeric weight) already exist; code ingestion needs no new primitives.
- **Security:** `render-source` reuses `import-from-url` guards; sandbox headless render + repo builds; no untrusted execution on the host.
- **Cost:** prompt‑cache the reconstruction system prompt; reserve `claude-opus-4-8` for grounded classify + fidelity repair; route cheap pre‑passes (OCR) to cheaper models.
- **Testing:** new modules pure + unit‑tested (R0–R6 discipline); per‑source fixtures; SSIM regression thresholds on a sample corpus.
- **Observability:** reuse `logApiUsage`/router `attempts`; surface per‑stage status + model‑used in the import dialog.

## 7. Sequencing

1. **Phase 0 guardrails** (golden‑render + CI) — prerequisite.
2. **WS2 Claude core** — adapter → `claude-opus-4-8`, router multimodal fix, structured outputs, Claude‑primary assignment + fallback. Immediate quality win for existing PDF/image reconstruction.
3. **WS1 ingestion façade** — wrap existing sources + `render-source` service + code subfunction (C1→C4).
4. **WS3 editor** — Phases 1–3 (drag/drop shell + unified import modal), then 4–8 polish and flag flip.

## 8. Locked decisions
1. **Raw‑codebase inputs:** all four shapes (HTML/CSS, live URL, React/JSX, full repo/zip), shipped as tiers C1→C4.
2. **Engine policy:** Claude‑primary (`claude-opus-4-8`) + Gemini/GPT fallback via the existing chain.
3. **Sequencing:** Phase 0 → Claude core → Ingestion → Editor.

## 9. Risks

| Risk | Mitigation |
|---|---|
| A change leaks into renderer output | Golden‑render snapshot tests + 🔴 do‑not‑touch list. |
| Headless render / repo build is a security surface | Sandboxed, SSRF‑guarded, resource‑capped; no host execution; reuse `import-from-url` guards. |
| Claude API surface drift (no `temperature`, adaptive thinking, effort) | Centralize in `claudeReconstruct.ts`; router branches by model family; verify with one test call per model. |
| C3/C4 (JSX/repo) scope creep | Tiered delivery — C1/C2 ship first and cover most fidelity needs; C3/C4 are job‑queued follow‑ups. |
| Reconstruction unreliable | R5 grounding + R6 SSIM repair already in place; structured outputs reduce parse failures; fallback chain for provider outages. |
