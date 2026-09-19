-- Phase 7 Final Regression Check
-- Run in Supabase SQL Editor after the final Phase 7 browser smoke test.
--
-- Expected flow before running:
-- Import PDF
-- → Review Quality
-- → Run Visual QA
-- → Run Repair
-- → Run AI reconciliation if recommended
-- → Apply repaired/reconciled template
-- → Record or run export parity

-- ---------------------------------------------------------------------------
-- 1. Latest full Phase 7 import quality rows
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.status,
  ti.source_filename,
  ti.page_count as import_page_count,
  ti.created_template_id as template_id,

  ti.meta->'import_manifests_summary'->>'job_id' as pdf_job_id,
  ti.meta->'import_manifests_summary'->>'engine_version' as engine_version,
  ti.meta->'import_manifests_summary'->>'diagnostics_path' as diagnostics_path,

  ti.meta->>'visual_quality_artifact_path' as visual_quality_artifact_path,
  ti.meta->'visual_quality_summary'->>'overallScore' as visual_quality_score,
  ti.meta->'visual_quality_summary'->>'manualReviewRequired' as visual_quality_manual_review_required,
  ti.meta->'visual_quality_summary'->>'finalMode' as visual_quality_final_mode,

  ti.meta->>'visual_repair_artifact_path' as visual_repair_artifact_path,
  ti.meta->'visual_repair_summary'->>'repairStatus' as repair_status,
  ti.meta->'visual_repair_summary'->>'visualQaScore' as repair_start_score,
  ti.meta->'visual_repair_summary'->>'finalScore' as repair_final_score,
  ti.meta->'visual_repair_summary'->>'scoreDelta' as repair_score_delta,
  ti.meta->'visual_repair_summary'->>'totalApplied' as repair_total_applied,
  ti.meta->'visual_repair_summary'->>'patchesAccepted' as repair_patches_accepted,
  ti.meta->'visual_repair_summary'->>'patchesRejected' as repair_patches_rejected,
  ti.meta->'visual_repair_summary'->>'requiresFallback' as repair_requires_fallback,
  ti.meta->'visual_repair_summary'->>'requiresManualReview' as repair_requires_manual_review,

  ti.meta->'ai_reconciliation_summary'->>'status' as ai_reconciliation_status,
  ti.meta->'ai_reconciliation_summary'->>'recommendation' as ai_reconciliation_recommendation,
  ti.meta->'ai_reconciliation_summary'->>'completedAt' as ai_reconciliation_completed_at,

  ti.meta->>'export_parity_artifact_path' as export_parity_artifact_path,
  ti.meta->'export_parity_summary'->>'status' as export_parity_status,
  ti.meta->'export_parity_summary'->>'mode' as export_parity_mode,
  ti.meta->'export_parity_summary'->>'editorVsSourceScore' as editor_vs_source_score,
  ti.meta->'export_parity_summary'->>'exportVsSourceScore' as export_vs_source_score,
  ti.meta->'export_parity_summary'->>'exportVsEditorScore' as export_vs_editor_score,
  ti.meta->'export_parity_summary'->>'manualReviewRequired' as export_parity_manual_review_required,

  ti.error,
  ti.created_at,
  ti.updated_at
from public.template_imports ti
order by ti.updated_at desc
limit 40;

