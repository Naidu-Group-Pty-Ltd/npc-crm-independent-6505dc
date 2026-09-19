-- Phase 10C Repair Pattern Library Check
-- Run in Supabase SQL Editor.
--
-- Purpose:
-- Validate repair_pattern_analysis metadata coverage and integrity.
--
-- This SQL is read-only.

-- ---------------------------------------------------------------------------
-- 1. Latest imports with repair pattern analysis
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.status,
  ti.source_filename,
  ti.page_count,
  ti.created_template_id as template_id,

  ti.meta->'import_intelligence_profile'->>'profileCategory' as profile_category,
  ti.meta->'import_intelligence_profile'->>'riskLevel' as import_risk_level,

  ti.meta->'repair_pattern_analysis'->>'version' as analysis_version,
  ti.meta->'repair_pattern_analysis'->>'primaryPatternId' as primary_pattern_id,
  ti.meta->'repair_pattern_analysis'->>'overallSeverity' as overall_severity,
  ti.meta->'repair_pattern_analysis'->>'overallConfidence' as overall_confidence,
  ti.meta->'repair_pattern_analysis'->>'deterministicRepairStrategy' as deterministic_repair_strategy,
  ti.meta->'repair_pattern_analysis'->>'aiReconciliationUsefulness' as ai_reconciliation_usefulness,
  ti.meta->'repair_pattern_analysis'->>'exportParityRequirement' as export_parity_requirement,
  ti.meta->'repair_pattern_analysis'->>'operatorReviewRequirement' as operator_review_requirement,

  jsonb_array_length(coalesce(ti.meta->'repair_pattern_analysis'->'matchedPatterns', '[]'::jsonb)) as matched_pattern_count,
  jsonb_array_length(coalesce(ti.meta->'repair_pattern_analysis'->'warnings', '[]'::jsonb)) as analysis_warning_count,
  jsonb_array_length(coalesce(ti.meta->'repair_pattern_analysis'->'blockers', '[]'::jsonb)) as analysis_blocker_count,

  ti.meta->'visual_quality_summary'->>'overallScore' as visual_quality_score,
  ti.meta->'visual_quality_summary'->>'manualReviewRequired' as visual_manual_review,
  ti.meta->'visual_repair_summary'->>'repairStatus' as repair_status,
  ti.meta->'visual_repair_summary'->>'finalScore' as repair_final_score,
  ti.meta->'visual_repair_summary'->>'requiresFallback' as repair_requires_fallback,
  ti.meta->'visual_repair_summary'->>'requiresManualReview' as repair_manual_review,
  ti.meta->'export_parity_summary'->>'status' as export_parity_status,
  ti.meta->'export_parity_summary'->>'exportVsSourceScore' as export_vs_source_score,
  ti.meta->'golden_regression_summary'->>'qualityGateStatus' as golden_quality_gate_status,

  ti.updated_at
from public.template_imports ti
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 2. Repair pattern coverage summary
-- ---------------------------------------------------------------------------
select
  count(*) as total_imports,
  count(*) filter (where meta ? 'repair_pattern_analysis') as imports_with_repair_pattern_analysis,
  count(*) filter (where status = 'completed') as completed_imports,
  count(*) filter (where status = 'completed' and meta ? 'repair_pattern_analysis') as completed_imports_with_analysis,
  count(*) filter (where status = 'completed' and not (meta ? 'repair_pattern_analysis')) as completed_imports_without_analysis,
  count(*) filter (where meta ? 'import_intelligence_profile') as imports_with_import_intelligence_profile,
  count(*) filter (where meta ? 'import_intelligence_profile' and meta ? 'repair_pattern_analysis') as imports_with_profile_and_repair_patterns
from public.template_imports;

-- ---------------------------------------------------------------------------
-- 3. Primary pattern distribution
-- ---------------------------------------------------------------------------
select
  coalesce(meta->'repair_pattern_analysis'->>'primaryPatternId', 'missing') as primary_pattern_id,
  coalesce(meta->'repair_pattern_analysis'->>'overallSeverity', 'missing') as overall_severity,
  coalesce(meta->'repair_pattern_analysis'->>'deterministicRepairStrategy', 'missing') as deterministic_repair_strategy,
  count(*) as import_count
