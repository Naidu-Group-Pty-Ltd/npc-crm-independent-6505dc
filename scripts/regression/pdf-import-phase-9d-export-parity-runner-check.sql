-- Phase 9D Automated Export Parity Runner Check
-- Run in Supabase SQL Editor.
--
-- Purpose:
-- Validate export parity summary state after automated/semi-automated runner execution.
--
-- This SQL is read-only.
--
-- Note: `runnerVersion`, `automationLevel`, `overallScore`, `warnings`, and
-- `blockers` are runner-only metadata and are NOT persisted into the strict
-- Phase 7F export_parity_summary — those columns will be null. The persisted
-- `status`, `mode`, and pair scores ARE populated; blockers are mirrored into
-- `problems`.

-- ---------------------------------------------------------------------------
-- 1. Latest imports with export parity metadata
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.status as import_status,
  ti.source_filename,
  ti.page_count,
  ti.created_template_id as template_id,

  ti.meta->>'export_parity_artifact_path' as export_parity_artifact_path,
  ti.meta->'export_parity_summary'->>'status' as export_parity_status,
  ti.meta->'export_parity_summary'->>'mode' as export_parity_mode,
  ti.meta->'export_parity_summary'->>'runnerVersion' as runner_version,
  ti.meta->'export_parity_summary'->>'automationLevel' as automation_level,
  ti.meta->'export_parity_summary'->>'exportVsSourceScore' as export_vs_source_score,
  ti.meta->'export_parity_summary'->>'editorVsSourceScore' as editor_vs_source_score,
  ti.meta->'export_parity_summary'->>'exportVsEditorScore' as export_vs_editor_score,
  ti.meta->'export_parity_summary'->>'overallScore' as overall_score,
  ti.meta->'export_parity_summary'->'problems' as export_parity_problems,
  ti.meta->'export_parity_summary'->>'generatedAt' as export_parity_generated_at,

  ti.meta->'visual_quality_summary'->>'overallScore' as visual_quality_score,
  ti.meta->'visual_repair_summary'->>'repairStatus' as repair_status,
  ti.meta->'golden_regression_summary'->>'qualityGateStatus' as golden_quality_gate_status,

  ti.updated_at
from public.template_imports ti
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 2. Imports ready for export parity automation but missing export parity
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.created_template_id as template_id,
  ti.page_count,
  ti.meta->>'visual_quality_artifact_path' as visual_quality_artifact_path,
  ti.meta->'visual_quality_summary'->>'overallScore' as visual_quality_score,
  ti.meta->>'visual_repair_artifact_path' as visual_repair_artifact_path,
  ti.meta->'visual_repair_summary'->>'repairStatus' as repair_status,
  case
    when ti.status <> 'completed' then 'not_ready_import_not_completed'
    when ti.created_template_id is null then 'not_ready_template_missing'
    when ti.meta->>'visual_quality_artifact_path' is null then 'not_ready_visual_quality_missing'
    when ti.meta->>'visual_repair_artifact_path' is null then 'not_ready_repair_missing'
    when ti.meta->>'export_parity_artifact_path' is null then 'ready_for_export_parity_runner'
    else 'has_export_parity'
  end as export_parity_runner_readiness,
  ti.updated_at
from public.template_imports ti
where ti.status = 'completed'
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 3. Export parity storage object presence
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.meta->>'export_parity_artifact_path' as export_parity_artifact_path,
  count(o.id) as storage_object_count,
  case
    when ti.meta->>'export_parity_artifact_path' is null then 'no_export_parity_path'
    when count(o.id) = 1 then 'pass'
    when count(o.id) = 0 then 'missing_storage_object'
    else 'duplicate_storage_objects'
  end as storage_status,
  max(o.created_at) as object_created_at,
  max(o.updated_at) as object_updated_at
from public.template_imports ti
left join storage.objects o
  on o.bucket_id = 'template-import-artifacts'
 and o.name = ti.meta->>'export_parity_artifact_path'
where ti.meta->>'export_parity_artifact_path' is not null
group by ti.id, ti.source_filename, ti.meta->>'export_parity_artifact_path'
order by max(ti.updated_at) desc
limit 100;

-- ---------------------------------------------------------------------------
-- 4. Automated vs manual export parity summary counts
-- ---------------------------------------------------------------------------
select
  coalesce(ti.meta->'export_parity_summary'->>'mode', 'missing') as export_parity_mode,
  coalesce(ti.meta->'export_parity_summary'->>'status', 'missing') as export_parity_status,
  coalesce(ti.meta->'export_parity_summary'->>'automationLevel', 'unknown') as automation_level,
  count(*) as import_count
