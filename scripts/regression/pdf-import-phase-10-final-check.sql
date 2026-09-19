-- Phase 10H Final Phase 10 Production Intelligence Lock Check
-- Run in Supabase SQL Editor.
--
-- Purpose:
-- Final database-side validation for Phase 10 production intelligence lock.
--
-- This SQL is read-only.
-- It does not mutate production data.

-- ---------------------------------------------------------------------------
-- 1. Latest imports with all Phase 10 metadata
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

  ti.meta->'adaptive_reconciliation_policy'->>'decision' as adaptive_decision,
  ti.meta->'adaptive_reconciliation_policy'->'flags'->>'aiBlocked' as adaptive_ai_blocked,

  ti.meta->'self_healing_retry_audit'->>'status' as self_healing_status,
  ti.meta->'self_healing_retry_audit'->'summary'->>'manualActions' as self_healing_manual_actions,
  ti.meta->'self_healing_retry_audit'->'summary'->>'blockedActions' as self_healing_blocked_actions,

  ti.meta->'performance_cost_audit'->>'overallCostLevel' as performance_cost_level,
  ti.meta->'performance_cost_audit'->>'overallRiskLevel' as performance_risk_level,

  ti.meta->'production_operator_control_audit'->'operatorState'->>'decision' as operator_decision,
  ti.meta->'production_operator_control_audit'->'operatorState'->>'manualReviewRequired' as operator_manual_review_required,
  ti.meta->'production_operator_control_audit'->'operatorState'->>'blocked' as operator_blocked,

  ti.meta->'export_parity_summary'->>'status' as export_parity_status,
  ti.meta->'golden_regression_summary'->>'qualityGateStatus' as golden_quality_gate_status,

  ti.updated_at
from public.template_imports ti
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 2. Phase 10 metadata coverage summary
-- ---------------------------------------------------------------------------
select
  count(*) as total_imports,
  count(*) filter (where status = 'completed') as completed_imports,

  count(*) filter (where meta ? 'import_intelligence_profile') as with_import_intelligence,
  count(*) filter (where meta ? 'repair_pattern_analysis') as with_repair_patterns,
  count(*) filter (where meta ? 'adaptive_reconciliation_policy') as with_adaptive_policy,
  count(*) filter (where meta ? 'self_healing_retry_audit') as with_self_healing,
  count(*) filter (where meta ? 'performance_cost_audit') as with_performance_audit,
  count(*) filter (where meta ? 'production_operator_control_audit') as with_operator_controls,

  count(*) filter (
    where meta ? 'import_intelligence_profile'
      and meta ? 'repair_pattern_analysis'
      and meta ? 'adaptive_reconciliation_policy'
      and meta ? 'self_healing_retry_audit'
      and meta ? 'performance_cost_audit'
      and meta ? 'production_operator_control_audit'
  ) as with_full_phase10_metadata
from public.template_imports;

-- ---------------------------------------------------------------------------
-- 3. Completed imports missing Phase 10 metadata
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.status,
  ti.created_template_id as template_id,
  case when not (ti.meta ? 'import_intelligence_profile') then true else false end as missing_import_intelligence,
  case when not (ti.meta ? 'repair_pattern_analysis') then true else false end as missing_repair_patterns,
  case when not (ti.meta ? 'adaptive_reconciliation_policy') then true else false end as missing_adaptive_policy,
  case when not (ti.meta ? 'self_healing_retry_audit') then true else false end as missing_self_healing,
  case when not (ti.meta ? 'performance_cost_audit') then true else false end as missing_performance_audit,
  case when not (ti.meta ? 'production_operator_control_audit') then true else false end as missing_operator_controls,
  ti.updated_at
