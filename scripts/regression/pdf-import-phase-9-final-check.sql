-- Phase 9 Final Production Rollout Check
-- Run in Supabase SQL Editor.
--
-- Purpose:
-- Produce the final, read-only production rollout snapshot for the PDF import
-- golden regression framework. This consolidates the Phase 9A-9F database
-- signals into a single Phase 9 rollout decision.
--
-- This SQL is read-only. It does not mutate data, create objects, or run DDL.

-- Stop the script with the documented rollout-blocked status before PostgreSQL
-- plans any later relation-dependent statement when Phase 9 is not deployed.
do $preflight$
declare
  missing_objects text[];
begin
  select array_agg(object_name order by object_name)
  into missing_objects
  from (
    values
      ('public.template_imports', to_regclass('public.template_imports')),
      ('public.report_templates', to_regclass('public.report_templates')),
      ('public.pdf_import_jobs', to_regclass('public.pdf_import_jobs')),
      ('public.pdf_import_golden_runs', to_regclass('public.pdf_import_golden_runs'))
  ) as required_objects(object_name, object_oid)
  where object_oid is null;

  if missing_objects is not null then
    raise exception using
      errcode = 'P0001',
      message = 'production_blocked_missing_database_objects',
      detail = 'Missing required objects: ' || array_to_string(missing_objects, ', '),
      hint = 'Deploy the required Phase 9 database objects before running the rollout snapshot.';
  end if;
end
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. Latest imports with Phase 9 metadata
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.status,
  ti.source_filename,
  ti.created_template_id as template_id,
  ti.meta->'import_manifests_summary'->>'engine_version' as engine_version,
  (ti.meta ? 'visual_quality_summary') as has_visual_quality,
  (ti.meta ? 'visual_repair_summary') as has_visual_repair,
  (ti.meta ? 'export_parity_summary') as has_export_parity,
  ti.meta->'export_parity_summary'->>'status' as export_parity_status,
  (ti.meta ? 'golden_regression_summary') as has_golden_summary,
  ti.meta->'golden_regression_summary'->>'qualityGateStatus' as golden_quality_gate_status,
  ti.created_at,
  ti.updated_at
from public.template_imports ti
order by ti.updated_at desc
limit 25;

-- ---------------------------------------------------------------------------
-- 2. Golden run history rows
-- ---------------------------------------------------------------------------
select
  gr.id as history_id,
  gr.run_id,
  gr.corpus_id,
  gr.import_id,
  gr.template_id,
  gr.quality_gate_status,
  gr.operator_decision,
  gr.visual_qa_score,
  gr.repair_final_score,
  gr.export_vs_source_score,
  gr.warning_count,
  gr.failure_count,
  gr.baseline_comparison->>'outcome' as baseline_outcome,
  gr.created_at
from public.pdf_import_golden_runs gr
order by gr.created_at desc
limit 50;

-- ---------------------------------------------------------------------------
-- 3. Corpus coverage
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
latest_history as (
  select distinct on (corpus_id)
    corpus_id,
    quality_gate_status,
    operator_decision,
    created_at,
    baseline_comparison->>'outcome' as baseline_outcome
  from public.pdf_import_golden_runs
  order by corpus_id, created_at desc
)
select
  rc.corpus_id,
  lh.quality_gate_status,
  lh.operator_decision,
  lh.baseline_outcome,
  lh.created_at as latest_run_at,
  case
    when lh.corpus_id is null then 'not_covered'
    when lh.quality_gate_status in ('fail', 'blocked') then 'covered_blocking'
    when lh.operator_decision in ('rejected', 'needs_rerun') then 'covered_operator_blocking'
    when lh.baseline_outcome = 'degraded' then 'covered_regression_warning'
    when lh.quality_gate_status = 'warning' then 'covered_warning'
    when lh.quality_gate_status = 'pass' then 'covered_pass'
    else 'covered_unknown'
  end as coverage_status
from required_corpus rc
left join latest_history lh
  on lh.corpus_id = rc.corpus_id
order by rc.corpus_id;

