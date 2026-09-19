-- Phase 11E Artifact Retention + Cleanup Policy Check
-- Run in the Supabase SQL Editor.
--
-- Purpose:
-- Validate PDF import retention events, cleanup candidates, storage references,
-- metadata bloat, and dry-run cleanup readiness.
--
-- This SQL is READ-ONLY. It does not delete or modify anything.
--
-- NOTE: pdf_import_monitoring_events uses rule_id + suppressed_until (not
-- alert_rule_id / suppressed_at). template_imports uses source_filename + meta.

-- ---------------------------------------------------------------------------
-- 1. Retention events table existence
-- ---------------------------------------------------------------------------
select
  'pdf_import_retention_events' as object_name,
  to_regclass('public.pdf_import_retention_events') as object_regclass;

-- ---------------------------------------------------------------------------
-- 2. Latest retention events
-- ---------------------------------------------------------------------------
select
  e.id, e.retention_rule_id, e.domain, e.decision, e.cleanup_action, e.safety_level, e.status,
  e.title, e.scope_type, e.scope_id, e.scope_label, e.storage_bucket, e.storage_object_path,
  e.import_id, e.template_id, e.estimated_bytes, e.occurrence_count,
  e.first_seen_at, e.last_seen_at, e.reviewed_at, e.approved_at, e.rejected_at, e.blocked_at,
  e.created_at, e.updated_at
from public.pdf_import_retention_events e
order by e.last_seen_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 3. Active retention candidates by decision/domain
-- ---------------------------------------------------------------------------
select
  e.decision, e.cleanup_action, e.safety_level, e.domain, e.status,
  count(*) as candidate_count,
  coalesce(sum(e.estimated_bytes), 0) as estimated_bytes,
  max(e.last_seen_at) as latest_seen_at
from public.pdf_import_retention_events e
where e.status in ('candidate', 'reviewed', 'approved_for_future_cleanup', 'blocked')
group by e.decision, e.cleanup_action, e.safety_level, e.domain, e.status
order by
  case e.decision
    when 'delete_candidate' then 1
    when 'archive_candidate' then 2
    when 'review' then 3
    when 'blocked' then 4
    when 'retain' then 5
    else 6
  end,
  candidate_count desc;

-- ---------------------------------------------------------------------------
-- 4. Delete candidates requiring developer approval
-- ---------------------------------------------------------------------------
select
  e.id, e.retention_rule_id, e.domain, e.title, e.message, e.scope_type, e.scope_id, e.scope_label,
  e.storage_bucket, e.storage_object_path, e.estimated_bytes, e.safety_level, e.status, e.recommended_action, e.last_seen_at
from public.pdf_import_retention_events e
where e.status in ('candidate', 'reviewed', 'approved_for_future_cleanup')
  and e.decision = 'delete_candidate'
order by e.estimated_bytes desc nulls last, e.last_seen_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 5. Archive candidates
-- ---------------------------------------------------------------------------
select
  e.id, e.retention_rule_id, e.domain, e.title, e.scope_type, e.scope_id, e.scope_label,
  e.storage_bucket, e.storage_object_path, e.estimated_bytes, e.status, e.last_seen_at
from public.pdf_import_retention_events e
where e.status in ('candidate', 'reviewed', 'approved_for_future_cleanup')
  and e.decision = 'archive_candidate'
order by e.estimated_bytes desc nulls last, e.last_seen_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 6. Retention event lifecycle summary
-- ---------------------------------------------------------------------------
select
  status, count(*) as event_count, coalesce(sum(estimated_bytes), 0) as estimated_bytes,
  min(first_seen_at) as earliest_first_seen, max(last_seen_at) as latest_last_seen
from public.pdf_import_retention_events
group by status
order by status;

-- ---------------------------------------------------------------------------
-- 7. Retention event dedupe health (active rows only)
-- ---------------------------------------------------------------------------
select
  dedupe_key, count(*) as active_duplicate_count, array_agg(id order by created_at desc) as event_ids
from public.pdf_import_retention_events
where status in ('candidate', 'reviewed', 'approved_for_future_cleanup', 'blocked')
group by dedupe_key
having count(*) > 1
order by active_duplicate_count desc;

