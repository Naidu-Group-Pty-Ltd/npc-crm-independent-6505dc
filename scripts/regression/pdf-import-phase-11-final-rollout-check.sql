-- Phase 11H Final Production Rollout Lock Check
-- Run in Supabase SQL Editor.
--
-- Purpose:
-- Final database-side validation for PDF import production rollout.
--
-- This SQL is read-only.
-- It does not mutate production data.

-- ---------------------------------------------------------------------------
-- 1. Required production tables
-- ---------------------------------------------------------------------------
select
  'template_imports' as object_name,
  to_regclass('public.template_imports') as object_regclass
union all
select 'pdf_import_jobs', to_regclass('public.pdf_import_jobs')
union all
select 'pdf_import_golden_runs', to_regclass('public.pdf_import_golden_runs')
union all
select 'pdf_import_monitoring_events', to_regclass('public.pdf_import_monitoring_events')
union all
select 'pdf_import_retention_events', to_regclass('public.pdf_import_retention_events')
union all
select 'pdf_import_client_reports', to_regclass('public.pdf_import_client_reports');

-- ---------------------------------------------------------------------------
-- 2. Latest imports with production rollout metadata
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
  ti.meta->'performance_cost_audit'->>'overallRiskLevel' as performance_risk_level,

  ti.meta->'production_operator_control_audit'->'operatorState'->>'decision' as operator_decision,
  ti.meta->'production_operator_control_audit'->'operatorState'->>'manualReviewRequired' as operator_manual_review_required,
  ti.meta->'production_operator_control_audit'->'operatorState'->>'blocked' as operator_blocked,

  ti.meta->'golden_regression_summary'->>'qualityGateStatus' as golden_quality_gate_status,
  ti.meta->'export_parity_summary'->>'status' as export_parity_status,

  ti.updated_at
from public.template_imports ti
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 3. Phase 10/11 metadata coverage
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
-- 4. Active monitoring alerts
-- ---------------------------------------------------------------------------
select
  severity,
  status,
  domain,
  count(*) as alert_count,
  max(last_seen_at) as latest_seen_at
from public.pdf_import_monitoring_events
where status in ('open', 'acknowledged')
group by severity, status, domain
order by
  case severity
    when 'critical' then 1
    when 'high' then 2
    when 'warning' then 3
    when 'info' then 4
    else 5
  end,
  alert_count desc;

-- ---------------------------------------------------------------------------
-- 5. Active critical monitoring alerts
-- (Schema note: pdf_import_monitoring_events uses rule_id and has no
--  scope_type/scope_id/recommended_action; runbook_anchor carries the SOP link.)
-- ---------------------------------------------------------------------------
select
  id,
  rule_id,
  domain,
  severity,
  status,
  title,
  summary,
  occurrence_count,
  last_seen_at,
  runbook_anchor
from public.pdf_import_monitoring_events
where status in ('open', 'acknowledged')
  and severity = 'critical'
order by last_seen_at desc;

-- ---------------------------------------------------------------------------
-- 6. Retention candidates
-- ---------------------------------------------------------------------------
select
  decision,
  cleanup_action,
  safety_level,
  status,
  domain,
  count(*) as candidate_count,
  coalesce(sum(estimated_bytes), 0) as estimated_bytes,
  max(last_seen_at) as latest_seen_at
from public.pdf_import_retention_events
where status in ('candidate', 'reviewed', 'approved_for_future_cleanup', 'blocked')
group by decision, cleanup_action, safety_level, status, domain
order by
  case decision
    when 'delete_candidate' then 1
    when 'archive_candidate' then 2
    when 'review' then 3
    when 'blocked' then 4
    else 5
  end,
  candidate_count desc;

-- ---------------------------------------------------------------------------
-- 7. Client reporting safety summary
-- ---------------------------------------------------------------------------
select
  report_type,
  audience,
  safety_level,
  status,
  count(*) as report_count,
  max(generated_at) as latest_generated_at
from public.pdf_import_client_reports
group by report_type, audience, safety_level, status
order by report_count desc;