from public.template_imports ti
where ti.status = 'completed'
  and (
    not (ti.meta ? 'import_intelligence_profile')
    or not (ti.meta ? 'repair_pattern_analysis')
    or not (ti.meta ? 'adaptive_reconciliation_policy')
    or not (ti.meta ? 'self_healing_retry_audit')
    or not (ti.meta ? 'performance_cost_audit')
    or not (ti.meta ? 'production_operator_control_audit')
  )
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 4. Metadata integrity rollup
-- ---------------------------------------------------------------------------
with integrity as (
  select
    ti.id as import_id,

    case
      when ti.meta ? 'import_intelligence_profile'
       and ti.meta->'import_intelligence_profile'->>'version' is not null
       and ti.meta->'import_intelligence_profile'->>'profileCategory' in (
        'simple_document',
        'design_heavy',
        'multi_page_report',
        'table_heavy',
        'image_heavy',
        'scanned_ocr',
        'mixed_complex',
        'high_risk',
        'unknown'
       )
      then 'pass'
      when ti.meta ? 'import_intelligence_profile' then 'fail'
      else 'missing'
    end as import_intelligence_integrity,

    case
      when ti.meta ? 'repair_pattern_analysis'
       and ti.meta->'repair_pattern_analysis'->>'version' is not null
       and ti.meta->'repair_pattern_analysis'->>'overallSeverity' in ('info', 'low', 'medium', 'high', 'critical')
      then 'pass'
      when ti.meta ? 'repair_pattern_analysis' then 'fail'
      else 'missing'
    end as repair_pattern_integrity,

    case
      when ti.meta ? 'adaptive_reconciliation_policy'
       and ti.meta->'adaptive_reconciliation_policy'->>'version' is not null
       and ti.meta->'adaptive_reconciliation_policy'->>'decision' in ('not_needed', 'optional', 'recommended', 'manual_review', 'blocked')
       and ti.meta->'adaptive_reconciliation_policy'->'flags' is not null
      then 'pass'
      when ti.meta ? 'adaptive_reconciliation_policy' then 'fail'
      else 'missing'
    end as adaptive_policy_integrity,

    case
      when ti.meta ? 'self_healing_retry_audit'
       and ti.meta->'self_healing_retry_audit'->>'version' is not null
       and ti.meta->'self_healing_retry_audit'->>'mode' in ('dry_run', 'audit_only', 'execute_safe', 'execute_confirmed')
       and ti.meta->'self_healing_retry_audit'->>'status' in ('planned', 'completed', 'completed_with_warnings', 'partial', 'blocked', 'failed', 'no_action')
      then 'pass'
      when ti.meta ? 'self_healing_retry_audit' then 'fail'
      else 'missing'
    end as self_healing_integrity,

    case
      when ti.meta ? 'performance_cost_audit'
       and ti.meta->'performance_cost_audit'->>'version' is not null
       and ti.meta->'performance_cost_audit'->>'overallCostLevel' in ('negligible', 'low', 'medium', 'high', 'very_high', 'unknown')
       and ti.meta->'performance_cost_audit'->>'overallRiskLevel' in ('low', 'medium', 'high', 'critical', 'unknown')
      then 'pass'
      when ti.meta ? 'performance_cost_audit' then 'fail'
      else 'missing'
    end as performance_integrity,

    case
      when ti.meta ? 'production_operator_control_audit'
       and ti.meta->'production_operator_control_audit'->>'version' is not null
       and ti.meta->'production_operator_control_audit'->'operatorState'->>'decision' in (
        'not_reviewed',
        'accepted',
        'accepted_with_warnings',
        'rejected',
        'needs_rerun',
        'manual_review_required',
        'blocked'
       )
      then 'pass'
      when ti.meta ? 'production_operator_control_audit' then 'fail'
      else 'missing'
    end as operator_control_integrity
  from public.template_imports ti
)
select
  count(*) as checked_imports,
  count(*) filter (where import_intelligence_integrity = 'pass') as import_intelligence_pass,
  count(*) filter (where import_intelligence_integrity = 'fail') as import_intelligence_fail,
  count(*) filter (where repair_pattern_integrity = 'pass') as repair_pattern_pass,
  count(*) filter (where repair_pattern_integrity = 'fail') as repair_pattern_fail,
  count(*) filter (where adaptive_policy_integrity = 'pass') as adaptive_policy_pass,
  count(*) filter (where adaptive_policy_integrity = 'fail') as adaptive_policy_fail,
  count(*) filter (where self_healing_integrity = 'pass') as self_healing_pass,
  count(*) filter (where self_healing_integrity = 'fail') as self_healing_fail,
  count(*) filter (where performance_integrity = 'pass') as performance_pass,
  count(*) filter (where performance_integrity = 'fail') as performance_fail,
  count(*) filter (where operator_control_integrity = 'pass') as operator_control_pass,
  count(*) filter (where operator_control_integrity = 'fail') as operator_control_fail
from integrity;

-- ---------------------------------------------------------------------------
-- 5. AI safety check
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.meta->'adaptive_reconciliation_policy'->>'decision' as adaptive_decision,
  ti.meta->'adaptive_reconciliation_policy'->'flags'->>'aiBlocked' as ai_blocked,
  ti.meta->'ai_reconciliation_summary'->>'status' as ai_status,
  case
    when (ti.meta->'adaptive_reconciliation_policy'->'flags'->>'aiBlocked')::boolean = true
      and ti.meta->'ai_reconciliation_summary'->>'status' = 'completed'
    then 'review_ai_completed_despite_blocked_policy'
    when exists (
      select 1
      from jsonb_array_elements(coalesce(ti.meta->'self_healing_retry_audit'->'actions', '[]'::jsonb)) a
      where a->>'actionId' = 'run_ai_reconciliation'
        and a->>'status' = 'completed'
    )
    then 'fail_self_healing_completed_ai_action'
    else 'pass_or_not_applicable'
  end as ai_safety_status,
  ti.updated_at
