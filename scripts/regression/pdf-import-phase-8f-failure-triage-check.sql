-- Phase 8F Failure Triage Check
-- Run in Supabase SQL Editor.
--
-- Purpose:
-- Inspect recent PDF import quality failures/warnings and map them to
-- recommended recovery actions. Read-only; does not mutate data.
--
-- NOTE: each of sections 1-4 repeats the recent/triage_rows preamble because Postgres CTEs are
-- scoped to a single statement. Run the whole file, or run any single section standalone.


with recent as (
  select
    ti.id as import_id,
    ti.status,
    ti.source_filename,
    ti.page_count,
    ti.created_template_id as template_id,
    ti.error,

    ti.meta->'import_manifests_summary'->>'job_id' as pdf_job_id,
    ti.meta->'import_manifests_summary'->>'engine_version' as engine_version,

    ti.meta->>'visual_quality_artifact_path' as visual_quality_artifact_path,
    ti.meta->'visual_quality_summary'->>'overallScore' as visual_quality_score,
    (ti.meta->'visual_quality_summary'->>'manualReviewRequired')::boolean as visual_manual_review,

    ti.meta->>'visual_repair_artifact_path' as repair_artifact_path,
    ti.meta->'visual_repair_summary'->>'repairStatus' as repair_status,
    ti.meta->'visual_repair_summary'->>'finalScore' as repair_final_score,
    (ti.meta->'visual_repair_summary'->>'requiresFallback')::boolean as repair_requires_fallback,
    (ti.meta->'visual_repair_summary'->>'requiresManualReview')::boolean as repair_manual_review,

    ti.meta->'ai_reconciliation_summary'->>'status' as ai_status,
    ti.meta->'ai_reconciliation_summary'->>'recommendation' as ai_recommendation,

    ti.meta->>'export_parity_artifact_path' as export_parity_artifact_path,
    ti.meta->'export_parity_summary'->>'status' as export_status,
    ti.meta->'export_parity_summary'->>'exportVsSourceScore' as export_vs_source_score,

    ti.meta->'golden_regression_summary'->>'corpusId' as corpus_id,
    ti.meta->'golden_regression_summary'->>'qualityGateStatus' as quality_gate_status,
    ti.meta->'golden_regression_summary'->>'operatorDecision' as operator_decision,
    ti.meta->'golden_regression_summary'->'warnings' as golden_warnings,
    ti.meta->'golden_regression_summary'->'failures' as golden_failures,

    ti.updated_at
  from public.template_imports ti
  order by ti.updated_at desc
  limit 100
),
triage_rows as (
  select import_id, source_filename, 'import_failed' as triage_code, 'import' as category, 'error' as severity, 'developer_fullstack' as owner,
    'Inspect PDF import jobs and function logs, then rerun import when cause is understood.' as recommendation, updated_at
  from recent where status = 'failed' or error is not null
  union all
  select import_id, source_filename, 'engine_version_missing', 'diagnostics', 'warning', 'developer_backend',
    'Inspect pdf_import_jobs and import manifest metadata.', updated_at
  from recent where status = 'completed' and engine_version is null
  union all
  select import_id, source_filename, 'visual_quality_artifact_missing', 'visual_quality', 'error', 'developer_frontend',
    'Rerun Visual QA and inspect source/generated raster availability.', updated_at
  from recent where status = 'completed' and visual_quality_artifact_path is null
  union all
  select import_id, source_filename, 'visual_quality_manual_review_required', 'visual_quality', 'warning', 'manual_review',
    'Manually inspect source/generated/diff rasters; run AI reconciliation if useful.', updated_at
  from recent where visual_manual_review = true
  union all
  select import_id, source_filename, 'repair_audit_missing', 'repair', 'error', 'developer_backend',
    'Rerun repair and inspect save_visual_repair_audit/storage persistence.', updated_at
  from recent where visual_quality_artifact_path is not null and repair_artifact_path is null
  union all
  select import_id, source_filename, 'repair_failed', 'repair', 'error', 'developer_frontend',
    'Rerun repair; if repeated, run AI reconciliation or inspect repair pipeline.', updated_at
  from recent where repair_status = 'failed'
  union all
  select import_id, source_filename, 'repair_skipped_no_eligible_pages', 'repair', 'warning', 'qa',
    'Accept if no eligible pages were expected; otherwise inspect repair eligibility.', updated_at
  from recent where repair_status = 'skipped'
  union all
  select import_id, source_filename, 'fallback_used', 'repair', 'warning', 'qa',
    'Manual review required; verify source raster was preserved and output is acceptable.', updated_at
  from recent where repair_requires_fallback = true
  union all
  select import_id, source_filename, 'visual_quality_manual_review_required', 'visual_quality', 'warning', 'manual_review',
    'Manual review required after repair; inspect final template before accepting.', updated_at
  from recent where repair_manual_review = true
  union all
  select import_id, source_filename, 'ai_reconciliation_recommended_not_run', 'ai_reconciliation', 'warning', 'operator',
    'Run AI reconciliation, then rerun Visual QA before applying.', updated_at
  from recent where ai_recommendation in ('recommended', 'manual_review') and coalesce(ai_status, '') <> 'completed'
  union all
  select import_id, source_filename, 'ai_reconciliation_failed', 'ai_reconciliation', 'warning', 'developer_frontend',
    'Inspect AI reconciliation call/logs; retry or move to manual review.', updated_at
  from recent where ai_status = 'failed'
  union all
  select import_id, source_filename, 'export_parity_artifact_missing', 'export_parity', 'error', 'operator',
    'Record or rerun export parity for this import.', updated_at
  from recent where visual_quality_artifact_path is not null and repair_artifact_path is not null and export_parity_artifact_path is null
  union all
  select import_id, source_filename, 'export_parity_failed', 'export_parity', 'error', 'developer_frontend',
    'Inspect exported PDF/editor/source mismatch and patch renderer if repeated.', updated_at
  from recent where export_status = 'failed'
  union all
  select import_id, source_filename, 'export_parity_manual_required', 'export_parity', 'warning', 'manual_review',
    'Manually inspect source/editor/export parity and accept or reject.', updated_at
  from recent where export_status = 'manual_required'
  union all
  select import_id, source_filename, 'golden_regression_missing', 'golden_regression', 'warning', 'operator',
    'Run and persist golden regression summary if this import belongs to the corpus.', updated_at
  from recent where visual_quality_artifact_path is not null and repair_artifact_path is not null
    and export_parity_artifact_path is not null and quality_gate_status is null
  union all
  select import_id, source_filename, 'quality_gate_failed', 'golden_regression', 'error', 'qa',
    'Inspect failures array, then rerun or patch the failing stage.', updated_at
  from recent where quality_gate_status = 'fail'
  union all
  select import_id, source_filename, 'quality_gate_blocked', 'golden_regression', 'error', 'operator',
    'Rerun golden regression after missing prerequisites are resolved.', updated_at
  from recent where quality_gate_status = 'blocked'
  union all
  select import_id, source_filename, 'operator_rejected', 'golden_regression', 'error', 'qa',
    'Review operator rejection notes and fix underlying issue before accepting.', updated_at
  from recent where operator_decision = 'rejected'
  union all
  select import_id, source_filename, 'operator_needs_rerun', 'golden_regression', 'warning', 'operator',
    'Rerun golden regression for this corpus item.', updated_at
  from recent where operator_decision = 'needs_rerun'
)
-- ---------------------------------------------------------------------------
-- 1. Triage rows
-- ---------------------------------------------------------------------------
select import_id, source_filename, triage_code, category, severity, owner, recommendation, updated_at
from triage_rows
order by case severity when 'critical' then 1 when 'error' then 2 when 'warning' then 3 else 4 end, updated_at desc;


