---
name: PDF Chunked Pipeline (Wave G)
description: Chunked Docling parse for large PDFs. Pdf-parse-dispatch plans page ranges, fans out /parse-chunk requests to the sidecar, and pdf-parse-chunk-callback handles retry/split/finalize. Monolithic /parse path still serves ≤20-page docs.
type: feature
---

# Chunked PDF import (Wave G — extends mem://architecture/pdf-import-pipeline)

## When chunked path runs
- `pdf-parse-dispatch` calls sidecar `POST /plan` after hashing.
- ≤20 pages → existing monolithic `/parse` + `pdf-parse-callback` flow.
- 21–60 pages → 10-page chunks. >60 → 5-page chunks. `ocr_hint=true` halves the chunk size.
- `request_payload.force_chunked=true` forces chunked even for small docs.

## Tables
- `pdf_import_chunks` — one row per page range. Statuses: `pending|dispatched|parsing|succeeded|failed|split|fatal`. `parent_chunk_id` links rows produced by splits.
- `pdf_import_jobs` additions: `chunked`, `chunks_total`, `chunks_completed`, `chunks_failed`, `plan_payload` (stores `{source:{kind,bucket,path|url}, page_count, ocr_hint, ...}`), `callback_received_at`.
- Status `recoverable_failed` is now valid on `pdf_import_jobs` for stuck / chunk-retry-exhausted cases.
- DB trigger `recompute_pdf_import_job_progress` keeps the rollup counters in sync; never bump them manually.
- `pdf_import_chunks` is in `supabase_realtime` so the diagnostics dashboard can stream chunk progress.

## Sidecar endpoints
- `POST /plan` — cheap pypdfium2 sample. Returns `{page_count, scanned_page_ratio, ocr_hint, byte_size}`. No Docling work.
- `POST /parse-chunk` — body `{job_id, chunk_id, chunk_index, page_start, page_end, url, mode, callback_url, callback_token, ...}`. Returns 202; background task carves the page range with `pypdfium2`, runs Docling, uploads to `{job_id}/chunks/{NNNN}/{docling.json,doctags.md,document.md,outline.json,rasters.json}`, then POSTs `pdf-parse-chunk-callback`.

## Chunk callback (`pdf-parse-chunk-callback`)
- Auth = `Bearer ${PDF_PARSE_SERVICE_TOKEN}`.
- Success: persists `artifact_paths` + `summary`, then when **all** chunks are `succeeded` (ignoring `split`) it inlines `finalizeJob` to merge per-chunk Docling docs into final `{job_id}/{docling.json,outline.json,document.md,doctags.md,rasters.json}` and flips the job to `succeeded`. Page numbers are rebased to global (`offset = page_start - 1`).
- Failure: retry up to `max_attempts` via `dispatchChunk`. When attempts exhausted but `span > 1`, `splitChunk` halves the span (single pages when span ≤ 5) and dispatches sub-chunks (the parent row is set to `split` so the trigger ignores it). Page-level failure → `fatal`. Any `fatal` rows force the job to `recoverable_failed`.
- Re-signs source via `pdf_import_jobs.plan_payload.source` — never trust the original signed URL across retries.

## Error codes (stable taxonomy)
`chunk_oom`, `chunk_timeout`, `source_fetch_error`, `chunk_retry_exhausted`, `chunk_split_failed`, `chunk_out_of_range`, `chunk_extract_failed`, `final_merge_failed`, `callback_failed`, `dispatch_http_<n>`, `dispatch_exception`.

## Stuck recovery
- `POST pdf-parse-dispatch { operation: 'recover' }` — scans monolithic jobs `parsing` older than 15 minutes (`STUCK_PARSING_MINUTES`) → marks `recoverable_failed`; scans chunks in `dispatched`/`parsing` past `last_event_at` cutoff → re-dispatches (re-signing source from `plan_payload`).
- Wire to pg_cron when ready: hourly is fine.

## Hard rules
- Sidecar must have `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` set or `/parse-chunk` returns `callback_upload_not_configured` (503). Same envs already required for the Option-3 monolithic flow.
- Never write to `chunks_total` / `chunks_completed` / `pages_completed` directly except inside `runChunkedDispatch` initial seed — the trigger owns ongoing maintenance.
- Cache lookup (`source_file_hash` + `mode`) still short-circuits the entire pipeline (chunked or monolithic). Don't bypass it.
- Existing `pdf-parse-callback` is unchanged and still serves the monolithic ≤20-page path.
- Engine version family bumped to `docling-2.14.0+phaseD+waveD+waveG` (dispatcher) / `+waveG-chunked` (sidecar) so cached jobs from earlier versions miss correctly.