-- ---------------------------------------------------------------------------
-- 4. Export parity readiness
-- ---------------------------------------------------------------------------
select
  count(*) filter (where meta ? 'export_parity_summary') as imports_with_export_parity,
  count(*) filter (where meta->'export_parity_summary'->>'status' = 'completed') as export_parity_completed,
  count(*) filter (where meta->'export_parity_summary'->>'status' = 'manual_required') as export_parity_manual_required,
  count(*) filter (where meta->'export_parity_summary'->>'status' = 'failed') as export_parity_failed,
  count(*) filter (where meta->'export_parity_summary'->>'automationLevel' = 'level_3_source_editor_export') as export_level_3,
  count(*) filter (where meta->'export_parity_summary'->>'automationLevel' = 'level_2_source_editor') as export_level_2,
  count(*) filter (where meta->'export_parity_summary'->>'automationLevel' = 'level_1_manual_compatible') as export_level_1
from public.template_imports;

-- ---------------------------------------------------------------------------
-- 5. Database object readiness
-- ---------------------------------------------------------------------------
select
  to_regclass('public.template_imports') is not null as template_imports_exists,
  to_regclass('public.report_templates') is not null as report_templates_exists,
  to_regclass('public.pdf_import_jobs') is not null as pdf_import_jobs_exists,
  to_regclass('public.pdf_import_golden_runs') is not null as pdf_import_golden_runs_exists,
  exists (
    select 1 from storage.buckets where id = 'template-import-artifacts'
  ) as template_import_artifacts_bucket_exists;

-- ---------------------------------------------------------------------------
-- 6. Golden run history indexes
-- ---------------------------------------------------------------------------
select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'pdf_import_golden_runs'
order by indexname;

-- ---------------------------------------------------------------------------
-- 7. Monitoring snapshot
-- ---------------------------------------------------------------------------
with alert_counts as (
  select
    count(*) filter (where severity = 'critical') as critical_count,
    count(*) filter (where severity = 'error') as error_count,
    count(*) filter (where severity = 'warning') as warning_count
  from (
    with metrics as (
      select
        (select count(*) from public.template_imports where status = 'failed' and updated_at >= now() - interval '24 hours') as failed_imports_24h,
        (select count(*) from public.template_imports where status not in ('completed', 'failed') and updated_at < now() - interval '30 minutes') as stuck_imports_30m,
        (select count(*) from public.pdf_import_jobs where status = 'failed' and updated_at >= now() - interval '24 hours') as failed_diagnostics_jobs_24h,
        (select count(*) from public.template_imports where meta->'golden_regression_summary'->>'qualityGateStatus' = 'fail') as golden_quality_gate_failed,
        (select count(*) from public.template_imports where meta->'golden_regression_summary'->>'qualityGateStatus' = 'blocked') as golden_quality_gate_blocked,
        (select count(*) from public.template_imports where meta->'export_parity_summary'->>'status' = 'failed') as export_parity_failed,
        (select count(*) from public.pdf_import_golden_runs where baseline_comparison->>'outcome' = 'degraded') as baseline_degraded_count,
        (select count(distinct corpus_id) from public.pdf_import_golden_runs) as corpus_covered_count
    )
    select 'critical' as severity from metrics where golden_quality_gate_failed >= 1
    union all select 'critical' from metrics where golden_quality_gate_blocked >= 1
    union all select 'error' from metrics where failed_imports_24h >= 1 and failed_imports_24h < 3
    union all select 'critical' from metrics where failed_imports_24h >= 3
    union all select 'error' from metrics where stuck_imports_30m >= 1
    union all select 'error' from metrics where failed_diagnostics_jobs_24h >= 1
    union all select 'error' from metrics where export_parity_failed >= 1
    union all select 'warning' from metrics where baseline_degraded_count >= 1
    union all select 'warning' from metrics where corpus_covered_count < 6
  ) a
)
select
  critical_count,
  error_count,
  warning_count,
  case
    when critical_count > 0 then 'critical_alerts_present'
    when error_count > 0 then 'errors_present'
    when warning_count > 0 then 'warnings_present'
    else 'healthy'
  end as monitoring_status
from alert_counts;

-- ---------------------------------------------------------------------------
-- 8. Release gate database readiness
-- ---------------------------------------------------------------------------
with release_counts as (
  select
    (select count(*) from public.pdf_import_golden_runs) as history_count,
    (select count(distinct corpus_id) from public.pdf_import_golden_runs) as corpus_covered,
    (select count(*) from public.pdf_import_golden_runs where quality_gate_status in ('fail', 'blocked')) as history_blocking,
    (select count(*) from public.pdf_import_golden_runs where operator_decision in ('rejected', 'needs_rerun')) as operator_blocking,
    (select count(*) from public.pdf_import_golden_runs where baseline_comparison->>'outcome' = 'degraded') as degraded_count,
    (select count(*) from public.template_imports where meta->'export_parity_summary'->>'status' = 'failed') as export_failed_count
)
select
  history_count,
  corpus_covered,
  history_blocking,
  operator_blocking,
  degraded_count,
  export_failed_count,
  case
    when history_blocking > 0 or operator_blocking > 0 or export_failed_count > 0 then 'release_blocked_database'
    when history_count = 0 then 'release_ready_with_warnings_no_history_runs'
    when corpus_covered < 6 then 'release_ready_with_warnings_partial_corpus_coverage'
    when degraded_count > 0 then 'release_ready_with_warnings_baseline_degraded'
    else 'release_ready_database'
  end as database_release_gate_status