-- ---------------------------------------------------------------------------
-- 2. Artifact object presence for Visual QA, Repair, and Export Parity
-- ---------------------------------------------------------------------------
with latest as (
  select
    ti.id,
    ti.source_filename,
    ti.meta->>'visual_quality_artifact_path' as visual_quality_path,
    ti.meta->>'visual_repair_artifact_path' as repair_path,
    ti.meta->>'export_parity_artifact_path' as export_parity_path,
    ti.updated_at
  from public.template_imports ti
  where ti.status = 'completed'
  order by ti.updated_at desc
  limit 50
),
artifact_paths as (
  select id, source_filename, 'visual_quality' as artifact_type, visual_quality_path as artifact_path, updated_at
  from latest
  where visual_quality_path is not null
  union all
  select id, source_filename, 'visual_repair' as artifact_type, repair_path as artifact_path, updated_at
  from latest
  where repair_path is not null
  union all
  select id, source_filename, 'export_parity' as artifact_type, export_parity_path as artifact_path, updated_at
  from latest
  where export_parity_path is not null
)
select
  ap.id as import_id,
  ap.source_filename,
  ap.artifact_type,
  ap.artifact_path,
  count(o.id) as storage_object_count,
  max(o.created_at) as object_created_at,
  max(o.updated_at) as object_updated_at,
  case
    when count(o.id) = 1 then 'pass'
    when count(o.id) = 0 then 'missing_storage_object'
    else 'duplicate_storage_objects'
  end as artifact_status,
  ap.updated_at as import_updated_at
from artifact_paths ap
left join storage.objects o
  on o.bucket_id = 'template-import-artifacts'
 and o.name = ap.artifact_path
group by ap.id, ap.source_filename, ap.artifact_type, ap.artifact_path, ap.updated_at
order by ap.updated_at desc, ap.artifact_type;

-- ---------------------------------------------------------------------------
-- 3. Template page count match
-- ---------------------------------------------------------------------------
with latest as (
  select
    ti.id,
    ti.source_filename,
    ti.page_count,
    ti.created_template_id,
    ti.updated_at
  from public.template_imports ti
  where ti.status = 'completed'
    and ti.created_template_id is not null
  order by ti.updated_at desc
  limit 50
)
select
  l.id as import_id,
  l.source_filename,
  l.page_count as import_page_count,
  rt.id as template_id,
  rt.name as template_name,
  rt.version as template_version,
  jsonb_array_length(coalesce(rt.schema->'pages', '[]'::jsonb)) as template_page_count,
  case
    when jsonb_array_length(coalesce(rt.schema->'pages', '[]'::jsonb)) = l.page_count then 'pass'
    else 'template_page_count_mismatch'
  end as page_count_status,
  rt.updated_at as template_updated_at,
  l.updated_at as import_updated_at
from latest l
join public.report_templates rt
  on rt.id = l.created_template_id
order by l.updated_at desc;

-- ---------------------------------------------------------------------------
-- 4. Template version and snapshot validation
-- ---------------------------------------------------------------------------
with latest_templates as (
  select distinct
    ti.created_template_id as template_id
  from public.template_imports ti
  where ti.status = 'completed'
    and ti.created_template_id is not null
  order by ti.created_template_id
  limit 50
),
snapshot_counts as (
  select
    rtv.template_id,
    count(*) as snapshot_count,
    count(*) filter (where lower(coalesce(rtv.label, '')) like '%repair%') as repair_snapshot_count,
    count(*) filter (where lower(coalesce(rtv.note, '')) like '%repair%') as repair_note_count,
    max(rtv.created_at) as latest_snapshot_at
  from public.report_template_versions rtv
  where rtv.template_id in (select template_id from latest_templates)
  group by rtv.template_id
)
select
  rt.id as template_id,
  rt.name,
  rt.version,
  coalesce(sc.snapshot_count, 0) as snapshot_count,
  coalesce(sc.repair_snapshot_count, 0) as repair_snapshot_count,
  coalesce(sc.repair_note_count, 0) as repair_note_count,
  sc.latest_snapshot_at,
  case
    when rt.version > 1 and coalesce(sc.snapshot_count, 0) > 0 then 'pass'
    when rt.version = 1 then 'version_not_incremented_or_no_apply_yet'
    else 'snapshot_missing'
  end as version_snapshot_status,
  rt.updated_at
from public.report_templates rt
left join snapshot_counts sc
  on sc.template_id = rt.id
where rt.id in (select template_id from latest_templates)
order by rt.updated_at desc;

