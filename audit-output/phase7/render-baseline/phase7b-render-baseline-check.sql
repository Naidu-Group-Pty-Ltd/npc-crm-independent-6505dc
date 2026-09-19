-- Phase 7B Render Baseline Check
-- Run this in Supabase SQL Editor after completing the live frontend test.

with latest_repaired_import as (
  select *
  from public.template_imports
  where created_template_id is not null
    and meta->>'visual_quality_artifact_path' is not null
    and meta->>'visual_repair_artifact_path' is not null
  order by updated_at desc
  limit 1
),
template_row as (
  select
    lri.id as import_id,
    rt.id as template_id,
    rt.name,
    rt.version,
    jsonb_array_length(coalesce(rt.schema->'pages', '[]'::jsonb)) as template_page_count,
    rt.updated_at as template_updated_at
  from latest_repaired_import lri
  join public.report_templates rt
    on rt.id = lri.created_template_id
),
latest_snapshot as (
  select distinct on (rtv.template_id)
    rtv.template_id,
    rtv.version as snapshot_version,
    rtv.label as snapshot_label,
    rtv.note as snapshot_note,
    rtv.created_at as snapshot_created_at,
    jsonb_array_length(coalesce(rtv.schema->'pages', '[]'::jsonb)) as snapshot_page_count
  from public.report_template_versions rtv
  join template_row tr
    on tr.template_id = rtv.template_id
  order by rtv.template_id, rtv.created_at desc
),
repair_object as (
  select
    lri.id as import_id,
    lri.meta->>'visual_repair_artifact_path' as repair_audit_path,
    o.name as repair_object_name,
    o.created_at as repair_object_created_at,
    o.updated_at as repair_object_updated_at
  from latest_repaired_import lri
  left join storage.objects o
    on o.bucket_id = 'template-import-artifacts'
   and o.name = lri.meta->>'visual_repair_artifact_path'
)
select
  lri.id as import_id,
  lri.status,
  lri.source_filename,
  lri.page_count as imported_page_count,
  lri.created_template_id as template_id,

  tr.name as template_name,
  tr.version as template_version,
  tr.template_page_count,

  lri.meta->>'visual_quality_artifact_path' as visual_quality_artifact_path,
  lri.meta->'visual_quality_summary'->>'overallScore' as visual_quality_score,
  lri.meta->'visual_quality_summary'->>'pageCount' as visual_quality_page_count,
  lri.meta->'visual_quality_summary'->>'manualReviewRequired' as visual_quality_manual_review_required,

  lri.meta->>'visual_repair_artifact_path' as visual_repair_artifact_path,
  lri.meta->'visual_repair_summary'->>'repairStatus' as repair_status,
  lri.meta->'visual_repair_summary'->>'visualQaScore' as repair_start_score,
  lri.meta->'visual_repair_summary'->>'finalScore' as repair_final_score,
  lri.meta->'visual_repair_summary'->>'scoreDelta' as repair_score_delta,
  lri.meta->'visual_repair_summary'->>'totalApplied' as total_applied,
  lri.meta->'visual_repair_summary'->>'passesAttempted' as passes_attempted,
  lri.meta->'visual_repair_summary'->>'patchesAccepted' as patches_accepted,
  lri.meta->'visual_repair_summary'->>'patchesRejected' as patches_rejected,
  lri.meta->'visual_repair_summary'->>'requiresFallback' as requires_fallback,
  lri.meta->'visual_repair_summary'->>'requiresManualReview' as requires_manual_review,

  case when ro.repair_object_name is not null then true else false end as repair_audit_object_exists,
  ro.repair_audit_path,

  ls.snapshot_version,
  ls.snapshot_label,
  ls.snapshot_note,
  ls.snapshot_page_count,

  case
    when lri.id is null then 'fail_missing_import'
    when lri.created_template_id is null then 'fail_missing_template'
    when lri.meta->>'visual_quality_artifact_path' is null then 'fail_missing_visual_quality'
    when lri.meta->>'visual_repair_artifact_path' is null then 'fail_missing_visual_repair'
    when ro.repair_object_name is null then 'fail_missing_repair_audit_object'
    when tr.template_page_count is distinct from lri.page_count then 'fail_template_page_count_mismatch'
    when ls.snapshot_label is distinct from 'Before visual repair' then 'fail_missing_before_repair_snapshot'
    else 'pass'
  end as phase7b_metadata_status,

  lri.created_at as import_created_at,
  lri.updated_at as import_updated_at,
  tr.template_updated_at,
  ls.snapshot_created_at

from latest_repaired_import lri
left join template_row tr
  on tr.import_id = lri.id
left join latest_snapshot ls
  on ls.template_id = tr.template_id
left join repair_object ro
  on ro.import_id = lri.id;
