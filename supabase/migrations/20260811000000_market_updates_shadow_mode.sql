-- Market Updates: shadow mode.
--
-- Until now a source was binary — `enabled` meant "fetch it and publish what it
-- produces", and anything not yet trustworthy had to sit at `enabled = false`,
-- which produces no evidence at all. That is the wrong shape for onboarding a
-- source: the only way to learn whether a feed is worth publishing is to run it
-- through the real pipeline and look at what it would have produced.
--
-- Shadow mode is that third state. A shadow source is fetched, parsed, deduped
-- and classified exactly like a live one, but its items are written with
-- visibility = 'shadow' and can never reach status = 'published'. The client
-- feed is therefore untouched, while source health, discovery volume and the
-- would-be publication rate all become measurable.
--
-- `enabled` is deliberately kept and keeps its existing meaning ("live, publishes
-- to the client feed"). Several older objects read it directly — the automation
-- alert in 20260726210000 and the registry summary in 20260726150000 among them —
-- and a shadow source must not raise a production source-failure alert. A trigger
-- reconciles the two columns so neither write path can leave them disagreeing.

alter table public.market_sources
  add column if not exists ingest_mode text not null default 'live',
  add column if not exists shadow_since timestamptz,
  add column if not exists shadow_promotion_notes text;

-- Backfill before the constraint so existing rows cannot violate it.
update public.market_sources
set ingest_mode = case when enabled then 'live' else 'disabled' end
where ingest_mode is distinct from (case when enabled then 'live' else 'disabled' end);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'market_sources_ingest_mode_check'
  ) then
    alter table public.market_sources
      add constraint market_sources_ingest_mode_check
      check (ingest_mode in ('live', 'shadow', 'disabled'));
  end if;
end $$;

comment on column public.market_sources.ingest_mode is
  'live = fetched and eligible for publication; shadow = fetched and classified but items are held at visibility=shadow and never published; disabled = not fetched at all.';
comment on column public.market_sources.shadow_since is
  'When the source most recently entered shadow mode. Used to age-out validation windows.';
comment on column public.market_sources.shadow_promotion_notes is
  'What has to be true before this source can be promoted from shadow to live.';

-- Keep ingest_mode and enabled consistent whichever column a caller writes.
-- market-updates-source-admin toggles `enabled` only; migrations and the shadow
-- tooling set `ingest_mode` only. Whichever one actually changed in this
-- statement wins, so neither path silently reverts the other.
create or replace function public.market_sources_sync_ingest_mode()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.ingest_mode is null then
      new.ingest_mode := case when new.enabled then 'live' else 'disabled' end;
    end if;
    new.enabled := (new.ingest_mode = 'live');
    if new.ingest_mode = 'shadow' and new.shadow_since is null then
      new.shadow_since := now();
    end if;
    return new;
  end if;

  if new.ingest_mode is distinct from old.ingest_mode then
    new.enabled := (new.ingest_mode = 'live');
  elsif new.enabled is distinct from old.enabled then
    new.ingest_mode := case when new.enabled then 'live' else 'disabled' end;
  end if;

  if new.ingest_mode = 'shadow' and old.ingest_mode is distinct from 'shadow' then
    new.shadow_since := now();
  elsif new.ingest_mode <> 'shadow' then
    new.shadow_since := null;
  end if;

  return new;
end $$;

drop trigger if exists trg_market_sources_sync_ingest_mode on public.market_sources;
create trigger trg_market_sources_sync_ingest_mode
  before insert or update on public.market_sources
  for each row execute function public.market_sources_sync_ingest_mode();

create index if not exists idx_market_sources_ingest_mode
  on public.market_sources(ingest_mode, registry_status);

-- Item-level visibility. 'shadow' rows are produced by shadow sources and are
-- excluded from every client-facing read; shadow_would_publish records the
-- decision the pipeline *would* have reached, which is the whole measurement.
alter table public.market_updates
  add column if not exists visibility text not null default 'public',
  add column if not exists shadow_would_publish boolean;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'market_updates_visibility_check'
  ) then
    alter table public.market_updates
      add constraint market_updates_visibility_check
      check (visibility in ('public', 'shadow'));
  end if;
end $$;

comment on column public.market_updates.visibility is
  'public = eligible for the client feed; shadow = produced by a shadow-mode source and never surfaced to clients.';
comment on column public.market_updates.shadow_would_publish is
  'For shadow rows, whether this item would have been published had the source been live. Null for public rows.';

-- A shadow row must never be published. This is the backstop for the rule the
-- ingest function applies, so a future code path cannot quietly leak one.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'market_updates_shadow_not_published_check'
  ) then
    alter table public.market_updates
      add constraint market_updates_shadow_not_published_check
      check (visibility = 'public' or status <> 'published');
  end if;
end $$;

create index if not exists idx_market_updates_visibility_status
  on public.market_updates(visibility, status, source_published_at desc);

-- Per-source shadow evidence, which is what an operator needs in order to decide
-- whether a source earns promotion. security_invoker so the view cannot be used
-- to read around the callers' own row-level policies.
create or replace view public.market_shadow_source_metrics
with (security_invoker = true) as
select
  s.id                                            as source_id,
  s.source_key,
  s.name,
  s.ingest_mode,
  s.shadow_since,
  s.shadow_promotion_notes,
  s.health_status,
  s.source_authority,
  s.reliability_tier,
  s.consecutive_failures,
  s.last_error,
  s.last_success_at,
  count(u.id)                                                        as shadow_items,
  count(u.id) filter (where u.shadow_would_publish)                  as would_publish,
  count(u.id) filter (where u.status = 'ignored')                    as below_relevance,
  count(u.id) filter (where u.status = 'rejected')                   as rejected,
  round(avg(u.relevance_score) filter (where u.relevance_score is not null), 1) as avg_relevance,
  round(avg(u.confidence_score) filter (where u.confidence_score is not null), 1) as avg_confidence,
  max(u.ingested_at)                                                 as last_shadow_item_at
from public.market_sources s
left join public.market_updates u
  on u.source_id = s.id
 and u.visibility = 'shadow'
 and (s.shadow_since is null or u.ingested_at >= s.shadow_since)
where s.registry_status = 'canonical'
group by s.id;

comment on view public.market_shadow_source_metrics is
  'Evidence gathered for each shadow-mode source since it entered shadow: how much it discovered, and how much of that would have been published had it been live.';
