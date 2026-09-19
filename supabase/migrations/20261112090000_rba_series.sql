-- RBA statistical-table observations — what rba-data-service reads instead
-- of asking a search model for numbers.
--
-- Loaded by the rba-tables-ingest edge function from three published RBA
-- statistical tables (layouts transcribed from the real files 2026-09-06,
-- acquisition log in docs/reports/MACRO_SOURCES.md):
--   * F1.1 — money-market rates (the cash rate target, monthly average);
--   * G1   — consumer price inflation (index, year-ended, trimmed mean,
--            quarterly), quarterly;
--   * F5   — indicator lending rates (housing: owner-occupier and investor,
--            variable standard/discounted and 3-year fixed), monthly.
--
-- rba.gov.au refuses this project's egress (Akamai 403, measured from a
-- deployed probe 2026-09-06), so the CSV text is fetched by a loader
-- running where egress works and POSTed to the ingest function verbatim —
-- ALL parsing is server-side (the sanctions-register lesson: a loader that
-- parsed differently writes rows no reader matches).
--
-- An empty value cell is an ABSENT observation, never zero: G1 carries
-- future-dated rows (three at transcription time, through 31/03/2027) whose
-- value cells are empty, and reading one as 0 would print a 100-point CPI
-- collapse. No row here, no figure served.

create table if not exists public.rba_series_meta (
  series_id text primary key,
  table_code text not null check (table_code in ('f1.1', 'g1', 'f5')),
  title text not null,
  description text,
  frequency text,
  -- Verbatim from the file's own Units row — G1's index base travels in it
  -- ("Index, September 2025 month = 100") and a rebased file updates it.
  units text not null,
  source text,
  -- The file's own Publication date row, verbatim (e.g. "01-Sep-2026").
  publication_date text,
  last_observation date not null,
  loaded_at timestamptz not null default now()
);

comment on table public.rba_series_meta is
  'Per-series metadata transcribed from the RBA statistical-table CSV header rows by rba-tables-ingest. units and publication_date are the file''s own words; last_observation is the data''s vintage, never the load time.';

create table if not exists public.rba_observations (
  series_id text not null,
  obs_date date not null,
  value numeric not null,
  primary key (series_id, obs_date)
);

comment on table public.rba_observations is
  'Dated observations from the RBA statistical tables. A period the file leaves empty has no row — absent is absent, never zero.';

create table if not exists public.rba_sync (
  id bigint generated always as identity primary key,
  detail jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.rba_series_meta enable row level security;
alter table public.rba_observations enable row level security;
alter table public.rba_sync enable row level security;

-- The old rba-data-service cached a search model's answers here for 24h and
-- financial-calculator-service read CPI projections out of the same entry.
-- Both now read the tables above; the entry is inert and a stale copy of
-- model output has no business surviving where a future reader might trust
-- it. (Same treatment as 20261112020000_purge_fabricated_source_caches.)
delete from public.economic_data_cache where data_type = 'rba_indicators';