-- ---------------------------------------------------------------------------
-- 8. Retention event integrity
-- ---------------------------------------------------------------------------
select
  e.id, e.retention_rule_id, e.domain, e.decision, e.cleanup_action, e.safety_level, e.status,
  case
    when e.retention_rule_id is null or length(trim(e.retention_rule_id)) = 0 then 'fail_missing_rule_id'
    when e.domain is null or length(trim(e.domain)) = 0 then 'fail_missing_domain'
    when e.decision not in ('retain', 'review', 'archive_candidate', 'delete_candidate', 'blocked', 'unknown') then 'fail_invalid_decision'
    when e.cleanup_action not in ('no_action','mark_for_review','archive_later','delete_later','compact_metadata_later','repair_reference','preserve_for_audit','preserve_for_regression','preserve_for_manual_review','blocked_from_cleanup') then 'fail_invalid_cleanup_action'
    when e.safety_level not in ('safe_to_recommend','requires_operator_approval','requires_developer_approval','manual_only','blocked') then 'fail_invalid_safety_level'
    when e.status not in ('candidate','reviewed','approved_for_future_cleanup','rejected','blocked','completed','superseded') then 'fail_invalid_status'
    when e.scope_type is null or length(trim(e.scope_type)) = 0 then 'fail_missing_scope_type'
    when e.scope_id is null or length(trim(e.scope_id)) = 0 then 'fail_missing_scope_id'
    when e.dedupe_key is null or length(trim(e.dedupe_key)) = 0 then 'fail_missing_dedupe_key'
    when e.occurrence_count < 1 then 'fail_invalid_occurrence_count'
    when e.evidence is null then 'warning_missing_evidence'
    else 'pass'
  end as integrity_status,
  e.updated_at
from public.pdf_import_retention_events e
order by e.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 9. Storage bucket object volume
-- ---------------------------------------------------------------------------
select
  o.bucket_id, count(*) as object_count,
  coalesce(sum(nullif(o.metadata->>'size','')::bigint), 0) as estimated_size_from_metadata,
  min(o.created_at) as oldest_object, max(o.created_at) as newest_object
from storage.objects o
where o.bucket_id = 'template-import-artifacts'
group by o.bucket_id;

-- ---------------------------------------------------------------------------
-- 10. Referenced artifact paths from template_imports
-- ---------------------------------------------------------------------------
with referenced_paths as (
  select ti.id as import_id, ti.source_filename, 'visual_quality' as artifact_type, ti.meta->>'visual_quality_artifact_path' as artifact_path
  from public.template_imports ti where ti.meta->>'visual_quality_artifact_path' is not null
  union all
  select ti.id, ti.source_filename, 'visual_repair', ti.meta->>'visual_repair_artifact_path'
  from public.template_imports ti where ti.meta->>'visual_repair_artifact_path' is not null
  union all
  select ti.id, ti.source_filename, 'export_parity', ti.meta->>'export_parity_artifact_path'
  from public.template_imports ti where ti.meta->>'export_parity_artifact_path' is not null
)
select artifact_type, count(*) as reference_count,
  count(*) filter (where artifact_path ilike 'http%') as suspicious_url_reference_count
from referenced_paths
group by artifact_type
order by artifact_type;

-- ---------------------------------------------------------------------------
-- 11. Missing referenced storage objects
-- ---------------------------------------------------------------------------
with referenced_paths as (
  select ti.id as import_id, ti.source_filename, 'visual_quality' as artifact_type, ti.meta->>'visual_quality_artifact_path' as artifact_path
  from public.template_imports ti where ti.meta->>'visual_quality_artifact_path' is not null
  union all
  select ti.id, ti.source_filename, 'visual_repair', ti.meta->>'visual_repair_artifact_path'
  from public.template_imports ti where ti.meta->>'visual_repair_artifact_path' is not null
  union all
  select ti.id, ti.source_filename, 'export_parity', ti.meta->>'export_parity_artifact_path'
  from public.template_imports ti where ti.meta->>'export_parity_artifact_path' is not null
)
select
  rp.import_id, rp.source_filename, rp.artifact_type, rp.artifact_path,
  count(o.id) as storage_object_count,
  case
    when rp.artifact_path ilike 'http%' then 'review_signed_or_external_url_reference'
    when count(o.id) = 0 then 'missing_storage_object'
    when count(o.id) > 1 then 'duplicate_storage_objects'
    else 'pass'
  end as reference_status
from referenced_paths rp
left join storage.objects o on o.bucket_id = 'template-import-artifacts' and o.name = rp.artifact_path
group by rp.import_id, rp.source_filename, rp.artifact_type, rp.artifact_path
having count(o.id) <> 1 or rp.artifact_path ilike 'http%'
order by rp.import_id, rp.artifact_type
limit 200;

