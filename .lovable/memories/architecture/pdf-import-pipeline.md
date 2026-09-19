---
name: PDF Import Pipeline (Docling)
description: Two-engine PDF→template import (legacy pdf.js + Docling sidecar) with async job ledger, feature-flag routing, and superadmin diagnostics. Use this for any change to template PDF ingestion.
type: feature
---

# PDF Import Pipeline

## Architecture (top-down)
- **Entry:** `extractPdfToTemplateRouted` (in `src/lib/reportTemplate/pdfImport/`)
  is the single entry point. It resolves the engine via
  `resolvePdfImportEngine` (feature flag + override + allowlist + `?pdfEngine=`
  URL param) and dispatches to either:
  - `extractPdfToTemplate` (legacy pdf.js, synchronous), or
  - `extractPdfViaDocling` (async; uploads, polls `pdf_import_jobs`, downloads
    `docling.json` + `rasters.json` from the `pdf-import-diagnostics` bucket).
- **Edge layer:** `pdf-parse-dispatch` is a fire-and-forget dispatcher. It
  inserts a `pdf_import_jobs` row, returns `{jobId}` immediately, and runs the
  heavy parse inside `EdgeRuntime.waitUntil`. Status flows
  `queued → uploading → parsing → mapping → finalizing → succeeded|failed`.
  Status `parsed` is mapped to `succeeded` (the DB CHECK constraint forbids
  the intermediate label). Mode keys use underscores (`pixel_perfect`).
- **Sidecar:** `pdf-parse-service/` (FastAPI + Docling on Cloud Run / Fly).
  Secrets `PDF_PARSE_SERVICE_URL` and `PDF_PARSE_SERVICE_TOKEN`.
- **Frontend:** `ImportPdfDialog` carries an engine selector
  (Auto / Legacy / Docling), shows realtime progress from `pdf_import_jobs`,
  and disables the legacy Tesseract OCR option when Docling is active
  (Docling handles OCR natively).

## Admin surfaces (superadmin only)
- `/admin/pdf-import-engine` — edit `feature_flags.pdf_import.engine`
  (`default`, `superadmin` override, `allowlist[]`) and run a side-by-side
  fidelity comparison through both engines. Calls `feature-flags-admin`.
- `/admin/pdf-import-diagnostics` — 7-day rollup (success rate, p50/p95,
  avg SSIM, engine mix) + recent jobs table with status / stage / duration /
  SSIM / signed-URL download of the diagnostics bundle. Realtime via
  `pdf_import_jobs` publication. Calls `pdf-import-diagnostics`.

## Hard rules
- `pdf_import_jobs.source_file_path` is NOT NULL — always provide a fallback
  (e.g. `inline:<file-name>`) when the upload is base64-inline.
- `pdf_import_jobs.status` CHECK only allows the values listed above; map any
  upstream `parsed` to `succeeded` before writing.
- Diagnostics bucket `pdf-import-diagnostics` is private + 7-day TTL; never
  embed signed URLs in templates — re-sign on demand via the diagnostics fn.
- `report_templates.schema` must stay <500 KB; rasters live in Storage, only
  URLs go into the DB.
- Both admin edge functions are `verify_jwt = false` because they re-check
  the superadmin role server-side from `user_roles` (custom auth).
- `pdf_import_jobs` is in the `supabase_realtime` publication — keep it there
  for the diagnostics + progress UIs.
- Legacy pdf.js path stays in code for 30 days after 100% rollout. Do not
  delete it without first flipping every cohort to `docling` and watching for
  one full week.
