# PDF Import Engine Phase 9 QA and Regression Notes

## Scope

This Phase 9 pass covers the Administration PDF Import Engine landing page, the connected diagnostics workspace, and the Import a PDF dialog entry point. The review remains UI-only and is intended to confirm production readiness after the prior theme, workflow, observability, compliance, state-handling, and accessibility passes.

No runtime pipeline, security, audit, diagnostics, or import behavior is changed by this phase.

## Verified surface inventory

- The PDF Import Engine landing page still presents the `PDF import engine` title, `Docling only` badge, explanatory Docling/Cloud Run retirement copy, and the two existing operator actions: `Open diagnostics` and `Import a PDF`.
- The three operational cards remain present and accurate: `Legacy toggle retired`, `Observable pipeline`, and `Compliance defaults`.
- The diagnostics workspace remains routed through the existing diagnostics secure-function operations for stats, list, and audited download behavior.
- The Import a PDF dialog remains the connected upload/import entry point and retains existing validation, progress, result, PII redaction, and import orchestration behavior.
- Loading, empty, pending, success, and failure states remain visible and styled through existing conditions rather than mock data or fake pipeline output.

## Behavior preservation checks

- No retired legacy pdf.js importer control, feature-flag rollout selector, or side-by-side legacy comparison workflow was reintroduced.
- Existing Cloud Run Docling dispatch, OCR, raster generation, SSIM artefacts, cost telemetry, reconciliation metadata, diagnostics bundle handling, PII redaction, signed URL expiry, audit logging, auth checks, and permission gates remain untouched.
- Diagnostics downloads continue to request a short-lived signed URL through the existing secure diagnostics operation instead of exposing stored signed URL values in the UI.
- The import dialog continues to use the existing import handler and provider dispatch path; this phase does not add fake jobs, fake progress, mock diagnostics, or alternate routing.

## Theme, viewport, and accessibility checks

- The landing page, diagnostics workspace, and import dialog remain aligned with the dashboard theme frame and tokenized dark/light-mode styling established in the earlier phases.
- The main page shell stays centered and contained, with responsive wrapping for the title, badge, explanatory copy, status cards, and action buttons.
- The diagnostics controls and table retain responsive containment for long metadata, bundle links, and status values.
- The import dialog remains viewport-safe with scrollable content, keyboard-reachable controls, visible focus states, and clear status announcements for progress/result states.
- Warning, pending, healthy, completed, failed, and compliance states remain mapped to their intended visual semantics without introducing red styling for non-error states.

## Commands run

```bash
rg -n "pdf_import\\.engine|side-by-side|legacy pdf\\.js|feature-flag|Docling only|Open diagnostics|Import a PDF|pdf-parse-dispatch|redact_pii|expiresIn" src/pages/admin/PdfImportEngineAdmin.tsx src/pages/admin/PdfImportDiagnostics.tsx src/components/templateBuilder/ImportPdfDialog.tsx src/lib/reportTemplate/pdfImport/extractPdfViaDocling.ts
npx eslint src/pages/admin/PdfImportEngineAdmin.tsx src/pages/admin/PdfImportDiagnostics.tsx src/components/templateBuilder/ImportPdfDialog.tsx
npm run build
which chromium || which chromium-browser || which google-chrome || true
```

## Production readiness conclusion

The Phase 9 regression pass found no UI-level defects requiring runtime code changes. The PDF Import Engine surfaces are ready for production review as a premium, Docling-only, compliance-aware import command centre, with all existing Cloud Run, diagnostics, import, PII, signed URL, auth, and audit behavior preserved.
