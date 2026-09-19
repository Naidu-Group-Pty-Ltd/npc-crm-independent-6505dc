# Phase 4 — Per-Page Docling Artifacts Implementation Checklist

## 4A — Contract Definition

- [x] Define storage layout
- [x] Define parent manifest shape
- [x] Define per-page artifact shapes
- [x] Define result_payload fields
- [x] Define validation rules
- [x] Define done criteria

## 4B — Cloud Run Per-Page Artifact Generation

- [ ] Add helper to split Docling document by page
- [ ] Generate per-page docling.json
- [ ] Generate per-page blocks.json
- [ ] Generate per-page tables.json
- [ ] Generate per-page pictures.json
- [ ] Generate per-page summary.json
- [ ] Support monolithic parse path
- [ ] Support chunk parse path

## 4C — Upload Page Artifacts

- [ ] Upload page artifacts to diagnostics bucket
- [ ] Store chunk-local page artifact paths in chunk artifact_paths
- [ ] Store monolithic page artifact paths in result_payload

## 4D — Parent Pages Manifest

- [ ] Create pages-manifest.json
- [ ] Include page_count
- [ ] Include page_no 1..N
- [ ] Include paths for docling, blocks, tables, pictures, summary, and raster
- [ ] Include validation report

## 4E — Chunk Finalizer Rebase

- [ ] Rebase chunk-local page artifacts to global page numbers
- [ ] Copy or regenerate parent-level page artifacts
- [ ] Produce parent pages-manifest.json
- [ ] Stamp result_payload with per_page_docling_artifact_version
- [ ] Stamp result_payload with per_page_docling_manifest_path

## 4F — Frontend Consumer Support

- [ ] Read per_page_docling_manifest_path
- [ ] Preserve manifest path in template meta
- [ ] Preserve page artifact manifest in import_manifests

## 4G — Validation Guardrails

- [ ] Validate page artifact count equals page_count
- [ ] Validate continuous page numbers
- [ ] Validate required artifact paths
- [ ] Fail recoverably if per-page artifacts are malformed

## 4H — Regression Lock

- [ ] Add Phase 4 SQL checks
- [ ] Add per-page artifact checks to regression SQL
- [ ] Validate small PDF
- [ ] Validate large chunked PDF
- [ ] Validate cache-hit import