with recent as (
  select
    ti.id as import_id,
    ti.status,
    ti.source_filename,
    ti.page_count,
    ti.created_template_id as template_id,
    ti.error,

    ti.meta->'import_manifests_summary'->>'job_id' as pdf_job_id,
    ti.meta->'import_manifests_summary'->>'engine_version' as engine_version,

    ti.meta->>'visual_quality_artifact_path' as visual_quality_artifact_path,
    ti.meta->'visual_quality_summary'->>'overallScore' as visual_quality_score,
    (ti.meta->'visual_quality_summary'->>'manualReviewRequired')::boolean as visual_manual_review,

    ti.meta->>'visual_repair_artifact_path' as repair_artifact_path,
    ti.meta->'visual_repair_summary'->>'repairStatus' as repair_status,
    ti.meta->'visual_repair_summary'->>'finalScore' as repair_final_score,
    (ti.meta->'visual_repair_summary'->>'requiresFallback')::boolean as repair_requires_fallback,
    (ti.meta->'visual_repair_summary'->>'requiresManualReview')::boolean as repair_manual_review,

    ti.meta->'ai_reconciliation_summary'->>'status' as ai_status,
    ti.meta->'ai_reconciliation_summary'->>'recommendation' as ai_recommendation,

    ti.meta->>'export_parity_artifact_path' as export_parity_artifact_path,
    ti.meta->'export_parity_summary'->>'status' as export_status,
    ti.meta->'export_parity_summary'->>'exportVsSourceScore' as export_vs_source_score,

    ti.meta->'golden_regression_summary'->>'corpusId' as corpus_id,
    ti.meta->'golden_regression_summary'->>'qualityGateStatus' as quality_gate_status,
    ti.meta->'golden_regression_summary'->>'operatorDecision' as operator_decision,
    ti.meta->'golden_regression_summary'->'warnings' as golden_warnings,
    ti.meta->'golden_regression_summary'->'failures' as golden_failures,

    ti.updated_at
  from public.template_imports ti
  order by ti.updated_at desc
  limit 100
),
triage_rows as (
  select import_id, source_filename, 'import_failed' as triage_code, 'import' as category, 'error' as severity, 'developer_fullstack' as owner,
    'Inspect PDF import jobs and function logs, then rerun import when cause is understood.' as recommendation, updated_at
  from recent where status = 'failed' or error is not null
  union all
  select import_id, source_filename, 'engine_version_missing', 'diagnostics', 'warning', 'developer_backend',
    'Inspect pdf_import_jobs and import manifest metadata.', updated_at
  from recent where status = 'completed' and engine_version is null
  union all
  select import_id, source_filename, 'visual_quality_artifact_missing', 'visual_quality', 'error', 'developer_frontend',
    'Rerun Visual QA and inspect source/generated raster availability.', updated_at
  from recent where status = 'completed' and visual_quality_artifact_path is null
  union all
  select import_id, source_filename, 'visual_quality_manual_review_required', 'visual_quality', 'warning', 'manual_review',
    'Manually inspect source/generated/diff rasters; run AI reconciliation if useful.', updated_at
  from recent where visual_manual_review = true
  union all
  select import_id, source_filename, 'repair_audit_missing', 'repair', 'error', 'developer_backend',
    'Rerun repair and inspect save_visual_repair_audit/storage persistence.', updated_at
  from recent where visual_quality_artifact_path is not null and repair_artifact_path is null
  union all
  select import_id, source_filename, 'repair_failed', 'repair', 'error', 'developer_frontend',
    'Rerun repair; if repeated, run AI reconciliation or inspect repair pipeline.', updated_at
  from recent where repair_status = 'failed'
  union all
  select import_id, source_filename, 'repair_skipped_no_eligible_pages', 'repair', 'warning', 'qa',
    'Accept if no eligible pages were expected; otherwise inspect repair eligibility.', updated_at
  from recent where repair_status = 'skipped'
  union all
  select import_id, source_filename, 'fallback_used', 'repair', 'warning', 'qa',
    'Manual review required; verify source raster was preserved and output is acceptable.', updated_at
  from recent where repair_requires_fallback = true
  union all
  select import_id, source_filename, 'visual_quality_manual_review_required', 'visual_quality', 'warning', 'manual_review',
    'Manual review required after repair; inspect final template before accepting.', updated_at
  from recent where repair_manual_review = true
  union all
  select import_id, source_filename, 'ai_reconciliation_recommended_not_run', 'ai_reconciliation', 'warning', 'operator',
    'Run AI reconciliation, then rerun Visual QA before applying.', updated_at
  from recent where ai_recommendation in ('recommended', 'manual_review') and coalesce(ai_status, '') <> 'completed'
  union all
  select import_id, source_filename, 'ai_reconciliation_failed', 'ai_reconciliation', 'warning', 'developer_frontend',
    'Inspect AI reconciliation call/logs; retry or move to manual review.', updated_at
  from recent where ai_status = 'failed'
  union all
  select import_id, source_filename, 'export_parity_artifact_missing', 'export_parity', 'error', 'operator',
    'Record or rerun export parity for this import.', updated_at
  from recent where visual_quality_artifact_path is not null and repair_artifact_path is not null and export_parity_artifact_path is null
  union all
  select import_id, source_filename, 'export_parity_failed', 'export_parity', 'error', 'developer_frontend',
    'Inspect exported PDF/editor/source mismatch and patch renderer if repeated.', updated_at
  from recent where export_status = 'failed'
  union all
  select import_id, source_filename, 'export_parity_manual_required', 'export_parity', 'warning', 'manual_review',
    'Manually inspect source/editor/export parity and accept or reject.', updated_at
  from recent where export_status = 'manual_required'
  union all
  select import_id, source_filename, 'golden_regression_missing', 'golden_regression', 'warning', 'operator',
    'Run and persist golden regression summary if this import belongs to the corpus.', updated_at
  from recent where visual_quality_artifact_path is not null and repair_artifact_path is not null
    and export_parity_artifact_path is not null and quality_gate_status is null
  union all
  select import_id, source_filename, 'quality_gate_failed', 'golden_regression', 'error', 'qa',
    'Inspect failures array, then rerun or patch the failing stage.', updated_at
  from recent where quality_gate_status = 'fail'
  union all
  select import_id, source_filename, 'quality_gate_blocked', 'golden_regression', 'error', 'operator',
    'Rerun golden regression after missing prerequisites are resolved.', updated_at
  from recent where quality_gate_status = 'blocked'
  union all
  select import_id, source_filename, 'operator_rejected', 'golden_regression', 'error', 'qa',
    'Review operator rejection notes and fix underlying issue before accepting.', updated_at
  from recent where operator_decision = 'rejected'
  union all
  select import_id, source_filename, 'operator_needs_rerun', 'golden_regression', 'warning', 'operator',
    'Rerun golden regression for this corpus item.', updated_at
  from recent where operator_decision = 'needs_rerun'
)
-- ---------------------------------------------------------------------------
-- 2. Triage summary by severity/category
-- ---------------------------------------------------------------------------
select severity, category, count(*) as issue_count
from triage_rows
group by severity, category
order by case severity when 'critical' then 1 when 'error' then 2 when 'warning' then 3 else 4 end, category;