-- ---------------------------------------------------------------------------
-- 8. Client report unsafe export checks
-- ---------------------------------------------------------------------------
select
  r.id,
  r.report_type,
  r.audience,
  r.safety_level,
  r.status,
  r.export_format,
  case
    when r.status = 'exported' and r.approved_at is null then 'fail_exported_without_approval'
    when r.status = 'exported' and r.safety_level in ('internal_only', 'blocked') then 'fail_exported_unsafe_report'
    when r.status = 'approved' and r.safety_level = 'blocked' then 'fail_approved_blocked_report'
    when r.report_payload::text ilike '%signedUrl%'
      or r.report_payload::text ilike '%signed_url%'
      or r.report_payload::text ilike '%service_role%'
      or r.report_payload::text ilike '%SUPABASE_SERVICE_ROLE_KEY%'
      or r.report_payload::text ilike '%template-import-artifacts%'
      or r.report_payload::text ilike '%storage.objects%'
      or r.report_payload::text ilike '%stack trace%'
      or r.report_payload::text ilike '%Traceback%'
    then 'fail_unsafe_content_pattern'
    else 'pass'
  end as client_report_safety_status,
  r.generated_at,
  r.approved_at,
  r.exported_at
from public.pdf_import_client_reports r
order by r.generated_at desc
limit 200;

-- ---------------------------------------------------------------------------
-- 9. Golden history readiness
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
-- 10. Golden corpus minimum coverage
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
-- 11. Safety violations: self-healing/manual-only
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  action->>'actionId' as action_id,
  action->>'safetyLevel' as safety_level,
  action->>'status' as action_status,
  case
    when action->>'safetyLevel' in ('manual_only', 'blocked')
      and action->>'status' = 'completed'
    then 'critical_manual_or_blocked_action_completed'
    else 'pass'
  end as safety_status,
  ti.updated_at
from public.template_imports ti
cross join lateral jsonb_array_elements(
  coalesce(ti.meta->'self_healing_retry_audit'->'actions', '[]'::jsonb)
) as action
where action->>'safetyLevel' in ('manual_only', 'blocked')
  and action->>'status' = 'completed'
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 12. Safety violations: operator controls
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  control->>'controlId' as control_id,
  control->>'safetyLevel' as safety_level,
  control->>'state' as control_state,
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
  and (
    control->>'controlId' in (
      'run_ai_reconciliation_manual',
      'apply_repair_manual',
      'apply_reconciliation_manual',
      'rerun_import_manual'
    )
    or control->>'safetyLevel' = 'blocked'
  )
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 13. Storage bucket safety
-- ---------------------------------------------------------------------------
select
  b.id as bucket_id,
  b.name,
  b.public,
  case
    when b.id = 'template-import-artifacts' and b.public = true then 'critical_public_import_artifacts_bucket'
    when b.id = 'template-import-artifacts' and b.public = false then 'pass'
    else 'review'
  end as bucket_safety_status,
  b.updated_at
from storage.buckets b
where b.id = 'template-import-artifacts'
   or b.name ilike '%template%'
   or b.name ilike '%import%'
   or b.name ilike '%pdf%';

-- ---------------------------------------------------------------------------
-- 14. Failed imports/jobs
-- (Schema note: pdf_import_jobs has no import_id column; it carries its own
--  source_file_name, so no join to template_imports is possible or needed.)
-- ---------------------------------------------------------------------------
select
  'template_import' as source_type,
  ti.id::text as source_id,
  ti.source_filename,
  ti.status,
  ti.error as error_text,
  ti.updated_at
from public.template_imports ti
where ti.status = 'failed'
   or ti.error is not null

union all

select
  'pdf_import_job',
  pij.id::text,
  pij.source_file_name,
  pij.status,
  coalesce(pij.error_text, pij.error_code) as error_text,
  pij.updated_at
from public.pdf_import_jobs pij
where pij.status = 'failed'
order by updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 15. Metadata size risk
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
-- 16. Required table RLS state
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
    'pdf_import_golden_runs',
    'pdf_import_monitoring_events',
    'pdf_import_retention_events',
    'pdf_import_client_reports'
  )
order by c.relname;