-- ---------------------------------------------------------------------------
-- 5. AI reconciliation metadata rows
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.created_template_id as template_id,
  ti.meta->'ai_reconciliation_summary'->>'version' as ai_version,
  ti.meta->'ai_reconciliation_summary'->>'status' as ai_status,
  ti.meta->'ai_reconciliation_summary'->>'recommendation' as ai_recommendation,
  ti.meta->'ai_reconciliation_summary'->>'reason' as ai_reason,
  ti.meta->'ai_reconciliation_summary'->>'visualQaScoreBefore' as visual_qa_score_before,
  ti.meta->'ai_reconciliation_summary'->>'repairFinalScoreBefore' as repair_final_score_before,
  ti.meta->'ai_reconciliation_summary'->>'visualQaScoreAfter' as visual_qa_score_after,
  ti.meta->'ai_reconciliation_summary'->>'editableElementsCreated' as editable_elements_created,
  ti.meta->'ai_reconciliation_summary'->>'layoutChanges' as layout_changes,
  ti.meta->'ai_reconciliation_summary'->>'startedAt' as started_at,
  ti.meta->'ai_reconciliation_summary'->>'completedAt' as completed_at,
  ti.meta->'ai_reconciliation_summary'->>'failedAt' as failed_at,
  ti.meta->'ai_reconciliation_summary'->>'errorMessage' as error_message,
  ti.updated_at
from public.template_imports ti
where ti.meta ? 'ai_reconciliation_summary'
order by ti.updated_at desc
limit 50;

-- ---------------------------------------------------------------------------
-- 6. Export parity metadata rows
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.created_template_id as template_id,
  ti.page_count,
  ti.meta->>'export_parity_artifact_path' as export_parity_artifact_path,
  ti.meta->'export_parity_summary'->>'status' as export_parity_status,
  ti.meta->'export_parity_summary'->>'mode' as export_parity_mode,
  ti.meta->'export_parity_summary'->>'editorVsSourceScore' as editor_vs_source_score,
  ti.meta->'export_parity_summary'->>'exportVsSourceScore' as export_vs_source_score,
  ti.meta->'export_parity_summary'->>'exportVsEditorScore' as export_vs_editor_score,
  ti.meta->'export_parity_summary'->>'manualReviewRequired' as export_manual_review_required,
  ti.meta->'export_parity_summary'->>'sourcePageCount' as source_page_count,
  ti.meta->'export_parity_summary'->>'editorPageCount' as editor_page_count,
  ti.meta->'export_parity_summary'->>'exportedPageCount' as exported_page_count,
  ti.meta->'export_parity_summary'->>'problemCount' as problem_count,
  ti.meta->'export_parity_summary'->>'generatedAt' as parity_generated_at,
  ti.meta->'export_parity_summary'->>'persistedAt' as parity_persisted_at,
  ti.updated_at
from public.template_imports ti
where ti.meta->>'export_parity_artifact_path' is not null
order by ti.updated_at desc
limit 50;

-- ---------------------------------------------------------------------------
-- 7. Latest PDF import diagnostics jobs
-- ---------------------------------------------------------------------------
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
limit 50;

-- ---------------------------------------------------------------------------
-- 8. Rows requiring attention
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.status,
  ti.source_filename,
  ti.created_template_id as template_id,
  ti.page_count,
  ti.error,

  ti.meta->'visual_quality_summary'->>'overallScore' as visual_quality_score,
  ti.meta->'visual_quality_summary'->>'manualReviewRequired' as visual_quality_manual_review_required,

  ti.meta->'visual_repair_summary'->>'repairStatus' as repair_status,
  ti.meta->'visual_repair_summary'->>'finalScore' as repair_final_score,
  ti.meta->'visual_repair_summary'->>'requiresFallback' as repair_requires_fallback,
  ti.meta->'visual_repair_summary'->>'requiresManualReview' as repair_requires_manual_review,

  ti.meta->'export_parity_summary'->>'status' as export_parity_status,
  ti.meta->'export_parity_summary'->>'exportVsSourceScore' as export_vs_source_score,
  ti.meta->'export_parity_summary'->>'manualReviewRequired' as export_parity_manual_review_required,

  ti.updated_at
