-- Phase 8C Quality Gates Check
-- Run in Supabase SQL Editor after manually executing golden corpus browser runs.
--
-- Replace blank import_id/template_id values in the golden_runs CTE.
-- This SQL does not persist results. Persistence belongs to Phase 8D.
--
-- NOTE: this file has independent statements (sections 1-5), each with its own copy of the
-- golden_runs / registry / joined / gate_rows / overall preamble (Postgres CTEs are scoped to
-- one statement). Paste the SAME import_id/template_id values into EVERY golden_runs block,
-- or run only the section you need.


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
    jsonb_array_length(coalesce(rt.schema->'pages', '[]'::jsonb)) as template_page_count,
    ti.meta->'import_manifests_summary'->>'engine_version' as engine_version,
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
    r.visual_min, r.repair_min, r.export_min, r.manual_review_allowed, r.fallback_allowed,
    ti.error, ti.updated_at
  from golden_runs gr
  left join registry r on r.corpus_id = gr.corpus_id
  left join public.template_imports ti on ti.id = nullif(gr.import_id, '')::uuid
  left join public.report_templates rt on rt.id = coalesce(nullif(gr.template_id, '')::uuid, ti.created_template_id)
),
gate_rows as (
  select j.corpus_id, j.import_id, x.gate_id, x.category, x.gate_status, x.message
  from joined j
  cross join lateral (values
    ('import_completed', 'import',
      case when j.mapped_import_id is null then 'not_evaluated' when j.import_id is null then 'fail' when j.import_status = 'completed' then 'pass' when j.import_status = 'failed' then 'fail' else 'blocked' end,
      case when j.mapped_import_id is null then 'Import ID is missing.' when j.import_id is null then 'Import record was not found.' when j.import_status = 'completed' then 'Import completed.' when j.import_status = 'failed' then 'Import failed.' else 'Import is not completed.' end),
    ('template_created', 'template',
      case when j.template_id is not null then 'pass' else 'fail' end,
      case when j.template_id is not null then 'Template exists.' else 'Template is missing.' end),
    ('template_page_count_match', 'template',
      case when j.import_page_count is null or j.template_page_count is null then 'blocked' when j.import_page_count = j.template_page_count then 'pass' else 'fail' end,
      case when j.import_page_count is null or j.template_page_count is null then 'Page count is unavailable.' when j.import_page_count = j.template_page_count then 'Template page count matches import page count.' else 'Template page count does not match import page count.' end),
    ('visual_quality_artifact_present', 'visual_quality',
      case when j.visual_quality_artifact_path is not null then 'pass' else 'fail' end,
      case when j.visual_quality_artifact_path is not null then 'Visual QA artifact exists.' else 'Visual QA artifact is missing.' end),
    ('visual_quality_score_threshold', 'visual_quality',
      case when j.visual_quality_score is null then 'warning' when j.visual_quality_score >= j.visual_min then 'pass' else 'fail' end,
      case when j.visual_quality_score is null then 'Visual QA score is missing.' when j.visual_quality_score >= j.visual_min then 'Visual QA score meets registry threshold.' else 'Visual QA score is below registry threshold.' end),
    ('repair_audit_present', 'repair',
      case when j.visual_repair_artifact_path is not null then 'pass' else 'fail' end,
      case when j.visual_repair_artifact_path is not null then 'Repair audit exists.' else 'Repair audit is missing.' end),
    ('repair_status_acceptable', 'repair',
      case when j.repair_status = 'completed' then 'pass' when j.repair_status = 'skipped' then 'warning' when j.repair_status = 'failed' then 'fail' else 'blocked' end,
      case when j.repair_status = 'completed' then 'Repair completed.' when j.repair_status = 'skipped' then 'Repair skipped safely or had no eligible pages.' when j.repair_status = 'failed' then 'Repair failed.' else 'Repair status missing or unknown.' end),
    ('repair_final_score_threshold', 'repair',
      case when j.repair_status = 'skipped' then 'warning' when j.repair_final_score is null then 'warning' when j.repair_final_score >= j.repair_min then 'pass' else 'fail' end,
      case when j.repair_status = 'skipped' then 'Repair skipped; final score threshold not enforced.' when j.repair_final_score is null then 'Repair final score is missing.' when j.repair_final_score >= j.repair_min then 'Repair final score meets registry threshold.' else 'Repair final score is below registry threshold.' end),
    ('manual_review_policy', 'visual_quality',
      case when coalesce(j.visual_quality_manual_review_required, false) = false and coalesce(j.repair_requires_manual_review, false) = false then 'pass' when j.manual_review_allowed = true then 'warning' else 'fail' end,
      case when coalesce(j.visual_quality_manual_review_required, false) = false and coalesce(j.repair_requires_manual_review, false) = false then 'Manual review not required.' when j.manual_review_allowed = true then 'Manual review required and allowed by registry.' else 'Manual review required but not allowed by registry.' end),
    ('fallback_policy', 'repair',
      case when coalesce(j.repair_requires_fallback, false) = false then 'pass' when j.fallback_allowed = true then 'warning' else 'fail' end,
      case when coalesce(j.repair_requires_fallback, false) = false then 'Fallback not required.' when j.fallback_allowed = true then 'Fallback required and allowed by registry.' else 'Fallback required but not allowed by registry.' end),
    ('ai_reconciliation_policy', 'ai_reconciliation',
      case when j.ai_reconciliation_status = 'completed' then 'pass' when j.ai_reconciliation_status = 'failed' then 'warning' when j.ai_reconciliation_recommendation in ('recommended', 'manual_review') then 'warning' when j.ai_reconciliation_recommendation = 'not_needed' then 'pass' else 'not_evaluated' end,
      case when j.ai_reconciliation_status = 'completed' then 'AI reconciliation completed.' when j.ai_reconciliation_status = 'failed' then 'AI reconciliation failed but is non-blocking in Phase 8C.' when j.ai_reconciliation_recommendation in ('recommended', 'manual_review') then 'AI reconciliation was recommended but not completed.' when j.ai_reconciliation_recommendation = 'not_needed' then 'AI reconciliation not needed.' else 'AI reconciliation was not evaluated.' end),
    ('export_parity_artifact_present', 'export_parity',
      case when j.export_parity_artifact_path is not null then 'pass' else 'fail' end,
      case when j.export_parity_artifact_path is not null then 'Export parity artifact exists.' else 'Export parity artifact is missing.' end),
    ('export_parity_status_acceptable', 'export_parity',
      case when j.export_parity_status = 'completed' then 'pass' when j.export_parity_status = 'manual_required' then 'warning' when j.export_parity_status = 'failed' then 'fail' else 'blocked' end,
      case when j.export_parity_status = 'completed' then 'Export parity completed.' when j.export_parity_status = 'manual_required' then 'Export parity requires manual review.' when j.export_parity_status = 'failed' then 'Export parity failed.' else 'Export parity status missing or unknown.' end),
    ('export_parity_score_threshold', 'export_parity',
      case when coalesce(j.export_vs_source_score, j.editor_vs_source_score, j.export_vs_editor_score) is null then 'warning' when coalesce(j.export_vs_source_score, j.editor_vs_source_score, j.export_vs_editor_score) >= j.export_min then 'pass' else 'fail' end,
      case when coalesce(j.export_vs_source_score, j.editor_vs_source_score, j.export_vs_editor_score) is null and j.export_parity_status = 'manual_required' then 'Export parity score missing because manual review is required.' when coalesce(j.export_vs_source_score, j.editor_vs_source_score, j.export_vs_editor_score) is null then 'Export parity score is missing.' when coalesce(j.export_vs_source_score, j.editor_vs_source_score, j.export_vs_editor_score) >= j.export_min then 'Export parity score meets registry threshold.' else 'Export parity score is below registry threshold.' end),
    ('engine_version_present', 'diagnostics',
      case when j.engine_version is not null then 'pass' else 'warning' end,
      case when j.engine_version is not null then 'Engine version is present.' else 'Engine version is missing.' end)
  ) as x(gate_id, category, gate_status, message)
),
overall as (
  select
    corpus_id,
    import_id,
    count(*) as total_gates,
    count(*) filter (where gate_status = 'pass') as pass_count,
    count(*) filter (where gate_status = 'warning') as warning_count,
    count(*) filter (where gate_status = 'fail') as fail_count,
    count(*) filter (where gate_status = 'blocked') as blocked_count,
    count(*) filter (where gate_status = 'not_evaluated') as not_evaluated_count,
    case
      when count(*) filter (where gate_status = 'blocked') > 0 then 'blocked'
      when count(*) filter (where gate_status = 'fail') > 0 then 'fail'
      when count(*) filter (where gate_status = 'warning') > 0 then 'warning'
      when count(*) filter (where gate_status <> 'not_evaluated') = 0 then 'not_evaluated'
      else 'pass'
    end as overall_quality_gate_status
  from gate_rows
  group by corpus_id, import_id
)

