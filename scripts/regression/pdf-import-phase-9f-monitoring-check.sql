-- Phase 9F Monitoring + Alert Readiness Check
-- Run in Supabase SQL Editor.
--
-- Purpose:
-- Produce a read-only monitoring snapshot for PDF import, export parity,
-- golden regression, baseline history, and release readiness.
--
-- This SQL does not mutate data.

-- ---------------------------------------------------------------------------
-- 1. Monitoring metric snapshot
-- ---------------------------------------------------------------------------
with metrics as (
  select
    -- Import pipeline
    (
      select count(*)
      from public.template_imports ti
      where ti.status = 'failed'
        and ti.updated_at >= now() - interval '24 hours'
    ) as failed_imports_24h,

    (
      select count(*)
      from public.template_imports ti
      where ti.status not in ('completed', 'failed')
        and ti.updated_at < now() - interval '30 minutes'
    ) as stuck_imports_30m,

    -- Diagnostics / sidecar
    (
      select count(*)
      from public.pdf_import_jobs pij
      where pij.status = 'failed'
        and pij.updated_at >= now() - interval '24 hours'
    ) as failed_diagnostics_jobs_24h,

    (
      select count(*)
      from public.template_imports ti
      where ti.status = 'completed'
        and ti.meta->'import_manifests_summary'->>'engine_version' is null
    ) as completed_imports_without_engine_version,

    -- Artifact / Visual QA / Repair
    (
      select count(*)
      from public.template_imports ti
      where ti.status = 'completed'
        and ti.meta->>'visual_quality_artifact_path' is null
    ) as completed_imports_missing_visual_qa,

    (
      select count(*)
      from public.template_imports ti
      where ti.status = 'completed'
        and ti.meta->>'visual_quality_artifact_path' is not null
        and ti.meta->>'visual_repair_artifact_path' is null
    ) as visual_qa_missing_repair_audit,

    -- Export parity
    (
      select count(*)
      from public.template_imports ti
      where ti.status = 'completed'
        and ti.created_template_id is not null
        and ti.meta->>'visual_quality_artifact_path' is not null
        and ti.meta->>'visual_repair_artifact_path' is not null
        and ti.meta->>'export_parity_artifact_path' is null
    ) as golden_ready_missing_export_parity,

    (
      select count(*)
      from public.template_imports ti
      where ti.meta->'export_parity_summary'->>'status' = 'failed'
    ) as export_parity_failed,

    (
      select count(*)
      from public.template_imports ti
      where ti.meta->'export_parity_summary'->>'status' = 'manual_required'
    ) as export_parity_manual_required,

    -- Manual review rate
    (
      select count(*)
      from public.template_imports ti
      where ti.status = 'completed'
        and ti.updated_at >= now() - interval '30 days'
    ) as recent_completed_imports,

    (
      select count(*)
      from public.template_imports ti
      where ti.status = 'completed'
        and ti.updated_at >= now() - interval '30 days'
        and (
          ti.meta->'visual_quality_summary'->>'manualReviewRequired' = 'true'
          or ti.meta->'visual_repair_summary'->>'requiresManualReview' = 'true'
        )
    ) as recent_manual_review_required,

    -- Golden regression
    (
      select count(*)
      from public.template_imports ti
      where ti.meta->'golden_regression_summary'->>'qualityGateStatus' = 'fail'
    ) as golden_quality_gate_failed,

    (
      select count(*)
      from public.template_imports ti
      where ti.meta->'golden_regression_summary'->>'qualityGateStatus' = 'blocked'
    ) as golden_quality_gate_blocked,

    (
      select count(*)
      from public.template_imports ti
      where ti.meta ? 'golden_regression_summary'
    ) as golden_summaries_count,

    (
      select count(*)
      from public.pdf_import_golden_runs
    ) as golden_history_rows_count,

    (
      select count(distinct corpus_id)
      from public.pdf_import_golden_runs
    ) as corpus_covered_count,

    (
      select count(*)
      from public.pdf_import_golden_runs
      where baseline_comparison->>'outcome' = 'degraded'
    ) as baseline_degraded_count,

    -- Release gate blockers
    (
      select case
        when exists (
          select 1
          from public.pdf_import_golden_runs
          where quality_gate_status in ('fail', 'blocked')
             or operator_decision in ('rejected', 'needs_rerun')
        )
        or exists (
          select 1
          from public.template_imports
          where meta->'export_parity_summary'->>'status' = 'failed'
        )
        then true
        else false
      end
    ) as release_blocked_database,

    -- Backend contract approximation
    (
      select count(*)
      from public.template_imports ti
      where coalesce(ti.error, '') ilike '%unknown operation%'
         or coalesce(ti.error, '') ilike '%operation does not exist%'
         or ti.meta::text ilike '%unknown operation%'
    ) as backend_unknown_operation_count,

    -- SQL cannot inspect local git artifacts; always 0 here.
    0 as private_artifact_risk_count
)
select * from metrics;

