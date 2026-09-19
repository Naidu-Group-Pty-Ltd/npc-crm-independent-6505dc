-- Phase 11G Client-Safe Reporting / Audit Export Check
-- Run in the Supabase SQL Editor.
--
-- Purpose:
-- Validate PDF import client-safe report records, approval/export state, safety
-- levels, and unsafe-content indicators.
--
-- This SQL is READ-ONLY.

-- ---------------------------------------------------------------------------
-- 1. Client reports table existence
-- ---------------------------------------------------------------------------
select
  'pdf_import_client_reports' as object_name,
  to_regclass('public.pdf_import_client_reports') as object_regclass;

-- ---------------------------------------------------------------------------
-- 2. Latest client reports
-- ---------------------------------------------------------------------------
select
  r.id, r.import_id, r.template_id, r.report_type, r.audience, r.safety_level, r.status,
  r.title, left(r.summary, 200) as summary_preview,
  jsonb_array_length(coalesce(r.redactions, '[]'::jsonb)) as redaction_count,
  r.generated_at, r.reviewed_at, r.approved_at, r.exported_at, r.export_format, r.rejected_at, r.superseded_at,
  r.created_at, r.updated_at
from public.pdf_import_client_reports r
order by r.generated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 3. Report status/safety distribution
-- ---------------------------------------------------------------------------
select report_type, audience, safety_level, status, count(*) as report_count, max(generated_at) as latest_generated_at
from public.pdf_import_client_reports
group by report_type, audience, safety_level, status
order by report_count desc;

-- ---------------------------------------------------------------------------
-- 4. Reports blocked or internal-only or rejected
-- ---------------------------------------------------------------------------
select r.id, r.import_id, r.template_id, r.report_type, r.audience, r.safety_level, r.status, r.title, r.summary, r.redactions, r.generated_at
from public.pdf_import_client_reports r
where r.safety_level in ('internal_only', 'blocked') or r.status = 'rejected'
order by r.generated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 5. Approved/exported reports
-- ---------------------------------------------------------------------------
select r.id, r.import_id, r.template_id, r.report_type, r.audience, r.safety_level, r.status, r.export_format, r.approved_at, r.exported_at, r.approval_note, r.export_note
from public.pdf_import_client_reports r
where r.status in ('approved', 'exported')
order by coalesce(r.exported_at, r.approved_at, r.generated_at) desc
limit 100;

-- ---------------------------------------------------------------------------
-- 6. Export safety validation
-- ---------------------------------------------------------------------------
select
  r.id, r.report_type, r.audience, r.safety_level, r.status, r.export_format,
  case
    when r.status = 'exported' and r.approved_at is null then 'fail_exported_without_approval'
    when r.status = 'exported' and r.safety_level in ('internal_only', 'blocked') then 'fail_exported_unsafe_report'
    when r.status = 'approved' and r.safety_level = 'blocked' then 'fail_approved_blocked_report'
    when r.audience = 'external_client' and r.safety_level = 'internal_only' then 'fail_external_report_internal_only'
    when r.export_format = 'pdf' then 'review_pdf_export_enabled'
    else 'pass'
  end as export_safety_status,
  r.generated_at, r.approved_at, r.exported_at
from public.pdf_import_client_reports r
order by r.generated_at desc
limit 200;

-- ---------------------------------------------------------------------------
-- 7. Report integrity validation
-- ---------------------------------------------------------------------------
select
  r.id, r.report_type, r.audience, r.safety_level, r.status,
  case
    when r.report_type not in ('import_status_summary','template_quality_summary','manual_review_summary','accepted_with_warnings_summary','rejected_import_summary','production_audit_summary','release_readiness_summary') then 'fail_invalid_report_type'
    when r.audience not in ('internal_operator', 'internal_business', 'external_client') then 'fail_invalid_audience'
    when r.safety_level not in ('safe', 'safe_with_warnings', 'internal_only', 'blocked') then 'fail_invalid_safety_level'
    when r.status not in ('draft', 'pending_review', 'approved', 'exported', 'rejected', 'superseded') then 'fail_invalid_status'
    when r.title is null or length(trim(r.title)) = 0 then 'fail_missing_title'
    when r.summary is null or length(trim(r.summary)) = 0 then 'fail_missing_summary'
    when r.report_payload is null then 'fail_missing_payload'
    when r.redactions is null then 'warning_missing_redactions_array'
    else 'pass'
  end as integrity_status,
  r.updated_at
from public.pdf_import_client_reports r
order by r.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 8. Unsafe content pattern scan in stored sanitized reports
-- ---------------------------------------------------------------------------
select
  r.id, r.report_type, r.audience, r.safety_level, r.status,
  case
    when r.report_payload::text ilike '%signedUrl%'
      or r.report_payload::text ilike '%signed_url%'
      or r.report_payload::text ilike '%service_role%'
      or r.report_payload::text ilike '%SUPABASE_SERVICE_ROLE_KEY%'
      or r.report_payload::text ilike '%template-import-artifacts%'
      or r.report_payload::text ilike '%storage.objects%'
      or r.report_payload::text ilike '%stack trace%'
      or r.report_payload::text ilike '%Traceback%'
    then 'fail_unsafe_content_pattern'
    when r.report_payload::text ilike '%http%token%' or r.report_payload::text ilike '%signature%'
    then 'review_possible_signed_url'
    else 'pass'
  end as unsafe_content_scan_status,
  r.generated_at