-- ---------------------------------------------------------------------------
-- 12. Potential orphaned storage objects
-- ---------------------------------------------------------------------------
with referenced_paths as (
  select ti.meta->>'visual_quality_artifact_path' as artifact_path from public.template_imports ti where ti.meta->>'visual_quality_artifact_path' is not null
  union
  select ti.meta->>'visual_repair_artifact_path' from public.template_imports ti where ti.meta->>'visual_repair_artifact_path' is not null
  union
  select ti.meta->>'export_parity_artifact_path' from public.template_imports ti where ti.meta->>'export_parity_artifact_path' is not null
)
select
  o.id as object_id, o.bucket_id, o.name as object_path, o.metadata, o.created_at, o.updated_at,
  case
    when o.created_at < now() - interval '90 days' and rp.artifact_path is null then 'orphan_delete_candidate_after_review'
    when rp.artifact_path is null then 'orphan_recent_review'
    else 'referenced'
  end as retention_signal
from storage.objects o
left join referenced_paths rp on rp.artifact_path = o.name
where o.bucket_id = 'template-import-artifacts' and rp.artifact_path is null
order by o.created_at asc
limit 200;

-- ---------------------------------------------------------------------------
-- 13. Metadata size risk
-- ---------------------------------------------------------------------------
select
  ti.id as import_id, ti.source_filename, pg_column_size(ti.meta) as meta_size_bytes,
  case
    when pg_column_size(ti.meta) > 500000 then 'compact_metadata_candidate_high'
    when pg_column_size(ti.meta) > 200000 then 'compact_metadata_candidate_medium'
    else 'pass'
  end as metadata_retention_signal,
  ti.updated_at
from public.template_imports ti
order by pg_column_size(ti.meta) desc
limit 100;

-- ---------------------------------------------------------------------------
-- 14. Old resolved monitoring events (rule_id + suppressed_until)
-- ---------------------------------------------------------------------------
select
  e.id, e.rule_id, e.domain, e.severity, e.status, e.title, e.resolved_at, e.suppressed_until, e.updated_at,
  case
    when e.status in ('resolved', 'suppressed', 'false_positive') and e.updated_at < now() - interval '180 days'
    then 'monitoring_archive_candidate'
    else 'retain'
  end as monitoring_retention_signal
from public.pdf_import_monitoring_events e
where e.status in ('resolved', 'suppressed', 'false_positive')
order by e.updated_at asc
limit 100;

-- ---------------------------------------------------------------------------
-- 15. Golden history retention signal
-- ---------------------------------------------------------------------------
select
  corpus_id, count(*) as history_count, min(created_at) as oldest_run, max(created_at) as newest_run,
  count(*) filter (where created_at < now() - interval '365 days') as older_than_365_days,
  'retain_summary_rows_do_not_delete_automatically' as retention_signal
from public.pdf_import_golden_runs
group by corpus_id
order by history_count desc;

-- ---------------------------------------------------------------------------
-- 16. Retention readiness rollup
-- ---------------------------------------------------------------------------
with signals as (
  select
    (select count(*) from public.pdf_import_retention_events) as total_retention_events,
    (select count(*) from public.pdf_import_retention_events where status in ('candidate','reviewed','approved_for_future_cleanup') and decision = 'delete_candidate') as active_delete_candidates,
    (select count(*) from public.pdf_import_retention_events where status in ('candidate','reviewed','approved_for_future_cleanup') and decision = 'archive_candidate') as active_archive_candidates,
    (select count(*) from public.pdf_import_retention_events where status in ('candidate','reviewed','approved_for_future_cleanup') and decision = 'review') as active_review_candidates,
    (select count(*) from public.pdf_import_retention_events where status = 'blocked') as blocked_retention_events,
    (select count(*) from storage.objects o where o.bucket_id = 'template-import-artifacts') as template_import_storage_objects,
    (select count(*) from public.template_imports ti where pg_column_size(ti.meta) > 500000) as high_meta_size_imports
)
select
  total_retention_events, active_delete_candidates, active_archive_candidates, active_review_candidates,
  blocked_retention_events, template_import_storage_objects, high_meta_size_imports,
  case
    when total_retention_events = 0 then 'retention_ready_no_scan_events_yet'
    when active_delete_candidates > 0 then 'retention_active_with_delete_candidates_review_required'
    when active_archive_candidates > 0 or active_review_candidates > 0 then 'retention_active_with_review_candidates'
    else 'retention_active_no_destructive_candidates'
  end as retention_readiness_status
from signals;

-- ---------------------------------------------------------------------------
-- 17. Phase 11E note
-- ---------------------------------------------------------------------------
select
  'phase_11e_artifact_retention_cleanup_policy' as phase,
  'Retention events are dry-run candidates only. Phase 11E must not physically delete or archive storage objects or database rows.' as note;
