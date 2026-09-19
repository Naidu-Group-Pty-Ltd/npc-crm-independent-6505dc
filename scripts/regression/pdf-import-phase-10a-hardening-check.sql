-- Phase 10A Production Readiness Hardening Check
-- Run in Supabase SQL Editor.
--
-- Purpose:
-- Database-side hardening audit for the PDF import system.
--
-- This SQL is read-only.
-- It does not mutate production data.
--
-- Schema notes (verified against the live project during Phase 10A):
--   * public.pdf_import_jobs has NO import_id column; it links to a template via
--     template_id. The spec template referenced pij.import_id — corrected here to
--     pij.template_id so the query runs.
--   * public.pdf_import_jobs terminal/status values are
--     'succeeded' / 'failed' / 'recoverable_failed' / 'queued' (there is no
--     'completed'). Summary filters below account for that.

-- ---------------------------------------------------------------------------
-- 1. Recent import health
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.status,
  ti.source_filename,
  ti.page_count,
  ti.created_template_id as template_id,
  ti.meta->'import_manifests_summary'->>'engine_version' as engine_version,
  ti.meta->'import_manifests_summary'->>'job_id' as pdf_job_id,
  ti.meta->>'visual_quality_artifact_path' as visual_quality_artifact_path,
  ti.meta->>'visual_repair_artifact_path' as visual_repair_artifact_path,
  ti.meta->>'export_parity_artifact_path' as export_parity_artifact_path,
  ti.meta->'golden_regression_summary'->>'qualityGateStatus' as golden_quality_gate_status,
  ti.error,
  ti.created_at,
  ti.updated_at
from public.template_imports ti
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 2. Import health summary
-- ---------------------------------------------------------------------------
select
  count(*) as total_imports,
  count(*) filter (where status = 'completed') as completed_imports,
  count(*) filter (where status = 'failed') as failed_imports,
  count(*) filter (where status not in ('completed', 'failed')) as in_progress_or_other_imports,
  count(*) filter (where created_template_id is not null) as imports_with_template,
  count(*) filter (where meta->>'visual_quality_artifact_path' is not null) as imports_with_visual_quality,
  count(*) filter (where meta->>'visual_repair_artifact_path' is not null) as imports_with_repair,
  count(*) filter (where meta->>'export_parity_artifact_path' is not null) as imports_with_export_parity,
  count(*) filter (where meta ? 'golden_regression_summary') as imports_with_golden_regression
from public.template_imports;

-- ---------------------------------------------------------------------------
-- 3. Recent failed imports and errors
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.status,
  ti.error,
  ti.meta->'import_manifests_summary'->>'job_id' as pdf_job_id,
  ti.created_at,
  ti.updated_at
from public.template_imports ti
where ti.status = 'failed'
   or ti.error is not null
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 4. Artifact path completeness for completed imports
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.created_template_id as template_id,
  case
    when ti.created_template_id is null then 'missing_template'
    when ti.meta->>'visual_quality_artifact_path' is null then 'missing_visual_quality'
    when ti.meta->>'visual_repair_artifact_path' is null then 'missing_repair_audit'
    when ti.meta->>'export_parity_artifact_path' is null then 'missing_export_parity'
    else 'phase9_quality_artifacts_present'
  end as artifact_readiness,
  ti.updated_at
from public.template_imports ti
where ti.status = 'completed'
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 5. Storage object presence for critical artifact paths
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
-- 6. Storage bucket visibility check
--    CRITICAL: template-import-artifacts.public MUST be false.
-- ---------------------------------------------------------------------------
select
  b.id as bucket_id,
  b.name,
  b.public,
  b.file_size_limit,
  b.allowed_mime_types,
  b.created_at,
  b.updated_at
from storage.buckets b
where b.id in ('template-import-artifacts')
   or b.name ilike '%template%'
   or b.name ilike '%import%'
   or b.name ilike '%pdf%';

