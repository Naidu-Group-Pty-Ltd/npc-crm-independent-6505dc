-- Phase 2H — PDF Import Regression Lock
-- Run this in Supabase SQL Editor after small, large, and cache-hit import tests.

-- ============================================================
-- 1) Recent parser jobs overview
-- ============================================================
select
  id,
  source_file_name,
  status,
  stage,
  page_count,
  pages_completed,
  pages_total,
  cache_hit,
  cache_source_job_id,
  plan_payload->>'selected_lane' as selected_lane,
  plan_payload->>'dispatch_effective_mode' as dispatch_effective_mode,
  result_payload->>'artifact_contract_version' as artifact_contract_version,
  result_payload->>'docling_page_rebase_version' as docling_page_rebase_version,
  result_payload->>'chunk_merge_validation_version' as chunk_merge_validation_version,
  result_payload->'merge_validation'->>'ok' as merge_validation_ok,
  result_payload->>'terminal_state_version' as terminal_state_version,
  result_payload->>'lane_enforcement_version' as lane_enforcement_version,
  result_payload->>'extractor_lane' as extractor_lane,
  result_payload->>'cache_safety_version' as cache_safety_version,
  jsonb_array_length(coalesce(result_payload->'page_raster_paths', '[]'::jsonb)) as page_raster_count,
  created_at,
  updated_at
from public.pdf_import_jobs
order by created_at desc
limit 15;


-- ============================================================
-- 2) Parser bad-state detector
-- Expected: zero rows
-- ============================================================
select
  id,
  source_file_name,
  status,
  stage,
  page_count,
  pages_completed,
  pages_total,
  cache_hit,
  result_payload->>'artifact_contract_version' as artifact_contract_version,
  result_payload->>'docling_page_rebase_version' as docling_page_rebase_version,
  result_payload->>'chunk_merge_validation_version' as chunk_merge_validation_version,
  result_payload->'merge_validation'->>'ok' as merge_validation_ok,
  result_payload->>'terminal_state_version' as terminal_state_version,
  result_payload->>'lane_enforcement_version' as lane_enforcement_version,
  jsonb_array_length(coalesce(result_payload->'page_raster_paths', '[]'::jsonb)) as page_raster_count,
  case
    when status = 'succeeded' and stage is distinct from 'parsed' then 'succeeded_not_parsed'
    when status = 'succeeded' and pages_total is not null and pages_completed is distinct from pages_total then 'page_progress_incomplete'
    when status = 'succeeded' and page_count is not null and jsonb_array_length(coalesce(result_payload->'page_raster_paths', '[]'::jsonb)) is distinct from page_count then 'page_raster_count_mismatch'
    when status = 'succeeded' and result_payload->>'artifact_contract_version' is distinct from 'raster-manifest-v1' then 'artifact_contract_missing'
    when status = 'succeeded' and chunked and result_payload->>'docling_page_rebase_version' is distinct from 'chunk-page-rebase-v1' then 'docling_rebase_missing'
    when status = 'succeeded' and chunked and result_payload->>'chunk_merge_validation_version' is distinct from 'chunk-merge-validation-v1' then 'merge_validation_version_missing'
    when status = 'succeeded' and chunked and result_payload->'merge_validation'->>'ok' is distinct from 'true' then 'merge_validation_not_ok'
    when status = 'succeeded' and chunked and result_payload->>'terminal_state_version' is distinct from 'terminal-state-normalizer-v1' then 'terminal_state_marker_missing'
    when status = 'succeeded' and result_payload->>'lane_enforcement_version' is null then 'lane_marker_missing'
    else 'unknown'
  end as failure_reason
from public.pdf_import_jobs
where status = 'succeeded'
  and (
    stage is distinct from 'parsed'
    or (pages_total is not null and pages_completed is distinct from pages_total)
    or (page_count is not null and jsonb_array_length(coalesce(result_payload->'page_raster_paths', '[]'::jsonb)) is distinct from page_count)
    or result_payload->>'artifact_contract_version' is distinct from 'raster-manifest-v1'
    or (chunked and result_payload->>'docling_page_rebase_version' is distinct from 'chunk-page-rebase-v1')
    or (chunked and result_payload->>'chunk_merge_validation_version' is distinct from 'chunk-merge-validation-v1')
    or (chunked and result_payload->'merge_validation'->>'ok' is distinct from 'true')
    or (chunked and result_payload->>'terminal_state_version' is distinct from 'terminal-state-normalizer-v1')
    or result_payload->>'lane_enforcement_version' is null
  )
order by updated_at desc
limit 50;


-- ============================================================
-- 3) Chunk health detector
-- Expected: zero rows for active/stale bad chunks
-- ============================================================
select
  c.job_id,
  j.source_file_name,
  j.status as job_status,
  j.stage as job_stage,
  c.chunk_index,
  c.page_start,
  c.page_end,
  c.status as chunk_status,
  c.attempts,
  c.max_attempts,
  c.error_code,
  left(c.error_text, 300) as error_text,
  c.updated_at,
  now() - c.updated_at as age_since_update
from public.pdf_import_chunks c
join public.pdf_import_jobs j on j.id = c.job_id
where j.created_at > now() - interval '2 days'
  and c.status in ('pending', 'dispatched', 'failed', 'fatal')
order by c.updated_at asc;


