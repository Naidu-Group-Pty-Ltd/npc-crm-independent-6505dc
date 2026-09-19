-- Phase 7C Fresh Rendering Baseline
-- Purpose:
--   Capture the latest fresh PDF import baseline after:
--   Import PDF → Open Template Editor → Run Visual QA → Run Repair.
--
-- Usage:
--   Option A:
--     Leave target_import_id as null to inspect the latest completed import.
--
--   Option B:
--     Replace null::uuid with a specific import ID:
--       select '00000000-0000-0000-0000-000000000000'::uuid as target_import_id
--
-- Run in Supabase SQL Editor.

-- ---------------------------------------------------------------------------
-- 1. Phase 7C baseline summary
-- ---------------------------------------------------------------------------
with params as (
  select null::uuid as target_import_id
),
target_import as (
  select ti.*
  from public.template_imports ti
  cross join params p
  where ti.created_template_id is not null
    and (p.target_import_id is null or ti.id = p.target_import_id)
  order by ti.updated_at desc
  limit 1
),
template_row as (
  select
    ti.id as import_id,
    rt.id as template_id,
    rt.name as template_name,
    rt.version as template_version,
    jsonb_array_length(coalesce(rt.schema->'pages', '[]'::jsonb)) as template_page_count,
    rt.updated_at as template_updated_at
  from target_import ti
  left join public.report_templates rt
    on rt.id = ti.created_template_id
),
job_row as (
  select
    ti.id as import_id,
    pij.id as job_id,
    pij.engine,
    pij.engine_version,
    pij.mode,
    pij.status as job_status,
    pij.stage as job_stage,
    pij.page_count as job_page_count,
    pij.ssim_score,
    pij.duration_ms,
    pij.cloud_run_ms,
    pij.diagnostics_path,
    pij.result_payload
  from target_import ti
  left join public.pdf_import_jobs pij
    on pij.id::text = ti.meta->'import_manifests_summary'->>'job_id'
),
storage_checks as (
  select
    ti.id as import_id,
    ti.meta->>'visual_quality_artifact_path' as visual_quality_path,
    ti.meta->>'visual_repair_artifact_path' as visual_repair_path,

    count(*) filter (
      where o.bucket_id = 'template-import-artifacts'
        and o.name = ti.meta->>'visual_quality_artifact_path'
    ) as visual_quality_object_count,

    count(*) filter (
      where o.bucket_id = 'template-import-artifacts'
        and o.name = ti.meta->>'visual_repair_artifact_path'
    ) as visual_repair_object_count,

    count(*) filter (
      where o.bucket_id = 'template-import-artifacts'
        and o.name like ti.id::text || '/pages/page-%-source.png'
    ) as visual_source_raster_count,

    count(*) filter (
      where o.bucket_id = 'template-import-artifacts'
        and o.name like ti.id::text || '/pages/page-%-generated.png'
    ) as visual_generated_raster_count,

    count(*) filter (
      where o.bucket_id = 'template-import-artifacts'
        and o.name like ti.id::text || '/pages/page-%-diff.png'
    ) as visual_diff_raster_count

  from target_import ti
  left join storage.objects o
    on o.bucket_id = 'template-import-artifacts'
   and (
      o.name = ti.meta->>'visual_quality_artifact_path'
      or o.name = ti.meta->>'visual_repair_artifact_path'
      or o.name like ti.id::text || '/pages/page-%'
   )
  group by ti.id, ti.meta
),
latest_snapshot as (
  select distinct on (rtv.template_id)
    ti.id as import_id,
    rtv.template_id,
    rtv.version as snapshot_version,
    rtv.label as snapshot_label,
    rtv.note as snapshot_note,
    rtv.created_at as snapshot_created_at,
    jsonb_array_length(coalesce(rtv.schema->'pages', '[]'::jsonb)) as snapshot_page_count
  from target_import ti
  join public.report_template_versions rtv
    on rtv.template_id = ti.created_template_id
  order by rtv.template_id, rtv.created_at desc
)
select
  ti.id as import_id,
  ti.status as import_status,
  ti.source_filename,
  ti.page_count as import_page_count,
  ti.created_template_id as template_id,
  tr.template_name,
  tr.template_version,
  tr.template_page_count,

  case
    when tr.template_page_count = ti.page_count then 'page_count_match'
    else 'page_count_mismatch'
  end as page_count_status,

  ti.meta->>'artifact_contract_version' as artifact_contract_version,
  ti.meta->>'artifact_stage' as artifact_stage,
  ti.meta->>'finalization_status' as finalization_status,
  ti.meta->>'finalization_mode' as finalization_mode,
  ti.meta->>'finalization_error' as finalization_error,

  ti.meta->'import_manifests_summary'->>'job_id' as manifest_job_id,
  ti.meta->'import_manifests_summary'->>'engine_version' as manifest_engine_version,
  ti.meta->'import_manifests_summary'->>'page_context_manifest_available' as page_context_manifest_available,
  ti.meta->'import_manifests_summary'->>'page_context_source' as page_context_source,
  ti.meta->'import_manifests_summary'->>'per_page_docling_manifest_path' as per_page_docling_manifest_path,
  ti.meta->'import_manifests_summary'->>'per_page_docling_validation_ok' as per_page_docling_validation_ok,
  ti.meta->'import_manifests_summary'->>'page_raster_count' as page_raster_count,

  jr.engine as job_engine,
  jr.engine_version as job_engine_version,
  jr.mode as job_mode,
  jr.job_status,
  jr.job_stage,
  jr.ssim_score,
  jr.duration_ms,
  jr.cloud_run_ms,
  jr.diagnostics_path,

  ti.meta->>'visual_quality_artifact_path' as visual_quality_artifact_path,
  ti.meta->'visual_quality_summary'->>'overallScore' as visual_quality_score,
  ti.meta->'visual_quality_summary'->>'pageCount' as visual_quality_page_count,
  ti.meta->'visual_quality_summary'->>'manualReviewRequired' as visual_quality_manual_review_required,

  ti.meta->>'visual_repair_artifact_path' as visual_repair_artifact_path,
  ti.meta->'visual_repair_summary'->>'repairStatus' as repair_status,
  ti.meta->'visual_repair_summary'->>'visualQaScore' as repair_start_score,
  ti.meta->'visual_repair_summary'->>'finalScore' as repair_final_score,
  ti.meta->'visual_repair_summary'->>'scoreDelta' as repair_score_delta,
  ti.meta->'visual_repair_summary'->>'totalApplied' as total_applied,
  ti.meta->'visual_repair_summary'->>'passesAttempted' as passes_attempted,
  ti.meta->'visual_repair_summary'->>'patchesAccepted' as patches_accepted,
  ti.meta->'visual_repair_summary'->>'patchesRejected' as patches_rejected,
  ti.meta->'visual_repair_summary'->>'requiresFallback' as requires_fallback,
  ti.meta->'visual_repair_summary'->>'requiresManualReview' as requires_manual_review,

  sc.visual_quality_object_count,
  sc.visual_repair_object_count,
  sc.visual_source_raster_count,
  sc.visual_generated_raster_count,
  sc.visual_diff_raster_count,

  ls.snapshot_version,
  ls.snapshot_label,
  ls.snapshot_note,
  ls.snapshot_page_count,

  case
    when ti.id is null then 'fail_missing_import'
    when ti.status <> 'completed' then 'fail_import_not_completed'
    when ti.created_template_id is null then 'fail_missing_template'
    when tr.template_page_count is distinct from ti.page_count then 'fail_page_count_mismatch'
    when ti.meta->>'finalization_status' is distinct from 'completed' then 'warn_finalization_not_completed'
    when ti.meta->>'visual_quality_artifact_path' is null then 'warn_visual_qa_not_run'
    when ti.meta->>'visual_repair_artifact_path' is null then 'warn_repair_not_run'
    when sc.visual_repair_object_count = 0 then 'fail_repair_audit_object_missing'
    else 'pass'
  end as phase7c_status,

  ti.created_at as import_created_at,
  ti.updated_at as import_updated_at,
  tr.template_updated_at

