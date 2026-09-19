-- Phase 8B Golden Corpus Run Check
-- Run in Supabase SQL Editor after manually executing golden corpus browser runs.
--
-- Step 1:
-- Replace the blank import_id/template_id values in the golden_runs CTE.
--
-- IMPORTANT: this file contains three independent statements (sections 1-3), each with its
-- own copy of the golden_runs / registry / joined preamble. Postgres CTEs are scoped to a
-- single statement, so paste the SAME import_id/template_id values into ALL THREE
-- golden_runs blocks below (or run only the section you need).
--
-- Step 2:
-- Run this SQL to validate whether each golden run has enough Phase 7 metadata.
--
-- This phase does not persist golden_regression_summary yet.

-- ---------------------------------------------------------------------------
-- 1. Golden run validation rows
-- ---------------------------------------------------------------------------
with golden_runs as (
  select *
  from (
    values
      ('golden-simple-001', '', ''),
      ('golden-design-001', '', ''),
      ('golden-report-001', '', ''),
      ('golden-table-001', '', ''),
      ('golden-image-001', '', ''),
      ('golden-ocr-001', '', '')
  ) as v(corpus_id, import_id, template_id)
),
registry as (
  select *
  from (
    values
      ('golden-simple-001', 'simple_one_page', 0.90::numeric, 0.90::numeric, 0.90::numeric, false, false),
      ('golden-design-001', 'design_heavy_one_page', 0.80::numeric, 0.82::numeric, 0.80::numeric, true, true),
      ('golden-report-001', 'multi_page_report', 0.82::numeric, 0.84::numeric, 0.82::numeric, true, false),
      ('golden-table-001', 'table_heavy', 0.78::numeric, 0.80::numeric, 0.78::numeric, true, false),
      ('golden-image-001', 'image_heavy', 0.80::numeric, 0.82::numeric, 0.80::numeric, true, true),
      ('golden-ocr-001', 'scanned_ocr', 0.65::numeric, 0.65::numeric, 0.75::numeric, true, true)
  ) as r(corpus_id, category, visual_min, repair_min, export_min, manual_review_allowed, fallback_allowed)
),
joined as (
  select
    gr.corpus_id,
    r.category,
    nullif(gr.import_id, '')::uuid as mapped_import_id,
    nullif(gr.template_id, '')::uuid as mapped_template_id,

    ti.id as import_id,
    ti.status as import_status,
    ti.source_filename,
    ti.page_count as import_page_count,
    ti.created_template_id,

    rt.id as template_id,
    rt.version as template_version,
    jsonb_array_length(coalesce(rt.schema->'pages', '[]'::jsonb)) as template_page_count,

    ti.meta->'import_manifests_summary'->>'engine_version' as engine_version,
    ti.meta->'import_manifests_summary'->>'job_id' as pdf_job_id,

    ti.meta->>'visual_quality_artifact_path' as visual_quality_artifact_path,
    nullif(ti.meta->'visual_quality_summary'->>'overallScore', '')::numeric as visual_quality_score,
    (ti.meta->'visual_quality_summary'->>'manualReviewRequired')::boolean as visual_quality_manual_review_required,

    ti.meta->>'visual_repair_artifact_path' as visual_repair_artifact_path,
    ti.meta->'visual_repair_summary'->>'repairStatus' as repair_status,
    nullif(ti.meta->'visual_repair_summary'->>'finalScore', '')::numeric as repair_final_score,
    (ti.meta->'visual_repair_summary'->>'requiresFallback')::boolean as repair_requires_fallback,
    (ti.meta->'visual_repair_summary'->>'requiresManualReview')::boolean as repair_requires_manual_review,

    ti.meta->'ai_reconciliation_summary'->>'status' as ai_reconciliation_status,
    ti.meta->'ai_reconciliation_summary'->>'recommendation' as ai_reconciliation_recommendation,

    ti.meta->>'export_parity_artifact_path' as export_parity_artifact_path,
    ti.meta->'export_parity_summary'->>'status' as export_parity_status,
    ti.meta->'export_parity_summary'->>'mode' as export_parity_mode,
    nullif(ti.meta->'export_parity_summary'->>'exportVsSourceScore', '')::numeric as export_vs_source_score,
    nullif(ti.meta->'export_parity_summary'->>'editorVsSourceScore', '')::numeric as editor_vs_source_score,
    nullif(ti.meta->'export_parity_summary'->>'exportVsEditorScore', '')::numeric as export_vs_editor_score,

    r.visual_min,
    r.repair_min,
    r.export_min,
    r.manual_review_allowed,
    r.fallback_allowed,

    ti.error,
    ti.updated_at
  from golden_runs gr
  left join registry r
    on r.corpus_id = gr.corpus_id
  left join public.template_imports ti
    on ti.id = nullif(gr.import_id, '')::uuid
  left join public.report_templates rt
    on rt.id = coalesce(nullif(gr.template_id, '')::uuid, ti.created_template_id)
)
select
  corpus_id,
  category,
  mapped_import_id,
  import_id,
  source_filename,
  import_status,
  mapped_template_id,
  template_id,
  engine_version,

  import_page_count,
  template_page_count,

  visual_quality_score,
  visual_min,
  repair_status,
  repair_final_score,
  repair_min,

  ai_reconciliation_status,
  ai_reconciliation_recommendation,

  export_parity_status,
  export_parity_mode,
  export_vs_source_score,
  export_min,

  case
    when mapped_import_id is null then 'not_evaluated_import_id_missing'
    when import_id is null then 'fail_import_missing'
    when import_status <> 'completed' then 'fail_import_not_completed'
    when template_id is null then 'fail_template_missing'
    when import_page_count is not null
      and template_page_count is not null
      and import_page_count <> template_page_count then 'fail_template_page_count_mismatch'
    when visual_quality_artifact_path is null then 'fail_visual_quality_missing'
    when visual_repair_artifact_path is null then 'fail_repair_audit_missing'
    when repair_status = 'failed' then 'fail_repair_failed'
    when visual_quality_manual_review_required = true and manual_review_allowed = false then 'fail_manual_review_not_allowed'
    when repair_requires_manual_review = true and manual_review_allowed = false then 'fail_repair_manual_review_not_allowed'
    when repair_requires_fallback = true and fallback_allowed = false then 'fail_fallback_not_allowed'
    when export_parity_status = 'failed' then 'fail_export_parity_failed'
    when export_parity_artifact_path is null then 'warning_export_parity_not_recorded'
    when visual_quality_score < visual_min then 'warning_visual_quality_below_registry_minimum'
    when repair_final_score < repair_min then 'warning_repair_final_below_registry_minimum'
    when export_vs_source_score < export_min then 'warning_export_parity_below_registry_minimum'
    when visual_quality_manual_review_required = true then 'warning_manual_review_required'
    when repair_requires_manual_review = true then 'warning_repair_manual_review_required'
    when repair_requires_fallback = true then 'warning_fallback_used'
    when repair_status = 'skipped' then 'warning_repair_skipped'
    else 'pass'
  end as golden_run_status,

  updated_at
