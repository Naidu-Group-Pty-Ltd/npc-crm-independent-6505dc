-- Phase 7B Repair Audit Contract Check
-- Run in Supabase SQL Editor after:
-- Import PDF → Review quality → Run Visual QA → Run repair.
--
-- Validates that the template-import-pdf edge function persisted the repair
-- audit artifact and its template_imports.meta pointers/summary.

-- 1. Latest repair audit metadata
select
  id as import_id,
  status,
  source_filename,
  page_count,
  created_template_id as template_id,
  meta->>'visual_quality_artifact_path' as visual_quality_artifact_path,
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

-- 2. Repair audit storage object presence
with repair_imports as (
  select
    id,
    meta->>'visual_repair_artifact_path' as audit_path,
    updated_at
  from public.template_imports
  where meta->>'visual_repair_artifact_path' is not null
  order by updated_at desc
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

-- 3. Visual QA exists but repair audit missing
select
  id as import_id,
  status,
  source_filename,
  page_count,
  created_template_id as template_id,
  meta->>'visual_quality_artifact_path' as visual_quality_artifact_path,
  meta->'visual_quality_summary'->>'overallScore' as visual_quality_score,
  meta->'visual_quality_summary'->>'manualReviewRequired' as manual_review_required,
  updated_at
from public.template_imports
where meta->>'visual_quality_artifact_path' is not null
  and meta->>'visual_repair_artifact_path' is null
order by updated_at desc
limit 50;

-- 4. Summary counts
select
  count(*) filter (where meta->>'visual_quality_artifact_path' is not null) as imports_with_visual_quality,
  count(*) filter (where meta->>'visual_repair_artifact_path' is not null) as imports_with_visual_repair,
  count(*) filter (where meta->'visual_repair_summary'->>'repairStatus' = 'completed') as repair_completed,
  count(*) filter (where meta->'visual_repair_summary'->>'repairStatus' = 'skipped') as repair_skipped,
  count(*) filter (where meta->'visual_repair_summary'->>'repairStatus' = 'failed') as repair_failed,
  count(*) filter (where nullif(meta->'visual_repair_summary'->>'totalApplied', '')::int > 0) as repair_applied_patches
from public.template_imports;
