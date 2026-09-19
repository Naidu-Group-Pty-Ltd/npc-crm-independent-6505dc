# PDF Import — Path-to-100 v2 · Work Package C0 Baseline

**Package:** C0 — Freeze the baseline and establish evidence
**Master plan:** `PDF-IMPORT-PATH-TO-100-V2.md` (external runbook)
**Recorded:** 2026-07-16
**Scope of this document:** a truthful, non-secret baseline for the PDF-import architecture, captured **before** any functional change. No production state was modified. Supabase was accessed read-only (MCP); Google Cloud Run was not touched.

---

## 1. Git baseline & branch topology

| Fact | Value |
|---|---|
| Working branch | `claude/document-analysis-clz4vi` |
| Baseline HEAD SHA | `eacd2418a7afd7cad883dca752209d239dc2509a` ("Fixed Report Q&A persistence", 2026-07-16) |
| Runbook's declared baseline | `main @ eacd2418…` — **matches HEAD exactly** |
| `origin/main` | `f4f54e1caf60d2f3d0ac6c7da3f0d5363df90027` ("Changes", 2026-07-14) |
| HEAD vs `origin/main` | HEAD is **93 commits ahead**; `origin/main` is an **ancestor** of HEAD |
| Working tree | clean (only gitignored `dist/`, `node_modules/`, `reports/` untracked) |

**Important topology note.** The entire PDF-import architecture that this plan completes lives in the 93 commits on `claude/document-analysis-clz4vi` that are **not yet on `origin/main`**. `importQualityGate.ts` (and the other pdfImport modules) are **absent** on `origin/main` and present on HEAD. Consequences:

- The designated branch already sits on the reviewed baseline commit; **do not** reset it to `origin/main` (that would delete the architecture). Continue work here.
- A PR from this branch to `main` will show the full 93-commit body of PDF-import work plus C0. That is the real repository state, not a mistake.
- The runbook's "refresh from main before beginning" instruction is satisfied: "main" in the runbook's sense **is** this branch's HEAD; `origin/main` is a stale ancestor.

---

## 2. Supabase project & migration state (read-only)

| Fact | Value |
|---|---|
| Project | `dduzbchuswwbefdunfct` — "NPC Property Dashboard" (org `nchuigmqbfcdhdgplrxq`) |
| Region / status | `ap-southeast-1` · `ACTIVE_HEALTHY` · Postgres 17.4 |
| Repo migration head | `20260715145224_86c60cff-5f00-4a23-b721-fea83bb4b944.sql` (528 migration files) |
| **Live** DB migration head | `20260715145228` (Jul 15) — in sync with the repo head (~4s apart) |

The live column set for the PDF-import tables matches the branch's migrations (including recent additions `plan_payload`, `callback_received_at`, `cloud_run_ms`, `timed_out_at`), so **the branch code and the deployed database agree** — the C0–C2 analysis holds against production.

> Deferred (non-blocking, read-only, re-runnable): deployed Edge Function *version numbers* via `list_edge_functions`. The relevant functions all exist in the repo (§4); versions can be pulled when a controlled deploy is planned.

---

## 3. Baseline command suite — results

Run on `eacd2418` after `npm ci` (which **succeeded** — the lockfile is in sync on this commit; no `npm install` fallback was needed). Full logs saved to a non-committed local evidence folder (not in git).

| Command | Result | Notes |
|---|---|---|
| `npm ci` | ✅ success | node_modules 699M |
| `npx tsc -p tsconfig.app.json --noEmit` | ✅ exit 0 | no type errors (152s) |
| `npx vitest run src/lib/reportTemplate/pdfImport src/lib/reportTemplate/ingestion/visualQuality src/components/templateBuilder` | ✅ exit 0 | **12 files, 112 tests passed**; empty `templateBuilder` path did not error |
| `npm run pdf-import:release-gate:no-build` | ✅ exit 0 | **PASS_WITH_WARNINGS, score 100/100**; 49 checks (45 pass / 0 warn / 0 fail / 4 skip) |
| `npm run build` (`vite build`) | ✅ exit 0 | builds; only the informational >500 kB chunk-size warning |
| `python3 -m py_compile pdf-parse-service/app.py` | ✅ exit 0 | sidecar compiles |

**Pre-existing failures: NONE.** The baseline is green. Any failure introduced by later packages is therefore new by definition (no baseline noise to subtract).

> Convention note: CI runs `pdf-import:release-gate:static` (which builds); `:no-build` used here is the documented local-fast variant. There is no dedicated `typecheck` npm script — type-checking is the `tsc … --noEmit` invocation above (also implicit in `vite build`).

---

## 4. Architecture inventory (callers of dispatcher / callback / quality gate / renderers)

### Serverless (Supabase Edge Functions, Deno) — all present
Core PDF-import lane: `pdf-parse-dispatch`, `pdf-parse-callback`, `pdf-parse-chunk-callback`, `pdf-parse-recover-stuck-jobs`, `template-import-pdf`, `pdf-import-diagnostics`, `template-design-agent`.
Adjacent: `template-import-finalize-worker`, `pdf-import-client-report`, `pdf-import-monitoring`, `pdf-import-retention`, `pdf-import-ssim-score`, `render-source`, `render-template-pdf`, `template-ai-author`, `parse-property-pdf`, `parse-template-document`, `parse-formara-pdf`.

