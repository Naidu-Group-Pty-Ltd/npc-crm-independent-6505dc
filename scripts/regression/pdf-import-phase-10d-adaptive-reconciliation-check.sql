-- Phase 10D Adaptive Reconciliation Policy Check
-- Run in Supabase SQL Editor.
--
-- Purpose:
-- Validate adaptive_reconciliation_policy metadata coverage and integrity.
--
-- This SQL is read-only.

-- ---------------------------------------------------------------------------
-- 1. Latest imports with adaptive reconciliation policy
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.status,
  ti.source_filename,
  ti.page_count,
  ti.created_template_id as template_id,

  ti.meta->'import_intelligence_profile'->>'profileCategory' as profile_category,
  ti.meta->'import_intelligence_profile'->>'riskLevel' as import_risk_level,

  ti.meta->'repair_pattern_analysis'->>'primaryPatternId' as primary_repair_pattern_id,
  ti.meta->'repair_pattern_analysis'->>'overallSeverity' as repair_pattern_severity,
  ti.meta->'repair_pattern_analysis'->>'aiReconciliationUsefulness' as repair_pattern_ai_usefulness,

  ti.meta->'adaptive_reconciliation_policy'->>'version' as policy_version,
  ti.meta->'adaptive_reconciliation_policy'->>'decision' as policy_decision,
  ti.meta->'adaptive_reconciliation_policy'->>'severity' as policy_severity,
  ti.meta->'adaptive_reconciliation_policy'->>'confidence' as policy_confidence,
  ti.meta->'adaptive_reconciliation_policy'->>'recommendedAction' as recommended_action,

  ti.meta->'adaptive_reconciliation_policy'->'flags'->>'requiresOperatorConfirmation' as requires_operator_confirmation,
  ti.meta->'adaptive_reconciliation_policy'->'flags'->>'requiresManualReview' as requires_manual_review,
  ti.meta->'adaptive_reconciliation_policy'->'flags'->>'requiresVisualQaAfterReconciliation' as requires_visual_qa_after_reconciliation,
  ti.meta->'adaptive_reconciliation_policy'->'flags'->>'requiresExportParityAfterReconciliation' as requires_export_parity_after_reconciliation,
  ti.meta->'adaptive_reconciliation_policy'->'flags'->>'shouldRerunRepairBeforeReconciliation' as should_rerun_repair_before_reconciliation,
  ti.meta->'adaptive_reconciliation_policy'->'flags'->>'aiAllowed' as ai_allowed,
  ti.meta->'adaptive_reconciliation_policy'->'flags'->>'aiBlocked' as ai_blocked,
  ti.meta->'adaptive_reconciliation_policy'->'flags'->>'canProceedWithoutAi' as can_proceed_without_ai,

  jsonb_array_length(coalesce(ti.meta->'adaptive_reconciliation_policy'->'reasons', '[]'::jsonb)) as reason_count,
  jsonb_array_length(coalesce(ti.meta->'adaptive_reconciliation_policy'->'warnings', '[]'::jsonb)) as policy_warning_count,
  jsonb_array_length(coalesce(ti.meta->'adaptive_reconciliation_policy'->'blockers', '[]'::jsonb)) as policy_blocker_count,

  ti.meta->'visual_quality_summary'->>'overallScore' as visual_quality_score,
  ti.meta->'visual_quality_summary'->>'manualReviewRequired' as visual_manual_review,
  ti.meta->'visual_repair_summary'->>'repairStatus' as repair_status,
  ti.meta->'visual_repair_summary'->>'requiresFallback' as repair_requires_fallback,
  ti.meta->'visual_repair_summary'->>'requiresManualReview' as repair_manual_review,
  ti.meta->'export_parity_summary'->>'status' as export_parity_status,
  ti.meta->'ai_reconciliation_summary'->>'status' as existing_ai_status,
  ti.meta->'ai_reconciliation_summary'->>'recommendation' as existing_ai_recommendation,
  ti.meta->'golden_regression_summary'->>'qualityGateStatus' as golden_quality_gate_status,

  ti.updated_at
from public.template_imports ti
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 2. Adaptive policy coverage summary
-- ---------------------------------------------------------------------------
select
  count(*) as total_imports,
  count(*) filter (where meta ? 'adaptive_reconciliation_policy') as imports_with_adaptive_policy,
  count(*) filter (where status = 'completed') as completed_imports,
  count(*) filter (where status = 'completed' and meta ? 'adaptive_reconciliation_policy') as completed_imports_with_policy,
  count(*) filter (where status = 'completed' and not (meta ? 'adaptive_reconciliation_policy')) as completed_imports_without_policy,
  count(*) filter (where meta ? 'import_intelligence_profile') as imports_with_import_profile,
  count(*) filter (where meta ? 'repair_pattern_analysis') as imports_with_repair_pattern_analysis,
  count(*) filter (
    where meta ? 'import_intelligence_profile'
      and meta ? 'repair_pattern_analysis'
      and meta ? 'adaptive_reconciliation_policy'
  ) as imports_with_profile_patterns_and_policy
