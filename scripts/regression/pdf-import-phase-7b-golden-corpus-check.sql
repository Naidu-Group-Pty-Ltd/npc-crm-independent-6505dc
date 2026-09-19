-- Phase 7B Golden Corpus Check
-- Purpose:
--   Validate golden corpus imports after each PDF runs through:
--   Import PDF → Visual QA → Repair → Apply Repair.
--
-- Usage:
--   Replace the values inside golden_imports with the import IDs from your golden corpus manifest.
--   Run this in Supabase SQL Editor.

with golden_imports(import_id, corpus_id, category, expected_page_count) as (
  values
    -- Replace these rows after each golden PDF run.
    -- ('00000000-0000-0000-0000-000000000000'::uuid, 'golden-simple-001', 'simple_one_page', 1),
    -- ('00000000-0000-0000-0000-000000000000'::uuid, 'golden-design-001', 'design_heavy_one_page', 1),
    -- ('00000000-0000-0000-0000-000000000000'::uuid, 'golden-report-001', 'multi_page_report', null),
    -- ('00000000-0000-0000-0000-000000000000'::uuid, 'golden-ocr-001', 'scanned_ocr', null)
    (null::uuid, 'placeholder', 'placeholder', null::int)
),
imports as (
  select
    gi.corpus_id,
    gi.category,
    gi.expected_page_count,
    ti.id as import_id,
    ti.status,
    ti.source_filename,
    ti.page_count,
    ti.created_template_id as template_id,
    ti.meta,
    ti.created_at,
    ti.updated_at
  from golden_imports gi
  left join public.template_imports ti
    on ti.id = gi.import_id
  where gi.import_id is not null
),
template_rows as (
  select
    i.*,
    rt.version as template_version,
    jsonb_array_length(coalesce(rt.schema->'pages', '[]'::jsonb)) as template_page_count,
    rt.updated_at as template_updated_at
  from imports i
  left join public.report_templates rt
    on rt.id = i.template_id
),
latest_snapshots as (
  select distinct on (rtv.template_id)
    rtv.template_id,
    rtv.version as snapshot_version,
    rtv.label as snapshot_label,
    rtv.note as snapshot_note,
    rtv.created_at as snapshot_created_at,
    jsonb_array_length(coalesce(rtv.schema->'pages', '[]'::jsonb)) as snapshot_page_count
  from public.report_template_versions rtv
  join template_rows tr
    on tr.template_id = rtv.template_id
  order by rtv.template_id, rtv.created_at desc
),
audit_objects as (
  select
    tr.import_id,
    tr.meta->>'visual_repair_artifact_path' as audit_path,
    o.name as object_name,
    o.created_at as object_created_at,
    o.updated_at as object_updated_at
  from template_rows tr
  left join storage.objects o
    on o.bucket_id = 'template-import-artifacts'
   and o.name = tr.meta->>'visual_repair_artifact_path'
)
select
  tr.corpus_id,
  tr.category,
  tr.import_id,
  tr.status,
  tr.source_filename,
  tr.expected_page_count,
  tr.page_count,
  tr.template_id,
  tr.template_version,
  tr.template_page_count,

  tr.meta->>'visual_quality_artifact_path' as visual_quality_artifact_path,
  tr.meta->>'visual_repair_artifact_path' as visual_repair_artifact_path,

  tr.meta->'visual_quality_summary'->>'overallScore' as visual_quality_score,
  tr.meta->'visual_quality_summary'->>'pageCount' as visual_quality_page_count,

  tr.meta->'visual_repair_summary'->>'repairStatus' as repair_status,
  tr.meta->'visual_repair_summary'->>'visualQaScore' as repair_start_score,
  tr.meta->'visual_repair_summary'->>'finalScore' as repair_final_score,
  tr.meta->'visual_repair_summary'->>'scoreDelta' as repair_score_delta,
  tr.meta->'visual_repair_summary'->>'totalApplied' as total_applied,
  tr.meta->'visual_repair_summary'->>'passesAttempted' as passes_attempted,
  tr.meta->'visual_repair_summary'->>'patchesAccepted' as patches_accepted,
  tr.meta->'visual_repair_summary'->>'patchesRejected' as patches_rejected,
  tr.meta->'visual_repair_summary'->>'requiresFallback' as requires_fallback,
  tr.meta->'visual_repair_summary'->>'requiresManualReview' as requires_manual_review,

  case when ao.object_name is not null then true else false end as repair_audit_object_exists,
  ao.audit_path,

  ls.snapshot_version,
  ls.snapshot_label,
  ls.snapshot_note,
  ls.snapshot_page_count,

  case
    when tr.import_id is null then 'missing_import'
    when tr.status not in ('completed', 'complete', 'succeeded', 'success') then 'check_import_status'
    when tr.template_id is null then 'missing_template'
    when tr.meta->>'visual_quality_artifact_path' is null then 'missing_visual_quality'
    when tr.meta->>'visual_repair_artifact_path' is null then 'missing_visual_repair'
    when ao.object_name is null then 'missing_repair_audit_object'
    when tr.template_page_count is distinct from tr.page_count then 'template_page_count_mismatch'
    when tr.expected_page_count is not null and tr.page_count is distinct from tr.expected_page_count then 'expected_page_count_mismatch'
    when ls.snapshot_label is distinct from 'Before visual repair' then 'missing_before_repair_snapshot'
    else 'pass'
  end as golden_check_status

from template_rows tr
left join audit_objects ao
  on ao.import_id = tr.import_id
left join latest_snapshots ls
  on ls.template_id = tr.template_id
order by tr.category, tr.corpus_id;
