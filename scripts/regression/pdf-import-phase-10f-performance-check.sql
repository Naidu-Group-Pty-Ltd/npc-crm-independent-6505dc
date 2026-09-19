-- Phase 10F Performance + Cost Optimization Check
-- Run in Supabase SQL Editor.
--
-- Purpose:
-- Validate performance_cost_audit metadata coverage and performance/cost signals.
--
-- This SQL is read-only.

-- ---------------------------------------------------------------------------
-- 1. Latest imports with performance/cost audit
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.status,
  ti.source_filename,
  ti.page_count,
  ti.created_template_id as template_id,

  ti.meta->'performance_cost_audit'->>'version' as audit_version,
  ti.meta->'performance_cost_audit'->>'overallCostLevel' as overall_cost_level,
  ti.meta->'performance_cost_audit'->>'overallRiskLevel' as overall_risk_level,
  ti.meta->'performance_cost_audit'->>'estimatedCostScore' as estimated_cost_score,
  ti.meta->'performance_cost_audit'->>'estimatedWasteScore' as estimated_waste_score,

  jsonb_array_length(coalesce(ti.meta->'performance_cost_audit'->'recommendations', '[]'::jsonb)) as recommendation_count,
  jsonb_array_length(coalesce(ti.meta->'performance_cost_audit'->'warnings', '[]'::jsonb)) as warning_count,
  jsonb_array_length(coalesce(ti.meta->'performance_cost_audit'->'blockers', '[]'::jsonb)) as blocker_count,

  ti.meta->'import_intelligence_profile'->>'profileCategory' as profile_category,
  ti.meta->'import_intelligence_profile'->>'riskLevel' as import_risk_level,
  ti.meta->'adaptive_reconciliation_policy'->>'decision' as adaptive_decision,
  ti.meta->'self_healing_retry_audit'->>'status' as self_healing_status,
  ti.meta->'export_parity_summary'->>'status' as export_parity_status,
  ti.meta->'golden_regression_summary'->>'qualityGateStatus' as golden_quality_gate_status,

  ti.meta->'performance_cost_audit'->>'generatedAt' as generated_at,
  ti.meta->'performance_cost_audit'->>'persistedAt' as persisted_at,
  ti.updated_at
from public.template_imports ti
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 2. Performance audit coverage summary
-- ---------------------------------------------------------------------------
select
  count(*) as total_imports,
  count(*) filter (where meta ? 'performance_cost_audit') as imports_with_performance_audit,
  count(*) filter (where status = 'completed') as completed_imports,
  count(*) filter (where status = 'completed' and meta ? 'performance_cost_audit') as completed_imports_with_audit,
  count(*) filter (where status = 'completed' and not (meta ? 'performance_cost_audit')) as completed_imports_without_audit
from public.template_imports;

-- ---------------------------------------------------------------------------
-- 3. Cost/risk distribution
-- ---------------------------------------------------------------------------
select
  coalesce(meta->'performance_cost_audit'->>'overallCostLevel', 'missing') as overall_cost_level,
  coalesce(meta->'performance_cost_audit'->>'overallRiskLevel', 'missing') as overall_risk_level,
  count(*) as import_count
from public.template_imports
group by
  coalesce(meta->'performance_cost_audit'->>'overallCostLevel', 'missing'),
  coalesce(meta->'performance_cost_audit'->>'overallRiskLevel', 'missing')
order by import_count desc;

-- ---------------------------------------------------------------------------
-- 4. Optimization recommendations expansion
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  rec->>'id' as recommendation_id,
  rec->>'domain' as domain,
  rec->>'action' as action,
  rec->>'severity' as severity,
  rec->>'costLevel' as cost_level,
  rec->>'confidence' as confidence,
  rec->>'message' as message,
  ti.updated_at
from public.template_imports ti
cross join lateral jsonb_array_elements(
  coalesce(ti.meta->'performance_cost_audit'->'recommendations', '[]'::jsonb)
) as rec
where ti.meta ? 'performance_cost_audit'
order by ti.updated_at desc
limit 300;

-- ---------------------------------------------------------------------------
-- 5. High-risk/high-cost audits requiring attention
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.created_template_id as template_id,
  ti.meta->'performance_cost_audit'->>'overallCostLevel' as overall_cost_level,
  ti.meta->'performance_cost_audit'->>'overallRiskLevel' as overall_risk_level,
  ti.meta->'performance_cost_audit'->>'estimatedWasteScore' as estimated_waste_score,
  ti.meta->'performance_cost_audit'->'recommendations' as recommendations,
  ti.meta->'performance_cost_audit'->'warnings' as warnings,
  ti.meta->'performance_cost_audit'->'blockers' as blockers,
  ti.updated_at
from public.template_imports ti
where ti.meta ? 'performance_cost_audit'
  and (
    ti.meta->'performance_cost_audit'->>'overallCostLevel' in ('high', 'very_high')
    or ti.meta->'performance_cost_audit'->>'overallRiskLevel' in ('high', 'critical')
    or nullif(ti.meta->'performance_cost_audit'->>'estimatedWasteScore', '')::numeric >= 0.65
    or jsonb_array_length(coalesce(ti.meta->'performance_cost_audit'->'blockers', '[]'::jsonb)) > 0
  )
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 6. Staleness expansion
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  stale->>'metadataKey' as metadata_key,
  stale->>'status' as staleness_status,
  stale->>'reason' as reason,
  stale->>'generatedAt' as generated_at,
  stale->'dependsOn' as depends_on,
  ti.updated_at
