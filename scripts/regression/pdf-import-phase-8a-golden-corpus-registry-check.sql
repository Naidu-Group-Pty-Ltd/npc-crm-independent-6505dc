-- Phase 8A Golden Corpus Registry Check
-- Run in Supabase SQL Editor.
--
-- Purpose:
-- Phase 8A defines the golden corpus registry.
-- This SQL does not require golden run persistence yet.
-- It inspects recent PDF imports and shows whether they have enough metadata
-- to be mapped into future golden corpus runs.

-- ---------------------------------------------------------------------------
-- 1. Recent imports with Phase 7 quality metadata
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
  ti.meta->'visual_quality_summary'->>'overallScore' as visual_quality_score,
  ti.meta->'visual_quality_summary'->>'manualReviewRequired' as visual_quality_manual_review_required,

  ti.meta->>'visual_repair_artifact_path' as visual_repair_artifact_path,
  ti.meta->'visual_repair_summary'->>'repairStatus' as repair_status,
  ti.meta->'visual_repair_summary'->>'finalScore' as repair_final_score,
  ti.meta->'visual_repair_summary'->>'requiresFallback' as repair_requires_fallback,
  ti.meta->'visual_repair_summary'->>'requiresManualReview' as repair_requires_manual_review,

  ti.meta->'ai_reconciliation_summary'->>'status' as ai_reconciliation_status,
  ti.meta->'ai_reconciliation_summary'->>'recommendation' as ai_reconciliation_recommendation,

  ti.meta->>'export_parity_artifact_path' as export_parity_artifact_path,
  ti.meta->'export_parity_summary'->>'status' as export_parity_status,
  ti.meta->'export_parity_summary'->>'mode' as export_parity_mode,
  ti.meta->'export_parity_summary'->>'exportVsSourceScore' as export_vs_source_score,

  ti.meta->'golden_regression_summary'->>'corpusId' as golden_corpus_id,
  ti.meta->'golden_regression_summary'->>'qualityGateStatus' as golden_quality_gate_status,

  ti.error,
  ti.created_at,
  ti.updated_at
from public.template_imports ti
order by ti.updated_at desc
limit 50;

-- ---------------------------------------------------------------------------
-- 2. Existing golden regression metadata if any
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.created_template_id as template_id,
  ti.meta->'golden_regression_summary' as golden_regression_summary,
  ti.updated_at
from public.template_imports ti
where ti.meta ? 'golden_regression_summary'
order by ti.updated_at desc
limit 50;

-- ---------------------------------------------------------------------------
-- 3. Corpus-readiness view
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.page_count,
  ti.created_template_id as template_id,
  case
    when ti.status <> 'completed' then 'not_ready_import_not_completed'
    when ti.created_template_id is null then 'not_ready_template_missing'
    when ti.meta->>'visual_quality_artifact_path' is null then 'not_ready_visual_quality_missing'
    when ti.meta->>'visual_repair_artifact_path' is null then 'not_ready_visual_repair_missing'
    when ti.meta->>'export_parity_artifact_path' is null then 'ready_with_warning_export_parity_missing'
    else 'ready_for_golden_mapping'
  end as corpus_mapping_readiness,
  ti.meta->'visual_quality_summary'->>'overallScore' as visual_quality_score,
  ti.meta->'visual_repair_summary'->>'finalScore' as repair_final_score,
  ti.meta->'export_parity_summary'->>'exportVsSourceScore' as export_vs_source_score,
  ti.updated_at
from public.template_imports ti
where ti.status in ('completed', 'failed')
order by ti.updated_at desc
limit 80;

-- ---------------------------------------------------------------------------
-- 4. Summary counts
-- ---------------------------------------------------------------------------
select
  count(*) as total_imports,
  count(*) filter (where status = 'completed') as completed_imports,
  count(*) filter (where status = 'failed') as failed_imports,
  count(*) filter (where created_template_id is not null) as imports_with_template,
  count(*) filter (where meta->>'visual_quality_artifact_path' is not null) as imports_with_visual_quality,
  count(*) filter (where meta->>'visual_repair_artifact_path' is not null) as imports_with_visual_repair,
  count(*) filter (where meta ? 'ai_reconciliation_summary') as imports_with_ai_reconciliation,
  count(*) filter (where meta->>'export_parity_artifact_path' is not null) as imports_with_export_parity,
  count(*) filter (where meta ? 'golden_regression_summary') as imports_with_golden_regression_summary
from public.template_imports;

-- ---------------------------------------------------------------------------
-- 5. Phase 8A readiness note
-- ---------------------------------------------------------------------------
select
  'phase_8a_registry_only' as phase,
  'Golden corpus registry does not require persisted golden runs yet. Phase 8B/8D will add runner/persistence.' as note;