-- ============================================================
-- 4) Latest large Cloverton job detail
-- Expected: clean markers and page_raster_count = page_count
-- ============================================================
with latest as (
  select id
  from public.pdf_import_jobs
  where source_file_name ilike '%Cloverton%'
  order by created_at desc
  limit 1
)
select
  j.id,
  j.source_file_name,
  j.status,
  j.stage,
  j.page_count,
  j.pages_completed,
  j.pages_total,
  j.cache_hit,
  j.cache_source_job_id,
  j.result_payload->>'artifact_contract_version' as artifact_contract_version,
  j.result_payload->>'docling_page_rebase_version' as docling_page_rebase_version,
  j.result_payload->>'chunk_merge_validation_version' as chunk_merge_validation_version,
  j.result_payload->'merge_validation'->>'ok' as merge_validation_ok,
  j.result_payload->>'terminal_state_version' as terminal_state_version,
  j.result_payload->>'lane_enforcement_version' as lane_enforcement_version,
  j.result_payload->>'extractor_lane' as extractor_lane,
  j.result_payload->>'cache_safety_version' as cache_safety_version,
  jsonb_array_length(coalesce(j.result_payload->'page_raster_paths', '[]'::jsonb)) as page_raster_count,
  j.updated_at
from public.pdf_import_jobs j
join latest l on l.id = j.id;


-- ============================================================
-- 5) Latest large Cloverton chunks
-- Expected: all succeeded, total represented pages = parent page_count
-- ============================================================
with latest as (
  select id
  from public.pdf_import_jobs
  where source_file_name ilike '%Cloverton%'
  order by created_at desc
  limit 1
)
select
  c.status,
  count(*) as chunk_count,
  sum(c.page_end - c.page_start + 1) as represented_pages
from public.pdf_import_chunks c
join latest l on l.id = c.job_id
group by c.status
order by c.status;


-- ============================================================
-- 6) Recent template imports overview
-- ============================================================
select
  id,
  source_filename,
  status,
  created_template_id,
  meta->>'artifact_contract_version' as artifact_contract_version,
  meta->>'finalization_status' as finalization_status,
  meta->>'artifact_stage' as artifact_stage,
  meta->'import_manifests'->'pdf_import_job'->>'consumer_guardrail_version' as consumer_guardrail_version,
  meta->'import_manifests'->'pdf_import_job'->'parse_guardrails'->>'ok' as parse_guardrails_ok,
  meta->'import_manifests'->'pdf_import_job'->'artifact_guardrails'->>'ok' as artifact_guardrails_ok,
  meta->'import_manifests'->'pdf_import_job'->>'docling_page_rebase_version' as docling_page_rebase_version,
  meta->'import_manifests'->'pdf_import_job'->>'chunk_merge_validation_version' as chunk_merge_validation_version,
  meta->'import_manifests'->'pdf_import_job'->>'terminal_state_version' as terminal_state_version,
  created_at,
  updated_at
from public.template_imports
order by created_at desc
limit 15;


-- ============================================================
-- 7) Template import bad-state detector
-- Expected: zero rows for recent imports
-- ============================================================
select
  id,
  source_filename,
  status,
  created_template_id,
  meta->>'artifact_contract_version' as artifact_contract_version,
  meta->>'finalization_status' as finalization_status,
  meta->>'artifact_stage' as artifact_stage,
  meta->'import_manifests'->'pdf_import_job'->>'consumer_guardrail_version' as consumer_guardrail_version,
  meta->'import_manifests'->'pdf_import_job'->'parse_guardrails'->>'ok' as parse_guardrails_ok,
  meta->'import_manifests'->'pdf_import_job'->'artifact_guardrails'->>'ok' as artifact_guardrails_ok,
  case
    when status = 'completed' and created_template_id is null then 'completed_without_template'
    when status = 'completed' and meta->>'artifact_contract_version' is distinct from 'template-finalization-artifacts-v1' then 'template_artifact_contract_missing'
    when status = 'completed' and meta->>'finalization_status' is distinct from 'completed' then 'finalization_not_completed'
    when status = 'completed' and meta->>'artifact_stage' is distinct from 'staged' then 'artifact_stage_not_staged'
    when status = 'completed' and meta->'import_manifests'->'pdf_import_job'->>'consumer_guardrail_version' is distinct from 'template-import-consumer-guardrails-v1' then 'consumer_guardrail_missing'
    when status = 'completed' and meta->'import_manifests'->'pdf_import_job'->'parse_guardrails'->>'ok' is distinct from 'true' then 'parse_guardrails_not_ok'
    when status = 'completed' and meta->'import_manifests'->'pdf_import_job'->'artifact_guardrails'->>'ok' is distinct from 'true' then 'artifact_guardrails_not_ok'
    else 'unknown'
  end as failure_reason
from public.template_imports
where created_at > now() - interval '2 days'
  and status = 'completed'
  and (
    created_template_id is null
    or meta->>'artifact_contract_version' is distinct from 'template-finalization-artifacts-v1'
    or meta->>'finalization_status' is distinct from 'completed'
    or meta->>'artifact_stage' is distinct from 'staged'
    or meta->'import_manifests'->'pdf_import_job'->>'consumer_guardrail_version' is distinct from 'template-import-consumer-guardrails-v1'
    or meta->'import_manifests'->'pdf_import_job'->'parse_guardrails'->>'ok' is distinct from 'true'
    or meta->'import_manifests'->'pdf_import_job'->'artifact_guardrails'->>'ok' is distinct from 'true'
  )
order by updated_at desc;
