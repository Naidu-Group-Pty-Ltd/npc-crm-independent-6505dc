-- Phase 8D Golden Regression Result Persistence Check
-- Run in Supabase SQL Editor after saving a golden regression summary.
--
-- This phase persists results into:
-- template_imports.meta.golden_regression_summary

-- ---------------------------------------------------------------------------
-- 1. Latest persisted golden regression summaries
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.created_template_id as template_id,
  ti.page_count,

  ti.meta->'golden_regression_summary'->>'version' as version,
  ti.meta->'golden_regression_summary'->>'runId' as run_id,
  ti.meta->'golden_regression_summary'->>'runBatchId' as run_batch_id,
  ti.meta->'golden_regression_summary'->>'corpusId' as corpus_id,
  ti.meta->'golden_regression_summary'->>'category' as category,

  ti.meta->'golden_regression_summary'->>'engineVersion' as engine_version,
  ti.meta->'golden_regression_summary'->>'importStatus' as import_status,
  ti.meta->'golden_regression_summary'->>'runStatus' as run_status,
  ti.meta->'golden_regression_summary'->>'runDecision' as run_decision,

  ti.meta->'golden_regression_summary'->>'visualQaScore' as visual_qa_score,
  ti.meta->'golden_regression_summary'->>'repairStatus' as repair_status,
  ti.meta->'golden_regression_summary'->>'repairFinalScore' as repair_final_score,

  ti.meta->'golden_regression_summary'->>'aiReconciliationStatus' as ai_reconciliation_status,
  ti.meta->'golden_regression_summary'->>'aiReconciliationRecommendation' as ai_reconciliation_recommendation,

  ti.meta->'golden_regression_summary'->>'exportParityStatus' as export_parity_status,
  ti.meta->'golden_regression_summary'->>'exportParityMode' as export_parity_mode,
  ti.meta->'golden_regression_summary'->>'exportVsSourceScore' as export_vs_source_score,
  ti.meta->'golden_regression_summary'->>'editorVsSourceScore' as editor_vs_source_score,
  ti.meta->'golden_regression_summary'->>'exportVsEditorScore' as export_vs_editor_score,

  ti.meta->'golden_regression_summary'->>'qualityGateStatus' as quality_gate_status,
  ti.meta->'golden_regression_summary'->'gateSummary' as gate_summary,
  jsonb_array_length(coalesce(ti.meta->'golden_regression_summary'->'warnings', '[]'::jsonb)) as warning_count,
  jsonb_array_length(coalesce(ti.meta->'golden_regression_summary'->'failures', '[]'::jsonb)) as failure_count,

  ti.meta->'golden_regression_summary'->>'operatorDecision' as operator_decision,
  ti.meta->'golden_regression_summary'->>'generatedAt' as generated_at,
  ti.meta->'golden_regression_summary'->>'persistedAt' as persisted_at,

  ti.updated_at
from public.template_imports ti
where ti.meta ? 'golden_regression_summary'
order by ti.updated_at desc
limit 50;

-- ---------------------------------------------------------------------------
-- 2. Golden regression summaries requiring attention
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
    ti.meta->'golden_regression_summary'->>'qualityGateStatus' in ('fail', 'blocked', 'not_evaluated')
    or ti.meta->'golden_regression_summary'->>'operatorDecision' in ('rejected', 'needs_rerun', 'not_reviewed')
    or jsonb_array_length(coalesce(ti.meta->'golden_regression_summary'->'failures', '[]'::jsonb)) > 0
  )
order by ti.updated_at desc
limit 50;

-- ---------------------------------------------------------------------------
-- 3. Recent Phase 7-complete imports without golden regression summary
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.created_template_id as template_id,
  ti.page_count,
  ti.meta->>'visual_quality_artifact_path' as visual_quality_artifact_path,
  ti.meta->>'visual_repair_artifact_path' as visual_repair_artifact_path,
  ti.meta->>'export_parity_artifact_path' as export_parity_artifact_path,
  ti.meta->'visual_quality_summary'->>'overallScore' as visual_quality_score,
  ti.meta->'visual_repair_summary'->>'finalScore' as repair_final_score,
  ti.meta->'export_parity_summary'->>'exportVsSourceScore' as export_vs_source_score,
  ti.updated_at
from public.template_imports ti
where ti.status = 'completed'
  and ti.meta->>'visual_quality_artifact_path' is not null
  and ti.meta->>'visual_repair_artifact_path' is not null
  and ti.meta->>'export_parity_artifact_path' is not null
  and not (ti.meta ? 'golden_regression_summary')
order by ti.updated_at desc
limit 50;

-- ---------------------------------------------------------------------------
-- 4. Summary counts by corpus/status
-- ---------------------------------------------------------------------------
select
  ti.meta->'golden_regression_summary'->>'corpusId' as corpus_id,
  ti.meta->'golden_regression_summary'->>'category' as category,
  ti.meta->'golden_regression_summary'->>'qualityGateStatus' as quality_gate_status,
  count(*) as run_count,
  max(ti.meta->'golden_regression_summary'->>'persistedAt') as latest_persisted_at
from public.template_imports ti
where ti.meta ? 'golden_regression_summary'
group by
  ti.meta->'golden_regression_summary'->>'corpusId',
  ti.meta->'golden_regression_summary'->>'category',
  ti.meta->'golden_regression_summary'->>'qualityGateStatus'
order by corpus_id, quality_gate_status;

-- ---------------------------------------------------------------------------
-- 5. Overall persistence summary
-- ---------------------------------------------------------------------------
select
  count(*) filter (where meta ? 'golden_regression_summary') as imports_with_golden_regression_summary,
  count(*) filter (where meta->'golden_regression_summary'->>'qualityGateStatus' = 'pass') as golden_pass,
  count(*) filter (where meta->'golden_regression_summary'->>'qualityGateStatus' = 'warning') as golden_warning,
  count(*) filter (where meta->'golden_regression_summary'->>'qualityGateStatus' = 'fail') as golden_fail,
  count(*) filter (where meta->'golden_regression_summary'->>'qualityGateStatus' = 'blocked') as golden_blocked,
  count(*) filter (where meta->'golden_regression_summary'->>'qualityGateStatus' = 'not_evaluated') as golden_not_evaluated,
  count(*) filter (where meta->'golden_regression_summary'->>'operatorDecision' = 'accepted') as operator_accepted,
  count(*) filter (where meta->'golden_regression_summary'->>'operatorDecision' = 'accepted_with_warnings') as operator_accepted_with_warnings,
  count(*) filter (where meta->'golden_regression_summary'->>'operatorDecision' = 'rejected') as operator_rejected,
  count(*) filter (where meta->'golden_regression_summary'->>'operatorDecision' = 'needs_rerun') as operator_needs_rerun
from public.template_imports;

-- ---------------------------------------------------------------------------
-- 6. Phase 8D note
-- ---------------------------------------------------------------------------
select
  'phase_8d_regression_result_persistence' as phase,
  'Golden regression summaries are persisted in template_imports.meta.golden_regression_summary. Dedicated tables are intentionally deferred.' as note;
