-- Per-section index over a stored report — Phase 3's addressable projection.
--
-- `investment_reports.report_content` remains the source of truth: it is the
-- document the client received. These tables are a DERIVED index over it that
-- makes a section findable by id instead of only readable as one blob, built
-- by `_shared/reports/investment/sectionStorage.pure.ts` and written by the
-- `report-sections-index` edge function.
--
-- Two rules are enforced by the shape rather than by convention.
--
-- **A repeat is an occurrence, never a merge.** The primary key is
-- (report_id, ordinal) — document order — and `occurrence` numbers the repeats
-- of a section id within one report. Production briefing 89b451f6 carries
-- marketPosition four times and tenYear three; keying on (report_id,
-- section_id) would have silently collapsed a client's document.
--
-- **An index is written only when it proves lossless.** `conserves` records
-- whether re-assembling the sections reproduces the document's non-whitespace
-- content exactly. A report that does not conserve gets an index row saying so
-- and NO section rows — recorded as unindexable rather than partially indexed,
-- because half an index is worse than none. Its counts then read zero, because
-- they describe what is STORED rather than what the partition saw: a labelled
-- row promises a figure, and `total_sections = 21` beside no rows at all is
-- exactly the shape this programme removes. What was seen stays visible in
-- `absorbed` and in the indexing function's own response.

create table if not exists public.investment_report_sections (
  report_id uuid not null references public.investment_reports(id) on delete cascade,
  -- 0-based position in the document. Order is the document's, never sorted.
  ordinal integer not null check (ordinal >= 0),
  section_id text not null,
  -- 1-based index among repeats of the same section_id in this report.
  occurrence integer not null check (occurrence >= 1),
  heading text not null,
  body text not null,
  primary key (report_id, ordinal)
);

comment on table public.investment_report_sections is
  'Derived, addressable index of a stored report''s sections. Never the source of truth — investment_reports.report_content is. Repeats are separate ordered occurrences, never merged.';

create index if not exists investment_report_sections_lookup
  on public.investment_report_sections (report_id, section_id, occurrence);

create table if not exists public.investment_report_section_index (
  report_id uuid primary key references public.investment_reports(id) on delete cascade,
  -- The heading level THIS document uses for its sections. Measured across the
  -- corpus 2026-09-07: 58.6% of stored reports write sections at H1 and only
  -- 41.4% at H2, which is why the level is stored per report rather than assumed.
  heading_level smallint not null check (heading_level in (1, 2)),
  preamble text not null default '',
  distinct_sections integer not null check (distinct_sections >= 0),
  total_sections integer not null check (total_sections >= 0),
  -- Unrecognised headings at the section level, so a genuinely new section
  -- heading appearing in production is visible rather than silently absorbed.
  absorbed jsonb not null default '[]'::jsonb,
  conserves boolean not null,
  -- Of the document indexed. Lets a re-run skip unchanged reports and detect
  -- an index gone stale against an edited document.
  content_hash text not null,
  indexed_at timestamptz not null default now()
);

comment on table public.investment_report_section_index is
  'One row per indexed report: the heading level it uses, its preamble, what was absorbed, and whether the index proved lossless. conserves=false means the report was deliberately left without section rows, and the counts read zero because they describe what is STORED.';

alter table public.investment_report_sections enable row level security;
alter table public.investment_report_section_index enable row level security;