from public.template_imports ti
group by
  coalesce(ti.meta->'export_parity_summary'->>'mode', 'missing'),
  coalesce(ti.meta->'export_parity_summary'->>'status', 'missing'),
  coalesce(ti.meta->'export_parity_summary'->>'automationLevel', 'unknown')
order by import_count desc;

-- ---------------------------------------------------------------------------
-- 5. Export parity rows requiring attention
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.created_template_id as template_id,
  ti.meta->'export_parity_summary'->>'status' as export_parity_status,
  ti.meta->'export_parity_summary'->>'mode' as export_parity_mode,
  ti.meta->'export_parity_summary'->>'automationLevel' as automation_level,
  ti.meta->'export_parity_summary'->>'exportVsSourceScore' as export_vs_source_score,
  ti.meta->'export_parity_summary'->>'editorVsSourceScore' as editor_vs_source_score,
  ti.meta->'export_parity_summary'->>'exportVsEditorScore' as export_vs_editor_score,
  ti.meta->'export_parity_summary'->'problems' as problems,
  ti.updated_at
from public.template_imports ti
where ti.meta ? 'export_parity_summary'
  and (
    ti.meta->'export_parity_summary'->>'status' in ('failed', 'manual_required')
    or jsonb_array_length(coalesce(ti.meta->'export_parity_summary'->'problems', '[]'::jsonb)) > 0
    or nullif(ti.meta->'export_parity_summary'->>'exportVsSourceScore', '')::numeric < 0.80
    or nullif(ti.meta->'export_parity_summary'->>'editorVsSourceScore', '')::numeric < 0.80
    or nullif(ti.meta->'export_parity_summary'->>'exportVsEditorScore', '')::numeric < 0.80
  )
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 6. Golden regression rows impacted by export parity
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  ti.meta->'golden_regression_summary'->>'corpusId' as corpus_id,
  ti.meta->'golden_regression_summary'->>'qualityGateStatus' as quality_gate_status,
  ti.meta->'golden_regression_summary'->>'operatorDecision' as operator_decision,
  ti.meta->'golden_regression_summary'->'warnings' as golden_warnings,
  ti.meta->'golden_regression_summary'->'failures' as golden_failures,
  ti.meta->'export_parity_summary'->>'status' as export_parity_status,
  ti.meta->'export_parity_summary'->>'mode' as export_parity_mode,
  ti.meta->'export_parity_summary'->>'automationLevel' as automation_level,
  ti.meta->'export_parity_summary'->>'exportVsSourceScore' as export_vs_source_score,
  ti.updated_at
from public.template_imports ti
where ti.meta ? 'golden_regression_summary'
  and (
    (ti.meta->'golden_regression_summary'->'warnings')::text ilike '%export%'
    or (ti.meta->'golden_regression_summary'->'failures')::text ilike '%export%'
    or ti.meta->'export_parity_summary'->>'status' in ('failed', 'manual_required')
  )
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 7. Summary counts
-- ---------------------------------------------------------------------------
select
  count(*) as total_imports,
  count(*) filter (where meta ? 'export_parity_summary') as imports_with_export_parity,
  count(*) filter (where meta->'export_parity_summary'->>'status' = 'completed') as export_parity_completed,
  count(*) filter (where meta->'export_parity_summary'->>'status' = 'manual_required') as export_parity_manual_required,
  count(*) filter (where meta->'export_parity_summary'->>'status' = 'failed') as export_parity_failed,
  count(*) filter (where meta->'export_parity_summary'->>'mode' = 'automated') as automated_count,
  count(*) filter (where meta->'export_parity_summary'->>'mode' = 'hybrid') as hybrid_count,
  count(*) filter (where meta->'export_parity_summary'->>'mode' = 'manual') as manual_count,
  count(*) filter (where meta->'export_parity_summary'->>'automationLevel' = 'level_3_source_editor_export') as level_3_count,
  count(*) filter (where meta->'export_parity_summary'->>'automationLevel' = 'level_2_source_editor') as level_2_count,
  count(*) filter (where meta->'export_parity_summary'->>'automationLevel' = 'level_1_manual_compatible') as level_1_count
from public.template_imports;

-- ---------------------------------------------------------------------------
-- 8. Phase 9D note
-- ---------------------------------------------------------------------------
select
  'phase_9d_automated_export_parity_runner' as phase,
  'Export parity automation should persist summaries through existing export parity metadata. Full source/editor/export automation depends on available export raster evidence.' as note;
