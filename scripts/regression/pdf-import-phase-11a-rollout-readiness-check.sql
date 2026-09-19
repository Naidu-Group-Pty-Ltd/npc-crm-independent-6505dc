-- Phase 11A Production Rollout Readiness Check
-- Run in Supabase SQL Editor.
--
-- Purpose:
-- Database-side rollout readiness review for PDF import production rollout.
--
-- This SQL is read-only.
-- It does not mutate production data.

-- ---------------------------------------------------------------------------
-- 1. Latest imports rollout readiness snapshot
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
  ti.meta->'adaptive_reconciliation_policy'->'flags'->>'aiBlocked' as ai_blocked,

  ti.meta->'self_healing_retry_audit'->>'status' as self_healing_status,

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
-- 2. Phase 10 metadata rollout coverage
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
-- 3. Imports missing rollout-critical metadata
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.status,
  ti.created_template_id as template_id,
  case when not (ti.meta ? 'import_intelligence_profile') then 'missing_import_intelligence' end as import_intelligence_gap,
  case when not (ti.meta ? 'repair_pattern_analysis') then 'missing_repair_patterns' end as repair_pattern_gap,
  case when not (ti.meta ? 'adaptive_reconciliation_policy') then 'missing_adaptive_policy' end as adaptive_policy_gap,
  case when not (ti.meta ? 'self_healing_retry_audit') then 'missing_self_healing' end as self_healing_gap,
  case when not (ti.meta ? 'performance_cost_audit') then 'missing_performance_audit' end as performance_gap,
  case when not (ti.meta ? 'production_operator_control_audit') then 'missing_operator_controls' end as operator_controls_gap,
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
-- 4. Operator state distribution
-- ---------------------------------------------------------------------------
select
  coalesce(ti.meta->'production_operator_control_audit'->'operatorState'->>'decision', 'missing') as operator_decision,
  coalesce(ti.meta->'production_operator_control_audit'->'operatorState'->>'manualReviewRequired', 'missing') as manual_review_required,
  coalesce(ti.meta->'production_operator_control_audit'->'operatorState'->>'blocked', 'missing') as operator_blocked,
  count(*) as import_count
from public.template_imports ti
group by
  coalesce(ti.meta->'production_operator_control_audit'->'operatorState'->>'decision', 'missing'),
  coalesce(ti.meta->'production_operator_control_audit'->'operatorState'->>'manualReviewRequired', 'missing'),
  coalesce(ti.meta->'production_operator_control_audit'->'operatorState'->>'blocked', 'missing')
order by import_count desc;

-- ---------------------------------------------------------------------------
-- 5. AI safety rollout check
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.meta->'adaptive_reconciliation_policy'->>'decision' as adaptive_decision,
  ti.meta->'adaptive_reconciliation_policy'->'flags'->>'aiBlocked' as ai_blocked,
  ti.meta->'ai_reconciliation_summary'->>'status' as ai_status,
  case
    when exists (
      select 1
      from jsonb_array_elements(coalesce(ti.meta->'self_healing_retry_audit'->'actions', '[]'::jsonb)) a
      where a->>'actionId' = 'run_ai_reconciliation'
        and a->>'status' = 'completed'
    ) then 'critical_self_healing_completed_ai_action'
    when (ti.meta->'adaptive_reconciliation_policy'->'flags'->>'aiBlocked')::boolean = true
      and ti.meta->'ai_reconciliation_summary'->>'status' = 'completed'
    then 'review_ai_completed_despite_blocked_policy'
    else 'pass_or_not_applicable'
  end as ai_rollout_safety_status,
  ti.updated_at
from public.template_imports ti
where ti.meta ? 'adaptive_reconciliation_policy'
   or ti.meta ? 'self_healing_retry_audit'
   or ti.meta ? 'ai_reconciliation_summary'
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 6. Manual-only / blocked action rollout safety
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
    then 'critical_manual_only_action_completed'
    when action->>'safetyLevel' = 'blocked'
      and action->>'status' = 'completed'
    then 'critical_blocked_action_completed'
    else 'pass'
  end as self_healing_action_safety_status,
  ti.updated_at
from public.template_imports ti
cross join lateral jsonb_array_elements(
  coalesce(ti.meta->'self_healing_retry_audit'->'actions', '[]'::jsonb)
) as action
where ti.meta ? 'self_healing_retry_audit'
order by ti.updated_at desc
limit 200;

-- ---------------------------------------------------------------------------
-- 7. Operator control rollout safety
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  control->>'controlId' as control_id,
  control->>'safetyLevel' as safety_level,
  control->>'state' as control_state,
  control->>'blockedReason' as blocked_reason,
  case
    when control->>'controlId' in (
      'run_ai_reconciliation_manual',
      'apply_repair_manual',
      'apply_reconciliation_manual',
      'rerun_import_manual'
    )
      and control->>'state' = 'completed'
    then 'critical_manual_control_completed_automatically'
    when control->>'safetyLevel' = 'blocked'
      and control->>'state' in ('available', 'recommended', 'completed')
    then 'critical_blocked_control_available'
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
-- 8. Golden history readiness
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
-- 9. Golden corpus minimum coverage
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
-- 10. Export parity readiness
-- ---------------------------------------------------------------------------
select
  coalesce(ti.meta->'export_parity_summary'->>'status', 'missing') as export_parity_status,
  coalesce(ti.meta->'export_parity_summary'->>'mode', 'missing') as export_parity_mode,
  coalesce(ti.meta->'export_parity_summary'->>'automationLevel', 'unknown') as automation_level,
  count(*) as import_count