from joined
order by corpus_id;

-- ---------------------------------------------------------------------------
-- 2. Artifact storage object presence for mapped golden runs
--    (paste the same import IDs into the golden_runs block below)
-- ---------------------------------------------------------------------------
with golden_runs as (
  select *
  from (
    values
      ('golden-simple-001', '', ''),
      ('golden-design-001', '', ''),
      ('golden-report-001', '', ''),
      ('golden-table-001', '', ''),
      ('golden-image-001', '', ''),
      ('golden-ocr-001', '', '')
  ) as v(corpus_id, import_id, template_id)
),
joined as (
  select
    gr.corpus_id,
    ti.id as import_id,
    ti.meta->>'visual_quality_artifact_path' as visual_quality_artifact_path,
    ti.meta->>'visual_repair_artifact_path' as visual_repair_artifact_path,
    ti.meta->>'export_parity_artifact_path' as export_parity_artifact_path
  from golden_runs gr
  left join public.template_imports ti
    on ti.id = nullif(gr.import_id, '')::uuid
),
artifact_paths as (
  select corpus_id, import_id, 'visual_quality' as artifact_type, visual_quality_artifact_path as artifact_path
  from joined
  where visual_quality_artifact_path is not null

  union all

  select corpus_id, import_id, 'visual_repair' as artifact_type, visual_repair_artifact_path as artifact_path
  from joined
  where visual_repair_artifact_path is not null

  union all

  select corpus_id, import_id, 'export_parity' as artifact_type, export_parity_artifact_path as artifact_path
  from joined
  where export_parity_artifact_path is not null
)
select
  ap.corpus_id,
  ap.import_id,
  ap.artifact_type,
  ap.artifact_path,
  count(o.id) as storage_object_count,
  case
    when count(o.id) = 1 then 'pass'
    when count(o.id) = 0 then 'missing_storage_object'
    else 'duplicate_storage_objects'
  end as storage_status,
  max(o.created_at) as object_created_at,
  max(o.updated_at) as object_updated_at
from artifact_paths ap
left join storage.objects o
  on o.bucket_id = 'template-import-artifacts'
 and o.name = ap.artifact_path
group by ap.corpus_id, ap.import_id, ap.artifact_type, ap.artifact_path
order by ap.corpus_id, ap.artifact_type;