-- ---------------------------------------------------------------------------
-- 1. Per-gate results
-- ---------------------------------------------------------------------------
select
  gr.corpus_id,
  j.category as corpus_category,
  gr.gate_id,
  gr.category as gate_category,
  gr.gate_status,
  gr.message,
  j.source_filename,
  j.import_id,
  j.template_id,
  j.visual_quality_score,
  j.visual_min,
  j.repair_final_score,
  j.repair_min,
  coalesce(j.export_vs_source_score, j.editor_vs_source_score, j.export_vs_editor_score) as export_score_used,
  j.export_min
from gate_rows gr
left join joined j
  on j.corpus_id = gr.corpus_id
 and (j.import_id = gr.import_id or (j.import_id is null and gr.import_id is null))
order by gr.corpus_id, gr.gate_id;


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
    jsonb_array_length(coalesce(rt.schema->'pages', '[]'::jsonb)) as template_page_count,
    ti.meta->'import_manifests_summary'->>'engine_version' as engine_version,
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
    r.visual_min, r.repair_min, r.export_min, r.manual_review_allowed, r.fallback_allowed,
    ti.error, ti.updated_at
  from golden_runs gr
  left join registry r on r.corpus_id = gr.corpus_id
  left join public.template_imports ti on ti.id = nullif(gr.import_id, '')::uuid
  left join public.report_templates rt on rt.id = coalesce(nullif(gr.template_id, '')::uuid, ti.created_template_id)
),
gate_rows as (
  select j.corpus_id, j.import_id, x.gate_id, x.category, x.gate_status, x.message
  from joined j
  cross join lateral (values
    ('import_completed', 'import',
      case when j.mapped_import_id is null then 'not_evaluated' when j.import_id is null then 'fail' when j.import_status = 'completed' then 'pass' when j.import_status = 'failed' then 'fail' else 'blocked' end,
      case when j.mapped_import_id is null then 'Import ID is missing.' when j.import_id is null then 'Import record was not found.' when j.import_status = 'completed' then 'Import completed.' when j.import_status = 'failed' then 'Import failed.' else 'Import is not completed.' end),
    ('template_created', 'template',
      case when j.template_id is not null then 'pass' else 'fail' end,
      case when j.template_id is not null then 'Template exists.' else 'Template is missing.' end),
    ('template_page_count_match', 'template',
      case when j.import_page_count is null or j.template_page_count is null then 'blocked' when j.import_page_count = j.template_page_count then 'pass' else 'fail' end,
      case when j.import_page_count is null or j.template_page_count is null then 'Page count is unavailable.' when j.import_page_count = j.template_page_count then 'Template page count matches import page count.' else 'Template page count does not match import page count.' end),
    ('visual_quality_artifact_present', 'visual_quality',
      case when j.visual_quality_artifact_path is not null then 'pass' else 'fail' end,
      case when j.visual_quality_artifact_path is not null then 'Visual QA artifact exists.' else 'Visual QA artifact is missing.' end),
    ('visual_quality_score_threshold', 'visual_quality',
      case when j.visual_quality_score is null then 'warning' when j.visual_quality_score >= j.visual_min then 'pass' else 'fail' end,
      case when j.visual_quality_score is null then 'Visual QA score is missing.' when j.visual_quality_score >= j.visual_min then 'Visual QA score meets registry threshold.' else 'Visual QA score is below registry threshold.' end),
    ('repair_audit_present', 'repair',
      case when j.visual_repair_artifact_path is not null then 'pass' else 'fail' end,
      case when j.visual_repair_artifact_path is not null then 'Repair audit exists.' else 'Repair audit is missing.' end),
    ('repair_status_acceptable', 'repair',
      case when j.repair_status = 'completed' then 'pass' when j.repair_status = 'skipped' then 'warning' when j.repair_status = 'failed' then 'fail' else 'blocked' end,
      case when j.repair_status = 'completed' then 'Repair completed.' when j.repair_status = 'skipped' then 'Repair skipped safely or had no eligible pages.' when j.repair_status = 'failed' then 'Repair failed.' else 'Repair status missing or unknown.' end),
    ('repair_final_score_threshold', 'repair',
      case when j.repair_status = 'skipped' then 'warning' when j.repair_final_score is null then 'warning' when j.repair_final_score >= j.repair_min then 'pass' else 'fail' end,
      case when j.repair_status = 'skipped' then 'Repair skipped; final score threshold not enforced.' when j.repair_final_score is null then 'Repair final score is missing.' when j.repair_final_score >= j.repair_min then 'Repair final score meets registry threshold.' else 'Repair final score is below registry threshold.' end),
    ('manual_review_policy', 'visual_quality',
      case when coalesce(j.visual_quality_manual_review_required, false) = false and coalesce(j.repair_requires_manual_review, false) = false then 'pass' when j.manual_review_allowed = true then 'warning' else 'fail' end,
      case when coalesce(j.visual_quality_manual_review_required, false) = false and coalesce(j.repair_requires_manual_review, false) = false then 'Manual review not required.' when j.manual_review_allowed = true then 'Manual review required and allowed by registry.' else 'Manual review required but not allowed by registry.' end),
    ('fallback_policy', 'repair',
      case when coalesce(j.repair_requires_fallback, false) = false then 'pass' when j.fallback_allowed = true then 'warning' else 'fail' end,
      case when coalesce(j.repair_requires_fallback, false) = false then 'Fallback not required.' when j.fallback_allowed = true then 'Fallback required and allowed by registry.' else 'Fallback required but not allowed by registry.' end),
    ('ai_reconciliation_policy', 'ai_reconciliation',
      case when j.ai_reconciliation_status = 'completed' then 'pass' when j.ai_reconciliation_status = 'failed' then 'warning' when j.ai_reconciliation_recommendation in ('recommended', 'manual_review') then 'warning' when j.ai_reconciliation_recommendation = 'not_needed' then 'pass' else 'not_evaluated' end,
      case when j.ai_reconciliation_status = 'completed' then 'AI reconciliation completed.' when j.ai_reconciliation_status = 'failed' then 'AI reconciliation failed but is non-blocking in Phase 8C.' when j.ai_reconciliation_recommendation in ('recommended', 'manual_review') then 'AI reconciliation was recommended but not completed.' when j.ai_reconciliation_recommendation = 'not_needed' then 'AI reconciliation not needed.' else 'AI reconciliation was not evaluated.' end),
    ('export_parity_artifact_present', 'export_parity',
      case when j.export_parity_artifact_path is not null then 'pass' else 'fail' end,
      case when j.export_parity_artifact_path is not null then 'Export parity artifact exists.' else 'Export parity artifact is missing.' end),
    ('export_parity_status_acceptable', 'export_parity',
      case when j.export_parity_status = 'completed' then 'pass' when j.export_parity_status = 'manual_required' then 'warning' when j.export_parity_status = 'failed' then 'fail' else 'blocked' end,
      case when j.export_parity_status = 'completed' then 'Export parity completed.' when j.export_parity_status = 'manual_required' then 'Export parity requires manual review.' when j.export_parity_status = 'failed' then 'Export parity failed.' else 'Export parity status missing or unknown.' end),
    ('export_parity_score_threshold', 'export_parity',
      case when coalesce(j.export_vs_source_score, j.editor_vs_source_score, j.export_vs_editor_score) is null then 'warning' when coalesce(j.export_vs_source_score, j.editor_vs_source_score, j.export_vs_editor_score) >= j.export_min then 'pass' else 'fail' end,
      case when coalesce(j.export_vs_source_score, j.editor_vs_source_score, j.export_vs_editor_score) is null and j.export_parity_status = 'manual_required' then 'Export parity score missing because manual review is required.' when coalesce(j.export_vs_source_score, j.editor_vs_source_score, j.export_vs_editor_score) is null then 'Export parity score is missing.' when coalesce(j.export_vs_source_score, j.editor_vs_source_score, j.export_vs_editor_score) >= j.export_min then 'Export parity score meets registry threshold.' else 'Export parity score is below registry threshold.' end),
    ('engine_version_present', 'diagnostics',
      case when j.engine_version is not null then 'pass' else 'warning' end,
      case when j.engine_version is not null then 'Engine version is present.' else 'Engine version is missing.' end)
  ) as x(gate_id, category, gate_status, message)
),
overall as (
  select
    corpus_id,
    import_id,
    count(*) as total_gates,
    count(*) filter (where gate_status = 'pass') as pass_count,
    count(*) filter (where gate_status = 'warning') as warning_count,
    count(*) filter (where gate_status = 'fail') as fail_count,
    count(*) filter (where gate_status = 'blocked') as blocked_count,
    count(*) filter (where gate_status = 'not_evaluated') as not_evaluated_count,
    case
      when count(*) filter (where gate_status = 'blocked') > 0 then 'blocked'
      when count(*) filter (where gate_status = 'fail') > 0 then 'fail'
      when count(*) filter (where gate_status = 'warning') > 0 then 'warning'
      when count(*) filter (where gate_status <> 'not_evaluated') = 0 then 'not_evaluated'
      else 'pass'
    end as overall_quality_gate_status
  from gate_rows
  group by corpus_id, import_id
)

