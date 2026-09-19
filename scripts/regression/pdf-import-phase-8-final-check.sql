-- Phase 8 Final Regression Check
-- Run in Supabase SQL Editor after Phase 8A–8F are complete.
--
-- This SQL is read-only.
--
-- It validates:
-- - recent import quality state
-- - golden regression summaries
-- - quality gate status distribution
-- - diagnostics dashboard readiness
-- - failure triage source conditions
-- - Phase 8 lock readiness

-- ---------------------------------------------------------------------------
-- 1. Latest imports with full Phase 7/8 metadata
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.status,
  ti.source_filename,
  ti.page_count,
  ti.created_template_id as template_id,

  ti.meta->'import_manifests_summary'->>'engine_version' as engine_version,
  ti.meta->'import_manifests_summary'->>'job_id' as pdf_job_id,

  ti.meta->>'visual_quality_artifact_path' as visual_quality_artifact_path,
  ti.meta->'visual_quality_summary'->>'overallScore' as visual_quality_score,
  ti.meta->'visual_quality_summary'->>'manualReviewRequired' as visual_quality_manual_review_required,

  ti.meta->>'visual_repair_artifact_path' as visual_repair_artifact_path,
  ti.meta->'visual_repair_summary'->>'repairStatus' as repair_status,
  ti.meta->'visual_repair_summary'->>'finalScore' as repair_final_score,
  ti.meta->'visual_repair_summary'->>'requiresFallback' as repair_requires_fallback,
  ti.meta->'visual_repair_summary'->>'requiresManualReview' as repair_requires_manual_review,

  ti.meta->'ai_reconciliation_summary'->>'status' as ai_reconciliation_status,
  ti.meta->'ai_reconciliation_summary'->>'recommendation' as ai_reconciliation_recommendation,

  ti.meta->>'export_parity_artifact_path' as export_parity_artifact_path,
  ti.meta->'export_parity_summary'->>'status' as export_parity_status,
  ti.meta->'export_parity_summary'->>'mode' as export_parity_mode,
  ti.meta->'export_parity_summary'->>'exportVsSourceScore' as export_vs_source_score,

  ti.meta->'golden_regression_summary'->>'version' as golden_version,
  ti.meta->'golden_regression_summary'->>'runId' as golden_run_id,
  ti.meta->'golden_regression_summary'->>'runBatchId' as golden_run_batch_id,
  ti.meta->'golden_regression_summary'->>'corpusId' as golden_corpus_id,
  ti.meta->'golden_regression_summary'->>'category' as golden_category,
  ti.meta->'golden_regression_summary'->>'qualityGateStatus' as golden_quality_gate_status,
  ti.meta->'golden_regression_summary'->>'operatorDecision' as golden_operator_decision,
  jsonb_array_length(coalesce(ti.meta->'golden_regression_summary'->'warnings', '[]'::jsonb)) as golden_warning_count,
  jsonb_array_length(coalesce(ti.meta->'golden_regression_summary'->'failures', '[]'::jsonb)) as golden_failure_count,
  ti.meta->'golden_regression_summary'->>'persistedAt' as golden_persisted_at,

  ti.error,
  ti.updated_at
from public.template_imports ti
order by ti.updated_at desc
limit 80;

-- ---------------------------------------------------------------------------
-- 2. Golden regression summary validity
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.created_template_id as template_id,

  ti.meta->'golden_regression_summary'->>'version' as version,
  ti.meta->'golden_regression_summary'->>'corpusId' as corpus_id,
  ti.meta->'golden_regression_summary'->>'category' as category,
  ti.meta->'golden_regression_summary'->>'qualityGateStatus' as quality_gate_status,
  ti.meta->'golden_regression_summary'->>'operatorDecision' as operator_decision,
  ti.meta->'golden_regression_summary'->>'generatedAt' as generated_at,
  ti.meta->'golden_regression_summary'->>'persistedAt' as persisted_at,

  case
    when not (ti.meta ? 'golden_regression_summary') then 'missing_summary'
    when ti.meta->'golden_regression_summary'->>'version' is null then 'missing_version'
    when ti.meta->'golden_regression_summary'->>'corpusId' is null then 'missing_corpus_id'
    when ti.meta->'golden_regression_summary'->>'qualityGateStatus' is null then 'missing_quality_gate_status'
    when ti.meta->'golden_regression_summary'->>'operatorDecision' is null then 'missing_operator_decision'
    when ti.meta->'golden_regression_summary'->>'persistedAt' is null then 'missing_persisted_at'
    else 'pass'
  end as summary_validity