from public.template_imports ti
where ti.meta ? 'adaptive_reconciliation_policy'
   or ti.meta ? 'self_healing_retry_audit'
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 6. Self-healing manual/blocked action safety
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  action->>'actionId' as action_id,
  action->>'safetyLevel' as safety_level,
  action->>'status' as action_status,
  case
    when action->>'safetyLevel' = 'manual_only'
      and action->>'status' = 'completed'
    then 'fail_manual_only_action_completed'
    when action->>'safetyLevel' = 'blocked'
      and action->>'status' = 'completed'
    then 'fail_blocked_action_completed'
    else 'pass'
  end as action_safety_status,
  ti.updated_at
from public.template_imports ti
cross join lateral jsonb_array_elements(
  coalesce(ti.meta->'self_healing_retry_audit'->'actions', '[]'::jsonb)
) as action
where ti.meta ? 'self_healing_retry_audit'
  and (
    action->>'safetyLevel' in ('manual_only', 'blocked')
    or action->>'status' = 'completed'
  )
order by ti.updated_at desc
limit 200;

-- ---------------------------------------------------------------------------
-- 7. Operator control safety check
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  control->>'controlId' as control_id,
  control->>'safetyLevel' as safety_level,
  control->>'state' as control_state,
  case
    when control->>'controlId' in ('run_ai_reconciliation_manual', 'apply_repair_manual', 'apply_reconciliation_manual', 'rerun_import_manual')
      and control->>'state' = 'completed'
    then 'fail_manual_control_completed_automatically'
    when control->>'safetyLevel' = 'blocked'
      and control->>'state' in ('available', 'recommended', 'completed')
    then 'fail_blocked_control_available'
    else 'pass'
  end as operator_control_safety_status,
  ti.updated_at
from public.template_imports ti
cross join lateral jsonb_array_elements(
  coalesce(ti.meta->'production_operator_control_audit'->'controls', '[]'::jsonb)
) as control
where ti.meta ? 'production_operator_control_audit'
order by ti.updated_at desc
limit 300;

-- ---------------------------------------------------------------------------
-- 8. Golden run history readiness
-- ---------------------------------------------------------------------------
select
  count(*) as total_history_rows,
  count(distinct corpus_id) as distinct_corpus_ids,
  count(*) filter (where quality_gate_status = 'pass') as pass_count,
  count(*) filter (where quality_gate_status = 'warning') as warning_count,
  count(*) filter (where quality_gate_status in ('fail', 'blocked')) as fail_or_blocked_count,
  count(*) filter (where baseline_comparison->>'outcome' = 'degraded') as degraded_baseline_count,
  max(created_at) as latest_history_at
from public.pdf_import_golden_runs;

-- ---------------------------------------------------------------------------
-- 9. Golden corpus coverage
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
history_counts as (
  select
    corpus_id,
    count(*) as run_count,
    max(created_at) as latest_run_at
  from public.pdf_import_golden_runs
  group by corpus_id
)
select
  rc.corpus_id,
  coalesce(hc.run_count, 0) as run_count,
  hc.latest_run_at,
  case
    when hc.run_count is null then 'warning_no_history_yet'
    else 'covered'
  end as corpus_history_status
from required_corpus rc
left join history_counts hc
  on hc.corpus_id = rc.corpus_id
order by rc.corpus_id;

-- ---------------------------------------------------------------------------
-- 10. Storage bucket safety
-- ---------------------------------------------------------------------------
select
  b.id as bucket_id,
  b.name,
  b.public,
  b.file_size_limit,
  b.allowed_mime_types,
  case
    when b.id = 'template-import-artifacts' and b.public = true then 'critical_public_template_import_artifacts_bucket'
    when b.id = 'template-import-artifacts' and b.public = false then 'pass_private_bucket'
    else 'review'
  end as bucket_safety_status,
  b.created_at,
  b.updated_at
from storage.buckets b
where b.id = 'template-import-artifacts'
   or b.name ilike '%template%'
   or b.name ilike '%import%'
   or b.name ilike '%pdf%';

-- ---------------------------------------------------------------------------
-- 11. RLS policy visibility
-- ---------------------------------------------------------------------------
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'template_imports',
    'report_templates',
    'pdf_import_jobs',
    'pdf_import_golden_runs'
  )
order by tablename, policyname;

-- ---------------------------------------------------------------------------
-- 12. RLS enabled state
-- ---------------------------------------------------------------------------
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as force_rls
from pg_class c
join pg_namespace n
  on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'template_imports',
    'report_templates',
    'pdf_import_jobs',
    'pdf_import_golden_runs'
  )