-- ---------------------------------------------------------------------------
-- 2. Overall quality gate result per corpus run
-- ---------------------------------------------------------------------------
select
  o.corpus_id,
  j.category,
  j.source_filename,
  j.import_id,
  j.template_id,
  o.overall_quality_gate_status,
  o.total_gates,
  o.pass_count,
  o.warning_count,
  o.fail_count,
  o.blocked_count,
  o.not_evaluated_count
from overall o
left join joined j
  on j.corpus_id = o.corpus_id
 and (j.import_id = o.import_id or (j.import_id is null and o.import_id is null))
order by o.corpus_id;


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
    jsonb_array_length(coalesce(rt.schema->'pages', '[]'::jsonb)) as template_page_count,
    ti.meta->'import_manifests_summary'->>'engine_version' as engine_version,
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
    r.visual_min, r.repair_min, r.export_min, r.manual_review_allowed, r.fallback_allowed,
    ti.error, ti.updated_at
  from golden_runs gr
  left join registry r on r.corpus_id = gr.corpus_id
  left join public.template_imports ti on ti.id = nullif(gr.import_id, '')::uuid
  left join public.report_templates rt on rt.id = coalesce(nullif(gr.template_id, '')::uuid, ti.created_template_id)
),
gate_rows as (
  select j.corpus_id, j.import_id, x.gate_id, x.category, x.gate_status, x.message
  from joined j
  cross join lateral (values
    ('import_completed', 'import',
      case when j.mapped_import_id is null then 'not_evaluated' when j.import_id is null then 'fail' when j.import_status = 'completed' then 'pass' when j.import_status = 'failed' then 'fail' else 'blocked' end,
      case when j.mapped_import_id is null then 'Import ID is missing.' when j.import_id is null then 'Import record was not found.' when j.import_status = 'completed' then 'Import completed.' when j.import_status = 'failed' then 'Import failed.' else 'Import is not completed.' end),
    ('template_created', 'template',
      case when j.template_id is not null then 'pass' else 'fail' end,
      case when j.template_id is not null then 'Template exists.' else 'Template is missing.' end),
    ('template_page_count_match', 'template',
      case when j.import_page_count is null or j.template_page_count is null then 'blocked' when j.import_page_count = j.template_page_count then 'pass' else 'fail' end,
      case when j.import_page_count is null or j.template_page_count is null then 'Page count is unavailable.' when j.import_page_count = j.template_page_count then 'Template page count matches import page count.' else 'Template page count does not match import page count.' end),
    ('visual_quality_artifact_present', 'visual_quality',
      case when j.visual_quality_artifact_path is not null then 'pass' else 'fail' end,
      case when j.visual_quality_artifact_path is not null then 'Visual QA artifact exists.' else 'Visual QA artifact is missing.' end),
    ('visual_quality_score_threshold', 'visual_quality',
      case when j.visual_quality_score is null then 'warning' when j.visual_quality_score >= j.visual_min then 'pass' else 'fail' end,
      case when j.visual_quality_score is null then 'Visual QA score is missing.' when j.visual_quality_score >= j.visual_min then 'Visual QA score meets registry threshold.' else 'Visual QA score is below registry threshold.' end),
    ('repair_audit_present', 'repair',
      case when j.visual_repair_artifact_path is not null then 'pass' else 'fail' end,
      case when j.visual_repair_artifact_path is not null then 'Repair audit exists.' else 'Repair audit is missing.' end),
    ('repair_status_acceptable', 'repair',
      case when j.repair_status = 'completed' then 'pass' when j.repair_status = 'skipped' then 'warning' when j.repair_status = 'failed' then 'fail' else 'blocked' end,
      case when j.repair_status = 'completed' then 'Repair completed.' when j.repair_status = 'skipped' then 'Repair skipped safely or had no eligible pages.' when j.repair_status = 'failed' then 'Repair failed.' else 'Repair status missing or unknown.' end),
    ('repair_final_score_threshold', 'repair',
      case when j.repair_status = 'skipped' then 'warning' when j.repair_final_score is null then 'warning' when j.repair_final_score >= j.repair_min then 'pass' else 'fail' end,
      case when j.repair_status = 'skipped' then 'Repair skipped; final score threshold not enforced.' when j.repair_final_score is null then 'Repair final score is missing.' when j.repair_final_score >= j.repair_min then 'Repair final score meets registry threshold.' else 'Repair final score is below registry threshold.' end),
    ('manual_review_policy', 'visual_quality',
      case when coalesce(j.visual_quality_manual_review_required, false) = false and coalesce(j.repair_requires_manual_review, false) = false then 'pass' when j.manual_review_allowed = true then 'warning' else 'fail' end,
      case when coalesce(j.visual_quality_manual_review_required, false) = false and coalesce(j.repair_requires_manual_review, false) = false then 'Manual review not required.' when j.manual_review_allowed = true then 'Manual review required and allowed by registry.' else 'Manual review required but not allowed by registry.' end),
    ('fallback_policy', 'repair',
      case when coalesce(j.repair_requires_fallback, false) = false then 'pass' when j.fallback_allowed = true then 'warning' else 'fail' end,
      case when coalesce(j.repair_requires_fallback, false) = false then 'Fallback not required.' when j.fallback_allowed = true then 'Fallback required and allowed by registry.' else 'Fallback required but not allowed by registry.' end),
    ('ai_reconciliation_policy', 'ai_reconciliation',
      case when j.ai_reconciliation_status = 'completed' then 'pass' when j.ai_reconciliation_status = 'failed' then 'warning' when j.ai_reconciliation_recommendation in ('recommended', 'manual_review') then 'warning' when j.ai_reconciliation_recommendation = 'not_needed' then 'pass' else 'not_evaluated' end,
      case when j.ai_reconciliation_status = 'completed' then 'AI reconciliation completed.' when j.ai_reconciliation_status = 'failed' then 'AI reconciliation failed but is non-blocking in Phase 8C.' when j.ai_reconciliation_recommendation in ('recommended', 'manual_review') then 'AI reconciliation was recommended but not completed.' when j.ai_reconciliation_recommendation = 'not_needed' then 'AI reconciliation not needed.' else 'AI reconciliation was not evaluated.' end),
    ('export_parity_artifact_present', 'export_parity',
      case when j.export_parity_artifact_path is not null then 'pass' else 'fail' end,
      case when j.export_parity_artifact_path is not null then 'Export parity artifact exists.' else 'Export parity artifact is missing.' end),
    ('export_parity_status_acceptable', 'export_parity',
      case when j.export_parity_status = 'completed' then 'pass' when j.export_parity_status = 'manual_required' then 'warning' when j.export_parity_status = 'failed' then 'fail' else 'blocked' end,
      case when j.export_parity_status = 'completed' then 'Export parity completed.' when j.export_parity_status = 'manual_required' then 'Export parity requires manual review.' when j.export_parity_status = 'failed' then 'Export parity failed.' else 'Export parity status missing or unknown.' end),
    ('export_parity_score_threshold', 'export_parity',
      case when coalesce(j.export_vs_source_score, j.editor_vs_source_score, j.export_vs_editor_score) is null then 'warning' when coalesce(j.export_vs_source_score, j.editor_vs_source_score, j.export_vs_editor_score) >= j.export_min then 'pass' else 'fail' end,
      case when coalesce(j.export_vs_source_score, j.editor_vs_source_score, j.export_vs_editor_score) is null and j.export_parity_status = 'manual_required' then 'Export parity score missing because manual review is required.' when coalesce(j.export_vs_source_score, j.editor_vs_source_score, j.export_vs_editor_score) is null then 'Export parity score is missing.' when coalesce(j.export_vs_source_score, j.editor_vs_source_score, j.export_vs_editor_score) >= j.export_min then 'Export parity score meets registry threshold.' else 'Export parity score is below registry threshold.' end),
    ('engine_version_present', 'diagnostics',
      case when j.engine_version is not null then 'pass' else 'warning' end,
      case when j.engine_version is not null then 'Engine version is present.' else 'Engine version is missing.' end)
  ) as x(gate_id, category, gate_status, message)
),
overall as (
  select
    corpus_id,
    import_id,
    count(*) as total_gates,
    count(*) filter (where gate_status = 'pass') as pass_count,
    count(*) filter (where gate_status = 'warning') as warning_count,
    count(*) filter (where gate_status = 'fail') as fail_count,
    count(*) filter (where gate_status = 'blocked') as blocked_count,
    count(*) filter (where gate_status = 'not_evaluated') as not_evaluated_count,
    case
      when count(*) filter (where gate_status = 'blocked') > 0 then 'blocked'
      when count(*) filter (where gate_status = 'fail') > 0 then 'fail'
      when count(*) filter (where gate_status = 'warning') > 0 then 'warning'
      when count(*) filter (where gate_status <> 'not_evaluated') = 0 then 'not_evaluated'
      else 'pass'
    end as overall_quality_gate_status
  from gate_rows
  group by corpus_id, import_id
)

