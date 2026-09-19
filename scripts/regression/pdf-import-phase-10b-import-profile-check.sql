-- Phase 10B Import Intelligence Profile Check
-- Run in Supabase SQL Editor.
--
-- Purpose:
-- Validate import_intelligence_profile metadata coverage and integrity.
--
-- This SQL is read-only.

-- ---------------------------------------------------------------------------
-- 1. Latest imports with import intelligence profile metadata
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.status,
  ti.source_filename,
  ti.page_count,
  ti.created_template_id as template_id,

  ti.meta->'import_intelligence_profile'->>'version' as profile_version,
  ti.meta->'import_intelligence_profile'->>'profileCategory' as profile_category,
  ti.meta->'import_intelligence_profile'->>'riskLevel' as risk_level,
  ti.meta->'import_intelligence_profile'->>'confidence' as profile_confidence,

  ti.meta->'import_intelligence_profile'->'scores'->>'complexityScore' as complexity_score,
  ti.meta->'import_intelligence_profile'->'scores'->>'ocrRiskScore' as ocr_risk_score,
  ti.meta->'import_intelligence_profile'->'scores'->>'tableRiskScore' as table_risk_score,
  ti.meta->'import_intelligence_profile'->'scores'->>'imageRiskScore' as image_risk_score,
  ti.meta->'import_intelligence_profile'->'scores'->>'designRiskScore' as design_risk_score,
  ti.meta->'import_intelligence_profile'->'scores'->>'automationRiskScore' as automation_risk_score,
  ti.meta->'import_intelligence_profile'->'scores'->>'manualReviewLikelihood' as manual_review_likelihood,

  ti.meta->'import_intelligence_profile'->'recommendations'->>'visualQaStrategy' as visual_qa_strategy,
  ti.meta->'import_intelligence_profile'->'recommendations'->>'repairStrategy' as repair_strategy,
  ti.meta->'import_intelligence_profile'->'recommendations'->>'aiReconciliationStrategy' as ai_reconciliation_strategy,
  ti.meta->'import_intelligence_profile'->'recommendations'->>'exportParityStrategy' as export_parity_strategy,
  ti.meta->'import_intelligence_profile'->'recommendations'->>'operatorStrategy' as operator_strategy,

  jsonb_array_length(coalesce(ti.meta->'import_intelligence_profile'->'warnings', '[]'::jsonb)) as profile_warning_count,
  jsonb_array_length(coalesce(ti.meta->'import_intelligence_profile'->'blockers', '[]'::jsonb)) as profile_blocker_count,

  ti.meta->'visual_quality_summary'->>'overallScore' as visual_quality_score,
  ti.meta->'visual_repair_summary'->>'repairStatus' as repair_status,
  ti.meta->'export_parity_summary'->>'status' as export_parity_status,
  ti.meta->'golden_regression_summary'->>'qualityGateStatus' as golden_quality_gate_status,

  ti.updated_at
from public.template_imports ti
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 2. Profile coverage summary
-- ---------------------------------------------------------------------------
select
  count(*) as total_imports,
  count(*) filter (where meta ? 'import_intelligence_profile') as imports_with_profile,
  count(*) filter (where status = 'completed') as completed_imports,
  count(*) filter (where status = 'completed' and meta ? 'import_intelligence_profile') as completed_imports_with_profile,
  count(*) filter (where status = 'completed' and not (meta ? 'import_intelligence_profile')) as completed_imports_without_profile
from public.template_imports;

-- ---------------------------------------------------------------------------
-- 3. Profile category distribution
-- ---------------------------------------------------------------------------
select
  coalesce(meta->'import_intelligence_profile'->>'profileCategory', 'missing') as profile_category,
  coalesce(meta->'import_intelligence_profile'->>'riskLevel', 'missing') as risk_level,
  count(*) as import_count
from public.template_imports
group by
  coalesce(meta->'import_intelligence_profile'->>'profileCategory', 'missing'),
  coalesce(meta->'import_intelligence_profile'->>'riskLevel', 'missing')
order by import_count desc;

-- ---------------------------------------------------------------------------
-- 4. Profiles requiring attention
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.created_template_id as template_id,
  ti.meta->'import_intelligence_profile'->>'profileCategory' as profile_category,
  ti.meta->'import_intelligence_profile'->>'riskLevel' as risk_level,
  ti.meta->'import_intelligence_profile'->>'confidence' as confidence,
  ti.meta->'import_intelligence_profile'->'warnings' as warnings,
  ti.meta->'import_intelligence_profile'->'blockers' as blockers,
  ti.meta->'import_intelligence_profile'->'recommendations' as recommendations,
  ti.updated_at
