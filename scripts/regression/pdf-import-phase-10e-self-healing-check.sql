-- Phase 10E Self-Healing Retry Orchestration Check
-- Run in Supabase SQL Editor.
--
-- Purpose:
-- Validate self_healing_retry_audit metadata coverage, safety gating, and
-- integrity. The self-healing layer is controlled and plan-first: it never
-- calls AI, mutates templates, reruns imports, or performs browser-dependent
-- actions automatically. Only safe metadata-level actions may execute, and only
-- after an explicit operator trigger.
--
-- This SQL is strictly read-only.

-- ---------------------------------------------------------------------------
-- 1. Latest imports with a self-healing retry audit
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.status,
  ti.source_filename,
  ti.page_count,
  ti.created_template_id as template_id,

  ti.meta->'self_healing_retry_audit'->>'version' as audit_version,
  ti.meta->'self_healing_retry_audit'->>'planId' as plan_id,
  ti.meta->'self_healing_retry_audit'->>'mode' as mode,
  ti.meta->'self_healing_retry_audit'->>'status' as plan_status,

  ti.meta->'self_healing_retry_audit'->'summary'->>'totalActions' as total_actions,
  ti.meta->'self_healing_retry_audit'->'summary'->>'executableActions' as executable_actions,
  ti.meta->'self_healing_retry_audit'->'summary'->>'completedActions' as completed_actions,
  ti.meta->'self_healing_retry_audit'->'summary'->>'failedActions' as failed_actions,
  ti.meta->'self_healing_retry_audit'->'summary'->>'skippedActions' as skipped_actions,
  ti.meta->'self_healing_retry_audit'->'summary'->>'manualActions' as manual_actions,
  ti.meta->'self_healing_retry_audit'->'summary'->>'blockedActions' as blocked_actions,

  jsonb_array_length(coalesce(ti.meta->'self_healing_retry_audit'->'warnings', '[]'::jsonb)) as warning_count,
  jsonb_array_length(coalesce(ti.meta->'self_healing_retry_audit'->'blockers', '[]'::jsonb)) as blocker_count,

  ti.meta->'self_healing_retry_audit'->>'generatedAt' as generated_at,
  ti.meta->'self_healing_retry_audit'->>'executedAt' as executed_at,
  ti.meta->'self_healing_retry_audit'->>'persistedAt' as persisted_at,

  ti.meta->'import_intelligence_profile'->>'profileCategory' as profile_category,
  ti.meta->'repair_pattern_analysis'->>'primaryPatternId' as primary_repair_pattern_id,
  ti.meta->'adaptive_reconciliation_policy'->>'decision' as adaptive_decision,
  ti.meta->'golden_regression_summary'->>'qualityGateStatus' as golden_quality_gate_status,

  ti.updated_at
from public.template_imports ti
where ti.meta ? 'self_healing_retry_audit'
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 2. Self-healing coverage summary
-- ---------------------------------------------------------------------------
select
  count(*) as total_imports,
  count(*) filter (where meta ? 'self_healing_retry_audit') as imports_with_self_healing_audit,
  count(*) filter (where status = 'completed') as completed_imports,
  count(*) filter (where status = 'completed' and meta ? 'self_healing_retry_audit') as completed_imports_with_audit,
  count(*) filter (where status <> 'completed' and meta ? 'self_healing_retry_audit') as non_completed_imports_with_audit,
  count(*) filter (
    where meta ? 'self_healing_retry_audit'
      and meta->'self_healing_retry_audit'->>'executedAt' is not null
  ) as executed_audits,
  count(*) filter (
    where meta ? 'self_healing_retry_audit'
      and meta->'self_healing_retry_audit'->>'executedAt' is null
  ) as plan_only_audits
from public.template_imports;

-- ---------------------------------------------------------------------------
-- 3. Mode and plan-status distribution
-- ---------------------------------------------------------------------------
select
  coalesce(meta->'self_healing_retry_audit'->>'mode', 'missing') as mode,
  coalesce(meta->'self_healing_retry_audit'->>'status', 'missing') as plan_status,
  count(*) as import_count
from public.template_imports
where meta ? 'self_healing_retry_audit'
group by
  coalesce(meta->'self_healing_retry_audit'->>'mode', 'missing'),
  coalesce(meta->'self_healing_retry_audit'->>'status', 'missing')
order by import_count desc;

-- ---------------------------------------------------------------------------
-- 4. Per-action expansion (safety level, status, attempts)
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.meta->'self_healing_retry_audit'->>'mode' as mode,
  action->>'actionId' as action_id,
  action->>'safetyLevel' as safety_level,
  action->>'status' as action_status,
  (action->>'priority')::int as priority,
  (action->>'attemptCount')::int as attempt_count,
  (action->>'maxAttempts')::int as max_attempts,
  jsonb_array_length(coalesce(action->'reasonCodes', '[]'::jsonb)) as reason_code_count,
  jsonb_array_length(coalesce(action->'evidence', '[]'::jsonb)) as evidence_count,
  ti.updated_at
from public.template_imports ti
cross join lateral jsonb_array_elements(
  coalesce(ti.meta->'self_healing_retry_audit'->'actions', '[]'::jsonb)
) as action
where ti.meta ? 'self_healing_retry_audit'
order by ti.updated_at desc, priority asc
limit 300;

-- ---------------------------------------------------------------------------
-- 5. Action-id / safety-level distribution
-- ---------------------------------------------------------------------------
select
  action->>'actionId' as action_id,
  action->>'safetyLevel' as safety_level,
  action->>'status' as action_status,
  count(*) as action_count