-- ---------------------------------------------------------------------------
-- 3. Blocking/failing gates only
-- ---------------------------------------------------------------------------
select
  gr.corpus_id,
  j.source_filename,
  gr.gate_id,
  gr.category as gate_category,
  gr.gate_status,
  gr.message,
  j.import_id,
  j.template_id
from gate_rows gr
left join joined j
  on j.corpus_id = gr.corpus_id
 and (j.import_id = gr.import_id or (j.import_id is null and gr.import_id is null))
where gr.gate_status in ('fail', 'blocked')
order by gr.corpus_id, gr.gate_id;


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
    jsonb_array_length(coalesce(rt.schema->'pages', '[]'::jsonb)) as template_page_count,
    ti.meta->'import_manifests_summary'->>'engine_version' as engine_version,
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
    r.visual_min, r.repair_min, r.export_min, r.manual_review_allowed, r.fallback_allowed,
    ti.error, ti.updated_at
  from golden_runs gr
  left join registry r on r.corpus_id = gr.corpus_id
  left join public.template_imports ti on ti.id = nullif(gr.import_id, '')::uuid
  left join public.report_templates rt on rt.id = coalesce(nullif(gr.template_id, '')::uuid, ti.created_template_id)
),
gate_rows as (
  select j.corpus_id, j.import_id, x.gate_id, x.category, x.gate_status, x.message
  from joined j
  cross join lateral (values
    ('import_completed', 'import',
      case when j.mapped_import_id is null then 'not_evaluated' when j.import_id is null then 'fail' when j.import_status = 'completed' then 'pass' when j.import_status = 'failed' then 'fail' else 'blocked' end,
      case when j.mapped_import_id is null then 'Import ID is missing.' when j.import_id is null then 'Import record was not found.' when j.import_status = 'completed' then 'Import completed.' when j.import_status = 'failed' then 'Import failed.' else 'Import is not completed.' end),
    ('template_created', 'template',
      case when j.template_id is not null then 'pass' else 'fail' end,
      case when j.template_id is not null then 'Template exists.' else 'Template is missing.' end),
    ('template_page_count_match', 'template',
      case when j.import_page_count is null or j.template_page_count is null then 'blocked' when j.import_page_count = j.template_page_count then 'pass' else 'fail' end,
      case when j.import_page_count is null or j.template_page_count is null then 'Page count is unavailable.' when j.import_page_count = j.template_page_count then 'Template page count matches import page count.' else 'Template page count does not match import page count.' end),
    ('visual_quality_artifact_present', 'visual_quality',
      case when j.visual_quality_artifact_path is not null then 'pass' else 'fail' end,
      case when j.visual_quality_artifact_path is not null then 'Visual QA artifact exists.' else 'Visual QA artifact is missing.' end),
    ('visual_quality_score_threshold', 'visual_quality',
      case when j.visual_quality_score is null then 'warning' when j.visual_quality_score >= j.visual_min then 'pass' else 'fail' end,
      case when j.visual_quality_score is null then 'Visual QA score is missing.' when j.visual_quality_score >= j.visual_min then 'Visual QA score meets registry threshold.' else 'Visual QA score is below registry threshold.' end),
    ('repair_audit_present', 'repair',
      case when j.visual_repair_artifact_path is not null then 'pass' else 'fail' end,
      case when j.visual_repair_artifact_path is not null then 'Repair audit exists.' else 'Repair audit is missing.' end),
    ('repair_status_acceptable', 'repair',
      case when j.repair_status = 'completed' then 'pass' when j.repair_status = 'skipped' then 'warning' when j.repair_status = 'failed' then 'fail' else 'blocked' end,
      case when j.repair_status = 'completed' then 'Repair completed.' when j.repair_status = 'skipped' then 'Repair skipped safely or had no eligible pages.' when j.repair_status = 'failed' then 'Repair failed.' else 'Repair status missing or unknown.' end),
    ('repair_final_score_threshold', 'repair',
      case when j.repair_status = 'skipped' then 'warning' when j.repair_final_score is null then 'warning' when j.repair_final_score >= j.repair_min then 'pass' else 'fail' end,
      case when j.repair_status = 'skipped' then 'Repair skipped; final score threshold not enforced.' when j.repair_final_score is null then 'Repair final score is missing.' when j.repair_final_score >= j.repair_min then 'Repair final score meets registry threshold.' else 'Repair final score is below registry threshold.' end),
    ('manual_review_policy', 'visual_quality',
      case when coalesce(j.visual_quality_manual_review_required, false) = false and coalesce(j.repair_requires_manual_review, false) = false then 'pass' when j.manual_review_allowed = true then 'warning' else 'fail' end,
      case when coalesce(j.visual_quality_manual_review_required, false) = false and coalesce(j.repair_requires_manual_review, false) = false then 'Manual review not required.' when j.manual_review_allowed = true then 'Manual review required and allowed by registry.' else 'Manual review required but not allowed by registry.' end),
    ('fallback_policy', 'repair',
      case when coalesce(j.repair_requires_fallback, false) = false then 'pass' when j.fallback_allowed = true then 'warning' else 'fail' end,
      case when coalesce(j.repair_requires_fallback, false) = false then 'Fallback not required.' when j.fallback_allowed = true then 'Fallback required and allowed by registry.' else 'Fallback required but not allowed by registry.' end),
    ('ai_reconciliation_policy', 'ai_reconciliation',
      case when j.ai_reconciliation_status = 'completed' then 'pass' when j.ai_reconciliation_status = 'failed' then 'warning' when j.ai_reconciliation_recommendation in ('recommended', 'manual_review') then 'warning' when j.ai_reconciliation_recommendation = 'not_needed' then 'pass' else 'not_evaluated' end,
      case when j.ai_reconciliation_status = 'completed' then 'AI reconciliation completed.' when j.ai_reconciliation_status = 'failed' then 'AI reconciliation failed but is non-blocking in Phase 8C.' when j.ai_reconciliation_recommendation in ('recommended', 'manual_review') then 'AI reconciliation was recommended but not completed.' when j.ai_reconciliation_recommendation = 'not_needed' then 'AI reconciliation not needed.' else 'AI reconciliation was not evaluated.' end),
    ('export_parity_artifact_present', 'export_parity',
      case when j.export_parity_artifact_path is not null then 'pass' else 'fail' end,
      case when j.export_parity_artifact_path is not null then 'Export parity artifact exists.' else 'Export parity artifact is missing.' end),
    ('export_parity_status_acceptable', 'export_parity',
      case when j.export_parity_status = 'completed' then 'pass' when j.export_parity_status = 'manual_required' then 'warning' when j.export_parity_status = 'failed' then 'fail' else 'blocked' end,
      case when j.export_parity_status = 'completed' then 'Export parity completed.' when j.export_parity_status = 'manual_required' then 'Export parity requires manual review.' when j.export_parity_status = 'failed' then 'Export parity failed.' else 'Export parity status missing or unknown.' end),
    ('export_parity_score_threshold', 'export_parity',
      case when coalesce(j.export_vs_source_score, j.editor_vs_source_score, j.export_vs_editor_score) is null then 'warning' when coalesce(j.export_vs_source_score, j.editor_vs_source_score, j.export_vs_editor_score) >= j.export_min then 'pass' else 'fail' end,
      case when coalesce(j.export_vs_source_score, j.editor_vs_source_score, j.export_vs_editor_score) is null and j.export_parity_status = 'manual_required' then 'Export parity score missing because manual review is required.' when coalesce(j.export_vs_source_score, j.editor_vs_source_score, j.export_vs_editor_score) is null then 'Export parity score is missing.' when coalesce(j.export_vs_source_score, j.editor_vs_source_score, j.export_vs_editor_score) >= j.export_min then 'Export parity score meets registry threshold.' else 'Export parity score is below registry threshold.' end),
    ('engine_version_present', 'diagnostics',
      case when j.engine_version is not null then 'pass' else 'warning' end,
      case when j.engine_version is not null then 'Engine version is present.' else 'Engine version is missing.' end)
  ) as x(gate_id, category, gate_status, message)
),
overall as (
  select
    corpus_id,
    import_id,
    count(*) as total_gates,
    count(*) filter (where gate_status = 'pass') as pass_count,
    count(*) filter (where gate_status = 'warning') as warning_count,
    count(*) filter (where gate_status = 'fail') as fail_count,
    count(*) filter (where gate_status = 'blocked') as blocked_count,
    count(*) filter (where gate_status = 'not_evaluated') as not_evaluated_count,
    case
      when count(*) filter (where gate_status = 'blocked') > 0 then 'blocked'
      when count(*) filter (where gate_status = 'fail') > 0 then 'fail'
      when count(*) filter (where gate_status = 'warning') > 0 then 'warning'
      when count(*) filter (where gate_status <> 'not_evaluated') = 0 then 'not_evaluated'
      else 'pass'
    end as overall_quality_gate_status
  from gate_rows
  group by corpus_id, import_id
)