from public.template_imports ti
where
  ti.status = 'failed'
  or ti.error is not null
  or (
    ti.status = 'completed'
    and ti.meta->>'visual_quality_artifact_path' is null
  )
  or (
    ti.meta->>'visual_quality_artifact_path' is not null
    and ti.meta->>'visual_repair_artifact_path' is null
  )
  or ti.meta->'visual_quality_summary'->>'manualReviewRequired' = 'true'
  or ti.meta->'visual_repair_summary'->>'requiresFallback' = 'true'
  or ti.meta->'visual_repair_summary'->>'requiresManualReview' = 'true'
  or ti.meta->'export_parity_summary'->>'status' in ('failed', 'manual_required')
  or ti.meta->'export_parity_summary'->>'manualReviewRequired' = 'true'
order by ti.updated_at desc
limit 80;

-- ---------------------------------------------------------------------------
-- 9. Summary counts
-- ---------------------------------------------------------------------------
select
  count(*) as total_imports,
  count(*) filter (where status = 'completed') as completed_imports,
  count(*) filter (where status = 'failed') as failed_imports,

  count(*) filter (where meta->>'visual_quality_artifact_path' is not null) as imports_with_visual_quality,
  count(*) filter (where meta->>'visual_repair_artifact_path' is not null) as imports_with_visual_repair,
  count(*) filter (where meta ? 'ai_reconciliation_summary') as imports_with_ai_reconciliation,
  count(*) filter (where meta->>'export_parity_artifact_path' is not null) as imports_with_export_parity,

  count(*) filter (where meta->'visual_quality_summary'->>'manualReviewRequired' = 'true') as visual_qa_manual_review,
  count(*) filter (where meta->'visual_repair_summary'->>'requiresFallback' = 'true') as repair_requires_fallback,
  count(*) filter (where meta->'visual_repair_summary'->>'requiresManualReview' = 'true') as repair_requires_manual_review,
  count(*) filter (where meta->'export_parity_summary'->>'manualReviewRequired' = 'true') as export_parity_manual_review,

  count(*) filter (where meta->'visual_repair_summary'->>'repairStatus' = 'completed') as repair_completed,
  count(*) filter (where meta->'visual_repair_summary'->>'repairStatus' = 'skipped') as repair_skipped,
  count(*) filter (where meta->'visual_repair_summary'->>'repairStatus' = 'failed') as repair_failed,

  count(*) filter (where meta->'export_parity_summary'->>'status' = 'completed') as export_parity_completed,
  count(*) filter (where meta->'export_parity_summary'->>'status' = 'manual_required') as export_parity_manual_required,
  count(*) filter (where meta->'export_parity_summary'->>'status' = 'failed') as export_parity_failed
from public.template_imports;

-- ---------------------------------------------------------------------------
-- 10. Final lock readiness summary
-- ---------------------------------------------------------------------------
with latest as (
  select *
  from public.template_imports
  where status = 'completed'
  order by updated_at desc
  limit 20
),
flags as (
  select
    count(*) as checked_imports,
    count(*) filter (where created_template_id is not null) as with_template,
    count(*) filter (where meta->>'visual_quality_artifact_path' is not null) as with_visual_quality,
    count(*) filter (where meta->>'visual_repair_artifact_path' is not null) as with_visual_repair,
    count(*) filter (where meta->>'export_parity_artifact_path' is not null) as with_export_parity,
    count(*) filter (where error is not null) as with_error
  from latest
)
select
  checked_imports,
  with_template,
  with_visual_quality,
  with_visual_repair,
  with_export_parity,
  with_error,
  case
    when checked_imports = 0 then 'not_locked_no_completed_imports'
    when with_error > 0 then 'not_locked_latest_import_errors'
    when with_template = 0 then 'not_locked_no_templates'
    when with_visual_quality = 0 then 'not_locked_no_visual_quality'
    when with_visual_repair = 0 then 'not_locked_no_visual_repair'
    when with_export_parity = 0 then 'locked_with_warnings_no_export_parity_recorded'
    else 'phase_7_ready_to_lock'
  end as phase_7_lock_status
from flags;
