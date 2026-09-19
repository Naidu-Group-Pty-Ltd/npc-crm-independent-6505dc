
create table if not exists public.cron_vault_bootstrap_marker (
  id uuid primary key default gen_random_uuid(),
  bootstrapped_at timestamptz not null default now()
);

grant all on public.cron_vault_bootstrap_marker to service_role;
revoke all on public.cron_vault_bootstrap_marker from public, anon, authenticated;

alter table public.cron_vault_bootstrap_marker enable row level security;

-- No policies: only service_role (which bypasses RLS) may touch it.

-- Ensure bootstrap function is in config.toml verify_jwt=false path via edge fn code guard.
comment on table public.cron_vault_bootstrap_marker is
  'Single-use marker: presence of a row means Vault has been seeded with pg_cron auth secrets.';
