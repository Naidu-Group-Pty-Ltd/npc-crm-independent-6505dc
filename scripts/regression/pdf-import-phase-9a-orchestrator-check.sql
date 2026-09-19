-- Phase 9A Golden Corpus Orchestrator Check
-- Run in Supabase SQL Editor.
--
-- Purpose:
-- Validate database-side readiness for the Phase 9A Golden Corpus Run Orchestrator.
--
-- This SQL is read-only.
-- It does not create golden regression summaries.
-- It does not mutate data.

-- ---------------------------------------------------------------------------
-- 1. Recent imports with orchestrator-relevant metadata
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.status as import_status,
  ti.source_filename,
  ti.page_count as import_page_count,
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

  ti.meta->'golden_regression_summary'->>'version' as golden_regression_version,
  ti.meta->'golden_regression_summary'->>'corpusId' as golden_corpus_id,
  ti.meta->'golden_regression_summary'->>'qualityGateStatus' as golden_quality_gate_status,
  ti.meta->'golden_regression_summary'->>'operatorDecision' as golden_operator_decision,
  ti.meta->'golden_regression_summary'->>'persistedAt' as golden_persisted_at,

  ti.error,
  ti.updated_at
from public.template_imports ti
order by ti.updated_at desc
limit 80;

-- ---------------------------------------------------------------------------
-- 2. Orchestrator readiness classification
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.status as import_status,
  ti.created_template_id as template_id,
  ti.page_count as import_page_count,

  case
    when ti.id is null then 'blocked_import_missing'
    when ti.status <> 'completed' then 'blocked_import_not_completed'
    when ti.created_template_id is null then 'blocked_template_missing'
    when ti.meta->>'visual_quality_artifact_path' is null then 'blocked_visual_quality_missing'
    when ti.meta->>'visual_repair_artifact_path' is null then 'blocked_repair_audit_missing'
    when ti.meta->>'export_parity_artifact_path' is null then 'blocked_export_parity_missing'
    else 'ready_for_orchestrator'
  end as orchestrator_readiness,

  case
    when ti.status = 'completed'
      and ti.created_template_id is not null
      and ti.meta->>'visual_quality_artifact_path' is not null
      and ti.meta->>'visual_repair_artifact_path' is not null
      and ti.meta->>'export_parity_artifact_path' is not null
    then true
    else false
  end as can_evaluate_and_persist_cleanly,

  ti.meta->'visual_quality_summary'->>'overallScore' as visual_quality_score,
  ti.meta->'visual_repair_summary'->>'finalScore' as repair_final_score,
  ti.meta->'export_parity_summary'->>'exportVsSourceScore' as export_vs_source_score,
  ti.updated_at
from public.template_imports ti
order by ti.updated_at desc
limit 80;

-- ---------------------------------------------------------------------------
-- 3. Existing orchestrator-compatible golden regression summaries
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.created_template_id as template_id,

  ti.meta->'golden_regression_summary'->>'version' as version,
  ti.meta->'golden_regression_summary'->>'runId' as run_id,
  ti.meta->'golden_regression_summary'->>'runBatchId' as run_batch_id,
  ti.meta->'golden_regression_summary'->>'corpusId' as corpus_id,
  ti.meta->'golden_regression_summary'->>'category' as category,
  ti.meta->'golden_regression_summary'->>'qualityGateStatus' as quality_gate_status,
  ti.meta->'golden_regression_summary'->>'operatorDecision' as operator_decision,
  jsonb_array_length(coalesce(ti.meta->'golden_regression_summary'->'warnings', '[]'::jsonb)) as warning_count,
  jsonb_array_length(coalesce(ti.meta->'golden_regression_summary'->'failures', '[]'::jsonb)) as failure_count,
  ti.meta->'golden_regression_summary'->>'generatedAt' as generated_at,
  ti.meta->'golden_regression_summary'->>'persistedAt' as persisted_at,

  case
    when ti.meta->'golden_regression_summary'->>'version' is null then 'invalid_missing_version'
    when ti.meta->'golden_regression_summary'->>'runId' is null then 'invalid_missing_run_id'
    when ti.meta->'golden_regression_summary'->>'corpusId' is null then 'invalid_missing_corpus_id'
    when ti.meta->'golden_regression_summary'->>'qualityGateStatus' is null then 'invalid_missing_quality_gate_status'
    when ti.meta->'golden_regression_summary'->>'operatorDecision' is null then 'invalid_missing_operator_decision'
    when ti.meta->'golden_regression_summary'->>'persistedAt' is null then 'invalid_missing_persisted_at'
    else 'valid'
  end as summary_validity,

  ti.updated_at