-- ---------------------------------------------------------------------------
-- 7. Golden regression summary integrity
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.meta->'golden_regression_summary'->>'version' as version,
  ti.meta->'golden_regression_summary'->>'runId' as run_id,
  ti.meta->'golden_regression_summary'->>'corpusId' as corpus_id,
  ti.meta->'golden_regression_summary'->>'qualityGateStatus' as quality_gate_status,
  ti.meta->'golden_regression_summary'->>'operatorDecision' as operator_decision,
  ti.meta->'golden_regression_summary'->>'persistedAt' as persisted_at,
  jsonb_array_length(coalesce(ti.meta->'golden_regression_summary'->'warnings', '[]'::jsonb)) as warning_count,
  jsonb_array_length(coalesce(ti.meta->'golden_regression_summary'->'failures', '[]'::jsonb)) as failure_count,
  case
    when not (ti.meta ? 'golden_regression_summary') then 'not_applicable'
    when ti.meta->'golden_regression_summary'->>'version' is null then 'fail_missing_version'
    when ti.meta->'golden_regression_summary'->>'runId' is null then 'fail_missing_run_id'
    when ti.meta->'golden_regression_summary'->>'corpusId' is null then 'fail_missing_corpus_id'
    when ti.meta->'golden_regression_summary'->>'qualityGateStatus' is null then 'fail_missing_quality_gate_status'
    when ti.meta->'golden_regression_summary'->>'operatorDecision' is null then 'fail_missing_operator_decision'
    when ti.meta->'golden_regression_summary'->>'persistedAt' is null then 'warning_missing_persisted_at'
    else 'pass'
  end as integrity_status,
  ti.updated_at
from public.template_imports ti
where ti.meta ? 'golden_regression_summary'
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 8. Golden run history integrity
-- ---------------------------------------------------------------------------
select
  gr.id as history_id,
  gr.run_id,
  gr.corpus_id,
  gr.category,
  gr.import_id,
  gr.template_id,
  gr.quality_gate_status,
  gr.operator_decision,
  gr.warning_count,
  gr.failure_count,
  gr.baseline_comparison->>'outcome' as baseline_outcome,
  case
    when ti.id is null then 'fail_missing_import_reference'
    when gr.run_id is null or length(trim(gr.run_id)) = 0 then 'fail_missing_run_id'
    when gr.corpus_id is null or length(trim(gr.corpus_id)) = 0 then 'fail_missing_corpus_id'
    when gr.quality_gate_status not in ('pass', 'warning', 'fail', 'blocked', 'not_evaluated') then 'fail_invalid_quality_gate_status'
    when gr.operator_decision not in ('accepted', 'accepted_with_warnings', 'rejected', 'needs_rerun', 'not_reviewed') then 'fail_invalid_operator_decision'
    when gr.warning_count < 0 or gr.failure_count < 0 then 'fail_invalid_counts'
    else 'pass'
  end as history_integrity_status,
  gr.created_at
from public.pdf_import_golden_runs gr
left join public.template_imports ti
  on ti.id = gr.import_id
order by gr.created_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 9. Golden history summary
-- ---------------------------------------------------------------------------
select
  count(*) as total_history_rows,
  count(distinct corpus_id) as distinct_corpus_ids,
  count(*) filter (where quality_gate_status = 'pass') as pass_count,
  count(*) filter (where quality_gate_status = 'warning') as warning_count,
  count(*) filter (where quality_gate_status = 'fail') as fail_count,
  count(*) filter (where quality_gate_status = 'blocked') as blocked_count,
  count(*) filter (where baseline_comparison->>'outcome' = 'degraded') as degraded_baseline_count
from public.pdf_import_golden_runs;

-- ---------------------------------------------------------------------------
-- 10. Export parity integrity
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.meta->'export_parity_summary'->>'status' as export_parity_status,
  ti.meta->'export_parity_summary'->>'mode' as export_parity_mode,
  ti.meta->'export_parity_summary'->>'automationLevel' as automation_level,
  ti.meta->'export_parity_summary'->>'exportVsSourceScore' as export_vs_source_score,
  ti.meta->'export_parity_summary'->>'editorVsSourceScore' as editor_vs_source_score,
  ti.meta->'export_parity_summary'->>'exportVsEditorScore' as export_vs_editor_score,
  ti.meta->'export_parity_summary'->'warnings' as warnings,
  ti.meta->'export_parity_summary'->'blockers' as blockers,
  case
    when not (ti.meta ? 'export_parity_summary') then 'not_run'
    when ti.meta->'export_parity_summary'->>'status' is null then 'fail_missing_status'
    when ti.meta->'export_parity_summary'->>'status' = 'failed' then 'fail_export_parity_failed'
    when ti.meta->'export_parity_summary'->>'status' = 'manual_required' then 'warning_manual_required'
    when ti.meta->>'export_parity_artifact_path' is null then 'warning_missing_artifact_path'
    else 'pass'
  end as export_parity_integrity_status,
  ti.updated_at