from public.template_imports ti
group by
  coalesce(ti.meta->'export_parity_summary'->>'status', 'missing'),
  coalesce(ti.meta->'export_parity_summary'->>'mode', 'missing'),
  coalesce(ti.meta->'export_parity_summary'->>'automationLevel', 'unknown')
order by import_count desc;

-- ---------------------------------------------------------------------------
-- 11. PDF import job health
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
-- 12. Recent failed/stale jobs requiring rollout attention
-- (pdf_import_jobs links to templates via template_id and carries its own
--  source_file_name; there is no import_id column on this table.)
-- ---------------------------------------------------------------------------
select
  pij.id as job_id,
  pij.template_id,
  pij.source_file_name,
  pij.status,
  pij.stage,
  pij.engine,
  pij.engine_version,
  pij.duration_ms,
  pij.error_code,
  pij.error_text,
  pij.created_at,
  pij.updated_at
from public.pdf_import_jobs pij
where pij.status = 'failed'
   or pij.engine_version is null
   or pij.duration_ms > 180000
order by pij.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 13. Storage bucket safety
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
-- 14. Artifact path/storage object presence
-- ---------------------------------------------------------------------------
with artifact_paths as (
  select
    ti.id as import_id,
    ti.source_filename,
    'visual_quality' as artifact_type,
    ti.meta->>'visual_quality_artifact_path' as artifact_path
  from public.template_imports ti
  where ti.meta->>'visual_quality_artifact_path' is not null

  union all

  select
    ti.id,
    ti.source_filename,
    'visual_repair',
    ti.meta->>'visual_repair_artifact_path'
  from public.template_imports ti
  where ti.meta->>'visual_repair_artifact_path' is not null

  union all

  select
    ti.id,
    ti.source_filename,
    'export_parity',
    ti.meta->>'export_parity_artifact_path'
  from public.template_imports ti
  where ti.meta->>'export_parity_artifact_path' is not null
)
select
  ap.import_id,
  ap.source_filename,
  ap.artifact_type,
  ap.artifact_path,
  count(o.id) as storage_object_count,
  case
    when count(o.id) = 1 then 'pass'
    when count(o.id) = 0 then 'missing_storage_object'
    else 'duplicate_storage_objects'
  end as storage_status,
  max(o.created_at) as object_created_at,
  max(o.updated_at) as object_updated_at
from artifact_paths ap
left join storage.objects o
  on o.bucket_id = 'template-import-artifacts'
 and o.name = ap.artifact_path
group by ap.import_id, ap.source_filename, ap.artifact_type, ap.artifact_path
order by ap.import_id, ap.artifact_type
limit 300;

-- ---------------------------------------------------------------------------
-- 15. RLS policy visibility
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
-- 16. Metadata size risk
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
-- 17. Database rollout readiness rollup
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
    ) as manual_operator_control_completed_count,

    (select count(*) from public.pdf_import_jobs where status = 'failed') as failed_pdf_jobs,

    (select count(*) from public.pdf_import_jobs where duration_ms > 180000) as long_running_pdf_jobs
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
  failed_pdf_jobs,
  long_running_pdf_jobs,
  case
    when public_import_artifact_bucket_count > 0
      or self_healing_ai_completed_count > 0
      or manual_or_blocked_action_completed_count > 0
      or manual_operator_control_completed_count > 0
    then 'rollout_not_ready'
    when completed_imports > 0 and (
      import_profile_count = 0
      or repair_pattern_count = 0
      or adaptive_policy_count = 0
      or self_healing_count = 0
      or performance_count = 0
      or operator_control_count = 0
    )
    then 'rollout_ready_with_conditions'
    when golden_history_count = 0
      or failed_pdf_jobs > 0
      or long_running_pdf_jobs > 0
    then 'rollout_ready_with_conditions'
    else 'database_rollout_ready_for_admin_limited'
  end as database_rollout_readiness_status,
  case
    when public_import_artifact_bucket_count > 0
      or self_healing_ai_completed_count > 0
      or manual_or_blocked_action_completed_count > 0
      or manual_operator_control_completed_count > 0
    then 'blocked'
    else 'admin_limited'
  end as recommended_initial_rollout_mode
from signals;

-- ---------------------------------------------------------------------------
-- 18. Phase 11A note
-- ---------------------------------------------------------------------------
select
  'phase_11a_production_rollout_readiness_review' as phase,
  'This SQL checks database-side rollout readiness only. Permissions, monitoring, alerting, runbooks, rollback procedures, CI gates, and private artifact checks must also be reviewed before rollout.' as note;
