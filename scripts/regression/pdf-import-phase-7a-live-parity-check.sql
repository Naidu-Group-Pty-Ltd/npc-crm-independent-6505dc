-- Phase 7A Live Parity Check
-- Purpose:
--   Confirm live Supabase DB state after post-Phase-7 rendering/engine changes.
--
-- Run this in Supabase SQL Editor.

-- ---------------------------------------------------------------------------
-- 1. Latest PDF import jobs and live engine versions
-- ---------------------------------------------------------------------------
select
  id,
  engine,
  engine_version,
  mode,
  status,
  stage,
  source_file_name,
  page_count,
  ssim_score,
  duration_ms,
  cloud_run_ms,
  diagnostics_path,
  result_payload->>'diagnostics_path' as result_diagnostics_path,
  result_payload->>'rasters_manifest_path' as rasters_manifest_path,
  result_payload->>'per_page_docling_manifest_path' as per_page_docling_manifest_path,
  result_payload->>'per_page_docling_artifact_version' as per_page_docling_artifact_version,
  result_payload->>'per_page_docling_parent_manifest_version' as per_page_docling_parent_manifest_version,
  result_payload->>'per_page_docling_global_artifact_copy_version' as per_page_docling_global_artifact_copy_version,
  result_payload->'summary'->>'text_chars' as text_chars,
  result_payload->'summary'->>'ocr_chars' as ocr_chars,
  result_payload->'summary'->>'table_count' as table_count,
  created_at,
  updated_at
from public.pdf_import_jobs
order by created_at desc
limit 20;

-- ---------------------------------------------------------------------------
-- 2. Latest template imports and finalization metadata
-- ---------------------------------------------------------------------------
select
  id,
  status,
  source_filename,
  page_count,
  created_template_id,
  error,
  meta->>'artifact_contract_version' as artifact_contract_version,
  meta->>'artifact_stage' as artifact_stage,
  meta->>'finalization_status' as finalization_status,
  meta->>'finalization_mode' as finalization_mode,
  meta->>'finalization_queued_at' as finalization_queued_at,
  meta->>'finalization_started_at' as finalization_started_at,
  meta->>'finalization_completed_at' as finalization_completed_at,
  meta->>'finalization_error' as finalization_error,
  meta->>'recoverable' as recoverable,
  meta->'import_manifests_summary'->>'engine_version' as import_manifest_engine_version,
  meta->'import_manifests_summary'->>'page_context_manifest_available' as page_context_manifest_available,
  meta->'import_manifests_summary'->>'page_context_source' as page_context_source,
  meta->'import_manifests_summary'->>'per_page_docling_manifest_path' as per_page_docling_manifest_path,
  meta->'import_manifests_summary'->>'per_page_docling_validation_ok' as per_page_docling_validation_ok,
  meta->'import_manifests_summary'->>'page_raster_count' as page_raster_count,
  meta->>'visual_quality_artifact_path' as visual_quality_artifact_path,
  meta->>'visual_repair_artifact_path' as visual_repair_artifact_path,
  created_at,
  updated_at
from public.template_imports
order by updated_at desc
limit 30;

-- ---------------------------------------------------------------------------
-- 3. Confirm required RPCs exist
-- ---------------------------------------------------------------------------
select
  n.nspname as schema,
  p.proname as function_name,
  pg_get_function_arguments(p.oid) as arguments,
  pg_get_function_result(p.oid) as result_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'template_finalize_v2',
    'template_resync_v2',
    'template_finalize',
    'template_resync'
  )
order by p.proname;

-- ---------------------------------------------------------------------------
-- 4. Latest completed templates created by PDF imports
-- ---------------------------------------------------------------------------
with latest_imports as (
  select
    id,
    created_template_id,
    page_count,
    source_filename,
    updated_at
  from public.template_imports
  where created_template_id is not null
  order by updated_at desc
  limit 20
)
select
  li.id as import_id,
  li.source_filename,
  li.page_count as import_page_count,
  rt.id as template_id,
  rt.name,
  rt.version,
  jsonb_array_length(coalesce(rt.schema->'pages', '[]'::jsonb)) as template_page_count,
  rt.updated_at as template_updated_at,
  case
    when jsonb_array_length(coalesce(rt.schema->'pages', '[]'::jsonb)) = li.page_count then 'page_count_match'
    else 'page_count_mismatch'
  end as page_count_status
from latest_imports li
join public.report_templates rt
  on rt.id = li.created_template_id
order by li.updated_at desc;

-- ---------------------------------------------------------------------------
-- 5. Visual QA / repair metadata presence
-- ---------------------------------------------------------------------------
select
  id,
  source_filename,
  created_template_id,
  meta->>'visual_quality_artifact_path' as visual_quality_artifact_path,
  meta->'visual_quality_summary'->>'overallScore' as visual_quality_score,
  meta->'visual_quality_summary'->>'manualReviewRequired' as manual_review_required,
  meta->>'visual_repair_artifact_path' as visual_repair_artifact_path,
  meta->'visual_repair_summary'->>'repairStatus' as repair_status,
  meta->'visual_repair_summary'->>'finalScore' as repair_final_score,
  meta->'visual_repair_summary'->>'scoreDelta' as repair_score_delta,
  meta->'visual_repair_summary'->>'totalApplied' as total_applied,
  updated_at
from public.template_imports
where meta->>'visual_quality_artifact_path' is not null
   or meta->>'visual_repair_artifact_path' is not null
order by updated_at desc
limit 30;

-- ---------------------------------------------------------------------------
-- 6. Repair audit object presence
-- ---------------------------------------------------------------------------
with repair_imports as (
  select
    id,
    meta->>'visual_repair_artifact_path' as audit_path,
    updated_at
  from public.template_imports
  where meta->>'visual_repair_artifact_path' is not null
  order by updated_at desc
  limit 30
)
select
  ri.id as import_id,
  ri.audit_path,
  case when o.name is not null then true else false end as repair_audit_object_exists,
  o.bucket_id,
  o.name,
  o.created_at as object_created_at,
  o.updated_at as object_updated_at
from repair_imports ri
left join storage.objects o
  on o.bucket_id = 'template-import-artifacts'
 and o.name = ri.audit_path
order by ri.updated_at desc;