from public.template_imports
group by
  coalesce(meta->'repair_pattern_analysis'->>'primaryPatternId', 'missing'),
  coalesce(meta->'repair_pattern_analysis'->>'overallSeverity', 'missing'),
  coalesce(meta->'repair_pattern_analysis'->>'deterministicRepairStrategy', 'missing')
order by import_count desc;

-- ---------------------------------------------------------------------------
-- 4. Matched pattern expansion
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  pattern->>'patternId' as pattern_id,
  pattern->>'category' as category,
  pattern->>'severity' as severity,
  pattern->>'confidence' as confidence,
  pattern->>'score' as score,
  pattern->>'recommendedAction' as recommended_action,
  pattern->>'operatorReviewRequirement' as operator_review_requirement,
  ti.updated_at
from public.template_imports ti
cross join lateral jsonb_array_elements(
  coalesce(ti.meta->'repair_pattern_analysis'->'matchedPatterns', '[]'::jsonb)
) as pattern
where ti.meta ? 'repair_pattern_analysis'
order by ti.updated_at desc
limit 200;

-- ---------------------------------------------------------------------------
-- 5. Analyses requiring operator/developer attention
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.created_template_id as template_id,
  ti.meta->'repair_pattern_analysis'->>'primaryPatternId' as primary_pattern_id,
  ti.meta->'repair_pattern_analysis'->>'overallSeverity' as overall_severity,
  ti.meta->'repair_pattern_analysis'->>'deterministicRepairStrategy' as deterministic_repair_strategy,
  ti.meta->'repair_pattern_analysis'->>'operatorReviewRequirement' as operator_review_requirement,
  ti.meta->'repair_pattern_analysis'->'warnings' as warnings,
  ti.meta->'repair_pattern_analysis'->'blockers' as blockers,
  ti.updated_at
from public.template_imports ti
where ti.meta ? 'repair_pattern_analysis'
  and (
    ti.meta->'repair_pattern_analysis'->>'overallSeverity' in ('high', 'critical')
    or ti.meta->'repair_pattern_analysis'->>'deterministicRepairStrategy' in ('manual_only', 'blocked')
    or ti.meta->'repair_pattern_analysis'->>'operatorReviewRequirement' in ('required', 'block_until_review')
    or jsonb_array_length(coalesce(ti.meta->'repair_pattern_analysis'->'blockers', '[]'::jsonb)) > 0
  )
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 6. Repair pattern integrity validation
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.meta->'repair_pattern_analysis'->>'version' as version,
  ti.meta->'repair_pattern_analysis'->>'primaryPatternId' as primary_pattern_id,
  ti.meta->'repair_pattern_analysis'->>'overallSeverity' as overall_severity,
  ti.meta->'repair_pattern_analysis'->>'overallConfidence' as overall_confidence,
  case
    when not (ti.meta ? 'repair_pattern_analysis') then 'missing_analysis'
    when ti.meta->'repair_pattern_analysis'->>'version' is null then 'fail_missing_version'
    when ti.meta->'repair_pattern_analysis'->>'overallSeverity' not in ('info', 'low', 'medium', 'high', 'critical') then 'fail_invalid_severity'
    when ti.meta->'repair_pattern_analysis'->>'deterministicRepairStrategy' not in ('safe', 'safe_with_review', 'constrained', 'manual_only', 'blocked', 'unknown') then 'fail_invalid_repair_strategy'
    when ti.meta->'repair_pattern_analysis'->>'aiReconciliationUsefulness' not in ('not_needed', 'low', 'medium', 'high', 'manual_review_only', 'blocked') then 'fail_invalid_ai_usefulness'
    when ti.meta->'repair_pattern_analysis'->>'exportParityRequirement' not in ('not_required', 'recommended', 'required', 'rerun_required', 'manual_required') then 'fail_invalid_export_parity_requirement'
    when ti.meta->'repair_pattern_analysis'->>'operatorReviewRequirement' not in ('not_required', 'recommended', 'required', 'block_until_review') then 'fail_invalid_operator_review_requirement'
    when ti.meta->'repair_pattern_analysis'->'matchedPatterns' is null then 'fail_missing_matched_patterns'
    when ti.meta->'repair_pattern_analysis'->'evidence' is null then 'warning_missing_evidence'
    else 'pass'
  end as analysis_integrity_status,
  ti.updated_at