from public.template_imports ti
where ti.meta ? 'golden_regression_summary'
order by ti.updated_at desc
limit 80;

-- ---------------------------------------------------------------------------
-- 4. Golden corpus coverage from persisted summaries
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
  select
    ti.meta->'golden_regression_summary'->>'corpusId' as corpus_id,
    count(*) as run_count,
    max(ti.meta->'golden_regression_summary'->>'persistedAt') as latest_persisted_at,
    count(*) filter (where ti.meta->'golden_regression_summary'->>'qualityGateStatus' = 'pass') as pass_count,
    count(*) filter (where ti.meta->'golden_regression_summary'->>'qualityGateStatus' = 'warning') as warning_count,
    count(*) filter (where ti.meta->'golden_regression_summary'->>'qualityGateStatus' = 'fail') as fail_count,
    count(*) filter (where ti.meta->'golden_regression_summary'->>'qualityGateStatus' = 'blocked') as blocked_count
  from public.template_imports ti
  where ti.meta ? 'golden_regression_summary'
  group by ti.meta->'golden_regression_summary'->>'corpusId'
)
select
  rc.corpus_id,
  coalesce(o.run_count, 0) as run_count,
  coalesce(o.pass_count, 0) as pass_count,
  coalesce(o.warning_count, 0) as warning_count,
  coalesce(o.fail_count, 0) as fail_count,
  coalesce(o.blocked_count, 0) as blocked_count,
  o.latest_persisted_at,
  case
    when o.corpus_id is null then 'not_yet_orchestrated'
    when coalesce(o.fail_count, 0) > 0 or coalesce(o.blocked_count, 0) > 0 then 'covered_with_failures'
    when coalesce(o.warning_count, 0) > 0 then 'covered_with_warnings'
    when coalesce(o.pass_count, 0) > 0 then 'covered_pass'
    else 'covered_unknown'
  end as coverage_status
from required_corpus rc
left join observed o
  on o.corpus_id = rc.corpus_id
order by rc.corpus_id;

-- ---------------------------------------------------------------------------
-- 5. Imports ready for Phase 9A but not yet persisted as golden regression
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.created_template_id as template_id,
  ti.page_count,
  ti.meta->'visual_quality_summary'->>'overallScore' as visual_quality_score,
  ti.meta->'visual_repair_summary'->>'finalScore' as repair_final_score,
  ti.meta->'export_parity_summary'->>'exportVsSourceScore' as export_vs_source_score,
  ti.updated_at
from public.template_imports ti
where ti.status = 'completed'
  and ti.created_template_id is not null
  and ti.meta->>'visual_quality_artifact_path' is not null
  and ti.meta->>'visual_repair_artifact_path' is not null
  and ti.meta->>'export_parity_artifact_path' is not null
  and not (ti.meta ? 'golden_regression_summary')
order by ti.updated_at desc
limit 80;

-- ---------------------------------------------------------------------------
-- 6. Summary counts
-- ---------------------------------------------------------------------------
select
  count(*) as total_imports,
  count(*) filter (where status = 'completed') as completed_imports,
  count(*) filter (where status = 'failed') as failed_imports,
  count(*) filter (
    where status = 'completed'
      and created_template_id is not null
      and meta->>'visual_quality_artifact_path' is not null
      and meta->>'visual_repair_artifact_path' is not null
      and meta->>'export_parity_artifact_path' is not null
  ) as imports_ready_for_orchestrator,
  count(*) filter (where meta ? 'golden_regression_summary') as imports_with_golden_regression_summary,
  count(*) filter (where meta->'golden_regression_summary'->>'qualityGateStatus' = 'pass') as golden_pass,
  count(*) filter (where meta->'golden_regression_summary'->>'qualityGateStatus' = 'warning') as golden_warning,
  count(*) filter (where meta->'golden_regression_summary'->>'qualityGateStatus' = 'fail') as golden_fail,
  count(*) filter (where meta->'golden_regression_summary'->>'qualityGateStatus' = 'blocked') as golden_blocked
from public.template_imports;

-- ---------------------------------------------------------------------------
-- 7. Phase 9A database readiness note
-- ---------------------------------------------------------------------------
select
  'phase_9a_golden_corpus_orchestrator' as phase,
  'The orchestrator runs in application code. This SQL validates that template_imports metadata can support evaluate_only and evaluate_and_persist modes.' as note;
