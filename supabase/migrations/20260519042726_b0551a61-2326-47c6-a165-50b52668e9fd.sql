
alter table public.permission_invite_tokens
  add column if not exists mc_seat_id text,
  add column if not exists mc_seat_idempotency_key text;

create table if not exists public.system_alerts (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  severity text not null default 'info',
  message text not null,
  payload jsonb,
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists system_alerts_active_idx
  on public.system_alerts (created_at desc)
  where acknowledged_at is null;

alter table public.system_alerts enable row level security;

drop policy if exists "superadmins read system alerts" on public.system_alerts;
create policy "superadmins read system alerts"
  on public.system_alerts for select
  using (public.has_role(auth.uid(), 'superadmin'));
