# Phase 7F — Export Parity Validation

## Goal

Export parity answers a single question:

> Does the **final exported / generated PDF** still match the **original uploaded
> PDF** and the **Template Builder editor preview**?

Concretely, parity validation captures three comparisons for an import:

- **editor vs source** — Template Builder editor preview vs original uploaded PDF
  (this is the Visual QA lineage from Phases 4–6).
- **export vs source** — final exported/generated PDF vs original uploaded PDF.
- **export vs editor** — final exported/generated PDF vs editor preview.

The results are persisted **without mutating the template**. Phase 7F is a
validation/diagnostics layer only.

## Hard rules (what Phase 7F must NOT do)

- Do **not** overwrite `report_templates` during parity validation.
- Do **not** mutate templates during parity validation.
- Do **not** auto-run AI reconciliation (Phase 7E) from parity validation.
- Do **not** add Phase 7E logic into the parity path.

Parity is read-only with respect to templates. The only writes it performs are:

1. a JSON artifact at `{importId}/export-parity/export-parity.json` in the
   `template-import-artifacts` bucket, and
2. a compact summary written to `template_imports.meta.export_parity_summary`
   plus the pointer `template_imports.meta.export_parity_artifact_path`.

## Current mode: MANUAL (MVP)

**Automated export comparison is not feasible in the current repo**, so Phase 7F
ships the *manual parity capture* path as the minimum viable path.

### Why automation is not yet possible

- The export path (`renderHtmlToPdfUrl` in `weasyRenderClient.ts`) returns a
  **transient signed URL** to a generated PDF. It is not persisted as an
  import-linked artifact, so there is no stable exported-PDF path to rasterize.
- There is **no exported-PDF rasterization** step (the Visual QA pipeline
  rasterizes the *source* PDF and the *editor* render, but never the exported
  PDF).
- Consequently there is **no exported-vs-source or exported-vs-editor image
  comparison** anywhere in the pipeline.

Until those pieces exist, `mode` is always `'manual'` and scores/counts are
supplied by an operator (or a future automated runner), not computed here.

### What must be built to enable automation (`mode: 'automated'`)

1. Persist the exported PDF as an import-linked artifact
   (`{importId}/export-parity/exported.pdf`) instead of a transient URL.
2. Add an exported-PDF rasterization step producing
   `{importId}/export-parity/exported-rasters/`.
3. Reuse the existing pixel-diff/scoring utilities (Phase 7C/7D fidelity utils)
   to compute `exportVsSourceScore` / `exportVsEditorScore` per page.
4. Populate `ExportParityPageSummary[]` and set `mode: 'automated'` (or
   `'hybrid'` when an operator overrides automated scores).

The type model already reserves fields for all of the above
(`ExportParityArtifactPaths.exportedPdfPath`, `exportedRasterFolder`,
`diffRasterFolder`; `ExportParityPageSummary`), so enabling automation is
additive and does not change the persisted shape.

## Data model

`src/lib/reportTemplate/ingestion/exportParity/`

- `exportParityTypes.ts` — `ExportParitySummary`, `ExportParityStatus`
  (`not_run | completed | manual_required | failed`), `ExportParityMode`
  (`manual | automated | hybrid`), score/page/artifact-path types, and the
  `isValidExportParityStatus` / `isValidExportParityMode` validators.
  Version tag: `export-parity-summary-v1`.
- `manualExportParity.ts` — `buildManualExportParitySummary(input)` derives a
  safe summary from operator-supplied scores/counts. It never renders or
  compares. Status logic:
  - any hard-failure problem marker
    (`export_failed`, `rasterization_failed`, `comparison_failed`,
    `missing_required_artifact`) → `failed`;
  - otherwise, no valid score present → `manual_required`;
  - otherwise → `completed`.

  A score is valid only if it is a finite number in `[0, 1]` (never clamped;
  anything else becomes `null`). When all three page counts are finite and not
  all equal, a `page_count_mismatch` problem is added. `manualReviewRequired`
  is set when the caller requests it, when no valid score exists, when any
  problem is present, or on a page-count mismatch.
- `exportParityPersistence.ts` — `saveExportParitySummary` /
  `loadExportParitySummary`, which call the secure edge function operations
  below. Missing artifacts resolve to `{ kind: 'missing' }` rather than an
  error.
- `index.ts` — barrel.

## Persistence (secure edge function)

`supabase/functions/template-import-pdf/index.ts` gains two operations,
mirroring `save_visual_repair_audit`:

- `save_export_parity` — ownership-checked; uploads the JSON artifact to
  `{importId}/export-parity/export-parity.json` (upsert) and writes the compact
  `meta.export_parity_summary` + `meta.export_parity_artifact_path`. Returns
  `{ ok: true, summary_path, artifactPaths: { summary, folder } }`.
- `get_export_parity` — ownership-checked; resolves
  `meta.export_parity_artifact_path` (falling back to the default path), reads
  the JSON artifact, and returns `null` when it is missing.

Both go through the anonymous browser client → secure function (service role)
pattern; the browser client never has privileged access.

The `list_visual_quality` operation is extended to surface
`export_parity_artifact_path` and a compact `export_parity` object
(status, mode, the three scores, `manualReviewRequired`, `problemCount`,
`persistedAt`) so the diagnostics table can render an Export column without a
second round trip.

## Diagnostics surface

`src/pages/admin/TemplateImportQuality.tsx` adds a compact **Export** column:

- **Not run** — no parity summary persisted.
- **Completed · 91%** — completed; percentage is the best available score.
- **Manual required** — completed capture but no automated score / needs an
  operator.
- **Failed** — a hard-failure marker was recorded.

A small **Review** badge appears alongside when `manualReviewRequired` is set
but the status is not already `manual_required`. The UI is intentionally
compact — parity detail lives in the JSON artifact, not the table.

## Regression check

`scripts/regression/pdf-import-phase-7f-export-parity-check.sql` (read-only):

1. latest export-parity summaries,
2. imports with a Visual QA report but no parity capture yet,
3. summaries flagged for manual review / carrying problems,
4. summary counts by status,
5. a guardrail query asserting parity persistence did **not** move
   `report_templates.updated_at` (expected: zero rows).

## Tests

- `exportParityTypes.spec.ts` — validators + version/shape constants.
- `manualExportParity.spec.ts` — status derivation, score normalization,
  page-count mismatch, `manualReviewRequired`, hard-failure markers, and the
  empty-`importId` guard.
- `exportParityPersistence.spec.ts` — request envelope shape and the
  ok / missing / error result mapping for save and load.