with recent as (
  select
    ti.id as import_id,
    ti.status,
    ti.source_filename,
    ti.page_count,
    ti.created_template_id as template_id,
    ti.error,

    ti.meta->'import_manifests_summary'->>'job_id' as pdf_job_id,
    ti.meta->'import_manifests_summary'->>'engine_version' as engine_version,

    ti.meta->>'visual_quality_artifact_path' as visual_quality_artifact_path,
    ti.meta->'visual_quality_summary'->>'overallScore' as visual_quality_score,
    (ti.meta->'visual_quality_summary'->>'manualReviewRequired')::boolean as visual_manual_review,

    ti.meta->>'visual_repair_artifact_path' as repair_artifact_path,
    ti.meta->'visual_repair_summary'->>'repairStatus' as repair_status,
    ti.meta->'visual_repair_summary'->>'finalScore' as repair_final_score,
    (ti.meta->'visual_repair_summary'->>'requiresFallback')::boolean as repair_requires_fallback,
    (ti.meta->'visual_repair_summary'->>'requiresManualReview')::boolean as repair_manual_review,

    ti.meta->'ai_reconciliation_summary'->>'status' as ai_status,
    ti.meta->'ai_reconciliation_summary'->>'recommendation' as ai_recommendation,

    ti.meta->>'export_parity_artifact_path' as export_parity_artifact_path,
    ti.meta->'export_parity_summary'->>'status' as export_status,
    ti.meta->'export_parity_summary'->>'exportVsSourceScore' as export_vs_source_score,

    ti.meta->'golden_regression_summary'->>'corpusId' as corpus_id,
    ti.meta->'golden_regression_summary'->>'qualityGateStatus' as quality_gate_status,
    ti.meta->'golden_regression_summary'->>'operatorDecision' as operator_decision,
    ti.meta->'golden_regression_summary'->'warnings' as golden_warnings,
    ti.meta->'golden_regression_summary'->'failures' as golden_failures,

    ti.updated_at
  from public.template_imports ti
  order by ti.updated_at desc
  limit 100
),
triage_rows as (
  select import_id, source_filename, 'import_failed' as triage_code, 'import' as category, 'error' as severity, 'developer_fullstack' as owner,
    'Inspect PDF import jobs and function logs, then rerun import when cause is understood.' as recommendation, updated_at
  from recent where status = 'failed' or error is not null
  union all
  select import_id, source_filename, 'engine_version_missing', 'diagnostics', 'warning', 'developer_backend',
    'Inspect pdf_import_jobs and import manifest metadata.', updated_at
  from recent where status = 'completed' and engine_version is null
  union all
  select import_id, source_filename, 'visual_quality_artifact_missing', 'visual_quality', 'error', 'developer_frontend',
    'Rerun Visual QA and inspect source/generated raster availability.', updated_at
  from recent where status = 'completed' and visual_quality_artifact_path is null
  union all
  select import_id, source_filename, 'visual_quality_manual_review_required', 'visual_quality', 'warning', 'manual_review',
    'Manually inspect source/generated/diff rasters; run AI reconciliation if useful.', updated_at
  from recent where visual_manual_review = true
  union all
  select import_id, source_filename, 'repair_audit_missing', 'repair', 'error', 'developer_backend',
    'Rerun repair and inspect save_visual_repair_audit/storage persistence.', updated_at
  from recent where visual_quality_artifact_path is not null and repair_artifact_path is null
  union all
  select import_id, source_filename, 'repair_failed', 'repair', 'error', 'developer_frontend',
    'Rerun repair; if repeated, run AI reconciliation or inspect repair pipeline.', updated_at
  from recent where repair_status = 'failed'
  union all
  select import_id, source_filename, 'repair_skipped_no_eligible_pages', 'repair', 'warning', 'qa',
    'Accept if no eligible pages were expected; otherwise inspect repair eligibility.', updated_at
  from recent where repair_status = 'skipped'
  union all
  select import_id, source_filename, 'fallback_used', 'repair', 'warning', 'qa',
    'Manual review required; verify source raster was preserved and output is acceptable.', updated_at
  from recent where repair_requires_fallback = true
  union all
  select import_id, source_filename, 'visual_quality_manual_review_required', 'visual_quality', 'warning', 'manual_review',
    'Manual review required after repair; inspect final template before accepting.', updated_at
  from recent where repair_manual_review = true
  union all
  select import_id, source_filename, 'ai_reconciliation_recommended_not_run', 'ai_reconciliation', 'warning', 'operator',
    'Run AI reconciliation, then rerun Visual QA before applying.', updated_at
  from recent where ai_recommendation in ('recommended', 'manual_review') and coalesce(ai_status, '') <> 'completed'
  union all
  select import_id, source_filename, 'ai_reconciliation_failed', 'ai_reconciliation', 'warning', 'developer_frontend',
    'Inspect AI reconciliation call/logs; retry or move to manual review.', updated_at
  from recent where ai_status = 'failed'
  union all
  select import_id, source_filename, 'export_parity_artifact_missing', 'export_parity', 'error', 'operator',
    'Record or rerun export parity for this import.', updated_at
  from recent where visual_quality_artifact_path is not null and repair_artifact_path is not null and export_parity_artifact_path is null
  union all
  select import_id, source_filename, 'export_parity_failed', 'export_parity', 'error', 'developer_frontend',
    'Inspect exported PDF/editor/source mismatch and patch renderer if repeated.', updated_at
  from recent where export_status = 'failed'
  union all
  select import_id, source_filename, 'export_parity_manual_required', 'export_parity', 'warning', 'manual_review',
    'Manually inspect source/editor/export parity and accept or reject.', updated_at
  from recent where export_status = 'manual_required'
  union all
  select import_id, source_filename, 'golden_regression_missing', 'golden_regression', 'warning', 'operator',
    'Run and persist golden regression summary if this import belongs to the corpus.', updated_at
  from recent where visual_quality_artifact_path is not null and repair_artifact_path is not null
    and export_parity_artifact_path is not null and quality_gate_status is null
  union all
  select import_id, source_filename, 'quality_gate_failed', 'golden_regression', 'error', 'qa',
    'Inspect failures array, then rerun or patch the failing stage.', updated_at
  from recent where quality_gate_status = 'fail'
  union all
  select import_id, source_filename, 'quality_gate_blocked', 'golden_regression', 'error', 'operator',
    'Rerun golden regression after missing prerequisites are resolved.', updated_at
  from recent where quality_gate_status = 'blocked'
  union all
  select import_id, source_filename, 'operator_rejected', 'golden_regression', 'error', 'qa',
    'Review operator rejection notes and fix underlying issue before accepting.', updated_at
  from recent where operator_decision = 'rejected'
  union all
  select import_id, source_filename, 'operator_needs_rerun', 'golden_regression', 'warning', 'operator',
    'Rerun golden regression for this corpus item.', updated_at
  from recent where operator_decision = 'needs_rerun'
)
-- ---------------------------------------------------------------------------
-- 3. Triage summary by owner
-- ---------------------------------------------------------------------------
select owner, count(*) as issue_count,
  count(*) filter (where severity = 'error') as error_count,
  count(*) filter (where severity = 'warning') as warning_count