order by c.relname;

-- ---------------------------------------------------------------------------
-- 13. PDF import job health
-- ---------------------------------------------------------------------------
select
  count(*) as total_jobs,
  count(*) filter (where status = 'completed') as completed_jobs,
  count(*) filter (where status = 'failed') as failed_jobs,
  count(*) filter (where engine_version is null) as jobs_missing_engine_version,
  count(*) filter (where duration_ms > 60000) as jobs_over_60s,
  count(*) filter (where duration_ms > 180000) as jobs_over_180s
from public.pdf_import_jobs;

-- ---------------------------------------------------------------------------
-- 14. Metadata size risk
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  pg_column_size(ti.meta) as meta_size_bytes,
  case
    when pg_column_size(ti.meta) > 500000 then 'warning_high_meta_size'
    when pg_column_size(ti.meta) > 200000 then 'notice_medium_meta_size'
    else 'pass'
  end as meta_size_status,
  ti.updated_at
from public.template_imports ti
order by pg_column_size(ti.meta) desc
limit 50;

-- ---------------------------------------------------------------------------
-- 15. Final lock signal rollup
-- ---------------------------------------------------------------------------
with signals as (
  select
    (select count(*) from public.template_imports where status = 'completed') as completed_imports,

    (select count(*) from public.template_imports where meta ? 'import_intelligence_profile') as import_profile_count,
    (select count(*) from public.template_imports where meta ? 'repair_pattern_analysis') as repair_pattern_count,
    (select count(*) from public.template_imports where meta ? 'adaptive_reconciliation_policy') as adaptive_policy_count,
    (select count(*) from public.template_imports where meta ? 'self_healing_retry_audit') as self_healing_count,
    (select count(*) from public.template_imports where meta ? 'performance_cost_audit') as performance_count,
    (select count(*) from public.template_imports where meta ? 'production_operator_control_audit') as operator_control_count,

    (select count(*) from public.pdf_import_golden_runs) as golden_history_count,

    (select count(*) from storage.buckets where id = 'template-import-artifacts' and public = true) as public_import_artifact_bucket_count,

    (
      select count(*)
      from public.template_imports ti
      cross join lateral jsonb_array_elements(coalesce(ti.meta->'self_healing_retry_audit'->'actions', '[]'::jsonb)) a
      where a->>'actionId' = 'run_ai_reconciliation'
        and a->>'status' = 'completed'
    ) as self_healing_ai_completed_count,

    (
      select count(*)
      from public.template_imports ti
      cross join lateral jsonb_array_elements(coalesce(ti.meta->'self_healing_retry_audit'->'actions', '[]'::jsonb)) a
      where a->>'safetyLevel' in ('manual_only', 'blocked')
        and a->>'status' = 'completed'
    ) as manual_or_blocked_action_completed_count,

    (
      select count(*)
      from public.template_imports ti
      cross join lateral jsonb_array_elements(coalesce(ti.meta->'production_operator_control_audit'->'controls', '[]'::jsonb)) c
      where c->>'controlId' in ('run_ai_reconciliation_manual', 'apply_repair_manual', 'apply_reconciliation_manual', 'rerun_import_manual')
        and c->>'state' = 'completed'
    ) as manual_operator_control_completed_count
)
select
  completed_imports,
  import_profile_count,
  repair_pattern_count,
  adaptive_policy_count,
  self_healing_count,
  performance_count,
  operator_control_count,
  golden_history_count,
  public_import_artifact_bucket_count,
  self_healing_ai_completed_count,
  manual_or_blocked_action_completed_count,
  manual_operator_control_completed_count,
  case
    when public_import_artifact_bucket_count > 0
      or self_healing_ai_completed_count > 0
      or manual_or_blocked_action_completed_count > 0
      or manual_operator_control_completed_count > 0
    then 'not_locked'
    when completed_imports > 0 and (
      import_profile_count = 0
      or repair_pattern_count = 0
      or adaptive_policy_count = 0
      or self_healing_count = 0
      or performance_count = 0
      or operator_control_count = 0
    )
    then 'locked_with_warnings'
    when golden_history_count = 0
    then 'locked_with_warnings'
    else 'database_phase10_locked'
  end as database_lock_status
from signals;

-- ---------------------------------------------------------------------------
-- 16. Final Phase 10 note
-- ---------------------------------------------------------------------------
select
  'phase_10h_final_production_intelligence_lock' as phase,
  'Final SQL checks database-side readiness only. Build/test results, preview smoke test, source-code safety review, and private artifact checks must also pass before declaring Phase 10 locked.' as note;
