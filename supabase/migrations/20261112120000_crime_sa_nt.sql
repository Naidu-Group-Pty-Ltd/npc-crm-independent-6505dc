-- South Australia and the Northern Territory join the recorded-crime layer.
--
-- Acquisition log: docs/reports/CRIME_SOURCES.md. Both registers were parsed
-- against their real published files before this migration was written
-- (crimeIngestSaNt.pure.ts), and both parsers were cross-checked against an
-- independent implementation to the digit.
--
-- Three shape changes, each forced by something measured rather than chosen.

-- 1. Two more states, and two more geographies.
--
-- SA is POSTCODE-keyed, which is the platform's own geography (as NSW is).
-- NT publishes no postcode at all: its geography is a Reporting Region
-- (Darwin, Palmerston, Alice Springs, Katherine, Tennant Creek, Nhulunbuy,
-- NT Balance) with a Statistical Area 2 breakdown inside NT Balance only —
-- measured, the 3,759 rows with a blank SA2 are exactly the six named
-- regions' rows. SA2 is resolvable for a coordinate because the T-stream
-- already built that lookup (abs-regional-service), so it is stored rather
-- than discarded.
alter table public.crime_reference drop constraint if exists crime_reference_state_check;
alter table public.crime_reference add constraint crime_reference_state_check
  check (state in ('NSW', 'QLD', 'SA', 'NT'));

alter table public.crime_reference drop constraint if exists crime_reference_area_kind_check;
alter table public.crime_reference add constraint crime_reference_area_kind_check
  check (area_kind in ('postcode', 'lga', 'state_total', 'region', 'sa2'));

alter table public.crime_state_benchmarks drop constraint if exists crime_state_benchmarks_state_check;
alter table public.crime_state_benchmarks add constraint crime_state_benchmarks_state_check
  check (state in ('NSW', 'QLD', 'SA', 'NT'));

-- 2. A prior-year window may be honestly ABSENT.
--
-- SAPOL adopted a new offence classification from July 2025, and it is a
-- reclassification rather than a rename: `THEFT` carries different Level 3
-- leaves from `THEFT AND RELATED OFFENCES`, and `HARM OR ENDANGER PERSONS`
-- corresponds to no single old category. Any crosswalk would be this
-- programme's own invention, and a "change on the same window a year earlier"
-- computed across it would be a confident figure that is not a like-for-like
-- comparison. So SA's Level 2 rows carry NULL here and say why in
-- `series_note`; SA's Level 1 rows, whose two groupings are unchanged and
-- measured continuous across the boundary, carry the number.
--
-- A labelled row promises a figure. This is the column admitting when there
-- is not one.
alter table public.crime_reference alter column prior12 drop not null;

alter table public.crime_reference add column if not exists series_note text;

comment on column public.crime_reference.prior12 is
  'Incidents in the 12 months before the latest 12. NULL where no like-for-like prior window exists (see series_note) — never a number computed across a classification change.';

comment on column public.crime_reference.series_note is
  'Why this series is shorter or less comparable than it looks. Rendered to the reader beside the figures rather than kept in a code comment.';

-- 3. Monthly counts get a home of their own.
--
-- NSW and QLD each publish ONE file holding the whole series, so their stages
-- parse and write the windows in a single pass. SA publishes one file PER
-- FINANCIAL YEAR — seven of them, ~10 MB each — and no edge invocation is
-- going to hold 70 MB. So SA loads one year per call into this table and a
-- finalise pass derives the windows from it.
--
-- It earns its place beyond that: the windows become re-derivable without
-- re-downloading anything, which is what makes a corrected window a query
-- rather than a re-ingest.
create table if not exists public.crime_month_counts (
  state text not null check (state in ('SA', 'NT')),
  area_kind text not null check (area_kind in ('postcode', 'region', 'sa2')),
  area text not null,
  offence text not null,
  month text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  count integer not null check (count >= 0),
  loaded_at timestamptz not null default now(),
  primary key (state, area_kind, area, offence, month)
);

comment on table public.crime_month_counts is
  'Per-month recorded-offence counts staged from the SA and NT registers, from which crime_reference windows are derived. Idempotent by its own key, so re-loading a financial year replaces exactly that year.';

create index if not exists crime_month_counts_state_idx
  on public.crime_month_counts (state, area_kind, month);

alter table public.crime_month_counts enable row level security;
