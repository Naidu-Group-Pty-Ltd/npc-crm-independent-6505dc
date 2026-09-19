-- Blacklisted caller numbers: inbound VAPI calls from these numbers are
-- auto-killed by the vapi-call-webhook via Live Call Control.
create table if not exists public.blacklisted_numbers (
  id uuid primary key default gen_random_uuid(),
  phone_number text not null,
  normalized_number text not null,
  category text not null default 'spam'
    check (category in ('spam','scam','telemarketer','abusive','other')),
  kill_mode text not null default 'silent'
    check (kill_mode in ('silent','announce')),
  announce_message text null
    check (announce_message is null or char_length(announce_message) <= 300),
  notes text null,
  is_active boolean not null default true,
  hit_count integer not null default 0 check (hit_count >= 0),
  last_hit_at timestamptz null,
  created_by text null,
  created_by_username text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blacklisted_numbers_phone_not_empty check (length(btrim(phone_number)) > 0),
  constraint blacklisted_numbers_normalized_min check (length(regexp_replace(normalized_number, '\D', '', 'g')) >= 6)
);

create unique index if not exists uq_blacklisted_numbers_normalized
  on public.blacklisted_numbers (normalized_number);
create index if not exists idx_blacklisted_numbers_active
  on public.blacklisted_numbers (is_active) where is_active = true;

drop trigger if exists trg_blacklisted_numbers_updated_at on public.blacklisted_numbers;
create trigger trg_blacklisted_numbers_updated_at
  before update on public.blacklisted_numbers
  for each row execute function public.update_updated_at_column();

-- The browser is anonymous under the custom auth system; all reads/writes go
-- through service-role edge functions, so the table is service-role only.
alter table public.blacklisted_numbers enable row level security;
grant all on public.blacklisted_numbers to service_role;
drop policy if exists "Service role manages blacklisted numbers" on public.blacklisted_numbers;
create policy "Service role manages blacklisted numbers"
  on public.blacklisted_numbers for all to service_role
  using (true) with check (true);

-- Atomic hit counter so concurrent webhook invocations never lose updates.
create or replace function public.increment_blacklist_hit(entry_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.blacklisted_numbers
     set hit_count = hit_count + 1,
         last_hit_at = now()
   where id = entry_id;
$$;
revoke all on function public.increment_blacklist_hit(uuid) from public, anon, authenticated;
grant execute on function public.increment_blacklist_hit(uuid) to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and tablename = 'blacklisted_numbers'
     ) then
    alter publication supabase_realtime add table public.blacklisted_numbers;
  end if;
end $$;
