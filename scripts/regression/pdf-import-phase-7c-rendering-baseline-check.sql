-- Phase 7C Rendering Baseline Check
-- Read-only. Run in Supabase SQL Editor after:
-- Import PDF → Review Quality → Run Visual QA → Run Repair → Apply Repair.
--
-- Columns were validated against the live schema of template_imports,
-- report_templates, report_template_versions, and pdf_import_jobs.

-- 1. Latest completed imports with Visual QA + Repair
select
  ti.id as import_id,
  ti.status,
  ti.source_filename,
  ti.page_count,
  ti.created_template_id as template_id,
  ti.meta->>'visual_quality_artifact_path' as visual_quality_artifact_path,
  ti.meta->>'visual_repair_artifact_path' as visual_repair_artifact_path,
  ti.meta->'visual_quality_summary'->>'overallScore' as visual_quality_score,
  ti.meta->'visual_quality_summary'->>'manualReviewRequired' as visual_quality_manual_review_required,
  ti.meta->'visual_repair_summary'->>'repairStatus' as repair_status,
  ti.meta->'visual_repair_summary'->>'finalScore' as repair_final_score,
  ti.meta->'visual_repair_summary'->>'scoreDelta' as repair_score_delta,
  ti.meta->'visual_repair_summary'->>'totalApplied' as total_applied,
  ti.meta->'visual_repair_summary'->>'patchesAccepted' as patches_accepted,
  ti.meta->'visual_repair_summary'->>'patchesRejected' as patches_rejected,
  ti.meta->'visual_repair_summary'->>'requiresFallback' as requires_fallback,
  ti.meta->'visual_repair_summary'->>'requiresManualReview' as requires_manual_review,
  ti.meta->'import_manifests_summary'->>'engine_version' as engine_version,
  ti.meta->'import_manifests_summary'->>'job_id' as pdf_job_id,
  ti.meta->'import_manifests_summary'->>'diagnostics_path' as diagnostics_path,
  ti.updated_at
from public.template_imports ti
where ti.status = 'completed'
order by ti.updated_at desc
limit 30;

-- 2. Repair audit object presence
with repair_imports as (
  select
    ti.id,
    ti.meta->>'visual_repair_artifact_path' as audit_path,
    ti.updated_at
  from public.template_imports ti
  where ti.meta->>'visual_repair_artifact_path' is not null
  order by ti.updated_at desc
  limit 50
)
select
  ri.id as import_id,
  ri.audit_path,
  count(*) filter (where o.name = ri.audit_path) as audit_object_count,
  max(o.created_at) filter (where o.name = ri.audit_path) as audit_object_created_at,
  max(o.updated_at) filter (where o.name = ri.audit_path) as audit_object_updated_at,
  ri.updated_at as import_updated_at
from repair_imports ri
left join storage.objects o
  on o.bucket_id = 'template-import-artifacts'
 and o.name = ri.audit_path
group by ri.id, ri.audit_path, ri.updated_at
order by ri.updated_at desc;

-- 3. Template page count match
with latest as (
  select
    ti.id,
    ti.page_count,
    ti.created_template_id,
    ti.updated_at
  from public.template_imports ti
  where ti.status = 'completed'
    and ti.created_template_id is not null
  order by ti.updated_at desc
  limit 30
)
select
  l.id as import_id,
  l.page_count as import_page_count,
  rt.id as template_id,
  rt.version as template_version,
  jsonb_array_length(coalesce(rt.schema->'pages', '[]'::jsonb)) as template_page_count,
  case
    when jsonb_array_length(coalesce(rt.schema->'pages', '[]'::jsonb)) = l.page_count then 'pass'
    else 'template_page_count_mismatch'
  end as page_count_status,
  rt.updated_at as template_updated_at
from latest l
join public.report_templates rt
  on rt.id = l.created_template_id
order by l.updated_at desc;

-- 4. Latest template snapshots
with latest as (
  select created_template_id
  from public.template_imports
  where status = 'completed'
    and created_template_id is not null
  order by updated_at desc
  limit 20
)
select
  rtv.template_id,
  rtv.version,
  rtv.label,
  rtv.note,
  rtv.created_at,
  jsonb_array_length(coalesce(rtv.schema->'pages', '[]'::jsonb)) as snapshot_page_count
from latest l
join public.report_template_versions rtv
  on rtv.template_id = l.created_template_id
order by rtv.created_at desc
limit 50;

-- 5. Latest diagnostics jobs
select
  id as job_id,
  user_id,
  template_id,
  source_file_name,
  engine,
  engine_version,
  mode,
  status,
  stage,
  duration_ms,
  cloud_run_ms,
  page_count,
  ssim_score,
  diagnostics_path,
  error_code,
  error_text,
  created_at,
  updated_at
from public.pdf_import_jobs
order by updated_at desc
limit 30;

-- 6. Summary counts
select
  count(*) filter (where status = 'completed') as completed_imports,
  count(*) filter (where meta->>'visual_quality_artifact_path' is not null) as imports_with_visual_quality,
  count(*) filter (where meta->>'visual_repair_artifact_path' is not null) as imports_with_visual_repair,
  count(*) filter (where meta->'visual_quality_summary'->>'manualReviewRequired' = 'true') as visual_qa_manual_review,
  count(*) filter (where meta->'visual_repair_summary'->>'requiresFallback' = 'true') as repair_requires_fallback,
  count(*) filter (where meta->'visual_repair_summary'->>'requiresManualReview' = 'true') as repair_requires_manual_review
from public.template_imports;