-- ---------------------------------------------------------------------------
-- 4. Warning gates only
-- ---------------------------------------------------------------------------
select
  gr.corpus_id,
  j.source_filename,
  gr.gate_id,
  gr.category as gate_category,
  gr.gate_status,
  gr.message,
  j.import_id,
  j.template_id
from gate_rows gr
left join joined j
  on j.corpus_id = gr.corpus_id
 and (j.import_id = gr.import_id or (j.import_id is null and gr.import_id is null))
where gr.gate_status = 'warning'
order by gr.corpus_id, gr.gate_id;


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
    jsonb_array_length(coalesce(rt.schema->'pages', '[]'::jsonb)) as template_page_count,
    ti.meta->'import_manifests_summary'->>'engine_version' as engine_version,
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
    r.visual_min, r.repair_min, r.export_min, r.manual_review_allowed, r.fallback_allowed,
    ti.error, ti.updated_at
  from golden_runs gr
  left join registry r on r.corpus_id = gr.corpus_id
  left join public.template_imports ti on ti.id = nullif(gr.import_id, '')::uuid
  left join public.report_templates rt on rt.id = coalesce(nullif(gr.template_id, '')::uuid, ti.created_template_id)
),
gate_rows as (
  select j.corpus_id, j.import_id, x.gate_id, x.category, x.gate_status, x.message
  from joined j
  cross join lateral (values
    ('import_completed', 'import',
      case when j.mapped_import_id is null then 'not_evaluated' when j.import_id is null then 'fail' when j.import_status = 'completed' then 'pass' when j.import_status = 'failed' then 'fail' else 'blocked' end,
      case when j.mapped_import_id is null then 'Import ID is missing.' when j.import_id is null then 'Import record was not found.' when j.import_status = 'completed' then 'Import completed.' when j.import_status = 'failed' then 'Import failed.' else 'Import is not completed.' end),
    ('template_created', 'template',
      case when j.template_id is not null then 'pass' else 'fail' end,
      case when j.template_id is not null then 'Template exists.' else 'Template is missing.' end),
    ('template_page_count_match', 'template',
      case when j.import_page_count is null or j.template_page_count is null then 'blocked' when j.import_page_count = j.template_page_count then 'pass' else 'fail' end,
      case when j.import_page_count is null or j.template_page_count is null then 'Page count is unavailable.' when j.import_page_count = j.template_page_count then 'Template page count matches import page count.' else 'Template page count does not match import page count.' end),
    ('visual_quality_artifact_present', 'visual_quality',
      case when j.visual_quality_artifact_path is not null then 'pass' else 'fail' end,
      case when j.visual_quality_artifact_path is not null then 'Visual QA artifact exists.' else 'Visual QA artifact is missing.' end),
    ('visual_quality_score_threshold', 'visual_quality',
      case when j.visual_quality_score is null then 'warning' when j.visual_quality_score >= j.visual_min then 'pass' else 'fail' end,
      case when j.visual_quality_score is null then 'Visual QA score is missing.' when j.visual_quality_score >= j.visual_min then 'Visual QA score meets registry threshold.' else 'Visual QA score is below registry threshold.' end),
    ('repair_audit_present', 'repair',
      case when j.visual_repair_artifact_path is not null then 'pass' else 'fail' end,
      case when j.visual_repair_artifact_path is not null then 'Repair audit exists.' else 'Repair audit is missing.' end),
    ('repair_status_acceptable', 'repair',
      case when j.repair_status = 'completed' then 'pass' when j.repair_status = 'skipped' then 'warning' when j.repair_status = 'failed' then 'fail' else 'blocked' end,
      case when j.repair_status = 'completed' then 'Repair completed.' when j.repair_status = 'skipped' then 'Repair skipped safely or had no eligible pages.' when j.repair_status = 'failed' then 'Repair failed.' else 'Repair status missing or unknown.' end),
    ('repair_final_score_threshold', 'repair',
      case when j.repair_status = 'skipped' then 'warning' when j.repair_final_score is null then 'warning' when j.repair_final_score >= j.repair_min then 'pass' else 'fail' end,
      case when j.repair_status = 'skipped' then 'Repair skipped; final score threshold not enforced.' when j.repair_final_score is null then 'Repair final score is missing.' when j.repair_final_score >= j.repair_min then 'Repair final score meets registry threshold.' else 'Repair final score is below registry threshold.' end),
    ('manual_review_policy', 'visual_quality',
      case when coalesce(j.visual_quality_manual_review_required, false) = false and coalesce(j.repair_requires_manual_review, false) = false then 'pass' when j.manual_review_allowed = true then 'warning' else 'fail' end,
      case when coalesce(j.visual_quality_manual_review_required, false) = false and coalesce(j.repair_requires_manual_review, false) = false then 'Manual review not required.' when j.manual_review_allowed = true then 'Manual review required and allowed by registry.' else 'Manual review required but not allowed by registry.' end),
    ('fallback_policy', 'repair',
      case when coalesce(j.repair_requires_fallback, false) = false then 'pass' when j.fallback_allowed = true then 'warning' else 'fail' end,
      case when coalesce(j.repair_requires_fallback, false) = false then 'Fallback not required.' when j.fallback_allowed = true then 'Fallback required and allowed by registry.' else 'Fallback required but not allowed by registry.' end),
    ('ai_reconciliation_policy', 'ai_reconciliation',
      case when j.ai_reconciliation_status = 'completed' then 'pass' when j.ai_reconciliation_status = 'failed' then 'warning' when j.ai_reconciliation_recommendation in ('recommended', 'manual_review') then 'warning' when j.ai_reconciliation_recommendation = 'not_needed' then 'pass' else 'not_evaluated' end,
      case when j.ai_reconciliation_status = 'completed' then 'AI reconciliation completed.' when j.ai_reconciliation_status = 'failed' then 'AI reconciliation failed but is non-blocking in Phase 8C.' when j.ai_reconciliation_recommendation in ('recommended', 'manual_review') then 'AI reconciliation was recommended but not completed.' when j.ai_reconciliation_recommendation = 'not_needed' then 'AI reconciliation not needed.' else 'AI reconciliation was not evaluated.' end),
    ('export_parity_artifact_present', 'export_parity',
      case when j.export_parity_artifact_path is not null then 'pass' else 'fail' end,
      case when j.export_parity_artifact_path is not null then 'Export parity artifact exists.' else 'Export parity artifact is missing.' end),
    ('export_parity_status_acceptable', 'export_parity',
      case when j.export_parity_status = 'completed' then 'pass' when j.export_parity_status = 'manual_required' then 'warning' when j.export_parity_status = 'failed' then 'fail' else 'blocked' end,
      case when j.export_parity_status = 'completed' then 'Export parity completed.' when j.export_parity_status = 'manual_required' then 'Export parity requires manual review.' when j.export_parity_status = 'failed' then 'Export parity failed.' else 'Export parity status missing or unknown.' end),
    ('export_parity_score_threshold', 'export_parity',
      case when coalesce(j.export_vs_source_score, j.editor_vs_source_score, j.export_vs_editor_score) is null then 'warning' when coalesce(j.export_vs_source_score, j.editor_vs_source_score, j.export_vs_editor_score) >= j.export_min then 'pass' else 'fail' end,
      case when coalesce(j.export_vs_source_score, j.editor_vs_source_score, j.export_vs_editor_score) is null and j.export_parity_status = 'manual_required' then 'Export parity score missing because manual review is required.' when coalesce(j.export_vs_source_score, j.editor_vs_source_score, j.export_vs_editor_score) is null then 'Export parity score is missing.' when coalesce(j.export_vs_source_score, j.editor_vs_source_score, j.export_vs_editor_score) >= j.export_min then 'Export parity score meets registry threshold.' else 'Export parity score is below registry threshold.' end),
    ('engine_version_present', 'diagnostics',
      case when j.engine_version is not null then 'pass' else 'warning' end,
      case when j.engine_version is not null then 'Engine version is present.' else 'Engine version is missing.' end)
  ) as x(gate_id, category, gate_status, message)
),
overall as (
  select
    corpus_id,
    import_id,
    count(*) as total_gates,
    count(*) filter (where gate_status = 'pass') as pass_count,
    count(*) filter (where gate_status = 'warning') as warning_count,
    count(*) filter (where gate_status = 'fail') as fail_count,
    count(*) filter (where gate_status = 'blocked') as blocked_count,
    count(*) filter (where gate_status = 'not_evaluated') as not_evaluated_count,
    case
      when count(*) filter (where gate_status = 'blocked') > 0 then 'blocked'
      when count(*) filter (where gate_status = 'fail') > 0 then 'fail'
      when count(*) filter (where gate_status = 'warning') > 0 then 'warning'
      when count(*) filter (where gate_status <> 'not_evaluated') = 0 then 'not_evaluated'
      else 'pass'
    end as overall_quality_gate_status
  from gate_rows
  group by corpus_id, import_id
)

-- ---------------------------------------------------------------------------
-- 5. Summary counts
-- ---------------------------------------------------------------------------
select
  count(*) as total_corpus_slots,
  count(*) filter (where overall_quality_gate_status = 'pass') as pass_count,
  count(*) filter (where overall_quality_gate_status = 'warning') as warning_count,
  count(*) filter (where overall_quality_gate_status = 'fail') as fail_count,
  count(*) filter (where overall_quality_gate_status = 'blocked') as blocked_count,
  count(*) filter (where overall_quality_gate_status = 'not_evaluated') as not_evaluated_count
from overall;


-- ---------------------------------------------------------------------------
-- 6. Phase 8C note
-- ---------------------------------------------------------------------------
select
  'phase_8c_quality_gates_only' as phase,
  'This SQL evaluates quality gates for operator-supplied golden corpus import IDs. It does not persist results; persistence belongs to Phase 8D.' as note;