-- ---------------------------------------------------------------------------
-- 3. Golden run summary counts
--    (paste the same import IDs into the golden_runs block below)
-- ---------------------------------------------------------------------------
with golden_runs as (
  select *
  from (
    values
      ('golden-simple-001', '', ''),
      ('golden-design-001', '', ''),
      ('golden-report-001', '', ''),
      ('golden-table-001', '', ''),
      ('golden-image-001', '', ''),
      ('golden-ocr-001', '', '')
  ) as v(corpus_id, import_id, template_id)
),
registry as (
  select *
  from (
    values
      ('golden-simple-001', 'simple_one_page', 0.90::numeric, 0.90::numeric, 0.90::numeric, false, false),
      ('golden-design-001', 'design_heavy_one_page', 0.80::numeric, 0.82::numeric, 0.80::numeric, true, true),
      ('golden-report-001', 'multi_page_report', 0.82::numeric, 0.84::numeric, 0.82::numeric, true, false),
      ('golden-table-001', 'table_heavy', 0.78::numeric, 0.80::numeric, 0.78::numeric, true, false),
      ('golden-image-001', 'image_heavy', 0.80::numeric, 0.82::numeric, 0.80::numeric, true, true),
      ('golden-ocr-001', 'scanned_ocr', 0.65::numeric, 0.65::numeric, 0.75::numeric, true, true)
  ) as r(corpus_id, category, visual_min, repair_min, export_min, manual_review_allowed, fallback_allowed)
),
joined as (
  select
    gr.corpus_id,
    nullif(gr.import_id, '')::uuid as mapped_import_id,
    ti.id as import_id,
    ti.status as import_status,
    ti.page_count as import_page_count,
    jsonb_array_length(coalesce(rt.schema->'pages', '[]'::jsonb)) as template_page_count,
    rt.id as template_id,
    ti.meta->>'visual_quality_artifact_path' as visual_quality_artifact_path,
    nullif(ti.meta->'visual_quality_summary'->>'overallScore', '')::numeric as visual_quality_score,
    (ti.meta->'visual_quality_summary'->>'manualReviewRequired')::boolean as visual_quality_manual_review_required,
    ti.meta->>'visual_repair_artifact_path' as visual_repair_artifact_path,
    ti.meta->'visual_repair_summary'->>'repairStatus' as repair_status,
    nullif(ti.meta->'visual_repair_summary'->>'finalScore', '')::numeric as repair_final_score,
    (ti.meta->'visual_repair_summary'->>'requiresFallback')::boolean as repair_requires_fallback,
    (ti.meta->'visual_repair_summary'->>'requiresManualReview')::boolean as repair_requires_manual_review,
    ti.meta->>'export_parity_artifact_path' as export_parity_artifact_path,
    ti.meta->'export_parity_summary'->>'status' as export_parity_status,
    nullif(ti.meta->'export_parity_summary'->>'exportVsSourceScore', '')::numeric as export_vs_source_score,
    r.visual_min,
    r.repair_min,
    r.export_min,
    r.manual_review_allowed,
    r.fallback_allowed
  from golden_runs gr
  left join registry r
    on r.corpus_id = gr.corpus_id
  left join public.template_imports ti
    on ti.id = nullif(gr.import_id, '')::uuid
  left join public.report_templates rt
    on rt.id = coalesce(nullif(gr.template_id, '')::uuid, ti.created_template_id)
),
statuses as (
  select
    corpus_id,
    case
      when mapped_import_id is null then 'not_evaluated'
      when import_id is null then 'fail'
      when import_status <> 'completed' then 'fail'
      when template_id is null then 'fail'
      when import_page_count is not null
        and template_page_count is not null
        and import_page_count <> template_page_count then 'fail'
      when visual_quality_artifact_path is null then 'fail'
      when visual_repair_artifact_path is null then 'fail'
      when repair_status = 'failed' then 'fail'
      when visual_quality_manual_review_required = true and manual_review_allowed = false then 'fail'
      when repair_requires_manual_review = true and manual_review_allowed = false then 'fail'
      when repair_requires_fallback = true and fallback_allowed = false then 'fail'
      when export_parity_status = 'failed' then 'fail'
      when export_parity_artifact_path is null then 'warning'
      when visual_quality_score < visual_min then 'warning'
      when repair_final_score < repair_min then 'warning'
      when export_vs_source_score < export_min then 'warning'
      when visual_quality_manual_review_required = true then 'warning'
      when repair_requires_manual_review = true then 'warning'
      when repair_requires_fallback = true then 'warning'
      when repair_status = 'skipped' then 'warning'
      else 'pass'
    end as decision
  from joined
)
select
  count(*) as total_corpus_slots,
  count(*) filter (where decision = 'pass') as pass_count,
  count(*) filter (where decision = 'warning') as warning_count,
  count(*) filter (where decision = 'fail') as fail_count,
  count(*) filter (where decision = 'not_evaluated') as not_evaluated_count
from statuses;

-- ---------------------------------------------------------------------------
-- 4. Phase 8B note
-- ---------------------------------------------------------------------------
select
  'phase_8b_runner_validation_only' as phase,
  'This SQL validates operator-supplied golden corpus import IDs. It does not persist golden_regression_summary; persistence belongs to Phase 8D.' as note;
