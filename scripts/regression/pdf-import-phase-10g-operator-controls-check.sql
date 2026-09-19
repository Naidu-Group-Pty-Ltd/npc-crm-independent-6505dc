-- Phase 10G Production Operator Controls Check
-- Run in Supabase SQL Editor.
--
-- Purpose:
-- Validate production_operator_control_audit metadata coverage and integrity.
--
-- This SQL is read-only.

-- ---------------------------------------------------------------------------
-- 1. Latest imports with production operator control audit
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.status,
  ti.source_filename,
  ti.page_count,
  ti.created_template_id as template_id,

  ti.meta->'production_operator_control_audit'->>'version' as audit_version,
  ti.meta->'production_operator_control_audit'->'operatorState'->>'decision' as operator_decision,
  ti.meta->'production_operator_control_audit'->'operatorState'->>'manualReviewRequired' as manual_review_required,
  ti.meta->'production_operator_control_audit'->'operatorState'->>'blocked' as operator_blocked,
  ti.meta->'production_operator_control_audit'->'operatorState'->>'lastActionId' as last_action_id,
  ti.meta->'production_operator_control_audit'->'operatorState'->>'lastActionAt' as last_action_at,

  jsonb_array_length(coalesce(ti.meta->'production_operator_control_audit'->'controls', '[]'::jsonb)) as control_count,
  jsonb_array_length(coalesce(ti.meta->'production_operator_control_audit'->'executedActions', '[]'::jsonb)) as executed_action_count,
  jsonb_array_length(coalesce(ti.meta->'production_operator_control_audit'->'notes', '[]'::jsonb)) as note_count,
  jsonb_array_length(coalesce(ti.meta->'production_operator_control_audit'->'warnings', '[]'::jsonb)) as warning_count,
  jsonb_array_length(coalesce(ti.meta->'production_operator_control_audit'->'blockers', '[]'::jsonb)) as blocker_count,

  ti.meta->'golden_regression_summary'->>'qualityGateStatus' as golden_quality_gate_status,
  ti.meta->'adaptive_reconciliation_policy'->>'decision' as adaptive_decision,
  ti.meta->'adaptive_reconciliation_policy'->'flags'->>'aiBlocked' as ai_blocked,
  ti.meta->'repair_pattern_analysis'->>'operatorReviewRequirement' as repair_operator_review_requirement,
  ti.meta->'self_healing_retry_audit'->>'status' as self_healing_status,
  ti.meta->'performance_cost_audit'->>'overallRiskLevel' as performance_risk_level,

  ti.meta->'production_operator_control_audit'->>'generatedAt' as generated_at,
  ti.meta->'production_operator_control_audit'->>'persistedAt' as persisted_at,
  ti.updated_at
from public.template_imports ti
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 2. Operator control coverage summary
-- ---------------------------------------------------------------------------
select
  count(*) as total_imports,
  count(*) filter (where meta ? 'production_operator_control_audit') as imports_with_operator_control_audit,
  count(*) filter (where status = 'completed') as completed_imports,
  count(*) filter (where status = 'completed' and meta ? 'production_operator_control_audit') as completed_imports_with_audit,
  count(*) filter (where status = 'completed' and not (meta ? 'production_operator_control_audit')) as completed_imports_without_audit
from public.template_imports;

-- ---------------------------------------------------------------------------
-- 3. Operator decision distribution
-- ---------------------------------------------------------------------------
select
  coalesce(meta->'production_operator_control_audit'->'operatorState'->>'decision', 'missing') as operator_decision,
  coalesce(meta->'production_operator_control_audit'->'operatorState'->>'manualReviewRequired', 'missing') as manual_review_required,
  coalesce(meta->'production_operator_control_audit'->'operatorState'->>'blocked', 'missing') as operator_blocked,
  count(*) as import_count