from target_import ti
left join template_row tr
  on tr.import_id = ti.id
left join job_row jr
  on jr.import_id = ti.id
left join storage_checks sc
  on sc.import_id = ti.id
left join latest_snapshot ls
  on ls.import_id = ti.id;

-- ---------------------------------------------------------------------------
-- 2. Latest 20 imports page-count health
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
  jsonb_array_length(coalesce(rt.schema->'pages', '[]'::jsonb)) as current_template_page_count,
  rt.updated_at as template_updated_at,
  case
    when jsonb_array_length(coalesce(rt.schema->'pages', '[]'::jsonb)) = li.page_count then 'page_count_match'
    else 'historical_or_current_page_count_mismatch'
  end as page_count_status
from latest_imports li
join public.report_templates rt
  on rt.id = li.created_template_id
order by li.updated_at desc;

-- ---------------------------------------------------------------------------
-- 3. Latest Docling jobs / engine version health
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
  diagnostics_path,
  result_payload->>'per_page_docling_manifest_path' as per_page_docling_manifest_path,
  result_payload->>'per_page_docling_artifact_version' as per_page_docling_artifact_version,
  result_payload->>'per_page_docling_parent_manifest_version' as per_page_docling_parent_manifest_version,
  result_payload->>'per_page_docling_global_artifact_copy_version' as per_page_docling_global_artifact_copy_version,
  created_at,
  updated_at
from public.pdf_import_jobs
order by created_at desc
limit 20;
