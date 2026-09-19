-- The open-data sales register — median sale prices by area and quarter,
-- what the Growth dimension of the Investment Grade reads when Domain's
-- suburb series is not held (docs/reports/OPEN_DATA_GROWTH_EVIDENCE.md).
--
-- Loaded by the market-sales-ingest edge function from two publishers, both
-- verified by execution from this project's own egress on 2026-09-15:
--   * QLD — Queensland Government Statistician's Office, residential land
--     development activity spreadsheet: median price and number of detached
--     and attached dwelling sales per local government area, quarterly since
--     June 2008 (area_kind 'lga', plus the publisher's regional groupings as
--     'region'). CC BY 4.0.
--   * NSW — Department of Communities and Justice, Rent and Sales Report
--     sales tables: median sale price and sales count by postcode and by
--     local government area, one workbook per quarter (area_kind 'postcode'
--     and 'lga', plus the state total as 'region'). CC BY 4.0.
--
-- Rows are the publisher's own figures, never estimates: a suppressed
-- median is NULL, never zero. `period` is the quarter the sales settled in
-- (its end month), which is the data's vintage; loaded_at is not.

create table if not exists public.market_sales_medians (
  state text not null check (state in ('QLD', 'NSW')),
  area_kind text not null check (area_kind in ('lga', 'postcode', 'region')),
  -- The publisher's own label ('Moreton Bay (C)', '2155', 'South East Queensland').
  area text not null,
  -- The lookup token (salesAreaToken): a postcode's digits, or the council
  -- name with its dressing stripped — the same rule the crime register uses,
  -- so a cadastre LGA resolves in one indexed lookup.
  area_token text not null,
  dwelling_type text not null check (dwelling_type in ('house', 'attached', 'any')),
  period text not null check (period ~ '^[0-9]{4}-(03|06|09|12)$'),
  median_price numeric check (median_price is null or median_price > 0),
  sales_count integer check (sales_count is null or sales_count >= 0),
  source text not null,
  source_url text not null,
  licence text not null,
  loaded_at timestamptz not null default now(),
  primary key (state, area_kind, area, dwelling_type, period)
);

create index if not exists market_sales_medians_token_idx
  on public.market_sales_medians (state, area_kind, area_token, dwelling_type, period);

comment on table public.market_sales_medians is
  'Open-data median sale prices by area, dwelling type and quarter (QGSO for QLD, DCJ for NSW), loaded by market-sales-ingest. period is the quarter the sales settled in; a suppressed median is NULL, never zero.';

create table if not exists public.market_sales_sync (
  id bigint generated always as identity primary key,
  detail jsonb not null,
  created_at timestamptz not null default now()
);

comment on table public.market_sales_sync is
  'One row per market-sales-ingest run: the file loaded, its own vintage, the counts written, and any refusal.';

alter table public.market_sales_medians enable row level security;
alter table public.market_sales_sync enable row level security;