from public.template_imports;

-- ---------------------------------------------------------------------------
-- 3. Decision distribution
-- ---------------------------------------------------------------------------
select
  coalesce(meta->'adaptive_reconciliation_policy'->>'decision', 'missing') as policy_decision,
  coalesce(meta->'adaptive_reconciliation_policy'->>'severity', 'missing') as policy_severity,
  coalesce(meta->'adaptive_reconciliation_policy'->>'recommendedAction', 'missing') as recommended_action,
  count(*) as import_count
from public.template_imports
group by
  coalesce(meta->'adaptive_reconciliation_policy'->>'decision', 'missing'),
  coalesce(meta->'adaptive_reconciliation_policy'->>'severity', 'missing'),
  coalesce(meta->'adaptive_reconciliation_policy'->>'recommendedAction', 'missing')
order by import_count desc;

-- ---------------------------------------------------------------------------
-- 4. Policies requiring operator/developer attention
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.created_template_id as template_id,
  ti.meta->'adaptive_reconciliation_policy'->>'decision' as policy_decision,
  ti.meta->'adaptive_reconciliation_policy'->>'severity' as policy_severity,
  ti.meta->'adaptive_reconciliation_policy'->>'recommendedAction' as recommended_action,
  ti.meta->'adaptive_reconciliation_policy'->'flags' as flags,
  ti.meta->'adaptive_reconciliation_policy'->'reasons' as reasons,
  ti.meta->'adaptive_reconciliation_policy'->'warnings' as warnings,
  ti.meta->'adaptive_reconciliation_policy'->'blockers' as blockers,
  ti.updated_at
from public.template_imports ti
where ti.meta ? 'adaptive_reconciliation_policy'
  and (
    ti.meta->'adaptive_reconciliation_policy'->>'decision' in ('recommended', 'manual_review', 'blocked')
    or ti.meta->'adaptive_reconciliation_policy'->>'severity' in ('high', 'critical')
    or (ti.meta->'adaptive_reconciliation_policy'->'flags'->>'requiresManualReview')::boolean = true
    or (ti.meta->'adaptive_reconciliation_policy'->'flags'->>'aiBlocked')::boolean = true
    or jsonb_array_length(coalesce(ti.meta->'adaptive_reconciliation_policy'->'blockers', '[]'::jsonb)) > 0
  )
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 5. Adaptive policy integrity validation
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.meta->'adaptive_reconciliation_policy'->>'version' as version,
  ti.meta->'adaptive_reconciliation_policy'->>'decision' as decision,
  ti.meta->'adaptive_reconciliation_policy'->>'severity' as severity,
  ti.meta->'adaptive_reconciliation_policy'->>'confidence' as confidence,
  ti.meta->'adaptive_reconciliation_policy'->>'recommendedAction' as recommended_action,
  case
    when not (ti.meta ? 'adaptive_reconciliation_policy') then 'missing_policy'
    when ti.meta->'adaptive_reconciliation_policy'->>'version' is null then 'fail_missing_version'
    when ti.meta->'adaptive_reconciliation_policy'->>'decision' not in ('not_needed', 'optional', 'recommended', 'manual_review', 'blocked') then 'fail_invalid_decision'
    when ti.meta->'adaptive_reconciliation_policy'->>'severity' not in ('info', 'low', 'medium', 'high', 'critical') then 'fail_invalid_severity'
    when ti.meta->'adaptive_reconciliation_policy'->>'recommendedAction' not in (
      'no_action',
      'allow_operator_choice',
      'run_ai_reconciliation',
      'run_ai_reconciliation_with_review',
      'require_manual_review',
      'block_ai_reconciliation',
      'rerun_visual_qa_first',
      'rerun_repair_first',
      'rerun_export_parity_first',
      'inspect_template_editor',
      'inspect_repair_patterns',
      'inspect_import_profile'
    ) then 'fail_invalid_action'
    when ti.meta->'adaptive_reconciliation_policy'->'flags' is null then 'fail_missing_flags'
    when ti.meta->'adaptive_reconciliation_policy'->'sourceSummary' is null then 'fail_missing_source_summary'
    when ti.meta->'adaptive_reconciliation_policy'->'evidence' is null then 'warning_missing_evidence'
    else 'pass'
  end as policy_integrity_status,
  ti.updated_at
