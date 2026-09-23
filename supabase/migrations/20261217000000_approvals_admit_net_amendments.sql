-- The supply register admits the publisher's negative figures.
--
-- @effect: select 1 from pg_constraint where conrelid = 'public.market_building_approvals'::regclass and conname = 'market_building_approvals_dwelling_units_magnitude'
--
-- ## Why the walk has been stalled since 12:20 UTC on 22 Sep 2026
--
-- Every hourly tick from then on asked the ABS for 2025-07 → 2025-09 and was
-- refused on one cell of roughly 22,000:
--
--     the ABS building-approvals count for Ulverstone 2025-08 reads -5
--     dwelling units, outside 0–100000 for a sa2 area (unit or column drift)
--
-- ABS Building Approvals are net of AMENDMENTS: a small area records a negative
-- in a month when a previously approved dwelling is cancelled or revised down.
-- The -5 is the publisher's own figure. The parser's plausibility guard read
-- it as drift, and fixing that guard alone does not unstick the walk, because
-- THIS TABLE says the same wrong thing — `20261213000000` declared
--
--     dwelling_units integer null check (dwelling_units is null or dwelling_units >= 0)
--     value_aud      numeric null check (value_aud is null or value_aud >= 0)
--
-- so a parser that admits the -5 hands the database a row it refuses, and the
-- refusal moves one layer down instead of going away.
--
-- ## What replaces them
--
-- The sign was never the thing worth checking. Drift — a column read in
-- thousands, a moved `UNIT_MULT` — is a fault of MAGNITUDE and shows in either
-- direction, so the replacements bound the magnitude, symmetrically, at the
-- LOOSEST grain's ceiling (`ABS_BA_PLAUSIBILITY`'s national figures: 2,000,000
-- dwelling units and $250bn in one area in one month). The per-grain ceilings
-- stay where they belong, in the parser, which knows each row's grain; this is
-- the backstop against a figure no grain could publish, whoever wrote it.
--
-- ## Found by what they SAY, never by a guessed name
--
-- Both constraints were declared inline, so their names are Postgres's own.
-- `drop constraint if exists <a guess>` does nothing when the guess is wrong,
-- and then leaves the refusal in place while this file reports success — the
-- purge-asserted-by-configuration defect this repository has paid for twice.
-- So the constraints are found by their definition.
--
-- ## And the result is proved by what the table DOES
--
-- Finding by definition has the same weakness one step removed: a check
-- spelled some other way — `not (dwelling_units < 0)` — matches no pattern,
-- and a re-count by the same pattern then passes exactly when the pattern
-- missed. Measured on PostgreSQL 16.13 before this was written: against that
-- spelling, a pattern-only version of this file exited 0, reported success,
-- and the table still refused the -5. So after the swap the block INSERTS a
-- row carrying a negative on both measures, inside a nested block that always
-- rolls it back, and RAISES if the table refuses it — which undoes the whole
-- statement, drops included. The probe row's key is one the loader can never
-- write (`1900-01`, a non-ABS area code) and it satisfies every other check on
-- the table, so the only refusal it can meet is the one this file removes. It
-- runs on a re-apply too, so a second application proves the effect again
-- rather than trusting the first.
--
-- ## One statement, because the workflow runs psql without a transaction
--
-- `apply-migration.yml` applies with `ON_ERROR_STOP` and no
-- `--single-transaction`, so separate statements would commit one by one and a
-- failure half-way would leave the table with its sign checks dropped and no
-- replacement. A DO block is one statement: it all lands or none of it does.
--
-- Idempotent: applied a second time it finds the replacements present and the
-- sign checks gone, proves the effect again, says so, and changes nothing.
--
-- ## Order against the code
--
-- None required. `market-sales-ingest` writes a window's negative-bearing rows
-- FIRST (`approvalsWriteOrder`), so if this has not been applied when the new
-- parser first meets a negative, the very first request of the window is the
-- one refused and nothing else of it commits — the register stays exactly
-- where it is and the next tick asks again. After this lands, the next tick
-- writes the whole window.

