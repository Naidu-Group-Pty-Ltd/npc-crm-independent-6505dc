-- How the urban-centre register is loaded, and how it heals.
--
-- `urban-centre-register-ingest` is the loader; this is the only thing that
-- calls it. The pattern is `market_sales_refresh`'s, for its reasons: the URL
-- and the headers are read inside a SECURITY DEFINER function, so the job body
-- carries no secret and no project literal — the literal-URL trap recorded in
-- 20261120090000 — and `cron_service_role_headers()` presents the internal edge
-- secret, which is what `verifyAuth` accepts.
--
-- ## Why MONTHLY, where the sales register is daily
--
-- The cadence of a register should be the cadence of its publisher, and these
-- two could hardly differ more. `market_sales_medians` reads quarterly
-- publications whose archive captures land on no schedule of ours, so the only
-- way to hold "the newest publication as of today" is to ask every day. The
-- ASGS release, by contrast, is a CONSTANT IN CODE (`ASGS_RELEASE`,
-- `asgsGeography.pure.ts`) and the ABS reissues it about every five years, so
-- asking daily would buy nothing a code change did not already require.
--
-- What a schedule does buy here is the thing a migration cannot: CLONE
-- SELF-HEALING. `CLONE_PROVISIONING_GAPS.md` measured that the rows a
-- migration INSERTs do not travel — seven `market_sources` seeding migrations
-- recorded as applied against a table holding zero rows — so a register that
-- is only ever loaded by hand on the prime is empty on every clone while
-- looking, from the ledger, exactly like it is full. Monthly is one request a
-- month to heal that, and to retry a load that failed its plausibility bounds.
--
-- ## The first call is a PROBE, and it writes nothing
--
-- `geo.abs.gov.au` is not reachable from the machine this was written on (403
-- at the CONNECT tunnel, organisation egress policy), so two things about the
-- query were assumptions rather than measurements: whether this MapServer
-- layer honours `returnCentroid`, and whether every SUA comes back in one
-- answer. The probe stage asks, describes what came back, and writes no
-- register row and no ledger row. Asserted by effect, never by configuration —
-- the rule the retention purge, the verification self-test and the
-- `manual_stats` CHECK constraint each paid for separately.

create or replace function public.urban_centre_refresh(stage_body jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_url text;
  v_req bigint;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'supabase_url' limit 1;
  if v_url is null or length(v_url) = 0 then
    raise exception 'urban_centre_refresh: supabase_url not configured in vault';
  end if;
  select net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/urban-centre-register-ingest',
    headers := public.cron_service_role_headers(),
    body := coalesce(stage_body, '{}'::jsonb),
    timeout_milliseconds := 120000
  ) into v_req;
  return v_req;
end;
$$;

comment on function public.urban_centre_refresh(jsonb) is
  'Posts urban-centre-register-ingest from pg_cron or by hand. The register is an upsert-then-prune, so a month in which the ABS released nothing changes nothing.';

revoke all on function public.urban_centre_refresh(jsonb) from public, anon, authenticated;
grant execute on function public.urban_centre_refresh(jsonb) to postgres, service_role;

-- The probe, once, now. It writes nothing; its answer is in the function's
-- logs, which is where a delivered request is honestly observed — pg_cron and
-- pg_net both report on the SQL that QUEUED the call, never on the call.
select public.urban_centre_refresh('{"stage":"probe"}'::jsonb);