from public.template_imports ti
cross join lateral jsonb_array_elements(
  coalesce(ti.meta->'performance_cost_audit'->'staleness', '[]'::jsonb)
) as stale
where ti.meta ? 'performance_cost_audit'
order by ti.updated_at desc
limit 300;

-- ---------------------------------------------------------------------------
-- 7. Long-running PDF import jobs
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
where pij.duration_ms > 60000
   or pij.status = 'failed'
   or pij.engine_version is null
order by pij.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 8. Golden history volume by corpus
-- ---------------------------------------------------------------------------
select
  gr.corpus_id,
  count(*) as history_count,
  count(*) filter (where gr.quality_gate_status = 'pass') as pass_count,
  count(*) filter (where gr.quality_gate_status = 'warning') as warning_count,
  count(*) filter (where gr.quality_gate_status in ('fail', 'blocked')) as fail_or_blocked_count,
  min(gr.created_at) as first_run_at,
  max(gr.created_at) as latest_run_at
from public.pdf_import_golden_runs gr
group by gr.corpus_id
order by history_count desc;

-- ---------------------------------------------------------------------------
-- 9. Metadata size approximation
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  pg_column_size(ti.meta) as meta_size_bytes,
  case
    when pg_column_size(ti.meta) > 500000 then 'high_meta_size'
    when pg_column_size(ti.meta) > 200000 then 'medium_meta_size'
    else 'normal'
  end as meta_size_status,
  ti.updated_at
from public.template_imports ti
order by pg_column_size(ti.meta) desc
limit 100;

-- ---------------------------------------------------------------------------
-- 10. Imports that may not need AI reconciliation
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.meta->'adaptive_reconciliation_policy'->>'decision' as adaptive_decision,
  ti.meta->'adaptive_reconciliation_policy'->>'recommendedAction' as recommended_action,
  ti.meta->'ai_reconciliation_summary'->>'status' as ai_status,
  ti.meta->'performance_cost_audit'->>'overallCostLevel' as cost_level,
  ti.meta->'performance_cost_audit'->>'overallRiskLevel' as risk_level,
  case
    when ti.meta->'adaptive_reconciliation_policy'->>'decision' in ('not_needed', 'blocked')
      and ti.meta->'ai_reconciliation_summary'->>'status' = 'completed' then 'review_ai_used_despite_policy'
    when ti.meta->'adaptive_reconciliation_policy'->>'decision' = 'not_needed' then 'avoid_ai_reconciliation'
    when ti.meta->'adaptive_reconciliation_policy'->>'decision' = 'blocked' then 'ai_blocked'
    else 'neutral'
  end as ai_cost_recommendation,
  ti.updated_at
from public.template_imports ti
where ti.meta ? 'adaptive_reconciliation_policy'
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 11. Performance audit integrity validation
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.meta->'performance_cost_audit'->>'version' as version,
  ti.meta->'performance_cost_audit'->>'overallCostLevel' as overall_cost_level,
  ti.meta->'performance_cost_audit'->>'overallRiskLevel' as overall_risk_level,
  ti.meta->'performance_cost_audit'->>'estimatedCostScore' as estimated_cost_score,
  ti.meta->'performance_cost_audit'->>'estimatedWasteScore' as estimated_waste_score,
  case
    when not (ti.meta ? 'performance_cost_audit') then 'missing_audit'
    when ti.meta->'performance_cost_audit'->>'version' is null then 'fail_missing_version'
    when ti.meta->'performance_cost_audit'->>'overallCostLevel' not in ('negligible', 'low', 'medium', 'high', 'very_high', 'unknown') then 'fail_invalid_cost_level'
    when ti.meta->'performance_cost_audit'->>'overallRiskLevel' not in ('low', 'medium', 'high', 'critical', 'unknown') then 'fail_invalid_risk_level'
    when ti.meta->'performance_cost_audit'->'recommendations' is null then 'fail_missing_recommendations'
    when ti.meta->'performance_cost_audit'->'stepCosts' is null then 'fail_missing_step_costs'
    when ti.meta->'performance_cost_audit'->'staleness' is null then 'fail_missing_staleness'
    else 'pass'
  end as audit_integrity_status,
  ti.updated_at
from public.template_imports ti
where ti.meta ? 'performance_cost_audit'
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 12. Summary counts
-- ---------------------------------------------------------------------------
select
  count(*) as total_imports,
  count(*) filter (where meta ? 'performance_cost_audit') as imports_with_performance_audit,
  count(*) filter (where meta->'performance_cost_audit'->>'overallCostLevel' in ('high', 'very_high')) as high_cost_imports,
  count(*) filter (where meta->'performance_cost_audit'->>'overallRiskLevel' in ('high', 'critical')) as high_risk_imports,
  count(*) filter (where nullif(meta->'performance_cost_audit'->>'estimatedWasteScore', '')::numeric >= 0.65) as high_waste_imports,
  count(*) filter (where pg_column_size(meta) > 500000) as high_meta_size_imports
from public.template_imports;

-- ---------------------------------------------------------------------------
-- 13. Phase 10F note
-- ---------------------------------------------------------------------------
select
  'phase_10f_performance_cost_optimization' as phase,
  'Performance/cost audit is stored in template_imports.meta.performance_cost_audit. It is advisory and does not skip quality gates, call AI, or mutate templates automatically.' as note;