from public.template_imports ti
where ti.meta ? 'repair_pattern_analysis'
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 7. Import profile vs repair pattern alignment
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.meta->'import_intelligence_profile'->>'profileCategory' as profile_category,
  ti.meta->'import_intelligence_profile'->>'riskLevel' as import_risk_level,
  ti.meta->'repair_pattern_analysis'->>'primaryPatternId' as primary_pattern_id,
  ti.meta->'repair_pattern_analysis'->>'overallSeverity' as overall_severity,
  case
    when ti.meta->'import_intelligence_profile'->>'profileCategory' = 'table_heavy'
      and ti.meta->'repair_pattern_analysis'->>'primaryPatternId' = 'table_grid_drift' then 'aligned'
    when ti.meta->'import_intelligence_profile'->>'profileCategory' = 'image_heavy'
      and ti.meta->'repair_pattern_analysis'->>'primaryPatternId' in ('image_crop_mismatch', 'missing_major_visual_element') then 'aligned'
    when ti.meta->'import_intelligence_profile'->>'profileCategory' = 'scanned_ocr'
      and ti.meta->'repair_pattern_analysis'->>'primaryPatternId' in ('ocr_text_fragments', 'manual_review_only') then 'aligned'
    when ti.meta->'import_intelligence_profile'->>'profileCategory' = 'design_heavy'
      and ti.meta->'repair_pattern_analysis'->>'primaryPatternId' in ('background_block_shift', 'layer_order_conflict', 'image_crop_mismatch') then 'aligned'
    when ti.meta->'import_intelligence_profile'->>'profileCategory' is null
      or ti.meta->'repair_pattern_analysis'->>'primaryPatternId' is null then 'insufficient_data'
    else 'neutral_or_review'
  end as profile_pattern_alignment,
  ti.updated_at
from public.template_imports ti
where ti.meta ? 'repair_pattern_analysis'
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 8. Repair pattern strategy distribution
-- ---------------------------------------------------------------------------
select
  meta->'repair_pattern_analysis'->>'deterministicRepairStrategy' as deterministic_repair_strategy,
  meta->'repair_pattern_analysis'->>'aiReconciliationUsefulness' as ai_reconciliation_usefulness,
  meta->'repair_pattern_analysis'->>'exportParityRequirement' as export_parity_requirement,
  meta->'repair_pattern_analysis'->>'operatorReviewRequirement' as operator_review_requirement,
  count(*) as import_count
from public.template_imports
where meta ? 'repair_pattern_analysis'
group by
  meta->'repair_pattern_analysis'->>'deterministicRepairStrategy',
  meta->'repair_pattern_analysis'->>'aiReconciliationUsefulness',
  meta->'repair_pattern_analysis'->>'exportParityRequirement',
  meta->'repair_pattern_analysis'->>'operatorReviewRequirement'
order by import_count desc;

-- ---------------------------------------------------------------------------
-- 9. Imports ready for repair pattern analysis
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.status,
  ti.page_count,
  ti.created_template_id as template_id,
  ti.meta->'import_intelligence_profile'->>'profileCategory' as profile_category,
  ti.meta->'visual_quality_summary'->>'overallScore' as visual_quality_score,
  ti.meta->'visual_repair_summary'->>'repairStatus' as repair_status,
  ti.meta->'export_parity_summary'->>'status' as export_parity_status,
  case
    when ti.status <> 'completed' then 'not_ready_import_not_completed'
    when not (ti.meta ? 'import_intelligence_profile') then 'ready_with_warning_profile_missing'
    when ti.meta ? 'repair_pattern_analysis' then 'analysis_exists'
    else 'ready_for_repair_pattern_analysis'
  end as repair_pattern_generation_readiness,
  ti.updated_at
from public.template_imports ti
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 10. Phase 10C note
-- ---------------------------------------------------------------------------
select
  'phase_10c_repair_pattern_library' as phase,
  'Repair pattern analysis is stored in template_imports.meta.repair_pattern_analysis. It is advisory and does not apply repair mutations.' as note;
