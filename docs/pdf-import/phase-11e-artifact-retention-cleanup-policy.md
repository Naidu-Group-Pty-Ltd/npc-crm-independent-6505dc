# PDF Import Phase 11E — Artifact Retention + Cleanup Policy

## Objective

Phase 11E defines artifact retention and cleanup governance for the PDF import
production system. It creates **dry-run** retention analysis, cleanup-candidate
detection, and operator review workflows. It performs **no physical cleanup**.

## Why This Exists

The PDF import system produces many artifacts and metadata records. Without
retention policy, production risks include storage bloat, metadata bloat,
private-artifact over-retention, orphaned storage objects, and unclear cleanup
boundaries.

## What Phase 11E Does

- Defines retention domains, decisions, cleanup actions, and safety levels.
- Creates the retention policy rule catalog (18 canonical rules).
- Creates the durable retention event table `public.pdf_import_retention_events`.
- Creates the retention evaluator (dry-run candidate detection).
- Creates the secure `pdf-import-retention` Edge Function.
- Creates the `/admin/pdf-import-retention` admin page.
- Adds a review / approve-for-future-cleanup / reject / block / supersede workflow.
- Adds read-only SQL validation and tests.

## What Phase 11E Does Not Do

- Does not physically delete files or database rows.
- Does not physically archive files.
- Does not compact metadata automatically.
- Does not mutate templates.
- Does not call AI.
- Does not rerun imports.
- Does not change storage lifecycle rules automatically.
- Does not store raw PDF/OCR text, raster content, signed URLs, or secrets.
- Does not expose private artifacts.

## Default Mode

**Dry-run only.** The system identifies candidates but does not clean them.

## Retention Domains

`source_pdf`, `docling_artifact`, `page_manifest`, `diagnostics`,
`visual_quality`, `visual_repair`, `export_parity`, `golden_regression`,
`golden_history`, `monitoring_events`, `phase10_metadata`, `operator_audit`,
`storage_orphan`, `metadata_reference`, `unknown`. (`golden_regression` is
covered via the `golden_history` + `export_parity` evidence rules.)

## Discovered Artifact Path Patterns

Import metadata references artifacts through storage-path keys, including:
`visual_quality_artifact_path`, `visual_repair_artifact_path`,
`export_parity_artifact_path`, `sign_pdf_diagnostics_artifact_path`,
`import_manifests_artifact_path`, `cdir_artifact_path`,
`cdir_fidelity_artifact_path`, `source_chunk_artifact_path`,
`schema_artifact_path`, `import_asset_artifact_path`. The artifact bucket is
`template-import-artifacts`; diagnostics also use `pdf-import-diagnostics`. Any
value that looks like an http(s)/signed URL is ignored and never stored.

## Retention Decisions

- `retain` — keep artifact/record.
- `review` — needs operator/developer review.
- `archive_candidate` — can be moved to cheaper/long-term storage later.
- `delete_candidate` — can be deleted later after approval.
- `blocked` — must not be deleted or archived automatically.
- `unknown` — insufficient information.

## Cleanup Actions

`no_action`, `mark_for_review`, `archive_later`, `delete_later`,
`compact_metadata_later`, `repair_reference`, `preserve_for_audit`,
`preserve_for_regression`, `preserve_for_manual_review`, `blocked_from_cleanup`.

## Safety Levels

- `safe_to_recommend`
- `requires_operator_approval`
- `requires_developer_approval`
- `manual_only`
- `blocked`

## Retention Windows

See `phase-11e-retention-policy.md` for the full table. Defaults: docling/page
manifest/visual QA/visual repair/export parity 180d; diagnostics 90d (180d for
failed imports); golden artifacts 365d; resolved monitoring events 180d;
orphaned storage objects 90d; source PDFs and operator audits retained
indefinitely.

## Candidate Lifecycle

`candidate` → `reviewed` → `approved_for_future_cleanup` / `rejected` /
`blocked` / `superseded`. `completed` exists for future compatibility and is
**not used** in Phase 11E (no physical cleanup occurs).

## Permissions

New capabilities (deny-by-default; `pdf_admin` and `developer_admin` only):

- `pdf_import.view_retention`
- `pdf_import.run_retention_scan`
- `pdf_import.manage_retention_candidates`

Approving a `delete_candidate` that is `requires_developer_approval` requires
`developer_admin` (superadmin); `pdf_admin` can review / reject / block but not
approve developer-level candidates.

## Acceptance Criteria

- docs, schema, migration, Edge Function, TS modules, and admin page exist.
- tests pass; SQL runs.
- no physical cleanup is performed.
- no private artifacts, signed URLs, or raw content are stored/committed.