### Call graph
```
Frontend extractPdfViaDocling.ts
  → template-import-pdf { create_import, upload_asset, stage_artifacts, start_finalize, get_status }
  → pdf-parse-dispatch  { upload_source, start, status(poll) }
        → runJob → findCachedJob / serveFromCache            (cache path)
                 → callSidecarPlan → Cloud Run /plan
                 → runChunkedDispatch → dispatchChunkToSidecar → Cloud Run /parse-chunk   (chunked)
                 → Cloud Run /parse                                                        (monolithic)
  Cloud Run sidecar → pdf-parse-callback           (monolithic completion)
                    → pdf-parse-chunk-callback      (per-chunk completion + finalizer/merge)
  cron → pdf-parse-recover-stuck-jobs → redispatch stale chunks

Quality gate: extractPdfViaDocling → runImportQualityGate → runVisualRepairOrchestrationPipeline
              (also invoked on-demand from usePersistedImportReviewController: runVisualQa / runRepair / forceMode)

Renderers consuming page.background.underlay / imageUrl + page.meta.sourceRasterRef:
  htmlRenderer.ts, pdfRenderer.ts, pptxExporter.ts, EditorialCanvas.tsx,
  visualQuality generatedRenderCapture (QA capture), imagePreloader.ts

Review UI: ImportReviewDialog.tsx ↔ usePersistedImportReviewController.ts
Diagnostics UI: PdfImportDiagnostics.tsx → pdf-import-diagnostics { stats, list, get, download }
```

### Schema snapshot — live-confirmed (all IDs `uuid`)
- **`pdf_import_jobs`**: id, user_id, template_id(→report_templates, nullable), source_file_*, engine, engine_version, mode, status, stage(+timing), page_count, ssim_score, error_*, diagnostics_path, request_payload/result_payload/attempts/plan_payload (jsonb, NOT NULL), source_file_hash, pages_total/completed, **cache_hit** (bool), **cache_source_job_id** (uuid), **idempotency_key**, bytes_in/out, chunked, chunks_total/completed/failed, **callback_received_at**, cloud_run_ms, timed_out_at.
  **→ No `template_import_id` column** (C1.3 correlation gap, confirmed live).
- **`pdf_import_chunks`**: id, job_id(→jobs, CASCADE), parent_chunk_id, chunk_index, page_start/end, page_count, status, attempts/max_attempts, artifact_paths/summary (jsonb), error_*, timing.
  **→ No `mode`/`extractor_lane`/`service_class` column** (C1.6 redispatch-class gap, confirmed live).
- **`template_imports`**: id, user_id, status, fidelity_mode, source_filename, source_size_bytes, page_count, created_template_id, error, **meta jsonb** (carries the job↔import link today), timestamps.
- **`pdf_import_golden_runs`**: metadata-only ledger; FKs `import_id`→template_imports, `template_id`→report_templates.

---

## 5. Confirmed defects the plan targets (verified this session)

The seven "non-negotiable corrections" all map to real, code-level defects on this baseline:

1. Dispatcher `PlanResult` (`pdf-parse-dispatch/index.ts:491`) declares 4 fields; `runJob` reads 6 more via `as PlanResult` cast. `callSidecarPlan` declared `(url, jobId)` (`:498`) but called with 4 args (`:687`); `/plan` body sends only `{url}` (`:507`). → **C1**
2. Fidelity scored from `buildCdirSelfExpectations` (`repair/repairBridge.ts:113`, `cdir_self_baseline`); source-derived `buildDoclingExpectations` exists but only feeds the CDIR report. → **C3**
3. `htmlRenderer.ts` never consults `overlay.locked` — pixel raster + native overlays both render. → **C5**
4. `DEFAULT_QUALITY_GATE_MAX_PAGES = 40` → `page_count_exceeds_gate_limit`; no batching. → **C4**
5. AI patch envelope `patches as TemplateImportPatch[]` (cast, not runtime-validated). → **C9**
6. Cache/idempotency keys fold in `mode` but **not `redact_pii`/lane/DPI** → redacted request can serve/replay a non-redacted job; `serveFromCache` copies only docling/rasters/manifest/page-PNGs (not the per-page tree). → **C1**
7. `get_artifacts` computes signed maps then drops them (`template-import-pdf/index.ts:1205-1206` vs `:1208` return); `PdfPageContextArtifacts` omits `ocr_path`/`vectors_path` though the sidecar writes both. → **C2**

---

## 6. Exit gate & recommended first code commit

**C0 exit gate — met:** baseline SHA + branch recorded; live schema/migration state confirmed; full command suite green with **no pre-existing failures**; architecture/call-graph inventory captured; **no production state changed**; Cloud Run untouched; Supabase read-only.

**Recommended first code commit (C1):** `pdf-import: repair dispatcher plan v2 and cache fingerprint` — introduce `pdf-plan-contract-v2` with a runtime validator, fix the `callSidecarPlan` signature/body to forward mode + chunking, add an indexed `template_import_id uuid` FK to `pdf_import_jobs` (thread `importId` from the frontend `start` body), and add a `cache_contract_fingerprint` that includes `redact_pii`/lane/DPI/description policy so a redacted request cannot reuse an unredacted result. C1 and C2 share the cache artifact-completeness work and must both precede release gate R0 and any sidecar redeploy.