from public.template_imports ti
where ti.meta ? 'import_intelligence_profile'
  and (
    ti.meta->'import_intelligence_profile'->>'riskLevel' in ('high', 'critical', 'unknown')
    or jsonb_array_length(coalesce(ti.meta->'import_intelligence_profile'->'blockers', '[]'::jsonb)) > 0
    or nullif(ti.meta->'import_intelligence_profile'->>'confidence', '')::numeric < 0.5
  )
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 5. Profile integrity validation
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.meta->'import_intelligence_profile'->>'version' as version,
  ti.meta->'import_intelligence_profile'->>'profileCategory' as profile_category,
  ti.meta->'import_intelligence_profile'->>'riskLevel' as risk_level,
  ti.meta->'import_intelligence_profile'->>'confidence' as confidence,
  case
    when not (ti.meta ? 'import_intelligence_profile') then 'missing_profile'
    when ti.meta->'import_intelligence_profile'->>'version' is null then 'fail_missing_version'
    when ti.meta->'import_intelligence_profile'->>'profileCategory' not in (
      'simple_document',
      'design_heavy',
      'multi_page_report',
      'table_heavy',
      'image_heavy',
      'scanned_ocr',
      'mixed_complex',
      'high_risk',
      'unknown'
    ) then 'fail_invalid_category'
    when ti.meta->'import_intelligence_profile'->>'riskLevel' not in (
      'low',
      'medium',
      'high',
      'critical',
      'unknown'
    ) then 'fail_invalid_risk_level'
    when ti.meta->'import_intelligence_profile'->'scores' is null then 'fail_missing_scores'
    when ti.meta->'import_intelligence_profile'->'signals' is null then 'fail_missing_signals'
    when ti.meta->'import_intelligence_profile'->'recommendations' is null then 'fail_missing_recommendations'
    when ti.meta->'import_intelligence_profile'->'evidence' is null then 'warning_missing_evidence'
    else 'pass'
  end as profile_integrity_status,
  ti.updated_at
from public.template_imports ti
where ti.meta ? 'import_intelligence_profile'
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 6. Strategy distribution
-- ---------------------------------------------------------------------------
select
  meta->'import_intelligence_profile'->'recommendations'->>'visualQaStrategy' as visual_qa_strategy,
  meta->'import_intelligence_profile'->'recommendations'->>'repairStrategy' as repair_strategy,
  meta->'import_intelligence_profile'->'recommendations'->>'aiReconciliationStrategy' as ai_reconciliation_strategy,
  meta->'import_intelligence_profile'->'recommendations'->>'exportParityStrategy' as export_parity_strategy,
  meta->'import_intelligence_profile'->'recommendations'->>'operatorStrategy' as operator_strategy,
  count(*) as import_count
from public.template_imports
where meta ? 'import_intelligence_profile'
group by
  meta->'import_intelligence_profile'->'recommendations'->>'visualQaStrategy',
  meta->'import_intelligence_profile'->'recommendations'->>'repairStrategy',
  meta->'import_intelligence_profile'->'recommendations'->>'aiReconciliationStrategy',
  meta->'import_intelligence_profile'->'recommendations'->>'exportParityStrategy',
  meta->'import_intelligence_profile'->'recommendations'->>'operatorStrategy'
order by import_count desc;

-- ---------------------------------------------------------------------------
-- 7. Profile vs quality outcome alignment
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.meta->'import_intelligence_profile'->>'profileCategory' as profile_category,
  ti.meta->'import_intelligence_profile'->>'riskLevel' as risk_level,
  ti.meta->'import_intelligence_profile'->'scores'->>'automationRiskScore' as automation_risk_score,
  ti.meta->'visual_quality_summary'->>'overallScore' as visual_quality_score,
  ti.meta->'visual_quality_summary'->>'manualReviewRequired' as visual_manual_review,
  ti.meta->'visual_repair_summary'->>'repairStatus' as repair_status,
  ti.meta->'visual_repair_summary'->>'requiresFallback' as repair_requires_fallback,
  ti.meta->'export_parity_summary'->>'status' as export_parity_status,
  ti.meta->'golden_regression_summary'->>'qualityGateStatus' as golden_quality_gate_status,
  case
    when ti.meta->'import_intelligence_profile'->>'riskLevel' in ('high', 'critical')
      and ti.meta->'golden_regression_summary'->>'qualityGateStatus' = 'pass' then 'high_risk_but_passed'
    when ti.meta->'import_intelligence_profile'->>'riskLevel' = 'low'
      and ti.meta->'golden_regression_summary'->>'qualityGateStatus' in ('fail', 'blocked') then 'low_risk_but_failed'
    when ti.meta->'import_intelligence_profile'->>'riskLevel' in ('high', 'critical')
      and ti.meta->'golden_regression_summary'->>'qualityGateStatus' in ('fail', 'blocked', 'warning') then 'risk_aligned'
    else 'neutral_or_insufficient_data'
  end as profile_quality_alignment,
  ti.updated_at
from public.template_imports ti
where ti.meta ? 'import_intelligence_profile'
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 8. Imports ready for profile generation
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.status,
  ti.page_count,
  ti.created_template_id as template_id,
  ti.meta->>'visual_quality_artifact_path' as visual_quality_artifact_path,
  ti.meta->>'visual_repair_artifact_path' as visual_repair_artifact_path,
  ti.meta->>'export_parity_artifact_path' as export_parity_artifact_path,
  case
    when ti.status <> 'completed' then 'not_ready_import_not_completed'
    when ti.created_template_id is null then 'ready_with_warning_template_missing'
    when ti.meta ? 'import_intelligence_profile' then 'profile_exists'
    else 'ready_for_profile_generation'
  end as profile_generation_readiness,
  ti.updated_at
from public.template_imports ti
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 9. Phase 10B note
-- ---------------------------------------------------------------------------
select
  'phase_10b_import_intelligence_profile' as phase,
  'Import intelligence profiles are stored in template_imports.meta.import_intelligence_profile. Profiles must not store raw PDF contents or private extracted text.' as note;
