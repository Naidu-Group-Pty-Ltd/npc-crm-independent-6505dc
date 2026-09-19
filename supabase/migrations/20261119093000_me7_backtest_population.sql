-- ME-6 closure — the frozen ME-7 backtest population.
--
-- ME-6 reported two Growth-addressable denominators (641 and 663) for the same
-- idea. An ambiguous denominator makes every coverage percentage that follows
-- unfalsifiable, so the population is now decided once, by
-- `_shared/reports/market/growthPopulation.pure.ts`, and FROZEN here.
--
-- The rule this table exists to enforce:
--
--   **Provider coverage is measured AGAINST the population; it never defines
--   the population.**
--
-- Without that, a provider outage silently shrinks the denominator and the
-- coverage percentage improves — the metric moves in the wrong direction under
-- exactly the fault it is supposed to reveal. So membership is settled before
-- any provider is called, and a sealed manifest cannot be edited afterwards.
--
-- Immutability mirrors `market_evidence_snapshots` deliberately: the same
-- draft -> sealed transition, the same refusal of UPDATE and DELETE once
-- sealed, the same absence of any "unseal". A population that needs different
-- membership is a NEW version, so a backtest can always say which one it ran
-- against.

create table if not exists public.me7_backtest_populations (
  id                    uuid        primary key default gen_random_uuid(),
  -- The predicate version from growthPopulation.pure.ts (e.g. 'me7.pop.1').
  -- Stored rather than assumed, so a manifest sealed under an older predicate
  -- is still readable and still says what produced it.
  predicate_version     text        not null,
  status                text        not null default 'draft'
                                    check (status in ('draft','sealed')),
  -- What was considered, and what qualified. Both, because a denominator with
  -- no numerator above it cannot be checked.
  considered_count      integer     not null,
  ready_count           integer     not null,
  -- Counts by state / dwelling class / resolution route, as measured.
  tally                 jsonb       not null default '{}'::jsonb,
  notes                 text,
  content_hash          text,
  sealed_at             timestamptz,
  created_at            timestamptz not null default now(),
  created_by            uuid,

  constraint me7_backtest_populations_sealed_is_complete
    check (status <> 'sealed' or (content_hash is not null and sealed_at is not null)),
  constraint me7_backtest_populations_counts_sane
    check (ready_count >= 0 and ready_count <= considered_count)
);

comment on table public.me7_backtest_populations is
  'ME-6 closure: the frozen Growth-ready population ME-7 backtests against. Provider coverage is measured against this; it never defines it.';
comment on column public.me7_backtest_populations.predicate_version is
  'The growthPopulation.pure.ts version that decided membership. A manifest is only interpretable beside the rule that built it.';

create table if not exists public.me7_backtest_population_members (
  id                    uuid        primary key default gen_random_uuid(),
  population_id         uuid        not null
                                    references public.me7_backtest_populations(id) on delete cascade,
  report_id             uuid        not null,
  -- Canonical geography, as resolved. Never the free-text address: 183 reports
  -- prove why (ADDRESS_COMPOSITION.md).
  suburb                text,
  state                 text,
  postcode              text,
  -- Canonical dwelling type and the provider segmentation it maps to.
  dwelling_type         text,
  dwelling_class        text        check (dwelling_class in ('house','attached')),
  -- Which of the three deterministic routes established the type.
  resolution_route      text        check (resolution_route in
                          ('property_specs','financial_calculations','sibling_canonical_key')),
  included              boolean     not null,
  exclusion_reason      text        check (exclusion_reason in
                          ('geography_absent','dwelling_type_unresolved','dwelling_type_not_segmentable')),
  created_at            timestamptz not null default now(),

  -- An included member must carry the two things a provider is asked for; an
  -- excluded one must say why. Neither is optional, because a row that is in
  -- with no geography and a row that is out with no reason are both unusable.
  constraint me7_member_included_is_addressable
    check (not included or (suburb is not null and state is not null
                            and dwelling_class is not null and resolution_route is not null)),
  constraint me7_member_excluded_has_reason
    check (included or exclusion_reason is not null),
  constraint me7_member_unique_per_population unique (population_id, report_id)
);

comment on table public.me7_backtest_population_members is
  'One row per considered report: its canonical geography, dwelling class, resolution route, and inclusion or exclusion reason.';

create index if not exists me7_members_population_idx
  on public.me7_backtest_population_members (population_id, included);
create index if not exists me7_members_state_class_idx
  on public.me7_backtest_population_members (population_id, state, dwelling_class);

-- A sealed population cannot be edited or deleted, and neither can its members.
-- There is deliberately no path back to draft.
create or replace function public.me7_backtest_population_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'me7_backtest_populations' then
    if tg_op = 'DELETE' then
      if old.status = 'sealed' then
        raise exception
          'me7_backtest_populations: % is sealed and cannot be deleted. A different membership is a NEW population.',
          old.id;
      end if;
      return old;
    end if;

    if old.status = 'sealed' then
      raise exception
        'me7_backtest_populations: % is sealed. A backtest is only reproducible while its population is unchanged.',
        old.id;
    end if;
    return new;
  end if;

  -- Members follow their population's status.
  if exists (
    select 1 from public.me7_backtest_populations p
    where p.id = coalesce(old.population_id, new.population_id)
      and p.status = 'sealed'
  ) then
    raise exception
      'me7_backtest_population_members: population % is sealed; its members cannot be %.',
      coalesce(old.population_id, new.population_id), lower(tg_op);
  end if;

  return coalesce(new, old);
end;
$$;

-- WP-17: a SECURITY DEFINER function is reachable from the browser bundle
-- unless it is revoked. This one is invoked by the triggers below and by
-- nothing else.
revoke execute on function public.me7_backtest_population_guard() from public, anon, authenticated;

drop trigger if exists me7_backtest_populations_guard on public.me7_backtest_populations;
create trigger me7_backtest_populations_guard
  before update or delete on public.me7_backtest_populations
  for each row execute function public.me7_backtest_population_guard();

drop trigger if exists me7_backtest_population_members_guard on public.me7_backtest_population_members;
create trigger me7_backtest_population_members_guard
  before update or delete on public.me7_backtest_population_members
  for each row execute function public.me7_backtest_population_guard();

alter table public.me7_backtest_populations        enable row level security;
alter table public.me7_backtest_population_members enable row level security;
