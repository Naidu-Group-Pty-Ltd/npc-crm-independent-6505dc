-- Phase 8E Diagnostics Dashboard Check
-- Run in Supabase SQL Editor.
--
-- Purpose:
-- Validate Template Import Quality dashboard data for Visual QA, Repair,
-- AI reconciliation, Export Parity, and Golden Regression status.

-- ---------------------------------------------------------------------------
-- 1. Dashboard source rows with golden regression state
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.status,
  ti.source_filename,
  ti.page_count,
  ti.created_template_id as template_id,

  ti.meta->'visual_quality_summary'->>'overallScore' as visual_quality_score,
  ti.meta->'visual_quality_summary'->>'manualReviewRequired' as visual_manual_review,

  ti.meta->'visual_repair_summary'->>'repairStatus' as repair_status,
  ti.meta->'visual_repair_summary'->>'finalScore' as repair_final_score,
  ti.meta->'visual_repair_summary'->>'requiresFallback' as repair_requires_fallback,
  ti.meta->'visual_repair_summary'->>'requiresManualReview' as repair_manual_review,

  ti.meta->'ai_reconciliation_summary'->>'status' as ai_status,
  ti.meta->'ai_reconciliation_summary'->>'recommendation' as ai_recommendation,

  ti.meta->'export_parity_summary'->>'status' as export_status,
  ti.meta->'export_parity_summary'->>'mode' as export_mode,
  ti.meta->'export_parity_summary'->>'exportVsSourceScore' as export_vs_source_score,

  ti.meta->'golden_regression_summary'->>'corpusId' as golden_corpus_id,
  ti.meta->'golden_regression_summary'->>'category' as golden_category,
  ti.meta->'golden_regression_summary'->>'qualityGateStatus' as golden_quality_status,
  ti.meta->'golden_regression_summary'->>'operatorDecision' as golden_operator_decision,
  jsonb_array_length(coalesce(ti.meta->'golden_regression_summary'->'warnings', '[]'::jsonb)) as golden_warning_count,
  jsonb_array_length(coalesce(ti.meta->'golden_regression_summary'->'failures', '[]'::jsonb)) as golden_failure_count,
  ti.meta->'golden_regression_summary'->>'persistedAt' as golden_persisted_at,

  case
    when not (ti.meta ? 'golden_regression_summary') then 'not_run'
    when ti.meta->'golden_regression_summary'->>'qualityGateStatus' = 'pass'
      and ti.meta->'golden_regression_summary'->>'operatorDecision' = 'accepted' then 'none'
    when ti.meta->'golden_regression_summary'->>'qualityGateStatus' in ('warning', 'not_evaluated') then 'review'
    when ti.meta->'golden_regression_summary'->>'qualityGateStatus' = 'blocked' then 'rerun'
    when ti.meta->'golden_regression_summary'->>'qualityGateStatus' = 'fail' then 'fix'
    when ti.meta->'golden_regression_summary'->>'operatorDecision' in ('needs_rerun', 'not_reviewed') then 'rerun'
    when ti.meta->'golden_regression_summary'->>'operatorDecision' = 'rejected' then 'fix'
    else 'review'
  end as action_required,

  ti.updated_at
from public.template_imports ti
order by ti.updated_at desc
limit 80;

-- ---------------------------------------------------------------------------
-- 2. Golden regression dashboard summary counts
-- ---------------------------------------------------------------------------
select
  count(*) filter (where meta ? 'golden_regression_summary') as golden_total,
  count(*) filter (where meta->'golden_regression_summary'->>'qualityGateStatus' = 'pass') as golden_pass,
  count(*) filter (where meta->'golden_regression_summary'->>'qualityGateStatus' = 'warning') as golden_warning,
  count(*) filter (where meta->'golden_regression_summary'->>'qualityGateStatus' = 'fail') as golden_fail,
  count(*) filter (where meta->'golden_regression_summary'->>'qualityGateStatus' = 'blocked') as golden_blocked,
  count(*) filter (where meta->'golden_regression_summary'->>'qualityGateStatus' = 'not_evaluated') as golden_not_evaluated,
  count(*) filter (
    where meta ? 'golden_regression_summary'
      and (
        meta->'golden_regression_summary'->>'qualityGateStatus' in ('warning', 'fail', 'blocked', 'not_evaluated')
        or meta->'golden_regression_summary'->>'operatorDecision' in ('rejected', 'needs_rerun', 'not_reviewed')
        or jsonb_array_length(coalesce(meta->'golden_regression_summary'->'warnings', '[]'::jsonb)) > 0
        or jsonb_array_length(coalesce(meta->'golden_regression_summary'->'failures', '[]'::jsonb)) > 0
      )
  ) as golden_needs_review
from public.template_imports;

-- ---------------------------------------------------------------------------
-- 3. Rows requiring operator attention
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
  ti.meta->'golden_regression_summary'->'warnings' as warnings,
  ti.meta->'golden_regression_summary'->'failures' as failures,
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
-- 4. Imports with Phase 7 quality metadata but no golden regression summary
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.created_template_id as template_id,
  ti.page_count,
  ti.meta->>'visual_quality_artifact_path' as visual_quality_artifact_path,
  ti.meta->>'visual_repair_artifact_path' as visual_repair_artifact_path,
  ti.meta->>'export_parity_artifact_path' as export_parity_artifact_path,
  ti.updated_at
from public.template_imports ti
where ti.status = 'completed'
  and ti.meta->>'visual_quality_artifact_path' is not null
  and ti.meta->>'visual_repair_artifact_path' is not null
  and not (ti.meta ? 'golden_regression_summary')
order by ti.updated_at desc
limit 80;

-- ---------------------------------------------------------------------------
-- 5. Phase 8E note
-- ---------------------------------------------------------------------------
select
  'phase_8e_diagnostics_dashboard' as phase,
  'Dashboard should surface golden regression quality gate status, warnings, failures, and action-required state.' as note;
