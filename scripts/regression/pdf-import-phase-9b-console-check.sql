-- Phase 9B Operator Golden Regression Console Check
-- Run in Supabase SQL Editor.
--
-- Purpose:
-- Validate imports that can be used with the Phase 9B operator console.
--
-- This SQL is read-only.
-- The console itself uses the Phase 9A orchestrator to evaluate and optionally
-- persist golden_regression_summary.

-- ---------------------------------------------------------------------------
-- 1. Recent imports suitable for console selection
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.status as import_status,
  ti.source_filename,
  ti.page_count as import_page_count,
  ti.created_template_id as template_id,

  ti.meta->'import_manifests_summary'->>'engine_version' as engine_version,

  ti.meta->>'visual_quality_artifact_path' as visual_quality_artifact_path,
  ti.meta->'visual_quality_summary'->>'overallScore' as visual_quality_score,
  ti.meta->'visual_quality_summary'->>'manualReviewRequired' as visual_quality_manual_review_required,

  ti.meta->>'visual_repair_artifact_path' as visual_repair_artifact_path,
  ti.meta->'visual_repair_summary'->>'repairStatus' as repair_status,
  ti.meta->'visual_repair_summary'->>'finalScore' as repair_final_score,

  ti.meta->>'export_parity_artifact_path' as export_parity_artifact_path,
  ti.meta->'export_parity_summary'->>'status' as export_parity_status,
  ti.meta->'export_parity_summary'->>'exportVsSourceScore' as export_vs_source_score,

  ti.meta->'golden_regression_summary'->>'corpusId' as golden_corpus_id,
  ti.meta->'golden_regression_summary'->>'qualityGateStatus' as golden_quality_gate_status,
  ti.meta->'golden_regression_summary'->>'operatorDecision' as golden_operator_decision,
  ti.meta->'golden_regression_summary'->>'persistedAt' as golden_persisted_at,

  case
    when ti.status <> 'completed' then 'blocked_import_not_completed'
    when ti.created_template_id is null then 'blocked_template_missing'
    when ti.meta->>'visual_quality_artifact_path' is null then 'console_can_run_but_visual_quality_missing_will_fail_gate'
    when ti.meta->>'visual_repair_artifact_path' is null then 'console_can_run_but_repair_missing_will_fail_gate'
    when ti.meta->>'export_parity_artifact_path' is null then 'console_can_run_but_export_parity_missing_will_fail_gate'
    when ti.meta ? 'golden_regression_summary' then 'already_has_golden_summary'
    else 'ready_for_console_evaluate_and_persist'
  end as console_readiness,

  ti.updated_at
from public.template_imports ti
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 2. Best candidates for operator console test
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.created_template_id as template_id,
  ti.page_count,
  ti.meta->'visual_quality_summary'->>'overallScore' as visual_quality_score,
  ti.meta->'visual_repair_summary'->>'repairStatus' as repair_status,
  ti.meta->'visual_repair_summary'->>'finalScore' as repair_final_score,
  ti.meta->'export_parity_summary'->>'status' as export_parity_status,
  ti.meta->'export_parity_summary'->>'exportVsSourceScore' as export_vs_source_score,
  case
    when ti.meta ? 'golden_regression_summary' then 'has_existing_summary'
    else 'ready_no_summary'
  end as golden_summary_state,
  ti.updated_at
from public.template_imports ti
where ti.status = 'completed'
  and ti.created_template_id is not null
  and ti.meta->>'visual_quality_artifact_path' is not null
  and ti.meta->>'visual_repair_artifact_path' is not null
  and ti.meta->>'export_parity_artifact_path' is not null
order by ti.updated_at desc
limit 50;

-- ---------------------------------------------------------------------------
-- 3. Existing golden summaries created or updated through console/orchestrator
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.created_template_id as template_id,
  ti.meta->'golden_regression_summary'->>'version' as version,
  ti.meta->'golden_regression_summary'->>'runId' as run_id,
  ti.meta->'golden_regression_summary'->>'runBatchId' as run_batch_id,
  ti.meta->'golden_regression_summary'->>'corpusId' as corpus_id,
  ti.meta->'golden_regression_summary'->>'qualityGateStatus' as quality_gate_status,
  ti.meta->'golden_regression_summary'->>'operatorDecision' as operator_decision,
  jsonb_array_length(coalesce(ti.meta->'golden_regression_summary'->'warnings', '[]'::jsonb)) as warning_count,
  jsonb_array_length(coalesce(ti.meta->'golden_regression_summary'->'failures', '[]'::jsonb)) as failure_count,
  ti.meta->'golden_regression_summary'->>'generatedAt' as generated_at,
  ti.meta->'golden_regression_summary'->>'persistedAt' as persisted_at,
  ti.updated_at