from release_counts;

-- ---------------------------------------------------------------------------
-- 9. Production attention rows
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.status,
  ti.source_filename,
  ti.created_template_id as template_id,
  ti.meta->'golden_regression_summary'->>'qualityGateStatus' as golden_quality_gate_status,
  ti.meta->'golden_regression_summary'->>'operatorDecision' as operator_decision,
  ti.meta->'export_parity_summary'->>'status' as export_parity_status,
  ti.error,
  ti.updated_at
from public.template_imports ti
where ti.status = 'failed'
  or (ti.status not in ('completed', 'failed') and ti.updated_at < now() - interval '30 minutes')
  or ti.meta->'golden_regression_summary'->>'qualityGateStatus' in ('fail', 'blocked')
  or ti.meta->'golden_regression_summary'->>'operatorDecision' in ('rejected', 'needs_rerun')
  or ti.meta->'export_parity_summary'->>'status' = 'failed'
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 10. Final Phase 9 database rollout decision
-- ---------------------------------------------------------------------------
with readiness as (
  select
    to_regclass('public.template_imports') is not null as template_imports_exists,
    to_regclass('public.report_templates') is not null as report_templates_exists,
    to_regclass('public.pdf_import_jobs') is not null as pdf_import_jobs_exists,
    to_regclass('public.pdf_import_golden_runs') is not null as golden_runs_exists,
    (select count(*) from public.pdf_import_golden_runs) as history_count,
    (select count(distinct corpus_id) from public.pdf_import_golden_runs) as corpus_covered,
    (select count(*) from public.pdf_import_golden_runs where quality_gate_status in ('fail', 'blocked')) as history_blocking,
    (select count(*) from public.pdf_import_golden_runs where operator_decision in ('rejected', 'needs_rerun')) as operator_blocking,
    (select count(*) from public.pdf_import_golden_runs where baseline_comparison->>'outcome' = 'degraded') as degraded_count,
    (select count(*) from public.template_imports where meta->'golden_regression_summary'->>'qualityGateStatus' = 'fail') as golden_gate_failed,
    (select count(*) from public.template_imports where meta->'golden_regression_summary'->>'qualityGateStatus' = 'blocked') as golden_gate_blocked,
    (select count(*) from public.template_imports where meta->'export_parity_summary'->>'status' = 'failed') as export_failed_count
)
select
  template_imports_exists,
  report_templates_exists,
  pdf_import_jobs_exists,
  golden_runs_exists,
  history_count,
  corpus_covered,
  history_blocking,
  operator_blocking,
  degraded_count,
  golden_gate_failed,
  golden_gate_blocked,
  export_failed_count,
  case
    when not (
      template_imports_exists
      and report_templates_exists
      and pdf_import_jobs_exists
      and golden_runs_exists
    ) then 'production_blocked_missing_database_objects'
    when history_blocking > 0
      or operator_blocking > 0
      or golden_gate_failed > 0
      or golden_gate_blocked > 0
      or export_failed_count > 0 then 'production_blocked_database'
    when history_count = 0 then 'production_ready_with_warnings_no_history_runs'
    when corpus_covered < 6 then 'production_ready_with_warnings_partial_corpus_coverage'
    when degraded_count > 0 then 'production_ready_with_warnings_baseline_degraded'
    else 'production_ready_database'
  end as final_phase_9_database_rollout_decision
from readiness;

-- ---------------------------------------------------------------------------
-- 11. Phase 9G note
-- ---------------------------------------------------------------------------
select
  'phase_9g_production_rollout_lock' as phase,
  'This SQL produces the final read-only Phase 9 database rollout decision. Local tests/build/private-artifact checks (pdf-import-phase-9-release-check.sh / pdf-import-phase-9-final-local-check.sh) and the manual browser smoke test must also pass before rollout.' as note;
