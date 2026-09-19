
create table if not exists public.token_webhook_events (
  id text not null,
  event text not null,
  payload jsonb,
  received_at timestamptz not null default now(),
  primary key (id, event)
);
alter table public.token_webhook_events enable row level security;
drop policy if exists service_role_full_twe on public.token_webhook_events;
create policy service_role_full_twe on public.token_webhook_events
  for all to service_role using (true) with check (true);

create table if not exists public.token_balance_cache (
  tenant_ref text primary key,
  available integer not null default 0,
  reserved integer not null default 0,
  lifetime_granted bigint not null default 0,
  lifetime_spent bigint not null default 0,
  plan_name text,
  monthly_allowance integer not null default 0,
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.token_balance_cache enable row level security;
drop policy if exists service_role_full_tbc on public.token_balance_cache;
create policy service_role_full_tbc on public.token_balance_cache
  for all to service_role using (true) with check (true);