from public.template_imports ti
where ti.meta ? 'golden_regression_summary'
order by ti.updated_at desc
limit 80;

-- ---------------------------------------------------------------------------
-- 3. Golden regression status distribution
-- ---------------------------------------------------------------------------
select
  ti.meta->'golden_regression_summary'->>'corpusId' as corpus_id,
  ti.meta->'golden_regression_summary'->>'category' as category,
  ti.meta->'golden_regression_summary'->>'qualityGateStatus' as quality_gate_status,
  ti.meta->'golden_regression_summary'->>'operatorDecision' as operator_decision,
  count(*) as run_count,
  max(ti.meta->'golden_regression_summary'->>'persistedAt') as latest_persisted_at
from public.template_imports ti
where ti.meta ? 'golden_regression_summary'
group by
  ti.meta->'golden_regression_summary'->>'corpusId',
  ti.meta->'golden_regression_summary'->>'category',
  ti.meta->'golden_regression_summary'->>'qualityGateStatus',
  ti.meta->'golden_regression_summary'->>'operatorDecision'
order by corpus_id, quality_gate_status, operator_decision;

-- ---------------------------------------------------------------------------
-- 4. Golden corpus coverage
-- ---------------------------------------------------------------------------
with required_corpus as (
  select *
  from (
    values
      ('golden-simple-001'),
      ('golden-design-001'),
      ('golden-report-001'),
      ('golden-table-001'),
      ('golden-image-001'),
      ('golden-ocr-001')
  ) as r(corpus_id)
),
observed as (
  select distinct
    ti.meta->'golden_regression_summary'->>'corpusId' as corpus_id
  from public.template_imports ti
  where ti.meta ? 'golden_regression_summary'
)
select
  rc.corpus_id,
  case
    when o.corpus_id is not null then 'covered'
    else 'not_yet_run'
  end as coverage_status
from required_corpus rc
left join observed o
  on o.corpus_id = rc.corpus_id
order by rc.corpus_id;

-- ---------------------------------------------------------------------------
-- 5. Phase 7 quality-complete imports without golden regression summary
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
  and ti.meta->>'export_parity_artifact_path' is not null
  and not (ti.meta ? 'golden_regression_summary')
order by ti.updated_at desc
limit 80;

-- ---------------------------------------------------------------------------
-- 6. Diagnostics dashboard readiness rows
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.status,
  ti.created_template_id as template_id,
  ti.meta->'visual_quality_summary'->>'overallScore' as visual_quality_score,
  ti.meta->'visual_repair_summary'->>'repairStatus' as repair_status,
  ti.meta->'export_parity_summary'->>'status' as export_parity_status,
  ti.meta->'golden_regression_summary'->>'corpusId' as golden_corpus_id,
  ti.meta->'golden_regression_summary'->>'qualityGateStatus' as quality_gate_status,
  ti.meta->'golden_regression_summary'->>'operatorDecision' as operator_decision,
  case
    when not (ti.meta ? 'golden_regression_summary') then 'not_run'
    when ti.meta->'golden_regression_summary'->>'qualityGateStatus' = 'pass' then 'none'
    when ti.meta->'golden_regression_summary'->>'qualityGateStatus' = 'warning' then 'review'
    when ti.meta->'golden_regression_summary'->>'qualityGateStatus' = 'blocked' then 'rerun'
    when ti.meta->'golden_regression_summary'->>'qualityGateStatus' = 'fail' then 'fix'
    else 'review'
  end as dashboard_action_required,
  ti.updated_at
from public.template_imports ti
order by ti.updated_at desc
limit 80;

