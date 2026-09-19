-- PDF Import Path-to-100 v2 — Work Package C1
-- Dispatcher Plan V2 correlation + policy-safe cache contract.
--
-- Adds:
--   * template_import_id  — durable correlation from a parse job to the
--     template_imports row that owns it (nullable, ON DELETE SET NULL so a
--     deleted import never orphans/removes its diagnostic job history).
--   * cache_contract_fingerprint — exact-match key for pdf-cache-contract-v2.
--     Cache reuse now requires an identical fingerprint (which encodes redaction
--     policy, lane, DPI, description tier, engine/artifact versions, etc.), so a
--     non-redacted result can never satisfy a redacted request.
--   * service_class — the Cloud Run service class the job ran on (default now;
--     'fast'/'heavy' later under optional track O3). Persisted so chunk-callback
--     retries and stuck recovery redispatch on the SAME class.
--
-- Non-destructive and idempotent. No backfill: existing rows keep NULLs, which
-- simply means they are never served as a v2 cache hit (safe by construction).

alter table public.pdf_import_jobs
  add column if not exists template_import_id uuid,
  add column if not exists cache_contract_fingerprint text,
  add column if not exists service_class text;

-- Correlation FK to template_imports. Guarded so re-running the migration (or
-- running it where the constraint already exists) is a no-op.
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'pdf_import_jobs_template_import_id_fkey'
      and table_name = 'pdf_import_jobs'
  ) then
    alter table public.pdf_import_jobs
      add constraint pdf_import_jobs_template_import_id_fkey
      foreign key (template_import_id)
      references public.template_imports(id)
      on delete set null;
  end if;
end $$;

create index if not exists idx_pdf_import_jobs_template_import_id
  on public.pdf_import_jobs(template_import_id);

-- Cache lookups filter on fingerprint + engine + status; partial index keeps it
-- lean by only indexing succeeded rows that actually carry a fingerprint.
create index if not exists idx_pdf_import_jobs_cache_fingerprint
  on public.pdf_import_jobs(cache_contract_fingerprint)
  where cache_contract_fingerprint is not null and status = 'succeeded';

comment on column public.pdf_import_jobs.template_import_id is
  'Correlation to template_imports(id). Path-to-100 v2 C1.';
comment on column public.pdf_import_jobs.cache_contract_fingerprint is
  'pdf-cache-contract-v2 exact-match cache key (encodes redaction/lane/DPI/policy). Path-to-100 v2 C1.';
comment on column public.pdf_import_jobs.service_class is
  'Cloud Run service class the job ran on (default|fast|heavy). Path-to-100 v2 C1/O3.';