-- ---------------------------------------------------------------------------
-- 2. Derived monitoring alerts
-- ---------------------------------------------------------------------------
with metrics as (
  select
    (
      select count(*)
      from public.template_imports ti
      where ti.status = 'failed'
        and ti.updated_at >= now() - interval '24 hours'
    ) as failed_imports_24h,
    (
      select count(*)
      from public.template_imports ti
      where ti.status not in ('completed', 'failed')
        and ti.updated_at < now() - interval '30 minutes'
    ) as stuck_imports_30m,
    (
      select count(*)
      from public.pdf_import_jobs pij
      where pij.status = 'failed'
        and pij.updated_at >= now() - interval '24 hours'
    ) as failed_diagnostics_jobs_24h,
    (
      select count(*)
      from public.template_imports ti
      where ti.status = 'completed'
        and ti.meta->'import_manifests_summary'->>'engine_version' is null
    ) as completed_imports_without_engine_version,
    (
      select count(*)
      from public.template_imports ti
      where ti.status = 'completed'
        and ti.meta->>'visual_quality_artifact_path' is null
    ) as completed_imports_missing_visual_qa,
    (
      select count(*)
      from public.template_imports ti
      where ti.status = 'completed'
        and ti.meta->>'visual_quality_artifact_path' is not null
        and ti.meta->>'visual_repair_artifact_path' is null
    ) as visual_qa_missing_repair_audit,
    (
      select count(*)
      from public.template_imports ti
      where ti.status = 'completed'
        and ti.created_template_id is not null
        and ti.meta->>'visual_quality_artifact_path' is not null
        and ti.meta->>'visual_repair_artifact_path' is not null
        and ti.meta->>'export_parity_artifact_path' is null
    ) as golden_ready_missing_export_parity,
    (
      select count(*)
      from public.template_imports ti
      where ti.meta->'export_parity_summary'->>'status' = 'failed'
    ) as export_parity_failed,
    (
      select count(*)
      from public.template_imports ti
      where ti.meta->'export_parity_summary'->>'status' = 'manual_required'
    ) as export_parity_manual_required,
    (
      select count(*)
      from public.template_imports ti
      where ti.status = 'completed'
        and ti.updated_at >= now() - interval '30 days'
    ) as recent_completed_imports,
    (
      select count(*)
      from public.template_imports ti
      where ti.status = 'completed'
        and ti.updated_at >= now() - interval '30 days'
        and (
          ti.meta->'visual_quality_summary'->>'manualReviewRequired' = 'true'
          or ti.meta->'visual_repair_summary'->>'requiresManualReview' = 'true'
        )
    ) as recent_manual_review_required,
    (
      select count(*)
      from public.template_imports ti
      where ti.meta->'golden_regression_summary'->>'qualityGateStatus' = 'fail'
    ) as golden_quality_gate_failed,
    (
      select count(*)
      from public.template_imports ti
      where ti.meta->'golden_regression_summary'->>'qualityGateStatus' = 'blocked'
    ) as golden_quality_gate_blocked,
    (
      select count(*)
      from public.template_imports ti
      where ti.meta ? 'golden_regression_summary'
    ) as golden_summaries_count,
    (
      select count(*)
      from public.pdf_import_golden_runs
    ) as golden_history_rows_count,
    (
      select count(distinct corpus_id)
      from public.pdf_import_golden_runs
    ) as corpus_covered_count,
    (
      select count(*)
      from public.pdf_import_golden_runs
      where baseline_comparison->>'outcome' = 'degraded'
    ) as baseline_degraded_count,
    (
      select case
        when exists (
          select 1
          from public.pdf_import_golden_runs
          where quality_gate_status in ('fail', 'blocked')
             or operator_decision in ('rejected', 'needs_rerun')
        )
        or exists (
          select 1
          from public.template_imports
          where meta->'export_parity_summary'->>'status' = 'failed'
        )
        then true
        else false
      end
    ) as release_blocked_database,
    (
      select count(*)
      from public.template_imports ti
      where coalesce(ti.error, '') ilike '%unknown operation%'
         or coalesce(ti.error, '') ilike '%operation does not exist%'
         or ti.meta::text ilike '%unknown operation%'
    ) as backend_unknown_operation_count
),
alerts as (
  select
    'failed_imports_recent' as code,
    'import_pipeline' as domain,
    case when failed_imports_24h >= 3 then 'critical' else 'error' end as severity,
    failed_imports_24h::text as metric_value,
    'Recent PDF imports failed.' as message
  from metrics
  where failed_imports_24h >= 1

  union all

  select
    'stuck_imports_recent',
    'import_pipeline',
    'error',
    stuck_imports_30m::text,
    'PDF imports are stuck for more than 30 minutes.'
  from metrics
  where stuck_imports_30m >= 1

  union all

  select
    'diagnostics_jobs_failed',
    'sidecar_diagnostics',
    'error',
    failed_diagnostics_jobs_24h::text,
    'PDF diagnostics/sidecar jobs failed in the last 24 hours.'
  from metrics
  where failed_diagnostics_jobs_24h >= 1

  union all

  select
    'engine_version_missing',
    'sidecar_diagnostics',
    'warning',
    completed_imports_without_engine_version::text,
    'Completed imports are missing engine version metadata.'
  from metrics
  where completed_imports_without_engine_version > 0

  union all

  select
    'visual_quality_missing',
    'visual_quality',
    'warning',
    completed_imports_missing_visual_qa::text,
    'Completed imports are missing Visual QA artifacts.'
  from metrics
  where completed_imports_missing_visual_qa >= 1

  union all

  select
    'repair_audit_missing',
    'repair',
    'warning',
    visual_qa_missing_repair_audit::text,
    'Imports with Visual QA are missing repair audits.'
  from metrics
  where visual_qa_missing_repair_audit >= 1

  union all

  select
    'export_parity_missing',
    'export_parity',
    'warning',
    golden_ready_missing_export_parity::text,
    'Golden-ready imports are missing export parity.'
  from metrics
  where golden_ready_missing_export_parity > 0

  union all

  select
    'export_parity_failed',
    'export_parity',
    'error',
    export_parity_failed::text,
    'Export parity failures are present.'
  from metrics
  where export_parity_failed >= 1

  union all

  select
    'export_parity_manual_required',
    'export_parity',
    'warning',
    export_parity_manual_required::text,
    'Export parity manual review is required.'
  from metrics
  where export_parity_manual_required > 0

  union all

  select
    'manual_review_rate_high',
    'visual_quality',
    'warning',
    case
      when recent_completed_imports = 0 then '0'
      else round((recent_manual_review_required::numeric / recent_completed_imports::numeric), 2)::text
    end,
    'Manual review rate is above 50 percent.'
  from metrics
  where recent_completed_imports > 0
    and (recent_manual_review_required::numeric / recent_completed_imports::numeric) > 0.5

  union all

  select
    'golden_quality_gate_failed',
    'golden_regression',
    'critical',
    golden_quality_gate_failed::text,
    'Golden quality gate failures are present.'
  from metrics
  where golden_quality_gate_failed >= 1

  union all

  select
    'golden_quality_gate_blocked',
    'golden_regression',
    'critical',
    golden_quality_gate_blocked::text,
    'Golden quality gates are blocked.'
  from metrics
  where golden_quality_gate_blocked >= 1

  union all

  select
    'golden_summary_missing',
    'golden_regression',
    'warning',
    golden_summaries_count::text,
    'No golden regression summaries are present.'
  from metrics
  where golden_summaries_count = 0

  union all

  select
    'golden_history_missing',
    'golden_regression',
    'warning',
    golden_history_rows_count::text,
    'No golden run history rows are present.'
  from metrics
  where golden_history_rows_count = 0

  union all

  select
    'corpus_coverage_incomplete',
    'golden_regression',
    'warning',
    corpus_covered_count::text,
    'Golden corpus coverage is incomplete.'
  from metrics
  where corpus_covered_count < 6

  union all

  select
    'baseline_degraded',
    'golden_regression',
    'warning',
    baseline_degraded_count::text,
    'One or more baseline comparisons are degraded.'
  from metrics
  where baseline_degraded_count >= 1

  union all

  select
    'release_blocked_database',
    'release_gates',
    'critical',
    release_blocked_database::text,
    'Database-side release gate is blocked.'
  from metrics
  where release_blocked_database = true

  union all

  select
    'backend_unknown_operation',
    'backend_contract',
    'critical',
    backend_unknown_operation_count::text,
    'Backend unknown operation signals were detected.'
  from metrics
  where backend_unknown_operation_count >= 1
)
select
  code,
  domain,
  severity,
  metric_value,
  message,
  case
    when severity = 'critical' then 'immediate_attention'
    when severity = 'error' then 'action_required'
    when severity = 'warning' then 'review'
    else 'info'
  end as recommended_response
