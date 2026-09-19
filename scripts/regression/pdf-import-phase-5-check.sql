-- Phase 5 Regression Check
-- Purpose:
--   Validate persisted visual QA artifacts for PDF template imports.
--
-- Run this in Supabase SQL Editor.

-- ---------------------------------------------------------------------------
-- 1. Latest imports with persisted visual quality summary
-- ---------------------------------------------------------------------------
select
  id,
  status,
  source_filename,
  page_count,
  created_template_id,
  meta->>'visual_quality_artifact_path' as visual_quality_artifact_path,
  meta->'visual_quality_summary'->>'overallScore' as visual_quality_overall_score,
  meta->'visual_quality_summary'->>'pageCount' as visual_quality_page_count,
  meta->'visual_quality_summary'->>'manualReviewRequired' as manual_review_required,
  meta->'visual_quality_summary'->>'finalMode' as final_mode,
  meta->'visual_quality_summary'->>'repairPassesApplied' as repair_passes_applied,
  meta->'visual_quality_summary'->>'generatedAt' as visual_quality_generated_at,
  updated_at
from public.template_imports
where meta->>'visual_quality_artifact_path' is not null
order by updated_at desc
limit 20;

-- Expected:
--   visual_quality_artifact_path = {importId}/visual-quality.json
--   visual_quality_overall_score is not null
--   visual_quality_page_count > 0
--   final_mode in semantic/hybrid/pixel-perfect


-- ---------------------------------------------------------------------------
-- 2. Storage artifact presence for latest visual QA imports
-- ---------------------------------------------------------------------------
with visual_imports as (
  select
    id,
    page_count,
    meta->>'visual_quality_artifact_path' as summary_path,
    nullif(meta->'visual_quality_summary'->>'pageCount', '')::int as visual_page_count
  from public.template_imports
  where meta->>'visual_quality_artifact_path' is not null
  order by updated_at desc
  limit 20
)
select
  vi.id,
  vi.page_count,
  vi.visual_page_count,
  vi.summary_path,
  count(*) filter (where o.name = vi.summary_path) as summary_object_count,
  count(*) filter (where o.name like vi.id || '/pages/page-%-source.png') as source_raster_objects,
  count(*) filter (where o.name like vi.id || '/pages/page-%-generated.png') as generated_raster_objects,
  count(*) filter (where o.name like vi.id || '/pages/page-%-diff.png') as diff_raster_objects,
  count(*) filter (where o.name like vi.id || '/pages/%') as all_page_raster_objects
from visual_imports vi
left join storage.objects o
  on o.bucket_id = 'template-import-artifacts'
 and o.name like vi.id || '/%'
group by vi.id, vi.page_count, vi.visual_page_count, vi.summary_path
order by vi.id desc;

-- Expected:
--   summary_object_count = 1
--   generated_raster_objects >= visual_page_count for full QA runs
--   diff_raster_objects >= visual_page_count for full QA runs
--   source_raster_objects may be 0 or visual_page_count depending whether source rasters were re-uploaded
--   all_page_raster_objects > 0


-- ---------------------------------------------------------------------------
-- 3. Visual QA report payload integrity
-- ---------------------------------------------------------------------------
with latest_visual as (
  select
    id,
    meta->>'visual_quality_artifact_path' as summary_path
  from public.template_imports
  where meta->>'visual_quality_artifact_path' is not null
  order by updated_at desc
  limit 1
)
select
  id,
  summary_path
from latest_visual;

-- Note:
--   Supabase SQL Editor cannot easily parse private Storage object JSON payloads
--   without a custom helper. Use get_visual_quality through the app/edge function
--   to validate signed URL availability.


-- ---------------------------------------------------------------------------
-- 4. Imports that have Phase 4 PageContext source refs and Phase 5 visual QA
-- ---------------------------------------------------------------------------
select
  id,
  source_filename,
  page_count,
  meta->'import_manifests'->'pdf_import_job'->>'per_page_docling_manifest_path' as per_page_manifest_path,
  meta->>'visual_quality_artifact_path' as visual_quality_artifact_path,
  meta->'visual_quality_summary' as visual_quality_summary,
  updated_at
from public.template_imports
where meta->'import_manifests'->'pdf_import_job'->>'per_page_docling_manifest_path' is not null
  and meta->>'visual_quality_artifact_path' is not null
order by updated_at desc
limit 20;

-- Expected:
--   per_page_manifest_path is not null
--   visual_quality_artifact_path is not null
--   visual_quality_summary is populated