-- ---------------------------------------------------------------------------
-- 7. Failure triage source conditions
-- ---------------------------------------------------------------------------
with recent as (
  select
    ti.id,
    ti.source_filename,
    ti.status,
    ti.error,
    ti.meta->>'visual_quality_artifact_path' as visual_quality_artifact_path,
    ti.meta->>'visual_repair_artifact_path' as visual_repair_artifact_path,
    ti.meta->>'export_parity_artifact_path' as export_parity_artifact_path,
    ti.meta->'visual_quality_summary'->>'manualReviewRequired' as visual_manual_review,
    ti.meta->'visual_repair_summary'->>'repairStatus' as repair_status,
    ti.meta->'visual_repair_summary'->>'requiresFallback' as repair_requires_fallback,
    ti.meta->'visual_repair_summary'->>'requiresManualReview' as repair_manual_review,
    ti.meta->'ai_reconciliation_summary'->>'status' as ai_status,
    ti.meta->'ai_reconciliation_summary'->>'recommendation' as ai_recommendation,
    ti.meta->'export_parity_summary'->>'status' as export_status,
    ti.meta->'golden_regression_summary'->>'qualityGateStatus' as quality_gate_status,
    ti.meta->'golden_regression_summary'->>'operatorDecision' as operator_decision,
    ti.updated_at
  from public.template_imports ti
  order by ti.updated_at desc
  limit 100
)
select
  count(*) filter (where status = 'failed' or error is not null) as import_failure_signals,
  count(*) filter (where status = 'completed' and visual_quality_artifact_path is null) as visual_quality_missing_signals,
  count(*) filter (where visual_quality_artifact_path is not null and visual_repair_artifact_path is null) as repair_missing_signals,
  count(*) filter (where repair_status = 'failed') as repair_failed_signals,
  count(*) filter (where repair_requires_fallback = 'true') as fallback_signals,
  count(*) filter (where visual_manual_review = 'true' or repair_manual_review = 'true') as manual_review_signals,
  count(*) filter (where ai_recommendation in ('recommended', 'manual_review') and coalesce(ai_status, '') <> 'completed') as ai_reconciliation_signals,
  count(*) filter (where visual_quality_artifact_path is not null and visual_repair_artifact_path is not null and export_parity_artifact_path is null) as export_parity_missing_signals,
  count(*) filter (where export_status = 'failed') as export_parity_failed_signals,
  count(*) filter (where quality_gate_status in ('fail', 'blocked')) as golden_gate_failure_signals,
  count(*) filter (where operator_decision in ('rejected', 'needs_rerun')) as operator_action_signals
from recent;

-- ---------------------------------------------------------------------------
-- 8. Overall Phase 8 database readiness summary
-- ---------------------------------------------------------------------------
with summary as (
  select
    count(*) filter (where meta ? 'golden_regression_summary') as golden_summary_count,
    count(*) filter (where meta->'golden_regression_summary'->>'qualityGateStatus' = 'pass') as golden_pass,
    count(*) filter (where meta->'golden_regression_summary'->>'qualityGateStatus' = 'warning') as golden_warning,
    count(*) filter (where meta->'golden_regression_summary'->>'qualityGateStatus' = 'fail') as golden_fail,
    count(*) filter (where meta->'golden_regression_summary'->>'qualityGateStatus' = 'blocked') as golden_blocked,
    count(*) filter (where meta->'golden_regression_summary'->>'operatorDecision' in ('rejected', 'needs_rerun')) as operator_blocking_count,
    count(*) filter (
      where meta ? 'golden_regression_summary'
        and (
          meta->'golden_regression_summary'->>'version' is null
          or meta->'golden_regression_summary'->>'corpusId' is null
          or meta->'golden_regression_summary'->>'qualityGateStatus' is null
          or meta->'golden_regression_summary'->>'qualityGateStatus' not in ('pass', 'warning', 'fail', 'blocked')
          or meta->'golden_regression_summary'->>'operatorDecision' is null
          or meta->'golden_regression_summary'->>'persistedAt' is null
        )
    ) as malformed_summary_count
  from public.template_imports
)
select
  golden_summary_count,
  golden_pass,
  golden_warning,
  golden_fail,
  golden_blocked,
  operator_blocking_count,
  malformed_summary_count,
  case
    when golden_fail > 0 or golden_blocked > 0 or operator_blocking_count > 0 then 'phase_8_not_locked_database_failures_present'
    when malformed_summary_count > 0 then 'phase_8_not_locked_invalid_golden_summaries'
    when golden_summary_count = 0 then 'phase_8_locked_with_warnings_no_golden_runs_persisted'
    when golden_warning > 0 then 'phase_8_locked_with_warnings'
    else 'phase_8_ready_to_lock'
  end as phase_8_database_lock_status
from summary;

-- ---------------------------------------------------------------------------
-- 9. Phase 8G note
-- ---------------------------------------------------------------------------
select
  'phase_8g_final_regression_lock' as phase,
  'This SQL validates database-side Phase 8 readiness. Source files, tests, build, and private-artifact checks must be verified outside SQL.' as note;
