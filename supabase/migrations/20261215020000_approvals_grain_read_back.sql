-- Read the supply register back and SAY what grain it is holding.
--
-- ## Why this file exists rather than a query
--
-- `market_building_approvals` holds 17,442 rows after two loads, and a row
-- count cannot answer the question that matters. The ABS region download is a
-- HIERARCHY — *"by SA2 and above"* means what it says — so one response
-- carries SA2s, states and the national total together, and each row must be
-- stamped with **its own** grain. `SUPPLY_EVIDENCE.md`'s rule:
--
--   > worse than the refusal, stamping every row with the REQUESTED grain
--   > files the national total as a council area, which the read path would
--   > then serve as one suburb's supply.
--
-- That is the one failure a count is blind to, and it is invisible in a green
-- 200: a national figure of ~$22bn presented as a suburb's approved supply
-- would read as a plausible number on a client's page.
--
-- Arbitrary database access is not available here, and this deployment's
-- standing restriction keeps it that way. The two reviewed migration
-- workflows are the authorised route, so the read travels as a migration and
-- the ANSWER travels out through `postgres_logs`: `raise warning` is logged
-- at Supabase's default `log_min_messages`, where `notice` is not.
--
-- **It writes nothing.** No insert, no update, no DDL — one read and one log
-- line. It is therefore safe to apply any number of times, and it declares no
-- `@effect` probe because it has no effect to declare; `migration-drift` will
-- count it "unverifiable", which for a file that changes nothing is the
-- honest classification.

do $$
declare
  by_kind   text;
  areas     text;
  periods   text;
  nulls     text;
  samples   text;
  total     bigint;
begin
  select count(*) into total from public.market_building_approvals;

  -- The distribution that decides it. If every row says the grain that was
  -- REQUESTED (sa2) and nothing else, either the download carried no
  -- hierarchy or the stamp is the request rather than the row.
  select string_agg(area_kind || '=' || n::text, ', ' order by area_kind)
    into by_kind
  from (
    select area_kind, count(*) as n
    from public.market_building_approvals group by area_kind
  ) q;

  select string_agg(area_kind || ':' || n::text, ', ' order by area_kind)
    into areas
  from (
    select area_kind, count(distinct area_code) as n
    from public.market_building_approvals group by area_kind
  ) q;

  select string_agg(area_kind || ' ' || lo || '..' || hi, ', ' order by area_kind)
    into periods
  from (
    select area_kind, min(period) as lo, max(period) as hi
    from public.market_building_approvals group by area_kind
  ) q;

  -- `dwelling_units` NULL where the publisher released nothing, 0 only where
  -- it released a zero. Both present is the healthy shape; all-NULL would
  -- mean the measure never parsed, and no NULLs at all on a suppressed-month
  -- publisher would mean an absence was written as a zero.
  select 'null=' || count(*) filter (where dwelling_units is null)::text
      || ' zero=' || count(*) filter (where dwelling_units = 0)::text
      || ' positive=' || count(*) filter (where dwelling_units > 0)::text
    into nulls
  from public.market_building_approvals;

  -- Actual codes and labels, because a grain word is checkable against the
  -- code that carries it: an SA2 code is 9 digits, a state is 1, and
  -- `AUS`/`0` is the nation. A mislabelled row shows up here as a short code
  -- wearing `sa2`.
  select string_agg(s, ' | ' order by s) into samples
  from (
    select distinct on (area_kind)
      area_kind || ' code=' || area_code || ' len=' || length(area_code)::text
        || ' area=' || left(area, 28) || ' state=' || coalesce(state, '(null)')
      as s
    from public.market_building_approvals
    order by area_kind, area_code
  ) q;

  raise warning 'APPROVALS_READBACK total=% | by_kind=[%] | distinct_areas=[%] | periods=[%] | dwelling_units=[%] | samples=[%]',
    total, by_kind, areas, periods, nulls, samples;
end $$;
