-- ME-6 — the immutable evidence snapshot ME-7 backtests against.
--
-- WHY THIS EXISTS
--
-- ME-7 runs the trusted historical corpus and decides whether the V2 scoring
-- methodology needs calibrating. That is only meaningful if re-running it gives
-- the same answer. A provider's suburb median moves every quarter and its API
-- can be re-priced, rate-limited or withdrawn -- so a backtest driven by live
-- calls is a measurement whose instrument changes while it is being read.
--
-- The snapshot is the unit of reproducibility: extract once, seal, and let
-- every later run read the sealed bytes.
--
-- SEALED MEANS SEALED, AND THE DATABASE ENFORCES IT
--
-- The pure module computes a content hash on seal, but an application-level
-- rule is only as good as the one caller that forgets it -- this repository has
-- twice found a rule that lived only in TypeScript and was bypassed by the
-- call site that mattered. So the trigger below refuses UPDATE and DELETE on a
-- sealed snapshot and on any record belonging to one. There is deliberately no
-- "force" flag: a snapshot that needs different evidence is a NEW snapshot.
--
-- TWO DATES, NEVER ONE
--
-- extracted_at is when we asked the provider; evidence_as_of is the newest
-- period the DATA describes. The sanctions work settled why both are needed --
-- freshness of the load is not currency of the data, and a four-year-old file
-- downloaded today passes every check that reads only the download date.
--
-- LICENSING IS A PROPERTY OF THE EVIDENCE
--
-- licensing_status defaults to 'unverified', which means scorable in a shadow
-- backtest and NOT renderable in a client document. It is never inferred: the
-- default is the conservative reading, because assuming a right nobody has
-- confirmed is how a licence gets breached in a document already emailed.

create table if not exists public.market_evidence_snapshots (
  snapshot_id          text primary key,
  schema_version       text        not null default 'me6.snapshot.1',
  status               text        not null default 'draft'
                                   check (status in ('draft','sealed')),
  provider             text        not null,
  source_product       text,
  -- When we asked the provider.
  extracted_at         timestamptz not null,
  -- The newest period the DATA describes. Set on seal; NOT the extraction date.
  evidence_as_of       date,
  -- A score is only reproducible against the code that produced it.
  methodology_versions jsonb       not null default '{}'::jsonb,
  -- The MOST restrictive licence across every record.
  licensing_status     text        not null default 'unverified'
                                   check (licensing_status in
                                     ('open','licensed_for_client_reports','internal_only','unverified')),
  content_hash         text,
  sealed_at            timestamptz,
  created_at           timestamptz not null default now(),
  notes                jsonb       not null default '{}'::jsonb,
  -- A sealed snapshot must carry the two things that make it reproducible.
  constraint market_evidence_snapshots_sealed_is_complete
    check (status <> 'sealed' or (content_hash is not null and sealed_at is not null))
);

comment on table public.market_evidence_snapshots is
  'ME-6: immutable, versioned market-evidence extractions. A sealed snapshot is what ME-7 backtests against, so that re-running the backtest reads the same bytes rather than a provider''s moving series.';
comment on column public.market_evidence_snapshots.extracted_at is
  'When the provider was asked. Never confuse with evidence_as_of.';
comment on column public.market_evidence_snapshots.evidence_as_of is
  'The newest period the DATA describes. Freshness of the load is not currency of the data.';
comment on column public.market_evidence_snapshots.licensing_status is
  'Defaults to unverified: scorable in a shadow backtest, NOT renderable to a client. Never inferred.';

create table if not exists public.market_evidence_snapshot_records (
  id              bigserial primary key,
  snapshot_id     text not null references public.market_evidence_snapshots(snapshot_id) on delete cascade,
  -- '<state>|<suburb>|<postcode>|<dwelling_type>'
  subject_key     text not null,
  state           text not null,
  suburb          text not null,
  postcode        text not null,
  dwelling_type   text not null,
  -- An EvidenceKey: medianPrice, growth1Year, priceSeries, ...
  measure         text not null,
  -- The EvidencePoint exactly as the adapter produced it.
  point           jsonb not null,
  -- Quality findings that travelled with it. Never a correction: this
  -- programme flags an extreme market move, it does not clip one.
  quality_findings jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now(),
  -- One measure per subject per snapshot.
  constraint market_evidence_snapshot_records_unique unique (snapshot_id, subject_key, measure)
);

comment on table public.market_evidence_snapshot_records is
  'ME-6: one measure for one subject, as the provider adapter produced it. quality_findings never carries a corrected value.';

create index if not exists market_evidence_snapshot_records_snapshot_idx
  on public.market_evidence_snapshot_records (snapshot_id);
create index if not exists market_evidence_snapshot_records_subject_idx
  on public.market_evidence_snapshot_records (snapshot_id, state, suburb, postcode, dwelling_type);

-- ── immutability ─────────────────────────────────────────────────────────────
-- A sealed snapshot cannot be edited or deleted, and its records cannot be
-- edited, deleted or added to. Sealing itself is the one permitted transition.

create or replace function public.market_evidence_snapshot_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'market_evidence_snapshots' then
    if tg_op = 'DELETE' then
      if old.status = 'sealed' then
        raise exception
          'market_evidence_snapshots: % is sealed and cannot be deleted. A snapshot that needs different evidence is a NEW snapshot.',
          old.snapshot_id
          using errcode = '42501';
      end if;
      return old;
    end if;

    -- UPDATE: the only permitted change to a sealed row is none at all; the
    -- draft -> sealed transition is permitted once.
    if old.status = 'sealed' then
      raise exception
        'market_evidence_snapshots: % is sealed. Its result is only reproducible while its bytes are unchanged.',
        old.snapshot_id
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- records
  if exists (
    select 1 from public.market_evidence_snapshots s
    where s.snapshot_id = coalesce(new.snapshot_id, old.snapshot_id)
      and s.status = 'sealed'
  ) then
    raise exception
      'market_evidence_snapshot_records: snapshot % is sealed; its records cannot be %.',
      coalesce(new.snapshot_id, old.snapshot_id), lower(tg_op)
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

-- CREATE FUNCTION grants EXECUTE to PUBLIC by default, and `anon` inherits it --
-- so a SECURITY DEFINER function ships reachable by the publishable key in the
-- browser bundle unless it is revoked. This one is invoked by the trigger
-- mechanism and never by a caller, so nothing is granted back.
-- Revoking from `anon` alone would be a no-op: the grant is on PUBLIC.
revoke execute on function public.market_evidence_snapshot_guard() from public, anon, authenticated;

drop trigger if exists market_evidence_snapshots_guard on public.market_evidence_snapshots;
create trigger market_evidence_snapshots_guard
  before update or delete on public.market_evidence_snapshots
  for each row execute function public.market_evidence_snapshot_guard();

drop trigger if exists market_evidence_snapshot_records_guard on public.market_evidence_snapshot_records;
create trigger market_evidence_snapshot_records_guard
  before insert or update or delete on public.market_evidence_snapshot_records
  for each row execute function public.market_evidence_snapshot_guard();

-- ── access ───────────────────────────────────────────────────────────────────
-- Shadow-backtest infrastructure. No browser reads it; the service role and the
-- edge functions do. RLS on with no permissive policy is the correct posture --
-- it is not client-facing data and a policy that let a browser read it would be
-- publishing a provider's licensed series.

alter table public.market_evidence_snapshots enable row level security;
alter table public.market_evidence_snapshot_records enable row level security;

revoke all on public.market_evidence_snapshots from anon, authenticated;
revoke all on public.market_evidence_snapshot_records from anon, authenticated;