from public.template_imports ti
where ti.meta ? 'golden_regression_summary'
order by ti.updated_at desc
limit 80;

-- ---------------------------------------------------------------------------
-- 4. Rows needing operator action
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.created_template_id as template_id,
  ti.meta->'golden_regression_summary'->>'corpusId' as corpus_id,
  ti.meta->'golden_regression_summary'->>'qualityGateStatus' as quality_gate_status,
  ti.meta->'golden_regression_summary'->>'operatorDecision' as operator_decision,
  jsonb_array_length(coalesce(ti.meta->'golden_regression_summary'->'warnings', '[]'::jsonb)) as warning_count,
  jsonb_array_length(coalesce(ti.meta->'golden_regression_summary'->'failures', '[]'::jsonb)) as failure_count,
  case
    when not (ti.meta ? 'golden_regression_summary') then 'not_run'
    when ti.meta->'golden_regression_summary'->>'qualityGateStatus' = 'pass'
      and ti.meta->'golden_regression_summary'->>'operatorDecision' = 'accepted' then 'none'
    when ti.meta->'golden_regression_summary'->>'qualityGateStatus' = 'warning' then 'review'
    when ti.meta->'golden_regression_summary'->>'qualityGateStatus' = 'blocked' then 'rerun'
    when ti.meta->'golden_regression_summary'->>'qualityGateStatus' = 'fail' then 'fix'
    when ti.meta->'golden_regression_summary'->>'operatorDecision' in ('needs_rerun', 'not_reviewed') then 'rerun'
    when ti.meta->'golden_regression_summary'->>'operatorDecision' = 'rejected' then 'fix'
    else 'review'
  end as operator_action_required,
  ti.updated_at
from public.template_imports ti
where ti.meta ? 'golden_regression_summary'
  and (
    ti.meta->'golden_regression_summary'->>'qualityGateStatus' in ('warning', 'fail', 'blocked', 'not_evaluated')
    or ti.meta->'golden_regression_summary'->>'operatorDecision' in ('rejected', 'needs_rerun', 'not_reviewed')
    or jsonb_array_length(coalesce(ti.meta->'golden_regression_summary'->'warnings', '[]'::jsonb)) > 0
    or jsonb_array_length(coalesce(ti.meta->'golden_regression_summary'->'failures', '[]'::jsonb)) > 0
  )
order by ti.updated_at desc
limit 80;

-- ---------------------------------------------------------------------------
-- 5. Console summary counts
-- ---------------------------------------------------------------------------
select
  count(*) as total_imports,
  count(*) filter (where status = 'completed') as completed_imports,
  count(*) filter (
    where status = 'completed'
      and created_template_id is not null
      and meta->>'visual_quality_artifact_path' is not null
      and meta->>'visual_repair_artifact_path' is not null
      and meta->>'export_parity_artifact_path' is not null
  ) as ready_for_clean_console_run,
  count(*) filter (where meta ? 'golden_regression_summary') as imports_with_golden_summary,
  count(*) filter (where meta->'golden_regression_summary'->>'qualityGateStatus' = 'pass') as golden_pass,
  count(*) filter (where meta->'golden_regression_summary'->>'qualityGateStatus' = 'warning') as golden_warning,
  count(*) filter (where meta->'golden_regression_summary'->>'qualityGateStatus' = 'fail') as golden_fail,
  count(*) filter (where meta->'golden_regression_summary'->>'qualityGateStatus' = 'blocked') as golden_blocked
from public.template_imports;

-- ---------------------------------------------------------------------------
-- 6. Phase 9B note
-- ---------------------------------------------------------------------------
select
  'phase_9b_operator_console' as phase,
  'Use the listed import_id/template_id values in /admin/pdf-golden-regression. This SQL is read-only and does not run the orchestrator.' as note;
