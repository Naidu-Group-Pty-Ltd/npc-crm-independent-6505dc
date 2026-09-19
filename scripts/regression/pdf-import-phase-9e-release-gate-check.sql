-- Phase 9E CI / Release Quality Gate Check
-- Run in Supabase SQL Editor.
--
-- Purpose:
-- Validate database-side release readiness for the PDF import golden regression framework.
--
-- This SQL is read-only.

-- ---------------------------------------------------------------------------
-- 1. Golden regression latest summary distribution
-- ---------------------------------------------------------------------------
select
  count(*) filter (where meta ? 'golden_regression_summary') as imports_with_golden_summary,
  count(*) filter (where meta->'golden_regression_summary'->>'qualityGateStatus' = 'pass') as golden_pass,
  count(*) filter (where meta->'golden_regression_summary'->>'qualityGateStatus' = 'warning') as golden_warning,
  count(*) filter (where meta->'golden_regression_summary'->>'qualityGateStatus' = 'fail') as golden_fail,
  count(*) filter (where meta->'golden_regression_summary'->>'qualityGateStatus' = 'blocked') as golden_blocked,
  count(*) filter (where meta->'golden_regression_summary'->>'operatorDecision' in ('rejected', 'needs_rerun')) as operator_blocking
from public.template_imports;

-- ---------------------------------------------------------------------------
-- 2. Golden run history distribution
-- ---------------------------------------------------------------------------
select
  count(*) as total_history_rows,
  count(distinct corpus_id) as corpus_covered,
  count(*) filter (where quality_gate_status = 'pass') as history_pass,
  count(*) filter (where quality_gate_status = 'warning') as history_warning,
  count(*) filter (where quality_gate_status = 'fail') as history_fail,
  count(*) filter (where quality_gate_status = 'blocked') as history_blocked,
  count(*) filter (where operator_decision in ('rejected', 'needs_rerun')) as history_operator_blocking,
  count(*) filter (where baseline_comparison->>'outcome' = 'degraded') as baseline_degraded
from public.pdf_import_golden_runs;

-- ---------------------------------------------------------------------------
-- 3. Corpus coverage status
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
  end as release_coverage_status
from required_corpus rc
left join latest_history lh
  on lh.corpus_id = rc.corpus_id
order by rc.corpus_id;

-- ---------------------------------------------------------------------------
-- 4. Export parity release readiness
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
-- 5. Recent blocking rows
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.created_template_id as template_id,
  ti.meta->'golden_regression_summary'->>'corpusId' as corpus_id,
  ti.meta->'golden_regression_summary'->>'qualityGateStatus' as quality_gate_status,
  ti.meta->'golden_regression_summary'->>'operatorDecision' as operator_decision,
  ti.meta->'golden_regression_summary'->'failures' as failures,
  ti.meta->'export_parity_summary'->>'status' as export_parity_status,
  ti.updated_at
from public.template_imports ti
where
  ti.status = 'failed'
  or ti.meta->'golden_regression_summary'->>'qualityGateStatus' in ('fail', 'blocked')
  or ti.meta->'golden_regression_summary'->>'operatorDecision' in ('rejected', 'needs_rerun')
  or ti.meta->'export_parity_summary'->>'status' = 'failed'
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 6. Release gate database decision
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
-- 7. Phase 9E note
-- ---------------------------------------------------------------------------
select
  'phase_9e_ci_release_gates' as phase,
  'This SQL validates database-side release readiness. Local tests/build/private-artifact checks must be run with scripts/regression/pdf-import-phase-9-release-check.sh.' as note;
