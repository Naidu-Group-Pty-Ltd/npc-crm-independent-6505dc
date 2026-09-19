
-- Bootstrap RPC: only callable by service_role (from an edge function) to populate vault.
create or replace function public.bootstrap_cron_vault(
  p_service_role_key text,
  p_internal_edge_secret text
) returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_id uuid;
begin
  -- supabase_service_role_key
  select id into v_id from vault.secrets where name = 'supabase_service_role_key';
  if v_id is null then
    perform vault.create_secret(p_service_role_key, 'supabase_service_role_key', 'Service-role JWT used by pg_cron to call edge functions');
  else
    perform vault.update_secret(v_id, p_service_role_key, 'supabase_service_role_key', 'Service-role JWT used by pg_cron to call edge functions');
  end if;

  -- internal_edge_secret
  select id into v_id from vault.secrets where name = 'internal_edge_secret';
  if v_id is null then
    perform vault.create_secret(p_internal_edge_secret, 'internal_edge_secret', 'Shared secret accepted by fail-closed edge functions');
  else
    perform vault.update_secret(v_id, p_internal_edge_secret, 'internal_edge_secret', 'Shared secret accepted by fail-closed edge functions');
  end if;

  -- supabase_url (used by some vault-based jobs already)
  select id into v_id from vault.secrets where name = 'supabase_url';
  if v_id is null then
    perform vault.create_secret('https://dduzbchuswwbefdunfct.supabase.co', 'supabase_url', 'Project base URL');
  end if;
end;
$$;

revoke all on function public.bootstrap_cron_vault(text, text) from public, anon, authenticated;
grant execute on function public.bootstrap_cron_vault(text, text) to service_role;

-- Header builder: base headers (service-role auth) that pg_cron uses.
create or replace function public.cron_service_role_headers(extra jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public, vault
as $$
  select
    jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_service_role_key' limit 1),
      'x-internal-edge-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'internal_edge_secret' limit 1)
    ) || coalesce(extra, '{}'::jsonb);
$$;

revoke all on function public.cron_service_role_headers(jsonb) from public, anon, authenticated;
grant execute on function public.cron_service_role_headers(jsonb) to postgres, service_role;