from public.template_imports
group by
  coalesce(meta->'production_operator_control_audit'->'operatorState'->>'decision', 'missing'),
  coalesce(meta->'production_operator_control_audit'->'operatorState'->>'manualReviewRequired', 'missing'),
  coalesce(meta->'production_operator_control_audit'->'operatorState'->>'blocked', 'missing')
order by import_count desc;

-- ---------------------------------------------------------------------------
-- 4. Control expansion
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  control->>'controlId' as control_id,
  control->>'state' as control_state,
  control->>'safetyLevel' as safety_level,
  control->>'recommended' as recommended,
  control->>'requiresConfirmation' as requires_confirmation,
  control->>'reason' as reason,
  control->>'blockedReason' as blocked_reason,
  ti.updated_at
from public.template_imports ti
cross join lateral jsonb_array_elements(
  coalesce(ti.meta->'production_operator_control_audit'->'controls', '[]'::jsonb)
) as control
where ti.meta ? 'production_operator_control_audit'
order by ti.updated_at desc
limit 300;

-- ---------------------------------------------------------------------------
-- 5. Recommended/blocked/manual controls requiring attention
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.meta->'production_operator_control_audit'->'operatorState'->>'decision' as operator_decision,
  control->>'controlId' as control_id,
  control->>'state' as control_state,
  control->>'safetyLevel' as safety_level,
  control->>'reason' as reason,
  control->>'blockedReason' as blocked_reason,
  ti.updated_at
from public.template_imports ti
cross join lateral jsonb_array_elements(
  coalesce(ti.meta->'production_operator_control_audit'->'controls', '[]'::jsonb)
) as control
where ti.meta ? 'production_operator_control_audit'
  and (
    control->>'recommended' = 'true'
    or control->>'state' in ('blocked', 'manual_only', 'requires_confirmation', 'failed')
  )
order by ti.updated_at desc
limit 300;

-- ---------------------------------------------------------------------------
-- 6. Executed operator actions
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  action->>'actionId' as action_id,
  action->>'controlId' as control_id,
  action->>'status' as action_status,
  action->>'message' as message,
  action->>'executedAt' as executed_at,
  ti.updated_at
from public.template_imports ti
cross join lateral jsonb_array_elements(
  coalesce(ti.meta->'production_operator_control_audit'->'executedActions', '[]'::jsonb)
) as action
where ti.meta ? 'production_operator_control_audit'
order by ti.updated_at desc
limit 300;

-- ---------------------------------------------------------------------------
-- 7. Operator audit integrity validation
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.meta->'production_operator_control_audit'->>'version' as version,
  ti.meta->'production_operator_control_audit'->'operatorState'->>'decision' as decision,
  case
    when not (ti.meta ? 'production_operator_control_audit') then 'missing_audit'
    when ti.meta->'production_operator_control_audit'->>'version' is null then 'fail_missing_version'
    when ti.meta->'production_operator_control_audit'->'operatorState' is null then 'fail_missing_operator_state'
    when ti.meta->'production_operator_control_audit'->'operatorState'->>'decision' not in (
      'not_reviewed',
      'accepted',
      'accepted_with_warnings',
      'rejected',
      'needs_rerun',
      'manual_review_required',
      'blocked'
    ) then 'fail_invalid_operator_decision'
    when ti.meta->'production_operator_control_audit'->'controls' is null then 'fail_missing_controls'
    when ti.meta->'production_operator_control_audit'->'executedActions' is null then 'fail_missing_executed_actions'
    when ti.meta->'production_operator_control_audit'->'warnings' is null then 'warning_missing_warnings_array'
    when ti.meta->'production_operator_control_audit'->'blockers' is null then 'warning_missing_blockers_array'
    else 'pass'
  end as audit_integrity_status,
  ti.updated_at