from public.template_imports ti
where ti.meta ? 'adaptive_reconciliation_policy'
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 6. Policy alignment with import profile and repair pattern
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.meta->'import_intelligence_profile'->>'profileCategory' as profile_category,
  ti.meta->'import_intelligence_profile'->>'riskLevel' as import_risk_level,
  ti.meta->'repair_pattern_analysis'->>'primaryPatternId' as primary_repair_pattern_id,
  ti.meta->'repair_pattern_analysis'->>'aiReconciliationUsefulness' as pattern_ai_usefulness,
  ti.meta->'adaptive_reconciliation_policy'->>'decision' as policy_decision,
  case
    when ti.meta->'repair_pattern_analysis'->>'aiReconciliationUsefulness' in ('high')
      and ti.meta->'adaptive_reconciliation_policy'->>'decision' in ('recommended', 'manual_review') then 'aligned'
    when ti.meta->'repair_pattern_analysis'->>'aiReconciliationUsefulness' in ('blocked')
      and ti.meta->'adaptive_reconciliation_policy'->>'decision' = 'blocked' then 'aligned'
    when ti.meta->'import_intelligence_profile'->>'profileCategory' = 'scanned_ocr'
      and ti.meta->'adaptive_reconciliation_policy'->>'decision' in ('manual_review', 'blocked') then 'aligned'
    when ti.meta->'import_intelligence_profile'->>'riskLevel' in ('high', 'critical')
      and ti.meta->'adaptive_reconciliation_policy'->>'decision' in ('manual_review', 'blocked') then 'aligned'
    when ti.meta->'import_intelligence_profile'->>'riskLevel' = 'low'
      and ti.meta->'adaptive_reconciliation_policy'->>'decision' in ('not_needed', 'optional') then 'aligned'
    when ti.meta->'adaptive_reconciliation_policy'->>'decision' is null then 'insufficient_data'
    else 'review'
  end as policy_alignment,
  ti.updated_at
from public.template_imports ti
where ti.meta ? 'adaptive_reconciliation_policy'
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 7. Existing AI reconciliation vs adaptive policy
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.meta->'adaptive_reconciliation_policy'->>'decision' as policy_decision,
  ti.meta->'adaptive_reconciliation_policy'->>'recommendedAction' as recommended_action,
  ti.meta->'ai_reconciliation_summary'->>'status' as ai_status,
  ti.meta->'ai_reconciliation_summary'->>'recommendation' as ai_recommendation,
  case
    when ti.meta->'adaptive_reconciliation_policy'->>'decision' = 'blocked'
      and ti.meta->'ai_reconciliation_summary'->>'status' = 'completed' then 'review_ai_completed_despite_blocked_policy'
    when ti.meta->'adaptive_reconciliation_policy'->>'decision' = 'recommended'
      and coalesce(ti.meta->'ai_reconciliation_summary'->>'status', '') <> 'completed' then 'ai_recommended_not_completed'
    when ti.meta->'adaptive_reconciliation_policy'->>'decision' = 'not_needed'
      and ti.meta->'ai_reconciliation_summary'->>'status' = 'completed' then 'ai_completed_even_though_not_needed'
    else 'neutral'
  end as ai_policy_alignment,
  ti.updated_at
from public.template_imports ti
where ti.meta ? 'adaptive_reconciliation_policy'
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 8. Imports ready for adaptive policy generation
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.status,
  ti.page_count,
  ti.created_template_id as template_id,
  ti.meta->'import_intelligence_profile'->>'profileCategory' as profile_category,
  ti.meta->'repair_pattern_analysis'->>'primaryPatternId' as primary_repair_pattern_id,
  ti.meta->'visual_quality_summary'->>'overallScore' as visual_quality_score,
  ti.meta->'visual_repair_summary'->>'repairStatus' as repair_status,
  ti.meta->'export_parity_summary'->>'status' as export_parity_status,
  case
    when ti.status <> 'completed' then 'not_ready_import_not_completed'
    when not (ti.meta ? 'import_intelligence_profile') then 'ready_with_warning_profile_missing'
    when not (ti.meta ? 'repair_pattern_analysis') then 'ready_with_warning_repair_pattern_missing'
    when ti.meta ? 'adaptive_reconciliation_policy' then 'policy_exists'
    else 'ready_for_adaptive_policy_generation'
  end as adaptive_policy_generation_readiness,
  ti.updated_at
from public.template_imports ti
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 9. Phase 10D note
-- ---------------------------------------------------------------------------
select
  'phase_10d_adaptive_reconciliation_policy' as phase,
  'Adaptive reconciliation policy is stored in template_imports.meta.adaptive_reconciliation_policy. It is advisory/governance metadata only and does not call AI automatically.' as note;