from public.template_imports ti
cross join lateral jsonb_array_elements(
  coalesce(ti.meta->'self_healing_retry_audit'->'actions', '[]'::jsonb)
) as action
where ti.meta ? 'self_healing_retry_audit'
group by
  action->>'actionId',
  action->>'safetyLevel',
  action->>'status'
order by action_count desc;

-- ---------------------------------------------------------------------------
-- 6. SAFETY INVARIANT: never-automatic actions must never be "completed"
-- Any row returned here is a violation to investigate. Expect 0 rows.
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.meta->'self_healing_retry_audit'->>'mode' as mode,
  action->>'actionId' as action_id,
  action->>'safetyLevel' as safety_level,
  action->>'status' as action_status,
  ti.updated_at
from public.template_imports ti
cross join lateral jsonb_array_elements(
  coalesce(ti.meta->'self_healing_retry_audit'->'actions', '[]'::jsonb)
) as action
where ti.meta ? 'self_healing_retry_audit'
  and action->>'actionId' in (
    'run_ai_reconciliation',
    'rerun_import',
    'rerun_visual_qa',
    'rerun_repair',
    'rerun_export_parity_manual',
    'rerun_golden_regression',
    'inspect_template_editor',
    'inspect_storage_artifacts',
    'inspect_pdf_import_jobs',
    'inspect_supabase_function_logs',
    'inspect_cloud_run_logs',
    'block_until_manual_review'
  )
  and action->>'status' = 'completed'
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 7. Audits with blockers or manual-only outcomes needing operator attention
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.created_template_id as template_id,
  ti.meta->'self_healing_retry_audit'->>'mode' as mode,
  ti.meta->'self_healing_retry_audit'->>'status' as plan_status,
  ti.meta->'self_healing_retry_audit'->'summary' as summary,
  ti.meta->'self_healing_retry_audit'->'warnings' as warnings,
  ti.meta->'self_healing_retry_audit'->'blockers' as blockers,
  ti.updated_at
from public.template_imports ti
where ti.meta ? 'self_healing_retry_audit'
  and (
    ti.meta->'self_healing_retry_audit'->>'status' in ('blocked', 'failed', 'partial')
    or (ti.meta->'self_healing_retry_audit'->'summary'->>'blockedActions')::int > 0
    or (ti.meta->'self_healing_retry_audit'->'summary'->>'manualActions')::int > 0
    or jsonb_array_length(coalesce(ti.meta->'self_healing_retry_audit'->'blockers', '[]'::jsonb)) > 0
  )
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 8. Self-healing audit integrity validation
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.meta->'self_healing_retry_audit'->>'version' as version,
  ti.meta->'self_healing_retry_audit'->>'mode' as mode,
  ti.meta->'self_healing_retry_audit'->>'status' as plan_status,
  case
    when not (ti.meta ? 'self_healing_retry_audit') then 'missing_audit'
    when ti.meta->'self_healing_retry_audit'->>'version' <> 'pdf-import-self-healing-retry-audit-v1' then 'fail_wrong_version'
    when ti.meta->'self_healing_retry_audit'->>'planId' is null then 'fail_missing_plan_id'
    when ti.meta->'self_healing_retry_audit'->>'mode' not in ('dry_run', 'audit_only', 'execute_safe', 'execute_confirmed') then 'fail_invalid_mode'
    when ti.meta->'self_healing_retry_audit'->>'status' not in ('planned', 'completed', 'completed_with_warnings', 'partial', 'blocked', 'failed', 'no_action') then 'fail_invalid_status'
    when ti.meta->'self_healing_retry_audit'->'actions' is null then 'fail_missing_actions'
    when ti.meta->'self_healing_retry_audit'->'summary' is null then 'fail_missing_summary'
    when (ti.meta->'self_healing_retry_audit'->'summary'->>'totalActions')::int
         <> jsonb_array_length(coalesce(ti.meta->'self_healing_retry_audit'->'actions', '[]'::jsonb)) then 'fail_summary_total_mismatch'
    when ti.meta->'self_healing_retry_audit'->>'generatedAt' is null then 'warning_missing_generated_at'
    else 'pass'
  end as audit_integrity_status,
  ti.updated_at
from public.template_imports ti
where ti.meta ? 'self_healing_retry_audit'
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 9. Imports ready for self-healing plan generation
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.status,
  ti.page_count,
  ti.created_template_id as template_id,
  ti.meta->'import_intelligence_profile'->>'profileCategory' as profile_category,
  ti.meta->'repair_pattern_analysis'->>'primaryPatternId' as primary_repair_pattern_id,
  ti.meta->'adaptive_reconciliation_policy'->>'decision' as adaptive_decision,
  ti.meta->'visual_repair_summary'->>'repairStatus' as repair_status,
  ti.meta->'export_parity_summary'->>'status' as export_parity_status,
  case
    when ti.meta ? 'self_healing_retry_audit' then 'audit_exists'
    when not (ti.meta ? 'import_intelligence_profile') then 'ready_with_warning_profile_missing'
    when not (ti.meta ? 'repair_pattern_analysis') then 'ready_with_warning_repair_pattern_missing'
    when not (ti.meta ? 'adaptive_reconciliation_policy') then 'ready_with_warning_adaptive_policy_missing'
    else 'ready_for_self_healing_plan'
  end as self_healing_generation_readiness,
  ti.updated_at
from public.template_imports ti
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 10. Phase 10E note
-- ---------------------------------------------------------------------------
select
  'phase_10e_self_healing_retry_orchestration' as phase,
  'Self-healing retry audit is stored in template_imports.meta.self_healing_retry_audit. It is a controlled, plan-first recovery layer: it never calls AI, mutates templates, reruns imports, or performs browser-dependent actions automatically. Only safe metadata-level actions may execute after an explicit operator trigger.' as note;