from triage_rows
group by owner
order by error_count desc, warning_count desc, issue_count desc;


with recent as (
  select
    ti.id as import_id,
    ti.status,
    ti.source_filename,
    ti.page_count,
    ti.created_template_id as template_id,
    ti.error,

    ti.meta->'import_manifests_summary'->>'job_id' as pdf_job_id,
    ti.meta->'import_manifests_summary'->>'engine_version' as engine_version,

    ti.meta->>'visual_quality_artifact_path' as visual_quality_artifact_path,
    ti.meta->'visual_quality_summary'->>'overallScore' as visual_quality_score,
    (ti.meta->'visual_quality_summary'->>'manualReviewRequired')::boolean as visual_manual_review,

    ti.meta->>'visual_repair_artifact_path' as repair_artifact_path,
    ti.meta->'visual_repair_summary'->>'repairStatus' as repair_status,
    ti.meta->'visual_repair_summary'->>'finalScore' as repair_final_score,
    (ti.meta->'visual_repair_summary'->>'requiresFallback')::boolean as repair_requires_fallback,
    (ti.meta->'visual_repair_summary'->>'requiresManualReview')::boolean as repair_manual_review,

    ti.meta->'ai_reconciliation_summary'->>'status' as ai_status,
    ti.meta->'ai_reconciliation_summary'->>'recommendation' as ai_recommendation,

    ti.meta->>'export_parity_artifact_path' as export_parity_artifact_path,
    ti.meta->'export_parity_summary'->>'status' as export_status,
    ti.meta->'export_parity_summary'->>'exportVsSourceScore' as export_vs_source_score,

    ti.meta->'golden_regression_summary'->>'corpusId' as corpus_id,
    ti.meta->'golden_regression_summary'->>'qualityGateStatus' as quality_gate_status,
    ti.meta->'golden_regression_summary'->>'operatorDecision' as operator_decision,
    ti.meta->'golden_regression_summary'->'warnings' as golden_warnings,
    ti.meta->'golden_regression_summary'->'failures' as golden_failures,

    ti.updated_at
  from public.template_imports ti
  order by ti.updated_at desc
  limit 100
),
triage_rows as (
  select import_id, source_filename, 'import_failed' as triage_code, 'import' as category, 'error' as severity, 'developer_fullstack' as owner,
    'Inspect PDF import jobs and function logs, then rerun import when cause is understood.' as recommendation, updated_at
  from recent where status = 'failed' or error is not null
  union all
  select import_id, source_filename, 'engine_version_missing', 'diagnostics', 'warning', 'developer_backend',
    'Inspect pdf_import_jobs and import manifest metadata.', updated_at
  from recent where status = 'completed' and engine_version is null
  union all
  select import_id, source_filename, 'visual_quality_artifact_missing', 'visual_quality', 'error', 'developer_frontend',
    'Rerun Visual QA and inspect source/generated raster availability.', updated_at
  from recent where status = 'completed' and visual_quality_artifact_path is null
  union all
  select import_id, source_filename, 'visual_quality_manual_review_required', 'visual_quality', 'warning', 'manual_review',
    'Manually inspect source/generated/diff rasters; run AI reconciliation if useful.', updated_at
  from recent where visual_manual_review = true
  union all
  select import_id, source_filename, 'repair_audit_missing', 'repair', 'error', 'developer_backend',
    'Rerun repair and inspect save_visual_repair_audit/storage persistence.', updated_at
  from recent where visual_quality_artifact_path is not null and repair_artifact_path is null
  union all
  select import_id, source_filename, 'repair_failed', 'repair', 'error', 'developer_frontend',
    'Rerun repair; if repeated, run AI reconciliation or inspect repair pipeline.', updated_at
  from recent where repair_status = 'failed'
  union all
  select import_id, source_filename, 'repair_skipped_no_eligible_pages', 'repair', 'warning', 'qa',
    'Accept if no eligible pages were expected; otherwise inspect repair eligibility.', updated_at
  from recent where repair_status = 'skipped'
  union all
  select import_id, source_filename, 'fallback_used', 'repair', 'warning', 'qa',
    'Manual review required; verify source raster was preserved and output is acceptable.', updated_at
  from recent where repair_requires_fallback = true
  union all
  select import_id, source_filename, 'visual_quality_manual_review_required', 'visual_quality', 'warning', 'manual_review',
    'Manual review required after repair; inspect final template before accepting.', updated_at
  from recent where repair_manual_review = true
  union all
  select import_id, source_filename, 'ai_reconciliation_recommended_not_run', 'ai_reconciliation', 'warning', 'operator',
    'Run AI reconciliation, then rerun Visual QA before applying.', updated_at
  from recent where ai_recommendation in ('recommended', 'manual_review') and coalesce(ai_status, '') <> 'completed'
  union all
  select import_id, source_filename, 'ai_reconciliation_failed', 'ai_reconciliation', 'warning', 'developer_frontend',
    'Inspect AI reconciliation call/logs; retry or move to manual review.', updated_at
  from recent where ai_status = 'failed'
  union all
  select import_id, source_filename, 'export_parity_artifact_missing', 'export_parity', 'error', 'operator',
    'Record or rerun export parity for this import.', updated_at
  from recent where visual_quality_artifact_path is not null and repair_artifact_path is not null and export_parity_artifact_path is null
  union all
  select import_id, source_filename, 'export_parity_failed', 'export_parity', 'error', 'developer_frontend',
    'Inspect exported PDF/editor/source mismatch and patch renderer if repeated.', updated_at
  from recent where export_status = 'failed'
  union all
  select import_id, source_filename, 'export_parity_manual_required', 'export_parity', 'warning', 'manual_review',
    'Manually inspect source/editor/export parity and accept or reject.', updated_at
  from recent where export_status = 'manual_required'
  union all
  select import_id, source_filename, 'golden_regression_missing', 'golden_regression', 'warning', 'operator',
    'Run and persist golden regression summary if this import belongs to the corpus.', updated_at
  from recent where visual_quality_artifact_path is not null and repair_artifact_path is not null
    and export_parity_artifact_path is not null and quality_gate_status is null
  union all
  select import_id, source_filename, 'quality_gate_failed', 'golden_regression', 'error', 'qa',
    'Inspect failures array, then rerun or patch the failing stage.', updated_at
  from recent where quality_gate_status = 'fail'
  union all
  select import_id, source_filename, 'quality_gate_blocked', 'golden_regression', 'error', 'operator',
    'Rerun golden regression after missing prerequisites are resolved.', updated_at
  from recent where quality_gate_status = 'blocked'
  union all
  select import_id, source_filename, 'operator_rejected', 'golden_regression', 'error', 'qa',
    'Review operator rejection notes and fix underlying issue before accepting.', updated_at
  from recent where operator_decision = 'rejected'
  union all
  select import_id, source_filename, 'operator_needs_rerun', 'golden_regression', 'warning', 'operator',
    'Rerun golden regression for this corpus item.', updated_at
  from recent where operator_decision = 'needs_rerun'
)
-- ---------------------------------------------------------------------------
-- 4. Imports with most triage items
-- ---------------------------------------------------------------------------
select import_id, source_filename, count(*) as triage_issue_count,
  count(*) filter (where severity = 'error') as error_count,
  count(*) filter (where severity = 'warning') as warning_count,
  max(updated_at) as latest_updated_at
from triage_rows
group by import_id, source_filename
order by error_count desc, warning_count desc, triage_issue_count desc
limit 50;


-- ---------------------------------------------------------------------------
-- 5. Phase 8F note
-- ---------------------------------------------------------------------------
select
  'phase_8f_failure_triage' as phase,
  'This SQL maps current PDF import quality failures/warnings to recovery recommendations. It does not mutate data.' as note;
