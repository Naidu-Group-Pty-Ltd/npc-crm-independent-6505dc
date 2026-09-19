-- WP-12 Phase B: SQL HMAC signer for pg_cron → edge function signed envelopes.
-- Mirrors supabase/functions/_shared/auth_v2.ts::signInternalRequest.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_net;

create or replace function public.cron_signed_internal_headers(
  method        text,
  function_name text,
  body          jsonb default '{}'::jsonb,
  caller        text  default 'pg_cron',
  extra         jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret_v1 text;
  v_secret_v2 text;
  v_key_id    text;
  v_secret    text;
  v_anon      text;
  v_srk       text;
  v_ts        text;
  v_nonce     text;
  v_body_txt  text;
  v_body_hash text;
  v_path      text;
  v_message   text;
  v_signature text;
  v_gateway_auth text;
  v_apikey    text;
begin
  select decrypted_secret into v_secret_v1
    from vault.decrypted_secrets where name = 'internal_edge_secret' limit 1;
  select decrypted_secret into v_secret_v2
    from vault.decrypted_secrets where name = 'internal_edge_secret_v2' limit 1;

  if coalesce(length(v_secret_v2), 0) >= 16 then
    v_key_id := 'v2';
    v_secret := v_secret_v2;
  elsif coalesce(length(v_secret_v1), 0) >= 16 then
    v_key_id := 'v1';
    v_secret := v_secret_v1;
  else
    raise exception 'cron_signed_internal_headers: internal_edge_secret not configured in vault';
  end if;

  v_path      := '/functions/v1/' || function_name;
  v_ts        := extract(epoch from clock_timestamp())::bigint::text;
  v_nonce     := encode(extensions.gen_random_bytes(16), 'hex');
  v_body_txt  := coalesce(body::text, '{}');
  v_body_hash := encode(extensions.digest(v_body_txt::bytea, 'sha256'), 'hex');

  v_message := upper(method)
    || E'\n' || v_path
    || E'\n' || v_ts
    || E'\n' || v_nonce
    || E'\n' || caller
    || E'\n' || v_key_id
    || E'\n' || v_body_hash;

  v_signature := encode(extensions.hmac(v_message::bytea, v_secret::bytea, 'sha256'), 'hex');

  -- Gateway auth: prefer anon so the service_role key isn't sprayed across the wire.
  select decrypted_secret into v_anon
    from vault.decrypted_secrets where name = 'supabase_anon_key' limit 1;

  if coalesce(length(v_anon), 0) >= 16 then
    v_apikey       := v_anon;
    v_gateway_auth := 'Bearer ' || v_anon;
  else
    select decrypted_secret into v_srk
      from vault.decrypted_secrets where name = 'supabase_service_role_key' limit 1;
    if coalesce(length(v_srk), 0) < 16 then
      raise exception 'cron_signed_internal_headers: neither supabase_anon_key nor supabase_service_role_key is configured in vault';
    end if;
    v_apikey       := v_srk;
    v_gateway_auth := 'Bearer ' || v_srk;
  end if;

  return jsonb_build_object(
    'Content-Type',         'application/json',
    'apikey',               v_apikey,
    'Authorization',        v_gateway_auth,
    'X-Internal-Timestamp', v_ts,
    'X-Internal-Nonce',     v_nonce,
    'X-Internal-Caller',    caller,
    'X-Internal-Key-Id',    v_key_id,
    'X-Internal-Signature', v_signature
  ) || coalesce(extra, '{}'::jsonb);
end;
$$;

revoke all on function public.cron_signed_internal_headers(text, text, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.cron_signed_internal_headers(text, text, jsonb, text, jsonb) to postgres, service_role;

comment on function public.cron_signed_internal_headers(text, text, jsonb, text, jsonb) is
  'WP-12: builds the signed X-Internal-* header envelope matching signInternalRequest in supabase/functions/_shared/auth_v2.ts. Restricted to postgres/service_role.';

-- Convenience wrapper: schedule an internal POST from pg_cron with a signed envelope.
create or replace function public.cron_invoke_signed_function(
  function_name text,
  body          jsonb default '{}'::jsonb,
  caller        text  default 'pg_cron'
)
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url     text;
  v_headers jsonb;
  v_req_id  bigint;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'supabase_url' limit 1;
  if v_url is null or length(v_url) = 0 then
    raise exception 'cron_invoke_signed_function: supabase_url not configured in vault';
  end if;

  v_headers := public.cron_signed_internal_headers('POST', function_name, body, caller);

  select net.http_post(
    url     := rtrim(v_url, '/') || '/functions/v1/' || function_name,
    headers := v_headers,
    body    := body
  ) into v_req_id;

  return v_req_id;
end;
$$;

revoke all on function public.cron_invoke_signed_function(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.cron_invoke_signed_function(text, jsonb, text) to postgres, service_role;

comment on function public.cron_invoke_signed_function(text, jsonb, text) is
  'WP-12: schedules a signed pg_net POST to an edge function. Preferred replacement for cron jobs still using cron_service_role_headers().';
