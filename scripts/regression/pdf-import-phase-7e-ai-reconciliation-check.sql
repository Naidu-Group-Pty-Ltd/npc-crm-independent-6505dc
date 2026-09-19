-- Phase 7E AI Reconciliation Check
-- Read-only. Run in Supabase SQL Editor after running AI reconciliation.

-- 1. Latest AI reconciliation summaries
select
  id as import_id,
  source_filename,
  created_template_id as template_id,
  page_count,
  meta->'ai_reconciliation_summary'->>'version' as version,
  meta->'ai_reconciliation_summary'->>'status' as status,
  meta->'ai_reconciliation_summary'->>'recommendation' as recommendation,
  meta->'ai_reconciliation_summary'->>'reason' as reason,
  meta->'ai_reconciliation_summary'->>'visualQaScoreBefore' as visual_qa_score_before,
  meta->'ai_reconciliation_summary'->>'repairFinalScoreBefore' as repair_final_score_before,
  meta->'ai_reconciliation_summary'->>'visualQaScoreAfter' as visual_qa_score_after,
  meta->'ai_reconciliation_summary'->>'editableElementsCreated' as editable_elements_created,
  meta->'ai_reconciliation_summary'->>'layoutChanges' as layout_changes,
  meta->'ai_reconciliation_summary'->>'startedAt' as started_at,
  meta->'ai_reconciliation_summary'->>'completedAt' as completed_at,
  meta->'ai_reconciliation_summary'->>'failedAt' as failed_at,
  meta->'ai_reconciliation_summary'->>'errorMessage' as error_message,
  updated_at
from public.template_imports
where meta ? 'ai_reconciliation_summary'
order by updated_at desc
limit 50;

-- 2. Imports with Visual QA/Repair but no AI reconciliation
select
  id as import_id,
  source_filename,
  created_template_id as template_id,
  page_count,
  meta->'visual_quality_summary'->>'overallScore' as visual_quality_score,
  meta->'visual_repair_summary'->>'finalScore' as repair_final_score,
  meta->'visual_repair_summary'->>'requiresManualReview' as requires_manual_review,
  meta->'visual_repair_summary'->>'requiresFallback' as requires_fallback,
  updated_at
from public.template_imports
where meta->>'visual_quality_artifact_path' is not null
  and meta->>'visual_repair_artifact_path' is not null
  and not (meta ? 'ai_reconciliation_summary')
order by updated_at desc
limit 50;

-- 3. Summary counts
select
  count(*) filter (where meta ? 'ai_reconciliation_summary') as imports_with_ai_reconciliation,
  count(*) filter (where meta->'ai_reconciliation_summary'->>'status' = 'completed') as ai_reconciliation_completed,
  count(*) filter (where meta->'ai_reconciliation_summary'->>'status' = 'failed') as ai_reconciliation_failed,
  count(*) filter (where meta->'ai_reconciliation_summary'->>'recommendation' = 'recommended') as ai_reconciliation_recommended,
  count(*) filter (where meta->'ai_reconciliation_summary'->>'recommendation' = 'manual_review') as ai_reconciliation_manual_review
from public.template_imports;
