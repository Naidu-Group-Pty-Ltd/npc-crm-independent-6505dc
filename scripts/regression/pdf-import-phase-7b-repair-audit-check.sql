-- Phase 7B Repair Audit Check
-- Run in Supabase SQL Editor after running Visual QA + Run Repair from the frontend.

select
  id,
  source_filename,
  page_count,
  created_template_id,
  meta->>'visual_quality_artifact_path' as visual_quality_artifact_path,
  meta->'visual_quality_summary'->>'overallScore' as visual_quality_score,
  meta->>'visual_repair_artifact_path' as visual_repair_artifact_path,
  meta->'visual_repair_summary'->>'repairStatus' as repair_status,
  meta->'visual_repair_summary'->>'visualQaScore' as repair_start_score,
  meta->'visual_repair_summary'->>'finalScore' as repair_final_score,
  meta->'visual_repair_summary'->>'scoreDelta' as repair_score_delta,
  meta->'visual_repair_summary'->>'totalApplied' as total_applied,
  meta->'visual_repair_summary'->>'passesAttempted' as passes_attempted,
  meta->'visual_repair_summary'->>'patchesAccepted' as patches_accepted,
  meta->'visual_repair_summary'->>'patchesRejected' as patches_rejected,
  meta->'visual_repair_summary'->>'requiresFallback' as requires_fallback,
  meta->'visual_repair_summary'->>'requiresManualReview' as requires_manual_review,
  meta->'visual_repair_summary'->>'persistedAt' as repair_persisted_at,
  updated_at
from public.template_imports
where meta->>'visual_repair_artifact_path' is not null
order by updated_at desc
limit 20;

with repair_imports as (
  select
    id,
    meta->>'visual_repair_artifact_path' as audit_path,
    updated_at
  from public.template_imports
  where meta->>'visual_repair_artifact_path' is not null
  order by updated_at desc
  limit 20
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
