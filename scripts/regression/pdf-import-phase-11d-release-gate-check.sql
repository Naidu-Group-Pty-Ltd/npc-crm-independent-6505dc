-- Phase 11D Release Gate / CI Integration Check
-- Run in the Supabase SQL Editor.
--
-- Purpose:
-- Database-side validation signals for PDF import release gate readiness.
--
-- This SQL is READ-ONLY. It mutates nothing. It never uploads PDFs, calls AI,
-- runs imports, or applies repairs/reconciliation.
--
-- NOTE: pdf_import_jobs has NO import_id column — never join it to
-- template_imports. Columns used below are the real schema:
--   template_imports(id, status, source_filename, error, meta, updated_at)
--   pdf_import_jobs(id, source_file_name, status, error_code, error_text, updated_at)
--   pdf_import_monitoring_events(rule_id, domain, severity, status, title,
--     occurrence_count, last_seen_at, runbook_anchor, ...)

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
select 'pdf_import_monitoring_events', to_regclass('public.pdf_import_monitoring_events');

-- ---------------------------------------------------------------------------
-- 2. Monitoring active critical/high alerts
-- ---------------------------------------------------------------------------
select
  severity,
  status,
  count(*) as alert_count,
  max(last_seen_at) as latest_seen_at
from public.pdf_import_monitoring_events
where status in ('open', 'acknowledged')
  and severity in ('critical', 'high')
group by severity, status
order by severity, status;

-- ---------------------------------------------------------------------------
-- 3. Release-blocking (critical) monitoring alerts
-- ---------------------------------------------------------------------------
select
  id,
  rule_id,
  domain,
  severity,
  status,
  title,
  release_blocking,
  occurrence_count,
  last_seen_at,
  runbook_anchor
from public.pdf_import_monitoring_events
where status in ('open', 'acknowledged')
  and severity = 'critical'
order by last_seen_at desc;

-- ---------------------------------------------------------------------------
-- 4. Golden history readiness
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
-- 5. Golden corpus minimum coverage
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
  select corpus_id, count(*) as run_count, max(created_at) as latest_run_at
  from public.pdf_import_golden_runs
  group by corpus_id
)
select
  rc.corpus_id,
  coalesce(hc.run_count, 0) as run_count,
  hc.latest_run_at,
  case when hc.run_count is null then 'warning_no_history_yet' else 'covered' end as corpus_history_status
from required_corpus rc
left join history_counts hc on hc.corpus_id = rc.corpus_id
order by rc.corpus_id;

-- ---------------------------------------------------------------------------
-- 6. Recent failed imports/jobs
-- (pdf_import_jobs has no import_id — do not join it to template_imports)
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
-- 7. Safety violations: self-healing / manual-only actions auto-completed
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
    then 'release_blocker_manual_or_blocked_action_completed'
    else 'pass'
  end as release_gate_safety_status,
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
-- 8. Safety violations: operator controls
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
    then 'release_blocker_manual_control_completed_automatically'
    when control->>'safetyLevel' = 'blocked'
      and control->>'state' in ('available', 'recommended', 'completed')
    then 'release_blocker_blocked_control_available'
    else 'pass'
  end as release_gate_operator_safety_status,
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
-- 9. Storage bucket safety
-- ---------------------------------------------------------------------------
select
  b.id as bucket_id,
  b.name,
  b.public,
  case
    when b.id = 'template-import-artifacts' and b.public = true then 'release_blocker_public_import_artifacts_bucket'
    when b.id = 'template-import-artifacts' and b.public = false then 'pass'
    else 'review'
  end as release_gate_bucket_status,
  b.updated_at
from storage.buckets b
where b.id = 'template-import-artifacts'
   or b.name ilike '%template%'
   or b.name ilike '%import%'
   or b.name ilike '%pdf%';

-- ---------------------------------------------------------------------------
-- 10. Permission/monitoring table RLS state
-- ---------------------------------------------------------------------------
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as force_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'template_imports',
    'report_templates',
    'pdf_import_jobs',
    'pdf_import_golden_runs',
    'pdf_import_monitoring_events'
  )
order by c.relname;

-- ---------------------------------------------------------------------------
-- 11. Metadata size release risk
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
-- 12. Database-side release gate rollup
-- ---------------------------------------------------------------------------
with signals as (
  select
    (select count(*) from public.pdf_import_monitoring_events where status in ('open', 'acknowledged') and severity = 'critical') as active_critical_alerts,
    (select count(*) from public.pdf_import_monitoring_events where status in ('open', 'acknowledged') and severity = 'high') as active_high_alerts,
    (select count(*) from public.template_imports where status = 'failed' or error is not null) as failed_imports,
    (select count(*) from public.pdf_import_jobs where status = 'failed') as failed_jobs,
    (select count(*) from public.pdf_import_golden_runs) as golden_history_rows,
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
    ) as manual_operator_control_completed_count
)
select
  active_critical_alerts,
  active_high_alerts,
  failed_imports,
  failed_jobs,
  golden_history_rows,
  public_artifact_bucket_count,
  manual_or_blocked_action_completed_count,
  manual_operator_control_completed_count,
  case
    when active_critical_alerts > 0
      or public_artifact_bucket_count > 0
      or manual_or_blocked_action_completed_count > 0
      or manual_operator_control_completed_count > 0
    then 'release_gate_database_fail'
    when active_high_alerts > 0
      or failed_imports > 0
      or failed_jobs > 0
      or golden_history_rows = 0
    then 'release_gate_database_pass_with_warnings'
    else 'release_gate_database_pass'
  end as database_release_gate_status
from signals;

-- ---------------------------------------------------------------------------
-- 13. Phase 11D note
-- ---------------------------------------------------------------------------
select
  'phase_11d_release_gate_ci_integration' as phase,
  'This SQL validates database-side release signals. The CI/static gate must also run source checks, tests, build, private-artifact scan, and unsafe-pattern scan.' as note;
