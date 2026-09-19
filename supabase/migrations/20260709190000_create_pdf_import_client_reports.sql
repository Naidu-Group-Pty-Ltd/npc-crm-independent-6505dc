-- Phase 11G — Client-safe reporting / audit export.
--
-- Durable store for SANITIZED client-safe report records + approval/export
-- lifecycle. The report_payload holds only sanitized content: never raw PDF/OCR
-- text, screenshots/diff artifacts, signed URLs, storage object paths, raw
-- metadata JSON, logs, or secrets. Phase 11G never emails, never publishes, and
-- never creates public links.
--
-- Writes are service-role only (the secure `pdf-import-client-report` edge
-- function performs capability-checked generate/save/approve/export lifecycle).
-- Reads are admin-only.

create table if not exists public.pdf_import_client_reports (
  id uuid primary key default gen_random_uuid(),

  import_id uuid null references public.template_imports(id) on delete set null,
  template_id uuid null references public.report_templates(id) on delete set null,

  report_type text not null,
  audience text not null,
  safety_level text not null,
  status text not null default 'draft',

  title text not null,
  summary text not null,

  report_payload jsonb not null default '{}'::jsonb,
  redactions jsonb not null default '[]'::jsonb,
  source_summary jsonb not null default '{}'::jsonb,

  generated_by uuid null,
  generated_at timestamptz not null default now(),

  reviewed_by uuid null,
  reviewed_at timestamptz null,
  review_note text null,

  approved_by uuid null,
  approved_at timestamptz null,
  approval_note text null,

  exported_by uuid null,
  exported_at timestamptz null,
  export_note text null,
  export_format text null,

  rejected_by uuid null,
  rejected_at timestamptz null,
  rejection_note text null,

  superseded_by uuid null references public.pdf_import_client_reports(id) on delete set null,
  superseded_at timestamptz null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint pdf_import_client_reports_report_type_valid
    check (report_type in (
      'import_status_summary', 'template_quality_summary', 'manual_review_summary',
      'accepted_with_warnings_summary', 'rejected_import_summary', 'production_audit_summary', 'release_readiness_summary'
    )),
  constraint pdf_import_client_reports_audience_valid
    check (audience in ('internal_operator', 'internal_business', 'external_client')),
  constraint pdf_import_client_reports_safety_level_valid
    check (safety_level in ('safe', 'safe_with_warnings', 'internal_only', 'blocked')),
  constraint pdf_import_client_reports_status_valid
    check (status in ('draft', 'pending_review', 'approved', 'exported', 'rejected', 'superseded')),
  constraint pdf_import_client_reports_export_format_valid
    check (export_format is null or export_format in ('json', 'markdown', 'html', 'pdf')),
  constraint pdf_import_client_reports_title_not_empty check (length(btrim(title)) > 0),
  constraint pdf_import_client_reports_summary_not_empty check (length(btrim(summary)) > 0)
);

comment on table public.pdf_import_client_reports is
  'Phase 11G client-safe report records. report_payload is SANITIZED only - never raw PDF/OCR text, screenshots, signed URLs, storage paths, raw metadata JSON, logs, or secrets. No email/public links.';

create index if not exists idx_pdf_import_client_reports_import_id on public.pdf_import_client_reports (import_id);
create index if not exists idx_pdf_import_client_reports_template_id on public.pdf_import_client_reports (template_id);
create index if not exists idx_pdf_import_client_reports_report_type on public.pdf_import_client_reports (report_type);
create index if not exists idx_pdf_import_client_reports_audience on public.pdf_import_client_reports (audience);
create index if not exists idx_pdf_import_client_reports_safety_level on public.pdf_import_client_reports (safety_level);
create index if not exists idx_pdf_import_client_reports_status on public.pdf_import_client_reports (status);
create index if not exists idx_pdf_import_client_reports_generated_at on public.pdf_import_client_reports (generated_at desc);
create index if not exists idx_pdf_import_client_reports_approved_at on public.pdf_import_client_reports (approved_at desc);
create index if not exists idx_pdf_import_client_reports_exported_at on public.pdf_import_client_reports (exported_at desc);

drop trigger if exists trg_pdf_import_client_reports_updated_at on public.pdf_import_client_reports;
create trigger trg_pdf_import_client_reports_updated_at
  before update on public.pdf_import_client_reports
  for each row execute function public.update_updated_at_column();

-- RLS: writes service-role only; direct reads admin/superadmin only. All access
-- flows through the secure edge function which re-checks the client-report
-- capability server-side.
alter table public.pdf_import_client_reports enable row level security;

grant select on public.pdf_import_client_reports to authenticated;
grant all on public.pdf_import_client_reports to service_role;

drop policy if exists "Service role manages client reports" on public.pdf_import_client_reports;
create policy "Service role manages client reports"
  on public.pdf_import_client_reports
  for all to service_role
  using (true) with check (true);

drop policy if exists "Admins can view client reports" on public.pdf_import_client_reports;
create policy "Admins can view client reports"
  on public.pdf_import_client_reports
  for select to authenticated
  using (
    has_role(auth.uid(), 'admin'::app_role)
    or has_role(auth.uid(), 'superadmin'::app_role)
  );