from public.template_imports ti
where ti.meta ? 'production_operator_control_audit'
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 8. Operator decision alignment with quality/adaptive state
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.meta->'golden_regression_summary'->>'qualityGateStatus' as quality_gate_status,
  ti.meta->'adaptive_reconciliation_policy'->>'decision' as adaptive_decision,
  ti.meta->'adaptive_reconciliation_policy'->'flags'->>'aiBlocked' as ai_blocked,
  ti.meta->'production_operator_control_audit'->'operatorState'->>'decision' as operator_decision,
  case
    when ti.meta->'golden_regression_summary'->>'qualityGateStatus' = 'pass'
      and ti.meta->'production_operator_control_audit'->'operatorState'->>'decision' = 'accepted' then 'aligned'
    when ti.meta->'golden_regression_summary'->>'qualityGateStatus' = 'warning'
      and ti.meta->'production_operator_control_audit'->'operatorState'->>'decision' = 'accepted_with_warnings' then 'aligned'
    when ti.meta->'golden_regression_summary'->>'qualityGateStatus' in ('fail', 'blocked')
      and ti.meta->'production_operator_control_audit'->'operatorState'->>'decision' in ('rejected', 'needs_rerun', 'blocked', 'manual_review_required') then 'aligned'
    when (ti.meta->'adaptive_reconciliation_policy'->'flags'->>'aiBlocked')::boolean = true
      and ti.meta->'production_operator_control_audit'->'operatorState'->>'decision' in ('blocked', 'manual_review_required') then 'aligned'
    when ti.meta->'production_operator_control_audit'->'operatorState'->>'decision' is null then 'insufficient_data'
    else 'review'
  end as operator_quality_alignment,
  ti.updated_at
from public.template_imports ti
where ti.meta ? 'production_operator_control_audit'
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 9. Imports ready for operator control generation
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.status,
  ti.page_count,
  ti.created_template_id as template_id,
  ti.meta->'golden_regression_summary'->>'qualityGateStatus' as quality_gate_status,
  ti.meta->'adaptive_reconciliation_policy'->>'decision' as adaptive_decision,
  ti.meta->'self_healing_retry_audit'->>'status' as self_healing_status,
  ti.meta->'performance_cost_audit'->>'overallRiskLevel' as performance_risk_level,
  case
    when ti.id is null then 'not_ready_missing_import'
    when ti.meta ? 'production_operator_control_audit' then 'audit_exists'
    when ti.meta ? 'golden_regression_summary' then 'ready_for_operator_controls'
    when ti.status = 'completed' then 'ready_with_warning_no_golden_summary'
    else 'ready_with_warning_import_not_completed'
  end as operator_control_generation_readiness,
  ti.updated_at
from public.template_imports ti
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 10. Summary counts
-- ---------------------------------------------------------------------------
select
  count(*) as total_imports,
  count(*) filter (where meta ? 'production_operator_control_audit') as imports_with_operator_control_audit,
  count(*) filter (where meta->'production_operator_control_audit'->'operatorState'->>'decision' = 'accepted') as operator_accepted,
  count(*) filter (where meta->'production_operator_control_audit'->'operatorState'->>'decision' = 'accepted_with_warnings') as operator_accepted_with_warnings,
  count(*) filter (where meta->'production_operator_control_audit'->'operatorState'->>'decision' = 'rejected') as operator_rejected,
  count(*) filter (where meta->'production_operator_control_audit'->'operatorState'->>'decision' = 'needs_rerun') as operator_needs_rerun,
  count(*) filter (where meta->'production_operator_control_audit'->'operatorState'->>'decision' = 'manual_review_required') as operator_manual_review_required,
  count(*) filter (where meta->'production_operator_control_audit'->'operatorState'->>'decision' = 'blocked') as operator_blocked
from public.template_imports;

-- ---------------------------------------------------------------------------
-- 11. Phase 10G note
-- ---------------------------------------------------------------------------
select
  'phase_10g_production_operator_controls' as phase,
  'Production operator control audit is stored in template_imports.meta.production_operator_control_audit. Controls are explicit, audited, and must not call AI or mutate templates automatically.' as note;
