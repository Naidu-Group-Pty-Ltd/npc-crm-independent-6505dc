# PDF Import — Path-to-100 Implementation Guide

**Audience:** an engineer completing the remaining work to take the PDF-import
pipeline to a literal 100/100 against `Lovable__Cloud_Run_Plan_1.docx`.
**Assumes:** the work already merged (PR #979) and open (PR #981) is in place.
**Sidecar host:** Google Cloud Run, service `pdf-parse-service`, Supabase
project ref `dduzbchuswwbefdunfct`.

This guide is intentionally exhaustive: exact files, function names, code
sketches, `gcloud`/`supabase` commands, verification steps, and the failure
modes to watch for. Work top-to-bottom — **Section 0 (deploys) is a hard
prerequisite** for the already-built score to count, and several later items
depend on it.

---

## Score model & current state

Scoring is per the audit in `/root/.claude/plans/…wiggly-plum.md` (also
reproduced in PR #981). Weighted **60% Part 1 (app) / 40% Part 2 (sidecar)**.

| | Phase | Now | Target | Gap item |
|---|---|---|---|---|
| P1-1 | Hybrid default | 10 | 10 | ✅ done |
| P1-2 | Visual quality contract | 10 | 10 | ✅ done |
| P1-3 | CDIR expectations | 10 | 10 | ✅ done |
| P1-4 | Visual diff harness | 8.5 | 10 | **§4** on-demand metrics |
| P1-5 | Persist artifacts | 10 | 10 | ✅ done |
| P1-6 | Auto AI repair | 8 | 10 | **§5** `visual_diff_repair` mode |
| P1-7 | Quality-gated finalize | 8 | 10 | **§3** per-page mode auto-apply |
| P1-8 | Import review UI | 9.5 | 10 | **§6** (polish; near-done) |
| P1-9 | Diagnostics | 9 | 10 | **§6** (polish; near-done) |
| P1-10 | Golden fixtures | 6.5 | 10 | **§7** generated PDFs + golden run |
| P2-1 | /plan router | 10 | 10 | ✅ done (needs deploy §0) |
| P2-2 | Extraction lanes | 9 | 10 | **§8** lane-varied enrichment |
| P2-3 | Per-page rasters | 10 | 10 | ✅ done |
| P2-4 | Per-page artifacts | 10 | 10 | ✅ done (needs deploy §0) |
| P2-5 | Chunk merge | 9.5 | 10 | ✅ done (needs deploy §0) |
| P2-6 | Image endpoints | 1 | 10 | **§9** (Tier 3, product decision) |
| P2-7 | Provider fallback | 3 | 10 | **§10** (Tier 3, product decision) |
| P2-8 | Stuck recovery | 10 | 10 | ✅ done (needs §0 secret) |
| P2-9 | Fast/heavy split | 0 | 10 | **§11** (Tier 3, Cloud Run infra) |
| P2-10 | Ops metrics | 8 | 10 | **§8.4** (sub-timings; needs deploy §0) |

**Trajectory:** deploys (§0) + Tier-1/2 (§3–§8) → **~93–95**. Tier-3 (§9–§11)
→ literal **100**. Do §0 first, then §3–§8, then decide on §9–§11.

---

## 0. Deploy the already-built changes (PREREQUISITE)

Nothing shipped in PR #981 counts until these land. Four edge functions and one
Cloud Run image changed, plus one Vault secret activates the recovery cron.

### 0.1 Edge functions (Supabase)

All four are `verify_jwt = false` and do in-function auth; deploying does not
change that. From the repo root, with the Supabase CLI authenticated:

```bash
export SUPABASE_PROJECT_REF=dduzbchuswwbefdunfct

# P2-1 mode-forwarding + PlanResult typing
supabase functions deploy pdf-parse-dispatch          --project-ref $SUPABASE_PROJECT_REF

# P2-5 page_confidence recompute + self_ref namespacing
supabase functions deploy pdf-parse-chunk-callback    --project-ref $SUPABASE_PROJECT_REF

# P1-9 chunk columns in the diagnostics list select
supabase functions deploy pdf-import-diagnostics      --project-ref $SUPABASE_PROJECT_REF

# P2-8 service-role bearer acceptance (for the cron)
supabase functions deploy pdf-parse-recover-stuck-jobs --project-ref $SUPABASE_PROJECT_REF
```

> If you deploy from the Lovable/Supabase Functions UI instead, redeploy the
> same four slugs. `template-import-pdf`, `pdf-parse-callback` are unchanged.

**Verify** each returned a new version (Functions dashboard) and that a
chunked import (≥ the chunk threshold, `CHUNK_MONOLITHIC_MAX` in
`pdf-parse-dispatch/index.ts`, currently ~20 pages) now produces
`result_payload.summary.page_confidence` (non-empty array) and
`result_payload.chunk_ref_namespacing_version = "chunk-ref-namespacing-v1"`:

```sql
-- Supabase SQL editor
select id,
       result_payload->'summary'->'page_confidence' as page_confidence,
       result_payload->>'chunk_ref_namespacing_version' as ns_version,
       result_payload->'metrics' as metrics
from pdf_import_jobs
where chunked = true
order by created_at desc
limit 3;
```

### 0.2 Cloud Run sidecar (`app.py`: per-page `ocr.json` + ops metrics)

`app.py` changed (per-page `ocr.json` in `_build_per_page_docling_artifacts` +
its upload, and the `metrics` object in the monolithic callback payload).
`requirements.txt` did **not** change, but Cloud Run needs a new image because
`app.py` is baked in. Follow the repo's existing runbook
(`pdf-parse-service/DEPLOY.md` §8/§11.1) — **use `--update-env-vars`, never
`--set-env-vars`**, or you will wipe `PDF_PARSE_SERVICE_TOKEN`:

```bash
cd pdf-parse-service
export GCP_PROJECT=<YOUR_GCP_PROJECT_ID>
export REGION=<your-region>              # e.g. australia-southeast1 or us-central1
export SERVICE=pdf-parse-service
export IMAGE=gcr.io/$GCP_PROJECT/$SERVICE:path100-$(date +%Y%m%d-%H%M)

gcloud builds submit --tag "$IMAGE" .

gcloud run deploy "$SERVICE" \
  --image "$IMAGE" \
  --region "$REGION" \
  --concurrency 2 \
  --timeout 300 \
  --min-instances 0 \
  --max-instances 10 \
  --startup-probe-http-path /healthz
```

**Verify** per-page OCR artifact + metrics after one import:

```bash
# ocr.json is written per page under {jobId}/pages/page-NNN/ocr.json;
# confirm the pages-manifest lists an ocr_path.
curl -s -X POST "$PDF_PARSE_SERVICE_URL/parse" \
  -H "Authorization: Bearer $PDF_PARSE_SERVICE_TOKEN" -H "Content-Type: application/json" \
  -d '{"url":"https://arxiv.org/pdf/2206.01062.pdf"}' \
  | jq '{engine: .engine_version, has_metrics: (.result_payload.metrics != null)}'
```

Then in Supabase SQL confirm `pdf_import_jobs.result_payload->'metrics'` is
populated (parse_ms / raster_ms / avg_ms_per_page / memory_profile) — it now
shows in the diagnostics **Run ms** cell (per-phase split on hover).

### 0.3 Activate the stuck-job recovery cron (Vault secret)

Migration `20260714180000_schedule_pdf_parse_recover_stuck_jobs.sql` is applied
and the `pdf-parse-recover-stuck-jobs` pg_cron job runs every 10 min, but it
**no-ops until** the service-role key is in Vault. Set it once:

```sql
-- Supabase SQL editor (service-role key from Project Settings → API)
select vault.create_secret('<SERVICE_ROLE_KEY>', 'pdf_parse_service_role_key');
-- Optional non-default project URL:
-- select vault.create_secret('https://dduzbchuswwbefdunfct.supabase.co', 'pdf_parse_project_url');
```

**Verify** the next fire actually POSTs (not the "no secret; skipping" log):

```sql
select j.jobname, d.status, d.return_message, d.end_time
from cron.job j
join cron.job_run_details d on d.jobid = j.jobid
where j.jobname = 'pdf-parse-recover-stuck-jobs'
order by d.end_time desc limit 3;
```

---

## Conventions for the code work (§3–§11)

- **Branch/PR:** continue on `claude/pdf-rendering-overlap-t3bpoj` (PR #981) or
  cut a fresh branch off `main` per item. Keep each § a separate commit.
- **Local verify loop** (run after every §):
  ```bash
  npx tsc -p tsconfig.app.json --noEmit
  npx vitest run src/lib/reportTemplate/pdfImport src/lib/reportTemplate/ingestion/visualQuality
  npx eslint <changed files>
  npm run pdf-import:release-gate:no-build      # must stay green
  python3 -m py_compile pdf-parse-service/app.py # for sidecar edits
  ```
- **Release-gate landmines** (`scripts/regression/pdf-import-release-gate.mjs`)
  — do NOT introduce these identifiers/patterns in `src/`:
  - `no_automatic_ai_execution_pattern`: `autoRunAiReconciliation`,
    `automaticallyReconcile`, `autoInvokeAiReconciliation`, `autoRunReconciliation`.
  - `no_quality_gate_bypass_pattern`: `bypassQualityGate`, `skipQualityGate`,
    `forceQualityGatePass`, `disableQualityGate`.
  - `no_automatic_template_mutation_pattern` (scoped to
    `ingestion/(selfHealing|operatorControls)/…Executor`): don't call
    `applyTemplateImportPlan`/`applyRepairedTemplateToRecord` or
    `report_templates` writes from those executor paths.
  - `no_service_role_secret_frontend_pattern` (scoped to `src/`): never put
    `SUPABASE_SERVICE_ROLE_KEY` in `src/`.

---

## 3. P1-7 — Per-page mode auto-apply in the quality gate (+2)

**Goal:** the doc's decision policy actually *changes the staged template*, not
just advises. Pages scoring `< 0.50` become pixel-perfect (full-opacity source
raster + all overlays locked); weak semantic pages (`< 0.65`) gain the hybrid
underlay. Today the gate only records `recommendedFinalMode`.

### 3.1 The core conflict to resolve first

`extractPdfViaDocling.ts` currently, when staging the repaired template, **force-
preserves each page's original `background` and `size`** (to keep the plan's
underlay flags/rasters across the CDIR round-trip):

```ts
// src/lib/reportTemplate/pdfImport/extractPdfViaDocling.ts  (the `improved` block)
pages: gate.template.pages.map((page) => {
  const orig = originalPagesById.get(page.id);
  return orig ? { ...page, background: orig.background, size: orig.size } : page;
}),
```

If the gate mutates a page's `background` (opacity/underlay) for a fallback,
this line would **undo it**. So the gate must become the single owner of page
backgrounds, and this preservation must be relaxed to "preserve `size` always;
preserve `background` only for pages the gate did not touch."

### 3.2 New pure helper: per-page fidelity fallback

Add to `src/lib/reportTemplate/pdfImport/applyFidelityMode.ts` (next to the
existing whole-template `applyFidelityModeToTemplate`). Reuse its per-page logic.

```ts
import { QUALITY_THRESHOLDS } from '../ingestion/visualQuality';

export interface PerPageFallbackVerdict { pageNumber: number; score: number; }

export interface PerPageFallbackResult {
  template: ReportTemplate;
  /** pageId → applied mode, for the summary / audit. */
  applied: Record<string, 'pixel-perfect' | 'hybrid'>;
}

/**
 * Apply the doc's per-page decision policy to a staged template:
 *   score < fallbackToHybrid (0.50) → pixel-perfect for that page
 *   score < repair (0.65)           → ensure hybrid underlay for that page
 * Pure. Page numbers map to `docling-page-{n}` ids; adjust if your ids differ.
 */
export function applyPerPageFidelityFallback(
  template: ReportTemplate,
  verdicts: PerPageFallbackVerdict[],
): PerPageFallbackResult {
  const byPageId = new Map<string, number>();      // pageId → score
  for (const v of verdicts) byPageId.set(`docling-page-${v.pageNumber}`, v.score);
  const applied: PerPageFallbackResult['applied'] = {};

  const pages = template.pages.map((page) => {
    const score = byPageId.get(page.id);
    if (score === undefined || !Number.isFinite(score)) return page;
    const bg = { ...((page.background as Record<string, unknown>) ?? {}) };
    const hasRaster = Boolean(bg.imageUrl);
    if (!hasRaster) return page;                    // nothing to lock behind

    if (score < QUALITY_THRESHOLDS.fallbackToHybrid) {
      bg.opacity = 1; bg.underlay = false; if (!bg.imageFit) bg.imageFit = 'fill';
      applied[page.id] = 'pixel-perfect';
      return {
        ...page, background: bg,
        blocks: page.blocks.map((b) => ({
          ...b, overlays: (b.overlays ?? []).map((o) => (o.locked ? o : { ...o, locked: true })),
        })),
      };
    }
    if (score < QUALITY_THRESHOLDS.repair) {
      bg.underlay = true; if (!bg.imageFit) bg.imageFit = 'fill';
      if (typeof bg.opacity !== 'number' || bg.opacity >= 1) bg.opacity = 0.5;
      applied[page.id] = 'hybrid';
      return { ...page, background: bg };
    }
    return page;
  });

  return { template: { ...template, pages } as ReportTemplate, applied };
}
```

**Note on pixel-perfect semantics:** locked overlays still *render* over the
full-opacity raster (this is the existing pixel-perfect behaviour; the overlays
match the raster because both derive from the same source). This is consistent
with `applyFidelityModeToTemplate('pixel-perfect')` and does **not** reintroduce
the ghost/overlap bug (that was hybrid at 0.5 opacity + offset).

### 3.3 Wire into the gate

In `src/lib/reportTemplate/pdfImport/importQualityGate.ts`, after the
orchestration produces `result.repair.finalReport.pages` and you've built
`perPage`, apply the fallback to the returned template and record it:

```ts
import { applyPerPageFidelityFallback } from './applyFidelityMode';

const fallback = applyPerPageFidelityFallback(
  result.draft.template ?? options.template,
  perPage.map((p) => ({ pageNumber: p.pageNumber, score: p.score })),
);
// return `fallback.template` instead of `result.draft.template`
// add to ImportQualityGateSummary: `fallbackApplied: fallback.applied`,
//   `pagesFellBackToPixel`, `pagesFellBackToHybrid` counts.
```

Update `RunImportQualityGateResult` + `ImportQualityGateSummary` with the new
fields, and set `templateChanged = repaired || Object.keys(fallback.applied).length > 0`.

### 3.4 Relax the preservation in `extractPdfViaDocling.ts`

Change the staging swap to trigger when the gate changed the template **for any
reason** (repair OR fallback), and preserve `background` only for untouched
pages:

```ts
const gateChanged = gate.summary.ran &&
  (/* repaired */ (gate.summary.patchesApplied > 0 && (gate.summary.scoreDelta ?? 0) > 0)
   || /* fell back */ Object.keys(gate.summary.fallbackApplied ?? {}).length > 0)
  && gate.template !== template;

if (gateChanged) {
  // …merge meta + fontFaces as today, but:
  pages: gate.template.pages.map((page) => {
    const orig = originalPagesById.get(page.id);
    const touched = Boolean(gate.summary.fallbackApplied?.[page.id]);
    return orig
      ? { ...page, size: orig.size, background: touched ? page.background : orig.background }
      : page;
  }),
  // …then validateReconstructedSchema(candidate); re-derive stageCdir/fidelity.
}
```

### 3.5 Also handle the large-doc skip

Today the gate hard-skips docs `> DEFAULT_QUALITY_GATE_MAX_PAGES` (40). To score
P1-7 fully, run it **page-batched** instead: capture/diff/score in windows of
~20 pages so an 80-page import still gets a verdict without a single giant
html2canvas pass. Implement by looping `captureOptions.pageNumbers` windows
inside `runImportQualityGate` and merging per-page reports, or raise the cap and
rely on the existing `maxPages`/`captureOptions.maxPages`. Keep the fail-open
wrapper around each batch.

### 3.6 Tests (`importQualityGate.spec.ts`, `applyFidelityMode.spec.ts`)

- `applyPerPageFidelityFallback`: page < 0.50 → `underlay:false`, `opacity:1`,
  all overlays locked, `applied[id]='pixel-perfect'`; 0.50–0.64 → `underlay:true`,
  `opacity:0.5`; ≥ 0.65 untouched; raster-less page untouched; input not mutated.
- Gate: a low-score page yields `summary.pagesFellBackToPixel === 1` and the
  returned template's that-page background is full-opacity/locked.

### 3.7 Verify E2E

Import a PDF where one page reconstructs poorly; confirm in the editor that page
shows the locked full raster while good pages stay editable, and
`stage_artifacts` meta `visual_quality_gate.fallbackApplied` lists it.

---

## 4. P1-4 — Real text/layout/missing metrics in the on-demand Visual QA path (+1.5)

**Problem:** `src/lib/reportTemplate/ingestion/visualQuality/renderDiffPersistence.ts`
(`buildVisualQualityFromRenderPairs`) is **image-first** — it holds
`textCoverageScore/layoutDriftScore/missingElementScore` at a neutral `0.5`
(look for the `Phase 5D is image-first` comment). Only pixel/color are real.
This path also backs the inline gate's headline score, so fixing it improves
both.

**Approach:** route the on-demand path through the same `runVisualDiff`
(`ingestion/visualQuality/diff/`) the repair loop uses, which computes real
layout/text/missing against **CDIR self-expectations**
(`buildCdirSelfExpectations` in `repair/repairBridge.ts`). Semantics: these
measure whether the *render matches the reconstructed CDIR* (not the raw
source), which is the correct, available signal on this path.

### 4.1 Thread the CDIR through

`attachVisualQualityToImportReview` (in `importReviewVisualQuality.ts`) already
has `options.draft.cdir`. Add an optional `cdir` +
`renderedRasters`/`sourceRasters` to `PersistRenderDiffOptions` and, when
present, compute the report via `runVisualDiff`:

```ts
// renderDiffPersistence.ts — inside persistRenderDiffVisualQuality / build…Pairs
import { runVisualDiff } from './diff';
import { buildCdirSelfExpectations, sourceRenderRastersToVisualDiffSourceRasters,
         generatedRastersToRenderedPageRasters } from './repair/repairBridge';

if (options.cdir) {
  const report = await runVisualDiff({
    importId: options.importId,
    templateId: options.templateId ?? null,
    cdir: options.cdir,
    expectations: buildCdirSelfExpectations(options.cdir),
    renderedRasters: generatedRastersToRenderedPageRasters(options.generatedRasters),
    sourceRasters: sourceRenderRastersToVisualDiffSourceRasters(options.sourceRasters ?? [], options.cdir),
    finalMode: options.finalMode ?? 'hybrid',
    repairPassesApplied: options.repairPassesApplied ?? 0,
  });
  // use `report` (has real text/layout/missing) in place of the image-first pages.
}
```

Keep the image-first branch as the fallback when `cdir` is absent (backward
compatible; no test churn there).

### 4.2 Pass `cdir` from the callers

- `attachVisualQualityToImportReview`: pass `cdir: options.draft.cdir`.
- The inline gate already runs through `runVisualRepairOrchestrationPipeline`,
  whose `runImportReviewVisualQualityPipeline` calls `attachVisualQualityToImportReview`
  with the draft — so once the draft's cdir flows down, the gate's headline score
  becomes fully metric-based automatically.

### 4.3 Test impact

Update `renderDiffPersistence.spec.ts` / `importReviewVisualQuality.spec.ts`:
the neutral-0.5 assertions become real values when a cdir fixture is supplied;
add a case with a cdir where a layer's bounds are wrong → `layoutDriftScore < 1`.
Keep a no-cdir case asserting the 0.5 fallback is retained.

---

## 5. P1-6 — AI `visual_diff_repair` escalation mode (+2)

**Goal:** after the deterministic repair loop, offer the doc's page-scoped AI
repair as a **manual-confirm** escalation (never automatic — the release gate
forbids auto AI). Reuses the existing `template-design-agent` edge function and
`TemplateDesignAgentReconciliationClient` (`ingestion/reconciliation/aiClient.ts`,
already invoked with `mode: 'pdf-import-quality-reconciliation'` at
`ImportPdfDialog.tsx:594`).

### 5.1 Client: add a page-scoped repair request builder

New module `ingestion/visualQuality/repair/aiVisualDiffRepair.ts`:

```ts
export interface VisualDiffRepairRequest {
  mode: 'visual_diff_repair';
  importId: string;
  pageId: string;
  sourcePageImage: string;      // signed URL or data URL
  generatedPageImage: string;
  diffImage: string;
  currentTemplatePage: unknown; // the single Page JSON
  doclingBlocks: unknown[];     // from per-page blocks.json (see §0.2 per-page artifacts)
  qualityReport: VisualPageQualityReport;
  instructions: string[];       // verbatim doc contract — see below
}

export const VISUAL_DIFF_REPAIR_INSTRUCTIONS = [
  'Do not rewrite document content.',
  'Only adjust layout, grouping, sizing, colors, and fallback mode.',
  'Keep source raster fallback if confidence is low.',
  'Return a valid TemplateImportPlan patch only.',
];
```

Send it via `invokeSecureFunction('template-design-agent', req, …)`. Validate
the returned patch with the existing `TemplateImportPatch` union
(`ingestion/reconciliation/types.ts`) and apply through
`applyTemplateImportPlan`/`applyRepairedTemplateToRecord` — **only after the
operator clicks "AI repair page N"** in `ImportReviewDialog`.

### 5.2 Edge function: handle the new mode

In `supabase/functions/template-design-agent/index.ts`, branch on
`mode === 'visual_diff_repair'`: build a vision prompt from
`sourcePageImage`/`generatedPageImage`/`diffImage` + `doclingBlocks`, constrain
the model to emit a `TemplateImportPatch[]` (layout ops only), and return
`{ patch, modelUsed, warnings }`. Keep the page as the unit (never send the whole
doc). Deploy: `supabase functions deploy template-design-agent --project-ref dduzbchuswwbefdunfct`.

### 5.3 Wire the UI (manual-confirm)

- `ImportReviewDialog.tsx`: per-page "AI repair" button in the §6 grid, calling a
  new controller handler `runAiVisualDiffRepair(pageNumber)`.
- `usePersistedImportReviewController.ts`: add the handler; it calls the builder,
  awaits the patch, applies it to the draft, re-runs Visual QA for that page, and
  requires an explicit "Apply" (reuse `applyRepairedTemplateToRecord`). Name the
  handler plainly (e.g. `runAiVisualDiffRepair`) — **avoid** the gate's banned
  identifiers (§Conventions).

### 5.4 Guard rails / gate

- No automatic invocation anywhere — button-gated only.
- Add a unit test that the request builder emits the verbatim `instructions`
  contract and page-scoped payload; mock the invoke.
- `npm run pdf-import:release-gate:no-build` must stay green (the
  `no_automatic_ai_execution_pattern` scan).

---

## 6. P1-8 / P1-9 — Review UI + diagnostics polish (already ~done; finishing)

Shipped in PR #981: per-page source/generated/diff grid in `ImportReviewDialog`
+ per-page score badges; requested→finalized mode in `PdfImportDiagnostics`;
metrics on the Run-ms cell. To claim the last 0.5 on each:

- **P1-8:** add per-page "Accept page / Force hybrid / Force pixel / Open in
  editor" actions to each grid cell (the doc's per-page buttons). `onForceMode`
  already exists on the dialog — extend it to accept a page number, and thread a
  per-page variant through `usePersistedImportReviewController` using
  `applyPerPageFidelityFallback` (§3.2) for a single page.
- **P1-9:** add a real **failed-pages** cell. For chunked jobs derive from
  `pdf_import_chunks` (status `failed`/`fatal`) — extend the diagnostics `list`
  op in `pdf-import-diagnostics/index.ts` to left-join a failed-chunk count, or
  add a `visual_quality_summary.pagesNeedingReview` column sourced from
  `template_imports.meta.visual_quality_gate`. Redeploy the function (§0.1).

---

## 7. P1-10 — Generated PDF fixtures + golden run (+3.5)

**Constraint (do not violate):** the repo forbids committing real/client PDFs
(`goldenCorpusRegistry.ts` header; `.pdf` is absent from `src/`). Satisfy the
doc's *intent* by **generating** deterministic PDFs at test time.

### 7.1 Fixture generator (test-time, no committed binaries)

Add `src/test/fixtures/pdf-import/generateFixtures.ts` using `pdf-lib` (already a
dep via `@pdf-lib/fontkit`) OR the WeasyPrint service. `pdf-lib` is simplest and
offline:

```ts
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export async function makeNativeSimplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('NPC Property — Borrowing Capacity', { x: 56, y: 780, size: 20, font });
  page.drawText('Executive Summary', { x: 56, y: 740, size: 14, font, color: rgb(0.1,0.1,0.4) });
  // …draw a simple table grid with lines + cell text for the "table" scenario.
  return doc.save();
}
```

Produce the 7 doc scenarios programmatically: `native-simple`,
`native-complex-table`, `brochure-heavy` (colored rects + overlapping text),
`multi-page-25`, `multi-page-80` (loop pages), `image-only` (embed a PNG),
`scanned-document` (rasterize text to an image page). Keep them tiny + seeded so
output is byte-deterministic.

### 7.2 Golden run against them

The Docling path needs the sidecar; for a **hermetic** unit golden run, feed the
generated PDFs through the parts that don't need Cloud Run:

- Parse the fixture's own structure into a `DoclingDocument`-shaped fixture (or
  run `pdfjs`/`pdf-lib` to extract text+bounds), then exercise
  `mapDoclingToPagePlan` → `applyTemplateImportPlan` → `reportTemplateToCdir` →
  `buildCdirFidelityReport` → `runVisualDiff` (jsdom canvas) → `runRepairLoop`.
- Assert the doc's 8 behaviors: valid schema; hybrid includes source raster;
  pixel-perfect locks all overlays; low-confidence locks; tables create
  rows/cols; CDIR validates; VQ report has per-page scores; repair loop ≤ 2
  passes (already covered by `runRepairLoopCap.spec.ts`).

For a **full** (sidecar) golden run, wire the generated fixtures into
`goldenCorpus/goldenCorpusOrchestrator.ts` behind an env flag
(`PDF_IMPORT_GOLDEN_LIVE=1`) that uploads each fixture through the real import
and records a `pdf_import_golden_runs` row — run manually pre-release, not in CI.

### 7.3 Wire to the release gate

Add the hermetic golden spec to the vitest set the gate runs
(`release_gate_tests_pass`). Do **not** add live-sidecar runs to CI.

---

## 8. P2-2 & P2-10 finish — sidecar lanes + metrics (+2)

### 8.1 P2-2: lane-varied formula/code enrichment

Today `_build_converter` (`app.py:~219`) applies
`ENABLE_FORMULA_ENRICHMENT`/`ENABLE_CODE_ENRICHMENT` globally, and the converter
cache key `_converter_key(...)` is `(picture_description, force_full_page_ocr,
table_mode)`. Make enrichment lane-dependent:

1. Add `formula_enrichment` + `code_enrichment` booleans to each lane in
   `LANE_PROFILES` (`app.py:~1468`). Recommended: `fast_native`/`ocr_scanned`/
   `pixel_raster_only` → both `False`; `accurate_table`/`design_heavy` → both
   `True` (or keep formula on, code off for finance docs).
2. Thread them through `_lane_policy(...)` → the parse handlers → `_get_converter`.
3. Add them to `_converter_key` + `_build_converter` signature (so variants cache
   correctly). Update the two `_safe_set(pipeline, "do_formula_enrichment", …)` /
   `do_code_enrichment` lines to use the passed flags.
4. Bump `LANE_ENFORCEMENT_VERSION` (e.g. `extractor-lane-policy-v2`).

Redeploy the sidecar (§0.2). Verify a `fast_native` lane job runs faster and its
`lane_policy` shows `formula_enrichment: false`.

### 8.2 P2-10: the remaining sub-timings

The `metrics` object (shipped) has parse/raster/cloud_run/duration/avg_ms_per_page
+ counts + memory_profile. To reach 10/10 add the phases the plan lists that
aren't captured yet: `download_ms` (time to fetch the signed source in
`_resolve_pdf_bytes`), `upload_ms` (artifact upload wall-time), `callback_ms`
(time in `_post_callback`), and `plan_ms` (already returned by `/plan`; thread it
into the job's plan_payload → surface in metrics). Wrap each phase in
`t = time.monotonic()` deltas and add to the `metrics` dict. Mirror the same
object into the **chunked** callback path (`pdf-parse-chunk-callback` finalizer)
so large docs report metrics too. Redeploy sidecar + chunk-callback.

---

## 9. P2-6 — Image-source sidecar endpoints (Tier 3; +9 Part 2)

> **Product decision first.** Images already work via the client `render-source`
> path (`src/lib/reportTemplate/ingestion/importOrchestrator.ts` image branch).
> Building the cloud path duplicates that. Only do this if you want image imports
> to be Docling/Cloud-Run-canonical (uniform artifacts, server OCR).

**Sidecar (`app.py`):** add FastAPI routes `POST /plan-source`, `/parse-source`,
`/parse-image`, `/raster-source`. Accept
`{ source_type: 'image', image_base64, mime, mode }`. Relax `_resolve_pdf_bytes`
so image payloads bypass the `%PDF` check and route to an image pipeline: OCR
words (EasyOCR/the existing OCR opts) → layout blocks → same
`RawImportBlock`/per-page artifact/raster-manifest contract as PDFs, so
downstream `mapDoclingToRawBlocks`/plan builders are unchanged. Emit the same
`result_payload` shape.

**Dispatcher (`pdf-parse-dispatch`):** add an image branch that uploads the image
to the source bucket and calls `/parse-source`. **Client
(`providers/dispatch.ts`):** switch `pickPrimary` so non-PDF routes to the cloud
provider instead of `renderSourceProvider` (or keep both behind a flag).

Deploy: rebuild Cloud Run (§0.2, rebuild required) + redeploy dispatcher. Add a
golden fixture (`image-only`) exercising it.

---

## 10. P2-7 — External provider fallback hooks (Tier 3; +7)

> **Requires provider accounts + keys.** Docling-only was deliberate.

**Sidecar:** add a `ProviderFallbackRequest` model
(`provider: Literal['google_document_ai','azure_document_intelligence','mistral_ocr']`,
`reason`, `page_start`, `page_end`) and a `/fallback` route (or a `provider`
field on `ParseRequest`). Implement thin adapters that call the external API and
**normalize output into the existing artifact contract** (raw provider JSON →
`RawImportBlock`s → CDIR/page manifests) so nothing downstream changes. Gate each
provider behind an env flag + secret (`GOOGLE_DOCAI_*`, `AZURE_DI_*`,
`MISTRAL_OCR_*`) via Cloud Run `--update-env-vars` / Secret Manager.

**Trigger policy** (dispatcher or watchdog): invoke fallback only when Docling
confidence is low / table extraction fails / visual-diff fails after repair /
OCR is poor / operator triggers it. Record attempts in the existing
`ProviderAttempt` audit trail (`providers/index.ts`).

---

## 11. P2-9 — Fast/heavy dual Cloud Run split (Tier 3; +10 Part 2)

> **Cost/perf optimization, not correctness.** This is the single biggest
> literal-100 lift and pure infra.

### 11.1 Two Cloud Run services

Deploy the **same image** twice with different resources:

```bash
# fast: fast_native + pixel_raster_only lanes
gcloud run deploy pdf-parse-fast --image "$IMAGE" --region "$REGION" \
  --cpu 2 --memory 4Gi --concurrency 1 --timeout 300 --max-instances 20 \
  --startup-probe-http-path /healthz \
  --update-env-vars "ENABLE_OCR_FALLBACK=false,DOCLING_TABLE_MODE=FAST"

# heavy: ocr_scanned + accurate_table + design_heavy
gcloud run deploy pdf-parse-heavy --image "$IMAGE" --region "$REGION" \
  --cpu 8 --memory 16Gi --concurrency 1 --timeout 300 --max-instances 6 \
  --startup-probe-http-path /healthz \
  --update-env-vars "ENABLE_OCR_FALLBACK=true,DOCLING_TABLE_MODE=ACCURATE,ENABLE_PICTURE_DESCRIPTION=true"
```

### 11.2 Dispatcher routing

Add Supabase secrets `PDF_PARSE_SERVICE_URL_FAST` / `PDF_PARSE_SERVICE_URL_HEAVY`
(keep `PDF_PARSE_SERVICE_URL` as the default/fallback). In
`pdf-parse-dispatch/index.ts`, after `callSidecarPlan`, pick the target URL from
`plan.recommended_lane`:

```ts
const HEAVY_LANES = new Set(['ocr_scanned','accurate_table','design_heavy']);
const baseUrl = HEAVY_LANES.has(selectedLane)
  ? (Deno.env.get('PDF_PARSE_SERVICE_URL_HEAVY') ?? PARSE_URL)
  : (Deno.env.get('PDF_PARSE_SERVICE_URL_FAST') ?? PARSE_URL);
```

Thread `baseUrl` into every sidecar call (`/parse`, `/parse-chunk`, `/raster`)
and into `pdf-parse-chunk-callback` (which also calls the sidecar). Keep the
single-URL default so the split is a no-op until both secrets are set. Redeploy
dispatcher + chunk-callback. Verify a scanned PDF hits `pdf-parse-heavy` logs and
a native PDF hits `pdf-parse-fast`.

---

## Appendix A — Per-item verification matrix

| § | tsc | vitest | eslint | gate | py_compile | deploy | E2E |
|---|---|---|---|---|---|---|---|
| 0 | – | – | – | – | – | ✅ all | chunked import + metrics + cron |
| 3 | ✅ | ✅ new fallback specs | ✅ | ✅ | – | – | weak page locks in editor |
| 4 | ✅ | ✅ updated diff specs | ✅ | ✅ | – | – | on-demand VQ shows real text/layout |
| 5 | ✅ | ✅ builder spec | ✅ | ✅ (no-auto-AI) | – | ✅ template-design-agent | button-gated AI page repair |
| 6 | ✅ | ✅ | ✅ | ✅ | – | ✅ pdf-import-diagnostics | grid actions + failed-pages |
| 7 | ✅ | ✅ golden spec | ✅ | ✅ | – | – | (live golden manual) |
| 8 | – | – | – | ✅ | ✅ | ✅ sidecar + chunk-callback | lane timings in diagnostics |
| 9–11 | ✅/– | ✅/– | ✅ | ✅ | ✅ | ✅ Cloud Run + dispatcher | routing / image / provider logs |

## Appendix B — File index (all touch points)

- Gate: `src/lib/reportTemplate/pdfImport/importQualityGate.ts`,
  `applyFidelityMode.ts`, `extractPdfViaDocling.ts`, `types.ts`.
- Visual QA/repair: `ingestion/visualQuality/renderDiffPersistence.ts`,
  `importReviewVisualQuality.ts`, `repair/{repairBridge,runRepairLoop,
  deterministicRepairRunner,repairOrchestrationPipeline}.ts`,
  `repair/aiVisualDiffRepair.ts` (new).
- UI: `components/templateBuilder/{ImportReviewDialog,ImportPdfDialog,
  ResyncPdfDialog,usePersistedImportReviewController,VisualQualityReviewDialog}.tsx`,
  `pages/admin/PdfImportDiagnostics.tsx`.
- Fixtures: `src/test/fixtures/pdf-import/generateFixtures.ts` (new),
  `ingestion/goldenCorpus/goldenCorpusOrchestrator.ts`.
- Sidecar: `pdf-parse-service/app.py` (lanes, metrics, image/provider routes),
  `Dockerfile`/`requirements.txt` (only if deps change).
- Edge: `supabase/functions/{pdf-parse-dispatch,pdf-parse-chunk-callback,
  pdf-import-diagnostics,pdf-parse-recover-stuck-jobs,template-design-agent}/index.ts`.
- Gate script: `scripts/regression/pdf-import-release-gate.mjs` (only if adding
  new required checks).
</content>
