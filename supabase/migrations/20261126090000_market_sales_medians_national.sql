-- The open-data sales register grows from two states to every state, and
-- from two grains to five.
--
-- 20261125090000 created `market_sales_medians` for Queensland (by local
-- government area) and New South Wales (by postcode), both quarterly medians.
-- Three more series now load into the same register, and each needs a shape
-- the first migration's checks refused:
--
--   * The Australian Bureau of Statistics' RES_DWELL_ST series — the MEAN
--     price of residential dwellings, by state and territory and for
--     Australia, quarterly since 2011-Q3, CC BY 4.0. It is the growth floor
--     for every state (Western Australia publishes no open sub-state series
--     at all) and the national benchmark. A mean is not a median, so the
--     measure is recorded on the row (`price_measure`) rather than a mean
--     being filed as a median; and the national row needs a state code, so
--     `AU` joins the eight jurisdictions with `area_kind = 'national'`.
--   * The Victorian Valuer-General's median house and unit prices by SUBURB
--     — an annual series (calendar-year medians, `period_span = 'year'`,
--     stored under the year's December quarter) plus the latest quarterly
--     file — served by the Internet Archive's Wayback Machine because
--     land.vic.gov.au refuses every scripted client. `captured_at` records
--     when the archive took the copy the rows came from, because a mirror's
--     currency is bounded by its capture and a reader must be able to see it.
--   * South Australia's quarterly suburb medians (`lsg_stats_*.xlsx`), also
--     from the archive, for the same reason.
--
-- Everything else is unchanged: the primary key, the token index, the RLS
-- posture (enabled, no policies — service-role reads and writes only), the
-- period check (an annual row is `YYYY-12`), and every QLD/NSW row already
-- loaded, which the new defaults describe correctly (median, quarter, no
-- capture because they came from the publisher directly).

alter table public.market_sales_medians
  drop constraint if exists market_sales_medians_state_check;
alter table public.market_sales_medians
  add constraint market_sales_medians_state_check
  check (state in ('NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT', 'AU'));

alter table public.market_sales_medians
  drop constraint if exists market_sales_medians_area_kind_check;
alter table public.market_sales_medians
  add constraint market_sales_medians_area_kind_check
  check (area_kind in ('suburb', 'postcode', 'lga', 'region', 'state', 'national'));

alter table public.market_sales_medians
  add column if not exists price_measure text not null default 'median';
alter table public.market_sales_medians
  drop constraint if exists market_sales_medians_price_measure_check;
alter table public.market_sales_medians
  add constraint market_sales_medians_price_measure_check
  check (price_measure in ('median', 'mean'));

alter table public.market_sales_medians
  add column if not exists period_span text not null default 'quarter';
alter table public.market_sales_medians
  drop constraint if exists market_sales_medians_period_span_check;
alter table public.market_sales_medians
  add constraint market_sales_medians_period_span_check
  check (period_span in ('quarter', 'year'));

alter table public.market_sales_medians
  add column if not exists captured_at timestamptz;

comment on column public.market_sales_medians.price_measure is
  'What the price column holds: the publisher''s median sale price (median) or, for the ABS state series, the mean price of the dwelling stock (mean). A mean is never filed as a median.';
comment on column public.market_sales_medians.period_span is
  'Whether the row describes one quarter (quarter) or a calendar year stored under its December quarter (year), as the Victorian suburb series is published.';
comment on column public.market_sales_medians.captured_at is
  'When the Internet Archive captured the file the row came from, for series the publisher''s host refuses to serve this project; null where the file came from the publisher directly.';

-- A calendar-year median and the December quarter's median are different
-- figures for the same suburb, dwelling and `YYYY-12`, so the span joins
-- the key: the Victorian suburb series carries both.
alter table public.market_sales_medians
  drop constraint if exists market_sales_medians_pkey;
alter table public.market_sales_medians
  add primary key (state, area_kind, area, dwelling_type, period, period_span);
