-- Phase 7D Editor Fidelity Check
-- Purpose:
--   Inspect latest live PDF import/template/rendering metadata before deciding
--   the next fidelity-improvement patch.
--
-- Usage:
--   Replace target_import_id with a specific import ID if needed.
--   Leave null to inspect the latest completed import with a template.
--
-- Run in Supabase SQL Editor.

-- ---------------------------------------------------------------------------
-- 1. Target import + template + diagnostics summary
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
    rt.name,
    rt.version,
    jsonb_array_length(coalesce(rt.schema->'pages', '[]'::jsonb)) as template_page_count,
    rt.updated_at as template_updated_at,
    rt.schema
  from target_import ti
  join public.report_templates rt
    on rt.id = ti.created_template_id
),
page_stats as (
  select
    tr.import_id,
    count(*) as page_count,
    min((page->'size'->>'width')::numeric) as min_page_width,
    max((page->'size'->>'width')::numeric) as max_page_width,
    min((page->'size'->>'height')::numeric) as min_page_height,
    max((page->'size'->>'height')::numeric) as max_page_height,
    sum(jsonb_array_length(coalesce(page->'blocks', '[]'::jsonb))) as total_blocks,
    min(jsonb_array_length(coalesce(page->'blocks', '[]'::jsonb))) as min_blocks_per_page,
    max(jsonb_array_length(coalesce(page->'blocks', '[]'::jsonb))) as max_blocks_per_page
  from template_row tr
  cross join lateral jsonb_array_elements(coalesce(tr.schema->'pages', '[]'::jsonb)) as page
  group by tr.import_id
),
job_row as (
  select
    ti.id as import_id,
    pij.id as job_id,
    pij.engine,
    pij.engine_version,
    pij.mode,
    pij.status as job_status,
    pij.stage,
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
storage_counts as (
  select
    ti.id as import_id,
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
    ) as source_raster_count,
    count(*) filter (
      where o.bucket_id = 'template-import-artifacts'
        and o.name like ti.id::text || '/pages/page-%-generated.png'
    ) as generated_raster_count,
    count(*) filter (
      where o.bucket_id = 'template-import-artifacts'
        and o.name like ti.id::text || '/pages/page-%-diff.png'
    ) as diff_raster_count
  from target_import ti
  left join storage.objects o
    on o.bucket_id = 'template-import-artifacts'
   and (
      o.name = ti.meta->>'visual_quality_artifact_path'
      or o.name = ti.meta->>'visual_repair_artifact_path'
      or o.name like ti.id::text || '/pages/page-%'
   )
  group by ti.id, ti.meta
)
select
  ti.id as import_id,
  ti.status as import_status,
  ti.source_filename,
  ti.page_count as import_page_count,
  ti.created_template_id as template_id,

  tr.name as template_name,
  tr.version as template_version,
  tr.template_page_count,
  ps.total_blocks,
  ps.min_blocks_per_page,
  ps.max_blocks_per_page,
  ps.min_page_width,
  ps.max_page_width,
  ps.min_page_height,
  ps.max_page_height,

  case
    when tr.template_page_count = ti.page_count then 'page_count_match'
    else 'page_count_mismatch'
  end as page_count_status,

  ti.meta->>'finalization_status' as finalization_status,
  ti.meta->>'finalization_mode' as finalization_mode,
  ti.meta->>'finalization_error' as finalization_error,

  ti.meta->'import_manifests_summary'->>'engine_version' as manifest_engine_version,
  ti.meta->'import_manifests_summary'->>'job_id' as manifest_job_id,
  ti.meta->'import_manifests_summary'->>'page_context_manifest_available' as page_context_manifest_available,
  ti.meta->'import_manifests_summary'->>'per_page_docling_manifest_path' as per_page_docling_manifest_path,
  ti.meta->'import_manifests_summary'->>'per_page_docling_validation_ok' as per_page_docling_validation_ok,
  ti.meta->'import_manifests_summary'->>'page_raster_count' as page_raster_count,

  jr.engine as job_engine,
  jr.engine_version as job_engine_version,
  jr.mode as job_mode,
  jr.job_status,
  jr.ssim_score,
  jr.duration_ms,
  jr.diagnostics_path,

  ti.meta->>'visual_quality_artifact_path' as visual_quality_artifact_path,
  ti.meta->'visual_quality_summary'->>'overallScore' as visual_quality_score,
  ti.meta->'visual_quality_summary'->>'manualReviewRequired' as visual_quality_manual_review_required,

  ti.meta->>'visual_repair_artifact_path' as visual_repair_artifact_path,
  ti.meta->'visual_repair_summary'->>'repairStatus' as repair_status,
  ti.meta->'visual_repair_summary'->>'finalScore' as repair_final_score,
  ti.meta->'visual_repair_summary'->>'scoreDelta' as repair_score_delta,
  ti.meta->'visual_repair_summary'->>'totalApplied' as total_applied,

  sc.visual_quality_object_count,
  sc.visual_repair_object_count,
  sc.source_raster_count,
  sc.generated_raster_count,
  sc.diff_raster_count,

  case
    when ti.status <> 'completed' then 'fail_import_not_completed'
    when tr.template_page_count is distinct from ti.page_count then 'fail_page_count_mismatch'
    when ti.meta->>'finalization_status' is distinct from 'completed' then 'warn_finalization_not_completed'
    when ti.meta->'import_manifests_summary'->>'page_context_manifest_available' is distinct from 'true' then 'warn_page_context_manifest_missing'
    when ti.meta->>'visual_quality_artifact_path' is null then 'warn_visual_qa_not_run'
    when ti.meta->>'visual_repair_artifact_path' is null then 'warn_repair_not_run'
    when sc.visual_repair_object_count = 0 then 'warn_repair_audit_object_missing'
    else 'pass'
  end as phase7d_metadata_status,

  ti.updated_at as import_updated_at,
  tr.template_updated_at

