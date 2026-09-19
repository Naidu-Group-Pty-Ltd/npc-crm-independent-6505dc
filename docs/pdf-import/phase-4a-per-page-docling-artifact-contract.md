# Phase 4A — Per-Page Docling Artifact Contract

## 1. Macro Objective

Phase 4 moves PDF import from document-level extraction to page-level extraction.

The goal is to make every source page independently inspectable, debuggable, comparable, and repairable.

Current document-level artifacts include:

- {jobId}/docling.json
- {jobId}/outline.json
- {jobId}/document.md
- {jobId}/doctags.md
- {jobId}/rasters-manifest.json
- {jobId}/pages/page-001.png

Phase 4 adds per-page Docling artifacts:

- {jobId}/pages/page-001/docling.json
- {jobId}/pages/page-001/blocks.json
- {jobId}/pages/page-001/tables.json
- {jobId}/pages/page-001/pictures.json
- {jobId}/pages/page-001/summary.json

This contract defines the storage layout, manifest shape, validation rules, and parent result payload fields.

## 2. Contract Version

Canonical version:

per-page-docling-v1

Parent pdf_import_jobs.result_payload must eventually include:

{
  "per_page_docling_artifact_version": "per-page-docling-v1",
  "per_page_docling_manifest_path": "<jobId>/pages-manifest.json",
  "per_page_docling_page_count": 61,
  "per_page_docling_validation": {
    "ok": true,
    "version": "per-page-docling-validation-v1",
    "problems": []
  }
}

## 3. Parent Storage Layout

Finalized parent jobs use global page numbers:

{jobId}/pages-manifest.json

{jobId}/pages/page-001/docling.json
{jobId}/pages/page-001/blocks.json
{jobId}/pages/page-001/tables.json
{jobId}/pages/page-001/pictures.json
{jobId}/pages/page-001/summary.json

The page folder must always use global page numbering:

page-001
page-002
...
page-NNN

## 4. Chunk Storage Layout

Chunk jobs may initially write chunk-local artifacts:

{jobId}/chunks/0001/pages/page-001/docling.json
{jobId}/chunks/0001/pages/page-001/blocks.json
{jobId}/chunks/0001/pages/page-001/tables.json
{jobId}/chunks/0001/pages/page-001/pictures.json
{jobId}/chunks/0001/pages/page-001/summary.json

Chunk-local pages must be rebased into parent-global pages.

Formula:

global_page_no = chunk.page_start + local_page_no - 1

Example:

chunk_index = 2
page_start = 6
local_page_no = 1
global_page_no = 6

Therefore:

chunk 0002 local page-001
becomes parent global page-006

## 5. Parent Manifest Shape

The parent manifest path is:

{jobId}/pages-manifest.json

Expected shape:

{
  "version": "per-page-docling-v1",
  "job_id": "uuid",
  "source": "chunk-merge",
  "page_count": 61,
  "generated_at": "2026-06-24T00:00:00.000Z",
  "pages": [
    {
      "page_no": 1,
      "width": 1190,
      "height": 1684,
      "docling_path": "job/pages/page-001/docling.json",
      "blocks_path": "job/pages/page-001/blocks.json",
      "tables_path": "job/pages/page-001/tables.json",
      "pictures_path": "job/pages/page-001/pictures.json",
      "summary_path": "job/pages/page-001/summary.json",
      "raster_path": "job/pages/page-001.png",
      "source_chunk_index": 1,
      "source_chunk_page_no": 1
    }
  ],
  "validation": {
    "ok": true,
    "problems": []
  }
}

## 6. Per-Page Artifact Shapes

### 6.1 docling.json

Per-page Docling artifact must contain only objects belonging to that page.

Expected shape:

{
  "version": "per-page-docling-v1",
  "job_id": "uuid",
  "page_no": 1,
  "schema_name": "DoclingDocumentPage",
  "pages": {
    "1": {
      "page_no": 1,
      "width": 1190,
      "height": 1684
    }
  },
  "texts": [],
  "tables": [],
  "pictures": [],
  "summary": {}
}

Rules:

- page_no must be global.
- pages object must contain exactly one page key.
- nested page object must have the same global page_no.
- texts, tables, and pictures must only contain items whose prov.page_no matches the global page.

### 6.2 blocks.json

Normalized page blocks used by future visual diff and AI repair.

Expected shape:

{
  "version": "per-page-docling-v1",
  "page_no": 1,
  "blocks": [
    {
      "id": "text-1",
      "type": "text",
      "label": "paragraph",
      "text": "Example text",
      "bbox": null,
      "confidence": null,
      "source": "docling"
    }
  ]
}

Rules:

- Blocks must be page-local but tagged with global page_no.
- Text, table, and picture blocks should be normalized into a common structure.
- Missing optional values may be null.

### 6.3 tables.json

Expected shape:

{
  "version": "per-page-docling-v1",
  "page_no": 1,
  "tables": []
}

### 6.4 pictures.json

Expected shape:

{
  "version": "per-page-docling-v1",
  "page_no": 1,
  "pictures": []
}

### 6.5 summary.json

Expected shape:

{
  "version": "per-page-docling-v1",
  "page_no": 1,
  "text_block_count": 12,
  "table_count": 1,
  "picture_count": 3,
  "text_chars": 1800,
  "ocr_chars": 0,
  "avg_text_confidence": null,
  "has_raster": true,
  "has_tables": true,
  "has_pictures": true
}

## 7. Required Validation Rules

A parse job should not be considered fully clean unless:

- parent page_count equals manifest page_count
- manifest pages are continuous 1..N
- no duplicate page numbers exist
- every page has docling_path
- every page has blocks_path
- every page has summary_path
- chunk-local pages are rebased to global page numbers
- per-page Docling page key matches nested page_no
- page item provenance does not reference the wrong page

If validation fails:

status = recoverable_failed
stage = failed
error_code = per_page_docling_validation_failed

## 8. Parent Result Payload Fields

Once Phase 4 is implemented, parent pdf_import_jobs.result_payload must include:

{
  "per_page_docling_artifact_version": "per-page-docling-v1",
  "per_page_docling_manifest_path": "job-id/pages-manifest.json",
  "per_page_docling_page_count": 61,
  "per_page_docling_validation": {
    "ok": true,
    "version": "per-page-docling-validation-v1",
    "problems": []
  }
}

For chunked jobs, this must sit alongside existing markers:

{
  "artifact_contract_version": "raster-manifest-v1",
  "docling_page_rebase_version": "chunk-page-rebase-v1",
  "chunk_merge_validation_version": "chunk-merge-validation-v1",
  "terminal_state_version": "terminal-state-normalizer-v1"
}

## 9. Phase 4A Done Criteria

Phase 4A is complete when:

- this contract is committed to the repo
- all future Phase 4 implementation uses per-page-docling-v1
- Phase 4B can begin without ambiguity around storage paths or payload fields
