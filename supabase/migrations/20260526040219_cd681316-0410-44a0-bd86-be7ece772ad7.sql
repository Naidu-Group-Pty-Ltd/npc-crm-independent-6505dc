create table if not exists public.data_provenance (
  id uuid primary key default gen_random_uuid(),
  report_id uuid null,
  property_address text null,
  branch smallint not null check (branch between 1 and 10),
  field_key text not null,
  value_numeric numeric null,
  value_text text null,
  source text not null check (source in ('cotality','abs','rba','bocsar','csa','qps','google','domain','modelled','manual','ptv','tfnsw','translink','walkscore')),
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  licence_tag text not null default 'public' check (licence_tag in ('cotality','public','derived','manual')),
  fetched_at timestamptz not null default now(),
  cache_ttl_days integer not null default 30,
  request_id text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_data_provenance_report on public.data_provenance(report_id);
create index if not exists idx_data_provenance_addr_branch on public.data_provenance(property_address, branch);
create index if not exists idx_data_provenance_fetched on public.data_provenance(fetched_at desc);

alter table public.data_provenance enable row level security;

-- service_role only; client access goes through edge functions
create policy "service_role full access to data_provenance"
on public.data_provenance
as permissive
for all
to public
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');