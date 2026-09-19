-- Market Updates Phase 3: all browser reads are mediated by the sanitised,
-- permission-aware market-updates-status Edge Function. Service functions remain
-- the only writers. Existing RLS stays enabled as an additive defence.

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'market_sources', 'market_updates', 'market_digests',
    'market_ingestion_runs', 'market_source_fetch_runs', 'market_update_questions'
  ] loop
    if to_regclass('public.' || table_name) is null then
      raise exception 'Required Market Updates table public.% is missing', table_name;
    end if;
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant all on table public.%I to service_role', table_name);
  end loop;
end $$;

-- Retire the broad browser-read policies. The source-admin, status, ingest,
-- digest, feed and Q&A functions apply their own deny-by-default permissions.
drop policy if exists "Authenticated users can read market sources" on public.market_sources;
drop policy if exists "Authenticated users can read published market updates" on public.market_updates;
drop policy if exists "Authenticated users can read published market digests" on public.market_digests;
drop policy if exists "Authenticated users read sanitised ingestion status" on public.market_ingestion_runs;
drop policy if exists "Authenticated users read source fetch status" on public.market_source_fetch_runs;
drop policy if exists "Authenticated users can insert own market questions" on public.market_update_questions;
drop policy if exists "Authenticated users can read market questions" on public.market_update_questions;
drop policy if exists "Authenticated users can read own market questions" on public.market_update_questions;

-- Service-only policies document the intended RLS contract even though the
-- service_role also carries BYPASSRLS in hosted Supabase.
do $$
declare table_name text; policy_name text;
begin
  foreach table_name in array array[
    'market_sources', 'market_updates', 'market_digests',
    'market_ingestion_runs', 'market_source_fetch_runs', 'market_update_questions'
  ] loop
    policy_name := 'Service role manages ' || table_name;
    execute format('drop policy if exists %I on public.%I', policy_name, table_name);
    execute format(
      'create policy %I on public.%I for all to service_role using (true) with check (true)',
      policy_name, table_name
    );
  end loop;
end $$;