from public.pdf_import_client_reports r
order by r.generated_at desc
limit 200;

-- ---------------------------------------------------------------------------
-- 9. Reports by import/operator decision
-- ---------------------------------------------------------------------------
select
  ti.id as import_id, ti.source_filename,
  ti.meta->'production_operator_control_audit'->'operatorState'->>'decision' as operator_decision,
  count(r.id) as report_count,
  count(r.id) filter (where r.status = 'approved') as approved_count,
  count(r.id) filter (where r.status = 'exported') as exported_count,
  max(r.generated_at) as latest_report_at
from public.template_imports ti
left join public.pdf_import_client_reports r on r.import_id = ti.id
group by ti.id, ti.source_filename, ti.meta->'production_operator_control_audit'->'operatorState'->>'decision'
order by latest_report_at desc nulls last
limit 100;

-- ---------------------------------------------------------------------------
-- 10. Imports that may need client-safe reports
-- ---------------------------------------------------------------------------
select
  ti.id as import_id, ti.source_filename, ti.created_template_id as template_id,
  ti.meta->'production_operator_control_audit'->'operatorState'->>'decision' as operator_decision,
  ti.meta->'golden_regression_summary'->>'qualityGateStatus' as quality_gate_status,
  ti.meta->'export_parity_summary'->>'status' as export_parity_status,
  count(r.id) as existing_report_count,
  case
    when ti.meta->'production_operator_control_audit'->'operatorState'->>'decision' in ('accepted', 'accepted_with_warnings') and count(r.id) = 0 then 'candidate_template_quality_summary'
    when ti.meta->'production_operator_control_audit'->'operatorState'->>'decision' in ('manual_review_required', 'blocked') and count(r.id) = 0 then 'candidate_manual_review_summary'
    when ti.meta->'production_operator_control_audit'->'operatorState'->>'decision' in ('rejected', 'needs_rerun') and count(r.id) = 0 then 'candidate_rejected_import_summary'
    else 'no_report_gap_detected'
  end as report_readiness_signal
from public.template_imports ti
left join public.pdf_import_client_reports r on r.import_id = ti.id
group by
  ti.id, ti.source_filename, ti.created_template_id,
  ti.meta->'production_operator_control_audit'->'operatorState'->>'decision',
  ti.meta->'golden_regression_summary'->>'qualityGateStatus',
  ti.meta->'export_parity_summary'->>'status'
order by max(ti.updated_at) desc
limit 100;

-- ---------------------------------------------------------------------------
-- 11. Client reporting readiness rollup
-- ---------------------------------------------------------------------------
with signals as (
  select
    (select count(*) from public.pdf_import_client_reports) as total_reports,
    (select count(*) from public.pdf_import_client_reports where status = 'approved') as approved_reports,
    (select count(*) from public.pdf_import_client_reports where status = 'exported') as exported_reports,
    (select count(*) from public.pdf_import_client_reports where status = 'exported' and approved_at is null) as exported_without_approval,
    (select count(*) from public.pdf_import_client_reports where status in ('approved', 'exported') and safety_level in ('internal_only', 'blocked')) as unsafe_approved_or_exported,
    (select count(*) from public.pdf_import_client_reports
      where report_payload::text ilike '%signedUrl%'
         or report_payload::text ilike '%signed_url%'
         or report_payload::text ilike '%service_role%'
         or report_payload::text ilike '%SUPABASE_SERVICE_ROLE_KEY%'
         or report_payload::text ilike '%template-import-artifacts%'
         or report_payload::text ilike '%storage.objects%'
         or report_payload::text ilike '%stack trace%'
         or report_payload::text ilike '%Traceback%') as unsafe_content_pattern_count
)
select
  total_reports, approved_reports, exported_reports, exported_without_approval, unsafe_approved_or_exported, unsafe_content_pattern_count,
  case
    when exported_without_approval > 0 or unsafe_approved_or_exported > 0 or unsafe_content_pattern_count > 0 then 'client_reporting_not_ready_unsafe_report_detected'
    when total_reports = 0 then 'client_reporting_ready_no_reports_generated_yet'
    else 'client_reporting_active'
  end as client_reporting_readiness_status
from signals;

-- ---------------------------------------------------------------------------
-- 12. Phase 11G note
-- ---------------------------------------------------------------------------
select
  'phase_11g_client_safe_reporting_audit_export' as phase,
  'Client reports must contain sanitized payload only. Phase 11G must not expose raw PDFs, screenshots, signed URLs, storage paths, raw OCR text, raw metadata JSON, or logs.' as note;