-- ---------------------------------------------------------------------------
-- 17. Final production rollout database lock rollup
-- ---------------------------------------------------------------------------
with signals as (
  select
    (select count(*) from public.pdf_import_monitoring_events where status in ('open', 'acknowledged') and severity = 'critical') as active_critical_alerts,
    (select count(*) from public.pdf_import_monitoring_events where status in ('open', 'acknowledged') and severity = 'high') as active_high_alerts,

    (select count(*) from storage.buckets where id = 'template-import-artifacts' and public = true) as public_artifact_bucket_count,

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

    (
      select count(*)
      from public.pdf_import_client_reports r
      where r.status = 'exported'
        and r.approved_at is null
    ) as exported_without_approval,

    (
      select count(*)
      from public.pdf_import_client_reports r
      where r.status in ('approved', 'exported')
        and r.safety_level in ('internal_only', 'blocked')
    ) as unsafe_approved_or_exported_reports,

    (
      select count(*)
      from public.pdf_import_client_reports r
      where r.report_payload::text ilike '%signedUrl%'
         or r.report_payload::text ilike '%signed_url%'
         or r.report_payload::text ilike '%service_role%'
         or r.report_payload::text ilike '%SUPABASE_SERVICE_ROLE_KEY%'
         or r.report_payload::text ilike '%template-import-artifacts%'
         or r.report_payload::text ilike '%storage.objects%'
         or r.report_payload::text ilike '%stack trace%'
         or r.report_payload::text ilike '%Traceback%'
    ) as unsafe_client_report_content_count,

    (select count(*) from public.template_imports where status = 'failed' or error is not null) as failed_imports,
    (select count(*) from public.pdf_import_jobs where status = 'failed') as failed_jobs,
    (select count(*) from public.pdf_import_golden_runs) as golden_history_rows,
    (select count(*) from public.pdf_import_monitoring_events) as monitoring_event_rows,
    (select count(*) from public.pdf_import_retention_events) as retention_event_rows,
    (select count(*) from public.pdf_import_client_reports) as client_report_rows
)
select
  active_critical_alerts,
  active_high_alerts,
  public_artifact_bucket_count,
  manual_or_blocked_action_completed_count,
  manual_operator_control_completed_count,
  exported_without_approval,
  unsafe_approved_or_exported_reports,
  unsafe_client_report_content_count,
  failed_imports,
  failed_jobs,
  golden_history_rows,
  monitoring_event_rows,
  retention_event_rows,
  client_report_rows,
  case
    when active_critical_alerts > 0
      or public_artifact_bucket_count > 0
      or manual_or_blocked_action_completed_count > 0
      or manual_operator_control_completed_count > 0
      or exported_without_approval > 0
      or unsafe_approved_or_exported_reports > 0
      or unsafe_client_report_content_count > 0
    then 'production_rollout_not_locked'
    when active_high_alerts > 0
      or failed_imports > 0
      or failed_jobs > 0
      or golden_history_rows = 0
      or monitoring_event_rows = 0
      or retention_event_rows = 0
      or client_report_rows = 0
    then 'production_rollout_locked_with_conditions'
    else 'production_rollout_database_locked'
  end as database_production_rollout_lock_status,
  case
    when active_critical_alerts > 0
      or public_artifact_bucket_count > 0
      or manual_or_blocked_action_completed_count > 0
      or manual_operator_control_completed_count > 0
      or exported_without_approval > 0
      or unsafe_approved_or_exported_reports > 0
      or unsafe_client_report_content_count > 0
    then 'blocked'
    when active_high_alerts > 0
      or failed_imports > 0
      or failed_jobs > 0
      or golden_history_rows = 0
    then 'admin_limited'
    when monitoring_event_rows = 0
      or retention_event_rows = 0
      or client_report_rows = 0
    then 'admin_limited'
    else 'controlled_team_rollout'
  end as recommended_rollout_mode
from signals;

-- ---------------------------------------------------------------------------
-- 18. Phase 11H note
-- ---------------------------------------------------------------------------
select
  'phase_11h_final_production_rollout_lock' as phase,
  'Final SQL checks database-side readiness only. Final lock also requires source tests, build, release gate, preview smoke test, permission review, private artifact check, and accepted rollout scope.' as note;