do $$
declare
  c                 record;
  dropped           text := '';
  has_units_bound   boolean;
  has_value_bound   boolean;
begin
  select exists (
           select 1 from pg_constraint
           where conrelid = 'public.market_building_approvals'::regclass
             and conname = 'market_building_approvals_dwelling_units_magnitude'),
         exists (
           select 1 from pg_constraint
           where conrelid = 'public.market_building_approvals'::regclass
             and conname = 'market_building_approvals_value_aud_magnitude')
    into has_units_bound, has_value_bound;

  -- Every CHECK on either measure that forbids a negative, by its definition.
  -- `pg_get_constraintdef` prints the numeric one as `value_aud >= (0)::numeric`.
  for c in
    select conname, pg_get_constraintdef(oid) as def
    from pg_constraint
    where conrelid = 'public.market_building_approvals'::regclass
      and contype = 'c'
      and (pg_get_constraintdef(oid) ~ 'dwelling_units >= \(?0\)?'
           or pg_get_constraintdef(oid) ~ 'value_aud >= \(?0\)?')
  loop
    execute format('alter table public.market_building_approvals drop constraint %I', c.conname);
    dropped := dropped || c.conname || ' [' || c.def || '] ';
  end loop;

  if not has_units_bound then
    alter table public.market_building_approvals
      add constraint market_building_approvals_dwelling_units_magnitude
      check (dwelling_units is null or abs(dwelling_units) <= 2000000);
  end if;
  if not has_value_bound then
    alter table public.market_building_approvals
      add constraint market_building_approvals_value_aud_magnitude
      check (value_aud is null or abs(value_aud) <= 250000000000);
  end if;

  -- Asserted by EFFECT, not by re-reading the catalogue: the table takes a
  -- published negative on both measures. The nested block is a
  -- subtransaction, so the probe row is always rolled back — by the sentinel
  -- on success, by the refusal on failure — and never becomes visible to
  -- anyone. A refusal raises from the handler, which fails this statement and
  -- undoes everything above it.
  begin
    insert into public.market_building_approvals
      (area_kind, area_code, area, area_token, state, period, building_type,
       dwelling_units, value_aud, source, source_url, licence)
    values
      ('national', 'approvals-admit-net-probe', 'probe', 'probe', null, '1900-01',
       'total_residential', -1, -1, 'probe', 'probe', 'probe');
    raise exception 'APPROVALS_ADMIT_NET_PROBE_ROLLED_BACK';
  exception
    when check_violation then
      raise exception 'APPROVALS_ADMIT_NET: the table still refuses a published negative after the swap (%) — refused, nothing changed', sqlerrm;
    when raise_exception then
      if sqlerrm is distinct from 'APPROVALS_ADMIT_NET_PROBE_ROLLED_BACK' then
        raise;
      end if;
  end;

  if dropped = '' and has_units_bound and has_value_bound then
    raise warning 'APPROVALS_ADMIT_NET already applied — the magnitude bounds are present and a negative is admitted (probed and rolled back); nothing changed';
    return;
  end if;

  raise warning 'APPROVALS_ADMIT_NET dropped=[%] added=[%] — a published negative is admitted (probed and rolled back)',
    nullif(trim(dropped), ''),
    concat_ws(', ',
      case when not has_units_bound then 'market_building_approvals_dwelling_units_magnitude' end,
      case when not has_value_bound then 'market_building_approvals_value_aud_magnitude' end);
end $$;

comment on column public.market_building_approvals.dwelling_units is
  'Dwelling units approved, net of amendments: the ABS publishes a negative for a month in which '
  'previously approved dwellings were cancelled or revised down, and it is stored as published. '
  'NULL where the publisher released no figure; 0 only where it released a zero.';

comment on column public.market_building_approvals.value_aud is
  'Value of building approved, net of amendments, stored as published — a negative is a '
  'cancellation or downward revision, not drift. NULL where the publisher released no figure.';
