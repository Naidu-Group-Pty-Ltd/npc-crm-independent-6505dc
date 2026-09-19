-- Phase 11E — Artifact Retention + Cleanup Policy event ledger.
--
-- Durable, DRY-RUN retention/cleanup candidates for the PDF import system. This
-- table records cleanup candidates, their policy decision + safety level, and
-- operator/developer review state. Phase 11E performs NO physical cleanup: it
-- never deletes storage objects or rows, never archives, never compacts
-- metadata. It stores METADATA REFERENCES ONLY — never raw PDF/OCR text,
-- raster content, signed URLs, secrets, or full logs.
--
-- Writes are service-role only (the secure `pdf-import-retention` edge function
-- performs capability-checked scans + lifecycle). Reads are admin-only.

create table if not exists public.pdf_import_retention_events (
  id uuid primary key default gen_random_uuid(),

  retention_rule_id text not null,
  domain text not null,
  decision text not null,
  cleanup_action text not null,
  safety_level text not null,
  status text not null default 'candidate',

  title text not null,
  message text not null,

  scope_type text not null,
  scope_id text not null,
  scope_label text null,

  dedupe_key text not null,

  storage_bucket text null,
  storage_object_path text null,

  import_id uuid null references public.template_imports(id) on delete set null,
  template_id uuid null references public.report_templates(id) on delete set null,
  monitoring_event_id uuid null references public.pdf_import_monitoring_events(id) on delete set null,
  golden_run_id uuid null references public.pdf_import_golden_runs(id) on delete set null,

  evidence jsonb not null default '[]'::jsonb,
  recommended_action text not null,

  estimated_bytes bigint null,
  object_created_at timestamptz null,
  object_updated_at timestamptz null,

  source text not null default 'pdf_import_retention',
  run_id text null,

  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  occurrence_count integer not null default 1,

  reviewed_by uuid null,
  reviewed_at timestamptz null,
  review_note text null,

  approved_by uuid null,
  approved_at timestamptz null,
  approval_note text null,

  rejected_by uuid null,
  rejected_at timestamptz null,
  rejection_note text null,

  blocked_by uuid null,
  blocked_at timestamptz null,
  block_note text null,

  completed_by uuid null,
  completed_at timestamptz null,
  completion_note text null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint pdf_import_retention_events_decision_valid
    check (decision in ('retain', 'review', 'archive_candidate', 'delete_candidate', 'blocked', 'unknown')),
  constraint pdf_import_retention_events_cleanup_action_valid
    check (cleanup_action in (
      'no_action', 'mark_for_review', 'archive_later', 'delete_later', 'compact_metadata_later',
      'repair_reference', 'preserve_for_audit', 'preserve_for_regression', 'preserve_for_manual_review', 'blocked_from_cleanup'
    )),
  constraint pdf_import_retention_events_safety_level_valid
    check (safety_level in ('safe_to_recommend', 'requires_operator_approval', 'requires_developer_approval', 'manual_only', 'blocked')),
  constraint pdf_import_retention_events_status_valid
    check (status in ('candidate', 'reviewed', 'approved_for_future_cleanup', 'rejected', 'blocked', 'completed', 'superseded')),
  constraint pdf_import_retention_events_occurrence_positive check (occurrence_count >= 1),
  constraint pdf_import_retention_events_bytes_nonneg check (estimated_bytes is null or estimated_bytes >= 0),
  constraint pdf_import_retention_events_rule_id_not_empty check (length(btrim(retention_rule_id)) > 0),
  constraint pdf_import_retention_events_domain_not_empty check (length(btrim(domain)) > 0),
  constraint pdf_import_retention_events_scope_type_not_empty check (length(btrim(scope_type)) > 0),
  constraint pdf_import_retention_events_scope_id_not_empty check (length(btrim(scope_id)) > 0),
  constraint pdf_import_retention_events_dedupe_key_not_empty check (length(btrim(dedupe_key)) > 0)
);

comment on table public.pdf_import_retention_events is
  'Phase 11E DRY-RUN artifact retention/cleanup candidates. Metadata references only — never raw PDF/OCR text, raster content, signed URLs, or secrets. No physical cleanup is performed.';

-- One live candidate per dedupe key (candidate/reviewed/approved/blocked).
-- Rejected/completed/superseded rows are historical and excluded so a
-- recurrence can open a fresh candidate.
create unique index if not exists uq_pdf_import_retention_events_active_dedupe
  on public.pdf_import_retention_events (dedupe_key)
  where status in ('candidate', 'reviewed', 'approved_for_future_cleanup', 'blocked');

create index if not exists idx_pdf_import_retention_events_status on public.pdf_import_retention_events (status);
create index if not exists idx_pdf_import_retention_events_decision on public.pdf_import_retention_events (decision);
create index if not exists idx_pdf_import_retention_events_cleanup_action on public.pdf_import_retention_events (cleanup_action);
create index if not exists idx_pdf_import_retention_events_safety_level on public.pdf_import_retention_events (safety_level);
create index if not exists idx_pdf_import_retention_events_domain on public.pdf_import_retention_events (domain);
create index if not exists idx_pdf_import_retention_events_rule_id on public.pdf_import_retention_events (retention_rule_id);
create index if not exists idx_pdf_import_retention_events_scope on public.pdf_import_retention_events (scope_type, scope_id);
create index if not exists idx_pdf_import_retention_events_import_id on public.pdf_import_retention_events (import_id);
create index if not exists idx_pdf_import_retention_events_template_id on public.pdf_import_retention_events (template_id);
create index if not exists idx_pdf_import_retention_events_monitoring_event_id on public.pdf_import_retention_events (monitoring_event_id);
create index if not exists idx_pdf_import_retention_events_golden_run_id on public.pdf_import_retention_events (golden_run_id);
create index if not exists idx_pdf_import_retention_events_storage on public.pdf_import_retention_events (storage_bucket, storage_object_path);
create index if not exists idx_pdf_import_retention_events_last_seen_at on public.pdf_import_retention_events (last_seen_at desc);
create index if not exists idx_pdf_import_retention_events_created_at on public.pdf_import_retention_events (created_at desc);

-- Keep updated_at fresh via the shared repo trigger helper.
drop trigger if exists trg_pdf_import_retention_events_updated_at on public.pdf_import_retention_events;
create trigger trg_pdf_import_retention_events_updated_at
  before update on public.pdf_import_retention_events
  for each row execute function public.update_updated_at_column();

-- RLS: writes service-role only; direct reads admin/superadmin only. The
-- browser is anonymous under custom-auth, so all access flows through the secure
-- edge function which re-checks the retention capability server-side.
alter table public.pdf_import_retention_events enable row level security;

grant select on public.pdf_import_retention_events to authenticated;
grant all on public.pdf_import_retention_events to service_role;

drop policy if exists "Service role manages retention events" on public.pdf_import_retention_events;
create policy "Service role manages retention events"
  on public.pdf_import_retention_events
  for all to service_role
  using (true) with check (true);

drop policy if exists "Admins can view retention events" on public.pdf_import_retention_events;
create policy "Admins can view retention events"
  on public.pdf_import_retention_events
  for select to authenticated
  using (
    has_role(auth.uid(), 'admin'::app_role)
    or has_role(auth.uid(), 'superadmin'::app_role)
  );