from target_import ti
left join template_row tr on tr.import_id = ti.id
left join page_stats ps on ps.import_id = ti.id
left join job_row jr on jr.import_id = ti.id
left join storage_counts sc on sc.import_id = ti.id;

-- ---------------------------------------------------------------------------
-- 2. Page-level template structure for target import
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
  select ti.id as import_id, rt.schema
  from target_import ti
  join public.report_templates rt on rt.id = ti.created_template_id
)
select
  tr.import_id,
  ordinality as page_number,
  page->>'id' as page_id,
  (page->'size'->>'width')::numeric as page_width,
  (page->'size'->>'height')::numeric as page_height,
  jsonb_array_length(coalesce(page->'blocks', '[]'::jsonb)) as block_count,
  count(*) filter (where block->>'type' = 'text') as text_blocks,
  count(*) filter (where block->>'type' = 'image') as image_blocks,
  count(*) filter (where block->>'type' in ('shape', 'rect', 'line')) as shape_like_blocks,
  count(*) filter (where block->>'type' = 'table') as table_blocks
from template_row tr
cross join lateral jsonb_array_elements(coalesce(tr.schema->'pages', '[]'::jsonb)) with ordinality as pages(page, ordinality)
left join lateral jsonb_array_elements(coalesce(page->'blocks', '[]'::jsonb)) as block on true
group by tr.import_id, ordinality, page
order by ordinality;

-- ---------------------------------------------------------------------------
-- 3. Latest imports that should be considered for 7D fidelity review
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.status,
  ti.page_count,
  ti.created_template_id,
  ti.meta->>'finalization_status' as finalization_status,
  ti.meta->'import_manifests_summary'->>'engine_version' as engine_version,
  ti.meta->'import_manifests_summary'->>'page_context_manifest_available' as page_context_manifest_available,
  ti.meta->>'visual_quality_artifact_path' as visual_quality_artifact_path,
  ti.meta->'visual_quality_summary'->>'overallScore' as visual_quality_score,
  ti.meta->>'visual_repair_artifact_path' as visual_repair_artifact_path,
  ti.meta->'visual_repair_summary'->>'repairStatus' as repair_status,
  ti.meta->'visual_repair_summary'->>'finalScore' as repair_final_score,
  ti.updated_at
from public.template_imports ti
where ti.created_template_id is not null
order by ti.updated_at desc
limit 30;
