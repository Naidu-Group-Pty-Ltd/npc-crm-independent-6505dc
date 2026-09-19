# PDF Import Phase 11G — Client-Safe Reporting / Audit Export

## Objective

Phase 11G creates a client-safe reporting and audit export layer for PDF import
workflows. It transforms internal QA, operator, monitoring, and regression state
into safe report summaries that can be reviewed, approved, and exported without
exposing private artifacts or internal implementation details.

## Why This Exists

The internal PDF import system contains sensitive technical evidence and
metadata. Clients and business stakeholders need simple, safe, professional
summaries. Phase 11G creates the boundary between internal diagnostics and
external communication.

## What Phase 11G Does

- Defines client-safe report types, audiences, safety levels, and lifecycle.
- Defines allowed/disallowed content and a redaction policy.
- Creates a redaction-first sanitizer and a deterministic report builder.
- Creates the `pdf_import_client_reports` table and the secure
  `pdf-import-client-report` Edge Function.
- Creates the `/admin/pdf-import-client-reports` admin page with a
  preview → approve → mark-exported workflow.
- Adds SQL validation and tests.

## What Phase 11G Does Not Do

- Does not expose raw PDFs, screenshots, signed URLs, storage paths, raw
  OCR/extracted text, raw metadata JSON, or logs.
- Does not call AI (no AI summarization).
- Does not send emails, create public links, or auto-send reports.
- Does not mutate templates, apply repairs/reconciliation, or rerun imports.
- Does not generate PDF binaries (no safe path confirmed — deferred).

## Report Types

`import_status_summary`, `template_quality_summary`, `manual_review_summary`,
`accepted_with_warnings_summary`, `rejected_import_summary`,
`production_audit_summary`, `release_readiness_summary`.

## Report Audiences

- `internal_operator` — trained operators/admins; limited operational context, no secrets/artifacts.
- `internal_business` — business stakeholders; high-level, non-technical.
- `external_client` — strictest; no internal implementation details. **Default** for client-facing types.

## Safety Levels

- `safe` — shareable after approval.
- `safe_with_warnings` — shareable after admin approval + a warning note.
- `internal_only` — must not be sent externally.
- `blocked` — must not be exported.

## Report Lifecycle

`draft` → `pending_review` → `approved` → `exported`; plus `rejected` and
`superseded`.

## Approval Policy

External-client reports must be approved by `pdf_admin` or `developer_admin`
before export. `safe_with_warnings` reports require an explicit approval note.
`internal_only` and `blocked` reports cannot be exported externally. Only
`approved` reports can be marked exported. Marking exported records that an
approved report was exported/copied — it performs no external delivery.

## Redaction Policy

See `phase-11g-client-safe-report-policy.md`. Every report is sanitized (URLs,
signed URLs, storage/bucket paths, service-role references, stack traces, raw
JSON dumps, env vars, and — for external audiences — internal UUIDs are
removed), then re-scanned; any surviving unsafe content forces `blocked`.

## Permissions

New capabilities (deny-by-default; `pdf_admin` and `developer_admin` only):
`pdf_import.view_client_reports`, `pdf_import.generate_client_report_preview`,
`pdf_import.save_client_report_draft`, `pdf_import.approve_client_report`,
`pdf_import.export_client_report`.

## Acceptance Criteria

- docs, policy, schema, migration, Edge Function, modules, admin page exist.
- tests pass; SQL runs; no private data is exported.
