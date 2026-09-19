-- Phase 6 Regression Check
-- Purpose:
--   Validate visual repair orchestration, audit persistence, and repaired-template application metadata.
--
-- Run this file in Supabase SQL Editor.
--
-- Phase 6 expected storage/meta outputs:
--   template_imports.meta.visual_repair_artifact_path
--   template_imports.meta.visual_repair_summary
--   template-import-artifacts/{importId}/repair/repair-loop.json

-- ---------------------------------------------------------------------------
-- 1. Latest imports with persisted visual repair audit summary
-- ---------------------------------------------------------------------------
select
  id,
  status,
  source_filename,
  page_count,
  created_template_id,
  meta->>'visual_quality_artifact_path' as visual_quality_artifact_path,
  meta->>'visual_repair_artifact_path' as visual_repair_artifact_path,

  meta->'visual_quality_summary'->>'overallScore' as visual_quality_score,
  meta->'visual_quality_summary'->>'manualReviewRequired' as visual_quality_manual_review_required,
  meta->'visual_quality_summary'->>'repairPassesApplied' as visual_quality_repair_passes,

  meta->'visual_repair_summary'->>'repairStatus' as repair_status,
  meta->'visual_repair_summary'->>'visualQaScore' as repair_visual_qa_score,
  meta->'visual_repair_summary'->>'finalScore' as repair_final_score,
  meta->'visual_repair_summary'->>'scoreDelta' as repair_score_delta,
  meta->'visual_repair_summary'->>'canRunRepairLoop' as can_run_repair_loop,
  meta->'visual_repair_summary'->>'eligiblePageCount' as eligible_page_count,
  meta->'visual_repair_summary'->>'totalApplied' as total_applied,
  meta->'visual_repair_summary'->>'passesAttempted' as passes_attempted,
  meta->'visual_repair_summary'->>'patchesAccepted' as patches_accepted,
  meta->'visual_repair_summary'->>'patchesRejected' as patches_rejected,
  meta->'visual_repair_summary'->>'requiresFallback' as requires_fallback,
  meta->'visual_repair_summary'->>'requiresManualReview' as requires_manual_review,
  meta->'visual_repair_summary'->>'generatedAt' as repair_generated_at,
  meta->'visual_repair_summary'->>'persistedAt' as repair_persisted_at,
  updated_at
from public.template_imports
where meta->>'visual_repair_artifact_path' is not null
order by updated_at desc
limit 30;

-- Expected:
--   visual_repair_artifact_path = {importId}/repair/repair-loop.json
--   repair_status in completed/skipped/failed
--   repair_final_score is populated
--   total_applied, passes_attempted, patches_accepted, patches_rejected are populated


-- ---------------------------------------------------------------------------
-- 2. Repair audit storage object presence
-- ---------------------------------------------------------------------------
with repair_imports as (
  select
    id,
    meta->>'visual_repair_artifact_path' as audit_path,
    meta->'visual_repair_summary' as repair_summary,
    updated_at
  from public.template_imports
  where meta->>'visual_repair_artifact_path' is not null
  order by updated_at desc
  limit 50
)
select
  ri.id,
  ri.audit_path,
  count(*) filter (where o.name = ri.audit_path) as audit_object_count,
  max(o.created_at) filter (where o.name = ri.audit_path) as audit_object_created_at,
  max(o.updated_at) filter (where o.name = ri.audit_path) as audit_object_updated_at,
  ri.repair_summary->>'repairStatus' as repair_status,
  ri.repair_summary->>'finalScore' as final_score,
  ri.repair_summary->>'totalApplied' as total_applied,
  ri.updated_at as import_updated_at
from repair_imports ri
left join storage.objects o
  on o.bucket_id = 'template-import-artifacts'
 and o.name = ri.audit_path
group by ri.id, ri.audit_path, ri.repair_summary, ri.updated_at
order by ri.updated_at desc;

-- Expected:
--   audit_object_count = 1 for each repair import
--   audit_path should end with /repair/repair-loop.json