from alerts
order by
  case severity
    when 'critical' then 1
    when 'error' then 2
    when 'warning' then 3
    else 4
  end,
  code;

-- ---------------------------------------------------------------------------
-- 3. Recent failed/stuck imports
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.status,
  ti.source_filename,
  ti.created_template_id as template_id,
  ti.error,
  ti.created_at,
  ti.updated_at,
  now() - ti.updated_at as age_since_update
from public.template_imports ti
where ti.status = 'failed'
   or (
     ti.status not in ('completed', 'failed')
     and ti.updated_at < now() - interval '30 minutes'
   )
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 4. Recent failed diagnostics jobs
--    (pdf_import_jobs links to a template via template_id; there is no import_id column)
-- ---------------------------------------------------------------------------
select
  pij.id as job_id,
  pij.template_id,
  pij.status,
  pij.stage,
  pij.engine,
  pij.engine_version,
  pij.error_code,
  pij.error_text,
  pij.duration_ms,
  pij.created_at,
  pij.updated_at
from public.pdf_import_jobs pij
where pij.status = 'failed'
   or (
     -- pdf_import_jobs terminal statuses are 'succeeded' / 'failed'
     pij.status not in ('succeeded', 'completed', 'failed')
     and pij.updated_at < now() - interval '30 minutes'
   )
order by pij.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 5. Golden regression monitoring rows requiring attention
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
where gr.quality_gate_status in ('fail', 'blocked', 'not_evaluated')
   or gr.operator_decision in ('rejected', 'needs_rerun', 'not_reviewed')
   or gr.failure_count > 0
   or gr.baseline_comparison->>'outcome' = 'degraded'
order by gr.created_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 6. Monitoring summary decision
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
  end as monitoring_status,
  case
    when critical_count > 0 then 'release_blocked_until_reviewed'
    when error_count > 0 then 'release_should_pause_until_errors_reviewed'
    when warning_count > 0 then 'release_possible_with_documented_warnings'
    else 'release_monitoring_clear'
  end as release_monitoring_decision
from alert_counts;

-- ---------------------------------------------------------------------------
-- 7. Phase 9F note
-- ---------------------------------------------------------------------------
select
  'phase_9f_monitoring_alert_readiness' as phase,
  'This SQL produces monitoring signals only. External alert delivery is intentionally deferred.' as note;
