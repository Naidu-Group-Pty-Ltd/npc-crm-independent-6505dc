-- Phase 7D.1 Page Context Recovery Check
-- Purpose:
--   Distinguish stale metadata from actual missing page-context artifacts.
--
-- Run in Supabase SQL Editor.

with recent_imports as (
  select
    ti.id,
    ti.source_filename,
    ti.page_count,
    ti.created_template_id,
    ti.status,
    ti.meta,
    ti.updated_at
  from public.template_imports ti
  where ti.created_template_id is not null
  order by ti.updated_at desc
  limit 50
),
job_join as (
  select
    ri.*,
    ri.meta->'import_manifests_summary'->>'job_id' as manifest_job_id,
    ri.meta->'import_manifests_summary'->>'engine_version' as manifest_engine_version,
    ri.meta->'import_manifests_summary'->>'page_context_manifest_available' as meta_page_context_manifest_available,
    ri.meta->'import_manifests_summary'->>'per_page_docling_manifest_path' as meta_page_manifest_path,
    pij.id as pdf_job_id,
    pij.engine,
    pij.engine_version as job_engine_version,
    pij.status as job_status,
    pij.stage,
    pij.result_payload->>'per_page_docling_manifest_path' as job_page_manifest_path,
    pij.result_payload->>'rasters_manifest_path' as job_rasters_manifest_path,
    pij.result_payload->>'per_page_docling_artifact_version' as per_page_docling_artifact_version,
    pij.result_payload->>'per_page_docling_parent_manifest_version' as parent_manifest_version,
    pij.result_payload->>'per_page_docling_global_artifact_copy_version' as global_copy_version
  from recent_imports ri
  left join public.pdf_import_jobs pij
    on pij.id::text = ri.meta->'import_manifests_summary'->>'job_id'
),
resolved as (
  select
    jj.*,
    coalesce(
      nullif(jj.meta_page_manifest_path, ''),
      nullif(jj.job_page_manifest_path, ''),
      case
        when jj.manifest_job_id is not null then jj.manifest_job_id || '/pages-manifest.json'
        else null
      end
    ) as resolved_manifest_path
  from job_join jj
)
select
  r.id as import_id,
  r.source_filename,
  r.page_count,
  r.created_template_id,
  r.status,

  r.manifest_job_id,
  r.manifest_engine_version,
  r.meta_page_context_manifest_available,
  r.meta_page_manifest_path,

  r.pdf_job_id,
  r.engine,
  r.job_engine_version,
  r.job_status,
  r.stage,
  r.job_page_manifest_path,
  r.job_rasters_manifest_path,
  r.per_page_docling_artifact_version,
  r.parent_manifest_version,
  r.global_copy_version,

  r.resolved_manifest_path,
  case when o.name is not null then true else false end as resolved_manifest_object_exists,
  o.bucket_id as resolved_manifest_bucket,
  o.name as resolved_manifest_object_name,
  o.created_at as resolved_manifest_created_at,

  case
    when r.manifest_job_id is null then 'missing_job_id'
    when r.resolved_manifest_path is null then 'missing_resolved_manifest_path'
    when o.name is null then 'missing_manifest_object'
    when r.meta_page_context_manifest_available is distinct from 'true' then 'metadata_false_negative_but_recoverable'
    else 'metadata_and_storage_ok'
  end as page_context_recovery_status,

  r.updated_at
from resolved r
left join storage.objects o
  on o.bucket_id = 'pdf-import-diagnostics'
 and o.name = r.resolved_manifest_path
order by r.updated_at desc;