from public.template_imports ti
where ti.meta ? 'export_parity_summary'
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 11. PDF import job diagnostics health
--    (pdf_import_jobs links to a template via template_id — there is no
--     import_id column.)
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
order by pij.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 12. PDF import job diagnostics summary
--    (terminal success status is 'succeeded'; 'failed' and 'recoverable_failed'
--     are the failure states.)
-- ---------------------------------------------------------------------------
select
  count(*) as total_jobs,
  count(*) filter (where status in ('succeeded', 'completed')) as completed_jobs,
  count(*) filter (where status in ('failed', 'recoverable_failed')) as failed_jobs,
  count(*) filter (where engine_version is null) as jobs_missing_engine_version,
  count(*) filter (where duration_ms > 60000) as jobs_over_60s,
  count(*) filter (where duration_ms > 180000) as jobs_over_180s
from public.pdf_import_jobs;

-- ---------------------------------------------------------------------------
-- 13. RLS policy visibility for relevant tables
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
-- 14. Table RLS enabled state
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
-- 15. Potential long-running/stale imports
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.status,
  ti.source_filename,
  ti.created_at,
  ti.updated_at,
  now() - ti.updated_at as time_since_update,
  ti.error
from public.template_imports ti
where ti.status not in ('completed', 'failed')
  and ti.updated_at < now() - interval '30 minutes'
order by ti.updated_at asc
limit 100;

-- ---------------------------------------------------------------------------
-- 16. Action-required golden runs
-- ---------------------------------------------------------------------------
select
  gr.id as history_id,
  gr.run_id,
  gr.corpus_id,
  gr.import_id,
  gr.quality_gate_status,
  gr.operator_decision,
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
-- 17. Hardening readiness summary
-- ---------------------------------------------------------------------------
with signals as (
  select
    (select count(*) from public.template_imports where status = 'failed' or error is not null) as failed_imports,
    (select count(*) from public.template_imports where status not in ('completed', 'failed') and updated_at < now() - interval '30 minutes') as stale_imports,
    (select count(*) from public.template_imports where status = 'completed' and created_template_id is null) as completed_without_template,
    (select count(*) from public.template_imports where status = 'completed' and meta->>'visual_quality_artifact_path' is null) as missing_visual_quality,
    (select count(*) from public.template_imports where meta ? 'golden_regression_summary' and meta->'golden_regression_summary'->>'qualityGateStatus' in ('fail', 'blocked')) as failing_golden_summaries,
    (select count(*) from public.pdf_import_golden_runs where quality_gate_status in ('fail', 'blocked')) as failing_golden_history_rows,
    (select count(*) from public.pdf_import_jobs where status in ('failed', 'recoverable_failed')) as failed_pdf_jobs,
    (select count(*) from public.pdf_import_jobs where engine_version is null) as jobs_missing_engine_version
)
select
  failed_imports,
  stale_imports,
  completed_without_template,
  missing_visual_quality,
  failing_golden_summaries,
  failing_golden_history_rows,
  failed_pdf_jobs,
  jobs_missing_engine_version,
  case
    when completed_without_template > 0
      or failing_golden_summaries > 0
      or failing_golden_history_rows > 0 then 'not_ready_blockers_present'
    when failed_imports > 0
      or stale_imports > 0
      or missing_visual_quality > 0
      or failed_pdf_jobs > 0
      or jobs_missing_engine_version > 0 then 'ready_with_warnings'
    else 'database_hardening_ready'
  end as database_hardening_status
from signals;

-- ---------------------------------------------------------------------------
-- 18. Phase 10A note
-- ---------------------------------------------------------------------------
select
  'phase_10a_production_hardening_audit' as phase,
  'This SQL checks database-side hardening signals only. Source-code auth contracts, frontend route protection, private artifact checks, and sidecar configuration must be reviewed in the repo and deployment environment.' as note;