-- ---------------------------------------------------------------------------
-- 3. Visual QA to visual repair score comparison
-- ---------------------------------------------------------------------------
select
  id,
  source_filename,
  created_template_id,

  nullif(meta->'visual_quality_summary'->>'overallScore', '')::numeric as visual_quality_score,
  nullif(meta->'visual_repair_summary'->>'visualQaScore', '')::numeric as repair_start_score,
  nullif(meta->'visual_repair_summary'->>'finalScore', '')::numeric as repair_final_score,
  nullif(meta->'visual_repair_summary'->>'scoreDelta', '')::numeric as repair_score_delta,

  nullif(meta->'visual_repair_summary'->>'totalApplied', '')::int as total_applied,
  nullif(meta->'visual_repair_summary'->>'passesAttempted', '')::int as passes_attempted,
  nullif(meta->'visual_repair_summary'->>'patchesAccepted', '')::int as patches_accepted,
  nullif(meta->'visual_repair_summary'->>'patchesRejected', '')::int as patches_rejected,

  meta->'visual_repair_summary'->>'repairStatus' as repair_status,
  meta->'visual_repair_summary'->>'requiresFallback' as requires_fallback,
  meta->'visual_repair_summary'->>'requiresManualReview' as requires_manual_review,
  updated_at
from public.template_imports
where meta->>'visual_repair_artifact_path' is not null
order by updated_at desc
limit 50;

-- Expected:
--   repair_start_score should generally match the Visual QA score used before repair.
--   repair_final_score should be populated.
--   repair_score_delta should be populated.
--   total_applied may be 0 for skipped/no-op repair audits.


-- ---------------------------------------------------------------------------
-- 4. Repair records requiring attention
-- ---------------------------------------------------------------------------
select
  id,
  source_filename,
  created_template_id,
  meta->'visual_repair_summary'->>'repairStatus' as repair_status,
  meta->'visual_repair_summary'->>'finalScore' as final_score,
  meta->'visual_repair_summary'->>'requiresFallback' as requires_fallback,
  meta->'visual_repair_summary'->>'requiresManualReview' as requires_manual_review,
  meta->'visual_repair_summary'->>'problemCount' as problem_count,
  meta->'visual_repair_summary'->>'totalApplied' as total_applied,
  meta->>'visual_repair_artifact_path' as visual_repair_artifact_path,
  updated_at
from public.template_imports
where meta->>'visual_repair_artifact_path' is not null
  and (
    meta->'visual_repair_summary'->>'repairStatus' in ('failed', 'skipped')
    or meta->'visual_repair_summary'->>'requiresFallback' = 'true'
    or meta->'visual_repair_summary'->>'requiresManualReview' = 'true'
    or nullif(meta->'visual_repair_summary'->>'finalScore', '')::numeric < 0.80
  )
order by updated_at desc
limit 50;

-- Expected:
--   This query may return rows.
--   Returned rows are not necessarily failures; they are imports that need manual review,
--   fallback inspection, or further repair-loop hardening.


-- ---------------------------------------------------------------------------
-- 5. Imports with Visual QA but no repair audit yet
-- ---------------------------------------------------------------------------
select
  id,
  status,
  source_filename,
  page_count,
  created_template_id,
  meta->>'visual_quality_artifact_path' as visual_quality_artifact_path,
  meta->'visual_quality_summary'->>'overallScore' as visual_quality_score,
  meta->'visual_quality_summary'->>'manualReviewRequired' as manual_review_required,
  meta->'visual_quality_summary'->>'repairPassesApplied' as repair_passes_applied,
  updated_at
from public.template_imports
where meta->>'visual_quality_artifact_path' is not null
  and meta->>'visual_repair_artifact_path' is null
order by updated_at desc
limit 50;

-- Expected:
--   This query can return older Phase 5 imports or imports where repair was not run.
--   For new Phase 6 smoke tests, repair-run imports should move out of this list.


-- ---------------------------------------------------------------------------
-- 6. Phase 6 metadata summary counts
-- ---------------------------------------------------------------------------
select
  count(*) filter (where meta->>'visual_quality_artifact_path' is not null) as imports_with_visual_quality,
  count(*) filter (where meta->>'visual_repair_artifact_path' is not null) as imports_with_visual_repair,
  count(*) filter (where meta->'visual_repair_summary'->>'repairStatus' = 'completed') as repair_completed,
  count(*) filter (where meta->'visual_repair_summary'->>'repairStatus' = 'skipped') as repair_skipped,
  count(*) filter (where meta->'visual_repair_summary'->>'repairStatus' = 'failed') as repair_failed,
  count(*) filter (where nullif(meta->'visual_repair_summary'->>'totalApplied', '')::int > 0) as repair_applied_patches,
  count(*) filter (where meta->'visual_repair_summary'->>'requiresManualReview' = 'true') as repair_requires_manual_review,
  count(*) filter (where meta->'visual_repair_summary'->>'requiresFallback' = 'true') as repair_requires_fallback
from public.template_imports;

-- Expected:
--   imports_with_visual_repair increases after running Phase 6 repair from the UI.
--   repair_completed/skipped/failed should reflect real repair outcomes.
