-- Phase 9C Regression History + Baseline Comparison Check
-- Run in Supabase SQL Editor.
--
-- Purpose:
-- Validate public.pdf_import_golden_runs historical ledger and baseline readiness.
--
-- This SQL is read-only.

-- ---------------------------------------------------------------------------
-- 1. Latest golden run history rows
-- ---------------------------------------------------------------------------
select
  gr.id as history_id,
  gr.run_id,
  gr.run_batch_id,
  gr.corpus_id,
  gr.category,
  gr.import_id,
  gr.template_id,
  gr.source_filename,
  gr.engine_version,
  gr.quality_gate_status,
  gr.operator_decision,
  gr.visual_qa_score,
  gr.repair_final_score,
  gr.export_vs_source_score,
  gr.warning_count,
  gr.failure_count,
  gr.baseline_comparison->>'outcome' as baseline_outcome,
  gr.created_by,
  gr.created_at,
  gr.updated_at
from public.pdf_import_golden_runs gr
order by gr.created_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 2. Latest run per corpus
-- ---------------------------------------------------------------------------
with ranked as (
  select
    gr.*,
    row_number() over (
      partition by gr.corpus_id
      order by gr.created_at desc
    ) as rn
  from public.pdf_import_golden_runs gr
)
select
  id as history_id,
  run_id,
  corpus_id,
  category,
  import_id,
  template_id,
  quality_gate_status,
  operator_decision,
  visual_qa_score,
  repair_final_score,
  export_vs_source_score,
  warning_count,
  failure_count,
  baseline_comparison->>'outcome' as baseline_outcome,
  created_at
from ranked
where rn = 1
order by corpus_id;

-- ---------------------------------------------------------------------------
-- 3. Golden corpus coverage
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
    count(*) filter (where quality_gate_status = 'pass') as pass_count,
    count(*) filter (where quality_gate_status = 'warning') as warning_count,
    count(*) filter (where quality_gate_status = 'fail') as fail_count,
    count(*) filter (where quality_gate_status = 'blocked') as blocked_count,
    max(created_at) as latest_run_at
  from public.pdf_import_golden_runs
  group by corpus_id
)
select
  rc.corpus_id,
  coalesce(hc.run_count, 0) as run_count,
  coalesce(hc.pass_count, 0) as pass_count,
  coalesce(hc.warning_count, 0) as warning_count,
  coalesce(hc.fail_count, 0) as fail_count,
  coalesce(hc.blocked_count, 0) as blocked_count,
  hc.latest_run_at,
  case
    when hc.run_count is null then 'not_yet_run'
    when hc.fail_count > 0 or hc.blocked_count > 0 then 'covered_with_failures'
    when hc.warning_count > 0 then 'covered_with_warnings'
    when hc.pass_count > 0 then 'covered_pass'
    else 'covered_unknown'
  end as coverage_status
from required_corpus rc
left join history_counts hc
  on hc.corpus_id = rc.corpus_id
order by rc.corpus_id;

-- ---------------------------------------------------------------------------
-- 4. History rows requiring attention
-- ---------------------------------------------------------------------------
select
  gr.id as history_id,
  gr.run_id,
  gr.corpus_id,
  gr.import_id,
  gr.template_id,
  gr.quality_gate_status,
  gr.operator_decision,
  gr.warning_count,
  gr.failure_count,
  gr.warnings,
  gr.failures,
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
-- 5. Baseline comparison outcomes
-- ---------------------------------------------------------------------------
select
  gr.corpus_id,
  gr.baseline_comparison->>'outcome' as baseline_outcome,
  count(*) as run_count,
  max(gr.created_at) as latest_created_at
from public.pdf_import_golden_runs gr
group by gr.corpus_id, gr.baseline_comparison->>'outcome'
order by gr.corpus_id, baseline_outcome;

-- ---------------------------------------------------------------------------
-- 6. Score trend by corpus
-- ---------------------------------------------------------------------------
select
  gr.corpus_id,
  gr.created_at,
  gr.run_id,
  gr.quality_gate_status,
  gr.operator_decision,
  gr.visual_qa_score,
  gr.repair_final_score,
  gr.export_vs_source_score,
  gr.warning_count,
  gr.failure_count
from public.pdf_import_golden_runs gr
order by gr.corpus_id, gr.created_at desc
limit 200;

-- ---------------------------------------------------------------------------
-- 7. History/meta consistency check
-- ---------------------------------------------------------------------------
select
  gr.id as history_id,
  gr.import_id,
  gr.run_id as history_run_id,
  ti.meta->'golden_regression_summary'->>'runId' as latest_meta_run_id,
  gr.corpus_id as history_corpus_id,
  ti.meta->'golden_regression_summary'->>'corpusId' as latest_meta_corpus_id,
  gr.quality_gate_status as history_quality_gate_status,
  ti.meta->'golden_regression_summary'->>'qualityGateStatus' as latest_meta_quality_gate_status,
  case
    when not (ti.meta ? 'golden_regression_summary') then 'meta_summary_missing'
    when gr.run_id = ti.meta->'golden_regression_summary'->>'runId' then 'matches_latest_meta'
    else 'history_row_not_latest_meta'
  end as consistency_status,
  gr.created_at
from public.pdf_import_golden_runs gr
left join public.template_imports ti
  on ti.id = gr.import_id
order by gr.created_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 8. Duplicate run IDs for review
-- ---------------------------------------------------------------------------
select
  run_id,
  corpus_id,
  import_id,
  count(*) as duplicate_count,
  min(created_at) as first_seen_at,
  max(created_at) as last_seen_at
from public.pdf_import_golden_runs
group by run_id, corpus_id, import_id
having count(*) > 1
order by duplicate_count desc, last_seen_at desc;

-- ---------------------------------------------------------------------------
-- 9. Overall history summary
-- ---------------------------------------------------------------------------
select
  count(*) as total_history_rows,
  count(distinct corpus_id) as distinct_corpus_count,
  count(distinct import_id) as distinct_import_count,
  count(*) filter (where quality_gate_status = 'pass') as pass_count,
  count(*) filter (where quality_gate_status = 'warning') as warning_count,
  count(*) filter (where quality_gate_status = 'fail') as fail_count,
  count(*) filter (where quality_gate_status = 'blocked') as blocked_count,
  count(*) filter (where baseline_comparison->>'outcome' = 'improved') as improved_count,
  count(*) filter (where baseline_comparison->>'outcome' = 'stable') as stable_count,
  count(*) filter (where baseline_comparison->>'outcome' = 'degraded') as degraded_count,
  count(*) filter (where baseline_comparison->>'outcome' = 'no_baseline') as no_baseline_count
from public.pdf_import_golden_runs;

-- ---------------------------------------------------------------------------
-- 10. Phase 9C readiness note
-- ---------------------------------------------------------------------------
select
  'phase_9c_regression_history_baselines' as phase,
  'History table should store one row per golden regression run. Baseline comparison allows future release gates to detect regressions.' as note;
