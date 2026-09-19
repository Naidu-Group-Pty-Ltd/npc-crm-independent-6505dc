# PDF Import Engine Phase 1 Audit

## Scope lock

Phase 1 is an audit and scope-lock pass for the Administration PDF Import Engine page. Implementation must remain UI-only for this surface and directly connected import/diagnostics entry points. Do not alter Docling routing, Cloud Run invocation, OCR, raster generation, reconciliation metadata, SSIM artifact handling, diagnostics downloads, signed URL behavior, PII redaction, authentication, permissions, audit logging, import job creation, idempotency, or provider dispatch behavior.

## Theme foundation reviewed first

`docs/dashboard-theme-foundation.md` is the source of truth for this UI uplift. Future page work should prefer dashboard theme tokens and `DashboardThemeFrame` variants (`page`, `hero`, `section`, `sectionAccent`, `card`, `premiumCard`, `chartCard`, `toolbar`) before introducing page-local styling. Preserve shadcn primitives, whitelabel compatibility, and token-based colors such as `bg-card`, `text-foreground`, `text-primary`, `border-border`, `bg-background`, and `text-muted-foreground`.

## Page and route inventory

- PDF Import Engine route: `/admin/pdf-import-engine`, registered in `src/App.tsx` and rendered through `ModuleGuard moduleKey="templates"`.
- PDF Import Engine component: `src/pages/admin/PdfImportEngineAdmin.tsx`.
- Permission gate: `useAuth().isSuperadmin`; non-superadmins see the existing card message, "Superadmin role required to view PDF import engine status."
- Diagnostics route: `/admin/pdf-import-diagnostics`, registered in `src/App.tsx` and rendered through `ModuleGuard moduleKey="templates"`.
- Diagnostics component: `src/pages/admin/PdfImportDiagnostics.tsx`.
- Import entry route: `/admin/template-builder`, registered in `src/App.tsx` and rendered through `ModuleGuard moduleKey="templates"`.
- Import entry component: `src/pages/admin/TemplateBuilder.tsx`; the Import PDF button opens `ImportPdfDialog` with local state.
- Import dialog component: `src/components/templateBuilder/ImportPdfDialog.tsx`.

## PDF Import Engine UI inventory

Existing `PdfImportEngineAdmin` elements to preserve:

- Page title: "PDF import engine".
- Badge: "Docling only".
- Description: Wave F7 retirement removed the legacy in-browser pdf.js template importer and feature-flag rollout controls; new imports, re-imports, rasters, OCR, diagnostics, and reconciliation metadata flow through Cloud Run Docling.
- Status card 1: "Legacy toggle retired" with copy explaining `pdf_import.engine` and the UI selector are no longer used, and dispatcher requests are idempotent and always target the Docling sidecar.
- Status card 2: "Observable pipeline" with copy directing users to diagnostics for attempts, summaries, SSIM artifacts, cost telemetry, and diagnostics bundle links instead of side-by-side legacy comparisons.
- Status card 3: "Compliance defaults" with copy explaining short-lived diagnostic URLs, import-dialog PII redaction availability, and audited diagnostic downloads.
- Primary action: "Open diagnostics" linking to `/admin/pdf-import-diagnostics`.
- Secondary action: "Import a PDF" linking to `/admin/template-builder`.

## Connected diagnostics inventory

Existing `PdfImportDiagnostics` behavior to preserve:

- Reads stats and job rows through `invokeSecureFunction('pdf-import-diagnostics', ...)`.
- Operations used: `stats`, `list`, and `download`.
- Download operation requests a signed URL with `expiresIn: 300` and opens it with `noopener,noreferrer`.
- Realtime updates subscribe to the existing `pdf_import_jobs` publication and patch local rows.
- Existing loading state: `loading` controls refresh disabled state, spinner, and table body state.
- Existing empty state: table renders "No jobs found for current filters." when no rows match.
- Existing error surfacing: auth/function errors are sent to `toast.error`; rows are cleared when listing fails.
- Existing filters: status, engine, and engine version.
- Existing observability content: 7-day totals, success rate, in-flight jobs, latency, SSIM, cost, summary/cohort metadata, recent jobs, status/stage/duration/SSIM/error/diagnostics data.

## Connected import inventory

Existing import behavior to preserve:

- Template Builder Import PDF button sets `importOpen` to true and mounts `ImportPdfDialog`.
- `ImportPdfDialog` validates only `.pdf` filenames and a 50 MB maximum before dispatch.
- Existing fidelity modes: semantic, hybrid default, pixel-perfect, and OCR.
- Existing engine status copy confirms Cloud Run Docling routing and retired legacy pdf.js routing.
- Existing PII control: "Redact likely PII before diagnostics" checkbox, passed as `redactPii`.
- Existing progress states are driven by `ImportProgress` and include reading, uploading, extracting, rasterizing, finalizing, and done.
- Existing errors are surfaced with `toast.error(describeAuthError(...) ?? Import failed...)`.
- Existing success result card includes page count, overlay/vector/image/font/raster metrics, suggested re-import mode, persisted PDF reference asset summary, fidelity score, and review/repair affordances.

## Cloud Run Docling dispatch inventory

- `ImportPdfDialog.start()` calls `runReferenceImport({ kind: 'pdf', file, mode }, ...)` with the current file, mode, user id, superadmin status, progress setter, and PII redaction flag.
- `runReferenceImport()` dynamically imports the provider dispatcher and calls `dispatchImport(...)`, preserving provider attempts and fallback audit trail.
- The Docling extractor path uses `extractPdfViaDocling()`.
- `extractPdfViaDocling()` creates the import record, uploads the source PDF via `invokeSecureFunction('pdf-parse-dispatch', { operation: 'upload_source', ... })`, starts the Cloud Run Docling job via `invokeSecureFunction('pdf-parse-dispatch', { operation: 'start', ... })`, passes `redact_pii` and `pii_redaction_reason`, polls the job, validates consumer guardrails, and uses returned Docling artifacts.

## Retired legacy controls check

The current PDF Import Engine page does not expose a toggle, selector, rollout control, or side-by-side legacy comparison workflow. The page contains explanatory retired-state copy only. Future phases must not add any controls that change `pdf_import.engine`, select `legacy`, reactivate pdf.js routing, or imply a side-by-side legacy comparison path.

## Phase 1 implementation constraint

No code behavior is changed by this audit. Future phases may improve layout, hierarchy, theme usage, responsiveness, accessibility, and state presentation, but handlers, routes, diagnostics calls, signed URL behavior, PII redaction, Cloud Run Docling dispatch, polling, provider dispatch, reconciliation, auth, and audit behavior must remain intact.
