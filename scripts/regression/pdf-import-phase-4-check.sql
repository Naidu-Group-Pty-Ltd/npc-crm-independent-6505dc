-- Phase 4 Regression Check
-- Purpose:
--   Validate per-page Docling artifacts, parent page manifests,
--   parent-global page artifacts, and PageContext consumer readiness.
--
-- Run this in Supabase SQL Editor.

-- ---------------------------------------------------------------------------
-- 1. Latest successful monolithic/small PDF jobs with parent per-page manifest
-- ---------------------------------------------------------------------------
select
  id,
  source_file_name,
  status,
  stage,
  page_count,
  cache_hit,
  chunked,
  result_payload->>'per_page_docling_artifact_version' as per_page_docling_artifact_version,
  result_payload->>'per_page_docling_manifest_path' as per_page_docling_manifest_path,
  result_payload->>'per_page_docling_page_count' as per_page_docling_page_count,
  result_payload->'per_page_docling_validation'->>'ok' as per_page_docling_validation_ok,
  jsonb_array_length(coalesce(result_payload->'page_raster_paths', '[]'::jsonb)) as page_raster_count,
  result_payload->'merge_validation'->>'ok' as merge_validation_ok,
  created_at,
  updated_at
from public.pdf_import_jobs
where status = 'succeeded'
  and stage = 'parsed'
  and cache_hit is not true
  and coalesce(chunked, false) = false
order by created_at desc
limit 10;

-- Expected:
--   per_page_docling_artifact_version = per-page-docling-v1
--   per_page_docling_manifest_path is not null
--   per_page_docling_page_count = page_count
--   per_page_docling_validation_ok = true


-- ---------------------------------------------------------------------------
-- 2. Latest successful chunked PDF jobs with parent-global page artifacts
-- ---------------------------------------------------------------------------
select
  id,
  source_file_name,
  status,
  stage,
  page_count,
  cache_hit,
  chunked,
  chunks_total,
  chunks_completed,
  chunks_failed,
  pages_completed,
  pages_total,
  error_code,
  error_text,
  result_payload->>'per_page_docling_artifact_version' as per_page_docling_artifact_version,
  result_payload->>'per_page_docling_parent_manifest_version' as per_page_docling_parent_manifest_version,
  result_payload->>'per_page_docling_global_artifact_copy_version' as per_page_docling_global_artifact_copy_version,
  result_payload->>'per_page_docling_manifest_path' as per_page_docling_manifest_path,
  result_payload->>'per_page_docling_page_count' as per_page_docling_page_count,
  result_payload->'per_page_docling_validation'->>'ok' as per_page_docling_validation_ok,
  result_payload->'per_page_docling_validation'->'problems' as per_page_docling_validation_problems,
  result_payload->'per_page_docling_global_artifact_copy'->>'copied_artifact_count' as copied_artifact_count,
  result_payload->'per_page_docling_global_artifact_copy'->'problems' as copy_problems,
  jsonb_array_length(coalesce(result_payload->'chunk_per_page_docling_manifest_paths', '[]'::jsonb)) as chunk_per_page_manifest_count,
  result_payload->'merge_validation'->>'ok' as merge_validation_ok,
  result_payload->'merge_validation'->'problems' as merge_validation_problems,
  jsonb_array_length(coalesce(result_payload->'page_raster_paths', '[]'::jsonb)) as parent_page_raster_count,
  created_at,
  updated_at,
  finished_at
from public.pdf_import_jobs
where status = 'succeeded'
  and stage = 'parsed'
  and cache_hit is not true
  and chunked = true
order by updated_at desc
limit 10;

-- Expected:
--   status = succeeded
--   stage = parsed
--   error_code = null
--   error_text = null
--   chunks_total = chunks_completed
--   chunks_failed = 0
--   pages_completed = pages_total = page_count
--   per_page_docling_artifact_version = per-page-docling-v1
--   per_page_docling_parent_manifest_version = chunk-parent-pages-manifest-v1
--   per_page_docling_global_artifact_copy_version = parent-global-page-artifact-copy-v1
--   per_page_docling_manifest_path is not null
--   per_page_docling_page_count = page_count
--   per_page_docling_validation_ok = true
--   copied_artifact_count is not null
--   copy_problems = []
--   chunk_per_page_manifest_count = chunks_total
--   merge_validation_ok = true
--   parent_page_raster_count = page_count


-- ---------------------------------------------------------------------------
-- 3. Chunk-local artifact contract for latest successful chunked job
-- ---------------------------------------------------------------------------
with latest_chunked as (
  select id
  from public.pdf_import_jobs
  where status = 'succeeded'
    and stage = 'parsed'
    and cache_hit is not true
    and chunked = true
  order by updated_at desc
  limit 1
)
select
  c.job_id,
  c.chunk_index,
  c.page_start,
  c.page_end,
  c.page_count,
  c.status,
  c.attempts,
  c.error_code,
  c.error_text,
  artifact_paths ? 'rasters_manifest_path' as has_rasters_manifest_path,
  artifact_paths->>'rasters_manifest_path' as rasters_manifest_path,
  jsonb_array_length(coalesce(artifact_paths->'page_raster_paths', '[]'::jsonb)) as page_raster_count,
  (c.page_end - c.page_start + 1) as expected_page_count,
  artifact_paths->>'per_page_docling_artifact_version' as per_page_docling_artifact_version,
  artifact_paths->>'per_page_docling_manifest_path' as per_page_docling_manifest_path,
  artifact_paths->>'per_page_docling_page_count' as per_page_docling_page_count,
  artifact_paths->'per_page_docling_validation'->>'ok' as per_page_docling_validation_ok,
  c.updated_at,
  c.finished_at
from public.pdf_import_chunks c
join latest_chunked l on l.id = c.job_id
order by c.chunk_index;

-- Expected for every chunk:
--   status = succeeded
--   error_code = null
--   error_text = null
--   has_rasters_manifest_path = true
--   page_raster_count = expected_page_count
--   per_page_docling_artifact_version = per-page-docling-v1
--   per_page_docling_manifest_path is not null
--   per_page_docling_page_count = expected_page_count
--   per_page_docling_validation_ok = true


-- ---------------------------------------------------------------------------
-- 4. Template imports that received Phase 4 page manifest metadata
-- ---------------------------------------------------------------------------
select
  id,
  status,
  source_filename,
  page_count,
  meta->'import_manifests_summary'->'pdf_import_job' as pdf_import_summary,
  meta->'import_manifests'->'pdf_import_job'->>'job_id' as pdf_job_id,
  meta->'import_manifests'->'pdf_import_job'->>'per_page_docling_artifact_version' as per_page_docling_artifact_version,
  meta->'import_manifests'->'pdf_import_job'->>'per_page_docling_manifest_path' as per_page_docling_manifest_path,
  meta->'import_manifests'->'pdf_import_job'->>'per_page_docling_page_count' as per_page_docling_page_count,
  updated_at
from public.template_imports
where meta->'import_manifests'->'pdf_import_job'->>'per_page_docling_manifest_path' is not null
order by updated_at desc
limit 10;

-- Expected:
--   per_page_docling_manifest_path is not null for Phase 4-backed imports.
--   Older Phase 2/3 imports may be absent from this result and should still use legacy fallback.
