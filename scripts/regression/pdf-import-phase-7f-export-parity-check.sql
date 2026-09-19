-- Phase 7F Export Parity Check
-- Read-only. Run in Supabase SQL Editor after persisting an export-parity summary.
--
-- Export parity compares (original uploaded PDF ≈ Template Builder editor preview ≈
-- final exported/generated PDF). Phase 7F persists a manual/operator parity summary
-- to template_imports.meta.export_parity_summary plus a JSON artifact referenced by
-- meta.export_parity_artifact_path. Templates are NOT mutated by parity validation.

-- 1. Latest export-parity summaries
select
  id as import_id,
  source_filename,
  created_template_id as template_id,
  page_count,
  meta->>'export_parity_artifact_path' as export_parity_artifact_path,
  meta->'export_parity_summary'->>'status' as status,
  meta->'export_parity_summary'->>'mode' as mode,
  meta->'export_parity_summary'->>'editorVsSourceScore' as editor_vs_source_score,
  meta->'export_parity_summary'->>'exportVsSourceScore' as export_vs_source_score,
  meta->'export_parity_summary'->>'exportVsEditorScore' as export_vs_editor_score,
  meta->'export_parity_summary'->>'manualReviewRequired' as manual_review_required,
  meta->'export_parity_summary'->>'sourcePageCount' as source_page_count,
  meta->'export_parity_summary'->>'editorPageCount' as editor_page_count,
  meta->'export_parity_summary'->>'exportedPageCount' as exported_page_count,
  meta->'export_parity_summary'->>'problemCount' as problem_count,
  meta->'export_parity_summary'->>'generatedAt' as generated_at,
  meta->'export_parity_summary'->>'persistedAt' as persisted_at,
  updated_at
from public.template_imports
where meta ? 'export_parity_summary'
order by updated_at desc
limit 50;

-- 2. Imports with a completed Visual QA report but no export-parity capture yet
select
  id as import_id,
  source_filename,
  created_template_id as template_id,
  page_count,
  meta->'visual_quality_summary'->>'overallScore' as visual_quality_score,
  updated_at
from public.template_imports
where meta->>'visual_quality_artifact_path' is not null
  and not (meta ? 'export_parity_summary')
order by updated_at desc
limit 50;

-- 3. Export-parity summaries flagged for manual review or carrying problems
select
  id as import_id,
  source_filename,
  meta->'export_parity_summary'->>'status' as status,
  meta->'export_parity_summary'->>'manualReviewRequired' as manual_review_required,
  meta->'export_parity_summary'->>'problemCount' as problem_count,
  updated_at
from public.template_imports
where meta ? 'export_parity_summary'
  and (
    (meta->'export_parity_summary'->>'manualReviewRequired')::boolean is true
    or coalesce((meta->'export_parity_summary'->>'problemCount')::int, 0) > 0
    or meta->'export_parity_summary'->>'status' in ('manual_required', 'failed')
  )
order by updated_at desc
limit 50;

-- 4. Summary counts
select
  count(*) filter (where meta ? 'export_parity_summary') as imports_with_export_parity,
  count(*) filter (where meta->'export_parity_summary'->>'status' = 'completed') as export_parity_completed,
  count(*) filter (where meta->'export_parity_summary'->>'status' = 'manual_required') as export_parity_manual_required,
  count(*) filter (where meta->'export_parity_summary'->>'status' = 'failed') as export_parity_failed,
  count(*) filter (where (meta->'export_parity_summary'->>'manualReviewRequired')::boolean is true) as export_parity_manual_review_flagged
from public.template_imports;

-- 5. Guardrail: export-parity persistence must not have mutated report_templates.
--    This lists templates whose updated_at moved AFTER their import's parity was
--    persisted — expected to return zero rows under Phase 7F (parity is read-only).
select
  ti.id as import_id,
  rt.id as template_id,
  rt.updated_at as template_updated_at,
  (ti.meta->'export_parity_summary'->>'persistedAt') as parity_persisted_at
from public.template_imports ti
join public.report_templates rt on rt.id = ti.created_template_id
where ti.meta ? 'export_parity_summary'
  and (ti.meta->'export_parity_summary'->>'persistedAt') is not null
  and rt.updated_at > (ti.meta->'export_parity_summary'->>'persistedAt')::timestamptz
order by rt.updated_at desc
limit 50;
