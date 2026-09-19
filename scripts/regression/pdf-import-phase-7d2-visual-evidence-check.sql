-- Phase 7D.2 Visual QA / Repair Evidence Check
-- Purpose:
--   Validate that recovered page contexts allow live Review Quality,
--   Visual QA, and Repair evidence persistence.
--
-- Run in Supabase SQL Editor after live UI:
--   Template Builder → open import review → Run Visual QA → Run repair.
--
-- Replace target_import_id if testing another import.

with params as (
  select 'b18b392a-f298-4896-b87c-f6cfe1db30b6'::uuid as target_import_id
),
target_import as (
  select ti.*
  from public.template_imports ti
  join params p on ti.id = p.target_import_id
),
job_join as (
  select
    ti.id as import_id,
    ti.source_filename,
    ti.page_count,
    ti.created_template_id,
    ti.status,
    ti.meta,
    ti.updated_at,

    ti.meta->'import_manifests_summary'->>'job_id' as manifest_job_id,
    ti.meta->'import_manifests_summary'->>'engine_version' as manifest_engine_version,
    ti.meta->'import_manifests_summary'->>'page_context_manifest_available' as meta_page_context_manifest_available,
    ti.meta->'import_manifests_summary'->>'per_page_docling_manifest_path' as meta_page_manifest_path,

    pij.id as pdf_job_id,
    pij.engine,
    pij.engine_version as job_engine_version,
    pij.status as job_status,
    pij.stage,
    pij.result_payload->>'per_page_docling_manifest_path' as job_page_manifest_path,
    pij.result_payload->>'rasters_manifest_path' as job_rasters_manifest_path,
    pij.result_payload->>'per_page_docling_artifact_version' as per_page_docling_artifact_version
  from target_import ti
  left join public.pdf_import_jobs pij
    on pij.id::text = ti.meta->'import_manifests_summary'->>'job_id'
),
resolved as (
  select
    jj.*,
    coalesce(
      nullif(jj.meta_page_manifest_path, ''),
      nullif(jj.job_page_manifest_path, ''),
      case
        when jj.manifest_job_id is not null then jj.manifest_job_id || '/pages-manifest.json'
        else null
      end
    ) as resolved_manifest_path
  from job_join jj
),
storage_checks as (
  select
    r.import_id,
    count(*) filter (
      where o.bucket_id = 'pdf-import-diagnostics'
        and o.name = r.resolved_manifest_path
    ) as page_manifest_object_count,

    count(*) filter (
      where o.bucket_id = 'template-import-artifacts'
        and o.name = r.meta->>'visual_quality_artifact_path'
    ) as visual_quality_object_count,

    count(*) filter (
      where o.bucket_id = 'template-import-artifacts'
        and o.name = r.meta->>'visual_repair_artifact_path'
    ) as visual_repair_object_count,

    count(*) filter (
      where o.bucket_id = 'template-import-artifacts'
        and o.name like r.import_id::text || '/pages/page-%-source.png'
    ) as source_raster_count,

    count(*) filter (
      where o.bucket_id = 'template-import-artifacts'
        and o.name like r.import_id::text || '/pages/page-%-generated.png'
    ) as generated_raster_count,

    count(*) filter (
      where o.bucket_id = 'template-import-artifacts'
        and o.name like r.import_id::text || '/pages/page-%-diff.png'
    ) as diff_raster_count

  from resolved r
  left join storage.objects o
    on (
      (o.bucket_id = 'pdf-import-diagnostics' and o.name = r.resolved_manifest_path)
      or
      (o.bucket_id = 'template-import-artifacts' and (
        o.name = r.meta->>'visual_quality_artifact_path'
        or o.name = r.meta->>'visual_repair_artifact_path'
        or o.name like r.import_id::text || '/pages/page-%'
      ))
    )
  group by r.import_id
)
select
  r.import_id,
  r.source_filename,
  r.page_count,
  r.created_template_id,
  r.status,

  r.manifest_job_id,
  r.manifest_engine_version,
  r.job_engine_version,
  r.meta_page_context_manifest_available,
  r.resolved_manifest_path,
  sc.page_manifest_object_count,
  case when sc.page_manifest_object_count > 0 then true else false end as page_manifest_object_exists,

  r.meta->>'visual_quality_artifact_path' as visual_quality_artifact_path,
  r.meta->'visual_quality_summary'->>'overallScore' as visual_quality_score,
  r.meta->'visual_quality_summary'->>'pageCount' as visual_quality_page_count,
  r.meta->'visual_quality_summary'->>'manualReviewRequired' as visual_quality_manual_review_required,
  sc.visual_quality_object_count,

  r.meta->>'visual_repair_artifact_path' as visual_repair_artifact_path,
  r.meta->'visual_repair_summary'->>'repairStatus' as repair_status,
  r.meta->'visual_repair_summary'->>'visualQaScore' as repair_start_score,
  r.meta->'visual_repair_summary'->>'finalScore' as repair_final_score,
  r.meta->'visual_repair_summary'->>'scoreDelta' as repair_score_delta,
  r.meta->'visual_repair_summary'->>'totalApplied' as total_applied,
  r.meta->'visual_repair_summary'->>'passesAttempted' as passes_attempted,
  r.meta->'visual_repair_summary'->>'patchesAccepted' as patches_accepted,
  r.meta->'visual_repair_summary'->>'patchesRejected' as patches_rejected,
  r.meta->'visual_repair_summary'->>'requiresFallback' as requires_fallback,
  r.meta->'visual_repair_summary'->>'requiresManualReview' as requires_manual_review,
  sc.visual_repair_object_count,

  sc.source_raster_count,
  sc.generated_raster_count,
  sc.diff_raster_count,

  case
    when sc.page_manifest_object_count = 0 then 'fail_page_manifest_missing'
    when r.meta->>'visual_quality_artifact_path' is null then 'pending_visual_qa'
    when sc.visual_quality_object_count = 0 then 'fail_visual_quality_object_missing'
    when r.meta->>'visual_repair_artifact_path' is null then 'pending_repair'
    when sc.visual_repair_object_count = 0 then 'fail_visual_repair_object_missing'
    else 'pass'
  end as phase7d2_status,

  r.updated_at
from resolved r
left join storage_checks sc on sc.import_id = r.import_id;
